# Informe final — catálogo y frontend de La Taba

Fecha: 2026-10-01.

## Resumen

El catálogo se lee mejor, el scroll dejó de tartamudear, el teléfono baja un
cuarto de los bytes de fotos, la búsqueda perdona el tipeo y existe un sistema
de piezas animadas listo y **apagado**. Nada de esto está publicado: producción
no se tocó.

El catálogo no está listo para vender, y eso no lo resuelve el frontend: las 46
fichas siguen sin precio, stock ni disponibilidad comercial, y 12 tienen un dato
que sólo puede confirmar el comercio.

En el camino rompí dos cosas y las arreglé antes de entregar. Están contadas en
`frontend-audit.md` («Tres errores propios») porque una de ellas dejó el CI en
rojo con 38 pruebas.

```text
TABA_FRONTEND_CATALOG_FINAL_REPORT

REPO:            bitflowapp/la-taba-pages-preview
WORKTREE:        la-taba-frontend-polish (aislado; ningún otro worktree se tocó)
BRANCH:          feat/taba-frontend-commercial-polish
HEAD_INITIAL:    bae464f  (cabeza del PR #129 al empezar)
HEAD_CODE:       fd54619  (último commit con código; lo que sigue es documentación)
BASE:            fix/taba-catalog-runtime-stability (PR #129), fusionada hasta c1dc3aa

CATALOG_TOTAL:               46
CATALOG_VALIDATED:           34
CATALOG_NEEDS_CONFIRMATION:  12
IMAGE_CORRECT:               40
IMAGE_NEEDS_REVIEW:          2   (más 4 fichas sin imagen)
NAME_CORRECT:                37
NAME_NEEDS_REVIEW:           9
DUPLICATES:                  0

FLICKER_REGRESSION:          NONE
CARD_REPLACEMENTS:           0
IMAGE_NODE_REPLACEMENTS:     0
IMAGE_REDOWNLOADS:           0   (caché real, contado en el servidor)
UNEXPECTED_RENDER_CYCLES:    0
CONSOLE_ERRORS:              0
NETWORK_ERRORS:              0
LAYOUT_SHIFTS:               2 en 5 min (CLS 0,003), los dos al buscar; 0 en carga y scroll
LIVE_CHANGE_SCOPE:           sólo la tarjeta del producto (4 mutaciones, 0 nodos reemplazados)

ANIMATION_PRESETS:           beer_pour, cold_can, product_drop, ice_reveal
CAMPAIGNS_ENABLED:           0 de 4   (todas con enabled:false y aprobación PENDIENTE)
REDUCED_MOTION:              PASS
ANIMATION_FALLBACK:          PASS   (con movimiento reducido o si el módulo falla: cuadro final)
ANIMATION_FPS:               58,4 – 60,1 mientras corre la escena; 60,1 después
CART_INTERFERENCE:           NONE
ACCESSIBILITY:               0 violaciones axe (WCAG 2.2 AA) en home, catálogo, ficha y carrito
BROWSER_MATRIX:              20 de 20 (5 tamaños × Chromium y WebKit × con y sin campañas)

PRICE_CHANGED:               NO
STOCK_CHANGED:               NO
PUBLICATION_CHANGED:         NO
PRODUCT_DATA_CHANGED:        NO
BACKEND_CHANGED:             NO   (SQL, RLS, Edge Functions, máquina de estados: sin tocar)
STAGING_TOUCHED:             NO
PRODUCTION_TOUCHED:          NO

FRONTEND_READY:              YES, sujeto a CI verde en fd54619 (resultado en el PR)
CATALOG_TECHNICALLY_READY:   YES
COMMERCIAL_CATALOG_READY:    NO
```

## Commits

| Commit | Tema |
|---|---|
| `a46913f` | Catálogo y UX: orden por rubro, nombres, marca, retornable, búsqueda tolerante |
| `229c478` | Performance: brillo de la góndola, miniaturas en el teléfono, memoización |
| `bb4cd52` | Campañas animadas: motor, configuración y cuatro escenas |
| `ae51d6b` | Accesibilidad: corazón de favoritos, nombre propio de cada anuncio |
| `649fd10` | Campañas: respaldo si el movimiento no arranca; texto que no puede prometer |
| `a2503a8` | Pruebas: unitarias y E2E en Chromium y WebKit |
| `c9bd231` | Publicación: versión de caché y de hojas, identidad firmada |
| `3b171e3` | Cambio en vivo acotado a su tarjeta; título del rubro |
| `1936e9d` | Corrige dos regresiones propias: orden de la demo y presentación en la vidriera |
| `fd54619` | Fusiona el commit nuevo del PR #129; caché v136 |
| siguiente | Documentación y evidencia |

## Qué cambió para quien compra

