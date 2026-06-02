# Backend Operativo DB v1

Este cambio prepara la base real para operar pedidos de La Taba sin reemplazar
todavia la demo actual. La app publicada sigue funcionando con localStorage y el
relay/ngrok; Supabase queda versionado como siguiente capa.

## Que cambia respecto a localStorage

Con localStorage, el pedido vive en el navegador que lo creo y se comparte en la
demo por relay. Con PostgreSQL/Supabase, el pedido queda en una base central:
cliente, negocio y rider pueden ver el mismo estado desde dispositivos distintos.

## Que ve Walter

La Central de pedidos puede pasar a leer pedidos reales del comercio. Cada pedido
tiene datos del cliente, direccion, items, total, estado, historial de eventos y
asignacion de rider. Cuando el rider comparte GPS real, la ubicacion queda ligada
al `order_id` correcto.

## Modelo operativo

- `businesses`: La Taba como comercio.
- `business_members`: usuarios del comercio con rol `owner`, `staff` o `rider`.
- `products`: catalogo persistente.
- `orders`: pedido principal y estado operativo.
- `order_items`: productos comprados.
- `order_events`: auditoria de cambios.
- `rider_locations`: ubicaciones GPS reales.
- `order_public_tokens`: acceso anonimo limitado al tracking de un pedido.

## Lo que sigue siendo demo-safe

- La app publica no cambia de modo por esta rama.
- El checkout actual no queda obligado a usar Supabase.
- El relay/ngrok sigue siendo valido para la demo GPS.
- No se agregan pagos.
- No se inventan rutas, km, ETA ni marcadores falsos.

## Requisitos antes de produccion

- Crear auth real para negocio y riders.
- Crear una RPC productiva que inserte pedido, items, evento inicial y token de
  tracking en una sola transaccion.
- Probar RLS con usuarios anonimos, staff, owner y rider.
- Definir politicas de retencion de ubicaciones.
- Configurar backups, monitoreo y dominio.
- Decidir si hacen falta Edge Functions para validaciones y notificaciones.

## Limites de esta fase

Esta fase deja schema, RLS inicial, seed y documentacion. No aplica migraciones a
una base remota, no guarda keys y no conecta produccion. Es una base preparada
para integrar con la app actual en una rama posterior.
