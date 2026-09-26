using System.Net;
using System.Reflection;
using System.Runtime.Versioning;
using System.Text.Json.Serialization;
using System.Threading.Channels;
using Taba.LocalAgent.Core.Health;
using Taba.LocalAgent.Core.Printing;
using Taba.LocalAgent.Core.Printing.EscPos;
using Taba.LocalAgent.Core.Security;
using Taba.LocalAgent.Windows;

namespace Taba.LocalAgent;

/// <summary>
/// El agente local: una API chica en 127.0.0.1 y un despachador de la cola.
/// No tiene lógica de pedidos, stock ni usuarios: recibe documentos ya
/// decididos por el backend y los imprime.
/// </summary>
public static class LocalAgentHost
{
    public static WebApplication Build(string[] args, Action<WebApplicationBuilder>? configure = null)
    {
        var builder = WebApplication.CreateSlimBuilder(args);
        builder.Host.UseWindowsService(options => options.ServiceName = "TabaLocalAgent");
        var agent = builder.Configuration.GetSection(AgentOptions.Section).Get<AgentOptions>() ?? new AgentOptions();
        builder.WebHost.ConfigureKestrel(kestrel => kestrel.Listen(IPAddress.Loopback, agent.Port));
        builder.Services.ConfigureHttpJsonOptions(json => json.SerializerOptions.Converters.Add(new JsonStringEnumConverter()));

        var dataDirectory = agent.ResolveDataDirectory();
        builder.Services.AddSingleton(agent);
        builder.Services.AddSingleton(TimeProvider.System);
        builder.Services.AddSingleton(Channel.CreateBounded<string>(new BoundedChannelOptions(256) { FullMode = BoundedChannelFullMode.DropOldest }));
        builder.Services.AddSingleton<IPrintJobStore>(_ => new JsonFilePrintJobStore(Path.Combine(dataDirectory, "print-jobs.json")));
        builder.Services.AddSingleton<IPrinterResolver, FormatPrinterResolver>();
        builder.Services.AddSingleton(sp => new PrintSpool(
            sp.GetRequiredService<IPrintJobStore>(),
            sp.GetRequiredService<IPrinterResolver>(),
            sp.GetRequiredService<TimeProvider>()));
        if (OperatingSystem.IsWindows())
        {
            AddWindowsDevices(builder.Services, agent, dataDirectory);
        }

        builder.Services.AddHostedService<PrintDispatcher>();
        configure?.Invoke(builder);

        var app = builder.Build();
        app.Use(GateMiddleware);
        MapEndpoints(app);
        return app;
    }

    [SupportedOSPlatform("windows")]
    private static void AddWindowsDevices(IServiceCollection services, AgentOptions agent, string dataDirectory)
    {
        services.AddSingleton<IPrinterCatalog, WinSpoolPrinterCatalog>();
        services.AddSingleton<IRawPrinterTransport, WinSpoolRawTransport>();
        // El token se crea (o se lee, protegido con DPAPI) recién cuando se usa la API.
        services.AddSingleton(_ => new LocalApiGate(
            new OriginPolicy(agent.AllowedOrigins),
            InstallationToken.LoadOrCreate(dataDirectory, new DpapiSecretProtector()),
            agent.Port));
    }

    private static async Task GateMiddleware(HttpContext context, Func<Task> next)
    {
        var gate = context.RequestServices.GetRequiredService<LocalApiGate>();
        var origin = context.Request.Headers.Origin.FirstOrDefault();
        var isPreflight = HttpMethods.IsOptions(context.Request.Method)
            && context.Request.Headers.ContainsKey("Access-Control-Request-Method");
        var decision = gate.Evaluate(new LocalApiRequest(
            context.Request.Host.Value ?? string.Empty,
            origin,
            context.Request.Headers[LocalApiToken.HeaderName].FirstOrDefault(),
            IsHealthProbe: isPreflight || context.Request.Path.Equals("/v1/health", StringComparison.Ordinal)));
        if (decision != GateDecision.Allowed)
        {
            // Sin detalle: a quien no está autorizado no se le explica por qué.
            context.Response.StatusCode = StatusCodes.Status403Forbidden;
            return;
        }

        if (origin is not null)
        {
            context.Response.Headers.AccessControlAllowOrigin = OriginPolicy.Normalize(origin);
            context.Response.Headers.Vary = "Origin";
        }

        if (isPreflight)
        {
            context.Response.Headers.AccessControlAllowMethods = "GET, POST";
            context.Response.Headers.AccessControlAllowHeaders = $"Content-Type, {LocalApiToken.HeaderName}";
            context.Response.Headers.AccessControlMaxAge = "600";
            // Chrome (Private/Local Network Access) pregunta por esto antes de
            // dejar que una web pública hable con 127.0.0.1.
            if (string.Equals(context.Request.Headers["Access-Control-Request-Private-Network"], "true", StringComparison.OrdinalIgnoreCase))
            {
                context.Response.Headers["Access-Control-Allow-Private-Network"] = "true";
            }

            context.Response.StatusCode = StatusCodes.Status204NoContent;
            return;
        }

        await next().ConfigureAwait(false);
    }

