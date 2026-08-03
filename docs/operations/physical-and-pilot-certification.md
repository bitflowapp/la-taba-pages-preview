# Certificación física y piloto controlado

## Estado de esta etapa

Scanner, impresoras, Moto G15, iPhone y redes reales están `NOT_RUN` para este
release candidate. Ninguna captura o test automatizado reemplaza la observación
física. Al ejecutar cada sesión se debe registrar modelo, identificador no
sensible, versión de SO, driver, HEAD/build, hora, operador, resultado real y
evidencia sanitizada.

## Scanner

Ejecutar al menos veinte lecturas representativas y registrar cada resultado:

- EAN-8, UPC-A, EAN-13 y GTIN-14;
- ceros iniciales conservados;
- secuencia rápida y códigos repetidos;
- código conocido con factor de pack correcto;
- código desconocido sin mutación;
- desconexión, intento durante desconexión y reconexión;
- cambio de foco y lectura accidental fuera del campo de scanner;
- doble lectura con idempotencia/feedback operativo.

Confirmar que ninguna lectura produce stock negativo y que packing/POS usan el
barcode y factor autorizados por PostgreSQL.

## Impresora térmica

Imprimir ticket completo con caracteres españoles, totales y QR autorizado;
verificar legibilidad y corte. Probar falta de papel, offline, reconexión,
duplicado explícito y reinicio del spooler. Distinguir siempre `queued`,
`sent_to_spooler`, `completed_when_verifiable`, `failed` y `unknown`. La vista
del papel es la evidencia; aceptar bytes no demuestra impresión.

## Impresora A4

Probar preview, descarga autenticada, escala al 100 %, QR legible, una y varias
páginas, selección de impresora, cantidad acotada y reimpresión. Comparar hash
del PDF descargado con metadata y verificar que reimprimir no cambia CAE,
número ni artefacto actual.

## Rider Moto G15 P0

Con la build Rider asociada al manifest ejecutar: GPS en movimiento, pantalla
apagada, background, Wi-Fi a datos, datos a Wi-Fi, modo avión y recuperación;
permiso rechazado/revocado; batería optimizada; notificación y navegación al
pedido correcto; código incorrecto, rate limit y correcto; entrega; GPS
detenido; foreground service detenido; reinicio. Validar que el Rider no ve
otros negocios y que una transición obsoleta falla por CAS.

## iPhone y redes

Medir carga, catálogo, búsqueda, carrito, checkout y tracking en un iPhone
físico. Repetir en Wi-Fi, datos móviles y red degradada real. Registrar p50/p95,
errores y condiciones de señal; no trasladar los números del viewport emulado.

## Piloto controlado propuesto

El piloto queda limitado a un negocio, un punto de venta, uno o dos Riders,
horario acotado y catálogo aprobado con precio/stock confirmados. Requiere:

- responsable técnico disponible durante toda la ventana;
- fallback manual legal y contablemente aprobado;
- monitoreo de alertas, workers, pagos, Rider, fiscal y backups;
- cierre inmutable y revisión al final de cada jornada;
- registro de cada incidente, impacto, correlación y recuperación;
- criterio de pausa por dinero sin pedido, duplicación, stock negativo, CAE
  ambiguo, pérdida de datos o ausencia de soporte;
- rollback con los mismos artefactos firmados y hashes del manifest.

La duración se decide después de observar volumen, tasa de incidentes y cierres
reales; este documento no inventa una cantidad de días. Iniciar el piloto exige
la confirmación exacta `I_AUTHORIZE_TABA2_CONTROLLED_PRODUCTION_PILOT`, que no
fue recibida en esta etapa.

## Gates separados

- Mercado Pago productivo requiere revisión aprobada. Un pago real controlado
  además exige `I_AUTHORIZE_REAL_MERCADOPAGO_PAYMENT_SMOKE`.
- Homologación ARCA exige `I_AUTHORIZE_ARCA_HOMOLOGATION` y credenciales de
  homologación completas.
- Emisión ARCA productiva exige la confirmación distinta
  `I_AUTHORIZE_ARCA_PRODUCTION_ISSUANCE`.
- El piloto exige su propia confirmación y no habilita un lanzamiento masivo.

