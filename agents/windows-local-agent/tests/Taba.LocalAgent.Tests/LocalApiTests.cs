using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.TestHost;
using Microsoft.Extensions.DependencyInjection;
using Taba.LocalAgent.Core.Agent;
using Taba.LocalAgent.Core.Backend;
using Taba.LocalAgent.Core.Printing;
using Taba.LocalAgent.Core.Security;

namespace Taba.LocalAgent.Tests;

/// <summary>La API local de punta a punta, en memoria: puerta, salud, prueba de impresión y reimpresión.</summary>
public sealed class LocalApiTests : IAsyncLifetime
{
    private const string Panel = "https://la-taba-commercial-pilot.pages.dev";

    private readonly string _token = LocalApiToken.Generate();
    private readonly string _directory = Path.Combine(Path.GetTempPath(), "taba-agent-api-" + Guid.NewGuid().ToString("N"));
    private readonly FakeTransport _transport = new();
    private readonly FakeBackend _backend = new();
    private readonly InMemoryCredentialStore _credentials = new();
    private WebApplication _app = null!;
    private HttpClient _client = null!;

    public async Task InitializeAsync()
    {
        _app = LocalAgentHost.Build([$"--Agent:DataDirectory={_directory}", "--Agent:Routes:kitchen_ticket:Printer=Termica mostrador"], builder =>
        {
            builder.WebHost.UseTestServer();
            builder.Services.AddSingleton<IPrinterCatalog>(new FakeCatalog("Termica mostrador"));
            builder.Services.AddSingleton<IRawPrinterTransport>(_transport);
            builder.Services.AddSingleton<IBackendClient>(_backend);
            builder.Services.AddSingleton<ICredentialStore>(_credentials);
            builder.Services.AddSingleton<IJournalStore>(new InMemoryJournalStore());
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

    private HttpRequestMessage Request(HttpMethod method, string path, object? body = null, string? origin = Panel, bool withToken = true, string? host = null)
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

        if (host is not null)
        {
            request.Headers.Host = host;
        }

        if (body is not null)
        {
            request.Content = JsonContent.Create(body);
        }

        return request;
    }

    [Fact]
    public async Task La_salud_responde_sin_token_y_sin_secretos()
    {
        using var response = await _client.SendAsync(Request(HttpMethod.Get, "/v1/health", withToken: false));
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        Assert.Equal(Panel, response.Headers.GetValues("Access-Control-Allow-Origin").Single());
        var text = await response.Content.ReadAsStringAsync();
        using var health = JsonDocument.Parse(text);
        Assert.Equal("ONLINE", health.RootElement.GetProperty("agent").GetString());
        Assert.Equal("0.1.0", health.RootElement.GetProperty("version").GetString());
        Assert.Equal("NOT_REGISTERED", health.RootElement.GetProperty("registration").GetString());
        Assert.Equal("READY", health.RootElement.GetProperty("printers")[0].GetProperty("status").GetString());
        Assert.Equal(0, health.RootElement.GetProperty("queue_depth").GetInt32());
        Assert.DoesNotContain(_token, text, StringComparison.Ordinal);
        Assert.DoesNotContain(_directory.Replace("\\", "\\\\", StringComparison.Ordinal), text, StringComparison.Ordinal);
        Assert.DoesNotContain("device", text, StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public async Task La_salud_dice_si_el_agente_esta_registrado_sin_mostrar_la_credencial()
    {
        var credential = new DeviceCredential(Guid.NewGuid(), DeviceCredential.NewSecret());
        _credentials.Save(new StoredCredential(credential, null, Guid.NewGuid(), "TABA IMPRIME A", "Mostrador", DateTimeOffset.UtcNow));
        _app.Services.GetRequiredService<AgentState>().SetRegistration(RegistrationStatus.Active, "TABA IMPRIME A");
        using var response = await _client.SendAsync(Request(HttpMethod.Get, "/v1/health", withToken: false));
        var text = await response.Content.ReadAsStringAsync();
        Assert.Contains("\"registration\":\"ACTIVE\"", text, StringComparison.Ordinal);
        Assert.DoesNotContain(credential.Secret, text, StringComparison.Ordinal);
        Assert.DoesNotContain(credential.DeviceId.ToString("D"), text, StringComparison.Ordinal);
    }

    [Fact]
    public async Task Otra_web_no_puede_usar_el_agente_ni_para_la_salud()
    {
        using var health = await _client.SendAsync(Request(HttpMethod.Get, "/v1/health", origin: "https://evil.example", withToken: false));
        Assert.Equal(HttpStatusCode.Forbidden, health.StatusCode);
        Assert.Empty(await health.Content.ReadAsByteArrayAsync());
        using var print = await _client.SendAsync(Request(HttpMethod.Post, "/v1/print-test", new { printer = "Termica mostrador" }, origin: "https://evil.example"));
        Assert.Equal(HttpStatusCode.Forbidden, print.StatusCode);
        Assert.Empty(_transport.Sent);
    }

    [Fact]
    public async Task Un_archivo_local_no_puede_hablarle_al_agente()
    {
        // file:// y los iframes con sandbox mandan Origin: null.
        using var response = await _client.SendAsync(Request(HttpMethod.Get, "/v1/printers", origin: "null"));
        Assert.Equal(HttpStatusCode.Forbidden, response.StatusCode);
    }

    [Fact]
    public async Task Sin_token_no_se_lista_ni_se_imprime()
    {
        using var printers = await _client.SendAsync(Request(HttpMethod.Get, "/v1/printers", withToken: false));
        Assert.Equal(HttpStatusCode.Forbidden, printers.StatusCode);
        using var print = await _client.SendAsync(Request(HttpMethod.Post, "/v1/print-test", new { printer = "Termica mostrador" }, withToken: false));
        Assert.Equal(HttpStatusCode.Forbidden, print.StatusCode);
        using var withToken = await _client.SendAsync(Request(HttpMethod.Get, "/v1/printers"));
        Assert.Equal(HttpStatusCode.OK, withToken.StatusCode);
        Assert.Empty(_transport.Sent);
    }

    [Fact]
    public async Task Un_host_ajeno_se_rechaza_aunque_traiga_token()
    {
        using var response = await _client.SendAsync(Request(HttpMethod.Get, "/v1/printers", host: "evil.example:17872"));
        Assert.Equal(HttpStatusCode.Forbidden, response.StatusCode);
        using var rebinding = await _client.SendAsync(Request(HttpMethod.Get, "/v1/health", withToken: false, host: "127.0.0.1.nip.io:17872"));
        Assert.Equal(HttpStatusCode.Forbidden, rebinding.StatusCode);
    }

    [Fact]
    public async Task El_preflight_de_chrome_para_red_local_se_contesta()
    {
        var request = Request(HttpMethod.Options, "/v1/print-test", withToken: false);
        request.Headers.Add("Access-Control-Request-Method", "POST");
        request.Headers.Add("Access-Control-Request-Private-Network", "true");
        using var response = await _client.SendAsync(request);
        Assert.Equal(HttpStatusCode.NoContent, response.StatusCode);
        Assert.Equal("true", response.Headers.GetValues("Access-Control-Allow-Private-Network").Single());
        Assert.Contains(LocalApiToken.HeaderName, response.Headers.GetValues("Access-Control-Allow-Headers").Single(), StringComparison.Ordinal);
    }

    [Fact]
    public async Task La_hoja_de_prueba_llega_a_la_impresora_elegida()
    {
        using var response = await _client.SendAsync(Request(HttpMethod.Post, "/v1/print-test", new { printer = "Termica mostrador", paper_width_mm = 58, code_page = "Pc850" }));
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        Assert.Contains("\"status\":\"SENT\"", await response.Content.ReadAsStringAsync(), StringComparison.Ordinal);
        var (printer, payload) = Assert.Single(_transport.Sent);
        Assert.Equal("Termica mostrador", printer);
        Assert.Equal(new byte[] { 0x1B, (byte)'@', 0x1B, (byte)'t', 2 }, payload[..5]);
    }

    [Fact]
    public async Task Una_prueba_con_un_ancho_raro_se_rechaza()
    {
        using var response = await _client.SendAsync(Request(HttpMethod.Post, "/v1/print-test", new { printer = "Termica mostrador", paper_width_mm = 76 }));
        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        Assert.Empty(_transport.Sent);
    }

    [Fact]
    public async Task Reimprimir_sin_registro_no_llega_al_backend()
    {
        using var response = await _client.SendAsync(Request(HttpMethod.Post, "/v1/reprint", new { job_id = Guid.NewGuid(), reason = "se mancho", idempotency_key = "agent-reprint-0001" }));
        Assert.Equal(HttpStatusCode.Conflict, response.StatusCode);
        Assert.Empty(_backend.Reprints);
    }

    [Fact]
    public async Task Reimprimir_queda_auditado_en_el_backend_con_motivo_y_operador()
    {
        _credentials.Save(new StoredCredential(new DeviceCredential(Guid.NewGuid(), DeviceCredential.NewSecret()), null, Guid.NewGuid(), "A", "Mostrador", DateTimeOffset.UtcNow));
        var job = Guid.NewGuid();
        using var response = await _client.SendAsync(Request(HttpMethod.Post, "/v1/reprint",
            new { job_id = job, reason = "  papel trabado ", operator_label = "Caja 1", idempotency_key = "agent-reprint-0001" }));
        Assert.Equal(HttpStatusCode.Accepted, response.StatusCode);
        var reprint = Assert.Single(_backend.Reprints);
        Assert.Equal((job, "papel trabado", "Caja 1", "agent-reprint-0001"), reprint);
        // La reimpresión se imprime cuando el backend la entrega como un trabajo NUEVO, no acá.
        Assert.Empty(_transport.Sent);
    }

    [Fact]
    public async Task Reimprimir_exige_un_motivo()
    {
        _credentials.Save(new StoredCredential(new DeviceCredential(Guid.NewGuid(), DeviceCredential.NewSecret()), null, Guid.NewGuid(), "A", "Mostrador", DateTimeOffset.UtcNow));
        using var response = await _client.SendAsync(Request(HttpMethod.Post, "/v1/reprint", new { job_id = Guid.NewGuid(), reason = "", idempotency_key = "agent-reprint-0002" }));
        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        Assert.Empty(_backend.Reprints);
    }

    [Fact]
    public async Task La_web_no_puede_mandar_documentos_crudos_a_la_impresora()
    {
        using var response = await _client.SendAsync(Request(HttpMethod.Post, "/v1/print-jobs", new { kind = "FiscalReceipt", payload = "JVBERi0=" }));
        Assert.True(response.StatusCode is HttpStatusCode.NotFound or HttpStatusCode.MethodNotAllowed);
        Assert.Empty(_transport.Sent);
    }
}
