using System.Globalization;
using System.Net.Http.Json;
using System.Text.Json;
using System.Text.Json.Nodes;
using Taba.LocalAgent.Core;
using Taba.LocalAgent.Core.Agent;
using Taba.LocalAgent.Core.Backend;
using Taba.LocalAgent.Core.Documents;
using Taba.LocalAgent.Core.Printing;
using Taba.LocalAgent.Windows;

namespace Taba.LocalAgent.Cli;

/// <summary>
/// La línea de comandos del agente. Sin argumentos (o «service») corre el
/// servicio; el resto son tareas de instalación y diagnóstico. Nunca imprime un
/// secreto: ni el código de emparejamiento ya usado, ni la credencial, ni el token.
/// </summary>
public static class AgentCli
{
    private static readonly JsonSerializerOptions Pretty = new() { WriteIndented = true };

    public static async Task<int> RunAsync(string[] args, TextWriter? output = null, TextWriter? error = null)
    {
        ArgumentNullException.ThrowIfNull(args);
        output ??= Console.Out;
        error ??= Console.Error;
        var command = args.Length == 0 ? "service" : args[0].ToLowerInvariant();
        if (command is "service" or "run")
        {
            var app = LocalAgentHost.Build(args.Length == 0 ? args : args[1..]);
            await app.RunAsync().ConfigureAwait(false);
            return 0;
        }

        var options = Options(args);
        try
        {
            return command switch
            {
                "version" => Print(output, $"{AgentInfo.Product} {AgentInfo.Version} ({AgentInfo.InformationalVersion})"),
                "printers" => Printers(output),
                "status" => await StatusAsync(output, error, options).ConfigureAwait(false),
                "register" => await RegisterAsync(output, error, args, options).ConfigureAwait(false),
                "configure" => Configure(output, error, args, options),
                "test-print" => await TestPrintAsync(output, error, args).ConfigureAwait(false),
                "rotate" => await RotateAsync(output, error, options).ConfigureAwait(false),
                "unregister" => Unregister(output, options),
                _ => Usage(error),
            };
        }
        catch (BackendException failure)
        {
            await error.WriteLineAsync($"El backend respondió {failure.Kind}: {failure.Code}").ConfigureAwait(false);
            return 1;
        }
        catch (ArgumentException failure)
        {
            await error.WriteLineAsync($"Dato inválido: {failure.Message.Split(' ')[0]}").ConfigureAwait(false);
            return 2;
        }
        catch (InvalidOperationException failure)
        {
            await error.WriteLineAsync($"No se puede: {failure.Message}").ConfigureAwait(false);
            return 1;
        }
        catch (UnauthorizedAccessException)
        {
            await error.WriteLineAsync("Sin permisos sobre la carpeta de datos: ejecutá la consola como administrador.").ConfigureAwait(false);
            return 1;
        }
    }

    private static AgentOptions Options(string[] args)
    {
        var dataDirectory = Arg(args, "--data-dir");
        var configuration = new ConfigurationBuilder()
            .AddJsonFile(Path.Combine(AppContext.BaseDirectory, "appsettings.json"), optional: true)
            .Build();
        var options = configuration.GetSection(AgentOptions.Section).Get<AgentOptions>() ?? new AgentOptions();
        if (!string.IsNullOrWhiteSpace(dataDirectory))
        {
            options.DataDirectory = dataDirectory;
        }

        var local = Path.Combine(options.ResolveDataDirectory(), AgentConfigFile.FileName);
        if (File.Exists(local))
        {
            new ConfigurationBuilder().AddJsonFile(local, optional: true).Build().GetSection(AgentOptions.Section).Bind(options);
        }

        return options;
    }

    private static int Printers(TextWriter output)
    {
        var catalog = new WinSpoolPrinterCatalog();
        foreach (var printer in catalog.ListPrinters())
        {
            output.WriteLine($"{(printer.IsDefault ? "*" : " ")} {printer.Name}  [{printer.State}]");
        }

        return 0;
    }

    private static async Task<int> StatusAsync(TextWriter output, TextWriter error, AgentOptions options)
    {
        using var http = new HttpClient { BaseAddress = new Uri($"http://127.0.0.1:{options.Port}/"), Timeout = TimeSpan.FromSeconds(5) };
        try
        {
            var health = await http.GetFromJsonAsync<JsonElement>("v1/health").ConfigureAwait(false);
            await output.WriteLineAsync(JsonSerializer.Serialize(health, Pretty)).ConfigureAwait(false);
            return 0;
        }
        catch (HttpRequestException)
        {
            await error.WriteLineAsync($"El servicio no responde en 127.0.0.1:{options.Port}. ¿Está iniciado «{LocalAgentHost.ServiceName}»?").ConfigureAwait(false);
            return 1;
        }
    }

