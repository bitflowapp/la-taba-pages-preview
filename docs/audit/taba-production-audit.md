# Auditoría de producción de TABA

Fecha: 2026-07-25
Repositorio auditado: `C:\1212\la-taba-pages`
Rama: `feat/taba-production-beverages`
Commit base: `333b5a2c5016afb0383ce409c2c381e54d93fcf9`

## Veredicto ejecutivo

TABA no está en condiciones de recibir pedidos productivos en el estado base auditado. La aplicación vigente es una PWA estática de demostración para una pizzería, con catálogo y operación locales. Hay código preliminar para Supabase, pero aplicar todas las migraciones deja rota la creación de pedidos y el frontend no implementa la autenticación, los tokens ni las políticas RLS que la última migración exige.

El mayor riesgo no es sólo que “falte conectar” el backend. Existe una combinación en la que la interfaz pública afirma que el pedido no se envía, pero los adaptadores HTTP o Supabase pueden transmitir nombre, teléfono, dirección y productos.

La conversión a producción requiere conservar dos caminos separados:

- **Demo explícita:** únicamente con `?demo=1`, estado local y rótulos de simulación.
- **Producción:** configuración de despliegue, Supabase Auth, catálogo remoto verificado, RPC transaccional, RLS, IDs e idempotencia de servidor.

Nunca debe existir fallback silencioso de producción a demo.

## Qué funciona hoy

| Área | Estado real |
|---|---|
| Catálogo, búsqueda y categorías | Funciona en el navegador con datos estáticos/locales de pizzería. |
| Carrito | Funciona localmente y valida cantidades contra el stock local. |
| Checkout | Valida datos y crea un pedido local de muestra. |
| Negocio | Funciona como simulación en el mismo dispositivo y se desbloquea con PIN cliente. |
| Rider | Funciona como simulación local; no hay asignación/Auth productiva. |
| Tracking | Muestra estados locales. El GPS productivo está deshabilitado. |
| Relay | Sincroniza una demo mediante salas SSE sin autenticación. No es apto para PII. |
| Supabase | Hay SQL y un adapter opt-in, pero no forman un flujo compatible de extremo a extremo. |
| PWA | Instalable y con cache network-first; no tiene push, outbox ni background sync. |
| Pruebas | Cubren ampliamente la demo y mocks, no una instancia Supabase real. |

## Matriz real, local, simulado y mock

| Componente | Persistencia | Autoridad | Observación |
|---|---|---|---|
| `js/data.js` | Archivo estático | Cliente | Catálogo de pizzería con precios declarados como estimados. |
| `js/state.js` | `localStorage`/memoria | Cliente | Pedidos, stock, PII, acceso del panel y tracking local. |
| `js/realtime.js` + relay | Memoria/SSE | Cliente/relay demo | Replica snapshots completos sin autenticación. |
| `supabase_order_repository.js` | REST Supabase | Cliente + SQL piloto | Envía precios/totales del cliente y no implementa Auth/token. |
| Migraciones Supabase | PostgreSQL no aplicado aquí | Servidor potencial | Las versiones actuales son incompatibles entre sí. |
| `backend/` no rastreado | Express/OpenAI | Ajeno | Backend de Ojo Claro; no contiene endpoints de pedidos TABA. |
| `mobile/` no rastreado | Flutter/Android | Ajeno | Aplicaciones Ojo Claro/Estela, fuera del producto TABA. |

## Hallazgos críticos

### P0-01 — La UI puede afirmar “no se envió” mientras transmite PII

**Severidad:** crítica
**Archivos:** `js/app.js`, `js/core/domain.js`, `js/repositories/repository_factory.js`, `js/repositories/http_order_repository.js`, `js/repositories/supabase_order_repository.js`

**Evidencia**

- `js/app.js:578-582` define `previewOnly` según el modo demo y luego llama al repositorio activo.
- `js/app.js:589-591` comunica en modo público que el pedido no fue enviado.
- `js/core/domain.js:96-113` no conserva `previewOnly` al normalizar el borrador.
- `repository_factory.js:10-17` permite seleccionar transporte mediante query string.
- Los adapters HTTP/Supabase transmiten el borrador por red.

**Impacto**

Nombre, teléfono, dirección y pedido podrían salir del dispositivo bajo una promesa de privacidad falsa.

**Solución propuesta**

