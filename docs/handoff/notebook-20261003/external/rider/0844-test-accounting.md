# Contabilidad de pruebas — automatizador Rider

Derivada de manifiestos JUnit XML y de salidas de runner reales, no del texto
del reporte anterior.

## Veredicto

**A. REPORTING_ARITHMETIC_ERROR**

Las cinco categorías son independientes y el total correcto es **152
descubiertos / 150 ejecutados** (2 skipped declarados por el runner JVM).

El `TOTAL=127` del reporte anterior salía de sumar cuatro de las cinco
categorías: `22 + 5 + 32 + 68 = 127`. Los **25 casos de
`Test-CleanupPathGuard` figuraban en la tabla pero quedaron fuera de la suma**.
Es un error de aritmética al redactar, no una suite faltante ni un conteo
solapado: las cinco corrieron y las cinco están completas.

No es B ni C, y eso está demostrado abajo, no afirmado.

## Por suite

### 1. `QaSmokeContractTest` — instrumentada

| | |
|---|---|
| Comando | `adb -s ZY32LHS6PS shell am instrument -w -e class com.lataba.rider.qa.QaSmokeContractTest com.lataba.rider.staging.test/androidx.test.runner.AndroidJUnitRunner` |
| Archivos | 1 (`QaSmokeContractTest.kt`) |
| Descubiertos | 22 |
| Ejecutados | 22 (22 puntos de progreso en la salida) |
| Aserciones | el runner no las informa |
| Passed / Failed / Skipped | 22 / 0 / 0 |
| Superposición | ninguna |
| Exit code | 0 (`OK (22 tests)`, 0,364 s) |
| Evidencia | `contract-test.log`, 14:00:38 |

### 2. `RiderSmokePreflightTest` — instrumentada

| | |
|---|---|
| Comando | `adb -s ZY32LHS6PS shell am instrument -w -e class com.lataba.rider.qa.RiderSmokePreflightTest com.lataba.rider.staging.test/androidx.test.runner.AndroidJUnitRunner` |
| Archivos | 1 |
| Descubiertos | 5 |
| Ejecutados | 5 |
| Aserciones | el runner no las informa |
| Passed / Failed / Skipped | 5 / 0 / 0 |
| Superposición | ninguna |
| Exit code | 0 (`OK (5 tests)`, 50,755 s) |
| Evidencia | `preflight-test.log`, 14:00:19 |

### 3. `Test-SmokeGuards.ps1` — host

| | |
|---|---|
| Comando | `& scripts\qa\tests\Test-SmokeGuards.ps1` |
| Archivos | 1 |
| Descubiertos | 32 |
| Ejecutados | 32 (32 líneas `ok`, coincide con `Resultado: 32 ok`) |
| Aserciones | 32 (una por caso) |
| Passed / Failed / Skipped | 32 / 0 / 0 |
| Superposición | ninguna |
| Exit code | 0 |
| Evidencia | `host-Test-SmokeGuards.log` |

### 4. `Test-CleanupPathGuard.ps1` — host

| | |
|---|---|
| Comando | `& scripts\qa\tests\Test-CleanupPathGuard.ps1` |
| Archivos | 1 |
| Descubiertos | 25 |
| Ejecutados | 25 (25 líneas `ok`, coincide con `Resultado: 25 ok`) |
| Aserciones | 25 |
| Passed / Failed / Skipped | 25 / 0 / 0 |
| Superposición | ninguna |
| Exit code | 0 |
| Evidencia | `host-Test-CleanupPathGuard.log` |

**Esta es la suite omitida de la suma anterior.** Es preexistente, no se agregó
en esta fase, y por eso se coló al totalizar.

### 5. JVM — `testStagingDebugUnitTest`

| | |
|---|---|
| Comando | `android\gradlew.bat -p android :app:testStagingDebugUnitTest` |
| Archivos | 14 XML en `build/app/test-results/testStagingDebugUnitTest` |
| Descubiertos | 68 |
| Ejecutados | **66** |
| Passed / Failed / Errors / Skipped | 66 / 0 / 0 / **2** |
| Superposición | ninguna |
| Exit code | 0 (`BUILD SUCCESSFUL in 1m 52s`) |

