# TABA2 · Arquitectura de producción

Base: `release/taba2-commercial-rc @ bc9af92` · 96 migraciones · 8 Edge Functions.

**Producción no existe todavía.** Este documento describe lo que hay que crear y
por qué cada pieza está donde está. No crea nada.

---

## 1 · El principio que ordena todo el diseño

> **Ningún componente de TABA2 necesita un servidor propio encendido 24/7.**

Eso no es una preferencia de presupuesto: es una propiedad medida del sistema.

| Capa | Dónde corre hoy | ¿Necesita compute persistente? |
|---|---|---|
| Storefront del Cliente | archivos estáticos (HTML/CSS/JS + service worker) | **No.** No hay build server ni SSR: `index.html` carga `runtime-config.js` y habla directo con Supabase |
| Panel del Negocio | la misma app estática, vista `business` | **No** |
| Autenticación, datos, RLS | Postgres de Supabase | No: es servicio gestionado |
| Realtime (pedidos, stock) | Supabase Realtime | No |
| Pagos (Mercado Pago) | 8 Edge Functions (Deno, bajo demanda) | **No**: se despiertan por request |
| Trabajo diferido de pagos | `mercadopago-payment-worker` + outbox en DB, disparado por `pg_net`/`pg_cron` | No |
| Barrido de alertas | `pg_cron` dentro de Postgres | No |
| Reloj externo de vigilancia | Cloudflare Worker (cron) + GitHub Actions (cron) | No: son disparos, no procesos |
| App del Rider | APK Android, habla directo con Supabase | No |
| **Puente fiscal ARCA** | `services/arca-fiscal-bridge` — Node 22, proceso largo, worker de artefactos, certificado X.509 en disco | **SÍ — y es el único** |

**Conclusión:** el único componente que justificaría un VPS es el puente fiscal
ARCA, y ARCA está **fuera del lanzamiento** (§7). Recomendar un servidor
tradicional para el resto sería pagar por algo que el sistema no usa.

---

## 2 · Topología de producción

```
                    ┌──────────────────────────────────────┐
   Cliente  ───────►│  Cloudflare Pages  (proyecto PROD)   │  estático, $0
   (navegador)      │  dominio propio + HTTPS + HSTS       │
                    └──────────────┬───────────────────────┘
                                   │  runtime-config.js  (sólo valores públicos)
                                   ▼
                    ┌──────────────────────────────────────┐
   Panel    ───────►│  Supabase PROD   (organización NUEVA)│  Pro · $25/mes
   (misma app)      │  ├─ Postgres 17 + RLS (84 tablas)    │
                    │  ├─ Auth (staff, riders, clientes)   │
   Rider    ───────►│  ├─ Realtime                         │
   (APK prod)       │  ├─ 8 Edge Functions (Mercado Pago)  │
                    │  └─ pg_cron: barrido de alertas      │
                    └──────────────┬───────────────────────┘
                                   │  Access Token PROD (nunca en el navegador)
                                   ▼
                    ┌──────────────────────────────────────┐
                    │  Mercado Pago  ·  cuenta PRODUCTIVA  │  comisión por venta
                    │  Checkout Pro + webhook firmado      │
                    └──────────────────────────────────────┘

   Relojes externos (gratis, no son servidores):
     · Cloudflare Worker cron  */5   → scheduler_heartbeat / check_scheduler_watchdog
     · GitHub Actions cron     */10  → lo mismo, y avisa por correo cuando falla
```

### Separación estricta staging ↔ producción

| | staging (hoy) | producción (a crear) |
|---|---|---|
| Organización Supabase | `qdhfqytbvgpvhxbbcomv` — queda en **Free** | **nueva**, en **Pro** |
| Proyecto | `ukxqbgswjlibmnjemrzd` (`la-taba-staging`) | ref nuevo |
| Base de datos | la del piloto, con 42 pedidos sintéticos | **vacía**, nace de las 96 migraciones |
| Auth | usuarios de QA | staff y riders creados de cero |
| Secretos Edge | los 7 de staging | **7 nuevos, ninguno reutilizado** |
| Mercado Pago | credenciales TEST | credenciales PRODUCTIVAS |
| Frontend | Cloudflare Pages `taba2-staging` | proyecto Pages nuevo + dominio propio |
| `deploymentEnvironment` | `staging` | `production` |
| Rider Android | `com.lataba.rider.staging` | `com.lataba.rider` |