Configurar producción exclusivamente mediante runtime/deploy config; separar los modos preview, demo y producción; bloquear el envío antes de construir el request si el modo no es producción; eliminar endpoints y claves de la URL; no hacer fallback silencioso.

### P0-02 — Las migraciones completas rompen la RPC de creación

**Severidad:** crítica
**Archivos:** `supabase/migrations/20260531040000_la_taba_phase1_hardening.sql`, `supabase/migrations/20260601205707_operational_orders_v1.sql`

**Evidencia**

- La RPC `create_order_with_items` inserta `order_events` sin `business_id` ni `event_type` en `20260531040000...sql:96-102`.
- La migración posterior convierte ambas columnas en `NOT NULL` en `20260601205707...sql:138-139`.

**Impacto**

El insert del evento falla y PostgreSQL revierte en forma atómica el pedido y sus ítems. Tras aplicar las tres migraciones, no se puede crear ningún pedido.

**Solución propuesta**

Nueva RPC versionada que cree pedido, ítems, evento y vínculo de tracking en una sola transacción y que sea compatible con el esquema final.

### P0-03 — No existe autenticación/autorización productiva

**Severidad:** crítica
**Archivos:** `js/config.js`, `js/business.js`, `js/ui.js`, `js/app.js`, `js/repositories/supabase_order_repository.js`

**Evidencia**

- PIN `1234` embebido en `js/config.js:44`.
- Comparación de PIN completamente cliente en `js/business.js:139-147`.
- El “bloqueo” sólo altera visibilidad y estado local en `js/ui.js:161-173`.
- El adapter usa la publishable/anon key como `Authorization: Bearer` en `supabase_order_repository.js:38-49`; no usa una sesión.
- En modo público las vistas operativas se ocultan y el hash se redirige a Home (`app.js:222-250`, `app.js:731-736`).

**Impacto**

No hay identidad verificable para dueño, empleado o rider. Con RLS abierta cualquiera opera; con RLS cerrada nadie opera.

**Solución propuesta**

Supabase Auth para usuarios permanentes del equipo, membresía `business_members` y rol validado por RLS/RPC. El PIN puede permanecer sólo en la demo explícita.

### P0-04 — El servidor confía en precios, totales, estado y nombres enviados por el cliente

**Severidad:** crítica
**Archivos:** `js/repositories/supabase_order_repository.js`, `20260531040000_la_taba_phase1_hardening.sql`

**Evidencia**

- El adapter construye `unit_price`, subtotales, envío y total en `supabase_order_repository.js:98-136`.
- La RPC acepta esos valores y permite un estado inicial arbitrario de una lista amplia en `20260531040000...sql:36-94`.
- La RPC no consulta `products`, no valida disponibilidad ni recalcula el total.

**Impacto**

Un cliente puede alterar precio, total, estado o descripción y generar pedidos inconsistentes.

**Solución propuesta**

La entrada pública debe contener sólo `product_id`, cantidad, datos mínimos e idempotency key. La RPC debe bloquear filas de catálogo, validar stock/disponibilidad y calcular todos los importes.

### P0-05 — Adapter y RLS operacional son incompatibles

**Severidad:** crítica
**Archivos:** `supabase_order_repository.js`, `20260601205707_operational_orders_v1.sql`

**Evidencia**

- La lectura exige membresía, rider asignado o `x-order-token` (`20260601205707...sql:392-415`, `477-536`).
- El adapter no envía JWT de sesión ni `x-order-token`.
- La RPC vieja no crea `order_public_tokens`; la propia migración lo reconoce en líneas `560-563`.
- El adapter consulta los últimos 100 pedidos del negocio con credencial anónima.

**Impacto**

Con policies piloto hay fuga global de pedidos. Con policies operativas, creación, lectura, estado y GPS dejan de funcionar.

**Solución propuesta**

Cliente anónimo autenticado para ownership/Reatime de su propio pedido; usuarios permanentes para negocio/rider; token opaco con hash como fallback de tracking; requests y canales con JWT correcto.

### P0-06 — No hay idempotencia ni control de concurrencia

**Severidad:** crítica
**Archivos:** `js/app.js`, `js/state.js`, `supabase_order_repository.js`, migraciones

**Evidencia**

