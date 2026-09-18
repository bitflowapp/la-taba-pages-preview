# TABA — Manifiesto de la candidata de producción

**Fecha de corte:** 2026-09-18 · **Rama:** `release/taba-production-rc`

Este documento es la identidad exacta de la candidata. Todo lo que dice está
medido, y lo que no se pudo medir dice que no se midió. La regla es la de
`docs/operations/recovery-and-continuity.md`: no se asignan cifras nominales
sin el ensayo que las produce.

Cada afirmación lleva su grado:

| Grado | Significa |
|---|---|
| `PROBADO` | Medido en este corte, con la evidencia citada |
| `SIMULADO` | Corre sobre un modelo o fixtures, no sobre el sistema real |
| `PROBADO EN STAGING` | Verificado contra un backend de staging vivo |
| `SIN VERIFICAR EN VIVO` | No se ejercitó contra el sistema real |

---

## 1. Identidad del código

| Campo | Valor | Grado |
|---|---|---|
| `RELEASE_HEAD` | `cecbb9cb5a7dca02753003b073741645daaabcb4` | `PROBADO` |
| Rama | `release/taba-production-rc` | `PROBADO` |
| Rama de origen | `feat/taba-commerce-v3` | `PROBADO` |
| Remoto | `github.com/bitflowapp/la-taba-pages-preview` | `PROBADO` |
| Árbol de trabajo | limpio | `PROBADO` |
| `CACHE_NAME` | `la-taba-runtime-v100-commerce-v3` | `PROBADO` |
| Archivos en precache | 180 | `PROBADO` |
| Migraciones en la candidata | 127 | `PROBADO` |

### Digests de los artefactos críticos

SHA-256 del contenido en `RELEASE_HEAD`. El token `?v=NN` **no** es un hash de
contenido: se comprobó que `app.js?v=49` devolvía bytes distintos en producción
y en staging. Estos digests son la identidad; el token no.

Los digests se calcularon en `c4ca098` y siguen idénticos en `df06c28`: entre
esos dos commits sólo cambió documentación. El agregado del precache
(`assetsDigest`) es el que verifica `npm run check` en cada corrida, y es el que
obliga a rotar `CACHE_NAME` si cambia un byte.

| Archivo | SHA-256 |
|---|---|
| `index.html` | `b2b96b7ad11e724f9996fac5426fed2500a0739320c67dc78c0505dfda559150` |
| `js/app.js` | `71d1fa4d1a956e71ec1eb4126e0cde912c2274e08f85af080a24562d4e007500` |
| `styles.css` | `f07a54f240956f64f154d8a722e21d49539894f4183c7bab729e99b071ae54ac` |
| `sw.js` | `313215144375e7cf327ccb7706866b709a15cc931e6af597473d6064ad185436` |
| `release-identity.json` | `97ca8effcaaeb9d7332abb529f4c9755964f53ed782cfc60b2a7f4e9846b674d` |
| `manifest.webmanifest` | `0e8bae96f11cab8b2b736bb32cc8ec306aa86c6699e767a8c175a828fefd7c0a` |
| **Agregado del precache** (180 archivos) | `fa55ce0761c7fbd5861e7a4499f167867145c1d1368465e367dc402074d06f48` |

`runtime-config.js` **no** lleva digest acá a propósito: se **deriva por
entorno** en el build (`scripts/build-production-runtime-config.mjs`) y es
distinto en cada destino. Es el archivo que apunta al backend, y por eso se
sirve `no-store`.

Verificación de un despliegue: `GET /version.json` devuelve `commit` y
`runtime`, y `scripts/deploy/verificar-publicado.mjs` los compara contra lo
esperado esperando a que el alias de Cloudflare converja.

---

## 2. Qué corre hoy en producción, y qué le falta

**Producción NO es esta candidata.** Medido:

| Entorno | Commit | Runtime | Sellado |
|---|---|---|---|
| `RELEASE_HEAD` (esta candidata) | `c4ca098` | `v100-commerce-v3` | sin desplegar |
| `la-taba.pages.dev` (producción) | `a56a9c5` | `v97-explicit-seller-status` | 2026-09-08T07:35Z |
| Edge Functions de producción | — | versión 8–9 | 2026-09-08T07:29Z |

Producción es internamente coherente —frente y funciones son del mismo
2026-09-08— pero está **22 commits atrás** de la candidata.

### Lo que producción no tiene, y es lo que importa

