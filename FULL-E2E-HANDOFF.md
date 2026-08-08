# FULL-E2E-HANDOFF — TABA2 de punta a punta: cliente, negocio y Rider

Worktree `la-taba2-first-physical-e2e`, rama `release/taba2-first-physical-e2e`,
base `11a0b02`. Todo local: sin push, sin `amend`, `reset`, `clean`, `stash` ni
`git add .`.

Lo que este documento sostiene no es que el circuito *puede* funcionar, sino que
**funcionó**: un mismo pedido —`LT-0098`— fue comprado desde un navegador,
operado desde el Panel del negocio y **entregado desde la app Android instalada
en un Moto G15 físico**, con el mapa vivo, GPS real, corte de red y código de
entrega. Nada de RPC directo, mocks ni tests en lugar de esas tres interfaces.

Una segunda jornada reemplazó el punto de retiro de prueba por el de **La Taba 2,
Mendoza 827**, y lo volvió a recorrer entero sobre `LT-0099` para comprobar que
el cambio no rompía nada. Ese punto es **provisional**, con su procedencia
registrada en la base, y la sección 6 explica exactamente por qué todavía no
puede llamarse verificado.

---

## 0. Resumen para leer primero

| | |
| --- | --- |
| Pedido certificado | **`LT-0098`** — Red Bull Energy Drink, real, **sin alcohol**, $ 3.726, pago Mercado Pago **TEST** aprobado (op. `171665077885`) |
| Recorrido | storefront → pedido → Panel → accepted → preparing → ready → app Rider → claim → retiro → en camino → GPS → llegada → **código incorrecto rechazado** → código correcto → **`delivered`** |
| Novedad | primer pedido del proyecto con **los dos puntos del mapa** en su instantánea, y primer mapa del Rider que dibuja el local sobre calles reales de Neuquén |
| Defectos cerrados | **9**, incluidos el que dejaba a la app Rider en la pantalla de ingreso con la sesión viva, el que la dejaba sin destino al abrir Google Maps y los **dos** que hacían que el GPS publicara una sola posición por entrega (sección 7) |
| Cierre QA | **14/14** verificaciones, cinco veces: `LT-0098`, `LT-0099`, `LT-0100`, `LT-0101` y `LT-0102` |
| Punto de retiro | ya no es `qa_fixture`: `-38.946054, -68.053236`, origen `public_directory_cross_checked`, **provisional** hasta verificarlo por presencia (sección 6) |
| GPS en vivo | **arreglado y medido**: cadencia 12,44 s, latencia Moto → backend 0,21 s, precisión 11,7 m. Con el equipo **quieto**: no se afirma desplazamiento (sección 7) |
| Bloqueo abierto | el Moto G15 **no tiene SIM**. Sin datos móviles no hay reparto real con seguimiento en vivo (sección 7.4) |
| Producción | intacta. ARCA sin emisión. `LT-0030` idéntico |

---

## 1. El defecto que impedía el mapa, de punta a punta

La sesión anterior dejó al Rider mirando esto sobre un pedido real:

> **Mapa no disponible para este pedido.** No hay coordenadas autorizadas. Usá
> las direcciones escritas: no mostramos una ubicación inventada.

No estaba roto el mapa. **El dato nunca había llegado**, y no llegaba por tres
cortes distintos, encadenados. Los tres estaban aguas arriba del mapa, y por eso
ninguna sesión anterior los vio: el mapa decía la verdad.

### 1.1 Corte 1 — el editor de direcciones no podía capturar coordenadas

`js/customer-profile-view.js` guardaba `source: 'manual'` **fijo** y no mandaba
latitud ni longitud. El resto de la cadena estaba lista: `normalizeCustomerAddress`
acepta coordenadas, precisión y origen, y `upsert_current_customer_address` los
valida uno por uno.

Había además un bloque de captura ya escrito —`renderLocationPanel` en
`js/customer-delivery.js`, con sus manejadores `use-location` y
`confirm-location`— **definido y jamás invocado**. Quedó huérfano cuando la
administración de direcciones se mudó al Perfil y el editor vivo se escribió sin
él. Se conectó en el editor que sí se usa, con el mismo contrato de dos pasos:
pedir la ubicación y confirmarla aparte.

La ubicación sigue siendo **opcional**: sin confirmación explícita la dirección
se guarda `manual` con lat/lng nulas, exactamente como antes.

### 1.2 Corte 2 — pedir la ubicación borraba lo escrito

Introducido por el arreglo anterior y encontrado **en el navegador, no en un
test**: al confirmar la ubicación, Ciudad y Provincia quedaban vacías. Lo tipeado
vivía sólo en el DOM y cada `render()` reconstruye el editor desde el estado.

Se guarda un borrador antes de cada re-dibujo y el editor se dibuja desde él. El
borrador no sobrevive a cerrar ni a guardar, para que la próxima dirección no
herede la anterior.

### 1.3 Corte 3 — Checkout Pro tiraba las coordenadas

