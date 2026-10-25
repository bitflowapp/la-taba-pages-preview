# WebKit Linux · actualización PWA y recarga sin red: diagnóstico

| corrida (GitHub Actions) | variante | resultado |
| --- | --- | --- |
| 40140930475 (ed227273, v164) | reset a mitad de pedido (método original) | FALLA, cachés `[]` |
| 40146286339 (v165) | reset, contexto efímero ×4 | 3 verdes / 1 falla (cachés `[]`, aserciones de libsoup) |
| 40146286339 | `context.setOffline(true)` ×4 | 4 fallas con la caché v165 completa (220) y el worker controlando: WebKit falla la navegación sin consultar al worker |
| 40146286339 | contexto persistente ×4 | 4 fallas al instalar la baseline v153 (variante no soportada por el arnés) |
| 40146680494 (v165) | **origen cerrado (conexión rechazada) ×16** | **16 verdes**, 0 líneas de libsoup |
| 40146680494 | control con reset ×8 | 6 verdes / 2 fallas (libsoup 5 y 15, cachés `[]`) |

Secuencia de la falla (run 40146286339, `diag ephemeral 3`): `offline reload` comienza a las 00:21:25.038;
a las 00:21:25.069 el proceso de red de WebKitGTK emite `libsoup-CRITICAL: soup_session_feature_request_queued`
y `g_object_ref: assertion 'G_IS_OBJECT'`; desde ahí cada carga termina en
`WebLoaderStrategy::internallyFailedLoadTimerFired` («WebKit encountered an internal error») y CacheStorage, que en un
contexto efímero vive en ese proceso, se lee vacía. Las corridas verdes no tienen esas líneas.

Conclusión: defecto del motor (WebKitGTK/libsoup, Linux), disparado por la forma de simular la falta de red. La app no
usa CacheStorage y el worker sólo borra cachés de otro nombre. Corrección en `scripts/qa-final-pwa-update.mjs`: sin
conexión = listener del origen cerrado. Las aserciones (catálogo visible, glass, CSS premium desde la caché) no cambian.
Probabilidad de 0/16 por azar con la tasa medida de falla del método viejo (3/12): 0,75^16 ≈ 1 %.
