using System.Runtime.Versioning;
using System.Security.Cryptography;
using Taba.LocalAgent.Core.Security;

namespace Taba.LocalAgent.Windows;

/// <summary>
/// DPAPI con alcance de máquina: el servicio (que no corre con el usuario del
/// mostrador) puede leerlo, y copiar el archivo a otra PC no sirve de nada.
/// </summary>
[SupportedOSPlatform("windows")]
public sealed class DpapiSecretProtector : ISecretProtector
{
    private static readonly byte[] Entropy = "taba-local-agent:v1"u8.ToArray();

    public byte[] Protect(ReadOnlySpan<byte> secret) =>
        ProtectedData.Protect(secret.ToArray(), Entropy, DataProtectionScope.LocalMachine);

    public byte[] Unprotect(ReadOnlySpan<byte> protectedSecret) =>
        ProtectedData.Unprotect(protectedSecret.ToArray(), Entropy, DataProtectionScope.LocalMachine);
}
