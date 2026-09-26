using System.Globalization;
using System.Security.Cryptography.Pkcs;
using System.Security.Cryptography.X509Certificates;
using System.Text;
using System.Xml;
using System.Xml.Linq;

namespace Taba.LocalAgent.Core.Fiscal;

/// <summary>
/// Ambientes de ARCA con sus endpoints oficiales (especificación WSAA 1.2.2 y
/// manual WSFEv1 4.7). No se pueden cambiar por configuración: la lista es cerrada.
/// </summary>
public sealed record ArcaEnvironment(string Name, Uri WsaaLoginCms, Uri Wsfe)
{
    public static readonly ArcaEnvironment Homologation = new(
        "homologation",
        new Uri("https://wsaahomo.afip.gov.ar/ws/services/LoginCms"),
        new Uri("https://wswhomo.afip.gov.ar/wsfev1/service.asmx"));

    public static readonly ArcaEnvironment Production = new(
        "production",
        new Uri("https://wsaa.afip.gov.ar/ws/services/LoginCms"),
        new Uri("https://servicios1.afip.gov.ar/wsfev1/service.asmx"));
}

/// <summary>
/// El Ticket de Requerimiento de Acceso (TRA). ARCA acepta un
/// <c>generationTime</c> de hasta 24 h antes y un <c>expirationTime</c> de hasta
/// 24 h después; se usa una ventana corta alrededor de «ahora» para tolerar un
/// reloj algo corrido sin pedir más de lo necesario.
/// </summary>
public static class LoginTicketRequest
{
    public static readonly TimeSpan MaxWindow = TimeSpan.FromHours(24);

    public static string Build(string service, DateTimeOffset now, uint uniqueId, TimeSpan? backdate = null, TimeSpan? lifetime = null)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(service);
        var before = backdate ?? TimeSpan.FromMinutes(5);
        var after = lifetime ?? TimeSpan.FromMinutes(10);
        if (before < TimeSpan.Zero || before > MaxWindow || after <= TimeSpan.Zero || after > MaxWindow)
        {
            throw new ArgumentOutOfRangeException(nameof(lifetime), "TRA_WINDOW_OUT_OF_RANGE");
        }

        var document = new XDocument(
            new XDeclaration("1.0", "UTF-8", null),
            new XElement("loginTicketRequest",
                new XAttribute("version", "1.0"),
                new XElement("header",
                    new XElement("uniqueId", uniqueId.ToString(CultureInfo.InvariantCulture)),
                    new XElement("generationTime", Format(now - before)),
                    new XElement("expirationTime", Format(now + after))),
                new XElement("service", service)));
        return document.Declaration + document.Root!.ToString(SaveOptions.DisableFormatting);
    }

    private static string Format(DateTimeOffset value) => value.ToString("yyyy-MM-dd'T'HH:mm:sszzz", CultureInfo.InvariantCulture);
}

/// <summary>
/// Firma CMS/PKCS#7 SignedData del TRA con el certificado del sistema, que
/// viaja dentro del CMS. El resultado en Base64 es lo que recibe LoginCms. La
/// clave privada sólo existe en el almacén de certificados o en el secret
/// manager; este método nunca la exporta.
/// </summary>
public static class CmsLoginTicketSigner
{
    public static string SignToBase64(string traXml, X509Certificate2 certificate)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(traXml);
        ArgumentNullException.ThrowIfNull(certificate);
        if (!certificate.HasPrivateKey)
        {
            throw new InvalidOperationException("CERTIFICATE_WITHOUT_PRIVATE_KEY");
        }

        var content = new ContentInfo(Encoding.UTF8.GetBytes(traXml));
        var cms = new SignedCms(content, detached: false);
        var signer = new CmsSigner(SubjectIdentifierType.IssuerAndSerialNumber, certificate)
        {
            IncludeOption = X509IncludeOption.EndCertOnly,
        };
        cms.ComputeSignature(signer);
        return Convert.ToBase64String(cms.Encode());
    }
}

/// <summary>El Ticket de Acceso: token y sign, válidos 12 horas.</summary>
public sealed record AccessTicket(string Token, string Sign, DateTimeOffset GeneratedAt, DateTimeOffset ExpiresAt)
{
    public bool IsUsable(DateTimeOffset now, TimeSpan margin) => now + margin < ExpiresAt;

    /// <summary>Lee la respuesta de LoginCms rechazando DTD y entidades externas.</summary>
    public static AccessTicket Parse(string loginTicketResponseXml)
    {
        var root = SafeXml.Parse(loginTicketResponseXml).Root ?? throw new FormatException("TA_EMPTY");
        var header = root.Element("header") ?? throw new FormatException("TA_WITHOUT_HEADER");
        var credentials = root.Element("credentials") ?? throw new FormatException("TA_WITHOUT_CREDENTIALS");
        var token = credentials.Element("token")?.Value;
        var sign = credentials.Element("sign")?.Value;
        if (string.IsNullOrWhiteSpace(token) || string.IsNullOrWhiteSpace(sign))
        {
            throw new FormatException("TA_WITHOUT_CREDENTIALS");
        }

        return new AccessTicket(
            token,
            sign,
            DateTimeOffset.Parse(header.Element("generationTime")?.Value ?? throw new FormatException("TA_WITHOUT_GENERATION"), CultureInfo.InvariantCulture),
            DateTimeOffset.Parse(header.Element("expirationTime")?.Value ?? throw new FormatException("TA_WITHOUT_EXPIRATION"), CultureInfo.InvariantCulture));
    }

