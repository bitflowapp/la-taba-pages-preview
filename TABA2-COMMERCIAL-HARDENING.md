# TABA2 — Endurecimiento comercial

Documento de trabajo de la candidata `release/taba2-commercial-hardening`.
Su función es permitir recuperar la sesión y auditar decisiones. **No sustituye
al trabajo**: un hallazgo sólo cuenta como cerrado cuando hay prueba.

## Identidad de la candidata

| | |
|---|---|
| Repositorio | `…\dev\la-taba-pages-preview` (worktrees compartidos) |
| Rama | `release/taba2-commercial-hardening` |
| Worktree | `…\worktrees\taba2-commercial-hardening` (nuevo, propio) |
| Base | `4f49234` — candidata cliente nocturna |
| Lock | `…\_claude-locks\taba2-commercial-hardening-release.txt` |

### Integración de partida

Los dos trabajos recientes eran **hijos directos de la misma base** y sus
archivos son **disjuntos**, así que no hizo falta merge ni resolución de
conflictos. Se integraron por cherry-pick y se verificó que el contenido
resultante es idéntico al de origen, archivo por archivo.

| Commit nuevo | Origen | Trabajo |
|---|---|---|
| `9778134` | `eed44a6` | pulido visual del catálogo (`feature/taba2-catalog-visual-polish`) |
| `6a6b4e6` | `24e38f4` | semántica de markers del mapa (`fix/taba2-map-marker-semantics`) |

`styles/tracking.css` era el archivo con riesgo de solapamiento declarado: lo
toca **sólo** el commit de markers. Verificado con `comm -12` sobre los dos
conjuntos de archivos — intersección vacía.

## Línea de base medida sobre la candidata integrada

Antes de tocar una línea de código:

| Gate | Resultado |
|---|---|
| `npm run check` | **5/5 verde** (syntax, static assets, precache graph, hygiene, location contract) |
| `npm test` | **1369/1369 verde**, 0 fallos |
| Playwright chromium + mobile-webkit | corrida 1 **ABORTADA a propósito** — ver abajo |

### Regla de medición bajo carga

La corrida 1 de Playwright arrancó con el host al **96 % de CPU y 2,5 GB de RAM
libres**, compitiendo contra 14 agentes de auditoría. El gate corre con
`retries: 0` y `timeout: 45_000`, así que bajo esa carga un timeout no distingue
entre «la app está rota» y «la máquina no llegó».

Por eso **la corrida 1 se abortó a mitad de camino, deliberadamente**: no iba a
producir una medición utilizable y, mientras tanto, le robaba la mitad del host
a los agentes de auditoría, que sí estaban produciendo algo. Matarla bajó la
carga del **96 % al 45 %** y liberó de 2,5 a 5,3 GB de RAM. No se descartó
ningún resultado válido porque no había ninguno: el gate no llegó a emitir.

**Ningún fallo de una corrida saturada se clasifica como bug.** Se anotan como
`NEEDS-RERUN / ENVIRONMENT-SUSPECT` y se vuelven a medir en aislamiento, en este
orden:

1. los tests focalizados que hayan fallado,
2. las suites críticas,
3. el E2E comercial.

Y no se corren agentes pesados en paralelo con la certificación final. Un
P0/P1 encontrado por navegador **exige reproducción en host libre antes de
tocar código**: corregir contra una medición saturada es corregir un fantasma.

Nota: el gate de higiene estaba **rojo** en la base `4f49234` (rutas con letra
de unidad en `CANDIDATA-CLIENTE-OVERNIGHT-RC.md`). El commit de pulido lo
corrigió, así que la candidata integrada arranca en verde y el `1368/1369`
histórico pasa a `1369/1369`.

---

## La auditoría de 14 frentes

Se corrieron 14 auditorías de subsistema en paralelo, cada hallazgo con un
verificador **adversarial** aparte cuya consigna era REFUTARLO.

**La corrida se quedó sin presupuesto de sesión a mitad de camino**: de 77
agentes, 27 terminaron y **50 murieron** por límite. Cayeron casi todos los
verificadores y el buscador entero de `ux-copy-a11y`.

### Corrección de un número que yo mismo reporté mal

Primero dije «55 refutados, 8 sobrevivieron». **Es falso, y el error era mío**:
mi script de orquestación clasificaba como refutado todo lo que no tuviera
`verdict.real`, y un verificador que **muere** deja `verdict === null`, que
también entra por esa rama. Estaba contando «no se pudo verificar» como «se
verificó y no era nada», que es justo la confusión que una verificación
adversarial existe para evitar.

El recuento real, separando por si el verificador llegó a emitir:

| | |
|---|---|
| Hallazgos crudos | **63** |
| Confirmados (el verificador corrió y sostuvo el hallazgo) | **8** |
| Refutados de verdad (el verificador corrió y lo tumbó) | **6** |
| **Sin veredicto** (el verificador murió por límite) | **49** |

