# Cierre Rider Android — 22 septiembre 2026

## Resultado

**Salida B: nueva base canónica lista para Staging.** La fuente histórica no fue
recuperada. No se presenta esta implementación como v146 ni como código extraído
de su APK. Procedencia y límites de búsqueda: `SOURCE-PROVENANCE.md`.

```text
RIDER_SOURCE_SEARCH: COMPLETED_REASONABLE_SCOPE
RIDER_SOURCE_RECOVERED: NO
SOURCE_PROVENANCE: NEW_IMPLEMENTATION_FROM_BACKEND_CONTRACTS
CANONICAL_PROJECT_PATH: apps/rider-android
PACKAGE_ID: com.lataba.rider.qa
VERSION_NAME: 0.1.0-canonical-qa
VERSION_CODE: 1

GRADLE_SYNC: PASS (CLI configuration/dependency resolution; Android Studio not opened)
DEBUG_BUILD: PASS
RELEASE_BUILD: PASS_UNSIGNED_QA
SIGNING_STATUS: DEBUG_ONLY; RELEASE_SIGNING_MISSING

BACKEND_CONTRACT: PASS_STAGING
ACTIVE_DELIVERY_POLICY: 3_CONSISTENT_SERVER_AUTHORITY
AUTH: PASS
QUEUE: PASS
ATOMIC_ACCEPT: PASS
GPS: PASS_REAL_DEVICE
DELIVERY_CODE: PASS
COMPLETION: PASS
RECONNECT: PASS

PHYSICAL_DEVICE: PASS_MOTO_G15_ZY32LHS6PS
ANDROID_E2E: PASS
CLIENT_TRACKING_E2E: PASS
PANEL_SYNC_E2E: PASS

SECURITY_RLS: PASS_TESTED_SCENARIOS
SECRET_SCAN: PASS_SOURCE_AND_BUILT_APKS
TESTS: 19_ANDROID_UNIT_PASS; 43_WEB_CONTRACT_PASS; 2_PHYSICAL_TEST_CASES_PASS

RIDER_REPLACEMENT_CREATED: YES
RIDER_REPLACEMENT_FOUNDATION: READY
BRANCH: feat/rider-android-canonical
COMMITS: 0
PUSHED: NO

READY_FOR_RIDER_STAGING: YES
READY_FOR_RIDER_PRODUCTION: NO
```

## Evidencia física y alcance E2E

Todas las pruebas fueron **automatizadas**, con Moto y backend reales. Ninguna
muestra de GPS fue simulada. No se afirma haber realizado una ruta física de
entrega: el GPS es la ubicación real del dispositivo disponible.

- Tres pedidos controlados (`LT-0021`, `LT-0022`, `LT-0027`) terminaron entregados.
  Se crearon y prepararon por RPCs normales con identidades QA, no por SQL ni por
  un checkout cliente UI. Android operó por UI Compose real.
- `LT-0022`: panel y cliente en contextos web separados, runtime Staging.
  Panel mostró Rider asignado, aceptación y «En camino». Cliente mostró
  «Tu pedido está en camino» y un marcador `.lt-rider-marker`.
- El backend devolvió GPS real capturado a las 13:03:51 y 13:05:21 UTC; el segundo
  después de restaurar la red. No se guardan aquí coordenadas del dispositivo.
- Android confirmó llegada, rechazó código incorrecto, recibió el código de cuatro
  dígitos del contrato del cliente y completó. El cliente pasó a «Pedido entregado».
  La tarjeta desapareció del panel y su contador de finalizados pasó de 0 a 1.
- Con el APK final y la corrección de scroll, `PhysicalQaTest` pasó sobre `LT-0027`
  (`OK (1 test)`, 10.049 s). A las 13:35 UTC / 10:35 Argentina, backend y tracking
  tokenizado devolvían `delivered` con el Rider esperado.
- `PhysicalResilienceTest`: `OK (1 test)`, 27.315 s. Force-stop del paquete QA,
  sesión recuperada desde Keystore, tres entregas persistentes, corte real de
  Wi-Fi/datos, recuperación, refresh Auth, background/foreground y recreación de
  Activity. Los switches de red originales (`1`, `1`) fueron restaurados.

La APK estable sigue instalada: `com.lataba.rider`, versionName `1.0.0`,
versionCode `146`, targetSdk 36. La nueva QA convive con ella y no la reemplazó.

## Capacidad y seguridad

Con cuatro pedidos auxiliares y dos Riders QA:

- Dos aceptaciones simultáneas con la misma llave: una sola operación efectiva.
- Tres aceptaciones concurrentes para dos lugares restantes: dos aceptadas y una
  `at_capacity`; tres activas, nunca cuatro.
