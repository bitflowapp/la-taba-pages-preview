# QA reproducible — sólo Staging

## Build

Desde la raíz web, JDK 17 + SDK 35:

```powershell
node scripts/e2e-staging/build-rider-android.mjs
node scripts/e2e-staging/create-rider-pilot-signing-key.mjs
node scripts/e2e-staging/build-rider-pilot.mjs --version-code 3 --version-name 0.1.2-canonical
node scripts/e2e-staging/build-rider-android.mjs lintDebug
node scripts/e2e-staging/scan-rider-apk.mjs
node scripts/scan-secrets.mjs
```

La primera resolución necesita Internet. `--offline` no es un gate garantizado en
un caché incompleto. No desactivar verificación de dependencias para resolver errores.
La generación de checksums es mantenimiento explícito, no un paso del build habitual.

## Instalar sin reemplazar v146

```powershell
adb -s ZY32LHS6PS install -r apps/rider-android/app/build/outputs/apk/debug/app-debug.apk
adb -s ZY32LHS6PS install -r apps/rider-android/app/build/outputs/apk/androidTest/debug/app-debug-androidTest.apk
```

Los paquetes son `com.lataba.rider.qa`, `com.lataba.rider.qa.test` y
`com.lataba.rider.pilot`. La release firmada queda en
`apps/rider-android/app/build/outputs/apk/release/app-release.apk`. El build
debe declarar explícitamente el código y nombre de la versión piloto; omitir
ambos reproduce la vCode 1 histórica del propio piloto, no la v146 original.
Conservar los APK vCode 1 y 2 firmados antes de generar una nueva versión.

Para instrumentar el **APK firmado exacto** sin hacerlo depurable, generar
aparte el test APK release con `--android-test` y verificar que
`com.lataba.rider.pilot` siga `debuggable=false`:

```powershell
node scripts/e2e-staging/build-rider-pilot.mjs --version-code 3 --version-name 0.1.2-canonical --android-test
adb -s ZY32LHS6PS install -r apps/rider-android/app/build/outputs/apk/androidTest/release/app-release-androidTest.apk
```

`pilot-release-auth-bridge.mjs` lee la cuenta Rider QA desde Credential
Manager, abre una sola conexión ADB reverse en `127.0.0.1` por 120 segundos y
publica únicamente el número de puerto. Pasar ese puerto como `qaPort` al
`PilotReleaseAuthSmokeTest` o `PilotReleasePhysicalTest` con `qaStaging=true`.
El password/código se entregan sólo en memoria, nunca como argumentos de
instrumentación, archivo del APK ni log. El bridge se retira al primer uso; al
terminar, desinstalar **sólo** `com.lataba.rider.pilot.test`. Los ensayos del
23/09/2026 verificaron login, capacidad 3, aceptación, GPS real, código
incorrecto rechazado y entrega final sobre la variante firmada.
No instalar una release unsigned ni desinstalar `com.lataba.rider`.

## Pedido / Android físico

Credenciales exclusivamente en Windows Credential Manager. El runner obtiene
sesiones Auth reales de cliente, negocio y Rider QA. `prepare` crea un pedido por
`create_order_with_items`, avanza por `transition_order` y ofrece por
`offer_order_to_rider`. No es una prueba del checkout cliente por UI y no usa SQL
para estados. Pago `coordinate`: Mercado Pago queda fuera.

```powershell
node scripts/e2e-staging/rider-canonical-qa.mjs inspect
node scripts/e2e-staging/rider-canonical-qa.mjs prepare
node scripts/e2e-staging/rider-canonical-qa.mjs input
node scripts/e2e-staging/run-rider-physical.mjs flow
node scripts/e2e-staging/rider-canonical-qa.mjs observe
node scripts/e2e-staging/rider-canonical-qa.mjs security
node scripts/e2e-staging/rider-canonical-qa.mjs cleanup
```

El guard impide duplicar un pedido existente. `resume` reanuda preparación;
`prepare-next` admite un pedido previo entregado o el pedido del soak fallido
que esté cancelado, clasificado QA y con el stock exactamente reconciliado.
Ejecutar `cleanup` para un entregado antes de comenzar otro. Los runners que modifican el registro QA se ejecutan
**secuencialmente**, nunca en paralelo.

El código de entrega llega por el contrato del cliente al input privado del test;
el test lo escribe en la UI Android, prueba primero un código erróneo y luego el
correcto. El input se borra inmediatamente al leerlo. Nunca viaja como argumento,
password de Gradle o archivo del repositorio.

## Recuperación de GPS con pantalla apagada

