# TABA2 · REGISTRATION + APPROVAL + CUSTOMER MEMORY · INFORME FINAL

## VERDICT

**`REGISTRATION + CUSTOMER MEMORY READY FOR PRODUCTION REVIEW`**

Con una compuerta de lanzamiento que hay que decir antes que nada: **el alta
pública no funciona todavía en producción por falta de SMTP propio.** El contrato
está aplicado, certificado y probado contra producción real; lo que falta es que
un candidato pueda recibir el correo de confirmación. Detalle en P0.

---

## DB

| | |
|---|---|
| ledger antes | **103** (última `20260816122000`) |
| migraciones nuevas | **4** — 104, 105, 106, 107 |
| ledger después | **107** (última `20260817040000`) |
| local == remoto | **sí** · 0 pendientes, 0 remotas fuera del local |
| drift | **0** |

| # | Migración | Qué hace |
|---|---|---|
| 104 | `20260817010000_business_access_requests` | la tabla del alta + `request_business_access` + `get_my_business_access_request` + 3 tipos de evento de auditoría |
| 105 | `20260817020000_access_request_review_contract` | la bandeja + la decisión atómica |
| 106 | `20260817030000_reviewer_identity_can_be_deleted` | **arregla un defecto propio**: el revisor no podía borrar su cuenta |
| 107 | `20260817040000_membership_guard_allows_account_deletion` | **arregla un defecto preexistente**: ninguna cuenta con membresía se podía borrar por Auth |

Digests verificados antes de cada push:

```
100 históricas : e45f69cdb9c939e29620278450984cd2f4e42ad52cf79295470437c35f5cf2a9  INTACTO
103 aplicadas  : b2af10478c4effc5451f26b5a38b1242a519b1b34248ad5a883444673a4eab76  INTACTO
107 completo   : f03e3f170adbda32171c9b75c2e95f1a1a39b7f6f123e65d6ec635095480e0a6
```

`HISTORICAL MIGRATIONS MODIFIED = 0`. Forward-only, sin `repair`, sin `reset`,
sin edición manual del ledger.

---

## EXISTING MODEL REUSED

La Fase 0 cambió el alcance de la misión. **Dos de los tres tracks ya tenían su
modelo**; lo que faltaba eran pruebas.

Reutilizado tal cual, sin duplicar autoridad:

* `auth.users` como identidad. No se duplicó password ni email en ninguna tabla.
* `business_members` como **la** autorización, con su `unique(business_id, user_id)`.
* `staff_profiles`, `rider_profiles`, `identity_user_security`, `identity_sessions`.
* `identity_permissions` / `identity_role_permissions`: el catálogo explícito.
* `identity_member_role()` y toda su compuerta: `is_business_member`,
  `has_business_role`, `identity_has_permission`, `identity_require_permission`.
* `identity_record_audit_event()` como único escritor de la auditoría.
* `identity_guard_membership_write()` como trigger que cierra la escritura directa.
* `identity_invitations`: intacta. Invitación y solicitud conviven.
* **`customers` + `customer_addresses` y sus cinco RPC: completas desde
  `20260728090000` / `20260729150000`.** No se creó ninguna tabla de cliente.

Se decidió **no** crear: una tabla `rider_applications` aparte, un
`customer_profiles` nuevo, un catálogo de permisos propio, estados `cancelled` o
`revoked`, una bandera `registration_enabled`, geodata nueva, ni CAPTCHA.
Detalle y razones en `EXISTING-MODEL-REUSED.md`.

---

## CUSTOMER PROFILE

**Campos reales**, tomados de los `name=` que el checkout tiene de verdad:

* `customers`: `id = auth.uid()` (PK, no una columna aparte), `name` 2–80 con al
  menos una letra, `phone` normalizado a 10–13 dígitos, `last_order_at`.
* `customer_addresses`: `label`, `street` + `street_number`, `city`,
  `neighborhood` declarado, `floor`, `apartment`, `reference`, `province`,
  `postal_code`, `latitude`/`longitude`/`geolocation_accuracy`, `source`,
  `is_default`, `last_used_at`, `deleted_at`.

