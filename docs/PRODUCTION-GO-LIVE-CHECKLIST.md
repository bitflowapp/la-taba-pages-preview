# TABA2 — production candidate launch plan

Este documento describe únicamente la candidate local `release/taba2-production-candidate`.
No autoriza deploy, creación de Supabase production, Mercado Pago production, DNS,
staging ni merge a `main`.

## Estado de blockers MUST-BEFORE-PROD

Los cinco blockers comerciales quedan cerrados en esta candidate:

| Blocker | Estado | Evidencia local |
| --- | --- | --- |
| B1 — catálogo maestro | CLOSED | migraciones aplicadas desde cero; catálogo/stock/estado cubiertos por unit, pgTAP y E2E focal |
| B2 — configuración operativa | CLOSED | fail-closed, ventanas/roles y contrato operativo cubiertos por pgTAP |
| B3 — alta transaccional | CLOSED | RPC y ciclo de pedido cubiertos por suite local de DB, unit y E2E focal |
| B4 — idempotencia/stock | CLOSED | payment/order local DB drill, unit y E2E de doble toque/reintento |
| B5 — estados auditables | CLOSED | pgTAP, transiciones y E2E de inbox/cancelación/rider |

## DB reproducible

- Migraciones canónicas: **98**.
- Primera: `20260531030000_la_taba_phase1_orders.sql`.
- Última: `20260814060000_commercial_contract_remediation_is_private.sql`.
- Base local descartable aplicada desde cero: **PASS**, ledger `98/98`, `0 pending`.
- pgTAP: **208/208** assertions.
- Restore lógico a otra base local: **PASS**; tablas, funciones, triggers, policies, RLS,
  grants públicos críticos, extensiones y ledger compararon iguales.
- BOLA de dos tenants: **PASS**, sin lectura ni escritura privada cross-tenant.
  Reverificado de forma independiente con un arnés distinto (2 negocios, 5 actores + `anon`,
  rol `authenticated` con claims JWT y sesión registrada, que es lo que hace PostgREST):
  0 lecturas cruzadas y 0 escrituras cruzadas. El arnés lleva **control positivo** —cada
  actor consulta también su propio negocio— porque una corrida donde el acceso legítimo
  también da 0 no prueba aislamiento, prueba que la sonda está rota.
- Postura de escritura, medida sobre la base construida desde cero: **ninguna tabla real de
  `public` otorga INSERT/UPDATE/DELETE a `anon` ni a `authenticated`**. Toda mutación pasa
  por RPC `security definer`; un `update` directo sobre `orders` devuelve `42501` incluso
  para el dueño del negocio.
- H-07 verificado en la base, no sólo en el texto de la migración: **0 policies siguen
  apoyadas en `is_business_member`**, y el repartidor pierde caja/auditoría/alertas
  conservando el pedido que tiene asignado.

> Advertencia que sobrevive a esta certificación: los privilegios y el esquema de las
> extensiones **no se reproducen desde las migraciones**. Sobre un Postgres pelado
> `pgcrypto` cae en `public`; en un proyecto Supabase real ya está en `extensions`. La
> postura de privilegios del proyecto productivo hay que **medirla ahí**, no asumirla.

## Release/PWA

- Identidad: `la-taba-runtime-v66-production-blockers`.
- Precache firmado: 127 archivos; digest registrado en `release-identity.json`.
- Tokens consistentes: CSS `v50`, `app.js` `v42`, `pwa-update.js` `v3`, `startup-recovery.js` `v2`.
- `npm run release:identity`: PASS, sin diff.
- Cambio de asset sin bump: rechazado por el gate en worktree descartable.
- Upgrade, degradación/recuperación y rollback están cubiertos por unit y E2E focal; no equivalen
  a prueba física de iPhone.

## Contrato exacto del Rider — CERTIFICADO PASS

Commit certificado: **`feature/taba2-rider-pilot-integration @ 894267a`**.

Una versión anterior de este documento afirmaba que ese commit no existía en el repositorio
local. **Es falso y queda corregido.** El objeto está presente en los dos repositorios del
Rider, es la punta de su rama y el árbol está limpio; se resolvió por Git local, sin red y
sin `fetch`. Se certificó el contenido exacto de ese commit, no un descendiente: el árbol
extraído da `93cc68aa433eeafe837d2921b5b68b666d426548`, idéntico a `894267a^{tree}`.