O sea que **sólo 14 de 63 hallazgos quedaron adjudicados**. Los 49 restantes no
son ni bugs ni falsos positivos: son desconocidos. Consecuencia:

- lo que dice `CONFIRMADO` abajo pasó por refutación adversarial **o** por
  verificación propia contra el código, indicada caso por caso;
- lo que quedó sin veredicto **no se cuenta como bug** ni entra al veredicto,
  pero tampoco se puede descartar, y por eso el sistema no puede declararse
  auditado;
- el frente `ux-copy-a11y` quedó **sin cubrir** y se declara como hueco.

## Hallazgos

Estado: `ABIERTO` · `CORREGIDO` · `ACEPTADO` · `EXTERNO` (requiere decisión humana)

### Corregidos en esta sesión

| # | Sev | Qué | Commit |
|---|---|---|---|
| H-04 | **P0** | El mismo carrito podía crear **dos pedidos reales** | `ce28c2e` |
| H-05 | **P0** | «Transferencia» era una forma de pago que la base rechaza siempre | `dc5f6fc` |
| H-06 | **P1** | El pedido de una persona apagaba el checkout de las demás | `2fa27bc` |
| H-03 | P1 | La ausencia de coordenada valía 0,0 en 4 validadores | `6c0f9a5` |
| H-02 | P2 | En teléfono no se veía qué orden estaba aplicado | `c44084d` |

### H-04 · P0 · CORREGIDO · El mismo carrito podía crear dos pedidos reales

**Verificado por mí contra el código**, no por agente (su verificador murió).

El carrito vive en `localStorage`; la clave de idempotencia vivía en
`sessionStorage` (`storage = safeSessionStorage()`). Un pedido que **sí se creó**
en el servidor y cuya respuesta se perdió —radio que reengancha, iOS que
descarta la pestaña de fondo, la persona que cierra la app y vuelve— dejaba al
cliente con el mismo carrito y sin la clave. El segundo intento nacía con otro
`client_request_id`, el índice único `(business_id, client_request_id)` no veía
nada repetido, y el negocio recibía **dos pedidos**: los prepara los dos y los
cobra los dos.

Lo que más pesa: **la RPC ya estaba escrita para ese reintento**.
`create_order_with_items` toma un advisory lock por `(comercio, clave)`, busca el
pedido existente y, si el hash del token de seguimiento y la huella del payload
coinciden, **devuelve ese pedido** en vez de crear otro. Toda esa recuperación
era inalcanzable porque el navegador tiraba la llave antes de poder usarla.

El registro pendiente pasa a `durableStorage` (localStorage), la misma vida que
el carrito al que protege. Dos tests, uno control negativo del otro.

### H-05 · P0 · CORREGIDO · Una forma de pago que la base rechaza siempre

**Verificado por mí contra el código** (su verificador murió). El checkout
ofrecía «Transferencia al confirmar»; el CHECK `orders_payment_method_valid`
acepta `mercadopago | cash | coordinate | qa_no_charge`. El valor viaja sin
traducción: el `<select>` lo entrega tal cual, el repositorio lo pasa verbatim y
la RPC hace `nullif(btrim(coalesce(payload->>'payment_method','')),'')` sin lista
blanca. **El pedido no se crea.** Para el cliente: elegir una forma de pago que
el negocio publicita, completar todo, y recibir un error genérico al final.

La causa de fondo eran **cuatro listas de formas de pago** que nadie mantenía
juntas (markup, `validators.js`, etiquetas de `state.js`, y el CHECK). El test
nuevo no escribe una quinta: lee el CHECK de la migración y las `<option>` del
markup y compara lo ofrecido contra lo aceptado.

Se retiró la opción en vez de agregar `transfer` al CHECK **a propósito**: una
transferencia de verdad necesita datos bancarios, comprobante y alguien que
confirme antes de preparar. Eso es una funcionalidad con su migración, no una
línea en un enum. Queda como seguimiento comercial.

### H-06 · P1 · CORREGIDO · El pedido de una persona apagaba el checkout de las demás

**Verificado por mí contra el código** (su verificador murió). Cadena completa:
cada pedido hace `update public.products set stock = stock - v_item.quantity` →
evento realtime de `products` → `loadCatalog()` → `setProductionCatalogReady(false)`
como primera línea → `isProductionOrderingBlocked()` verdadero → el botón
«Confirmar pedido» se deshabilita y el submit contesta **«Los pedidos online
todavía no están disponibles»**, que es falso. En una tienda con movimiento no
es un parpadeo aislado: es continuo.

