<#
  Prueba de instalación REAL del MSI en un Windows descartable (runner de CI,
  que corre como administrador). Nunca en la PC de un local.

    1. instala en silencio y exige código 0;
    2. el servicio corre como LOCAL SERVICE, inicio automático;
    3. /v1/health responde en 127.0.0.1:17872 (versión, sin registro) y el
       puerto escucha SÓLO en loopback;
    4. la carpeta de datos quedó cerrada (sin Users/Everyone) y el servicio
       creó su token protegido con DPAPI;
    5. ESC/POS por el spooler real: impresora «Generic / Text Only» en un puerto
       archivo, hoja de prueba PC850 → el archivo trae ESC @, ESC t 2 y el corte;
    6. desinstala: servicio y binarios fuera, datos conservados.

  powershell -File ci-install-test.ps1 -Msi <ruta.msi> -Version 0.1.0 -Report <salida.json>
#>
param(
  [Parameter(Mandatory = $true)][string]$Msi,
  [Parameter(Mandatory = $true)][string]$Version,
  [string]$Report = ''
)
$ErrorActionPreference = 'Stop'
$checks = [ordered]@{}
function Check([string]$name, [bool]$ok, $detail = $null) {
  $script:checks[$name] = if ($ok) { 'PASS' } else { 'FAIL' }
  if ($null -ne $detail) { $script:checks["$name.detail"] = $detail }
  Write-Host ("{0,-34} {1} {2}" -f $name, $script:checks[$name], ($detail | Out-String).Trim())
}

$msiPath = (Resolve-Path $Msi).Path
$work = Join-Path $env:RUNNER_TEMP 'taba-agent-install'
New-Item -ItemType Directory -Force $work | Out-Null
$exe = Join-Path $env:ProgramFiles 'La Taba\LocalAgent\TabaLocalAgent.exe'
$data = Join-Path $env:ProgramData 'TabaLocalAgent'

# 1 · instalar
$install = Start-Process msiexec.exe -ArgumentList "/i `"$msiPath`" /qn /norestart /l*v `"$work\install.log`"" -Wait -PassThru
Check 'INSTALL_EXIT_0' ($install.ExitCode -eq 0) $install.ExitCode
Check 'BINARY_INSTALLED' (Test-Path $exe)

# 2 · servicio
$service = Get-CimInstance Win32_Service -Filter "Name='TabaLocalAgent'"
Check 'SERVICE_REGISTERED' ($null -ne $service)
Check 'SERVICE_ACCOUNT_LOCAL_SERVICE' ($service.StartName -eq 'NT AUTHORITY\LocalService') $service.StartName
Check 'SERVICE_START_AUTO' ($service.StartMode -eq 'Auto') $service.StartMode
$deadline = (Get-Date).AddSeconds(60)
while ((Get-Service TabaLocalAgent).Status -ne 'Running' -and (Get-Date) -lt $deadline) { Start-Sleep -Milliseconds 500 }
Check 'SERVICE_RUNNING' ((Get-Service TabaLocalAgent).Status -eq 'Running') (Get-Service TabaLocalAgent).Status

# 3 · salud y escucha sólo en loopback
$health = $null
$deadline = (Get-Date).AddSeconds(60)
while ($null -eq $health -and (Get-Date) -lt $deadline) {
  try {
    $health = Invoke-RestMethod -Uri 'http://127.0.0.1:17872/v1/health' -Headers @{ Origin = 'https://la-taba-commercial-pilot.pages.dev' } -TimeoutSec 5
  } catch { Start-Sleep -Seconds 1 }
}
Check 'HEALTH_RESPONDS' ($null -ne $health)
Check 'HEALTH_VERSION' ($health.version -eq $Version) $health.version
Check 'HEALTH_NOT_REGISTERED' ($health.registration -eq 'NOT_REGISTERED') $health.registration
$listeners = @(Get-NetTCPConnection -LocalPort 17872 -State Listen -ErrorAction SilentlyContinue)
Check 'LISTENS_ONLY_ON_LOOPBACK' ($listeners.Count -ge 1 -and @($listeners | Where-Object { $_.LocalAddress -ne '127.0.0.1' }).Count -eq 0) (($listeners | ForEach-Object LocalAddress) -join ',')
try {
  Invoke-WebRequest -UseBasicParsing -Uri 'http://127.0.0.1:17872/v1/health' -Headers @{ Origin = 'https://evil.example' } -TimeoutSec 5 | Out-Null
  Check 'FOREIGN_ORIGIN_REJECTED' $false
} catch { Check 'FOREIGN_ORIGIN_REJECTED' ($_.Exception.Response.StatusCode.value__ -eq 403) $_.Exception.Response.StatusCode.value__ }

