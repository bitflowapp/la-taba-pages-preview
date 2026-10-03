# TABA2 Rider · pasada de UX comercial

**No se emite `TABA2_RIDER_COMMERCIAL_UX_READY_FOR_PILOT`.** El encargo pone el
gate físico del Moto G15 como condición y ese gate no se pudo correr: otra
sesión estaba usando el teléfono. El motivo está en el punto 10, con horas, y la
decisión de no disputárselo fue explícita.

Todo lo demás está hecho y medido.

---

## 1 · HEAD base

`ae90ab6` — *feat(rider): el mapa es la superficie permanente, no una capa del
pedido*, punta de `feature/taba2-rider-shifts-dispatch`, árbol limpio.

## 2 · HEAD final

`8e9cd4f`, en `feature/taba2-rider-commercial-ux`. Dos commits sobre la base:

- `94adf07` *la hoja dice si cobrás, por qué puerta y cuánto dura el turno*
- `8e9cd4f` *la entrega cerrada es un comprobante, no una orden de cobro*

Worktree `D:\1212\worktrees\taba2-rider-commercial-ux`, árbol limpio. Sin push:
el repo Rider no tiene remoto. Sin deploy.

El segundo commit salió de mirar la evidencia generada, no de un test: el estado
`delivered` seguía mostrando «Cobrás ARS 18.500 en efectivo» sobre una entrega
que el servidor ya había confirmado, y «Cómo entrar» por una puerta a la que ya
se llegó. En efectivo eso es un cobro repetido. Vale anotarlo porque es el
argumento a favor de producir las imágenes aunque el teléfono no esté: el
defecto no lo veía ninguna de las 40 pruebas nuevas.

## 3 · Ancestry

Verificada con `git merge-base --is-ancestor`, no asumida. Es una sola línea:

```
471f79e  Polish Rider basemap visual hierarchy        ← «basemap visual» del encargo
   └─ 39089d8  turnos y ofertas, puerta del cliente cerrada hasta aceptar
        └─ b9b881d  auto-dispatch: mandar el flag de mock validado  ← el otro HEAD del encargo
             └─ ae90ab6  el mapa es la superficie permanente         ← BASE de esta pasada
                  ├─ acc253a  identidad/biometría (otra sesión, lock cerrado)
                  └─ 94adf07  esta pasada
```

Los dos HEADs que nombraba el encargo **no compiten**: `471f79e` es ancestro de
`b9b881d`, y los dos son ancestros de `ae90ab6`. No había que elegir.

**Por qué `ae90ab6` y no `acc253a`,** que es la punta real: `acc253a` arrastra 6
migraciones (`20260812010000`…`060000`) **no aplicadas** a staging y acopladas a
su cliente. Colgar la rama de UX de ahí metía esa dependencia en el piloto, y
aplicarlas no era decisión de esta sesión. El cruce de diffs es casi nulo
—`review_fixtures.dart` y dos tests, pocas líneas—, así que el merge posterior
sigue siendo limpio en cualquier orden.

## 4 · Archivos

**Nuevos**

| Archivo | Qué es |
|---|---|
| `lib/features/orders/presentation/widgets/payment_callout.dart` | El aviso de cobro y el formateo de importes |
| `lib/features/orders/presentation/widgets/delivery_card.dart` | La ficha de entrega |
| `lib/features/rider_operations/presentation/widgets/shift_panel.dart` | Ventana del turno, zona y actividad |
| `lib/features/rider_operations/presentation/widgets/offer_countdown.dart` | La barra de tiempo de la oferta |
| `lib/core/feedback/taba2_haptics.dart` | Pulso háptico de transiciones confirmadas |
| `lib/review/review_operations.dart` | Fixtures de despacho para el build de revisión |
| `test/features/commercial_ux_test.dart` | 40 pruebas focales |
| `test/golden/commercial_ux_golden_test.dart` | 10 retratos de regresión |
| `test/evidence/commercial_ux_evidence_test.dart` | Generador de evidencia legible (no es gate) |

**Modificados**: `order_detail_page.dart`, `rider_home_page.dart`,
`rider_map.dart`, `rider_sheet.dart`, `app.dart`, `review_shell.dart`,
`review_scenario.dart`, `review_fixtures.dart`, y dos tests (punto 9).

## 5 · BEFORE / AFTER

**AFTER legible** — `artifacts/taba2-rider-commercial-ux/after-legible/`, 10
imágenes a 432×960 dp, que es exactamente el tamaño lógico del Moto G15
(1080×2400 a densidad 400), con Roboto real. Se generan con:

```
TABA_EVIDENCIA=<carpeta> flutter test test/evidence/commercial_ux_evidence_test.dart
```

