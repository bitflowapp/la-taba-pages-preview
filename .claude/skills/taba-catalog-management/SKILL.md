---
name: taba-catalog-management
description: Alta, auditoría y corrección de productos del catálogo comercial de TABA2 (bebidas). Usar cuando se pida agregar un producto, revisar una ficha, corregir marca/presentación/volumen/imagen, clasificar individual vs pack vs combo, arreglar que algo "no aparece en la búsqueda", o preparar un SKU para publicar. También cuando alguien pregunte qué falta para vender un producto.
allowed-tools: Read, Grep, Glob
---

# Catálogo TABA2 · alta y auditoría de productos

Esta skill es **dueña de la identidad del producto**: qué es, cómo se llama, cómo
se presenta, con qué imagen y bajo qué clasificación. No decide precios ni
promociones (`taba-pricing-promotions`), no decide dónde se muestra
(`taba-merchandising`) y no firma la publicación (`taba-commercial-qa`).

## Regla que ordena todo lo demás

Un producto se **describe** desde una fuente; nunca se **completa** desde la
intuición. Si un dato no está en una fuente del repo o no lo confirmó una
persona con autoridad comercial, el dato es **PENDIENTE** y se declara como tal.
Un catálogo con huecos declarados es honesto; uno con huecos rellenados es una
mentira que nadie audita hasta que un cliente compra mal.

Nunca inventar: producto, marca, SKU, volumen, precio, stock, cantidad por pack,
graduación alcohólica ni procedencia de una imagen.

## Antes de responder cualquier pedido de catálogo

1. Leer el estado vigente del SKU en la matriz de autoridad y en el catálogo
   fuente. Los caminos y qué contesta cada archivo están en
   [references/fuentes-de-autoridad.md](references/fuentes-de-autoridad.md).
2. No confiar en la memoria de otra sesión ni en un documento de fecha: los
   estados cambian. La matriz es un corte, el CSV fuente es el dato.
3. Si el pedido es "agregá X" y X ya existe en otra presentación, decirlo antes
   de proponer nada: casi siempre lo que falta es precio o imagen, no un alta.

## Checklist obligatorio por producto

Ninguna ficha está completa sin las 13 casillas. La tabla campo por campo, con
la columna exacta del CSV y qué la valida, está en
[references/campos-y-validacion.md](references/campos-y-validacion.md).

| # | Casilla | Se resuelve con |
|---|---|---|
| 1 | Producto real (existe, se consigue) | fuente comercial o confirmación del dueño |
| 2 | SKU / `external_id` estable y único | catálogo fuente |
| 3 | Marca | catálogo fuente |
| 4 | Presentación (lata, botella, retornable, PET) | `package_type` |
| 5 | Volumen | `capacity_value` + `capacity_unit` |
| 6 | Cantidad / unidades | `units_per_pack` (1 = individual) |
| 7 | Categoría (de la lista cerrada) | `category` |
| 8 | Precio autorizado | `taba-pricing-promotions` |
| 9 | Stock | `taba-pricing-promotions` |
| 10 | Imagen que representa la presentación real | manifiesto de imágenes |
| 11 | +18 (`alcoholic`, `minimum_age`) | coherente con la categoría |
| 12 | Aliases de búsqueda | `tags` |
| 13 | Individual / pack / combo | ver abajo |

Una casilla sin fuente se reporta como pendiente **con su nombre**: "falta
precio confirmado" y "falta imagen frontal" son bloqueos distintos y se cierran
por caminos distintos.

## Individual, pack y combo no son lo mismo

- **Individual**: una unidad. `units_per_pack = 1`.
- **Pack**: varias unidades del **mismo** SKU. Necesita `units_per_pack > 1` y
  una imagen que muestre el multipack. Un pack de abastecimiento (el que compra
  el local) **no se convierte** en artículo minorista dividiendo el precio.
- **Combo**: dos o más SKUs **distintos**, o una entidad del manifiesto de
  combos. Su precio y su ahorro se derivan del catálogo vivo, nunca se guardan.

Confundirlos produce el defecto más caro del catálogo: publicar un pack con la
foto de una unidad suelta. El detalle y los casos límite están en
[references/pack-combo-e-imagen.md](references/pack-combo-e-imagen.md).

## Imagen

La imagen tiene que coincidir **exactamente** con variedad, capacidad, envase y
cantidad del registro. Si no coincide, el estado es `WRONG_PRESENTATION` o
`PACK_NEEDS_COMPOSITION`, no "imagen aprobada con observaciones".

Cuando la imagen y el SKU se contradicen sobre un hecho verificable (el envase
dice 750 ml y la ficha dice 700 ml), el resultado es `REJECTED_DATA_CONFLICT`:
no se elige cuál de los dos tiene razón ni se maquilla como "falta imagen". Se
declara el conflicto y se deriva a una persona.

## Búsqueda: por qué un producto "no aparece"

La búsqueda del storefront concatena marca, nombre, variedad, presentación,
etiqueta de unidad, capacidad, subcategoría, categoría y `tags`. Para que un
producto se encuentre por un nombre popular, ese nombre va en `tags` — **no** se
deforma el nombre público del producto para que matchee.

Un término que no devuelve nada porque el único candidato está rechazado es un
**hueco documentado del surtido**, no un motivo para publicar el rechazado.

## Qué entregar

Un informe, no una edición silenciosa:

1. Estado por SKU: listo / pendiente (con la casilla faltante nombrada) /
   bloqueado (con la causa).
2. Qué se puede resolver desde el repo y qué necesita una decisión humana.
3. Si el pedido implica publicar, derivar a `taba-commercial-qa`: esta skill
   prepara, no publica.

## Nunca

- Rellenar precio, stock o graduación "para que quede completo".
- Reutilizar la imagen de otra presentación de la misma marca.
- Convertir un pack de abastecimiento en unidad minorista por inferencia.
- Dar por publicable algo que sólo está *listo*: publicar tiene su propia
  compuerta y su propio dueño.
