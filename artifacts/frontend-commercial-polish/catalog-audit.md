# Auditoría del catálogo — La Taba

Rama `feat/taba-frontend-commercial-polish`. Cierre: 2026-10-01.

La tabla completa de las 46 fichas, una por renglón, está en
[`catalog/catalog-frontend-audit.md`](../../catalog/catalog-frontend-audit.md).
Este documento es el resumen y lo que hay que decidir.

## Resultado

```text
TOTAL_PRODUCTS:        46
VALIDATED:             34
NEEDS_CONFIRMATION:    12
IMAGE_CORRECT:         40
IMAGE_NEEDS_REVIEW:    2   (más 4 fichas sin imagen)
NAME_CORRECT:          37
NAME_NEEDS_REVIEW:     9
DUPLICATES:            0
```

Cómo se llegó a esos números: se abrió la tienda en modo producción con la copia
de sólo lectura del catálogo (`tests/fixtures/catalog-cp-46.json`, 2026-09-30) y
las 42 fotos aprobadas, verificadas por SHA-256, y se miró cada ficha en la
grilla, en la vidriera y en la hoja del producto, a 390 px y a 1366 px. Cada
foto se comparó con el nombre y la presentación que la tarjeta escribe debajo.

## Qué no se tocó

Precio, stock, disponibilidad, publicación, promociones, descuentos. Tampoco
nombre, marca, presentación, tamaño, código ni imagen de ningún producto. No se
agregó ni se quitó ninguna ficha. No se descargó ninguna imagen.

Las 12 observaciones que siguen son **preguntas para el comercio**, no cambios.

## Las 12 fichas a confirmar

| # | Producto | Qué hay que decidir |
|---|---|---|
| 1 | Cepita Naranja 1 L | Identidad: el código corresponde a un Tetra Brik y el envase declarado es «Botella». Sigue sin imagen. **No se eligió ninguna de las dos.** |
| 2 | Cinzano Rosso 950 ml | Identidad: 950 ml o 1 L. Sigue sin imagen. **No se eligió ninguna de las dos.** |
| 3 | Lay’s Clásicas 134 g | Falta la foto. Se muestra el marcador neutro «Imagen pendiente». |
| 4 | Pepsi Black 2,25 L | Falta la foto. Se muestra el marcador neutro. |
| 5 | Alamos Malbec 750 ml | El envase de la foto dice «RESERVE»; el nombre no. |
| 6 | Trapiche Cabernet Sauvignon 750 ml | El envase dice «RESERVA»; el nombre no. |
| 7 | Trapiche Red Blend 750 ml | El envase dice «RESERVA», y la etiqueta de la foto es una edición con el escudo de un club. |
| 8 | Sprite Sin Azúcar 2,25 L | El envase dice «ZERO»; el nombre, «Sin Azúcar». |
| 9 | Sprite Sin Azúcar 600 ml | Igual. |
| 10 | Schweppes Pomelo Sin Azúcar 2,25 L | El envase dice «ZERO Pomelo»; el nombre, «Sin Azúcar». |
| 11 | Hielo Cristal 4 kg | La bolsa de la foto es de una fábrica de San Antonio de Areco (Buenos Aires). Confirmar qué hielo vende el local. |
| 12 | Campari Bitter 750 ml | La foto viene de otra fuente (Open Food Facts, CC BY-SA) y tiene otro encuadre y otra luz que el resto. |

En las fichas 5 a 10 la foto es la del código de barras exacto: lo que hay que
decidir es el nombre, no la imagen. En los tres vinos la palabra que falta es la
línea del producto, que cambia qué botella es.

## Lo que se revisó en las 46

| Aspecto | Resultado |
|---|---|
| Nombre | 46 con nombre; ninguno vacío ni con el tamaño repetido en el título |
| Marca | 46 con marca |
| Variante y presentación | 46 coherentes |
| Volumen o contenido | 46 con capacidad, en L, ml, g o kg |
| Imagen | 42 con foto, 4 con marcador neutro; ninguna foto de otro producto |
| Imágenes genéricas | 0 |
| Duplicados | 0 (hay 3 pares con el mismo título y distinto tamaño; la presentación los separa) |
| Rubro | 11 rubros; cada producto en el suyo |
| Insignias | «+18» en las 18 bebidas con alcohol; ninguna insignia de oferta |
| Títulos largos | ninguno se corta en la grilla, de 360 px a 1920 px |

## Lo que cambió en cómo se muestra

Son cambios de presentación: los datos son los mismos.

| Antes | Ahora |
|---|---|
| «Todas» en orden alfabético: un vino, un aperitivo, un agua, una cerveza | Agrupado por rubro, en el orden de los chips. Vale mientras el comercio no numere sus productos: si pone un orden propio, manda el suyo |
| «BRANCA / Fernet Branca», «CRISTAL / Hielo Cristal» | El renglón de marca no repite lo que el título ya dice |
| «Schweppes Pomelo Sin…» a 390 px; cinco nombres cortados a 360 px | El nombre entra entero |
| En la home, «Coca-Cola Sin…» al lado de «Coca-Cola» | El nombre largo usa sus dos renglones y la presentación queda fija al final del segundo; la tarjeta mide lo mismo. Si no entra todo, lo que queda afuera es el final del nombre, nunca el tamaño |
| Brahma Chopp «1 L» | «1 L · Retornable» (el catálogo ya lo declaraba) |
| Corazón de favoritos invisible (1,02:1) | 17,2:1 sin guardar, 5,4:1 guardado |
| «Todas», «Jugos»: el título perdía el pie de la «j» y la «g» en Chromium | Se ve entero |

## Búsqueda

La búsqueda exacta sigue mandando. Sólo cuando no trae nada se muestra lo más
parecido, y la pantalla lo dice: «No encontramos «heiniken». Esto es lo más
parecido.»

| Lo que se escribe | Antes | Ahora |
|---|---|---|
| `cocacola`, `redbull`, `lays`, `bon aqua` | 0 resultados | Coincidencia exacta |
| `1 litro`, `710 cc`, `2.25`, `medio litro`, `litro y medio` | 0 resultados | Mismo resultado que `1 L`, `710 ml`, `2,25` |
| `vino tinto`, `tinto`, `blanco`, `agua tónica` | 0 resultados | Los 4 tintos, el blanco, las 2 tónicas |
| `heiniken`, `cervesa`, `energisante`, `kilm` y otros 13 errores de tipeo | 0 resultados | El producto, marcado como «parecido» |
| `vodka`, `whisky`, `gin`, `leche`, `yerba` | 0 resultados | 0 resultados: no se inventa surtido |
| `471`, `heiniken 500 ml` | 0 resultados | 0 resultados: los números no se aproximan |

Pruebas: `tests/catalog-search-tolerance.test.mjs` (9 casos) y
`tests/e2e/catalog-polish.spec.mjs`.

## Para que el catálogo quede listo para vender

Nada de esto lo resuelve el frontend:

1. Precio, stock y disponibilidad de las 46 fichas: los define Walter.
2. Cepita Naranja y Cinzano Rosso: confirmar presentación, tamaño y código.
3. Foto de Lay’s Clásicas 134 g y de Pepsi Black 2,25 L.
4. Los seis nombres donde el envase dice otra palabra.
5. Qué hielo se vende.