Medido sobre `LT-0097`, comprado con la ubicación confirmada:

| | |
| --- | --- |
| `customer_addresses` | lat `-38.9539`, lng `-68.0596`, precisión `12`, source `gps` |
| `orders` | source `gps`, **`delivery_latitude` NULL, `delivery_longitude` NULL** |

El pedido afirmaba origen GPS sin tener un solo punto. Dos huecos en fila:

1. `create_checkout_session` **acepta** `latitude` y `longitude` entre las claves
   permitidas de la dirección… y arma `address_snapshot` sin ellas. Con dirección
   guardada tampoco copiaba las de `customer_addresses`.
2. `finalize_paid_checkout_session` proyecta el snapshot al pedido, pero ya no
   tenía punto que proyectar.

Aguas abajo el efecto es **permanente**: el trigger del contrato del mapa
fotografía la ubicación **en el alta** y la instantánea es inmutable. Un pedido
de Checkout Pro nacía sin punto de entrega para siempre. Los demás medios de pago
no comparten el defecto: escriben `delivery_latitude` directo.

Migración `20260807160000_checkout_pro_delivery_coordinates`, aplicada a staging.
Sin coordenadas, un origen `gps` o `geocoder` se **degrada** a `manual` en vez de
abortar: la dirección postal sigue siendo válida y el pedido tiene que poder
avanzar; lo que no puede es afirmar un origen sin respaldo.

### 1.4 Corte 4 — staging no tenía punto de retiro

Medido: `private.rider_map_business_locations` con **0 filas** y
`businesses.address` en **NULL**. El contrato del mapa
(`20260804090000_rider_map_location_contracts`, que vive sólo en el remoto y está
documentado en `docs/migrations/remote-only/`) funcionaba perfecto: devolvía nulo
porque no había nada que devolver.

`supabase/staging-rider-map-pickup-point.sql` carga el punto declarado por
`js/config.js` (`-38.9516, -68.0591`) como **`qa_fixture`**, no como
`business_verified`: nadie del negocio verificó todavía ese punto contra la
puerta del local, y decir lo contrario sería afirmar una verificación que no
ocurrió.

### 1.5 Corte 5 — la dirección del negocio tiene que coincidir con la app

Al cargar una etiqueta descriptiva (`Local TABA2 · Neuquén Capital…`) el Rider
quedó **bloqueado sobre un pedido válido**:

> **Retiro no reconocido.** Este pedido no corresponde a La Taba 2. No podemos
> operarlo desde acá.

La app trae su identidad compilada (`kTabaBusinessIdentity`: `La Taba 2`,
**`Mendoza 827`**) y `matchesProjection` compara nombre **y dirección** con lo
proyectado por el backend. Falla cerrada a propósito, y está bien que lo haga.
Mientras la app declare `Mendoza 827`, el backend tiene que decir `Mendoza 827`.
Corregido y anotado dentro del propio SQL.

### 1.6 Resultado: `LT-0098`

```
delivery_latitude              -38.953900      business_latitude   -38.951600
delivery_longitude             -68.059600      business_longitude  -68.059100
delivery_geolocation_accuracy   12.00          business_source     qa_fixture
delivery_address_source         gps            customer_source     gps
```

Los dos puntos, en la instantánea inmutable del pedido. Es la primera vez que un
pedido de TABA2 los tiene.

---

## 2. CLIENTE — navegador real contra el sitio publicado

Chromium con viewport de teléfono, `es-AR`, `America/Argentina/Buenos_Aires`,
permiso de ubicación concedido y posición fija en Neuquén Capital —exactamente lo
que hace el teléfono de una persona con el GPS puesto—. Sesión **anónima** creada
por el propio storefront: el camino real, sin login inyectado ni RPC directo.

| Paso | Resultado |
| --- | --- |
| Perfil | nombre y teléfono cargados en la UI real |
| Dirección | `Avenida Argentina 450, Neuquén` + **«Usar mi ubicación» → «Confirmar ubicación»** |
| Persistencia | `customer_addresses`: lat `-38.9539`, lng `-68.0596`, precisión `12`, source **`gps`** |
| Producto | **Red Bull Energy Drink**, real, **sin alcohol**, $ 3.576 |
| Carrito | `Total $ 3.726` (con envío $ 150), decidido por el backend |
| Pago | Mercado Pago **TEST**, tarjeta de prueba, 1 cuota |
| Aprobación | operación `171665077885`, `status=approved` |
| Cierre | pantalla **«Pedido confirmado · Pedido LT-0098»** |
| Errores propios del storefront | **0** (los únicos observados son CSP y `requestStorageAccessFor` de las páginas de Mercado Pago) |

### 2.1 El contrato de versionado, cobrándose una corrida