**Por qué organizaciones distintas y no sólo proyectos distintos:** Supabase
factura **por organización**, y dentro de una organización Pro cada proyecto
adicional suma su propio compute. Producción sola en una organización Pro cuesta
exactamente los USD 25 del techo; staging conviviendo ahí dentro lo rompe. El
detalle numérico está en `PRODUCTION-INFRA-COSTS.md`.

Beneficio secundario, y no menor: una credencial de staging **no puede** tocar
producción, porque son cuentas distintas con facturación distinta.

---

## 3 · Frontend · Cloudflare Pages

El artefacto es el que ya produce `scripts/create-release-folder.mjs` (`dist_release`).

- **Proyecto Pages nuevo**, separado de `taba2-staging`. Nunca reutilizar el de
  staging con otra rama: comparten caché, cabeceras y dominio de service worker.
- **GitHub Pages queda fuera de producción.** El repositorio ya tiene un
  `preview-pages.yml` que publica ahí; es para previsualización y no debe
  apuntar nunca al dominio comercial. Además hay un `js/ui.js` viejo cacheado en
  ese origen que rompe el arranque.
- **`runtime-config.js` no se versiona.** Se genera en el despliegue con los
  valores de PROD y se verifica por hash después de publicar (§5 del checklist).
- **Dominio propio con HTTPS.** Cloudflare emite el certificado; el dominio hay
  que registrarlo (ver costos).

### El contrato de caché es el ancla del rollback

`sw.js` sirve con estrategia *network-first* y reescritura de caché, y su atajo
de cortocircuito se justifica textualmente en que «el precache está versionado
(`?v=…`), así que una copia guardada es el MISMO contenido». Publicar contenido
nuevo bajo el mismo `?v=` rompe esa invariante **y deja sin ancla al rollback**:
dos artefactos distintos se vuelven indistinguibles.

Por eso el bump de `?v=` y de `CACHE_NAME` es parte del release, no un detalle:
28 sitios, con siete pruebas que fallan si el bump queda a medias
(`tests/pwa.test.mjs`, `tests/github-pages.test.mjs`,
`tests/service-worker-degraded-edge.test.mjs`,
`tests/service-worker-install-and-timeout.test.mjs`,
`tests/e2e/service-worker-degraded-recovery.spec.mjs`,
`scripts/preflight-staging-package.mjs`, `scripts/certify-staging-always-map.mjs`).

`js/map/rider_marker.js` no lleva `?v=`: a ese archivo sólo lo protege
`CACHE_NAME`, lo que confirma que el bump de la caché es obligatorio.

---

## 4 · Base de datos

**Producción nace de `supabase/migrations/`, en orden, sobre una base vacía.**
No se copia el esquema de staging, y menos aún sus datos.

Forma del esquema, medida sobre las 96 migraciones de `bc9af92`:

| | |
|---|---|
| Tablas en `public` | **84** |
| Tablas con `enable row level security` | **83** |
| Tablas **sin** RLS | **1** — `commercial_contract_remediation` → bloqueante, ver checklist |
| Funciones ejecutables por `anon` o `authenticated` | **81** |
| Extensiones exigidas | `pg_cron`, `pg_net`, `pgcrypto`, `supabase_vault` |

### Por qué el estado final no se puede leer sólo en los archivos

A lo largo de las 96 migraciones hay `grant` tempranos y `revoke` posteriores
sobre las mismas tablas. El privilegio efectivo es el resultado del orden de
aplicación, no de lo que dice una migración aislada. Medido contra staging con
la clave anónima pública:

