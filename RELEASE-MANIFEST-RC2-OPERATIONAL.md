# TABA2 Pilot · RC2 operativa

**Rama:** `release/taba2-pilot-rc2-operational`
**Base:** `release/taba2-pilot-rc1` (`f4588f9`) — ancestro directo, sin divergencia
**Qué agrega:** que el sistema se vigile solo, y que se pueda ver si lo está haciendo.
**Qué NO agrega:** ni una función comercial.

---

## 1. Ancestry

`release/taba2-pilot-rc1` es ancestro de esta candidata: no hay un solo commit de
RC1 que falte acá. Los cinco commits que se suman son todos de resiliencia:

| commit | qué |
| --- | --- |
| `d1eb2e0` | el aviso de actualización deja de quedar huérfano (P1 de RC1) |
| `07a051a` | las alertas se evalúan solas + salud operativa |
| `51b17db` | «Cómo viene el sistema» en el Panel |
| `0bcfc32` | una tarea en su primera corrida no está detenida |
| `e7466b5` | quién vigila al vigilante |

No se tocó catálogo, tracking, el Panel de recuperación ni ningún contrato
existente: el diff contra RC1 son 20 archivos, y los únicos de producto son
`index.html` (un botón de descarte y las versiones), `js/pwa-update.js`,
los dos módulos del Panel, `styles/business.css` y `sw.js`.

## 2. Publicado en staging

| | |
| --- | --- |
| proyecto | Cloudflare Pages `taba2-staging`, rama `staging` |
| deployment | `0e01f5f1` |
| archivos | 351 subidos, **7 nuevos**, 344 ya presentes |
| verificación | **351/351** responden 200 con bytes idénticos y content-type correcto |
| `runtime-config.js` | **preservado byte a byte**: 684 B, sha256 `57d8a007…c8716` |

**Qué se preservó, y cómo se sabe:** Cloudflare reconoció **344 archivos como ya
presentes** —los identifica por hash— y sólo subió 7. Catálogo, imágenes,
seguimiento, el Panel de recuperación y el resto del producto están entre esos
344: no cambió un byte. Los 7 que sí cambiaron son `index.html`, `sw.js`,
`styles.css`, `styles/business.css`, `js/pwa-update.js` y los dos módulos del
Panel.

**Un solo bump, y porque correspondía:** cambió código precacheado
(`js/pwa-update.js`) y una hoja de estilo (`styles/business.css`), así que rotan
juntos la caché del worker (`v58` → `v59`), la cadena de hojas (`?v=47` → `?v=48`)
y el script del aviso (`?v=2` → `?v=3`). `js/app.js` sigue en `?v=40`: no cambió.

## 3. Certificado en la URL pública

**`https://taba2-staging.pages.dev`**, contra la base viva, con una cuenta de
operador **TEST creada y borrada** en el mismo acto (13/13):

* el Panel abre y el Centro de operación dibuja «Cómo viene el sistema»;
* cada valor de la pantalla coincide con lo que el servidor mide en ese momento
  —vigilancia, tareas del planificador, dinero cobrado sin pedido, configuración
  de cobros—, comparado contra la RPC en la misma corrida;
* **sin datos no es verde**: el módulo PUBLICADO, con la salud ausente, dibuja
  `sin-datos` en tono de atención y dice que todavía no puede decirlo;
* ni un secreto en la pantalla: cero cadenas con forma de credencial en el HTML;
* las dos alertas que ya existían siguen apareciendo, en castellano y sin el
  código interno;
* cero errores de consola y cero respuestas 4xx/5xx.

**Service worker en la URL pública (8/8):** instalación limpia deja una sola
caché, la de esta release, y el aviso no aparece porque no hay nada que
actualizar; y un perfil que arranca con la caché de la publicación anterior la
ve borrarse sola al activar, quedando 101 entradas precacheadas.

## 4. Backend

Ledger remoto **72/72**, sin ninguna migración local pendiente y sin maniobras
manuales: `supabase db push` responde `Remote database is up to date`.

Barridos autónomos después del deploy: **ocho corridas consecutivas**, una por
minuto, todas `ok`, cero críticas.

## 5. Gates

| Gate | Resultado |
| --- | --- |
| `npm run check` | verde |
| `npm test` | **1289/1289** |
| Playwright (Chromium + mobile WebKit) | **243/243** en 9,2 min |
| `npm run migrations:validate` | 72 en orden |
| `npm run secrets:scan` | limpio |
| Ensayos de resiliencia (PostgreSQL real) | **13 ensayos · 74 afirmaciones** |
| Salud en la URL pública | **13/13** |
| Service worker en la URL pública | **8/8** |
| Conjunto publicado | **351/351** bytes idénticos |