Una corrida entera midió el árbol equivocado: el service worker servía los bytes
`v48` desde su caché mientras el borde ya publicaba `v49`, y el cartel «Hay una
actualización disponible» estaba a la vista sin que yo lo leyera. El arreglo
estaba bien; la página no lo tenía. Por eso esta rama rota la versión de caché
cada vez que cambian bytes precacheados: `v47 → v48 → v49`, y `?v=43 → ?v=44`
cuando cambió una hoja.

---

## 3. NEGOCIO — Panel real, sobre `LT-0098`

Panel publicado (`/#business`), login real con el actor `owner`
(`qa-business-staging@local.taba`), solapa **Pedidos**. Cada avance salió de un
click en la UI: **ningún RPC directo**.

| Prueba | Resultado |
| --- | --- |
| El pedido entra solo | `LT-0098` aparece en la bandeja sin buscarlo: **una sola aparición** |
| Aceptar | `received → accepted`, revisión **2 → 3** |
| Preparar | `accepted → preparing`, revisión **3 → 4** |
| Listo con **doble click** | `preparing → ready`, revisión **4 → 5**: dos pulsaciones, **una sola transición** |
| Reload completo | el estado sobrevive en `ready` y sigue habiendo una sola tarjeta |
| Offline | con la red cortada el servidor **no se movió** (revisión 5 → 5) |
| Reconexión | sin duplicar (revisión 5 → 5) |
| Errores de página | **0** |

Se observó además el diseño offline-first funcionando de verdad: el Panel encola
los comandos y los concilia contra el backend, así que una espera fija mide la
latencia de la red y no al producto. El driver espera al estado observable.

La sesión anterior había certificado la misma matriz sobre `LT-0096` con un
actor `staff`, incluidos los 3 recibos de idempotencia, las claves sin `:` y los
`order_events` con `type` lleno.

---

## 4. RIDER — el bloqueo, con evidencia

### 4.1 Lo que sí quedó probado

| | |
| --- | --- |
| App canónica | `fix/taba2-rider-commercial-review-p1` (`9b498db`), el head que desciende de todo el linaje |
| Integración | + `test/taba2-rider-staging-smoke-automation` (24 archivos nuevos, **cero del producto**) → `release/taba2-rider-first-physical-e2e` |
| APK | flavor **staging** (`com.lataba.rider.staging`), build propio |
| Instalación | `sha256 0cee5546…` — **local ≡ instalado**, verificado bajando el APK del teléfono |
| Moto G15 | `ZY32LHS6PS`, Android 15, por ADB |
| Permisos | ubicación fina, aproximada y notificaciones concedidos |
| Cola y privacidad | pre-claim la cola muestra **«Zona general: Neuquen»**; post-claim la dirección completa. El contrato de privacidad **funciona** |
| Contratos vigentes | `get_rider_queue` filtra `origin='production'`, oculta `customer_location` antes del claim y **no** es ejecutable por `anon` |

### 4.2 El defecto grande: una ubicación desautenticaba al Rider

Síntoma: **la app autentica bien, persiste la sesión en disco y vuelve sola a la
pantalla de ingreso**, con el formulario vacío y **sin ningún mensaje de error**.

Costó media jornada porque todo lo observable decía que estaba sana: el archivo
`no_backup/rider_session.enc` quedaba escrito, el servicio de reparto arrancaba,
y el backend no registraba ningún cierre de sesión. Se descartaron, con
evidencia, la membresía (la consulta exacta de la app con un JWT real devuelve
`200` con la fila), la competencia de sesiones, el tipeo, el reloj del teléfono
y las credenciales.

Lo que lo destrabó fue instrumentar el puente con un rastro de vocabulario
cerrado (`TabaAuth`, sin secretos). La traza lo dice sin ambigüedad:

```
15:11:32.130  emit type=signedIn state=signedIn role=rider listeners=1
15:11:32.132  flutter: evento type=signedIn version=1 hayData=true
15:11:32.498  flutter: resultado ok=true state=signedIn role=rider
15:11:33.574  bridge listAvailableOrders -> ArrayList
15:11:35.417  flutter: evento type=locationChanged version=1 hayData=true
```

**Causa.** El canal de eventos es **uno solo** y lo comparten la sesión, el
servicio de reparto y la ubicación. `AuthController._onEvent` descartaba
únicamente `serviceStateChanged` y construía una `RiderSession` con **cualquier
otro payload**. Apenas el GPS entrega un fix llega `locationChanged`, cuyo `data`
es una ubicación: `RiderSession.fromMap` no encuentra `state` y cae en
`signedOut` por el caso por defecto del `switch`. Tres segundos entre el ingreso
y la pérdida de la pantalla.

Eso explica todo lo que parecía contradictorio: con el permiso de ubicación
denegado no pasaba, con el permiso concedido pasaba siempre, y `pm clear`
—que resetea permisos— lo «arreglaba» una vez.

**Arreglo.** Lista blanca en vez de lista negra: sólo los seis tipos que
describen la sesión se aplican. Un tipo que este controlador no entiende no
puede tocarla. Con test que **falla sin el arreglo** (2 de 4 casos) y pasa con
él; `flutter test` **251/251**.

