using Microsoft.Extensions.Logging;
using Taba.LocalAgent.Core.Backend;
using Taba.LocalAgent.Core.Documents;
using Taba.LocalAgent.Core.Printing;
using Taba.LocalAgent.Core.Security;

namespace Taba.LocalAgent.Core.Agent;

/// <summary>
/// El ciclo del agente contra el backend: informar lo pendiente, latir, reclamar
/// lo que las impresoras listas pueden imprimir y procesarlo. Consulta con el
/// ritmo que pide el servidor (2 s con trabajo, 10 s abierto, 60 s cerrado) y,
/// si el backend no está, espera cada vez más sin perder nada del diario.
/// </summary>
public sealed partial class BackendSyncWorker(
    ICredentialStore credentials,
    IBackendClient backend,
    PrintJobProcessor processor,
    PrintJournal journal,
    PrintRoutes routes,
    IPrinterCatalog catalog,
    AgentState state,
    ILogger<BackendSyncWorker> logger,
    TimeProvider? clock = null)
{
    public const int ClaimLimit = 3;
    private static readonly TimeSpan HeartbeatEvery = TimeSpan.FromSeconds(60);
    private static readonly TimeSpan RevokedRecheck = TimeSpan.FromMinutes(5);
    private readonly TimeProvider _clock = clock ?? TimeProvider.System;
    private DateTimeOffset _nextHeartbeat = DateTimeOffset.MinValue;
    private int _failures;
    private bool _recovered;

    /// <summary>Una vuelta del ciclo. Devuelve cuánto esperar hasta la próxima.</summary>
    public async Task<TimeSpan> RunOnceAsync(CancellationToken cancellationToken)
    {
        if (!_recovered)
        {
            foreach (var entry in journal.RecoverAfterRestart())
            {
                LogRecovered(logger, entry.JobId, entry.State.ToString(), entry.ErrorCode ?? "-");
            }

            _recovered = true;
        }

        var stored = credentials.Load();
        if (stored is null)
        {
            state.SetRegistration(RegistrationStatus.NotRegistered);
            return TimeSpan.FromSeconds(30);
        }

        try
        {
            var credential = await ResolveCredentialAsync(stored, cancellationToken).ConfigureAwait(false);
            await processor.FlushReportsAsync(credential, cancellationToken).ConfigureAwait(false);
            var poll = 10;
            var now = _clock.GetUtcNow();
            if (now >= _nextHeartbeat)
            {
                var heartbeat = await backend.HeartbeatAsync(credential, BuildReport(), cancellationToken).ConfigureAwait(false);
                poll = heartbeat.PollSeconds;
                _nextHeartbeat = now + HeartbeatEvery;
            }

            state.SetRegistration(RegistrationStatus.Active, stored.BusinessName);
            state.BackendReached();
            var types = ClaimableTypes();
            if (types.Count == 0)
            {
                _failures = 0;
                return TimeSpan.FromSeconds(Math.Max(poll, 30));
            }

            var claim = await backend.ClaimAsync(credential, types, ClaimLimit, cancellationToken).ConfigureAwait(false);
            foreach (var job in claim.Jobs)
            {
                await processor.ProcessAsync(credential, job, cancellationToken).ConfigureAwait(false);
            }

            _failures = 0;
            return TimeSpan.FromSeconds(claim.PollSeconds);
        }
        catch (BackendException error) when (error.Kind == BackendErrorKind.Unauthorized)
        {
            state.SetRegistration(RegistrationStatus.Revoked, stored.BusinessName);
            LogUnauthorized(logger, stored.Current.DeviceId);
            _nextHeartbeat = DateTimeOffset.MinValue;
            return RevokedRecheck;
        }
        catch (BackendException error)
        {
            state.BackendFailed(error.Code);
            _failures++;
            var delay = Backoff(_failures);
            LogBackendDown(logger, stored.Current.DeviceId, error.Code, (int)delay.TotalSeconds);
            return delay;
        }
    }

    /// <summary>5, 10, 20, 40, 80 y 120 s como techo: nunca se martilla un backend caído.</summary>
    public static TimeSpan Backoff(int failures) =>
        TimeSpan.FromSeconds(Math.Min(120, 5 * Math.Pow(2, Math.Clamp(failures - 1, 0, 6))));

    /// <summary>Sólo se reclama lo que alguna impresora lista puede imprimir.</summary>
    public IReadOnlyList<DocumentType> ClaimableTypes() =>
        routes.All
            .Where(route => catalog.GetState(route.Value.PrinterName) is PrinterState.Ready or PrinterState.Unknown)
            .Select(route => route.Key)
            .OrderBy(type => type)
            .ToList();

    public HeartbeatReport BuildReport() => new(
        AgentInfo.Version,
        routes.All.Select(route => new PrinterReport(route.Value.PrinterName, PrintRoutes.Role(route.Key), catalog.GetState(route.Value.PrinterName) switch
        {
            PrinterState.Ready => "READY",
            PrinterState.Offline or PrinterState.NotFound => "OFFLINE",
            PrinterState.Error or PrinterState.Paused => "ERROR",
            _ => "UNKNOWN",
        })).ToList(),
        journal.Depth());

    /// <summary>
    /// Rotación en dos fases: si hay un secreto nuevo pendiente, se prueba
    /// primero. Si el backend lo acepta queda promovido; si lo rechaza se
    /// descarta y sigue valiendo el anterior.
    /// </summary>
    private async Task<DeviceCredential> ResolveCredentialAsync(StoredCredential stored, CancellationToken cancellationToken)
    {
        if (stored.Pending is null)
        {
            return stored.Current;
        }

        try
        {
            await backend.HeartbeatAsync(stored.Pending, BuildReport(), cancellationToken).ConfigureAwait(false);
            credentials.Save(stored with { Current = stored.Pending, Pending = null });
            _nextHeartbeat = _clock.GetUtcNow() + HeartbeatEvery;
            LogRotated(logger, stored.Current.DeviceId);
            return stored.Pending;
        }
        catch (BackendException error) when (error.Kind == BackendErrorKind.Unauthorized)
        {
            credentials.Save(stored with { Pending = null });
            return stored.Current;
        }
    }

    [LoggerMessage(EventId = 200, Level = LogLevel.Warning, Message = "agent action=recovered job={JobId} state={State} error={ErrorCode}")]
    private static partial void LogRecovered(ILogger logger, Guid jobId, string state, string errorCode);

    [LoggerMessage(EventId = 201, Level = LogLevel.Error, Message = "agent action=unauthorized device={DeviceId} (revocado o credencial invalida): no se reclama nada")]
    private static partial void LogUnauthorized(ILogger logger, Guid deviceId);

    [LoggerMessage(EventId = 202, Level = LogLevel.Warning, Message = "agent action=backend_unavailable device={DeviceId} error={ErrorCode} retry_in_s={RetrySeconds}")]
    private static partial void LogBackendDown(ILogger logger, Guid deviceId, string errorCode, int retrySeconds);

    [LoggerMessage(EventId = 203, Level = LogLevel.Information, Message = "agent action=secret_rotated device={DeviceId}")]
    private static partial void LogRotated(ILogger logger, Guid deviceId);
}

