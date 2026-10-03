# IMPLEMENTATION_ROADMAP — Tasks 06 a 10

## Orden de ejecución

~~~text
Task06 GPS nativo/FGS
       |
       v
Task07 cola offline + sesión/uploader
       |
       v
Task08 process death + recovery/lifecycle
       |
       v
Task09 mapa/navegación/UX/completion contract
       |
       v
Task10 staging + certificación física + release
~~~

No se debe empezar la certificación final con placeholders de etapas anteriores. Se pueden desarrollar adaptadores UX en paralelo, pero cada etapa conserva su gate.

## Task06 — GPS native/publication

Archivos principales: build.gradle.kts, AndroidManifest.xml, MainActivity.kt, RiderApplication.kt, native/location/*, native/delivery/*, native/data/LocationPublisher.kt y tests nativos. Inyectar SessionManager y el cliente RPC sin exponer tokens al bridge.

Objetivo: FLP real dentro de RiderForegroundService, fine permission, filtro de calidad, sampling adaptativo, actor por orden y publicación exacta a publish_rider_location. Flutter solo observa estado.

Dependencias: Task05 start/claim existente, migración Gate2 leída, decisión de Play Services Location, ADR-001/003.

Exit gate: una muestra aceptada con sequence/recorded_at en staging y pantalla apagada; no logs sensibles; contract tests exactos.

## Task07 — Offline queue/session

Archivos principales: Room database/DAO/migrations, EncryptedLocationQueueStore, OfflineLocationQueue, QueueDrainWorker, NetworkMonitor, uploader y SessionManager integration, además de unit/instrumented tests.

Objetivo: durable queue cifrada, leases, backoff, ACK/delete transaccional, 401 single-flight, stale/validation mapping y límites de batería/espacio.

Dependencias: Task06 location DTO/publisher, ADR-002/003; no requiere un RPC nuevo.

Exit gate: air-plane test con retorno de red, process restart sin pérdida, cambio de rider/logout seguro y payload ausente en filesystem/logs.

## Task08 — Recovery/process death

Archivos principales: ActiveDeliveryStore/Repository cifrado, RecoveryPolicy, ProcessRestartReceiver/BootReceiver si la política lo permite, DeliveryServiceCoordinator/RiderForegroundService, SessionGate/DeliveryController y pruebas lifecycle. Usar el método assigned existente para reconcile.

Objetivo: resolver la ventana start RPC/FSG, recuperar intent/queue, impedir dos órdenes activas, detener al completar/invalidar y explicar force-stop/reboot.

Dependencias: Task06/07, contrato assigned/revision; leer cualquier RPC de completion existente antes de implementarlo.

Exit gate: process kill, crash, swipe, reboot, force-stop, permission revoke y terminal order tienen resultados documentados y tests físicos/automáticos donde sea posible.

## Task09 — Map/navigation/UX

Archivos principales: rider_map/map_controller/map_freshness/location_freshness, active_delivery_page/order_detail, service banner/events, notification actions, navigation adapter y tests UI/integration.

Objetivo: UX operacional con Fresh/Delayed/Stale/Queued/Session required, pausa no destructiva, recovery card, navegación externa y mapa solo con proveedor/estilo autorizado. Validar contrato backend real de completion; no inventar RPC.

Dependencias: estado/queue/freshness de Task06–08, decisión de proveedor y privacidad, UX review.

Exit gate: rider puede iniciar, entender el estado, navegar, recuperarse y pausar sin confundir tracking con estado comercial; TalkBack/font scale/permission denial aprobados.

## Task10 — Physical certification/staging release

Archivos principales: runbook y evidence bundle, CI scripts, release Gradle/signing, staging config, test reports, privacy/security checklist y rollback plan. No modificar/deployar durante esta auditoría.

Objetivo: probar en instancia staging real y Moto de certificación, cerrar permisos/lifecycle/batería/network/recovery, generar APK firmado y checklist de release.

Dependencias: Tasks06–09 completos, migración aplicada con aprobación, secrets de CI gestionados por el owner, Moto/linea staging disponible, espacio de disco para ejecutar suites.

Exit gate: todos los gates críticos sin waiver; evidencia reproducible y veredicto final exacto.

## Definition of Done transversal

- Contrato RPC citado desde migración local y verificado contra staging; ninguna firma inventada.
- Todo almacenamiento sensible cifrado o justificado; tokens nunca cruzan bridge ni logs.
- Un solo active delivery y uploader por rider.
- Cada transición técnica tiene evento sanitizado y acción UX.
- Tests ejecutables, no placeholders, con resultado publicado.
- Reboot/force-stop/OEM se presentan como límites cuando no hay garantía.
- Métricas agregadas permiten diagnosticar freshness, queue y sesión sin coordenadas.
- Production signing y configuración fail-closed están separados de staging.
- Backout/rollback y responsable de retención documentados.

## Orden de aprobación

1. Arquitectura y contratos: ADRs + revisión backend.
2. Seguridad: sesión, queue, logs, RLS.
3. Correctitud: unit/contract/instrumented.
4. Operación: Moto y red/batería/lifecycle.
5. Release: build firmado, staging smoke, checklist y decisión de go/no-go.

Hasta completar el punto 5, el estado es NO LISTO PARA PRODUCCIÓN.
