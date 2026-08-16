# Pack, combo e imagen: los tres errores caros

## 1. Pack ≠ combo

| | Pack | Combo |
|---|---|---|
| Qué agrupa | N unidades del **mismo** SKU | 2+ SKUs **distintos** (o una entidad del manifiesto) |
| Dónde vive | fila propia en el catálogo, `units_per_pack > 1` | `data/combos.csv` |
| Precio | precio propio, confirmado como cualquier producto | **derivado** del catálogo vivo |
| Imagen | debe mostrar el multipack | una imagen por componente, o composición honesta |
| Ahorro | no aplica por sí mismo | `suma de precios individuales − precio promocional` |

Un combo de un solo SKU en cantidad (por ejemplo seis latas iguales) se dibuja
con imágenes de unidades reales y un badge `x6`. Eso es una composición honesta.
Generar un packaging que no existe —una caja dibujada, una etiqueta compuesta con
IA— es falsificar el producto.

## 2. Pack de abastecimiento ≠ artículo minorista

El local compra en packs. Que exista una fila "Coca-Cola PET 500 ml x12" no
significa que se venda así. Convertirla en unidad minorista requiere:

- decisión comercial explícita de vender esa presentación,
- precio propio confirmado para la presentación que se vende,
- stock contado en la unidad que se vende,
- imagen que represente lo que recibe el cliente.

**Dividir el precio del pack por 12 no es un precio.** Es una estimación
presentada como dato, y viaja hasta la tarjeta del cliente sin que nadie la
revise.

## 3. La imagen tiene que ser del producto que llega

Cuatro verificaciones de identidad deben coincidir: **variedad, capacidad,
envase y cantidad**. Cualquier desacuerdo → `REVISAR`, y no se publica.

Reglas del pipeline:

- Salida WebP 1000×1000 + miniatura 400×400, fondo blanco, producto centrado,
  proporción original.
- Sin precio, promoción, watermark ni retoque de etiqueta.
- Fuentes admitidas: fabricante/marca, distribuidor oficial, mayorista
  autorizado, proveedor aprobado o material propio. **No** miniaturas de
  buscador, **no** envases parecidos, **no** reconstrucción con IA.
- Sólo raster (JPEG/PNG/WebP/AVIF/TIFF). SVG remoto, GIF y formatos animados se
  rechazan antes de normalizar.
- `status=APROBADA` exige derechos documentados, las cuatro verificaciones en
  `true` y un `expected_sha256` de 64 caracteres.
- Toda imagen nueva bajo `assets/` necesita entrada con procedencia en el
  manifiesto correspondiente. Un WebP no manifestado invalida el pipeline.

### El caso que se repite

Un pack cuyo activo es idéntico a la unidad individual (mismo hash) **no es un
pack verificable**. El estado correcto es rechazo por conflicto de datos, no
`PACK_NEEDS_COMPOSITION` con la foto de la lata suelta publicada igual. Si el
hash del activo del pack coincide con el de la unidad, eso ya es la prueba.

### El otro caso que se repite

Envase que declara un volumen y ficha que declara otro. No se corrige "el que
parece equivocado": los dos son afirmaciones sobre el mundo físico y sólo una
persona con el producto en la mano las resuelve. Estado:
`REJECTED_DATA_CONFLICT`, con las dos afirmaciones citadas.

## Propagación del +18

En un combo, la restricción de edad de **cualquier** componente se propaga al
combo entero. No existe un combo medio alcohólico. Lo mismo con el stock: el
combo vale lo que sostiene su componente **limitante**, no el promedio.
