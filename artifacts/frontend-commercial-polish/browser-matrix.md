# Matriz de navegadores y tamaños

Commit medido: `1936e9d`. Fecha: 2026-10-01.

Motores: Chromium (Playwright 1.60, build 1223) y WebKit (build 2287), en
Windows 11. Tienda en modo producción, 46 fichas reales, 42 fotos reales.

**Lo que esta matriz no cubre:** un iPhone físico y un Android físico. WebKit de
Playwright es el motor de Safari, no Safari en un teléfono: el teclado en
pantalla, la barra que se esconde al scrollear y el gesto de volver no se
ejercitan acá.

## Resultado: 20 de 20

Cada celda es una corrida con las campañas apagadas (como se publica) y otra con
las campañas de QA encendidas.

| Tamaño | Chromium · sin campañas | Chromium · con campañas | WebKit · sin campañas | WebKit · con campañas |
|---|---|---|---|---|
| 360 × 800 | PASS | PASS | PASS | PASS |
| 390 × 844 | PASS | PASS | PASS | PASS |
| 430 × 932 | PASS | PASS | PASS | PASS |
| 1366 × 768 | PASS | PASS | PASS | PASS |
| 1920 × 1080 | PASS | PASS | PASS | PASS |

Qué tiene que cumplir una celda para pasar, en home, catálogo y ficha:

| Criterio | Cómo se mide |
|---|---|
| Sin scroll horizontal | `scrollWidth` del documento igual al ancho de la ventana |
| Ningún texto cortado | títulos, nombres, precios, acciones y textos de la pieza: `scrollWidth`/`scrollHeight` contra su caja |
| Nada fuera de la ventana | tarjetas, piezas, buscador y controles con el borde derecho adentro |
| Barra superior fija | sigue en `top: 0` después de scrollear |
| Navegación inferior pegada | separación 0 con el borde de la ventana (teléfono) |
| Ficha del producto | entra en la ventana, con el botón de cerrar a la vista |
| La escena no se sale de la pieza | caja de la escena adentro de la caja de la pieza |
| Consola | 0 errores |

Capturas: `after/matrix/` (70 imágenes: home, catálogo, ficha y pieza, por motor,
por tamaño y por estado de campañas).

## Cuánto ocupa una pieza

| Tamaño | Banda de apertura | % de la ventana | Franja o pieza de grilla | % de la ventana |
|---|---|---:|---|---:|
| 360 × 800 | 336 × 101 px | 13 % | 336 × 166 px | 21 % |
| 390 × 844 | 358 × 105 px | 12 % | 358 × 166 px | 20 % |
| 430 × 932 | 398 × 114 px | 12 % | 398 × 166 px | 18 % |
| 1366 × 768 | 1020 × 270 px | 35 % | 1020 × 210 px | 27 % |
| 1920 × 1080 | 1020 × 270 px | 25 % | 1020 × 210 px | 19 % |

La banda de apertura ocupa la misma caja que la puerta editorial que ya estaba:
no agrega alto. Con la pieza puesta, el primer «Agregar» queda a 671 px a
390 × 844 (pliegue útil 788) y a 655 px a 360 × 800 (pliegue útil 744).

## El defecto que encontró la matriz

En Chromium, el título del rubro («Todas», «Jugos») perdía el pie de las letras
con descendente: la caja del título recortaba 2–3 px. En WebKit no pasaba.
Corregido en `3b171e3`. Antes y después: `before/defects/` y `after/defects/`.

## Recorrido de navegación

Mismo guion en los dos motores, a 390 × 844, con campañas apagadas y encendidas.

| Paso | Chromium | WebKit |
|---|---|---|
| Chip de rubro en la home → catálogo filtrado («Cervezas», 8 tarjetas) | PASS | PASS |
| Abrir la ficha no mueve el scroll de atrás (420 → 420) | PASS | PASS |
| Cerrar la ficha devuelve el foco a la tarjeta | PASS | PASS |
| Agregar dos productos → contador «2» → carrito con 2 renglones | PASS | PASS |
| «Atrás» desde el carrito vuelve al catálogo con el rubro elegido | PASS | PASS |
| Recargar conserva la vista y el carrito | PASS | PASS |
| Buscar desde la home salta al catálogo con la consulta puesta | PASS | PASS |
| Limpiar la búsqueda devuelve las 46 | PASS | PASS |
| Ruta desconocida → home | PASS | PASS |
| Errores de consola | 0 | 0 |

Dos comportamientos que son así a propósito y no se cambiaron: «Atrás» deja el
catálogo arriba y no en la posición anterior, y después de recargar el rubro
vuelve a «Todas».

## Suite E2E del repositorio

Proyectos `chromium` y `mobile-webkit` de `playwright.config.mjs`. Los
resultados están en `qa-results.md`.

## Diferencias entre motores

| Tema | Chromium | WebKit |
|---|---|---|
| Animación de las piezas | corre | corre; mismas 18–19 animaciones por escena |
| Pausa fuera de pantalla | `paused` | `paused` |
| Movimiento reducido | cuadro final, 0 animaciones | cuadro final, 0 animaciones |
| `color-mix()` del fondo de la pieza | soportado | soportado (desde Safari 16.2; antes, fondo grafito) |
| Medición de saltos de maqueta | API `layout-shift` | la API no existe: no se puede medir, y no se informa como 0 |
| Prueba de brillo cuadro a cuadro | corre | omitida: WebKit sin ventana en Windows entrega ~2 cuadros por segundo a `requestAnimationFrame`, y la prueba mide tiempos entre cuadros |