    // Nunca imprimir token ni sign, ni por accidente en un log.
    public override string ToString() => $"AccessTicket(expires {ExpiresAt:O})";
}

/// <summary>Un error de WSAA con su código oficial (por ejemplo <c>coe.alreadyAuthenticated</c>).</summary>
public sealed class WsaaException(string code, string message) : Exception(message)
{
    public string Code { get; } = code;
}

public enum WsaaRetryPolicy
{
    /// <summary>Ya hay un TA válido: usarlo y no pedir otro.</summary>
    ReuseExistingTicket,

    /// <summary>Servicio caído o error de ARCA: esperar 60 s antes de volver a pedir.</summary>
    RetryAfterOneMinute,

    /// <summary>Autorización, reloj, certificado o XML: no pedir más hasta corregirlo.</summary>
    StopUntilFixed,
}

public static class WsaaErrors
{
    /// <summary>
    /// Las reglas de la especificación: con errores que no son <c>wsaa.*</c> ni
    /// <c>wsn.unavailable</c> no se piden TA nuevos hasta resolver la causa; con el
    /// resto, no se vuelve a pedir durante 60 segundos.
    /// </summary>
    public static WsaaRetryPolicy Classify(string? code)
    {
        if (string.Equals(code, "coe.alreadyAuthenticated", StringComparison.Ordinal))
        {
            return WsaaRetryPolicy.ReuseExistingTicket;
        }

        if (code is not null && (code.StartsWith("wsaa.", StringComparison.Ordinal) || code == "wsn.unavailable"))
        {
            return WsaaRetryPolicy.RetryAfterOneMinute;
        }

        return WsaaRetryPolicy.StopUntilFixed;
    }
}

/// <summary>
/// Caché de TA por ambiente + CUIT + servicio. Una sola renovación a la vez
/// (las concurrentes esperan la misma), reutilización mientras sea válido y
/// respeto de las esperas oficiales ante errores.
/// </summary>
public sealed class AccessTicketCache(TimeProvider? clock = null) : IDisposable
{
    public static readonly TimeSpan RenewalMargin = TimeSpan.FromMinutes(5);
    public static readonly TimeSpan ErrorBackoff = TimeSpan.FromSeconds(60);

    private readonly TimeProvider _clock = clock ?? TimeProvider.System;
    private readonly SemaphoreSlim _gate = new(1, 1);
    private readonly Dictionary<string, AccessTicket> _tickets = new(StringComparer.Ordinal);
    private readonly Dictionary<string, (WsaaRetryPolicy Policy, DateTimeOffset At, string Code)> _blocks = new(StringComparer.Ordinal);

    public static string Key(ArcaEnvironment environment, string cuit, string service) => $"{environment.Name}|{cuit}|{service}";

    public async Task<AccessTicket> GetAsync(string key, Func<CancellationToken, Task<AccessTicket>> login, CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(login);
        await _gate.WaitAsync(cancellationToken).ConfigureAwait(false);
        try
        {
            var now = _clock.GetUtcNow();
            if (_tickets.TryGetValue(key, out var cached) && cached.IsUsable(now, RenewalMargin))
            {
                return cached;
            }

            if (_blocks.TryGetValue(key, out var block))
            {
                if (block.Policy == WsaaRetryPolicy.StopUntilFixed)
                {
                    throw new WsaaException(block.Code, "WSAA_BLOCKED_UNTIL_FIXED");
                }

                if (block.Policy == WsaaRetryPolicy.RetryAfterOneMinute && now - block.At < ErrorBackoff)
                {
                    throw new WsaaException(block.Code, "WSAA_BACKOFF");
                }
            }

            try
            {
                var ticket = await login(cancellationToken).ConfigureAwait(false);
                _tickets[key] = ticket;
                _blocks.Remove(key);
                return ticket;
            }
            catch (WsaaException error)
            {
                var policy = WsaaErrors.Classify(error.Code);
                if (policy == WsaaRetryPolicy.ReuseExistingTicket && cached is not null && now < cached.ExpiresAt)
                {
                    return cached;
                }

                _blocks[key] = (policy == WsaaRetryPolicy.ReuseExistingTicket ? WsaaRetryPolicy.RetryAfterOneMinute : policy, now, error.Code);
                throw;
            }
        }
        finally
        {
            _gate.Release();
        }
    }

    public void Dispose() => _gate.Dispose();

    /// <summary>La causa de un bloqueo permanente se corrigió (certificado, reloj, relación).</summary>
    public void ClearBlock(string key)
    {
        _gate.Wait();
        try
        {
            _blocks.Remove(key);
        }
        finally
        {
            _gate.Release();
        }
    }
}

/// <summary>XML de ARCA leído sin DTD ni resolución de entidades externas.</summary>
public static class SafeXml
{
    public static XDocument Parse(string xml)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(xml);
        var settings = new XmlReaderSettings
        {
            DtdProcessing = DtdProcessing.Prohibit,
            XmlResolver = null,
            MaxCharactersInDocument = 4 * 1024 * 1024,
        };
        using var reader = XmlReader.Create(new StringReader(xml), settings);
        return XDocument.Load(reader);
    }
}
