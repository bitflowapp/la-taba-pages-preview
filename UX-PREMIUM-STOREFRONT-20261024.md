# Vidriera del cliente: rediseño UX/UI — 2026-10-24

Rama: `feature/ux-premium-storefront-20261024`, creada desde `ec4962e1`
(`feature/catalog-pricing-images-20261024`, vitrina Neuquén de GLM con 42 fotos
reales sobre 52 SKU). Los commits de GLM siguen intactos debajo de los de esta
rama. Estado: **sólo local**. Sin push, sin merge y sin publicar.

## Cómo verlo

```powershell
node scripts/realtime-relay.mjs 8231
```

| Qué | URL |
|---|---|
| Vitrina Neuquén (fotos reales) | <http://localhost:8231/?reset=1&demo=1&vitrina=neuquen20261024> |
| Demo aprobado, con historias y combos | <http://localhost:8231/?reset=1&demo=1> |
| Antes y después lado a lado | `artifacts/ux-premium-20261024/comparacion/index.html` |

## Qué cambió

Todo vive en una sola capa nueva, `styles/ux-premium.css`, que se carga al
final de la cascada, y en un cambio chico del visor de historias
(`js/ui.js` y `js/app.js`). No hay componentes nuevos ni textos nuevos, y no se
tocaron precios, stock, pedidos, pagos ni datos de catálogo. Cada sección de la
hoja dice qué medición la motivó.

| Superficie | Antes (medido) | Después |
|---|---|---|
| Tarjeta del catálogo (390) | 384px de alto, foto de 143px; 2 productos por pantalla y **ningún precio** sin scrollear | ~300px, foto de 159px a ras; precio y «Agregar» del primer renglón visibles sin scrollear |
| Controles del catálogo (390) | chips de 54px, buscador de 52px y orden de 60px en una fila propia | chips de 44px, buscador de 48px, orden de 44px al lado del título (si el filtro de producción está visible, se apilan como antes) |
| Pastilla «Recomendado» | tapaba la base de la foto | esquina superior izquierda, más chica |
| Catálogo escritorio (1280) | tarjeta de 600px de alto con mucho aire | mismo presupuesto de columnas (≥250px, lo fija `premium-storefront.spec`), tarjeta compacta de ~575px con foto cuadrada |
| Home escritorio (1280) | 1060px de ancho con 110px de margen por lado; rieles de 4; un riel de 3 tarjetas las estiraba a 316px; un combo solo ocupaba el renglón entero | hasta 1400px; rieles de 3 en tablet, 4 desde 960, 5 desde 1100 y 6 desde 1500, siempre con tarjetas parejas; combos en grilla con ancho de tarjeta (en tablet siguen en carrusel) |
| Visor de historias (390) | tarjeta de 366px, pieza 9:16 recortada a 4:5, la página asomando arriba y abajo | pantalla completa, pieza entera, progreso, título, acción y navegación sobre degradado |
| Visor de historias (escritorio) | tarjeta con la imagen recortada | marco 9:16 centrado |
| Navegación de historias | sólo botones | más tocar el tercio izquierdo/derecho de la pieza y las flechas del teclado; el foco ya no se pierde al pasar de historia |
| Carga de historias | hueco negro | brillo de carga hasta que la pieza llega |
| Línea del carrito (390) | dos filas: nombre; luego cantidad e importe | foto a la izquierda, nombre y cantidad al centro, importe arriba a la derecha |
| Mínimo de delivery alcanzado | barra llena en dorado | marca de listo y el mensaje (el dorado se conserva) |
| Delivery / Retiro | la opción elegida apenas se distinguía | control segmentado con la elegida en rojo |
| Resumen del pedido | total con el mismo peso que el resto | total destacado, cifras tabulares |
| Carrito escritorio | la lista quedaba arriba mientras se recorría el formulario | la lista acompaña el scroll |
| Ficha | «Observación (opcional)» en dos renglones; stock desalineado | un renglón; disponibilidad en pastilla alineada al precio |
| Agregar al carrito | ya existía el aviso en el carrito flotante | el carrito flotante, además, da un pequeño salto |
| Foco de teclado | dispar | anillo visible coherente en toda la vidriera |

