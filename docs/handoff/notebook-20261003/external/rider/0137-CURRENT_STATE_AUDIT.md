# LA TABA RIDER — Auditoría del estado actual

Fecha de corte: 2026-08-02  
Alcance: rider Android/Flutter en C:\1212\la-taba-rider-android, backend staging en C:\1212\la-taba-real-orders-staging, y contrato Supabase staging ukxqbgswjlibmnjemrzd.  
Regla de trabajo: esta auditoría es de solo lectura sobre los repositorios, el backend y Supabase. Los cambios existentes en ambos worktrees se consideran del usuario y no se alteraron.

## Veredicto ejecutivo

El proyecto tiene una base razonable de autenticación nativa, separación Flutter/Kotlin y contratos Gate2 de claim/start, pero todavía no es un rider GPS de producción. El servicio foreground actual es un cascarón de ciclo de vida: inicia una notificación y persiste un estado mínimo, pero no adquiere ubicaciones, no las filtra, no las encola y no las publica. La cola offline, la reconciliación después de muerte de proceso, el mapa/navegación y la certificación física siguen pendientes.

Task04 queda validado en el sentido de que el flujo de sesión, membership y la frontera de bridge están diseñados con un buen fail-closed. Task05 está implementado parcialmente en el worktree actual: claim, start y el shell del ForegroundService existen, pero la evidencia de integración real y de dispositivo aún no existe. La documentación raíz del rider todavía describe el estado anterior a Task05; este documento se basa en el código efectivo del worktree y registra esa discrepancia.

Estado global: NO LISTO PARA PRODUCCIÓN.

## Evidencia por componente

| Área | Evidencia actual | Evaluación |
|---|---|---|
| Flutter app | AuthController, SessionGate, OrdersController y DeliveryController existen; el flujo de inicio llama primero a permiso, luego a start_rider_delivery y después al servicio. | Buena estructura; sin mapa, navegación ni implementación real de GPS. |
| Bridge | MethodChannel/EventChannel versionados, envelopes ok/failure y errores sanitizados; los tokens no pasan a Dart. | Aprobable como frontera, pendiente de completar eventos de GPS/cola y manejo de resultados pendientes en destrucción. |
| Auth Kotlin | SessionManager con refresh single-flight, membership activa, almacenamiento AES-GCM en Android Keystore y sign-out que detiene trabajo nativo antes de limpiar. | Fuerte para MVP; falta integrar el servicio con la sesión y el uploader. |
| Contratos de órdenes | RiderRpcDataSource usa GET/RPC reales para available, assigned, claim y start; start usa solamente order_id y expected_revision. | Compatible con el Gate2 local; la aplicación/validación en staging real no está probada. |
| Manifest | INTERNET, FOREGROUND_SERVICE, FOREGROUND_SERVICE_LOCATION, POST_NOTIFICATIONS, FINE/COARSE y servicio location no exportado. | Declaración base correcta; aceptar COARSE como suficiente para publicar es un riesgo de calidad. |
| ForegroundService | RiderForegroundService crea canal, llama startForeground y conserva metadata; devuelve START_STICKY. No usa FusedLocationProviderClient ni uploader. | Shell funcional, pipeline GPS ausente. |
| Estado activo | ActiveDeliveryStore escribe JSON plano en noBackupFilesDir con orderId, publicCode, startedAt y state. | Riesgo de confidencialidad y de consistencia; no existe lock contra dos órdenes. |
| GPS | LocationModels, FusedLocationSource, LocationSampler, LocationQualityFilter y LocationPublisher son placeholders. build.gradle.kts no incluye Play Services Location. | Bloqueador P0. |
| Cola | EncryptedLocationQueueStore, OfflineLocationQueue y QueueDrainWorker son placeholders. No Room, DataStore, WorkManager ni SQLCipher. | Bloqueador P0. |
| Recuperación | Existen nombres de BootReceiver, ProcessRestartReceiver y RecoveryPolicy, pero son placeholders. No hay reconciliación de servicio/orden después de proceso muerto. | Bloqueador P0. |
| UX | Orders y detalle permiten iniciar/detener; ServiceBanner muestra starting/running/error/stopped. Map, freshness, battery y complete delivery son placeholders. | No certificable como operación de reparto. |
| Observabilidad | Hay sanitización de errores; no hay métricas operativas ni telemetría de GPS/cola implementada. | Riesgo alto para soporte y diagnóstico. |
| Tests | flutter analyze pasa. Flutter, Node y Gradle no obtuvieron ejecución completa por falta de espacio; varios instrumented/integration tests son placeholders. No hay Moto/staging evidence. | Evidencia insuficiente. |
| Release | Production config está vacía/fail-closed y el signing release continúa con debug key/TODO. | Bloqueador de release. |

## Arquitectura efectiva observada

El flujo actual es:

1. Flutter valida que la orden esté assigned o picked_up.
2. El bridge solicita permisos; la implementación nativa acepta fine o coarse.
3. Flutter llama a start_rider_delivery con order_id y expected_revision.
4. Tras la respuesta, Flutter llama a startDeliveryService. El idempotencyKey generado en Dart no se transmite porque el RPC real no tiene ese parámetro.
5. DeliveryServiceCoordinator persiste metadata mínima y arranca RiderForegroundService.
6. RiderForegroundService publica una notificación y cambia el snapshot a running.
7. No existe el paso de ubicación, calidad, persistencia, upload, ACK ni reconciliación.

El resultado es una notificación de servicio, no una garantía de tracking.

## Contratos backend que sí están demostrados en el código fuente

