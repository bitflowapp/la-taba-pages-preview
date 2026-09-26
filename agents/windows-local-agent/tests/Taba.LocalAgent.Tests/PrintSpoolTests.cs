using Taba.LocalAgent.Core.Printing;

namespace Taba.LocalAgent.Tests;

public sealed class PrintSpoolTests : IDisposable
{
    private readonly FakeTransport _transport = new();
    private readonly InMemoryPrintJobStore _store = new();
    private readonly ManualClock _clock = new(new DateTimeOffset(2026, 9, 26, 12, 0, 0, TimeSpan.Zero));
    private readonly PrintSpool _spool;

    public PrintSpoolTests()
    {
        _spool = new PrintSpool(_store, new FormatPrinterResolver(new FakeCatalog("Termica mostrador", "A4 oficina"), _transport), _clock);
    }

    public void Dispose() => _spool.Dispose();

    private static PrintRequest Kitchen(string key = "order:LT-2044:kitchen:v1", string printer = "Termica mostrador") =>
        new(key, PrintDocumentKind.KitchenTicket, PrintFormat.EscPos80mm, printer, new byte[] { 0x1B, 0x40, 0x41 }, 1, "auto");

    [Fact]
    public async Task La_misma_clave_de_idempotencia_nunca_imprime_dos_veces()
    {
        var first = _spool.Enqueue(Kitchen());
        var second = _spool.Enqueue(Kitchen());
        Assert.Equal(first.JobId, second.JobId);

        await _spool.DispatchPendingAsync();
        await _spool.DispatchPendingAsync();
        _spool.Enqueue(Kitchen());
        await _spool.DispatchPendingAsync();

        Assert.Single(_transport.Sent);
        Assert.Equal(PrintJobState.Printed, _spool.Find(first.JobId)!.State);
    }

    [Fact]
    public void Un_reinicio_en_medio_de_la_impresion_deja_el_trabajo_desconocido_y_no_lo_reimprime()
    {
        var job = _spool.Enqueue(Kitchen());
        _store.Save(job with { State = PrintJobState.Printing, Attempts = 1 });

        var recovered = _spool.RecoverAfterRestart();

        var only = Assert.Single(recovered);
        Assert.Equal(PrintJobState.Unknown, only.State);
        Assert.Equal("RESTART_DURING_PRINT", only.LastErrorCode);
        Assert.Empty(_transport.Sent);
    }

    [Fact]
    public async Task Un_trabajo_desconocido_no_se_despacha_solo()
    {
        var job = _spool.Enqueue(Kitchen());
        _store.Save(job with { State = PrintJobState.Unknown });

        await _spool.DispatchPendingAsync();

        Assert.Empty(_transport.Sent);
        Assert.Equal(PrintJobState.Unknown, _spool.Find(job.JobId)!.State);
    }

    [Fact]
    public async Task Reimprimir_crea_otro_trabajo_auditado_que_apunta_al_original()
    {
        var original = _spool.Enqueue(Kitchen());
        await _spool.DispatchAsync(original.JobId);

        var reprint = _spool.Reprint(original.JobId, "operador:ana");
        await _spool.DispatchAsync(reprint.JobId);

        Assert.NotEqual(original.JobId, reprint.JobId);
        Assert.Equal(original.JobId, reprint.ReprintOf);
        Assert.Equal("operador:ana", reprint.RequestedBy);
        Assert.Equal("order:LT-2044:kitchen:v1:reprint:1", reprint.IdempotencyKey);
        Assert.Equal(2, _transport.Sent.Count);
        Assert.Equal(_transport.Sent[0].Payload, _transport.Sent[1].Payload);
    }

    [Fact]
    public async Task Lo_que_no_llego_a_enviarse_se_reintenta_hasta_el_tope_y_despues_espera_al_operador()
    {
        for (var i = 0; i < PrintSpool.MaxAutomaticAttempts + 2; i++)
        {
            _transport.Script.Enqueue(PrintOutcome.NotSent("PRINTER_OFFLINE"));
        }

        var job = _spool.Enqueue(Kitchen());
        for (var i = 0; i < PrintSpool.MaxAutomaticAttempts + 2; i++)
        {
            await _spool.DispatchPendingAsync();
        }

        var final = _spool.Find(job.JobId)!;
        Assert.Equal(PrintJobState.Failed, final.State);
        Assert.Equal(PrintSpool.MaxAutomaticAttempts, final.Attempts);
        Assert.Equal("PRINTER_OFFLINE", final.LastErrorCode);
        Assert.Empty(_transport.Sent);
    }

    [Fact]
    public async Task Un_corte_a_mitad_de_camino_queda_desconocido_no_fallido()
    {
        _transport.Script.Enqueue(PrintOutcome.Unknown("PRINTER_WRITE_PARTIAL"));
        var job = _spool.Enqueue(Kitchen());

        var result = await _spool.DispatchAsync(job.JobId);
        await _spool.DispatchPendingAsync();

        Assert.Equal(PrintJobState.Unknown, result.State);
        Assert.Equal(1, _spool.Find(job.JobId)!.Attempts);
    }

