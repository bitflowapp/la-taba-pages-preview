# Rendimiento · línea integrada `d98184f`

Moto G15 (lamu_g, ZY32LHS6PS), Android 15, 1080×2400 @ 400 dpi.
Build **profile**. Un build debug no tiene AOT y sus tiempos no se comparan con
nada.

---

## 1 · Jank por frame — medido

Fuente: `SchedulerBinding.addTimingsCallback`, que entrega por cada frame su
`buildDuration` y su `rasterDuration`. Son las dos series que DevTools grafica
en su panel de rendimiento, tomadas del motor y en proceso.

Hay **calentamiento antes de medir**: se abren y descartan las tres pantallas
más pesadas —mapa con teselas, hoja con cuenta regresiva y ficha larga— para no
contar como UX normal la compilación de shaders y el armado de cachés que un
repartidor paga una sola vez.

Milisegundos. Un frame cuenta como perdido si **cualquiera** de sus dos mitades
se pasó del presupuesto.

| escenario | frames | build medio | build p90 | build p99 | peor build | raster medio | raster p90 | raster p99 | peor raster | >16,7 ms | >33 ms | jank |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 01 arranque → mapa | 139 | 0,89 | 0,53 | 10,09 | 23,47 | 4,92 | 5,91 | 7,95 | 14,49 | 1 | 0 | 0,72 % |
| 02 pan y zoom | 223 | 0,70 | 1,63 | 5,28 | 5,45 | 8,29 | 22,09 | 23,11 | 24,47 | 31 | 0 | **13,90 %** |
| 03 fuera de turno → Trabajar ahora | 106 | 3,96 | 5,61 | 9,21 | 14,71 | 6,43 | 7,65 | 14,97 | 16,80 | 1 | 0 | 0,94 % |
| 04 oferta aparece | 221 | 2,28 | 1,45 | 21,91 | **40,12** | 6,87 | 8,03 | 8,94 | 9,48 | 10 | 1 | 4,52 % |
| 05 hoja: abrir, cerrar, arrastrar | 130 | 3,81 | 5,89 | 20,79 | 20,91 | 8,09 | 9,31 | 18,07 | 23,19 | 11 | 0 | 8,46 % |
| 06 oferta → aceptada | 133 | 2,14 | 2,40 | 21,85 | 23,89 | 6,73 | 7,09 | 13,18 | 21,71 | 6 | 0 | 4,51 % |
| 07 navegación de retiro | 139 | 2,08 | 3,73 | 19,10 | 21,98 | 6,62 | 6,61 | 16,98 | 25,18 | 6 | 0 | 4,32 % |
| 08 ficha de entrega con scroll | 294 | 2,51 | 4,85 | 17,21 | **42,09** | 7,22 | 8,13 | 19,51 | 23,11 | 9 | 1 | 3,06 % |
| 09 entregado → idle | 290 | 1,85 | 3,27 | 16,61 | **38,09** | 6,29 | 6,52 | 8,77 | 24,00 | 4 | 1 | 1,38 % |

**1.675 frames · 79 por encima de 16,7 ms (4,72 %) · 3 por encima de 33 ms
(0,18 %). Peor frame de toda la corrida: 42,09 ms, en la ficha con scroll, del
lado de construcción.**

### 10 · segundo plano → primer plano: NO capturado

Su medición de frames no está. La corrida completa dura varios minutos y se
cortó dos veces antes de llegar al último escenario; el reintento dirigido
—`--dart-define=JANK_SOLO=10-fondo`, que existe justamente para recuperar uno
suelto— tampoco llegó a imprimir. No se inventa una cifra.

Lo que sí está verificado de ese caso, del gate físico anterior y por otra vía:
salir con el botón de inicio y volver conserva **el mismo PID** (1476 antes y
después), deja **un solo proceso**, y la pantalla vuelve a su estado. Eso
descarta recreación de actividad y procesos duplicados, que es el riesgo real;
no dice nada sobre fluidez.

### Atribución

Son dos fenómenos distintos y ninguno es el mismo problema.

**Pan y zoom concentra 31 de los 79 frames perdidos, y es puramente de
rasterizado.** Raster medio 8,29 y p99 23,11, contra un build que ni se
despeina: medio 0,70 y peor 5,45. Es composición de teselas ráster de
OpenStreetMap mientras el mapa se arrastra. Ningún frame pasa de 33 ms, así que
se siente como leve falta de suavidad, no como tirón. **La causa no es local**:
se resuelve con teselas vectoriales o con otro proveedor, que es exactamente la
decisión de proveedor de tiles ya anotada como POST-PILOT.

**Los tres frames por encima de 33 ms son del lado de construcción y caen los
tres en el mismo momento**: el primer layout de una pantalla nueva —abrir la
oferta, abrir la ficha larga, abrir entregado—. Uno por transición, no
repetidos, y en esos mismos escenarios el p90 queda entre 1,45 y 4,85 ms. Es el
costo de armar el árbol una vez, no un problema sostenido.

