# COMMERCIAL_MARGIN_REVIEW — precios PedidosYa 2026-10-10

## 1. Qué encontré en la regla de precio

- Los precios de producción **son exactamente** `costo × 1,45` redondeado hacia arriba a múltiplos de $50, para los 8 SKU que comparé (ver tabla). La fórmula está en `catalog/gondola-neuquen.mjs` (`margenUnidad: 1.45`, `margenPack: 1.35`).
- La fórmula **no se ejecuta en runtime**: no encontré recálculo en `js/`, en las Edge Functions ni en las migraciones. El 1,45 vive en el generador de `catalog/*.csv/json`. Por eso el riesgo de sobrescritura es **re-importar** esos archivos (`catalog:import`), que volvería a poner los precios de la fórmula.
- `unit_cost` en `public.products` es **NULL en los 72 productos**. Los costos usados aquí salen de `costoMayorista` en `catalog/gondola-neuquen.mjs`, no de la base. Hay que confirmarlos con facturas actuales antes de aprobar.

## 2. Margen de los cambios propuestos

| SKU | Costo (repo) | Precio actual | Fórmula ×1,45 (redondeada) | Propuesto | Propuesto / costo | Margen sobre costo | vs. fórmula |
|---|---|---|---|---|---|---|---|
| andes-origen-rubia-lata-473ml | 1.818,10 | 2.650 | 2.650 | 3.840 | 2,11 | +111,2 % | +45,7 % |
| budweiser-lata-473ml | 1.611,49 | 2.350 | 2.350 | 3.345 | 2,08 | +107,6 % | +43,2 % |
| quilmes-stout-lata-473ml | 1.404,88 | 2.050 | 2.050 | 2.999 | 2,13 | +113,5 % | +47,2 % |
| stella-artois-lata-473ml | 2.479,26 | 3.600 | 3.600 | 4.635 | 1,87 | +87,0 % | +28,9 % |
| gancia-lima-limon-lata-473ml | 1.735,45 | 2.550 | 2.550 | 3.239 | 1,87 | +86,6 % | +28,7 % |
| fernet-branca-1000ml | 18.099,09 | 26.250 | 26.250 | 27.585 | 1,52 | +52,4 % | +5,1 % |
| fernet-1882-750ml | 6.168,87 | 8.950 | 8.950 | 11.880 | 1,93 | +92,6 % | +32,8 % |
| *corona-extra-botella-330ml (AMBIGUO, no aplicado)* | 2.313,97 | 3.400 | 3.400 | 4.935 | 2,13 | +113,3 % | +47,1 % |

**Riesgo de margen negativo: 0 productos.** Todos los precios propuestos quedan por encima de `costo × 1,45` y por encima de `costo × 1,5`. El mínimo es Fernet Branca 1 L (1,52 × costo).

## 3. Conflicto con la regla general

Las instrucciones dicen «conservar la fórmula para los demás productos» y «no reescribir el motor». Eso se cumple: **no se toca el código del generador**. Pero los 7 productos aprobados quedan **fuera** de la fórmula, y el generador los volvería a poner en el precio de la fórmula en la próxima importación. Hay que decidir cómo convivir con eso.

## 4. Propuesta mínima de override (NO implementada)

1. Un archivo `catalog/price-overrides/pedidosya-20261010.csv` con `sku,precio_comercial,aprobado_por,fecha`.
2. `catalog/gondola-neuquen.mjs` aplica ese override **después** de calcular `costo × margen`, sólo para los SKU listados, y registra en su salida cuál precio usó.
3. `scripts/alcohol/verificar-promos-alcohol.mjs` (o un test nuevo) falla si un SKU con override aparece con un precio distinto al del archivo.
4. Sin override: el comportamiento de los demás productos queda igual.

Esto cambia código fuera de la base de datos, así que requiere aprobación aparte. No lo hice.

## 5. Productos que siguen con la fórmula

Los 64 productos de La Taba sin correspondencia conservan su precio y su política (ver `UNMATCHED_PRODUCTS.csv`). Incluyen los packs x6/x12, que nunca reciben precio unitario.

## 6. Preguntas para decidir antes de aprobar

- ¿Los costos de `gondola-neuquen.mjs` siguen vigentes? (Son la única base del margen.)
- ¿Aceptás el override por SKU, o preferís que el 1,45 se aplique a estos SKU también y se revise el precio de referencia?
- Corona Extra 330 ml: ¿es el mismo producto que «Corona Rubia 330 ml» de la lista? Si sí, el cambio sería de $3.400 a $4.935 (+45 %).