## 6. Rollback

* **Frontend:** volver a publicar el árbol de `f4588f9` conservando el
  `runtime-config.js` vivo, o restituir el deployment `aee2e619` desde el panel
  de Cloudflare Pages.
* **Backend:** las cuatro migraciones de resiliencia son aditivas y no tocan
  datos. `select cron.unschedule('taba-operational-alerts-sweep');`, restituir
  `refresh_operational_alerts` y `get_production_operation_center` desde
  `f4588f9`, quitar el trigger `orders_kick_scheduler_watchdog`, y borrar las
  funciones nuevas y `public.operational_sweep_runs`.
* **Worker:** `npx wrangler delete --name taba2-scheduler-watchdog`.

---

# Cierre del gate humano · 2026-08-10

## 7. El reloj de afuera, ahora corriendo

La deuda que este manifiesto declaraba —«el cron no está registrado»— **está
saldada**, y al saldarla apareció un defecto que nadie podía ver antes.

| | |
| --- | --- |
| subdominio | `taba2-ops.workers.dev` registrado (autorizado por la dueña de la cuenta) |
| Worker | `taba2-scheduler-watchdog`, versión `e58f2bba` |
| cron | `*/5 * * * *`, **activo** |
| URL pública | ninguna: `workers_dev = false` |

**El defecto:** el secreto `SUPABASE_ANON_KEY` estaba cargado **con un BOM
UTF-8** al principio. El primer disparo real del cron lo destapó: la cabecera
`apikey` salía con bytes no ASCII y el backend respondía `401 Invalid API key`.
El reloj de afuera estaba **muerto**, y no se sabía porque nunca había llegado a
correr —el cron no existía—. Se recargó el secreto sin BOM.

**Probado en vivo, no deducido.** Disparo del cron de las `19:40:43Z`:

```json
{"at":"2026-08-10T19:40:43.000Z","healthy":true,"age_seconds":44,"action":"ninguna"}
```

`outcome: ok`, cero excepciones, cero avisos.

**Detección de la muerte del planificador**, simulada en el contenedor
descartable (nunca en staging: envejecer la marca del barrido allá sería
mentirle al Panel):

| | |
| --- | --- |
| barrido al día | la sonda dice sano · el watchdog no inventa nada (`acción=ninguna`) |
| 30 min sin correr | detectado a los **1800 s** · alerta **abierta** por el reloj de afuera |
| una por negocio | 2 alertas / 2 negocios, ni una de más |
| anti-spam | **6 comprobaciones seguidas → 1 alerta y 1 evento**, no 14 |
| recuperación | la misma sonda **cierra la alerta sola** al volver el barrido |
| aviso al humano | «La vigilancia automática dejó de correr.» — sin el código interno |

`pg_cron` interno **no se tocó**.

## 8. Rider QA

Una sola cuenta rotada (`aab5bc54`, rol `rider`, activo), guardada como
`rider-map-qa-login.txt` en la carpeta de secretos de la máquina de operación,
login verificado **por backend y por la app** (`rider_session.enc` escrito en el
Moto). Ninguna otra cuenta se tocó.

**Se rotó dos veces, y hay que decir por qué:** en el primer intento el
formulario corrió el foco al abrirse el teclado y la contraseña entró en el
campo de correo, **a la vista**. Se quemó en el acto, se borraron las capturas
comprometidas y se rotó de nuevo. El segundo intento ubica los campos por la
jerarquía real de la UI y salta con TAB, y **aborta antes de tipear** si el foco
no cayó en un campo protegido.

## 9. Recorrido físico real

Moto G15 `ZY32LHS6PS` (sin SIM, colgado del hotspot del iPhone) contra el pedido
QA `QA-RC2-0CD74937` (`origin=qa`, `qa_no_charge`, cero cobros, cero
comprobantes), llevado desde la app por sus RPC reales:
`assigned → picked_up → on_the_way`.

