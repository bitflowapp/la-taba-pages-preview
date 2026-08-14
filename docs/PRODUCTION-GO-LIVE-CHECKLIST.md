# TABA2 · Checklist de salida a producción

Auditoría del **2026-08-14** sobre `release/taba2-commercial-rc @ bc9af92`
(96 migraciones, ledger 96/96) y `feature/taba2-rider-pilot-integration @ 894267a`.

**Producción no existe. No se creó nada. No se desplegó nada. No se mergeó ni se
pusheó nada. Staging quedó intacto.**

---

## 0 · Veredicto

# NO-GO — 6 bloqueantes técnicos, 7 bloqueantes humanos

Ninguno es grande. Ninguno es de arquitectura. Pero se cobra dinero real recién
cuando los 13 estén cerrados.

---

## 1 · Clasificación del código

### `MUST BEFORE PROD`

| # | Qué | Dónde | Estado |
|---|---|---|---|
| M1 | **La RC comercial entera** — 499 commits sobre `main`, incluye los dos P0 cerrados (doble pedido del mismo carrito · «Transferencia» que la base rechaza siempre) y las correcciones de sesión, pagos, tracking, carrito y PWA | `release/taba2-commercial-rc @ bc9af92` | listo, congelado |
| M2 | **Endurecimiento del Cliente post-demo** — la app se congelaba en Chrome/iPhone y no volvía a preguntar por el estado del pedido | `fix/taba2-customer-postdemo-hardening` | ⚠️ **SIN COMMITEAR** |
| M3 | **H-07** — el repartidor lee caja, fiscal e inventario del comercio | migración nueva | no escrita |
| M4 | **`commercial_contract_remediation` sin RLS** — anónimo lee y **escribe** | migración nueva | no escrita |
| M5 | **`?demo=1` en un origen productivo** — sirve una tienda simulada y «confirma» pedidos que no existen | `js/core/app-mode.js` | no corregido |
| M6 | **Bump de `?v=` y `CACHE_NAME`** — sin él, dos artefactos distintos son indistinguibles y el rollback se queda sin ancla | 28 sitios + 7 pruebas que lo pinean | no hecho |

#### M2 merece un párrafo aparte

`fix/taba2-customer-postdemo-hardening` está **a cero commits** de la RC: todo su
trabajo vive **sin commitear** en el worktree `…\worktrees\taba2-customer-postdemo`
—4 archivos modificados y 4 sin seguimiento, entre ellos el módulo nuevo
`js/core/browser-resume.js` y 18 pruebas—.

Eso es una release candidate a un `git clean` de distancia de dejar de existir.
**La primera acción de la próxima sesión es commitearlo**, antes de cualquier
otra cosa.

Y el contenido es MUST, no cosmético. La causa raíz: la app **desarmaba** el
seguimiento con un evento (`pagehide`) y lo **rearmaba** con otro distinto
(`pageshow`), y `pagehide` no pausaba sino que destruía el controlador —incluidos
sus propios listeners de reanudación—. En cualquier navegador cuyo par
suspender/reanudar no sea simétrico en esos dos eventos, el cliente queda
congelado para siempre. Chrome en iPhone es el que hoy cae del lado malo: emite
`pagehide` y **no** emite `pageshow`.

El servidor nunca fue el problema: `get_public_order_tracking` devuelve el estado
autoritativo completo en una llamada. El cliente dejaba de preguntar.

**Un cliente que paga y ve su pedido congelado en «recibido» es un problema de
producción, no de demo.**

### `SAFE POST-LAUNCH`

