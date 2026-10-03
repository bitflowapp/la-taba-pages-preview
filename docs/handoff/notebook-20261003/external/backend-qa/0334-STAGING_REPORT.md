# TABA — catálogo QA, pedido real y rider Moto G15

## Veredicto de esta iteración

**STAGING QA FUNCIONAL PARCIAL — no emitir `TABA_FUNCTIONAL_STAGING_AND_MOTO_RIDER_READY`.**

La persistencia real de staging, el flujo de negocio/rider, Auth, RLS, delivery
code, Realtime y el frontend HTTPS quedaron probados con datos sintéticos. El
catálogo es exclusivamente QA y no es aprobación comercial. La certificación
física del Moto queda pendiente porque el dispositivo detectado está bloqueado
y no se pudo conceder ubicación ni obtener GPS físico.

Producción continúa bloqueada hasta recibir catálogo, precios, assets y derechos
aprobados.

## Fuente y worktree

- Fuente: `C:\1212\la-taba-mostador-patagonico`
- Rama fuente: `feature/mostrador-patagonico-v1`
- HEAD fuente verificado: `2e5f02b5d201f9addbe6d1d1a8f8b5aa900bbde0`
- Fuente limpia y sin modificaciones.
- Worktree: `C:\1212\la-taba-real-orders-staging`
- Rama staging: `staging/real-orders-walter`
- HEAD staging base: `2e5f02b5d201f9addbe6d1d1a8f8b5aa900bbde0`
- HEAD staging final: `23e57ad447e31a82b3d3bfdbc5992582ae88d98b`

## Supabase staging

- Proyecto: `la-taba-staging`
- Ref: `ukxqbgswjlibmnjemrzd`
- Región: `us-east-1`
- Estado observado: `ACTIVE_HEALTHY`
- Migraciones locales/remotas: `19/19`, todas coincidentes.
- `supabase db push --linked --dry-run`: `Remote database is up to date`.
- Migraciones nuevas aplicadas sólo a staging:
  - `20260731230000_staging_qa_fixture_catalog.sql`
  - `20260731231000_staging_qa_product_verification.sql`
- `supabase/.gitignore` y `supabase/config.toml` se conservan: son
  configuración estándar de la CLI, no contienen claves ni secretos.

Auth anónimo se habilitó únicamente en staging. Las cuentas sintéticas de
negocio y rider tienen membresías activas. El frontend usa sólo la clave pública
de runtime; `service_role` no está en frontend, Git, artefactos ni logs.

## Catálogo QA privado

Se importaron y publicaron operacionalmente 8 SKUs existentes en el catálogo
demo local, mediante las RPCs QA autorizadas. Todos tienen:

- `catalog_origin=demo_fixture`;
- `rights_status=UNAPPROVED_QA`;
- `approved_at` y `approved_by` nulos;
- asset local existente y cargable;
- precio positivo, stock positivo y disponibilidad pública de staging.

SKUs: Coca-Cola Original PET 500 ml pack x12; Coca-Cola Original PET 1500 ml
pack x6; Sprite Original PET 1500 ml pack x6; Red Bull Original lata 250 ml;
Speed Original lata 473 ml; Heineken Original lata 473 ml; Imperial APA lata
473 ml; Fanta Naranja PET 1500 ml pack x6.

Verificación remota: productos `8`, precios positivos `8`, stock disponible
`8`, imágenes locales verificadas `16`, categorías Gaseosas/Cervezas/Energéticas.
Hay packs. **No existe un SKU ni asset de agua en el catálogo demo autorizado**;
por eso `waterSku=null` y el requisito de agua queda bloqueado sin inventar
datos.

CSV y manifiesto: `qa-catalog/QA_CATALOG.csv` y
`qa-catalog/QA_CATALOG_MANIFEST.json`. Este lote es `staging_only`/QA y no
habilita una publicación comercial.

## Pedidos persistentes y seguridad

### Pedido real QA entregado

- Pedido: `89b18625-9580-4c9e-adb1-f5dd281783f4`
- Código público: `LT-0001`
- Pago: efectivo.
- Estado final remoto: `delivered`.