| Criterio | Exigido | Medido | |
| --- | --- | --- | --- |
| fixes GPS reales | ≥20 | **566** | ✔ |
| desplazamiento | ≥300 m | **1425 m** desde el inicio | ✔ |
| GPS simulado | prohibido | ninguno: `source=gps`, 0 s de atraso de subida | ✔ |
| paso humano | — | velocidad mediana **5,0 km/h** en el tramo caminado | ✔ |
| precisión | — | mediana **12,1 m** (mejor 2,0 · peor 50,3) | ✔ |
| cadencia | — | mediana **12,3 s** | ✔ |
| el Rider publica | sí | 92 fixes en 9 min de caminata, ±4 m mediana | ✔ |
| el cliente lo sigue | sí | 12/12 muestras con posición, **0-9 s** de antigüedad | ✔ |
| pantalla apagada | sí | sigue publicando con `mWakefulness=Dozing` | ✔ |
| Internet OFF | ≥60 s | **12 min 12 s** (21:29:10 → 21:41:22) | ✔ |
| último punto permanece | sí | se mantiene y **envejece a la vista** hasta 173 s | ✔ |
| stale / offline | sí | a los **179 s** el mapa deja de afirmar dónde está | ✔ |
| reconexión | sí | primer fix a los **3 s** de volver la red | ✔ |
| convergencia | al fix reciente | el cliente vuelve a un punto de **3 s**, no a uno viejo | ✔ |
| pinch real | sí | **NO PROBADO** | ✖ |
| follow / explore | sí | **NO PROBADO** | ✖ |
| «Volver al Rider» | sí | **NO PROBADO** | ✖ |

**Por qué faltan los tres últimos.** El seguimiento del cliente sólo funciona en
el navegador que hizo el pedido: la sesión es **anónima** y el token vive en ese
navegador. Un pedido sembrado por backend no se puede seguir desde otro
teléfono. Se intentó adoptarlo a la sesión del iPhone —funcionó en el ensayo con
un navegador de escritorio— y en el teléfono no prendió. Las tres validaciones
son de dedo sobre el mapa del cliente y **no se hicieron**.

**Hallazgos del recorrido**, medidos, sin adorno:

1. `recover_order_tracking_access` **rota el token y deja mudo al que lo tenía
   antes, en silencio**. Si el cliente abre el seguimiento en un segundo
   dispositivo, el primero pierde el seguimiento sin aviso. Es la contracara de
   un token por pedido, no un defecto; queda dicho.
2. **No hubo recuperación de los fixes capturados durante el corte.** Entre
   `seq 1929` y `seq 1930` el track queda con un hueco permanente de 12 minutos.
   Puede ser que la app no muestree sin red; arrastrar posiciones de hace 12
   minutos tampoco sería honesto en el mapa. Medido, no juzgado.
3. El mapa del cliente muestra **«Señal GPS débil» siempre**: el contrato
   redondea la posición a 3 decimales (~110 m) y **pisa la precisión a un
   mínimo de 100 m** por privacidad. Con ±4 m reales, el cliente lee «débil».
   La etiqueta describe el dato degradado, no la señal.
4. La cola del Rider exige `origin = 'production'`, así que un pedido QA nunca
   aparece en ella —correcto, evita que se cuele en la operación real— pero
   `get_active_rider_delivery` **no filtra por origen**: asignado a mano, la app
   lo opera igual. Ese es el camino que usó este gate.

## 10. Smoke de cierre · 15/15

`runtime-config.js` intacto (684 B, `57d8a007…`) · storefront 200 · versiones
v48/v3/v40 · el Panel exige acceso seguro · cero credenciales privadas en el
HTML · SW en `v59` · planificador vivo (edad 8 s de 600) · el latido no filtra
negocio · el seguimiento abre y trae la posición · sin alerta del watchdog ·
**LT-0030 intacto** (`arrived`, $550, rev 11) · los últimos 5 barridos `ok`.

## 11. Estado final

| | |
| --- | --- |
| frontend | `release/taba2-pilot-rc2-operational` **`5eec3a2`**, árbol limpio, **sin push** |
| ledger | **72/72**, local == remote en las 72, sin deriva |
| worker externo | `taba2-scheduler-watchdog` `e58f2bba` · cron `*/5` · sin URL pública |
| APK del Rider | `com.lataba.rider.staging` v1.0.0 (code 1) · sha256 `ad2eb16ce2e939db7b9201855a4d964602eb614a0521788cad37d758320fcbb6` |
| storefront | https://taba2-staging.pages.dev |
| API | https://ukxqbgswjlibmnjemrzd.supabase.co |
| producción | no se tocó · ARCA no · WhatsApp no · dinero real no |

