# FULL-E2E-HANDOFF — TABA2 de punta a punta: cliente, negocio y Rider

Worktree `la-taba2-first-physical-e2e`, rama `release/taba2-first-physical-e2e`,
base `11a0b02`. Todo local: sin push, sin `amend`, `reset`, `clean`, `stash` ni
`git add .`.

**Este documento no declara la certificación completa.** El circuito cliente →
negocio quedó cerrado y el pedido para el piloto humano quedó preparado con el
mapa vivo por primera vez. El rol Rider está **bloqueado por un defecto de la
app Android** que se aisló, se reprodujo y se documenta abajo con la evidencia.

---

## 0. Resumen para leer primero

| | |
| --- | --- |
| Pedido preparado | **`LT-0098`** — Red Bull Energy Drink, real, **sin alcohol**, $ 3.726, pago Mercado Pago **TEST** aprobado (op. `171665077885`) |
| Novedad | primer pedido de la historia del proyecto que llega con **los dos puntos del mapa** en su instantánea |
| Bloqueo | la app Rider **autentica bien y vuelve sola a la pantalla de ingreso** |
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

## 3. NEGOCIO — Panel real

Certificado en la sesión anterior sobre `LT-0096` con un actor `staff`, cada
avance por click en la UI, ningún RPC directo: el pedido entra solo, aceptar →
preparar → listo (`revisión 2 → 5`), doble click sin cuarta transición, reload
completo con una sola tarjeta, offline sin mover el servidor, reconexión
aplicando el comando retenido **una sola vez**, 3 recibos de idempotencia, claves
sin `:` y `order_events` con `type` lleno. **0 errores de página.**

`LT-0098` **no** pasó por el Panel en esta sesión: se detuvo en `received` porque
el rol Rider quedó bloqueado y no tenía sentido moverlo a `ready` para que nadie
pudiera levantarlo.

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

### 4.2 El defecto que bloquea

**La app autentica correctamente, persiste la sesión en disco y vuelve sola a la
pantalla de ingreso.**

Reproducido con el formulario correctamente completo —captura
`rider-login-directo/formulario-completo.png`: `qa-rider-2-staging@local.taba` y
la contraseña, ambos en su campo—. Tras enviar:

- se escribe `no_backup/rider_session.enc` (la autenticación **sí** ocurrió);
- 16 s después la pantalla es el formulario **vacío y sin mensaje de error**;
- sobrevive a reinicios sólo a veces: tres arranques en frío seguidos dieron
  formulario las tres veces.

Un formulario vacío **sin error** no es un rechazo de credenciales: `_setError`
dejaría `authError` a la vista. Es un evento `signedOut` llegando desde la capa
nativa después de un ingreso exitoso.

Pistas ya reunidas para quien lo tome:

1. `logcat` registra `E TlcKM: lookup_operation(session, operation_handle, &op) == -28`
   —un fallo de **Keymaster/Keystore**— exactamente en el instante del ingreso.
2. `SessionManager.establishMembership` reintenta **una sola vez** ante un 401 de
   membresía y propaga cualquier otro error. `requireRiderMembership` exige
   `businessId`, `userId`, rol y `is_active`.
3. **La membresía no es la causa**: se probó la consulta exacta de
   `SupabaseAuthClient.getRiderMembership` con un JWT real del rider y la
   publishable key compilada → `200` con la fila correcta.
4. **La competencia de sesiones tampoco**: se repitió el ingreso rotando la
   contraseña una sola vez y sin ningún `password grant` de verificación. Mismo
   resultado.
5. `pm clear` **mejora** la situación de forma transitoria: inmediatamente
   después de limpiar los datos, un ingreso quedó autenticado y sobrevivió un
   arranque en frío. Volvió a fallar después.

La sospecha en pie es la clave del almacén cifrado de sesión: se escribe pero no
se puede volver a operar. Es coherente con el `TlcKM -28`, con que `pm clear`
—que borra las entradas de Keystore de la app— destrabe una vez, y con que la
app deje `rider_session.enc` en disco aunque arranque pidiendo ingreso.