**AFTER de regresión** — `after-widget/`, los mismos estados como golden. Se
dibujan con la tipografía de prueba (bloques): sirven para que un cambio futuro
falle, no para leerlos.

**BEFORE** — `before/`, **parcial y así declarado**. Sobrevivieron 5 capturas
tomadas antes del choque: `01-fuera-de-turno-DIAG`, `03`, `04`, `05` y
`08-llegaste-DIAG`. Las otras 8 quedaron inservibles y están apartadas en
`before-descartadas/`: seis capturas del menú, dos pantallas en blanco de 18 kB,
tres bytes idénticos repetidos y un PNG de 0 bytes. No se usan como evidencia.

La comparación que sí se sostiene, y es la del hueco más grande:

| | BEFORE (`08-llegaste-DIAG.png`) | AFTER (`07-llegaste-efectivo.png`) |
|---|---|---|
| Primer bloque | «Resumen · Seguimiento: Sin seguimiento activo» | «Cobrás ARS 18.500 en efectivo» |
| Cobro | fila «Medio: Efectivo», última de la tabla | aviso con tono propio, arriba de todo |
| Piso/depto | no se renderiza nunca | «Depto 3 C», visible |
| Indicaciones | cortadas bajo el pliegue, debajo del CTA | en caja, sobre el pliegue |
| Importes | `ARS 17000` | `ARS 17.000` |

## 6 · Decisiones visuales

**Lo que NO se cambió, a propósito.** La cápsula de estado ya tenía punto de
color por tono, la hoja ya era contextual, el mapa ya era permanente y una sola
instancia, y las etiquetas de estado ya nombran el comercio real («Yendo a La
Taba 2» en vez de «En camino al comercio»). El encargo pedía esas ocho
etiquetas; siete ya estaban y son más específicas que las propuestas. Cambiar
«Yendo a La Taba 2» por el genérico habría sido perder información y romper
tests que protegen la matriz de estados.

**La única etiqueta que sí cambió**: la oferta mostraba `Oferta / 25 s` — la
única cápsula de la app que contestaba una pregunta que nadie hizo primero.
Ahora dice `Estado / Oferta recibida`, como todas, y los segundos se fueron a
la barra que está al lado del botón.

**La barra va fijada, no desplazable.** Medido a 432×960 con la hoja colapsada,
en el cuerpo desplazable quedaba cortada al medio. Un temporizador que hay que
desplazar para ver es un temporizador que se vence sin que lo vean.

**En la puerta se va la lista de paradas.** `arrived` significa que el
repartidor ya llegó: no hay ruta que describir, y mantener las dos paradas
empujaba hacia abajo lo único que sigue siendo accionable.

**El cobro va primero sólo en la puerta.** Medido a 360×780, si el aviso seguía
a la ficha quedaba 113 dp bajo el pliegue. Mientras se viaja el orden es el
inverso: la puerta es lo que se está leyendo y el pago es un dato para después.

**El aviso de seguimiento caído se limita a `on_the_way`.** En la puerta el
viaje terminó, no hay nada que seguir, y ese cartel costaba ~100 dp verticales
justo donde la hoja tiene que entrar el cobro, el departamento y el código.

**Ambigüedades resueltas por el lado conservador**, como pide el encargo:

- `address_label` puede ser «Casa» o «3.º C»: el contrato no lo dice. Se muestra
  el valor con un icono de domicilio y **no se lo rotula** como piso ni como
  apartamento.
- `card` y `transfer` se leen como pagado. Es la lectura del storefront, y es la
  que el encargo pide («si pago online: no mostrar CTA de cobro»). Un valor
  fuera del vocabulario conocido **no se dobla hacia ningún lado**: se declara
  desconocido y se pide confirmar con el negocio.
- El importe a cobrar es `total`, que es lo que el contrato asignado trae. El
  `collection_amount` que existe en la oferta **no existe** en el pedido
  asignado y no se inventa uno.

## 7 · Estados cubiertos

Los ocho del encargo, más los tres de degradación:

fuera de turno · disponible/sin pedido · oferta con TTL · yendo al comercio ·
retiro · yendo al cliente · ficha de entrega · entregado · sincronizando ·
sin conexión · seguimiento caído.

En el menú del build de revisión son 13 escenarios (eran 10; los tres nuevos son
los de despacho).

## 8 · Rendimiento

**No hay medición AFTER en el aparato**, porque no hubo aparato. Lo que sí se
puede afirmar del código:

- **Cero animaciones nuevas.** La barra de la oferta es un `ColoredBox` dentro
  de un `FractionallySizedBox`, repintado por el tick de un segundo que el
  controlador **ya corría** para la cuenta regresiva. No agrega ticker.