**Limpieza:** se borró **sólo lo QA propio** —pedido, 1152 ubicaciones, 15
eventos, token, línea, dirección y la cuenta efímera del cliente—. Verificado a
0 en las siete tablas. `LT-0030` intacto.

**Lo que quedó y no es mío:** `LT-0133`, un pedido `origin=production` real
($3.726, 1 Red Bull, pago en efectivo, sin dinero movido) entrado desde el
iPhone a las 20:22:38 durante la preparación. Está en `received` y mantiene
abierta la alerta `ORDER_NOT_ACCEPTED`. **No se tocó**: no es QA.

## 12. Rollback de lo agregado hoy

* **Worker:** `npx wrangler delete --name taba2-scheduler-watchdog`; el
  subdominio `taba2-ops.workers.dev` se libera desde el panel de Cloudflare.
* **Cuenta Rider QA:** rotar de nuevo desde la sesión Management.
* **Backend:** nada que revertir. No se aplicó ninguna migración en este tramo
  y todo el dato QA creado ya está borrado.

## 13. Veredicto

**NO se declara `TABA2_PILOT_RC2_CERTIFIED_FOR_HUMAN_PILOT`.**

La release operativa pasa: smoke 15/15, ledger 72/72, y el reloj de afuera
—que era la deuda declarada— quedó corriendo y probado en vivo, con un defecto
real encontrado y corregido en el camino.

El recorrido físico pasa en todo lo que se pudo medir: 566 fixes reales, 1425 m,
pantalla apagada, 12 minutos sin red, permanencia del último punto, caducidad a
los 3 minutos, reconexión y convergencia.

Lo que falta son **tres validaciones de dedo sobre el mapa del cliente** —pinch,
follow/explore y «Volver al Rider»—, y faltan porque el seguimiento no se pudo
poner en el segundo teléfono. Son parte explícita del gate. Mientras no se
hagan, esto es una candidata con el recorrido medido, no una release
certificada para el piloto humano.

**Para cerrarlo hace falta una sola cosa:** un pedido hecho *desde* el teléfono
que va a mirar el seguimiento —así el token nace en ese navegador— y repetir
sobre él los tres gestos. Es una vuelta de manzana, no un rediseño.

---

# El rider que volvía al principio · 2026-08-11

## 14. Lo que se veía y lo que era

Durante un recorrido real el marcador del rider avanzaba bien y cada tanto
**volvía hacia el punto de partida**, para después avanzar otra vez. Se leía como
si el mapa reprodujera calles ya recorridas.

Lo primero fue descartar lo fácil, con datos. La traza física de `LT-0138`
—85 fixes, 931 m— tiene `captured_at` **estrictamente creciente**: 0 desórdenes,
0 duplicados, 85 `client_request_id` distintos. Y el motor visual aguanta: un
arnés que le pasa esa traza real por seis escenarios —poll en orden, realtime más
un poll atrasado, GPS local contra el del servidor, drenaje offline de 12 puntos
viejos después de uno reciente, remount a mitad de camino y duplicados— da
**0 retrocesos**. El defecto no estaba ni en los datos ni en `rider_motion.js`.

Estaba en el contrato público, y eran **dos** causas distintas.

## 15. Causa A · la coordenada estaba cuantizada a 111 m

`get_public_order_tracking` entregaba `round(lat, 3)`, una grilla de ~111 m.
Medido sobre ese mismo recorrido:

| | |
| --- | --- |
| lo que el rider caminó | **931 m** en 85 fixes |
| posiciones distintas que veía el cliente | **4** |
| error de posición | mediana **28,0 m** · máximo **66,0 m** |
| saltos del marcador | **86–141 m**, donde se caminaron 7–177 m |
| veces que volvía a una celda ya abandonada | **80** |

El motor de movimiento **anima** cada uno de esos rebotes de 86 m con una
interpolación suave. Eso —y no un fix viejo— es lo que se leía como «vuelve al
principio y repite las calles». Ninguna regla de ordenamiento lo arregla: esos
puntos llegaban puntuales y en orden; estaban cuantizados.

El redondeo era una **decisión de privacidad documentada**, no un descuido. Se
abrió a cuatro decimales (~11 m) con autorización expresa de quien la tomó:

| decimales | posiciones visibles | error mediano | error máximo |
| --- | --- | --- | --- |
| 3 | 4 | 28,0 m | 66,0 m |
| **4** | **17** | **2,4 m** | **6,2 m** |
| 5 | 50 | 0,4 m | 0,7 m |

