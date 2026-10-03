# TABA Rider Android — Arquitectura

**Estado: propuesta. El proyecto Flutter no está creado.**

## Elección de plataforma: Flutter

Preferida, y sin contraindicación detectada.

| Alternativa | Por qué no |
|---|---|
| Kotlin nativo | La mejor opción técnica pura para servicios en primer plano y batería, pero el equipo ya trabaja en Dart/Flutter en otros proyectos y v1 es una app de formularios y estados, no de gráficos. El coste de arranque no se recupera |
| React Native | Sumaría un tercer ecosistema (hoy JS web + Dart); el soporte de foreground service con ubicación exige plugins nativos igual que Flutter |
| PWA envuelta (TWA/Capacitor) | Reintroduce exactamente los problemas que motivan la migración: ciclo de vida del navegador, ubicación no fiable con pantalla apagada, sin cola durable propia |

Flutter necesita **igualmente código nativo Android** para el foreground service. Eso está asumido y acotado: un servicio y su canal de notificación.

## Estructura de paquetes

```
taba_rider/
├── android/                       # manifest, foreground service, canales
├── lib/
│   ├── main.dart
│   ├── app/                       # arranque, tema, router, flavors
│   │   ├── app.dart
│   │   ├── router.dart
│   │   └── theme/taba_tokens.dart # GENERADO desde design-system/TOKENS.json
│   ├── core/
│   │   ├── result.dart            # Result<T, Failure> — sin excepciones cruzando capas
│   │   ├── clock.dart             # inyectable; nunca DateTime.now() directo
│   │   ├── ids.dart               # cmd_id (UUID v4) en el dispositivo
│   │   └── logger.dart
│   ├── domain/                    # SIN dependencias de Flutter ni de Supabase
│   │   ├── models/                # Order, OrderItem, Rider, Shift, Incident, Location
│   │   ├── enums/order_status.dart
│   │   ├── policies/              # transiciones válidas, geocerca, expiración
│   │   └── repositories/          # interfaces puras
│   ├── data/
│   │   ├── remote/                # SupabaseOrderApi, RealtimeChannel, RPCs tipados
│   │   ├── local/                 # Drift: OrdersDao, OutboxDao, LocationDao, SessionDao
│   │   ├── mappers/
│   │   └── repositories/          # implementaciones: local primero, remoto después
│   ├── services/
│   │   ├── outbox_service.dart    # cola durable + drenaje + backoff
│   │   ├── location_service.dart  # puente al foreground service nativo
│   │   ├── notification_service.dart
│   │   ├── session_service.dart
│   │   └── connectivity_service.dart
│   ├── features/                  # una carpeta por pantalla: view + controller + state
│   │   ├── auth/ shift/ jobs/ job_detail/ pickup/ delivery/ code/ incident/ history/ settings/
│   └── ui/                        # widgets compartidos: TabaButton, SlideToConfirm, NumPad, StatusPill…
└── test/ · integration_test/
```

**Regla de dependencias:** `domain` no importa nada de `data`, `services`, `ui` ni Flutter. `data` implementa interfaces de `domain`. `features` depende de `domain` y de providers, nunca de `data` directamente. Un test de arquitectura verifica esto en CI.

## Dependencias — y por qué

| Paquete | Uso | Justificación | Alternativa descartada |
|---|---|---|---|
| **flutter_riverpod** | Estado y dependencias | Compile-safe, sin `BuildContext` para leer estado, testeable sin widgets, y `AsyncValue` modela loading/error/data que es exactamente lo que hace esta app | BLoC: más ceremonia para estados que son casi todos "cargando/valor/error". `provider`: sin seguridad de tipos en overrides |
| **go_router** | Navegación declarativa | Deep links para notificaciones (`taba://order/A-1042`), redirecciones por sesión y por pedido activo, y **restauración de ruta tras muerte del proceso** | Navigator 1.0: no resuelve deep links ni restauración sin trabajo manual |
| **drift** (SQLite) | Persistencia | Consultas tipadas en compilación, migraciones versionadas y verificables, streams reactivos que alimentan la UI sin polling. La outbox necesita transacciones reales | `sqflite` crudo: SQL en strings, sin migraciones. Hive: sin transacciones ni consultas relacionales |
| **supabase_flutter** | Backend | El backend ya es Supabase; cliente oficial con auth, realtime y RPC | Cliente HTTP propio: reimplementar refresh de token y realtime |
| **maplibre_gl** | Mapa | Coherente con MapLibre en web; estilo auto-hospedado, sin clave de proveedor ni coste por carga | Google Maps: coste, dependencia de Play Services y otra clave que gestionar |
| **flutter_foreground_task** | Servicio en primer plano | Envoltura del servicio nativo con notificación persistente y callback aislado; es la pieza sin la cual la ubicación no sobrevive la pantalla apagada | Implementación nativa propia: viable, más mantenimiento |
| **geolocator** | Permisos y stream de posición | API estable de permisos y precisión; se usa **dentro** del servicio | `location`: menos control de precisión |
| **firebase_messaging** | Push | Único camino fiable para despertar la app en Android con pedido nuevo | WebSocket permanente: batería y muerte del proceso |
| **flutter_secure_storage** | Tokens | Keystore de Android para refresh token | SharedPreferences: texto plano |
| **sentry_flutter** | Errores | Crash reporting con breadcrumbs y sesiones; **con scrubbing de PII obligatorio** | Crashlytics: acopla más a Firebase |
| **connectivity_plus** | Señal de red | Dispara el drenaje de la outbox | Sondeo propio: gasta batería |

