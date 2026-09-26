using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using System.Text.Json.Serialization;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.TestHost;
using Microsoft.Extensions.DependencyInjection;
using Taba.LocalAgent.Core.Printing;
using Taba.LocalAgent.Core.Security;

namespace Taba.LocalAgent.Tests;

/// <summary>La API local de punta a punta, en memoria: puerta, render, cola y despacho.</summary>
public sealed class LocalApiTests : IAsyncLifetime
{
    private const string Panel = "https://la-taba-commercial-pilot.pages.dev";
    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web) { Converters = { new JsonStringEnumConverter() } };

    private readonly string _token = LocalApiToken.Generate();
    private readonly string _directory = Path.Combine(Path.GetTempPath(), "taba-agent-api-" + Guid.NewGuid().ToString("N"));
    private readonly FakeTransport _transport = new();
    private WebApplication _app = null!;
    private HttpClient _client = null!;

    public async Task InitializeAsync()
    {
        _app = LocalAgentHost.Build([], builder =>
        {
            builder.WebHost.UseTestServer();
            builder.Services.AddSingleton<IPrinterCatalog>(new FakeCatalog("Termica mostrador"));
            builder.Services.AddSingleton<IRawPrinterTransport>(_transport);
            builder.Services.AddSingleton<IPrintJobStore>(new JsonFilePrintJobStore(Path.Combine(_directory, "jobs.json")));
            builder.Services.AddSingleton(new LocalApiGate(new OriginPolicy([Panel]), _token, 17872));
        });
        await _app.StartAsync();
        _client = _app.GetTestClient();
        _client.BaseAddress = new Uri("http://127.0.0.1:17872/");
    }

    public async Task DisposeAsync()
    {
        _client.Dispose();
        await _app.StopAsync();
        await _app.DisposeAsync();
        await TestFiles.DeleteDirectoryAsync(_directory);
    }

    private HttpRequestMessage Request(HttpMethod method, string path, object? body = null, string? origin = Panel, bool withToken = true)
    {
        var request = new HttpRequestMessage(method, path);
        if (origin is not null)
        {
            request.Headers.Add("Origin", origin);
        }

        if (withToken)
        {
            request.Headers.Add(LocalApiToken.HeaderName, _token);
        }

        if (body is not null)
        {
            request.Content = JsonContent.Create(body, options: Json);
        }

        return request;
    }

    private static object KitchenJob(string key = "order:LT-2044:kitchen:v1") => new
    {
        idempotencyKey = key,
        kind = "KitchenTicket",
        format = "EscPos80mm",
        printerName = "Termica mostrador",
        copies = 1,
        requestedBy = "auto",
        order = new
        {
            businessName = "La Taba",
            orderCode = "LT-2044",
            createdAt = "2026-09-26T22:04:00-03:00",
            fulfillmentLabel = "Delivery",
            lines = new[] { new { quantity = 4, description = "Gaseosa cola 2,25 L" } },
        },
    };

    [Fact]
    public async Task La_salud_responde_sin_token_y_sin_secretos()
    {
        var response = await _client.SendAsync(Request(HttpMethod.Get, "/v1/health", withToken: false));
        var body = await response.Content.ReadAsStringAsync();

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        Assert.Contains("\"agent\":\"ONLINE\"", body, StringComparison.Ordinal);
        Assert.Contains("Termica mostrador", body, StringComparison.Ordinal);
        Assert.DoesNotContain(_token, body, StringComparison.Ordinal);
        Assert.Equal(Panel, response.Headers.GetValues("Access-Control-Allow-Origin").Single());
    }

    [Fact]
    public async Task Otra_web_no_puede_usar_el_agente_ni_para_la_salud()
    {
        var health = await _client.SendAsync(Request(HttpMethod.Get, "/v1/health", origin: "https://evil.example", withToken: false));
        var print = await _client.SendAsync(Request(HttpMethod.Post, "/v1/print-jobs", KitchenJob(), origin: "https://evil.example"));

        Assert.Equal(HttpStatusCode.Forbidden, health.StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, print.StatusCode);
        Assert.False(health.Headers.Contains("Access-Control-Allow-Origin"));
        Assert.Empty(_transport.Sent);
    }

    [Fact]
    public async Task Sin_token_no_se_imprime()
    {
        var response = await _client.SendAsync(Request(HttpMethod.Post, "/v1/print-jobs", KitchenJob(), withToken: false));

        Assert.Equal(HttpStatusCode.Forbidden, response.StatusCode);
        Assert.Empty(_transport.Sent);
    }

    [Fact]
    public async Task Un_host_ajeno_se_rechaza_aunque_traiga_token()
    {
        var request = Request(HttpMethod.Get, "/v1/printers");
        request.Headers.Host = "rebinding.evil.example:17872";

        var response = await _client.SendAsync(request);

        Assert.Equal(HttpStatusCode.Forbidden, response.StatusCode);
    }

    [Fact]
    public async Task El_preflight_de_chrome_para_red_local_se_contesta()
    {
        var request = Request(HttpMethod.Options, "/v1/print-jobs", withToken: false);
        request.Headers.Add("Access-Control-Request-Method", "POST");
        request.Headers.Add("Access-Control-Request-Private-Network", "true");

        var response = await _client.SendAsync(request);

        Assert.Equal(HttpStatusCode.NoContent, response.StatusCode);
        Assert.Equal("true", response.Headers.GetValues("Access-Control-Allow-Private-Network").Single());
        Assert.Contains(LocalApiToken.HeaderName, response.Headers.GetValues("Access-Control-Allow-Headers").Single(), StringComparison.Ordinal);
    }

    [Fact]
    public async Task Un_pedido_repetido_con_la_misma_clave_imprime_una_sola_vez()
    {
        var first = await _client.SendAsync(Request(HttpMethod.Post, "/v1/print-jobs", KitchenJob()));
        var second = await _client.SendAsync(Request(HttpMethod.Post, "/v1/print-jobs", KitchenJob()));
        var a = await first.Content.ReadFromJsonAsync<JsonElement>(Json);
        var b = await second.Content.ReadFromJsonAsync<JsonElement>(Json);

        Assert.Equal(HttpStatusCode.Accepted, first.StatusCode);
        Assert.Equal(a.GetProperty("jobId").GetString(), b.GetProperty("jobId").GetString());

        var jobId = a.GetProperty("jobId").GetString();
        var printed = await WaitForStateAsync(jobId!, "Printed");
        Assert.True(printed, "el trabajo no llegó a imprimirse");
        Assert.Single(_transport.Sent);
        Assert.Equal(new byte[] { 0x1B, 0x40 }, _transport.Sent[0].Payload[..2]);
    }

    [Fact]
    public async Task Reimprimir_queda_auditado_con_quien_lo_pidio()
    {
        var created = await (await _client.SendAsync(Request(HttpMethod.Post, "/v1/print-jobs", KitchenJob("order:LT-2045:kitchen:v1"))))
            .Content.ReadFromJsonAsync<JsonElement>(Json);
        var jobId = created.GetProperty("jobId").GetString()!;
        await WaitForStateAsync(jobId, "Printed");

        var reprint = await _client.SendAsync(Request(HttpMethod.Post, $"/v1/print-jobs/{jobId}/reprint", new { requestedBy = "operador:ana" }));
        var view = await reprint.Content.ReadFromJsonAsync<JsonElement>(Json);

        Assert.Equal(HttpStatusCode.Accepted, reprint.StatusCode);
        Assert.Equal(jobId, view.GetProperty("reprintOf").GetString());
        Assert.Equal("operador:ana", view.GetProperty("requestedBy").GetString());
    }

    [Fact]
    public async Task Un_comprobante_fiscal_sin_cae_no_entra_a_la_cola()
    {
        var body = new
        {
            idempotencyKey = "fiscal:FB-4-42:thermal",
            kind = "FiscalReceipt",
            format = "EscPos80mm",
            printerName = "Termica mostrador",
            copies = 1,
            requestedBy = "operador:ana",
            fiscal = new
            {
                issuerName = "La Taba",
                issuerCuit = "20-00000000-1",
                voucherLabel = "Factura B",
                pointOfSale = 4,
                voucherNumber = 42,
                issueDate = "2026-09-26",
                total = 12100,
                cae = "",
                caeExpiration = "2026-10-06",
                qrUrl = "https://www.arca.gob.ar/fe/qr/?p=abc",
            },
        };

        var response = await _client.SendAsync(Request(HttpMethod.Post, "/v1/print-jobs", body));
        var error = await response.Content.ReadFromJsonAsync<JsonElement>(Json);

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        Assert.Equal("CAE_REQUIRED", error.GetProperty("error").GetString());
        Assert.Empty(_transport.Sent);
    }

    [Fact]
    public async Task La_web_no_puede_mandar_un_pdf_que_no_sea_un_comprobante()
    {
        var body = new
        {
            idempotencyKey = "k-pdf",
            kind = "OrderTicket",
            format = "PdfA4",
            printerName = "Termica mostrador",
            copies = 1,
            requestedBy = "operador:ana",
            pdfBase64 = Convert.ToBase64String("%PDF-1.7"u8.ToArray()),
        };

        var response = await _client.SendAsync(Request(HttpMethod.Post, "/v1/print-jobs", body));

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    private async Task<bool> WaitForStateAsync(string jobId, string state)
    {
        for (var i = 0; i < 100; i++)
        {
            var view = await (await _client.SendAsync(Request(HttpMethod.Get, $"/v1/print-jobs/{jobId}"))).Content.ReadFromJsonAsync<JsonElement>(Json);
            if (view.GetProperty("state").GetString() == state)
            {
                return true;
            }

            await Task.Delay(50);
        }

        return false;
    }
}
