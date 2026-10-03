# Reporte de build Android

Fecha: 2026-08-02

## Entorno

- Flutter: 3.44.6.
- Dart: 3.12.2.
- Android SDK: API 36 detectada.
- Java: JDK 17.
- Repositorio lógico: `C:\1212\la-taba-rider-android`.
- Repositorio físico: `D:\1212\la-taba-rider-android` (junction confirmada).
- TEMP/TMP: `E:\DevCache\Temp`.
- Gradle cache: `E:\DevCache\Gradle`.
- Pub cache: `E:\DevCache\Pub`.

El SDK Android preexistente permanece en `C:\Users\marco\AppData\Local\Android\Sdk` por `android/local.properties`; no fue copiado ni modificado. Los outputs pesados del repositorio residen físicamente en `D:` y los temporales/caches de esta validación en `E:`.

Espacio libre al cierre:

- C: 3.06 GiB;
- D: 59.97 GiB;
- E: 16.00 GiB.

## APK

- Tipo: debug estándar (`flutter build apk --debug`).
- Ruta lógica: `C:\1212\la-taba-rider-android\build\app\outputs\flutter-apk\app-debug.apk`.
- Ruta física: `D:\1212\la-taba-rider-android\build\app\outputs\flutter-apk\app-debug.apk`.
- Tamaño: 161,917,743 bytes (154.42 MiB).
- Modificado: 2026-08-02 15:36:18 -03:00.
- SHA-256: `0B94C7D205C1F3B10A9FDC51B2840E97EBE0D8B917A6F3581EDF1023F14CC64E`.

## Certificación

- `flutter analyze`: PASS.
- Flutter tests: 42/42 PASS.
- Gradle unit tests: 128 ejecuciones, 0 fallas, 0 errores, 4 live staging omitidas.
- AndroidTest staging APK: compilado correctamente.
- APK debug: construido correctamente.
- `git diff --check`: limpio.

## Git y alcance

- Rama: `develop`.
- HEAD: `31003891de66c6a3d3fd78b3a4fbab0ac746ac4a`.
- Cambios preexistentes Tasks 04–06 preservados junto al hardening.
- Sin commit, push, merge, reset, restore, stash ni clean.
- Sin modificación de backend, Supabase, producción, firma release ni contratos Gate 1/2.

## Riesgos/pasos pendientes

- Ejecutar matriz física descrita en `LIFECYCLE_REVIEW.md` con ventana controlada de staging.
- Ejecutar la suite conectada sólo con autorización para instalar APKs de test en el Moto G15.
- Verificar en hardware comportamiento OEM/batería, GPS real, red intermitente, bloqueo, swipe y process death.
- No asumir ni prometer supervivencia ante **Forzar detención**.

Veredicto:

`LA_TABA_RIDER_ANDROID_RUNTIME_HARDENED_READY_FOR_PHYSICAL_TEST`