A cuatro decimales el error de redondeo (2,4 m) queda **por debajo de la
precisión real del GPS** medida en el mismo recorrido (mediana 12,1 m): la
coordenada publicada no afirma nada que el círculo de precisión no afirme ya.
El piso de 100 m con que se informa la precisión **no se tocó**: sigue diciendo
dónde sin decir con cuánta certeza.

## 16. Causa B · «el último» era el último en llegar, no en capturarse

El contrato elegía la ubicación con `order by created_at desc` teniendo
`captured_at` y `receipt_sequence` en la misma fila. Medido en el mismo
recorrido: latencia de publicación **mediana 390 ms, máxima 26.683 ms**, contra
un hueco mínimo entre capturas de **5.044 ms**.

Con esos números alcanza una demora de 5 s para que el fix **anterior** llegue
después, gane el orden, y se entregue como «el más nuevo» **con un timestamp más
nuevo** — que la guardia de retroceso acepta, porque ese timestamp de verdad es
más nuevo. El marcador se va caminando hacia atrás a una posición donde el rider
ya no está.

En ese recorrido los dos órdenes coincidieron. La causa es latente, y está
dentro del envelope medido.

## 17. Lo que se cambió

* **`supabase/migrations/20260811020000_public_tracking_canonical_capture_order.sql`**
  — orden por `coalesce(captured_at, created_at) desc, receipt_sequence desc`;
  frescura medida sobre la **captura**, no sobre la llegada; el DTO agrega
  `captured_at`; la coordenada pasa a cuatro decimales. `receipt_sequence`
  **no viaja**: es un contador global del negocio y diría cuántos fixes publica.
* **`js/repositories/supabase_order_repository.js`** — `latestRiderLocation`
  ordena y sella por captura, y descarta el fix sin fecha de captura.
* **`js/map/rider_motion.js`** — cursor canónico explícito: `DUPLICATE` (el mismo
  hecho entregado dos veces) separado de `BACKWARDS` (un dato tarde), y `UNDATED`
  para el fix sin hora propia, que `normalizeRiderLocation` sellaba con
  `Date.now()` y por lo tanto colaba como el más nuevo de todos.
* **Documentación alineada con el código**, con un test que lo obliga:
  `docs/security/public-tracking-threat-model.md` y
  `docs/final-commercial-release/tracking-security-review.md` ya no afirman
  ~100 m, y la suite falla si alguna vuelve a hacerlo.
* **`tests/rider-tracking-no-replay.test.mjs`** — 12 regresiones: las siete
  obligatorias (A→B→C, B viejo, poll completo, realtime+poll, drenaje offline,
  duplicados, remount) más «un regreso físico real **sí** se ve», «un fix sin
  hora no se sella con el reloj de quien mira», el contrato del SQL y la
  coherencia de la documentación.

## 18. Lo aplicado y certificado en staging

`supabase db push` aplicó la migración: **ledger 73/73**, sin pendientes. Antes:
lock releído, snapshot tomado y el pedido humano en vuelo retirado desde el
Panel con motivo — el contrato no se cambia debajo de un mapa que alguien está
mirando.

El contrato **desplegado** se certificó leyendo el cuerpo de la función desde la
base, **22/22**: cuatro decimales, `captured_at` entregado, orden por captura,
desempate por `receipt_sequence` sin exponerlo, sin coordenada cruda, frescura
sobre la captura; y sin aflojar nada de lo anterior — piso de 100 m, rango
0–250, token vivo comparado por hash, rider asignado, fuente GPS,
`security definer` con `search_path` fijo, ubicación sólo en
`picked_up/on_the_way/arrived`, sin teléfono ni dirección ni ítems ni totales,
sin identificadores internos, un solo punto y sin historial.

`npm test` **1301/1301**.

## 19. La traza física real, contra el contrato nuevo

La caminata de `LT-0138` —85 fixes de GPS real del Moto, 931 m, una vuelta de
manzana que termina donde empezó— se hizo pasar por el contrato tal como quedó
desplegado. Los puntos son los que publicó el dispositivo: no se inventó un
metro. Mismo recorrido, los dos contratos:

| | antes (3 decimales, orden por llegada) | ahora (4 decimales, orden por captura) |
| --- | --- | --- |
| posiciones públicas distintas | **4** | **17** |
| error de redondeo, mediana | 28,0 m | **2,36 m** |
| error de redondeo, máximo | 66,0 m | **6,24 m** |
| saltos del marcador | 86–141 m | — |
| retrocesos por fix atrasado | — | **0** |
| regresos físicos reales visibles | — | **4** |
| fixes recientes descartados | — | **0** |

