# Threat model del tracking público

## Activo y atacante

El enlace de tracking es un bearer: quien obtiene el token puede ver el estado
mínimo mientras sea válido. Se consideran filtración por historial, captura,
referer, logs, fuerza bruta, enumeración y reutilización posterior a la entrega.

## Controles

- Token generado con CSPRNG en el cliente, mínimo 32 bytes base64url.
- Sólo SHA-256 se persiste; el texto plano se devuelve una vez y vive en
  `sessionStorage`.
- Comparación por hash, UUID/código más token y respuesta nula uniforme.
- Expiración obligatoria, revocación por cliente o equipo y revocación operativa.
- RPC `get_public_order_tracking` como única superficie anónima.
- Sin SELECT anónimo de `orders`, `order_items`, `order_events`,
  `rider_locations` ni `order_public_tokens`.
- Polling: el token no entra en canales Realtime, query strings ni logs. La
  vista Tracking mantiene una única solicitud abortable y un ciclo de cinco
  segundos sólo durante reparto; al salir, vencer/revocar o entregar se corta.
- Ubicación redondeada (~100 m) sólo durante entrega activa; no hay historial.

## DTO permitido

Código público, estado, timestamps operativos, ETA aproximada, indicador
entregado y última ubicación aproximada sólo cuando hace falta. Actualmente se
omite el alias del rider porque no existe una fuente aprobada y minimizada.

Quedan expresamente fuera: teléfono, email, dirección, notas, UUID internos,
Auth IDs, membresías, ítems, totales, hashes, tokens y coordenadas históricas.

## Pruebas necesarias en staging

Token válido/incorrecto/expirado/revocado, código enumerado, pedido ajeno,
respuesta terminal sin GPS y revisión de logs/proxy para verificar que el header
no se registra. La rotación automática de token puede agregarse si el negocio
requiere enlaces de vida más corta.

La política de frescura en cliente es: fresco hasta 15 s, demorado hasta 45 s y
perdido después. En los dos últimos casos se puede conservar el último punto
redondeado, pero nunca se inventa movimiento, ruta ni ETA.
