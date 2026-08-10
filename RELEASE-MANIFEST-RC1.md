# TABA2 Pilot RC1 — Release Manifest

**Rama:** `release/taba2-pilot-rc1` · **URL:** https://taba2-staging.pages.dev
**Frontend publicado:** `f61e84f` (deployment `aee2e619`). La punta de la rama agrega
encima **sólo este documento**, que no forma parte del conjunto de 351 archivos publicados:
el bundle servido corresponde exactamente a `f61e84f`.
**Fecha:** 2026-08-10 · **Entorno:** staging (`ukxqbgswjlibmnjemrzd`) · **Producción:** no tocada

Este documento describe UNA release. Todo lo que dice está medido en esta sesión, o
está marcado explícitamente como heredado de una certificación anterior.

---

## 1. Qué es esta release

`release/taba2-pilot-rc1` sale de `integration/taba2-operational-frontend` (`f16c6d9`)
y le agrega **un solo commit**, que no toca frontend.

| commit | qué es |
|---|---|
| `f61e84f` | **nuevo en esta sesión**: trae el backend que la candidata invocaba y no contenía |
| `f16c6d9` | informe de la candidata operativa |
| `d3c1426` | spec E2E del Panel de recuperación, dos motores, cuatro anchuras |
| `1b0122c` | bump de cache v57 → v58-panel-operativo |
| `de1b078` | unión de las dos mitades del rearmado |
| `b8ea870` | rebanada por ruta de `a186d29`: sólo el frontend de recuperación |

### Ancestría verificada (no se confió en el handoff)

`f16c6d9` **contiene** — comprobado con `merge-base --is-ancestor`:

- `73fdb4c` seguimiento en vivo (tracking final)
- `11cd59d` customer experience
- `280213d` catálogo premium
- `da56ce9` candidata comercial
- `90a28a1` storefront comercial
- `c9b9f0d` base del despliegue de tracking

**No contiene** `0efe1dc`, que era lo que staging servía hasta esta sesión. No es una
pérdida: `0efe1dc` y la RC descienden ambos de `c9b9f0d` y resuelven el mismo contrato
por caminos distintos. Se comparó archivo por archivo: la RC **no elimina** ninguna
capacidad de `0efe1dc`; las 6 líneas que desaparecen son reemplazos por su propio
equivalente (función renombrada, helper extraído). La implementación de la RC es
mejor: resuelve el `checkout_session_id` desde el pago, revalida el permiso, contempla
el cobro sin compra asociada y acota el mensaje de faltantes al presupuesto de
caracteres de `humanizeFailure`.

### La divergencia que se encontró y por qué se integró

La candidata **llamaba a `recover_paid_checkout_order` desde el Panel y su árbol no
tenía la migración que la crea**: 62 migraciones en la rama contra 67 aplicadas en
staging. Y la fuente del worker que guardaba era la **anterior** a la desplegada —la
que exige `provider_payment_id`, justo lo que un checkout abandonado no tiene—.

`f61e84f` trae, **byte a byte desde `59d8e03`** y nada más:

- `supabase/functions/mercadopago-payment-worker/index.ts` (+43 −2)
- las 5 migraciones del circuito: `20260809180000`, `190000`, `200000`, `210000`, `220000`
- `20260807155000`, que en staging **no** se aplicó porque el esquema `private` ya existía
- los 5 drills `.local.sql` (las 98 afirmaciones con las que se certificó el circuito)

**No se aplicó ni se redesplegó nada.** Las migraciones ya estaban aplicadas y el worker
ya está en v14. El árbol se puso a la altura del entorno, no al revés. Verificado que la
selección por ruta no arrastró nada: `git diff 59d8e03` en esos caminos es vacío y no hay
un solo archivo tocado fuera de `supabase/`.

---

## 2. Ledger de migraciones

| | |
|---|---|
| en el árbol de la RC | **68** |
| aplicadas en staging | **67** |
| la diferencia | `20260807155000_rider_map_location_contract_reconciliation.sql` |

