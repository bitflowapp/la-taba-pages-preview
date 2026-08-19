<#
.SYNOPSIS
  Abre una sesión de owner una sola vez, asocia las 4 fotografías y la cierra.

.DESCRIPTION
  QUÉ HACE CON LA CONTRASEÑA

  La pide oculta, la usa una vez contra el endpoint público de Auth y la
  descarta. Concretamente:

    · no se imprime, ni siquiera enmascarada;
    · no viaja como argumento (los argumentos los ve cualquier proceso);
    · no se escribe en ningún archivo ni en ningún artefacto;
    · no queda en una variable de entorno, ni de proceso ni persistente;
    · nunca se convierte en un String de .NET. Se lee del BSTR carácter por
      carácter a un char[], se arma el cuerpo JSON en otro char[], se pasa a
      bytes, y los tres búferes se sobreescriben con ceros en el `finally`.

  Esto último es el motivo de que el guion use HttpClient con un ByteArrayContent
  en vez del cómodo `Invoke-RestMethod -Body`: un String de .NET es inmutable y
  no se puede borrar, así que si la contraseña llega a ser String queda en el
  heap hasta que el recolector decida. Con char[] y byte[] se puede borrar, y se
  borra.

  Lo que SÍ cruza a Node es un JWT de sesión, por STDIN —no por argumento ni por
  entorno— y se revoca al terminar.

.NOTES
  Un solo comando. No deja nada abierto.
#>