La prueba física de 60 minutos reveló una pausa de red/GPS con pantalla apagada
en el Moto G15. La vCode 3 agrega un wake lock parcial acotado a entregas
activas, con notificación foreground y liberación al detener el servicio.
No darlo por resuelto sólo por compilar: ejecutar un pedido QA nuevo, instalar
la app QA nueva **después** de cerrar cualquier test en curso y pasar
`qaMinutes=25` al `PhysicalSoakTest`. El monitor de host se inicia con
`--target-minutes 25 --network-cut-at-minutes 0 --screen-off-at-minutes 1
--screen-off-duration-minutes 20`. Exige recibos GPS reales, máximo 180 s sin
recibo, a lo sumo un minuto offline y entrega completada por código. El
resultado se suma a los tramos físicos anteriores sólo si sus tiempos y
recibos están documentados por separado; no se convierte un fallo previo en
PASS por cambiarle la etiqueta.

## Observar panel y cliente reales

```powershell
node scripts/e2e-staging/serve-rider-qa.mjs
```

Servidor sólo en `127.0.0.1:39092`, runtime público dirigido a Staging y negocio QA.
Antes de cualquier prueba visual, comprobar que `http://127.0.0.1:39092/styles/tracking.css?v=60`
responda 200 y que `[data-map-canvas]` mida más de 0 px. El 23/09 se
detectó que el servidor QA bloqueaba `/styles/`: el marcador GPS existía en el
DOM pero el mapa medía 0 px. Se corrigió la whitelist; esas observaciones
anteriores no certifican visibilidad real del mapa.

`run-pilot-full-ui-signed.mjs` deja el pedido creado por la UI cliente y
preparado desde el panel; al imprimir `PILOT_FULL_UI_ORDER_READY_FOR_SIGNED_RIDER`,
iniciar `pilot-release-auth-bridge.mjs --full-ui` y pasar el puerto de un solo
uso a `PilotReleasePhysicalTest`. Ejecutar los dos procesos en paralelo. El
runner cancela/clasifica sólo pedidos QA no entregados y restaura inventario
mediante RPC; borra el código y token temporales del Credential Manager al
cerrar. No aceptar como PASS un marcador que sólo existe en DOM pero no es
visible, ni un pedido cuyo observador se cerró antes de la respuesta Android.
Abrir dos contextos limpios agent-browser, sesiones `rider-panel` y `rider-customer`,
en esa URL. `browser-input` inyecta por stdin las sesiones QA recién autenticadas,
sin logs ni exportar storageState. Abrir `/#business` y `/#tracking` tras recargar.
Al repetir, vaciar el acceso anterior de **sessionStorage**: la app lo prefiere
sobre el puente localStorage. Un contexto nuevo evita esa ambigüedad.

Con `input --observers`, Android espera hasta cinco minutos tras recibir GPS real.
Después de observar asignación, marcador y estado en ambas webs, continuar con:

```powershell
adb -s ZY32LHS6PS shell run-as com.lataba.rider.qa touch files/qa-observer-continue
```

No sacar la Activity de la prueba con otro `am start` durante esta espera: usar
el test específico de resiliencia para background/foreground. Al cerrar, borrar
storage de esos contextos QA y cerrar sólo esas sesiones de navegador.

## Capacidad, aislamiento y resiliencia

Después de limpiar el pedido físico, con Rider A sin entregas:

```powershell
node scripts/e2e-staging/rider-canonical-qa.mjs security
node scripts/e2e-staging/rider-canonical-qa.mjs capacity
node scripts/e2e-staging/run-rider-physical.mjs resilience
node scripts/e2e-staging/rider-canonical-qa.mjs cleanup-aux
node scripts/e2e-staging/rider-canonical-qa.mjs seal
```

`capacity` crea cuatro pedidos QA, comprueba duplicación/concurrencia con máximo 3,
rechazo y asignación al Rider B. Conserva un ledger seguro para no duplicarlos.
`capacity-resume` continúa el tramo de rechazo/aislamiento si falló ese tramo;
no simula haber repetido la carrera. `cleanup-aux` cancela con RPC, clasifica QA y
verifica stock repuesto. La prueba de resiliencia requiere las tres entregas de A;
hace force-stop **sólo de la app QA**, corta temporalmente Wi-Fi/datos y restaura
los valores originales en `finally`. No correrla en una sesión personal crítica.

`seal` elimina códigos y tokens de tracking temporales de los registros de esta
prueba, preservando IDs de auditoría. Las cuentas QA permanecen en Credential
Manager para reuso autorizado. Un ledger ya completado no se resetea silenciosamente.

## Límites

Pruebas automatizadas sobre backend y Moto reales, no un desplazamiento físico de
reparto ni una certificación de autonomía de batería/Doze de varias horas. No se
certifican producción, firma histórica, Play Store ni recuperación de fuente v146.
