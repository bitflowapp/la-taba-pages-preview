# Inventario preflight de archivos no rastreados

Fecha de inspección: 2026-07-25
Repositorio: `<REPO_ROOT>`
Rama: `feat/taba-production-beverages`
HEAD: `333b5a2c5016afb0383ce409c2c381e54d93fcf9`
Fuente del inventario: `git -c core.quotepath=false ls-files --others --exclude-standard`

## Resumen

Se identificaron exactamente **199 archivos no rastreados** antes de iniciar cambios de producción.

| Clasificación | Archivos | Tamaño |
|---|---:|---:|
| Backend | 4 | 39.878 bytes |
| Capturas, videos y evidencia | 150 | 94.298.432 bytes |
| Configuración local generada | 3 | 92.549 bytes |
| Logs de ejecución generados | 2 | 204 bytes |
| Mobile ajeno a TABA (Ojo Claro/Estela) | 40 | 128.240 bytes |
| Frontend nuevo | 0 | 0 bytes |
| Migraciones/base de datos nuevas | 0 | 0 bytes |
| **Total** | **199** | **94.559.303 bytes** |

## Evaluación de sensibilidad

- No hay un archivo `.env` real entre los archivos no rastreados.
- `backend/.env.example` contiene la variable `OPENAI_API_KEY` con un valor no vacío. No se registra el valor en este informe y el archivo se excluye del resguardo por precaución.
- `backend/src/server.js` solamente referencia `process.env.OPENAI_API_KEY`; no contiene una clave incrustada detectada en el preflight.
- `backend/backend-runtime.err.log` menciona el nombre de la variable, pero no contiene una asignación ni un valor.
- `backend/backend-runtime.log` incluye una IP LAN local. Se clasifica como log temporal y se excluye del resguardo.
- `.idea/workspace.xml` y `.idea/caches/deviceStreaming.xml` son estado local del IDE/dispositivo. Se excluyen del resguardo.
- La raíz también contiene `.env.example`, que ya está rastreado. Se excluirán todos los nombres `.env` y `.env.*` del resguardo para evitar copiar configuraciones sensibles por error.

## Código fuente relevante / backend (4)

Los cuatro archivos pertenecen a un backend de **Ojo Claro**, no al flujo actual de pedidos TABA. Se preservan como trabajo local, pero no deben integrarse en producción sin una decisión explícita.

- `backend/.env.example`
- `backend/package-lock.json`
- `backend/package.json`
- `backend/src/server.js`

## Frontend (0)

No hay archivos frontend nuevos no rastreados. El frontend TABA vigente está compuesto por archivos ya rastreados.

## Mobile ajeno a TABA (40)

Los nombres de paquete, rutas, README y código identifican dos aplicaciones Ojo Claro/Estela. No forman parte del primer comercio TABA. Se preservan en la copia externa y no se modificarán ni integrarán durante esta etapa.