| Tabla | anon SELECT |
|---|---|
| `products` | 200 · devuelve filas (catálogo público, correcto) |
| `orders`, `order_items` | 200 · devuelve `[]` — el privilegio existe, **RLS lo tapa** |
| `businesses`, `customers`, `customer_addresses`, `rider_locations`, `payment_attempts`, `pos_sales`, `fiscal_documents`, `business_command_receipts` | **401** · privilegio revocado |
| `commercial_contract_remediation` | **200 · y además acepta INSERT** — ver `PRODUCTION-GO-LIVE-CHECKLIST.md` |

**Consecuencia para producción:** la matriz de privilegios se valida
**consultando la base PROD recién construida**, no releyendo migraciones. Es un
paso del checklist, no una suposición.

### Datos que entran a producción

| Dato | ¿Va? | Motivo |
|---|---|---|
| Esquema (96 migraciones) | **SÍ** | es la definición del sistema |
| Negocio (`businesses`) | **SÍ, cargado a mano** | dirección, pin verificado, horarios, zona, envío, mínimo, huso horario |
| Catálogo | **SÍ, re-importado** | precios y stock los confirma Walter; ver `PRODUCTION-CATALOG-LAUNCH.md` |
| Staff y riders | **SÍ, creados de cero** | |
| Pedidos, sesiones de checkout, intentos de pago | **NO** | |
| Alertas operativas, barridos | **NO** | arrancan vacías |
| Documentos fiscales, ventas POS | **NO** | están en cero y así se quedan |
| Usuarios de Auth de staging | **NO** | |

El motivo de fondo, medido: en staging hay **42 pedidos con `origin='production'`
que no son de clientes reales** (totales sintéticos repetidos, ciclo completo en
segundos). El campo `origin` ya no distingue un pedido real de un ensayo. Si se
copiara, el primer pedido real nacería contaminado.

---

## 5 · Identidad y autorización

La compuerta vive en `20260812030000_identity_authorization_gate.sql` y sus
vecinas. Un rol se resuelve con `identity_member_role(business_id)`, que exige,
en este orden: usuario autenticado · **no anónimo** · membresía activa en
`business_members` · usuario no deshabilitado · sesión no revocada · token
emitido después del corte `sessions_valid_from`.

Encima se apoyan `has_business_role(business_id, roles[])` e
`is_business_member(business_id)`.

**`is_business_member` no mira el rol.** Ésa es la raíz de H-07: un `rider` con
membresía activa la satisface igual que un `owner`, y 19 policies de lectura de
caja, fiscal y auditoría se apoyan en ella. Ver el veredicto y el arreglo en
`PRODUCTION-GO-LIVE-CHECKLIST.md`.

### Roles y superficies

| Rol | App | Debe ver |
|---|---|---|
| `owner` / `admin` | Panel | todo el comercio |
| `staff` | Panel | operación, caja, inventario, fiscal |
| `rider` | App Android | **sólo los pedidos que tiene asignados**, mientras están activos |
| cliente | Storefront | sus propios pedidos y su perfil |
| anónimo | Storefront | catálogo público, disponibilidad, seguimiento **por token** |

El seguimiento público no usa identidad: el token **es** la credencial.
`get_public_order_tracking` devuelve en una sola llamada el estado autoritativo
completo, así que cualquier consulta exitosa converge al cliente al estado
correcto sin depender de haber recibido los eventos intermedios.

---

## 6 · Pagos

```
Cliente  →  create_checkout_session (RPC, reserva stock)
         →  mercadopago-create-checkout-session (Edge)  →  Checkout Pro
         →  el cliente paga en Mercado Pago
Mercado Pago  →  mercadopago-webhook (Edge)
                  · exige POST + HTTPS
                  · tope de 16 KB
                  · límite de tasa 240/60s
                  · valida HMAC-SHA256 de x-signature sobre data.id
                  · persiste el recibo de forma idempotente (RPC)
                  · responde 201 en <22 s  ← no hace el trabajo pesado acá
         →  mercadopago-payment-worker (outbox durable)
                  · lee el pago contra la API de Mercado Pago
                  · finaliza el pedido
         →  el pedido aparece en el Panel
```

