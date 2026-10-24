# Vidriera del cliente: rediseño UX/UI — 2026-10-24

Rama: `feature/ux-premium-storefront-20261024`, creada desde `ec4962e1`
(`feature/catalog-pricing-images-20261024`, vitrina Neuquén de GLM con 42 fotos
reales sobre 52 SKU). Los commits de GLM siguen intactos debajo de los de esta
rama. Sin merge. No toca precios, stock, pedidos, pagos ni lógica financiera.

## Cómo verlo

```powershell
node scripts/realtime-relay.mjs 8231
```

| Qué | URL |
|---|---|
| Vitrina Neuquén (fotos reales de GLM) | <http://localhost:8231/?reset=1&demo=1&vitrina=neuquen20261024> |
| Demo aprobado, con historias y combos | <http://localhost:8231/?reset=1&demo=1> |
| Antes y después lado a lado | `artifacts/ux-premium-20261024/comparacion/index.html` |

Sin `?demo=1` la tienda local muestra el cierre honesto («La tienda online
todavía no está abierta»): no hay proyecto de producción. El camino productivo
se verifica con el arnés que simula el catálogo de Supabase
(`tests/e2e/catalog-runtime-fixture.mjs`).

## Qué cambió

Todo vive en una capa nueva, `styles/ux-premium.css`, al final de la cascada,
más tres cambios chicos de JS en `js/ui.js`/`js/app.js` (visor de historias,
banner de marca con foto de producto y el total para la barra del checkout).
No hay textos nuevos. Cada sección de la hoja dice qué medición la motivó.

| Superficie | Antes (medido) | Después |
|---|---|---|
| Tarjeta del catálogo (390) | 384px de alto, foto de 143px; 2 productos por pantalla y **ningún precio** sin scrollear | ~300px, foto de 159px a ras; precio y «Agregar» del primer renglón visibles sin scrollear |
| Controles del catálogo (390) | chips de 54px, buscador de 52px y orden de 60px en una fila propia | chips de 44px, buscador de 48px, orden de 44px al lado del título (si el filtro de producción está visible, se apilan como antes) |
| Pastilla «Recomendado» | tapaba la base de la foto | esquina superior izquierda, más chica |
| Catálogo escritorio (1280) | tarjeta de 600px de alto con mucho aire | mismo presupuesto de columnas (≥250px, lo fija `premium-storefront.spec`), tarjeta compacta con foto cuadrada |
| Home escritorio (1280) | 1060px de ancho con 110px de margen por lado; rieles de 4; un riel de 3 tarjetas las estiraba a 316px | hasta 1400px; rieles de 3 en tablet, 4 desde 960, 5 desde 1100 y 6 desde 1500, siempre parejos |
| Combos en escritorio | un combo solo ocupaba el renglón; siete quedaban 3+3+1 | uno: tarjeta horizontal; dos a cuatro: grilla; cinco o más: carrusel de cuatro con el borde desvanecido |
| Banner de marca Andes Origen | la imagen era una tarjeta de **receta** («Ricotta casera + Repollitos quemados y pomelo») del sitio de la marca | foto de producto de Andes Origen Rubia con licencia comercial `TABA-AUT-2026-08-001` (la misma de su tarjeta), entera en un recuadro claro |
| Visor de historias (390) | tarjeta de 366px, pieza 9:16 recortada a 4:5, la página asomando arriba y abajo | pantalla completa, pieza entera, progreso, título, acción y navegación sobre degradado; entrada sólo por opacidad |
| Visor de historias (escritorio) | tarjeta con la imagen recortada | marco 9:16 centrado |
| Navegación de historias | sólo botones | más tocar el tercio izquierdo/derecho de la pieza y las flechas del teclado; el foco ya no se pierde al pasar de historia |
| Carga de historias | hueco negro | brillo de carga hasta que la pieza llega |
| Checkout: total y «Confirmar pedido» | con tres direcciones guardadas el botón quedaba ~1.100px debajo de «Datos de entrega» y el total fuera de pantalla | barra fija sobre la navegación con el total y el botón mientras se recorre el formulario; al final vuelve a su lugar. Mismo orden del DOM, mismo botón, mismo total |
| Línea del carrito (390) | dos filas: nombre; luego cantidad e importe | foto a la izquierda, nombre y cantidad al centro, importe arriba a la derecha |
| Mínimo de delivery alcanzado | barra llena en dorado | marca de listo y el mensaje (el dorado se conserva) |
| Delivery / Retiro | la opción elegida apenas se distinguía | control segmentado con la elegida en rojo |
| Resumen del pedido | total con el mismo peso que el resto | total destacado, cifras tabulares |
| Carrito escritorio | la lista quedaba arriba mientras se recorría el formulario | la lista acompaña el scroll |
| Ficha | «Observación (opcional)» en dos renglones; stock desalineado | un renglón; disponibilidad en pastilla alineada al precio |
| Agregar al carrito | ya existía el aviso en el carrito flotante | el carrito flotante, además, da un pequeño salto |
| Foco de teclado | dispar | anillo visible coherente en toda la vidriera |

