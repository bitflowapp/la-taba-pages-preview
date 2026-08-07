# PILOT-RC-HANDOFF — TABA2, RC única de piloto

Worktree `la-taba2-pilot-rc` · Rama `release/taba2-pilot-rc`

| | |
| --- | --- |
| Base | `aed0293` — HEAD de `feature/taba2-real-orders-ops` |
| Integrado encima | `c761a8d` — HEAD de `feature/taba2-fable-visual-polish` |
| Merge | `0d7bfee23e15ccc42fb205c4f4af1070faf3b7c6` |
| Deploy | Cloudflare Pages `taba2-staging`, deployment `4e5f1e75`, source `0d7bfee` |
| Git | Limpio. Sin push, sin amend, sin reset, sin clean, sin stash, sin `git add .` |

---

## 1. Las dos fuentes, verificadas antes de tocar nada

| Fuente | HEAD | Declaración encontrada en el árbol |
| --- | --- | --- |
| `feature/taba2-real-orders-ops` | `aed0293c32d5cbf5a4599e5eb4f46033192bb84e` | `TABA2_REAL_ORDER_PIPELINE_READY_FOR_PILOT` (cierre de `HANDOFF.md`) |
| `feature/taba2-fable-visual-polish` | `c761a8d43a9e4abcd17c7687e3e8a25ad545db93` | `TABA2_FABLE_COMMERCIAL_VISUAL_POLISH_READY_FOR_INTEGRATION` (cierre de `FABLE-HANDOFF.md`) |

`feature/taba2-fable-visual-polish` está construida **sobre** `feature/taba2-commercial-storefront`
(`6dd0565`), que es su base directa. Por eso el storefront comercial entra por Fable y **no** se
integró por separado, como pedía la consigna.

Ambas fuentes parten del mismo tronco: `git merge-base` de las dos es `6294a98`
—*fix(mercadopago): close the checkout without depending on a webhook*—. Desde ahí Operaciones
aporta 10 commits y Fable 25.

Las dos ramas quedaron **intactas**: la RC nace de un worktree nuevo y ninguna fuente se movió.

---

## 2. La integración

### 2.1 Por qué salió limpia

Las dos entregas casi no se tocan. Fuera de `supabase/`, Operaciones sólo altera cuatro archivos
—`js/repositories/supabase_order_repository.js`, `scripts/certify-real-order-pipeline.mjs` y dos
tests— y ninguno de ellos aparece en la entrega de Fable. La intersección real entre las dos ramas
son **dos archivos**:

| Archivo | Resolución |
| --- | --- |
| `package.json` | Auto-merge correcto: conserva `certify:orders:staging` de Operaciones y suma `catalog:pending`, `qa:taba2:commercial-audit` y `qa:taba2:commercial-screenshots` del lado comercial. |
| `HANDOFF.md` | Conflicto add/add. Ver abajo. |

### 2.2 El único conflicto, y por qué no se resolvió con `ours`/`theirs`

Las dos ramas agregaron un `HANDOFF.md` distinto: el de Operaciones documenta el circuito de
pedidos; el de Fable arrastra el del storefront comercial de su base. **Ninguno reemplaza al
otro**: son dos entregas diferentes y las dos son evidencia. Elegir un lado habría borrado la
documentación del otro.

Se conservaron los dos, textualmente idénticos a su fuente:

- `HANDOFF.md` → el de Operaciones (`git show feature/taba2-real-orders-ops:HANDOFF.md` da el
  mismo byte a byte).
- `STOREFRONT-HANDOFF.md` → el del storefront comercial (idem contra
  `feature/taba2-commercial-storefront:HANDOFF.md`).
- `FABLE-HANDOFF.md` → entró sin conflicto.

### 2.3 La prueba de que cada autoridad quedó donde debía

No es una afirmación, es un `diff` vacío:

```
git diff --quiet feature/taba2-fable-visual-polish HEAD -- sw.js styles/ styles.css index.html
    → sin diferencias: la presentación de Fable está intacta

git diff --quiet feature/taba2-real-orders-ops HEAD -- supabase/ \
    js/repositories/supabase_order_repository.js scripts/certify-real-order-pipeline.mjs
    → sin diferencias: la lógica operativa está intacta
```

La regla de "si comparten archivo, preservar lógica operativa y aplicar encima la presentación de
Fable" no llegó a necesitarse en ningún archivo de código: los dos dominios no se pisan.

---

## 3. Combos — el bloqueante sigue cerrado, y es correcto que siga

El bloqueante está documentado en `STOREFRONT-HANDOFF.md` §5.1. La consigna pedía no permitir
"Agregar combo" hasta que el backend valide el combo, los componentes y el precio promocional sean
server-side, el stock se reserve por componente y el frontend no pueda alterar el precio.