/// <summary>Registro, rotación y baja local de la credencial del dispositivo.</summary>
public sealed class DeviceRegistration(IBackendClient backend, ICredentialStore credentials, TimeProvider? clock = null)
{
    private readonly TimeProvider _clock = clock ?? TimeProvider.System;

    /// <summary>Normaliza el código como la base: mayúsculas, sin guiones ni espacios, O→0, I/L→1.</summary>
    public static string NormalizeCode(string code) =>
        new string((code ?? string.Empty).ToUpperInvariant().Where(char.IsAsciiLetterOrDigit).ToArray())
            .Replace('O', '0').Replace('I', '1').Replace('L', '1');

    public async Task<StoredCredential> RegisterAsync(string pairingCode, string deviceName, CancellationToken cancellationToken)
    {
        var code = NormalizeCode(pairingCode);
        if (code.Length != 10)
        {
            throw new ArgumentException("PAIRING_CODE_INVALID", nameof(pairingCode));
        }

        var name = (deviceName ?? string.Empty).Trim();
        if (name.Length is < 1 or > 80)
        {
            throw new ArgumentException("DEVICE_NAME_INVALID", nameof(deviceName));
        }

        if (credentials.Load() is not null)
        {
            throw new InvalidOperationException("ALREADY_REGISTERED");
        }

        // El secreto nace acá y no sale: al backend va sólo su SHA-256.
        var secret = DeviceCredential.NewSecret();
        var result = await backend.RegisterAsync($"{code[..5]}-{code[5..]}", DeviceCredential.Hash(secret), name, cancellationToken).ConfigureAwait(false);
        var stored = new StoredCredential(new DeviceCredential(result.DeviceId, secret), null, result.BusinessId,
            result.BusinessName, result.DeviceName, _clock.GetUtcNow());
        credentials.Save(stored);
        return stored;
    }

    /// <summary>Rota el secreto: el nuevo queda pendiente hasta que el backend lo acepta en su primer uso.</summary>
    public async Task RotateAsync(CancellationToken cancellationToken)
    {
        var stored = credentials.Load() ?? throw new InvalidOperationException("NOT_REGISTERED");
        var next = new DeviceCredential(stored.Current.DeviceId, DeviceCredential.NewSecret());
        await backend.RotateSecretAsync(stored.Current, next.SecretHash, cancellationToken).ConfigureAwait(false);
        credentials.Save(stored with { Pending = next });
    }

    /// <summary>Borra la credencial de esta PC. La baja en el backend (revocar) se hace desde el Panel u operación.</summary>
    public void Unregister() => credentials.Delete();
}