Y un segundo defecto peor, silencioso: `catalogProductCount = 0` corría **antes**
de la consulta y la rama de error no lo restauraba, así que **un solo refresco
fallido dejaba la tienda bloqueada** hasta el próximo evento que saliera bien.

Dos tests nuevos, comprobados fallando contra el código anterior. El primero
mira la tienda **en medio** del refresco, con la consulta detenida a propósito.

### H-01 · P2 · Contenido nuevo bajo la versión vieja: se rompe la invariante que el propio worker usa como excusa

**Estado:** ABIERTO — clasificado como **release-hardening, no P1**. El bump de
`?v=` y `CACHE_NAME` se ejecuta **una sola vez, con la candidata final ya
cerrada**, para no encadenar bumps repetidos mientras siguen entrando
correcciones.

**Corrección de mi primera lectura.** Empecé anotando esto como P1 «el usuario
que vuelve se queda con el CSS viejo». **Es falso y lo dejo escrito para que no
se vuelva a afirmar.** El worker es *network-first* con reescritura de caché
(`networkFirst`, `guardar(request, response.clone())`) y `precargar()` pide con
`cache: 'reload'`. Un cliente en línea que recarga recibe el CSS nuevo **sin
ningún bump**. La app no queda partida por este motivo.

**Lo que sí rompe.** La candidata modifica 9 archivos que se sirven al cliente
—`styles/{brand-home,catalog,common,profile,responsive,storefront,tokens,tracking}.css`
y `js/map/rider_marker.js`— y el contrato de versionado sigue diciendo `?v=49`
en los 28 sitios donde vive, con `CACHE_NAME` todavía en
`la-taba-runtime-v61-cliente-comercial-mapa-permanente`. Eso deja tres cosas
rotas, en orden de importancia:

1. **El atajo del cortacircuitos pasa a mentir.** `sw.js` justifica servir la
   copia guardada sin esperar a la red con este argumento textual: «el precache
   está versionado (`?v=49`), así que una copia guardada es el MISMO contenido
   que iba a traer la red, no una versión vieja». Con contenido nuevo bajo la
   misma URL **deja de ser el mismo contenido**. En una red degradada —tres
   plazos vencidos, corte de 10 s— el cliente recibe HTML y JS nuevos con CSS
   viejo. Es un camino estrecho, pero es exactamente el escenario para el que se
   escribió ese código.
2. **Identidad de release.** `scripts/preflight-staging-package.mjs` afirma
   `ESPERADO = { app:'?v=41', css:'?v=49', cache:'la-taba-runtime-v61-…' }` y
   `scripts/certify-staging-always-map.mjs` identifica lo desplegado por el
   nombre de la caché. Publicar contenido distinto bajo la misma identidad
   vuelve indistinguibles dos artefactos y deja sin ancla el rollback.
3. **PWA instalada sin red.** Mientras no haya una carga en línea exitosa, sigue
   sirviendo el CSS anterior. Se cura sola, pero se cura sola *después*.

**Causa raíz.** El versionado es manual y deliberadamente se hace una sola vez
por release; las dos ramas integradas se cerraron sin bump —correctamente, cada
una lo declaró en su lock— y nadie lo hizo todavía porque la candidata no
existía hasta ahora.

**Superficie del bump (medida, no estimada):**

- `styles.css` — 13 `@import ... ?v=49`
- `index.html` — 1 `<link ... styles.css?v=49>`
- `sw.js` — `CACHE_NAME` + 14 entradas `?v=49`
- Pines que fallan si el bump queda a medias, y por eso son la red de seguridad:
  `tests/pwa.test.mjs`, `tests/github-pages.test.mjs`,
  `tests/service-worker-degraded-edge.test.mjs`,
  `tests/service-worker-install-and-timeout.test.mjs`,
  `tests/e2e/service-worker-degraded-recovery.spec.mjs`,
  `scripts/preflight-staging-package.mjs`, `scripts/certify-staging-always-map.mjs`

`js/map/rider_marker.js` **no** lleva `?v=`: a ese archivo lo protege
únicamente `CACHE_NAME`, lo cual confirma que el bump de la cache es
obligatorio y no opcional.

### H-02 · P2 · En teléfono, el orden elegido no se ve en ninguna parte

**Estado:** ABIERTO

**Reproducción.** `@media (max-width: 560px)` — es decir, todos los teléfonos —
`styles/responsive.css:744` deja el `<select>` de orden en `opacity: 0`
ocupando toda la caja. Lo único visible es `.sort-label-short`
(`index.html:503`), que es el texto **estático** «Ordenar», más una flecha
dibujada por `::after`. El usuario toca, elige «Menor precio», y el control
sigue diciendo «Ordenar». La grilla se reordena, así que hay una señal
indirecta, pero el control no declara su propio estado.