`20260807155000` está en el árbol y **no** en staging, a propósito: staging ya tenía el
esquema `private` cuando le tocaba. Se conserva en la release porque una base desde cero
la necesita para llegar al resto de la cadena.

Última migración del árbol: `20260809220000_resolve_security_review.sql`.
`migrations:validate`: 68 revisadas en orden, aprobado.

**No se pudo leer la tabla `supabase_migrations.schema_migrations` en esta sesión**: el
CLI exige la contraseña de la base y no está disponible acá. El 67 viene del cierre
anterior (`TABA2_REAL_ORDER_INTAKE_AND_DISPATCH_CERTIFIED_ON_STAGING`, 62 → 67). Lo que
sí se verificó de forma independiente en esta sesión son los **efectos**:

- `recover_paid_checkout_order` existe (anónimo recibe 401, no `PGRST202`)
- `can_recover_paid_checkout` existe y responde
- `operational_alerts` existe con `alert_code`/`severity`/`status`
- `list_business_payments` devuelve `can_recover_order`

---

## 3. Edge Functions (leídas del proyecto, no supuestas)

| función | estado | versión | sha256 |
|---|---|---|---|
| `mercadopago-payment-worker` | ACTIVE | **14** | `142d1081…41eb` |
| `mercadopago-webhook` | ACTIVE | 13 | `75666434…ec19` |
| `mercadopago-create-preference` | ACTIVE | 13 | `8dd89aba…a449` |
| `mercadopago-checkout-status` | ACTIVE | 12 | `bfa58e2e…a3b2` |
| `mercadopago-create-checkout-session` | ACTIVE | 11 | `7b78e3e8…0b57` |
| `mercadopago-refund` | ACTIVE | 2 | `ce02a046…076b` |

Ninguna se redesplegó en esta sesión.

---

## 4. Frontend publicado

| | |
|---|---|
| deployment | `aee2e619` |
| archivos | **351** (16 subidos, 335 ya presentes) |
| cache del SW | `la-taba-runtime-v58-panel-operativo` |
| hojas | `?v=47` · `js/app.js?v=40` |
| anterior | `v56-seguimiento-en-vivo` · `?v=46` · `app.js?v=39` |

**`runtime-config.js` preservado byte a byte**: `sha256 57d8a007289a31cc334b77d2431aa45f126c39e1d760137d273dbcfa640c8716`, 684 bytes, medido antes y después. El del repositorio es una plantilla (`PROJECT_REF`) y **no se subió**.

El conjunto de 351 se derivó de lo que staging ya servía, no de una corazonada: contra el
árbol desplegado (`5941279`) son **+2 altas y CERO bajas** —`js/back-office.js` y
`assets/promos/cervezas-heineken-band.webp`—.

**Verificación posterior: 351/351** responden 200, con bytes idénticos al árbol y
content-type correcto. Cero fallback HTML. El riesgo anotado antes de subir quedó cerrado:
`js/back-office.js` (8645 B) es una importación **estática** de `js/app.js` y se sirve como
`application/javascript`; si hubiera caído en el fallback, la app entera no arrancaba.

### Service Worker, los dos caminos

| camino | resultado |
|---|---|
| instalación limpia | una sola cache: **v58** · 0 errores · 0 4xx |
| perfil que ya tenía v56 | una sola cache: **v58** · 0 errores · 0 4xx |

Durante la ventana de *waiting* conviven v56 y v58: es el diseño —no hay `skipWaiting` en
`install`, la purga corre en `activate`—. Al soltar los clientes, la vieja se borra. No hay
mezcla de versiones: `?v=47` y `app.js?v=40` en todos los casos.

---

## 5. Rider

APK de staging conocidos (ninguno instalado ni modificado en esta sesión):

| archivo | sha256 | fecha |
|---|---|---|
| `artifacts/primer-pedido-humano/apk/app-staging-debug.apk` | `f65ed1aa…4cbe` | 2026-08-08 17:13 |
| `la-taba-rider-pilot-readiness/…/app-staging-debug.apk` | `ad2eb16c…fcbb` | 2026-08-09 06:59 |
| `worktrees/taba2-rider-pilot-rc2/…/app-staging-debug.apk` | `3cb61d52…3fda8` | 2026-08-08 05:52 |