    private static async Task<int> RegisterAsync(TextWriter output, TextWriter error, string[] args, AgentOptions options)
    {
        var code = Arg(args, "--code") ?? throw new ArgumentException("PAIRING_CODE_REQUIRED");
        var name = Arg(args, "--name") ?? Environment.MachineName;
        var dataDirectory = options.ResolveDataDirectory();
        DataDirectory.Ensure(dataDirectory, harden: DataDirectory.IsElevated());
        using var http = new HttpClient { Timeout = TimeSpan.FromSeconds(20) };
        var backend = BackendFactory.Create(http, options.Backend);
        var registration = new DeviceRegistration(backend, new ProtectedCredentialStore(dataDirectory, new DpapiSecretProtector()));
        var stored = await registration.RegisterAsync(code, name, CancellationToken.None).ConfigureAwait(false);
        await output.WriteLineAsync($"Agente registrado: «{stored.DeviceName}» en {stored.BusinessName}.").ConfigureAwait(false);
        await output.WriteLineAsync($"Dispositivo {stored.Current.DeviceId:D}. La credencial quedó protegida con DPAPI en {dataDirectory}.").ConfigureAwait(false);
        if (!DataDirectory.IsElevated())
        {
            await error.WriteLineAsync("Aviso: la consola no es de administrador; la carpeta de datos no se cerró a otros usuarios.").ConfigureAwait(false);
        }

        return 0;
    }

    private static int Configure(TextWriter output, TextWriter error, string[] args, AgentOptions options)
    {
        var document = Arg(args, "--document") ?? throw new ArgumentException("DOCUMENT_REQUIRED");
        if (!DocumentTypes.TryParse(document, out var type))
        {
            throw new ArgumentException("DOCUMENT_UNKNOWN");
        }

        var dataDirectory = options.ResolveDataDirectory();
        DataDirectory.Ensure(dataDirectory, harden: DataDirectory.IsElevated());
        var path = Path.Combine(dataDirectory, AgentConfigFile.FileName);
        var root = File.Exists(path) ? JsonNode.Parse(File.ReadAllText(path)) as JsonObject ?? [] : [];
        var agent = root[AgentOptions.Section] as JsonObject ?? [];
        root[AgentOptions.Section] = agent;
        var routes = agent["Routes"] as JsonObject ?? [];
        agent["Routes"] = routes;
        if (args.Contains("--remove", StringComparer.OrdinalIgnoreCase))
        {
            routes.Remove(type.ToWire());
        }
        else
        {
            var printer = Arg(args, "--printer") ?? throw new ArgumentException("PRINTER_REQUIRED");
            var profile = ParseProfile(printer, args);
            profile.Validate();
            if (new WinSpoolPrinterCatalog().GetState(printer) == PrinterState.NotFound)
            {
                error.WriteLine($"Aviso: Windows no conoce la impresora «{printer}» todavía.");
            }

            routes[type.ToWire()] = new JsonObject
            {
                ["Printer"] = profile.PrinterName,
                ["Driver"] = profile.Driver.ToString(),
                ["PaperWidthMm"] = profile.PaperWidthMm,
                ["CodePage"] = profile.CodePage.ToString(),
                ["Copies"] = profile.Copies,
            };
        }

        var temporary = path + ".tmp";
        File.WriteAllText(temporary, root.ToJsonString(Pretty));
        File.Move(temporary, path, overwrite: true);
        output.WriteLine($"Listo: {type.ToWire()} → {(routes[type.ToWire()] is JsonObject r ? r["Printer"]?.GetValue<string>() : "(sin impresora)")}. El servicio lo toma sin reiniciar.");
        return 0;
    }