**Causa raíz.** El patrón de select invisible sobre una superficie dibujada a
mano es correcto y accesible —el `<select>` nativo conserva la semántica y su
`aria-label`—, pero le falta el espejo visible del valor elegido.
`js/ui.js:2190` ya sincroniza `select.value` con `state.sortBy`; no hay nada
que escriba ese valor en pantalla.

**Corrección prevista.** Escribir la etiqueta de la opción elegida en un span
visible, en el mismo punto donde ya se sincroniza el `value`. Sin tocar la
lógica de orden ni la accesibilidad.

### H-03 · P0-candidato · `null` se convierte en coordenada 0,0

**Estado:** EN INVESTIGACIÓN — el defecto está confirmado en el código; se está
midiendo qué caminos reales lo alcanzan.

**Reproducción del defecto en sí.** `Number(null) === 0` y
`Number.isFinite(0) === true`, así que:

- `isValidMapPoint({lat: null, lng: null})` → `true` (`js/map/maplibre_tracking_map.js:103`)
- `normalizeTrackingLocation({lat: null, lng: null})` → `{lat: 0, lng: 0, …}` (`js/core/domain.js:23`)

Es decir: la capa cliente considera que «sin dato» es una posición válida en el
Golfo de Guinea, y `normalizeTrackingLocation` además le pone `source` y
`timestamp` — la presenta como un fix real.

**El repo ya tiene la forma correcta y no la usa en todos lados.**
`js/core/delivery-location.js:202` valida así, y es lo que corresponde:

```js
function finiteCoordinate(value, limit) {
  if (value == null || String(value).trim() === '') return null;
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || Math.abs(numeric) > limit) return null;
  return numeric;
}
```

**Lo que ya se descartó como camino real** (para no inflar la severidad):

- `rider_locations` tiene `lat`/`lng` **`not null` con `check` de rango**
  (`supabase/migrations/20260531030000_la_taba_phase1_orders.sql:79-80`), así que
  una fila con coordenada nula no existe.
- El camino público del cliente pasa por un `jsonb_strip_nulls` en la RPC de
  seguimiento, que convertiría un `null` en **clave ausente** →
  `Number(undefined)` es `NaN` → rechazado. Ese camino se salva por accidente,
  no por diseño.

**Lo que falta.** Enumerar el resto de normalizadores y sus llamadores.
`latestRiderLocation` (`js/repositories/supabase_order_repository.js:2509`)
filtra por `source === 'gps'` y por timestamp finito, y **no mira lat/lng**:
delega toda la validación en el normalizador que no valida. Si algún camino
entrega `null` en vez de ausente, dibuja Null Island.

---

### H-08 · P1 · CORREGIDO (`e1d6dba`) · El carrito se recortaba y se vaciaba solo mientras el cliente lo miraba

**Cerrado.** Lo que sigue documenta el defecto y —más importante— la parte que
el hallazgo original NO decía y que descubrí al implementarlo.

**El hallazgo nombraba un solo sitio; había dos.** `sanitizeCart` es el que se
ve leyendo el código, pero en **producción la línea moría antes**:
`loadCatalog()` consulta con `.eq('available', true)` y `available` en la base
es `stock > 0`, así que un producto agotado **no vuelve en la respuesta**, y
`replaceProductionCatalog` filtraba el carrito por los ids recibidos. Arreglar
sólo `sanitizeCart` no habría arreglado producción — y el test de producción que
escribí lo confirma: falla contra el código anterior por el segundo sitio, no
por el primero.

**El arreglo es dejar funcionar lo que ya estaba construido.** `cartItemIssue`,
el aviso `.cart-item-issue` con `role="status"`, el botón `data-cart-fit` con su
cantidad correctiva y la rama de `validateCartForCheckout` existían todos y eran
inalcanzables. No hizo falta UI nueva.

**Un tercer caso que sólo apareció al probar:** en producción la hidratación del
carrito está **diferida** —al arrancar no hay catálogo—, así que la validación
real ocurre cuando llega el primer catálogo verificado, y ese camino entra por
`updateState`. Sin poder pedir `hydrate` en ese commit, un carrito guardado en
disco con productos agotados volvía a la pantalla como válido. Lo destapó el
spec `lo que vuelve del disco se reconcilia con el catálogo verificado`, que se
puso en rojo con mi primera versión del arreglo.

**Test actualizado, no borrado.** `cart rejects invalid quantities and prunes
disabled products from state` afirmaba `state().cart === []`. Su intención —que
no se pueda comprar algo deshabilitado— se conserva entera: ahora la línea
queda, viene marcada `unavailable` y `validateCartForCheckout` impide confirmar.
Se renombró para que el nombre diga lo que prueba.

Gates: `npm test` 1406/1406 (+12) · Playwright chromium: `production-cart-persistence`
5/5 con el caso nuevo comprobado fallando contra el código anterior; carrito y
checkout 58/58.