Reglas que se mantuvieron: todo control táctil mide 44px o más; no hay blur
nuevo, capas fijas fuera de la barra del checkout ni animaciones permanentes;
con `prefers-reduced-motion` no hay movimiento nuevo; el panel del negocio y el
del repartidor no se tocan.

**El total de la barra del checkout** lo escribe `renderOrderSummary` en
`data-checkout-total` con el mismo `total` de la fila «Total» y el CSS lo pinta
con `attr()`: no es texto del DOM ni parte del nombre del botón, así que no se
duplica para lectores de pantalla ni para búsquedas por texto, y no hay ningún
cálculo nuevo.

**Imágenes:** la tarjeta de receta queda en `assets/promos/` sin referencias y
marcada `RETIRADA` en `docs/catalog/promo-image-manifest.json`. No se agregó
ninguna imagen nueva al repo.

## Contratos existentes que la capa respeta

Ninguna prueba previa se reescribió. Cada uno lo fija un spec:
brillo de estante (sin `box-shadow` propio en tarjetas, `catalog-card-glow`),
presupuesto de columnas ≥250px (`premium-storefront`), aviso de precio
pendiente a 14px y títulos largos sin recorte (`catalog-real-content`), alto de
renglón del título constante (`catalog-polish`), techo de alto de la home en
tablet (`taba2-brand-home`).

## Identidad de release

`la-taba-runtime-v162-catalogo-vitrina-neuquen` → `la-taba-runtime-v163-ux-premium-storefront`,
CSS `?v=81` → `?v=82` y `app.js?v=53` → `?v=54`, con `release-identity.json`
re-firmado y `scripts/preflight-staging-package.mjs` alineado.

## Conflicto previsto con Mercado Pago (PR #151)

Rama `feature/mp-commercial-onboarding-20261024` (`eade6022`), misma base
`7d473aa3`. Ensayado con `git merge-tree` sin tocar ningún worktree
(`node artifacts/ux-premium-20261024/tools/ensayar-fusion-mp.mjs`):

| Archivo | UX | Mercado Pago |
|---|---|---|
| `sw.js` (`CACHE_NAME`) | `v163-ux-premium-storefront` | `v162-mp-commercial-onboarding` |
| `scripts/preflight-staging-package.mjs` (`ESPERADO`) | `?v=54`, `?v=82`, `v163-…` | `?v=53`, `?v=81`, `v162-…` |
| `release-identity.json` | digest de UX | digest de MP |

No hay ningún otro archivo en común: los 28 de Mercado Pago (panel, scripts de
producción, docs) y los de esta rama no se cruzan. GLM y Mercado Pago usaron
los dos el número `v162` con nombres distintos.

Resolución comprobada en el ensayo: tomar los `?v=` de UX (Mercado Pago no
cambió ninguno), poner un `CACHE_NAME` nuevo y mayor que ambos (el ensayo usa
`la-taba-runtime-v164-ux-premium-mp-onboarding`) en `sw.js` y en el preflight, y
re-firmar con `node scripts/check-release-identity.mjs --write` sobre el árbol
fusionado. El ensayo da 218 archivos precacheados y la identidad coherente.
Después hay que correr `npm run check`, `npm test` y la e2e sobre la fusión: el
ensayo sólo prueba la identidad.

