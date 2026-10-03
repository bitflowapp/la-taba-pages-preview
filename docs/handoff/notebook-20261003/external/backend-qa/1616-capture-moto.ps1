param(
  [string]$Serial = 'ZY32LHS6PS',
  [string]$BaseUrl = 'http://192.168.1.39:4190/?demo=1',
  [string]$OutDir  = 'D:\1212\taba2-gate-20260804\moto'
)

$ErrorActionPreference = 'Stop'
$adb = "$env:LOCALAPPDATA\Android\Sdk\platform-tools\adb.exe"
New-Item -ItemType Directory -Force $OutDir | Out-Null

function Grab([string]$name) {
  Start-Sleep -Milliseconds 2600
  & $adb -s $Serial exec-out screencap -p > "$OutDir\$name.png"
  $sz = (Get-Item "$OutDir\$name.png").Length
  Write-Output ("  captura {0,-28} {1,8:N0} bytes" -f $name, $sz)
}

function Go([string]$hash, [string]$name) {
  $url = "$BaseUrl$hash"
  Write-Output "-> $url"
  & $adb -s $Serial shell am start -a android.intent.action.VIEW -d "`"$url`"" com.android.chrome | Out-Null
  Start-Sleep -Milliseconds 1200
  Grab $name
}

function Tap([int]$x, [int]$y, [string]$name) {
  & $adb -s $Serial shell input tap $x $y | Out-Null
  Grab $name
}

function Swipe([int]$x1,[int]$y1,[int]$x2,[int]$y2,[int]$ms,[string]$name) {
  & $adb -s $Serial shell input swipe $x1 $y1 $x2 $y2 $ms | Out-Null
  Grab $name
}

Write-Output "== dispositivo =="
& $adb -s $Serial shell getprop ro.product.model
& $adb -s $Serial shell wm size
& $adb -s $Serial shell wm density

Write-Output "== capturas =="
Go '#home'     '01-home'
Swipe 540 1700 540 700 320 '02-home-scroll1'
Swipe 540 1700 540 700 320 '03-home-scroll2'
Swipe 540 1700 540 700 320 '04-home-scroll3'

Go '#catalog'  '05-catalogo'
Go '#cart'     '06-carrito'
Go '#tracking' '07-seguimiento'
Go '#profile'  '08-perfil'

Write-Output "Listo. Salida en $OutDir"