<details>
<summary>El defecto, como estaba</summary>

### El defecto original

**Verificado adversarialmente, confianza alta, y reproducido de nuevo por mí.**

`sanitizeCart` corre en **cada** `commitState`, no sólo al hidratar del disco
(`js/state.js:214` ← `sanitizeState` ← `commitState:727`). Y hace dos cosas:

```js
js/state.js:364  if (!isProductOrderable(product) || !product.available || product.stock <= 0) continue;
js/state.js:370  byProduct.set(item.productId, Math.min(product.stock, current + quantity));
```

En producción el catálogo se recarga por realtime cada vez que alguien compra
(la RPC descuenta stock), así que **con el cliente mirando la pantalla** su
carrito se recorta o desaparece, sin una palabra. Medido: 5 unidades → llega
stock 2 → queda en 2 y el total baja de $17.880 a $7.152; llega stock 0 → el
carrito queda vacío.

**Y deja muerta la función que existía para evitar exactamente eso.** Como
después de cada commit siempre se cumple `quantity <= stock` y el producto está
disponible, `cartItemIssue` (`js/cart.js:298`) devuelve `null` siempre. Con eso
quedan inalcanzables `.cart-item-issue` (`js/ui.js:2879`), el botón
`data-cart-fit` (`js/app.js:1363`) y las ramas de `validateCartForCheckout`. El
propio comentario de `cart.js` dice que existen porque «el cliente se enteraba al
final del recorrido y sin saber CUÁL de sus productos era el problema». Hoy no
se entera nunca, que es peor que el «antes» que el módulo documenta.

**Por qué no lo corrijo en esta sesión.** El arreglo correcto **no** es el que
propuso el agente (dejar de recortar del todo). El propio comentario de
`sanitizeCart` dice que descartar es lo que corresponde **al hidratar** —«esa
línea se descarta al hidratar»—: el defecto es que la misma función también
corre en vivo. La corrección honesta separa los dos casos, que ya están
separados en el código (`hydrateState` vs `commitState`, ambos entran por
`sanitizeState`):

- **al hidratar del disco**: descartar y recortar como hoy (nadie está mirando);
- **en vivo**: conservar la línea y dejar que `cartItemIssue` la explique;
- **siempre**: descartar el producto que ya no existe en el catálogo o con
  precio pendiente, porque ése sí se cobraría a cero.

Eso toca una función de la que dependen muchos tests y cambia lo que ve el
cliente en el punto de compra. Es un ciclo propio —reproducir, corregir, medir
regresiones— y hacerlo con el presupuesto que queda sería apurarlo. Queda
documentado con su reproducción y su dirección de arreglo, y **cuenta como P1
abierto en el veredicto**.

### H-07 · P1 · ABIERTO, REQUIERE TU DECISIÓN · El repartidor puede leer la caja, lo fiscal y la auditoría del comercio

**Verificado por mí contra el código.** No se corrige acá: cambiar RLS sobre la
base compartida es de alto impacto (§36) y queda como solución preparada, no
aplicada.

`business_members.role` admite `owner`, `admin`, `staff` y **`rider`**
(`business_members_role_check`), y la propia tabla se documenta diciendo que
«staff and rider have **scoped** operational access». Pero
`is_business_member(uuid)` **no mira el rol**:

```sql
select exists (select 1 from public.business_members bm
                where bm.business_id = target_business_id
                  and bm.user_id = auth.uid()
                  and bm.is_active = true)
```

y diecinueve policies de lectura se apoyan en esa función
(`20260802160000_business_windows_scanner_fiscal.sql:1191-1207`). Un repartidor
con membresía activa —que muchas veces es un tercero contratado— puede leer:

- `pos_sales`, `pos_sale_items`, `pos_payments` — ventas de mostrador y caja
- `fiscal_profiles`, `fiscal_documents`, `fiscal_document_items`, `fiscal_events`
- `business_command_receipts` — auditoría de comandos, con el payload de las órdenes
- `inventory_movements`, `inventory_receipts`, `stock_count_*`
- `catalog_product_drafts`, `product_barcodes`, `notification_outbox`,
  `order_packing_*`

El «scoped» del comentario **no está implementado**.

**Por qué es acotado de arreglar.** Los únicos consumidores de esas tablas en el
cliente son tres repositorios del **Panel** (`supabase-pos-repository`,
`supabase-fiscal-repository`, `supabase-inventory-repository`), no del Rider —el
Rider es otra app, con sus propias RPC—. Cambiar la condición a

```sql
public.has_business_role(business_id, array['owner', 'admin', 'staff'])
```

deja exactamente al mismo conjunto de personas que hoy opera el Panel.

