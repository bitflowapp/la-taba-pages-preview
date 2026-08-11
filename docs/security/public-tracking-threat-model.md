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
- Ubicación redondeada a cuatro decimales (~11 m) sólo durante entrega activa;
  no hay historial. La precisión informada nunca se presenta mejor que 100 m.
- Sólo se entrega el **último** punto, elegido por hora de captura del
  dispositivo. El contador interno de recibos ordena del lado del servidor y no
  viaja: diría cuántos fixes publica el negocio.

### Por qué ~11 m y no ~100 m

El redondeo original era de tres decimales (~111 m). Medido sobre un recorrido
físico real de 931 m con 85 fixes: el cliente veía **cuatro posiciones
distintas** en toda la caminata, el marcador saltaba de a 86–141 m donde el
rider había caminado 7–177 m, y volvía a una celda ya abandonada 80 veces. El
motor de movimiento anima cada uno de esos rebotes, de modo que el seguimiento
se leía como un rider que vuelve al principio y repite calles.

| decimales | posiciones visibles | error mediano | error máximo |
| --- | --- | --- | --- |
| 3 | 4 | 28,0 m | 66,0 m |
| **4** | **17** | **2,4 m** | **6,2 m** |
| 5 | 50 | 0,4 m | 0,7 m |

Cuatro decimales dejan el error de redondeo (2,4 m) **por debajo de la precisión
real del GPS** medida en ese mismo recorrido (mediana 12,1 m). Es decir: la
coordenada publicada no afirma nada que el círculo de precisión no afirme ya, y
el atacante que tiene el token no gana resolución por encima del ruido del
propio sensor. El cambio fue autorizado explícitamente por quien tomó la
decisión de privacidad original.

## DTO permitido

Código público, estado, timestamps operativos, ETA aproximada, indicador
entregado y última ubicación aproximada sólo cuando hace falta —con su hora de
captura—. Actualmente se omite el alias del rider porque no existe una fuente
aprobada y minimizada.

Quedan expresamente fuera: teléfono, email, dirección, notas, UUID internos,
Auth IDs, membresías, ítems, totales, hashes, tokens, coordenadas históricas,
coordenada sin redondear y el número de recibo de la ubicación.

## Pruebas necesarias en staging

Token válido/incorrecto/expirado/revocado, código enumerado, pedido ajeno,
respuesta terminal sin GPS y revisión de logs/proxy para verificar que el header
no se registra. La rotación automática de token puede agregarse si el negocio
requiere enlaces de vida más corta.

La política de frescura en cliente es: fresco hasta 15 s, demorado hasta 45 s y
perdido después. En los dos últimos casos se puede conservar el último punto
redondeado, pero nunca se inventa movimiento, ruta ni ETA.
