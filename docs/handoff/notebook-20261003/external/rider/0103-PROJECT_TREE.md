# Estructura propuesta — `C:\1212\la-taba-rider-android`

El árbol siguiente es el objetivo de scaffold. No presupone que esos archivos existan hoy.

```text
la-taba-rider-android/
├── README.md
├── analysis_options.yaml
├── pubspec.yaml
├── pubspec.lock
├── .metadata
├── .gitignore
├── tool/
│   ├── verify_contract.dart
│   └── verify_flavors.dart
├── lib/
│   ├── main_staging.dart
│   ├── main_production.dart
│   ├── app.dart
│   ├── core/
│   │   ├── config/app_config.dart
│   │   ├── config/flavor.dart
│   │   ├── errors/app_failure.dart
│   │   ├── errors/backend_error_mapper.dart
│   │   ├── logging/sanitized_logger.dart
│   │   ├── routing/app_router.dart
│   │   ├── result/app_result.dart
│   │   ├── time/clock.dart
│   │   ├── validation/uuid_validator.dart
│   │   └── widgets/app_error_view.dart
│   ├── domain/
│   │   ├── auth/rider_session.dart
│   │   ├── auth/rider_membership.dart
│   │   ├── orders/order.dart
│   │   ├── orders/available_order.dart
│   │   ├── orders/order_status.dart
│   │   ├── orders/order_revision.dart
│   │   ├── delivery/active_delivery.dart
│   │   ├── delivery/delivery_service_state.dart
│   │   ├── delivery/location_sample.dart
│   │   ├── delivery/location_publication.dart
│   │   ├── delivery/offline_queue_state.dart
│   │   └── map/location_freshness.dart
│   ├── data/
│   │   ├── datasources/rider_platform_datasource.dart
│   │   ├── datasources/session_datasource.dart
│   │   ├── dto/auth_dto.dart
│   │   ├── dto/order_dto.dart
│   │   ├── dto/gps_dto.dart
│   │   ├── dto/service_event_dto.dart
│   │   ├── mappers/auth_mapper.dart
│   │   ├── mappers/order_mapper.dart
│   │   ├── mappers/gps_mapper.dart
│   │   └── repositories/
│   │       ├── auth_repository_impl.dart
│   │       ├── orders_repository_impl.dart
│   │       ├── delivery_repository_impl.dart
│   │       └── location_repository_impl.dart
│   ├── features/
│   │   ├── auth/
│   │   │   ├── application/auth_controller.dart
│   │   │   ├── presentation/login_page.dart
│   │   │   ├── presentation/session_gate.dart
│   │   │   └── presentation/widgets/login_form.dart
│   │   ├── orders/
│   │   │   ├── application/orders_controller.dart
│   │   │   ├── application/claim_order_use_case.dart
│   │   │   ├── presentation/orders_page.dart
│   │   │   ├── presentation/order_detail_page.dart
│   │   │   └── presentation/widgets/order_card.dart
│   │   ├── delivery/
│   │   │   ├── application/delivery_controller.dart
│   │   │   ├── application/start_delivery_use_case.dart
│   │   │   ├── application/complete_delivery_use_case.dart
│   │   │   ├── presentation/active_delivery_page.dart
│   │   │   ├── presentation/widgets/delivery_actions.dart
│   │   │   ├── presentation/widgets/service_banner.dart
│   │   │   └── presentation/widgets/delivery_notification_copy.dart
│   │   └── map/
│   │       ├── application/map_controller.dart
│   │       ├── presentation/rider_map.dart
│   │       ├── presentation/widgets/freshness_badge.dart
│   │       └── map_style.dart
│   └── platform/
│       ├── rider_method_channel.dart
│       ├── rider_event_channel.dart
│       ├── platform_codec.dart
│       └── platform_permissions.dart
├── android/
│   ├── build.gradle
│   ├── settings.gradle
│   ├── gradle.properties
│   └── app/
│       ├── build.gradle
│       ├── proguard-rules.pro
│       └── src/
│           ├── main/
│           │   ├── AndroidManifest.xml
│           │   ├── res/
│           │   │   ├── drawable/ic_stat_delivery.xml
│           │   │   ├── mipmap-anydpi-v26/ic_launcher.xml
│           │   │   ├── values/strings.xml
│           │   │   └── xml/backup_rules.xml
│           │   └── kotlin/com/lataba/rider/
│           │       ├── MainActivity.kt
│           │       ├── RiderApplication.kt
│           │       ├── bridge/
│           │       │   ├── RiderMethodChannel.kt
│           │       │   ├── RiderEventChannel.kt
│           │       │   ├── BridgeCodec.kt
│           │       │   └── BridgeErrorMapper.kt
│           │       ├── auth/
│           │       │   ├── SessionManager.kt
│           │       │   ├── SupabaseAuthClient.kt
│           │       │   ├── SessionModels.kt
│           │       │   └── TokenRefreshMutex.kt
│           │       ├── data/
│           │       │   ├── SupabaseHttpClient.kt
│           │       │   ├── RiderRpcDataSource.kt
│           │       │   ├── BackendContract.kt
│           │       │   ├── BackendDtos.kt
│           │       │   └── BackendError.kt
│           │       ├── secure/
│           │       │   ├── SecureTokenStore.kt
│           │       │   ├── EncryptedSessionStore.kt
│           │       │   ├── ActiveDeliveryStore.kt
│           │       │   └── EncryptedLocationQueueStore.kt
│           │       ├── delivery/
│           │       │   ├── RiderForegroundService.kt
│           │       │   ├── DeliveryServiceCoordinator.kt
│           │       │   ├── DeliveryStateMachine.kt
│           │       │   ├── LocationSampler.kt
│           │       │   ├── LocationQualityFilter.kt
│           │       │   ├── LocationPublisher.kt
│           │       │   ├── OfflineLocationQueue.kt
│           │       │   ├── QueueDrainWorker.kt
│           │       │   ├── ActiveDeliveryRecovery.kt
│           │       │   └── DeliveryCompletionStopper.kt
│           │       ├── notifications/
│           │       │   ├── RiderNotificationController.kt
│           │       │   ├── RiderNotificationChannel.kt
│           │       │   └── RiderNotificationModel.kt
│           │       ├── location/
│           │       │   ├── FusedLocationSource.kt
│           │       │   ├── LocationPermissionManager.kt
│           │       │   └── LocationModels.kt
│           │       ├── connectivity/
│           │       │   ├── NetworkMonitor.kt
│           │       │   └── ConnectivityState.kt
│           │       └── recovery/
│           │           ├── BootReceiver.kt
│           │           ├── ProcessRestartReceiver.kt
│           │           └── RecoveryPolicy.kt
│           └── staging/
│               └── res/values/strings.xml
├── test/
│   ├── core/
│   ├── domain/
│   ├── data/
│   ├── features/auth/
│   ├── features/orders/
│   ├── features/delivery/
│   ├── features/map/
│   └── fixtures/backend_contract_fixtures.dart
├── integration_test/
│   ├── auth_flow_test.dart
│   ├── order_claim_flow_test.dart
│   ├── delivery_recovery_test.dart
│   ├── offline_queue_test.dart
│   └── map_freshness_test.dart
└── android/app/src/androidTest/kotlin/com/lataba/rider/
    ├── MainActivityBridgeTest.kt
    ├── SessionManagerInstrumentedTest.kt
    ├── RiderForegroundServiceInstrumentedTest.kt
    ├── OfflineLocationQueueInstrumentedTest.kt
    ├── NotificationInstrumentedTest.kt
    └── RestartRecoveryInstrumentedTest.kt
```

