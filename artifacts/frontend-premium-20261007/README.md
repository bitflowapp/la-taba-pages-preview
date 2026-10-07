# LA TABA · frontend premium · 07/10/2026

El catálogo de escritorio aprovecha más ancho, mantiene tarjetas grandes y concentra título, cantidad y orden en una cabecera. Las categorías incorporan vidrio rojo, respuesta al arrastre y un spring corto. El fondo conserva la intensidad roja con luces radiales orgánicas y ruido casi imperceptible.

**Candidato listo para revisión visual. Sin merge ni deploy.** La producción inspeccionada era main `cd26834b25909a3fbf6b5133af7b70c39a35fc2d`, runtime v144. El candidato usa v145. El SHA final se encuentra en el HEAD del PR y en el reporte final entregado al usuario.

## Comparar y reproducir

- Abrir [comparison.html](comparison.html): selector de vista, resolución, motor y deslizador antes/después.
- [Antes, desktop 1920](before/chromium/1920x1080-todas.webp) · [Después, desktop 1920](after/chromium/1920x1080-todas.webp).
- [Antes, móvil 390](before/chromium/390x844-todas.webp) · [Después, móvil 390](after/chromium/390x844-todas.webp).
- [Video desktop](motion/desktop-categories.mp4) · [Video touch Chromium](motion/mobile-touch.mp4). Los WebM originales también están en motion/.
- 196 capturas de matriz: 7 vistas × 7 resoluciones × 2 motores × antes/después. Otras 4 capturas inspeccionan producción de sólo lectura. Imágenes WebP sin pérdida.
- Vistas: Home, Todas, Gaseosas, Energizantes, Cervezas, Isotónicas y carrito. Resoluciones: 390×844, 430×932, 1366×768, 1440×900, 1536×864, 1920×1080, 2560×1440.

Las capturas usan la app real y el snapshot público de 51 productos de `tests/fixtures/catalog-live.json`, con sus fotos, precios, stock y campañas publicadas. El backend se simula para fijar las mismas condiciones en ambas versiones; no se alteró producción ni se hicieron pedidos/pagos. Las escenas de campaña se llevan a su final sólo para la captura estática. Los videos conservan el movimiento real.

## Distribución comprobada

| Viewport | Columnas antes → después | Ancho de tarjeta | Ancho de catálogo |
|---|---|---|---|
| 390×844 | 2 → 2 | 173 → 173 px | 362 → 362 px |
| 430×932 | 2 → 2 | 193 → 193 px | 402 → 402 px |
| 1366×768 | 5 → 4 | 215 → 293 px | 1140 → 1244 px |
| 1440×900 | 5 → 4 | 215 → 310 px | 1140 → 1314 px |
| 1536×864 | 5 → 5 | 215 → 262 px | 1140 → 1404 px |
| 1920×1080 | 4 → 5 | 273 → 317 px | 1140 → 1680 px |
| 2560×1440 | 4 → 5 | 273 → 317 px | 1140 → 1680 px |

Cuatro columnas amplias en 1366/1440; cinco desde 1536 cuando caben tarjetas de al menos 250px. El mínimo de tarjeta y el ancho disponible calculan la grilla; no es un repeat(5) fijo. Se probaron también 768px y rotaciones/resize. Fotos ligeramente apaisadas en escritorio: la primera fila y su botón de agregar entran a 1366×768. El layout móvil conserva ancho de tarjeta y dos columnas.

## Material y motion

