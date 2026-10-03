# FINAL CERTIFICATION - La Taba Rider Android Task 03

Fecha: 2026-08-01  
Veredicto: `LA_TABA_RIDER_ANDROID_TASK03_ORDERS_CERTIFIED_AND_COMMITTED`

## Identidad y alcance

- Proyecto Android: `C:\1212\la-taba-rider-android`
- Rama final: `develop`
- HEAD de entrada: `b64616f8901ca1d7615f9fbc30917d4cb0daee55`
- Commit final: `31003891de66c6a3d3fd78b3a4fbab0ac746ac4a`
- Mensaje: `feat(orders): add secure rider order consultation`
- Backend de referencia: `C:\1212\la-taba-real-orders-staging`
- Backend branch/HEAD de referencia: `staging/real-orders-walter` / `c6270589756214eac617515248e93a8e8819190b`
- Supabase usado: proyecto staging `ukxqbgswjlibmnjemrzd`

Task 03 queda limitada a autenticacion, consulta de pedidos disponibles y
recuperacion read-only del pedido asignado. No incluye claim, cambio de
estado, inicio de entrega, GPS, mapa, ForegroundService, cola offline ni
publicacion.

## Commit, tree y backup

El stage fue explicito y contiene solamente los 35 paths de Task 03. No se
incluyeron credenciales, `.temp` de Supabase CLI, archivos generados,
artefactos, ni cambios del backend.

Verificaciones post-commit:

- `git status --short`: limpio.
- rama: `develop`.
- commit y mensaje coinciden con los valores anteriores.
- `git diff --check`: limpio.
- no se hizo push, merge, rebase, deploy, reset, restore, stash ni clean.

Bundle Git verificado:

- Ruta: `C:\1212\backups\la-taba-rider-task03-3100389.bundle`
- Tamano: `100091` bytes
- `git bundle verify`: PASS; history completa y ref `HEAD` presente.
- SHA-256: `EFD93471E17174C20B326762AE48F0733CCED7741880A46864457B41AAF5C163`

El worktree del backend conserva sus cambios previos del usuario; no se
commiteo ni se limpio.

## Correccion de datos QA en staging

La auditoria previa a la escritura encontro siete ordenes del comercio
staging. Las siete tenian productos con `catalog_origin=demo_fixture`; hubo
cero ordenes o items no-QA y cero ordenes comerciales en el alcance del
comercio.

Se ejecuto una unica transaccion de mantenimiento backend sobre el proyecto
Supabase staging enlazado. La operacion fue autorizada para este cierre, uso
el canal CLI enlazado de mantenimiento (`postgres`) y no uso `service_role`,
la anon key ni una RPC inventada. La app Android nunca escribio datos.

La transaccion:

- cambio el `business.currency_code` de `USD` a `ARS`;
- cambio el `orders.currency_code` de `USD` a `ARS` solamente para las siete
  ordenes QA protegidas por la guarda de origen;
- preservo subtotal, delivery fee, total, items, rider asignado y status;
- no inserto ni edito `order_events`;
- dejo que el trigger existente incremente `revision` exactamente una vez por
  orden actualizada.

Resultado posterior:

- negocio: `ARS`;
- ordenes: 7 totales, 7 ARS, 0 no-ARS;
- ordenes activas asignadas al rider auditado: 3;
- agregados: subtotal `221726.00`, delivery fee `1050.00`, total `222776.00`;
- todas las revisiones quedaron en `revision_anterior + 1`;
- no se contactaron endpoints ni datos de produccion.

Los tipos y secuencias de eventos se reconsultaron despues de la operacion y
no hubo una escritura de eventos en la transaccion de reparacion. El aumento
de revision es intencional y corresponde exclusivamente a la correccion de
metadata de moneda en staging.

## Contrato y seguridad de la app

- RPC exacta para disponibles: `list_available_rider_orders(p_business_id)`.
- Recuperacion asignada: GET PostgREST bajo RLS, filtrado por business,
  `assigned_rider_user_id`, estados canonicos y `limit=1`.
- Estados aceptados: `assigned`, `picked_up`, `on_the_way`, `arrived`.
- `delivery_mode` requerido: `delivery`.
- Solo se acepta `currency_code=ARS`.
- Revisiones positivas y respuestas duplicadas se validan estrictamente.
- UUID interno se valida en Kotlin pero no cruza hacia Flutter.
- No se exponen email, nombre, telefono, UUID, GPS, `rider_locations` ni
  historial de ubicaciones.
- En el pedido asignado solo cruzan los campos aprobados: direccion,
  instrucciones, items, importes ARS, metodo de pago, status y revision.
- No existen llamadas Android a claim, start, cambio de estado, GPS, insert,
  update, delete o publicacion.
