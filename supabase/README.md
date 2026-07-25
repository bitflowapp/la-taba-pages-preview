# Supabase · base operativa de TABA

Esta carpeta versiona el esquema PostgreSQL/Supabase para pedidos de bebidas.
La migración más reciente agrega la base productiva, pero **todavía no fue
aplicada ni validada contra una instancia real en esta ejecución**. La migración
no contiene secrets ni crea productos, precios, stock o configuración comercial
productiva.

## Migraciones

Se aplican en orden:

1. `20260531030000_la_taba_phase1_orders.sql`
2. `20260531040000_la_taba_phase1_hardening.sql`
3. `20260601205707_operational_orders_v1.sql`
4. `20260725030000_taba_production_orders.sql`

La última migración es aditiva respecto de las fases anteriores y conserva
columnas legacy necesarias para compatibilidad. También aplica un cierre
deliberado sobre datos previos:

- marca todos los productos existentes como no disponibles y no verificados;
- deshabilita y desverifica la recepción de pedidos del comercio;
- elimina policies permisivas de las fases piloto;
- revoca escrituras directas sobre pedidos, ítems, eventos y tokens;
- deja la operación cerrada hasta una validación humana.

`supabase/seed.sql` está intencionalmente vacío. `supabase db reset` no inventa
un comercio, dirección, identidad de bebida, precio, imagen ni stock. Los datos
comerciales reales deben cargarse y verificarse de forma autenticada.

Antes de aplicarla en una base remota hay que tomar un backup verificable,
probarla sobre staging con una copia representativa y preparar rollback. No usar
`supabase db push` contra producción sin autorización explícita.

## Modelo

- `businesses`: comercio, moneda, modalidades, tarifa, mínimo y compuertas de
  habilitación.
- `business_members`: vínculo entre usuarios de Supabase Auth, comercio y rol.
- `products`: catálogo maestro de bebidas y stock.
- `orders`: pedido, dueño cliente, idempotencia, moneda, totales, estado y rider.
- `order_items`: snapshot de nombre, presentación, cantidad y precio aplicado.
- `order_events`: auditoría de creación y cambios de estado.
- `rider_locations`: fixes GPS reales asociados a pedido, comercio y rider.
- `order_public_tokens`: digest del token de seguimiento, vencimiento y
  revocación; no conserva el bearer en texto plano.

### Catálogo maestro

Un producto no puede publicarse hasta que una persona autorizada complete y
verifique:

- nombre y marca;
- categoría y subcategoría;
- presentación, capacidad y tipo de envase;
- precio mayor que cero y stock no negativo;
- condición alcohólica;
- URL de imagen validada y con derecho de uso;
- etiquetas, si corresponden;
- `verified_at` y `verified_by`.

`available = true` exige además `is_active = true`, `is_verified = true` y stock
positivo. La migración no incluye catálogo comercial: no se deben crear datos
ficticios para superar estas restricciones.

El comercio tampoco puede recibir pedidos hasta validar moneda, delivery y/o
retiro, tarifa y mínimo cuando corresponda, identidad del verificador y estado
operativo. Sólo entonces pueden activarse `ordering_verified` y
`ordering_enabled`.

## Creación autoritativa de pedidos

`create_order_with_items(payload jsonb)` es `SECURITY DEFINER`, exige
`auth.uid()` y acepta una lista cerrada de campos. Cada ítem permite únicamente
`product_id` UUID y `quantity` entera.

Dentro de una sola transacción:

1. normaliza el pedido y construye un fingerprint;
2. serializa reintentos por comercio y `client_request_id`;
3. bloquea productos en un orden determinista;
4. valida comercio, modalidades, catálogo, stock y mínimos;
5. calcula precios, subtotal, envío, total y moneda desde PostgreSQL;
6. genera el UUID y código público;
7. inserta pedido, ítems y evento;
8. descuenta stock;
9. guarda solamente el hash SHA-256 del token de seguimiento;
10. devuelve el resultado autoritativo.

Un reintento equivalente con la misma clave devuelve el pedido existente. La
misma clave con otro usuario, token o fingerprint falla. El cliente no puede
imponer precios, totales, nombres de producto, stock, estado o IDs.

## Estados y concurrencia

`change_order_status(p_order_id, p_expected_status, p_new_status)` bloquea la
fila del pedido y aplica compare-and-swap con el estado esperado. No se permiten
updates directos desde el frontend.

- `owner`/`admin`/`staff`: aceptar, rechazar, preparar, marcar listo, cancelar y
  completar un retiro según la transición vigente.
- Cliente dueño: cancelar sólo antes de que el comercio acepte.
- `rider`: tomar un pedido listo, quedar asignado, salir, llegar y entregar.

Cada cambio crea un evento atribuible al usuario autenticado. La cancelación o
el rechazo restituye inventario una sola vez mediante `inventory_released_at`;
la disponibilidad no se reactiva automáticamente, para conservar el criterio
fail-closed.

## Auth y matriz de autorización

Supabase Auth debe tener habilitadas las sesiones anónimas para clientes. Las
cuentas del equipo se crean con email y contraseña y luego se vinculan con una
fila activa de `business_members`. Los roles operativos son `owner`, `admin`,
`staff` y `rider`.

| Actor | Rol/membresía | Acceso previsto |
| --- | --- | --- |
| Visitante | `anon` | Comercio activo y catálogo público verificado. |
| Cliente | usuario anónimo autenticado | Crear por RPC y leer su propio pedido. |
| Owner | `owner` activo | Operación y gestión de membresías/activación del comercio. |
| Admin | `admin` activo | Pedidos y catálogo del comercio. |
| Staff | `staff` activo | Operación cotidiana de pedidos y catálogo según las policies. |
| Rider | `rider` activo | Pedidos listos sin asignar o asignados a sí mismo; GPS propio. |