Los seis commits de endurecimiento de pagos que producción no corre tocan
**código de servidor y esquema**, no sólo el navegador:

```
supabase/functions/_shared/refund-correlation.ts          79 líneas
supabase/functions/_shared/refund-runtime.deno.ts        125 líneas (nuevo)
supabase/functions/_shared/refund-no-guess.deno.ts        16 líneas
supabase/functions/_shared/current-payment-authority.deno.ts  240 líneas
supabase/functions/_shared/seller-oauth.ts               165 líneas
supabase/functions/mercadopago-refund/index.ts            79 líneas
supabase/functions/mercadopago-create-preference/index.ts 70 líneas
supabase/functions/mercadopago-payment-worker/index.ts    28 líneas
+ 4 migraciones, 1.665 líneas
```

Dicho de frente: **la correlación de reembolsos que se audita como la mejor
pieza del sistema no está desplegada.** La regla «un ID vinculado es la
evidencia de identidad» vive en `RELEASE_HEAD`, no en la función que producción
tiene arriba hoy.

Lo que evita que eso sea un incidente: **no puede moverse dinero**. La compuerta
de `create_checkout_session` exige `enabled`, `reserve_stock`,
`checkout_mode='checkout_pro'`, `currency='ARS'`, `collector_id`,
`application_id` y `production_review_status='approved'`, y Walter no autorizó
el OAuth. Ningún cobro puede recorrer el camino sin endurecer porque ningún
cobro puede empezar.

---

## 3. Migraciones

| Ámbito | Estado | Grado |
|---|---|---|
| En la candidata | 127 archivos | `PROBADO` |
| Aplicadas en producción | ledger no legible sin la contraseña de la base | `SIN VERIFICAR EN VIVO` |
| Requeridas en producción para promover | **5** (abajo) | `PROBADO` (por diferencia de árbol) |

### `PRODUCTION_MIGRATIONS_REQUIRED` — 5, en este orden

```
20260908164550_current_payment_authority_and_refund_identity.sql
20260908190758_a1_attempt_authority_expand_v2.sql
20260909011239_a1_a4_durable_contract_control_v3.sql
20260909050330_a1_a4_release_interlock_v5.sql
20260913011340_commerce_v3_product_draft_details.sql
```

Las cuatro primeras son la mitad de esquema del endurecimiento de pagos. La
quinta es el detalle de borradores de producto de Commerce V3.

**No se aplicaron.** Aplicar esquema a producción es una acción externa, va con
el orden de arriba y después de tener un respaldo del día verificado.

### Deriva conocida: `CREATE OR REPLACE` no avisa

Cinco migraciones llevan en la cabecera `ESTADO: PREPARADA, NO APLICADA`:

```
20260813010000_pos_last_unit_keeps_availability_contract.sql
20260813020000_checkout_pro_carries_customer_notes.sql
20260813030000_public_tracking_restores_terminal_window.sql
20260814010000_public_tracking_publishes_gps_quality.sql
20260814020000_daily_reconciliation_uses_business_timezone.sql
```

Redefinen funciones con `CREATE OR REPLACE`, y sus nombres ordenan DESPUÉS de
la versión que está viva. Un `supabase db reset` desde cero las aplica últimas y
produce **un comportamiento de creación de pedidos distinto del que corre en
producción**. La propia `20260813020000` documenta que eso ya pasó una vez: una
versión anterior «habría REVERTIDO en silencio» el trabajo de enforcement,
porque `CREATE OR REPLACE` «pisa y sigue: no falla, no avisa».

La reproducibilidad hoy depende del ledger de lo aplicado, no de los archivos.
Cerrar esa deriva pide una base real y queda como trabajo abierto.

> **Trampa para quien siga:** `supabase/.temp/linked-project.json` de este
> repositorio apunta a **producción** (`wwcpogltfgzgkrlilbcd`). Un `supabase db
> push` distraído desde acá va a producción, no a staging.

---

## 4. Edge Functions

Desplegadas en producción (`wwcpogltfgzgkrlilbcd`), medido con
`supabase functions list`:

| Función | Versión | `verify_jwt` | Sellado |
|---|---|---|---|
| `mercadopago-create-checkout-session` | 9 | false | 2026-09-08T07:29Z |
| `mercadopago-create-preference` | 9 | false | 2026-09-08T07:29Z |
| `mercadopago-checkout-status` | 9 | false | 2026-09-08T07:29Z |
| `mercadopago-webhook` | 9 | false | 2026-09-08T07:29Z |
| `mercadopago-payment-worker` | 9 | false | 2026-09-08T07:29Z |
| `mercadopago-refund` | 9 | **true** | 2026-09-08T07:29Z |
| `mercadopago-cancel-payment` | 9 | **true** | 2026-09-08T07:29Z |
| `mercadopago-connect` | 8 | false | 2026-09-08T07:29Z |
| `mercadopago-oauth-callback` | 8 | false | 2026-09-08T07:29Z |
| `fiscal-artifact-access` | **ausente** | — | **nunca desplegada** |

`verify_jwt: false` en el webhook es correcto: Mercado Pago no puede mandar un
JWT de Supabase y la autenticidad la decide la firma HMAC. Reembolso y
cancelación sí exigen JWT, que es lo que corresponde.

`fiscal-artifact-access` existe en el repositorio y **no está en producción**:
`GET` devuelve `404 Requested function was not found`. Cualquier función que
dependa de recuperar un artefacto fiscal falla sólo en producción.

Orden de despliegue al promover: `_shared` viaja con cada función, así que se
despliegan las nueve y **después** se aplican las migraciones sólo si el
runbook de `release-edge-production.yml` lo indica para ese cambio.

---

## 5. Backend de staging — CAÍDO, y no se reconstruye en este corte

| Campo | Valor | Grado |
|---|---|---|
| Ref histórica | `ukxqbgswjlibmnjemrzd` | — |
| DNS | **NXDOMAIN** | `PROBADO` |
| En la cuenta | **ausente** de `supabase projects list` | `PROBADO` |
| Veredicto | proyecto **borrado**, no pausado | `PROBADO` |

Un proyecto pausado resuelve por DNS y contesta 503. Éste no tiene registro y no
aparece en la organización. No es recuperable.

Proyectos que existen hoy en la organización Luna Systems:

| Ref | Nombre | Estado | Región |
|---|---|---|---|
| `wwcpogltfgzgkrlilbcd` | la-taba-production | ACTIVE_HEALTHY | sa-east-1 |
| `enznqfzhikpasjzpvjfd` | bitflow-production | ACTIVE_HEALTHY | sa-east-1 |
| `yakhtrkukqlgzvxuvhzs` | la-taba-demo | INACTIVE | us-east-1 |

**Decidido en este corte: no se reconstruye.** Levantar un tercer proyecto
activo excede el plan gratuito de la organización y es una decisión de gasto.

> `https://taba2-staging.pages.dev` **sigue sirviendo una tienda que parece
> funcionar sobre una base que no existe.** Conviene bajarla o ponerle un aviso:
> hoy es peor que no tener staging.

Y lo que nadie debería pasar por alto: **un proyecto Supabase de este sistema se
destruyó y ninguna capa lo denunció.** Ni CI, ni el barrido de alertas, ni la
sonda externa. La misma ceguera cubre producción.

### Lo que queda sin verificar por no haber staging

| Fase | Estado |
|---|---|
| Despliegue de la candidata a staging | `BLOQUEADO` |
| E2E entre apps (cliente → panel → rider → cliente) | `BLOQUEADO` |
| Concurrencia real contra RPC | `BLOQUEADO` |
| Aceptación iPhone 360/390/430 contra la candidata desplegada | `BLOQUEADO` |
| Aceptación del panel del negocio | `BLOQUEADO` |

---

## 6. Base de producción

| Campo | Valor | Grado |
|---|---|---|
| Ref | `wwcpogltfgzgkrlilbcd` (sa-east-1) | `PROBADO` |
| Estado | `ACTIVE_HEALTHY` | `PROBADO` |
| Salud de lectura | responde; catálogo legible con clave publicable | `PROBADO` |
| Productos visibles a anónimo | 51 | `PROBADO` |
| Vendibles | 34 | `PROBADO` |
| Alcohólicos cerrados | 17 de 17 `available=false` | `PROBADO` |
| Datos falsos o de demo | ninguno; los 51 son `catalog_origin=commercial` | `PROBADO` |

### RLS y privilegios, medidos en vivo

Sondeo anónimo sobre 17 tablas de producción:

- **`42501 permission denied` a nivel de GRANT** (antes de que RLS intervenga):
  `customers`, `customer_addresses`, `payment_intents`, `mp_seller_connections`,
  `business_payment_settings`, `rider_locations`, `identity_sessions`,
  `payment_refunds`, `payment_webhook_receipts`, `order_public_tokens`,
  `riders`, `staff_profiles`, `business_members`, `businesses`.
