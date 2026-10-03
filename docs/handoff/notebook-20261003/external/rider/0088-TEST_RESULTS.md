# Task 04 — resultados de pruebas y gates

Fecha de ejecución: 2026-08-01. Rama Android: `develop`. No se creó commit.

## Gates locales

| Comando | Resultado |
|---|---|
| `flutter pub get` | PASS; dependencias resueltas |
| `dart format lib test` | PASS |
| `flutter analyze` | PASS; 0 issues |
| `flutter test` | PASS; 23 pruebas |
| `android/gradlew.bat testStagingDebugUnitTest --no-daemon` | PASS; 34 tests, 0 fallos, 2 skipped reservados |
| `android/gradlew.bat testProductionDebugUnitTest --no-daemon` | PASS; 34 tests, 0 fallos, 2 skipped reservados |
| `flutter build apk --debug --flavor staging -t lib/main_staging.dart` | PASS |
| `flutter build apk --debug --flavor production -t lib/main_production.dart` | PASS |
| `adb install -r app-staging-debug.apk` | PASS en Moto G15 conectado |
| `android/gradlew.bat connectedStagingDebugAndroidTest --no-daemon` | PASS; 2 tests en Moto G15 / Android 15 |
| Consulta rider staging autenticada de disponibles | PASS; 0 elegibles, sólo lectura |
| Consulta business staging autenticada de órdenes | PASS; 7 visibles, 0 `ready` sin asignar |

## Cobertura agregada

- firma RPC, body y `null` de `p_expected_rider_user_id`;
- parser JSONB objeto con `idempotent_no_op` true/false;
- ocultamiento de UUIDs/PII y rechazo de marcador inválido;
- clasificación separada de carrera perdida y revisión vieja;
- actor no autorizado `42501` y desconexión de transporte;
- refresh de sesión una sola vez tras 401;
- MethodChannel con sólo código público y revisión;
- no mutación optimista, respuesta idempotente, doble toque, revisión vieja,
  no elegible, pérdida de carrera, excepción inesperada y UI sanitizada.

## Advertencias no bloqueantes

Gradle reporta advertencias existentes sobre la versión del plugin Kotlin y
opciones Android DSL deprecadas. No introdujeron fallos en los gates.

## Pendiente de QA remoto

`CONCURRENCY_TEST.md` registra por qué la carrera real con dos riders no se
marcó como PASS. La build y los tests locales no sustituyen esa prueba de
autorización/concurrencia sobre dos sesiones Auth reales.
