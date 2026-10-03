# TABA Rider Android — Observabilidad

## Principio

Se instrumenta para responder tres preguntas: **¿se perdió alguna acción?**, **¿la batería aguanta el turno?**, **¿dónde se traba el flujo?**. Nada más. Ningún evento contiene PII.

## Errores y crashes

`sentry_flutter` con:

- `beforeSend` que **elimina** nombre, teléfono, dirección, coordenadas y código de entrega de cualquier evento. Existe un test que verifica que un evento con PII no se envía.
- Breadcrumbs: transiciones de estado, resultados de la cola, cambios de conectividad, ciclo de vida del servicio de ubicación.
- Contexto: flavor, versión, `device_id` opaco, API de Android, modelo, nivel de batería, estado de red.
- Release health por versión (sesiones sin fallos).
- Mapping de R8 subido en el build de `prod`.

## Eventos de producto

| Evento | Propiedades | Para qué |
|---|---|---|
| `shift_started` / `shift_ended` | duración, entregas, km | Uso real |
| `order_claimed` | latencia desde la oferta | ¿El rider ve el pedido a tiempo? |
| `transition` | `from`, `to`, `offline`, latencia | Salud de la máquina de estados |
| `delivery_code_attempt` | `success`, `attempt_no`, `offline` | Tasa de fallo del código |
| `incident_reported` | `type` | Motivos reales de fallo |
| `outbox_enqueued` / `_drained` / `_rejected` | `type`, intentos, tiempo en cola, `error_code` | **Acciones perdidas: objetivo 0** |
| `location_service_started` / `_stopped` / `_killed_by_system` | duración, puntos, descartes | Fiabilidad del servicio |
| `battery_sample` | nivel, hora del turno, ubicación activa | Consumo por hora |
| `permission_result` | permiso, resultado | Dónde se pierde la concesión |
| `process_death_recovered` | estado recuperado, comandos pendientes | Robustez |

## Métricas y alertas

| Métrica | Objetivo | Alerta |
|---|---|---|
| Comandos rechazados definitivamente | < 0,5 % | > 2 % en 1 h |
| Tiempo medio en la cola | < 10 s | p95 > 5 min |
| Comandos expirados a las 24 h | 0 | ≥ 1 |
| Servicio de ubicación detenido por el sistema | < 2 % de las entregas | > 5 % |
| Batería por hora con ubicación activa | < 8 % | > 12 % |
| Fallo de código de entrega | < 2 % | > 5 % |
| Sesiones sin fallos | > 99,5 % | < 99 % |
| Arranque en frío (p95) | < 2,5 s | > 4 s |

## Registro local

Anillo de 500 líneas en el dispositivo, con rotación y **sin PII**, exportable desde `Perfil → Soporte` como archivo que el rider comparte al reportar un problema. Permite diagnosticar un caso puntual sin telemetría invasiva.

## Trazabilidad de extremo a extremo

`cmd_id` viaja del dispositivo al servidor y queda en `command_log` y en `order_events`. Un problema reportado por el local se sigue hasta el dispositivo, el estado de red y la hora exacta. Es la herramienta central para resolver disputas del tipo “yo lo entregué / no llegó”.

## Privacidad de la telemetría

- Sin identificadores publicitarios.
- `device_id` propio y opaco, no reversible a la persona desde la telemetría.
- Datos agregados de ubicación (cantidad de puntos, descartes), **nunca coordenadas**.
- El rider puede desactivar la telemetría de producto desde `Perfil`. El reporte de fallos permanece porque es necesario para la seguridad del servicio, y eso se dice explícitamente.
