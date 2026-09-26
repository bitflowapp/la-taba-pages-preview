using System.Net;
using System.Text.Json;
using System.Text.Json.Serialization;
using Microsoft.Extensions.Options;
using Taba.LocalAgent.Core;
using Taba.LocalAgent.Core.Agent;
using Taba.LocalAgent.Core.Backend;
using Taba.LocalAgent.Core.Documents;
using Taba.LocalAgent.Core.Health;
using Taba.LocalAgent.Core.Printing;
using Taba.LocalAgent.Core.Security;
using Taba.LocalAgent.Logging;
using Taba.LocalAgent.Windows;

namespace Taba.LocalAgent;

/// <summary>
/// El agente: un servicio de Windows con una API chica en 127.0.0.1 y el ciclo
/// contra el backend. No tiene lógica de pedidos, stock, precios ni usuarios:
/// imprime lo que el backend decidió y cuenta honestamente qué pasó.
/// </summary>
public static class LocalAgentHost
{
    public static WebApplication Build(string[] args, Action<WebApplicationBuilder>? configure = null)
    {
        // La configuración vive junto al ejecutable, se corra como servicio o a mano desde otra carpeta.
        var builder = WebApplication.CreateSlimBuilder(new WebApplicationOptions { Args = args, ContentRootPath = AppContext.BaseDirectory });
        builder.Host.UseWindowsService(options => options.ServiceName = ServiceName);
        var initial = builder.Configuration.GetSection(AgentOptions.Section).Get<AgentOptions>() ?? new AgentOptions();
        var dataDirectory = initial.ResolveDataDirectory();
        // Configuración de esta PC (impresoras). Opcional; se recarga sola.
        builder.Configuration.AddJsonFile(Path.Combine(dataDirectory, AgentConfigFile.FileName), optional: true, reloadOnChange: true);
        builder.Services.Configure<AgentOptions>(builder.Configuration.GetSection(AgentOptions.Section));
        builder.WebHost.ConfigureKestrel(kestrel => kestrel.Listen(IPAddress.Loopback, initial.Port));
        builder.Services.ConfigureHttpJsonOptions(json =>
        {
            json.SerializerOptions.Converters.Add(new JsonStringEnumConverter());
            json.SerializerOptions.PropertyNamingPolicy = JsonNamingPolicy.SnakeCaseLower;
        });
        builder.Logging.AddProvider(new JsonFileLoggerProvider(Path.Combine(dataDirectory, "logs")));

        builder.Services.AddSingleton(TimeProvider.System);
        builder.Services.AddSingleton<ISecretProtector>(new DpapiSecretProtector());
        builder.Services.AddSingleton<ICredentialStore>(sp => new ProtectedCredentialStore(dataDirectory, sp.GetRequiredService<ISecretProtector>()));
        builder.Services.AddSingleton<IJournalStore>(_ => new JsonFileJournalStore(Path.Combine(dataDirectory, "journal.json")));
        builder.Services.AddSingleton(sp => new PrintJournal(sp.GetRequiredService<IJournalStore>(), sp.GetRequiredService<TimeProvider>()));
        builder.Services.AddSingleton(sp => new AgentState(sp.GetRequiredService<TimeProvider>()));
        builder.Services.AddSingleton<IPrinterCatalog, WinSpoolPrinterCatalog>();
        builder.Services.AddSingleton<IRawPrinterTransport>(_ => new WinSpoolRawTransport());
        builder.Services.AddSingleton<IPrinter>(sp => new EscPosPrinter(sp.GetRequiredService<IRawPrinterTransport>()));
        builder.Services.AddSingleton<IPrinter>(sp => new PdfPrinter(sp.GetRequiredService<IRawPrinterTransport>()));
        builder.Services.AddSingleton<IPrinter>(_ => new GdiTicketPrinter());
        builder.Services.AddSingleton(sp => new PrinterRouter(sp.GetServices<IPrinter>(), sp.GetRequiredService<IPrinterCatalog>()));
        builder.Services.AddSingleton(sp =>
        {
            var monitor = sp.GetRequiredService<IOptionsMonitor<AgentOptions>>();
            return new PrintRoutes(() => monitor.CurrentValue.ResolveRoutes());
        });
        builder.Services.AddSingleton(_ => new TicketComposer());
        builder.Services.AddSingleton(_ => new HttpClient { Timeout = TimeSpan.FromSeconds(20) });
        builder.Services.AddSingleton<IBackendClient>(sp =>
            BackendFactory.Create(sp.GetRequiredService<HttpClient>(), sp.GetRequiredService<IOptionsMonitor<AgentOptions>>().CurrentValue.Backend));
        builder.Services.AddSingleton<PrintJobProcessor>();
        builder.Services.AddSingleton(sp => new BackendSyncWorker(
            sp.GetRequiredService<ICredentialStore>(), sp.GetRequiredService<IBackendClient>(), sp.GetRequiredService<PrintJobProcessor>(),
            sp.GetRequiredService<PrintJournal>(), sp.GetRequiredService<PrintRoutes>(), sp.GetRequiredService<IPrinterCatalog>(),
            sp.GetRequiredService<AgentState>(), sp.GetRequiredService<ILogger<BackendSyncWorker>>(), sp.GetRequiredService<TimeProvider>()));
        builder.Services.AddSingleton(sp => new LocalApiGate(
            new OriginPolicy(initial.AllowedOrigins),
            InstallationToken.LoadOrCreate(dataDirectory, sp.GetRequiredService<ISecretProtector>()),
            initial.Port));
        builder.Services.AddHostedService<SyncHostedService>();
        configure?.Invoke(builder);

        var app = builder.Build();
        app.Use(GateMiddleware);
        MapEndpoints(app);
        return app;
    }

