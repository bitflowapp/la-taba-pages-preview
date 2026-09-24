# Piloto comercial controlado — compuertas y operación

Alcance inicial: un comercio autorizado, hasta tres Riders y unos veinte clientes.
Los pedidos y cobros reales empiezan únicamente después de que todos los gates
de esta página pasen y se publique el SHA exacto. El proyecto QA no representa
una venta real ni acredita efectivo.

## Estado de esta candidata

- Cliente y panel Staging: <https://taba2-staging.pages.dev/> y
  <https://taba2-staging.pages.dev/#business>.
- Backend Staging: `ucbtjcurawxjwjdvvcvj`; Producción: `wwcpogltfgzgkrlilbcd`.
- APK QA coexistente: `com.lataba.rider.qa`. APK piloto independiente:
  `com.lataba.rider.pilot` vCode 3 / `0.1.2-canonical-pilot`, salida de
  `build-rider-pilot.mjs` firmada con clave exclusiva del piloto. Las vCode 1 y
  2 están conservadas para rollback. La v3 pasó el tramo QA de 20 minutos con
  pantalla apagada y un E2E firmado; no actualiza la v146 histórica.
- Mercado Pago WCS-51579: pendiente de soporte. No sustituir Checkout Pro por
  `/v1/card_tokens` o `/v1/payments`.
- Catálogo publicado actual, sólo lectura: 34 productos activos comprables y
  68 imágenes decodificadas en Chromium y WebKit. El catálogo del comercio QA
  Staging sigue siendo fixture y no sustituye la carga/aprobación del comercio
  real para un lanzamiento.
- Cobro alternativo: `cash` o `coordinate` en pedido, estado manual `pending` →
  `confirmed` → `reversed`. Lo confirma personal del negocio después de recibir
  el dinero; la devolución exige dueño/admin y dinero ya devuelto. Ninguno de
  estos pasos crea un `payment_intent` ni invoca un refund de MP.

## Gate de publicación

| Compuerta | Evidencia exigida |
|---|---|
| Web | CI del SHA, Chromium/WebKit sin fallos de producto P0/P1, cache identity nueva |
| Backend | Migraciones locales = Staging; RLS, roles y migración compensatoria revisados |
| Pedido | Cliente UI → panel → Android → tracking/código → terminal, sin SQL de estado |
| Cobro manual | Pendiente, confirmación, replay, roles, devolución y stock en QA |
| Rider | Firma del paquete `.pilot`, presencia compartida y GPS físico prolongado |
| Reversibilidad | Ensayo web, configuración, APK y recuperación de datos en entorno seguro |
| Seguridad | Secret scan del repo, artifacts y APK; ningún secreto privado en clientes |

Si falta una compuerta, se conserva Staging y se deja `COMMERCIAL_PILOT_READY=NO`.
El estado de MP se informa por separado: `ONLINE_PAYMENTS_READY=NO` mientras
WCS-51579 siga abierto. La firma histórica faltante no impide probar `.pilot`,
pero tampoco autoriza reemplazar `com.lataba.rider`.

## Onboarding controlado

**Comercio:** comprobar identidad y autorización de su dueño; crear negocio y
cuenta de equipo en el entorno aprobado; configurar horario, cobertura,
delivery/retiro, medio de cobro manual, precios, stock y fotos con derechos;
validar un pedido de prueba antes de aceptar personas reales. No copiar el
catálogo QA como comercial. La cuenta real de Walter y el seller MP real no son
identidades de prueba.

**Rider:** provisionar hasta tres membresías activas; instalar el APK piloto
firmado, verificar fingerprint, login y disponibilidad visible en el panel;
conceder ubicación precisa y notificaciones. La disponibilidad caduca a los
90 segundos sin renovación. La entrega activa sigue necesitando el servicio
GPS en primer plano; un teléfono sin ruta de Internet no transmite tracking.

**Cliente:** provisionar un grupo conocido de 10–20 cuentas; confirmar dirección
y zona, explicar pago al recibir/retirar o medio acordado con el local y pedir
el código de cuatro dígitos al entregar. No anunciar alta pública por correo
si SMTP/confirmación no quedó probado.

**Soporte:** conservar el código público del pedido, hora, estado, versión de
web/APK, rol del operador y error RPC sanitizado. No copiar tokens, contraseña,
ubicación exacta ni código de entrega en tickets.