    private static void MapEndpoints(WebApplication app)
    {
        var version = typeof(LocalAgentHost).Assembly.GetCustomAttribute<AssemblyInformationalVersionAttribute>()?.InformationalVersion ?? "0.0.0";

        app.MapGet("/v1/health", (IPrinterCatalog printers, PrintSpool queue, TimeProvider clock) =>
            Results.Ok(AgentHealth.Build(version, SafeList(printers), queue.List(), ComponentStatus.Disabled, clock.GetUtcNow())));

        app.MapGet("/v1/printers", (IPrinterCatalog printers) => Results.Ok(SafeList(printers)));

        app.MapPost("/v1/print-jobs", (PrintJobRequest body, PrintSpool queue, Channel<string> wake, TimeProvider clock) =>
        {
            byte[] payload;
            try
            {
                payload = Render(body, clock.GetUtcNow());
            }
            catch (ArgumentException error)
            {
                return Results.BadRequest(new { error = error.Message.Split(' ')[0] });
            }

            PrintJob job;
            try
            {
                job = queue.Enqueue(new PrintRequest(body.IdempotencyKey, body.Kind, body.Format, body.PrinterName, payload, body.Copies, body.RequestedBy));
            }
            catch (ArgumentException error)
            {
                return Results.BadRequest(new { error = error.Message.Split(' ')[0] });
            }

            wake.Writer.TryWrite(job.JobId);
            return Results.Accepted($"/v1/print-jobs/{job.JobId}", PrintJobView.From(job));
        });

        app.MapGet("/v1/print-jobs/{jobId}", (string jobId, PrintSpool queue) =>
            queue.Find(jobId) is { } job ? Results.Ok(PrintJobView.From(job)) : Results.NotFound());

        app.MapPost("/v1/print-jobs/{jobId}/reprint", (string jobId, ReprintRequest body, PrintSpool queue, Channel<string> wake) =>
        {
            if (string.IsNullOrWhiteSpace(body.RequestedBy))
            {
                return Results.BadRequest(new { error = "REQUESTED_BY_REQUIRED" });
            }

            try
            {
                var job = queue.Reprint(jobId, body.RequestedBy);
                wake.Writer.TryWrite(job.JobId);
                return Results.Accepted($"/v1/print-jobs/{job.JobId}", PrintJobView.From(job));
            }
            catch (KeyNotFoundException)
            {
                return Results.NotFound();
            }
        });
    }

    /// <summary>
    /// El agente renderiza a partir de datos estructurados: la web nunca manda
    /// bytes crudos a la impresora. Un comprobante fiscal sin CAE no se puede
    /// construir (lo impide <see cref="AuthorizedFiscalReceipt"/>).
    /// </summary>
    internal static byte[] Render(PrintJobRequest body, DateTimeOffset now)
    {
        ArgumentNullException.ThrowIfNull(body);
        if (body.Format == PrintFormat.PdfA4)
        {
            if (body.Kind != PrintDocumentKind.FiscalReceipt || string.IsNullOrWhiteSpace(body.PdfBase64))
            {
                throw new ArgumentException("PDF_ONLY_FOR_AUTHORIZED_FISCAL_DOCUMENTS");
            }

            var pdf = Convert.FromBase64String(body.PdfBase64);
            return pdf.AsSpan().StartsWith("%PDF-"u8) ? pdf : throw new ArgumentException("PDF_INVALID");
        }

        return body.Kind switch
        {
            PrintDocumentKind.KitchenTicket => TicketRenderer.KitchenTicket(body.Order ?? throw new ArgumentException("ORDER_REQUIRED"), body.Format),
            PrintDocumentKind.OrderTicket => TicketRenderer.OrderTicket(body.Order ?? throw new ArgumentException("ORDER_REQUIRED"), body.Format),
            PrintDocumentKind.FiscalReceipt => TicketRenderer.FiscalReceipt(
                body.Fiscal?.ToAuthorized() ?? throw new ArgumentException("FISCAL_RECEIPT_REQUIRED"), body.Format),
            _ => TicketRenderer.TestPage(body.PrinterName, body.Format, now),
        };
    }