Modelo DAY-1 verificado —`Panel → asignación manual → Rider recibe`— contra
`BackendContract.kt` (VERSION 2), que declara 18 nombres:

| Grupo | Estado en la candidate |
| --- | --- |
| 9 RPC operativas DAY-1 (`get_rider_queue`, `get_active_rider_delivery`, `claim_delivery_order`, `mark_delivery_picked_up`, `start_rider_delivery`, `mark_rider_arrived`, `confirm_delivery_code`, `report_rider_delivery_issue`, `publish_rider_location_receipt`) | **9/9 PRESENTES**, todas `security definer` con `search_path` fijo y `grant execute` a `authenticated` |
| 9 RPC de turnos y auto-despacho (`rider_work_now`, `rider_start_shift`, `rider_pause_shift`, `rider_resume_shift`, `rider_end_shift`, `rider_shift_heartbeat`, `get_rider_operational_state`, `accept_rider_dispatch_offer`, `reject_rider_dispatch_offer`) | **9/9 AUSENTES** — viven en `feature/taba2-automated-rider-dispatch`, sin integrar |

Y la app **nunca las invoca**: `AppConfig.manualAssignmentOnly = true` es el default y ningún
sitio lo pisa, así que `session_gate` no construye `RiderOperationsController` y no hay poll,
ni heartbeat, ni oferta. Además `OrdersController(loadAvailableOrders: false)`: tampoco hay
toma de pedidos libres.

- **H-07 no alcanza al Rider**: sus 9 RPC son `security definer`, así que RLS no las toca, y
  la app no menciona ninguna de las 28 tablas cerradas.
- **Estados alineados**: `can_access_order` habilita la lectura del repartidor sólo para su
  pedido asignado, modo `delivery`, en `assigned|picked_up|on_the_way|arrived` — exactamente
  `BackendContract.ASSIGNED_STATUSES`.
- El repartidor **pierde back office, no capacidad operacional**: medido en vivo, ve su
  pedido asignado y no ve caja, auditoría ni notificaciones.

Trampa anotada para la release que traiga las migraciones de despacho: en
`orders_page._buildBody`, con el controlador de operaciones construido y sin pedido asignado,
la pantalla renderiza el panel de turnos **en vez de** la cola. Activar la bandera sin sus
migraciones deja al Rider parado.

## E2E completo — PASS

`npm run test:e2e`, la suite ENTERA, con la configuración del repositorio tal cual: sin filtro
de proyecto, sin shards y sin tocar un solo timeout.

- **358/358** — `expected 358`, `unexpected 0`, `flaky 0`, `skipped 0`.
- Reparto por motor: **chromium 296**, **mobile-webkit 62**.
- Duración real: **890,9 s (14,8 min)**, `exit code 0`.

Sobre el «timeout a los 300 s» que declaraba la versión anterior de este documento: no era un
cuelgue del producto ni un fixture que no liberaba recursos. Era el límite de la herramienta
que invocaba la corrida. La suite usa `workers: 1` a propósito —los specs compiten por el relay
y el servidor estático—, así que su duración normal es de unos 15 minutos. Se mide y se explica;
no se sube ningún timeout para fabricar verde.

Los 358 son 357 más **una prueba nueva**: `production ignores ?showcase=1`. La que fallaba
—`showcase.spec.mjs`— afirmaba el contrato ANTERIOR a B4: esperaba que `?showcase=1` abriera la
presentación incluso sobre una configuración productiva, que es exactamente el agujero que
`0fb94e8` cerró. Se corrigió la prueba, **no el runtime**, y se partió en dos para que ninguna
de las dos garantías quede sin medir:

- **producción + `?showcase=1` → RECHAZADO**, en sus dos formas: con `deploymentEnvironment`
  declarado y deducido. Se afirma que el modo queda en `production`, que no hay raíz de
  presentación ni sandbox técnico, y que el repositorio elegido es el real.
