# La Taba - servidor local para probar la app/PWA antes de subir a GitHub Pages.
# Uso: clic derecho > "Ejecutar con PowerShell", o desde una terminal: ./run-local.ps1
# Requiere Python instalado. Abrí http://localhost:8080 en el navegador.

$ErrorActionPreference = 'Stop'
$port = if ($args.Count -ge 1 -and $args[0] -match '^\d+$') { [int]$args[0] } else { 8080 }

Set-Location -Path $PSScriptRoot

$python = Get-Command python -ErrorAction SilentlyContinue
if (-not $python) {
    $python = Get-Command python3 -ErrorAction SilentlyContinue
}

if (-not $python) {
    Write-Host "No se encontró Python. Instalalo desde https://www.python.org/downloads/ y volvé a intentar." -ForegroundColor Red
    exit 1
}

# Servidor sin caché. `python -m http.server` a secas responde sin
# `Cache-Control`, así que el navegador aplica caché heurística: en una revisión
# visual sobre un teléfono real eso significa medir un build viejo sin darse
# cuenta. Pasó: el Moto conservó `styles/tokens.css` y las tarjetas aparecieron
# sin fondo porque el token de superficie llegaba vacío. Parecía un defecto de
# producto y era la caché.
$server = @'
import sys
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

class NoCacheHandler(SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header('Cache-Control', 'no-store, no-cache, must-revalidate')
        self.send_header('Pragma', 'no-cache')
        SimpleHTTPRequestHandler.end_headers(self)

ThreadingHTTPServer(('0.0.0.0', int(sys.argv[1])), NoCacheHandler).serve_forever()
'@

$lan = (Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue |
    Where-Object { $_.IPAddress -notlike '127.*' -and $_.IPAddress -notlike '169.254.*' -and $_.PrefixOrigin -eq 'Dhcp' } |
    Select-Object -First 1 -ExpandProperty IPAddress)

Write-Host "Sirviendo La Taba en http://localhost:$port  (Ctrl+C para detener)" -ForegroundColor Green
if ($lan) {
    Write-Host "Desde el celular en la misma red: http://${lan}:$port/index.html?demo=1" -ForegroundColor Green
}

# El handler va a un archivo y no a `python -c`: pasar un script multilínea como
# argumento depende de cómo cada shell de Windows arma la línea de comandos, y
# ahí se rompe en silencio.
$handlerPath = Join-Path ([System.IO.Path]::GetTempPath()) 'taba-dev-preview.py'
Set-Content -Path $handlerPath -Value $server -Encoding UTF8
& $python.Source $handlerPath $port
