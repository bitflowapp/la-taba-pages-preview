$ErrorActionPreference = 'Stop'
$secretInput = Read-Host 'Nuevo client secret de La Taba Delivery (entrada oculta; no pegarlo en el chat)' -AsSecureString
$secretPointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secretInput)
try {
    $start = [Diagnostics.ProcessStartInfo]::new()
    $start.FileName = 'node'
    $start.ArgumentList.Add((Join-Path $PSScriptRoot 'actualizar-client-secret-produccion.mjs'))
    $start.ArgumentList.Add('wwcpogltfgzgkrlilbcd')
    $start.UseShellExecute = $false
    $start.CreateNoWindow = $true
    $start.RedirectStandardInput = $true
    $process = [Diagnostics.Process]::Start($start)
    $process.StandardInput.Write([Runtime.InteropServices.Marshal]::PtrToStringBSTR($secretPointer))
    $process.StandardInput.Close()
    $process.WaitForExit()
    if ($process.ExitCode -ne 0) { throw 'No se pudo actualizar el secreto. No se desconectó al seller.' }
} finally {
    [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($secretPointer)
    $secretInput.Dispose()
}
