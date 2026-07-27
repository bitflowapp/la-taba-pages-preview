# Correcciones aplicadas

- Se añadió un panel de recuperación server-rendered dentro de `main`, visible hasta que termina el primer `renderAll()`.
- Se añadió `js/startup-recovery.js`, cargado como script clásico antes del módulo, con listeners globales para error y `unhandledrejection`, reintento y reinicio limitado a demo.
- El bootstrap ya no espera reset ni IndexedDB para pintar. El reset se ejecuta después del primer render y elimina sus parámetros antes de recargar.
- La apertura de IndexedDB tiene timeout de 2,5 segundos.
- Si IndexedDB falla, el repositorio sandbox continúa con snapshot en memoria y sincronización entre pestañas.
- El reset sandbox también completa en memoria si la base está ocupada o no se puede limpiar.
- `persist()` sanea fallos de serialización de estados viejos sin impedir el arranque.
- Service worker actualizado a `v30`, con `startup-recovery.js` en el precache y assets con versión explícita.
- Se agregaron pruebas unitarias y E2E para sesión limpia, estado viejo/vacío, reset, IndexedDB rechazado, módulo fallido y fail-closed productivo.
