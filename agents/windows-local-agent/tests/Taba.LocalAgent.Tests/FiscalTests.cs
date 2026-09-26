using System.Security.Cryptography.Pkcs;
using System.Text;
using System.Xml.Linq;
using Taba.LocalAgent.Core.Fiscal;

namespace Taba.LocalAgent.Tests;

public sealed class WsaaTests
{
    [Fact]
    public void El_tra_tiene_los_campos_de_la_especificacion_y_una_ventana_corta()
    {
        var xml = LoginTicketRequest.Build("wsfe", ArcaFixtures.Now, 123456);
        var root = XDocument.Parse(xml).Root!;

        Assert.StartsWith("<?xml version=\"1.0\" encoding=\"UTF-8\"?>", xml, StringComparison.Ordinal);
        Assert.Equal("loginTicketRequest", root.Name.LocalName);
        Assert.Equal("1.0", root.Attribute("version")!.Value);
        Assert.Equal("123456", root.Element("header")!.Element("uniqueId")!.Value);
        Assert.Equal("wsfe", root.Element("service")!.Value);
        var generation = DateTimeOffset.Parse(root.Element("header")!.Element("generationTime")!.Value, System.Globalization.CultureInfo.InvariantCulture);
        var expiration = DateTimeOffset.Parse(root.Element("header")!.Element("expirationTime")!.Value, System.Globalization.CultureInfo.InvariantCulture);
        Assert.True(generation < ArcaFixtures.Now && expiration > ArcaFixtures.Now);
        Assert.True(expiration - generation <= TimeSpan.FromMinutes(15));
    }

    [Fact]
    public void Una_ventana_fuera_de_las_24_horas_de_tolerancia_no_se_arma()
    {
        Assert.Throws<ArgumentOutOfRangeException>(() => LoginTicketRequest.Build("wsfe", ArcaFixtures.Now, 1, lifetime: TimeSpan.FromHours(25)));
        Assert.Throws<ArgumentOutOfRangeException>(() => LoginTicketRequest.Build("wsfe", ArcaFixtures.Now, 1, backdate: TimeSpan.FromHours(25)));
    }

    [Fact]
    public void La_firma_cms_contiene_el_tra_y_el_certificado_y_verifica()
    {
        using var certificate = TestCertificate.Create();
        var tra = LoginTicketRequest.Build("wsfe", ArcaFixtures.Now, 7);

        var cmsBase64 = CmsLoginTicketSigner.SignToBase64(tra, certificate);

        var cms = new SignedCms();
        cms.Decode(Convert.FromBase64String(cmsBase64));
        cms.CheckSignature(verifySignatureOnly: true);
        Assert.Equal(tra, Encoding.UTF8.GetString(cms.ContentInfo.Content));
        var signerCertificate = Assert.Single(cms.Certificates);
        Assert.Equal(certificate.Thumbprint, signerCertificate.Thumbprint);
        Assert.Contains("CUIT 20000000001", signerCertificate.Subject, StringComparison.Ordinal);
    }

    [Fact]
    public void Sin_clave_privada_no_se_firma()
    {
        using var certificate = TestCertificate.Create();
        using var publicOnly = System.Security.Cryptography.X509Certificates.X509CertificateLoader.LoadCertificate(certificate.RawData);

        Assert.Throws<InvalidOperationException>(() => CmsLoginTicketSigner.SignToBase64("<x/>", publicOnly));
    }

    [Fact]
    public void La_respuesta_de_login_se_lee_y_nunca_se_imprime_el_token()
    {
        var ticket = WsaaSoap.ParseLoginResponse(ArcaFixtures.LoginResponse(ArcaFixtures.Now, ArcaFixtures.Now.AddHours(12)));

        Assert.Equal("TOKEN-SECRETO", ticket.Token);
        Assert.Equal(ArcaFixtures.Now.AddHours(12), ticket.ExpiresAt);
        Assert.DoesNotContain("TOKEN-SECRETO", ticket.ToString(), StringComparison.Ordinal);
        Assert.DoesNotContain("SIGN-SECRETO", ticket.ToString(), StringComparison.Ordinal);
    }

