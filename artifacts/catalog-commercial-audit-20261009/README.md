# Auditoría comercial del catálogo y las promociones — 2026-10-09

| Archivo | Qué es |
|---|---|
| `FINDINGS.md` | Todos los hallazgos, priorizados, con causa raíz, evidencia, estado y prueba de regresión. |
| `ROOT_CAUSE.md` | La investigación del problema reportado («vi la promoción y no encontré cómo agregarla»). |
| `PRODUCT_AUDIT.csv` | Una fila por producto (51): identidad, foto, precio, estado comercial y el resultado de tocar cada cosa en 5 configuraciones. |
| `PROMOTION_AUDIT.csv` | Una fila por pieza/campaña/combo/construcción editorial. `prod_*` = producción observada; `rama_*` = esta rama. |
| `TEST_RESULTS.md` | Qué se ejecutó y qué dio, incluidos los fallos y su causa. |
| `COMMERCIAL_UX_REVIEW.md` | Oportunidades de conversión: lo implementado y lo recomendado. |
| `BEFORE_AFTER/` | Capturas antes/después (390, 360 y 1440 px) y la hoja de contacto de las 51 fotos. |
| `VIDEO/` | `antes.webm` (3 toques para comprar lo que la pieza muestra) y `despues.webm` (1 toque). |
| `raw/` | Salidas crudas minificadas de los arneses y las filas públicas de producción usadas como verdad. |

## Origen de los datos

- **Catálogo real observado:** lectura pública de sólo lectura de la tienda de producción
  (`https://la-taba.pages.dev/`, clave publicable que ya viaja en el navegador), 2026-10-09 18:08 ART (21:08 UTC).
  `raw/prod-products-rows.json`. Sin costos ni autores.
- **Instantánea del repositorio:** `tests/fixtures/catalog-live.json` (2026-10-05). Difiere de la lectura
  anterior sólo en el stock de 2 filas.
- **Sintético:** sólo donde el nombre de la prueba lo dice (`[SINTÉTICO]`, «sintético» en los combos).
- **Staging:** no se usó.

## Reproducir

```bash
# 1 · lectura de sólo lectura de producción (rows) y recorrido contra producción
node scripts/audit/catalog-commercial-audit.mjs --rows=<rows.json> --out=<dir> --engine=chromium --viewport=390x844
node scripts/audit/promotion-audit.mjs          --out=<dir> --engine=webkit   --viewport=390x844
node scripts/audit/catalog-navigation-audit.mjs --rows=<rows.json> --out=<dir>

# 2 · el mismo recorrido contra el árbol de trabajo, con la instantánea servida en memoria
node scripts/realtime-relay.mjs 8099 &
node scripts/audit/catalog-commercial-audit.mjs --local=http://127.0.0.1:8099 --rows=<rows.json> --out=<dir>

# 3 · tablas
node scripts/audit/build-audit-csvs.mjs --rows=<rows.json> --prod=<dir> --local=<dir> --images=<img.json> --out=<dir>
```

La auditoría en producción **no crea pedidos ni toca el servidor**: el carrito es local del
navegador. No hay datos personales de clientes en esta carpeta.
