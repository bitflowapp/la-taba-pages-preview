using Taba.LocalAgent.Core.Agent;
using Taba.LocalAgent.Core.Printing;

namespace Taba.LocalAgent.Core.Health;

public sealed record PrinterHealth(string Name, string Role, string Status);

/// <summary>
/// Lo que se puede mostrar del agente: versión, registro, backend, impresoras y
/// cola. No lleva secretos, rutas de archivos, ids de dispositivo ni contenido
/// de trabajos: es seguro exponerlo en /v1/health sin token.
/// </summary>
public sealed record AgentHealthReport(
    string Agent,
    string Version,
    string Registration,
    string? Business,
    string Backend,
    DateTimeOffset? LastBackendContact,
    IReadOnlyList<PrinterHealth> Printers,
    int QueueDepth,
    int NeedsAttention,
    DateTimeOffset? LastPrintedAt,
    DateTimeOffset GeneratedAt);

public static class AgentHealth
{
    public static AgentHealthReport Build(AgentSnapshot snapshot, PrintRoutes routes, IPrinterCatalog catalog, PrintJournal journal, DateTimeOffset now)
    {
        ArgumentNullException.ThrowIfNull(snapshot);
        ArgumentNullException.ThrowIfNull(routes);
        ArgumentNullException.ThrowIfNull(catalog);
        ArgumentNullException.ThrowIfNull(journal);
        var printers = routes.All
            .OrderBy(route => route.Key)
            .Select(route => new PrinterHealth(route.Value.PrinterName, PrintRoutes.Role(route.Key), SafeState(catalog, route.Value.PrinterName)))
            .ToList();
        return new AgentHealthReport(
            "ONLINE",
            AgentInfo.Version,
            snapshot.Registration switch
            {
                RegistrationStatus.Active => "ACTIVE",
                RegistrationStatus.Revoked => "REVOKED",
                _ => "NOT_REGISTERED",
            },
            snapshot.BusinessName,
            snapshot.Backend switch
            {
                BackendConnectivity.Connected => "CONNECTED",
                BackendConnectivity.Unreachable => "UNREACHABLE",
                _ => "UNKNOWN",
            },
            snapshot.LastBackendContact,
            printers,
            journal.Depth(),
            journal.NeedsAttention(),
            snapshot.LastPrintedAt,
            now);
    }

    private static string SafeState(IPrinterCatalog catalog, string printer)
    {
        try
        {
            return catalog.GetState(printer) switch
            {
                PrinterState.Ready => "READY",
                PrinterState.Offline or PrinterState.NotFound => "OFFLINE",
                PrinterState.Error or PrinterState.Paused => "ERROR",
                _ => "UNKNOWN",
            };
        }
        catch (System.ComponentModel.Win32Exception)
        {
            return "UNKNOWN";
        }
    }

}
