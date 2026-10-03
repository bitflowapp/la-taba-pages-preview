# Plan de implementación por etapas

Regla general: cada etapa termina con tests y revisión del diff. No tocar `C:\1212\la-taba-real-orders-staging`, Supabase, `main`, producción ni agregar RPCs. Los prompts ejecutables están en `CODEX_TASKS/`.

## 1. Scaffold

- Archivos: `pubspec.yaml`, `lib/`, `android/`, flavors, `analysis_options.yaml`, tests base.
- Objetivo: compilar staging y production con configuración separada y package id aprobado.
- Restricciones: sin Auth real, sin GPS real, sin secretos y sin WebView/AccessibilityService.
- Pruebas: `flutter analyze`, `flutter test`, build APK de cada flavor.
- Aceptación: launch de ambos flavors, production no apunta a staging por default, árbol igual a `PROJECT_TREE.md`.
- Dependencias: aprobación de package/applicationId, min/target SDK y mapas.

## 2. Auth

- Archivos: `SessionManager.kt`, `SupabaseAuthClient.kt`, stores cifrados, `auth_repository_impl.dart`, login y bridge.
- Objetivo: login password, membresía rider, restore, refresh rotado y logout local.
- Restricciones: Kotlin único dueño de tokens; sin refresh token en Dart; sólo publishable key.
- Pruebas: login OK/401/429, rol incorrecto, membresía inactiva, refresh concurrente, logout y sanitización.
- Aceptación: la app no muestra cola si no hay rider activo; una rotación actualiza service y Flutter sin perder sesión.
- Dependencias: flavor config y endpoint Supabase staging aprobado.

## 3. Pedidos

- Archivos: `RiderRpcDataSource.kt`, DTOs/mappers, `orders_repository_impl.dart`, orders page y fixtures.
- Objetivo: cargar disponibles, recuperar asignados y mostrar `revision`.
- Restricciones: firma Gate 2 exacta; no seleccionar `rider_locations`; no estados nuevos.
- Pruebas: DTO completo, campos nulos, revision como número/string, error `40001`, pedido asignado visible sólo al rider correcto.
- Aceptación: la lista muestra sólo campos de `list_available_rider_orders`; el snapshot completo sustituye estado local.
- Dependencias: Auth.

## 4. Bridge Flutter/Kotlin

- Archivos: `RiderMethodChannel.kt`, `RiderEventChannel.kt`, `BridgeCodec.kt`, wrappers Dart y contratos JSON versionados.
- Objetivo: API tipada para Auth, pedidos, entrega, service y eventos.
- Restricciones: respuestas `{ok,data,error}`, no excepciones ni secretos cruzando, idempotencia explícita.
- Pruebas: métodos unknown, payload inválido, reconexión EventChannel, orden de eventos, backpressure.
- Aceptación: Flutter puede consultar estado nativo después de matar/reabrir su proceso.
- Dependencias: Auth y DTOs.

## 5. ForegroundService

- Archivos: `RiderForegroundService.kt`, state machine, notification controller, manifest y permission manager.
- Objetivo: servicio persistente con pantalla apagada y notificación.
- Restricciones: `foregroundServiceType=location`, `stopWithTask=false`, no depender de Dart, detener en terminal/logout.
- Pruebas: start/stop, permiso denegado, notification channel, swipe de recientes instrumentado, process recreation.
- Aceptación: service entra en foreground dentro del plazo Android y reporta estado aun sin Flutter.
- Dependencias: bridge, Auth y aprobación de permisos.

## 6. GPS y RPC Gate 2

- Archivos: `FusedLocationSource.kt`, `LocationQualityFilter.kt`, `LocationPublisher.kt`, backend contract fixtures.
- Objetivo: preparar/iniciar entrega, capturar y publicar por `publish_rider_location`.
- Restricciones: no fallback a RPC legacy, no insert directo, revision obligatoria, servidor como reloj/secuencia.
- Pruebas: claim concurrente, start idempotente, GPS inválido, accuracy, futuro/atrasado, 5 s rate limit, otro rider, terminal.
- Aceptación: una publicación exitosa devuelve y muestra `sequence`/`recorded_at`; ningún evento `captured` se presenta como `published`.
- Dependencias: etapas 2–5 y Gate 2 remoto aplicado.

## 7. Cola offline

- Archivos: `EncryptedLocationQueueStore.kt`, `OfflineLocationQueue.kt`, `QueueDrainWorker.kt`, conectividad.
- Objetivo: almacenar y drenar muestras recientes sin red.
- Restricciones: cifrada, FIFO, TTL 3 min, límite, respeta 5 s, purga en terminal/revisión inválida; no historial.
- Pruebas: persistencia tras kill, límite, TTL, reconexión, refresh 401, `40001`, `P0001`, duplicados.
- Aceptación: ninguna muestra vencida se envía; cola se vacía o descarta con motivo observable y sanitizado.
- Dependencias: GPS, Auth, ActiveDeliveryStore.

## 8. Mapa

- Archivos: `rider_map.dart`, `map_controller.dart`, `map_style.dart`, freshness widgets.
- Objetivo: MapLibre con marcador propio/último fix y freshness.
- Restricciones: no WebView, no ruta/ETA/destino inventados, no interpolación de puntos no publicados.
- Pruebas: fresh/delayed/lost/none, sequence atrasado, ausencia de fix, rotación y background.
- Aceptación: mapa conserva último fix sin declarar live cuando supera 15 s; nunca dibuja historial crudo.
- Dependencias: eventos de ubicación y aprobación del proveedor de tiles.

## 9. Recuperación

- Archivos: `ActiveDeliveryRecovery.kt`, `BootReceiver.kt`, `RecoveryPolicy.kt`, session gate y recovery integration tests.
- Objetivo: recuperar entrega activa tras reabrir, process death y reconnect.
- Restricciones: validar session, asignación, estado y revision; no inventar RPC de pausa/cancelación.
- Pruebas: proceso Flutter muerto, service recreado, estado terminal, otro rider, refresh inválido, reboot best-effort.
- Aceptación: una entrega activa válida restaura notificación y permite continuar; terminal siempre detiene/purga.
- Dependencias: service, Auth, orders y cola.

## 10. Pruebas físicas

- Archivos: `integration_test/`, `androidTest/`, checklist no versionado de evidencias.
- Objetivo: validar Moto G15/Android objetivo con staging, cuenta QA y pedido QA.
- Restricciones: no coordenadas/domicilios/teléfonos/tokens en screenshots; no producción; no deploy.
- Pruebas: pantalla apagada, otra app, swipe, pérdida de red, refresh, GPS apagado, terminal, reboot y Force stop.
- Aceptación: evidencia firmada con tiempos redondeados, resultado, freshness, sequence y stop inmediato; todos los límites Android quedan documentados.
- Dependencias: todas las etapas, dispositivo físico, cuenta QA y aprobación humana.

## Orden de merge local

Cada etapa debe ser un cambio aislado en el proyecto Android. El agente que trabaje en una etapa no debe “arreglar” backend ni combinar refactors no necesarios. Las revisiones se hacen por contrato primero, tests después y UI al final.