- `mobile/ojo_claro/.gitignore`
- `mobile/ojo_claro/.metadata`
- `mobile/ojo_claro/README.md`
- `mobile/ojo_claro/analysis_options.yaml`
- `mobile/ojo_claro/android/.gitignore`
- `mobile/ojo_claro/android/app/build.gradle.kts`
- `mobile/ojo_claro/android/app/src/debug/AndroidManifest.xml`
- `mobile/ojo_claro/android/app/src/main/AndroidManifest.xml`
- `mobile/ojo_claro/android/app/src/main/kotlin/com/example/ojo_claro/MainActivity.kt`
- `mobile/ojo_claro/android/app/src/main/res/drawable-v21/launch_background.xml`
- `mobile/ojo_claro/android/app/src/main/res/drawable/launch_background.xml`
- `mobile/ojo_claro/android/app/src/main/res/mipmap-hdpi/ic_launcher.png`
- `mobile/ojo_claro/android/app/src/main/res/mipmap-mdpi/ic_launcher.png`
- `mobile/ojo_claro/android/app/src/main/res/mipmap-xhdpi/ic_launcher.png`
- `mobile/ojo_claro/android/app/src/main/res/mipmap-xxhdpi/ic_launcher.png`
- `mobile/ojo_claro/android/app/src/main/res/mipmap-xxxhdpi/ic_launcher.png`
- `mobile/ojo_claro/android/app/src/main/res/values-night/styles.xml`
- `mobile/ojo_claro/android/app/src/main/res/values/styles.xml`
- `mobile/ojo_claro/android/app/src/profile/AndroidManifest.xml`
- `mobile/ojo_claro/android/build.gradle.kts`
- `mobile/ojo_claro/android/gradle.properties`
- `mobile/ojo_claro/android/gradle/wrapper/gradle-wrapper.properties`
- `mobile/ojo_claro/android/settings.gradle.kts`
- `mobile/ojo_claro/lib/main.dart`
- `mobile/ojo_claro/pubspec.lock`
- `mobile/ojo_claro/pubspec.yaml`
- `mobile/ojo_claro/test/widget_test.dart`
- `mobile/ojo_claro_android/.gitignore`
- `mobile/ojo_claro_android/app/build.gradle.kts`
- `mobile/ojo_claro_android/app/src/main/AndroidManifest.xml`
- `mobile/ojo_claro_android/app/src/main/java/com/ojoclaro/estela/MainActivity.kt`
- `mobile/ojo_claro_android/app/src/main/res/values/styles.xml`
- `mobile/ojo_claro_android/app/src/main/res/xml/file_paths.xml`
- `mobile/ojo_claro_android/app/src/main/res/xml/network_security_config.xml`
- `mobile/ojo_claro_android/build.gradle.kts`
- `mobile/ojo_claro_android/gradle/wrapper/gradle-wrapper.jar`
- `mobile/ojo_claro_android/gradle/wrapper/gradle-wrapper.properties`
- `mobile/ojo_claro_android/gradlew`
- `mobile/ojo_claro_android/gradlew.bat`
- `mobile/ojo_claro_android/settings.gradle.kts`

## Migraciones y base de datos (0)

No hay migraciones SQL ni archivos de base de datos nuevos entre los 199 no rastreados.

## Configuración y archivos generados (5)

Se excluyen del resguardo externo por ser configuración local, caché o logs de ejecución.

- `.idea/caches/deviceStreaming.xml`
- `.idea/vcs.xml`
- `.idea/workspace.xml`
- `backend/backend-runtime.err.log`
- `backend/backend-runtime.log`

## Capturas, videos, documentación y evidencia (150)

### `artifacts/` (43)