El teléfono no se tocó. `moto-g15.lock` quedó libre y sigue libre.

---

## 6. Secretos requeridos (SÓLO NOMBRES)

Ninguno de estos valores aparece en este documento, en el repositorio ni en el bundle
publicado. Viven en Supabase Edge Function Secrets y en Vault.

`MERCADOPAGO_ACCESS_TOKEN` · `MERCADOPAGO_WEBHOOK_SECRET` · `MERCADOPAGO_ENVIRONMENT` ·
`MERCADOPAGO_PRODUCTION_REVIEW_STATUS` · `MERCADOPAGO_REAL_PAYMENT_SMOKE_CONFIRMATION` ·
`PAYMENT_WORKER_SECRET` · `PAYMENT_LOG_HASH_SALT` · `SUPABASE_URL` ·
`SUPABASE_ANON_KEY` · `SUPABASE_SERVICE_ROLE_KEY` · `TABA_ALLOWED_ORIGINS` ·
`TABA_CHECKOUT_BASE_URL` · `FISCAL_PANEL_ORIGINS`

Lo único público que viaja al navegador es `runtime-config.js`: `supabaseUrl`,
`publishableKey` (`sb_publishable_…`, clave publicable por diseño) y `businessId`.
`secrets:scan` del repositorio: limpio.

Credenciales locales usadas **sólo en memoria**, nunca impresas: la cuenta `owner` del
negocio y `rider-map-qa`. Los dos logins del Rider siguen **rotados** (400).

---

## 7. Rollback exacto

El cambio es frontend puro. Para volver atrás:

```
# 1 · reconstruir el árbol servido antes de esta sesión
#     (tracking 5941279 + los 4 archivos del Panel de 0efe1dc)
git -C <repo> checkout 0efe1dc

# 2 · publicar ese árbol conservando el runtime-config vivo
#     (copiar preserva/runtime-config.live.js —de la carpeta de evidencia de la
#      sesión, sección 13— sobre runtime-config.js ANTES de subir)
npx wrangler pages deploy <dir> --project-name=taba2-staging --branch=staging
```

Vuelve a `v56-seguimiento-en-vivo`, `?v=46`, `app.js?v=39`.
**No hay nada que revertir en la base**: cero migraciones, cero redeploys de Edge
Functions, cero escrituras persistentes de esta sesión (los fixtures QA se borraron y el
estado quedó idéntico — ver §9).

Alternativa más simple: Cloudflare Pages conserva el deployment anterior (`0dc54b0f`);
un rollback desde el panel de Pages lo restituye sin reconstruir nada.

---

## 8. Gates

### Locales, sobre la punta `f61e84f`

| gate | resultado |
|---|---|
| `npm run check` | **verde** (4 comprobaciones) |
| `npm test` | **1268 / 1268** · 41 s |
| Playwright local, Chromium + mobile WebKit | **238 / 238** · 9,3 min |
| `npm run secrets:scan` | **limpio** |
| `npm run migrations:validate` | **68 revisadas en orden**, aprobado |
| árbol de trabajo | **limpio** · sin push · sin producción |

`npm test`, `check`, `secrets:scan` y `migrations:validate` se re-corrieron **después** de
integrar el backend, no sólo antes.

### En la URL pública, sobre lo que staging sirve ahora

**CLIENTE — 9 / 10**

| prueba | Chromium | mobile WebKit |
|---|---|---|
| home → búsqueda → categoría → producto → carrito → reload | ✅ | ❌ (ver §10) |
| 320 px sin desborde | ✅ | ✅ |
| 360 px sin desborde | ✅ | ✅ |
| 390 px sin desborde | ✅ | ✅ |
| 432 px sin desborde | ✅ | ✅ |

Cero errores de consola y cero respuestas ≥400 en las diez. El recorrido de WebKit **pasa
en 39 s cuando corre aislado**; falla de forma intermitente en la corrida completa, y
siempre por la misma causa: §10.

**PANEL — 12 / 12, contra la base VIVA**

