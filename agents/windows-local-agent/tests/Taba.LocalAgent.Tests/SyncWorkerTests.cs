using Microsoft.Extensions.Logging.Abstractions;
using Taba.LocalAgent.Core.Agent;
using Taba.LocalAgent.Core.Backend;
using Taba.LocalAgent.Core.Documents;
using Taba.LocalAgent.Core.Printing;
using Taba.LocalAgent.Core.Security;

namespace Taba.LocalAgent.Tests;

/// <summary>El ciclo contra el backend: registro, reclamo según impresoras, espera ante caídas, revocación y rotación.</summary>
public sealed class SyncWorkerTests
{
    private sealed class Rig
    {
        public Rig(bool registered = true)
        {
            Queue = new PrintQueueTests.Rig();
            if (registered)
            {
                Credentials.Save(new StoredCredential(Queue.Credential, null, Guid.NewGuid(), "TABA IMPRIME A", "Mostrador", DateTimeOffset.UtcNow));
            }

            Worker = new BackendSyncWorker(Credentials, Queue.Backend, Queue.Processor, Queue.Journal, Queue.Routes, Queue.Catalog,
                Queue.State, NullLogger<BackendSyncWorker>.Instance, Queue.Clock);
        }

        public PrintQueueTests.Rig Queue { get; }

        public InMemoryCredentialStore Credentials { get; } = new();

        public BackendSyncWorker Worker { get; }

        public Task<TimeSpan> Run() => Worker.RunOnceAsync(CancellationToken.None);
    }

    [Fact]
    public async Task Sin_registro_no_se_llama_al_backend()
    {
        var rig = new Rig(registered: false);
        Assert.Equal(TimeSpan.FromSeconds(30), await rig.Run());
        Assert.Empty(rig.Queue.Backend.Calls);
        Assert.Equal(RegistrationStatus.NotRegistered, rig.Queue.State.Snapshot().Registration);
    }

    [Fact]
    public async Task Late_reclama_e_imprime_con_el_ritmo_que_pide_el_servidor()
    {
        var rig = new Rig();
        var job = PrintQueueTests.Rig.Job();
        rig.Queue.Backend.Claims.Enqueue(new ClaimResult([job], 2));
        Assert.Equal(TimeSpan.FromSeconds(2), await rig.Run());
        Assert.Equal(["heartbeat", "claim", "update:Printing", "update:Printed"], rig.Queue.Backend.Calls);
        Assert.Single(rig.Queue.Transport.Sent);
        Assert.Equal(RegistrationStatus.Active, rig.Queue.State.Snapshot().Registration);
        Assert.Equal(BackendConnectivity.Connected, rig.Queue.State.Snapshot().Backend);
    }

    [Fact]
    public async Task Solo_se_reclaman_los_documentos_con_impresora_lista()
    {
        var rig = new Rig();
        rig.Queue.Catalog.States["Mostrador"] = PrinterState.Offline;
        await rig.Run();
        Assert.Equal([DocumentType.KitchenTicket], rig.Queue.Backend.ClaimedTypes.Single());
    }

    [Fact]
    public async Task Con_todas_las_impresoras_apagadas_no_se_reclama_nada_pero_se_informa()
    {
        var rig = new Rig();
        rig.Queue.Catalog.States["Mostrador"] = PrinterState.Offline;
        rig.Queue.Catalog.States["Cocina"] = PrinterState.Error;
        await rig.Run();
        Assert.DoesNotContain("claim", rig.Queue.Backend.Calls);
        Assert.Contains("heartbeat", rig.Queue.Backend.Calls);
        var report = rig.Worker.BuildReport();
        Assert.Contains(report.Printers, p => p.Name == "Cocina" && p.Status == "ERROR" && p.Role == "kitchen");
        Assert.Contains(report.Printers, p => p.Name == "Mostrador" && p.Status == "OFFLINE");
    }

    [Fact]
    public async Task Con_el_backend_caido_se_espera_cada_vez_mas_sin_martillar()
    {
        var rig = new Rig();
        rig.Queue.Backend.HeartbeatFailure = new BackendException(BackendErrorKind.Unavailable, "BACKEND_UNREACHABLE");
        var delays = new List<double>();
        for (var i = 0; i < 7; i++)
        {
            delays.Add((await rig.Run()).TotalSeconds);
        }

        Assert.Equal([5, 10, 20, 40, 80, 120, 120], delays);
        Assert.Equal(BackendConnectivity.Unreachable, rig.Queue.State.Snapshot().Backend);
        Assert.Empty(rig.Queue.Transport.Sent);
    }

    [Fact]
    public async Task Un_dispositivo_revocado_deja_de_reclamar_y_lo_dice_en_la_salud()
    {
        var rig = new Rig();
        rig.Queue.Backend.Accepts = _ => false;
        Assert.Equal(TimeSpan.FromMinutes(5), await rig.Run());
        Assert.DoesNotContain("claim", rig.Queue.Backend.Calls);
        Assert.Equal(RegistrationStatus.Revoked, rig.Queue.State.Snapshot().Registration);
    }