    [Fact]
    public void Un_fault_de_wsaa_trae_su_codigo_oficial()
    {
        const string Fault = "<soapenv:Envelope xmlns:soapenv=\"http://schemas.xmlsoap.org/soap/envelope/\"><soapenv:Body><soapenv:Fault><faultcode xmlns:ns1=\"http://xml.apache.org/axis/\">ns1:coe.alreadyAuthenticated</faultcode><faultstring>El CEE ya posee un TA valido</faultstring></soapenv:Fault></soapenv:Body></soapenv:Envelope>";

        var error = Assert.Throws<WsaaException>(() => WsaaSoap.ParseLoginResponse(Fault));
        Assert.Equal("coe.alreadyAuthenticated", error.Code);
    }

    [Fact]
    public void El_xml_con_dtd_se_rechaza()
    {
        const string Evil = "<?xml version=\"1.0\"?><!DOCTYPE x [<!ENTITY e SYSTEM \"file:///c:/windows/win.ini\">]><loginTicketResponse>&e;</loginTicketResponse>";
        Assert.ThrowsAny<System.Xml.XmlException>(() => SafeXml.Parse(Evil));
    }

    [Theory]
    [InlineData("coe.alreadyAuthenticated", WsaaRetryPolicy.ReuseExistingTicket)]
    [InlineData("wsaa.unavailable", WsaaRetryPolicy.RetryAfterOneMinute)]
    [InlineData("wsaa.internalError", WsaaRetryPolicy.RetryAfterOneMinute)]
    [InlineData("wsn.unavailable", WsaaRetryPolicy.RetryAfterOneMinute)]
    [InlineData("coe.notAuthorized", WsaaRetryPolicy.StopUntilFixed)]
    [InlineData("cms.cert.expired", WsaaRetryPolicy.StopUntilFixed)]
    [InlineData("xml.generationTime.invalid", WsaaRetryPolicy.StopUntilFixed)]
    public void Los_errores_de_wsaa_se_tratan_como_dice_la_especificacion(string code, WsaaRetryPolicy expected)
    {
        Assert.Equal(expected, WsaaErrors.Classify(code));
    }
}

public sealed class AccessTicketCacheTests
{
    [Fact]
    public async Task El_ta_se_reutiliza_mientras_es_valido_y_se_renueva_antes_de_vencer()
    {
        var clock = new ManualClock(ArcaFixtures.Now);
        using var cache = new AccessTicketCache(clock);
        var logins = 0;
        Task<AccessTicket> Login(CancellationToken _)
        {
            logins++;
            return Task.FromResult(ArcaFixtures.Ticket(clock.Now));
        }

        await cache.GetAsync("homologation|20000000001|wsfe", Login);
        clock.Advance(TimeSpan.FromHours(11));
        await cache.GetAsync("homologation|20000000001|wsfe", Login);
        Assert.Equal(1, logins);

        clock.Advance(TimeSpan.FromMinutes(56));
        await cache.GetAsync("homologation|20000000001|wsfe", Login);
        Assert.Equal(2, logins);
    }

    [Fact]
    public async Task Pedidos_concurrentes_comparten_una_sola_renovacion()
    {
        using var cache = new AccessTicketCache(new ManualClock(ArcaFixtures.Now));
        var logins = 0;
        async Task<AccessTicket> Login(CancellationToken cancellationToken)
        {
            Interlocked.Increment(ref logins);
            await Task.Delay(50, cancellationToken);
            return ArcaFixtures.Ticket();
        }

        await Task.WhenAll(Enumerable.Range(0, 8).Select(_ => cache.GetAsync("k", Login)));

        Assert.Equal(1, logins);
    }

    [Fact]
    public async Task Con_un_error_de_servicio_no_se_vuelve_a_pedir_antes_de_60_segundos()
    {
        var clock = new ManualClock(ArcaFixtures.Now);
        using var cache = new AccessTicketCache(clock);
        var logins = 0;
        Task<AccessTicket> Failing(CancellationToken _)
        {
            logins++;
            throw new WsaaException("wsaa.unavailable", "down");
        }

        await Assert.ThrowsAsync<WsaaException>(() => cache.GetAsync("k", Failing));
        await Assert.ThrowsAsync<WsaaException>(() => cache.GetAsync("k", Failing));
        Assert.Equal(1, logins);

        clock.Advance(TimeSpan.FromSeconds(61));
        await cache.GetAsync("k", _ => Task.FromResult(ArcaFixtures.Ticket(clock.Now)));
    }

