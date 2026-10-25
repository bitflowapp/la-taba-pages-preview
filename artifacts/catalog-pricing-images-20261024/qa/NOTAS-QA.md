# NOTAS · QA de vitrina y ficha de propuesta · 2026-10-24

Entorno: **preview local aislado**, servidor `node scripts/realtime-relay.mjs 8231`,
navegador Chromium headless (Playwright), sin ninguna conexión a producción.

Cómo correr:

```sh
# 1) servidor estático del storefront (una sola vez)
node scripts/realtime-relay.mjs 8231 &

# 2) QA (vitrina demo + ficha de propuesta + capturas)
node artifacts/catalog-pricing-images-20261024/qa/qa-vitrina-20261024.mjs
#   BASE=http://127.0.0.1:8231 (default)
```

Salida: `qa-resultados.json` (números del QA), `capturas/*.png` (6 imágenes),
`ficha/ficha-propuesta.html` (ficha estática de la propuesta, con `<base href>`
hacia el relay para servir las fotos auditadas).

---

## A · Vitrina del storefront (catálogo DEMO del preview)

| Métrica | Resultado |
|---|---|
| Tarjetas en grilla (Ver-más agotado) | 80 |
| Fotos reales cargadas | 0 de 80 (todas placeholder) |
| `overflow` horizontal 390 / 1280 | 0 px / 0 px |
| Ficha (modal) del primer SKU (`red-bull-original-lata-250ml`) | abre, precio `$ 3.576`, foto modal carga |
| Pageerrors | 0 |

**Sobre "0 fotos reales": es el comportamiento previsto, no una falla de esta rama.**
El preview local sirve el catálogo DEMO (`js/beverage-demo-data.js`), que no declara
`imageSha256`/`rightsStatus`. La compuerta de `js/core/product-photo.js`
(`productPhotoIsOfficial`) exige hash + derechos (`PROPIO`, `LICENCIA_COMERCIAL`,
`PERMISO_DOCUMENTADO`): sin esos campos, la tarjeta muestra el placeholder
`beverage-placeholder.svg`. El trabajo de precios/imágenes de esta rama no tocó ningún
archivo del storefront; el QA de A es verificación de superficie (navegación, fichas,
overflow, 0 errores), no de contenido comercial.

La verdadera verificación del contenido comercial es la parte B.

## B · Ficha de propuesta (góndola autoridad + mapa auditado)

Página estática generada por el script (header identificado
«PÁGINA DE TRABAJO · NO es el storefront · nada de esto está publicado») que renderiza:

1. **33 tarjetas** del mapa de imágenes auditado (`docs/catalog/gondola-publica-imagenes.csv`)
   con su foto real, vigente de la autoridad y estado de la propuesta.
2. **Tabla del resto de la góndola**: los 23 SKU con alcohol (detrás de la compuerta
   de licencia de expendio, sin vidriera; los 29 no alcohólicos están todos en las
   33 tarjetas auditadas, incluida la sifón Manaos).

Verificaciones estrictas de B:

| Assert | Resultado |
|---|---|
| Tarjetas renderizadas | 33/33 |
| Archivos de imagen existen en disco | 33/33 |
| Imágenes cargan por el host de assets de la tienda | **33/33** |
| Precio mostrado == vigente `GONDOLA` (sólo los 29 SKUs en góndola) | **29/29** |
| 4 SKUs del mapa fuera de la góndola de 52 | marcados visiblemente «fuera» (ver abajo) |

Consistente además con el QA de imágenes/precios de la propuesta: la ficha muestra los
precios VIGENTES (no los propuestos, que en esta rama son iguales: 0 rebajas) y los
estados `pendiente_aprobacion_comercial`.

## Hallazgos concretos para el dueño

1. **El mapa auditado tiene 4 SKUs fuera de la góndola de 52**
   (`coca-cola-original-botella-pet-500-ml-pack-x12`,
   `coca-cola-zero-botella-pet-500-ml-pack-x12`, `sprite-botella-pet-500-ml-pack-x12`,
   `coca-cola-original-pet-1500ml`). Imagen correcta y con derechos; precio fuera del
   alcance de esta propuesta (son SKUs de la ola retail
   `catalog/gondola-retail-final-proposal.mjs`).
2. En la vitrina DEMO, todo el SKU 250 ml/473 ml de energía (y en general 80 de 80
   tarjetas) usa placeholder; la vidriera con fotos reales sólo existe vía los datos con
   derechos (producción/RLS). No aplica acción de esta rama.