- **Cero instancias de mapa nuevas.** El `GlobalKey` único de `ae90ab6` está
  intacto y el test de identidad de instancia a lo largo de los siete estados
  sigue en verde.
- **Cero listeners nuevos.** El test que cuenta listeners tras siete
  transiciones sigue afirmando exactamente 1 y 1.
- **Cero adquisiciones y cero publicaciones de GPS nuevas.** Los tests que
  cuentan `heartbeats` y `acquisitions` no se tocaron y siguen en verde.
- Widgets agregados: cuatro, todos `StatelessWidget` sin estado ni suscripciones.

Referencia BEFORE de `ae90ab6` sobre el mismo teléfono, del handoff anterior:
mapa idle 16,63 ms medio, jank 0,0 %, 191 MB en frío. **Hay que volver a
medirlo**; está en la deuda como P1.

## 9 · Tests y gates

`flutter analyze` sin hallazgos. **361 tests, todos verdes** (307 previos + 54
nuevos).

**Gradle**, los tres que pedía el encargo:

| Gate | Resultado |
|---|---|
| `assembleCommercialReviewDebug` | ✅ |
| `assembleStagingDebug` | ✅ `61682496e5…` |
| `assembleCommercialReviewRelease` (release-safe) | ✅ sin firmar |

El release sale sin firmar a propósito: `releaseSigningConfigured` es falso sin
keystore en el entorno y el `buildType` pone `signingConfig = null`. Sirve como
gate de compilación —prueba que R8 y el tree-shaking no rompen nada—, no como
artefacto distribuible.

Nuevos: 40 focales (`commercial_ux_test.dart`), 10 golden, 3 de aislamiento del
arnés de revisión. Cubren los cinco tamaños del encargo —360×780, 360×800,
390×844, 412×915, 432×960— afirmando por cada uno que el CTA final no queda
tapado y mide ≥48 dp, que el cobro se lee sin desplegar nada, que el turno entra
completo y que la atribución no invade la banda de estado.

**Dos tests cambiados, ninguno debilitado:**

1. `rider_offer_surface_test.dart` afirmaba el texto `Tenés 25 s para
   responder`. El contrato que protege —que el repartidor pueda ver cuánto le
   queda— ahora se afirma sobre la barra, que además exige que el segundero sea
   el del servidor. Es una afirmación más fuerte que la anterior.
2. `review_isolation_test.dart` fijaba `ReviewScenario.values.length == 10`.
   Son 13 porque se agregaron tres escenarios. Se sumaron además tres pruebas
   nuevas al mismo archivo, incluida una que exige que **ningún** escenario
   caiga en el puente nativo.

## 10 · Moto G15 — GATE NO CORRIDO

Con horas del propio aparato:

- **01:49** sondeo inicial con el APK que ya estaba instalado. Tres capturas
  buenas. Confirmado en el teléfono que el mapa permanente de `ae90ab6`
  funciona, y confirmado el defecto de «Sin conexión» en rojo sobre todos los
  estados.
- **01:58** empieza la corrida BEFORE con mi APK
  (`c6b2ae65…`, construido desde `ae90ab6`, `adb install -r`, sin `pm clear`).
- **02:00:44** otra sesión instala `com.lataba.rider.staging`.
- **02:06:37** otra sesión instala `com.lataba.rider.staging.test`
  (instrumentación).
- adb pasa a `offline` y después a `unauthorized`; hay que reiniciar el servidor
  para recuperar el aparato. Las capturas salen intercaladas con arranques
  ajenos: menús, pantallas en blanco, un PNG de 0 bytes.
- `com.logistics.rider.pedidosya` ya no está. Estaba instalada al tomar el lock
  y mi adquisición la declara explícitamente **no tocada**. No la desinstalé yo.
- Al cierre, `com.lataba.rider.staging` seguía corriendo.

**Decisión, consultada y confirmada: no disputar el teléfono.** Reinstalar
encima podía voltear una corrida de instrumentación ajena que quizá era una
certificación. Preferí quedarme sin gate antes que romperle el suyo. Queda
anotado en `_claude-locks/moto-g15.lock` con la hora de cada instalación.

Lo que hay que correr cuando el aparato esté libre, con lo que ya quedó armado:

```
adb install -r artifacts/.../evidencia/BEFORE-ae90ab6-commercialReview-debug.apk
bash artifacts/.../evidencia/capturar.sh <carpeta>/before
adb install -r artifacts/.../evidencia/AFTER-8e9cd4f-commercialReview-debug.apk
bash artifacts/.../evidencia/capturar.sh <carpeta>/after
```

BEFORE: `c6b2ae658b4eb027073ab60b9bd96ced490580f4482f42accfa26127a555f388`,
construida desde `ae90ab6`. El sha256 del AFTER queda en el nombre del archivo
archivado.