- **staging declarado + `?showcase=1` → la presentación corre y sigue aislada**: la garantía
  original se conserva entera —cero peticiones a Supabase, cero al relay, sandbox oculto,
  repositorio `showcase/sandbox/showcase`—.

## Gates pendientes de esta certificación

- El arnés histórico de colisiones de migraciones conserva expectativas de un snapshot de 39
  migraciones/`private` ausente; 5 assertions de conteo/huella fallan contra el estado actual de
  98. Las assertions de no duplicación, reconciliación, abort seguro y preservación del trigger pasan.
  **SAFE TO DEFER, verificado**: `scripts/run-migration-collision-scenarios.mjs` no está
  referenciado por ningún script de `package.json` ni por ningún workflow de CI —sólo por un
  documento—, así que no puede afectar rollback ni reproducibilidad: nadie lo corre.
- 32 imports dinámicos de rutas del Panel no están precacheados. **SAFE TO DEFER**: el grafo
  del cliente está completo (94 módulos, todos en `sw.js`); no es camino de cliente.
- `runtime-config.js` es el que decide si el despliegue es productivo. Si ese archivo no
  cargara (404, red), la configuración queda ausente y `?demo=1` vuelve a servir la tienda de
  mentira en el dominio real. Mitigado por el precache del service worker después de la
  primera visita, y es un compromiso deliberado —el artefacto de previsualización necesita la
  demo—, pero es el único hueco que le queda a B4.
- El *restore* lógico y el conteo de `87` probes BOLA provienen de la certificación previa y
  **no fueron reproducidos de forma independiente** (el arnés de restore reinicia un
  contenedor compartido; el de las 87 probes no está en el árbol).

## Contrato de CI

`playwright.config.mjs` declara dos proyectos —`chromium` y `mobile-webkit`— y el paso de CI
corre `npm run test:e2e` **sin filtro de proyecto**, así que los dos se ejecutan. El workflow
instalaba solamente Chromium: con eso Playwright aborta el proyecto `mobile-webkit` con
«Executable doesn't exist», y el paso falla por el navegador que falta, no por el producto.
Corregido: `npx playwright install --with-deps chromium webkit`.

`mobile-webkit` **no se quitó** para poner CI en verde, y no era una opción quitarlo: cubre el
retorno desde Mercado Pago por back/forward cache, el arranque en blanco de iOS, el service
worker degradado y la confirmación de ubicación —defectos que aparecieron en un iPhone real—.
Declararlos cerrados con Chromium sería declararlos sobre el navegador donde no ocurrieron.

## Identidad de release

Estos arreglos tocan **prueba, documentación y CI**: ni un byte de runtime ni del precache.
Verificado, no supuesto — `npm run release:identity` vuelve a firmar sin diff:
`la-taba-runtime-v66-production-blockers`, 127 archivos, digest `172c8f01…`, idéntico al de
`cc9e88f`. Por eso **no se hizo bump**: subir `CACHE_NAME` sin que cambie el artefacto es
ruido que después le saca sentido al rollback.

## No-gates físicos

Permanecen pendientes: Chrome iPhone físico, Safari iPhone físico, Moto G15 físico, GPS físico,
dominio/DNS, catálogo comercial aprobado, Mercado Pago production, ARCA/homologación, y
aprobaciones de Walter/Opus. Este documento no los convierte en PASS.

Guion preparado para el Moto G15 con el APK de `894267a`: ingreso, biometría, **pantalla de
espera sin asignación** —tiene que mostrar la espera, no el panel de turnos—, asignación manual
desde el Panel, `picked_up → on_the_way → arrived`, PIN. En el log no debe aparecer un solo
404/`PGRST202` de las nueve RPC ausentes.

## Decisión

**READY FOR PHYSICAL PRE-PROD GATES.** Los bloqueantes técnicos de certificación están
cerrados: E2E completo `358/358`, contrato exacto del Rider certificado sobre `894267a`, CI
capaz de correr los dos motores que declara. Sin P0 y sin P1.

Esto **no autoriza** deploy, creación de Supabase production, Mercado Pago production, DNS,
mutación de staging ni merge a `main`. Lo que sigue es hardware y decisiones humanas.