**Qué NO habría que tocar:** `is_business_member` en sí (sigue siendo la
respuesta correcta a «¿pertenece a este comercio?»), ni `is_assigned_rider`, ni
las policies por las que el repartidor ve **los pedidos que tiene asignados**,
que es su trabajo.

**Reversión:** volver a `is_business_member(business_id)` en las mismas policies.
No hay pérdida de datos; sólo cambia quién puede leer.

## Decisiones que no son mías

### D-01 · HUMAN DECISION / COMMERCIAL-LEGAL CONFIG — venta de alcohol deshabilitada en el backend

**No se toca.** Instrucción explícita del usuario: queda marcado como gate
humano y la auditoría sigue normalmente por todos los demás frentes.


`businesses.alcohol_sales_enabled` es `boolean not null default false`, y las
RPC de checkout rechazan el pedido si está en `false`
(`20260725030000_taba_production_orders.sql:681` y cuatro redefiniciones
posteriores). El control **está implementado y funciona**; lo que está en
`false` es el dato del comercio en staging.

Encenderlo es una decisión **comercial y legal** del usuario, no un bug que yo
deba corregir. Un negocio de bebidas que no puede vender alcohol no está
comercialmente listo, así que esto entra al informe final como gate humano.

## Los 49 sin veredicto

**Esto no es una lista de bugs.** Es lo que un buscador afirmó y ningún
verificador llegó a mirar. Cada línea puede ser un defecto real, un falso
positivo o una cita mal leída. Se publican porque es el mapa de dónde seguir, y
porque ocultarlas sería peor.

Dos de ellas **ya no son incógnitas**: las verifiqué yo contra el código y están
corregidas en esta rama — «El storefront ofrece Transferencia…» (`dc5f6fc`) y
«La clave de idempotencia vive en sessionStorage…» (`ce28c2e`). Que un buscador
las encontrara y su verificador muriera, y que al mirarlas de cerca resultaran
ser los dos P0 de la sesión, es la razón para no tratar el resto como ruido.

Tres más las verifiqué y están arriba como `H-06` (realtime, corregida), `H-07`
(RLS, abierta) y `H-08` (carrito, abierta).

### backend-esquema (5)

- El storefront ofrece «Transferencia»… → **verificada y corregida** (`dc5f6fc`)
- `public.commercial_contract_remediation` queda en el esquema público sin RLS y sin revocar privilegios: lectura y escritura anónimas por PostgREST
- El seguimiento público mide la frescura del GPS con el reloj del teléfono del rider, y la RPC de ingesta acepta capturas de hasta 10 minutos
- `checkout_pipeline_state` está declarada IMMUTABLE y llama a `clock_timestamp()`
- `release_expired_stock_reservations` recalcula `available` ignorando stock y estado del precio

### catalogo-verdad (7)

- Un pack x6/x12 se le muestra al cliente sin indicador de pack: nombre, ficha y carrito dicen «1500 ml» al lado del precio del pack
- El rechazo de la política de alcohol se traduce a «reintentá»: la compra es imposible y el mensaje miente sobre por qué
- Un producto que se agota mientras el cliente arma el pedido desaparece del carrito sin aviso → **relacionada con `H-08`**
- Vender la última unidad por mostrador (POS) hace fallar la venta entera: el UPDATE de stock viola el constraint de disponibilidad
- `?demo=1` sirve una tienda completa con 82 productos y precios locales, sin rótulo de simulación
- Tres productos publicados aparecen dos veces en la góndola: uno comprable y su gemelo «Precio próximamente»
- La inferencia de alcohol por categoría no conoce las categorías que el catálogo usa de verdad (vinos, espumantes, destilados, fernet, aperitivos)

### checkout-idempotencia (4)

- La clave de idempotencia vive en sessionStorage… → **verificada y corregida** (`ce28c2e`)
- El segundo pedido de la misma sesión nace sin seguimiento: la app lleva al Seguimiento del pedido ANTERIOR
- Cada toque de «Pagar con Mercado Pago» abre una sesión de pago nueva y cada una descuenta stock por 15 minutos
- Los rechazos de alcohol y de mínimo de delivery se traducen a un genérico que invita a reintentar algo que nunca va a entrar

### debug-muerto (5)

- `?demo=1` y `?showcase=1` convierten el sitio desplegado en una sandbox SIN rótulo, y el pedido se confirma con el mismo texto que producción
- En producción, cada carga borra los favoritos guardados del cliente
- El relay de demo acepta CUALQUIER origen por query param: un enlace preparado publica nombre, teléfono, dirección y coordenadas a un host de terceros
- `applyProductionTrackingCopy()` es código muerto: nadie produce el nodo que corrige
- Ganchos de QA en el bundle comercial: `globalThis.__TABA_TEST_CATALOG__` y `window.TABA2_MOTION`

### fechas-tz (4)