| Qué | Dónde | Por qué puede esperar |
|---|---|---|
| **Motor de merchandising y personalización** (hero contextual, puertas rankeadas, orden por afinidad, campañas) | `feature/taba2-commerce-growth-engine` · 9 commits, ~5.970 líneas | Es crecimiento, no funcionamiento. Ninguna venta depende de él. Con 30 SKUs la personalización tiene poco que personalizar |
| BOLA de `get_mercadopago_checkout_availability` | migración | Single-tenant: hay un solo comercio. **Deja de poder esperar el día que entre un segundo comercio** |
| Oráculo `can_recover_paid_checkout` | migración | UUID v4 no enumerable; el dato es un booleano |
| H-02 · en teléfono no se ve qué orden está aplicado | `styles/responsive.css` | P2 de UX |
| Los otros 13 nombres que ocultan la variante | catálogo | ninguno entra en los 30 del lanzamiento |
| Puente fiscal ARCA | `services/arca-fiscal-bridge` | el piloto factura por el medio habitual de Walter |
| Turnos, disponibilidad y auto-despacho del Rider | `feature/taba2-automated-rider-dispatch` | fuera del modelo del piloto |

> **Excepción dentro de growth.** El commit `0192c68` de esa rama es el único que
> contiene `catalog/CATALOG-COMMERCIAL-AUTHORITY.csv`, que **sí** es MUST: es la
> fuente del catálogo de lanzamiento. Es un commit de sólo documentación y se
> toma aparte, sin arrastrar el motor.

### `DO NOT INTEGRATE`

| Qué | Por qué |
|---|---|
| `feature/taba2-automated-rider-dispatch` | Sus RPC (`rider_work_now`, `rider_start_shift`, `get_rider_operational_state`) **no están migradas y devuelven 404**. La RC del Rider las evita no construyendo el controlador que las llama |
| Cualquier dato de staging: pedidos, usuarios, sesiones de checkout, intentos de pago | En staging hay **42 pedidos con `origin='production'` que no son reales**. El campo `origin` ya no distingue un pedido real de un ensayo |
| Fixtures de catálogo de QA (`catalog_origin` en `test_only` / `staging_only`) | |
| `runtime-config.js` de staging | apunta al proyecto equivocado; el de PROD se genera en el despliegue y no se versiona |

---

## 2 · H-07 · Exposición del Rider a caja, fiscal y auditoría

# VEREDICTO: `MUST FIX BEFORE PROD`

### Policy actual

`business_members.role` admite `owner`, `admin`, `staff` y **`rider`**, y la
propia tabla se documenta diciendo que «staff and rider have **scoped**
operational access».

Pero la función que deciden 19 policies de lectura **no mira el rol**:

```sql
-- 20260812030000_identity_authorization_gate.sql
create or replace function public.is_business_member(target_business_id uuid)
returns boolean language sql stable security definer as $$
  select public.identity_member_role(target_business_id) is not null
$$;
```

`identity_member_role` verifica mucho —usuario no anónimo, membresía activa,
usuario no deshabilitado, sesión no revocada, token posterior al corte— y
después **devuelve el rol sin que nadie lo compare con nada**.

Las 19 policies afectadas
(`20260802160000_business_windows_scanner_fiscal.sql:1190-1207` y vecinas):

- `pos_sales`, `pos_sale_items`, `pos_payments` — **ventas de mostrador y caja**
- `fiscal_profiles`, `fiscal_documents`, `fiscal_document_items`, `fiscal_events`
- `business_command_receipts` — **auditoría de comandos, con el payload de los
  pedidos**, es decir datos personales de clientes que no son suyos
- `inventory_movements`, `inventory_receipts`, `stock_count_sessions`, `stock_count_items`
- `catalog_product_drafts`, `product_barcodes`, `notification_outbox`,
  `order_packing_sessions`, `order_packing_scans`, `inventory_receipt_items`

Un repartidor —que muchas veces es un tercero contratado— con la clave anónima
pública y su sesión puede leer las 19. **El «scoped» del comentario no está
implementado.**

### Policy propuesta

En esas 19 policies, y sólo en ésas:

```sql
-- de:
using (public.is_business_member(business_id))
-- a:
using (public.has_business_role(business_id, array['owner','admin','staff']))
```

**Qué NO se toca:** `is_business_member` en sí (sigue siendo la respuesta
correcta a «¿pertenece a este comercio?»), `is_assigned_rider`, y las policies
por las que el repartidor ve **los pedidos que tiene asignados**, que es su
trabajo.