La migración local actual 20260801040000_rider_gps_tracking_gate2.sql define:

- list_available_rider_orders(uuid): entrega datos de lista y revision para riders autenticados.
- claim_available_rider_order(uuid, text, bigint, text default 'ready', uuid default null): claim con membership, lock y CAS de revision; el mismo rider puede obtener idempotent_no_op.
- start_rider_delivery(uuid, bigint): autoriza al rider asignado, hace transición assigned/picked_up a on_the_way y permite repetición no-op.
- publish_rider_location(uuid, bigint, double precision, double precision, double precision, double precision default null, double precision default null, timestamptz default null): valida identidad, estado, coordenadas, accuracy, heading, speed, captured_at y revision; asigna sequence y recorded_at del servidor.
- get_public_order_tracking(text): devuelve únicamente la última ubicación pública redondeada, con accuracy mínima de 100 y ventana de tres minutos.

La publicación rechaza captured_at futuro de más de 30 segundos, datos con más de tres minutos, accuracy fuera de 0–250, heading fuera de 0–360, speed fuera de 0–70, revisión obsoleta y una segunda inserción dentro de cinco segundos por orden. recorded_at y created_at son autoridad del servidor. No se debe agregar un RPC, un parámetro de idempotencia ni una firma “conveniente” desde el cliente.

Este contrato es el contrato fuente local, no evidencia de que la migración esté aplicada y validada en la instancia staging. La documentación del backend también deja constancia histórica de que no hubo una validación real de migraciones/RLS en ejecuciones previas. La aplicación en staging, grants, RLS, trigger de timestamp y smoke test deben ser un gate de Task10.

## Seguridad y datos

Lo correcto hoy:

- La publishable key es de cliente y la configuración de producción vacía falla cerrado.
- Los access/refresh tokens permanecen dentro de NativeRequestContext/SessionManager.
- EncryptedSessionStore usa AES-GCM y Android Keystore dentro de noBackupFilesDir.
- BridgeCodec no devuelve body HTTP, token, SQL crudo ni stack trace.
- Las llamadas sensibles están detrás de Auth/RLS/RPC, no de service_role.

Lo que debe corregirse:

- ActiveDeliveryStore es JSON plano. Aunque no guarda dirección ni coordenadas, expone orderId, publicCode y estado a cualquier lectura local con acceso al archivo.
- La cola GPS todavía no cifra nada ni ata cada fila a una identidad de sesión.
- El servicio no recibe SessionManager ni una fuente autenticada de requests; por tanto no puede refrescar sesión, detenerse al cambiar de rider ni manejar 401 de manera segura.
- La salida de log de ubicación, órdenes y errores debe permanecer libre de coordenadas, direcciones, tokens, cuerpos HTTP y PII.
- La retención real de rider_locations y su purga no queda demostrada por el Gate2 leído; debe verificarse en staging antes de release.

## Riesgos de concurrencia y recuperación

- Dos taps o una restauración podrían escribir metadata de una orden sobre otra: DeliveryServiceCoordinator no tiene un active-order lock/conflict guard.
- El proceso puede morir después del RPC start y antes de startForeground; el servidor queda on_the_way mientras el teléfono no sigue.
- START_STICKY no es una garantía de que Android reconstruya el servicio con todos sus datos ni de que haya una sesión válida.
- onTaskRemoved no detiene el servicio, pero la política aún no está probada en OEM; no hay una pantalla de recuperación.
- detener desde la notificación detiene el seguimiento local y limpia metadata, pero no cambia la orden backend. La UX debe llamarlo “Pausar seguimiento” y explicar la divergencia.
- force-stop y acciones equivalentes del sistema no pueden prometer recuperación automática; requieren lanzamiento explícito de la app.
- no hay manejo de permisos revocados, cambios de rider, revisión obsoleta, orden entregada mientras el dispositivo estaba offline ni cola vencida.

## Pruebas ejecutadas y límites

| Comando/artefacto | Resultado | Qué demuestra |
|---|---|---|
| flutter analyze | PASS: no issues found | Compilación/análisis estático Dart básico. |
| flutter test | NO EJECUTADO | Flutter no pudo crear temporales en D: ENOSPC; no se ejecutaron casos. |
| npm test Gate2/GPS | NO EJECUTADO | npm no pudo crear log/temp en D: ENOSPC; no se ejecutaron casos. |
| Gradle staging unit test | SIN RESULTADO | Gradle se lanzó con GRADLE_USER_HOME aislado en C: y agotó el tiempo del chequeo; no se debe contar como PASS. |
| Android instrumented tests | INSUFICIENTES | Hay clases nominales, pero OfflineLocationQueue, RestartRecovery y RiderForegroundService contienen cobertura placeholder. |
| integration_test Flutter | INSUFICIENTES | auth_flow, delivery_recovery, offline_queue, map_freshness y order_claim_flow son placeholders de una línea. |
| Moto/staging | AUSENTE | No hay logs, capturas, secuencias ni resultados físicos. |

El disco local agotado es un bloqueo del entorno de verificación, no una justificación para relajar los gates.

## Conclusión de auditoría

La base se puede convertir en producción si se implementan Task06–Task10 en orden y se preserva el contrato exacto de Gate2. La prioridad no es ampliar la UI antes de tener una fuente GPS nativa, una cola durable cifrada, sesión segura dentro del servicio y recuperación observable. El release no debe declararse listo por tener un ForegroundService que muestra una notificación.

Resultado requerido al terminar todos los gates: LA_TABA_RIDER_PRODUCTION_PLAN_READY.
