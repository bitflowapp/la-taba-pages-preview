param(
  [Parameter(Mandatory = $true)][string]$Browser,
  [int]$HttpPort = 8080,
  [int]$RelayPort = 18787
)

$ErrorActionPreference = 'Continue'
$root = 'D:\1212\taba2-gate-20260804'
$wt = 'C:\1212\la-taba2-mobile-design-integration'

$env:TMP = "$root\tmp"
$env:TEMP = "$root\tmp"
$env:TABA_E2E_HTTP_PORT = "$HttpPort"
$env:TABA_E2E_RELAY_PORT = "$RelayPort"
$env:PLAYWRIGHT_JSON_OUTPUT_NAME = "$root\e2e\$Browser.json"

New-Item -ItemType Directory -Force "$root\e2e\$Browser-out" | Out-Null

Set-Location $wt

$free = [math]::Round((Get-PSDrive C).Free / 1MB, 0)
Write-Output "== $Browser == inicio | C: libre ${free} MB | http=$HttpPort relay=$RelayPort"

& npx playwright test --browser=$Browser --output="$root\e2e\$Browser-out" --reporter=list,json
$code = $LASTEXITCODE

$freeAfter = [math]::Round((Get-PSDrive C).Free / 1MB, 0)
Write-Output "== $Browser == fin | exit=$code | C: libre ${freeAfter} MB"
Set-Content -Path "$root\e2e\$Browser.exitcode" -Value "$code" -Encoding utf8
exit $code