    public const string ServiceName = "TabaLocalAgent";

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

        context.Response.Headers.CacheControl = "no-store";
        await next().ConfigureAwait(false);
    }

    private static void MapEndpoints(WebApplication app)
    {
        app.MapGet("/v1/health", (AgentState state, PrintRoutes routes, IPrinterCatalog printers, PrintJournal journal, TimeProvider clock) =>
            Results.Ok(AgentHealth.Build(state.Snapshot(), routes, printers, journal, clock.GetUtcNow())));

        app.MapGet("/v1/printers", (IPrinterCatalog printers) =>
        {
            try
            {
                return Results.Ok(printers.ListPrinters());
            }
            catch (System.ComponentModel.Win32Exception)
            {
                return Results.Ok(Array.Empty<PrinterDescriptor>());
            }
        });

        // Hoja de prueba local: no crea un trabajo en el backend ni imprime datos del negocio.
        app.MapPost("/v1/print-test", async (PrintTestRequest body, PrinterRouter router, TimeProvider clock, CancellationToken cancellationToken) =>
        {
            PrinterProfile profile;
            try
            {
                profile = new PrinterProfile(body.Printer ?? string.Empty, body.Driver ?? PrinterDriverKind.EscPos, body.PaperWidthMm ?? 80, null,
                    body.CodePage ?? EscPosCodePage.Ascii);
                profile.Validate();
            }
            catch (ArgumentException error)
            {
                return Results.BadRequest(new { error = error.Message.Split(' ')[0] });
            }

            var page = TicketComposer.TestPage(profile.PrinterName, profile.PaperWidthMm, profile.EffectiveColumns, profile.CodePage.ToString(), clock.GetLocalNow());
            var outcome = await router.PrintAsync(new TicketContent(page), profile, "La Taba - prueba de impresion", cancellationToken).ConfigureAwait(false);
            return Results.Ok(new { status = outcome.Status.ToString().ToUpperInvariant(), error = outcome.ErrorCode });
        });

        // Reimpresión explícita desde el mostrador: el backend crea OTRO trabajo y audita quién y por qué.
        app.MapPost("/v1/reprint", async (ReprintRequest body, ICredentialStore credentials, IBackendClient backend, CancellationToken cancellationToken) =>
        {
            var stored = credentials.Load();
            if (stored is null)
            {
                return Results.Conflict(new { error = "NOT_REGISTERED" });
            }

            if (body.JobId is not { } jobId || string.IsNullOrWhiteSpace(body.Reason) || body.Reason.Trim().Length is < 3 or > 300
                || string.IsNullOrWhiteSpace(body.IdempotencyKey))
            {
                return Results.BadRequest(new { error = "REPRINT_REQUEST_INVALID" });
            }

            try
            {
                var created = await backend.RequestReprintAsync(stored.Current, jobId, body.Reason.Trim(), body.OperatorLabel?.Trim(),
                    body.IdempotencyKey.Trim(), cancellationToken).ConfigureAwait(false);
                return Results.Accepted(value: new { print_job_id = created });
            }
            catch (BackendException error)
            {
                return Results.Json(new { error = error.Code }, statusCode: error.Kind switch
                {
                    BackendErrorKind.Unauthorized => StatusCodes.Status401Unauthorized,
                    BackendErrorKind.NotFound => StatusCodes.Status404NotFound,
                    BackendErrorKind.Invalid => StatusCodes.Status400BadRequest,
                    BackendErrorKind.NotAllowed or BackendErrorKind.Conflict => StatusCodes.Status409Conflict,
                    _ => StatusCodes.Status503ServiceUnavailable,
                });
            }
        });
    }
}