### 4.3 Consecuencia honesta

`LT-0096` quedó **`on_the_way` con el Rider asignado** (revisión 10). Su código
de entrega se recuperó por el camino que el producto ofrece
—`recover_order_tracking_access`, que revoca el token viejo, emite uno nuevo y
**regenera** el código cifrándolo con él— y quedó listo para usar. No se pudo
aplicar porque la app no sostiene la sesión.

**No se declara la certificación del Rider.** No hubo llegada, ni código
incorrecto rechazado, ni código correcto, ni `delivered`, ni GPS en movimiento.
Nada de eso se afirma acá.

---

## 5. Verificaciones de cierre

| Verificación | Estado |
| --- | --- |
| ARCA | `fiscal_documents` **0**, `fiscal_outbox` **0**, `pos_sales` **0**. Sin emisión |
| Producción | `la-taba-demo` nunca fue apuntada |
| `LT-0030` | **idéntico**: `arrived`, revisión 11, $ 550, 9 eventos |
| `LT-0033/34/35` | intactos, `received`, `origin=qa` |
| Duplicados | 2 pedidos, 2 huellas distintas. **Cero duplicados** |
| Stock | Red Bull 93 → **91**: exactamente 2 unidades por 2 pedidos |
| Aislamiento QA | `LT-0095` (`origin=qa`) sigue sin sonar en el Panel ni entrar en la cola |
| Gates | `npm test` **1119/1119** · `npm run check` ok · `migrations:validate` aprobado |

### 5.1 Pedidos que quedan en vuelo

| Pedido | Estado | Por qué |
| --- | --- | --- |
| `LT-0096` | `on_the_way`, rider asignado | heredado; sólo se cierra desde la app |
| `LT-0097` | `received` | residuo de la corrida que descubrió el corte 3; **no tiene coordenadas** y no sirve para certificar el mapa |
| `LT-0098` | `received` | **el pedido preparado** para el piloto |

Ninguno se canceló por SQL: mover pedidos reales por fuera de la UI del negocio
es justo lo que este trabajo evita.

---

## 6. Primer pedido humano físico

Lo que falta es **una sola cosa**: que la app Rider sostenga la sesión.

Cuando eso esté resuelto, el pedido ya está comprado y esperando:

1. **URL del cliente** — `https://taba2-staging.pages.dev`
   (tu pareja compra desde ahí; en el Perfil, «Usar mi ubicación» → «Confirmar
   ubicación» antes de guardar la dirección: eso es lo que enciende el mapa).
2. **App que abrís vos** — `TABA2 Rider` (el ícono de la moto,
   `com.lataba.rider.staging`), **ya instalada** en el Moto G15.
3. **Usuario Rider** — `qa-rider-2-staging@local.taba`. La contraseña quedó
   rotada por esta sesión; te la fijo en el momento y te la paso.
4. **Producto** — **Red Bull Energy Drink**, 250 ml, $ 3.576. Real y **sin
   alcohol**. Pago **TEST**, sin dinero real.
5. **Recorrido** — retirás en `Mendoza 827` y entregás en `Avenida Argentina 450,
   Neuquén`. En el mapa vas a ver los dos puntos.

**Antes del pedido real**, con el negocio delante: reemplazar el punto
`qa_fixture` por el punto real de la puerta del local y recién ahí declararlo
`business_verified`. El SQL exacto está al final de
`supabase/staging-rider-map-pickup-point.sql`.

---

## 7. Lo que no se tocó

Producción, ARCA (`services/arca-fiscal-bridge` sin cambios), `LT-0030`,
`LT-0033` / `LT-0034` / `LT-0035`, los locks ajenos, las ramas fuente del Rider
(ninguna fue movida) y los artefactos de las otras sesiones.

Datos del teléfono: sólo se tocaron los de `com.lataba.rider.staging` —un
`pm clear` para poder re-loguear, permitido por el lock del Moto—. Ninguna app
ajena fue desinstalada ni modificada.
