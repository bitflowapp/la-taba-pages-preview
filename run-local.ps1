# La Taba - servidor local para probar la app/PWA antes de subir a GitHub Pages.
# Uso: clic derecho > "Ejecutar con PowerShell", o desde una terminal: ./run-local.ps1
# Requiere Python instalado. Abrí http://localhost:8080 en el navegador.

$ErrorActionPreference = 'Stop'
$port = 8080

Set-Location -Path $PSScriptRoot

$python = Get-Command python -ErrorAction SilentlyContinue
if (-not $python) {
    $python = Get-Command python3 -ErrorAction SilentlyContinue
}

if (-not $python) {
    Write-Host "No se encontró Python. Instalalo desde https://www.python.org/downloads/ y volvé a intentar." -ForegroundColor Red
    exit 1
}

Write-Host "Sirviendo La Taba en http://localhost:$port  (Ctrl+C para detener)" -ForegroundColor Green
& $python.Source -m http.server $port