- **`200 []`**: `orders`, `order_items` — con GRANT, y RLS devuelve cero filas.
- **`200` con filas**: `products` — catálogo público, es lo esperado.

Grado: `PROBADO`. Defensa en profundidad correcta.

### Configuración comercial — el bloqueante que no es de código

`commerce_availability` en producción devuelve hoy:

```json
{ "is_open": true, "hours": [], "hours_enforced": false,
  "areas": [], "coverage_enforced": false,
  "delivery": { "eligible": true, "delivery_fee": 0.00, "minimum_subtotal": 0.00 },
  "ordering_ready": true }
```

Sin horario, sin zonas, sin envío y sin mínimo, con las dos compuertas
apagadas. El código implementa las cuatro cosas y las implementa bien
(`business_is_open`, `resolve_delivery_zone`, envío y mínimo congelados en la
sesión). Lo que falta son **datos**, y es la hora de trabajo más rentable que
queda en este proyecto.

---

## 7. Creación de pedidos

Leído sobre la definición viva
(`20260812220000_business_operations_checkout_enforcement.sql`):

| Propiedad | Estado | Cómo |
|---|---|---|
| Precio autoritativo del servidor | `PROBADO` | el cliente manda sólo `product_id` y `quantity`; el precio se lee de `products` bajo `FOR UPDATE` |
| Stock atómico | `PROBADO` | bloqueo por fila en orden determinístico de UUID; descuento dentro de la transacción |
| Idempotencia | `PROBADO` | `normalized_intent_hash` + `SELECT … FOR UPDATE` de la sesión existente |
| Índice único | `PROBADO` | `orders_business_client_request_key` en `(business_id, client_request_id)` |
| Lock de aviso | `PROBADO` | `pg_advisory_xact_lock(hashtext(business_id), hashtext(client_request_id))` |
| Carrito distinto con la misma clave | `PROBADO` | se rechaza con `23505` |
| Sobreventa entre línea suelta y combo | `PROBADO` | ítems consolidados por `product_id` antes de tomar locks |
| Doble envío contra base real | `SIN VERIFICAR EN VIVO` | pide staging |
| Concurrencia real medida | `SIN VERIFICAR EN VIVO` | pide staging |

El modelo en memoria de `scripts/load-concurrency-audit.mjs` es `SIMULADO` y no
cuenta como evidencia de base. Se lo dejó porque el contrato escrito sirve, y se
le corrigió el rótulo: su columna dice `Sim ops/s (NOT capacity)`. El «967
req/s» que se citó antes era la velocidad del planificador de Node sobre los
`setTimeout` de ese mismo archivo.

---

## 8. Pagos — postura de compuerta

| Campo | Valor | Grado |
|---|---|---|
| `SELLER_CONNECTED` | `FALSE` | `PROBADO` |
| `PAYMENTS_ENABLED` | `FALSE` | `PROBADO` |
| `BUSINESS_AUTHORIZED` | `FALSE` | `PROBADO` |
| `READY_FOR_WALTER_AUTHORIZATION` | `YES` | `PROBADO` |
| `MONEY_MOVEMENT_POSSIBLE` | `NO` | `PROBADO` |

Evidencia: las nueve funciones rechazan `GET` con 405 y no filtran nada;
`get_mercadopago_checkout_availability` contesta `permission denied` a un
anónimo; el callback de OAuth **ignora** un `redirect_uri` puesto por el
atacante y redirige siempre al destino de configuración (probado con
`?redirect_uri=https://evil.example.com` — sin redirección abierta).

No se movió dinero, no se hizo ningún reembolso, no se tocó ninguna bandera y no
se completó ningún OAuth.

### Firma y reembolso, leídos en la candidata

| Propiedad | Estado |
|---|---|
| Firma de webhook por el SDK oficial, sobre el `data.id` de la query | `PROBADO` |
| Rechazo si el `data.id` del cuerpo no coincide con el de la query | `PROBADO` |
| Ventana de frescura 5 min + 60 s de tolerancia futura | `PROBADO` |
| Acuse sólo después de persistir | `PROBADO` |
| El outbox relee al proveedor antes de validar plata | `PROBADO` |
| Reembolso sin ID vinculado ⇒ `ambiguous`, nunca adivina de una lista | `PROBADO` |
| ID ya usado por otro reembolso ⇒ `rejected` | `PROBADO` |
| Monto en centavos enteros con guarda de deriva de punto flotante | `PROBADO` |
| Todo lo anterior **en producción** | **NO** — ver §2 |

