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
  $taskStart.RedirectStandardOutput = $true
  $taskStart.RedirectStandardError = $true
  $taskProcess = [System.Diagnostics.Process]::Start($taskStart)
  $taskOutput = $taskProcess.StandardOutput.ReadToEndAsync()
  $taskError = $taskProcess.StandardError.ReadToEndAsync()
  $taskProcess.StandardInput.Write([System.Net.NetworkCredential]::new('', $taskSecret).Password)
  $taskProcess.StandardInput.Close()
  $taskProcess.WaitForExit()
  $taskConfirmation = $taskOutput.GetAwaiter().GetResult().Trim()
  $null = $taskError.GetAwaiter().GetResult()
  if ($taskProcess.ExitCode -ne 0 -or $taskConfirmation -ne 'CONFIGURED') {
    throw 'No se pudo confirmar el Webhook Secret en Supabase staging. No se mostro el secreto.'
  }
  Write-Output 'CONFIGURED'
} finally {
  $taskSecret.Dispose()
  if ($null -ne $taskProcess) { $taskProcess.Dispose() }
}