**RLS**: activa en las dos. `authenticated` tiene `SELECT` con
`id = auth.uid()` / `customer_id = auth.uid()`, y **cero** INSERT/UPDATE/DELETE.
`anon` no tiene nada. Toda escritura pasa por RPC `SECURITY DEFINER` que derivan
`auth.uid()` y no aceptan un identificador de persona en su firma.

**Direcciones**: múltiples por persona, borrado lógico para no reescribir la
historia de entregas pasadas.

**Contrato de predeterminada**: máximo una, y el invariante es del **índice
único parcial**, no de la RPC. Probado forzando dos por `UPDATE` directo como
superusuario: la base contesta `23505`. Al borrar la predeterminada, se muda a la
dirección viva más recientemente usada; nunca queda cero.

**NEVER STORE verificado**: no existe columna para tarjeta, CVV, token de pago
reutilizable ni credencial de Mercado Pago. El PIN de entrega existe en
`order_delivery_handoffs` como hash + ciphertext **por pedido**, no en el perfil.

---

## CUSTOMER PREFILL

**Carga**: una sola autoridad de estado (`js/customer-delivery.js` +
`customer_profile_repository.js`), no un fetch por componente.

**Carrera resuelta**, y ahora con su prueba nombrada: se abre el checkout, la
respuesta del perfil tarda, la persona empieza a escribir, la respuesta llega →
**lo escrito gana**. Las señales son `addressFormDirty` y
`userInteractedWhileLoading`; `profileHydrationVersion` descarta respuestas de
una carga anterior.

**Guardado**: al confirmar, no en cada tecla.

**Pedido y perfil son responsabilidades distintas**: si guardar el perfil falla,
el checkout sigue y `create_order_with_items` acepta los datos escritos a mano.

**Editar / borrar / elegir predeterminada**: las tres existen en la superficie de
Perfil (`js/customer-profile-view.js`), con confirmación antes de borrar y con el
aviso de que borrar no modifica pedidos anteriores.

---

## BUSINESS REGISTRATION

| Paso | Estado |
|---|---|
| signup | `signUpTeam` con Auth real de Supabase, email/password. Sin Google, sin magic links. |
| request | `request_business_access(business, 'panel', nombre, teléfono)` |
| pending | pantalla comercial: «Solicitud enviada · Esperando aprobación», con actualizar y cerrar sesión |
| approval | owner o admin, desde `Solicitudes de acceso` en el centro de operación |
| rejection | estado claro, sin el motivo interno, con la fecha desde la que puede volver a pedir |

Cinco pantallas, y un estado indeterminado cae al **ingreso**, nunca al
formulario de pedido. Ninguna dice 403, PGRST, JWT, `policy` ni `row-level`: hay
una prueba que revisa el texto de las cinco.

Mobile-first verificado en 390×844, 430×932 y 1440×900: sin desborde y con
**todos** los controles ≥44px. 21 capturas en `screenshots/`.

---

## BUSINESS SECURITY

`self escalation tests`: **98 pruebas** en `registration_approval_test`, más
**37 comprobaciones** contra producción real por HTTP.

| Intento | Respuesta |
|---|---|
| el solicitante se aprueba a sí mismo | 42501 |
| el solicitante cambia pending → approved | 42501 |
| el solicitante inserta en `business_members` | 403 (grant), RLS debajo, guard debajo |
| el solicitante se asigna `owner` | `invalid_role`, para cualquiera |
| un empleado con sesión válida aprueba | 42501 |
| un Rider aprueba a otro Rider | 42501 |
| un admin fabrica otro admin | `role_above_actor` |
| el owner del comercio vecino aprueba una solicitud ajena | 42501 |
| el owner del comercio vecino lee la bandeja ajena | 42501 |
| el owner se aprueba a sí mismo | `self_review` |
| la sesión anónima pide acceso al equipo | `not_authenticated` |
| aprobar dos veces | `already_decided`, y **el rol no cambia** |

