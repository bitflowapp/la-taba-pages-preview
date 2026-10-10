# FINDINGS — auditoría comercial del catálogo y las promociones

Auditoría: 2026-10-09 · Producción `https://la-taba.pages.dev/` (sólo lectura) · Código:
`origin/main` `0b7f5427` → rama `fix/catalog-promotions-purchase-audit-20261009`.

**Cobertura real, no muestra.**

| Qué | Cuántos | Cómo |
|---|---|---|
| Productos publicados y visibles | **51 / 51** | `PRODUCT_AUDIT.csv`: tarjeta, foto (maestra + miniatura, HTTP), precio, ficha desde la foto y desde el nombre, agregar, carrito. Chromium 390×844, WebKit 390×844 (emulado), Chromium 1440×900 en producción; Chromium y WebKit 390×844 sobre la rama. |
| Piezas promocionales observadas | **4** (3 campañas × superficies) + 2 apagadas + 7 combos + 5 construcciones editoriales | `PROMOTION_AUDIT.csv`. Mapa de impactos 16×6, 6 puntos de toque, compra, carrito. |
| Categorías | **14 / 14** pastillas | `raw/navigation-*.json`: cantidad esperada vs mostrada por rubro. |
| Búsquedas / orden / favoritos / volver del carrito | 15 / 3 / 1 / 1 | ídem |

No hay dispositivo físico: **Safari/iPhone físico NO se declara aprobado**. WebKit = el motor de
Playwright con el descriptor «iPhone 13».

## Resumen

| Severidad | Encontrados | Corregidos | Pendientes |
|---|---|---|---|
| P0 (cobro, pedido, seguridad, datos) | 0 | 0 | 0 |
| P1 (impide comprar / pérdida comercial importante) | 1 | 1 | 0 |
| P2 (fricción, confusión, falla parcial) | 2 | 2 | 0 |
| P3 (visual / detalle) | 6 | 1 | 5 (datos, migración o decisión comercial) |

Productos con error funcional: **0 / 51**. Piezas con la falla de compra: **4 / 4** (corregidas).

---

## CPA-001 · P1 · La pieza que promete un producto con precio no ofrece comprarlo

- **Afecta:** `red-bull-cold-can` (banda de la home), `coca-cola-product-drop` (franja y grilla «Gaseosas»), `aquarius-ice-reveal` (grilla «Todas»). Las 3 campañas encendidas.
- **Pasos:** abrir la home en un teléfono → ver la banda «Red Bull · Fría y lista para llevar · $ 2.800 · Ver Red Bull →» → buscar cómo agregarla.
- **Causa raíz (confirmada):** la pieza era un único `<button data-product-detail>` con foto, título, precio y un rótulo «Ver …». Su acción era abrir la ficha; el «Agregar» vivía recién ahí. En el teléfono el rótulo es texto coral de 13 px, sin forma de botón. Ver `ROOT_CAUSE.md`.
- **Evidencia:** `BEFORE_AFTER/antes-*.png`, `VIDEO/antes.webm`; `PROMOTION_AUDIT.csv` (`agregar_en_la_pieza_prod = false`, `toques_hasta_el_carrito_prod = 3`).
- **Impacto comercial:** cada visita a la home pasa por una pieza que muestra un precio y exige dos toques y un cambio de pantalla para cumplirlo; en el teléfono la acción no parece una acción.
- **Corrección:** control de compra real en la pieza (`Agregar` → cantidad), mismo camino que la tarjeta; el botón de la ficha deja de envolver el texto. La banda conserva la altura de la puerta editorial.
- **Estado:** **corregido** (commit `37eccd33`).
- **Regresión:** `tests/campaigns.test.mjs` (4 pruebas de marcado: botones hermanos, cantidad, escape, fallback sin compra) · `tests/e2e/catalog-commercial-coverage.spec.mjs` («campaña «…»: la pieza compra el producto correcto con un toque…» ×3, «el teclado compra sin ratón» ×3, «dos toques seguidos…») · `tests/e2e/campaigns.spec.mjs` actualizado.

## CPA-002 · P2 · «Ocultar» (44×44) pisa la esquina de la foto del producto en las franjas del teléfono

- **Afecta:** `coca-cola-product-drop` y `aquarius-ice-reveal` (franja `home-inline` / grilla) en 360, 390 y 430 px.
- **Pasos:** tocar la esquina superior derecha de la foto de la franja.
- **Causa raíz (confirmada, medida):** la zona del botón de ocultar solapaba **14×30 px** de la foto (`getBoundingClientRect`, `raw/dismiss-overlap.json`). El resultado es «Ocultamos el anuncio» y la promoción no vuelve durante toda la visita (`sessionStorage`), sin deshacer.
- **Impacto:** quien intenta tocar la foto de la promoción puede hacerla desaparecer.
- **Corrección:** la escena de las franjas se corre 16 px (`right: 36px`); solape **0 px** a 360/390/430.
- **Estado:** **corregido**.
- **Regresión:** `catalog-commercial-coverage.spec.mjs` mide que ningún punto del paquete de foto caiga en `[data-campaign-dismiss]`; la geometría la fija `campaigns.spec.mjs`.

## CPA-003 · P2 · Los filtros ofrecen opciones que llevan a una lista vacía