### 4.3 Lo que se certificó después del arreglo

| Prueba | Resultado |
| --- | --- |
| Ingreso estable | autenticado y **sobrevive arranque en frío**; 35 s con el GPS entregando fixes sin perder la sesión |
| Identidad del negocio | «La Taba 2 · Mendoza 827», sin el bloqueo «Retiro no reconocido» |
| **Mapa vivo** | tiles reales de Neuquén Capital con el **pin del local dibujado** en el punto autorizado, brújula, recentrado y navegación |
| Privacidad pre-claim | «Zona Neuquén — Zona aproximada. La dirección exacta se muestra al aceptar» |
| `LT-0096` llegada y código | fase `ARRIVAL_AND_CODE` **PHASE_PASSED** |
| `LT-0096` entrega | **`delivered`**: `arrived_at` 18:33:28, `delivered_at` 18:33:56, revisión 12 |
| Rider libre | 0 pedidos en vuelo tras la entrega |

El mapa de `LT-0096` sigue diciendo «sin coordenadas» y **está bien**: ese pedido
nació antes de los arreglos y su instantánea es inmutable por contrato. El que
tiene los dos puntos es `LT-0098`.

### 4.4 Los 25 pasos sobre `LT-0098`, en el Moto G15

| # | Paso | Resultado |
| --- | --- | --- |
| 1–3 | sesión viva, abrir la cola, localizar el pedido | **PASS** — `LT-0098` encontrado entre **dos** pedidos disponibles |
| 4–5 | zona aproximada pre-claim, dirección enmascarada | **PASS** — privacidad `PASS`: «Zona Neuquén», sin el número exacto |
| 6 | reclamar · doble claim no-op | **PASS** — `ready → assigned`, revisión +1; el control de aceptar deja de existir |
| 7 | dirección exacta post-claim | **PASS** — privacidad `PASS` |
| 8–9 | confirmar retiro, iniciar recorrido | **PASS** — `assigned → picked_up → on_the_way` |
| 10 | **GPS vivo estacionario** | **PASS** — fix vivo con el equipo quieto. **No se afirma desplazamiento**: el Moto no se movió |
| 11–12 | recentrar, encuadre de paradas | **PASS** |
| 13–14 | abrir Google Maps, volver a TABA2 Rider | **PASS** — otra app toma el foreground y la app vuelve con su estado |
| 15–17 | apagar pantalla, 20 s reales en background, encender | **PASS** |
| 18–19 | app a background, volver a foreground | **PASS** |
| 20 | cortar la red | **PASS** — sin red validada |
| 21 | acción offline permitida | **PASS** — el servidor **no se movió**: revisión 11 → 11 |
| 22 | restaurar la red | **PASS** |
| 23 | sincronización exactly-once | **PASS** — revisión 11 → 11, estado intacto, **3 ubicaciones publicadas** |
| 24 | tracking del cliente entrega el código | **PASS** — «Tu pedido está en camino · Rider TABA2 En camino»; el código sale del navegador del cliente |
| 25 | llegada | **PASS** — `on_the_way → arrived` |
| 26 | **código incorrecto rechazado** | **PASS** — `failed_attempts 0 → 1`, el pedido **sigue** en `arrived` |
| 27 | código correcto · entregado una sola vez | **PASS** — **`delivered`**, revisión 15, `delivered_at` 20:28:30 |
| 28 | Rider vuelve a libre | **PASS** — 0 pedidos en vuelo |

Sobre el paso 10: el teléfono estuvo quieto sobre el escritorio toda la corrida.
Lo que se certifica es que el GPS entrega un fix vivo y que la app lo publica
—3 puntos llegaron al backend—. **No se certifica movimiento**, porque no lo
hubo.

Sobre el paso 21: la corrida se hizo con la app **viva**, no reiniciándola. El
escenario real es perder señal con la app abierta. Al reiniciar el proceso sin
red aparece otra cosa, y está anotada abajo como hallazgo.

### 4.5 Hallazgo anotado y no corregido: arranque en frío sin red

Medido: con la red cortada y el proceso reiniciado, la app muestra **«Sin
pedidos disponibles»** y «Todavía no hay nada que ubicar», aunque el Rider tiene
un reparto en curso y `no_backup/active_delivery.json` lo tiene en disco. El
cartel dice «Seguimos mostrando la última información confirmada» y no muestra
ninguna.

No se tocó. No es el escenario que vive una persona —Android tendría que matar
la app justo mientras está sin señal— y arreglar la recuperación offline del
estado activo es un cambio de fondo en el arranque, que no se hace a las apuradas
antes de un pedido real. Queda medido, con su captura, para que quien lo tome
sepa exactamente qué reproducir.

---

## 5. Cierre QA — 14/14

