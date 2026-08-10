# Seguimiento en vivo del cliente — informe

Rama `feature/taba2-live-tracking-production-ux`, en un worktree propio bajo el
directorio de worktrees del proyecto. Tres commits de producto sobre `da56ce9`.

---

## 1. Qué base se eligió, y por qué

**Base: `da56ce9`, `release/taba2-commercial-candidate`.** Es exactamente lo que
staging sirve hoy, verificado contra la URL pública y no contra un lock:

| medido en `https://taba2-staging.pages.dev` | valor |
|---|---|
| `sw.js` → `CACHE_NAME` | `la-taba-runtime-v55-gondola-comercial` |
| hojas de estilo | `?v=45` |
| `js/app.js` | `?v=38` |

Eso coincide con `da56ce9` y con nada más.

El aviso del encargo era correcto: **el worktree histórico de
`feature/taba2-tracking-visual-polish` (`4ea98c6`) está atrasado** — su trabajo ya
está mergeado dentro de `da56ce9`, así que partir de ahí habría sido retroceder.
Verificado con `merge-base --is-ancestor`.

La línea más nueva es lineal y no divergente:

```
da56ce9  ← lo que sirve staging
   └── e59ac1c  feature/taba2-digital-commerce-100   (certificado, sin desplegar)
          └── 59d8e03  fix/taba2-order-intake-dispatch  (5 migraciones sin aplicar)
```

Se comprobó que **ninguna de las dos ramas posteriores toca el tracking ni el
mapa** (`git diff --name-only`: cero archivos de `js/map/`, `js/tracking/` o
`styles/tracking.css`). Por eso se ramificó desde `da56ce9`: el trabajo queda
ortogonal a ambas y se integra sin conflicto, sin arrastrar cinco migraciones
pendientes ni una dependencia de Vault que este encargo no necesita.

---

## 2. Medición del ANTES, sobre datos reales

191 fixes GPS reales del Moto G15 guardados por sesiones anteriores
(`artifacts/taba2-first-physical-e2e/gps-vivo`). Trazas de cadencia sana
(LT-0101, LT-0102, 67 fixes):

| | mediana | p90 | máx |
|---|---|---|---|
| cadencia entre fixes | 12,42 s | 12,52 s | 12,59 s |
| precisión (accuracy) | 11,8 m | 14,2 m | 20,0 m |
| salto entre fixes, equipo quieto | 0,90 m | 1,31 m | 2,24 m |
| latencia dispositivo → servidor | 0,19 s | 0,30 s | 0,58 s |

**El problema no nace en Android.** Precisión mediana de 11,8 m, jitter de 0,90 m
con el equipo detenido y latencia de 0,19 s son cifras buenas. Por eso **no se
tocó una sola línea del repo del Rider**: la medición no lo justifica, y el
encargo condicionaba ese cambio a que lo justificara.

El defecto estaba en el render:

> Los fixes llegan cada 12,4 s y el mapa los dibujaba con una animación fija de
> 420 ms. El marcador estaba **inmóvil el 96,9 % del tiempo** y daba un tirón de
> hasta **25 cm de un frame al siguiente**.

---

## 3. Bugs encontrados

1. **La frescura cortaba el movimiento.** `updateFreshness` cancelaba la
   animación en curso y plantaba el marcador de golpe sobre la coordenada
   medida. El publicador del Rider puede tardar hasta 15 s
   (`GPS_PUBLISH_MAX_MS`) y ése es exactamente el umbral de `fresh`: el corte
   ocurría en operación normal, no en un caso raro.
2. **La cámara sólo se movía cuando ya era tarde.** `maybeFollowRider` recentraba
   únicamente si el rider se había salido del viewport. La única forma de que la
   cámara «acompañara» era un salto.
3. **El CTA nuevo era inalcanzable.** A 15 px del borde, la atribución de
   MapLibre —que ocupa toda la franja inferior con su propio z-index— se comía el
   toque. Medido: el click aterrizaba en el contenedor.
4. **Un `mousemove` sobre el mapa cargando se leía como exploración.** Medido: a
   los 61 ms de abrir el seguimiento llegaba un `dragstart` nacido de un
   `mousemove`, y el cliente aparecía explorando un mapa que todavía no había
   visto.
5. **El arnés de capturas estaba roto desde el 8 de agosto.** Armaba pedidos
   delivery sin punto confirmado y moría con `DELIVERY_LOCATION_REQUIRED`. Se lo
   puso al día; no se relajó el contrato.

---

## 4. Movimiento visual: la regla

Dos posiciones, y son cosas distintas:

- **`measured`** — la coordenada que publicó el dispositivo. Es la verdad, es la
  que se persiste y es la única que se reporta.
- **`visual`** — dónde se dibuja el marcador ahora. Sale de interpolar entre dos
  posiciones medidas **reales**.

