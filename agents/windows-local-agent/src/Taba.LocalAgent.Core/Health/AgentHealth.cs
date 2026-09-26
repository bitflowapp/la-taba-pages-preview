using Taba.LocalAgent.Core.Printing;

namespace Taba.LocalAgent.Core.Health;

public enum ComponentStatus
{
    Ready,
    Degraded,
    Error,
    Disabled,
}

public sealed record PrinterHealth(string Name, ComponentStatus Status);

/// <summary>
/// Lo que el Panel puede mostrar del agente: agente, impresoras, cola y ARCA.
/// No lleva secretos, rutas ni contenido de trabajos: es seguro exponerlo en
/// /v1/health aun sin token.
/// </summary>
public sealed record AgentHealthReport(
    string Agent,
    string Version,
    IReadOnlyList<PrinterHealth> Printers,
    int QueuedJobs,
    int JobsNeedingAttention,
    ComponentStatus Fiscal,
    DateTimeOffset GeneratedAt);

public static class AgentHealth
{
    public static AgentHealthReport Build(
        string version,
        IReadOnlyList<PrinterDescriptor> printers,
        IReadOnlyList<PrintJob> jobs,
        ComponentStatus fiscal,
        DateTimeOffset now)
    {
        ArgumentNullException.ThrowIfNull(printers);
        ArgumentNullException.ThrowIfNull(jobs);
        var failingPrinters = jobs
            .Where(j => j.State is PrintJobState.Failed && j.Attempts >= PrintSpool.MaxAutomaticAttempts)
            .Select(j => j.PrinterName)
            .ToHashSet(StringComparer.Ordinal);
        return new AgentHealthReport(
            "ONLINE",
            version,
            printers.Select(p => new PrinterHealth(p.Name, failingPrinters.Contains(p.Name) ? ComponentStatus.Error : ComponentStatus.Ready)).ToList(),
            jobs.Count(j => j.State == PrintJobState.Queued),
            jobs.Count(j => j.State is PrintJobState.Unknown || (j.State == PrintJobState.Failed && j.Attempts >= PrintSpool.MaxAutomaticAttempts)),
            fiscal,
            now);
    }
}