    private static async Task<int> TestPrintAsync(TextWriter output, TextWriter error, string[] args)
    {
        var printer = Arg(args, "--printer") ?? throw new ArgumentException("PRINTER_REQUIRED");
        var profile = ParseProfile(printer, args);
        profile.Validate();
        var toFile = Arg(args, "--to-file");
        var catalog = new WinSpoolPrinterCatalog();
        var raw = new WinSpoolRawTransport();
        IPrinter[] printers = [new EscPosPrinter(raw), new PdfPrinter(raw), new GdiTicketPrinter { OutputFile = toFile }];
        var router = new PrinterRouter(printers, catalog);
        var page = Arg(args, "--sample") switch
        {
            null => TicketComposer.TestPage(profile.PrinterName, profile.PaperWidthMm, profile.EffectiveColumns, profile.CodePage.ToString(), DateTimeOffset.Now),
            "kitchen" => new TicketComposer().KitchenTicket(PrintPayloadParser.ParseOrder(Samples.Order())),
            "order" => new TicketComposer().OrderTicket(PrintPayloadParser.ParseOrder(Samples.Order())),
            "fiscal" => TicketComposer.FiscalReceipt(PrintPayloadParser.ParseFiscal(Samples.Fiscal())),
            _ => throw new ArgumentException("SAMPLE_UNKNOWN"),
        };
        var outcome = await router.PrintAsync(new TicketContent(page), profile, "La Taba - prueba de impresion", CancellationToken.None).ConfigureAwait(false);
        var line = $"Prueba en «{printer}» ({profile.Driver}, {profile.PaperWidthMm} mm, {profile.CodePage}): {outcome.Status}{(outcome.ErrorCode is null ? string.Empty : " " + outcome.ErrorCode)}";
        if (outcome.Status == PrintOutcomeStatus.Sent)
        {
            await output.WriteLineAsync(line).ConfigureAwait(false);
            return 0;
        }

        await error.WriteLineAsync(line).ConfigureAwait(false);
        return 1;
    }

    private static async Task<int> RotateAsync(TextWriter output, TextWriter error, AgentOptions options)
    {
        var dataDirectory = options.ResolveDataDirectory();
        using var http = new HttpClient { Timeout = TimeSpan.FromSeconds(20) };
        var registration = new DeviceRegistration(BackendFactory.Create(http, options.Backend),
            new ProtectedCredentialStore(dataDirectory, new DpapiSecretProtector()));
        await registration.RotateAsync(CancellationToken.None).ConfigureAwait(false);
        await output.WriteLineAsync("Secreto nuevo registrado como pendiente: el servicio lo activa en su próximo latido.").ConfigureAwait(false);
        return 0;
    }

    private static int Unregister(TextWriter output, AgentOptions options)
    {
        var dataDirectory = options.ResolveDataDirectory();
        new ProtectedCredentialStore(dataDirectory, new DpapiSecretProtector()).Delete();
        output.WriteLine("Credencial borrada de esta PC. Para invalidarla en el backend, revocá el dispositivo desde el Panel u operación.");
        return 0;
    }

    private static PrinterProfile ParseProfile(string printer, string[] args)
    {
        var driver = (Arg(args, "--driver") ?? "escpos").ToLowerInvariant() switch
        {
            "escpos" => PrinterDriverKind.EscPos,
            "windows" => PrinterDriverKind.Windows,
            "pdf" => PrinterDriverKind.Pdf,
            _ => throw new ArgumentException("DRIVER_UNKNOWN"),
        };
        var width = int.Parse(Arg(args, "--width") ?? "80", CultureInfo.InvariantCulture);
        var codePage = (Arg(args, "--codepage") ?? "ascii").ToLowerInvariant() switch
        {
            "ascii" => EscPosCodePage.Ascii,
            "pc850" or "cp850" => EscPosCodePage.Pc850,
            "pc858" or "cp858" => EscPosCodePage.Pc858,
            "wpc1252" or "cp1252" => EscPosCodePage.Wpc1252,
            _ => throw new ArgumentException("CODEPAGE_UNKNOWN"),
        };
        var copies = int.Parse(Arg(args, "--copies") ?? "1", CultureInfo.InvariantCulture);
        return new PrinterProfile(printer, driver, width, null, codePage, copies);
    }

    private static string? Arg(string[] args, string name)
    {
        var index = Array.FindIndex(args, a => string.Equals(a, name, StringComparison.OrdinalIgnoreCase));
        return index >= 0 && index + 1 < args.Length ? args[index + 1] : null;
    }

    private static int Print(TextWriter output, string text)
    {
        output.WriteLine(text);
        return 0;
    }

    private static int Usage(TextWriter error)
    {
        error.WriteLine("""
            Uso: TabaLocalAgent [service]
                 TabaLocalAgent version | status | printers
                 TabaLocalAgent register --code XXXXX-XXXXX [--name "Mostrador"]
                 TabaLocalAgent configure --document kitchen_ticket|order_ticket|fiscal_receipt --printer "<nombre>"
                                          [--driver escpos|windows] [--width 58|80] [--codepage ascii|pc850|pc858|wpc1252] [--copies 1]
                 TabaLocalAgent configure --document <tipo> --remove
                 TabaLocalAgent test-print --printer "<nombre>" [--driver escpos|windows] [--width 58|80] [--codepage ...]
                                           [--sample kitchen|order|fiscal] [--to-file <ruta>]
                 TabaLocalAgent rotate | unregister
            Opción común: --data-dir <carpeta> (por defecto %ProgramData%\TabaLocalAgent)
            """);
        return 2;
    }
}
