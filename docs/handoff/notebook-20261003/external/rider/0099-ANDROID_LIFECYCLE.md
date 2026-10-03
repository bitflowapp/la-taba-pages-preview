# Ciclo de vida Android — Rider

## Estados

Pedido: autoridad remota y `revision`.

```text
ready --claim--> assigned --start_rider_delivery--> on_the_way --> arrived --> delivered
                                  |                         |
                                  +--> picked_up -----------+
```

Servicio nativo:

```text
STOPPED -> ARMING -> ACTIVE -> DEGRADED -> DRAINING -> STOPPING -> STOPPED
                         |          |
                         +----------+--> FAILED
```

`DEGRADED` significa que la captura puede continuar y la cola puede crecer, pero la publicación no está confirmada. No es un estado de pedido.

## Login

1. Flutter presenta email y password.
2. `MethodChannel` llama a Kotlin `signInWithPassword`.
3. Kotlin ejecuta Supabase Auth, guarda la sesión cifrada y consulta `business_members` para el `business_id` del flavor.
4. Sólo una membresía activa con `role = rider` habilita la app rider.
5. Dart recibe user id, rol, business id y expiración; nunca refresh token.
6. Si una sesión guardada existe, Kotlin la valida/refresca antes de mostrar la cola.

No se habilita la captura GPS durante login ni por una sesión anónima.

## Claim

1. Flutter carga la cola y conserva `public_code`, `revision`, `expected_status = ready` y `expected_rider = null`.
2. Kotlin invoca la firma Gate 2 de `claim_available_rider_order`.
3. La respuesta completa reemplaza el snapshot local.
4. `idempotent_no_op = true` se trata como éxito; no se crea una segunda entrega.
5. Un `40001` fuerza refresh y permite volver a intentar sólo con la nueva revisión.

Si el proceso muere durante el claim, al reabrir se consulta la cola y el pedido asignado por RLS. El usuario puede ver que el pedido ya está asignado al mismo rider y continuar.

## Iniciar entrega

1. Flutter verifica permiso de ubicación y que el snapshot tiene UUID interno y `revision`.
2. Kotlin prepara el `ForegroundService` en modo `ARMING` y publica la notificación.
3. Kotlin llama `start_rider_delivery(order_id, expected_revision)`.
4. Con respuesta exitosa, persiste `active_delivery` mínimo y activa captura.
5. El servicio empieza a aceptar fixes; cada publicación lleva la revisión confirmada.
6. Si la RPC falla, el servicio vuelve a `STOPPED` y no captura.

El estado remoto puede quedar `on_the_way` si el proceso muere después de la RPC y antes de activar la captura. La recuperación debe reconocerlo y ofrecer reactivar GPS; no debe hacer una transición inventada para “deshacer” la entrega.

## Pantalla apagada y cambio de app

- Al apagar pantalla, Flutter puede pausarse. El `ForegroundService` sigue recibiendo ubicación y publicando mientras Android mantenga el servicio, los permisos y la política de batería.
- Al cambiar de app, no se detiene el service. La notificación sigue visible.
- `EventChannel` puede desconectarse; los eventos se consideran efímeros. Al reconectar, Dart pide `getServiceSnapshot`, `getActiveDelivery` y un refresh remoto.
- La UI sólo marca `fresh` con `recorded_at`/timestamp de servidor reciente. Una captura local pendiente no es “GPS en vivo”.

## Pérdida de red

1. El servicio conserva captura si hay permiso y espacio en cola.
2. Cada muestra se valida localmente y se cifra antes de persistir.
3. La cola tiene TTL de 3 minutos, porque Gate 2 rechaza `captured_at` más viejo.
4. Al volver `online`, el servicio drena FIFO, respetando 5 s mínimos y el access token actual.
5. `401` dispara refresh bajo mutex y reintenta una vez.
6. `42501` detiene publicación y requiere sesión/membresía válida.
7. `40001` de revisión detiene el drenaje, actualiza el pedido y descarta o reencola sólo si la política aprobada confirma que la muestra sigue siendo válida; nunca se reescribe silenciosamente una muestra vieja.
8. Estado terminal o pérdida de asignación purga la cola de esa entrega.

La cola offline no garantiza publicar todos los puntos ni conservar una ruta histórica. Garantiza que no se pierda innecesariamente un fix reciente y que no se envíe una muestra que el servidor debe rechazar.

## Refresh de sesión