- `artifacts/ChatGPT Image 1 jul 2026, 06_21_01 p.m.png`
- `artifacts/REPORTE-demo-walter-moto-g15-completo.txt`
- `artifacts/REPORTE-demo-walter-moto-g15.txt`
- `artifacts/REPORTE-demo-walter.txt`
- `artifacts/REPORTE-la-taba-walter-final.txt`
- `artifacts/REPORTE-mejoras-demo-walter.txt`
- `artifacts/REPORTE-pwa-instalable-walter.txt`
- `artifacts/la-taba-demo-walter-moto-g15-completo.mp4`
- `artifacts/la-taba-demo-walter-moto-g15.mp4`
- `artifacts/la-taba-demo-walter.mp4`
- `artifacts/la-taba-walter-final-tracking-visible.mp4`
- `artifacts/audit-realista-2026-07-01/01-local-home.png`
- `artifacts/audit-realista-2026-07-01/01b-local-home-full.png`
- `artifacts/audit-realista-2026-07-01/02-local-catalog.png`
- `artifacts/audit-realista-2026-07-01/03-local-product-detail.png`
- `artifacts/audit-realista-2026-07-01/04-local-catalog-quantity.png`
- `artifacts/audit-realista-2026-07-01/05-local-cart.png`
- `artifacts/audit-realista-2026-07-01/05b-local-cart-full.png`
- `artifacts/audit-realista-2026-07-01/06-local-checkout.png`
- `artifacts/audit-realista-2026-07-01/06b-local-checkout-full.png`
- `artifacts/audit-realista-2026-07-01/07-local-tracking-received.png`
- `artifacts/audit-realista-2026-07-01/07b-local-tracking-received-full.png`
- `artifacts/audit-realista-2026-07-01/08-local-after-reload.png`
- `artifacts/audit-realista-2026-07-01/09-local-home-active-order.png`
- `artifacts/audit-realista-2026-07-01/10-local-business-new-order.png`
- `artifacts/audit-realista-2026-07-01/10b-local-business-new-order-full.png`
- `artifacts/audit-realista-2026-07-01/11-local-business-dispatched.png`
- `artifacts/audit-realista-2026-07-01/12-local-tracking-dispatched-no-gps.png`
- `artifacts/audit-realista-2026-07-01/13-local-rider-dispatched.png`
- `artifacts/audit-realista-2026-07-01/13b-local-rider-dispatched-full.png`
- `artifacts/audit-realista-2026-07-01/14-local-rider-arrived.png`
- `artifacts/audit-realista-2026-07-01/15-local-tracking-delivered.png`
- `artifacts/audit-realista-2026-07-01/16-local-home-reorder.png`
- `artifacts/audit-realista-2026-07-01/16b-local-home-reorder-full.png`
- `artifacts/audit-realista-2026-07-01/18-public-home.png`
- `artifacts/audit-realista-2026-07-01/20-moto-g15-public-cachebust.png`
- `artifacts/audit-realista-2026-07-01/21-moto-g15-public-reset.png`
- `artifacts/audit-realista-2026-07-01/22-public-fake-confirmation.png`
- `artifacts/audit-realista-2026-07-01/23-local-invalid-phone-outside-zone.png`
- `artifacts/audit-realista-2026-07-01/24-moto-g15-actual-screen.png`
- `artifacts/audit-realista-2026-07-01/25-public-rider-second-device-empty.png`
- `artifacts/audit-realista-2026-07-01/26-local-pizza-detail.png`
- `artifacts/audit-realista-2026-07-01/27-local-promo-maqueta.png`

### `demo-evidence/` (19)

- `demo-evidence/_expr.js`
- `demo-evidence/cdp-console.mjs`
- `demo-evidence/cdp.mjs`
- `demo-evidence/phone-01-pitch.png`
- `demo-evidence/phone-02-home.png`
- `demo-evidence/phone-03-catalog.png`
- `demo-evidence/phone-04-catalog-cart.png`
- `demo-evidence/phone-05-cart.png`
- `demo-evidence/phone-06-checkout-filled.png`
- `demo-evidence/phone-07-tracking.png`
- `demo-evidence/phone-08-pin-modal.png`
- `demo-evidence/phone-09-business-inbox.png`
- `demo-evidence/phone-10-business-order-detail.png`
- `demo-evidence/phone-11-rider-ready.png`
- `demo-evidence/phone-12-rider-code.png`
- `demo-evidence/phone-13-tracking-delivered.png`
- `demo-evidence/phone-14-home-reorder.png`
- `demo-evidence/phone-15-business-reports.png`
- `demo-evidence/phone-16-home-abierto-demo.png`

### `docs/visual-review/commercial-polish-v1/` (21)

- `docs/visual-review/commercial-polish-v1/desktop-01-home.png`
- `docs/visual-review/commercial-polish-v1/desktop-02-catalog.png`
- `docs/visual-review/commercial-polish-v1/desktop-03-cart-empty.png`
- `docs/visual-review/commercial-polish-v1/desktop-04-business-empty.png`
- `docs/visual-review/commercial-polish-v1/mobile-01-home.png`
- `docs/visual-review/commercial-polish-v1/mobile-02-tracking-empty.png`
- `docs/visual-review/commercial-polish-v1/mobile-03-cart-empty.png`
- `docs/visual-review/commercial-polish-v1/mobile-04-catalog.png`
- `docs/visual-review/commercial-polish-v1/mobile-05-product-modal.png`
- `docs/visual-review/commercial-polish-v1/mobile-06-catalog-no-results.png`
- `docs/visual-review/commercial-polish-v1/mobile-07-catalog-with-cart.png`
- `docs/visual-review/commercial-polish-v1/mobile-08-cart-filled.png`
- `docs/visual-review/commercial-polish-v1/mobile-09-checkout-filled.png`
- `docs/visual-review/commercial-polish-v1/mobile-10-tracking-active.png`
- `docs/visual-review/commercial-polish-v1/mobile-11-pin-modal.png`
- `docs/visual-review/commercial-polish-v1/mobile-12-business-inbox.png`
- `docs/visual-review/commercial-polish-v1/mobile-13-business-preparing.png`
- `docs/visual-review/commercial-polish-v1/mobile-14-rider.png`
- `docs/visual-review/commercial-polish-v1/narrow-01-home.png`
- `docs/visual-review/commercial-polish-v1/narrow-02-catalog.png`
- `docs/visual-review/commercial-polish-v1/narrow-03-cart.png`

