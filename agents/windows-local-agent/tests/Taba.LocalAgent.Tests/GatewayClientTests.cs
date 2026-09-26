using System.Net;
using System.Text;
using System.Text.Json;
using Taba.LocalAgent.Core.Backend;
using Taba.LocalAgent.Core.Documents;
using Taba.LocalAgent.Core.Security;

namespace Taba.LocalAgent.Tests;

/// <summary>El cliente de print-agent-gateway: qué manda, cómo lo manda y cómo traduce cada respuesta.</summary>
public sealed class GatewayClientTests
{
    private static readonly Uri Gateway = new("https://example.supabase.co/functions/v1/print-agent-gateway");

    private sealed class Handler(Func<HttpRequestMessage, string, HttpResponseMessage> respond) : HttpMessageHandler
    {
        public List<(HttpRequestMessage Request, string Body)> Requests { get; } = [];

        protected override async Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken)
        {
            var body = request.Content is null ? string.Empty : await request.Content.ReadAsStringAsync(cancellationToken);
            Requests.Add((request, body));
            return respond(request, body);
        }
    }

    private static HttpResponseMessage Json(HttpStatusCode status, string json) =>
        new(status) { Content = new StringContent(json, Encoding.UTF8, "application/json") };

    private static (GatewayBackendClient Client, Handler Handler) Client(Func<HttpRequestMessage, string, HttpResponseMessage> respond)
    {
        var handler = new Handler(respond);
        return (new GatewayBackendClient(new HttpClient(handler), Gateway, "sb_publishable_example"), handler);
    }

    private static readonly DeviceCredential Credential = new(Guid.Parse("0b2f5a4e-5c1d-4e1b-9f3a-7a1c2d3e4f50"), DeviceCredential.NewSecret());

    [Fact]
    public async Task La_credencial_viaja_en_authorization_y_la_clave_publica_en_apikey()
    {
        var (client, handler) = Client((_, _) => Json(HttpStatusCode.OK, """{"jobs":[],"poll_seconds":10}"""));
        await client.ClaimAsync(Credential, [DocumentType.KitchenTicket, DocumentType.FiscalReceipt], 3, CancellationToken.None);
        var (request, body) = handler.Requests.Single();
        Assert.Equal(HttpMethod.Post, request.Method);
        Assert.Equal(Gateway, request.RequestUri);
        Assert.Equal("Bearer", request.Headers.Authorization!.Scheme);
        Assert.Equal($"tla1.{Credential.DeviceId:D}.{Credential.Secret}", request.Headers.Authorization.Parameter);
        Assert.Equal("sb_publishable_example", request.Headers.GetValues("apikey").Single());
        using var json = JsonDocument.Parse(body);
        Assert.Equal("claim", json.RootElement.GetProperty("action").GetString());
        Assert.Equal(["kitchen_ticket", "fiscal_receipt"], json.RootElement.GetProperty("document_types").EnumerateArray().Select(e => e.GetString()));
    }

    [Fact]
    public async Task El_registro_no_manda_credencial_y_solo_el_hash_del_secreto()
    {
        var (client, handler) = Client((_, _) => Json(HttpStatusCode.OK,
            """{"device_id":"11111111-2222-4333-8444-555555555555","business_id":"b7000000-0000-4000-8000-000000000001","business_name":"A","device_name":"Mostrador"}"""));
        var hash = DeviceCredential.Hash("secreto");
        var result = await client.RegisterAsync("ABCDE-12345", hash, "Mostrador", CancellationToken.None);
        var (request, body) = handler.Requests.Single();
        Assert.Null(request.Headers.Authorization);
        Assert.Contains(hash, body, StringComparison.Ordinal);
        Assert.DoesNotContain("\"secreto\"", body, StringComparison.Ordinal);
        Assert.Equal(Guid.Parse("11111111-2222-4333-8444-555555555555"), result.DeviceId);
    }

    [Fact]
    public async Task Los_trabajos_reclamados_llegan_con_su_token_y_su_payload()
    {
        var (client, _) = Client((_, _) => Json(HttpStatusCode.OK, """
            {"jobs":[{"id":"c7000000-0000-4000-8000-000000000001","document_type":"order_ticket","payload":{"order":{"code":"X"}},
                      "payload_version":1,"claim_token":"d7000000-0000-4000-8000-000000000002","attempt":2,"reprint_of":null}],
             "poll_seconds":2}
            """));
        var claim = await client.ClaimAsync(Credential, [DocumentType.OrderTicket], 3, CancellationToken.None);
        var job = Assert.Single(claim.Jobs);
        Assert.Equal(DocumentType.OrderTicket, job.DocumentType);
        Assert.Equal(Guid.Parse("d7000000-0000-4000-8000-000000000002"), job.ClaimToken);
        Assert.Equal(2, job.Attempt);
        Assert.Null(job.ReprintOf);
        Assert.Equal("X", job.Payload.GetProperty("order").GetProperty("code").GetString());
        Assert.Equal(2, claim.PollSeconds);
    }

    [Theory]
    [InlineData(HttpStatusCode.Unauthorized, BackendErrorKind.Unauthorized)]
    [InlineData(HttpStatusCode.Forbidden, BackendErrorKind.Unauthorized)]
    [InlineData(HttpStatusCode.Conflict, BackendErrorKind.Conflict)]
    [InlineData(HttpStatusCode.NotFound, BackendErrorKind.NotFound)]
    [InlineData(HttpStatusCode.UnprocessableEntity, BackendErrorKind.NotAllowed)]
    [InlineData(HttpStatusCode.BadRequest, BackendErrorKind.Invalid)]
    [InlineData(HttpStatusCode.InternalServerError, BackendErrorKind.Unavailable)]
    [InlineData(HttpStatusCode.ServiceUnavailable, BackendErrorKind.Unavailable)]
    public async Task Cada_respuesta_se_traduce_a_una_decision(HttpStatusCode status, BackendErrorKind kind)
    {
        var (client, _) = Client((_, _) => Json(status, """{"code":"SOME_CODE"}"""));
        var error = await Assert.ThrowsAsync<BackendException>(() =>
            client.UpdateJobAsync(Credential, Guid.NewGuid(), Guid.NewGuid(), JobTransition.Printing, null, null, CancellationToken.None));
        Assert.Equal(kind, error.Kind);
        Assert.Equal("SOME_CODE", error.Code);
    }

    [Fact]
    public async Task Sin_red_el_backend_esta_no_disponible_y_no_se_filtra_nada()
    {
        var (client, _) = Client((_, _) => throw new HttpRequestException("dns: no such host tla1.secret"));
        var error = await Assert.ThrowsAsync<BackendException>(() => client.HeartbeatAsync(Credential,
            new HeartbeatReport("0.1.0", [], 0), CancellationToken.None));
        Assert.Equal(BackendErrorKind.Unavailable, error.Kind);
        Assert.Equal("BACKEND_UNREACHABLE", error.Code);
    }

    [Fact]
    public async Task Una_respuesta_rota_no_se_toma_como_exito()
    {
        var (client, _) = Client((_, _) => Json(HttpStatusCode.OK, "<html>proxy</html>"));
        var error = await Assert.ThrowsAsync<BackendException>(() => client.ClaimAsync(Credential, [DocumentType.OrderTicket], 1, CancellationToken.None));
        Assert.Equal(BackendErrorKind.Unavailable, error.Kind);
    }

    [Fact]
    public void Un_backend_por_http_publico_se_rechaza_de_entrada()
    {
        Assert.Throws<ArgumentException>(() => new GatewayBackendClient(new HttpClient(), new Uri("http://example.com/gateway"), null));
        _ = new GatewayBackendClient(new HttpClient(), new Uri("http://127.0.0.1:54321/functions/v1/print-agent-gateway"), null);
    }
}
