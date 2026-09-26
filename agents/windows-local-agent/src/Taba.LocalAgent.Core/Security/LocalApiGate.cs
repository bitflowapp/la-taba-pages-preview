using System.Security.Cryptography;
using System.Text;

namespace Taba.LocalAgent.Core.Security;

/// <summary>
/// Lista blanca de orígenes. Compara el origen completo —esquema, host y
/// puerto— contra una lista exacta: sin comodines, sin subdominios, sin «null».
/// Cualquier web del mundo puede intentar hablarle a localhost; sólo el Panel
/// de La Taba puede lograrlo.
/// </summary>
public sealed class OriginPolicy
{
    private readonly HashSet<string> _allowed;

    public OriginPolicy(IEnumerable<string> allowedOrigins)
    {
        ArgumentNullException.ThrowIfNull(allowedOrigins);
        _allowed = new HashSet<string>(StringComparer.Ordinal);
        foreach (var origin in allowedOrigins)
        {
            var normalized = Normalize(origin) ?? throw new ArgumentException($"ORIGIN_INVALID: {origin}", nameof(allowedOrigins));
            if (normalized.StartsWith("http://", StringComparison.Ordinal) && !IsLoopbackOrigin(normalized))
            {
                throw new ArgumentException("ORIGIN_MUST_BE_HTTPS", nameof(allowedOrigins));
            }

            _allowed.Add(normalized);
        }
    }

    public bool IsAllowed(string? origin)
    {
        var normalized = Normalize(origin);
        return normalized is not null && _allowed.Contains(normalized);
    }

    /// <summary>Origen canónico «esquema://host[:puerto]» en minúsculas, o null si no es un origen.</summary>
    public static string? Normalize(string? origin)
    {
        if (string.IsNullOrWhiteSpace(origin) || string.Equals(origin.Trim(), "null", StringComparison.OrdinalIgnoreCase))
        {
            return null;
        }

        if (!Uri.TryCreate(origin.Trim(), UriKind.Absolute, out var uri)
            || (uri.Scheme != Uri.UriSchemeHttps && uri.Scheme != Uri.UriSchemeHttp)
            || !string.IsNullOrEmpty(uri.UserInfo)
            || uri.PathAndQuery is not ("/" or "")
            || !string.IsNullOrEmpty(uri.Fragment))
        {
            return null;
        }

        var port = uri.IsDefaultPort ? string.Empty : $":{uri.Port}";
        return $"{uri.Scheme}://{uri.IdnHost.ToLowerInvariant()}{port}";
    }

    private static bool IsLoopbackOrigin(string normalized) =>
        normalized.StartsWith("http://localhost", StringComparison.Ordinal)
        || normalized.StartsWith("http://127.0.0.1", StringComparison.Ordinal);
}

/// <summary>El token de instalación: 32 bytes aleatorios, comparados en tiempo constante.</summary>
public static class LocalApiToken
{
    public const string HeaderName = "X-Taba-Agent-Token";

    public static string Generate() => Base64Url(RandomNumberGenerator.GetBytes(32));

    public static bool Verify(string? presented, string expected)
    {
        if (string.IsNullOrEmpty(presented) || string.IsNullOrEmpty(expected))
        {
            return false;
        }

        return CryptographicOperations.FixedTimeEquals(Encoding.UTF8.GetBytes(presented), Encoding.UTF8.GetBytes(expected));
    }

    private static string Base64Url(byte[] bytes) =>
        Convert.ToBase64String(bytes).TrimEnd('=').Replace('+', '-').Replace('/', '_');
}

public enum GateDecision
{
    Allowed,
    RejectedHost,
    RejectedOrigin,
    RejectedToken,
}

/// <summary>Lo que hace falta saber de un pedido para decidir si entra.</summary>
public sealed record LocalApiRequest(string Host, string? Origin, string? Token, bool IsHealthProbe);

/// <summary>
/// La puerta de la API local, en tres controles y en este orden:
///  1. Host: sólo 127.0.0.1 o localhost con el puerto del agente. Frena el
///     «DNS rebinding»: un dominio ajeno que resuelve a 127.0.0.1 llega con su
///     propio nombre en Host.
///  2. Origin: si viene de un navegador, tiene que estar en la lista blanca.
///  3. Token de instalación: siempre, salvo en /health, que no devuelve nada sensible.
/// </summary>
public sealed class LocalApiGate(OriginPolicy origins, string token, int port)
{
    public GateDecision Evaluate(LocalApiRequest request)
    {
        ArgumentNullException.ThrowIfNull(request);
        if (!IsLoopbackHost(request.Host))
        {
            return GateDecision.RejectedHost;
        }

        if (request.Origin is not null && !origins.IsAllowed(request.Origin))
        {
            return GateDecision.RejectedOrigin;
        }

        if (request.IsHealthProbe)
        {
            return GateDecision.Allowed;
        }

        return LocalApiToken.Verify(request.Token, token) ? GateDecision.Allowed : GateDecision.RejectedToken;
    }

    public bool IsLoopbackHost(string? host) =>
        string.Equals(host, $"127.0.0.1:{port}", StringComparison.OrdinalIgnoreCase)
        || string.Equals(host, $"localhost:{port}", StringComparison.OrdinalIgnoreCase);
}
