<#
  Verifica un MSI de Taba.LocalAgent SIN instalarlo (lee sus tablas en modo
  sólo lectura; no hace falta ser administrador):

    · lleva exactamente TabaLocalAgent.exe y appsettings.json (nada de tokens,
      certificados, claves, .pdb ni configuraciones locales);
    · el servicio «TabaLocalAgent» corre como LOCAL SERVICE, inicio automático,
      con el argumento «service», y se detiene y quita al desinstalar;
    · la carpeta de datos se crea con permisos cerrados (SDDL);
    · la versión del paquete es la esperada.

  pwsh/powershell -File verify-msi.ps1 -Msi <ruta.msi> [-Version 0.1.0]
#>
param(
  [Parameter(Mandatory = $true)][string]$Msi,
  [string]$Version = ''
)
$ErrorActionPreference = 'Stop'
$installer = New-Object -ComObject WindowsInstaller.Installer
$database = $installer.GetType().InvokeMember('OpenDatabase', 'InvokeMethod', $null, $installer, @((Resolve-Path $Msi).Path, 0))

function Query([string]$sql, [int]$columns) {
  $view = $database.GetType().InvokeMember('OpenView', 'InvokeMethod', $null, $database, @($sql))
  $view.GetType().InvokeMember('Execute', 'InvokeMethod', $null, $view, $null) | Out-Null
  $rows = @()
  while ($true) {
    $record = $view.GetType().InvokeMember('Fetch', 'InvokeMethod', $null, $view, $null)
    if ($null -eq $record) { break }
    $row = @()
    for ($i = 1; $i -le $columns; $i++) { $row += $record.GetType().InvokeMember('StringData', 'GetProperty', $null, $record, @($i)) }
    $rows += , $row
  }
  $view.GetType().InvokeMember('Close', 'InvokeMethod', $null, $view, $null) | Out-Null
  return , $rows
}

$failures = @()
$files = (Query 'SELECT `FileName` FROM `File`' 1) | ForEach-Object { ($_[0] -split '\|')[-1] }
$expected = @('TabaLocalAgent.exe', 'appsettings.json')
if ((Compare-Object ($files | Sort-Object) ($expected | Sort-Object))) { $failures += "FILES: $($files -join ', ')" }
foreach ($file in $files) {
  if ($file -match '(?i)\.(pfx|p12|pem|key|cer|crt|bin|pdb)$' -or $file -match '(?i)(token|credential|secret)') { $failures += "FORBIDDEN_FILE: $file" }
}

$services = Query 'SELECT `Name`, `StartType`, `StartName`, `Arguments` FROM `ServiceInstall`' 4
if ($services.Count -ne 1) { $failures += "SERVICES: $($services.Count)" }
else {
  $service = $services[0]
  if ($service[0] -ne 'TabaLocalAgent') { $failures += "SERVICE_NAME: $($service[0])" }
  if ($service[1] -ne '2') { $failures += "SERVICE_START_TYPE: $($service[1]) (2 = automático)" }
  if ($service[2] -ne 'NT AUTHORITY\LocalService') { $failures += "SERVICE_ACCOUNT: $($service[2])" }
  if ($service[3] -ne 'service') { $failures += "SERVICE_ARGUMENTS: $($service[3])" }
}

# ServiceControl.Event: 1 = start on install, 2 = stop on install, 32 = stop on uninstall, 128 = delete on uninstall.
$control = Query 'SELECT `Name`, `Event` FROM `ServiceControl`' 2
if ($control.Count -ne 1 -or (([int]$control[0][1]) -band 161) -ne 161) { $failures += "SERVICE_CONTROL: $($control | ForEach-Object { $_ -join '=' })" }

$permissions = Query 'SELECT `SDDLText` FROM `MsiLockPermissionsEx`' 1
if ($permissions.Count -ne 1 -or $permissions[0][0] -ne 'O:BAG:SYD:PAI(A;OICI;FA;;;SY)(A;OICI;FA;;;BA)(A;OICI;0x1301bf;;;LS)') { $failures += "DATA_ACL: $($permissions | ForEach-Object { $_[0] })" }

$properties = @{}
(Query 'SELECT `Property`, `Value` FROM `Property`' 2) | ForEach-Object { $properties[$_[0]] = $_[1] }
if ($Version -and $properties['ProductVersion'] -ne $Version) { $failures += "VERSION: $($properties['ProductVersion'])" }
if ($properties['ALLUSERS'] -ne '1') { $failures += "SCOPE: ALLUSERS=$($properties['ALLUSERS'])" }

$report = [ordered]@{
  msi = (Split-Path $Msi -Leaf)
  version = $properties['ProductVersion']
  files = $files
  service = if ($services.Count -eq 1) { [ordered]@{ name = $services[0][0]; startType = $services[0][1]; account = $services[0][2]; arguments = $services[0][3] } } else { $null }
  dataAcl = if ($permissions.Count -eq 1) { $permissions[0][0] } else { $null }
  verdict = if ($failures.Count -eq 0) { 'PASS' } else { 'FAIL' }
  failures = $failures
}
$report | ConvertTo-Json -Depth 4
if ($failures.Count -gt 0) { exit 1 }
