param([ValidateSet('production', 'controlled-production')][string]$Target = 'production')
$ErrorActionPreference = 'Stop'
$taskRoot = Split-Path (Split-Path $PSScriptRoot -Parent) -Parent
$taskRef = if ($Target -eq 'controlled-production') { 'tkanbadcglszlcyfjvpv' } else { 'wwcpogltfgzgkrlilbcd' }
Set-Location -LiteralPath $taskRoot
Write-Host '============================================================'
Write-Host 'CONFIGURAR APLICACIÓN INTEGRADORA DE MARCO/LUNA EN PRODUCCIÓN'
Write-Host '============================================================'
Write-Host 'IMPORTANTE: Esta es la aplicación de la plataforma TABA creada por Marco.'
Write-Host 'Walter es el seller y NO debe crear ninguna aplicación.'
Write-Host "Destino:  $Target ($taskRef)"
Write-Host "Callback: https://$taskRef.supabase.co/functions/v1/mercadopago-oauth-callback"
Write-Host "Webhook:  https://$taskRef.supabase.co/functions/v1/mercadopago-webhook"
Write-Host 'Activá Authorization Code con PKCE S256 y permisos read, write, offline_access.'
Write-Host ''
$taskClientId = Read-Host 'ID de la aplicación productiva de Marco (Client ID numérico)'
if ($taskClientId -ne '7677852968049976') { throw 'ID inválido: no corresponde a La Taba Delivery' }
$taskSecret = Read-Host 'Client Secret de esa aplicación (entrada oculta)' -AsSecureString
$taskWebhook = Read-Host 'Firma secreta de Webhooks de esa aplicación (entrada oculta)' -AsSecureString
try {
  $env:TABA_SETUP_CLIENT_ID = $taskClientId
  $env:TABA_SETUP_CLIENT_SECRET = [System.Net.NetworkCredential]::new('', $taskSecret).Password
  $env:TABA_SETUP_WEBHOOK_SECRET = [System.Net.NetworkCredential]::new('', $taskWebhook).Password
  node scripts/mercadopago/configurar-oauth-produccion.mjs "--target=$Target"
  if ($LASTEXITCODE -ne 0) { throw 'La configuración no terminó. Ningún secreto se imprimió.' }
} finally {
  Remove-Item Env:TABA_SETUP_CLIENT_ID, Env:TABA_SETUP_CLIENT_SECRET, Env:TABA_SETUP_WEBHOOK_SECRET -ErrorAction SilentlyContinue
  $taskSecret.Dispose()
  $taskWebhook.Dispose()
}