| contrato | resultado |
|---|---|
| abre con la cuenta dueño | ✅ «Dueño · sesión verificada» |
| los pedidos existentes se ven | ✅ LT-0132, LT-0118 |
| el rearmado se ofrece SÓLO donde el servidor lo habilita | ✅ **2 botones sobre 85 pagos** |
| los dos son exactamente los dos cobros QA | ✅ |
| sin stock, dice QUÉ falta y CUÁNTO | ✅ «No hay stock para armarlo: QA RC1 recovery B (hay 99, hacen falta 900).» |
| y no inventa un pedido incumplible | ✅ 97 → 97 |
| el botón **ejecuta `recover_paid_checkout_order`** | ✅ 97 → 98, **LT-0132 armado** |
| lo dice con el código del pedido | ✅ «Pedido LT-0132 armado» |
| tras armarlo el botón desaparece | ✅ no se puede duplicar desde la UI |
| la consulta de respaldo sigue corriendo | ✅ 10 → 11 llamadas |
| cero errores de consola | ✅ |
| cero respuestas ≥400 | ✅ |

Esto importa porque **la RC cablea el botón distinto** a lo que staging servía hasta hoy
(`recoverPaymentOrder` → `context.recoverOrder`, en vez de `context.recoverPaidCheckoutOrder`).
Ese camino nuevo quedó ejercitado contra el backend real, no contra un doble.

**Permisos, en las tres identidades, contra el servidor**

| identidad | `list_business_payments` | `recover_paid_checkout_order` |
|---|---|---|
| anónimo | 401 | 401 |
| miembro no elevado (rider activo) | 403 «pagos no autorizados» | 403 «recuperacion no autorizada» |
| dueño | 200 · 85 pagos | habilitado |

El servidor niega por rol, no sólo la interfaz.

**SEGUIMIENTO — 7 / 8** (los specs del propio repo, contra el bundle publicado, con
`?demo=1`, que usa datos locales y nunca el backend)

| prueba | Chromium | mobile WebKit |
|---|---|---|
| arriving reproduce la composición y conserva datos reales | ✅ | ⚠️ no aplicable |
| el mapa se deja explorar y devuelve el seguimiento | ✅ | ✅ |
| la vuelta al Rider entra en las cuatro anchuras | ✅ | ✅ |
| perder la señal no borra al rider ni apaga el mapa | ✅ | ✅ |

El ⚠️ **no es un defecto del producto**: `mouse.wheel` no existe en mobile WebKit
(limitación del driver). El repo nunca había corrido seguimiento en WebKit —su proyecto
`mobile-webkit` sólo cubría dos specs—; esta sesión lo extendió y encontró el límite.

El pellizco real de dos dedos **no lo verifica ninguna máquina**: Playwright no sintetiza
multi-touch de forma confiable, y así está declarado en el propio spec del repo. Eso vive
en el gate físico.

---

## 9. Estado de la base: idéntico al inicial

Los dos cobros QA (`correlation_id` `…aa` y `…bb`) se crearon, se usaron y se borraron.

| | antes | después |
|---|---|---|
| pedidos | 97 | **97** |
| checkout_sessions | 83 | **83** |
| payment_intents | 83 | **83** |
| inventory_reservations | 104 | **104** |
| reservas activas | 0 | **0** |
| stock góndola | 760 (Speed 70 · Imperial 99) | **760 (Speed 70 · Imperial 99)** |
| ARCA `fiscal_documents` / `pos_sales` | 0 / 0 | **0 / 0** |
| LT-0030 | `arrived` $550 @2026-08-06T19:31:47 | **idéntico** |
| residuo de la marca QA | — | **ninguno** |

**Un cambio que no es residuo y hay que declarar:** las alertas abiertas pasaron de 4 a 2.
Las dos `PAYMENT_RECONCILIATION_REQUIRED` que había dejado la sesión anterior (06:23:10Z)
quedaron **`resolved` a las 08:39:55Z por el propio sistema**, con la nota «Condición
ausente en la reconciliación automática», al recalcularse las alertas cuando se abrió el
Panel. No se borró ninguna alerta. Las dos que siguen abiertas son `RIDER_SIGNAL_STALE`
preexistentes (2026-08-07 y 2026-08-10 05:19Z).