**Operaciones no implementa combos.** Su propio handoff lo dice explícitamente: no tocó catálogo ni
combos. Por lo tanto, y como la consigna previó, los combos quedan **visibles pero no comprables**.

Verificado en el árbol de la RC, no de memoria:

- Los siete combos de `data/combos.csv` y `js/combos-data.js` están en
  `approval_status = PENDIENTE_APROBACION_COMERCIAL` con `previewOnly: true`.
- La ficha de combo (`js/ui.js`) **no tiene** botón de agregar: muestra la composición, el ahorro
  derivado, el stock del componente limitante, el aviso `.combo-modal-pending` y un único botón que
  lleva al primer componente.
- No existe **ninguna** ruta de código que meta un combo en el carrito: buscar `combo` cruzado con
  `addToCart`/`cart` en todo `js/` no devuelve una sola coincidencia.
- `tests/e2e/combos.spec.mjs` fija ese contrato.

**Queda como P1 posterior**, y hay trabajo previo aprovechable: la rama
`release/taba2-pilot-integration` ya implementa el contrato completo en cuatro migraciones
(`20260806240000` a `20260806270000`) — definición server-side, precio decidido por el backend,
reserva atómica por componente y `orders.discount_total`. **Esas migraciones ya están aplicadas a
`la-taba-staging`** (ver §7). Esta RC no las incluye porque la consigna acotó la integración a
Operaciones + Fable, pero el camino para cerrar el P1 es integrar esa rama, no reescribirla.

### Precios: nada inventado

Las nueve unidades derivadas sin precio unitario confirmado siguen bloqueadas, con el motivo
explícito en `catalog/catalog-pending.csv`: *"El precio UNITARIO no se puede derivar dividiendo el
pack: incluye el margen minorista que fija el local"*. De 96 filas bloqueadas, 83 lo están por
precio. No se publicó ni se estimó un solo precio nuevo.

---

## 4. Gates

Todos corridos sobre el árbol integrado (`0d7bfee`), en este worktree.

| Gate | Resultado |
| --- | --- |
| `npm run check` | passed |
| `npm test` | **1042 / 1042** — exactamente los 1028 de Fable + los 14 de Operaciones |
| `npm run test:e2e` | **204 / 204** (6.8 min) |
| `npm run test:webhook` | 12 / 12 |
| `npm run test:payments` | 27 / 27 |
| `npm run secrets:scan` | passed |
| `npm run migrations:validate` | revisión estática aprobada |
| `git diff --check` | limpio |
| `npm run certify:orders:staging` | **47 / 47 contra la base real** |

El `1042 = 1028 + 14` no es cosmético: es la prueba aritmética de que el merge no perdió ni duplicó
un solo test de ninguna de las dos entregas.

### 4.1 `npm run config:check` falla, y tiene que fallar

`runtime-config.js` está deliberadamente vacío en el repositorio para fallar cerrado; el script
reporta `status: absent` con cero errores. **No es una regresión del merge**: el archivo no fue
tocado por ninguna de las dos fuentes (`git log 6294a98..HEAD -- runtime-config.js` no devuelve
nada; su último cambio es el commit fundacional). La configuración se inyecta en el artefacto de
deploy, y ahí el mismo gate pasa:

```
Runtime válido: entorno=staging, host=ukxqbgswjlibmnjemrzd.supabase.co,
business=00000000-0000-4000-8000-000000000001, key=sb_pub…se9A
```

El worktree quedó con su `runtime-config.js` vacío, como corresponde.

### 4.2 Certificación viva — qué prueba realmente

Los 47 checks corrieron contra `la-taba-staging` **con las migraciones de combos del otro worktree
ya aplicadas**, que es el escenario real. Cubren, uno por uno, los gates que pedía la consigna:

- **Pagos / checkout** — compra completa: pedido único, dirección/teléfono/envío/total completos,
  reintento idempotente que no duplica ni vuelve a descontar stock, y el rechazo de la base a
  declarar `mercadopago` sin intent verificado.
- **Stock expiry** — abrir el checkout reserva; al vencer, el barrido devuelve el stock y la sesión
  queda `expired`; cero reservas huérfanas.
- **QA isolation** — el pedido con fixture QA se clasifica solo, no entra a la bandeja, no suena, y
  el rider no lo ve ni puede tomarlo sabiendo el código.
- **Panel / Rider** — aceptar → preparar → listo → el rider ve, toma, retira, sale, llega y entrega
  con el código del cliente; segundo claim idempotente; código incorrecto no cierra el pedido.
- **Evidencia protegida** — LT-0030 con `arrived`, revisión 11 y sus 4 fixes de GPS; LT-0033,
  LT-0034 y LT-0035 clasificados QA con sus 3, 4 y 2 eventos.

### 4.3 Auditoría visual

Con el sitio servido localmente, en los dos motores y los seis anchos pedidos:

