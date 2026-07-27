# Incidente P0: main vacío en Safari con sesión sandbox existente

Fecha de investigación: 2026-07-27

## Síntoma

En una sesión normal con `?demo=1`, el HTML estático conservaba header y navegación, pero la zona principal quedaba vacía. El mismo patrón podía aparecer al entrar con `reset=1&demo=1`.

## Punto exacto de detención

El shell inicial deja las superficies de catálogo con `hidden` hasta que `js/app.js` ejecuta `bootstrap()` y llama a `renderAll()`. `bootstrap()` esperaba `maybeResetDemoSession()` antes de ese primer render. Ese reset esperaba `clearRelayRoomOnReset()` e `IndexedDB.resetSandbox()`. Si Safari mantenía la base ocupada, demoraba la apertura o el módulo fallaba al importar, no se alcanzaba el render. El `catch` existente solo mostraba un toast; no había un nodo de recuperación visible dentro de `main`.

La sincronización posterior también esperaba la apertura de IndexedDB. Aunque ya existía un fallback en memoria, el límite de apertura no estaba definido y un request sin respuesta podía dejar la inicialización pendiente indefinidamente.

## Causa raíz

La interfaz tenía una dependencia de arranque demasiado fuerte: reset/hidratación/storage precedían al primer render y el único manejo de error era efímero. No fue un problema de catálogo vacío en sí mismo: `mergeCatalogProducts()` ya reconstruía el catálogo base, pero esa lógica no podía ejecutarse si el bootstrap no llegaba a correr.

## Alcance

La corrección está aislada al modo sandbox (`?demo=1`). El modo sin el parámetro sigue resolviendo el repositorio productivo o unavailable y no usa datos locales como fallback.
