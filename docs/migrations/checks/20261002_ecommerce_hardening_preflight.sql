-- Verificación previa de las migraciones 20261002010000 .. 20261002062000 (endurecimiento del e-commerce,
-- segunda tanda: entregas y alertas, pagos, idempotencia, autorización y sondas del proveedor).
--
-- SÓLO LECTURA: no cambia nada. Se corre en cada entorno ANTES de aplicar esas migraciones y otra vez
-- DESPUÉS, y se guardan las dos salidas, igual que 20261001_ecommerce_hardening_preflight.sql (que cubre
-- 20261001180000 .. 20261002030000 y se corre también). No usa ninguna tabla, columna ni función nueva:
-- corre igual en los dos momentos.
--
-- Ninguna de estas migraciones borra ni reescribe filas existentes. Cambian reglas; las consultas dicen a
-- QUIÉN le cambia algo en el momento de aplicar. Una consulta sin filas es el resultado esperado, salvo
-- donde dice INFORMATIVA.
--
--   node scripts/release/run-readonly-checks.mjs --target staging|controlled-production \
--     --file docs/migrations/checks/20261002_ecommerce_hardening_preflight.sql --out <privado>/preflight-2.json
--
-- Cada consulta es una sola sentencia y devuelve una columna `finding` con su nombre.

-- ── H · Entregas y alertas (20261002010000, 20261002011000) ───────────────────

-- H1. INFORMATIVA. Pedidos en viaje: los que la gerencia va a poder cerrar sin el código del cliente.
select 'in_flight_delivery_orders' as finding, o.business_id, b.slug, o.status, count(*) as orders,
       min(o.updated_at) as oldest_update
  from public.orders o
  join public.businesses b on b.id = o.business_id
 where o.status in ('picked_up', 'on_the_way', 'arrived')
 group by o.business_id, b.slug, o.status
 order by b.slug, o.status;

-- H2. Tareas programadas apagadas: con 20261002011000 cada una abre una alerta CRÍTICA en cada comercio
--     (SCHEDULER_JOB_DISABLED) la próxima vez que se reconcilien sus alertas.
select 'scheduler_jobs_inactive' as finding, j.jobname, j.schedule
  from cron.job j
 where not j.active
 order by j.jobname;

-- H3. INFORMATIVA. Cobros con disputa o contracargo: abren PAYMENT_NEEDS_REVIEW.
select 'payments_in_dispute' as finding, pi.business_id, pi.provider_status, count(*) as intents,
       min(pi.provider_event_at) as oldest
  from public.payment_intents pi
 where pi.provider_status in ('in_mediation', 'charged_back')
 group by pi.business_id, pi.provider_status;

-- ── I · Pagos (20261002020000 .. 20261002023000) ──────────────────────────────

-- I1. Cobros sin pedido que retienen stock con el dinero ya devuelto: 20261002021000 los libera recién con
--     el próximo aviso de ese pago (o soporte con release_manual_review_checkout_inventory).
select 'paid_checkout_money_returned_still_holding_stock' as finding, cs.id as checkout_session_id, cs.business_id,
       cs.status, cs.manual_review_reason, pi.id as payment_intent_id, pi.internal_status, pi.provider_status,
       pi.refunded_amount, coalesce(pi.paid_amount, pi.expected_amount) as amount, count(r.id) as active_reservations
  from public.checkout_sessions cs
  join public.payment_intents pi on pi.checkout_session_id = cs.id
  join public.inventory_reservations r on r.checkout_session_id = cs.id and r.status = 'active'
 where cs.status in ('manual_review_required', 'payment_approved', 'finalizing_order')
   and cs.completed_order_id is null
   and pi.order_id is null
   and (pi.internal_status in ('refunded', 'charged_back')
        or pi.provider_status in ('refunded', 'charged_back')
        or pi.refunded_amount >= coalesce(pi.paid_amount, pi.expected_amount))
 group by cs.id, cs.business_id, cs.status, cs.manual_review_reason, pi.id, pi.internal_status,
          pi.provider_status, pi.refunded_amount, pi.paid_amount, pi.expected_amount;

-- I2. INFORMATIVA. Entregas firmadas repetidas (mismo pedido del proveedor) antes de 20261002022000.
select 'signed_delivery_replayed_before_fix' as finding, r.environment, r.resource_id, count(*) as receipts,
       count(o.id) as jobs, min(r.received_at) as first_seen, max(r.received_at) as last_seen
  from public.payment_webhook_receipts r
  left join public.payment_outbox o on o.webhook_receipt_id = r.id
 where r.signature_valid
   and r.request_id is not null
 group by r.environment, r.resource_id, r.request_id
having count(*) > 1;