- El manifest declara solamente `android.permission.INTERNET`.
- No hay `ACCESS_FINE_LOCATION`, `ACCESS_COARSE_LOCATION`,
  `POST_NOTIFICATIONS` ni permiso de ForegroundService.
- Los errores bridge no incluyen cuerpos HTTP, tokens ni credenciales.
- Tokens de sesion se almacenan cifrados; refresh se serializa y solo hay un
  retry tras 401. Logout cancela requests activos.
- La publishable key de staging se uso solo en memoria durante pruebas y no
  fue escrita en archivos, logs, commit o bundle.

Production permanece fail-closed: el `BuildConfig` de production verifico
URL, publishable key, project ref y business ID vacios.

## Gates ejecutados

| Gate | Resultado |
|---|---|
| `flutter pub get` | PASS |
| `dart format lib test` | PASS, 68 archivos, 0 cambios |
| `flutter analyze` | PASS, sin issues |
| `flutter test` | PASS, 13 tests |
| `:app:testStagingDebugUnitTest` | PASS, 26 tests, 0 fallos, smoke real habilitado |
| `:app:testProductionDebugUnitTest` | PASS, 26 tests, 0 fallos, 2 smoke opt-in skipped |
| `:app:connectedStagingDebugAndroidTest` | PASS, 2 tests en moto g15 / Android 15 |
| build staging debug | PASS |
| build production debug | PASS |
| install/launch staging | PASS |

APK final staging:

- Ruta: `C:\1212\la-taba-rider-android\build\app\outputs\flutter-apk\app-staging-debug.apk`
- Bytes: `161178384`
- SHA-256: `E7277D158FBB7A1DA81A6F78799427787804F5E5CCB847922399A4DFBB47CF7E`

APK final production:

- Ruta: `C:\1212\la-taba-rider-android\build\app\outputs\flutter-apk\app-production-debug.apk`
- Bytes: `161178517`
- SHA-256: `81C88647A6E3D1CCA46971BC53980047815A3BA37EAFB2B46C544F060E754B5E`

## Smoke real read-only post-commit

El smoke se repitio con las credenciales del rider leidas desde el archivo
local autorizado, siempre en memoria y sin imprimir valores sensibles.

| Operacion | Resultado |
|---|---|
| Auth password | HTTP 200 |
| pedidos disponibles | HTTP 200, 1 fila |
| pedido asignado | HTTP 200, 1 fila, ARS, revision positiva |
| detalle/reapertura | HTTP 200 |
| refresh manual | HTTP 200 |
| request con token invalido | HTTP 401 |
| refresh de sesion | HTTP 200 |
| lectura posterior al refresh | HTTP 200 |
| campos PII prohibidos en la proyeccion | 0 |

El endpoint de disponibles y el GET asignado no produjeron mutaciones. El
estado del backend fue reconsultado despues: las siete ordenes siguen ARS,
los tres activos del rider siguen asignados y no se agregaron cambios de
estado por el smoke.

En el dispositivo `ZY32LHS6PS`, el APK staging final se instalo y la actividad
`com.lataba.rider.staging/com.lataba.rider.MainActivity` quedo arriba. La
captura limpia conservada es:

[login-device-final.png](C:/1212/artifacts/la-taba-rider-android-task03/captures/login-device-final.png)

Las capturas temporales con credenciales o pedidos fueron eliminadas. El
login credentialed por coordenadas ADB no se cuenta como PASS porque el
teclado del dispositivo terminaba la actividad al usar Back; la validacion
credentialed real queda cubierta por REST y `RiderOrdersStagingTest`.

## Riesgos, incognitas y aprobaciones humanas

1. El staging tiene tres ordenes activas asignadas al mismo rider, mientras
   el contrato de recovery de Task 03 selecciona una fila (`limit=1`). No se
   cambio ningun estado para normalizarlo; el comportamiento debe ser aprobado
   antes de claim/start.
2. La reparacion de moneda es metadata QA y aumenta revision sin crear un
   evento operativo. Si el backend exige un evento para toda revision futura,
   el equipo backend debe definirlo antes de reutilizar este mecanismo.
3. Production no tiene backend configurado por decision de seguridad. Una
   persona responsable debe aprobar URL, key, business y politica de release
   antes de habilitarlo.
4. Claim, start, GPS persistente, cola offline, mapa, notificaciones y
   ForegroundService siguen fuera de alcance y requieren sus propias gates.
5. El login visual en dispositivo requiere una prueba manual o un harness de
   input que no use Back; no se debe tratar la automatizacion ADB actual como
   evidencia de UI autenticada.

No se realizaron push ni deploy.

`LA_TABA_RIDER_ANDROID_TASK03_ORDERS_CERTIFIED_AND_COMMITTED`
