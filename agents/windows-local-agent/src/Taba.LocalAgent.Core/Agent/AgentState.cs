using Taba.LocalAgent.Core.Documents;
using Taba.LocalAgent.Core.Printing;

namespace Taba.LocalAgent.Core.Agent;

public enum RegistrationStatus
{
    NotRegistered,
    Active,
    Revoked,
}

public enum BackendConnectivity
{
    Unknown,
    Connected,
    Unreachable,
}

/// <summary>
/// Lo que el agente sabe de sí mismo en este momento. Lo leen /v1/health, el
/// comando «status» y el latido que llega al Panel. Sin secretos.
/// </summary>
public sealed class AgentState(TimeProvider? clock = null)
{
    private readonly TimeProvider _clock = clock ?? TimeProvider.System;
    private readonly object _gate = new();
    private RegistrationStatus _registration = RegistrationStatus.NotRegistered;
    private BackendConnectivity _backend = BackendConnectivity.Unknown;
    private DateTimeOffset? _lastContact;
    private string? _lastBackendError;
    private string? _businessName;
    private DateTimeOffset? _lastPrintedAt;

    public void SetRegistration(RegistrationStatus status, string? businessName = null)
    {
        lock (_gate)
        {
            _registration = status;
            _businessName = businessName ?? _businessName;
        }
    }

    public void BackendReached()
    {
        lock (_gate)
        {
            _backend = BackendConnectivity.Connected;
            _lastContact = _clock.GetUtcNow();
            _lastBackendError = null;
        }
    }

    public void BackendFailed(string code)
    {
        lock (_gate)
        {
            _backend = BackendConnectivity.Unreachable;
            _lastBackendError = code;
        }
    }

    public void Printed()
    {
        lock (_gate)
        {
            _lastPrintedAt = _clock.GetUtcNow();
        }
    }

    public AgentSnapshot Snapshot()
    {
        lock (_gate)
        {
            return new AgentSnapshot(_registration, _backend, _lastContact, _lastBackendError, _businessName, _lastPrintedAt);
        }
    }
}

public sealed record AgentSnapshot(
    RegistrationStatus Registration,
    BackendConnectivity Backend,
    DateTimeOffset? LastBackendContact,
    string? LastBackendError,
    string? BusinessName,
    DateTimeOffset? LastPrintedAt);

/// <summary>
/// A qué impresora va cada documento. Configurado en esta PC con «configure»;
/// se lee en cada vuelta, así un cambio de impresora no exige reiniciar.
/// </summary>
public sealed class PrintRoutes
{
    private readonly Func<IReadOnlyDictionary<DocumentType, PrinterProfile>> _source;

    public PrintRoutes(IReadOnlyDictionary<DocumentType, PrinterProfile> routes)
        : this(() => routes)
    {
    }

    public PrintRoutes(Func<IReadOnlyDictionary<DocumentType, PrinterProfile>> source)
    {
        ArgumentNullException.ThrowIfNull(source);
        _source = source;
    }

    public IReadOnlyDictionary<DocumentType, PrinterProfile> All => _source();

    public PrinterProfile? For(DocumentType type) => All.TryGetValue(type, out var profile) ? profile : null;

    public static string Role(DocumentType type) => type switch
    {
        DocumentType.KitchenTicket => "kitchen",
        DocumentType.FiscalReceipt => "fiscal",
        _ => "counter",
    };
}
