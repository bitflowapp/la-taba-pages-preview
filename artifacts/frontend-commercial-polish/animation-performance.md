# Performance — antes y después

Fecha: 2026-10-01. Base: `bae464f` (PR #129).

La tabla del teléfono se midió sobre `3b171e3`. Los dos commits de código
posteriores (`1936e9d` y la fusión `fd54619`) agregan sobre eso un ordenamiento
de 46 elementos por carga de catálogo, un cambio de maqueta en 13 tarjetas de la
home y la limpieza de la nota de la ficha que trae el PR #129; esa tabla no se
repitió después. La tabla de escritorio sí se midió sobre el commit final,
`273c4e8`.

## Cómo se midió, y una corrección

Tienda en modo producción, 46 fichas reales, 42 fotos reales, servida desde la
máquina local. Chromium con CDP. Perfil «teléfono»: 390 × 844, densidad 3, CPU
limitada 4x. Perfil «escritorio»: 1366 × 768, sin límite.

**La primera tabla que armé estaba mal comparada.** Medí la base a una hora y la
rama a otra, con otros procesos corriendo en la misma máquina, y la diferencia
de carga entre las dos tandas se sumó a la mejora: el scroll del catálogo
aparecía pasando de 24,5 a 59 fps y el LCP de 4.068 a 2.508 ms. Al repetirlo
bien —base y rama **intercaladas**, tres rondas, nueve corridas por lado, la
base servida desde una copia exacta de `bae464f` en otro puerto— la mejora es
real pero más chica, y el LCP no cambió. Los números de abajo son los
intercalados. Los de la primera tanda se descartaron.

Aun intercaladas, las corridas se mueven: esta máquina tiene otros agentes
trabajando. Por eso se informa la mediana **y el rango**.

## Teléfono: base contra rama (mediana de 9, rango entre corchetes)

| Métrica | Base `bae464f` | Rama `3b171e3` | Lectura |
|---|---:|---:|---|
| FPS · scroll del catálogo, 1.ª pasada | 45,1 [44,3 – 48,9] | 54,9 [24,3 – 59,8] | Mejora. Dos corridas de la rama cayeron a 24 y 34 por tropiezos de la máquina |
| FPS · scroll del catálogo, 2.ª pasada | 45,8 [4,9 – 48,9] | 58,0 [18,1 – 60] | Mejora |
| FPS · scroll de la home | 57,0 [50,8 – 58,2] | 58,3 [52,4 – 60] | Sin cambio medible |
| Cuadro p95 · catálogo | 33,2 ms | 16,8 ms | Mejora |
| LCP | 3.556 ms [2.724 – 4.176] | 3.372 ms [2.716 – 3.864] | Sin cambio medible |
| FCP | 480 ms [392 – 616] | 504 ms [368 – 536] | Sin cambio medible |
| CLS (carga y scroll) | 0 | 0 | Igual |
| DOM_NODE_COUNT | 2.726 | 2.738 | +12 (el hueco de campaña y el aviso de búsqueda) |
| MEMORY (heap JS) | 13,1 MB [11,6 – 14,8] | 14,0 MB [12,4 – 14,8] | Sin cambio medible |
| NETWORK_REQUESTS (home) | 165 | 174 | +9: los módulos y la hoja de campañas |
| IMAGE_REQUESTS (home) | 34 | 34 | Igual |
| IMAGE_REQUESTS (catálogo) | 45 | 46 | Igual (±1 por la foto de la ficha) |
| Bytes de imágenes · catálogo | 1.856.079 | 471.164 | −75 %: miniaturas en vez de masters |
| Bytes de imágenes · home | 1.923.661 | 1.034.131 | −46 % |
| Bytes totales · home | 5.843.340 | 5.055.814 | −787 kB: −890 kB de fotos, +102 kB de JS y CSS sin comprimir |
| LONG_TASKS · catálogo, cantidad | 37 [32 – 44] | 18 [15 – 46] | Mejora |
| LONG_TASKS · catálogo, tiempo | 8.988 ms [7.515 – 14.895] | 5.944 ms [4.370 – 12.180] | −34 % |
| LONG_TASKS · home, tiempo | 3.198 ms | 2.585 ms | Mejora leve |
| Tecla del buscador, promedio | 378 ms [223 – 408] | 236 ms [180 – 248] | −38 % |
| Tecla del buscador, la peor | 502 ms | 311 ms | −38 % |
| Imágenes vueltas a bajar | 0 | 0 | Igual |
| Errores de consola | 0 | 0 | Igual |

Con CPU 4x las tareas largas son muchas en los dos lados: es un teléfono lento
simulado renderizando 46 tarjetas. Lo que la rama cambia es cuánto de ese tiempo
se gasta al scrollear.

## Escritorio: base contra rama (mediana de 6, rango entre corchetes)

1366 × 768, sin limitar la CPU. Medido sobre el commit final (`273c4e8`), base y
rama intercaladas, dos rondas de tres corridas por lado.

| Métrica | Base `bae464f` | Rama `273c4e8` | Lectura |
|---|---:|---:|---|
| FPS · scroll del catálogo, 1.ª pasada | 31,0 [21,9 – 34,4] | 46,9 [14,8 – 53] | Mejora. Una corrida de la rama cayó a 14,8 |
| FPS · scroll del catálogo, 2.ª pasada | 28,3 [1 – 29,3] | 34,1 [20,7 – 59,1] | Mejora, con rangos que se pisan |
| FPS · scroll de la home | 44,3 [40,7 – 53,9] | 50,2 [17 – 55,5] | Sin cambio medible |
| LCP | 2.372 ms [1.900 – 3.600] | 2.368 ms [1.740 – 3.356] | Sin cambio |
| FCP | 276 ms [240 – 692] | 324 ms [220 – 556] | Sin cambio medible |
| CLS | 0 | 0 | Igual |
| DOM_NODE_COUNT | 2.726 | 2.738 | +12 |
| MEMORY (heap JS) | 10,9 MB | 11,6 MB | +0,7 MB |
| NETWORK_REQUESTS (home) | 165 | 174 | +9: módulos y hoja de campañas |
| IMAGE_REQUESTS (home) | 34 | 34 | Igual |
| Bytes de imágenes · catálogo | 468.677 | 468.677 | Igual: a densidad 1 ya bajaba la miniatura |
| Bytes totales · home | 5.172.980 | 5.278.312 | +105 kB de JS y CSS sin comprimir |
| LONG_TASKS · catálogo, cantidad | 61,5 [40 – 67] | 15 [9 – 25] | Mejora |
| LONG_TASKS · catálogo, tiempo | 9.707 ms [9.441 – 20.685] | 4.361 ms [1.255 – 13.522] | −55 % |
| Tecla del buscador, promedio | 80 ms [74 – 167] | 75 ms [53 – 89] | Mejora leve en esta tanda |
| Errores de consola | 0 | 0 | Igual |

En escritorio la rama **no ahorra bytes**: suma 105 kB. El ahorro de fotos es del
teléfono, que era el que bajaba la foto grande.

Hay una segunda tanda intercalada, anterior, que quedó incompleta porque la
máquina se apagó: seis corridas de la base y tres de la rama. Va en la misma
dirección, con otra magnitud, y se deja porque muestra cuánto se mueven estos
números de una hora a otra en esta máquina:

| Métrica | Base (6 corridas) | Rama (3 corridas) |
|---|---:|---:|
| FPS · scroll del catálogo, 1.ª pasada | 14,5 [5,5 – 25,7] | 39,7 [20,3 – 43] |
| LONG_TASKS · catálogo, tiempo | 13.254 ms [9.683 – 26.462] | 2.016 ms [1.926 – 13.297] |
| Tecla del buscador, promedio | 98,5 ms [81 – 118] | 54 ms [53 – 69] |
| LCP | 2.256 ms [1.984 – 2.916] | 1.964 ms [1.588 – 2.396] |

Lo que se sostiene en las dos tandas: el scroll del catálogo mejora, las tareas
largas bajan a menos de la mitad, y el LCP no cambia de forma demostrable. La
tecla del buscador en escritorio mejora entre 6 % y 45 % según la tanda: no
alcanza para dar un número.

La causa de fondo del scroll (F-01 en `frontend-audit.md`) se midió aparte y no
depende de la carga de la máquina: el recálculo de estilo durante el recorrido
pasó de 1.141 – 1.149 ms a 2 ms.

## El costo de las campañas

Las campañas están apagadas en lo que se publica: su costo real hoy es la hoja y
los módulos que se cargan igual.

| | Bytes | Comprimido |
|---|---:|---:|
| `styles/campaigns.css` | 38.389 | 9.225 |
| `campaign-engine.js` | 11.448 | 4.372 |
| `campaign-motion.js` | 7.015 | 2.719 |
| `campaign-config.js` | 4.067 | 1.702 |
| `presets/` (5 archivos) | 8.621 | 4.300 |
| **Total** | **69.540** | **22.318** |

Son 9 pedidos más en la carga. Con el service worker quedan precargados.

Encendidas (configuración de QA, tres piezas: banda de apertura, franja de la
home y pieza en la grilla), en una ventana con GPU real a 60 Hz, sin limitar la
CPU, dos rondas intercaladas:

| Métrica | Sin campañas | Con campañas |
|---|---:|---:|
| FPS · mientras corre la escena de la banda (teléfono) | 60,1 | 58,4 – 58,9 |
| Cuadros de más de 20 ms durante la escena (de ~355) | 0 | 7 – 11, el peor de 33 ms |
| FPS · mientras corre la escena de la banda (escritorio) | 60,1 | 59,9 – 60,1 |
| FPS · escena de la franja | — | 59,3 – 60,1 |
| FPS · con la escena terminada | 60,1 | 60,1 |
| Cuadro promedio · scroll del catálogo | 16,6 – 18,3 ms | 16,6 – 17,3 ms |
| Recálculo de estilo en ese scroll | 3 – 6 ms | 27 – 35 ms |
| DOM_NODE_COUNT | 2.738 | 2.863 (+125 por tres piezas) |
| Oyentes de eventos (CDP) | 135 | 135 |
| Heap JS (CDP) | 7,5 MB | 7,4 – 8,3 MB |
| CLS | 0 | 0 |
| LCP (teléfono, CPU 4x, tandas contiguas) | 4.032 ms | 4.176 ms |
| IMAGE_REQUESTS | 34 | 34: las escenas no piden ninguna imagen |

Lectura: en el teléfono la escena de la cerveza cuesta entre 1 y 2 cuadros por
segundo mientras dura (5,6 s) y nada después. No agrega oyentes ni imágenes. El
scroll del catálogo con una pieza en la grilla recalcula 25–30 ms más de estilo
en todo el recorrido, sin efecto en el cuadro promedio.

Nodos por escena: `beer_pour` 37, `cold_can` 31, `ice_reveal` 28,
`product_drop` 17.

## Qué hace que la animación sea barata

| Decisión | Verificado por |
|---|---|
| Sólo `transform` y `opacity` | Una prueba lee la hoja y falla si una animación toca otra propiedad |
| Sin `filter: blur`, sin sombras animadas | La misma prueba |
| Marcado estático: ningún nodo se crea en ejecución | 0 reemplazos de piezas en 5 minutos de uso |
| Un solo IntersectionObserver para todas las piezas | `observerCount: 1` en el diagnóstico |
| Pausa fuera de pantalla y con la pestaña oculta | E2E: las animaciones pasan a `paused` |
| Los bucles terminan solos (seis vueltas) | E2E: 0 animaciones corriendo a los ~26 s |
| Sin `setTimeout`, `setInterval` ni `requestAnimationFrame` en el módulo | Prueba sobre el código |
| Con movimiento reducido no arranca nada | E2E en Chromium y WebKit: 0 animaciones |

## Lo que no se midió

- Un teléfono físico. El perfil «teléfono» es Chromium de escritorio con la CPU
  limitada: sirve para comparar antes y después, no para afirmar los fps de un
  Moto G.
- FPS en WebKit: sin ventana, en Windows, entrega unos dos cuadros por segundo a
  `requestAnimationFrame`, y cualquier número sería del arnés y no de la tienda.
- Consumo de batería.