El diseño es correcto para producción: la firma se valida contra el `data.id` de
la query (que es lo que firma Mercado Pago), el recibo se persiste antes de
procesar, y el trabajo lento vive en un outbox con reintentos. Un webhook
duplicado no crea un segundo pedido.

### La red de seguridad del cobro real

`providerEnvironment()` **lanza excepción** si `MERCADOPAGO_ENVIRONMENT` es
`production` y no existe `MERCADOPAGO_PRODUCTION_REVIEW_STATUS=approved`.

Esto significa que **el cobro real se apaga con una sola variable de entorno**,
sin desplegar nada y sin tocar el frontend. Es la palanca de emergencia más
importante del sistema y hay que dejarla intacta.

---

## 7 · Fiscal / ARCA — fuera del lanzamiento

Estado medido: **0 comprobantes emitidos**, automatización no desplegada, y la
puerta de activación exige **9 condiciones** más una frase escrita a mano
(`I_AUTHORIZE_ARCA_HOMOLOGATION`). El sistema **no puede emitir un comprobante
hoy, ni por accidente** — y eso es lo correcto.

Durante el piloto rige el flujo manual ya documentado en `FISCAL-PILOTO-MANUAL.md`:
el pedido se cobra y se entrega normalmente, y **Walter emite el comprobante por
su medio habitual, fuera del sistema**. Nada del circuito comercial depende de
la facturación.

**Impacto en infraestructura: ninguno.** El puente ARCA es el único componente
que pediría un servidor encendido —proceso largo, worker de artefactos,
certificado X.509 en disco— y no entra el día 1. Su costo eventual está
documentado en `PRODUCTION-INFRA-COSTS.md` como **POST-LAUNCH**.

---

## 8 · Rider en producción

Modelo del piloto, sin cambios: **el Panel asigna → el Rider recibe.**

Sin turnos, sin disponibilidad, sin auto-despacho, sin cola de pedidos libres.
En `feature/taba2-rider-pilot-integration @ 894267a` esto no es una pantalla
oculta: con `AppConfig.manualAssignmentOnly` el gate de sesión **no construye**
`RiderOperationsController`, así que las RPC de turnos y despacho no se llaman
nunca —ni al entrar, ni al volver a primer plano, ni por refresh—. Esas RPC
viven en `feature/taba2-automated-rider-dispatch`, no están migradas, y
devolverían 404.

El flavor `production` compila con backend vacío a propósito: exige
`TABA_PRODUCTION_BACKEND_PROJECT_REF`, `TABA_PRODUCTION_SUPABASE_URL`,
`TABA_PRODUCTION_PUBLISHABLE_KEY` y `TABA_PRODUCTION_BUSINESS_ID`, y valida que
la URL sea exactamente `https://$ref.supabase.co`. Se completan cuando exista el
ref de PROD.

---

## 9 · Observabilidad — tres capas, ninguna con servidor

1. **Adentro:** `pg_cron` corre el barrido de alertas cada 60 s y escribe en
   `operational_alerts`. Verificado en staging: `scheduler_heartbeat` responde
   `healthy:true` con `age_seconds` de 36.
2. **Afuera:** dos relojes independientes llaman a `check_scheduler_watchdog`,
   que **mide la condición contra la base** (quien llama no puede inventar ni
   silenciar una alerta). Cloudflare Worker cada 5 min; GitHub Actions cada 10
   min, y este último **manda correo** cuando falla.
3. **El tráfico real:** el primer pedido que entra descubre un planificador
   muerto. No reemplaza a los relojes —un local cerrado no genera tráfico— pero
   no cuesta nada.

Ninguna de las tres capas está corriendo hoy en staging: la de adentro sí, las
dos de afuera **no**, porque el workflow no está en la rama por defecto del
remoto y el Worker nunca se desplegó.

---

## 10 · Lo que este documento NO decide

- No elige dominio.
- No crea proyectos, ni organizaciones, ni activa facturación.
- No toca Mercado Pago.
- No resuelve `alcohol_sales_enabled`: es una decisión comercial y legal.
- No fija precios.
