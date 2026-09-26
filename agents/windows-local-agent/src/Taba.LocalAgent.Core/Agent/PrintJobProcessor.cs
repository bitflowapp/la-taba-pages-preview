using System.Diagnostics;
using Microsoft.Extensions.Logging;
using Taba.LocalAgent.Core.Backend;
using Taba.LocalAgent.Core.Documents;
using Taba.LocalAgent.Core.Printing;
using Taba.LocalAgent.Core.Security;

namespace Taba.LocalAgent.Core.Agent;

/// <summary>
/// Imprime UN trabajo reclamado, en este orden y sin atajos:
///
///   1. se anota en el diario (reclamado);
///   2. si un reclamo anterior del mismo trabajo pudo haber impreso, no se imprime: revisión;
///   3. se arma el documento (un payload malformado nunca se imprime a medias);
///   4. se registra «printing» en el backend ANTES de tocar el spooler; sin esa
///      confirmación no se imprime;
///   5. se anota «entregando» y recién ahí se manda a la impresora;
///   6. el resultado honesto (impreso, no impreso, desconocido) se informa, y si
///      el backend no está, queda pendiente en el diario hasta que vuelva.
/// </summary>
public sealed partial class PrintJobProcessor(
    PrintJournal journal,
    IBackendClient backend,
    PrinterRouter router,
    PrintRoutes routes,
    TicketComposer composer,
    AgentState state,
    ILogger<PrintJobProcessor> logger)
{
    public async Task<JournalEntry> ProcessAsync(DeviceCredential credential, ClaimedJob job, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(credential);
        ArgumentNullException.ThrowIfNull(job);
        if (journal.Find(job.Id, job.ClaimToken) is { } existing)
        {
            LogDuplicateClaim(logger, job.Id, credential.DeviceId);
            return existing;
        }

        var reprint = job.ReprintOf is not null;
        if (journal.MayHavePrinted(job.Id))
        {
            // El mismo trabajo volvió con otro reclamo, pero acá ya pudo haber
            // salido papel: nunca un segundo ticket automático.
            var duplicate = journal.Begin(job.Id, job.ClaimToken, job.DocumentType, job.Attempt, reprint);
            duplicate = journal.Update(duplicate, JournalState.Unknown, PendingReport.Unknown, "DUPLICATE_JOB_DELIVERY");
            LogOutcome(logger, job.Id, credential.DeviceId, "-", "unknown", 0, "DUPLICATE_JOB_DELIVERY");
            await TryReportAsync(credential, duplicate, cancellationToken).ConfigureAwait(false);
            return duplicate;
        }

        var entry = journal.Begin(job.Id, job.ClaimToken, job.DocumentType, job.Attempt, reprint);
        var profile = routes.For(job.DocumentType);
        if (profile is null)
        {
            return await FinishNotSentAsync(credential, entry, "NO_PRINTER_FOR_DOCUMENT", cancellationToken).ConfigureAwait(false);
        }

        PrintContent content;
        try
        {
            if (job.PayloadVersion != PrintPayloadParser.SupportedVersion)
            {
                throw new MalformedPayloadException("PAYLOAD_VERSION_UNSUPPORTED");
            }

            content = Render(job);
        }
        catch (MalformedPayloadException error)
        {
            return await FinishNotSentAsync(credential, entry, error.Code, cancellationToken).ConfigureAwait(false);
        }

        try
        {
            await backend.UpdateJobAsync(credential, job.Id, job.ClaimToken, JobTransition.Printing, null, null, cancellationToken).ConfigureAwait(false);
            state.BackendReached();
        }
        catch (BackendException error) when (error.Kind is BackendErrorKind.Conflict or BackendErrorKind.NotFound)
        {
            // El reclamo venció o es de otro: no se imprime y no hay nada que contar.
            LogAbandoned(logger, job.Id, credential.DeviceId, error.Code);
            return journal.Update(entry, JournalState.Abandoned, PendingReport.None, error.Code);
        }
        catch (BackendException error) when (error.Kind is BackendErrorKind.Unauthorized)
        {
            state.SetRegistration(RegistrationStatus.Revoked);
            LogAbandoned(logger, job.Id, credential.DeviceId, error.Code);
            return journal.Update(entry, JournalState.Abandoned, PendingReport.None, "DEVICE_UNAUTHORIZED");
        }
        catch (BackendException error)
        {
            // Sin confirmación de «printing» no se imprime. Nada salió: se
            // devuelve el trabajo a la cola apenas vuelva el backend.
            state.BackendFailed(error.Code);
            entry = journal.Update(entry, JournalState.NotSent, PendingReport.NotPrinted, "BACKEND_UNAVAILABLE");
            LogOutcome(logger, job.Id, credential.DeviceId, profile.PrinterName, "not_printed", 0, "BACKEND_UNAVAILABLE");
            return entry;
        }

        entry = journal.Update(entry, JournalState.MarkedPrinting, printerName: profile.PrinterName);
        entry = journal.Update(entry, JournalState.Sending);
        var watch = Stopwatch.StartNew();
        PrintOutcome outcome;
        try
        {
            outcome = await router.PrintAsync(content, profile, $"La Taba {job.DocumentType.ToWire()} {job.Id:N}", cancellationToken).ConfigureAwait(false);
        }
        catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested)
        {
            // Se detuvo el servicio a mitad de la entrega: no se sabe si salió.
            journal.Update(entry, JournalState.Unknown, PendingReport.Unknown, "AGENT_STOPPED_DURING_PRINT");
            throw;
        }
#pragma warning disable CA1031 // Cualquier falla del driver es un resultado desconocido, nunca un reintento ciego.
        catch (Exception)
#pragma warning restore CA1031
        {
            outcome = PrintOutcome.Unknown("PRINTER_EXCEPTION");
        }

        var duration = (int)Math.Min(watch.ElapsedMilliseconds, int.MaxValue);
        entry = outcome.Status switch
        {
            PrintOutcomeStatus.Sent => journal.Update(entry, JournalState.Sent, PendingReport.Printed, null, duration),
            PrintOutcomeStatus.NotSent => journal.Update(entry, JournalState.NotSent, PendingReport.NotPrinted, outcome.ErrorCode ?? "NOT_PRINTED", duration),
            _ => journal.Update(entry, JournalState.Unknown, PendingReport.Unknown, outcome.ErrorCode ?? "PRINT_OUTCOME_UNKNOWN", duration),
        };
        if (outcome.Status == PrintOutcomeStatus.Sent)
        {
            state.Printed();
        }

        LogOutcome(logger, job.Id, credential.DeviceId, profile.PrinterName,
            outcome.Status switch { PrintOutcomeStatus.Sent => "printed", PrintOutcomeStatus.NotSent => "not_printed", _ => "unknown" },
            duration, entry.ErrorCode ?? "-");
        await TryReportAsync(credential, entry, cancellationToken).ConfigureAwait(false);
        return journal.List().First(e => e.JobId == entry.JobId && e.ClaimToken == entry.ClaimToken);
    }

    /// <summary>Informa lo pendiente del diario, en orden. Corta al primer backend caído.</summary>
    public async Task<int> FlushReportsAsync(DeviceCredential credential, CancellationToken cancellationToken)
    {
        var reported = 0;
        foreach (var entry in journal.PendingReports())
        {
            if (!await TryReportAsync(credential, entry, cancellationToken).ConfigureAwait(false))
            {
                break;
            }

            reported++;
        }

        return reported;
    }

    private TicketContent Render(ClaimedJob job) => job.DocumentType switch
    {
        DocumentType.KitchenTicket => new TicketContent(composer.KitchenTicket(PrintPayloadParser.ParseOrder(job.Payload))),
        DocumentType.OrderTicket => new TicketContent(composer.OrderTicket(PrintPayloadParser.ParseOrder(job.Payload))),
        DocumentType.FiscalReceipt => new TicketContent(TicketComposer.FiscalReceipt(PrintPayloadParser.ParseFiscal(job.Payload))),
        _ => throw new MalformedPayloadException("UNKNOWN_DOCUMENT_TYPE"),
    };

    private async Task<JournalEntry> FinishNotSentAsync(DeviceCredential credential, JournalEntry entry, string code, CancellationToken cancellationToken)
    {
        entry = journal.Update(entry, JournalState.NotSent, PendingReport.NotPrinted, code);
        LogOutcome(logger, entry.JobId, credential.DeviceId, entry.PrinterName ?? "-", "not_printed", 0, code);
        await TryReportAsync(credential, entry, cancellationToken).ConfigureAwait(false);
        return entry;
    }

    private async Task<bool> TryReportAsync(DeviceCredential credential, JournalEntry entry, CancellationToken cancellationToken)
    {
        var transition = entry.PendingReport switch
        {
            PendingReport.Printed => JobTransition.Printed,
            PendingReport.NotPrinted => JobTransition.NotPrinted,
            PendingReport.Unknown => JobTransition.Unknown,
            _ => (JobTransition?)null,
        };
        if (transition is null)
        {
            return true;
        }

        try
        {
            await backend.UpdateJobAsync(credential, entry.JobId, entry.ClaimToken, transition.Value,
                transition == JobTransition.Printed ? null : entry.ErrorCode, entry.DurationMs, cancellationToken).ConfigureAwait(false);
            journal.MarkReported(entry);
            state.BackendReached();
            return true;
        }
        catch (BackendException error) when (error.Kind is BackendErrorKind.Conflict or BackendErrorKind.NotFound
            or BackendErrorKind.Invalid or BackendErrorKind.NotAllowed)
        {
            // El backend ya decidió otra cosa (por ejemplo, una persona resolvió
            // la revisión). Manda el backend: se cierra acá sin reintentar.
            journal.MarkReported(entry);
            LogReportSuperseded(logger, entry.JobId, credential.DeviceId, error.Code);
            return true;
        }
        catch (BackendException error) when (error.Kind is BackendErrorKind.Unauthorized)
        {
            state.SetRegistration(RegistrationStatus.Revoked);
            return false;
        }
        catch (BackendException error)
        {
            state.BackendFailed(error.Code);
            LogReportDeferred(logger, entry.JobId, credential.DeviceId, error.Code);
            return false;
        }
    }

    [LoggerMessage(EventId = 100, Level = LogLevel.Information,
        Message = "print_job action={Action} job={JobId} device={DeviceId} printer={Printer} duration_ms={DurationMs} error={ErrorCode}")]
    private static partial void LogOutcome(ILogger logger, Guid jobId, Guid deviceId, string printer, string action, int durationMs, string errorCode);

    [LoggerMessage(EventId = 101, Level = LogLevel.Warning, Message = "print_job action=abandoned job={JobId} device={DeviceId} error={ErrorCode}")]
    private static partial void LogAbandoned(ILogger logger, Guid jobId, Guid deviceId, string errorCode);

    [LoggerMessage(EventId = 102, Level = LogLevel.Information, Message = "print_job action=duplicate_claim_ignored job={JobId} device={DeviceId}")]
    private static partial void LogDuplicateClaim(ILogger logger, Guid jobId, Guid deviceId);

    [LoggerMessage(EventId = 103, Level = LogLevel.Warning, Message = "print_job action=report_deferred job={JobId} device={DeviceId} error={ErrorCode}")]
    private static partial void LogReportDeferred(ILogger logger, Guid jobId, Guid deviceId, string errorCode);

    [LoggerMessage(EventId = 104, Level = LogLevel.Information, Message = "print_job action=report_superseded job={JobId} device={DeviceId} error={ErrorCode}")]
    private static partial void LogReportSuperseded(ILogger logger, Guid jobId, Guid deviceId, string errorCode);
}
