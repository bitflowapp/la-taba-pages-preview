using Taba.LocalAgent.Core.Documents;
using Taba.LocalAgent.Core.Printing;
using Taba.LocalAgent.Windows;

namespace Taba.LocalAgent;

/// <summary>
/// Configuración del agente. Ningún secreto vive acá: la credencial del
/// dispositivo y el token local están protegidos aparte (DPAPI). appsettings.json
/// trae lo común; %ProgramData%\TabaLocalAgent\agent.json lo de esta PC
/// (impresoras), y se recarga sin reiniciar.
/// </summary>
public sealed class AgentOptions
{
    public const string Section = "Agent";

    /// <summary>Puerto local. Sólo se escucha en 127.0.0.1.</summary>
    public int Port { get; set; } = 17872;

    /// <summary>Orígenes exactos del Panel que pueden hablarle a la API local.</summary>
    public List<string> AllowedOrigins { get; set; } = [];

    /// <summary>Carpeta de datos. Por defecto, %ProgramData%\TabaLocalAgent.</summary>
    public string? DataDirectory { get; set; }

    public BackendOptions Backend { get; set; } = new();

    /// <summary>A qué impresora va cada documento (lo escribe «TabaLocalAgent configure»).</summary>
    public Dictionary<string, RouteOptions> Routes { get; set; } = new(StringComparer.OrdinalIgnoreCase);

    public string ResolveDataDirectory() =>
        string.IsNullOrWhiteSpace(DataDirectory) ? Windows.DataDirectory.Default : DataDirectory;

    public IReadOnlyDictionary<DocumentType, PrinterProfile> ResolveRoutes()
    {
        var routes = new Dictionary<DocumentType, PrinterProfile>();
        foreach (var (key, route) in Routes)
        {
            if (!DocumentTypes.TryParse(key, out var type) || string.IsNullOrWhiteSpace(route.Printer))
            {
                continue;
            }

            var profile = new PrinterProfile(route.Printer.Trim(), route.Driver, route.PaperWidthMm, route.Columns, route.CodePage, route.Copies);
            profile.Validate();
            routes[type] = profile;
        }

        return routes;
    }
}

public sealed class BackendOptions
{
    /// <summary>URL de la Edge Function print-agent-gateway del proyecto.</summary>
    public string GatewayUrl { get; set; } = string.Empty;

    /// <summary>Clave publicable del proyecto (es pública: la misma que usa la web).</summary>
    public string? PublishableKey { get; set; }
}

public sealed class RouteOptions
{
    public string Printer { get; set; } = string.Empty;

    public PrinterDriverKind Driver { get; set; } = PrinterDriverKind.EscPos;

    public int PaperWidthMm { get; set; } = 80;

    public int? Columns { get; set; }

    public EscPosCodePage CodePage { get; set; } = EscPosCodePage.Ascii;

    public int Copies { get; set; } = 1;
}