- Sólo `SessionManager` puede refrescar.
- Se usa una exclusión mutua para que UI y service no roten el refresh token simultáneamente.
- Access y refresh nuevos se escriben atómicamente; si falla la escritura, se conserva la pareja anterior o se invalida toda la sesión, nunca una mitad.
- Tras rotación, se emite `session_changed` a Flutter y al service.
- Si el refresh token es inválido/expiró, el service detiene publicación, mantiene una notificación de acción requerida y purga la cola cuando la política de seguridad lo indique.

## Reinicio de proceso

Al iniciar Flutter o el service:

1. Leer `ActiveDeliveryStore`.
2. Validar que contiene order id, revision, rider id y un estado no terminal.
3. Validar/renovar sesión.
4. Obtener snapshot remoto autorizado.
5. Si sigue asignado y operativo, restaurar notificación y captura.
6. Si está terminal, detener y borrar estado local.
7. Si está asignado a otro rider o no es accesible, detener y borrar secretos/cola de esa entrega.

El service usa `START_STICKY` sólo como ayuda. No se considera una garantía de Android ni del fabricante.

## Swipe de recientes

El task Flutter puede desaparecer mientras el `ForegroundService` continúa porque `stopWithTask=false` y no se implementa `onTaskRemoved` como stop. La notificación debe seguir visible. Al volver, Flutter reconcilia por bridge.

Esto no garantiza que un OEM agresivo conserve el service. La app debe mostrar estado degradado y registrar sólo métricas sanitizadas.

## Entrega completada

1. Sólo el flujo de código existente `confirm_order_delivery` puede pasar `arrived` a `delivered`.
2. Al éxito o `already_confirmed`, Kotlin ordena detener captura de inmediato.
3. Se cancelan actualizaciones de ubicación, timer de drenaje, worker y notificación.
4. Se purga la cola y el `ActiveDeliveryStore`.
5. Flutter hace refresh; el trigger backend purga ubicaciones exactas y revoca/limita tokens según el contrato de privacidad.

Si una muestra llega concurrentemente con la confirmación, el servidor decide; el cliente no trata de “ganar” por orden local.

## Logout

Logout normal está bloqueado si existe una entrega activa no terminal, porque el backend observado no tiene RPC de pausa/cancelación de reparto para el rider. La UI ofrece terminar con el flujo aprobado o solicitar intervención.

Si el usuario elige un logout de emergencia aprobado:

- detener service y notificación;
- borrar tokens y cola local;
- cerrar sesión local;
- dejar explícito que el pedido remoto puede seguir `on_the_way` y requiere recuperación manual al volver a iniciar sesión.

No se debe inventar `cancel_rider_delivery` ni cambiar el estado por update directo.

## Forzar detención desde Ajustes

Android termina la app y sus services y puede impedir que se reinicien hasta que el usuario abra explícitamente la app. No hay una API legítima que garantice publicación GPS después de `Force stop`. La app debe documentar esta limitación y recuperar cuando el rider vuelva a abrir e inicie sesión.

## Matriz de garantías Android

| Escenario | Garantía de diseño | No garantizable |
|---|---|---|
| Pantalla apagada | Foreground service + notificación + permiso; intenta capturar/publicar. | OEM, ahorro extremo, permiso revocado o radio GPS ausente. |
| App en segundo plano | Service independiente de Flutter. | Ejecución si el usuario fuerza detención. |
| Swipe de recientes | Service configurado para continuar. | Kill por fabricante o política del sistema. |
| Proceso Flutter muerto | Service puede continuar; bridge se reconecta. | Eventos perdidos mientras no hay listener; se recuperan por snapshot. |
| Proceso service muerto | `START_STICKY`/recovery ayudan. | Reinicio inmediato universal. |
| Reinicio del dispositivo | Receiver puede solicitar restauración si Android lo permite y hay sesión. | Arranque automático garantizado en todas las versiones/OEM. |
| Sin red | Cola cifrada y TTL corto. | Publicación confirmada sin conectividad. |
| Force stop | Se informa y se corta. | Reanudar sin apertura explícita. |

## Qué se prueba físicamente

Moto G15 objetivo: pantalla apagada 30 minutos, cambio de app, swipe de recientes, pérdida de red, refresh de sesión, bloqueo/desbloqueo, entrega terminal, reinicio del proceso, reinicio del equipo y Force stop. Las evidencias no deben incluir coordenadas, tokens, domicilios ni teléfonos.

