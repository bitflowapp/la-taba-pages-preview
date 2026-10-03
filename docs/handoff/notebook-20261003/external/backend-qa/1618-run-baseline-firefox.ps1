# Compara customer-delivery.spec.mjs en Firefox entre el HEAD de la rama y la
# baseline RC (4ca22af, ancestro directo). Objetivo: decidir con evidencia si los
# 4 fallos son regresion de esta rama o baseline preexistente de Firefox.
#
# El worktree del RC se usa SOLO para leer/ejecutar. Los outputs van a D:.

$ErrorActionPreference = 'Continue'
$root = 'D:\1212\taba2-gate-20260804'
$rc = 'C:\1212\la-taba-production-rc1'

$env:TMP = "$root\tmp"
$env:TEMP = "$root\tmp"
# Puertos distintos del gate para no chocar con nada residual.
$env:TABA_E2E_HTTP_PORT = '8099'
$env:TABA_E2E_RELAY_PORT = '18799'
$env:PLAYWRIGHT_JSON_OUTPUT_NAME = "$root\e2e\baseline-rc-firefox.json"

New-Item -ItemType Directory -Force "$root\e2e\baseline-rc-out" | Out-Null
Set-Location $rc

Write-Output "== baseline RC == $(& git rev-parse HEAD)"
Write-Output "== git status (debe estar limpio) =="
$st = & git status --porcelain
if ($st) { $st } else { Write-Output "(limpio)" }

& npx playwright test tests/e2e/customer-delivery.spec.mjs --browser=firefox `
  --output="$root\e2e\baseline-rc-out" --reporter=list,json
$code = $LASTEXITCODE

Write-Output "== baseline firefox == exit=$code"
Set-Content -Path "$root\e2e\baseline-rc-firefox.exitcode" -Value "$code" -Encoding utf8
exit $code
