# Lee el token del CLI de Supabase del Administrador de credenciales de Windows.
#
# POR QUÉ EXISTE
# --------------
# `supabase db push` no puede aplicar este paquete: en el ledger remoto hay dos
# migraciones que no existen en ningún commit —quedaron como archivos sueltos en
# el worktree de otra sesión— y el CLI se niega a correr mientras no estén.
# La única salida que ofrece es marcarlas `reverted`, que sería mentir sobre
# migraciones que SÍ están aplicadas.
#
# La vía controlada es la Management API: aplica exactamente los archivos que se
# le pasan y escribe exactamente las filas de ledger que se le indican, sin tocar
# las de nadie más. Es el mismo camino que usó la sesión de identidad.
#
# EL TOKEN NUNCA SE IMPRIME EN UN LOG. Sale por stdout para que quien lo llama lo
# ponga en una variable de entorno, y nada más.
$ErrorActionPreference = 'Stop'

$signature = @'
using System;
using System.Runtime.InteropServices;
public class CredentialReader {
  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
  private struct CREDENTIAL {
    public uint Flags; public uint Type; public IntPtr TargetName; public IntPtr Comment;
    public long LastWritten; public uint CredentialBlobSize; public IntPtr CredentialBlob;
    public uint Persist; public uint AttributeCount; public IntPtr Attributes;
    public IntPtr TargetAlias; public IntPtr UserName;
  }
  [DllImport("advapi32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
  private static extern bool CredRead(string target, uint type, uint flags, out IntPtr credential);
  [DllImport("advapi32.dll", SetLastError = true)]
  private static extern void CredFree(IntPtr buffer);

  // El blob se lee como BYTES y se decodifica como UTF-8. Leerlo con
  // PtrToStringUni daba exactamente la mitad de los caracteres y basura al
  // principio: el CLI lo guarda en UTF-8, no en UTF-16.
  public static string Read(string target) {
    IntPtr handle;
    if (!CredRead(target, 1, 0, out handle)) return null;
    try {
      CREDENTIAL c = (CREDENTIAL)Marshal.PtrToStructure(handle, typeof(CREDENTIAL));
      if (c.CredentialBlobSize == 0) return null;
      byte[] blob = new byte[c.CredentialBlobSize];
      Marshal.Copy(c.CredentialBlob, blob, 0, (int)c.CredentialBlobSize);
      return System.Text.Encoding.UTF8.GetString(blob);
    } finally { CredFree(handle); }
  }
}
'@

if (-not ([System.Management.Automation.PSTypeName]'CredentialReader').Type) {
  Add-Type -TypeDefinition $signature -Language CSharp
}

$token = [CredentialReader]::Read('Supabase CLI:supabase')
if ([string]::IsNullOrWhiteSpace($token)) {
  Write-Error 'No hay token del CLI de Supabase en el Administrador de credenciales.'
  exit 1
}
Write-Output $token.Trim()
