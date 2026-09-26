using Taba.LocalAgent.Core.Documents;
using Taba.LocalAgent.Core.Security;

namespace Taba.LocalAgent.Core.Backend;

/// <summary>Sin URL de backend configurada: el agente arranca, informa su salud y no reclama nada.</summary>
public sealed class DisabledBackendClient : IBackendClient
{
    private static BackendException Disabled() => new(BackendErrorKind.Unavailable, "BACKEND_NOT_CONFIGURED");

    public Task<RegistrationResult> RegisterAsync(string pairingCode, string secretHash, string deviceName, CancellationToken cancellationToken) =>
        Task.FromException<RegistrationResult>(Disabled());

    public Task<HeartbeatResult> HeartbeatAsync(DeviceCredential credential, HeartbeatReport report, CancellationToken cancellationToken) =>
        Task.FromException<HeartbeatResult>(Disabled());

    public Task<ClaimResult> ClaimAsync(DeviceCredential credential, IReadOnlyCollection<DocumentType> types, int limit, CancellationToken cancellationToken) =>
        Task.FromException<ClaimResult>(Disabled());

    public Task<JobUpdateResult> UpdateJobAsync(DeviceCredential credential, Guid jobId, Guid claimToken, JobTransition transition,
        string? errorCode, int? durationMs, CancellationToken cancellationToken) => Task.FromException<JobUpdateResult>(Disabled());

    public Task<Guid> RequestReprintAsync(DeviceCredential credential, Guid jobId, string reason, string? operatorLabel,
        string idempotencyKey, CancellationToken cancellationToken) => Task.FromException<Guid>(Disabled());

    public Task RotateSecretAsync(DeviceCredential credential, string newSecretHash, CancellationToken cancellationToken) =>
        Task.FromException(Disabled());
}
