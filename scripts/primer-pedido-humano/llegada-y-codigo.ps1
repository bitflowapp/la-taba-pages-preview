# Llegada y codigo del pedido, por la app, con el APK que ya lleva la
# navegacion por coordenada. Llegada (con rechazo del codigo equivocado) y
# entrega terminal. No se cancela por SQL: el pedido se termina como lo
# terminaria una persona.
param(
    [Parameter(Mandatory)][string]$DeliveryCode,
    [Parameter(Mandatory)][string]$OrderCode,
    # El worktree del Rider, su arnes de QA y el serial del equipo. Se pasan o
    # se toman del entorno: nada de rutas de una maquina en particular.
    [string]$RiderWorktree = $env:TABA_RIDER_WORKTREE,
    [string]$Serial = $(if ($env:TABA_MOTO_SERIAL) { $env:TABA_MOTO_SERIAL } else { 'ZY32LHS6PS' }),
    [string]$SupabaseCli = $(if ($env:SUPABASE_CLI) { $env:SUPABASE_CLI } else { 'supabase' }),
    [string]$ArtifactRoot = $env:TABA_EVIDENCIA
)
$ErrorActionPreference = 'Stop'
try { [Console]::OutputEncoding = [System.Text.Encoding]::UTF8 } catch {}

if (-not $RiderWorktree) {
    # Por convencion, el repo del Rider es hermano de este.
    $RiderWorktree = Join-Path (Split-Path -Parent (Split-Path -Parent $PSScriptRoot)) 'la-taba2-rider-first-physical-e2e'
}
if (-not (Test-Path $RiderWorktree)) {
    throw "no encuentro el worktree del Rider. Pasalo con -RiderWorktree o TABA_RIDER_WORKTREE"
}
if (-not $ArtifactRoot) { $ArtifactRoot = Join-Path $PSScriptRoot '..\..\.taba-evidencia\pedido-humano' }

$here = Join-Path $RiderWorktree 'scripts\qa'
. (Join-Path $here 'lib\StagingGuard.ps1')
. (Join-Path $here 'lib\QaCredential.ps1')
. (Join-Path $here 'lib\QaRiderAccess.ps1')
. (Join-Path $here 'lib\DeviceSmoke.ps1')
. (Join-Path $here 'lib\SmokeRun.ps1')

$RunId = [guid]::NewGuid().ToString()
New-Item -ItemType Directory -Path $ArtifactRoot -Force | Out-Null

$guard = Assert-TabaStaging -RiderWorktree $RiderWorktree -SupabaseCli $SupabaseCli
Assert-NotProduction -Ref $guard.Ref | Out-Null
$hash = (Get-FileHash -LiteralPath $Apk -Algorithm SHA256).Hash.ToLower()
$device = Assert-TabaDevice -Serial $Serial -ApkPath $Apk -ExpectedHash $hash
if (-not $device.Matches) { throw 'el APK instalado no coincide con el construido' }
Write-Host ("guard OK: proyecto={0}; apk={1}" -f $guard.Name, $hash.Substring(0, 12))

