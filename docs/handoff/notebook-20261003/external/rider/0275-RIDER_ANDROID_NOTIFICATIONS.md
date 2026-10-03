# TABA Rider Android — Notificaciones

## Canales

| Canal | Importancia | Sonido | Uso |
|---|---|---|---|
| `orders_new` | **HIGH** | Tono propio, insistente | Pedido nuevo disponible o asignado |
| `orders_updates` | DEFAULT | Por defecto | Cancelación, reasignación |
| `sync` | LOW | Silencioso | Resultado de la sincronización de la cola |
| `location` | LOW, **no descartable** | Silencioso | Notificación persistente del foreground service |

Los canales se crean al primer arranque. El rider puede ajustarlos desde el sistema; la app respeta esa elección y **avisa en `home`** si el canal crítico quedó silenciado — que es el fallo operativo más caro de todos.

## Push

**FCM** vía `firebase_messaging`. El token se registra con `rpc_register_device` y se renueva ante `onTokenRefresh`.

| Evento | Prioridad | Contenido | Al tocar |
|---|---|---|---|
| `order.offered` | `high` | “Nuevo pedido · 2,4 km · $ 42.300” | `taba://orders` |
| `order.assigned_to_you` | `high` | “Te asignaron #A-1042” | `taba://order/A-1042` |
| `order.cancelled` | `high` | “#A-1042 fue cancelado” | `taba://order/A-1042` |
| `session.revoked` | `high` | “Se cerró tu sesión” | `taba://login` |

**El payload nunca contiene PII** — ni nombre, ni dirección, ni teléfono, ni código de entrega. Sólo identificadores y datos agregados. Una notificación se ve en la pantalla bloqueada.

Los deep links los resuelve `go_router`, que valida sesión y estado antes de abrir la ruta.

## Notificación persistente del servicio

Mientras se emite ubicación:

> **TABA Rider · Entrega en curso**
> Compartiendo tu ubicación con el cliente hasta que entregues #A-1042.
> [ Ver pedido ]

No descartable (requisito del foreground service) y **explícita sobre qué se comparte y hasta cuándo**. Se cancela en cuanto el pedido se cierra.

## Sonido de pedido nuevo

- Tono propio, distinto del de mensajería, reconocible con casco puesto.
- Se repite hasta 3 veces con 5 s de separación si no se abre.
- Vibración larga en paralelo.
- Suena **sólo con turno activo**.

## Con la app en primer plano

No se muestra la notificación del sistema: se usa una tarjeta irruptiva dentro de la app con el mismo sonido. Evita la duplicación y permite aceptar sin salir del contexto.

## Pruebas obligatorias

| Escenario | Resultado esperado |
|---|---|
| App cerrada, pedido nuevo | Notificación con sonido en menos de 5 s |
| App en segundo plano | Igual |
| App abierta | Tarjeta interna, sin notificación del sistema |
| Sin permiso de notificaciones | Aviso persistente en `home` |
| Canal silenciado por el usuario | Aviso en `home` |
| No molestar activo | Suena si el rider autorizó el canal; si no, se avisa |
| Modo avión y luego reconexión | La notificación llega al recuperar red |
| Deep link con sesión expirada | Va a `login` y, tras entrar, al pedido |
| Toque en la notificación persistente | Abre el pedido activo, no el inicio |
