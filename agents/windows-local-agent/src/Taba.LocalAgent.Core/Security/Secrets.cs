using System.Text.RegularExpressions;

namespace Taba.LocalAgent.Core.Security;

/// <summary>
/// Protección de secretos en disco (token de la API local, credencial del
/// dispositivo). En Windows la implementa DPAPI con alcance de máquina; nunca
/// un JSON en claro.
/// </summary>
public interface ISecretProtector
{
    byte[] Protect(ReadOnlySpan<byte> secret);

    byte[] Unprotect(ReadOnlySpan<byte> protectedSecret);
}

/// <summary>
/// Saneo de todo lo que va a un log: la credencial del dispositivo
/// («tla1.&lt;id&gt;.&lt;secreto&gt;»), hashes de secretos, claves PEM, cabeceras de
/// autorización y el token de la API local. Se aplica en el borde, antes de
/// escribir, sin confiar en que nadie los loguee.
/// </summary>
public static partial class LogSanitizer
{
    private const string Redacted = "[redacted]";

    public static string Sanitize(string? text)
    {
        if (string.IsNullOrEmpty(text))
        {
            return string.Empty;
        }

        var result = PemBlock().Replace(text, Redacted);
        result = DeviceToken().Replace(result, m => $"{DeviceCredential.Prefix}.{m.Groups["id"].Value}.{Redacted}");
        result = XmlCredential().Replace(result, m => $"<{m.Groups["tag"].Value}>{Redacted}</{m.Groups["tag"].Value}>");
        result = HeaderCredential().Replace(result, m => $"{m.Groups["name"].Value}: {Redacted}");
        result = JsonCredential().Replace(result, m => $"\"{m.Groups["name"].Value}\":\"{Redacted}\"");
        return result;
    }

    [GeneratedRegex(@"-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----", RegexOptions.CultureInvariant)]
    private static partial Regex PemBlock();

    [GeneratedRegex(@"tla1\.(?<id>[0-9a-fA-F-]{36})\.[A-Za-z0-9_-]+", RegexOptions.CultureInvariant)]
    private static partial Regex DeviceToken();

    [GeneratedRegex(@"<(?<tag>(?:[A-Za-z]+:)?(?:token|sign|Token|Sign))>[^<]*</\k<tag>>", RegexOptions.CultureInvariant)]
    private static partial Regex XmlCredential();

    // El valor termina en el primer espacio (salvo el esquema «Bearer»/«Basic»):
    // lo que sigue en el mismo renglón no es parte de la credencial.
    [GeneratedRegex(@"(?<name>Authorization|X-Taba-Agent-Token|apikey)\s*:\s*(?:(?:Bearer|Basic)\s+)?\S+", RegexOptions.CultureInvariant | RegexOptions.IgnoreCase)]
    private static partial Regex HeaderCredential();

    [GeneratedRegex("\"(?<name>token|sign|password|privateKey|apiToken|secret|secret_hash|new_secret_hash|pairing_code)\"\\s*:\\s*\"[^\"]*\"", RegexOptions.CultureInvariant | RegexOptions.IgnoreCase)]
    private static partial Regex JsonCredential();
}
