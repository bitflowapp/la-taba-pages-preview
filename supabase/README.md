# Supabase operational database v1

Esta carpeta versiona la base operativa inicial para La Taba. No conecta la app
publica a Supabase por defecto y no incluye secretos.

## Que resuelve

- Persistir pedidos e items en PostgreSQL.
- Permitir que el comercio vea pedidos desde cualquier dispositivo autenticado.
- Registrar cambios de estado como eventos auditables.
- Asociar ubicaciones GPS reales del rider al `order_id` correcto.
- Preparar tracking anonimo por token publico, sin exponer todos los pedidos.

## Tablas

- `businesses`: comercio operativo.
- `business_members`: usuarios autenticados vinculados a un comercio con rol.
- `products`: catalogo persistente del comercio.
- `orders`: pedido, cliente, direccion, estado, totales y rider asignado.
- `order_items`: lineas del pedido.
- `order_events`: historial de eventos del pedido.
- `rider_locations`: fixes GPS reales del rider por pedido.
- `order_public_tokens`: token opaco para que un cliente lea solo su pedido.

La migracion `20260601205707_operational_orders_v1.sql` extiende las tablas de
la fase piloto previa en vez de eliminarlas. Mantiene columnas legacy como
`code` y `fulfillment_type` para no romper el adapter existente mientras prepara
`public_code` y `delivery_mode`.

## Flujo previsto

Cliente:

1. Inserta pedido e items por una RPC validada.
2. Recibe `order_id`, `public_code` y un token publico de tracking.
3. Escucha `orders`, `order_events` y `rider_locations` filtrados por su token.

Negocio:

1. Inicia sesion con Supabase Auth.
2. Lee pedidos de su `business_id` por `business_members`.
3. Actualiza estado: recibido, aceptado, preparando, listo, en reparto, entregado.
4. Ve items y eventos del pedido.

Rider:

1. Inicia sesion con rol `rider`.
2. Lee pedidos disponibles o asignados de su negocio.
3. Toma un pedido actualizando el rider asignado.
4. Inserta `rider_locations` con `source = 'gps'` y el `order_id` correcto.

## Realtime

La migracion intenta agregar estas tablas a `supabase_realtime` de forma
idempotente:

- `orders`
- `order_events`
- `rider_locations`

Si la publication no existe en el entorno local, la migracion deja un notice. En
Supabase Cloud debe existir normalmente.

## Uso local con Supabase CLI

```powershell
supabase start
supabase db reset
```

El reset aplica migraciones y luego `supabase/seed.sql`.

Para una base remota, no ejecutar `supabase db push` sin confirmacion explicita.

## Variables futuras

Ver `.env.example` en la raiz. La app publica actual no las necesita para seguir
funcionando en demo.

## Que no esta listo todavia

- La app publica no esta conectada automaticamente a Supabase.
- Falta RPC productiva que cree pedido, items y `order_public_tokens` juntos.
- Falta auth real de comercio/rider en frontend.
- Falta flujo de invitacion y alta de `business_members`.
- Falta revision de RLS contra un proyecto real con usuarios de prueba.
- Falta monitoreo, backups, dominio final y politicas de retencion.

## Seguridad

- No commitear keys.
- No usar una llave privilegiada en frontend.
- No guardar ubicaciones que no sean GPS real.
- No exponer listados globales de pedidos a clientes anonimos.
- No usar esta fase como produccion abierta sin completar auth, RPCs y QA de RLS.