`direct membership denial`: tres capas, verificadas por separado. Control
negativo incluido: se devolvió el grant dentro de la transacción y la RLS siguió
rechazando.

`cross-business isolation`: dos comercios en el fixture. Las solicitudes no
cruzan, ni para leer ni para decidir.

---

## RIDER REGISTRATION

| Paso | Estado |
|---|---|
| signup | `Crear cuenta` en la app, sobre el contrato Auth productivo existente. `NativeAuthConfig` sin un byte de cambio. |
| application | `request_business_access(business, 'rider', nombre, teléfono)`. El teléfono es obligatorio: al Rider hay que poder llamarlo. |
| pending | pantalla propia: «Cuenta creada · Tu solicitud está pendiente de aprobación», con `Actualizar estado` y `Cerrar sesión`. Sin mapa, sin tablero, sin ofertas. |
| approval | owner o admin desde el Panel; el rol otorgado sólo puede ser `rider` |
| rejection | estado claro, con la fecha de reintento, y salida por cerrar sesión |

**No se recopila DNI, licencia ni vehículo**: sólo nombre y teléfono, que es lo
que el modelo ya usaba.

**La sesión de la solicitud vive sólo en memoria.** Guardarla en el almacén
cifrado agregaría un refresh token más en disco y una segunda entrada a la
maquinaria de niveles y biometría, a cambio de ahorrarle un login a alguien que no
está trabajando. Lo que sí se persiste es un dato que no es secreto —correo y
último estado— y con eso reabrir la app después de un force-stop muestra la
espera, no un formulario en blanco.

`capacity / multiorder`: la aprobación no toca `rider_max_active_orders()`, ni
ofertas, ni claim, ni asignación, ni ciclo de vida. Las cuatro suites
multi-pedido siguen verdes.

---

## RIDER SECURITY

Un Rider pendiente, verificado en la suite **y** contra producción real:

| Superficie | Respuesta |
|---|---|
| `get_rider_delivery_board` | 42501 / 403 |
| `get_rider_queue` | 42501 / 403 |
| `publish_rider_location_fanout` | 42501 / 403 |
| `orders` con el rol real de PostgREST | 0 filas |
| `rider_order_offers` | sin grant para `authenticated` |
| su propia solicitud | la ve |

Y **no se le pide GPS** antes de estar aprobado: la pantalla de espera no
solicita ningún permiso de ubicación.

---

## OWNER APPROVAL

| | |
|---|---|
| RPC de bandeja | `identity_list_access_requests(business, status)` → exige `identity.members.read` |
| RPC de decisión | `identity_review_access_request(request, decision, role, reason)` → exige `identity.members.write` |
| roles permitidos para decidir | **owner** y **admin** |
| roles otorgables | `staff` (owner y admin) · `admin` (sólo owner, por `identity.roles.write`) · `rider` (para solicitudes de Rider) |
| `owner` otorgable | **no**, por nadie, por esta vía |
| atomicidad | membresía + seguridad + perfil + sello, en una función y por lo tanto en una transacción |
| concurrencia | `select … for update` sobre la solicitud |

---

## FIRST OWNER

`scripts/bootstrap-first-business-owner.mjs` — **LISTO, NO EJECUTADO**.

Requiere target productivo explícito (reutiliza la guardia de destino), verifica
el comercio canónico, exige que el equipo esté vacío, es idempotente, no está
expuesta por ningún cliente, y nunca acepta una contraseña: crea la cuenta sin
contraseña y emite un enlace de recuperación.

`FIRST OWNER IDENTITY = HUMAN GATE`. Falta el correo y el nombre del dueño real.
Runbook completo en `BOOTSTRAP-FIRST-BUSINESS-OWNER.md`.

---

## RLS / BOLA

Matriz completa en `RLS-MATRIX.md`. Resumen medido contra producción:

| Eje | Antes | Después |
|---|---|---|
| tablas | 85 | 86 |
| RLS activa | 85 / 85 | **86 / 86** |
| RLS faltante | 0 | **0** |
| policies | 66 | 66 |
| grants de escritura a `anon`/`authenticated` | 0 | **0** |
| `business_access_requests`: grants para el cliente | — | **0** |

