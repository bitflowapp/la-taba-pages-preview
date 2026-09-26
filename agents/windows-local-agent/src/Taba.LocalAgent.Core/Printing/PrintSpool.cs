namespace Taba.LocalAgent.Core.Printing;

/// <summary>
/// La cola de impresión del local (el «spool» del mostrador).
///
/// Reglas que no se negocian:
///  · una misma clave de idempotencia es un solo trabajo: pedirlo dos veces no imprime dos veces;
///  · el estado <see cref="PrintJobState.Printing"/> se persiste ANTES de mandar los bytes, así un
///    reinicio en medio deja el trabajo como <see cref="PrintJobState.Unknown"/> y no se reimprime solo;
///  · reimprimir crea OTRO trabajo que apunta al original y dice quién lo pidió;
///  · sólo se reintenta automáticamente lo que no llegó a enviarse.
/// </summary>
public sealed class PrintSpool : IDisposable
{
    public const int MaxAutomaticAttempts = 3;

    private readonly IPrintJobStore _store;
    private readonly IPrinterResolver _printers;
    private readonly TimeProvider _clock;
    private readonly SemaphoreSlim _gate = new(1, 1);

    public PrintSpool(IPrintJobStore store, IPrinterResolver printers, TimeProvider? clock = null)
    {
        _store = store;
        _printers = printers;
        _clock = clock ?? TimeProvider.System;
    }

    public PrintJob Enqueue(PrintRequest request)
    {
        ArgumentNullException.ThrowIfNull(request);
        ValidateRequest(request);
        _gate.Wait();
        try
        {
            var existing = FindByKey(request.IdempotencyKey);
            if (existing is not null)
            {
                return existing;
            }

            var now = _clock.GetUtcNow();
            var job = new PrintJob
            {
                JobId = Guid.NewGuid().ToString("N"),
                IdempotencyKey = request.IdempotencyKey,
                Kind = request.Kind,
                Format = request.Format,
                PrinterName = request.PrinterName,
                PayloadBase64 = Convert.ToBase64String(request.Payload.Span),
                Copies = request.Copies,
                RequestedBy = request.RequestedBy,
                State = PrintJobState.Queued,
                CreatedAt = now,
                UpdatedAt = now,
            };
            _store.Save(job);
            return job;
        }
        finally
        {
            _gate.Release();
        }
    }