## Pedido trabado

1. Abrir `Pedidos` y consultar la tarjeta; usar `Actualizar` para confirmar
   estado y revisión del servidor. Dos operadores trabajan con la misma revisión:
   ante conflicto se relee, no se reenvía ciegamente.
2. Si Rider figura disponible pero no recibe oferta, revisar su membresía,
   capacidad 0–3, versión de APK y conexión. La oferta se propone desde el panel;
   el Rider decide desde Android. No asignar por SQL.
3. Si GPS queda viejo, comprobar servicio foreground y conectividad del móvil.
   Avisar al cliente por el canal existente. Sin posición fresca, no prometer
   ETA ni usar coordenadas simuladas.
4. Si el pedido no salió, cancelarlo desde el panel con motivo; confirmar que
   el stock volvió una sola vez. Si ya se retiró mercadería, reconciliar el
   retorno físico antes de un movimiento de inventario auditado. Nunca sumar
   stock por un reparto que aún está en la calle.
5. Si había cobro manual confirmado, dueño/admin registra la devolución ya
   realizada en `Pagos` y recién después cancela. Un pago MP exige su flujo
   financiero propio; la devolución manual no genera un refund MP.
6. Si hubo entrega, Rider solicita el código al cliente y finaliza con la RPC
   normal. El equipo no lo adivina ni marca `delivered` por SQL. Escalar
   incidentes sin código con trazas de `order_events` y recibos, saneadas.

## Rollback

