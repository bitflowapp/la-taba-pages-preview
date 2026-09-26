using Microsoft.Extensions.Logging.Abstractions;
using Taba.LocalAgent.Core.Agent;
using Taba.LocalAgent.Core.Backend;
using Taba.LocalAgent.Core.Documents;
using Taba.LocalAgent.Core.Printing;
using Taba.LocalAgent.Core.Security;

namespace Taba.LocalAgent.Tests;

/// <summary>
/// La cola del mostrador: el orden «printing en el backend → entregar al
/// spooler → informar», la recuperación tras un reinicio y los casos en que NO
/// se imprime. Hereda las garantías de la cola del spike.
/// </summary>
public sealed class PrintQueueTests
{
    internal sealed class Rig
    {
        public Rig(int kitchenCopies = 1, bool withFiscalRoute = true)
        {
            var routes = new Dictionary<DocumentType, PrinterProfile>
            {
                [DocumentType.KitchenTicket] = new("Cocina", PrinterDriverKind.EscPos, 80, null, EscPosCodePage.Ascii, kitchenCopies),
                [DocumentType.OrderTicket] = new("Mostrador", PrinterDriverKind.EscPos, 58),
            };
            if (withFiscalRoute)
            {
                routes[DocumentType.FiscalReceipt] = new("Mostrador", PrinterDriverKind.EscPos, 58);
            }

            Routes = new PrintRoutes(routes);
            Journal = new PrintJournal(Store, Clock);
            Router = new PrinterRouter([new EscPosPrinter(Transport)], Catalog);
            Processor = new PrintJobProcessor(Journal, Backend, Router, Routes, new TicketComposer(TimeZoneInfo.Utc), State, NullLogger<PrintJobProcessor>.Instance);
        }

        public ManualClock Clock { get; } = new(DateTimeOffset.Parse("2026-09-26T18:00:00Z", System.Globalization.CultureInfo.InvariantCulture));

        public FakeTransport Transport { get; } = new();

        public FakeCatalog Catalog { get; } = new("Cocina", "Mostrador");

        public FakeBackend Backend { get; } = new();

        public InMemoryJournalStore Store { get; } = new();

        public PrintJournal Journal { get; }

        public AgentState State { get; } = new();

        public PrintRoutes Routes { get; }

        public PrinterRouter Router { get; }

        public PrintJobProcessor Processor { get; }

        public DeviceCredential Credential { get; } = new(Guid.NewGuid(), DeviceCredential.NewSecret());

        public static ClaimedJob Job(DocumentType type = DocumentType.KitchenTicket, System.Text.Json.JsonElement? payload = null,
            Guid? id = null, Guid? token = null, int version = 1) =>
            new(id ?? Guid.NewGuid(), type, payload ?? (type == DocumentType.FiscalReceipt ? Payloads.Fiscal() : Payloads.Order()), version, token ?? Guid.NewGuid(), 1, null);

        public Task<JournalEntry> Process(ClaimedJob job) => Processor.ProcessAsync(Credential, job, CancellationToken.None);
    }

    [Fact]
    public async Task Printing_se_registra_en_el_backend_antes_de_mandar_un_solo_byte()
    {
        var rig = new Rig();
        var job = Rig.Job();
        rig.Transport.OnSend = () =>
        {
            Assert.Contains(rig.Backend.Updates, u => u.Job == job.Id && u.Transition == JobTransition.Printing);
            Assert.Equal(JournalState.Sending, rig.Journal.Find(job.Id, job.ClaimToken)!.State);
        };

        var entry = await rig.Process(job);

        Assert.Single(rig.Transport.Sent);
        Assert.Equal(JournalState.Sent, entry.State);
        Assert.Equal(PendingReport.None, entry.PendingReport);
        Assert.Equal([JobTransition.Printing, JobTransition.Printed], rig.Backend.Updates.Select(u => u.Transition));
        Assert.All(rig.Backend.Updates, u => Assert.Equal(job.ClaimToken, u.Token));
    }

    [Fact]
    public async Task Un_reclamo_vencido_o_ajeno_no_imprime_nada()
    {
        var rig = new Rig();
        rig.Backend.FailNext(JobTransition.Printing, new BackendException(BackendErrorKind.Conflict, "CLAIM_CONFLICT"));
        var entry = await rig.Process(Rig.Job());
        Assert.Empty(rig.Transport.Sent);
        Assert.Equal(JournalState.Abandoned, entry.State);
        Assert.Empty(rig.Backend.Updates);
    }