### Impacto — medido, no estimado

**Cero.** Verificado sobre `feature/taba2-rider-pilot-integration @ 894267a`:

```
grep -rn "pos_sales|fiscal_|inventory_movements|business_command_receipts|stock_count" lib/
→ 0 resultados
```

La app del Rider **no menciona ninguna de esas tablas**. Habla por sus propias
RPC. Los únicos consumidores en el cliente web son tres repositorios del **Panel**
(`supabase-pos-repository`, `supabase-fiscal-repository`,
`supabase-inventory-repository`), y el Panel lo operan `owner`, `admin` y
`staff` — exactamente el conjunto que la policy nueva conserva.

### Rollback

Volver a `is_business_member(business_id)` en las mismas 19 policies. **No hay
pérdida de datos**: sólo cambia quién puede leer. Es reversible con una
migración inversa de la misma forma.

### Por qué no puede diferirse

Diferirlo sería aceptar que un tercero contratado lea la caja del comercio y los
datos personales de clientes con los que no tiene relación. El arreglo es una
migración de 19 líneas con impacto medido en cero. **La proporción entre riesgo y
costo no admite diferirlo.**

---

## 3 · BOLA / IDOR / aislamiento de inquilinos

# VEREDICTO: `PASS con 2 excepciones` — y **no certificable para multi-inquilino**

### Alcance de la prueba

- **Barrido estático completo**: las 96 migraciones, resolviendo `grant`/`revoke`
  en orden de aplicación. **81 funciones son invocables por `anon` o
  `authenticated`.** De ésas, **71 llevan una comprobación de autorización
  explícita** en su cuerpo.
- **Sondas en vivo, de sólo lectura**, contra staging con la clave anónima
  pública. Ninguna creó, modificó ni borró una fila.

### Un ID enviado por el cliente nunca equivalió a autorización

| Sonda | Resultado |
|---|---|
| `can_access_order(uuid al azar)` | `false` |
| `get_public_order_tracking(token falsificado)` | sin datos |
| `list_business_combos(business_id ajeno)` | `[]` |
| `identity_member_role(...)` como anónimo | `42501 permission denied` |
| SELECT anónimo a `businesses`, `customers`, `customer_addresses`, `rider_locations`, `payment_attempts`, `pos_sales`, `fiscal_documents`, `business_command_receipts` | **401** en las 8 |
| SELECT anónimo a `orders` / `order_items` | `200 []` — el privilegio existe, **RLS lo tapa** |

### ❌ Excepción 1 — `commercial_contract_remediation` · **BLOQUEANTE**

**De las 84 tablas de `public`, 83 tienen RLS. Ésta es la única que no.**

Y no está protegida por privilegios: los privilegios por defecto de Supabase
alcanzan a `anon`. Demostrado en vivo, con control:

```
POST /rest/v1/commercial_contract_remediation  {}
→ 400  23502  null value in column "migration" violates not-null constraint

POST /rest/v1/orders  {}                                        ← control
→ 401  42501  permission denied for table orders
```

La primera llamada **atravesó la comprobación de privilegios** y murió recién
contra un `NOT NULL`. La segunda murió en el privilegio. La diferencia entre
`23502` y `42501` prueba que **`anon` tiene INSERT**. *(La sonda no pudo crear
ninguna fila: el cuerpo viola la restricción a propósito.)*

Es decir: **cualquiera en internet, sin cuenta, puede escribir filas en esa tabla
de producción.** Lectura también (`200 []` frente al `401` de las demás).

**Impacto:** escritura sin autenticar y sin límite contra la base de producción
—crecimiento de disco, y una tabla de auditoría que deja de ser confiable—. Con
8 GB de disco incluidos en el plan, es también un riesgo de costo y de
disponibilidad.

**Arreglo:** una migración.

```sql
alter table public.commercial_contract_remediation enable row level security;
revoke all on table public.commercial_contract_remediation from anon, authenticated;
```