La interpolación va **siempre por detrás**, recorriendo un tramo que el rider ya
hizo. Nunca extrapola, nunca adivina hacia dónde sigue, nunca ajusta el trazo a
una calle. Si el fix siguiente no llega, el marcador termina su tramo y se queda
quieto sobre la última coordenada real: quedarse quieto es la respuesta honesta a
no tener dato nuevo.

### A/B sobre las mismas trazas reales

| | antes | después |
|---|---|---|
| marcador en movimiento | 3,1 % del tiempo | **51,7 %** |
| mayor desplazamiento en un frame | 24,7 cm | **1,0 cm** |
| fixes reales descartados por el filtro | — | **0** |

(El 51,7 % es sobre trazas del equipo **detenido**, donde el desplazamiento real
es puro jitter de menos de un metro. Con movimiento físico el porcentaje sube.)

El filtro descarta sólo lo que no puede ser cierto: coordenada inválida, reloj
adelantado, retroceso en el tiempo, precisión fuera de rango y velocidad
imposible. Un fix feo pero posible entra: la coordenada del backend sigue siendo
la verdad.

---

## 5. Estado de la señal

Cuatro estados, porque son las cuatro cosas distintas que pueden estar pasando:

| estado | texto | qué le dice al cliente |
|---|---|---|
| `live` | «Ubicación en vivo · ahora» | no hay nada que hacer |
| `delayed` | «Actualizado hace 22 s» | esperar, sigue viniendo |
| `weak` | «Señal GPS débil · hace 4 s» | el punto es aproximado |
| `offline` | «Sin conexión · última ubicación hace 2 min» | es lo último que se supo |

**En ningún estado se borra el rider ni se apaga el mapa.** Verificado en el
navegador: al envejecer el fix más allá del umbral, el mapa sigue visible, el
marcador sigue visible y el texto dice desde cuándo.

Antes, perder la señal mostraba «Ubicación temporalmente no disponible»: no
nombraba la causa y escondía la antigüedad, que es justo el dato con el que el
cliente decide si espera.

**Halo de precisión**: polígono geodésico en metros reales, no en píxeles. Con la
precisión habitual del equipo (11,8 m ≈ 6 px a zoom 16) queda tapado por el
marcador y no agrega ruido; con señal mala se ve y explica la incertidumbre.

---

## 6. Follow mode

`SEGUIR` ⇄ `EXPLORAR`. En seguir, la cámara va pegada a la posición **visual** del
marcador —que ya viene interpolada—, así que el encuadre se desliza en vez de dar
saltos. Cualquier gesto del cliente suspende el seguimiento y aparece el CTA
discreto «Volver al Rider», que devuelve la cámara con zoom útil y reactiva el
seguimiento.

Un gesto se distingue de un movimiento propio por `originalEvent` —sólo un dedo o
un mouse traen el evento del navegador que lo originó—, y sólo cuenta con el mapa
ya cargado.

### Decisión revisada: `cooperativeGestures` se queda

Se probó sacarlo para que arrastrar con **un** dedo moviera el mapa. **Fue un
error y se revirtió.** Sin esa opción MapLibre le pone `touch-action: none` al
lienzo y se queda con el arrastre vertical: el cliente deja de poder scrollear su
propio pedido con el dedo sobre el mapa, que ocupa media pantalla. Ese contrato
ya estaba fijado en `tracking-arriving.spec.mjs` y tiene razón.

O sea que **explorar el mapa se hace con dos dedos** —arrastrar y pellizcar—, la
convención de cualquier mapa embebido en una página larga. Es lo que hay que
mirar con dedos reales en la prueba física.

---

## 7. Offline y recuperación

El contrato público del seguimiento entrega **sólo la última coordenada**, nunca
una cola: `rowToOrder` expone `tracking.lastLocation` y nada más. Así que la
«reproducción caótica de la cola vieja» no puede ocurrir por diseño, y no se
escribió código para un caso que el contrato no produce.

Lo que sí ocurre al volver la red es un salto único y grande. Se lo reconoce por
dos señales independientes —saltó más de 400 m, o pasó más de 2,5 veces la
cadencia normal— y en cualquiera de los dos casos converge acotado en 1,4 s en
vez de fingir un recorrido que nadie observó. Después el ritmo normal se
restablece solo.

---

## 8. Gates

| gate | resultado |
|---|---|
| `npm test` | **1240 / 1240** |
| `npm run check` | verde (sintaxis, assets, higiene, contrato de ubicación) |
| `npm run secrets:scan` | limpio |
| Playwright Chromium | 222 / 223 |
| Playwright WebKit móvil | **7 / 7** |
| auditoría visual 320/360/390/432, dos motores | **48 capturas**, sin overflow ni errores de página |