Precisión del GPS sin degradar: mediana 11,8 m, mejor 3,9 m, peor 78,6 m. El
error de redondeo (2,36 m) queda cinco veces por debajo de esa mediana.

**Y una advertencia que vale más que la tabla.** La primera versión de este arnés
contaba como retroceso *volver a una celda ya visitada*, y marcó **29 fallas**
sobre un recorrido correcto — porque la persona volvió por la misma calle, que es
lo que hace cualquiera que da la vuelta a la manzana. El defecto era del
indicador. Un indicador así, si nadie lo mira dos veces, empuja a «arreglar» el
sistema rompiendo el requisito explícito de que los regresos reales se vean. El
criterio correcto es **temporal**: sólo es retroceso que el marcador se mueva por
un fix capturado *antes* que el último ya aceptado. Con ese criterio: 0
retrocesos y 4 regresos físicos reales preservados, entre ellos uno de 174 m que
es el cierre de la vuelta.

## 20. El recorrido con el arreglo puesto · `LT-0141`

Ya con la migración aplicada, el rider salió a caminar con `LT-0141`. Esta es la
primera traza que existe bajo el contrato nuevo, y es la que decide.

**Que el desplazamiento es real, y no ruido acumulado con el equipo quieto:**

| | |
| --- | --- |
| fixes | **277** en 39,0 min |
| recorrido acumulado | **1.647 m** |
| separación máxima entre dos puntos | **252 m** |
| caja que ocupa | 175 m × 244 m |
| saltos sobre el ruido típico (>10 m) | 81 de 276 |
| velocidad media | 2,5 km/h |
| precisión reportada | mediana **3,0 m** (mejor 1,5 · peor 33,8) |

Un teléfono quieto no produce 81 saltos de más de 10 m ni una caja de 244 m de
ancho. Se movió.

**Los criterios, medidos sobre esa traza: 7 de 8.**

| | |
| --- | --- |
| recorrido ≥ 300 m | ✔ 1.647 m |
| ≥ 20 fixes | ✔ 277 |
| 0 replay por posiciones históricas | ✔ |
| 0 retroceso por llegada tardía | ✔ |
| el regreso físico real se ve | ✔ **32 revisitas reales**, y la sonda mueve 243 m |
| 0 fixes recientes descartados | ✔ |
| tracking visualmente continuo | ✔ **87 posiciones públicas** |
| error de redondeo < precisión del GPS | ✘ **3,34 m contra 3,0 m** |

**El único que falla, y por qué es honesto que falle.** En esta caminata el GPS
estuvo excepcional —mediana de 3,0 m, con fixes de 1,5 m—, y a esa altura la
grilla de ~11 m pasa a ser la fuente de error dominante: el redondeo aporta 3,34 m
de mediana. No es un error del arreglo; es el arreglo topándose con su propio
límite cuando el sensor es mejor que la grilla. Para referencia, en la traza
anterior el GPS daba 11,8 m y el redondeo 2,36 m: ahí el margen sobraba.

Si se quiere ese criterio cumplido con margen, la palanca es un decimal más
—cinco decimales, ~1,1 m de grilla, ~0,35 m de error—, y **es otra decisión de
privacidad**, no una corrección técnica: hay que tomarla explícitamente como se
tomó la de cuatro.

## 21. Veredicto del arreglo

**NO se declara `TABA2_RIDER_TRACKING_NO_REPLAY_CERTIFIED`.**

Lo que el problema original pedía **está resuelto y demostrado sobre un recorrido
físico real**: cero retrocesos por un punto atrasado, cero replay del historial,
cero fixes recientes descartados, los regresos físicos reales visibles —32 de
ellos—, y el seguimiento pasó de 4 posiciones en 931 m a 87 en 1.647 m.

No se firma por dos cosas, y ninguna es un detalle:

* **Un criterio explícito no se cumple** (redondeo contra precisión del GPS), y
  la palanca para cumplirlo es una decisión de privacidad que no me corresponde.
* **Nadie reportó haber mirado el mapa**, y no hay vídeo. La continuidad visual
  está medida por el número de posiciones publicadas, no por un ojo humano.

Queda además, dicho para que no se descubra tarde: el arreglo del lado del
navegador está en la rama pero **no publicado** en Pages, y el commit **no se
llevó a `release/taba2-pilot-rc2-operational`**.