    [Fact]
    public async Task Con_un_error_de_autorizacion_no_se_pide_mas_hasta_corregirlo()
    {
        var clock = new ManualClock(ArcaFixtures.Now);
        using var cache = new AccessTicketCache(clock);

        await Assert.ThrowsAsync<WsaaException>(() => cache.GetAsync("k", _ => throw new WsaaException("coe.notAuthorized", "sin relación")));
        clock.Advance(TimeSpan.FromHours(1));
        var blocked = await Assert.ThrowsAsync<WsaaException>(() => cache.GetAsync("k", _ => Task.FromResult(ArcaFixtures.Ticket())));
        Assert.Equal("coe.notAuthorized", blocked.Code);

        cache.ClearBlock("k");
        await cache.GetAsync("k", _ => Task.FromResult(ArcaFixtures.Ticket(clock.Now)));
    }
}

public sealed class WsfeTests
{
    [Fact]
    public void El_pedido_de_cae_lleva_la_condicion_del_receptor_en_el_orden_del_wsdl()
    {
        var envelope = WsfeSoap.FeCaeSolicitar(ArcaFixtures.Ticket(), ArcaFixtures.Invoice());
        var ns = (XNamespace)WsfeSoap.Namespace;
        var detail = XDocument.Parse(envelope).Descendants(ns + "FECAEDetRequest").Single();
        var names = detail.Elements().Select(e => e.Name.LocalName).ToList();

        Assert.Equal("5", detail.Element(ns + "CondicionIVAReceptorId")!.Value);
        Assert.True(names.IndexOf("MonCotiz") < names.IndexOf("CondicionIVAReceptorId"));
        Assert.True(names.IndexOf("CondicionIVAReceptorId") < names.IndexOf("Iva"));
        Assert.Equal("42", detail.Element(ns + "CbteDesde")!.Value);
        Assert.Equal("42", detail.Element(ns + "CbteHasta")!.Value);
        Assert.Equal("20260926", detail.Element(ns + "CbteFch")!.Value);
        Assert.Equal("12100.00", detail.Element(ns + "ImpTotal")!.Value);
        Assert.DoesNotContain("CAE", detail.Elements().Select(e => e.Name.LocalName));
    }

    [Fact]
    public void Sin_condicion_del_receptor_o_con_totales_que_no_cierran_no_se_manda_nada()
    {
        var invoice = ArcaFixtures.Invoice();
        var noCondition = Assert.Throws<ArgumentException>(() => WsfeSoap.FeCaeSolicitar(ArcaFixtures.Ticket(), invoice with { ReceiverVatConditionId = 0 }));
        Assert.Contains("RECEIVER_VAT_CONDITION_REQUIRED", noCondition.Message, StringComparison.Ordinal);
        var badTotal = Assert.Throws<ArgumentException>(() => WsfeSoap.FeCaeSolicitar(ArcaFixtures.Ticket(), invoice with { Total = 12000m }));
        Assert.Contains("TOTAL_MISMATCH", badTotal.Message, StringComparison.Ordinal);
        var services = Assert.Throws<ArgumentException>(() => WsfeSoap.FeCaeSolicitar(ArcaFixtures.Ticket(), invoice with { Concept = 2 }));
        Assert.Contains("SERVICE_DATES_REQUIRED", services.Message, StringComparison.Ordinal);
    }

    [Fact]
    public void Los_datos_del_comprador_no_pueden_inyectar_xml()
    {
        var ticket = new AccessTicket("a</ar:Token><ar:Evil>1</ar:Evil>", "s", ArcaFixtures.Now, ArcaFixtures.Now.AddHours(1));
        var envelope = WsfeSoap.FeCompConsultar(ticket, "20000000001", 6, 4, 42);

        Assert.Empty(XDocument.Parse(envelope).Descendants((XNamespace)WsfeSoap.Namespace + "Evil"));
    }

    [Fact]
    public void Una_aprobacion_trae_cae_y_vencimiento()
    {
        var result = WsfeResponses.ParseCaeResponse(ArcaFixtures.CaeApproved(42));

        Assert.Equal(CaeOutcome.Approved, result.Outcome);
        Assert.Equal("74123456789012", result.Cae);
        Assert.Equal(new DateOnly(2026, 10, 6), result.CaeExpiration);
        Assert.Equal(42, result.VoucherNumber);
    }