- El DTO público de tracking no tiene tope superior de frescura: un fix con `captured_at` futuro se presenta como «Ubicación en vivo · ahora»
- El cierre de caja toma la zona horaria del navegador del operador, no la del negocio, y queda en un registro inmutable
- En el Panel, `toLocaleString('es-AR')` imprime 21:30 y 09:30 igual: se concilian pagos contra una hora ambigua
- `validFrom` se parsea como UTC: una promo de mañana figura «Activa» desde las 21:00 de hoy

### panel-intake-dedupe (4)

- El Panel reescribe todo su DOM 3 veces por ciclo de poll (5 s): el rider elegido vuelve al primero y el motivo de cancelación tipeado se borra
- Cada vuelta a la pestaña emite `SIGNED_IN` y el Panel borra la bandeja y muestra el login
- Las «Observaciones del pedido» nunca llegan al Panel cuando se paga con Mercado Pago
- Piso y departamento se guardan pero no se muestran al Panel ni al rider: la moto sale sin el dato que completa la entrega

### realtime-concurrencia (5)

- Cada cambio de estado bloquea la tienda… → **verificada y corregida** (`2fa27bc`, `H-06`)
- El Panel se cae al login en cada refresco de token de Supabase
- El refresco no es single-flight: en red degradada se apilan y una respuesta vieja pisa el estado nuevo
- Un pedido que entra mientras se reconstruye el coordinador nunca dispara la alerta de «Nuevo pedido»
- El tick del seguimiento commitea un cambio vacío cada 5 s y fuerza un `renderAll` completo

### rls-seguridad (3)

- Un rider puede leer los datos personales de TODOS los pedidos vía `business_command_receipts` → **verificada, abierta (`H-07`)**
- Un rider puede leer la caja, el mostrador y los comprobantes fiscales → **verificada, abierta (`H-07`)**
- `check_scheduler_watchdog` está concedida a `anon` y escribe en `operational_alerts` con texto elegido por quien llama

### secretos-config (6)

- `config:check` aprueba la plantilla SIN editar: host inválido, clave placeholder y businessId de ceros pasan como «Runtime válido»
- El gate «Secret scan» de CI sólo ve tokens de Mercado Pago: es ciego a `service_role`, PAT de Supabase y tokens de GitHub/Cloudflare
- Ningún gate automático valida el `runtime-config.js` que el deploy publica
- `.env.example` documenta un origen que el Edge Function descarta en silencio por no ser HTTPS
- `config:check` rechaza el stub del repo sin decir por qué
- `github.ref_name` se interpola dentro de un script pwsh en el job que recibe la clave de firma de Tauri

### tracking-estados (6)

- El pedido ENTREGADO borra el seguimiento del cliente: el poll interpreta la falta de `terminal_visible_until` como acceso revocado
- «Señal GPS débil» permanente: el piso del servidor (100 m) supera el umbral del cliente (80 m), así que «Ubicación en vivo» sería inalcanzable
- La frescura del rider se mide contra el reloj del TELÉFONO DEL RIDER
- Un pedido de RETIRO muestra la línea de progreso de reparto
- Dos escritores del snapshot público sin guardia de orden: el cliente ignora `revision`
- El pin del LOCAL queda en 1,89:1 de contraste sobre el lienzo nocturno

### ux-copy-a11y (0 hallazgos, 0 cobertura)

El agente murió antes de empezar. **Este frente no se auditó.**

## Veredicto

# NO-GO — BLOQUEADORES RESTANTES

No por lo que se rompió, sino por lo que **no se llegó a mirar**. Los dos P0 que
aparecieron están cerrados con prueba; lo que impide un GO es esto:

1. **Dos P1 abiertos.** `H-07` (el repartidor lee la caja, lo fiscal y la
   auditoría del comercio) y `H-08` (el carrito se recorta solo y deja muerto el
   aviso que lo explicaba).
2. **49 de 63 hallazgos sin veredicto.** Entre ellos hay afirmaciones de
   severidad alta sobre el Panel, el seguimiento y el realtime que no fueron ni
   confirmadas ni refutadas. Un sistema con 49 incógnitas abiertas no está
   auditado, está empezado.
3. **Un frente sin auditar**: `ux-copy-a11y` (accesibilidad, veracidad del copy,
   affordances) perdió su agente y nunca corrió.
4. **Sin staging desplegado y sin gates físicos.** La candidata no se publicó, y
   el iPhone y el Moto G15 siguen pendientes.

La regla del encargo es explícita: no se usa `GO` con P0 o P1 abiertos.

## Puntuación (0–100)

Puntúo lo que **medí**. Donde no medí, lo digo: un número inventado acá sería
exactamente el pecado que este trabajo persigue.

