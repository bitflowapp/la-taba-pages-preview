using System.Text.Json;
using Taba.LocalAgent.Core.Backend;
using Taba.LocalAgent.Core.Documents;
using Taba.LocalAgent.Core.Printing;
using Taba.LocalAgent.Core.Security;

namespace Taba.LocalAgent.Tests;

internal sealed class ManualClock(DateTimeOffset now) : TimeProvider
{
    public DateTimeOffset Now { get; set; } = now;

    public override DateTimeOffset GetUtcNow() => Now;

    public void Advance(TimeSpan span) => Now += span;
}

/// <summary>Una impresora de mentira que registra lo que recibió y contesta lo que se le pida.</summary>
internal sealed class FakeTransport : IRawPrinterTransport
{
    public List<(string Printer, byte[] Payload)> Sent { get; } = [];

    public Queue<PrintOutcome> Script { get; } = new();

    /// <summary>Se ejecuta al recibir los bytes: sirve para ver el estado del diario en ese instante.</summary>
    public Action? OnSend { get; set; }

    public Task<PrintOutcome> SendRawAsync(string printerName, ReadOnlyMemory<byte> payload, string documentTitle, CancellationToken cancellationToken)
    {
        OnSend?.Invoke();
        var outcome = Script.Count > 0 ? Script.Dequeue() : PrintOutcome.Sent();
        if (outcome.Status != PrintOutcomeStatus.NotSent)
        {
            Sent.Add((printerName, payload.ToArray()));
        }

        return Task.FromResult(outcome);
    }
}

internal sealed class FakeCatalog(params string[] names) : IPrinterCatalog
{
    public Dictionary<string, PrinterState> States { get; } = names.ToDictionary(n => n, _ => PrinterState.Ready, StringComparer.Ordinal);

    public IReadOnlyList<PrinterDescriptor> ListPrinters() =>
        States.Select((pair, index) => new PrinterDescriptor(pair.Key, index == 0, pair.Value)).ToList();

    public PrinterState GetState(string printerName) =>
        States.TryGetValue(printerName, out var state) ? state : PrinterState.NotFound;
}

/// <summary>Backend de mentira: registra cada llamada y contesta lo guionado o lo razonable.</summary>
internal sealed class FakeBackend : IBackendClient
{
    public List<string> Calls { get; } = [];

    public List<(Guid Job, Guid Token, JobTransition Transition, string? Error)> Updates { get; } = [];

    public Queue<ClaimResult> Claims { get; } = new();

    public Dictionary<JobTransition, Queue<Exception>> UpdateFailures { get; } = [];

    public Exception? HeartbeatFailure { get; set; }

    public Exception? ClaimFailure { get; set; }

    public Func<DeviceCredential, bool> Accepts { get; set; } = _ => true;

    public string? LastRegisteredSecretHash { get; private set; }

    public string? LastRotatedHash { get; private set; }

    public List<(Guid Job, string Reason, string? Operator, string Key)> Reprints { get; } = [];

    public List<IReadOnlyCollection<DocumentType>> ClaimedTypes { get; } = [];

    public Task<RegistrationResult> RegisterAsync(string pairingCode, string secretHash, string deviceName, CancellationToken cancellationToken)
    {
        Calls.Add($"register:{pairingCode}");
        LastRegisteredSecretHash = secretHash;
        return Task.FromResult(new RegistrationResult(Guid.Parse("11111111-2222-4333-8444-555555555555"), Guid.Parse("b7000000-0000-4000-8000-000000000001"), "TABA IMPRIME A", deviceName));
    }

    public Task<HeartbeatResult> HeartbeatAsync(DeviceCredential credential, HeartbeatReport report, CancellationToken cancellationToken)
    {
        Calls.Add("heartbeat");
        if (!Accepts(credential))
        {
            return Task.FromException<HeartbeatResult>(new BackendException(BackendErrorKind.Unauthorized, "DEVICE_UNAUTHORIZED"));
        }

        return HeartbeatFailure is { } failure ? Task.FromException<HeartbeatResult>(failure) : Task.FromResult(new HeartbeatResult(10));
    }

    public Task<ClaimResult> ClaimAsync(DeviceCredential credential, IReadOnlyCollection<DocumentType> types, int limit, CancellationToken cancellationToken)
    {
        Calls.Add("claim");
        ClaimedTypes.Add(types);
        if (!Accepts(credential))
        {
            return Task.FromException<ClaimResult>(new BackendException(BackendErrorKind.Unauthorized, "DEVICE_UNAUTHORIZED"));
        }

        if (ClaimFailure is { } failure)
        {
            return Task.FromException<ClaimResult>(failure);
        }

        return Task.FromResult(Claims.Count > 0 ? Claims.Dequeue() : new ClaimResult([], 10));
    }

