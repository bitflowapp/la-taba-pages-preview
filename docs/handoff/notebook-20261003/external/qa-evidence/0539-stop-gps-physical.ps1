$ErrorActionPreference = 'Stop'

$targets = @(
  @{
    Pid = 12408
    Label = 'Quick Tunnel TABA'
    CommandPattern = 'cloudflared\.exe.*tunnel --url http://127\.0\.0\.1:8789'
  },
  @{
    Pid = 704
    Label = 'Lanzador Quick Tunnel TABA'
    CommandPattern = 'cloudflared\.exe.*tunnel --url http://127\.0\.0\.1:8789'
  },
  @{
    Pid = 14144
    Label = 'Relay TABA'
    CommandPattern = 'node\.exe.*scripts/realtime-relay\.mjs 8789'
  }
)

foreach ($target in $targets) {
  $process = Get-CimInstance Win32_Process -Filter "ProcessId=$($target.Pid)" -ErrorAction SilentlyContinue
  if (-not $process) {
    Write-Host "$($target.Label): ya estaba detenido."
    continue
  }
  if ($process.CommandLine -notmatch $target.CommandPattern) {
    Write-Warning "$($target.Label): el PID ya no corresponde al proceso esperado; no se detuvo."
    continue
  }
  Stop-Process -Id $target.Pid
  Write-Host "$($target.Label): detenido."
}