Web: conservar ID y SHA del deployment anterior del proyecto de piloto, probar
su URL inmutable y compatibilidad con la base antes de promoverlo. En Cloudflare
Pages sólo un deployment de producción del proyecto es objetivo de rollback;
una preview no lo es. Ver [documentación oficial](https://developers.cloudflare.com/pages/configuration/rollbacks/).

Base: las migraciones aplicadas son hechos históricos. Usar una migración
compensatoria o un forward fix probado; no borrar filas del historial ni ejecutar
`DROP` ciego con pedidos activos. Para aislar la política Rider se puede
desactivar por negocio con `set_business_rider_presence_policy` mientras se
investiga, sin deshacer otras migraciones.

APK: mantener el APK firmado anterior de `com.lataba.rider.pilot` con la misma
clave y versión instalable. Al bajar versión puede hacer falta desinstalar la
variante piloto y volver a instalarla; la sesión local se perderá, los pedidos
siguen en el servidor. Nunca desinstalar `com.lataba.rider` v146 como atajo.

Configuración: guardar el runtime público previo, hash y proyecto Supabase
esperado. La restauración debe verificar desde el dominio público que web y
backend pertenecen al mismo entorno. No copiar secretos entre proyectos.

Un README no es el ensayo: registrar deployment restaurado, consulta de pedido
QA después de volver, estado de presencia, APK instalada y hash de runtime.

### Ensayos parciales del 2026-09-23

- La configuración de disponibilidad Rider del negocio QA se desactivó y
  restauró por RPC, sin afectar otros negocios; el estado volvió a `true`.
- La base pasó el restore aislado de CI y la devolución manual de inventario QA
  dejó el stock exactamente en su valor anterior tras un pedido cancelado.
- Los pedidos QA `LT-0035` a `LT-0041` se crearon desde la UI cliente y se
  operaron desde el panel en pruebas de coordinación con el APK piloto firmado.
  Android completó por GPS/código real `LT-0036`, `LT-0037`, `LT-0038` y
  `LT-0041`; el backend dejó estado terminal y las cuentas/pedidos de ensayo
  se clasificaron QA con stock restaurado. `LT-0035`, `LT-0039` y `LT-0040`
  terminaron cancelados por el limpiador de QA. No se falsificaron estados por
  SQL. El ensayo integral final `LT-0042` pasó sobre el APK piloto firmado:
  pedido por UI cliente, transiciones y oferta por panel, aceptación Android,
  GPS real publicado y visible como marcador en cliente, estado en reparto en
  panel, código incorrecto rechazado, código correcto aceptado y terminal en
  cliente/panel/backend. El observador público vio `location_quality` pasar de
  `unavailable` a `low_accuracy` con punto publicable, sin guardar coordenadas
  ni token; Android terminó `OK (1 test)`. Pedido QA clasificado, stock repuesto
  exactamente y credencial efímera eliminada. Antes de ese éxito, el servidor
  QA omitía `/styles/` y la red produjo `initial-style-timeout` de OpenFreeMap;
  ambos casos se distinguieron del contrato GPS y no se declararon PASS.
- En Moto G15 se instaló `com.lataba.rider.pilot` vCode 2 con la misma firma,
  se desinstaló **sólo esa variante** y se reinstaló el APK firmado vCode 1
  desde la copia local verificada. La aplicación arrancó y la v146 histórica
  `com.lataba.rider` conservó su versión. La desinstalación borra la sesión
  local de la variante piloto; el pedido y la disponibilidad viven en Staging.
- Se repitió el ensayo con v3→v2→v3, todas firmadas con el certificado piloto.
  El downgrade directo fue rechazado por Android; la reinstalación controlada
  de `.pilot` restauró v2 y luego v3, sin tocar la v146. El E2E físico v3 QA
  entregó `LT-0033` y el E2E del APK firmado entregó `LT-0034` por código;
  ambos pedidos se clasificaron QA y repusieron stock. El segundo se completó
  antes de que el observador live entrara al panel, pero la lectura UI posterior
  verificó estado final exacto en panel y cliente.
- El candidato `bcea25fd8d3ffe088dbf6ea6f3bfa2dbc3b79852` se publicó
  **sólo en Staging** el 2026-09-23: workflow de GitHub y smoke público PASS,
  runtime `la-taba-runtime-v114-commercial-pilot`, destino Cloudflare
  `taba2-staging / staging`, backend `ucbtjcurawxjwjdvvcvj`. El 2026-09-24
  el workflow [35934832771](https://github.com/bitflowapp/la-taba-pages-preview/actions/runs/35934832771)
  publicó la segunda candidata compatible `81335a3` sólo en ese proyecto:
  smoke público PASS. Luego Cloudflare hizo rollback real al deployment
  `fdb5a1ec` y el dominio volvió a `bcea25f`/v114: smoke público PASS. El
  post-rollback confirmó login/bandeja del panel QA, lectura del pedido QA
  entregado `LT-0041` y catálogo cliente. `ROLLBACK_DRILL=PASS` en entorno
  Staging; las tres variables temporales del workflow se eliminaron. Es un
  ensayo entre SHAs distintos pero web/backend compatibles; no demuestra un
  rollback de un cambio de esquema incompatible. `main` tampoco es una vuelta
  segura para un piloto de cobro manual: no contiene
  `confirm_manual_order_payment` en la web.
- El paquete Staging se puede preparar sin secretos privados mediante
  `node scripts/deploy/preparar-staging-pilot.mjs --commit <SHA completo>`.
  El builder exige el runtime público del proyecto `ucbtjcurawxjwjdvvcvj`,
  verifica su identidad, sella el SHA y escanea todo `dist_staging_pilot/`.
  La preparación local no despliega; sólo el workflow con SHA exacto publicó
  la v114 y verificó el dominio público.

Cuando el E2E físico y los demás gates estén cerrados, el workflow
`deploy-staging-pilot.yml` se arma **sólo** para el SHA exacto de un commit aún
local. Antes de hacer push, registrar las variables de repositorio
`STAGING_DEPLOY_SHA=<SHA>` y `STAGING_DEPLOY_PROJECT=taba2-staging`; el push a
`release/taba-commercial-pilot` dispara ese workflow. Si las variables no
coinciden exactamente, el job queda omitido. Espera la CI web y Android del
mismo SHA, comprueba que la rama no avanzó, verifica el proyecto Cloudflare,
prepara el artefacto y revisa el dominio/archivos después de publicar. Para
un drill de rollback se arma además `STAGING_ROLLBACK_DRILL_SHA=<SHA>`; el
workflow captura el ID anterior antes del deploy y lo restaura después del
smoke del candidato. Borrar las variables al terminar; no contienen secretos.
El workflow de Producción
permanece separado, sin cambios y restringido a `main`.

Antes de publicar un piloto real, comprobar de nuevo que el deployment previo
del proyecto **piloto** es compatible con la base efectiva; no promover por
inercia el `main` histórico.
