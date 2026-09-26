using System.Reflection;

namespace Taba.LocalAgent.Core;

/// <summary>Identidad del agente: nombre y versión SemVer (sin el sufijo de compilación).</summary>
public static class AgentInfo
{
    public const string Product = "Taba.LocalAgent";

    public static string Version { get; } = ReadVersion();

    /// <summary>La versión completa con el commit, para los logs.</summary>
    public static string InformationalVersion { get; } =
        typeof(AgentInfo).Assembly.GetCustomAttribute<AssemblyInformationalVersionAttribute>()?.InformationalVersion ?? "0.0.0";

    private static string ReadVersion()
    {
        var informational = typeof(AgentInfo).Assembly.GetCustomAttribute<AssemblyInformationalVersionAttribute>()?.InformationalVersion;
        if (string.IsNullOrWhiteSpace(informational))
        {
            return "0.0.0";
        }

        var plus = informational.IndexOf('+', StringComparison.Ordinal);
        return plus < 0 ? informational : informational[..plus];
    }
}
