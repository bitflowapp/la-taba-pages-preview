# Planilla de apertura (CONTROLLED_PRODUCTION)

`planilla-apertura-cp.csv` trae los 46 productos del comercio real con precio y stock vacíos y `publicar = no`. Primero van los productos sin alcohol; los que tienen alcohol llevan «(alcohol)» en el nombre.

## Qué completa el comercio

| Columna | Cómo |
| --- | --- |
| `precio` | Pesos, sin puntos de mil ni signo: `4200` o `4200.50`. Vacío = «todavía no lo decidí». |
| `stock` | Unidades contadas en el local: `12`. Vacío = sin contar; `0` = contado y agotado. |
| `publicar` | `si` para que aparezca en la tienda, `no` para dejarlo oculto. |

No hace falta tocar `sku` ni `producto`.

## Qué pasa al aplicarla

- **Falla cerrado.** Si una sola fila está mal, no se aplica ninguna.
- **Para publicar**, la fila necesita:
  - precio;
  - stock mayor a cero;
  - foto aprobada en el Panel.
- **Alcohol.** Los productos con alcohol no se pueden publicar mientras la venta de alcohol esté cerrada.
- **La primera publicación verifica la ficha del producto**, cosa que el Panel no hace. Después, ocultar o volver a publicar se hace desde el Panel → Catálogo.

## Cómo se aplica

Se prueba siempre primero; esta corrida no escribe nada:

```
node scripts/import-commercial-catalog.mjs catalog/opening/planilla-apertura-cp.csv --catalogo cp
```

Después se aplica con la sesión de un dueño o admin del negocio:

```
node scripts/import-commercial-catalog.mjs <planilla> --catalogo cp --apply --target supabase
```

- La aplicación necesita, en el entorno, `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, `TABA_BUSINESS_ID` y `SUPABASE_ACCESS_TOKEN`.
- El token tiene que ser de una sesión registrada con `identity_register_session`.
- La aplicación la corre el operador técnico (o Claude) y el comercio la autoriza.
- Nunca se inventan precios ni stock.

Para ver qué falta para abrir:

```
node scripts/controlled-production/opening-readiness.mjs
```