Se ejecutó con clientes independientes de cliente, negocio y rider. Se guardó
Perfil y dirección; el negocio recuperó el pedido después de abrir; avanzó
`received → accepted → preparing → ready`; el rider lo reclamó y avanzó
`assigned → picked_up → on_the_way → arrived`; un código incorrecto devolvió
`MISMATCH`; el código correcto completó la entrega. Tras renovar sesiones,
cliente y negocio volvieron a leer `delivered` desde staging.

Se observaron callbacks Realtime de pedidos/eventos (13 callbacks, incluyendo
`order.status_changed` y `order.delivery_handoff_confirmed`). El historial
remoto del pedido contiene 11 eventos.

### Pedido activo para la demostración del rider

- Pedido: `0655ad17-1763-43e5-b275-e005401f5a57`
- Código público: `LT-0002`
- Pago: efectivo.
- Estado remoto actual: `on_the_way`, rider asignado.

Este pedido se creó desde la UI HTTPS con una sesión anónima de cliente,
Perfil, dirección, catálogo QA y checkout. Negocio y rider lo recuperaron desde
Supabase en sesiones separadas; el rider web muestra el pedido activo y el
control de GPS real. El valor secreto del delivery code no aparece en las
vistas de negocio/rider; sólo se ven metadatos operativos como
`delivery_code_required`.

La prueba de RLS incluyó aislamiento del cliente, alcance por negocio y cola de
rider. La transición inválida `received → delivered` fue rechazada. La lectura
directa del handoff por el cliente fue denegada. El GPS sólo puede publicarse
por `publish_rider_location`, para el rider asignado, con `source='gps'`,
precisión y frecuencia acotadas.

## Enlaces HTTPS

El frontend se sirvió desde el worktree staging con configuración runtime de
Supabase staging y una URL pública temporal HTTPS. No usa `demo=1`, relay ni
datos inventados.

- Cliente: `https://dresses-happiness-original-leaders.trycloudflare.com/`
- Negocio: `https://dresses-happiness-original-leaders.trycloudflare.com/#business`
- Rider: `https://dresses-happiness-original-leaders.trycloudflare.com/#rider`
- Tracking: `https://dresses-happiness-original-leaders.trycloudflare.com/#tracking`

El enlace de tracking requiere la sesión/token del cliente en el mismo
navegador; el token no se guarda en este reporte ni en `LIVE_LINKS.txt`. El
quick tunnel es temporal y sólo sirve para QA privado, no es deploy productivo.

## Moto G15

`adb devices -l` detectó:

- serial: `ZY32LHS6PS`;
- modelo: `moto_g15`;
- producto: `lamu_g` / device `lamu`;
- Android: `15`.

Se lanzó la URL rider mediante ADB equivalente a `am start` y se guardó
`moto-01-rider-open.png`. El dispositivo quedó en pantalla de bloqueo. No se
pudo iniciar sesión Chrome, conceder ubicación precisa, abrir el pedido, ver
MapLibre ni publicar GPS físico. No se usó `adb geo fix`, coordenadas simuladas
ni ningún fallback de simulación; por lo tanto mapa, marcador y GPS físico no
se declaran PASS.

Se verificó el ciclo apagar/encender pantalla, pero el retorno siguió en la
pantalla de bloqueo. Capturas del Moto: `moto-01-rider-open.png` y
`moto-02-screen-return-locked.png`. Capturas web de apoyo:
`business-lt0002.png` y `rider-lt0002.png`.

## Gates

- `npm run check`: PASS.
- `npm test`: 605/605 PASS.
- `npm run migrations:validate`: PASS; 19 migraciones revisadas.
- `npm run catalog:images:verify`: PASS técnico del demo; 22 productos/44 WebP
  demo, 0 imágenes comerciales aprobadas.
- `npm audit --audit-level=high`: 0 vulnerabilidades.
- `git diff --check`: PASS.

## Límites comerciales y seguridad

El lote QA sólo demuestra funcionamiento técnico privado. No marca derechos,
precios ni catálogo como aprobados y no habilita producción. Falta el SKU/asset
de agua del catálogo autorizado y falta la aprobación humana del catálogo real.

No se guardaron contraseñas, JWT, tokens de tracking, delivery codes, API keys
ni `service_role` en reportes, logs o frontend. No hubo push, merge, cambio en
`main` ni deploy productivo.