| Área | Puntaje | Sobre qué evidencia |
|---|---|---|
| Cliente / storefront | 78 | suites verdes + e2e chromium; falta el frente de a11y/copy |
| Catálogo | 75 | pulido integrado y medido; datos comerciales sin auditar (agente sin veredicto) |
| Checkout | 85 | dos P0 cerrados con prueba acá; idempotencia real de punta a punta |
| Negocio / Panel | — | **sin puntuar**: los 4 hallazgos del Panel quedaron sin veredicto |
| Rider | — | **sin puntuar**: es otra app y otro repo; no se ejecutó |
| Tracking | 70 | markers integrados y medidos; 6 hallazgos sin veredicto |
| Backend / datos | 72 | esquema e idempotencia leídos a fondo; 5 hallazgos sin veredicto |
| Realtime | 65 | un P1 cerrado con prueba; 4 hallazgos sin veredicto |
| Seguridad | 60 | RLS con un P1 confirmado y abierto (`H-07`) |
| PWA / caché | 88 | ruta de actualización leída entera y bump coordinado con sus pines |
| UI / UX | — | **sin puntuar**: es justo el agente que no corrió |
| Responsive | 80 | smokes 320→1280 verdes en chromium |
| Performance | — | **sin puntuar**: no se midió nada en esta sesión |
| Observabilidad | — | **sin puntuar**: no se auditó |
| Listo para release | 45 | árbol limpio y candidata con identidad propia, pero sin desplegar ni certificar |

## Gates físicos — checklist

**Ninguno de los dos se ejecutó. Los dos quedan `PENDING` y no se inventa un
resultado.** El checklist es corto a propósito: son las cosas que un emulador no
decide.

### iPhone (Safari real) — `PENDING`

1. Abrir la URL de staging sin PWA instalada. ¿Arranca sin pantalla en blanco?
2. Barra de direcciones dinámica: scrollear la home y el catálogo. ¿La barra
   inferior queda tapada o flotando?
3. Safe areas: ¿el contenido pasa por debajo del notch o del indicador de home?
4. Teclado abierto en checkout (nombre, teléfono, dirección). ¿Tapa el campo
   activo? ¿Se puede llegar a «Confirmar pedido»?
5. Control de orden en el catálogo: elegir «Menor precio» y comprobar que el
   texto visible ahora **dice** «Menor precio» (H-02).
6. Carrito: agregar, recargar la pestaña, volver. ¿Sigue el carrito?
7. Handoff a Mercado Pago y **vuelta con el botón atrás**: ¿la tienda se rearma
   sin quedar sin estilos y sin crear una segunda sesión de pago?
8. Instalar como PWA, cerrar, volver a abrir. ¿Arranca?
9. Actualización: con la versión anterior instalada, publicar la candidata y
   recargar. ¿Queda coherente **sin** «borrar datos del sitio»?

### Moto G15 (Chrome Android) — `PENDING`

1. 360×800: recorrer home, catálogo, carrito, checkout y seguimiento buscando
   scroll horizontal.
2. Los controles principales alcanzan 44 px.
3. Mapa de seguimiento: que los tres marcadores se distingan sin leer texto
   (local vitrina, destino casa, rider moto) y que el rider **no aparezca** sin
   ubicación válida.
4. Pan y zoom del mapa: el jank de rasterizado ya está medido y aceptado como
   post-piloto; sólo confirmar que no se congela.
5. Mismo punto 5 del iPhone: el orden aplicado se ve.
6. Mismo punto 9: actualización desde la versión anterior.

## Qué falta para producción

1. Cerrar `H-07` y `H-08`.
2. Terminar la verificación de los 49 hallazgos sin veredicto y auditar
   `ux-copy-a11y`.
3. Desplegar la candidata a un **preview** de Cloudflare Pages (`taba2-staging`,
   nunca `--branch=staging`, nunca GitHub Pages) y correr el smoke contra la URL.
4. Probar la actualización desde la versión anterior instalada, ahora que la
   candidata sí cambia de `?v` y de `CACHE_NAME`.
5. Gates físicos: iPhone y Moto G15.
6. Decisión tuya sobre `alcohol_sales_enabled` (D-01) y sobre si «Transferencia»
   vuelve con un flujo real.

## Bitácora

- Locks leídos al abrir: los 27 de `_claude-locks`. Ninguno `HOLDING`. Se dejó
  el propio antes de crear nada.
- `node_modules` es una **unión** al worktree de la candidata nocturna: no se
  instala ni se actualiza nada ahí.
- `TMP`/`TEMP` redirigidos a `…\_claude-tmp\commercial-hardening` y puertos
  8210/18810, porque el disco del temporal por defecto tenía 0,6 GB libres y los
  puertos por defecto son de otras sesiones. (La ruta va con elipsis a
  propósito: el gate de higiene rechaza rutas con letra de unidad en archivos
  versionados, y este documento no es la excepción.)
