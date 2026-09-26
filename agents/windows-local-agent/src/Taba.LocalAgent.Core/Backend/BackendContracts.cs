using System.Text.Json;
using Taba.LocalAgent.Core.Documents;
using Taba.LocalAgent.Core.Security;

namespace Taba.LocalAgent.Core.Backend;

/// <summary>Cómo falló una llamada al backend. Decide si se reintenta, se abandona o se para.</summary>
public enum BackendErrorKind
{
    /// <summary>Credencial inválida o dispositivo revocado: se deja de reclamar.</summary>
    Unauthorized,

    /// <summary>Reclamo vencido o de otro agente: NO se imprime.</summary>
    Conflict,

    NotFound,
    Invalid,
    NotAllowed,

    /// <summary>Red caída, timeout o 5xx: se reintenta con espera.</summary>
    Unavailable,
}

public sealed class BackendException(BackendErrorKind kind, string code) : Exception(code)
{
    public BackendErrorKind Kind { get; } = kind;

    public string Code { get; } = code;
}

public sealed record ClaimedJob(
    Guid Id,
    DocumentType DocumentType,
    JsonElement Payload,
    int PayloadVersion,
    Guid ClaimToken,
    int Attempt,
    Guid? ReprintOf);

public sealed record ClaimResult(IReadOnlyList<ClaimedJob> Jobs, int PollSeconds);

public sealed record HeartbeatResult(int PollSeconds);

public sealed record RegistrationResult(Guid DeviceId, Guid BusinessId, string BusinessName, string DeviceName);

public enum JobTransition
{
    Printing,
    Printed,
    NotPrinted,
    Unknown,
}

public sealed record JobUpdateResult(string Status, bool IdempotentReplay);

public sealed record PrinterReport(string Name, string? Role, string Status);

public sealed record HeartbeatReport(string AgentVersion, IReadOnlyList<PrinterReport> Printers, int QueueDepth);

/// <summary>
/// El backend de La Taba visto desde el agente. Una sola puerta
/// (print-agent-gateway); el agente nunca tiene service_role ni sesión de usuario.
/// </summary>
public interface IBackendClient
{
    Task<RegistrationResult> RegisterAsync(string pairingCode, string secretHash, string deviceName, CancellationToken cancellationToken);

    Task<HeartbeatResult> HeartbeatAsync(DeviceCredential credential, HeartbeatReport report, CancellationToken cancellationToken);

    Task<ClaimResult> ClaimAsync(DeviceCredential credential, IReadOnlyCollection<DocumentType> types, int limit, CancellationToken cancellationToken);

    Task<JobUpdateResult> UpdateJobAsync(DeviceCredential credential, Guid jobId, Guid claimToken, JobTransition transition,
        string? errorCode, int? durationMs, CancellationToken cancellationToken);

    Task<Guid> RequestReprintAsync(DeviceCredential credential, Guid jobId, string reason, string? operatorLabel,
        string idempotencyKey, CancellationToken cancellationToken);

    Task RotateSecretAsync(DeviceCredential credential, string newSecretHash, CancellationToken cancellationToken);
}
