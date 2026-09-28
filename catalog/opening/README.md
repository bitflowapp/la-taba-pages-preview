# Planilla de apertura (CONTROLLED_PRODUCTION)

`planilla-apertura-cp.csv` trae los 46 productos del comercio real:

- precio y stock vacíos y `publicar = no`;
- primero los productos sin alcohol;
- los que tienen alcohol llevan «(alcohol)» en el nombre.

Es la forma de cargar **muchos** productos juntos. Para uno o pocos, el Panel alcanza: Catálogo › precio y stock › «Guardar», y después «Verificar ficha y publicar».

Todos los datos que hay que pedirle al comercio están en [`OWNER-INPUT.md`](OWNER-INPUT.md).

## Qué completa el comercio

| Columna | Cómo |
| --- | --- |
| `precio` | En pesos, sin puntos de mil ni signo: `4200` o `4200.50`. Vacío = «todavía no lo decidí». |
| `stock` | Unidades contadas en el local: `12`. Vacío = sin contar; `0` = contado y agotado. |
| `publicar` | `si` para que aparezca en la tienda, `no` para dejarlo oculto. |

No hace falta tocar `sku` ni `producto`.

## Qué pasa al aplicarla

- **Falla cerrado.** Si una sola fila está mal, no se aplica ninguna.
- **Para publicar**, la fila necesita:
  - precio;
  - stock mayor a cero;
  - foto aprobada en el Panel.
- **Alcohol:** los productos con alcohol no se publican mientras la venta de alcohol esté cerrada. Lo controla la planilla y también la base.
- **La primera publicación verifica la ficha del producto.** Es el mismo contrato que el botón «Verificar ficha y publicar» del Panel.
- **Se puede repetir sin peligro:** aplicar la misma planilla dos veces no cambia nada la segunda vez.

## Cómo se aplica

1. **Ensayo, que no escribe nada.** Valida la planilla contra el catálogo real y dice qué quedaría pendiente para abrir:

   ```
   npm run opening:dry-run
   ```

2. **Aplicar**, con la sesión de un dueño o encargado. Nunca con la clave de servicio: la credencial se lee del Administrador de credenciales de Windows. Pide escribir `APLICAR` y hace todo en una transacción:

   ```
   npm run opening:publish -- --apply --credential "<credencial del dueño o encargado>"
   ```

3. **Ver qué falta:** Panel › Apertura, o `npm run opening:check`.

El ensayo es el paso 1: corre contra el catálogo real y no escribe nada. El tenant QA de CP **no sirve** para ensayar la planilla: sus productos se llaman «QA …» y el importador rechaza a propósito los productos de prueba. Lo que la planilla escribe (la RPC `apply_commercial_catalog_batch`) está certificado en vivo sobre QA desde la sesión del dueño (`scripts/controlled-production/opening-cert.mjs`).

Nunca se inventan precios ni stock.
