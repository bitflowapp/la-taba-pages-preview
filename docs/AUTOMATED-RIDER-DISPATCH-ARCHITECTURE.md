# TABA2: arquitectura de turnos y auto-dispatch de Riders

Estado del documento: contrato de implementacion local. No habilita produccion ni staging.

Base web auditada: `eda13f833bfc54f52a838ac1f76459b7ae276a5b` (`release/taba2-pilot-rc2-operational`).

Base Rider auditada: `471f79ef9a9f47ebb9018f5962b0d6538319ccde` (`feature/rider-pilot-readiness-ux`).

## 1. Hechos de partida

- `orders.status = 'ready'` ya significa que el negocio confirmo que el pedido esta fisicamente listo. Auto-dispatch no cambia ni anticipa ese estado.
- El claim Rider vigente usa `FOR UPDATE`, revision CAS e idempotencia, pero todos los Riders activos ven la misma cola y eligen manualmente.
- No existen turnos, presencia pre-claim, capacidad, ranking, offer leases, rewards ni metricas de dispatch.
- El tracking publico y el payload Rider posterior al claim ya tienen contratos de privacidad y recuperacion que deben preservarse.
- `change_order_status(uuid,text,text)` conserva un grant legado a `authenticated` y permite que un Rider salte de `ready` a `on_the_way` autoasignandose. `transition_order(uuid,bigint,text)` tambien sigue ejecutable y delega en ese helper; revocar solo el primero no cierra el bypass. La implementacion debe revocar ambas firmas directas para `authenticated`; el Panel ya usa el wrapper idempotente de cuatro argumentos.
- Rider Android publica GPS solo durante una entrega. Un turno activo necesita su propio heartbeat de baja cadencia; al morir la app, el heartbeat queda stale y el Rider deja de ser elegible.
- El piloto Rider actual soporta una entrega activa. El esquema conserva `max_concurrent_orders`, pero el perfil operativo se limita a 1 hasta que la UI pueda representar multiples entregas.

## 2. Limites de dominio

El estado del pedido no incorpora `searching`, `offered` ni `no_rider`. Esos estados pertenecen a `dispatch_jobs` y `dispatch_offers`.

```text
orders                  verdad comercial y de entrega
rider_shifts            verdad de turno y disponibilidad
rider_dispatch_presence heartbeat/GPS privado pre-claim
dispatch_jobs           trabajo exactly-once por pedido
dispatch_offers         lease temporal para un solo Rider
dispatch_evaluations    ranking y exclusiones auditables
rider_reward_ledger     importes congelados y asientos inmutables
dispatch_events         observabilidad y explicacion causal
```

No se usa LLM ni aleatoriedad en runtime. La hora autoritativa es siempre la del servidor.

## 3. Maquina de estado del turno

```text
scheduled --start--> active --pause--> paused --resume--> active
    |                    |                 |
    +-------end----------+-------end-------+--> ended
```

Reglas:

- `scheduled`: tiene `starts_at`/`ends_at`; no recibe ofertas.
- `active`: requiere membresia Rider activa, sesion valida y heartbeat fresco para ser elegible.
- `paused`: revoca la oferta pendiente del Rider y no recibe nuevas; una entrega aceptada continua.
- `ended`: terminal. Revoca ofertas pendientes, pero no desasigna ni detiene entregas aceptadas.
- Solo puede existir un turno `active|paused` por Rider y negocio.
- `availability` es `available`, `unavailable` o `at_capacity`; nunca reemplaza `status`.
- `current_active_orders` se reconcilia desde pedidos asignados no terminales dentro de la misma transaccion que cambia asignacion/estado.
- Duracion trabajada y pausada se acumula por segmentos usando `state_changed_at` del servidor. Las horas programadas no se pagan ni se cuentan como trabajadas.

Ownership:

- Rider: work-now, iniciar un turno propio programado, pausar, reanudar, finalizar y heartbeat.
- Owner/admin: programar turnos, objetivos, zona, capacidad (limitada a 1 en piloto) y bloqueo operativo.
- Sistema: marcar stale/at-capacity y revocar ofertas incompatibles.

## 4. Maquina de estado del dispatch job

```text
queued -> ranking -> offering -> claimed -> completed
   ^         |           |          |
   |         |           |          +--> cancelled (solo si el pedido se cancela)
   |         |           +--> queued (reject/expiry/revoke)
   |         +--> no_rider_available --retry ante nueva presencia--> queued
   +---------------- manual_override -------------------------------> claimed

cualquier estado no terminal --pedido deja de ser elegible--> cancelled
```

