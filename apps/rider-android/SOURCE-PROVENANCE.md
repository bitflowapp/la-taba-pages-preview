# Procedencia — 22 septiembre 2026

## Fuente histórica NO recuperada

- Moto G15, serial ZY32LHS6PS, `com.lataba.rider`, versionName `1.0.0`,
  versionCode `146`, minSdk 24, targetSdk 36. Instalación inicial 17 agosto,
  última actualización 22 agosto 2026. Sólo lectura de `dumpsys package`.
- Las notas `docs/RIDER-MULTI-ORDER-HANDOFF.md` ubican el repositorio histórico en
  una unidad no montada, sin remoto, con worktree `taba2-rider-multi-order`,
  base `894267a`. Esa ubicación no existe en esta computadora. Las notas
  describen un híbrido Dart/Kotlin, no esta app.
- Único disco físico montado accesible: el del sistema. Se revisaron Desktop, Documents,
  Downloads, OneDrive, .claude, .gemini/scratch, carpetas de trabajo de Codex,
  directorios de desarrollo, otros perfiles accesibles y temporales. Búsqueda de Gradle,
  Kotlin, manifiestos, package ID y ActiveDeliveryPolicy no encontró proyecto Rider.
- Se inspeccionaron listados internos de 18 ZIP de las carpetas de usuario/trabajo,
  incluido `la-taba-main.zip`: ningún proyecto Android Rider. Sin extracción ni
  destrucción de archivos. No se afirma recuperar archivos borrados o discos ausentes.
- Git local web y una copia adicional del repositorio:
  refs/historial/stashes revisados, sin rutas Kotlin/Gradle/pubspec de Rider.
  Fetch de origin sólo actualizó referencias locales. Reflogs y objetos inalcanzables
  fueron inspeccionados como evidencia; no prueban existencia de fuente Android.
- GitHub autenticado `bitflowapp`: inventario 26 repos; búsqueda de código
  `com.lataba.rider` sin resultados. `rider-hub` tiene sólo rama main y archivos
  HTML/JS/PWA; se excluyó expresamente como fuente nativa. No se afirma cobertura
  de cuentas GitHub ajenas o repos no accesibles.
- No se encontró registro recentProjects de Android Studio en rutas estándar
  disponibles. Gradle caches contienen herramientas, no se usaron como fuente.
- Hay APKs y evidencia previa en Temp/lataba-rider-audit-20260920. No se leyó ni
  reutilizó código descompilado de esas carpetas.

## Fuente de la implementación nueva

Migraciones SQL y tests del repo web, definición de RPCs leída en Supabase Staging,
documentación oficial Android/Supabase. Se preservaron los contratos y el backend.
`rider_max_active_orders()` desplegada devuelve 3; board, ofertas, GPS fanout y
confirmación de código están presentes. No se modificó Mercado Pago.

Gradle wrapper estándar reutilizado del proyecto local Estela (herramienta de
build, no lógica de aplicación); versiones y URL pública están fijadas.

Rama de trabajo: `feat/rider-android-canonical`. Se conservaron todos los cambios
previos sin commit del repo web. No merge, push ni deploy productivo.
