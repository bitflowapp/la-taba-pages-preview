# FULL-E2E-HANDOFF — TABA2 de punta a punta: cliente, negocio y Rider

Worktree `la-taba2-first-physical-e2e`, rama `release/taba2-first-physical-e2e`,
base `11a0b02`. Todo local: sin push, sin `amend`, `reset`, `clean`, `stash` ni
`git add .`.

Lo que este documento sostiene no es que el circuito *puede* funcionar, sino que
**funcionó**: un mismo pedido —`LT-0098`— fue comprado desde un navegador,
operado desde el Panel del negocio y **entregado desde la app Android instalada
en un Moto G15 físico**, con el mapa vivo, GPS real, corte de red y código de
entrega. Nada de RPC directo, mocks ni tests en lugar de esas tres interfaces.

---

## 0. Resumen para leer primero

| | |
| --- | --- |
| Pedido certificado | **`LT-0098`** — Red Bull Energy Drink, real, **sin alcohol**, $ 3.726, pago Mercado Pago **TEST** aprobado (op. `171665077885`) |
| Recorrido | storefront → pedido → Panel → accepted → preparing → ready → app Rider → claim → retiro → en camino → GPS → llegada → **código incorrecto rechazado** → código correcto → **`delivered`** |
| Novedad | primer pedido del proyecto con **los dos puntos del mapa** en su instantánea, y primer mapa del Rider que dibuja el local sobre calles reales de Neuquén |
| Defectos cerrados | **6**, incluido el que dejaba a la app Rider en la pantalla de ingreso con la sesión viva |
| Cierre QA | **14/14** verificaciones |
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
| Gates | `npm test` **1119/1119** · `flutter test` **251/251** · `check` ok · `migrations:validate` aprobado |

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

## 6. Primer pedido humano físico

Todo lo técnico está probado sobre este mismo teléfono. Estos son los cinco
pasos:

1. **URL del cliente** — `https://taba2-staging.pages.dev`
   Tu pareja compra desde ahí. En el Perfil, al cargar la dirección:
   **«Usar mi ubicación» → «Confirmar ubicación»** antes de guardar. Ese paso es
   el que enciende el mapa del Rider; sin él la entrega llega sin punto.
2. **App que abrís vos** — **TABA2 Rider** (ícono de la moto), ya instalada y
   verificada en el Moto G15.
3. **Usuario Rider** — `qa-rider-2-staging@local.taba`. La contraseña se rotó
   durante las pruebas: **pedímela y te la fijo en el momento**.
4. **Producto** — **Red Bull Energy Drink**, 250 ml, $ 3.576. Real y **sin
   alcohol**. Pago **TEST**: no se mueve dinero real.
5. **Recorrido** — retirás en **Mendoza 827** y entregás donde tu pareja cargue
   la dirección. En el mapa vas a ver los dos puntos; al llegar, ella te dicta
   el código de 4 dígitos que ve en su seguimiento.

**Antes del pedido real**, con el negocio delante: reemplazar el punto
`qa_fixture` por el punto real de la puerta del local y recién ahí declararlo
`business_verified`. El SQL exacto está al final de
`supabase/staging-rider-map-pickup-point.sql`. Mientras siga en `qa_fixture`, el
pin del retiro está en el centro de Neuquén Capital, no en tu puerta.

Y una advertencia que vale la pena tener presente: si reinstalás la APK, **limpiá
los datos de la app antes de volver a entrar**. El almacén cifrado de sesión
queda inservible tras la reinstalación y el ingreso parece funcionar pero no se
sostiene. Está medido en la sección 4.

---

## 7. Lo que no se tocó

Producción, ARCA (`services/arca-fiscal-bridge` sin cambios), `LT-0030`,
`LT-0033` / `LT-0034` / `LT-0035`, los locks ajenos, las ramas fuente del Rider
(ninguna fue movida) y los artefactos de las otras sesiones.

Datos del teléfono: sólo se tocaron los de `com.lataba.rider.staging` —un
`pm clear` para poder re-loguear, permitido por el lock del Moto—. Ninguna app
ajena fue desinstalada ni modificada.

---

## 8. Declaración

Con el pedido `LT-0098` recorriendo storefront → Panel → app Rider Android →
`delivered` sobre las tres interfaces reales, con mapa vivo, GPS real, corte de
red, código incorrecto rechazado y código correcto confirmado una sola vez, y
con el cierre QA en 14/14:

**TABA2_CLIENT_BUSINESS_RIDER_FULL_E2E_CERTIFIED**

Con la APK final instalada y verificada en el Moto G15 (`sha256 fc2dd0a6aa60…`),
el Rider libre, la cola de producción vacía y el circuito documentado en cinco
pasos:

**TABA2_READY_FOR_FIRST_HUMAN_PHYSICAL_ORDER**

Lo que estas declaraciones **no** cubren, dicho explícitamente: no hubo
desplazamiento físico del teléfono, así que no se certifica el seguimiento en
movimiento; el punto de retiro es `qa_fixture` hasta que el negocio verifique el
real; y el arranque en frío sin red pierde el reparto activo en pantalla
(sección 4.5).