    private static IReadOnlyList<PrinterDescriptor> SafeList(IPrinterCatalog printers)
    {
        try
        {
            return printers.ListPrinters();
        }
        catch (System.ComponentModel.Win32Exception)
        {
            return [];
        }
    }
}

public sealed record PrintJobRequest(
    string IdempotencyKey,
    PrintDocumentKind Kind,
    PrintFormat Format,
    string PrinterName,
    int Copies,
    string RequestedBy,
    OrderTicketData? Order = null,
    FiscalReceiptRequest? Fiscal = null,
    string? PdfBase64 = null);

public sealed record FiscalReceiptRequest(
    string IssuerName,
    string IssuerCuit,
    string VoucherLabel,
    int PointOfSale,
    long VoucherNumber,
    DateOnly IssueDate,
    decimal Total,
    string Cae,
    DateOnly CaeExpiration,
    string QrUrl)
{
    public AuthorizedFiscalReceipt ToAuthorized() =>
        new(IssuerName, IssuerCuit, VoucherLabel, PointOfSale, VoucherNumber, IssueDate, Total, Cae, CaeExpiration, QrUrl);
}

public sealed record ReprintRequest(string RequestedBy);

/// <summary>Lo que se devuelve de un trabajo: sin la carga, que puede tener datos del cliente.</summary>
public sealed record PrintJobView(string JobId, string IdempotencyKey, PrintDocumentKind Kind, string PrinterName, PrintJobState State, int Attempts, string? LastErrorCode, string? ReprintOf, string RequestedBy)
{
    public static PrintJobView From(PrintJob job) =>
        new(job.JobId, job.IdempotencyKey, job.Kind, job.PrinterName, job.State, job.Attempts, job.LastErrorCode, job.ReprintOf, job.RequestedBy);
}

/// <summary>
/// Despacha la cola: al arrancar marca como «desconocido» lo que quedó a mitad,
/// y después imprime lo pendiente en orden, cuando llega un trabajo o cada pocos segundos.
/// </summary>
public sealed class PrintDispatcher(PrintSpool queue, Channel<string> wake, ILogger<PrintDispatcher> logger) : BackgroundService
{
    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        foreach (var job in queue.RecoverAfterRestart())
        {
            LogRecovered(logger, job.JobId);
        }

        while (!stoppingToken.IsCancellationRequested)
        {
            try
            {
                await queue.DispatchPendingAsync(stoppingToken).ConfigureAwait(false);
            }
            catch (IOException error)
            {
                LogDispatchError(logger, error.GetType().Name);
            }

            using var timeout = CancellationTokenSource.CreateLinkedTokenSource(stoppingToken);
            timeout.CancelAfter(TimeSpan.FromSeconds(3));
            try
            {
                await wake.Reader.ReadAsync(timeout.Token).ConfigureAwait(false);
            }
            catch (OperationCanceledException) when (!stoppingToken.IsCancellationRequested)
            {
                // Ningún trabajo nuevo: se vuelve a mirar la cola igual.
            }
        }
    }

    private static readonly Action<ILogger, string, Exception?> LogRecoveredMessage =
        LoggerMessage.Define<string>(LogLevel.Warning, new EventId(1, "RecoveredUnknown"), "Trabajo {JobId} quedó a mitad al reiniciar: queda como desconocido y no se reimprime solo.");

    private static readonly Action<ILogger, string, Exception?> LogDispatchErrorMessage =
        LoggerMessage.Define<string>(LogLevel.Error, new EventId(2, "DispatchError"), "No se pudo despachar la cola ({ErrorType}).");

    private static void LogRecovered(ILogger logger, string jobId) => LogRecoveredMessage(logger, jobId, null);

    private static void LogDispatchError(ILogger logger, string errorType) => LogDispatchErrorMessage(logger, errorType, null);
}
