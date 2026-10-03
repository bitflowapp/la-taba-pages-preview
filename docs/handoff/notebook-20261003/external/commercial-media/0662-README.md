# Producción audiovisual TABA/TABA2

Esta carpeta contiene el material generado fuera del repositorio de producto.

## Entregables

- renders/TABA_PROMO_VERTICAL_1080x1920.mp4
- renders/TABA_PROMO_SHORT_1080x1920.mp4

## Fuentes y auditoría

- source-clips/: clips WebM capturados desde la app real en demo local.
- runtime/: recorrido cliente y confirmación.
- operations/: transición comercio/rider/seguimiento.
- capture-manifest.json: viewport, fuentes y recortes utilizados.
- render-manifest.json: duración, escenas, textos y salidas.
- audit-report.md: ruta Git, versión, funciones incluidas/excluidas y verificación.
- storyboard.md: especificación narrativa.

## Regeneración

1. Servir la copia validada de TABA:

   powershell -NoProfile -ExecutionPolicy Bypass -File C:\Users\marco\dev\la-taba-business-panel-automation\run-local.ps1 8123

2. Capturar las fuentes:

   $env:BASE='http://127.0.0.1:8123'; node artifacts/taba2-commercial/capture-promo.mjs

3. Renderizar los dos MP4:

   node artifacts/taba2-commercial/render-promo.mjs

El render no toca el código de TABA. Usa datos sintéticos del modo demo=1, escala una sola vez a 1080×1920, compone subtítulos ASS en zona segura y agrega únicamente una pista AAC silenciosa; no incorpora música comercial.
