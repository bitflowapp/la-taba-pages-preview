$ErrorActionPreference = 'Stop'
$taskSecret = Read-Host 'Pega SOLO el Webhook Secret de TABA2 Staging (entrada oculta)' -AsSecureString
$taskProcess = $null
try {
  $taskStart = New-Object System.Diagnostics.ProcessStartInfo
  $taskStart.FileName = (Get-Command node -ErrorAction Stop).Source
  $taskStart.Arguments = '"' + (Join-Path $PSScriptRoot 'configurar-webhook-staging.mjs') + '"'
  $taskStart.UseShellExecute = $false
  $taskStart.CreateNoWindow = $true
  $taskStart.RedirectStandardInput = $true
  $taskProcess = [System.Diagnostics.Process]::Start($taskStart)
  $taskProcess.StandardInput.Write([System.Net.NetworkCredential]::new('', $taskSecret).Password)
  $taskProcess.StandardInput.Close()
  $taskProcess.WaitForExit()
  if ($taskProcess.ExitCode -ne 0) { throw 'La configuracion no termino; no se mostro el secreto.' }
} finally {
  $taskSecret.Dispose()
  if ($null -ne $taskProcess) { $taskProcess.Dispose() }
}
