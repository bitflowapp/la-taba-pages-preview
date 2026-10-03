# Resultados de pruebas

Fecha: 2026-08-02

## Secuencia final obligatoria

Todos los comandos se ejecutaron secuencialmente, sin continuar en paralelo:

| Paso | Comando | Resultado |
|---:|---|---|
| 1 | `flutter pub get` | PASS; dependencias resueltas |
| 2 | `flutter analyze` | PASS; 0 issues, 22.3 s de análisis |
| 3 | `flutter test` | PASS; 42 tests, 145.7 s |
| 4 | `gradlew.bat test --no-daemon --console=plain --stacktrace` | PASS; exit 0, 90.2 s |
| 5 | `flutter build apk --debug` | PASS; 171.1 s |
| 6 | `git diff --check` | PASS; sin salida, exit 0 |

Para Gradle/build se forzó `java.io.tmpdir=E:\DevCache\Temp`. `TEMP`, `TMP`, `GRADLE_USER_HOME` y `PUB_CACHE` quedaron en `E:\DevCache`.

## Flutter

- Total: 42.
- Fallas: 0.
- Cobertura funcional reforzada: 50 taps claim/start, start supersedido por stop, segundo pedido bloqueado, respuesta/evento viejo descartado, recreación de controlador, logout/stop, estado contractual `noSignal`, alias `no_signal` y estados futuros rechazados, envelopes incompletos rechazados, campos futuros compatibles y textos operativos accionables renderizados literalmente.

## Kotlin/JVM

Agregado desde XML bajo `build/app/test-results`:

- suites XML: 28;
- ejecuciones: 128 (variantes productionDebug y stagingDebug);
- fallas: 0;
- errores: 0;
- omitidas: 4.

Las cuatro omisiones corresponden a dos tests live que se repiten por variante y requieren configuración segura de staging:

- login/membresía real contra staging;
- lectura real de superficies available/assigned contra staging.

Cobertura destacada: refresh con 50 callers, gate con 50 callers, claim exclusivo, publicación no paralela, callback/ACK tardío descartado, terminal/acceso purga y detiene, ubicación apagada con `noSignal` accionable y recuperación `fresh`, red caída con muestra retenida y error sanitizado, bridge versionado y errores HTTP sanitizados/clasificados (401/403/409/429/5xx).

## Tests instrumentados

`gradlew.bat :app:assembleStagingDebugAndroidTest --no-daemon --console=plain --stacktrace`:

- PASS;
- 369.3 s en la compilación final contra el código de cierre.

Esto certifica compilación de los tests instrumentados de bridge, notificación, service/restart recovery, ubicación, store cifrado y sesión. No equivale a ejecución conectada.

## Dispositivo

El `adb devices -l` de cierre detectó un Moto G15 físico. No se ejecutaron comandos de instalación ni tests conectados; se requiere autorización/ventana de prueba para alterar el equipo y utilizar datos controlados de staging.