| Motor | 320 | 375 | 390 | 414 | 432 | 1280 |
| --- | :-: | :-: | :-: | :-: | :-: | :-: |
| Chromium | 0 | 0 | 0 | 0 | 0 | 0 |
| WebKit | 0 | 0 | 0 | 0 | 0 | 0 |

72 pares vista×ancho por motor, todos en cero (contraste WCAG AA, superficies fuera de identidad,
overflow horizontal y blancos táctiles < 44 px). Además, el recorrido completo de compra se
reprodujo sobre el **sitio ya desplegado** con WebKit y descriptor de iPhone 13 (§6.1).

### 4.4 `sw.js`, versiones de caché y el CSS de Fable

Verificado explícitamente, que era lo que la consigna pedía mirar:

- El árbol declara `CACHE_NAME = 'la-taba-runtime-v46-pulido'` y las hojas en `?v=42`.
- Los **92** assets que `sw.js` precachea existen todos en el árbol (cero faltantes).
- El sitio publicado sirve `la-taba-runtime-v46-pulido` — antes del deploy servía
  `la-taba-runtime-v45-gondola`, es decir el storefront comercial **sin** el pulido.
- `styles/brand-home.css?v=42` publicado contiene las reglas de Fable (el favorito sobre plato
  blanco).
- Pedido seis veces seguidas, `sw.js` vuelve siempre con el mismo `ETag`
  (`2d98bc4fde36f3ca48c9578e912110c0`) y la misma versión: el borde no está sirviendo una mezcla de
  versiones, que es el riesgo real de publicar estilos sin service worker.
- El banner "Hay una actualización disponible" aparece y aplica correctamente sobre una instalación
  previa: es el mecanismo de actualización funcionando, no un defecto.

El service worker es **network-first** (`fetch` fresco gana, la caché es respaldo offline), así que
la versión nueva se ve sin trucos de borrar caché.

---

## 5. Deploy

- **Web** — `wrangler pages deploy` sobre el proyecto `taba2-staging`, rama `staging` (que en este
  proyecto es el entorno *Production* del alias). Deployment `4e5f1e75-7ab5-4556-827f-1390e4096ea5`,
  con `--commit-hash 0d7bfee23e15ccc42fb205c4f4af1070faf3b7c6`, y el listado de Cloudflare muestra
  `Source = 0d7bfee`.
- **Artefacto** — construido con `git archive HEAD` en un directorio fuera del worktree, para que
  la RC no tenga que ensuciar su `runtime-config.js`. Se le quitaron los directorios que no son
  sitio (`scripts`, `tests`, `supabase`, `services`, `src-tauri`, `docs`, `.github`, `templates`) y
  se le inyectó el `runtime-config.js` de staging. 359 archivos, 9,5 MB.
- **Backend** — **no se desplegó nada**. La integración no lo requiere: las 8 migraciones de
  Operaciones ya estaban aplicadas y esta RC no agrega ninguna. No se rehízo ninguna migración.

---

## 6. Compra de prueba desde iPhone real

### 6.1 Ensayo previo sobre el sitio desplegado

Antes de pedir la compra se reprodujo el recorrido con WebKit y descriptor de iPhone 13 **contra
`https://taba2-staging.pages.dev`**, deteniéndose antes de pagar para no crear pedidos:

- El producto QA aparece en la góndola y entra al carrito.
- El checkout muestra `Subtotal $ 850`, `Envío a domicilio $ 150`, `Total $ 1.000`, y la fila
  `Pedido mínimo delivery $ 350` renderizada como **nota al pie** — el arreglo §2.4 de Fable,
  visible en el sitio publicado.
- `data-mercadopago-available = "true"` y el selector de pago ofrece las cuatro opciones, incluida
  `mercadopago :: Mercado Pago — Tarjeta, débito o dinero en cuenta`.
- Cero errores de consola.

La disponibilidad de Mercado Pago se confirmó también contra la base:
`get_mercadopago_checkout_availability` devuelve
`{available: true, environment: "test", checkout_mode: "checkout_pro"}`.

El mínimo de delivery real de staging es **$350** (`businesses.minimum_delivery_subtotal`), no los
$5.000 que menciona el handoff de Fable: ese valor venía del fixture local de aquella sesión.

### 6.2 Datos de la compra

| | |
| --- | --- |
| URL | `https://taba2-staging.pages.dev` |
| Producto | `QA TEST iPhone - compra de prueba` (`882c6108-…`), $850, stock 23, `staging_only`, no alcohólico |
| Subtotal | $ 850 |
| Envío | $ 150 |
| **Total esperado** | **$ 1.000** |
| Tarjeta sandbox | `5031 7557 3453 0604` · 11/30 · CVV 123 · titular `APRO` · DNI 12345678 |

### 6.3 Estado