$Admin = Get-TabaStagingAdmin -Ref $guard.Ref -SupabaseCli $SupabaseCli
$o = ConvertTo-TabaFlatArray -Value (Invoke-RestMethod -Method Get -Headers $Admin.Headers `
    -Uri "$($Admin.Url)/rest/v1/orders?code=eq.$OrderCode&select=id,status,revision,delivery_street_number")
if ($o.Count -ne 1) { throw "el codigo $OrderCode no identifica un unico pedido" }
$OrderId = $o[0].id
Write-Host ("pedido {0}: {1} revision {2}" -f $OrderCode, $o[0].status, $o[0].revision)

$secureCode = ConvertTo-SecureString -String $DeliveryCode -AsPlainText -Force
$secureAddr = ConvertTo-SecureString -String "$($o[0].delivery_street_number)" -AsPlainText -Force
function Estado {
    $x = ConvertTo-TabaFlatArray -Value (Invoke-RestMethod -Method Get -Headers $Admin.Headers `
        -Uri "$($Admin.Url)/rest/v1/orders?id=eq.$OrderId&select=status,revision,delivered_at,assigned_rider_user_id")
    $x[0]
}
function Fase {
    param([string]$Phase, [string]$Inicial)
    Send-TabaSmokeManifest -Serial $Serial -RunId $RunId -Phase $Phase -OrderId $OrderId `
        -OrderCode $OrderCode -ExpectedInitialState $Inicial `
        -DeliveryCode $secureCode -ExactAddress $secureAddr | Out-Null
    $r = Invoke-TabaSmokePhase -Serial $Serial -RunId $RunId -Phase $Phase -ArtifactRoot $ArtifactRoot
    [void](Remove-TabaSmokeManifest -Serial $Serial -RunId $RunId)
    Write-Host ("  {0}: exito={1} clasificacion={2} inicial={3} final={4}" -f `
        $Phase, $r.Success, $r.Classification, $r.InitialMatch, $r.FinalMatch)
    return $r
}

$handoffAntes = ConvertTo-TabaFlatArray -Value (Invoke-RestMethod -Method Get -Headers $Admin.Headers `
    -Uri "$($Admin.Url)/rest/v1/order_delivery_handoffs?order_id=eq.$OrderId&select=failed_attempts")
$fallidosAntes = if ($handoffAntes.Count -eq 1) { [int]$handoffAntes[0].failed_attempts } else { 0 }

try {
    $r = Fase -Phase 'ARRIVAL_AND_CODE' -Inicial 'on_the_way'
    if (-not $r.Success) { throw "la llegada fallo: $($r.Classification)" }
    $handoffDespues = ConvertTo-TabaFlatArray -Value (Invoke-RestMethod -Method Get -Headers $Admin.Headers `
        -Uri "$($Admin.Url)/rest/v1/order_delivery_handoffs?order_id=eq.$OrderId&select=failed_attempts")
    $fallidosDespues = [int]$handoffDespues[0].failed_attempts
    $trasLlegada = Estado
    Write-Host ("  codigo incorrecto rechazado: intentos {0} -> {1}; estado {2}" -f `
        $fallidosAntes, $fallidosDespues, $trasLlegada.status) -ForegroundColor Cyan
    if ($fallidosDespues -le $fallidosAntes) { throw 'el codigo equivocado no dejo rastro de rechazo' }
    if ($trasLlegada.status -eq 'delivered') { throw 'WRONG_CODE_ACCEPTED' }

    $t = Fase -Phase 'TERMINAL_DELIVERY_ASSERT' -Inicial 'arrived'
    $final = Estado
    Write-Host ("pedido final: {0}" -f ($final | ConvertTo-Json -Compress))
    if ($final.status -ne 'delivered') { exit 1 }

    $enVuelo = ConvertTo-TabaFlatArray -Value (Invoke-RestMethod -Method Get -Headers $Admin.Headers `
        -Uri "$($Admin.Url)/rest/v1/orders?assigned_rider_user_id=eq.$($final.assigned_rider_user_id)&status=in.(assigned,picked_up,on_the_way,arrived)&select=code")
    Write-Host ("Rider libre: pedidos en vuelo={0}" -f $enVuelo.Count)
    $ubic = ConvertTo-TabaFlatArray -Value (Invoke-RestMethod -Method Get -Headers $Admin.Headers `
        -Uri "$($Admin.Url)/rest/v1/rider_locations?order_id=eq.$OrderId&select=id")
    Write-Host ("purga de ubicaciones al terminar: filas={0}" -f $ubic.Count)
    if ($enVuelo.Count -ne 0) { exit 1 }
    Write-Host "$OrderCode CERRADO" -ForegroundColor Green
}
finally {
    try { [void](Remove-TabaSmokeManifest -Serial $Serial -RunId $RunId) } catch {}
}
