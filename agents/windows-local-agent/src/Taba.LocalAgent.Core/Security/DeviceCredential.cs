using System.Security.Cryptography;
using System.Text;
using System.Text.Json.Serialization;

namespace Taba.LocalAgent.Core.Security;

/// <summary>
/// La credencial de ESTA instalación: device_id + un secreto de 32 bytes que
/// genera el propio agente. Al backend viaja «tla1.&lt;device_id&gt;.&lt;secreto&gt;»;
/// la base guarda sólo el SHA-256 del secreto. Nunca se imprime ni se loguea.
/// </summary>
public sealed record DeviceCredential(Guid DeviceId, string Secret)
{
    public const string Prefix = "tla1";

    [JsonIgnore]
    public string BearerToken => $"{Prefix}.{DeviceId:D}.{Secret}";

    [JsonIgnore]
    public string SecretHash => Hash(Secret);

    public static string NewSecret() =>
        Convert.ToBase64String(RandomNumberGenerator.GetBytes(32)).TrimEnd('=').Replace('+', '-').Replace('/', '_');

    public static string Hash(string secret)
    {
        ArgumentNullException.ThrowIfNull(secret);
        return Convert.ToHexStringLower(SHA256.HashData(Encoding.UTF8.GetBytes(secret)));
    }

    /// <summary>Nunca el secreto: ni en logs, ni en excepciones, ni en el depurador.</summary>
    public override string ToString() => $"DeviceCredential {{ DeviceId = {DeviceId:D}, Secret = *** }}";
}

/// <summary>Lo que el agente guarda protegido en disco. El secreto va dentro del blob DPAPI.</summary>
public sealed record StoredCredential(
    DeviceCredential Current,
    DeviceCredential? Pending,
    Guid BusinessId,
    string BusinessName,
    string DeviceName,
    DateTimeOffset RegisteredAt);

/// <summary>Custodia de la credencial. En Windows: DPAPI + ACL de la carpeta de datos.</summary>
public interface ICredentialStore
{
    StoredCredential? Load();

    void Save(StoredCredential credential);

    void Delete();
}

/// <summary>Custodia en memoria para pruebas.</summary>
public sealed class InMemoryCredentialStore : ICredentialStore
{
    private StoredCredential? _credential;

    public StoredCredential? Load() => _credential;

    public void Save(StoredCredential credential) => _credential = credential;

    public void Delete() => _credential = null;
}