- **Afecta:** el panel de filtros del catálogo en todos los rubros.
- **Pasos:** Catálogo → «Energizantes» → Filtros → Marca → elegir «Brahma» → «Ningún producto coincide con los filtros».
- **Causa raíz (confirmada):** `renderCatalogFilters` calculaba las opciones sobre el catálogo **entero** (`unitStorefrontProducts`), no sobre el rubro mirado. Gaseosas: 29 marcas ofrecidas, 5 con producto; Energizantes: 29 / 3; Mixers: 29 / 2.
- **Impacto:** una opción sin resultado es una puerta que no abre; el cliente arma solo la pantalla vacía.
- **Corrección:** las opciones salen de los productos del rubro (misma definición de rubro que la lista, `productMatchesActiveCategory`); el valor ya aplicado se conserva aunque el rubro no lo tenga, para que el selector no diga «Todas» con una marca puesta.
- **Evidencia:** `raw/navigation-prod-*.json` (29 ofrecidas) vs `raw/navigation-local-*.json` (5 / 3 / 2, `brandsWithNoResult: []`).
- **Estado:** **corregido**.
- **Regresión:** `catalog-commercial-coverage.spec.mjs` («las opciones de marca son las del rubro…»).

## CPA-004 · P3 · Un botón deshabilitado se anuncia como «Agregar … al pedido»

- **Afecta:** las tarjetas sin stock (los 4 packs de cerveza en 0) que no son alcohol «en vidriera»: nombre accesible «Agregar Andes Origen Rubia Pack x6 · 473 ml · Lata al pedido» sobre un botón que dice «No disponible».
- **Causa raíz:** `quickAddControl` sólo distinguía «precio pendiente» y «vidriera de alcohol».
- **Corrección:** el nombre accesible dice «<producto>: no disponible».
- **Estado:** **corregido**. **Regresión:** `catalog-commercial-coverage.spec.mjs` («CADA producto visible…» verifica el estado deshabilitado y su texto).

## CPA-005 · P3 · Datos: la columna `variant` de los packs trae la presentación entera

- **Afecta:** 4 filas (`coca-cola-original-botella-pet-500-ml-pack-x12`, `coca-cola-zero-…-pack-x12`, `fanta-naranja-…-pack-x6`, `sprite-…-pack-x12`): `variant = "Botella PET · 500 ml · Pack x12"`, `subcategory = "Cola"` (el resto va en minúsculas con guiones: `cola`).
- **Efecto visible hoy:** ninguno — la tarjeta normaliza («Pack x12 · 500 ml»). Riesgo: cualquier superficie que agrupe por `variant`/`subcategory` los trataría como valores distintos.
- **Estado:** **pendiente de aprobación** (dato comercial, no frontend).

## CPA-006 · P3 · 401 en consola al abrir el carrito sin sesión (`get_mercadopago_checkout_availability`)

- **Causa:** decisión documentada en `supabase_order_repository.js`: la RPC está concedida sólo a `authenticated`, y preguntar no crea sesión (evita una fila anónima permanente por visita). Sin sesión, Mercado Pago figura «no disponible» hasta que exista una.
- **Efecto:** ruido en consola; nada visible. **No se tocó** (Mercado Pago intacto).
- **Estado:** pendiente de migración (conceder la RPC a `anon`), con su propia compuerta.

## CPA-007 · P3 · Precarga de alta prioridad de una banda que no se pinta

- `index.html` precarga `assets/promos/cervezas-heineken-band.webp` en el teléfono; mientras las cervezas no se pueden comprar la puerta no se pinta y el navegador avisa «preloaded but not used». Un pedido de alta prioridad (~35 KB) por visita.
- **Estado:** pendiente: tocar el precache exige mover tres lugares y `tests/home-hero-preload.test.mjs`.

## CPA-008 · P3 · Miniaturas de 400 px en pantallas 3×

- 102/102 imágenes cargan (HTTP 200); masters 1000×1000, miniaturas 400×400. La tarjeta pinta ~154 px: nítido en 2×, algo blando en 3×. (Una medición ingenua dio «130 px»: es el ancho lógico de `srcset`, no el del archivo.)
- **Estado:** recomendación, sin urgencia.

## CPA-009 · P3 · El orden sólo ofrece «Menor precio»

- Opciones: Recomendados · Menor precio · Destacados. No hay «Mayor precio». **Estado:** decisión de producto; no se tocó.

---

## Observaciones (no son defectos)

- **CPA-010 · Producción está atrasada respecto de `main`.** Sirve el service worker `v144-mp-production-verification` (linaje PR #141); `main` está en v152 (PR #145: premium, tracking y casco). Nada de esta auditoría ni del PR #145 está desplegado. No se pudo atar producción a un SHA exacto.
- **CPA-011 · Alcohol visible, no vendible.** 17 de 51 productos tienen foto y precio y «Próximamente» (13) / «No disponible» (4). Es honesto y coincide con la política de licencia; ver recomendaciones en `COMMERCIAL_UX_REVIEW.md`.
- **Combos:** los 7 del manifiesto están bloqueados con el catálogo publicado (Imperial/Heineken no existen; Corona y Speed no están a la venta). No se muestran ni ofrecen «Agregar combo». Con un catálogo sintético completo cada uno se cobra a `roundPromotionalPrice(Σ·(1−d))` y el stock es el del componente limitante (`tests/catalog-commercial-coverage.test.mjs`).
- **Carrito, favoritos, volver, recarga:** sin hallazgos (`raw/navigation-*.json`). Dos pestañas y persistencia: `cart-two-tabs.spec` y `production-cart-persistence.spec` (ver `TEST_RESULTS.md`).