    /// <summary>Reimpresión auditada: nuevo trabajo, misma carga, referencia al original.</summary>
    public PrintJob Reprint(string jobId, string requestedBy)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(requestedBy);
        _gate.Wait();
        try
        {
            var original = Find(jobId) ?? throw new KeyNotFoundException("PRINT_JOB_NOT_FOUND");
            var reprints = _store.LoadAll().Count(j => string.Equals(j.ReprintOf, original.JobId, StringComparison.Ordinal));
            var now = _clock.GetUtcNow();
            var job = original with
            {
                JobId = Guid.NewGuid().ToString("N"),
                IdempotencyKey = $"{original.IdempotencyKey}:reprint:{reprints + 1}",
                ReprintOf = original.JobId,
                RequestedBy = requestedBy,
                State = PrintJobState.Queued,
                CreatedAt = now,
                UpdatedAt = now,
                Attempts = 0,
                LastErrorCode = null,
            };
            _store.Save(job);
            return job;
        }
        finally
        {
            _gate.Release();
        }
    }

    public async Task<PrintJob> DispatchAsync(string jobId, CancellationToken cancellationToken = default)
    {
        await _gate.WaitAsync(cancellationToken).ConfigureAwait(false);
        try
        {
            var job = Find(jobId) ?? throw new KeyNotFoundException("PRINT_JOB_NOT_FOUND");
            if (job.State is not (PrintJobState.Queued or PrintJobState.Failed))
            {
                return job;
            }

            if (job.State == PrintJobState.Failed && job.Attempts >= MaxAutomaticAttempts)
            {
                return job;
            }

            var printer = _printers.Resolve(job.PrinterName, job.Format);
            if (printer is null)
            {
                return Save(job with { State = PrintJobState.Failed, Attempts = job.Attempts + 1, LastErrorCode = "PRINTER_NOT_FOUND" });
            }

            // Se persiste antes de tocar el spooler: es lo que permite saber,
            // después de un reinicio, que este trabajo pudo haber salido.
            job = Save(job with { State = PrintJobState.Printing, Attempts = job.Attempts + 1, LastErrorCode = null });
            var payload = Convert.FromBase64String(job.PayloadBase64);
            var outcome = PrintOutcome.Sent();
            for (var copy = 0; copy < job.Copies && outcome.Status == PrintOutcomeStatus.Sent; copy++)
            {
                outcome = await printer.SendAsync(payload, DocumentTitle(job), cancellationToken).ConfigureAwait(false);
                // Si falla una copia después de la primera, ya salió papel.
                if (copy > 0 && outcome.Status == PrintOutcomeStatus.NotSent)
                {
                    outcome = PrintOutcome.Unknown(outcome.ErrorCode ?? "COPY_INTERRUPTED");
                }
            }

            return Save(outcome.Status switch
            {
                PrintOutcomeStatus.Sent => job with { State = PrintJobState.Printed },
                PrintOutcomeStatus.NotSent => job with { State = PrintJobState.Failed, LastErrorCode = outcome.ErrorCode },
                _ => job with { State = PrintJobState.Unknown, LastErrorCode = outcome.ErrorCode },
            });
        }
        finally
        {
            _gate.Release();
        }
    }

    /// <summary>Despacha lo pendiente en orden de llegada. Lo fallido se reintenta hasta el tope.</summary>
    public async Task<IReadOnlyList<PrintJob>> DispatchPendingAsync(CancellationToken cancellationToken = default)
    {
        var pending = _store.LoadAll()
            .Where(j => j.State == PrintJobState.Queued
                || (j.State == PrintJobState.Failed && j.Attempts < MaxAutomaticAttempts))
            .OrderBy(j => j.CreatedAt)
            .Select(j => j.JobId)
            .ToList();
        var results = new List<PrintJob>(pending.Count);
        foreach (var id in pending)
        {
            results.Add(await DispatchAsync(id, cancellationToken).ConfigureAwait(false));
        }

        return results;
    }

    /// <summary>
    /// Al arrancar: lo que quedó «imprimiendo» pasa a «desconocido». No se
    /// reimprime solo porque puede haber salido el papel.
    /// </summary>
    public IReadOnlyList<PrintJob> RecoverAfterRestart()
    {
        _gate.Wait();
        try
        {
            return _store.LoadAll()
                .Where(j => j.State == PrintJobState.Printing)
                .Select(j => Save(j with { State = PrintJobState.Unknown, LastErrorCode = "RESTART_DURING_PRINT" }))
                .ToList();
        }
        finally
        {
            _gate.Release();
        }
    }

    public void Dispose() => _gate.Dispose();

    public PrintJob? Find(string jobId) =>
        _store.LoadAll().FirstOrDefault(j => string.Equals(j.JobId, jobId, StringComparison.Ordinal));

    public IReadOnlyList<PrintJob> List() => _store.LoadAll();

    private PrintJob? FindByKey(string key) =>
        _store.LoadAll().FirstOrDefault(j => string.Equals(j.IdempotencyKey, key, StringComparison.Ordinal));

    private PrintJob Save(PrintJob job)
    {
        var saved = job with { UpdatedAt = _clock.GetUtcNow() };
        _store.Save(saved);
        return saved;
    }

    private static string DocumentTitle(PrintJob job) => job.Kind switch
    {
        PrintDocumentKind.KitchenTicket => "La Taba - comanda",
        PrintDocumentKind.OrderTicket => "La Taba - pedido",
        PrintDocumentKind.FiscalReceipt => "La Taba - comprobante",
        _ => "La Taba - prueba",
    };

    private static void ValidateRequest(PrintRequest request)
    {
        if (string.IsNullOrWhiteSpace(request.IdempotencyKey) || request.IdempotencyKey.Length > 200)
        {
            throw new ArgumentException("IDEMPOTENCY_KEY_INVALID", nameof(request));
        }

        if (string.IsNullOrWhiteSpace(request.PrinterName) || request.PrinterName.Length > 256)
        {
            throw new ArgumentException("PRINTER_NAME_INVALID", nameof(request));
        }

        if (request.Copies is < 1 or > 5)
        {
            throw new ArgumentException("COPIES_OUT_OF_RANGE", nameof(request));
        }

        if (request.Payload.IsEmpty || request.Payload.Length > 16 * 1024 * 1024)
        {
            throw new ArgumentException("PAYLOAD_SIZE_INVALID", nameof(request));
        }

        if (string.IsNullOrWhiteSpace(request.RequestedBy))
        {
            throw new ArgumentException("REQUESTED_BY_REQUIRED", nameof(request));
        }
    }
}
