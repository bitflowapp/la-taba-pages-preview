param(
  [Parameter(Mandatory = $true)][int]$HttpPort,
  [Parameter(Mandatory = $true)][int]$RelayPort,
  [switch]$CleanupOrphans
)

$ErrorActionPreference = 'Stop'

function Get-RunnerProcesses {
  Get-CimInstance Win32_Process |
    Where-Object {
      $_.Name -match 'node.exe|cmd.exe|WebKitNetworkProcess.exe|WebKitWebProcess.exe|firefox.exe|chromium.exe' -and
      $_.CommandLine -and
      $_.CommandLine -match 'playwright|realtime-relay|la-taba2-payment-recovery-p0|la-taba2-mobile-brand-refresh'
    }
}

function Get-ListeningPort([int]$Port) {
  Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue |
    Where-Object LocalPort -eq $Port
}

if ($CleanupOrphans) {
  $webkit = Get-CimInstance Win32_Process | Where-Object Name -eq 'WebKitNetworkProcess.exe'
  foreach ($process in $webkit) {
    $parent = Get-CimInstance Win32_Process -Filter "ProcessId=$($process.ParentProcessId)" -ErrorAction SilentlyContinue
    if (-not $parent) {
      Invoke-CimMethod -InputObject $process -MethodName Terminate | Out-Null
    }
  }
  Start-Sleep -Seconds 2
}

$processes = @(Get-RunnerProcesses)
$listeners = @((Get-ListeningPort $HttpPort), (Get-ListeningPort $RelayPort)) | Where-Object { $_ }
$webkit = @(Get-CimInstance Win32_Process | Where-Object Name -eq 'WebKitNetworkProcess.exe')

[pscustomobject]@{
  timestamp = (Get-Date).ToString('o')
  httpPort = $HttpPort
  relayPort = $RelayPort
  runnerProcesses = $processes.Count
  listeningExclusivePorts = $listeners.Count
  webkitNetworkProcesses = $webkit.Count
} | ConvertTo-Json -Compress

if ($processes.Count -gt 0) {
  $processes | Select-Object ProcessId, ParentProcessId, Name, CommandLine | Format-List
  throw 'PLAYWRIGHT_OR_WEBSERVER_PROCESS_PRESENT'
}
if ($listeners.Count -gt 0) {
  $listeners | Select-Object LocalAddress, LocalPort, OwningProcess | Format-Table
  throw 'EXCLUSIVE_PORT_OCCUPIED'
}
if ($webkit.Count -gt 0) {
  $webkit | Select-Object ProcessId, ParentProcessId, Name | Format-Table
  throw 'WEBKIT_PROCESS_PRESENT'
}
