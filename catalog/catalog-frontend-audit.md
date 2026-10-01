# Auditoría del catálogo en el frontend — La Taba

Fecha: 2026-09-30 (cierre 2026-10-01). Rama `feat/taba-frontend-commercial-polish`.

Qué se miró: las **46 fichas** del catálogo comercial, tal como las dibuja la
tienda en modo producción —tarjeta de grilla, tarjeta de vidriera y ficha—, a
390 px y a 1366 px. Los datos son la copia de sólo lectura del 2026-09-30
(`tests/fixtures/catalog-cp-46.json`); las 84 imágenes (42 master + 42
miniatura) se verificaron por SHA-256 contra esa copia antes de usarlas.

Qué **no** se tocó: precio, stock, disponibilidad, publicación, promociones ni
descuentos. Tampoco nombre, marca, presentación ni imagen de ningún producto:
todo lo que sigue son **observaciones para que decida el comercio**. Nada se
adivinó.

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

- **VALIDATED** es una ficha donde el nombre, la presentación, el rubro y la
  foto dicen lo mismo y la tarjeta se lee bien.
- **NEEDS_CONFIRMATION** no es un defecto del frontend: es un dato comercial que
  sólo puede cerrar quien conoce la góndola.

## Lo que hay que confirmar (12)

| Producto | Tipo | Observación |
|---|---|---|
| Campari Bitter 750 ml | IMAGEN | Foto de otra procedencia (Open Food Facts, CC BY-SA): encuadre y luz distintos al resto. |
| Cinzano Rosso 950 ml | IDENTIDAD | 950 ml vs 1 L sin confirmar. Sin imagen hasta confirmar. |
| Pepsi Black 2,25 L | FOTO | Falta foto propia (la disponible era de 2017 y borrosa). |
| Sprite Sin Azúcar 2,25 L | NOMBRE | El envase dice «Sprite ZERO»; el nombre dice «Sin Azúcar». |
| Sprite Sin Azúcar 600 ml | NOMBRE | El envase dice «Sprite ZERO»; el nombre dice «Sin Azúcar». |
| Hielo Cristal 4 kg · Bolsa de hielo | MARCA | La bolsa de la foto es de una fábrica de San Antonio de Areco (Buenos Aires). Confirmar qué hielo vende el local. |
| Cepita Naranja 1 L | IDENTIDAD | GTIN = Tetra Brik vs envase «Botella» (issue #118). Sin imagen hasta confirmar. |
| Schweppes Pomelo Sin Azúcar 2,25 L | NOMBRE | El envase dice «Schweppes ZERO Pomelo»; el nombre dice «Sin Azúcar». |
| Lay’s Clásicas 134 g | FOTO | Falta foto propia (sólo existía una edición con marca de torneo). |
| Alamos Malbec 750 ml | NOMBRE | El envase de la foto dice «Alamos Malbec RESERVE»; el nombre no dice Reserve. |
| Trapiche Cabernet Sauvignon 750 ml | NOMBRE | El envase dice «Trapiche RESERVA Cabernet Sauvignon»; el nombre no dice Reserva. |
| Trapiche Red Blend 750 ml | NOMBRE+IMAGEN | El envase dice «Trapiche RESERVA Red Blend» y la foto es una etiqueta de edición con escudo de un club. |

Por tipo:

- **IDENTIDAD (2)** — Cepita Naranja y Cinzano Rosso. Ya estaban pendientes y
  siguen igual: no se eligió presentación, tamaño ni código por ellos.
- **FOTO (2)** — Lay’s Clásicas 134 g y Pepsi Black 2,25 L. Falta la foto; el
  producto se muestra con el marcador neutro «Imagen pendiente».
- **NOMBRE (6)** — el envase de la foto dice una palabra que el nombre no dice.
  En tres vinos esa palabra es la línea del producto (Reserve / Reserva), que
  cambia qué botella es. En las tres gaseosas el envase dice «Zero» y el nombre
  «Sin Azúcar»: es la misma bebida con otra palabra. En los seis casos la foto
  es la del código de barras exacto; lo que hay que decidir es el nombre.
- **MARCA (1)** — Hielo Cristal. La foto es de una bolsa con dirección de San
  Antonio de Areco. Si el local vende otro hielo, cambian la marca y la foto.
- **IMAGEN (2)** — Campari (foto de otra procedencia, con otro encuadre) y
  Trapiche Red Blend (etiqueta de una edición con escudo de un club).

## Lo que se revisó en cada ficha

| Aspecto | Resultado |
|---|---|
| Nombre | 46 con nombre; ninguno vacío ni con el tamaño repetido en el título |
| Marca | 46 con marca; el renglón de marca ya no se repite cuando el título la dice |
| Variante y presentación | 46 coherentes entre sí (la tienda descarta la ficha si no lo son) |
| Volumen o contenido | 46 con capacidad; se muestra en L, ml, g o kg según corresponde |
| Imagen | 42 con foto oficial, 4 con marcador neutro; ninguna foto de otro producto |
| Imágenes genéricas | 0 |
| Marcadores | 4, todos justificados arriba |
| Duplicados | 0. Hay 3 pares con el mismo título y distinto tamaño (Lay’s 134 g / 40 g, Pepsi Black 1,5 L / 2,25 L, Sprite 2,25 L / 600 ml): son productos distintos y la presentación los separa |
| Rubro | 11 rubros; cada producto en el que le corresponde |
| Insignias | «+18» en las 18 bebidas con alcohol; ninguna insignia de oferta (no hay ofertas) |
| Títulos largos | ninguno se corta ya en la grilla (antes: 1 a 390 px y 5 a 360 px) |

## Lo que cambió en cómo se MUESTRA (no en los datos)

| Antes | Ahora |
|---|---|
| «Todas» en orden alfabético: un vino, un aperitivo, un agua, una cerveza | Agrupado por rubro, en el orden de los chips y de la home. Vale mientras el comercio no numere sus productos: si pone un orden propio, manda el suyo |
| «BRANCA / Fernet Branca», «CRISTAL / Hielo Cristal» | El renglón de marca no repite lo que el título ya dice |
| «Schweppes Pomelo Sin…» a 390 px | El nombre entra entero (dos renglones reservados, tres permitidos) |
| En la home, «Coca-Cola Sin…» al lado de «Coca-Cola» | El nombre largo usa sus dos renglones y la presentación queda fija al final del segundo; la tarjeta mide lo mismo. Si no entra todo, lo que queda afuera es el final del nombre, nunca el tamaño |
| Brahma Chopp «1 L» | «1 L · Retornable»: el catálogo ya lo declaraba y la tarjeta lo callaba |
| Corazón de favoritos invisible en las 46 tarjetas (1,02:1) | Visible: 17,2:1 sin guardar, 5,4:1 guardado |

## Las 46 fichas

`OK` = validada. Lo demás remite a la tabla de arriba.

| # | Rubro | Título en la tarjeta | Presentación | Foto | +18 | Estado | Observación |
|---|---|---|---|---|---|---|---|
| 1 | Aguas | Bonaqua | 2,25 L · Sin gas | SI |  | OK |  |
| 2 | Aguas | Eco de los Andes | 2 L · Sin gas | SI |  | OK |  |
| 3 | Aguas | Glaciar Con Gas Baja en Sodio | 1,5 L | SI |  | OK |  |
| 4 | Aguas | Glaciar Sin Gas Baja en Sodio | 1,5 L | SI |  | OK |  |
| 5 | Aguas | Villavicencio | 500 ml · Sin gas | SI |  | OK |  |
| 6 | Aperitivos | Aperol | 750 ml | SI | +18 | OK |  |
| 7 | Aperitivos | Branca Menta | 750 ml | SI | +18 | OK |  |
| 8 | Aperitivos | Campari Bitter | 750 ml | SI | +18 | IMAGEN | Foto de otra procedencia (Open Food Facts, CC BY-SA): encuadre y luz distintos al resto. |
| 9 | Aperitivos | Cinzano Rosso | 950 ml | NO | +18 | IDENTIDAD | 950 ml vs 1 L sin confirmar. Sin imagen hasta confirmar. |
| 10 | Cervezas | Brahma Chopp Rubia | 1 L · Retornable | SI | +18 | OK |  |
| 11 | Cervezas | Corona Extra | 330 ml · Lager | SI | +18 | OK |  |
| 12 | Cervezas | Heineken Lager | 710 ml · Lata | SI | +18 | OK |  |
| 13 | Cervezas | Imperial Golden | 473 ml · Lata | SI | +18 | OK |  |
| 14 | Cervezas | Patagonia Lager del Sur | 730 ml | SI | +18 | OK |  |
| 15 | Cervezas | Quilmes Clásica | 710 ml · Lata · Lager | SI | +18 | OK |  |
| 16 | Cervezas | Schneider Rubia | 710 ml · Lata | SI | +18 | OK |  |
| 17 | Cervezas | Stella Artois Rubia | 473 ml · Lata | SI | +18 | OK |  |
| 18 | Energizantes | Monster Mango Loco | 473 ml · Lata | SI |  | OK |  |
| 19 | Energizantes | Monster Ultra | 473 ml · Lata · Sin azúcar | SI |  | OK |  |
| 20 | Energizantes | Red Bull Energy Drink | 355 ml · Lata | SI |  | OK |  |
| 21 | Energizantes | Speed Zero | 473 ml · Lata | SI |  | OK |  |
| 22 | Fernet | Fernet Branca | 750 ml | SI | +18 | OK |  |
| 23 | Gaseosas | Coca-Cola | 2,25 L | SI |  | OK |  |
| 24 | Gaseosas | Coca-Cola Sin Azúcar | 2,25 L | SI |  | OK |  |
| 25 | Gaseosas | Fanta Naranja | 2,25 L | SI |  | OK |  |
| 26 | Gaseosas | Pepsi Black | 1,5 L | SI |  | OK |  |
| 27 | Gaseosas | Pepsi Black | 2,25 L | NO |  | FOTO | Falta foto propia (la disponible era de 2017 y borrosa). |
| 28 | Gaseosas | Sprite Sin Azúcar | 2,25 L | SI |  | NOMBRE | El envase dice «Sprite ZERO»; el nombre dice «Sin Azúcar». |
| 29 | Gaseosas | Sprite Sin Azúcar | 600 ml | SI |  | NOMBRE | El envase dice «Sprite ZERO»; el nombre dice «Sin Azúcar». |
| 30 | Hielo | Hielo Cristal | 4 kg · Bolsa de hielo | SI |  | MARCA | La bolsa de la foto es de una fábrica de San Antonio de Areco (Buenos Aires). Confirmar qué hielo vende el local. |
| 31 | Jugos | Cepita Durazno | 1 L | SI |  | OK |  |
| 32 | Jugos | Cepita Naranja | 1 L | NO |  | IDENTIDAD | GTIN = Tetra Brik vs envase «Botella» (issue #118). Sin imagen hasta confirmar. |
| 33 | Mixers | Paso de los Toros Pomelo | 1,5 L | SI |  | OK |  |
| 34 | Mixers | Paso de los Toros Tónica | 1,5 L | SI |  | OK |  |
| 35 | Mixers | Schweppes Pomelo Sin Azúcar | 2,25 L | SI |  | NOMBRE | El envase dice «Schweppes ZERO Pomelo»; el nombre dice «Sin Azúcar». |
| 36 | Mixers | Schweppes Tónica | 354 ml · Lata | SI |  | OK |  |
| 37 | Snacks | Doritos Queso | 129 g | SI |  | OK |  |
| 38 | Snacks | Lay’s Clásicas | 134 g | NO |  | FOTO | Falta foto propia (sólo existía una edición con marca de torneo). |
| 39 | Snacks | Lay’s Clásicas | 40 g | SI |  | OK |  |
| 40 | Snacks | Mani King Maní Salado sin Piel | 100 g | SI |  | OK |  |
| 41 | Snacks | Pehuamar Palitos Salados | 90 g | SI |  | OK |  |
| 42 | Vinos | Alamos Malbec | 750 ml | SI | +18 | NOMBRE | El envase de la foto dice «Alamos Malbec RESERVE»; el nombre no dice Reserve. |
| 43 | Vinos | Norton Select Malbec | 750 ml | SI | +18 | OK |  |
| 44 | Vinos | Santa Julia Chenin Dulce Natural | 750 ml | SI | +18 | OK |  |
| 45 | Vinos | Trapiche Cabernet Sauvignon | 750 ml | SI | +18 | NOMBRE | El envase dice «Trapiche RESERVA Cabernet Sauvignon»; el nombre no dice Reserva. |
| 46 | Vinos | Trapiche Red Blend | 750 ml | SI | +18 | NOMBRE+IMAGEN | El envase dice «Trapiche RESERVA Red Blend» y la foto es una etiqueta de edición con escudo de un club. |

## Cómo se repite esta auditoría

Las pruebas que la sostienen corren en CI con la misma copia del catálogo:

- `tests/catalog-runtime-contract.test.mjs` — título y presentación de las 46.
- `tests/catalog-frontend-polish.test.mjs` — marca, retornable, nombres largos.
- `tests/e2e/catalog-polish.spec.mjs` — orden, nombres sin cortar, favoritos,
  búsqueda, en Chromium y en WebKit.
