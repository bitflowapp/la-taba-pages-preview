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

Para ensayar la planilla en el tenant QA de CP antes del real:

```
node scripts/import-commercial-catalog.mjs <planilla> --catalogo cp --business <uuid del tenant QA>
```

Nunca se inventan precios ni stock.