| Antes | Ahora |
|---|---|
| «Todas» abría con un Malbec, un aperitivo, un agua y una cerveza | Abre por rubro, en el orden de los chips |
| El scroll del catálogo recalculaba el estilo de las 46 tarjetas a cada paso | No recalcula nada mientras se mueve |
| Un teléfono de densidad 3 bajaba 1,86 MB de fotos en el catálogo | Baja 0,47 MB |
| «cocacola», «heiniken», «1 litro», «vino tinto»: cero resultados | Encuentran, y lo parecido se dice que es parecido |
| El corazón de favoritos no se veía | Se ve, guardado y sin guardar |
| En la home, «Coca-Cola Sin…» al lado de «Coca-Cola» | El nombre usa sus dos renglones; el tamaño siempre a la vista |
| «Schweppes Pomelo Sin…» en la grilla | Entero |
| Brahma «1 L» | «1 L · Retornable» |
| Cada tecla del buscador: 378 ms en un teléfono lento | 236 ms |

## Performance, en una línea por métrica

Teléfono simulado (390 × 844, densidad 3, CPU 4x), base y rama intercaladas,
mediana de 9 corridas. El detalle y los rangos están en
`animation-performance.md`.

| | Base | Rama |
|---|---:|---:|
| FPS, scroll del catálogo | 45,1 | 54,9 |
| FPS, scroll de la home | 57,0 | 58,3 |
| LCP | 3.556 ms | 3.372 ms (sin cambio medible) |
| CLS | 0 | 0 |
| DOM_NODE_COUNT | 2.726 | 2.738 |
| MEMORY | 13,1 MB | 14,0 MB (sin cambio medible) |
| IMAGE_REQUESTS, home | 34 | 34 |
| NETWORK_REQUESTS, home | 165 | 174 |
| Bytes de fotos, catálogo | 1.856.079 | 471.164 |
| LONG_TASKS, catálogo | 8.988 ms | 5.944 ms |

Una primera versión de esta tabla decía 24,5 → 59 fps y LCP 4.068 → 2.508 ms.
Estaba mal comparada —la base y la rama se habían medido con distinta carga en
la máquina— y se descartó.

## Las piezas animadas

Cuatro escenas hechas con HTML, CSS y JavaScript nativo: sin librerías, canvas,
video ni imágenes. Se configuran en un archivo y hoy están las cuatro apagadas.
Para que una se vea hacen falta dos llaves (`enabled` y una aprobación con
referencia) y que el producto exista y se pueda comprar en ese momento. No
pueden mencionar precio, porcentaje, oferta ni urgencia: el motor descarta la
pieza si el texto lo hace.

Las cuatro candidatas apuntan a productos que existen en el catálogo: Heineken
710 ml, Red Bull 355 ml, Coca-Cola 2,25 L y Aperol 750 ml. Ninguna se enciende
sin que el comercio apruebe texto, producto y vigencia.

El envase que se anima es una silueta genérica con el color de la campaña. No
lleva logotipo ni emblema de ninguna marca: una creatividad con marca tiene que
salir del lote curado con procedencia, y acá no se dibujó ni se generó ninguna.

Diseño: `animation-design.md`. Videos: `videos/`.

## Lo que queda abierto

| # | Qué | De quién depende |
|---|---|---|
| 1 | Precio, stock y disponibilidad de las 46 fichas | Walter |
| 2 | Cepita Naranja y Cinzano Rosso: presentación, tamaño y código | Walter |
| 3 | Foto de Lay’s Clásicas 134 g y Pepsi Black 2,25 L | Comercio |
| 4 | Seis nombres donde el envase dice otra palabra (Reserve, Reserva, Zero) | Walter |
| 5 | Qué hielo se vende | Walter |
| 6 | Aprobar o descartar cada una de las cuatro campañas | Walter |
| 7 | El PR #129, del que esta rama depende, sigue en borrador | Quien lo revise |
| 8 | Prueba en un teléfono físico: no se hizo | Pendiente |
| 9 | Cada tecla del buscador renderiza la tienda entera (236 ms en un teléfono lento) | Frontend, otra rama |
| 10 | En la home, a 360 px, «Brahma Chopp Rubia» pierde «Rubia» para que entre «1 L · Retornable» | Decisión de diseño: nombre más corto o un tercer renglón |

## Compuertas externas

- CI sobre `fd54619` y sobre el commit de documentación.
- Revisión y fusión del PR #129.
- Datos comerciales de Walter.
- Prueba en dispositivo.

## Evidencia

Todo en `artifacts/frontend-commercial-polish/`:

| Archivo | Qué tiene |
|---|---|
| `catalog-audit.md` | Las 12 fichas a confirmar y la búsqueda |
| `frontend-audit.md` | Los 12 defectos, los 3 errores propios y lo que no se tocó |
| `animation-design.md` | Cómo están hechas las piezas y cómo se enciende una |
| `animation-performance.md` | Antes y después, con rangos |
| `browser-matrix.md` | 20 celdas y el recorrido de navegación |
| `qa-results.md` | CI, E2E, estrés, cambio en vivo, accesibilidad |
| `before/`, `after/`, `videos/` | 156 capturas y 8 videos |

La tabla de las 46 fichas está en `catalog/catalog-frontend-audit.md`.
