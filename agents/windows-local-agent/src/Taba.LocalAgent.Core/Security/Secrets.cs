using System.Text.RegularExpressions;

namespace Taba.LocalAgent.Core.Security;

/// <summary>
/// Protección de secretos en disco (token de instalación, configuración). En
/// Windows la implementa DPAPI con alcance de máquina; nunca un JSON en claro.
/// </summary>
public interface ISecretProtector
{
    byte[] Protect(ReadOnlySpan<byte> secret);

    byte[] Unprotect(ReadOnlySpan<byte> protectedSecret);
}

/// <summary>
/// Saneo de todo lo que va a un log: credenciales de WSAA (token y sign), claves
/// PEM, cabeceras de autorización y el token del agente. Se aplica en el borde,
/// antes de escribir, no confiando en que nadie los loguee.
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
        result = XmlCredential().Replace(result, m => $"<{m.Groups["tag"].Value}>{Redacted}</{m.Groups["tag"].Value}>");
        result = HeaderCredential().Replace(result, m => $"{m.Groups["name"].Value}: {Redacted}");
        result = JsonCredential().Replace(result, m => $"\"{m.Groups["name"].Value}\":\"{Redacted}\"");
        return result;
    }

    [GeneratedRegex(@"-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----", RegexOptions.CultureInvariant)]
    private static partial Regex PemBlock();

    [GeneratedRegex(@"<(?<tag>(?:[A-Za-z]+:)?(?:token|sign|Token|Sign))>[^<]*</\k<tag>>", RegexOptions.CultureInvariant)]
    private static partial Regex XmlCredential();

    // El valor termina en el primer espacio (salvo el esquema «Bearer»/«Basic»):
    // lo que sigue en el mismo renglón no es parte de la credencial.
    [GeneratedRegex(@"(?<name>Authorization|X-Taba-Agent-Token)\s*:\s*(?:(?:Bearer|Basic)\s+)?\S+", RegexOptions.CultureInvariant | RegexOptions.IgnoreCase)]
    private static partial Regex HeaderCredential();

    [GeneratedRegex("\"(?<name>token|sign|password|privateKey|apiToken)\"\\s*:\\s*\"[^\"]*\"", RegexOptions.CultureInvariant | RegexOptions.IgnoreCase)]
    private static partial Regex JsonCredential();
}
