# Venta de alcohol: qué decide el comercio antes de activarla

**Estado: CERRADA.** Los 18 productos con alcohol no se publican ni se venden:

- Cervezas, Fernet, Aperitivos y Vinos, todos con edad mínima 18 en su ficha.
- La tienda puede abrir sin alcohol: los 28 productos sin alcohol alcanzan.

## Qué impide hoy vender alcohol (y seguirá impidiéndolo)

| Capa | Regla |
| --- | --- |
| Base: publicar | `set_commercial_product_publication` y `apply_commercial_catalog_batch` (desde 20260928150000) se niegan a publicar o republicar un producto con alcohol mientras `alcohol_sales_enabled` sea falso. Vale para la planilla y para el Panel |
| Base: pedir | `create_order_with_items` rechaza un pedido con alcohol si falta la política completa (edad, franja, huso), si el cliente no confirmó la mayoría de edad o si está fuera de la franja |
| Base: invariante | `businesses_alcohol_policy_complete`: no se puede encender sin edad (18–99), franja y huso |
| Tienda | El checkout pide confirmar la edad antes de un pedido con alcohol. Es el age gate, y **se mantiene** |
| Panel | El botón de publicar no aparece para productos con alcohol mientras la venta esté cerrada |

## Qué tiene que decidir el comercio

1. **¿Se vende alcohol por la web?** Es una decisión comercial y legal del titular del comercio, no técnica.
2. **Edad mínima.** 18 o más.
3. **Franja horaria de venta de alcohol**: inicio y fin, y si cruza la medianoche. Tiene que respetar la normativa municipal y provincial que aplique al local (Neuquén capital) y su habilitación.
4. **Habilitación o licencia**: referencia de la habilitación municipal que permite vender alcohol para llevar. Se guarda en la documentación del comercio.
5. **Productos**: cuáles de los 18 se venden. Cada uno necesita foto propia aprobada, precio y stock, igual que el resto.
6. **Entrega**: si el delivery lleva alcohol, el repartidor entrega con el código del cliente. Conviene que el comercio defina si pide documento al entregar.

## Cómo se activa, cuando esté decidido

Lo hace el operador técnico con la **sesión del dueño o encargado**. Los permisos son los del comercio: el dueño o encargado escribe estas columnas; no se usa la clave de servicio.

```
npm run alcohol:policy -- status
npm run alcohol:policy -- apply --credential "<credencial del dueño>" --min-age 18 --start 10:00 --end 23:00 --timezone America/Argentina/Buenos_Aires
```

- `apply` pide escribir `HABILITAR ALCOHOL`.
- Escribe edad, franja, huso y el interruptor en un solo cambio, que la base valida completo.
- Después se publican los productos con alcohol como cualquier otro: Panel › Catálogo › «Verificar ficha y publicar».

Para volver a cerrar, en cualquier momento. Deja de ofrecerse al instante y la configuración queda guardada:

```
npm run alcohol:policy -- disable --credential "<credencial del dueño>"
```

«Preparar apertura» y `npm run opening:check` muestran el estado en la línea «Venta de alcohol».