- El board oculta ofertas al estar completo. El primer harness buscó la oferta
  en ese board y falló DESPUÉS de aprobar los asserts de duplicación/capacidad.
  Se corrigió conservando la oferta inicial; el tramo restante se reanudó sobre
  los mismos pedidos, sin inventar una nueva ejecución de aquella carrera.
- Rechazo real de la oferta restante, oferta al Rider B y aceptación por B.
- A no pudo leer el pedido de B; B no pudo leer el de A ni su GPS. La función
  interna de payload no era invocable por B. Board limitado al Rider autenticado.
- Rider no pudo modificar negocio ni precio; B no pudo tomar/finalizar el pedido
  de A. Cliente no pudo usar el board Rider. Finalización prematura rechazada.
- A tampoco pudo modificar el pedido de B mediante acceso directo a la tabla.
- Cuatro auxiliares cancelados mediante `cancel_order`, no SQL; ambos boards
  quedaron vacíos y el stock volvió al valor previo a la prueba.

Esto prueba esos escenarios de autorización; no equivale a un pentest integral.
No se desplegaron migraciones ni se cambiaron RPCs/roles de cuentas reales.

## Build y tests

- JDK 17, AGP 8.7.3, Kotlin 2.0.21, Gradle 8.11.1, SDK 35; minSdk 26.
- Wrapper con SHA-256 oficial, versiones y `app/gradle.lockfile` fijados;
  `gradle/verification-metadata.xml` activo. Dos metadatos JUnit BOM omitidos en
  la generación inicial se añadieron con SHA-256 publicado por Maven Central.
  El build habitual posterior pasó con verificación estricta, sin deshabilitarla.
- Debug, release unsigned, tests y lint: PASS. Lint: 0 errores, 11 advertencias
  de antigüedad de target/dependencias; no se silencian como certificación de release.
- 10 tests de contrato Kotlin + 9 de repositorio/estado/coroutines: PASS.
- 43 tests Node de contrato Rider, tracking, límites web y código: PASS.
  Se reparó sólo el fixture de `tests/delivery-code.test.mjs`: referenciaba un
  producto que ya no existía en el catálogo. No se modificó código web productivo.
- CI remota: NO ejecutada; no hubo push. No se certifica aquí toda la suite del repo.

Fallos encontrados y tratados: formato de etiqueta QA, mínimo de delivery,
clasificación temprana que ocultaba el pedido al panel, navegación restaurada por
ActivityScenario, recreación posterior a una maniobra externa de background, y
scroll anidado en landscape. Se conservó/reanudó el pedido cuando correspondía;
no se forzaron estados para convertir un fallo en PASS.

## Seguridad y limpieza

- APK sólo incluye clave publicable de Staging; se inspeccionaron en memoria sus
  entradas ZIP buscando la credencial privilegiada y passwords QA conocidos.
  No aparecieron. El scanner del repo también pasó.
- Tokens de sesión cifrados con Android Keystore; sin password persistida,
  sin HTTP logging y con exclusiones de backup/transferencia Android 12+.
  Referencia: https://developer.android.com/identity/data/autobackup
- Inputs privados de instrumentación eliminados al leer/finalizar. Códigos y
  tracking tokens temporales eliminados del store al sellar la corrida.
- Pedidos entregados clasificados QA y stock repuesto por movimiento normal;
  auxiliares cancelados y clasificados. Sin despachos reales.
- Navegadores temporales QA cerrados y storage de esas sesiones limpiado.
  Cuentas QA conservadas únicamente en Credential Manager para pruebas futuras.
- GPS detenido al no haber entregas; stable APK y cuentas reales intactas.

Artefactos locales sanitizados: `artifacts/rider-canonical-*.json`, captura del
paquete QA y reportes Gradle bajo `app/build/reports/`. No publicar capturas que
contengan localización sin revisión, ni subir APKs a Git.

## Bloqueos de producción

1. Sin fuente/certificación histórica ni firma release vinculada a v146.
   No se inventó keystore. La release generada es **QA unsigned**, no productiva.
2. El proyecto falla cerrado hacia Staging y usa `.qa`. Una promoción requiere
   configuración, identidad de paquete, firma y autorización de release explícitas.
3. Disponibilidad es local y está rotulada así: no existe RPC de presencia en el
   contrato auditado. No se vende como disponibilidad compartida con el panel.
4. Falta certificación de ruta prolongada, batería/Doze, dispositivos/API adicionales
   y revisión de SDK/dependencias para distribución. No se confunde una prueba
   física corta con esa certificación.

Mercado Pago: **sin trabajo ni cambios en esta misión**. WCS-51579 permanece
WAITING_SUPPORT. No hubo deploy de Producción, merge, commit ni push.
