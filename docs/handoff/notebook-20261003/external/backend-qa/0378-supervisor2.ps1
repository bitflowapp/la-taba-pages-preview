# Supervisor del gate por archivos. Pasada 2 (post-fix 'Ver historias').
#
# El runner muere desde afuera cada tantos archivos. Como `gate-chunks2.ps1`
# reanuda desde el CSV, basta con volver a lanzarlo: cada intento avanza. El
# supervisor sólo se detiene cuando el CSV tiene la marca FIN o cuando se
# agotan los intentos. Cada reinicio queda documentado en el estado.
$ErrorActionPreference = 'Continue'
$SCRATCH = 'E:\DevCache\Temp\claude\C--Users-marco\885bec76-902b-48e6-9eae-79802ca274bc\scratchpad'
$CSV = Join-Path $SCRATCH 'gate-chunks2.csv'
$STATUS = Join-Path $SCRATCH 'supervisor2-estado.txt'
$RUNNER = Join-Path $SCRATCH 'gate-chunks2.ps1'
Set-Content -Path $STATUS -Value ("[{0}] SUPERVISOR arranca (PID {1})" -f (Get-Date).ToString('HH:mm:ss'), $PID) -Encoding utf8

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