    [Fact]
    public async Task Un_trabajo_de_otro_negocio_no_se_imprime()
    {
        var rig = new Rig();
        rig.Backend.FailNext(JobTransition.Printing, new BackendException(BackendErrorKind.NotFound, "NOT_FOUND"));
        var entry = await rig.Process(Rig.Job());
        Assert.Empty(rig.Transport.Sent);
        Assert.Equal(JournalState.Abandoned, entry.State);
    }

    [Fact]
    public async Task Un_dispositivo_revocado_no_imprime_y_queda_marcado_como_revocado()
    {
        var rig = new Rig();
        rig.Backend.FailNext(JobTransition.Printing, new BackendException(BackendErrorKind.Unauthorized, "DEVICE_UNAUTHORIZED"));
        var entry = await rig.Process(Rig.Job());
        Assert.Empty(rig.Transport.Sent);
        Assert.Equal(JournalState.Abandoned, entry.State);
        Assert.Equal(RegistrationStatus.Revoked, rig.State.Snapshot().Registration);
    }

    [Fact]
    public async Task Sin_backend_no_se_imprime_y_el_trabajo_vuelve_a_la_cola_cuando_vuelve()
    {
        var rig = new Rig();
        var job = Rig.Job();
        rig.Backend.FailNext(JobTransition.Printing, new BackendException(BackendErrorKind.Unavailable, "BACKEND_TIMEOUT"));
        var entry = await rig.Process(job);
        Assert.Empty(rig.Transport.Sent);
        Assert.Equal(JournalState.NotSent, entry.State);
        Assert.Equal(PendingReport.NotPrinted, entry.PendingReport);

        Assert.Equal(1, await rig.Processor.FlushReportsAsync(rig.Credential, CancellationToken.None));
        Assert.Contains(rig.Backend.Updates, u => u.Transition == JobTransition.NotPrinted && u.Error == "BACKEND_UNAVAILABLE");
        Assert.Empty(rig.Journal.PendingReports());
    }

    [Fact]
    public async Task La_impresora_apagada_no_recibe_nada_y_el_trabajo_vuelve_a_la_cola()
    {
        var rig = new Rig();
        rig.Catalog.States["Cocina"] = PrinterState.Offline;
        var entry = await rig.Process(Rig.Job());
        Assert.Empty(rig.Transport.Sent);
        Assert.Equal(JournalState.NotSent, entry.State);
        Assert.Contains(rig.Backend.Updates, u => u.Transition == JobTransition.NotPrinted && u.Error == "PRINTER_OFFLINE");
    }

    [Fact]
    public async Task Una_impresora_que_Windows_no_conoce_falla_sin_mandar_nada()
    {
        var rig = new Rig();
        rig.Catalog.States.Remove("Cocina");
        var entry = await rig.Process(Rig.Job());
        Assert.Empty(rig.Transport.Sent);
        Assert.Equal("PRINTER_NOT_FOUND", entry.ErrorCode);
    }

    [Fact]
    public async Task Un_corte_a_mitad_de_camino_queda_desconocido_no_fallido()
    {
        var rig = new Rig();
        rig.Transport.Script.Enqueue(PrintOutcome.Unknown("PRINTER_WRITE_PARTIAL"));
        var entry = await rig.Process(Rig.Job());
        Assert.Equal(JournalState.Unknown, entry.State);
        Assert.Contains(rig.Backend.Updates, u => u.Transition == JobTransition.Unknown && u.Error == "PRINTER_WRITE_PARTIAL");
        Assert.DoesNotContain(rig.Backend.Updates, u => u.Transition == JobTransition.NotPrinted);
    }

    [Fact]
    public async Task Si_falla_la_segunda_copia_el_resultado_es_desconocido_porque_ya_salio_papel()
    {
        var rig = new Rig(kitchenCopies: 2);
        rig.Transport.Script.Enqueue(PrintOutcome.Sent());
        rig.Transport.Script.Enqueue(PrintOutcome.NotSent("PRINTER_START_FAILED"));
        var entry = await rig.Process(Rig.Job());
        Assert.Equal(JournalState.Unknown, entry.State);
        Assert.Single(rig.Transport.Sent);
    }

    [Fact]
    public async Task Un_payload_malformado_no_se_imprime_nunca_ni_a_medias()
    {
        var rig = new Rig();
        var entry = await rig.Process(Rig.Job(payload: Payloads.Parse("""{"order":{"code":"X"}}""")));
        Assert.Empty(rig.Transport.Sent);
        Assert.Equal("MALFORMED_PAYLOAD", entry.ErrorCode);
        Assert.DoesNotContain(rig.Backend.Updates, u => u.Transition == JobTransition.Printing);
        Assert.Contains(rig.Backend.Updates, u => u.Transition == JobTransition.NotPrinted && u.Error == "MALFORMED_PAYLOAD");
    }