    [Fact]
    public async Task Si_falla_la_segunda_copia_el_resultado_es_desconocido_porque_ya_salio_papel()
    {
        _transport.Script.Enqueue(PrintOutcome.Sent());
        _transport.Script.Enqueue(PrintOutcome.NotSent("PRINTER_OFFLINE"));
        var job = _spool.Enqueue(Kitchen() with { Copies = 2 });

        var result = await _spool.DispatchAsync(job.JobId);

        Assert.Equal(PrintJobState.Unknown, result.State);
    }

    [Fact]
    public async Task Una_impresora_que_no_existe_falla_sin_mandar_nada()
    {
        var job = _spool.Enqueue(Kitchen(printer: "No existe"));

        var result = await _spool.DispatchAsync(job.JobId);

        Assert.Equal(PrintJobState.Failed, result.State);
        Assert.Equal("PRINTER_NOT_FOUND", result.LastErrorCode);
        Assert.Empty(_transport.Sent);
    }

    [Fact]
    public void Las_entradas_invalidas_se_rechazan_antes_de_encolar()
    {
        Assert.Throws<ArgumentException>(() => _spool.Enqueue(Kitchen(key: " ")));
        Assert.Throws<ArgumentException>(() => _spool.Enqueue(Kitchen() with { Copies = 6 }));
        Assert.Throws<ArgumentException>(() => _spool.Enqueue(Kitchen() with { Payload = ReadOnlyMemory<byte>.Empty }));
        Assert.Throws<ArgumentException>(() => _spool.Enqueue(Kitchen() with { RequestedBy = "" }));
        Assert.Empty(_store.LoadAll());
    }

    [Fact]
    public async Task Un_pdf_invalido_no_llega_al_spooler()
    {
        var job = _spool.Enqueue(new PrintRequest("fiscal:FB-4-42:a4", PrintDocumentKind.FiscalReceipt, PrintFormat.PdfA4, "A4 oficina", "no es un pdf"u8.ToArray(), 1, "operador:ana"));

        var result = await _spool.DispatchAsync(job.JobId);

        Assert.Equal(PrintJobState.Failed, result.State);
        Assert.Equal("PDF_INVALID", result.LastErrorCode);
        Assert.Empty(_transport.Sent);
    }
}

public sealed class JsonFilePrintJobStoreTests : IDisposable
{
    private readonly string _directory = Path.Combine(Path.GetTempPath(), "taba-agent-tests-" + Guid.NewGuid().ToString("N"));

    public void Dispose() => TestFiles.DeleteDirectoryAsync(_directory).GetAwaiter().GetResult();

    [Fact]
    public void La_cola_sobrevive_a_un_reinicio_del_proceso()
    {
        var path = Path.Combine(_directory, "jobs.json");
        var clock = new ManualClock(DateTimeOffset.UnixEpoch);
        var resolver = new FormatPrinterResolver(new FakeCatalog("T"), new FakeTransport());
        string jobId;
        using (var spool = new PrintSpool(new JsonFilePrintJobStore(path), resolver, clock))
        {
            jobId = spool.Enqueue(new PrintRequest("k1", PrintDocumentKind.TestPage, PrintFormat.EscPos58mm, "T", new byte[] { 1 }, 1, "auto")).JobId;
        }

        using var again = new PrintSpool(new JsonFilePrintJobStore(path), resolver, clock);
        var job = again.Find(jobId);
        Assert.NotNull(job);
        Assert.Equal(PrintJobState.Queued, job.State);
        Assert.False(File.Exists(path + ".tmp"));
    }

    [Fact]
    public void Lo_impreso_se_recorta_pero_lo_pendiente_o_dudoso_nunca()
    {
        var store = new JsonFilePrintJobStore(Path.Combine(_directory, "jobs.json"), retainCompleted: 2);
        var start = new DateTimeOffset(2026, 1, 1, 0, 0, 0, TimeSpan.Zero);
        for (var i = 0; i < 5; i++)
        {
            store.Save(Job($"printed-{i}", PrintJobState.Printed, start.AddMinutes(i)));
        }

        store.Save(Job("unknown", PrintJobState.Unknown, start));
        store.Save(Job("queued", PrintJobState.Queued, start));

        var ids = store.LoadAll().Select(j => j.JobId).ToList();
        Assert.Contains("unknown", ids);
        Assert.Contains("queued", ids);
        Assert.Equal(2, ids.Count(id => id.StartsWith("printed-", StringComparison.Ordinal)));
        Assert.Contains("printed-4", ids);
    }

    private static PrintJob Job(string id, PrintJobState state, DateTimeOffset at) => new()
    {
        JobId = id,
        IdempotencyKey = id,
        Kind = PrintDocumentKind.TestPage,
        Format = PrintFormat.EscPos58mm,
        PrinterName = "T",
        PayloadBase64 = "AQ==",
        Copies = 1,
        RequestedBy = "auto",
        State = state,
        CreatedAt = at,
        UpdatedAt = at,
    };
}
