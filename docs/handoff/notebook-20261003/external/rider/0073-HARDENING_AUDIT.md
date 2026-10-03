# LA TABA RIDER — Auditoría fina del runtime Android

Fecha de cierre: 2026-08-02 15:45:58 -03:00

## Resultado

El runtime Android quedó endurecido y pasó la validación automatizada completa. El cierre no afirma supervivencia ante **Forzar detención** y mantiene pendientes las pruebas físicas de comportamiento real indicadas en `LIFECYCLE_REVIEW.md`.

Veredicto de esta etapa:

`LA_TABA_RIDER_ANDROID_RUNTIME_HARDENED_READY_FOR_PHYSICAL_TEST`

## Alcance e insumos auditados

- Repositorio lógico: `C:\1212\la-taba-rider-android`.
- Target físico confirmado por junction: `D:\1212\la-taba-rider-android`.
- Rama preservada: `develop`.
- HEAD preservado: `31003891de66c6a3d3fd78b3a4fbab0ac746ac4a`.
- Se leyeron los artefactos Task 04, Task 05 y Task 06, el contrato de arquitectura y el Gate 2 GPS real antes de editar.
- Se preservaron los contratos RPC existentes; no se agregaron RPC, argumentos, estados backend ni mutaciones Supabase.
- No se modificaron producción, firma release, backend, Gate 1/2 ni alcance comercial/visual.
- No se implementó una cola GPS persistente: la cola continúa siendo efímera, acotada y purgable.

## Fallos encontrados y correcciones

1. El mutex de refresh era genérico y permitía mezclar tipos de retorno entre callers concurrentes. Se convirtió en single-flight de rotación con resultado compartido seguro y lectura posterior de la sesión común.
2. Los clientes HTTP sólo podían cancelar la llamada más reciente. Ahora mantienen un conjunto concurrente y cancelan todas las llamadas activas al detener GPS, cerrar sesión o invalidar transporte.
3. Un ACK tardío de publicación podía emitir `fresh` después de `stop`. El actor invalida su ciclo, cancela el gateway y verifica vigencia después de operaciones bloqueantes.
4. El servicio y la UI no tenían una autoridad única para pedido, revisión, estado y ciclo. `DeliveryServiceCoordinator` centraliza esos datos y usa una generación monotónica.
5. La recuperación podía confiar demasiado en JSON local. Los metadatos ahora son mínimos, validados y atómicos; el estado se reconcilia contra backend por pedido y revisión antes de reanudar.
6. Claim/start/stop podían competir entre toques rápidos y respuestas tardías. Se añadió single-flight, exclusión entre pedidos, IDs locales de operación y supersesión explícita por stop.
7. EventChannel podía duplicar listener o entregar eventos de una registración anterior. La registración activa es única, se desacopla al cancelar y cada evento lleva `generation`/`event_id` monotónicos.
8. El bridge aceptaba envelopes incompletos y el parser Dart aún toleraba el alias histórico `no_signal`. Se exige versión 1, campos contractuales y tipos válidos; los campos futuros desconocidos se ignoran, sólo se acepta el estado contractual `noSignal` y los estados desconocidos fallan sin crash. La migración del alias legacy queda confinada al store nativo.
9. Callbacks de ubicación de un perfil anterior podían sobrevivir a stop/restart. `FusedLocationSource` usa un token de ciclo y descarta callbacks obsoletos.
10. Estado de GPS desactivado, red caída y otros errores operativos no siempre eran accionables; algunas cadenas nuevas además tenían codificación incorrecta. Se preservan sólo claves locales sanitizadas y se muestran correctamente sesión vencida, permiso preciso, ubicación apagada, sin red, revisión desactualizada, acceso denegado y servicio detenido.

## Autoridad y contratos resultantes

- Autoridad local: `DeliveryServiceCoordinator` de alcance de proceso, compartido desde `RiderApplication`.
- Exclusión de operaciones: `RiderOperationGate` de alcance de proceso.
- Servicio nativo independiente de Dart: `RiderForegroundService` + `LocationTrackingActor`.
- Secuencia y `recorded_at`: sólo se aceptan desde la respuesta del servidor.
- Floor de publicación: 6 segundos como mínimo, una publicación en vuelo y dedupe/filtros previos.
- Estados EventChannel exactos: `starting`, `running`, `fresh`, `delayed`, `stale`, `noSignal`, `stopped`, `error`.
- Métodos contractuales exactos: `claimOrder`, `startDelivery`, `startDeliveryService`, `stopDeliveryService`, `getDeliveryServiceStatus`.

