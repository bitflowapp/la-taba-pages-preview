# Vitrina visual Neuquén 2026-10-24 — fotos reales en un catálogo funcional

Branch: `feature/catalog-pricing-images-20261024` · worktree `C:\Users\marco\worktrees\la-taba-catalog-pricing-20261024`
Estado: **local/demo-only**. Nada de esto toca producción, la base comercial ni Supabase; los precios siguen sin aplicar (la propuesta comercial espera la decisión de Walter).

## Cómo abrirlo

Servidor local (si no está corriendo):

```powershell
node scripts/realtime-relay.mjs 8231
```

| Qué mirar | URL |
|---|---|
| **Vitrina con fotos reales (después)** | <http://localhost:8231/?reset=1&demo=1&vitrina=neuquen20261024> |
| **Misma góndola sin fotos (antes)** | <http://localhost:8231/?reset=1&demo=1&vitrina=neuquen20261024&fotos=antes> |
| **Comparación antes/después** (página estática hecha con capturas y fotos reales) | `artifacts/catalog-pricing-images-20261024/preview/comparacion/antes-y-despues.html` |
| Catálogo demo de siempre, sin cambios | <http://localhost:8231/?reset=1&demo=1> |

La bandera es la ÚNICA forma de activar la vitrina: sin `?vitrina=neuquen20261024` la app arranca con el catálogo demo aprobado de siempre, byte a byte igual.

## Qué es la vitrina

La góndola comercial autoridad (52 SKU, `catalog/gondola-neuquen.mjs`) con sus **fotos reales verificadas**, servida en el storefront real (no un mock): buscador, chips de categoría, fichas (modal), favoritos, carrito, +18 en todo lo alcohólico, responsive móvil 390 y desktop 1280.

- **42 SKU con foto de verdad**: 29 del mapa auditado (`docs/catalog/gondola-publica-imagenes.json`) + 13 con manifiesto y cadena sha256 completa (`docs/catalog/image-manifest.json`) — derechos `LICENCIA_COMERCIAL` ref `TABA-AUT-2026-08-001`.
- **10 SKU honestos sin foto** (no hay fuente auditada; NO se publican parecidos): la imagen de la tarjeta es el placeholder propio de TABA con el precio vigente, como cualquier producto recién cargado.
  `quilmes-clasica-lata-473ml`, `quilmes-clasica-lata-473ml-pack-6`, `quilmes-clasica-botella-710ml`, `andes-origen-roja-lata-473ml`, `fernet-1882-750ml`, `gancia-americano-450ml`, `cafayate-torrontes-750ml`, `toro-viejo-clasico-tinto-750ml`, `toro-tinto-1000ml`, `vodka-skyy-700ml`.
- **Los precios son los vigentes** del criterio publicado (costo × 1,45 unidad / × 1,35 pack) y NO se tocó uno solo. La propuesta de precios (32 mantener, 14 conflicto de margen, 6 pendientes) sigue en artefactos esperando aprobación: `artifacts/catalog-pricing-images-20261024/propuesta-precios.{csv,json}` y `qa/ficha/ficha-propuesta.html`.

## Verificación

- QA automatizado (Playwright): `node artifacts/catalog-pricing-images-20261024/qa/qa-vitrina-neuquen-20261024.mjs` (servidor local arriba, no derriba nada). Resultado: `artifacts/.../qa/qa-vitrina-neuquen-20261024.json`; capturas en `artifacts/.../qa/capturas-neuquen/`.
  Cubre: per-SKU image correctness (la miniatura declarada para CADA SKU), 42/10 cobertura exacta, precios DOM = `precioDeVenta` 52/52 en modos después **y** antes, búsqueda, chips, alta al carrito, fichas (foto + precio + aviso +18 y el placeholder honesto de un SKU sin foto), sin pageerrors ni respuestas fallidas, sin overflow 390/1280, y el modo antes con 52/52 placeholder.
- Integridad de los 42 activos: `node artifacts/catalog-pricing-images-20261024/tools/verificar-integridad-imagenes.mjs` (todo webp, ≥600px master, sha256 = manifiesto) → `artifacts/.../vitrina-imagenes-verificadas.json`.

## Archivos clave

- `js/vitrina-neuquen-20261024.js` — dataset generado (NO editar a mano; generador en `artifacts/.../tools/generar-vitrina-neuquen.mjs`).
- `js/beverage-demo-data.js` — compuerta de activación: test-catalog > vitrina > demo aprobado; `?fotos=antes` quita los campos de imagen (todo placeholder) en memoria.
- `sw.js` — preempt cache del nuevo módulo vitrina.
- `catalog/gondola-neuquen.mjs` — autoridad de sku/precio/categoría; sin cambios.

## Lane de los 10 sin foto

Per asset aprobación o foto propia del comercio (producto en tu mano, fondo uniforme). Cuando exista la foto, entran por el mismo manifiesto (sha256 + derechos) y el generador re-corre; no se suma ninguna imagen sin su cadena de verificación.
