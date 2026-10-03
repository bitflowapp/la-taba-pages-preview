# TABA Rider Android — Estrategia offline

## Premisa

**Offline es un estado normal de trabajo, no un error.** Un rider en un sótano, un ascensor o una zona ciega de Neuquén tiene que poder retirar, llegar, pedir el código y entregar. La app no bloquea nunca por falta de red.

## Estado local como fuente de verdad de la interfaz

La UI lee **siempre** de Drift. La red actualiza Drift. Nunca hay un spinner esperando a la red para mostrar un dato que ya se tiene.

| Tabla | Contenido | Retención |
|---|---|---|
| `orders` | Pedido activo + ofertas + historial del día | Activo: hasta cerrarlo. Historial: 7 días, sin PII |
| `order_items` | Artículos del pedido activo | Con el pedido |
| `outbox` | Comandos pendientes | Hasta confirmación o rechazo definitivo |
| `locations` | Puntos sin enviar | Hasta enviar; máximo 2.000 con diezmado |
| `session` | Tokens (cifrados) y perfil | Hasta cerrar sesión |
| `flags` | Feature flags con valores por defecto seguros | 24 h |

Base cifrada con SQLCipher; clave en Keystore.

## Cola durable

```sql
outbox(
  id INTEGER PK,
  cmd_id TEXT UNIQUE,        -- UUID generado en el DISPOSITIVO
  type TEXT,                 -- claim_order | confirm_pickup | start_delivery |
                             -- mark_arriving | confirm_delivery | report_incident |
                             -- release_order | set_availability
  order_id TEXT,
  payload TEXT,              -- JSON; cifrado si contiene el código de entrega
  created_at INTEGER,
  attempts INTEGER DEFAULT 0,
  next_attempt_at INTEGER,
  status TEXT                -- pending | sending | done | rejected
)
```

### Reglas

1. **Se escribe primero en la cola, después se intenta enviar.** Nunca al revés. Una acción confirmada por el rider está persistida antes de que la interfaz cambie.
2. **`cmd_id` se genera en el dispositivo.** Es lo que hace idempotente el reintento en el servidor (`command_log`).
3. **Orden estricto por pedido.** Las transiciones de un mismo pedido salen en secuencia; pedidos distintos van en paralelo.
4. **Nada se descarta solo.** Sólo se descarta con un rechazo definitivo del servidor (`retryable: false`), y **se le muestra al rider** qué pasó.
5. **La cola es visible.** En la pantalla offline se listan las acciones pendientes con su hora: *“✓ Retiro confirmado 14:38 · se envía sola”*. Es lo que hace que la app sea confiable en vez de sospechosa.

### Backoff

`2s → 5s → 15s → 60s → 5min → cada 5min`, con jitter del ±20 % para que una flota entera no golpee el servidor al volver la cobertura de un barrio.

Disparadores del drenaje: cambio de conectividad · arranque · vuelta del segundo plano · temporizador · acción manual (“Sincronizar ahora”).

## Comandos y su comportamiento

| Comando | Sin red | Al drenar, si el servidor rechaza |
|---|---|---|
| `claim_order` | **No se permite offline** — tomar un pedido requiere confirmación de exclusividad | — |
| `confirm_pickup` | Sí, optimista | “Este pedido fue reasignado”; se libera el trabajo |
| `start_delivery` | Sí | Se reconcilia con el estado del servidor |
| `mark_arriving` | Sí | Se ignora si el pedido ya avanzó |
| `confirm_delivery` | Sí, con el código **cifrado** en la cola | `INVALID_CODE` → se revierte a `arriving` y se le pide el código otra vez, explicando qué pasó |
| `report_incident` | Sí | Se reconcilia |
| `release_order` | Sí | Se reconcilia |
| `set_availability` | Sí | Gana el servidor |

`claim_order` es la única excepción a “todo funciona offline”, y por una razón de negocio: dos riders no pueden tomar el mismo pedido. Se muestra explícitamente: *“Necesitás conexión para tomar un pedido”*.

## Entrega offline — el caso más delicado

1. El rider escribe el código. La app **no puede validarlo** (el código nunca está en el dispositivo, por diseño de seguridad).
2. Se encola `confirm_delivery` con el código cifrado.
3. La interfaz muestra **“Entrega registrada · pendiente de confirmar”** — no “Entregado”. Es honesto y no promete lo que no puede garantizar.
4. Al recuperar señal:
   - **código correcto** → “Entrega confirmada” y el pedido se cierra;
   - **código incorrecto** → aviso claro, el pedido vuelve a `arriving`, con los intentos restantes. El rider ya se fue: por eso la app **guarda la geoposición y la hora** de la entrega declarada, y el local decide con esa evidencia.
5. El código cifrado se borra en cuanto el servidor responde.

## Conflictos y reconciliación

| Conflicto | Resolución |
|---|---|
| El local canceló mientras el rider trabajaba offline | Al drenar, los comandos se rechazan; se muestra “Este pedido fue cancelado a las 14:22” y el trabajo se libera |
| El pedido fue reasignado | Igual, con “Fue reasignado a otro rider” |
| Dos comandos del mismo pedido, uno viejo | El orden por pedido lo evita; si aun así llega desordenado, el servidor rechaza por precondición |
| El servidor avanzó el estado por otra vía | `rpc_sync_state` gana; los comandos locales que ya no aplican se descartan **con aviso** |

## Expiración

- Comando con más de **24 h** sin enviar: se marca `expired`, **no** se descarta en silencio. Se muestra en `Perfil → Pendientes` con la explicación y un contacto con el local.
- Puntos de ubicación con más de **2 h**: el servidor los rechaza; se descartan localmente.
- Historial de más de 7 días: se purga.

## Prioridad de drenaje

1. `confirm_delivery` — cierra el pedido y libera al rider.
2. `report_incident` — el local necesita saberlo ya.
3. `confirm_pickup`, `start_delivery`, `mark_arriving` — orden del pedido.
4. `set_availability`.
5. Lotes de ubicación — último: son los más pesados y los menos urgentes.

## Feedback al rider

| Situación | Qué ve |
|---|---|
| Sin conexión | Franja ámbar permanente + cola visible con horas |
| Reconectando | Franja azul “Reconectando · N acciones en cola” |
| Sincronizado tras estar offline | Franja verde “Conexión recuperada · N acciones sincronizadas”, que desaparece a los 5 s |
| Comando rechazado | Tarjeta persistente con el motivo y la acción sugerida |
| Comando expirado | Entrada en `Perfil → Pendientes` |

**Nunca** un spinner bloqueante. **Nunca** “Error de red” sin explicar qué pasó con lo que el rider ya hizo.

## Recuperación tras muerte del proceso

Android puede matar la app en cualquier momento. Al reabrir:

1. Se lee el pedido activo desde Drift.
2. `go_router` restaura la ruta correspondiente al estado (no vuelve al inicio).
3. Se reanuda el foreground service si el estado lo requiere.
4. Se drena la cola.
5. Se llama a `rpc_sync_state` y se reconcilia.
6. Se muestra la pantalla `recovered`: **qué se recuperó, qué ya está registrado y qué falta**.

Ver `screenshots/rider-recovered-390x844.png`.