    public Task<JobUpdateResult> UpdateJobAsync(DeviceCredential credential, Guid jobId, Guid claimToken, JobTransition transition,
        string? errorCode, int? durationMs, CancellationToken cancellationToken)
    {
        Calls.Add($"update:{transition}");
        if (UpdateFailures.TryGetValue(transition, out var failures) && failures.Count > 0)
        {
            return Task.FromException<JobUpdateResult>(failures.Dequeue());
        }

        Updates.Add((jobId, claimToken, transition, errorCode));
        return Task.FromResult(new JobUpdateResult(transition.ToString(), false));
    }

    public Task<Guid> RequestReprintAsync(DeviceCredential credential, Guid jobId, string reason, string? operatorLabel, string idempotencyKey, CancellationToken cancellationToken)
    {
        Calls.Add("reprint");
        Reprints.Add((jobId, reason, operatorLabel, idempotencyKey));
        return Task.FromResult(Guid.NewGuid());
    }

    public Task RotateSecretAsync(DeviceCredential credential, string newSecretHash, CancellationToken cancellationToken)
    {
        Calls.Add("rotate");
        LastRotatedHash = newSecretHash;
        return Task.CompletedTask;
    }

    public void FailNext(JobTransition transition, Exception error)
    {
        if (!UpdateFailures.TryGetValue(transition, out var queue))
        {
            queue = new Queue<Exception>();
            UpdateFailures[transition] = queue;
        }

        queue.Enqueue(error);
    }
}

/// <summary>Payloads v1 tal como los arma la base (supabase/migrations/20260926160000_local_print_agent.sql).</summary>
internal static class Payloads
{
    public static JsonElement Order(bool reprint = false, string notes = "sin cebolla") => Parse($$$"""
        {"business":{"name":"TABA IMPRIME A"},
         "order":{"code":"PRINT-2","created_at":"2026-09-26T18:30:00+00:00","fulfillment":"delivery","notes":"{{{notes}}}",
                  "items":[{"name":"Fernet Branca 750 ml","quantity":2,"unit":"u","unit_price":1250.00,"subtotal":2500.00},
                           {"name":"Hielo 2 kg","quantity":1,"unit":null,"unit_price":800,"subtotal":800}],
                  "subtotal":3300.00,"delivery_fee":500,"discount":0,"total":3800.00,"currency":"ARS",
                  "payment":{"method":"cash","label":"Efectivo"},"rider":{"name":"Marco"}},
         "reprint":{{{(reprint ? "true" : "false")}}}}
        """);

    public static JsonElement Fiscal(string cae = "12345678901234", string environment = "homologation", bool reprint = false) => Parse($$$"""
        {"environment":"{{{environment}}}",
         "issuer":{"legal_name":"TABA IMPRIME SA","cuit":"20123456789","tax_condition":"monotributo","address":"Mendoza 827, Neuquén","gross_income_number":"123-456"},
         "receiver":{"condition":"consumidor_final","document_type":99,"document_number":"0"},
         "voucher":{"type_code":11,"label":"Factura C","point_of_sale":1,"number":123,"issue_date":"2026-09-26","intent":"invoice","associated":null},
         "items":[{"description":"Fernet Branca 750 ml","quantity":1,"unit_price":1234.50,"net_amount":1234.50,"tax_amount":0}],
         "totals":{"net":1234.50,"tax":0,"exempt":0,"non_taxed":0,"other_taxes":0,"total":1234.50,"currency":"PES","currency_rate":1.000000},
         "cae":"{{{cae}}}","cae_expiration":"2026-10-06",
         "qr_url":"https://www.arca.gob.ar/fe/qr/?p=eyJ2ZXIiOjF9",
         "reprint":{{{(reprint ? "true" : "false")}}}}
        """);

    public static JsonElement Parse(string json)
    {
        using var document = JsonDocument.Parse(json);
        return document.RootElement.Clone();
    }
}

internal static class TestFiles
{
    /// <summary>Borra la carpeta temporal tolerando que Windows la tenga abierta unos milisegundos.</summary>
    public static async Task DeleteDirectoryAsync(string directory)
    {
        for (var attempt = 0; attempt < 20 && Directory.Exists(directory); attempt++)
        {
            try
            {
                Directory.Delete(directory, recursive: true);
            }
            catch (IOException)
            {
                await Task.Delay(50);
            }
            catch (UnauthorizedAccessException)
            {
                await Task.Delay(50);
            }
        }
    }
}
