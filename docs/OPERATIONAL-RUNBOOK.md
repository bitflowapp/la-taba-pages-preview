# TABA — RELEASE & OPERATIONS RUNBOOK
**Estabilidad · Resiliencia · Operaciones · Primeros 100 Pedidos**

Este documento es la guía canónica de operaciones para la puesta en marcha de TABA. Contiene protocolos de 5 minutos, procedimientos de despliegue, rollback inmediato y resolución de incidentes de día 1.

---

## 1. PRE-LAUNCH CHECKS (Protocolo de 5 Minutos)

Antes de cualquier despliegue o apertura de turnos, ejecutar esta secuencia obligatoria:

```bash
# 1. Comprobar limpieza del repositorio y rama activa
git status

# 2. Comprobación estricta de higiene, contratos e identidad de release
npm run check

# 3. Batería completa de pruebas unitarias y de integración
npm test

# 4. Pruebas de integración fiscal ARCA (fetch stubbeado, sin llamar a ARCA)
npm run fiscal:test
```

**Los dos scripts que NO son compuertas.** `load-concurrency-audit.mjs` y
`trace-order-correlation.mjs` se pueden correr, pero **no acreditan nada sobre
la infraestructura**: el primero mide un modelo en memoria definido en su propio
archivo, y el segundo valida fixtures escritas a mano. Ninguno toca la base, la
red ni el proveedor de pagos, y ninguno puede fallar por un problema real.
Estaban listados acá como pasos 5 y 6 de un protocolo de lanzamiento, que es
exactamente donde no tienen que estar. La verificación equivalente de verdad es
`npm run test:db:isolated` contra una base real.

### Verificación de Compuertas de Pago (Postura Walter / Pre-OAuth)
Confirmar que Mercado Pago permanece cerrado hasta la autorización externa de Walter:
- `SELLER_CONNECTED = FALSE`
- `PAYMENTS_ENABLED = FALSE`
- `BUSINESS_AUTHORIZED = FALSE`
- `READY_FOR_WALTER_AUTHORIZATION = YES`
- `MONEY_MOVEMENT_POSSIBLE = NO`

---

## 2. DESPLIEGUE SEGURO (Cloudflare Pages)

1. **Compilar y validar el paquete de release:**
   ```bash
   # Valida que no existan rutas prohibidas y que los hashes de precache coincidan
   node scripts/check-release-identity.mjs
   ```

2. **Publicar a Staging:**
   El despliegue a `https://taba2-staging.pages.dev` se ejecuta empujando a la rama vinculada en el repositorio remoto:
   ```bash
   git push origin feat/taba-commerce-v3
   ```
   Cloudflare Pages compila y publica automáticamente el commit en preview.

3. **Publicar a Producción:**
   *Nota: No publicar a producción hasta completar la autorización de Walter y el test de cobro de $15.*
   Una vez autorizado, el tag de release se promociona a la rama `main`.

---

## 3. VERIFICACIÓN POST-DEPLOY

Ejecutar inmediatamente tras publicar un nuevo build:

1. **Smoke en frío (Incógnito / Clean Cache):**
   - Abrir ventana de incógnito en navegador móvil o de escritorio.
   - Navegar a la URL publicada.
   - Verificar carga inicial instantánea en `#home` sin errores en consola.
2. **Service Worker & Precache:**
   - Abrir DevTools -> Application -> Service Workers.
   - Verificar que el worker está `active and running`.
   - Abrir Cache Storage: confirmar que `CACHE_NAME` (`la-taba-runtime-v100-commerce-v3`) contiene los 180 activos precacheados sin ningún 404.
3. **Persistencia y Memoria del Cliente:**
   - Agregar 1 producto al carrito.
   - Recargar la página (`F5`).
   - Verificar que el carrito persiste con el producto seleccionado.
   - Abrir consola y ejecutar: `TABA_FUNNEL.getSummary()`
   - Confirmar que los eventos agregados (`HOME_VIEW`, `PRODUCT_ADDED`, `CART_OPENED`) se registraron sin PII.