Ningún pedido humano, ningún stock humano y ninguna dirección de una persona real se
tocaron. Los fixtures reusaron un cliente QA que **ya existía** (`QA Cliente TABA`, sin
pedidos): no se creó ninguna persona.

---

## 10. Deudas reales

### DEFECTO-AVISO-PWA — el aviso de actualización se queda pegado (P1, ABIERTO)

**Mecanismo, en el código:** `js/pwa-update.js:41-46`.

```js
updateButton?.addEventListener('click', () => {
  if (!pendingUpdate?.waiting) return;   // <- sale sin ocultar el aviso
  refreshing = true;
  hideUpdate();
  pendingUpdate.waiting.postMessage('skip-waiting');
});
```

`registration.waiting` es una propiedad viva. Si el worker en espera **activa por su
cuenta** entre que el aviso se muestra y la persona lo toca, `waiting` pasa a `null`, la
guarda hace `return` **antes** de `hideUpdate()`, y el aviso ya no se va nunca: no tiene
botón de descarte, y su única salida es ese click que ahora no hace nada.

**Medido en la URL pública, iPhone 13 / mobile WebKit:** aparece a 1,0 s de la primera
carga y sigue visible después de aceptarlo, con `waiting:false`. Es `position: fixed`,
`z-index: 700`, `bottom: 76px`, **115 px de alto sobre un viewport de 664** (17 % de la
pantalla).

**Impacto:** cualquier control que caiga en esa banda deja de recibir el toque. En la
corrida completa le comió el toque al botón «Agregar» del catálogo —239 reintentos, 120 s—
y por eso el recorrido de WebKit figura en rojo. **No tapa la navegación inferior**, y la
persona puede esquivarlo desplazando el contenido: degrada la compra en iPhone, no la
impide.

**No se corrigió en esta sesión**: es código de producto y el encargo era no abrir frentes.
Con el diagnóstico en la mano el arreglo es acotado —ocultar el aviso cuando ya no hay
worker en espera—, pero toca un archivo certificado y obliga a redesplegar y recertificar.
**Queda como decisión.**

### El carrito no sobrevive a una recarga

`js/cart.js` no escribe en `localStorage` ni en `sessionStorage`. Comprobado en la versión
que servía staging (`5941279`) **y** en la RC: **no es una regresión**, es una carencia del
producto. La certificación lo mide y lo deja escrito en vez de afirmar lo contrario.

### `recover_paid_checkout_order` filtra la existencia de un checkout

La función valida «checkout inexistente» (`P0002`) **antes** de comprobar el rol. Un
miembro no elevado recibe `500 P0002` para un id que no existe y `403 42501` para uno que
sí: puede distinguir cuáles existen. **No es escalada de privilegio** —la acción se niega
igual—, pero es información que no debería salir.

### Heredadas, no tocadas

- `[data-production-payment-recover]` en `js/production-operations.js` sigue **inalcanzable**:
  ningún render emite ese atributo. Vino así del circuito certificado y se conservó sin maquillar.
- `js/business/*` **no** está en el precache del Service Worker. El Panel vive del cacheo en
  runtime del `fetch`: tras la primera visita con red queda disponible sin red.
- Bloqueante `GITHUB_PAGES_MODULE_GRAPH_SIN_VERSION`, de cabeceras HTTP, heredado.
- Las alertas sólo se recalculan al abrir el Panel.
- La firma del webhook de Mercado Pago no valida en TEST.
- 47 checkouts antiguos sin comparar contra Mercado Pago: el token vive sólo como secreto
  de Edge Function y la única vía alternativa habría mutado los 48.

---

## 11. Qué NO está incluido