BOLA: **0 accesos cruzados** en las 16 pruebas de la matriz, entre cliente A/B,
solicitante A/B, Rider A/B y comercio 1/2.

---

## SECURITY DEFINER

| | Antes | Después |
|---|---|---|
| total | 220 | **224** |
| sin `search_path` | **0** | **0** |
| ejecutables por `anon` | **8** | **8** |
| `EXECUTE` a `PUBLIC` en las funciones nuevas | — | **0** |

Las cuatro nuevas: `search_path = pg_catalog, public, pg_temp`, sin `PUBLIC`, sin
`anon`, grant explícito sólo a `authenticated`. La quinta
(`business_access_request_retry_delay`) no la ejecuta ningún rol de cliente.

**El alta no agregó un solo definer ejecutable por `anon`.**

---

## LOCAL FROM ZERO

`supabase db reset --local` sobre un stack aislado: **0 → 107 desde cero**, cuatro
veces (una por cada migración nueva). No «103 más parches».

---

## TESTS

| Suite | Total | Resultado |
|---|---|---|
| **DB (pgTAP)** | **521** en 14 archivos | PASS |
| · de las cuales nuevas | 145 (98 alta + 47 cliente) | PASS |
| · controles negativos | 6 | los 6 hacen fallar la suite y revierten |
| **Web unit** | **1623** · 1617 pasan | 6 fallos, **todos preexistentes** |
| · de las cuales nuevas | 55 en 5 archivos + 1 en el de hidratación | PASS |
| **E2E responsive (nuevo)** | 2 specs × 3 anchos | PASS |
| **E2E completo** | **360** · 359 pasan | 1 flaky, ver abajo |
| **Rider Dart** | **632** | PASS |
| · de las cuales nuevas | 11 | PASS |
| **Rider Kotlin (staging)** | **195** (2 skipped) | PASS |
| **Rider Kotlin (production)** | **195** (2 skipped) | PASS |
| · de las cuales nuevas | 11 | PASS |
| **security / BOLA** | 16 ejes en la matriz | 0 accesos cruzados |
| **live smoke** | **37** comprobaciones | PASS |

### El E2E, medido cuatro veces

| Corrida | Árbol | Resultado | Tiempo |
|---|---|---|---|
| base | `39f13d0` | **358 / 358** | 14,8 min |
| mía, con el APK compilando en paralelo | rama | 358 pasan, 2 fallan | 21,2 min |
| mía, sola | rama | 357 pasan, 3 fallan | 17,8 min |
| mía, con el spec nuevo aliviado | rama | **359 / 360** | **14,3 min** |

La primera versión del spec nuevo abría un contexto de navegador por ancho: seis
contextos para dos pruebas. No rompió nada propio; le corrió el reloj a los
demás. Los specs que fallaban eran **distintos en cada corrida**, todos pasan en
aislamiento, y todos fallan de la misma forma: un elemento que existe en el DOM
pero todavía no está visible dentro de los 5 s del `expect`. Reescrito para
cargar una página y cambiar el viewport, la suite volvió a su tiempo de base.

Queda **1 fallo intermitente**: `cancel-confirmation.spec.mjs:51`, que pasa 6/6
con `--repeat-each=3` en aislamiento. Es una pantalla del Panel en modo demo que
esta misión no toca. Anotado como P1 de estabilidad, con su firma escrita.

Detalle y desglose en `TEST-REPORT.md`.

---

## LIVE PRODUCTION SMOKE

| | |
|---|---|
| identidades sintéticas creadas | 5 por corrida (owner, solicitante Panel, solicitante Rider, cliente A, cliente B) |
| corridas con escritura | 3 |
| comprobaciones de contrato | 32 en cada corrida, **todas OK** |
| limpieza automática final | **5 / 5** |
| identidades borradas | **todas** |

Las dos primeras corridas dejaron residuo porque encontraron sendos defectos en el
borrado. Las dos veces se limpió a mano por etiqueta y se verificó por recuento, y
los dos defectos se arreglaron con migración antes de seguir. La tercera cerró
sola.

