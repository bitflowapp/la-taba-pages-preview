using System.Security.AccessControl;
using System.Security.Cryptography;
using System.Security.Principal;
using System.Text;
using System.Text.Json;
using Taba.LocalAgent.Core.Security;

namespace Taba.LocalAgent.Windows;

/// <summary>
/// DPAPI con alcance de máquina: el servicio (que corre como LOCAL SERVICE, no
/// con el usuario del mostrador) puede leerlo, y copiar el archivo a otra PC no
/// sirve de nada. La carpeta de datos, además, sólo la leen SYSTEM,
/// Administradores y el servicio (<see cref="DataDirectory"/>).
/// </summary>
public sealed class DpapiSecretProtector(string purpose = "taba-local-agent:v1") : ISecretProtector
{
    private readonly byte[] _entropy = Encoding.UTF8.GetBytes(purpose);

    public byte[] Protect(ReadOnlySpan<byte> secret) =>
        ProtectedData.Protect(secret.ToArray(), _entropy, DataProtectionScope.LocalMachine);

    public byte[] Unprotect(ReadOnlySpan<byte> protectedSecret) =>
        ProtectedData.Unprotect(protectedSecret.ToArray(), _entropy, DataProtectionScope.LocalMachine);
}

/// <summary>
/// La credencial del dispositivo en disco: el JSON (con el secreto adentro)
/// viaja sólo como blob DPAPI. Nunca un archivo de configuración en claro.
/// </summary>
public sealed class ProtectedCredentialStore(string directory, ISecretProtector protector) : ICredentialStore
{
    public const string FileName = "device-credential.bin";
    private readonly string _path = Path.Combine(directory, FileName);
    private readonly object _gate = new();

    public StoredCredential? Load()
    {
        lock (_gate)
        {
            if (!File.Exists(_path))
            {
                return null;
            }

            var json = protector.Unprotect(File.ReadAllBytes(_path));
            try
            {
                return JsonSerializer.Deserialize<StoredCredential>(json);
            }
            finally
            {
                CryptographicOperations.ZeroMemory(json);
            }
        }
    }

    public void Save(StoredCredential credential)
    {
        ArgumentNullException.ThrowIfNull(credential);
        lock (_gate)
        {
            Directory.CreateDirectory(Path.GetDirectoryName(_path)!);
            var json = JsonSerializer.SerializeToUtf8Bytes(new StoredCredentialFile(credential));
            try
            {
                var temporary = _path + ".tmp";
                File.WriteAllBytes(temporary, protector.Protect(json));
                File.Move(temporary, _path, overwrite: true);
            }
            finally
            {
                CryptographicOperations.ZeroMemory(json);
            }
        }
    }

    public void Delete()
    {
        lock (_gate)
        {
            if (File.Exists(_path))
            {
                File.Delete(_path);
            }
        }
    }

    // DeviceCredential ignora BearerToken/SecretHash al serializar; el secreto sí
    // viaja, pero sólo dentro del blob DPAPI.
    private sealed record StoredCredentialFile(DeviceCredential Current, DeviceCredential? Pending, Guid BusinessId,
        string BusinessName, string DeviceName, DateTimeOffset RegisteredAt)
    {
        public StoredCredentialFile(StoredCredential c)
            : this(c.Current, c.Pending, c.BusinessId, c.BusinessName, c.DeviceName, c.RegisteredAt)
        {
        }
    }
}

/// <summary>
/// El token de la API local (127.0.0.1) se genera una vez y queda protegido con
/// DPAPI. Lo usan la CLI y, al emparejar, el Panel; ningún endpoint lo devuelve.
/// </summary>
public static class InstallationToken
{
    public const string FileName = "agent-token.bin";

    public static string LoadOrCreate(string directory, ISecretProtector protector)
    {
        ArgumentNullException.ThrowIfNull(protector);
        Directory.CreateDirectory(directory);
        var path = Path.Combine(directory, FileName);
        if (File.Exists(path))
        {
            return Encoding.UTF8.GetString(protector.Unprotect(File.ReadAllBytes(path)));
        }

        var token = LocalApiToken.Generate();
        var temporary = path + ".tmp";
        File.WriteAllBytes(temporary, protector.Protect(Encoding.UTF8.GetBytes(token)));
        File.Move(temporary, path, overwrite: true);
        return token;
    }
}

/// <summary>
/// %ProgramData%\TabaLocalAgent: diario, logs, configuración local y la
/// credencial protegida. Cuando la crea un administrador (instalador o CLI
/// elevada) queda con permisos cerrados: SYSTEM y Administradores control
/// total, LOCAL SERVICE modificar, nadie más.
/// </summary>
public static class DataDirectory
{
    public static string Default =>
        Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.CommonApplicationData), "TabaLocalAgent");

    public static bool IsElevated()
    {
        using var identity = WindowsIdentity.GetCurrent();
        return new WindowsPrincipal(identity).IsInRole(WindowsBuiltInRole.Administrator);
    }

    public static void Ensure(string path, bool harden)
    {
        var directory = Directory.CreateDirectory(path);
        if (!harden)
        {
            return;
        }

        var security = new DirectorySecurity();
        security.SetAccessRuleProtection(isProtected: true, preserveInheritance: false);
        const InheritanceFlags Inherit = InheritanceFlags.ContainerInherit | InheritanceFlags.ObjectInherit;
        security.AddAccessRule(new FileSystemAccessRule(new SecurityIdentifier(WellKnownSidType.LocalSystemSid, null),
            FileSystemRights.FullControl, Inherit, PropagationFlags.None, AccessControlType.Allow));
        security.AddAccessRule(new FileSystemAccessRule(new SecurityIdentifier(WellKnownSidType.BuiltinAdministratorsSid, null),
            FileSystemRights.FullControl, Inherit, PropagationFlags.None, AccessControlType.Allow));
        security.AddAccessRule(new FileSystemAccessRule(new SecurityIdentifier(WellKnownSidType.LocalServiceSid, null),
            FileSystemRights.Modify, Inherit, PropagationFlags.None, AccessControlType.Allow));
        security.SetOwner(new SecurityIdentifier(WellKnownSidType.BuiltinAdministratorsSid, null));
        directory.SetAccessControl(security);
    }
}
