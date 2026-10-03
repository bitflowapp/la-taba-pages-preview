# Verificación del preview publicado

URL: https://d6635263.taba2-staging.pages.dev

## Comprobaciones
- OK    la home abre y pinta la marca
- OK    el CSS servido es el del pulido (tokens nuevos aplicados de verdad)
- OK    el catálogo abre con producto real del backend
- OK    el "Agregar" es la píldora nueva y el precio la tipografía nueva
- OK    los filtros abren y aplican
- OK    el orden cambia la grilla
- FALLA el carrito suma — locator.click: Timeout 30000ms exceeded.
Call log:
[2m  - waiting for locator('[data-product-grid] [data-add-product]:not([disabled])').first()[22m
[2m    - locator resolved to <button type="button" class="add-button" aria-label="Agregar Red Bull Energy Drink al pedido" data-add-product="90920a02-e37b-4e1d-b424-e3d02349b47f">…</button>[22m
[2m  - attempting click action[22m
[2m    2 × waiting for element to be visible, enabled and stable[22m
[2m      - element is visible, enabled and stable[22m
[2m      - scrolling into view if needed[22m
[2m      - done scrolling[22m
[2m      - <select data-catalog-filter="alcohol" aria-label="Filtrar por alcohol">…</select> from <div class="catalog-controls">…</div> subtree intercepts pointer events[22m
[2m    - retrying click action[22m
[2m    - waiting 20ms[22m
[2m    - waiting for element to be visible, enabled and stable[22m
[2m    - element is visible, enabled and stable[22m
[2m    - scrolling into view if needed[22m
[2m    - done scrolling[22m
[2m    - <select data-catalog-filter="capacity" aria-label="Filtrar por capacidad">…</select> from <div class="catalog-controls">…</div> subtree intercepts pointer events[22m
[2m  2 × retrying click action[22m
[2m      - waiting 100ms[22m
[2m      - waiting for element to be visible, enabled and stable[22m
[2m      - element is visible, enabled and stable[22m
[2m      - scrolling into view if needed[22m
[2m      - done scrolling[22m
[2m      - <details open="" data-catalog-filters="" data-motion-reveal="section" class="catalog-filters is-motion-visible">…</details> from <div class="catalog-controls">…</div> subtree intercepts pointer events[22m
[2m  10 × retrying click action[22m
[2m       - waiting 500ms[22m
[2m       - waiting for element to be visible, enabled and stable[22m
[2m       - element is visible, enabled and stable[22m
[2m       - scrolling into view if needed[22m
[2m       - done scrolling[22m
[2m       - <select data-catalog-filter="alcohol" aria-label="Filtrar por alcohol">…</select> from <div class="catalog-controls">…</div> subtree intercepts pointer events[22m
[2m     - retrying click action[22m
[2m       - waiting 500ms[22m
[2m       - waiting for element to be visible, enabled and stable[22m
[2m       - element is visible, enabled and stable[22m
[2m       - scrolling into view if needed[22m
[2m       - done scrolling[22m
[2m       - <select data-catalog-filter="capacity" aria-label="Filtrar por capacidad">…</select> from <div class="catalog-controls">…</div> subtree intercepts pointer events[22m
[2m     - retrying click action[22m
[2m       - waiting 500ms[22m
[2m       - waiting for element to be visible, enabled and stable[22m
[2m       - element is visible, enabled and stable[22m
[2m       - scrolling into view if needed[22m
[2m       - done scrolling[22m
[2m       - <details open="" data-catalog-filters="" data-motion-reveal="section" class="catalog-filters is-motion-visible">…</details> from <div class="catalog-controls">…</div> subtree intercepts pointer events[22m
[2m     - retrying click action[22m
[2m       - waiting 500ms[22m
[2m       - waiting for element to be visible, enabled and stable[22m
[2m       - element is visible, enabled and stable[22m
[2m       - scrolling into view if needed[22m
[2m       - done scrolling[22m
[2m       - <details open="" data-catalog-filters="" data-motion-reveal="section" class="catalog-filters is-motion-visible">…</details> from <div class="catalog-controls">…</div> subtree intercepts pointer events[22m
[2m  - retrying click action[22m
[2m    - waiting 500ms[22m
[2m    - waiting for element to be visible, enabled and stable[22m
[2m    - element is visible, enabled and stable[22m
[2m    - scrolling into view if needed[22m
[2m    - done scrolling[22m
[2m    - <select data-catalog-filter="alcohol" aria-label="Filtrar por alcohol">…</select> from <div class="catalog-controls">…</div> subtree intercepts pointer events[22m
[2m  - retrying click action[22m
[2m    - waiting 500ms[22m

- OK    Perfil abre
- OK    el service worker no deja una versión anterior pegada
- OK    recarga en caliente: con el worker ya activo la tienda vuelve entera

## Medido
- marca en la barra: "La Taba"
- tokens vivos: --control-h=48px --radius-control=14px --card-pad=10px
- alto real del buscador: 48px
- tarjetas de producto en el catálogo: 8
- radio del "Agregar": 999px · precio: 18px
- borde izq. plato 23 vs título 23
- filtro de alcohol: 8 -> 2 tarjetas
- orden recomendados="Red Bull Energy Drink" -> menor precio="Speed Unlimited"
- control de Perfil: radio undefined, decoración "undefined"
- worker: registrado=true controlando=true enEspera=false
- cachés en este origen: ["la-taba-runtime-v61-cliente-comercial-mapa-permanente"]
- tras recarga con worker activo: 8 tarjetas

## Red
- peticiones fallidas: 0
- respuestas >=400: 0

## Consola
- errores: 0
