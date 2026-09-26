using System.Security.Cryptography;
using System.Security.Cryptography.X509Certificates;
using Taba.LocalAgent.Core.Fiscal;

namespace Taba.LocalAgent.Tests;

/// <summary>ARCA de mentira: responde con los sobres que se le programen, o corta la comunicación.</summary>
internal sealed class FakeArcaTransport : IArcaTransport
{
    public List<(Uri Endpoint, string Action, string Envelope)> Calls { get; } = [];

    public Queue<Func<string>> Responses { get; } = new();

    public Task<string> PostAsync(Uri endpoint, string soapAction, string envelope, CancellationToken cancellationToken)
    {
        Calls.Add((endpoint, soapAction, envelope));
        if (Responses.Count == 0)
        {
            throw new InvalidOperationException("UNEXPECTED_ARCA_CALL");
        }

        return Task.FromResult(Responses.Dequeue()());
    }
}

internal sealed class TestCertificates : IArcaCertificateSource
{
    private readonly byte[] _pfx;

    public TestCertificates()
    {
        _pfx = TestCertificate.CreatePfx();
    }

    public X509Certificate2 GetSigningCertificate(string cuit) =>
        X509CertificateLoader.LoadPkcs12(_pfx, "test", X509KeyStorageFlags.EphemeralKeySet);
}

internal static class TestCertificate
{
    /// <summary>
    /// Certificado autofirmado con el DN que pide ARCA (serialNumber «CUIT n»,
    /// CN, O, C). Es sólo para probar la firma CMS: ARCA no lo aceptaría.
    /// </summary>
    public static X509Certificate2 Create() =>
        X509CertificateLoader.LoadPkcs12(CreatePfx(), "test", X509KeyStorageFlags.EphemeralKeySet);

    public static byte[] CreatePfx()
    {
        var name = new X500DistinguishedNameBuilder();
        name.AddCountryOrRegion("AR");
        name.AddOrganizationName("Taba Test");
        name.AddCommonName("taba-local-agent-test");
        name.Add("2.5.4.5", "CUIT 20000000001");
        using var key = RSA.Create(2048);
        var request = new CertificateRequest(name.Build(), key, HashAlgorithmName.SHA256, RSASignaturePadding.Pkcs1);
        using var selfSigned = request.CreateSelfSigned(DateTimeOffset.UtcNow.AddMinutes(-5), DateTimeOffset.UtcNow.AddDays(30));
        return selfSigned.Export(X509ContentType.Pfx, "test");
    }
}

internal static class ArcaFixtures
{
    public static readonly DateTimeOffset Now = new(2026, 9, 26, 12, 0, 0, TimeSpan.FromHours(-3));

    public static AccessTicket Ticket(DateTimeOffset? now = null)
    {
        var at = now ?? Now;
        return new AccessTicket("TOKEN-SECRETO", "SIGN-SECRETO", at, at.AddHours(12));
    }

    public static WsfeInvoiceRequest Invoice(long number = 42) => new()
    {
        IssuerCuit = "20000000001",
        PointOfSale = 4,
        VoucherType = 6,
        Concept = 1,
        RecipientDocType = 99,
        RecipientDocNumber = 0,
        VoucherNumber = number,
        IssueDate = new DateOnly(2026, 9, 26),
        Total = 12100m,
        Net = 10000m,
        Vat = 2100m,
        ReceiverVatConditionId = 5,
        VatLines = [new VatLine(5, 10000m, 2100m)],
    };

