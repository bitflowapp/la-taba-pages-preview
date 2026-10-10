# ROOT_CAUSE — «vi la promoción, quise comprarla y no encontré cómo agregarla»

Fecha de la auditoría: 2026-10-09 · Rama `fix/catalog-promotions-purchase-audit-20261009`
sobre `origin/main` `0b7f5427` (PR #145).

## Veredicto

| Pregunta | Respuesta | Evidencia |
|---|---|---|
| ¿Se reprodujo el síntoma que describió el propietario? | **Sí, el síntoma de cara al cliente.** | La pieza muestra foto y precio vivo (`$ 2.800`) y su **única** acción es «Ver Red Bull →». No hay «Agregar» en la pieza. |
| ¿Hay una falla *funcional* (botón muerto, capa que tapa, evento roto) en producción? | **No encontrada.** | 4 piezas × 3 configuraciones (Chromium 390, WebKit-emulado 390, Chromium 1440), toques en 6 puntos de cada una: 5 de 6 abren la ficha del producto correcto con «Agregar» alcanzable; el sexto (esquina superior derecha, sólo en el teléfono) cae en «Ocultar» (ver CPA-002). El carrito queda con 1 línea y el precio de la fila. |
| ¿Es *la* causa del incidente original? | **No se puede afirmar.** Es la causa más probable y la única reproducible. | El incidente no trae captura, dispositivo ni hora. Se auditaron todas las piezas y todos los productos y no apareció ninguna otra falla de compra. |

## Causa raíz confirmada (diseño, no un error de JavaScript)

`js/campaigns/campaign-engine.js` (antes de esta rama) escribía cada pieza como **un solo `<button class="cmp-hit" data-product-detail>`** con todo adentro: escena, título, precio y un rótulo `«Ver <marca> →»`. Consecuencias medidas:

1. **La acción de la pieza era "mirar", no "comprar".** Tocar cualquier punto abría `showProductModal`; el control de compra vivía recién en la ficha. Comprar lo que la pieza promete costaba **3 toques** (pieza → «Agregar» → carrito) y un cambio de contexto.
2. **En el teléfono el rótulo no parecía un botón.** `styles/campaigns.css` dibuja el pill rojo sólo a partir de 700 px; en la banda del teléfono es texto coral de 13 px (`.cmp-cta`). Una pieza con foto + precio + una línea de texto es indistinguible de un anuncio informativo.
3. **El precio sin acción de compra promete.** El motor decide mostrar la pieza *sólo* si el producto se puede comprar ahora, y la pieza muestra su precio vivo: dice «esto se vende y cuesta tanto» y no ofrece venderlo.

No se puede anidar un botón de compra dentro de un botón de ficha (HTML inválido), por eso no era un parche de una línea: había que separar el botón de la ficha del texto.

## Hipótesis descartadas (con evidencia)

| Hipótesis | Resultado |
|---|---|
| CTA que no responde / ficha que no abre | Descartada: 4 piezas × 3 configuraciones × 5 puntos de toque abren la ficha correcta (60/60) en Chromium móvil y escritorio y en WebKit emulado. |
| Capa visual o `pointer-events` que tapa un control | Descartada: mapa de impactos 16×6 por pieza → 92 % `cta`, 4 % `dismiss`, 0 % otra cosa. Las escenas son `pointer-events: none`. |
| Producto mal vinculado / inexistente / agotado | Descartada: `npm run campaigns:verify-live` contra el catálogo en línea: 3 campañas encendidas → PASS (SKU, marca, variante, capacidad, envase, foto, comprable, elegida por el motor). Las dos apagadas (Heineken, Aperol) no se muestran. |
| Datos de prueba ≠ producción | Descartada para el catálogo: la instantánea del repositorio difiere de producción sólo en el stock de 2 filas (22→23 y 24→20). |
| Safari / WebKit | Sin falla en WebKit emulado de Playwright (iPhone 13). **No se declara Safari físico aprobado**: no hay dispositivo en esta auditoría. |
| Estado desactualizado (PWA / caché) | No reproducible sin el dispositivo. Producción sirve el service worker `v144-mp-production-verification`; `main` ya está en v152 y **no está desplegado**. |

## Hallazgo asociado en la misma superficie (no es el incidente, sí un riesgo real)

El botón de ocultar (44×44 px) invadía la **esquina superior derecha de la foto** del producto en las franjas del teléfono: 14×30 px a 360, 390 y 430 px de ancho. Tocar ahí «Ocultaba el anuncio» durante toda la visita, sin deshacer: quien intentaba tocar la foto de la promoción **perdía la promoción**. Medido con `getBoundingClientRect` en `main` y en la rama (ver `FINDINGS.md`, CPA-002).

## Corrección

- `campaignMarkup` separa **botón de ficha** (capa transparente a pantalla completa, nombre accesible con titular, producto, precio y «Ver …») del **control de compra** (`<button data-add-product data-campaign-add>` / cantidad `data-cart-dec`/`-inc`), hermanos dentro de `.cmp-body`.
- El control pasa por el **mismo camino que la tarjeta** (`runCartAction` → `addToCart`): stock, precio y disponibilidad los decide `cart.js`; el servidor vuelve a decidirlos al confirmar. No hay descuentos visuales ni stock inventado.
- Sin `view.buy` el motor produce exactamente la pieza anterior (rótulo + ficha): el cambio es opt-in y las pruebas lo fijan.
- La banda del teléfono conserva la altura de la puerta editorial (26 px a la vista, 44 al dedo con `::after`), la escena no baja a la leyenda legal (`.cmp-body`), y el botón de ocultar no pisa la foto.

Evidencia visual: `BEFORE_AFTER/`. Video: `VIDEO/`. Pruebas: `TEST_RESULTS.md`.