Desglose por suite:

| Suite | tests | skip |
|---|---|---|
| `SessionManagerTest` | 8 | 0 |
| `SupabaseAuthClientTest` | 3 | 0 |
| `SupabaseAuthStagingTest` | 1 | **1** |
| `TokenRefreshMutexTest` | 1 | 0 |
| `BridgeCodecTest` | 7 | 0 |
| `BackendDtosTest` | 8 | 0 |
| `RiderOrdersStagingTest` | 1 | **1** |
| `RiderRpcDataSourceTest` | 14 | 0 |
| `ActiveDeliveryPolicyTest` | 2 | 0 |
| `LocationQualityFilterTest` | 6 | 0 |
| `LocationTrackingActorTest` | 9 | 0 |
| `OfflineLocationQueueTest` | 4 | 0 |
| `QueueDrainWorkerTest` | 2 | 0 |
| `RiderOperationGateTest` | 2 | 0 |

Los 2 skipped son `SupabaseAuthStagingTest` y `RiderOrdersStagingTest`: casos
que el propio runner saltea cuando no hay credenciales de staging inyectadas.
Es el comportamiento correcto —no tocan staging— pero **descubiertos y
ejecutados no coinciden**, y el reporte anterior no hacía esa distinción.

## Prueba de independencia

No hay solapamiento, y no es una afirmación de lectura:

- **androidTest vs JVM**: viven en source sets distintos (`src/androidTest` y
  `src/test`), los ejecutan runners distintos y **comparten 0 nombres de
  clase** (verificado comparando los 8 `@RunWith` de androidTest contra los 14
  archivos de `src/test`).
- **Las dos suites host**: **0 nombres de caso compartidos**.
- **Host vs Kotlin**: runners completamente distintos, sin cruce posible.

## Totales

| | Descubiertos | Ejecutados | Passed | Failed | Skipped |
|---|---|---|---|---|---|
| Instrumentadas (2 suites) | 27 | 27 | 27 | 0 | 0 |
| Host PowerShell (2 suites) | 57 | 57 | 57 | 0 | 0 |
| JVM (14 suites) | 68 | 66 | 66 | 0 | 2 |
| **TOTAL** | **152** | **150** | **150** | **0** | **2** |

## Qué NO está contado

Para que el número signifique algo, esto queda explícitamente afuera:

- **`RiderSmokePhaseTest`** — 1 método (`runSmokePhase`), compilado e instalado
  pero **nunca ejecutado**: necesita un pedido QA sembrado. Es el driver de los
  25 pasos.
- **Instrumentadas preexistentes no corridas en esta fase**:
  `QaCredentialIsolationTest`, `QaLoginTraceTest`, `RiderQaLoginTest`,
  `EncryptedSessionStoreInstrumentedTest`, `StorageIsolationInstrumentedTest`.
  Existen y algunas se corrieron en fases anteriores, pero no entran en el
  total de esta.
- **Suites Dart** (`flutter test`) — no se ejecutaron en esta fase. Por eso
  `delivery_privacy_test.dart` se menciona como cobertura preexistente pero
  **no** se suma al total.

## Nota sobre el recuento de las instrumentadas

Se intentó reejecutar las dos suites instrumentadas para recontar en vivo. El
Moto pasó a `offline` y luego a `unauthorized` durante el intento: el transport
se reinició (`transport_id` 1 → 4 → 6 → 2) y quedó pidiendo autorización de
depuración USB en pantalla. `adb reconnect` y el reinicio del servidor no lo
recuperan; hace falta aceptar el diálogo en el teléfono.

Las cifras de las suites 1 y 2 se toman de las salidas reales de las corridas
de las 14:00 contra **el mismo APK androidTest que está instalado**
(`6c28a572eb0760a62682225695657fec9697d151de2990b392a9bb54cd5772ca`), no de
texto del reporte. Los archivos vacíos `instr-*.log` son el rastro del intento
bloqueado y se conservan como tal.