    public static string LoginResponse(DateTimeOffset generated, DateTimeOffset expires) =>
        "<soapenv:Envelope xmlns:soapenv=\"http://schemas.xmlsoap.org/soap/envelope/\"><soapenv:Body>"
        + "<loginCmsResponse xmlns=\"http://wsaa.view.sua.dvadac.desein.afip.gov\"><loginCmsReturn>"
        + System.Security.SecurityElement.Escape(
            $"<?xml version=\"1.0\" encoding=\"UTF-8\"?><loginTicketResponse version=\"1.0\"><header><source>CN=wsaahomo</source><destination>SERIALNUMBER=CUIT 20000000001</destination><uniqueId>1</uniqueId><generationTime>{generated:yyyy-MM-ddTHH:mm:sszzz}</generationTime><expirationTime>{expires:yyyy-MM-ddTHH:mm:sszzz}</expirationTime></header><credentials><token>TOKEN-SECRETO</token><sign>SIGN-SECRETO</sign></credentials></loginTicketResponse>")
        + "</loginCmsReturn></loginCmsResponse></soapenv:Body></soapenv:Envelope>";

    public static string CaeApproved(long number, string cae = "74123456789012") =>
        Wrap("FECAESolicitarResponse", "FECAESolicitarResult",
            "<FeCabResp><Cuit>20000000001</Cuit><PtoVta>4</PtoVta><CbteTipo>6</CbteTipo><FchProceso>20260926</FchProceso><CantReg>1</CantReg><Resultado>A</Resultado><Reproceso>N</Reproceso></FeCabResp>"
            + $"<FeDetResp><FEDetResponse><Concepto>1</Concepto><DocTipo>99</DocTipo><DocNro>0</DocNro><CbteDesde>{number}</CbteDesde><CbteHasta>{number}</CbteHasta><Resultado>A</Resultado><CAE>{cae}</CAE><CbteFch>20260926</CbteFch><CAEFchVto>20261006</CAEFchVto></FEDetResponse></FeDetResp>");

    public static string CaeRejected(long number) =>
        Wrap("FECAESolicitarResponse", "FECAESolicitarResult",
            "<FeCabResp><Resultado>R</Resultado></FeCabResp>"
            + $"<FeDetResp><FEDetResponse><CbteDesde>{number}</CbteDesde><CbteHasta>{number}</CbteHasta><Resultado>R</Resultado><CAE></CAE><Obs><Observaciones><Code>10246</Code><Msg>Campo Condicion Frente al IVA del receptor es obligatorio</Msg></Observaciones></Obs></FEDetResponse></FeDetResp>");

    public static string Consulted(long number, decimal total = 12100m, string cae = "74123456789012") =>
        Wrap("FECompConsultarResponse", "FECompConsultarResult",
            $"<ResultGet><Concepto>1</Concepto><DocTipo>99</DocTipo><DocNro>0</DocNro><CbteDesde>{number}</CbteDesde><CbteHasta>{number}</CbteHasta><CbteFch>20260926</CbteFch><ImpTotal>{total.ToString(System.Globalization.CultureInfo.InvariantCulture)}</ImpTotal><MonId>PES</MonId><MonCotiz>1</MonCotiz><Resultado>A</Resultado><CodAutorizacion>{cae}</CodAutorizacion><EmisionTipo>CAE</EmisionTipo><FchVto>20261006</FchVto><FchProceso>20260926</FchProceso><PtoVta>4</PtoVta><CbteTipo>6</CbteTipo></ResultGet>");

    public static string NotFound() =>
        Wrap("FECompConsultarResponse", "FECompConsultarResult", "<Errors><Err><Code>602</Code><Msg>No existen datos en nuestros registros.</Msg></Err></Errors>");

    public static string LastAuthorized(long number) =>
        Wrap("FECompUltimoAutorizadoResponse", "FECompUltimoAutorizadoResult", $"<PtoVta>4</PtoVta><CbteTipo>6</CbteTipo><CbteNro>{number}</CbteNro>");

    private static string Wrap(string response, string result, string inner) =>
        "<soap:Envelope xmlns:soap=\"http://schemas.xmlsoap.org/soap/envelope/\"><soap:Body>"
        + $"<{response} xmlns=\"http://ar.gov.afip.dif.FEV1/\"><{result}>{inner}</{result}></{response}>"
        + "</soap:Body></soap:Envelope>";
}