**Impacto del arreglo: cero.** La única referencia en todo el repositorio es
`tests/commercial-price-contract.test.mjs:156`, que lee el **texto** de la
migración. Ningún código lee ni escribe esa tabla.

**Rollback:** `disable row level security` y devolver los grants.

### ⚠️ Excepción 2 — `get_mercadopago_checkout_availability` · `CAN DEFER`

`security definer`, concedida a `authenticated`, recibe un `p_business_id` del
cliente y **no comprueba quién llama**. Cualquier usuario autenticado —incluido
un cliente anónimo de otro comercio— obtiene de **cualquier** comercio: si está
activo y abierto, si tiene pedidos habilitados, el entorno de Mercado Pago
(test/producción), el modo de checkout, si acepta medios offline y el tope de
cuotas.

Es un BOLA de manual —referencia a objeto sin autorización— pero lo que expone es
configuración comercial de bajo valor, y hoy **hay un solo comercio en la base**.

**Se difiere. Deja de poder diferirse el día que entre un segundo comercio.**

### ⚠️ Excepción 3 — `can_recover_paid_checkout(uuid)` · `CAN DEFER`

Oráculo booleano sobre un `payment_intent_id` arbitrario, sin comprobar al
llamador. UUID v4 no es enumerable y la respuesta es un booleano. Se anota por el
patrón, no por el impacto.

### 🔴 Lo que esta prueba **no** puede certificar

**El aislamiento entre comercios no se puede demostrar contra una base con un
solo comercio.** Un `[]` puede significar «la policy te frenó» o «no hay datos».
Son indistinguibles desde afuera.

Las escrituras cruzadas tampoco se probaron: hacerlo exige mutar, y staging es el
piloto.

**Gate obligatorio, antes del GO:** sobre la base de **PROD recién construida y
todavía vacía**, cargar un segundo comercio de descarte con su propio owner,
staff y rider, y correr la matriz completa —`business_id`, `order_id`,
`rider_user_id`, `payment_id` y parámetros JSON de RPC— cruzando los seis roles:
owner, admin, staff, rider, cliente y anónimo. **Después borrar el comercio de
descarte.** Es el único momento en que se puede probar sin arriesgar datos
reales, y es barato porque la base está vacía.

---

## 4 · Bloqueantes técnicos

| # | Bloqueante | Evidencia |
|---|---|---|
| **B1** | El trabajo del Cliente post-demo está **sin commitear** | 4 modificados + 4 sin seguimiento; 0 commits sobre la RC |
| **B2** | **H-07** abierto | §2 |
| **B3** | **`commercial_contract_remediation`** escribible sin autenticar | §3, probado en vivo |
| **B4** | `?demo=1` sirve tienda simulada **incluso con configuración de producción** | `js/core/app-mode.js:29` — `if (isDemoMode(search)) return APP_MODE_DEMO;` corre **antes** de mirar el runtime. Y no hay rótulo de simulación en ninguna parte |
| **B5** | **No se puede validar que producción nazca de las migraciones**: Docker no corre en este host, así que `supabase test db --local`, `supabase db dump` y la reconstrucción desde cero no se pueden ejecutar | la sesión de endurecimiento ya lo encontró: «`supabase db dump` no está disponible en este host» |
| **B6** | El build `release` del Rider sale **sin firmar** si no hay keystore: `signingConfig = if (releaseSigningConfigured) … else null` | `android/app/build.gradle.kts:103` |

### Riesgos que no bloquean pero hay que mirar de frente

- **49 de 63 hallazgos de la auditoría de 14 frentes quedaron sin veredicto**
  porque sus verificadores murieron por límite de sesión. La RC posterior cerró
  varios (retorno de MP, expiración terminal del tracking, carrito con selección
  concurrente, caché atómica de la PWA, cancelación genérica después del cobro),
  pero **nadie los volvió a contar uno por uno**. No son bugs; son incógnitas.
