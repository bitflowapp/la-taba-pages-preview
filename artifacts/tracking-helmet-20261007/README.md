# Casco unificado · LA TABA · 07/10/2026

Se reutiliza el casco existente de `riderAvatarHelmetSvg`, mediante la misma función de geometría `riderHelmetProfileMarkup`, para reemplazar la moto del mapa. La tarjeta conserva su retrato con cuello; el marcador usa una variante encuadrada del mismo casco dentro de su disco rojo.

Sin cambios de tracking, estados, GPS, cámara, checkout o pagos. Cambios sobre la rama del PR #143; sin deploy.

## Comparar

- 390×844: [antes](before/chromium/390x844-on-the-way.webp) · [después](after/chromium/390x844-on-the-way.webp).
- 430×932: [antes](before/chromium/430x932-on-the-way.webp) · [después](after/chromium/430x932-on-the-way.webp).
- Detalle tarjeta: [antes](before/chromium/390x844-on-the-way-card.webp) · [después](after/chromium/390x844-on-the-way-card.webp).
- Detalle marcador ampliado 5×: [antes](before/chromium/390x844-on-the-way-marker-5x.png) · [después](after/chromium/390x844-on-the-way-marker-5x.png). Ampliación sin interpolación, para examinar los trazos.
- También se capturó WebKit/iPhone emulado en ambos tamaños. Como en la pasada anterior, el host Windows puede omitir el raster de WebGL; no se presenta como certificación de iPhone físico.

Pedidos y GPS son de QA local, con el renderer real. Para comparar sólo iconografía se fija la misma cámara en ambas capturas. BEFORE intercepta exclusivamente los dos archivos visuales desde `f85ca90f`; AFTER usa los archivos modificados. No se modifica el código de cámara para esta comparación.

## Archivos

- `js/map/rider_marker.js`: `riderMapHelmetSvg` comparte los trazos del casco existente; mantiene disco, viewBox y anclaje. Se retira el dibujo de moto y se actualiza la etiqueta accesible.
- `styles/tracking-premium.css`: tarjeta en rojo/blanco, borde/sombra sutil y casco de 40×40 dentro de un contenedor de 46×46. Corrige la proporción anterior de 46×58. Marcador sin aumentar su tamaño de 50×50.
- `tests/map.test.mjs`, `tests/tracking-always-on-map.test.mjs`, `tests/operational-hardening.test.mjs`, `tests/e2e/tracking-arriving.spec.mjs`, `tests/e2e/direct-ordering-growth.spec.mjs`: expectativas y etiqueta accesible actualizadas al casco; se verifica que los trazos compartidos sigan iguales y que la moto no reaparezca.
- `scripts/qa-tracking-helmet.mjs`: captura reproducible, manifiestos y recortes de mapa/tarjeta.
- Bookkeeping de PWA: `styles.css`, `index.html`, `sw.js`, `release-identity.json`, `scripts/preflight-staging-package.mjs`, los tres HTML de retorno de pago y los tests de versión CSS/precache. CSS v76 y CACHE v147 evitan entregar iconografía vieja; la lógica del service worker y de los retornos de pago no cambia.

## Verificación

- Tests de mapa, selector y presentación: 68 PASS. [Log](unit-tests.log).
- PWA, precache e identidad: 21 PASS. [Log](pwa-tests.log).
- [Pruebas de navegador](browser-tests.log): 8 PASS, seguimiento manual/recentrado y geometría responsive/reduced motion, en Chromium y WebKit.
- Manifiestos [antes](before/manifest.json) / [después](after/manifest.json): cero errores de página/overflow, marcador de 50×50, un casco en el mapa, cero motos y cero animaciones infinitas en AFTER.
- Casco blanco sobre rojo: contraste 4.39:1, superior al mínimo de 3:1 para gráficos significativos. No hay imágenes nuevas, downloads, filtros ni animaciones añadidos.

```text
HELMET_ICON_UNIFIED: YES
TRACKING_VISUAL_POLISH: YES
READY_FOR_REVIEW: YES
```