| Verificación | Resultado |
| --- | --- |
| Cliente ve entregado | `delivered`, `delivered_at` 2026-08-07T20:28:30Z |
| Panel | `LT-0098` sale de la bandeja al volverse terminal; «La operación está al día», 0 comandos pendientes |
| Rider vuelve a libre | 0 pedidos en vuelo; la app vuelve a «Pedido disponible» |
| Pedido único | 1 pedido por huella de intención. **Cero duplicados** |
| Entregado una sola vez | un único `delivered_at`; 14 eventos, 8 cambios de estado, ninguno con `type` nulo |
| Código confirmado una vez | `confirmed_at` presente; `failed_attempts` vuelve a 0 tras el acierto |
| Stock y reservas | Red Bull 93 → **92**: 2 vendidas, 1 devuelta por la cancelación de `LT-0097`. Sin reservas colgadas |
| Rastro GPS purgado | 3 puntos durante el viaje → **0** tras entregar. El trigger los borra y acota el seguimiento a 30 min |
| ARCA | `fiscal_documents` **0**, `fiscal_outbox` **0**, `pos_sales` **0**. Sin emisión |
| Producción | `la-taba-demo` nunca fue apuntada |
| `LT-0030` | **idéntico**: `arrived`, revisión 11, $ 550 |
| QA aislado | 59 pedidos `origin=qa`, ninguno en la cola de producción |
| Cola de producción | **vacía** |
| Gates | `npm test` **1119/1119** · `flutter test` **251/251** · `check` ok · `migrations:validate` aprobado. Tras el arreglo de navegación: `flutter test` **254/254** |

### 5.1 Residuos, retirados por la UI real

`LT-0097` —el pedido de la corrida que descubrió el corte de coordenadas, sin
punto de cliente y por lo tanto inútil para certificar el mapa— fue
**cancelado desde el Panel con motivo obligatorio**, no borrado por SQL: mover
pedidos reales por fuera de la UI del negocio es justo lo que este trabajo
evita. Quedó `cancelled`, revisión 8, y su unidad volvió al stock.

`LT-0096`, heredado de la sesión anterior en `on_the_way`, quedó **`delivered`**
(revisión 12) cerrado desde la app real: llegada, código y entrega.

En el teléfono no quedó nada: red en su estado original, sin manifiesto QA en la
caché privada, credenciales efímeras borradas del host y del dispositivo.

---

## 6. El punto de retiro: de `qa_fixture` a un punto con procedencia

`LT-0098` se certificó con el retiro en `qa_fixture`, un punto de prueba en el
centro de Neuquén Capital. Servía para probar el mapa; no servía para que alguien
fuera a buscar el pedido. Esta sección cuenta cómo se reemplazó y —sobre todo—
**qué no se puede afirmar todavía** de lo que quedó.

### 6.1 Lo primero fue no inventar

El punto no salió de un geocodificador. `Mendoza 827, Neuquén` devuelve, en OSM,
**una casa en Zapala a 175 km**: el único «Mendoza 827» que la base tiene en toda
la provincia. Un geocodificador que responde con seguridad algo que está a 175 km
del local es exactamente la razón por la que no se acepta su respuesta.

El punto aplicado —`-38.946054, -68.053236`— es el que aportó la persona a cargo,
tomado de un **directorio público de comercios y contrastado con dos fuentes
independientes** que coinciden en nombre y dirección. No es una medición sobre la
puerta. Y como no lo es, **no se registró como verificado**.

### 6.2 El registro dice lo que el punto es, no lo que uno quisiera

La migración `20260807170000_pickup_point_provenance.sql` le agrega procedencia a
`private.rider_map_business_locations` y pone la regla en la base, no en la
costumbre:

```sql
check (human_verified = false or source = 'business_verified')
```

Sólo un punto confirmado sobre el local puede llamarse verificado. Lo aplicado
hoy es:

| Campo | Valor |
| --- | --- |
| `latitude`, `longitude` | `-38.946054`, `-68.053236` |
| `source` | `public_directory_cross_checked` |
| `confidence` | `medium` |
| `human_verified` | **`false`** |
| `accuracy_m` | `null` — no hay medición, y un número inventado sería peor que nada |
| `presence_status` | sin verificar |

Un detalle que casi rompe todo: el trigger que congela la instantánea del pedido
**copia el `source` del negocio en el `INSERT`**. Extender el CHECK de
`rider_map_order_location_snapshots` no era cosmético; sin eso, la primera compra
con el punto nuevo habría abortado la creación del pedido.

La herramienta `scripts/set-pickup-point.mjs` exige `--fuente` para este origen,
exige `--confirmado-por-humano` para `business_verified`, rechaza cualquier
coordenada fuera de Neuquén Capital y **imprime el comando de reversión** con el
punto anterior antes de mutar.

### 6.3 Las comprobaciones, con su resultado real