    [Fact]
    public async Task Un_texto_con_caracteres_de_control_se_rechaza_para_no_mandar_comandos_a_la_impresora()
    {
        var rig = new Rig();
        var entry = await rig.Process(Rig.Job(payload: Payloads.Order(notes: "hola\\u001b@")));
        Assert.Empty(rig.Transport.Sent);
        Assert.Equal("MALFORMED_PAYLOAD", entry.ErrorCode);
    }

    [Fact]
    public async Task Un_ticket_fiscal_sin_cae_no_llega_a_la_impresora()
    {
        var rig = new Rig();
        var entry = await rig.Process(Rig.Job(DocumentType.FiscalReceipt, Payloads.Fiscal(cae: "")));
        Assert.Empty(rig.Transport.Sent);
        Assert.Equal("FISCAL_WITHOUT_CAE", entry.ErrorCode);
    }

    [Fact]
    public async Task Un_ticket_fiscal_autorizado_se_imprime_con_su_cae()
    {
        var rig = new Rig();
        var entry = await rig.Process(Rig.Job(DocumentType.FiscalReceipt));
        Assert.Equal(JournalState.Sent, entry.State);
        Assert.Contains("CAE 12345678901234", System.Text.Encoding.ASCII.GetString(rig.Transport.Sent[0].Payload), StringComparison.Ordinal);
    }

    [Fact]
    public async Task Una_version_de_payload_desconocida_no_se_imprime()
    {
        var rig = new Rig();
        var entry = await rig.Process(Rig.Job(version: 2));
        Assert.Empty(rig.Transport.Sent);
        Assert.Equal("PAYLOAD_VERSION_UNSUPPORTED", entry.ErrorCode);
    }

    [Fact]
    public async Task Sin_impresora_configurada_para_el_documento_no_se_imprime()
    {
        var rig = new Rig(withFiscalRoute: false);
        var entry = await rig.Process(Rig.Job(DocumentType.FiscalReceipt));
        Assert.Empty(rig.Transport.Sent);
        Assert.Equal("NO_PRINTER_FOR_DOCUMENT", entry.ErrorCode);
    }

    [Fact]
    public async Task El_mismo_reclamo_entregado_dos_veces_imprime_una_sola_vez()
    {
        var rig = new Rig();
        var job = Rig.Job();
        await rig.Process(job);
        await rig.Process(job);
        Assert.Single(rig.Transport.Sent);
        Assert.Single(rig.Backend.Updates, u => u.Transition == JobTransition.Printing);
    }

    [Fact]
    public async Task El_mismo_trabajo_con_otro_reclamo_despues_de_imprimir_no_se_reimprime_solo()
    {
        var rig = new Rig();
        var id = Guid.NewGuid();
        await rig.Process(Rig.Job(id: id));
        var again = await rig.Process(Rig.Job(id: id, token: Guid.NewGuid()));
        Assert.Single(rig.Transport.Sent);
        Assert.Equal(JournalState.Unknown, again.State);
        Assert.Equal("DUPLICATE_JOB_DELIVERY", again.ErrorCode);
        Assert.Contains(rig.Backend.Updates, u => u.Transition == JobTransition.Unknown && u.Error == "DUPLICATE_JOB_DELIVERY");
    }

    [Fact]
    public async Task Dos_agentes_con_el_mismo_trabajo_imprimen_una_sola_vez()
    {
        // El backend sólo acepta «printing» con el token vigente: el segundo agente pierde.
        var winner = new Rig();
        var loser = new Rig();
        var id = Guid.NewGuid();
        loser.Backend.FailNext(JobTransition.Printing, new BackendException(BackendErrorKind.Conflict, "CLAIM_CONFLICT"));
        await Task.WhenAll(winner.Process(Rig.Job(id: id)), loser.Process(Rig.Job(id: id)));
        Assert.Single(winner.Transport.Sent);
        Assert.Empty(loser.Transport.Sent);
    }

    [Fact]
    public async Task Un_reporte_perdido_se_reintenta_hasta_que_el_backend_lo_confirma()
    {
        var rig = new Rig();
        rig.Backend.FailNext(JobTransition.Printed, new BackendException(BackendErrorKind.Unavailable, "BACKEND_UNREACHABLE"));
        var entry = await rig.Process(Rig.Job());
        Assert.Equal(PendingReport.Printed, entry.PendingReport);
        Assert.Equal(1, rig.Journal.Depth());
        Assert.Equal(1, await rig.Processor.FlushReportsAsync(rig.Credential, CancellationToken.None));
        Assert.Single(rig.Backend.Updates, u => u.Transition == JobTransition.Printed);
        Assert.Equal(0, rig.Journal.Depth());
        Assert.Single(rig.Transport.Sent);
    }

