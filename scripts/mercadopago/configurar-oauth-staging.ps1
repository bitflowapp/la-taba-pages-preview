$ErrorActionPreference = 'Stop'
$taskRoot = Split-Path (Split-Path $PSScriptRoot -Parent) -Parent
Set-Location -LiteralPath $taskRoot
Write-Host 'Configurar aplicación TABA/LUNA de Marco en STAGING. No uses la aplicación de Walter.'
Write-Host 'Callback: https://ukxqbgswjlibmnjemrzd.supabase.co/functions/v1/mercadopago-oauth-callback'
Write-Host 'Activá Authorization Code con PKCE S256 y permisos read, write, offline_access.'
$taskClientId = Read-Host 'ID de la aplicación de Marco'
if ($taskClientId -notmatch '^\d+$') { throw 'ID inválido' }
$taskSecret = Read-Host 'Client Secret de esa aplicación (entrada oculta)' -AsSecureString
$taskWebhook = Read-Host 'Firma secreta de Webhooks de esa aplicación (entrada oculta)' -AsSecureString
try {
  $env:TABA_SETUP_CLIENT_ID = $taskClientId
  $env:TABA_SETUP_CLIENT_SECRET = [System.Net.NetworkCredential]::new('', $taskSecret).Password
  $env:TABA_SETUP_WEBHOOK_SECRET = [System.Net.NetworkCredential]::new('', $taskWebhook).Password
  node scripts/mercadopago/configurar-oauth-staging.mjs
  if ($LASTEXITCODE -ne 0) { throw 'La configuración no terminó. Ningún secreto se imprimió.' }
} finally {
  Remove-Item Env:TABA_SETUP_CLIENT_ID, Env:TABA_SETUP_CLIENT_SECRET, Env:TABA_SETUP_WEBHOOK_SECRET -ErrorAction SilentlyContinue
  $taskSecret.Dispose()
  $taskWebhook.Dispose()
}