- La protección de doble click es una variable en memoria (`app.js:565-570`).
- Cada intento genera ID/código nuevo (`supabase_order_repository.js:108-110`).
- Los estados se actualizan sólo por ID, sin estado esperado ni versión.
- En demo, cada dispositivo calcula el correlativo local (`state.js:598-606`).

**Impacto**

Un timeout/retry puede duplicar pedidos. Dos operadores pueden sobrescribir estados.

**Solución propuesta**

`client_request_id` único por negocio, retry seguro, folio generado en DB, bloqueo transaccional de stock y actualización de estado con `expected_status`.

## Hallazgos altos

### P1-01 — Relay demo inseguro para datos reales

**Archivos:** `scripts/realtime-relay.mjs`, `js/realtime.js`, `js/business.js`, `js/delivery.js`

- Salas predecibles, CORS abierto, publicación/lectura/reset sin autenticación.
- Replica todos los pedidos, PII, tracking y potencialmente fotos.
- Un `hello` hace que otro cliente publique su snapshot.
- Existen rutas donde IDs remotos se interpolan en HTML/atributos sin escape consistente.
- El límite del relay es menor que el tamaño permitido para una foto de entrega.

**Acción:** conservar sólo para `?demo=1`; impedir que transporte demo se active en producción; no usarlo para PII.

### P1-02 — Catálogo incompatible con una tienda de bebidas

**Archivos:** `js/data.js`, `supabase/seed.sql`, `templates/la-taba-products-template.csv`, `assets/products/`, `README.md`, `manifest.webmanifest`, `sw.js`

- Frontend y PWA son de pizzería.
- Seed y plantilla Supabase todavía contienen carnicería/parrilla.
- `products` no tiene marca, subcategoría, presentación, capacidad, envase, stock, alcohol, etiquetas ni estado de verificación.
- La app nunca carga `products` desde Supabase.
- Los precios se describen como estimados; no son un catálogo comercial validado.

**Acción:** crear el esquema maestro, desactivar datos incompatibles y no habilitar pedidos hasta cargar precio/stock verificados por el comercio.

### P1-03 — Stock local y sobreventa entre dispositivos

**Archivos:** `js/core/catalog-store.js`, `js/business.js`, `supabase_order_repository.js`, esquema `products`

El stock se descuenta en el navegador. La tabla remota no tiene stock autoritativo ni locks.

**Acción:** stock en DB, `SELECT ... FOR UPDATE`, validación/decremento atómico en la RPC y edición sólo para owner/staff.

### P1-04 — Rider/GPS usa columnas incompatibles y falla con RLS

**Archivos:** `supabase_order_repository.js`, `20260601205707_operational_orders_v1.sql`

- Adapter: `assigned_rider_id` y `rider_id`.
- Esquema Auth: `assigned_rider_user_id`, `rider_user_id`, `business_id`.
- Adapter omite campos obligatorios.
- RLS exige rider autenticado/asignado y `source='gps'`.

**Acción:** unificar el modelo Auth, RPC de claim/asignación, insert GPS con JWT del rider y eliminar simulación del transporte productivo.

### P1-05 — Estado y pruebas de entrega son sólo locales

**Archivos:** `js/orders.js`, `js/core/delivery-code.js`, `js/core/delivery-proof.js`

El código y la foto de entrega no se persisten en Supabase. No forman parte de la auditoría operativa real.

**Acción:** posponer foto hasta definir storage/retención; persistir eventos mínimos y confirmación de entrega en el servidor.

### P1-06 — PII operativa queda en `localStorage`

**Archivo:** `js/state.js`

El snapshot completo conserva pedidos, teléfonos, direcciones y fotos. El éxito del checkout no depende de una confirmación remota.

**Acción:** en producción, el backend es la autoridad; persistir localmente sólo el identificador/token mínimo necesario y limpiar PII terminal según política de retención.

## Hallazgos medios

1. La policy piloto `"phase1 public read businesses"` sobrevive y deja lectura global aunque exista una policy nueva más estricta.
2. Las columnas legacy/nuevas (`code/public_code`, `fulfillment_type/delivery_mode`, riders legacy/Auth) pueden divergir.
3. DB acepta `rejected`, pero el workflow JS no lo representa coherentemente.
4. `manifest.webmanifest`, `README.md`, service worker y textos contienen pizzería; hay 252 coincidencias relacionadas con pizza/pizzería.
5. Persisten 93 coincidencias de carnicería/carnes en código, pruebas, plantillas o docs relevantes.
6. Leaflet se carga desde CDN sin SRI y no existe CSP.
7. No hay CI/CD, `.github/`, `supabase/config.toml` ni pipeline de despliegue productivo.
8. Playwright bloquea service workers, por lo que el comportamiento PWA real no está cubierto.
9. El adapter Supabase llama “Realtime” a polling cada cinco segundos.
10. El backend Ojo Claro no rastreado reporta una vulnerabilidad `low`; no debe incorporarse al producto TABA.