    [Fact]
    public void Un_rechazo_no_tiene_cae_y_conserva_la_observacion_oficial()
    {
        var result = WsfeResponses.ParseCaeResponse(ArcaFixtures.CaeRejected(42));

        Assert.Equal(CaeOutcome.Rejected, result.Outcome);
        Assert.Null(result.Cae);
        Assert.Contains(result.Observations, o => o.Code == 10246);
    }

    [Fact]
    public void Una_aprobacion_sin_cae_valido_es_un_error_y_no_un_cae_inventado()
    {
        Assert.Throws<FormatException>(() => WsfeResponses.ParseCaeResponse(ArcaFixtures.CaeApproved(42, cae: "123")));
    }

    [Fact]
    public void La_consulta_distingue_encontrado_de_inexistente()
    {
        var found = WsfeResponses.ParseConsultResponse(ArcaFixtures.Consulted(42));
        Assert.NotNull(found);
        Assert.Equal("74123456789012", found.Cae);
        Assert.Equal(12100m, found.Total);
        Assert.Null(WsfeResponses.ParseConsultResponse(ArcaFixtures.NotFound()));
        Assert.Equal(41, WsfeResponses.ParseLastAuthorized(ArcaFixtures.LastAuthorized(41)));
    }
}

public sealed class FiscalReconcilerTests
{
    [Fact]
    public void Si_arca_ya_lo_autorizo_se_recupera_el_cae_sin_reenviar()
    {
        var consulted = WsfeResponses.ParseConsultResponse(ArcaFixtures.Consulted(42));

        var result = FiscalReconciler.Decide(ArcaFixtures.Invoice(42), consulted, lastAuthorized: 42);

        Assert.Equal(ReconciliationDecision.RecoverAuthorized, result.Decision);
        Assert.Equal("74123456789012", result.Cae);
    }

    [Fact]
    public void Si_arca_no_lo_recibio_y_el_numero_sigue_libre_se_reenvia_el_mismo()
    {
        var result = FiscalReconciler.Decide(ArcaFixtures.Invoice(42), consulted: null, lastAuthorized: 41);

        Assert.Equal(ReconciliationDecision.ResendSameNumber, result.Decision);
    }

    [Fact]
    public void Si_el_numero_existe_con_otros_datos_se_frena_para_revision()
    {
        var consulted = WsfeResponses.ParseConsultResponse(ArcaFixtures.Consulted(42, total: 999m));

        var result = FiscalReconciler.Decide(ArcaFixtures.Invoice(42), consulted, lastAuthorized: 42);

        Assert.Equal(ReconciliationDecision.NeedsReconciliation, result.Decision);
        Assert.Equal("ARCA_RECONCILIATION_MISMATCH", result.Reason);
    }

    [Fact]
    public void Si_no_aparece_pero_el_numero_ya_se_uso_tampoco_se_reemite()
    {
        var result = FiscalReconciler.Decide(ArcaFixtures.Invoice(42), consulted: null, lastAuthorized: 42);

        Assert.Equal(ReconciliationDecision.NeedsReconciliation, result.Decision);
        Assert.Equal("NUMBER_ALREADY_USED", result.Reason);
    }
}

public sealed class ArcaGatewayTests : IDisposable
{
    private readonly FakeArcaTransport _transport = new();
    private readonly AccessTicketCache _cache = new(new ManualClock(ArcaFixtures.Now));

    public void Dispose() => _cache.Dispose();

    private ArcaGateway Gateway(ArcaEnvironment? environment = null, bool productionEnabled = false) =>
        new(environment ?? ArcaEnvironment.Homologation, _transport, new TestCertificates(), _cache, new ManualClock(ArcaFixtures.Now), productionEnabled);

    private void QueueLogin() =>
        _transport.Responses.Enqueue(() => ArcaFixtures.LoginResponse(ArcaFixtures.Now, ArcaFixtures.Now.AddHours(12)));

    [Fact]
    public async Task Camino_feliz_en_homologacion_con_los_endpoints_oficiales()
    {
        QueueLogin();
        _transport.Responses.Enqueue(() => ArcaFixtures.CaeApproved(42));

        var result = await Gateway().AuthorizeAsync(ArcaFixtures.Invoice(42));

        Assert.Equal(FiscalAuthorizationState.Authorized, result.State);
        Assert.Equal("74123456789012", result.Cae);
        Assert.Equal(new Uri("https://wsaahomo.afip.gov.ar/ws/services/LoginCms"), _transport.Calls[0].Endpoint);
        Assert.Equal(new Uri("https://wswhomo.afip.gov.ar/wsfev1/service.asmx"), _transport.Calls[1].Endpoint);
        Assert.Equal("http://ar.gov.afip.dif.FEV1/FECAESolicitar", _transport.Calls[1].Action);
    }