Las dos APK están archivadas con su sha256. **Ojo**: `capturar.sh` tiene las
coordenadas del menú de 10 escenarios; el AFTER tiene 13 y hay que correr la
tabla.

## 11 · Contratos preservados

Sin tocar: SQL de auto-dispatch, ranking, migraciones, edge functions, backend,
staging, producción, ARCA, Mercado Pago, storefront del cliente.

- **GPS y publicación**: cadencia sin cambios, sin adquisiciones nuevas. Los
  tests que lo cuentan siguen verdes.
- **Cola offline**: sin tocar.
- **Claim / auto-dispatch**: los RPC y sus `operationId` sin cambios. Lo único
  que se agregó alrededor del claim es un pulso háptico **después** de que el
  servidor confirmó.
- **Privacidad pre-claim**: `preClaimDeliveryLabel` y `maskAddressNumbers` sin
  tocar. La oferta de despacho no tiene dónde poner la puerta del cliente y la
  prueba nueva lo fija. La ficha de entrega **sólo** se dibuja sobre pedido
  asignado.
- **Código de entrega**: panel, reintentos, bloqueo temporal e idempotencia sin
  cambios. Sólo se movió en la hoja.
- **Navegación**: `navigationUriFor` y la preferencia de coordenada sobre texto,
  intactas.
- **Nombre y teléfono del cliente**: el proyectado asignado no los trae
  (`AssignedOrderDto`: `address_label`, `customer_street_address`,
  `customer_neighborhood`, `customer_reference`, `customer_notes`,
  `customer_address`, y nada más). No se inventan, y hay una prueba que exige
  que no aparezca ni un placeholder ni un botón de llamar.

## 12 · Deuda

**BLOCKER**

- **Gate físico Moto G15 sin correr.** Punto 10. Es la única condición del
  encargo que quedó abierta y la razón por la que no hay declaración.

**P1**

- **Rendimiento AFTER sin medir en el aparato.** Hay que repetir frames de
  SurfaceFlinger, PSS y primera pintura contra el BEFORE de `ae90ab6`.
- **Nombre y teléfono del cliente no existen en el contrato.** Las referencias
  compartidas los muestran y son útiles de verdad en la puerta. Requiere ampliar
  el proyectado del pedido asignado, que este encargo prohíbe tocar.
- **`capturar.sh` tiene las coordenadas del menú viejo.** Hay que actualizar la
  tabla a 13 escenarios antes de la pasada AFTER.

**P2**

- **`Sin GPS` aparece dos veces** en la lista de paradas, una por parada.
  `rider_map_test.dart` lo fija con `findsNWidgets(2)` y ese test protege una
  honestidad real (no inventar distancia), así que no se tocó.
- **Los importes de la oferta y del cobro pre-claim** ya se agrupan, pero
  `unit_price` de cada producto y algunos textos sueltos siguen crudos.
- **El aviso de mapa sin coordenadas** aparece en el build de revisión porque
  las fixtures no traen punto. En operación real no debería verse; conviene
  confirmarlo con un pedido de staging.

**POST-PILOT**

- **Tiles de OpenStreetMap.** Sigue vigente lo del handoff anterior: la política
  de uso de los servidores públicos desaconseja producción. Antes de ampliar la
  flota hay que decidir proveedor.
- **Sonido y vibración configurables para la oferta.** El encargo lo pedía «si
  ya existe contrato». No existe: no hay preferencia persistida ni ajuste. El
  háptico que se agregó es de transición confirmada, no de aviso de oferta.
- **El camino de la cola de pedidos es código muerto en la app real.**
  `SessionGate` siempre construye el controlador de operaciones, así que
  `_buildQueueMap` y la lista de `OrdersPage` no se alcanzan nunca con
  auto-dispatch. Conservan tests; habría que decidir si se retiran.

## 13 · Qué falta para el piloto comercial

1. **Correr el gate físico.** Todo lo necesario está archivado y automatizado.
2. **Volver a medir rendimiento** en el aparato y compararlo con `ae90ab6`.
3. **Decidir el merge con `acc253a`** (identidad/biometría) y, si entra, aplicar
   sus 6 migraciones junto con su cliente, en ese orden.
4. **Un pedido de staging real** que recorra oferta → retiro → entrega con la
   hoja nueva. Todo lo de esta pasada se validó contra fixtures y contratos, no
   contra el backend.
5. **Decidir proveedor de tiles** antes de ampliar la flota.

---

**Mutaciones**: ninguna. `STAGING_MUTATED=false` · `PRODUCTION_TOUCHED=false` ·
`PUSH=no` · `DEPLOY=no` · migraciones ninguna · GPS falso no se usó · ningún
pedido tocado.