| Comprobación | Resultado |
| --- | --- |
| Dentro de Neuquén Capital | **sí** — dentro de `defaultMapBounds` de `js/config.js` |
| Contra la geometría real de calle Mendoza | **15 m** perpendiculares al eje de la calle (traza OSM, barrio Santa Genoveva) |
| Contra el falso positivo de Zapala | **175 km** — descartado |
| Contra el POI «Mercado La Taba» de Islas Malvinas 145 | **368 m** — es otro local, descartado |
| Geocodificación inversa del punto | «Diagonal España», Santa Genoveva, Neuquén — es la esquina; los 15 m lo explican |
| Altura 827 de Mendoza en OSM | **no existe** en Neuquén Capital: la comparación se apoya en la geometría de la calle, no en el número |
| Google Maps | abre **la coordenada exacta**, con pin y ruta; pero **no la etiqueta «Mendoza 827» ni conoce «La Taba 2»**: muestra el plus code `3W3W+HPC` |

Esa última fila es la que impide declarar el punto cerrado. El destino es
coherente y navegable; la etiqueta no lo confirma.

### 6.4 Google Maps no resolvía el texto — y por eso se navega por coordenada

Al probar la salida a navegación apareció un defecto que el `qa_fixture` tapaba:
la app le pasaba a Maps **el texto de la dirección**, y Maps abría la vista
genérica de Neuquén **sin ningún resultado**. El Rider tocaba «navegar» y se
quedaba sin destino.

Arreglado en el repo del Rider (`a37bdd4`): se navega por **la coordenada que el
mapa ya está dibujando** —la del negocio antes del retiro, la del cliente desde
`pickedUp`—, con el texto sólo como respaldo. Verificado en el Moto G15: tocar
navegar abre Maps con la coordenada, pin y «Cómo llegar», y volver conserva el
reparto activo.

### 6.5 `LT-0099`: la prueba focal, no un E2E repetido

No se rehízo la certificación completa. Se corrió lo que el cambio de punto
podía romper, sobre un pedido nuevo:

| Tramo | Resultado |
| --- | --- |
| Cliente con dirección estructurada y GPS | pedido creado con los dos puntos en su instantánea |
| Panel: recibido → aceptado → preparando → listo | **PASS**, con doble clic, recarga, offline y reconexión. 0 errores |
| Rider: cola, privacidad pre-claim, claim, doble claim | **PASS** — el doble claim no mueve la revisión |
| Retiro e inicio del recorrido | **PASS** |
| Mapa: pin del negocio, pin del rider, pin del cliente, encuadre | **PASS** — «La Taba 2 · Mendoza 827 · 16 m aprox.» |
| GPS real del teléfono contra el punto aplicado | `-38.9459199, -68.0533019`, precisión 11,5 m → **16,0 m** del punto |
| Abrir Google Maps y volver sin perder estado | **PASS** |
| Código incorrecto | **rechazado** (`failed_attempts` 0 → 1) |
| Código correcto → `delivered` | **PASS**, revisión 12, un único `delivered_at` |
| Cierre QA sobre `LT-0099` | **14/14** |

Los 16 m entre el GPS del teléfono y el punto aplicado **no son un error medido
del punto**: el teléfono estaba en otro lado. Es la distancia entre dos lugares
distintos, y se anota como tal.

### 6.6 Lo que queda pendiente y cómo se cierra

Ningún pedido vivo arrastra `qa_fixture`: quedan 3 instantáneas terminales que lo
llevan congelado por diseño —la instantánea es inmutable— y ninguna viva.

El punto se cierra **en el primer retiro físico**, no antes: cuando el rider
confirme el retiro parado en la puerta, se toma GPS fresco, se exige precisión
**≤ 20 m** y se compara. A **≤ 30 m** se registra `verified_by_rider_presence`;
por encima **no se sobrescribe nada** y queda marcado
`PICKUP_LOCATION_DISCREPANCY` con la evidencia.

---

## 7. El GPS en vivo: dos defectos que nadie había visto

Todo lo anterior se certificó con el mapa dibujando pines. Ninguna de esas
corridas miró lo que el proveedor de ubicación del sistema estaba haciendo de
verdad, y ahí había un agujero grande: **la app publicaba una sola posición por
entrega y después nada, para siempre**. El cliente veía al Rider congelado en la
puerta del local todo el viaje. Eso explica, hacia atrás, los «3 puntos
publicados» de `LT-0098` y `LT-0099`: no era una cadencia, era el arranque y dos
rebotes de ciclo de vida.

### 7.1 El muestreo se apagaba solo

`LocationSampler` decía en su propio comentario que cambiaba de perfil *«only
after a stable movement classification»*. Clasificaba con **la primera muestra**.
Y un reparto empieza siempre con el Rider parado —acaba de retirar el pedido—,
así que degradaba siempre, en todas las entregas.

El perfil degradado pedía además **35 m de desplazamiento mínimo**.
`minUpdateDistance` no filtra lo que llega: es una condición para que el
proveedor entregue algo. Con el equipo quieto no entregaba nada. En
`dumpsys location` se ve el alta a las `20:29:41.741` y la **baja 1,23 s
después**, apenas llegó el primer fix.