    [Fact]
    public async Task Un_timeout_despues_de_enviar_consulta_y_recupera_el_cae_sin_reemitir()
    {
        QueueLogin();
        _transport.Responses.Enqueue(() => throw new ArcaCommunicationException("TIMEOUT", mayHaveReachedArca: true));
        _transport.Responses.Enqueue(() => ArcaFixtures.Consulted(42));
        _transport.Responses.Enqueue(() => ArcaFixtures.LastAuthorized(42));

        var result = await Gateway().AuthorizeAsync(ArcaFixtures.Invoice(42));

        Assert.Equal(FiscalAuthorizationState.Authorized, result.State);
        Assert.Equal("RECOVERED_FROM_ARCA", result.Reason);
        Assert.Equal(1, _transport.Calls.Count(c => c.Action.EndsWith("FECAESolicitar", StringComparison.Ordinal)));
    }

    [Fact]
    public async Task Si_la_conexion_fallo_antes_de_enviar_se_reintenta_despues_sin_consultar()
    {
        QueueLogin();
        _transport.Responses.Enqueue(() => throw new ArcaCommunicationException("CONNECT_FAILED", mayHaveReachedArca: false));

        var result = await Gateway().AuthorizeAsync(ArcaFixtures.Invoice(42));

        Assert.Equal(FiscalAuthorizationState.RetryLater, result.State);
        Assert.Equal(2, _transport.Calls.Count);
    }

    [Fact]
    public async Task Si_tampoco_se_puede_consultar_queda_para_revision_y_no_se_reenvia()
    {
        QueueLogin();
        _transport.Responses.Enqueue(() => throw new ArcaCommunicationException("TIMEOUT", mayHaveReachedArca: true));
        _transport.Responses.Enqueue(() => throw new ArcaCommunicationException("TIMEOUT", mayHaveReachedArca: true));

        var result = await Gateway().AuthorizeAsync(ArcaFixtures.Invoice(42));

        Assert.Equal(FiscalAuthorizationState.NeedsReconciliation, result.State);
        Assert.Equal("AMBIGUOUS_UNRESOLVED", result.Reason);
    }

    [Fact]
    public async Task Un_rechazo_de_arca_es_rechazo_y_no_se_reintenta()
    {
        QueueLogin();
        _transport.Responses.Enqueue(() => ArcaFixtures.CaeRejected(42));

        var result = await Gateway().AuthorizeAsync(ArcaFixtures.Invoice(42));

        Assert.Equal(FiscalAuthorizationState.Rejected, result.State);
        Assert.Null(result.Cae);
    }

    [Fact]
    public async Task Produccion_esta_apagada_por_diseno()
    {
        var error = await Assert.ThrowsAsync<InvalidOperationException>(() => Gateway(ArcaEnvironment.Production).AuthorizeAsync(ArcaFixtures.Invoice(42)));

        Assert.Equal("ARCA_PRODUCTION_DISABLED_BY_DESIGN", error.Message);
        Assert.Empty(_transport.Calls);
    }

    [Fact]
    public async Task El_login_viaja_firmado_y_el_ta_se_reutiliza_entre_comprobantes()
    {
        QueueLogin();
        _transport.Responses.Enqueue(() => ArcaFixtures.CaeApproved(42));
        _transport.Responses.Enqueue(() => ArcaFixtures.CaeApproved(43, cae: "74123456789013"));
        var gateway = Gateway();

        await gateway.AuthorizeAsync(ArcaFixtures.Invoice(42));
        await gateway.AuthorizeAsync(ArcaFixtures.Invoice(43));

        var login = _transport.Calls[0].Envelope;
        var cms = XDocument.Parse(login).Descendants().Single(e => e.Name.LocalName == "in0").Value;
        var signed = new SignedCms();
        signed.Decode(Convert.FromBase64String(cms));
        signed.CheckSignature(verifySignatureOnly: true);
        Assert.Equal(1, _transport.Calls.Count(c => c.Endpoint.AbsolutePath.EndsWith("LoginCms", StringComparison.Ordinal)));
    }
}