## Responsabilidades clave

| Archivo | Responsabilidad | No debe hacer |
|---|---|---|
| `BackendContract.kt` | Firmas, nombres de RPC, nombres de parámetros y códigos conocidos. | Inventar endpoints o estados. |
| `SupabaseHttpClient.kt` | HTTPS, headers, refresh ante 401 una sola vez, timeout y parseo. | Guardar tokens en texto plano. |
| `RiderRpcDataSource.kt` | Invocar Auth, RPCs y lecturas autorizadas. | Aplicar reglas de asignación en cliente. |
| `SecureTokenStore.kt` | Access/refresh token y expiración cifrados. | Exponer refresh token a Dart/UI. |
| `ActiveDeliveryStore.kt` | Pedido activo mínimo, revision y estado de servicio. | Persistir historial de coordenadas. |
| `EncryptedLocationQueueStore.kt` | Cola cifrada, TTL, límite y borrado seguro. | Reproducir muestras vencidas. |
| `RiderForegroundService.kt` | Foreground service, lifecycle y notificación. | Mostrar UI o depender de Flutter para publicar. |
| `LocationPublisher.kt` | Validar, rate-limit, publicar o encolar. | Saltar la RPC para escribir tabla. |
| `RiderMethodChannel.kt` | API de control síncrona/async entre Dart y Kotlin. | Transportar secretos o stack traces. |
| `RiderEventChannel.kt` | Stream de estado nativo versionado. | Prometer publicación por sólo capturar. |
| `orders_repository_impl.dart` | Casos de uso y estados de la app. | Conocer SQLSTATE mediante strings dispersos. |
| `rider_map.dart` | Render MapLibre y freshness. | Inventar ruta, ETA o movimiento. |
| `RiderForegroundServiceInstrumentedTest.kt` | Verificar notificación, permisos, stop y reinicio. | Sustituir una prueba física. |

## Manifest y configuración Android obligatorios

El scaffold debe declarar sólo los permisos aprobados: `INTERNET`, `ACCESS_FINE_LOCATION`, `ACCESS_COARSE_LOCATION`, `FOREGROUND_SERVICE` y el permiso específico de ubicación de foreground service requerido por el `targetSdk`. `POST_NOTIFICATIONS` se solicita en runtime donde corresponda. `ACCESS_BACKGROUND_LOCATION` requiere aprobación de producto y una explicación visible; no se agrega de forma silenciosa.

El service debe tener `android:exported="false"`, `android:foregroundServiceType="location"`, `android:stopWithTask="false"` y un canal de notificación de baja importancia pero visible. La configuración no debe permitir que production apunte accidentalmente al proyecto staging.