# 4 · carpeta de datos cerrada y token protegido por el servicio
$acl = Get-Acl $data
$open = @($acl.Access | Where-Object { $_.IdentityReference -match 'Users|Everyone|Usuarios|Todos' })
Check 'DATA_DIR_NOT_READABLE_BY_USERS' ($open.Count -eq 0) (($acl.Access | ForEach-Object { "$($_.IdentityReference):$($_.FileSystemRights)" }) -join '; ')
Check 'DATA_DIR_LOCAL_SERVICE_MODIFY' (@($acl.Access | Where-Object { $_.IdentityReference -match 'LOCAL SERVICE' -and ($_.FileSystemRights -band [Security.AccessControl.FileSystemRights]::Modify) }).Count -ge 1)
$token = Join-Path $data 'agent-token.bin'
Check 'SERVICE_CREATED_PROTECTED_TOKEN' ((Test-Path $token) -and (Get-Item $token).Length -gt 100) (Get-Item $token -ErrorAction SilentlyContinue).Length
Check 'SERVICE_WRITES_JSON_LOGS' (@(Get-ChildItem (Join-Path $data 'logs') -Filter 'agent-*.jsonl' -ErrorAction SilentlyContinue).Count -ge 1)

# 5 · ESC/POS RAW por el spooler real
$spooler = Get-Service Spooler
if ($spooler.Status -ne 'Running') { Set-Service Spooler -StartupType Manual; Start-Service Spooler }
$prn = Join-Path $work 'escpos.prn'
try {
  if (-not (Get-PrinterDriver -Name 'Generic / Text Only' -ErrorAction SilentlyContinue)) { Add-PrinterDriver -Name 'Generic / Text Only' }
  Add-PrinterPort -Name $prn
  Add-Printer -Name 'Taba CI ESCPOS' -DriverName 'Generic / Text Only' -PortName $prn
  & $exe test-print --printer 'Taba CI ESCPOS' --width 80 --codepage pc850 | Out-Host
  $printed = $LASTEXITCODE -eq 0
  $deadline = (Get-Date).AddSeconds(20)
  while (-not (Test-Path $prn) -and (Get-Date) -lt $deadline) { Start-Sleep -Milliseconds 250 }
  $bytes = if (Test-Path $prn) { [IO.File]::ReadAllBytes($prn) } else { [byte[]]@() }
  $hex = [BitConverter]::ToString($bytes).Replace('-', '')
  Check 'RAW_PRINT_REPORTED_SENT' $printed
  Check 'RAW_BYTES_START_WITH_INIT_AND_PC850' ($hex.StartsWith('1B401B7402')) ($hex.Substring(0, [Math]::Min(20, $hex.Length)))
  Check 'RAW_BYTES_CONTAIN_QR_AND_CUT' ($hex.Contains('1D286B') -and $hex.EndsWith('1D564203')) $bytes.Length
} catch {
  Check 'RAW_PRINT_PATH' $false $_.Exception.Message
}

# 6 · desinstalar
$uninstall = Start-Process msiexec.exe -ArgumentList "/x `"$msiPath`" /qn /norestart /l*v `"$work\uninstall.log`"" -Wait -PassThru
Check 'UNINSTALL_EXIT_0' ($uninstall.ExitCode -eq 0) $uninstall.ExitCode
Check 'SERVICE_REMOVED' ($null -eq (Get-Service TabaLocalAgent -ErrorAction SilentlyContinue))
Check 'BINARY_REMOVED' (-not (Test-Path $exe))
Check 'DATA_KEPT_FOR_REINSTALL' (Test-Path $data)

$failed = @($checks.Keys | Where-Object { $_ -notlike '*.detail' -and $checks[$_] -ne 'PASS' })
$checks['VERDICT'] = if ($failed.Count -eq 0) { 'PASS' } else { 'FAIL' }
if ($Report) { $checks | ConvertTo-Json -Depth 3 | Set-Content -Encoding utf8 $Report }
Write-Host "VERDICT $($checks['VERDICT'])"
if ($failed.Count -gt 0) { exit 1 }