Reglas:

- El unico disparador automatico es la transicion real a `orders.status = 'ready'`, `delivery_mode = 'delivery'` y origen permitido.
- `dispatch_jobs.order_id` es unico. Realtime, poll, webhook, refresh y retry convergen en la misma fila.
- El trigger solo encola; nunca marca el pedido `ready`.
- El worker toma jobs con `FOR UPDATE SKIP LOCKED` y advisory lock por job.
- Un job conserva una sola oferta `offered` a la vez.
- `no_rider_available` es explicito y tiene `last_failure_code`, evidencia agregada y `next_attempt_at`.
- El override manual modifica el mismo job, revoca leases y registra motivo/actor; no crea un segundo job.
- Pedido entregado cierra job y recompensa. Pedido cancelado invalida oferta/job. Un cambio incompatible mientras hay oferta la revoca.
- Un kill switch por negocio nace apagado y limitado a fixtures QA. Deshabilitarlo corta nuevas ofertas sin borrar jobs ni auditoria; habilitar produccion requiere una decision operativa posterior y explicita.

## 5. Maquina de estado del offer lease

```text
offered --accept valido--> accepted
   |  \
   |   +--reject--> rejected
   +------TTL--> expired
   +--turno/orden incompatible--> revoked
```

Reglas:

- TTL por defecto: 25 segundos, configurable entre limites operativos; se valida localmente antes de staging.
- `lease_expires_at` y `server_now` salen del backend. El countdown del movil es solo presentacion.
- Indices parciales garantizan una oferta vigente por job y una por Rider.
- Un Rider se evalua/ofrece como maximo una vez por ronda automatica. No hay bucles infinitos.
- Aceptar bloquea en orden: offer, job y order; vuelve a validar version, TTL, asignacion, turno, heartbeat, zona y capacidad.
- Dos aceptaciones concurrentes producen un ganador y un receipt estructurado para el perdedor. Nunca se clasifica la carrera por texto de error.
- Antes del claim la oferta no contiene nombre, telefono, direccion exacta, referencia, notas ni coordenadas de puerta. Despues del claim se reutiliza el payload Rider certificado.

## 6. Invariantes

1. Un pedido tiene como maximo un `dispatch_job`.
2. Un job tiene como maximo una oferta `offered`.
3. Un Rider tiene como maximo una oferta `offered`.
4. Un pedido tiene como maximo un `assigned_rider_user_id`.
5. Una oferta aceptada corresponde al Rider autenticado y a un lease vigente.
6. Ninguna oferta nueva se crea fuera de turno `active`, con heartbeat/GPS stale, bloqueo, zona incompatible o capacidad llena.
7. Pausar/finalizar turno nunca modifica una entrega ya aceptada.
8. Ningun camino Rider directo puede mutar `orders` sin RPC con CAS/idempotencia.
9. `estimated`, `earned`, `bonus` y `adjustment` son asientos separados; una entrega crea como maximo un `earned`.
10. Un cambio de formula no modifica snapshots ni asientos historicos.
11. Un job no queda bloqueado por una oferta expirada: el sweep la expira y avanza.
12. Las decisiones son reproducibles con datos, politica y `evaluated_at` guardados.

## 7. Elegibilidad

Para cada Rider del negocio se guarda una evaluacion, incluso si queda excluido. Un candidato es elegible solo si todas son verdaderas:

- membresia `rider` activa y sesion demostrada por un heartbeat autenticado;
- perfil no bloqueado;
- turno `active` y `availability = 'available'`;
- heartbeat dentro de `heartbeat_ttl_seconds`;
- GPS privado dentro de `gps_ttl_seconds`, no mock, precision dentro del limite;
- zona del turno `*` o igual a la zona de dispatch del pedido;
- `current_active_orders < max_concurrent_orders`;
- sin otra oferta vigente;
- no fue ofrecido en la ronda actual;
- pickup y destino tienen snapshots de ubicacion autorizados.

Codigos de exclusion: `NO_ACTIVE_SHIFT`, `PAUSED_OR_ENDED`, `MEMBERSHIP_INACTIVE`, `RIDER_BLOCKED`, `HEARTBEAT_STALE`, `GPS_STALE`, `GPS_INACCURATE`, `ZONE_MISMATCH`, `AT_CAPACITY`, `OFFER_ALREADY_PENDING`, `ALREADY_OFFERED`, `PICKUP_LOCATION_UNAVAILABLE`, `DESTINATION_LOCATION_UNAVAILABLE`.

