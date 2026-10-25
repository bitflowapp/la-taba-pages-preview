# Validación local de la v167 antes de la CI (2026-10-25)

Candidata: `la-taba-runtime-v167-catalog-rights-review` (221 archivos precacheados). Base `5d13b6cf`, más el trabajo de la
otra sesión (`737b14ae`, `76cbb264`, incorporados por cherry-pick conservando autoría) y el refuerzo contra la inyección
en el estilo de la miniatura. #152 (`b070b4ae`, v165) no se tocó.

| Compuerta | Resultado |
|---|---|
| `npm run check` | verde (higiene, grafo de precaché, identidad v167 coherente con 221 archivos, codificación, secretos) |
| `npm test` | **3.226 / 3.226** (`npm-test.log`) |
| Batería adversarial de rutas (24 variantes) | 23 bloqueadas; la que queda pasando es una ruta en el **hash**, que el navegador no envía, a propósito y cubierta por una prueba |
| Batería de inyección en el estilo y proxy de imágenes (6) | 6 bloqueadas |
| Rutas legítimas (Storage, producto, placeholder, vacío, paréntesis) | 0 bloqueadas |
| e2e Chromium · catálogo, historias, derechos, vitrina, búsqueda por categoría | **109 / 109** |
| e2e Chromium · PWA, actualización y Service Worker degradado | **49 / 49** |
| e2e WebKit móvil · `catalog-transformation` | 17 / 17 |
| e2e WebKit móvil · `ux-premium-storefront` | 1 fallo en el primer intento (`:104`, geometría del catálogo); repetido **7 / 7**, no reproduce |
| e2e WebKit móvil · `catalog-polish`, `catalog-runtime-stability`, `catalog-commercial-coverage` | 8 + 1 omitida · 8 · 19 |
| e2e WebKit recuperación · `service-worker-degraded-recovery` | 19 / 19 |
| Regresión nueva (miniatura con comillas) | **roja** sobre `a3ed4b69`, verde con el refuerzo |
| Moto G15 físico · actualización del PWA | la v166 instalada detecta la v167 (el worker queda esperando junto a la caché v166), muestra «Hay una actualización disponible», se activa por toque, **borra la caché v166** y deja sólo la v167 (223 entradas); recarga **sin conexión** con los 52 productos |

La otra sesión corrió además sobre `76cbb264`: `npm test` 3.219/0, unitarias dirigidas 387/0, e2e dirigidas en Chromium 119 + 1 omitida y
WebKit móvil + recuperación 70/70.

Sin cambios en Mercado Pago, OAuth, webhooks, reembolsos, lógica financiera, stock, precios ni pedidos.