- Escala magnética máxima 1.038, elevación hasta 1.7px y atracción vecina hasta 2.6px. Spring amortiguado, sin rebote caricaturesco; se detiene al quedar quieto.
- Touch y trackpad conservan el scroll nativo. El mouse tiene arrastre e inercia acotada. La rueda vertical no se intercepta. Flechas/Home/End navegan por teclado y Enter/Space activan.
- El snap se pausa durante la transformación y vuelve como proximity al asentarse. Esto evita que el snap persiga la geometría animada. Una guarda específica bloquea el click de un arrastre y se reinicia en el siguiente toque intencional.
- Geometría leída al empezar; frames escriben transform y la opacidad del reflejo. No se animan width/height/top/left. Sin will-change permanente ni blur en las tarjetas. Sólo la categoría activa puede usar backdrop blur de 8px, con fallback opaco y sin blur en modo ligero.
- Si un frame llega más de 90ms tarde, se retira temporalmente el magnetismo: el scroll nativo continúa y el target vuelve estable. Reduced motion desactiva magnetismo y springs; se verificó tanto al arrancar como al cambiar la preferencia con la app abierta.
- Tres luces estáticas con falloff a transparencia antes del límite de pintado de 1600px. Noise estático de 64×64 y 2357 bytes, alfa 1–3/255. Sin grandes capas de blur.
- Refinamientos de radios, encuadre, fondos, gutters, favorito, ordenar y press/release del botón de agregar. Se conserva el feedback existente del carrito.

## Verificación

- `npm run check`: PASS, incluida identidad de release, precache, cadena de CSS y escaneo de secretos.
- `npm test`: **2903/2903 PASS**. [Log](unit-tests-final.log).
- Regresión de navegador seleccionada: **159 PASS, 1 omisión existente, 0 fallas, 0 reintentos**. [Log](regression-tests.log). Catálogo, campañas, carrito persistente, checkout, entry/handoff de Mercado Pago, cuenta, tracking, instalación PWA y worker activo con 404/429/503, HTML falso, red colgada y dos pestañas.
- Categorías: **27 PASS y 5 omisiones explícitas por capacidades del driver**. [Log](category-tests.log). Arrastre lento/rápido/ida-vuelta, release entre píldoras, click posterior, rueda horizontal/vertical, extremos por teclado, selección repetida, identidad/geometría de nodos sin flicker, resize, reduced motion y touch nativo en Chromium.
- Desktop final: **4/4 PASS**, también el botón de agregar dentro del primer viewport. [Log](desktop-final-retest.log).

Las 5 omisiones del driver son tres casos de inyección de pan táctil nativo fuera de Chromium móvil, y mouse/rueda en WebKit móvil. Playwright no permite mouse.wheel en WebKit móvil. El mouse y la rueda se verifican en WebKit desktop; los taps táctiles, la selección, el carrito, el teclado y los cambios de tamaño se verifican en WebKit móvil. **El pan físico de Safari en un iPhone real queda sin certificar.** La omisión de la suite previa es su medición de brillo durante scroll continuo, ya excluida en WebKit para Windows; sus restantes controles de brillo pasaron.

## Performance antes/después

Medición definitiva en [technical/performance-paired.json](technical/performance-paired.json): un solo navegador/contexto, sin otras suites activas, tres muestras de scroll vertical de 1.2s (mediana del p95) y una de categorías de 1.2s. El benchmark normaliza el alto a 900px, excepto 2560×1440; las capturas y el retest responsive usan los tamaños exactos pedidos. Se guardan frames, máximos, CLS, long tasks y contadores de layout/estilo de Chromium.