El único rojo de Chromium es `business-windows-operations.spec.mjs`, la carrera
heredada que ya venían documentando las sesiones anteriores: **12/12 en aislado
con `--repeat-each=3`**, y esta rama no toca ni uno de sus archivos.

`DELIVERY_LOCATION_REQUIRED` intacto: el contrato de ubicación pasa su check, y
al arnés de capturas se lo puso al día para cumplirlo, no se lo relajó.

Sin tocar: producción, staging, ARCA, WhatsApp, el repo del Rider, LT-0030.
Sin push.

---

## 9. Desplegado a staging

`deployment 5f29f3c3`, proyecto `taba2-staging`, rama `staging`. 10 archivos
subidos, 340 ya presentes.

| | antes | ahora |
|---|---|---|
| `CACHE_NAME` | `v55-gondola-comercial` | `v56-seguimiento-en-vivo` |
| hojas | `?v=45` | `?v=46` |
| `app.js` | `?v=38` | `?v=39` |

Verificado en la URL pública: `js/map/rider_motion.js` y
`js/map/tracking_status.js` responden 200 con `Content-Type:
application/javascript` — se sirven de verdad, no caen en el fallback HTML de
Pages.

`runtime-config.js` **preservado byte a byte**: se bajó el vivo antes de subir y
se comparó por sha256 local contra remoto (idénticos). El del repo es una
plantilla vacía que habría dejado al storefront sin backend. **Cero migraciones**
—la rama no trae ninguna— y **ni una fila escrita** en la base.

Rollback: redesplegar el árbol de `da56ce9`. El cambio es front puro.

---

## 10. La prueba física sigue sin poder correr

**El teléfono ya no es el problema.** El Moto G15 está conectado y autorizado,
con la APK de staging instalada, permisos `FINE`/`COARSE`/`POST_NOTIFICATIONS`
concedidos, `location_mode=3` y Wi-Fi doméstica.

Lo que falta son **credenciales**, y no se pueden reponer desde acá:

- El **PAT de management de Supabase fue borrado** el 2026-08-10 a pedido de la
  persona a cargo. Sin él no hay camino de admin.
- **Los dos logins del Rider están rotados.** Medido en vivo contra
  `/auth/v1/token`: `400 invalid_credentials` en ambos.
- **El teléfono ya no tiene sesión guardada**: `no_backup/` está vacío, o sea
  `rider_session.enc` no existe. La app tiene que volver a entrar y no tiene con
  qué.
- Sin login de staff tampoco se puede llevar un pedido a `on_the_way` desde el
  Panel.

Queda vivo únicamente `rider-map-qa`, que es un actor de mapa.

No se forzó ningún estado por SQL y no se tocó ningún pedido: hacerlo habría
fabricado la evidencia que esta prueba existe para producir.

### La declaración NO se emite

**`TABA2_CUSTOMER_LIVE_TRACKING_PRODUCTION_UX_CERTIFIED` queda sin emitir.**

Su condición es que un cliente pueda seguir un Rider **físico** con movimiento
comprensible. El código está desplegado y verificable en staging, el movimiento
visual está medido y el estado de la señal está probado en el navegador — pero
sin un Rider que pueda publicar GPS no hay recorrido que seguir, y afirmarlo
sobre trazas grabadas sería exactamente la clase de evidencia inventada que este
encargo prohíbe.

### Lo único que falta para desbloquearla

1. Un **PAT nuevo** de `supabase.com/dashboard/account/tokens`, guardado donde el
   proyecto guarda sus credenciales — con eso se rota el login del Rider y se
   puede preparar el pedido.
2. El Moto sale por el **hotspot del iPhone** (ya decidido) y el iPhone mira el
   tracking por sus propios datos móviles.
3. Recorrido de ≥300 m con ≥20 fixes, cubriendo pan y pinch de dos dedos,
   «Volver al Rider», pantalla apagada, background, offline de ≥60 s y
   reconexión.

### La declaración NO se emite

**`TABA2_CUSTOMER_LIVE_TRACKING_PRODUCTION_UX_CERTIFIED` queda sin emitir.**

Su condición es que un cliente pueda seguir un Rider **físico** con movimiento
comprensible. Todo lo medido acá corre sobre trazas reales pero **grabadas**, y
sobre un navegador de prueba. El movimiento visual está medido, el estado de la
señal está verificado en el navegador y la vuelta al rider funciona; lo que falta
es exactamente lo que la declaración exige: dos teléfonos, una caminata y alguien
mirando.

### Para desbloquearla

1. Conectar el Moto G15 por USB con depuración autorizada.
2. Desplegar esta rama a Pages (`taba2-staging`) — sin migraciones: no trae
   ninguna.
3. Recorrido físico de ≥300 m con un segundo teléfono en el seguimiento,
   cubriendo pan y pinch de **dos** dedos, «Volver al Rider», pantalla apagada,
   background, offline de ≥60 s y reconexión.