### `docs/visual-review/commercial-polish-v1-final/` (67)

- `docs/visual-review/commercial-polish-v1-final/d1280-01-home.png`
- `docs/visual-review/commercial-polish-v1-final/d1280-02-catalog.png`
- `docs/visual-review/commercial-polish-v1-final/d1280-03-cart-filled.png`
- `docs/visual-review/commercial-polish-v1-final/d1280-04-checkout-filled.png`
- `docs/visual-review/commercial-polish-v1-final/d1280-05-tracking-active.png`
- `docs/visual-review/commercial-polish-v1-final/d1280-06-business-new-order.png`
- `docs/visual-review/commercial-polish-v1-final/d1280-07-rider.png`
- `docs/visual-review/commercial-polish-v1-final/m390-01-pitch.png`
- `docs/visual-review/commercial-polish-v1-final/m390-02-home.png`
- `docs/visual-review/commercial-polish-v1-final/m390-03-tracking-empty.png`
- `docs/visual-review/commercial-polish-v1-final/m390-04-rider-pin-lock.png`
- `docs/visual-review/commercial-polish-v1-final/m390-05-business-pin-modal.png`
- `docs/visual-review/commercial-polish-v1-final/m390-06-business-initial.png`
- `docs/visual-review/commercial-polish-v1-final/m390-07-business-catalog-collapsed.png`
- `docs/visual-review/commercial-polish-v1-final/m390-08-business-catalog-form-new.png`
- `docs/visual-review/commercial-polish-v1-final/m390-09-business-catalog-edit.png`
- `docs/visual-review/commercial-polish-v1-final/m390-10-business-catalog-expanded.png`
- `docs/visual-review/commercial-polish-v1-final/m390-11-business-cashbox-initial.png`
- `docs/visual-review/commercial-polish-v1-final/m390-12-demo-guide.png`
- `docs/visual-review/commercial-polish-v1-final/m390-13-catalog.png`
- `docs/visual-review/commercial-polish-v1-final/m390-14-catalog-no-results.png`
- `docs/visual-review/commercial-polish-v1-final/m390-15-product-detail.png`
- `docs/visual-review/commercial-polish-v1-final/m390-16-cart-filled.png`
- `docs/visual-review/commercial-polish-v1-final/m390-17-checkout-filled.png`
- `docs/visual-review/commercial-polish-v1-final/m390-18-tracking-active.png`
- `docs/visual-review/commercial-polish-v1-final/m390-19-profile.png`
- `docs/visual-review/commercial-polish-v1-final/m390-20-business-new-order.png`
- `docs/visual-review/commercial-polish-v1-final/m390-21-business-preparing.png`
- `docs/visual-review/commercial-polish-v1-final/m390-22-business-ready.png`
- `docs/visual-review/commercial-polish-v1-final/m390-23-rider-ready.png`
- `docs/visual-review/commercial-polish-v1-final/m390-24-rider-on-the-way.png`
- `docs/visual-review/commercial-polish-v1-final/m390-25-rider-code-input.png`
- `docs/visual-review/commercial-polish-v1-final/m390-26-rider-code-confirmed.png`
- `docs/visual-review/commercial-polish-v1-final/m390-27-rider-delivered.png`
- `docs/visual-review/commercial-polish-v1-final/m390-28-tracking-delivered.png`
- `docs/visual-review/commercial-polish-v1-final/m390-29-home-reorder.png`
- `docs/visual-review/commercial-polish-v1-final/m390-30-reorder-card.png`
- `docs/visual-review/commercial-polish-v1-final/m390-31-business-cashbox-after.png`
- `docs/visual-review/commercial-polish-v1-final/m390-32-business-metrics-after.png`
- `docs/visual-review/commercial-polish-v1-final/n320-01-home.png`
- `docs/visual-review/commercial-polish-v1-final/n320-02-catalog.png`
- `docs/visual-review/commercial-polish-v1-final/n320-03-cart-filled.png`
- `docs/visual-review/commercial-polish-v1-final/n320-04-checkout-filled.png`
- `docs/visual-review/commercial-polish-v1-final/n320-05-tracking-active.png`
- `docs/visual-review/commercial-polish-v1-final/n320-06-business-new-order.png`
- `docs/visual-review/commercial-polish-v1-final/n320-07-rider.png`
- `docs/visual-review/commercial-polish-v1-final/t768-01-home.png`
- `docs/visual-review/commercial-polish-v1-final/t768-02-catalog.png`
- `docs/visual-review/commercial-polish-v1-final/t768-03-cart-filled.png`
- `docs/visual-review/commercial-polish-v1-final/t768-04-checkout-filled.png`
- `docs/visual-review/commercial-polish-v1-final/t768-05-tracking-active.png`
- `docs/visual-review/commercial-polish-v1-final/t768-06-business-new-order.png`
- `docs/visual-review/commercial-polish-v1-final/t768-07-rider.png`
- `docs/visual-review/commercial-polish-v1-final/v360-01-home.png`
- `docs/visual-review/commercial-polish-v1-final/v360-02-catalog.png`
- `docs/visual-review/commercial-polish-v1-final/v360-03-cart-filled.png`
- `docs/visual-review/commercial-polish-v1-final/v360-04-checkout-filled.png`
- `docs/visual-review/commercial-polish-v1-final/v360-05-tracking-active.png`
- `docs/visual-review/commercial-polish-v1-final/v360-06-business-new-order.png`
- `docs/visual-review/commercial-polish-v1-final/v360-07-rider.png`
- `docs/visual-review/commercial-polish-v1-final/v412-01-home.png`
- `docs/visual-review/commercial-polish-v1-final/v412-02-catalog.png`
- `docs/visual-review/commercial-polish-v1-final/v412-03-cart-filled.png`
- `docs/visual-review/commercial-polish-v1-final/v412-04-checkout-filled.png`
- `docs/visual-review/commercial-polish-v1-final/v412-05-tracking-active.png`
- `docs/visual-review/commercial-polish-v1-final/v412-06-business-new-order.png`
- `docs/visual-review/commercial-polish-v1-final/v412-07-rider.png`