- **Nada de ARCA / fiscal.** `feature/taba2-arca-fiscal-automation` no se tocó.
- **Nada de WhatsApp.** `feature/taba2-whatsapp-commerce` no se tocó.
- **Nada de Stories** ni experimentos.
- **Ninguna rama ajena.** La RC es `f16c6d9` más un único commit que sólo toca `supabase/`.
- **Ninguna migración aplicada** y **ninguna Edge Function redesplegada** en esta sesión.
- **Producción intacta.** Sin push a ningún remoto. Sin dinero real. LT-0030 sólo lectura.
- **El Rider no se tocó**: ni el teléfono, ni la APK, ni el código.
- **Sin GPS falso** y sin forzar estados de pedido por SQL para superar un gate.

---

## 12. Gate pendiente — HUMAN_CHECKPOINT_PHYSICAL_RIDER_GATE

La caminata de ≥300 m con ≥20 fixes reales **no se pudo correr**, y no por falta de tiempo:

1. **Los dos logins del Rider están rotados.** Medido contra `/auth/v1/token`:
   `400 invalid_credentials` en ambos. El teléfono tampoco tiene sesión guardada
   (`no_backup/` vacío: `rider_session.enc` no existe), así que la app tiene que volver a
   entrar y no tiene con qué.
2. **No hay PAT de management de Supabase** para reponerlos por la vía de admin: se borró
   el 2026-08-10 a pedido de la persona a cargo.
3. **La caminata necesita una persona** y un segundo teléfono mirando el seguimiento.

Lo que sí quedó medido antes, y no se repitió porque no cambió: sobre 20 fixes reales del
Moto G15, precisión mediana 3,5 m, cadencia 5,1 s, 0 fixes rechazados por el filtro, y el
marcador interpola en vez de dar tirones. **Desplazamiento: no medido** (2,0 m acumulados).

**Para retomar:** reponer un login de Rider, `adb reverse tcp:8099 tcp:8099`, abrir
`http://localhost:8099` en el Moto y tocar «Empezar a medir». El servidor vive en
la carpeta temporal de la sesión (`_claude-tmp/medicion-gps/`). `moto-g15.lock`
está **libre**.

---

## 13. Evidencia

Carpeta de artefactos de la sesión: `artifacts/taba2-pilot-rc1/` (fuera del repo,
en el disco de trabajo).

| archivo | qué prueba |
|---|---|
| `certificacion-panel.json` | los 12 pasos del Panel contra la base viva |
| `panel-01-pagos.png` · `panel-02-sin-stock.png` · `panel-03-armado.png` | la vista de Pagos, el mensaje de faltantes y el pedido armado |
| `sw-antes.json` · `sw-despues.json` · `sw-upgrade-real.json` | el upgrade del Service Worker desde un perfil que ya tenía v56 |
| `preserva/runtime-config.live.js` | el `runtime-config.js` vivo, byte a byte |
| `preserva/taba2-staging-mutation.lock.respaldo` | el lock tal como estaba antes de tomarlo |

El arnés vive en `artifacts/ci/rc1/` dentro del worktree de la release (ignorado por git).

---

## 14. Declaración

**NO se emite `TABA2_PILOT_RC1_CERTIFIED_ON_STAGING`.**

Storefront, Panel, backend certificado y seguimiento **sí conviven en la misma release** y
quedaron verificados en la URL pública. Pero quedan dos cosas fuera, y ninguna se esconde:

1. La caminata física, bloqueada por credenciales que no puedo reponer
   (`HUMAN_CHECKPOINT_PHYSICAL_RIDER_GATE`).
2. **DEFECTO-AVISO-PWA**, un defecto P1 abierto sobre el camino de compra en iPhone.

Con el defecto abierto, `TABA2_PILOT_RC1_READY_FOR_FINAL_PHYSICAL_GATE` diría que sólo
falta caminar, y no es cierto. Lo que sí se puede afirmar hoy:

> **TABA2_PILOT_RC1_DEPLOYED_AND_OPERATIONALLY_VERIFIED_ON_STAGING**
> _con un defecto P1 abierto (DEFECTO-AVISO-PWA) y el gate físico pendiente._

Corregido el defecto y recertificado el recorrido en WebKit, la release queda en
`TABA2_PILOT_RC1_READY_FOR_FINAL_PHYSICAL_GATE` sin nada más que hacer salvo la caminata.