- **El frente `ux-copy-a11y` nunca se auditó**: su agente murió antes de empezar.
- **Gates físicos sin correr**: el iPhone real nunca se probó, y el gate del Moto
  G15 quedó a mitad porque el teléfono se desconectó del USB. *(Trampa anotada
  para quien lo retome: con el USB cayéndose, `screencap` devuelve frames a medio
  componer que se leen igual que un layout roto — pasaba también en Google Maps y
  en la pantalla de bloqueo.)*
- **Staging no tiene horarios ni zonas de envío**, y la exigencia está apagada.
  Medido en vivo: `hours: []`, `areas: []`, `hours_enforced: false`,
  `coverage_enforced: false`. En producción eso significa un local que acepta
  pedidos las 24 h desde cualquier distancia.

---

## 5 · Bloqueantes humanos

| # | Quién | Qué | Bloquea |
|---|---|---|---|
| H1 | Walter | **¿Se habilita la venta de alcohol?** (`alcohol_sales_enabled = false`) | 24 de los 30 SKUs. Un negocio de bebidas que no puede vender alcohol no está comercialmente listo |
| H2 | Walter | Aprobar precio, stock y derecho de publicación de los 18 de la Lista A | el lanzamiento entero |
| H3 | Walter | Poner precio a los 12 de la Lista B | la mitad del surtido |
| H4 | Walter | Datos reales del local: dirección, **pin verificado a mano**, horarios, zonas de envío, costo, mínimo, huso horario | sin esto el local abre 24/7 y reparte a cualquier distancia |
| H5 | Walter | Cuenta **productiva** de Mercado Pago y su aprobación de revisión | el cobro real |
| H6 | Marco | Dominio: cuál, quién lo registra, quién lo paga (es el único gasto fuera de los USD 25) | el despliegue |
| H7 | Marco | **Autorización explícita para crear el proyecto de producción** y activar facturación | todo |

---

## 6 · Plan de la base de datos

**Producción nace de `supabase/migrations/`. No se copia el esquema de staging.**

### Validación previa — hay que resolver B5

Ninguno de estos pasos existe todavía porque Docker no corre:

- [ ] **Historia canónica**: `npm run migrations:validate` en verde
- [ ] **Reconstrucción desde cero**: las 96 migraciones sobre una base vacía, en
      orden, sin una sola pendiente en `supabase migration list`
- [ ] **pgTAP**: correr las suites de `supabase/tests/` (hoy 9 `.sql` + 7
      `.local.sql`) contra esa base reconstruida
- [ ] **Deriva**: comparar el esquema reconstruido contra el vivo de staging y
      explicar cada diferencia. *(La sesión de reconciliación ya encontró una vez
      16 migraciones aplicadas en staging que no estaban en la rama, y un
      `create or replace` que habría revertido en silencio el trabajo de otra
      sesión. No es un riesgo teórico.)*
- [ ] **Restore**: restaurar un backup a un proyecto de descarte y verificar que
      arranca

**Dos caminos para desbloquear B5**, y hay que elegir uno:
**(a)** levantar Docker Desktop en este host y usar `supabase start`;
**(b)** crear un proyecto Supabase Free de descarte, aplicar las 96 migraciones
ahí, correr todo y borrarlo. Cuesta USD 0 y prueba exactamente lo que hay que
probar: que producción puede nacer de cero.

### Bootstrap de producción — y sólo esto

- [ ] `businesses`: el comercio real de Walter
- [ ] Owner + staff
- [ ] Riders
- [ ] Huso horario (`operating_timezone`) — **el cierre de caja se firma con esta
      zona, no con la del navegador del operador**
- [ ] Horarios de servicio, con la exigencia **encendida**
- [ ] Zonas de envío + costo + mínimo, con la exigencia **encendida**
- [ ] El tope de distancia exige el **punto del local verificado por una persona**
      (la RPC lo rechaza si no existe: «el tope de distancia necesita el punto del
      local verificado por una persona»)
- [ ] Catálogo autorizado — los 30 SKUs de `PRODUCTION-CATALOG-LAUNCH.md`
- [ ] Configuración de pagos

**No se copian cuentas ni pedidos de QA.**

---

## 7 · Mercado Pago · transición TEST → PROD