**No se incluyen** por moda: gestores de estado adicionales, inyección por code-gen pesada, ORMs alternativos, ni librerías de animación.

## Modelos inmutables

`freezed` + `json_serializable`. Todo modelo de dominio es `@freezed` con `copyWith` y unions para estados. `OrderStatus` es un `enum` con `fromJson` estricto: **un valor desconocido no se ignora** — se mapea a `OrderStatus.unknown` y se registra, porque significa que el servidor avanzó y la app no.

## Flujo de datos

```
UI (features)
  ↕ Riverpod
Repository  ── lee ──►  Drift (fuente de verdad LOCAL, streams)
            ── escribe ─► Outbox (comando durable con cmd_id)
                              │
                       OutboxService (drenaje con backoff)
                              ↓
                        Supabase RPC
                              ↓
                    Realtime → Drift → UI
```

**La UI nunca espera a la red.** Escribe local, muestra el resultado optimista, y el drenaje reconcilia. Es lo que hace que la app funcione igual con y sin señal.

## Outbox

Tabla `outbox(id, cmd_id UNIQUE, type, payload JSON, order_id, created_at, attempts, next_attempt_at, status)`.

- Un comando por transición de estado (T1–T9 de `RIDER_ANDROID_STATE_MACHINE.md`).
- `cmd_id` generado en el dispositivo → el reintento es idempotente en el servidor.
- Drenaje **en orden por pedido** (las transiciones de un mismo pedido no pueden salir desordenadas), en paralelo entre pedidos distintos.
- Backoff: 2s, 5s, 15s, 60s, 5min, luego cada 5min. Sin descarte automático: sólo se descarta si el servidor responde con un rechazo definitivo, y eso se le muestra al rider.
- Se dispara por: cambio de conectividad, arranque de la app, temporizador y acción manual.

## Configuración, flavors y secretos

| Flavor | Backend | applicationId | Detalles |
|---|---|---|---|
| `dev` | Supabase local o staging | `ar.com.taba.rider.dev` | Logs verbosos, banner de entorno |
| `staging` | Supabase staging | `ar.com.taba.rider.staging` | Igual a producción, datos de prueba |
| `prod` | Supabase producción | `ar.com.taba.rider` | Sin logs de PII |

Configuración por `--dart-define-from-file`, no en el código. **Ningún secreto en el repositorio.** La `anon key` de Supabase es pública por diseño: la seguridad la da RLS, no ocultarla. Firmado con keystore en el runner de CI.

## Feature flags

Tabla remota `rider_feature_flags`, cacheada localmente con valores por defecto seguros. Necesarios para el despliegue progresivo: `android_rider_enabled`, `geofence_arriving`, `incident_photo`, `location_interval_override`.

## CI

| Etapa | Acción |
|---|---|
| Análisis | `flutter analyze` con `very_good_analysis`, sin warnings |
| Formato | `dart format --set-exit-if-changed` |
| Tests | `flutter test --coverage`; umbral en `domain/` ≥ 90% |
| Arquitectura | test que verifica las reglas de dependencia entre capas |
| Tokens | regenerar `taba_tokens.dart` desde `TOKENS.json` y fallar si hay diferencias sin commitear |
| Contrato | tests contra Supabase staging (firmas de RPC, códigos de error) |
| Build | APK y AAB de `staging` en cada PR a `main`; `prod` sólo por tag |
| Integración | `integration_test` en emulador Android 13 y 15 |