## Carpetas ajenas y archivos no rastreados

El detalle completo está en `docs/audit/preflight-untracked-inventory.md`.

- 199 archivos no rastreados en la línea base, 94.559.303 bytes.
- 150 archivos de evidencia TABA.
- 40 archivos mobile Ojo Claro/Estela.
- 6 archivos backend Ojo Claro, incluidos dos logs.
- 3 archivos `.idea`.
- 8.116 archivos ignorados, principalmente dependencias y builds.

No se detectaron secretos reales de alta confianza. Se excluyeron del backup todos los `.env`, logs, IDE, dependencias, builds y cachés.

## Qué impediría pedidos entre celulares distintos

1. Catálogo y stock no compartidos.
2. RPC rota después de todas las migraciones.
3. Falta de Auth/JWT.
4. RLS incompatible con el adapter.
5. Ausencia de idempotencia.
6. Falta de token/ownership de cliente.
7. Negocio y rider inaccesibles fuera de demo.
8. Estado, GPS, código y prueba sólo locales.
9. “Realtime” reducido a polling o relay inseguro.
10. No hay instancia/configuración de despliegue validada.

## Validación ejecutada

### Línea base local

- `npm run check`: **aprobado**.
- `npm test`: **288/288 aprobadas**.
- `npm run test:e2e`: **42/42 aprobadas**.

Estas pruebas demuestran estabilidad de la demo actual. No demuestran seguridad ni operación productiva.

### Supabase

No fue posible aplicar migraciones porque el entorno no contiene:

- Supabase CLI;
- Docker;
- `psql`;
- `supabase/config.toml`;
- credenciales de una instancia de prueba.

Las 17 pruebas Supabase existentes son regex/mocks y pasan, pero no ejecutan PostgreSQL ni RLS. El smoke actual también intenta operaciones incompatibles con la última migración.

## Referencias oficiales verificadas

- Supabase recomienda usar sus librerías cliente para Postgres Changes y aplica RLS por JWT en las suscripciones: <https://supabase.com/docs/guides/realtime/postgres-changes>
- Supabase Auth integra JWT con RLS: <https://supabase.com/docs/guides/auth>
- Los usuarios anónimos autenticados usan rol `authenticated` y son aptos para e-commerce sin exigir cuenta al cliente: <https://supabase.com/docs/guides/auth/auth-anonymous>
- El login de equipo puede usar `signInWithPassword`: <https://supabase.com/docs/reference/javascript/auth-signinwithpassword>

## Orden de corrección

1. Bloquear la contradicción “no se envía”/transporte real.
2. Crear migración productiva compatible y RPC transaccional.
3. Hacer que DB calcule precios, stock y totales.
4. Agregar idempotencia y transiciones de estado atómicas.
5. Integrar Supabase Auth y RLS para cliente, owner, staff y rider.
6. Cargar catálogo remoto verificado y dejar datos viejos fuera de producción.
7. Implementar suscripciones Realtime con JWT y fallback de polling controlado.
8. Unificar rider/GPS.
9. Ejecutar matriz RLS y carreras en una instancia Supabase real.
10. Recién entonces habilitar pedidos productivos en el despliegue.

## Riesgos y decisiones humanas pendientes

- URL y publishable key del proyecto Supabase de prueba.
- Confirmación de habilitación de Anonymous Sign-Ins y mecanismo antiabuso/CAPTCHA.
- Usuarios iniciales y membresías owner/staff/rider.
- Catálogo real de bebidas con precios, stock, presentaciones e imágenes verificadas.
- Dirección, horarios, zona, tarifa y pedido mínimo del comercio.
- Política de privacidad, retención de PII y GPS.
- Dominio y procedimiento de despliegue.

Hasta resolver y probar esos puntos, no corresponde declarar TABA “listo para producción”.