---

## 4. ROLLBACK — QUÉ SE PUEDE VOLVER ATRÁS Y QUÉ NO

**No existe un rollback de sistema completo en 10 segundos.** Lo que se
revierte rápido es EL FRENTE. Cada capa tiene su propio camino y su propio
tiempo. Decirlo junto era la parte peligrosa: invitaba a suponer que una
migración también se deshace con un clic.

| Capa | Camino | Tiempo real | Estado |
|---|---|---|---|
| Frente (Cloudflare Pages) | Dashboard → rollback | < 1 min | Mecanismo disponible, **sin ensayar** |
| Edge Functions | `npm run release:edge:production` sobre el SHA anterior | minutos | Procedimiento listo |
| Base de datos | Migración hacia adelante | horas | **Sólo forward-fix** |
| Rider (Android) | Reinstalar el APK anterior en el dispositivo | manual | Procedimiento listo |

### Frente: Cloudflare Pages
1. Dashboard de Cloudflare Pages, proyecto **`la-taba`**.
   (El proyecto se llama `la-taba`; `la-taba-pages-preview` es el repositorio
   de GitHub. Buscar por el nombre del repo acá no encuentra nada, y es
   justo el momento en que no se puede perder tiempo.)
2. Pestaña **Deployments**.
3. Ubicar el despliegue `N-1` por su commit hash.
4. `...` → **Rollback to this deployment**.
5. Verificar: `curl -s https://la-taba.pages.dev/version.json` tiene que
   devolver el commit y el runtime de `N-1`.

> **El flujo de despliegue NO sirve para volver atrás.** `deploy-production.yml`
> tiene el paso «No retroceder», que rechaza cualquier SHA que no sea la punta
> de `main`. Es deliberado y está bien: evita publicar una versión vieja por
> accidente. Consecuencia: el rollback pasa SIEMPRE por el dashboard, fuera de
> CI, sin smoke automático y sin quedar registrado en el log del flujo. Después
> de un rollback hay que verificar a mano con el `curl` de arriba.

### Base de datos: no hay rollback
Una migración aplicada no se deshace con un clic. El camino es **arreglar hacia
adelante** con una migración nueva. Antes de tocar producción, ver
`docs/operations/recovery-and-continuity.md` — y tener presente que el ensayo de
restauración figura como `NOT_RUN`.

### Lo que NO hay que hacer
`git checkout <commit>` **no es un rollback**: cambia un árbol de trabajo local
y no toca producción. Figuraba acá como paso de rollback y era engañoso.

> **Sobre el Service Worker:** cada release rota `CACHE_NAME`, así que al volver
> a `N-1` el worker se reinstala y vuelve a pedir sus assets. Lo que NO
> garantiza eso es el token `?v=NN` de `app.js`: no es un hash de contenido y se
> mantiene a mano en cuatro archivos. Dos builds distintos pueden compartir
> token. La identidad se comprueba con `version.json` y con los digests del
> manifiesto de release, no con el token.

---

## 5. MONITOREO DEL PRIMER DÍA (Primeros 100 Pedidos)

### La fuente de verdad es la base, no el navegador

Para saber qué está pasando en la tienda se consulta el SERVIDOR. Las tablas ya
existen y ya se escriben:

| Pregunta | Dónde se contesta |
|---|---|
| ¿Entran pedidos? | `orders`, `order_events` |
| ¿Se están rechazando? | `order_events` + `operational_alert_events` |
| ¿Llegan los webhooks de pago? | `payment_webhook_receipts` (`signature_valid`, `duplicate`) |
| ¿Quedó un cobro sin pedido? | `payment_intents` sin `order_id` correlacionado |
| ¿El rider avanza? | `order_events` por `order_id` |
| ¿Murió el planificador? | `operational_sweep_runs`, `cron.job_run_details` |

El barrido de alertas (pg_cron) y la sonda externa
(`.github/workflows/scheduler-watchdog.yml`) cubren la ausencia del planificador.

### `TABA_FUNNEL` es LOCAL DEL NAVEGADOR — no es analítica