| Motor | Ancho | p95 vertical antes → después | p95 categorías antes → después |
|---|---|---|---|
| chromium | 390 | 16.8 → 16.7 ms | 16.7 → 16.7 ms |
| chromium | 430 | 16.7 → 16.8 ms | 16.7 → 16.8 ms |
| chromium | 1366 | 16.7 → 16.7 ms | 16.8 → 16.8 ms |
| chromium | 1440 | 16.8 → 16.7 ms | 16.7 → 16.8 ms |
| chromium | 1536 | 16.7 → 16.7 ms | 16.8 → 16.8 ms |
| chromium | 1920 | 16.8 → 16.7 ms | 16.8 → 16.7 ms |
| chromium | 2560 | 16.8 → 16.8 ms | 16.8 → 16.7 ms |
| webkit | 390 | 44.0 → 40.0 ms | 36.0 → 41.0 ms |
| webkit | 430 | 46.0 → 41.0 ms | 38.0 → 37.0 ms |
| webkit | 1366 | 111.0 → 87.0 ms | 118.0 → 97.0 ms |
| webkit | 1440 | 112.0 → 91.0 ms | 100.0 → 79.0 ms |
| webkit | 1536 | 121.0 → 100.0 ms | 103.0 → 109.0 ms |
| webkit | 1920 | 118.0 → 119.0 ms | 112.0 → 109.0 ms |
| webkit | 2560 | 198.0 → 197.0 ms | 201.0 → 206.0 ms |

Chromium conserva aproximadamente 60fps (p95 16.7–16.8ms), sin long tasks ni frames >50ms en las muestras verticales; CLS 0 en las muestras verticales y horizontales. WebKit para Windows es lento desde la base: mejora en móvil/escritorio mediano y se mantiene en 1920/2560 dentro de variación pequeña. La muestra horizontal móvil de 390 varía 36→41ms; es una sola muestra, no una certificación física. **PASS de performance significa ausencia de una regresión material en esta comparación, no 60fps certificados en Safari físico.** Los primeros samples exploratorios se guardan aparte en technical/initial-unpaired-samples.json y no son el gate final.

## Aislamiento

No cambió OAuth, autoridad de checkout, payment worker, webhook, seller, activación productiva, Supabase, stock, órdenes, Rider ni Caja Clara. Los únicos cambios en las tres rutas HTML de retorno de pago son el token del stylesheet compartido. Se actualizan v74/CACHE v145, precache y tests/preflight correspondientes para que los assets nuevos arranquen y actualicen offline. La evidencia y herramientas QA no viajan en el paquete web publicado.

## Resultados solicitados

```text
PROJECT_PATH: . (worktree; absolute path is in the external delivery report)
REPOSITORY: bitflowapp/la-taba-pages-preview
BRANCH: feat/frontend-premium-liquid-glass-20261007
SOURCE_MAIN_SHA: cd26834b25909a3fbf6b5133af7b70c39a35fc2d
DESKTOP_REFINEMENT: PASS
LIQUID_GLASS_CATEGORIES: PASS
CATEGORY_MOTION: PASS
RED_AMBIENT_GRADIENT: PASS
PRODUCT_CARDS_REFINEMENT: PASS
MOBILE_REGRESSION: PASS
WEBKIT: PASS
CHROMIUM: PASS
PERFORMANCE: PASS
REDUCED_MOTION: PASS
CHECKOUT_REGRESSION: PASS
MERCADOPAGO_ENTRY_REGRESSION: PASS
BEFORE_EVIDENCE: before/
AFTER_EVIDENCE: after/
MOTION_VIDEO: motion/desktop-categories.mp4, motion/mobile-touch.mp4
READY_FOR_VISUAL_REVIEW: YES
DEPLOYED: false
```

## Repetir

Servir el árbol de main cd26834b en 18240 y el candidato en 18241 con `node scripts/realtime-relay.mjs PORT`. Desde el candidato:

```powershell
node scripts/qa-premium-refinement.mjs before
node scripts/qa-premium-refinement.mjs after
node scripts/qa-premium-motion.mjs
# Medir solo cuando no haya otras suites/navegadores de QA corriendo.
node scripts/qa-premium-performance.mjs
npx playwright test -c playwright.premium.config.mjs
node scripts/qa-premium-gallery.mjs
node scripts/qa-premium-report.mjs
```

La conversión MP4 usa ffmpeg desde los WebM; los originales están conservados. Los scripts de captura generan PNG y la galería los comprime a WebP sin pérdida para mantener evidencia exacta. FINAL_SHA y PR se informan en el cierre y en el reporte externo de entrega.