    [Fact]
    public async Task Si_una_persona_ya_resolvio_la_revision_el_reporte_tardio_no_insiste()
    {
        var rig = new Rig();
        rig.Backend.FailNext(JobTransition.Printed, new BackendException(BackendErrorKind.Conflict, "CLAIM_CONFLICT"));
        var entry = await rig.Process(Rig.Job());
        Assert.Equal(PendingReport.None, entry.PendingReport);
        Assert.Empty(rig.Journal.PendingReports());
    }

    [Fact]
    public void Un_reinicio_en_medio_de_la_impresion_deja_el_trabajo_desconocido_y_no_lo_reimprime()
    {
        var rig = new Rig();
        var entry = rig.Journal.Begin(Guid.NewGuid(), Guid.NewGuid(), DocumentType.KitchenTicket, 1, false);
        rig.Journal.Update(entry, JournalState.Sending, printerName: "Cocina");

        var recovered = Assert.Single(rig.Journal.RecoverAfterRestart());

        Assert.Equal(JournalState.Unknown, recovered.State);
        Assert.Equal(PendingReport.Unknown, recovered.PendingReport);
        Assert.Equal("AGENT_RESTARTED_DURING_PRINT", recovered.ErrorCode);
        Assert.True(rig.Journal.MayHavePrinted(entry.JobId));
    }

    [Theory]
    [InlineData(JournalState.Claimed)]
    [InlineData(JournalState.MarkedPrinting)]
    public void Un_reinicio_antes_de_tocar_el_spooler_devuelve_el_trabajo_sin_imprimir(JournalState state)
    {
        var rig = new Rig();
        var entry = rig.Journal.Begin(Guid.NewGuid(), Guid.NewGuid(), DocumentType.OrderTicket, 1, false);
        rig.Journal.Update(entry, state);
        var recovered = Assert.Single(rig.Journal.RecoverAfterRestart());
        Assert.Equal(JournalState.NotSent, recovered.State);
        Assert.Equal(PendingReport.NotPrinted, recovered.PendingReport);
        Assert.False(rig.Journal.MayHavePrinted(entry.JobId));
    }

    [Fact]
    public async Task El_diario_sobrevive_a_un_reinicio_del_proceso()
    {
        var directory = Path.Combine(Path.GetTempPath(), "taba-journal-" + Guid.NewGuid().ToString("N"));
        try
        {
            var path = Path.Combine(directory, "journal.json");
            var first = new PrintJournal(new JsonFileJournalStore(path));
            var entry = first.Begin(Guid.NewGuid(), Guid.NewGuid(), DocumentType.KitchenTicket, 1, false);
            first.Update(entry, JournalState.Sending, printerName: "Cocina");

            var afterRestart = new PrintJournal(new JsonFileJournalStore(path));
            var recovered = Assert.Single(afterRestart.RecoverAfterRestart());
            Assert.Equal(entry.JobId, recovered.JobId);
            Assert.Equal(JournalState.Unknown, recovered.State);
            Assert.DoesNotContain("Fernet", await File.ReadAllTextAsync(path), StringComparison.Ordinal);
        }
        finally
        {
            await TestFiles.DeleteDirectoryAsync(directory);
        }
    }

    [Fact]
    public async Task Lo_terminado_se_recorta_pero_lo_pendiente_o_dudoso_nunca()
    {
        var directory = Path.Combine(Path.GetTempPath(), "taba-journal-" + Guid.NewGuid().ToString("N"));
        try
        {
            var journal = new PrintJournal(new JsonFileJournalStore(Path.Combine(directory, "journal.json"), retainFinished: 2));
            var pending = journal.Update(journal.Begin(Guid.NewGuid(), Guid.NewGuid(), DocumentType.OrderTicket, 1, false), JournalState.Unknown, PendingReport.Unknown, "X_UNKNOWN");
            for (var i = 0; i < 5; i++)
            {
                var done = journal.Update(journal.Begin(Guid.NewGuid(), Guid.NewGuid(), DocumentType.KitchenTicket, 1, false), JournalState.Sent, PendingReport.Printed);
                journal.MarkReported(done);
            }

            var entries = journal.List();
            Assert.Equal(2, entries.Count(e => e.IsFinished));
            Assert.Contains(entries, e => e.JobId == pending.JobId);
        }
        finally
        {
            await TestFiles.DeleteDirectoryAsync(directory);
        }
    }
}