### Secretos — distintos, nuevos, nunca reutilizados

| Secreto | PROD |
|---|---|
| `MERCADOPAGO_ACCESS_TOKEN` | productivo |
| `MERCADOPAGO_ENVIRONMENT` | `test` al principio → `production` sólo en el paso final |
| `MERCADOPAGO_WEBHOOK_SECRET` | productivo, nuevo |
| `PAYMENT_LOG_HASH_SALT` | **nuevo**, no reutilizar el de staging |
| `PAYMENT_WORKER_SECRET` | **nuevo** |
| `TABA_ALLOWED_ORIGINS` | el dominio de PROD |
| `TABA_CHECKOUT_BASE_URL` | el dominio de PROD |
| `MERCADOPAGO_PRODUCTION_REVIEW_STATUS` | **falta a propósito hasta el día del cobro real** |

La última es la red de seguridad: sin ella, `providerEnvironment()` **lanza
excepción** si el entorno es `production`. Funciona, y no hay que tocarla.

### Lo que ya está resuelto en el código

Validación de firma HMAC-SHA256 sobre el `data.id` de la query (que es lo que
Mercado Pago firma) · exigencia de POST y HTTPS · tope de 16 KB · límite de tasa
240/60 s · **recibo idempotente persistido antes de procesar** · trabajo pesado
en un outbox durable con reintentos · respuesta 201 en menos de 22 s.

Un webhook duplicado **no** crea un segundo pedido.

### Las 8 Edge Functions

En staging faltan dos: `mercadopago-cancel-payment` y `fiscal-artifact-access`.
**En PROD se despliegan las 8**, o se decide explícitamente no desplegar alguna.
No se arrastra el olvido.

### El pago real controlado — un solo pago, de importe bajo

- [ ] `MERCADOPAGO_ENVIRONMENT=production` + `MERCADOPAGO_PRODUCTION_REVIEW_STATUS=approved`
- [ ] Un pedido real, importe bajo, con una tarjeta real
- [ ] Verificar la cadena: `approved → pedido creado → Panel → asignación →
      Rider → GPS → tracking → PIN → delivered`
- [ ] Verificar que el webhook llegó **firmado** y que el recibo quedó
- [ ] **Devolución** de ese pago y conciliación contra `list_business_payments`
- [ ] Si algo falla: quitar `MERCADOPAGO_PRODUCTION_REVIEW_STATUS` y el cobro
      real se apaga sin desplegar nada

---

## 8 · Rider en producción

Modelo sin cambios: **el Panel asigna → el Rider recibe.** Sin turnos, sin
auto-despacho.

- [ ] `applicationId = com.lataba.rider` (flavor `production`)
- [ ] `TABA_PRODUCTION_BACKEND_PROJECT_REF`, `TABA_PRODUCTION_SUPABASE_URL`,
      `TABA_PRODUCTION_PUBLISHABLE_KEY`, `TABA_PRODUCTION_BUSINESS_ID`
      *(la URL se valida: tiene que ser exactamente `https://$ref.supabase.co`)*
- [ ] **Keystore de release creado y configurado** — hoy, sin él, el APK sale sin
      firmar (B6). La clave se guarda fuera del repositorio y se hace copia: si se
      pierde, no se puede volver a publicar la misma app
- [ ] Usuario rider creado en PROD con rol `rider` y membresía activa
- [ ] Gate físico completo en el Moto G15: asignación desde el Panel → aparece
      solo → retirado → en camino → GPS → llegué → PIN → entregado
- [ ] Verificar que **no** aparece «Trabajar ahora» ni la cola de pedidos libres
- [ ] Con el arreglo de H-07 aplicado: confirmar que el Rider sigue funcionando
      entero (debería, porque no toca ninguna de las 19 tablas)

---

## 9 · Backups

**PITR queda fuera del presupuesto** (USD 100/mes + un compute Small de USD 15).
Ver `PRODUCTION-INFRA-COSTS.md`. Esto **reemplaza** el requisito «PITR encendido
antes del primer pedido» de `PRODUCCION-PREPARACION.md`.

