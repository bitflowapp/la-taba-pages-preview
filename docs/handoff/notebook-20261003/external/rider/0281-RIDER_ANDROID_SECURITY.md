# TABA Rider Android — Seguridad

## Autenticación

- Supabase Auth con email y contraseña. Sin PIN compartido: el PIN de la demo web **no se traslada**.
- `refresh_token` en **Android Keystore** (`flutter_secure_storage`); `access_token` sólo en memoria.
- Sesión ligada a `device_id` (identificador propio, persistente, no el ANDROID_ID). Al iniciar sesión en otro equipo, la sesión anterior se **revoca** y recibe `session.revoked` por Realtime.
- Cierre de sesión: borra la base local, la cola pendiente **sólo tras confirmar que está vacía**, y los tokens. Si hay comandos pendientes, se avisa y se ofrece esperar.

## Autorización

- **RLS en todas las tablas.** El rider ve pedidos de su `business_id` y sólo los `ready` sin asignar o los suyos.
- **Ningún cambio de estado por escritura directa**: todo pasa por RPC `SECURITY DEFINER` que valida precondición y autoría.
- **El `rider_id` nunca viaja en el cuerpo del RPC**: se toma de `auth.uid()`. Aceptarlo del cliente sería suplantación directa.
- Un rider con turno cerrado no puede tomar pedidos (`RIDER_OFF_SHIFT`).
- Un rider con pedido activo no puede tomar otro en v1 (`RIDER_HAS_ACTIVE_ORDER`).

## Visibilidad limitada de datos

| Dato | Antes de asignar | Con pedido activo | Después de cerrar |
|---|---|---|---|
| Nombre del cliente | No | Sí (nombre para mostrar) | **No** |
| Teléfono | No | **Enmascarado** + llamada por enlace | No |
| Dirección exacta | Aproximada (calle y altura, sin piso ni timbre) | Completa con referencia | No |
| Artículos | Cantidad y total | Detalle completo | No |
| Código de entrega | **Nunca** | **Nunca** | Nunca |
| Otros clientes | Nunca | Nunca | Nunca |

El histórico del rider guarda `order_id`, hora, importe y estado. **Sin PII.**

## Código de entrega

- Se guarda **hasheado** en el servidor. No viaja al dispositivo del rider en ninguna circunstancia.
- Validación exclusivamente en `rpc_confirm_delivery`.
- **Máximo 3 intentos** por pedido; agotados, la única salida es la incidencia, que queda auditada y la revisa el local.
- Cada intento se registra con hora, geoposición y `cmd_id`.
- Sin red, el código se guarda **cifrado** en la cola local y se descarta en cuanto el servidor confirma. Nunca en logs, nunca en telemetría, nunca en el reporte de errores.

## Límites de tasa

| Operación | Límite |
|---|---|
| `signInWithPassword` | 5 por 15 min por email + 20 por hora por IP |
| `rpc_confirm_delivery` | 10 por minuto por rider |
| `rpc_claim_order` | 30 por minuto por rider |
| `rpc_push_locations` | 60 llamadas/hora, 60 puntos por llamada |
| Realtime | 1 canal por rider |

Superarlos devuelve `429` con `retry_after`; la cola respeta ese valor.

## Protección contra cambios inválidos

Cada RPC valida, en este orden: sesión → pertenencia al `business_id` → asignación del pedido → precondición de estado → idempotencia por `cmd_id`. Cualquier fallo devuelve un error tipado **sin filtrar información** sobre pedidos ajenos (un pedido de otro rider devuelve `NOT_FOUND`, no `FORBIDDEN`: no se confirma su existencia).

## Ubicación y privacidad

- Se emite **sólo** entre `picked_up` y `delivered`. Fuera de esa ventana el servicio se detiene y el servidor rechaza los puntos.
- Notificación persistente mientras está activa, con texto explícito sobre qué se comparte y hasta cuándo.
- El rider puede ver en `home` si la ubicación está activa y por qué.
- Retención de puntos: **7 días**; después queda la ruta resumida del pedido.
- Nunca se comparte la posición del rider entre riders.
- El cliente ve la posición **sólo** mientras su pedido está en camino.

## Almacenamiento local

- Base Drift **cifrada** con SQLCipher; clave en Keystore.
- Sin PII en logs ni en el reporte de errores: `sentry_flutter` con `beforeSend` que elimina nombre, teléfono, dirección, código y coordenadas.
- `android:allowBackup="false"` y `android:usesCleartextTraffic="false"`.
- Al cerrar sesión o al recibir `session.revoked`, la base local se destruye.

## Transporte

- TLS obligatorio.
- **Certificate pinning** al dominio de Supabase, con plan de rotación documentado y flag remoto para desactivarlo si una rotación mal coordinada dejara a la flota sin app.
- Sin proxy de depuración habilitado en `prod`; `network_security_config` que sólo confía en anclas del sistema.

## Integridad de la aplicación

- Detección de root/emulador **informativa**, no bloqueante: bloquear dejaría sin trabajar a un rider con un teléfono modificado.
- Detección de ubicación simulada (`isMocked`): el punto se marca `src: "mock"`, se envía igualmente y se **alerta al local**. No se bloquea al rider desde el dispositivo; la decisión es del negocio, con evidencia.
- Ofuscación con R8 en `prod`, mapping subido al reporte de errores.

## Revocación y expiración

| Situación | Efecto |
|---|---|
| El local desvincula al rider | `session.revoked` → cierre de sesión al instante; la app conserva la cola y avisa qué quedó sin enviar |
| Turno cerrado | Deja de recibir ofertas; el pedido activo se mantiene hasta cerrarlo |
| Token expirado sin red | Se sigue trabajando offline; la cola espera; al recuperar red, si el refresco falla, se pide reautenticación **sin perder la cola** |
| Cambio de dispositivo | Sesión anterior invalidada; el pedido activo se recupera del servidor, no del dispositivo viejo |
| Cierre de sesión remoto desde el panel | Igual que revocación |

## Amenazas consideradas

| Amenaza | Mitigación |
|---|---|
| Rider marca entregas que no hizo | Código validado en servidor + geoposición en la auditoría + máximo de intentos |
| Rider ve datos de clientes que no reparte | RLS + proyección del pedido activo + purga al cerrar |
| Teléfono robado con sesión abierta | Keystore + base cifrada + revocación remota desde el panel |
| Falsificación de ubicación | Marcado `mock`, alerta al negocio, evidencia registrada |
| Reintento duplicando entregas | `command_log` con `cmd_id` |
| Fuga de PII por telemetría | Scrubbing obligatorio y test que verifica que un evento con PII no se envía |
| Escalada por token manipulado | El `rider_id` sale de `auth.uid()`, nunca del cuerpo |