public sealed record PrintTestRequest(string? Printer, PrinterDriverKind? Driver, int? PaperWidthMm, EscPosCodePage? CodePage);

public sealed record ReprintRequest(Guid? JobId, string? Reason, string? OperatorLabel, string? IdempotencyKey);

/// <summary>El ciclo del agente como servicio de fondo: una vuelta, la espera que pide el servidor, y otra.</summary>
public sealed partial class SyncHostedService(BackendSyncWorker worker, ILogger<SyncHostedService> logger) : BackgroundService
{
    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        LogStarted(logger, AgentInfo.InformationalVersion);
        while (!stoppingToken.IsCancellationRequested)
        {
            TimeSpan delay;
            try
            {
                delay = await worker.RunOnceAsync(stoppingToken).ConfigureAwait(false);
            }
            catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested)
            {
                break;
            }
#pragma warning disable CA1031 // El ciclo no puede morir por un error inesperado: se registra y se reintenta.
            catch (Exception error)
#pragma warning restore CA1031
            {
                LogCycleFailed(logger, error.GetType().Name);
                delay = TimeSpan.FromSeconds(30);
            }

            try
            {
                await Task.Delay(delay, stoppingToken).ConfigureAwait(false);
            }
            catch (OperationCanceledException)
            {
                break;
            }
        }

        LogStopped(logger);
    }

    [LoggerMessage(EventId = 1, Level = LogLevel.Information, Message = "agent action=started version={Version}")]
    private static partial void LogStarted(ILogger logger, string version);

    [LoggerMessage(EventId = 2, Level = LogLevel.Error, Message = "agent action=cycle_failed error_type={ErrorType}")]
    private static partial void LogCycleFailed(ILogger logger, string errorType);

    [LoggerMessage(EventId = 3, Level = LogLevel.Information, Message = "agent action=stopped")]
    private static partial void LogStopped(ILogger logger);
}

/// <summary>El backend configurado, o uno deshabilitado si falta la URL (el agente no reclama nada).</summary>
public static class BackendFactory
{
    public static IBackendClient Create(HttpClient http, BackendOptions options)
    {
        ArgumentNullException.ThrowIfNull(options);
        return Uri.TryCreate(options.GatewayUrl, UriKind.Absolute, out var gateway)
            ? new GatewayBackendClient(http, gateway, options.PublishableKey)
            : new DisabledBackendClient();
    }
}

/// <summary>agent.json de esta PC: sólo impresoras. Lo escribe la CLI.</summary>
public static class AgentConfigFile
{
    public const string FileName = "agent.json";
}
