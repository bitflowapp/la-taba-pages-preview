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
  `com.lataba.rider.pilot`, salida de `build-rider-pilot.mjs` firmada con clave
  exclusiva del piloto. No actualiza la v146 histórica.
- Mercado Pago WCS-51579: pendiente de soporte. No sustituir Checkout Pro por
  `/v1/card_tokens` o `/v1/payments`.
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