Arreglado en `2457d75`: hacen falta tres clasificaciones quietas seguidas para
bajar de perfil, se sube al primer indicio de movimiento, y ningún perfil exige
desplazamiento. El ahorro del perfil quieto pasó a ser la cadencia.

### 7.2 La revisión congelada

Con eso arreglado el seguimiento **seguía cortándose**. El último punto fue a las
`00:39:38`; ocho segundos después, en el mismo pedido, hay un
`order.tracking_access_recovered`.

El disparador de `orders` sube la revisión ante **cualquier** cambio de la fila.
El actor de seguimiento la llevaba congelada desde que arrancaba el recorrido, y
desde el primer cambio el backend rechaza toda publicación con `code: 'stale'`,
que el cliente mapea como reintentable y reintenta para siempre. Al Rider le
muestra **«Sin conexión» con la red intacta**: en la misma corrida la
confirmación de entrega pasó sin problemas por esa misma red.

Lo que mueve la revisión durante un reparto no es una rareza. Es el propio
**«Llegué»** del Rider, y es **el cliente abriendo su seguimiento**, que es justo
lo que una persona hace mientras espera el pedido.

El servidor ya devolvía la revisión vigente en el rechazo; el cliente la tiraba.
Arreglado en `fd756dc`: se propaga, se distingue como `REVISION_MOVED` y el actor
la adopta y reintenta en el acto. Sólo hacia adelante: una revisión que no avanza
detiene el seguimiento en vez de hacerlo girar en el lugar.

### 7.3 Lo medido, con el equipo QUIETO

41 puntos seguidos sobre `LT-0102`, sin un solo hueco, mientras el cliente
recuperaba su seguimiento dos veces:

| | |
| --- | --- |
| Cadencia | mediana **12,44 s** (perfil activo 10 s, quieto 12 s) |
| Latencia Moto → backend | mediana **0,21 s**, máximo 0,58 s |
| Precisión | mediana **11,7 m** (8,5 a 20,0 m) |
| Salto entre fixes | mediana 0,93 m — **ruido de GPS: el teléfono no se movió** |
| Pantalla apagada | 8 publicaciones seguidas sin perder cadencia |
| Tras `delivered` | 27 puntos → **0**, purgados por el trigger |
| Revisiones en los puntos guardados | **8, 9 y 10** — el actor las adoptó en vivo |

La cadencia quieta quedó en **12 s y no en 30** porque el seguimiento del cliente
llama «vivo» a un fix de hasta 15 s (`GPS_LOCATION_FRESH_MS`). Medido con 30 s:
la pantalla del cliente alternaba entre «última ubicación» y «ubicación
temporalmente no disponible». Ese techo lo pone el consumidor, no una preferencia
de batería, y quedó fijado en un test.

**No se midió desplazamiento.** El teléfono estuvo quieto todo el tiempo y no se
afirma movimiento. La prueba de movimiento queda pendiente en
`HUMAN_CHECKPOINT_SAFE_GPS_MOVEMENT`.

### 7.4 El bloqueo que no es de software

**El Moto G15 no tiene SIM.** `slot 0: N/A`, `defaultDataSubId=-1`, y ninguna
interfaz móvil registró tráfico nunca: el equipo siempre estuvo en el Wi‑Fi de la
casa. Apenas sale a la calle se queda sin red. Sin datos móviles no hay
seguimiento en vivo durante un reparto real, ni forma de confirmar el código en
la puerta del cliente.

Todo lo de esta sección está probado sobre Wi‑Fi. El primer pedido humano queda
**postergado hasta que el teléfono tenga datos** —SIM propia o hotspot de otro
equipo—, por decisión explícita.

---

## 8. Primer pedido humano físico

Todo lo técnico está probado sobre este mismo teléfono. Estos son los cinco
pasos:

1. **URL del cliente** — `https://taba2-staging.pages.dev`
   Tu pareja compra desde ahí. En el Perfil, al cargar la dirección:
   **«Usar mi ubicación» → «Confirmar ubicación»** antes de guardar. Ese paso es
   el que enciende el mapa del Rider; sin él la entrega llega sin punto.
2. **App que abrís vos** — **TABA2 Rider** (ícono de la moto), ya instalada y
   verificada en el Moto G15.
3. **Usuario Rider** — `qa-rider-2-staging@local.taba`, **ya con la sesión
   abierta en el teléfono**: no hace falta volver a entrar. Es importante que sea
   **ése** y no `qa-rider-staging`, que tiene `LT-0030` tomado y no se toca.
4. **Producto** — **Red Bull Energy Drink**, 250 ml, **$ 3.576**, stock **91**.
   Real y **sin alcohol**. Pago **TEST**: no se mueve dinero real.
5. **Recorrido** — retirás en **Mendoza 827** y entregás donde tu pareja cargue
   la dirección. En el mapa vas a ver los dos puntos; al llegar, ella te dicta
   el código de 4 dígitos que ve en su seguimiento.

**Requisito previo, sin excepción: el teléfono tiene que tener datos móviles**
(sección 7.4). Hoy no los tiene y por eso este pedido está postergado.