| Capa | Qué | Retención | Costo |
|---|---|---|---|
| Backups diarios de Supabase | automáticos, incluidos en Pro | **7 días** | USD 0 |
| Volcado lógico nocturno | `supabase db dump` desde GitHub Actions, guardado fuera de Supabase | a elección | USD 0 |
| Registro autoritativo de pagos | la propia cuenta de Mercado Pago | permanente | USD 0 |

**RPO real: hasta 24 horas de pedidos** en el peor caso. Es la consecuencia
honesta del presupuesto y está aceptada explícitamente en el documento de costos,
con su condición de revisión.

- [ ] Confirmar que el primer backup diario existe **antes** del primer pedido real
- [ ] El volcado nocturno corriendo y su artefacto verificado
- [ ] **Restore probado al menos una vez** contra un proyecto de descarte

---

## 10 · Observabilidad mínima

Tres capas, ninguna con servidor propio (§9 de `PRODUCTION-ARCHITECTURE.md`).

| Qué hay que poder detectar | Con qué | Estado |
|---|---|---|
| Checkout fallando | `operational_alerts` + el Panel | existe |
| Webhook de MP fallando | recibos con `signature_valid=false` + outbox atascado | existe |
| Pedido que no llega al Panel | barrido de alertas de `pg_cron` (cada 60 s) | existe · verificado en staging: `healthy:true`, `age_seconds` 36 |
| Errores de auth / DB / Edge | logs de Supabase (Pro: 7 días) | incluido |
| Errores de GPS / tracking | alertas operativas del propio circuito | existe |
| **Que el vigilante se muera** | dos relojes externos | ❌ **ninguno corriendo** |

- [ ] Desplegar el Worker `services/scheduler-watchdog/` con su cron `*/5` y su
      secreto `SUPABASE_ANON_KEY`
- [ ] Poner `.github/workflows/scheduler-watchdog.yml` **en la rama por defecto
      del remoto** —hoy no está, y por eso el cron nunca disparó— con el secreto
      y la variable de repositorio. Es la única capa que **avisa por correo**
- [ ] Verificar `scheduler_heartbeat()` en `healthy:true` contra PROD
- [ ] Definir a qué correo llegan las alertas y quién lo mira

---

## 11 · Rollback

**Ningún despliegue sale sin esto escrito y probado.**

| Capa | Cómo se vuelve atrás | Probado |
|---|---|---|
| **Web** | re-promover el deployment anterior en Cloudflare Pages. El SHA anterior queda anotado antes de publicar | ❌ |
| **`runtime-config.js`** | restaurar el archivo preservado y verificar `sha256` contra el sitio publicado. Es el error que deja el sitio sin arrancar | ❌ |
| **Service worker / caché** | acá se cobra el bump de M6: sin `?v=` y `CACHE_NAME` nuevos, volver al artefacto anterior **no se distingue** de quedarse en el nuevo | ❌ |
| **Edge Functions** | `supabase functions deploy` de la versión anterior | ❌ |
| **Cobro caído** | **quitar `MERCADOPAGO_PRODUCTION_REVIEW_STATUS`** → `providerEnvironment()` falla cerrado y no se cobra más. Sin desplegar nada | ❌ |
| **Migración que falla** | se aplican **de a una**, verificando entre cada una. Cada migración lleva su inversa escrita antes de aplicarse. Si ya escribió datos: restaurar el backup diario | ❌ |
| **Apagar la tienda** | `set_business_open_state` desde el Panel deja de aceptar pedidos sin desplegar nada | ❌ |

Regla que ya se pagó una vez: **`create or replace` pisa y sigue.** Una migración
que redefine una función tomando como base una definición vieja **revierte en
silencio** el trabajo de otra sesión. Antes de aplicar, comparar contra la
definición **vigente**, no contra la que está en la rama.

---

## 12 · Compuerta de GO-LIVE

Sin excepciones. Sin «lo vemos después».

