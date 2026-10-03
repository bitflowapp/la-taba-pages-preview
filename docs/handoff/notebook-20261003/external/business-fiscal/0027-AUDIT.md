# Auditoría de recepción de pedidos — panel Negocio

Fecha: 2026-08-02  
Repo fuente: `C:\1212\la-taba-real-orders-staging`  
Worktree auditado: `C:\1212\la-taba-business-intake-hardening`  
Base exacta: `c6270589756214eac617515248e93a8e8819190b`  
Rama: `fix/business-order-intake-reliability`  
Supabase staging autorizado: `ukxqbgswjlibmnjemrzd`

## Alcance y aislamiento

- El worktree nuevo se creó directamente desde la base exacta solicitada.
- El worktree `C:\1212\la-taba-real-orders-staging` se inspeccionó sólo en modo lectura. Sus cambios Gate 2 sin commit permanecen allí y no fueron copiados, restaurados ni modificados.
- No se tocó Rider Android, rediseño rojo, `main` ni producción.
- No se ejecutaron `push`, `merge`, `deploy`, `reset`, `restore`, `stash` ni `clean`.
- No se creó ni aplicó ninguna migración y no se ejecutó `db push`.
- El relay demo no se usó como autoridad. Los cambios productivos usan PostgREST/Auth/Realtime oficial y PostgreSQL como autoridad.

## Arquitectura encontrada antes de la corrección

La recepción productiva estaba distribuida entre `js/production-operations.js` y `js/repositories/supabase_order_repository.js`:

1. `startSync()` abría un canal Realtime y, por separado, disparaba `refresh()`.
2. `createRealtimeWatch()` detenía el polling de respaldo apenas el canal informaba `SUBSCRIBED`.
3. Cada evento Realtime disparaba una nueva consulta completa, pero las consultas no se serializaban.
4. `fetchOrders()` reemplazaba toda la lista mediante `mirrorOrders(..., { replace: true })` sin comparar `order_id + revision`.
5. `listOrders()` convertía cualquier error de consulta en `[]`, perdiendo la diferencia entre “bandeja realmente vacía” y “lectura fallida”.
6. El panel productivo no tenía estado operativo propio, última sincronización, recuperación de lifecycle ni coordinación entre pestañas.
7. El snapshot general consultaba los 100 pedidos más recientes por `created_at`, mezclaba terminales y activos, y podía omitir un pedido activo antiguo.
8. `orders.revision` y `order_events.sequence` ya existían en la base Gate 1, pero la bandeja no utilizaba la revisión al aplicar snapshots y no cargaba eventos para reproducirlos por secuencia.

## Ventanas de pérdida, duplicación o datos incompletos encontradas

| ID | Ventana anterior | Consecuencia posible | Severidad | Corrección |
|---|---|---|---|---|
| A-01 | Entre la consulta inicial y la confirmación efectiva de la suscripción no había una segunda consulta obligatoria. | Un pedido insertado en esa ventana podía no generar evento para esa pestaña y quedar invisible indefinidamente mientras Realtime aparentaba salud. | Crítica | Secuencia fija: snapshot → suscripción → snapshot al recibir `SUBSCRIBED`. |
| A-02 | Polling detenido al recibir `SUBSCRIBED`. | Un WebSocket silencioso, evento descartado o filtro defectuoso dejaba la bandeja congelada. | Crítica | Polling autoritativo continúa siempre; Realtime sólo invalida y acelera. |
| A-03 | Varias consultas podían terminar fuera de orden y todas reemplazaban el estado. | Un resultado viejo podía pisar un estado nuevo y retroceder `accepted/preparing/ready`. | Crítica | Consultas serializadas/coalescidas, watermarks por `order_id + revision` y descarte de revisiones viejas. |
| A-04 | `mirrorOrders(... replace: true)` no protegía revisiones. | Tarjetas duplicadas, regresión visual o restauración de un pedido que ya salió de la bandeja. | Alta | Reconciliación única, deduplicación por UUID de pedido, tombstone en memoria y orden determinista. |
| A-05 | `listOrders()` devolvía `[]` ante error. | Un consumidor podía confundir una falla de Auth/red con bandeja vacía. | Alta | `fetchBusinessOrderSnapshot()` devuelve `{ok, code, message}` y nunca muta estado si falla. |
| A-06 | Realtime podía entregar una fila parcial; el contrato no declaraba explícitamente que sólo era invalidación. | Riesgo de completar defaults y mostrar PII, ítems o importes incompletos si se reutilizaba el payload. | Alta | El payload Realtime se reduce a `orderId/revision` y nunca se aplica; siempre se reconsulta el snapshot con relaciones completas. |
| A-07 | No había recuperación en `online`, `pageshow` ni vuelta a foreground para Negocio. | Una pestaña suspendida o un corte de red podía quedar desactualizado hasta otro evento casual. | Alta | Reconsulta explícita en `online`, `pageshow` y `visibilitychange` visible. |
| A-08 | No había coordinación productiva entre pestañas. | Cada pestaña podía mantener una vista distinta; una futura alerta por pestaña se repetiría. | Alta | `BroadcastChannel` + invalidación por storage; cada pestaña conserva su propio snapshot; alertas reclamadas con Web Locks y registro compartido acotado. |
| A-09 | Los 100 pedidos más recientes incluían terminales y se ordenaban sólo por creación. | Un activo antiguo podía quedar fuera; terminales permanecían en la bandeja. | Alta | Consulta exclusiva de estados activos, límite fail-closed de 500+1 y remoción al faltar del snapshot activo. |
| A-10 | No existía un indicador de salud propio del intake. | La UI no distinguía cargando, offline, error o snapshot reciente. | Media | Estados: Conectado, Recuperando pedidos, Sin conexión, Error recuperable y Última sincronización. |
| A-11 | Las transiciones del frontend usaban CAS por estado, no la RPC Gate 1 por revisión. | Dos actores sobre la misma revisión podían tomar decisiones incompatibles aunque el estado aparente coincidiera. | Alta | `transition_order(order_id, expected_revision, new_status)` y refetch completo posterior. |
| A-12 | La historia visible se sintetizaba desde timestamps. | Eventos con el mismo `created_at` podían reproducirse en orden ambiguo. | Media | Snapshot Negocio incluye `order_events`; los cambios se ordenan por `sequence`, nunca por timestamp solamente. |
| A-13 | Errores dentro de tareas Realtime se absorbían sin superficie operativa. | Fallas recuperables quedaban silenciosas. | Media | El coordinador conserva la bandeja, publica error recuperable y registra una nueva consulta. |

