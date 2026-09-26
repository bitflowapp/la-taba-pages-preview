using System.Text;
using Taba.LocalAgent.Core.Security;

namespace Taba.LocalAgent;

/// <summary>Configuración del agente. Ningún secreto vive acá: el token está protegido aparte.</summary>
public sealed class AgentOptions
{
    public const string Section = "Agent";

    /// <summary>Puerto local. Sólo se escucha en 127.0.0.1.</summary>
    public int Port { get; set; } = 17872;

    /// <summary>Orígenes exactos del Panel que pueden hablarle al agente.</summary>
    public List<string> AllowedOrigins { get; set; } = [];

    /// <summary>Carpeta de datos (cola y token protegido). Por defecto, %ProgramData%\TabaLocalAgent.</summary>
    public string? DataDirectory { get; set; }

    public string ResolveDataDirectory() =>
        string.IsNullOrWhiteSpace(DataDirectory)
            ? Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.CommonApplicationData), "TabaLocalAgent")
            : DataDirectory;
}

/// <summary>
/// El token de instalación se genera una vez y queda protegido en disco. Se
/// entrega al Panel una sola vez, durante el emparejamiento; no hay endpoint
/// que lo devuelva.
/// </summary>
public static class InstallationToken
{
    public static string LoadOrCreate(string directory, ISecretProtector protector)
    {
        ArgumentNullException.ThrowIfNull(protector);
        Directory.CreateDirectory(directory);
        var path = Path.Combine(directory, "agent-token.bin");
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