`TABA_FUNNEL.getSummary()` devuelve el embudo **del dispositivo donde se
ejecuta**, leído de su `localStorage`. El módulo no tiene transporte: nada se
envía a ningún lado. **El embudo de un cliente vive en el teléfono de ese
cliente y no se puede consultar desde acá.**

Sirve para QA con un dispositivo en la mano, y para nada más. No se puede usar
para vigilar los primeros 100 pedidos; para eso están las tablas de arriba.

Los ratios que figuraban en esta sección se quitaron: los eventos que los
alimentaban se contaban mal —`HOME_VIEW` dos veces por navegación,
`CHECKOUT_STARTED` una vez por tecla, y `ORDER_CREATED` al redirigir a Mercado
Pago en vez de al cobrar—, así que ninguno de los cuatro significaba lo que
decía. Los tres defectos están corregidos; el evento de entrega al proveedor
ahora es `PAYMENT_HANDOFF` y es distinto de `ORDER_CREATED`.

### Flujo de Diagnósticos (`[TABA_DIAGNOSTIC]`)
También client-side: estas líneas salen por la consola **del navegador del
cliente**. Son útiles con un dispositivo delante, no a distancia.
Filtrar la consola por `[TABA_DIAGNOSTIC]`:
- **Alertas Críticas (Requieren Atención Inmediata)**:
  - `scope: 'checkout', error: 'create_order_rejected'`: Rechazo por stock insuficiente o validación.
  - `scope: 'supabase_query', status: 500`: Falla interna en base de datos o RPC PostgreSQL.
  - `scope: 'rider_contract_refusal'`: Conflicto de revisión o colisión en asignación de rider.
- **Alertas Benignas (Normales / Esperadas)**:
  - 401 en `get_mercadopago_checkout_availability` para visitantes anónimos en catálogo (comportamiento fail-closed que evita crear identidades vacías en Auth).

---

## 6. PLAYBOOK DE INCIDENTES COMUNES

### Caso A: "El cliente afirma que pagó pero el local no lo ve en la bandeja"
1. **Diagnóstico**:
   - Abrir terminal y ejecutar:
     ```bash
     node scripts/trace-order-correlation.mjs
     ```
   - Verificar si el pedido se encuentra en estado `pending` de Mercado Pago o si falló el webhook relay.
2. **Causas Comunes**:
   - Webhook de Mercado Pago demorado por latencia de red.
   - El cliente cerró la pestaña antes de la redirección de retorno (`mercadopago-return.js`).
3. **Resolución Operativa**:
   - Buscar el pago en el panel de Mercado Pago por monto y horario aproximado.
   - Si el cobro está aprobado en MP pero la orden no avanzó: cambiar manualmente el estado en el Panel de Negocio o forzar ingesta con el número de transacción.

### Caso B: "El rider no ve la dirección o no puede confirmar entrega"
1. **Diagnóstico**:
   - Verificar si el pedido fue emitido como `deliveryMode = 'pickup'` (Retiro en local) en lugar de `'delivery'`.
   - Verificar si el contrato de ubicación requirió confirmación de pin (`delivery_location_confirmed_at`).
2. **Resolución Operativa**:
   - En el Panel de Negocio, abrir el detalle del pedido.
   - Leer las referencias del cliente en las notas del pedido (`customer_notes`).
   - Si el rider no tiene código de entrega (`delivery_code`), el operador puede confirmar la entrega directamente desde el panel con rol de administración.

### Caso C: "El cliente tocó dos veces Confirmar por latencia"
1. **Comportamiento del Sistema**:
   - El cliente dispone de bloqueo de UI (`confirming = true`) y deshabilitación del botón submit.
   - El backend utiliza `pg_advisory_xact_lock` sobre `business_id` y `client_request_id`.
   - La segunda solicitud detecta la clave de idempotencia existente y reemite la orden ya creada sin duplicar ítems ni cobros.
2. **Resolución Operativa**:
   - Ninguna acción técnica requerida; el sistema es 100% idempotente por diseño.