## 8. Ranking y fairness

Se maximiza un score entero; no se usa distancia sola:

```text
score = 100000
      - min(distance_to_pickup_m, 20000) / 50             # 0..400
      - round(250 * active_orders / max_concurrent_orders) # 0..250
      + min(idle_since_assignment_s, 10800) / 40           # 0..270
      - 60 * assignments_last_4h                           # carga reciente
      - min(heartbeat_age_s, heartbeat_ttl_s)              # salud
      - min(gps_age_s, gps_ttl_s)                           # salud GPS
```

Orden estable:

1. score descendente;
2. `last_assigned_at` ascendente, NULL primero;
3. `rider_user_id` ascendente.

Cada evaluacion persiste distancia, carga, tiempo idle, asignaciones 4h, edades heartbeat/GPS, pesos/version de politica, score, rank y exclusiones. Asi el Panel puede responder por que X fue antes que Y sin revelar coordenadas.

Fairness se vigila con distribucion por Rider, maximo tiempo sin asignacion, coeficiente de Jain y starvation. La formula reduce cercania, carga y recencia; no promete reparto igual si zonas/capacidad/turnos difieren.

## 9. Recompensas

- Politica versionada por negocio con defaults TEST neutrales: todos los importes en cero; no se inventan montos reales.
- Componentes: base, distancia, franja/turno, demanda y objetivo.
- La oferta guarda `estimated_reward` y el snapshot de componentes/version.
- Al aceptar se agrega un asiento `estimated` y se vincula el turno.
- Al entregar se agrega exactly-once un asiento `earned` usando el snapshot aceptado.
- Bonus de objetivo y ajustes son asientos separados. Ajustes requieren owner/admin, motivo e idempotency key.
- Tabla append-only: update/delete siempre rechazados.

## 10. Concurrencia e idempotencia

- Creacion de job: unique `order_id` + `INSERT ... ON CONFLICT DO NOTHING`.
- Worker: advisory lock por job (`pg_try_advisory_xact_lock`, equivalente a SKIP LOCKED), indices parciales.
- Accept: locks offer -> job -> order; version CAS y TTL del servidor.

Orden de locks (unico y obligatorio):

```text
advisory por job  ->  dispatch_offers  ->  dispatch_jobs  ->  orders  ->  rider_shifts
```

Todo camino que toque un job, su lease o su asignacion —accept, reject,
override manual, worker, sweep de expiracion y revocacion por turno— toma
primero el advisory lock del job y recien despues locks de fila. La medicion lo
exigio: con accept recorriendo offer -> job y el override manual job -> offer,
la carrera real entre ambos producia `deadlock detected`. Los invariantes se
sostenian porque PostgreSQL aborta un lado, pero el orden divergente era un
defecto y esta corregido.

Riesgo residual conocido: una mutacion externa del pedido (por ejemplo una
cancelacion del Panel) sostiene la fila de `orders` y despierta el trigger de
ciclo de vida, mientras un accept sostiene la oferta y va hacia el pedido. Ese
cruce todavia puede trabar; PostgreSQL lo detecta, revierte un lado y ningun
invariante se rompe. Cerrarlo del todo requiere que cada RPC de estado de
pedido tome el advisory del job primero, y eso excede esta rama.
- Comandos Rider/Panel: receipt por `(actor, operation, idempotency_key)` con fingerprint. Repetir mismo payload devuelve el receipt; reutilizar la clave con otro payload falla.
- Rewards: claves/indices unicos por pedido, Rider y tipo.
- Revision de `orders` sigue siendo el CAS de entrega. La revision del offer es independiente.
- El scheduler puede repetir un ciclo completo sin crear job, oferta incompatible, claim o reward duplicados.
- La migracion no activa auto-dispatch: `auto_dispatch_enabled = false` y `qa_fixture_only = true` son el rollback inmediato y el limite inicial de rollout.

## 11. Matriz de fallos