---

## PRODUCTION DATA AFTER

| Recuento | Valor |
|---|---|
| QA users | **0** |
| QA applications | **0** |
| QA memberships | **0** |
| QA profiles (`customers`) | **0** |
| QA addresses | **0** |
| QA riders (`rider_profiles`) | **0** |
| `staff_profiles` | **0** |
| `identity_sessions` | **0** |
| `identity_user_security` | **0** |
| `auth.users` | **0** |
| `orders` / `order_items` | **0** |
| `products` / `payment_intents` | **0** |
| `businesses` | 1 (la fila canónica de `20260531030000`) |
| `identity_audit_events` | **21** — inmutables por diseño, ver abajo |

Los 21 eventos son `session_opened`, `access_requested` y
`access_request_approved` de las tres corridas del smoke.
`identity_audit_events` es append-only por trigger y **no tiene FK hacia
`auth.users`** desde la migración `20260812070000`: las dos cosas son
deliberadas, porque una auditoría que se borra con lo que audita no es una
auditoría. Su metadata guarda el **dominio** del correo, nunca el correo
completo. Explicado en `SYNTHETIC-CLEANUP.md`.

---

## CUSTOMER BUILD

Sitio estático, sin paso de bundling. `check-syntax`, `check-static-assets`,
`check-precache-graph`, `check-release-identity` y `scan-secrets`: **PASS**.
Firma: 127 archivos, digest `8b239b4b9f132192…`.
`runtime-config.js` publicado es la plantilla vacía: falla cerrado.

## BUSINESS BUILD

El mismo artefacto que Customer. Los dos módulos nuevos del Panel llegan por
import dinámico, igual que sus 34 hermanos; el aviso del verificador de precache
sigue diciendo 34, o sea que no cambiaron esa cuenta.

## RIDER BUILD

`:app:assembleStagingDebug` → **BUILD SUCCESSFUL** (16 min),
`app-staging-debug.apk` de 153,9 MB. Encadena el Kotlin nuevo, el snapshot Dart y
el empaquetado: las dos mitades del alta compilan juntas y entran en un APK.

El APK **de producción firmado** sigue detrás de su compuerta preexistente
(keystore + aprobación de piloto). Ver P1.

---

## PREVIEWS

**Ninguna desplegada**, y por seguridad, no por tiempo: hoy el único backend con
las migraciones 104-107 es producción, y publicar una preview de rama apuntada a
producción es exactamente lo que la Fase 60 prohíbe. Las dos alternativas
honestas —aplicar a staging, o exponer el shadow— tienen una decisión humana
detrás. Detalle en `PREVIEWS-AND-BUILDS.md`.

Lo que una preview mostraría ya está capturado: 21 capturas reales de Chromium en
los tres anchos.

---

## PACKAGE SCANS

| Escaneo | Resultado |
|---|---|
| `scan-secrets` (web) | PASS |
| `service_role` / clave secreta en el cliente web | **0** |
| referencia a staging en el cliente web | **0** |
| `service_role` / clave secreta en el árbol Rider | **0** (las 8 apariciones del texto son el guard que lo rechaza) |
| `NativeAuthConfig.kt` + `build.gradle.kts` | **sin un byte de cambio** |
| `tool/package_scan.dart` sobre el APK | **no corrido**: se niega a analizar un debug, y el release está detrás del keystore |

Detalle en `PACKAGE-SCANS.md`.

---

## P0

### 1. SMTP propio · el alta pública no funciona sin él

Medido, no supuesto. `GET /auth/v1/settings` de producción contesta:

```
disable_signup     : false   (el alta pública está habilitada)
mailer_autoconfirm : false   (exige confirmar el correo)
external_email     : true
external_anonymous : true    (el cliente que compra sigue funcionando)
```

Y `POST /auth/v1/signup` contesta, a la tercera cuenta:

```
429 over_email_send_rate_limit
```