[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

$ref     = 'wwcpogltfgzgkrlilbcd'
$base    = "https://$ref.supabase.co"
$repo    = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$aplicar = Join-Path $repo 'scripts\catalog-images\apply-association.mjs'

Write-Host ''
Write-Host 'TABA · asociar las 4 fotografías oficiales' -ForegroundColor Cyan
Write-Host "  destino : $base"
Write-Host "  repo    : $repo"
Write-Host ''

if (-not (Test-Path $aplicar)) { throw "No encuentro $aplicar" }

# ── Preflight sin credenciales ───────────────────────────────────────────────
Write-Host 'Preflight (sin credenciales)...' -ForegroundColor Cyan
Push-Location $repo
try {
  node scripts/catalog-images/preflight-association.mjs
  if ($LASTEXITCODE -ne 0) { throw 'El preflight falló. No se pide ninguna contraseña.' }
  node scripts/catalog-images/apply-association.mjs --dry-run | Out-Null
  if ($LASTEXITCODE -ne 0) { throw 'La validación del lote falló. No se pide ninguna contraseña.' }
} finally {
  Pop-Location
}
Write-Host 'Preflight verde.' -ForegroundColor Green
Write-Host ''

# ── Credenciales ─────────────────────────────────────────────────────────────
$email = Read-Host 'Email del owner'
if ([string]::IsNullOrWhiteSpace($email)) { throw 'Email vacío.' }
$secure = Read-Host "Contraseña de $email" -AsSecureString
if ($secure.Length -eq 0) { throw 'Contraseña vacía.' }

Add-Type -AssemblyName System.Net.Http | Out-Null

$bstr   = [IntPtr]::Zero
$clave  = $null   # char[]
$cuerpo = $null   # char[]
$bytes  = $null   # byte[]
$token  = $null
$salida = 1

try {
  # BSTR -> char[], sin pasar nunca por String.
  $bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
  $largo = $secure.Length
  $clave = New-Object char[] $largo
  for ($i = 0; $i -lt $largo; $i++) {
    $clave[$i] = [char][Runtime.InteropServices.Marshal]::ReadInt16($bstr, $i * 2)
  }

  # Cuerpo JSON armado a mano, escapando sólo lo que JSON exige.
  $lista = New-Object 'System.Collections.Generic.List[char]'
  foreach ($c in ('{"email":' + (ConvertTo-Json $email -Compress) + ',"password":"').ToCharArray()) { $lista.Add($c) }
  foreach ($c in $clave) {
    switch ($c) {
      '"'      { $lista.Add('\'); $lista.Add('"') }
      '\'      { $lista.Add('\'); $lista.Add('\') }
      "`b"     { $lista.Add('\'); $lista.Add('b') }
      "`f"     { $lista.Add('\'); $lista.Add('f') }
      "`n"     { $lista.Add('\'); $lista.Add('n') }
      "`r"     { $lista.Add('\'); $lista.Add('r') }
      "`t"     { $lista.Add('\'); $lista.Add('t') }
      default  {
        if ([int]$c -lt 32) { foreach ($d in ('\u{0:x4}' -f [int]$c).ToCharArray()) { $lista.Add($d) } }
        else { $lista.Add($c) }
      }
    }
  }
  foreach ($c in '"}'.ToCharArray()) { $lista.Add($c) }
  $cuerpo = $lista.ToArray()
  $lista.Clear()
  $bytes = [Text.Encoding]::UTF8.GetBytes($cuerpo)

  Write-Host ''
  Write-Host 'Autenticando contra el endpoint público de Auth...' -ForegroundColor Cyan

  # La clave publicable sale del sitio publicado: es pública por diseño.
  $config = (Invoke-WebRequest -Uri 'https://la-taba.pages.dev/runtime-config.js' -UseBasicParsing).Content
  if ($config -notmatch "publishableKey:\s*'([^']+)'") { throw 'No pude leer la clave publicable del sitio.' }
  $apikey = $Matches[1]
  if ($config -notmatch $ref) { throw "El sitio publicado no apunta a $ref." }

  $cliente = New-Object System.Net.Http.HttpClient
  $contenido = New-Object System.Net.Http.ByteArrayContent(,$bytes)
  $contenido.Headers.ContentType = [System.Net.Http.Headers.MediaTypeHeaderValue]::Parse('application/json')
  $cliente.DefaultRequestHeaders.Add('apikey', $apikey)
  $respuesta = $cliente.PostAsync("$base/auth/v1/token?grant_type=password", $contenido).GetAwaiter().GetResult()
  $texto = $respuesta.Content.ReadAsStringAsync().GetAwaiter().GetResult()
  $contenido.Dispose()
  $cliente.Dispose()

  if (-not $respuesta.IsSuccessStatusCode) {
    # El cuerpo de error de GoTrue no contiene la contraseña.
    throw "Auth respondió $([int]$respuesta.StatusCode): $texto"
  }
  $sesion = $texto | ConvertFrom-Json
  $token = $sesion.access_token
  if ([string]::IsNullOrWhiteSpace($token)) { throw 'Auth no devolvió access_token.' }
  Write-Host 'Sesión abierta.' -ForegroundColor Green

} finally {
  # Borrar de verdad, pase lo que pase.
  if ($null -ne $bytes)  { [Array]::Clear($bytes, 0, $bytes.Length);  $bytes = $null }
  if ($null -ne $cuerpo) { [Array]::Clear($cuerpo, 0, $cuerpo.Length); $cuerpo = $null }
  if ($null -ne $clave)  { [Array]::Clear($clave, 0, $clave.Length);   $clave = $null }
  if ($bstr -ne [IntPtr]::Zero) { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr); $bstr = [IntPtr]::Zero }
  if ($null -ne $secure) { $secure.Dispose(); $secure = $null }
  [GC]::Collect()
  [GC]::WaitForPendingFinalizers()
}

# ── Aplicar y cerrar ─────────────────────────────────────────────────────────
try {
  Push-Location $repo
  try {
    $env:TMP = 'D:\1212\_catalog-images-tmp'
    $env:TEMP = 'D:\1212\_catalog-images-tmp'
    Write-Host ''
    $token | node scripts/catalog-images/apply-association.mjs
    $salida = $LASTEXITCODE
  } finally {
    Pop-Location
  }
} finally {
  if ($null -ne $token) {
    try {
      $cerrar = New-Object System.Net.Http.HttpClient
      $cerrar.DefaultRequestHeaders.Add('apikey', $apikey)
      $cerrar.DefaultRequestHeaders.Authorization =
        New-Object System.Net.Http.Headers.AuthenticationHeaderValue('Bearer', $token)
      $vacio = New-Object System.Net.Http.StringContent('')
      $cerrar.PostAsync("$base/auth/v1/logout", $vacio).GetAwaiter().GetResult() | Out-Null
      $vacio.Dispose(); $cerrar.Dispose()
      Write-Host ''
      Write-Host 'Sesión cerrada (token revocado).' -ForegroundColor Green
    } catch {
      Write-Host ''
      Write-Host "No pude revocar el token: $($_.Exception.Message)" -ForegroundColor Yellow
      Write-Host 'Caduca solo en una hora.' -ForegroundColor Yellow
    }
    $token = $null
  }
  [GC]::Collect()
}

Write-Host ''
if ($salida -eq 0) {
  Write-Host 'LISTO. Las 4 asociaciones quedaron aplicadas y verificadas.' -ForegroundColor Green
} else {
  Write-Host "TERMINÓ CON ERRORES (código $salida). Leé la salida de arriba." -ForegroundColor Red
}
exit $salida
