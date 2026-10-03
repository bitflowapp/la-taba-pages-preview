# Evidencia técnica - TABA2 Rider pilot readiness

Fecha: 2026-08-02  
Worktree: `D:\1212\la-taba-rider-pilot-readiness`  
Rama: `feature/rider-pilot-readiness-ux`  
HEAD: `db645b51f89c8862da6ad29af16ec4e194c9cbc6`

## Gates ejecutados

| Gate | Resultado |
|---|---|
| `flutter analyze` | PASS, 0 issues |
| `flutter test --reporter compact` | PASS, 58 tests |
| Gradle JVM staging + production | PASS, 128 ejecuciones, 0 fallas, 0 errores, 4 opt-in omitidas |
| `assembleStagingDebugAndroidTest` | PASS |
| `assembleProductionDebugAndroidTest` | PASS |
| `connectedStagingDebugAndroidTest` | PASS, 10 tests, 0 fallas, 0 errores |
| `flutter build apk --debug --flavor staging -t lib/main_staging.dart` | PASS |
| `git diff --check` | PASS |
| Escaneo de secretos del diff | PASS por patrones; `gitleaks` no estaba instalado |

## APK

| Campo | Valor |
|---|---|
| Path | `D:\1212\la-taba-rider-pilot-readiness\build\app\outputs\flutter-apk\app-staging-debug.apk` |
| Package | `com.lataba.rider.staging` |
| Flavor | staging debug |
| Version | `1.0.0` (code `1`) |
| Tamaño | 163,387,621 bytes |
| SHA-256 | `3AF3722A8B87FE8F24763D0B701B23F1950848CF42CA0ADEF2CDA8C857C0ADB8` |

El APK se instaló mediante `adb install -r` únicamente en el Moto G15 autorizado. El smoke obtuvo lanzamiento correcto, HOME/retorno correcto, force-stop/reapertura correcta y ciclo de pantalla ejecutado. No se generó APK release: la configuración existente usaría firma debug y no se inventó una firma de release.

## Observaciones de arranque debug

Los tiempos `am start -W` fueron aproximadamente 5.727 s en arranque inicial, 0.124 s en retorno caliente y 4.349 s después de force-stop. Son observaciones de debug, no una certificación de rendimiento release ni de primera pantalla autenticada.

## Límites honestos

- Las credenciales privadas live staging no estuvieron presentes; ver `LIVE_STAGING_STATUS.md`.
- No se declaró GPS físico en movimiento: ver `MOTO_G15_PHYSICAL_VALIDATION_CHECKLIST.md`.
- El puente actual no publica RPCs para retiro, llegada, código de entrega, rate limit, cancelación ni delivered; no se fabricaron estados UI para simularlos.