- [ ] **P0 técnicos = 0**
- [ ] **P1 técnicos = 0**
- [ ] **H-07** corregido y verificado — o decisión explícita y firmada de Walter
- [ ] **`commercial_contract_remediation`** con RLS y sin grants a `anon`
- [ ] **Aislamiento de inquilinos PASS** — matriz de 6 roles contra un segundo
      comercio de descarte, sobre PROD vacía, y después borrarlo
- [ ] **Catálogo autorizado** — 30 SKUs, ninguno «Precio próximamente», sin
      nombres repetidos, `speed-zero-lata-473ml` renombrado
- [ ] **DB de PROD PASS** — 96 migraciones sobre base vacía, pgTAP verde, restore
      probado, privilegios verificados **consultando la base**, no leyendo archivos
- [ ] **Cliente PASS** — incluye el arreglo M2 y los gates físicos de iPhone y
      Moto G15
- [ ] **Negocio PASS** — recepción, estados, asignación, caja
- [ ] **Rider PASS** — APK firmado, gate físico completo
- [ ] **MP PROD PASS** — un pago real de importe bajo, su cadena completa, su
      devolución y su conciliación
- [ ] **Backups PASS** — backup diario existente y restore probado
- [ ] **Observabilidad PASS** — los dos relojes externos corriendo, con destinatario
- [ ] **Rollback PASS** — probado al menos una vez, no sólo escrito
- [ ] **Smoke físico PASS**:
      `Cliente → pedido → Negocio → asignación → Rider → GPS → tracking → PIN → delivered`

---

## 13 · Secuencia de salida

Cada paso es reversible y ninguno cobra dinero hasta el 15.

| # | Paso | Reversible por |
|---|---|---|
| 1 | **Commitear M2** (el trabajo del Cliente sin commitear) | — |
| 2 | Escribir las migraciones de H-07 y de la tabla sin RLS, con su inversa | — |
| 3 | Corregir `?demo=1` en origen productivo (M5) | — |
| 4 | Resolver B5: Docker o proyecto Free de descarte. **Reconstruir desde cero + pgTAP** | borrar el proyecto de descarte |
| 5 | Bump de `?v=` y `CACHE_NAME` (M6) y `npm run verify` completo | commit |
| 6 | Publicar la candidata a un **preview** de Cloudflare Pages y correr el smoke | borrar el preview |
| 7 | **Gates físicos**: iPhone real y Moto G15 | — |
| 8 | ⛔ **Autorización de Walter (H7)** | — |
| 9 | Crear la organización Supabase Pro y el proyecto de PROD | borrar el proyecto |
| 10 | 96 migraciones **de a una**; secretos con `MERCADOPAGO_ENVIRONMENT=test`; 8 Edge Functions | borrar el proyecto |
| 11 | **Matriz de aislamiento** con el comercio de descarte, y borrarlo | — |
| 12 | Bootstrap: comercio, horarios, zonas, staff, riders, catálogo de 30 | — |
| 13 | Proyecto Cloudflare Pages de PROD + dominio + `runtime-config` verificado por hash | re-promover / apuntar el DNS |
| 14 | Rider `production` firmado, instalado, gate físico contra PROD | reinstalar el de staging |
| 15 | 🔴 **Mercado Pago productivo**: las dos variables + **un pago real de importe bajo** + devolución | quitar una variable |
| 16 | Verificar backup diario + restore + los dos relojes externos | — |
| 17 | ✅ Abrir al público |

---

## 14 · Lo que esta sesión NO hizo

- No creó producción, ni organización, ni proyecto, ni facturación.
- No registró dominio ni tocó DNS.
- No tocó Mercado Pago ni movió dinero.
- No mergeó ni pusheó nada.
- No aplicó ninguna migración.
- No modificó `release/taba2-commercial-rc`, ni el Rider, ni `main`.
- **No mutó staging.** Las sondas fueron de lectura; la única que envió un POST
  llevaba un cuerpo que viola una restricción `NOT NULL` a propósito, y por eso
  no pudo crear ninguna fila. Se leyó el lock de staging antes y después.