## Archivos de hardening principales

Android/Kotlin:

- `android/app/src/main/kotlin/com/lataba/rider/MainActivity.kt`
- `android/app/src/main/kotlin/com/lataba/rider/RiderApplication.kt`
- `android/app/src/main/kotlin/com/lataba/rider/runtime/RiderOperationGate.kt`
- `android/app/src/main/kotlin/com/lataba/rider/auth/SessionManager.kt`
- `android/app/src/main/kotlin/com/lataba/rider/auth/TokenRefreshMutex.kt`
- `android/app/src/main/kotlin/com/lataba/rider/auth/SupabaseAuthClient.kt`
- `android/app/src/main/kotlin/com/lataba/rider/data/SupabaseHttpClient.kt`
- `android/app/src/main/kotlin/com/lataba/rider/bridge/BridgeCodec.kt`
- `android/app/src/main/kotlin/com/lataba/rider/bridge/RiderEventChannel.kt`
- `android/app/src/main/kotlin/com/lataba/rider/bridge/RiderMethodChannel.kt`
- `android/app/src/main/kotlin/com/lataba/rider/delivery/DeliveryServiceCoordinator.kt`
- `android/app/src/main/kotlin/com/lataba/rider/delivery/RiderForegroundService.kt`
- `android/app/src/main/kotlin/com/lataba/rider/delivery/LocationTrackingActor.kt`
- `android/app/src/main/kotlin/com/lataba/rider/delivery/LocationPublisher.kt`
- `android/app/src/main/kotlin/com/lataba/rider/location/FusedLocationSource.kt`
- `android/app/src/main/kotlin/com/lataba/rider/location/LocationPermissionManager.kt`
- `android/app/src/main/kotlin/com/lataba/rider/secure/ActiveDeliveryStore.kt`

Flutter/Dart:

- `lib/platform/platform_codec.dart`
- `lib/platform/rider_method_channel.dart`
- `lib/platform/rider_event_channel.dart`
- `lib/domain/delivery/delivery_service_state.dart`
- `lib/features/delivery/application/delivery_controller.dart`
- `lib/features/delivery/application/start_delivery_use_case.dart`
- `lib/features/orders/application/orders_controller.dart`
- `lib/features/auth/application/auth_controller.dart`
- Widgets de estado/acción de delivery y orders para errores operativos accionables.

Tests reforzados o agregados:

- `android/app/src/test/kotlin/com/lataba/rider/runtime/RiderOperationGateTest.kt`
- `android/app/src/test/kotlin/com/lataba/rider/delivery/LocationTrackingActorTest.kt`
- `android/app/src/test/kotlin/com/lataba/rider/auth/TokenRefreshMutexTest.kt`
- `android/app/src/test/kotlin/com/lataba/rider/bridge/BridgeCodecTest.kt`
- Tests instrumentados de bridge, restart, servicio y `FusedLocationSource`.
- `test/features/delivery/start_delivery_test.dart`
- `test/features/orders/claim_order_test.dart`
- `test/platform/rider_method_channel_test.dart`

La cobertura del actor incluye de forma directa el ciclo `location_services_disabled` → `noSignal` accionable → nueva muestra `fresh`, demostrando que apagar ubicación no congela permanentemente el ciclo y que puede recuperarse al reactivarla.

El worktree completo contiene cambios previos de Tasks 04–06 y el hardening actual: 81 entradas en `git status --short`, 66 archivos tracked en el diff y 19 archivos untracked enumerados por Git. No se intentó separar, revertir ni limpiar trabajo preexistente.

## Preservación Git

- Rama y HEAD coinciden con el preflight.
- `git diff --check`: limpio al cierre.
- Worktree intencionalmente dirty: preservado.
- No se ejecutó commit, push, merge, reset, restore, stash ni clean.
