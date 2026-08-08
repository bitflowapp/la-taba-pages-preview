# Entrega terminal del pedido. La llegada ya ocurrio y el codigo equivocado ya
# fue rechazado (failed_attempts 0 -> 1). Esta fase reescribe el codigo correcto
# -no es una mutacion remota- y confirma.
param([Parameter(Mandatory)][string]$DeliveryCode, [Parameter(Mandatory)][string]$OrderCode)
$ErrorActionPreference = 'Stop'
try { [Console]::OutputEncoding = [System.Text.Encoding]::UTF8 } catch {}

$RiderWorktree = 'D:\1212\la-taba2-rider-first-physical-e2e'
$here = Join-Path $RiderWorktree 'scripts\qa'
. (Join-Path $here 'lib\StagingGuard.ps1')
. (Join-Path $here 'lib\QaCredential.ps1')
. (Join-Path $here 'lib\QaRiderAccess.ps1')
. (Join-Path $here 'lib\DeviceSmoke.ps1')
. (Join-Path $here 'lib\SmokeRun.ps1')

$Serial = 'ZY32LHS6PS'
$RunId = [guid]::NewGuid().ToString()
$ArtifactRoot = 'D:\1212\artifacts\taba2-first-physical-e2e\focal-mendoza'

$guard = Assert-TabaStaging -RiderWorktree $RiderWorktree -SupabaseCli 'C:\1212\scripts\supabase.exe'
Assert-NotProduction -Ref $guard.Ref | Out-Null
$Admin = Get-TabaStagingAdmin -Ref $guard.Ref -SupabaseCli 'C:\1212\scripts\supabase.exe'
$o = ConvertTo-TabaFlatArray -Value (Invoke-RestMethod -Method Get -Headers $Admin.Headers `
    -Uri "$($Admin.Url)/rest/v1/orders?code=eq.$OrderCode&select=id,status,revision,delivery_street_number")
$OrderId = $o[0].id
Write-Host ("pedido {0}: {1} revision {2}" -f $OrderCode, $o[0].status, $o[0].revision)

$secureCode = ConvertTo-SecureString -String $DeliveryCode -AsPlainText -Force
$secureAddr = ConvertTo-SecureString -String "$($o[0].delivery_street_number)" -AsPlainText -Force
try {
    Send-TabaSmokeManifest -Serial $Serial -RunId $RunId -Phase 'TERMINAL_DELIVERY_ASSERT' -OrderId $OrderId `
        -OrderCode $OrderCode -ExpectedInitialState 'arrived' `
        -DeliveryCode $secureCode -ExactAddress $secureAddr | Out-Null
    $r = Invoke-TabaSmokePhase -Serial $Serial -RunId $RunId -Phase 'TERMINAL_DELIVERY_ASSERT' -ArtifactRoot $ArtifactRoot
    Write-Host ("fase: exito={0} clasificacion={1} inicial={2} final={3}" -f $r.Success, $r.Classification, $r.InitialMatch, $r.FinalMatch)
}
finally { try { [void](Remove-TabaSmokeManifest -Serial $Serial -RunId $RunId) } catch {} }

$final = ConvertTo-TabaFlatArray -Value (Invoke-RestMethod -Method Get -Headers $Admin.Headers `
    -Uri "$($Admin.Url)/rest/v1/orders?id=eq.$OrderId&select=status,revision,delivered_at,assigned_rider_user_id")
Write-Host ("pedido: {0}" -f ($final[0] | ConvertTo-Json -Compress))
if ($final[0].status -ne 'delivered') { exit 1 }

$enVuelo = ConvertTo-TabaFlatArray -Value (Invoke-RestMethod -Method Get -Headers $Admin.Headers `
    -Uri "$($Admin.Url)/rest/v1/orders?assigned_rider_user_id=eq.$($final[0].assigned_rider_user_id)&status=in.(assigned,picked_up,on_the_way,arrived)&select=code")
$ubic = ConvertTo-TabaFlatArray -Value (Invoke-RestMethod -Method Get -Headers $Admin.Headers `
    -Uri "$($Admin.Url)/rest/v1/rider_locations?order_id=eq.$OrderId&select=id")
Write-Host ("Rider libre: en vuelo={0}; ubicaciones purgadas: filas restantes={1}" -f $enVuelo.Count, $ubic.Count)
if ($enVuelo.Count -ne 0) { exit 1 }
Write-Host "$OrderCode ENTREGADO Y CERRADO" -ForegroundColor Green