**Estado del alistamiento, verificado el 8/8:** producto activo con stock 91 a
$ 3.576; Rider libre (0 pedidos en vuelo) y con sesión viva; punto de retiro
cargado y dibujándose; APK `ee0032cf81d5…` instalada y coincidente con la
construida; Panel operativo; storefront publicado; Mercado Pago en `test`,
demostrado por digest sin leer el secreto; GPS vivo medido (sección 7.3).

**Dos cosas para tener presentes.**

La primera: el pin del retiro es **provisional** (sección 6). Está a 15 m del eje
de calle Mendoza, así que te deja en la cuadra, pero no está medido sobre la
puerta. **Cuando confirmes el retiro parado en el local, avisame**: ahí se toma
el GPS bueno y el punto queda cerrado con evidencia.

La segunda: en la cola del Panel hay **6 pedidos QA viejos** (`LT-0004`,
`LT-0033`, `LT-0034`, `LT-0035`, `LT-0036`, `LT-0095`). No se cancelaron porque
cancelar toca stock y el stock está fuera de alcance. **Buscá el pedido por su
código**, que es el más reciente; no confíes en que sea el único de la lista.

Sobre reinstalar la APK: la advertencia anterior de este documento —«limpiá los
datos antes de volver a entrar»— **quedó desmentida y se corrige acá**. Se
reinstaló con `adb install -r` durante esta sesión y la sesión sobrevivió, igual
que el reparto activo en disco. Lo que rompía el ingreso no era la reinstalación
sino el defecto de la sección 4.2, ya arreglado. **No hace falta borrar nada.**

---

## 9. Lo que no se tocó

Producción, ARCA (`services/arca-fiscal-bridge` sin cambios), `LT-0030`,
`LT-0033` / `LT-0034` / `LT-0035`, los locks ajenos, las ramas fuente del Rider
(ninguna fue movida) y los artefactos de las otras sesiones.

Datos del teléfono: sólo se tocaron los de `com.lataba.rider.staging` —un
`pm clear` en la primera jornada para poder re-loguear, permitido por el lock del
Moto—. En la jornada del punto de retiro **no se usó `pm clear`**: la APK nueva
entró con `adb install -r` y la sesión y el reparto activo quedaron intactos.
Ninguna app ajena fue desinstalada ni modificada.

Pedidos: `LT-0030` intacto (`arrived`, revisión 11, $ 550) y los 6 pedidos QA
viejos de la cola quedaron **sin tocar**, porque cancelarlos habría movido stock.

---

## 10. Declaración

Con el pedido `LT-0098` recorriendo storefront → Panel → app Rider Android →
`delivered` sobre las tres interfaces reales, con mapa vivo, GPS real, corte de
red, código incorrecto rechazado y código correcto confirmado una sola vez, y
con el cierre QA en 14/14:

**TABA2_CLIENT_BUSINESS_RIDER_FULL_E2E_CERTIFIED**

Con el punto de retiro reemplazado por uno con procedencia declarada, la prueba
focal `LT-0099` en verde de punta a punta (14/14), la navegación externa
arreglada, el Rider libre y la APK `81633242680905a0…` instalada y verificada en
el Moto G15:

**TABA2_READY_FOR_FIRST_HUMAN_PHYSICAL_ORDER_WITH_PROVISIONAL_PICKUP**

**No se declara `TABA2_READY_FOR_FIRST_HUMAN_PHYSICAL_ORDER` a secas**, y el
motivo es uno solo y concreto: la condición era que el mismo punto apareciera
correctamente en Cliente, Panel, Rider, seguimiento **y Google Maps**. Los cuatro
primeros lo muestran; Google Maps abre la coordenada pero **no la reconoce como
«La Taba 2, Mendoza 827»** —devuelve un plus code—, y el punto sigue con
`human_verified=false`. La declaración definitiva corresponde después de
verificar presencia en el primer retiro físico.

**Tampoco se declara `TABA2_READY_FOR_FIRST_HUMAN_PHYSICAL_ORDER_LIVE_GPS.**
El seguimiento en vivo quedó arreglado y medido (sección 7.3), pero **sobre
Wi‑Fi y con el teléfono quieto**. El Moto G15 no tiene SIM: en un reparto real se
queda sin red apenas sale a la calle, y ahí no hay seguimiento en vivo ni forma
de confirmar el código en la puerta. El primer pedido humano queda **postergado
hasta que el teléfono tenga datos móviles**, por decisión explícita.

Lo que estas declaraciones **no** cubren, dicho explícitamente: no hubo
desplazamiento físico del teléfono, así que no se certifica el seguimiento en
movimiento y queda pendiente `HUMAN_CHECKPOINT_SAFE_GPS_MOVEMENT`; el punto de
retiro es provisional hasta la verificación por presencia (sección 6.6); y el
arranque en frío sin red pierde el reparto activo en pantalla (sección 4.5).