-- I3. INFORMATIVA. Trabajos de la cola de pagos en dead_letter: los de lectura se van a poder reanimar
--     (20261002023000); los de conciliación de dinero no.
select 'dead_lettered_payment_jobs' as finding, o.topic, count(*) as jobs,
       count(*) filter (where o.payment_intent_id is null and r.seller_business_id is null and o.topic <> 'payment') as without_owner,
       min(o.created_at) as oldest
  from public.payment_outbox o
  left join public.payment_webhook_receipts r on r.id = o.webhook_receipt_id
 where o.status in ('dead_letter', 'failed')
 group by o.topic;

-- I4. Cancelaciones de pago que quedaron «requested» más de una hora: antes del arreglo de la Edge Function
--     mercadopago-cancel-payment podían quedar así para siempre si asentar la respuesta del proveedor fallaba.
select 'payment_cancellation_stuck_requested' as finding, c.id as cancellation_id, c.payment_intent_id,
       c.requested_at
  from public.payment_cancellations c
 where c.status = 'requested'
   and c.requested_at < clock_timestamp() - interval '1 hour';

-- ── J · Autorización (20261002050000, 20261002051000) ─────────────────────────

-- J1. INFORMATIVA. Qué roles tienen orders.cancel en el catálogo (esperado: admin, owner). Con
--     20261002050000 cancelar y rechazar un pedido pasan a seguir este catálogo.
select 'orders_cancel_catalog' as finding, string_agg(rp.role, ',' order by rp.role) as roles
  from public.identity_role_permissions rp
 where rp.permission = 'orders.cancel';

-- J2. Empleados activos que pierden cancelar y rechazar al aplicar 20261002050000 (también en una caja de
--     Caja Clara atendida por un empleado). Decisión del dueño: ver LA_TABA_AUTONOMOUS_STATUS.md.
select 'staff_losing_cancel_and_reject' as finding, m.business_id, b.slug, s.client,
       count(distinct m.user_id) as staff_members
  from public.business_members m
  join public.businesses b on b.id = m.business_id
  left join public.identity_sessions s
    on s.business_id = m.business_id and s.user_id = m.user_id and s.revoked_at is null
 where m.role = 'staff'
   and m.is_active
 group by m.business_id, b.slug, s.client
 order by b.slug, s.client;

-- J3. INFORMATIVA. Cancelaciones y rechazos hechos por empleados en los últimos 30 días: lo que deja de
--     poder hacer quien tiene ese rol.
select 'staff_cancellations_last_30_days' as finding, r.business_id, b.slug, r.command_type,
       r.result ->> 'status' as resulting_status, count(*) as commands, max(r.created_at) as last_at
  from public.business_command_receipts r
  join public.business_members m
    on m.business_id = r.business_id and m.user_id = r.actor_user_id and m.role = 'staff'
  join public.businesses b on b.id = r.business_id
 where r.created_at > clock_timestamp() - interval '30 days'
   and r.command_type in ('cancel_order', 'transition_order')
   and r.result ->> 'status' in ('cancelled', 'canceled', 'rejected')
 group by r.business_id, b.slug, r.command_type, r.result ->> 'status'
 order by last_at desc;

-- ── K · Sondas del proveedor (20261002060000) ─────────────────────────────────

-- K1. INFORMATIVA. Checkouts de las últimas 48 horas, sin pedido, con 8 o más vacíos: reciben las sondas
--     tardías (2, 6 y 24 horas). Los vacíos anteriores a la migración cuentan como concluyentes.
select 'checkouts_due_late_provider_probes' as finding, pi.business_id, count(*) as intents,
       min(cs.created_at) as oldest
  from public.payment_intents pi
  join public.checkout_sessions cs on cs.id = pi.checkout_session_id
 where cs.completed_order_id is null
   and pi.order_id is null
   and cs.created_at > clock_timestamp() - interval '48 hours'
   and (select count(*) from public.payment_events pe
         where pe.payment_intent_id = pi.id
           and pe.event_type = 'payment.provider_probe_empty') >= 8
 group by pi.business_id;

-- K2. Checkouts sin pedido de las últimas 48 horas cuya preferencia se creó con una conexión del vendedor
--     que ya no es la vigente: sus vacíos no prueban nada (el caso de Staging del 2026-09-25). Revisarlos en
--     Mercado Pago o con scripts/payments/reconcile-payments.mjs.
select 'checkout_preference_from_replaced_seller_connection' as finding, pi.business_id, pi.id as payment_intent_id,
       pi.internal_status, cs.created_at, pa.seller_generation is distinct from c.generation as generation_changed,
       c.status as connection_status
  from public.payment_intents pi
  join public.checkout_sessions cs on cs.id = pi.checkout_session_id
  join public.payment_attempts pa on pa.id = pi.current_payment_attempt_id
  join public.mp_seller_connections c on c.business_id = pi.business_id and c.environment = pi.environment
 where cs.completed_order_id is null
   and pi.order_id is null
   and pi.provider_payment_id is null
   and cs.created_at > clock_timestamp() - interval '48 hours'
   and pa.seller_generation is not null
   and (pa.seller_generation is distinct from c.generation or c.status <> 'connected');