**Ya existe una integración de otra sesión**: `integration/taba-unified-20261024`
(en el remoto, punta `ed227273`; local `747f9999` en otro worktree) fusionó esta rama **hasta `c8f05a95`** con
Mercado Pago, con `CACHE_NAME` `v164-unified-commercial`. Esta rama avanzó
después (`e2d93455` combos y capturas, `923c8893` higiene de
`tools/e2e-shard.sh`, que en `c8f05a95` hace fallar `npm run check`). Esa
integración tiene que traer estos commits y volver a firmar la identidad
(nuevo `CACHE_NAME`, p. ej. `v165`) antes de darse por buena.

## Pruebas

- `tests/e2e/ux-premium-storefront.spec.mjs` (7 pruebas, también en WebKit
  móvil): visor a pantalla completa y 9:16 en escritorio, navegación por toque y
  flechas con foco conservado; catálogo móvil con precio y botón sin scrollear,
  título y orden en un renglón, sin desborde de 320 a 412px; carrito en dos
  renglones; **recorrido completo por toques en la vitrina con fotos reales**
  (categoría → ficha con foto real → carrito → barra de total → pedido
  confirmado, y el banner de Andes Origen con la foto autorizada); y el
  **catálogo por el camino productivo** con Supabase simulado.
- `tests/github-pages.test.mjs`: la hoja nueva está en el precache.

## Resultados (2026-10-24, en esta PC, sobre `923c8893`)

| Compuerta | Resultado |
|---|---|
| `npm run check` | verde |
| `npm test` | **3193/3193** |
| `npm run migrations:validate` | revisión estática aprobada (sin cambios de migraciones) |
| `npm run catalog:release:validate` | no corre en local: pide `TABA_CATALOG_FILE` (catálogo real); esta rama no toca catálogo |
| e2e Chromium (599, 12 lotes) | **593 pasadas, 6 omitidas, 0 rojas** · 12/12 lotes con salida 0 |
| e2e WebKit móvil (172, 8 lotes) | **171 pasadas, 1 omitida, 0 rojas** · 8/8 lotes con salida 0 |
| e2e WebKit recuperación (71, 4 lotes) | **71 pasadas, 0 rojas** · 4/4 lotes con salida 0 |

Se corrió en lotes (`--shard`), uno por vez, con un worker y puertos propios
(`artifacts/ux-premium-20261024/tools/e2e-shard.sh`); el registro de cada lote
y la memoria libre están en `artifacts/ux-premium-20261024/e2e/resumen.txt`.

Repeticiones, todas registradas en `resumen.txt` y sin ocultar ningún intento:

- Chromium lotes 6 y 7: la primera vez dieron 3 rojas (`launch-ux-checkout-reorder` «PROFILE HUNG», `mapa-fuera-del-arranque` y `operational-hardening`, las dos de mapa) mientras otra sesión corría su propia e2e en paralelo. Pasaron aisladas y los **dos lotes completos** se repitieron en verde.
- WebKit lote 6: las 34 pruebas pasaron, pero Playwright quedó colgado al cerrar WebKit y lo cortó mi límite de tiempo; repetido completo con salida 0.
- WebKit recuperación lote 2: un intento cortado por mi propio límite de 145 s y otro con 16/16 pasadas pero salida 1 porque el proceso de WebKit no terminó («worker-0 process did not exit»); el tercero dio 16/16 con salida 0.

Esos cuelgues al cerrar son el problema de WebKit en Windows que ya describe `playwright.config.mjs`.

Omitidas por el propio suite: 3 de gestos táctiles nativos (sólo WebKit
móvil), 3 fiscales que requieren una base de datos local real
(`order-fiscal-real-db`) y 1 de catálogo que en WebKit se declara omitida.

Capturas: `artifacts/ux-premium-20261024/comparacion/` (11 pares WebP
versionados). Las PNG crudas se regeneran con
`ETAPA=antes|despues node artifacts/ux-premium-20261024/tools/capturas.mjs`
(servidor en 8231) y no se versionan por peso.

## Pendientes

- Los 10 SKU sin foto siguen con el placeholder honesto de TABA.
- Re-integrar estos commits en `integration/taba-unified-20261024` (ver arriba).
- El aviso «Modo demostración» cuelga de la barra y, al scrollear, pasa por
  encima del contenido (diseño existente, sólo en demo; no toma toques).