---

## 9. Respaldo y recuperación

Medido con `supabase backups list --project-ref wwcpogltfgzgkrlilbcd`. Esto
**corrige** el `UNKNOWN` de la auditoría anterior:

| Campo | Valor | Grado |
|---|---|---|
| `BACKUP_STATUS` | **existen**: respaldos físicos diarios automáticos, 7 con estado `COMPLETED` | `PROBADO` |
| `BACKUP_TYPE` | físico WAL-G (`walg_enabled: true`) | `PROBADO` |
| `BACKUP_RETENTION` | 7 días rodantes (2026-09-11 … 2026-09-17) | `PROBADO` |
| `PITR` | **NO** (`pitr_enabled: false`) | `PROBADO` |
| `RPO_ESTIMATE` | **hasta ~24 h.** Los respaldos corren ~06:47 UTC; una pérdida a las 06:46 UTC se lleva casi un día de pedidos | `PROBADO` (derivado de las marcas) |
| `RTO_ESTIMATE` | `UNKNOWN` — nunca se restauró | `SIN VERIFICAR EN VIVO` |
| `RESTORE_DRILL_STATUS` | **NOT DONE** | `PROBADO` (el propio doc lo declara `NOT_RUN`) |

Lectura honesta: una pérdida total **no** es irrecuperable, y la auditoría
anterior fue demasiado pesimista al decirlo. Pero hasta 24 horas de pedidos,
pagos y correlación fiscal sí se pueden perder, y **nadie restauró nunca este
respaldo**, así que el tiempo de recuperación es desconocido. Un respaldo que
existe no es un respaldo probado.

---

## 10. Observabilidad — qué se ve de verdad

| Señal | Dónde vive | Alcance |
|---|---|---|
| `order_events`, `payment_events` | servidor, Postgres | `CENTRALIZADO` |
| `payment_webhook_receipts` | servidor, Postgres | `CENTRALIZADO` |
| `operational_alerts`, `operational_alert_events` | servidor, Postgres | `CENTRALIZADO` |
| `operational_sweep_runs`, `cron.job_run_details` | servidor, Postgres | `CENTRALIZADO` |
| Sonda externa del planificador | GitHub Actions, cada 10 min | `CENTRALIZADO` |
| `TABA_FUNNEL` | `localStorage` del cliente | **CLIENT-LOCAL, EFÍMERO** |
| `[TABA_DIAGNOSTIC]` | consola del cliente | **CLIENT-LOCAL, EFÍMERO** |

`CENTRALIZED_FUNNEL_ANALYTICS: NO.` El módulo del embudo no tiene transporte:
ni `fetch`, ni `sendBeacon`, ni escritura a Supabase. El embudo de un cliente
vive en el teléfono de ese cliente. `TABA_FUNNEL.getSummary()` devuelve el
embudo **del dispositivo donde se ejecuta**, y sirve para QA con el teléfono en
la mano y para nada más.

Diagnóstico de un incidente real: por las tablas del servidor. El runbook §5
ahora arranca por ahí, con una pregunta operativa por fila, en vez de mandar a
abrir DevTools en el teléfono de un cliente.

`PII_SAFE: PASS` para los emisores de este repositorio —mandan identificadores,
conteos y totales— con la salvedad escrita en el módulo: el filtro es por
**nombre de clave**, no por valor, así que un emisor nuevo que mande texto libre
en una clave no listada lo persistiría.

---

## 11. Rider

Ver `RIDER-RELEASE.md` al lado de este archivo.

---

## 12. Bloqueantes externos

1. **Configuración comercial en producción** (horario, zonas, envío, mínimo).
   Datos, no código. Es la decisión del comercio, no del release.
2. **Backend de staging.** Decisión de gasto: reactivar `la-taba-demo` o crear
   un proyecto nuevo en sa-east-1. Sin esto no hay E2E entre apps, ni
   concurrencia real, ni aceptación de iPhone contra la candidata desplegada.
3. **Walter autoriza el OAuth de Mercado Pago.** La compuerta está lista y
   cerrada.
4. **Cinco migraciones de producción** (§3), en orden, con respaldo del día
   verificado antes.
5. **Ensayo de restauración.** Los respaldos existen; nunca se restauraron.
6. **Bajar o señalizar `taba2-staging.pages.dev`**, que hoy sirve una tienda
   sobre una base inexistente.