    [Fact]
    public async Task Al_arrancar_se_informa_lo_que_quedo_a_medias_y_no_se_reimprime()
    {
        var rig = new Rig();
        var entry = rig.Queue.Journal.Begin(Guid.NewGuid(), Guid.NewGuid(), DocumentType.KitchenTicket, 1, false);
        rig.Queue.Journal.Update(entry, JournalState.Sending, printerName: "Cocina");
        await rig.Run();
        Assert.Contains(rig.Queue.Backend.Updates, u => u.Job == entry.JobId && u.Transition == JobTransition.Unknown && u.Error == "AGENT_RESTARTED_DURING_PRINT");
        Assert.Empty(rig.Queue.Transport.Sent);
    }

    [Fact]
    public async Task La_rotacion_pendiente_se_promueve_en_el_primer_latido()
    {
        var rig = new Rig();
        var stored = rig.Credentials.Load()!;
        var next = new DeviceCredential(stored.Current.DeviceId, DeviceCredential.NewSecret());
        rig.Credentials.Save(stored with { Pending = next });
        await rig.Run();
        Assert.Equal(next.Secret, rig.Credentials.Load()!.Current.Secret);
        Assert.Null(rig.Credentials.Load()!.Pending);
    }

    [Fact]
    public async Task Si_el_backend_rechaza_el_secreto_nuevo_sigue_valiendo_el_anterior()
    {
        var rig = new Rig();
        var stored = rig.Credentials.Load()!;
        var next = new DeviceCredential(stored.Current.DeviceId, DeviceCredential.NewSecret());
        rig.Credentials.Save(stored with { Pending = next });
        rig.Queue.Backend.Accepts = credential => credential.Secret == stored.Current.Secret;
        await rig.Run();
        Assert.Equal(stored.Current.Secret, rig.Credentials.Load()!.Current.Secret);
        Assert.Null(rig.Credentials.Load()!.Pending);
        Assert.Equal(RegistrationStatus.Active, rig.Queue.State.Snapshot().Registration);
    }
}

/// <summary>Identidad por instalación: registro, doble registro, códigos mal escritos y rotación.</summary>
public sealed class DeviceRegistrationTests
{
    [Fact]
    public async Task El_registro_manda_solo_el_hash_del_secreto_y_guarda_la_credencial()
    {
        var backend = new FakeBackend();
        var store = new InMemoryCredentialStore();
        var stored = await new DeviceRegistration(backend, store).RegisterAsync("abcde-fgh1o", "Mostrador", CancellationToken.None);
        Assert.Equal("register:ABCDE-FGH10", backend.Calls.Single());
        Assert.Equal(DeviceCredential.Hash(stored.Current.Secret), backend.LastRegisteredSecretHash);
        Assert.NotEqual(stored.Current.Secret, backend.LastRegisteredSecretHash);
        Assert.Equal(43, stored.Current.Secret.Length);
        Assert.Equal("TABA IMPRIME A", store.Load()!.BusinessName);
    }

    [Fact]
    public async Task No_se_registra_dos_veces_sin_dar_de_baja()
    {
        var store = new InMemoryCredentialStore();
        var registration = new DeviceRegistration(new FakeBackend(), store);
        await registration.RegisterAsync("ABCDE-12345", "Mostrador", CancellationToken.None);
        var error = await Assert.ThrowsAsync<InvalidOperationException>(() => registration.RegisterAsync("ABCDE-12346", "Otra", CancellationToken.None));
        Assert.Equal("ALREADY_REGISTERED", error.Message);
        registration.Unregister();
        Assert.Null(store.Load());
    }

    [Theory]
    [InlineData("ABC")]
    [InlineData("ABCDE-12345-EXTRA")]
    [InlineData("")]
    public async Task Un_codigo_mal_escrito_no_llega_al_backend(string code)
    {
        var backend = new FakeBackend();
        await Assert.ThrowsAsync<ArgumentException>(() => new DeviceRegistration(backend, new InMemoryCredentialStore()).RegisterAsync(code, "Mostrador", CancellationToken.None));
        Assert.Empty(backend.Calls);
    }

    [Fact]
    public async Task Rotar_deja_el_secreto_nuevo_pendiente_y_manda_solo_su_hash()
    {
        var backend = new FakeBackend();
        var store = new InMemoryCredentialStore();
        var registration = new DeviceRegistration(backend, store);
        var stored = await registration.RegisterAsync("ABCDE-12345", "Mostrador", CancellationToken.None);
        await registration.RotateAsync(CancellationToken.None);
        var after = store.Load()!;
        Assert.Equal(stored.Current.Secret, after.Current.Secret);
        Assert.NotNull(after.Pending);
        Assert.Equal(after.Pending!.SecretHash, backend.LastRotatedHash);
    }
}