## Decisiones de resguardo

- Se preservará todo el código y toda la evidencia no rastreada.
- Se excluirán `.git`, dependencias, builds, cachés, configuración de IDE, logs temporales y todos los archivos `.env`/`.env.*`.
- El contenido mobile Ojo Claro/Estela se preservará en el backup, pero queda fuera del alcance de implementación TABA.
- No se ejecutará ninguna limpieza ni eliminación durante esta fase.

## Resguardo externo verificado

Destino: `<EXTERNAL_BACKUP_ROOT>/la-taba-pages-backup-pre-production`
Inicio: `2026-07-25T02:29:35.7244036-03:00`
Finalización: `2026-07-25T02:29:44.3015132-03:00`
Archivos copiados: **520**
Tamaño total: **138.208.104 bytes**
Código de Robocopy: `1` (copia correcta con archivos nuevos)
Faltantes: **0**
Archivos extra: **0**
Diferencias de tamaño: **0**
Diferencias SHA-256: **0**

Directorios excluidos en cualquier nivel:

- `.git`
- `node_modules`
- `build`
- `dist`
- `.dart_tool`
- `.idea`
- `.vscode`
- `coverage`
- `cache`
- `caches`
- `.cache`
- `.gradle`
- `.kotlin`
- `test-results`

Archivos excluidos:

- `.env`
- `.env.*`
- `*.tmp`
- `*.temp`
- `*.log`
- `*.lock.tmp`
- `Thumbs.db`
- `.DS_Store`