> **PENDIENTE.** Al cierre de esta versión del documento la compra todavía no se ejecutó: el
> monitor de backend corrió 40 minutos sin registrar un solo checkout, intent, pedido ni webhook
> nuevo. Esta sección se completa con la evidencia medida en cuanto la compra ocurra, y recién
> entonces corresponde la declaración final.

Baseline inmediatamente anterior a la compra, para poder medir el delta:

```
orders=58  (production=5, qa=53)   order_items=61   order_events=406
checkout_sessions=36   payment_intents=36   payment_webhook_receipts=105
payment_outbox: 2 completed, 0 pendientes
reservas huérfanas=0   pagos verificados sin pedido=0
stock del producto QA = 23
LT-0030 arrived rev 11 · LT-0033/34/35 origin=qa
```

---

## 7. Convivencia con `release/taba2-pilot-integration`

Hay **otra RC trabajando sobre el mismo staging**, y conviene saberlo antes de tocar nada:

- Aplicó a `la-taba-staging` las migraciones `20260806240000`, `250000`, `260000` y `270000`
  (contrato de combos, precio server-side, líneas de preferencia y `orders.discount_total`).
- Desplegó Edge Functions (sin cambios de código respecto de la base, así que esta RC es
  compatible) y publicó su propio bundle en `taba2-staging` una hora antes que este.
- Creó LT-0078 y LT-0079 con combo cobrado a precio de combo.

Consecuencias reales para esta RC:

1. **La base tiene más esquema del que esta rama conoce.** Es compatible hacia adelante:
   `discount_total` tiene default 0 y la invariante reforzada `total = subtotal - descuento + envío`
   se cumple en las 58 filas de `orders`, incluidas las que crea esta RC (que nunca manda combos).
   La certificación 47/47 corrió contra ese esquema.
2. **El alias web es uno solo.** Este deploy reemplazó el bundle de la otra RC. En sentido
   comercial eso es un retroceso deliberado: la otra rama vendía combos y esta los deja en vitrina,
   que es exactamente lo que la consigna ordenó.
3. **No se tocó ninguno de sus artefactos**: LT-0078 y LT-0079 quedaron como estaban.

El lock `D:\1212\_claude-locks\taba2-staging-mutation.lock` se adquirió de forma atómica
(`set -o noclobber`) antes de la primera mutación y registra el alcance, las fuentes y esta
convivencia.

---

## 8. Lo que no se tocó

Producción, ARCA (`services/arca-fiscal-bridge` sin cambios), `la-taba-demo`
(`yakhtrkukqlgzvxuvhzs`), LT-0030 y los pedidos QA LT-0033 / LT-0034 / LT-0035, que siguen
clasificados `origin=qa` con su evidencia completa. Ninguna migración ya aplicada se rehízo. Cero
datos humanos alterados.

---

## 9. Riesgos y P1 abiertos

1. **Combos no comprables (P1).** Descrito en §3. La ficha es honesta —dice que el local todavía
   tiene que aprobarlos— pero el ahorro anunciado no se puede cobrar hasta integrar el contrato
   backend.

2. **`alcohol_sales_enabled = false` en staging (P1, bloqueante comercial).** Medido en
   `businesses`: además, `alcohol_minimum_age`, la ventana horaria y el timezone están en `null`.
   El backend es fail-closed: un carrito con alcohol levanta `politica de alcohol no configurada`
   (errcode 55000). Como la góndola del piloto es mayoritariamente cerveza, **hoy no se puede
   comprar el rubro principal**. No se corrigió a propósito: habilitar venta de alcohol es una
   decisión comercial y legal (edad mínima, franja horaria, huso), y completarla por cuenta propia
   habría sido inventar política. No afecta la compra de certificación, cuyo producto QA no es
   alcohólico.

3. **Deriva de migraciones.** La base tiene `2402…`–`2702…` aplicadas y esta rama no las versiona.
   Un `migrations:validate` local sigue pasando, pero un despliegue limpio desde esta rama no
   reproduciría el esquema actual de staging. Se resuelve integrando la rama de combos.

4. **`runtime-config.js` se inyecta fuera del repositorio.** Es deliberado (fail-closed), pero
   significa que el artefacto desplegable no sale de un `npm run build`: hay que reconstruirlo como
   en §5 en cada deploy.

5. **61 de 134 módulos JS no están en el precache del service worker** (todo `js/business/`,
   `js/pos/`, `js/payments/`, `js/catalog/` y los combos). Es previo a esta integración y no rompe
   nada online porque el worker es network-first, pero una PWA instalada y offline no los tiene.

6. **Playwright necesita `npx playwright install`** en un worktree nuevo, o el gate E2E falla entero
   por ejecutable ausente y no por regresión.

---

*(La declaración final se agrega en cuanto la compra desde iPhone quede certificada.)*