| Falla | Respuesta autoritativa |
| --- | --- |
| Rider pierde internet/app muere | deja de latir, queda stale; lease expira; turno persiste; entrega aceptada persiste |
| Reconnect | snapshot agregado recupera turno/oferta/entrega; mismo operation id reconcilia accept incierto |
| Dos Riders aceptan | locks + job/order CAS: uno `accepted`, otro `offer_not_available`/`order_taken` |
| Oferta expira | sweep marca `expired` y ofrece al siguiente |
| Rechazo | receipt + `rejected`; siguiente candidato inmediato |
| Todos rechazan/expiran | `no_rider_available`, alerta deduplicada y fallback manual |
| Ningun Rider | motivo `NO_ACTIVE_RIDERS`; retry al iniciar/latir un turno |
| Heartbeat/GPS stale | excluido; oferta pendiente puede revocarse o expirar; no se asigna |
| Rider pausa/finaliza | revoca oferta; una entrega aceptada continua |
| Negocio cancela/cambia pedido | trigger cancela/revoca dispatch no reclamado; entrega reclamada sigue reglas de pedido |
| Retry/webhook/realtime/poll duplicado | convergen por unique job y receipts |
| Clock skew | decisiones por reloj DB; movil usa `server_now` para mostrar countdown |
| Worker/scheduler cae | backlog/oldest age + heartbeat generan alerta; jobs siguen durables |
| Reward retry | unique ledger key; cero duplicados |
| Override durante offer | lock job/order, revoca lease y registra actor/motivo antes de asignar |

## 12. Contratos

Rider:

- `get_rider_operational_state()` -> `server_now`, turno, oferta segura, entrega activa y actividad.
- `rider_work_now`, `rider_start_shift`, `rider_pause_shift`, `rider_resume_shift`, `rider_end_shift`.
- `rider_shift_heartbeat` con GPS validado y hora capturada.
- `accept_rider_dispatch_offer` y `reject_rider_dispatch_offer` con offer/version/idempotency key.
- Los IDs de Rider/negocio, score, TTL y recompensa se infieren o leen en servidor; el movil no los decide.

Panel:

- `get_business_dispatch_control(business_id)` -> Riders ahora, jobs/timeline, bloqueos, metricas y alertas sin GPS.
- `schedule_rider_shift`, `configure_rider_dispatch_profile` y `manual_override_dispatch` con permisos y auditoria.

Worker:

- `run_rider_dispatch_cycle(limit)` expira leases, procesa jobs y deja heartbeat/metricas. Solo owner de funcion/service role/scheduler.

## 13. Observabilidad y alertas

Metricas: ready->job, job->first-offer, offer->accept, ofertas/pedido, timeout/rejection rate, no-rider, backlog/oldest, activos/stale, distribucion por Rider, Jain y starvation. Eventos y timestamps son del servidor.

Alertas deduplicadas: `DISPATCH_WORKER_STALE`, `DISPATCH_JOB_STALLED`, `NO_ELIGIBLE_RIDER`, `OFFER_TIMEOUT_BURST`, `DISPATCH_INVARIANT_BREACH`, `RIDER_HEARTBEAT_STALE`. La evidencia no contiene PII ni GPS. Se auto-resuelven cuando desaparece la condicion.

## 14. Integracion y ownership de archivos

No tocar en esta rama: `js/map/**`, `js/tracking/customer_tracking_poll.js`, `js/delivery.js`, `styles/tracking.css`, `js/ui.js`, `index.html`, bloques tracking de `styles/responsive.css` ni tests de tracking/map.

El agente de tracking modifica actualmente `js/map/map_view.js`, `js/map/maplibre_tracking_map.js`, `js/ui.js`, `scripts/taba2-tracking-screenshots.mjs`, `styles/responsive.css`, `styles/tracking.css` y tests de tracking. El Panel se integra solo desde `js/business/**`, un repositorio dispatch dedicado, `js/production-operations.js` y estilos scoped en `styles/business.css`.

En Rider se puede tocar la composicion `rider_home_page.dart` por dependencia estricta, pero no `rider_map.dart`, `map_style.dart`, markers ni overlays. Prioridad visual: entrega aceptada > oferta > turno activo > turno inactivo.

## 15. Gates antes de staging

- tests de funciones/migrations y DB local descartable;
- carrera PostgreSQL real con dos sesiones y barrera (A, B +20 ms);
- state machines, idempotencia, expiry/reject/cancel/reconnect/end-shift;
- ledger exactly-once e inmutabilidad;
- simulador determinista 1/2/5/10 Riders, bursts, stale, rechazo, capacidad y reconnect, con hash repetible;
- Flutter/Kotlin unit/widget tests y contrato pre-claim sin PII;
- Panel tests y gates existentes sin bajar ninguno;
- lock staging libre, fixtures propios, rollback y cero datos humanos.

Hasta que esos gates esten verdes no corresponde declarar `TABA2_AUTOMATED_RIDER_DISPATCH_READY_FOR_STAGING`.