## Auth, membership y aislamiento por comercio

- `createSupabaseAuthService.getMembership()` filtra simultáneamente por `business_id`, `user_id` e `is_active = true`.
- Sólo `owner`, `admin` y `staff` habilitan Negocio; `rider` queda fuera.
- El snapshot y la suscripción Realtime repiten el filtro exacto `business_id=eq.<runtime businessId>`.
- Un token vencido o una membership incorrecta no inicializan una bandeja autorizada.
- Un cambio de Auth detiene el coordinador anterior. Una activación obsoleta por carrera de Auth también desmonta su coordinador.
- Producción no persiste PII de pedidos en localStorage. BroadcastChannel comparte sólo invalidaciones sin PII.

## Revisión y secuencia

- `orders.revision` es la versión monótona de la proyección del pedido y manda sobre timestamps.
- Cada identidad se compara por UUID backend (`backendId/order_id`) + `revision`.
- Una revisión menor se ignora aunque tenga un timestamp posterior.
- Una revisión igual se deduplica.
- La ausencia de un pedido del snapshot activo lo retira de la bandeja; el watermark evita que reaparezca con la misma revisión.
- `order_events.sequence` se usa para reconstruir la historia cuando los eventos están presentes. `created_at` sólo aporta la hora visual.

## Orden determinista de la bandeja

Orden aplicado:

1. prioridad operativa de estado (`submitted`, `accepted`, `preparing`, `ready`, `assigned`, `picked_up`, `on_the_way`, `arrived`);
2. FIFO por `createdAt` dentro del mismo estado;
3. UUID backend como desempate estable.

La revisión no se compara entre pedidos diferentes porque es monotónica por fila, no una secuencia global. Sí decide todas las sustituciones de una misma orden.

## Notificaciones y pestañas

- El primer snapshot establece baseline y no genera una tormenta de alertas históricas.
- Un pedido nuevo posterior al baseline intenta una única alerta visual.
- La reclamación se serializa con Web Locks y se registra en localStorage por siete días, con máximo de 500 identidades.
- No existe líder permanente: todas las pestañas consultan PostgreSQL y cualquiera sobrevive al cierre de otra.
- La pestaña nueva siempre ejecuta snapshot propio; BroadcastChannel nunca reemplaza ese bootstrap.

## Estado operativo honesto

- **Conectado** sólo se muestra después de una consulta PostgreSQL exitosa y con `lastSuccessfulSyncAt`.
- **Recuperando pedidos** se muestra durante bootstrap o reconsulta.
- **Sin conexión** se muestra cuando el navegador informa offline.
- **Error recuperable** conserva la última bandeja confirmada y muestra el motivo saneado.
- **Última sincronización** nunca se inventa; antes del primer éxito dice que todavía no hubo sincronización exitosa.
- Una falla Realtime no vacía la lista.

## Riesgos residuales observados

1. La bandeja falla cerrada si supera 500 pedidos activos. Es preferible a truncar silenciosamente, pero requiere paginación/operación excepcional si ese volumen se vuelve real.
2. La garantía empieza cuando PostgreSQL aceptó el pedido válido. Un cliente totalmente offline no puede crear un pedido nuevo hasta recuperar conectividad; la idempotencia conserva el intento de confirmación.
3. Las alertas son visuales en la app; no se agregó push notification ni service worker de push.
4. El smoke real quedó demostrado con cuenta QA Auth autorizada. La rotación administrativa permanece separada del frontend y el smoke no modifica pedidos preexistentes.

## Archivos de implementación auditados/modificados

- `js/core/business-order-intake.js`
- `js/repositories/supabase_order_repository.js`
- `js/production-operations.js`
- `js/app.js`
- `styles/business.css`
- `tests/business-order-intake.test.mjs`
- `tests/supabase-auth.test.mjs`
- `tests/supabase-repository.test.mjs`
- `tests/e2e/business-intake-reliability.spec.mjs`
- `tests/fixtures/business-intake-harness.html`
- `scripts/run-business-intake-staging-smoke.mjs`
- `playwright.staging.config.mjs`
- `tests/business-intake-staging-smoke-script.test.mjs`
- `tests/staging/business-intake-staging.spec.mjs`
