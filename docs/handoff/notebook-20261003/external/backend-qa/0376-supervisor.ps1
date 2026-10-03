# Supervisor del gate por archivos.
#
# El runner muere desde afuera cada tantos archivos. Como `gate-chunks.ps1`
# reanuda desde el CSV, basta con volver a lanzarlo: cada intento avanza. El
# supervisor sólo se detiene cuando el CSV tiene la marca FIN o cuando se
# agotan los intentos.
$ErrorActionPreference = 'Continue'
$SCRATCH = 'E:\DevCache\Temp\claude\C--Users-marco\f04ffd25-c5f4-4120-a4a6-a8e4596b07c9\scratchpad'
$CSV = Join-Path $SCRATCH 'gate-chunks.csv'
$STATUS = Join-Path $SCRATCH 'supervisor-estado.txt'
$RUNNER = Join-Path $SCRATCH 'gate-chunks.ps1'
Set-Content -Path $STATUS -Value ("[{0}] SUPERVISOR arranca" -f (Get-Date).ToString('HH:mm:ss')) -Encoding utf8

for ($i = 1; $i -le 25; $i++) {
  if ((Get-Content $CSV -ErrorAction SilentlyContinue) -match '^FIN,') {
    Add-Content -Path $STATUS -Value ("[{0}] COMPLETO en {1} intentos" -f (Get-Date).ToString('HH:mm:ss'), ($i - 1)) -Encoding utf8
    exit 0
  }
  $antes = (@(Get-Content $CSV -ErrorAction SilentlyContinue)).Count
  Add-Content -Path $STATUS -Value ("[{0}] intento {1}: {2} archivos hechos" -f (Get-Date).ToString('HH:mm:ss'), $i, ($antes - 1)) -Encoding utf8

  $p = Start-Process -FilePath 'powershell' -ArgumentList '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', $RUNNER -WindowStyle Hidden -PassThru
  $p.WaitForExit()

  $despues = (@(Get-Content $CSV -ErrorAction SilentlyContinue)).Count
  if ($despues -eq $antes) {
    Add-Content -Path $STATUS -Value ("[{0}] intento {1} no avanzo ningun archivo" -f (Get-Date).ToString('HH:mm:ss'), $i) -Encoding utf8
    Start-Sleep -Seconds 10
  }
}
Add-Content -Path $STATUS -Value ("[{0}] AGOTADOS los intentos" -f (Get-Date).ToString('HH:mm:ss')) -Encoding utf8