Reglas que se mantuvieron: todo control táctil mide 44px o más; no hay blur
nuevo, capas fijas ni animaciones permanentes; con `prefers-reduced-motion` no
hay movimiento nuevo; el panel del negocio y el del repartidor no se tocan.

## Identidad de release

Cambian archivos del precache, así que la identidad rota:
`la-taba-runtime-v162-catalogo-vitrina-neuquen` → `la-taba-runtime-v163-ux-premium-storefront`,
CSS `?v=81` → `?v=82` y `app.js?v=53` → `?v=54`, con `release-identity.json`
re-firmado y `scripts/preflight-staging-package.mjs` alineado (el mismo
procedimiento que siguió GLM en `ec4962e1`).

También se corrigió un fallo que ya traía `ec4962e1`:
`VITRINA-VISUAL-NEUQUEN-20261024.md` tenía la ruta absoluta del worktree y
`npm run check` fallaba en la higiene de release.

## Pruebas

Ver la sección «Resultados» al final.

- `tests/e2e/ux-premium-storefront.spec.mjs` (nuevo): el visor ocupa el
  teléfono, es 9:16 centrado en escritorio, se navega tocando y con las flechas,
  conserva el foco; en el catálogo móvil, precio y botón se ven sin scrollear,
  título y orden comparten renglón, no hay desborde horizontal entre 320 y
  412px; la línea del carrito tiene dos renglones.
- `tests/github-pages.test.mjs`: la hoja nueva está en el precache.

## Pendientes y observaciones

- **Banner «Andes Origen» (home de la vitrina):** la imagen es una pieza de
  receta («Ricotta casera… Receta de Tofi Quesada»), no una foto de producto.
  No se reemplazó: es un activo con su propia cadena de derechos y la regla es
  no cambiar imágenes auditadas sin justificación. Hay que decidirlo.
- Los 10 SKU sin foto siguen con el placeholder honesto de TABA (sin cambios).
- Checkout en el teléfono: el total y «Confirmar pedido» quedan debajo de la
  lista de direcciones. Se evaluó una barra fija de confirmación, pero tocaba el
  orden que fija `launch-ux-checkout-reorder` y quedó fuera de este alcance.
- La suite e2e completa (Chromium y WebKit móvil) tarda más de una hora; ver
  «Resultados» para qué se corrió en esta máquina.

## Resultados (2026-10-24, en esta PC)

| Compuerta | Resultado |
|---|---|
| `npm run check` | verde (incluye higiene, identidad de release y precache) |
| `npm test` | **3193/3193** |
| `npm run migrations:validate` | revisión estática aprobada (sin cambios de migraciones) |
| `npm run catalog:release:validate` | no corre en local: pide `TABA_CATALOG_FILE` (catálogo real); esta rama no toca catálogo |
| `tests/e2e/ux-premium-storefront.spec.mjs` (nuevo, Chromium) | 5/5 |
| 28 specs relacionados (home, historias, catálogo, checkout, góndola, combos, campañas, motion), Chromium | 250 pasadas y 8 rojas en la primera corrida, todas por esta capa; corregidas respetando cada contrato y vueltas a correr en verde |
| Suite e2e completa, Chromium (597) | **cortada por falta de memoria del sistema** tras 269 pasadas y 0 rojas; no se relanzó |
| WebKit móvil | no corrido en esta PC |

Capturas: `artifacts/ux-premium-20261024/comparacion/` (WebP versionados). Las
PNG crudas de `capturas/antes` y `capturas/despues` se regeneran con
`ETAPA=antes|despues node artifacts/ux-premium-20261024/tools/capturas.mjs`
(servidor en 8231) y no se versionan por peso (~55 MB cada juego).

Para cerrar antes de integrar: correr la suite e2e completa (Chromium y los
dos proyectos WebKit) en CI o en una máquina con memoria libre.