3. El QA oficial `qa:taba2:screenshots` tiene fixture vencido
   (`data-product-detail="red-bull-original-lata-250ml-pack-4"`): pre-existente, no de
   esta rama. La suite completa corrió con `qa:taba2:commercial-screenshots`
   (resultados en `artifacts/taba2-commercial-audit/final/`).

## Resultados de la suite oficial (2026-10-24)

`npm run qa:taba2:commercial-screenshots` terminó **sin incidencias**: 151 capturas
(53,1 MB, sin versionar por diseño — `.gitignore` tiene
`artifacts/taba2-commercial-audit/`) en
`artifacts/taba2-commercial-audit/final/`. Recorrido: home + combos + ficha de combo,
catálogo, búsquedas (con y sin resultado), filtros, ficha normal y ficha sin precio,
carrito + checkout, perfil y seguimiento, 5 retornos de Mercado Pago, 2 dispositivos
reales (iPhone 13 WebView/WebKit, Pixel 7/Chromium), 6 anchos Chromium + 3 WebKit.

Notas del script: `[iphone-13] overflow horizontal: 0px` y `[pixel-7] overflow
horizontal: 0px` — cero pageerrors y cero fallas de siembra en ninguna vista ni motor.

## C · Vitrina Neuquén 2026-10-24 con fotos REALES en el storefront

Complemento de A y B: la góndola autoridad (52 SKU) activa EN el storefront demo vía
`?vitrina=neuquen20261024`, con las fotos verificadas por SKU. Script:
`qa-vitrina-neuquen-20261024.mjs` → `qa-vitrina-neuquen-20261024.json` (54/54 OK),
capturas en `capturas-neuquen/` y página de comparación
`preview/comparacion/antes-y-despues.html` (verificada con
`verificar-comparacion-antes-despues.mjs`: 42 + 10 en grilla, cero imágenes rotas,
cero requests remotas abriéndola `file://`).

| Assert | Resultado |
|---|---|
| Datos: 52 SKU, precio = `precioDeVenta`, 42 fotos + 10 FALBACK honestos, alcohol 18 | OK |
| Góndola visible 390 y 1280 (móvil + desktop), antes y después | 52/52 |
| Imagen por SKU EXACTA (miniatura declarada; sin foto → placeholder propio) | OK |
| Precio DOM == vigente por SKU, en modos después **y** antes | 52×4 |
| Etiqueta +18 SÓLO en alcohólicos; ficha con aviso y disponibilidad | OK |
| Búsqueda «coca» sin ruido; chip Cervezas = su rubro exacto; «Todas» vuelve | OK |
| Carrito (Coca-Cola 2,25 L, no alcohólico): 1 línea, línea y subtotal = vigente | OK |
| Ficha SKU con foto (Gancia Lima Limón) y ficha del sin foto (Quilmes 710) | OK |
| `<img>` con url de otro origen | 0 |
| Fotos decodificadas (naturalWidth > 0) y 10 placeholders pintados | 42 + 10 |
| Pageerrors / respuestas fallidas del propio servidor (4 corridas) | 0 / 0 |
| Overflow horizontal 390 y 1280 (góndola, ficha, carrito) | 0 px |
| Modo antes (`&fotos=antes`): 52/52 placeholder, MISMO mapa de precios | OK |

**Lecciones del armado del QA** (para futuros corredores de storefront con Playwright):

1. `?reset=1` hace que la app lance `window.location.replace()` (limpieza de
   sesión demo): cualquier `page.evaluate` en ese primer documento muere con
   «Execution context was destroyed». Esperar la URL canónica SIN el parámetro
   (`page.waitForURL`) antes de tocar el DOM.
2. El mismo `reclamoGondola` sirve a los dos modos sólo si es consciente del
   modo: en antes/con `&fotos=antes` el resultado ESPERADO es que los 42 SKU
   con foto en datos muestren placeholder; un comparador agnóstico los
   rotula como «malas».
3. El catálogo pagina en lotes (`CATALOG_PAGE_SIZE = 120`): no hace falta
   «Ver más» para una góndola de 52.

## Capturas

- `01-home-390.png`, `02-catalogo-390.png`, `04-catalogo-desktop.png` — superficie
  storefront demo (lo que un QA de UI vería en un preview).
- `03-ficha-producto.png` — modal de producto demo con precio visible.
- `05-ficha-propuesta-completa.png` — captura completa de página de la ficha de
  propuesta (33 tarjetas con estado + tabla del resto).
