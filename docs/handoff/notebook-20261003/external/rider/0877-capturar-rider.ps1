# Las nueve pantallas de la ESCENA 3, capturadas del Moto G15 real.
#
# POR QUE EXISTE ESTE ARCHIVO
# ---------------------------
# Hasta el 2026-08-08 las nueve capturas venian de dos sesiones distintas y de
# dos momentos distintos del producto, y eso se notaba:
#
#   - las de `taba2-rider-map-redesign` (04/08) mostraban el comercio «Tercera
#     Docena - Diag. Espana 115», que ya no existe en el repositorio, con el pin
#     del negocio junto a Parque Central;
#   - las de `taba2-rider-commercial-redesign` (05/08) si decian «La Taba 2 -
#     Mendoza 827», pero mostraban «Mapa no disponible para este pedido: no hay
#     coordenadas autorizadas», que era cierto entonces y dejo de serlo cuando
#     la app paso a traer la coordenada del contrato central.
#
# Ahora las nueve salen de UNA corrida sobre UN build, asi que la escena es
# internamente coherente y ninguna pantalla afirma algo que el producto ya no
# hace.
#
# QUE BUILD
# ---------
# `commercialReview` (com.lataba.rider.review), que se instala AL LADO de
# staging y no lleva ninguna configuracion de backend: cada pantalla se alimenta
# de lib/review/review_fixtures.dart. No lee ni modifica un pedido real.
#
#   flutter build apk --debug --flavor commercialReview -t lib/main_review.dart
#   adb install -r build/app/outputs/flutter-apk/app-commercialreview-debug.apk
#
# El destino del cliente de los fixtures («Los Alamos 1450, Confluencia») es
# sintetico y no lleva coordenada a proposito -lo impone review_isolation_test-,
# asi que la app avisa que no puede ubicarlo. Ese aviso es producto real
# funcionando, no una falla de la captura.
param(
  [string]$Destino = (Join-Path $PSScriptRoot 'overlay\stills'),
  [string]$Serial  = 'ZY32LHS6PS'
)

$ErrorActionPreference = 'Stop'
$PKG = 'com.lataba.rider.review'

# y real de cada tile del menu DESPUES de un swipe hacia arriba de 900 px,
# sobre 1080x2400 a densidad 400. Si cambia el equipo, esto se recalcula.
$Y = @{ 2 = 246; 3 = 470; 4 = 734; 5 = 960; 6 = 1186; 7 = 1411; 8 = 1636; 9 = 1860; 10 = 2086 }

$PLAN = @(
  @{ n = 2;  archivo = 'rider-1-buscando.png'     }
  @{ n = 3;  archivo = 'rider-2-nuevo.png'        }
  @{ n = 5;  archivo = 'rider-3-retiro.png'       }
  @{ n = 6;  archivo = 'rider-4-retirado.png'     }
  @{ n = 7;  archivo = 'rider-5-mapa.png'         }
  @{ n = 8;  archivo = 'rider-6-llegaste.png'     }
  @{ n = 8;  archivo = 'rider-7-codigo.png'; codigo = $true }
  @{ n = 9;  archivo = 'rider-8-entregado.png'    }
  @{ n = 10; archivo = 'rider-9-sin-conexion.png' }
)

function AbrirEscenario($n) {
  & adb -s $Serial shell am force-stop $PKG | Out-Null
  Start-Sleep -Milliseconds 700
  & adb -s $Serial shell monkey -p $PKG -c android.intent.category.LAUNCHER 1 | Out-Null
  Start-Sleep -Seconds 6
  & adb -s $Serial shell input swipe 540 1800 540 900 300 | Out-Null
  Start-Sleep -Milliseconds 900
  & adb -s $Serial shell input tap 540 $Y[$n] | Out-Null
  # El mapa pide sus tiles por red: sin esta espera la captura sale a medio pintar.
  Start-Sleep -Seconds 7
}

New-Item -ItemType Directory -Force -Path $Destino | Out-Null
foreach ($p in $PLAN) {
  AbrirEscenario $p.n
  if ($p.codigo) {
    & adb -s $Serial shell input tap 540 2179 | Out-Null   # «Ingresar codigo»
    Start-Sleep -Seconds 3
    & adb -s $Serial shell input text 4321 | Out-Null      # reviewDeliveryCodeHint
    Start-Sleep -Seconds 2
  }
  # El encuadre del compositor: se recorta la barra de navegacion y se baja de
  # escala a 864x1824, que es 2x del telefono en cuadro (432x912 CSS). Bajar de
  # escala rasteriza de nuevo y queda nitido; ampliar, no.
  $ruta = Join-Path $Destino $p.archivo
  & adb -s $Serial shell screencap -p /sdcard/taba-cap.png | Out-Null
  & adb -s $Serial pull -a /sdcard/taba-cap.png "$env:TEMP\taba-cap.png" | Out-Null
  & ffmpeg -y -v error -i "$env:TEMP\taba-cap.png" -vf 'crop=1080:2280:0:0,scale=864:1824:flags=lanczos' $ruta
  Write-Output ("escenario {0,2} -> {1}" -f $p.n, $p.archivo)
}
& adb -s $Serial shell rm -f /sdcard/taba-cap.png | Out-Null
