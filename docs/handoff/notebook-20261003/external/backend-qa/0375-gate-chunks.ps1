# Gate Chromium por ARCHIVO, con reanudación.
#
# Motivo: en esta máquina las corridas largas mueren desde afuera en puntos
# distintos (22/170, 50/170) sin registrar falla, y WebKit además se cuelga.
# Ejecutar archivo por archivo hace que una muerte cueste segundos en vez de la
# corrida entera, y el CSV permite reanudar exactamente donde quedó.
#
# Los parámetros por prueba no cambian: mismos puertos, reporter, workers y
# timeouts de playwright.config.mjs.

$ErrorActionPreference = 'Continue'
$TMPDIR = 'E:\DevCache\Temp\playwright-tmp'
New-Item -ItemType Directory -Force -Path $TMPDIR | Out-Null
$env:TEMP = $TMPDIR; $env:TMP = $TMPDIR

$REPO = 'C:\1212\la-taba2-mobile-brand-refresh'
$SCRATCH = 'E:\DevCache\Temp\claude\C--Users-marco\f04ffd25-c5f4-4120-a4a6-a8e4596b07c9\scratchpad'
$CSV = Join-Path $SCRATCH 'gate-chunks.csv'
$LOGDIR = Join-Path $SCRATCH 'chunks'
New-Item -ItemType Directory -Force -Path $LOGDIR | Out-Null

if (-not (Test-Path $CSV)) { Set-Content -Path $CSV -Value 'archivo,pasadas,fallidas,exit' -Encoding utf8 }
$hechos = @{}
foreach ($row in (Import-Csv $CSV)) { $hechos[$row.archivo] = $true }

$archivos = Get-ChildItem (Join-Path $REPO 'tests\e2e') -Filter '*.spec.mjs' | Sort-Object Name

Set-Location $REPO
$env:TABA_E2E_HTTP_PORT = '8721'
$env:TABA_E2E_RELAY_PORT = '18721'

foreach ($a in $archivos) {
  if ($hechos[$a.Name]) { continue }

  Get-CimInstance Win32_Process -Filter "Name='node.exe'" -ErrorAction SilentlyContinue |
    Where-Object { $_.CommandLine -like '*playwright*' -or $_.CommandLine -like '*realtime-relay.mjs 8721*' -or $_.CommandLine -like '*realtime-relay.mjs 18721*' } |
    ForEach-Object { & taskkill /PID $_.ProcessId /F /T 2>&1 | Out-Null }
  Start-Sleep -Seconds 2

  $log = Join-Path $LOGDIR "$($a.BaseName).txt"
  npx playwright test "tests/e2e/$($a.Name)" --output='E:\DevCache\Temp\claude\pw-chunk' --reporter=line 2>&1 |
    Out-File -FilePath $log -Encoding utf8
  $code = $LASTEXITCODE

  $texto = if (Test-Path $log) { (Get-Content $log -Raw) -replace '\x1b\[[0-9;]*[A-Za-z]', '' } else { '' }
  $pas = if ($texto -match '(\d+)\s+passed') { [int]$matches[1] } else { 0 }
  $fal = if ($texto -match '(\d+)\s+failed') { [int]$matches[1] } else { 0 }
  Add-Content -Path $CSV -Value "$($a.Name),$pas,$fal,$code" -Encoding utf8
}

Add-Content -Path $CSV -Value 'FIN,0,0,0' -Encoding utf8