O sea: con confirmación obligatoria y el emisor compartido de Supabase, **una
persona real no puede crear su cuenta hoy**. El contrato de alta está entero
detrás de esa puerta.

Tres salidas, en orden de preferencia:

1. **configurar SMTP propio** (lo correcto, y además habilita «olvidé mi
   contraseña» en operación);
2. poner `mailer_autoconfirm = true` — el alta funciona sin correo, pero se pierde
   la verificación de que el correo existe, y con eso el anti-spam más barato que
   hay;
3. dejar el alta cerrada y usar sólo invitaciones, que **sí** funcionan (el token
   se entrega por el canal que el comercio quiera).

Hasta que se resuelva, el circuito completo se puede operar por bootstrap +
invitación.

---

## P1

1. **Firmar y escanear el APK de producción del Rider.** El build compila y las
   pruebas pasan; falta `assembleProductionRelease` con keystore y aprobación de
   piloto, y después `tool/package_scan.dart`. Compuerta preexistente.
2. **Preview de rama**, con la decisión previa de contra qué backend (§PREVIEWS).
3. **`check-release-hygiene` falla por 7 hallazgos preexistentes**: rutas
   absolutas de disco local en `artifacts/production-remediation/CLEANUP-LOCAL-SHADOW.md`
   (líneas 44 y 78) y `docs/RIDER-MULTI-ORDER-HANDOFF.md` (14, 15, 17, 18, 222).
   Verificado como preexistente contra el árbol base. No se corrigieron a
   propósito: editar la evidencia de otra misión para que una compuerta pase de
   rojo a verde degrada lo único que esa compuerta protege.
4. **Cinco fallos de suite preexistentes** (catálogo, imágenes, fotos, autoridad
   comercial, smoke sin confirmación). Verificados uno por uno contra el árbol
   base. No los rompió esta misión y no se tocaron.
5. **CAPTCHA como compuerta de apertura pública.** No hay proveedor y no se
   inventó uno. El anti-spam de base ya está: una fila por persona y comercio,
   espera de 24 h tras un rechazo, y `attempt_count` visible en la bandeja.

## P2

1. **Persistir la sesión de una solicitud del Rider.** Hoy reabrir la app después
   de un force-stop muestra la espera desde el recordatorio, pero pide entrar de
   nuevo para actualizarla. Ahorrar ese login exige guardar un refresh token más
   en el almacén cifrado; es una decisión de seguridad, no de comodidad, y se
   documenta en vez de tomarla de costado.
2. **Vincular identidad anónima a correo** (Fase 9). No está soportado en la
   arquitectura actual y meterlo acá habría sido otra misión. Sin él, un cliente
   que pierde su identidad anónima pierde su memoria — y **no se finge
   recuperación**: no hay fingerprinting, ni IP, ni identificador de aparato.
3. **`showcase-map-lifecycle` E2E falla desde antes.** Verificado contra el árbol
   base.
4. **Reaplicar 104-107 a staging** para tener un entorno de previews con el
   contrato completo. Requiere levantar la regla `STAGING MUTATIONS = 0`.

---

## HUMAN GATES

Sólo lo que de verdad no puedo decidir yo:

1. **El correo y el nombre del primer dueño.** La herramienta está lista y se
   niega a correr con una persona inventada.
2. **SMTP**: qué proveedor, con qué dominio y con qué remitente.
3. **Si el alta pública se abre o no** antes de tener CAPTCHA.
4. **Keystore y aprobación de piloto** para firmar el APK de producción.
5. **Si se autoriza mutar staging** para tener un entorno de previews.

---

## SAFETY

```
STAGING MUTATIONS            = 0
HISTORICAL MIGRATIONS MODIFIED = 0
ORDERING ENABLED             = NO   (ordering_enabled=false, ordering_verified=false)
REAL ORDERS                  = 0
REAL USERS CREATED           = 0    (5 sintéticas por corrida, todas borradas)
MP PROD                      = 0
SERVICE ROLE IN CLIENT       = 0
MAIN MERGE                   = 0
PUSH TO REMOTE               = 0    (no se pidió)
```
