# Task 03 - Resultados de pruebas y evidencia

Fecha: 2026-08-01. Proyecto: `C:\1212\la-taba-rider-android`. Rama:
`develop`. HEAD de entrada: `b64616f8901ca1d7615f9fbc30917d4cb0daee55`.

## Gates locales

| Gate | Resultado | Detalle |
|---|---|---|
| `flutter pub get` | PASS | Dependencias resueltas |
| `dart format lib test` | PASS | Sin cambios pendientes de formato |
| `flutter analyze` | PASS | `No issues found!` |
| `flutter test` | PASS | 13 tests |
| `:app:testStagingDebugUnitTest` | PASS | 26 tests, 26 ejecutados, smoke real habilitado |
| `:app:testProductionDebugUnitTest` | PASS | 26 tests, 24 ejecutados, 2 smoke opt-in skipped |
| `flutter build apk --debug --flavor staging` | PASS | APK staging final generado |
| `flutter build apk --debug --flavor production` | PASS | APK production final generado fail-closed |
| install/launch fisico | PASS | `com.lataba.rider.staging` abre en dispositivo ADB |

APK staging final:
`build/app/outputs/flutter-apk/app-staging-debug.apk`

SHA-256 staging: `E7277D158FBB7A1DA81A6F78799427787804F5E5CCB847922399A4DFBB47CF7E`.

APK production final:
`build/app/outputs/flutter-apk/app-production-debug.apk`

SHA-256 production: `81C88647A6E3D1CCA46971BC53980047815A3BA37EAFB2B46C544F060E754B5E`.

El `BuildConfig` production contiene URL, publishable key, business ID y
project ref vacios. El manifest declara solamente `INTERNET`.

## Tests relevantes

Los tests Dart cubren revision numerica/string, money decimal, estados
asignados, ARS, duplicados, respuestas invalidas, descarte de refresh viejo,
desmontaje del shell autenticado, error parcial de recovery y UI read-only sin
UUID/GPS.

Los tests Kotlin cubren el endpoint y body exactos del RPC, filtros RLS del
GET asignado, ausencia de `rider_locations`, envelope versionado, snapshot
Auth convertido a mapa `StandardMessageCodec`, 401/rotacion/retry unico,
errores sanitizados y numeros JSON integrales para columnas Postgres `numeric`.

La primera ejecucion del smoke Gradle detecto que `quantity` llega como
`1.0`/`2.0`; el parser fue endurecido para aceptar solamente valores
decimales positivos con valor entero exacto. La regresion quedo cubierta por
test y el smoke final paso.

## Correccion QA de staging

La auditoria del proyecto Supabase enlazado `ukxqbgswjlibmnjemrzd` encontro
siete ordenes del comercio staging, todas con productos de origen
`demo_fixture`, cero ordenes o items no-QA y ninguna orden comercial. Se
ejecuto una unica transaccion de mantenimiento backend sobre staging, sin
`service_role`, sin crear RPC y sin usar el cliente Android para escribir:

- negocio staging: `USD` -> `ARS`;
- siete ordenes QA: `USD` -> `ARS`;
- subtotal, delivery fee y total preservados;
- revision incrementada una vez por orden por el trigger existente;
- no se cambio status, rider asignado, item, importe ni tipo/secuencia de
  evento;
- no se contacto produccion.

Los agregados posteriores son subtotal `221726.00`, delivery fee `1050.00` y
total `222776.00`; las siete ordenes quedan en ARS.

## Smoke real staging read-only

Con el archivo de credenciales del rider, usado solamente en memoria:

| Operacion | Resultado |
|---|---|
| Auth password | HTTP 200 |
| pedidos disponibles | HTTP 200, 1 fila |
| pedido asignado | HTTP 200, 1 fila, ARS, revision positiva |
| detalle/reapertura | HTTP 200 |
| refresh manual | HTTP 200 |
| token invalido | HTTP 401 |
| refresh de sesion | HTTP 200 |
| lectura posterior al refresh | HTTP 200 |
| campos PII prohibidos en la proyeccion | 0 |

No se ejecutaron claim, start, cambio de estado, GPS, insert, update o delete
desde Android. La prueba de token invalido fue deliberadamente local al
request y no modifico pedidos.

## Evidencia visual y dispositivo

- [login-device-final.png](C:/1212/artifacts/la-taba-rider-android-task03/captures/login-device-final.png)

La captura conservada es la pantalla de login vacia. Las capturas
intermedias con credenciales o datos de pedidos fueron eliminadas. El APK
staging se instalo y abrio en `ZY32LHS6PS`; el login credentialed por
coordenadas ADB no se cuenta como PASS porque el teclado del dispositivo
terminaba la actividad al usar Back. El smoke credentialed real queda
respaldado por REST y por `RiderOrdersStagingTest`.

## No ejecutado por alcance

No se ejecutaron claim/start, publicacion GPS, cola offline, mapa,
foreground service, deploy ni push.