La separación visual no reemplaza RLS. No existe PIN productivo. No se debe
exponer llaves privilegiadas de servidor al navegador ni usarlas para ocultar fallas de policies.
El alta inicial de owners y miembros requiere un procedimiento administrativo
controlado que todavía debe definirse.

## Tracking y GPS

El cliente conserva acceso por su identidad anónima de Auth. La base también
puede autorizar un pedido mediante el header `x-order-token`: compara su digest,
vencimiento y revocación sin exponer `order_public_tokens` por PostgREST.

La recuperación cross-device mediante token debe probarse antes de habilitarse
comercialmente. Limpiar el almacenamiento del navegador puede eliminar la
sesión anónima local aunque el pedido siga persistido en PostgreSQL.

Sólo el rider autenticado y asignado puede insertar `rider_locations`, y
`source` debe ser `gps`. Registros legacy o simulados no se exponen como
ubicación productiva. La migración reemplaza `created_at` con hora del servidor;
esto impide que un navegador mantenga un fix futuro artificialmente vigente,
pero no certifica que las coordenadas del dispositivo sean físicamente reales.

## Realtime

Las migraciones intentan incluir en `supabase_realtime`:

- `businesses`;
- `products`;
- `orders`;
- `order_events`;
- `rider_locations`.

Si la publication no existe en un entorno local, la migración deja un notice.
En un proyecto de prueba hay que verificar publication, `REPLICA IDENTITY`, JWT,
RLS y recepción de eventos con dos sesiones reales. El frontend usa polling como
respaldo; ese respaldo no demuestra que Realtime funcione.

La sesión Auth del cliente y las cuentas del equipo usan Realtime. La
recuperación excepcional mediante `x-order-token` usa polling continuo: los
headers PostgREST del navegador no viajan en el WebSocket de Realtime.

## Ejecución local

Requisitos todavía ausentes en el equipo de esta ejecución: Supabase CLI y un
runtime local compatible, normalmente Docker.

Cuando estén instalados:

```powershell
supabase start
supabase db reset
supabase status
```

`db reset` es destructivo para la base local y aplica todas las migraciones y el
seed legacy del repositorio. Confirmar primero que el target es local, que no
contiene datos que deban preservarse y que los productos históricos siguen
fail-closed.

Para validar una instancia aislada:

1. obtener URL y publishable key del proyecto de prueba;
2. aplicar las migraciones en orden;
3. crear un comercio de prueba con datos explícitamente rotulados;
4. habilitar Auth anónimo;
5. crear usuarios de prueba y memberships `owner`, `admin`, `staff` y `rider`;
6. cargar un catálogo de prueba validado, nunca datos comerciales inventados;
7. ejecutar las pruebas RLS y el smoke productivo;
8. eliminar o cancelar los datos creados por la prueba según el runbook.

## Smoke productivo

El comando previsto es:

```powershell
npm run smoke:supabase
```

Es una prueba mutante: crea un pedido real en la instancia indicada, reintenta
la misma clave para comprobar idempotencia, prueba permisos, cambia estados,
observa Realtime y deja el pedido cancelado para restituir stock. El pedido y
sus eventos permanecen como evidencia; no es una prueba sin efectos.

Variables requeridas:

- `SUPABASE_URL`;
- `SUPABASE_PUBLISHABLE_KEY` o `SUPABASE_ANON_KEY`;
- `SUPABASE_BUSINESS_ID`;
- `SUPABASE_STAFF_EMAIL`;
- `SUPABASE_STAFF_PASSWORD`;
- `TABA_SMOKE_CUSTOMER_PHONE`;
- `TABA_SMOKE_CONFIRM=I_UNDERSTAND_THIS_CREATES_AN_ORDER`.

Variables opcionales: `TABA_SMOKE_CUSTOMER_NAME`,
`TABA_SMOKE_DELIVERY_MODE` (`delivery` o `pickup`) y
`TABA_SMOKE_STREET_ADDRESS`, obligatoria si se usa delivery. Nunca imprimir keys
o contraseñas completas en logs.

En esta ejecución el smoke quedó **bloqueado y no ejecutado** por falta de:

- Supabase CLI/runtime local;
- URL y publishable key de una instancia aislada;
- UUID de comercio y catálogo verificado;
- cuentas y memberships de prueba;
- autorización para crear y mutar datos en una instancia remota.

Los tests estáticos de SQL y los dobles de prueba del adapter no reemplazan esta
validación.

## Compuertas antes de cualquier producción

- backup y restauración ensayada;
- migración completa validada en staging;
- catálogo y configuración comercial firmados por el comercio;
- matriz RLS probada con cliente, owner, admin, staff, rider y actor no
  autorizado;
- idempotencia, stock concurrente y restitución de stock probados en PostgreSQL;
- Realtime y fallback probados con dos dispositivos;
- recuperación de tracking y vencimiento/revocación de tokens;
- rate limiting y protección de altas anónimas;
- retención, privacidad y minimización de PII/GPS;
- una cola de riders minimizada que no entregue PII completa a todos los riders
  activos antes de que uno tome el pedido;
- validación antifraude de coordenadas y saltos GPS si el negocio necesita esa
  garantía;
- monitoreo, alertas, auditoría y rollback.

Hasta completar esas compuertas, esta carpeta representa una implementación en
progreso y no una autorización para abrir pedidos reales.