### Qué NO se corrigió, y por qué

Nada. Ninguno de los dos hallazgos es «P1 o P2 claro y local»:

- el ráster del mapa es una decisión de proveedor de teselas, no un defecto de
  código de esta línea;
- ganar el frame del primer layout exigiría reestructurar cómo se construyen las
  hojas, que es tocar funcionalidad sin una regresión material demostrada.

Con 0,18 % de frames por encima de 33 ms y ninguno en el recorrido operativo
crítico salvo en transiciones de pantalla, no hay regresión material que
justifique el riesgo.

---

## 2 · Memoria — sin regresión

Tres arranques en frío, `dumpsys meminfo` tras abrir el estado «disponible»:

| | TOTAL PSS | TOTAL RSS |
|---|---|---|
| arranque 1 | 175.506 KB | 262.800 KB |
| arranque 2 | 170.335 KB | 258.056 KB |
| arranque 3 | 169.995 KB | 257.896 KB |

Línea base `ae90ab6` (handoff anterior, mismo aparato, mismo modo de build):
191.164 / 191.516 / 191.119 KB.

**La línea integrada usa entre 8 % y 11 % menos memoria que la base**, con
identidad y biometría adentro. No se busca crédito por eso: la comparación se
hace para descartar regresión y la descarta con margen. El estado del aparato no
es idéntico entre ambas mediciones, así que la lectura honesta es «no hay
regresión material», no «mejoró un 11 %».

Los tres arranques en frío de arriba son la medición rigurosa. Además se
muestreó PSS durante las corridas de jank, y ahí las lecturas sueltas cayeron
entre **163 y 223 MB**, con el mapa cargado y teselas en memoria. **No es una
serie**: cada vez que una corrida se cortó, el muestreador se cortó con ella y
el archivo quedó con lo de la última —hoy, una sola muestra de 223.142 KB, que
es la que se conserva en `memoria-durante-jank.txt`—. Sirve como orden de
magnitud consistente con los arranques en frío y con la base; no se presenta
como curva ni se saca de ahí ninguna conclusión sobre fugas.

---

## 3 · Sin baseline de frames: no se compara contra la base

La base `ae90ab6` declara «frames de SurfaceFlinger»: 124 frames, medio
16,63 ms, jank 0,0 %. **Esa cifra no se compara con la de este informe** y no se
usa como referencia, porque no hay una medición profile equivalente: se tomó con
un método que en este aparato ya no devuelve datos.

Para el próximo que lo intente, lo que no funciona y por qué:

- `dumpsys SurfaceFlinger --latency <capa>` devuelve el período correcto
  (16.666.667 ns) y después **129 filas de ceros**. La capa se identifica bien
  —`SurfaceView[com.lataba.rider.review/...]`, extraída del envoltorio
  `RequestedLayerState{...}` del listado nuevo— pero no registra frames
  presentados. Es el frontend nuevo de SurfaceFlinger de Android 15.
- `dumpsys gfxinfo <paquete>` informa **0 frames** aun con el mapa
  arrastrándose visiblemente en pantalla. Mide HWUI, y Flutter no dibuja por
  HWUI.

Lo que sí funciona es lo de la sección 1.

### Y lo que no hay que usar para correrlo

`flutter drive`, después de cuatro intentos:

- `traceAction` necesita abrir el VM Service desde dentro del proceso y con DDS
  activo no puede. El propio error lo dice —«try adding `--no-dds`»— pero llega
  truncado por logcat y parece otra cosa.
- Con `--no-dds`, el que deja de conectarse es `flutter_driver` del lado del
  host, que se cae en `checkHealth`. Las dos mitades quieren lo contrario.
- Y al terminar corre **`adb uninstall` sin preguntar**; en una de las corridas
  contra `com.lataba.rider`, el id de **producción**. Falló sólo porque esa app
  no está instalada en este teléfono. En uno que la tenga, se la lleva puesta.

El arnés final no usa driver: `flutter run --profile` con el test como punto de
entrada, y `addTimingsCallback` en proceso.

```
flutter run --profile --flavor commercialReview \
  -t integration_test/jank_profile_test.dart -d ZY32LHS6PS --no-dds
```

---

## 4 · Lo demás, sin cambios respecto del handoff

- **Cero animaciones nuevas.** La barra de la oferta se repinta con el tick de
  un segundo que el controlador ya corría; no agrega ticker.
- **Una sola instancia de mapa** a lo largo de los siete estados, con identidad
  de elemento verificada por `always_on_map_test.dart`.
- **Un listener por controlador** después de siete transiciones.
- **Cero adquisiciones y cero publicaciones de GPS nuevas.**
- **Un solo proceso** en el aparato, antes, durante y después de la prueba de
  red y del viaje a segundo plano.
