-- Verificación previa de las migraciones 20261001180000 .. 20261001230000 (endurecimiento del e-commerce).
--
-- SÓLO LECTURA: no cambia nada. Se corre en cada entorno ANTES de aplicar esas
-- migraciones y otra vez DESPUÉS, y se guardan las dos salidas. No usa ninguna
-- columna ni función nueva: corre igual en los dos momentos.
--
-- Ninguna de esas migraciones borra filas, y casi todas sólo cambian reglas. Tres
-- escriben sobre filas que ya existen, y cada una tiene su consulta en la sección E:
--   20261001180000  carga techos propios a los negocios marcados `qa_fixture`;
--   20261001200300  completa la confirmación de edad en pedidos de Mercado Pago;
--   20261001225000  completa el SKU en los renglones de pedidos.
-- Las demás consultas listan a QUIÉN le cambia algo en el momento de aplicar, o qué
-- dejó el comportamiento anterior. Una consulta sin filas es el resultado esperado,
-- salvo donde dice que es informativa.
--
-- Cada consulta es una sola sentencia y devuelve una columna `finding` con su nombre.

-- ── A · Pedidos y admisión (20261001180000, 20261001191000) ──────────────────

-- A1. INFORMATIVA. Los topes cargados por comercio. Lo que esté en NULL deja de ser
--     «sin límite»: rigen los valores por defecto (5 pedidos sin atender por cliente,
--     20 por cliente cada 10 minutos).
select 'intake_limits_by_business' as finding, b.id as business_id, b.slug, b.status, b.ordering_verified,
       b.max_pending_orders_per_customer, b.order_rate_limit_per_10_minutes, b.abandoned_order_minutes
  from public.businesses b
 where b.is_active
 order by b.slug;

-- A2. Clientes que hoy tienen más pedidos sin atender que el tope que va a regir:
--     no pueden hacer otro hasta que el comercio atienda o cancele alguno.
select 'customer_over_pending_cap' as finding, o.business_id, b.slug, o.customer_user_id is not null as identified_customer,
       count(*) as pending_orders, coalesce(b.max_pending_orders_per_customer, 5) as cap
  from public.orders o
  join public.businesses b on b.id = o.business_id
 where o.status in ('received', 'submitted') and o.inventory_released_at is null
 group by o.business_id, b.slug, o.customer_user_id, b.max_pending_orders_per_customer
having count(*) > coalesce(b.max_pending_orders_per_customer, 5)
 order by pending_orders desc;

-- A3. Pedidos en efectivo sin atender que la tarea de vencimiento va a cancelar en su
--     PRIMERA corrida (devuelve el stock). Sólo en comercios con abandoned_order_minutes
--     cargado. Si no se quiere ese efecto, dejar la columna en NULL antes de aplicar.
select 'unattended_orders_that_will_expire' as finding, b.id as business_id, b.slug, b.abandoned_order_minutes,
       count(*) as orders, min(o.created_at) as oldest
  from public.orders o
  join public.businesses b on b.id = o.business_id
 where o.status in ('received', 'submitted')
   and o.payment_method in ('cash', 'coordinate')
   and o.manual_payment_status = 'pending'
   and o.acknowledged_at is null
   and b.abandoned_order_minutes is not null
   and o.created_at < clock_timestamp() - make_interval(mins => b.abandoned_order_minutes)
   and not exists (select 1 from public.payment_intents pi where pi.order_id = o.id)
 group by b.id, b.slug, b.abandoned_order_minutes;

-- ── B · Cobros, reembolsos y cancelaciones (20261001203000 .. 20261001205000) ─

-- B1. Sesiones donde UN pedido consumió el stock dos veces (dos generaciones
--     `converted` del mismo producto). `surplus_units` son unidades vendibles que
--     faltan en products.stock: se reponen a mano, con un movimiento de inventario.
select 'double_converted' as finding, r.checkout_session_id, r.product_id,
       count(*) as converted_generations, sum(r.quantity) - max(i.quantity) as surplus_units
  from public.inventory_reservations r
  join public.checkout_session_items i
    on i.checkout_session_id = r.checkout_session_id and i.product_id = r.product_id
 where r.status = 'converted'
 group by r.checkout_session_id, r.product_id
having sum(r.quantity) > max(i.quantity);

-- B2. Stock retenido por un checkout que el barrido nunca libera (revisión manual, o
--     pagado y sin finalizar). Después de aplicar se resuelven rearmando el pedido,
--     reembolsando, o con release_manual_review_checkout_inventory si el dinero ya salió.
select 'held_by_paid_or_review_checkout' as finding, cs.id as checkout_session_id, cs.status, cs.manual_review_reason,
       pi.id as payment_intent_id, pi.internal_status, pi.provider_status, pi.paid_amount, pi.refunded_amount,
       r.product_id, r.quantity, clock_timestamp() - r.expires_at as expired_for
  from public.inventory_reservations r
  join public.checkout_sessions cs on cs.id = r.checkout_session_id
  left join public.payment_intents pi on pi.checkout_session_id = cs.id
 where r.status = 'active'
   and cs.status in ('manual_review_required', 'payment_approved', 'finalizing_order')
   and r.expires_at < clock_timestamp()
 order by r.expires_at;

-- B3. Pedidos rearmados sobre un cobro reembolsado (total o parcial) o con un
--     reembolso en curso: el pedido existe y el dinero, o parte, ya no está.
select 'order_on_refunded_payment' as finding, pi.id as payment_intent_id, pi.order_id, o.public_code, o.status as order_status,
       pi.internal_status, pi.paid_amount, pi.refunded_amount,
       (select string_agg(pr.status || ':' || pr.amount, ',' order by pr.requested_at)
          from public.payment_refunds pr where pr.payment_intent_id = pi.id) as refunds
  from public.payment_intents pi
  join public.orders o on o.id = pi.order_id
 where exists (select 1 from public.payment_events e
                where e.payment_intent_id = pi.id and e.event_type = 'payment.order_recovered_by_operator')
   and (pi.refunded_amount > 0 or exists (
         select 1 from public.payment_refunds pr
          where pr.payment_intent_id = pi.id and pr.status in ('requested', 'processing', 'ambiguous', 'approved')));

-- B4. Reembolsos en curso. Antes no tenían salida; después se destraban con
--     resolve_stuck_payment_refund. `provider_payments_seen` mayor que 1 en una
--     solicitud anterior a la migración significa que no se puede deducir contra
--     qué pago salió: esa la resuelve soporte en Mercado Pago.
select 'refund_in_flight' as finding, pr.id as refund_id, pr.payment_intent_id, pr.status, pr.amount,
       pr.provider_refund_id is not null as has_provider_identity, clock_timestamp() - pr.requested_at as age,
       (select string_agg(o.status, ',') from public.payment_outbox o
         where o.refund_id = pr.id and o.topic = 'refund_reconcile') as reconcile_jobs,
       (select count(distinct e.provider_event_id) from public.payment_events e
         where e.payment_intent_id = pr.payment_intent_id and e.provider_event_id is not null) as provider_payments_seen
  from public.payment_refunds pr
 where pr.status in ('requested', 'processing', 'ambiguous')
 order by pr.requested_at;

-- B5. Cancelaciones que una marca dudosa tardía pudo degradar después de que el
--     proveedor las confirmó.
select 'cancellation_downgraded' as finding, c.id as cancellation_id, c.payment_intent_id, c.status, c.completed_at
  from public.payment_cancellations c
 where c.completed_at is not null and c.status not in ('cancelled', 'rejected');

-- B6. Cobros aprobados sin pedido. La alerta que los informa pasa a medir desde que
--     se aprobó el cobro (20261001222000): los que estén acá van a quedar alertando.
select 'approved_payment_without_order' as finding, pi.id as payment_intent_id, pi.business_id, pi.internal_status,
       pi.paid_amount, pi.approved_at, clock_timestamp() - pi.approved_at as approved_for
  from public.payment_intents pi
 where pi.internal_status in ('approved', 'approved_order_pending') and pi.order_id is null
 order by pi.approved_at;

-- ── C · Horarios, entrega y apertura (20261001213000 .. 20261001216000) ───────

-- C1. Comercios con tope de distancia y cobertura SIN exigir. Desde 20261001214000 el
--     tope rige igual: se rechazan los puntos más lejos, los pedidos sin punto y, si
--     el punto del local no está verificado por una persona, todos los envíos.
select 'radius_cap_without_enforced_coverage' as finding, b.id as business_id, b.slug, b.delivery_max_radius_meters,
       exists (select 1 from private.rider_map_business_locations l
                where l.business_id = b.id and l.human_verified) as point_verified
  from public.businesses b
 where b.delivery_max_radius_meters is not null and not b.delivery_zone_enforced;

-- C2. Zonas declaradas cuyo nombre publicado no es su área. Desde 20261001214000 el
--     nombre también se puede elegir, y un nombre gana sobre el área de otra zona.
--     (La expresión es la de public.normalize_zone_name, escrita acá porque el rol de
--     sólo lectura de la plataforma no puede ejecutar esa función.)
select 'zone_name_differs_from_area' as finding, z.business_id, z.name, z.area_normalized, z.is_active
  from public.delivery_zones z
 where z.match_kind = 'declared_area'
   and nullif(btrim(regexp_replace(
         lower(translate(coalesce(z.name, ''), 'áéíóúüñÁÉÍÓÚÜÑ', 'aeiouunAEIOUUN')), '[^a-z0-9]+', ' ', 'g')), '')
       is distinct from z.area_normalized;

-- C3. Fechas con un cierre Y un horario especial. Desde 20261001213000 el cierre gana:
--     ese día queda cerrado y no arrastra apertura a la madrugada siguiente.
select 'closure_and_special_hours_same_date' as finding, e.business_id, e.on_date,
       array_agg(e.channel || case when e.is_closed then ':closed' else ':special' end order by e.channel) as exceptions
  from public.business_service_exceptions e
 group by e.business_id, e.on_date
having bool_or(e.is_closed) and bool_or(not e.is_closed);

-- C4. Horarios especiales «para todos los canales» en comercios que exigen la grilla de
--     alcohol. Desde 20261001213000 ya no mueven la ventana de alcohol.
select 'all_channel_special_hours_with_alcohol_grid' as finding, e.business_id, e.on_date, e.opens_at, e.closes_at
  from public.business_service_exceptions e
  join public.businesses b on b.id = e.business_id
 where e.channel = 'all' and not e.is_closed and b.alcohol_hours_enforced;

-- C5. INFORMATIVA. Comercios ya verificados que hoy operan sin alguna regla. No se les
--     revoca nada. Cuando enciendan una exigencia, el Panel ya no la deja apagar; y si
--     apagan el delivery, para volver a encenderlo van a necesitar la cobertura.
select 'verified_without_rules' as finding, b.id as business_id, b.slug, b.status, b.hours_enforced,
       b.delivery_enabled, b.delivery_zone_enforced,
       (select count(*) from public.delivery_zones z where z.business_id = b.id and z.is_active) as active_zones
  from public.businesses b
 where b.ordering_verified and (not b.hours_enforced or (b.delivery_enabled and not b.delivery_zone_enforced));

-- C6. INFORMATIVA. Comercios sin verificar a los que la verificación de plataforma les
--     va a pedir algo más que antes: un dueño activo, el horario exigido con franjas
--     y, con delivery, la cobertura exigida con una zona activa.
select 'unverified_missing_new_requirements' as finding, b.id as business_id, b.slug,
       not exists (select 1 from public.business_members m
                    where m.business_id = b.id and m.role = 'owner' and m.is_active) as owner_missing,
       not b.hours_enforced as hours_not_enforced,
       (select count(*) from public.business_service_hours h where h.business_id = b.id) as hour_rows,
       b.delivery_enabled and not b.delivery_zone_enforced as coverage_not_enforced,
       (select count(*) from public.delivery_zones z where z.business_id = b.id and z.is_active) as active_zones
  from public.businesses b
 where b.is_active and not b.ordering_verified
 order by b.slug;

-- ── D · Operación (20261001220000 .. 20261001230000) ──────────────────────────

-- D1. INFORMATIVA. Pedidos abiertos hace más de 24 horas. Sus alertas se cerraban
--     solas al día; desde 20261001220500 vuelven a alertar en el primer barrido.
select 'open_orders_older_than_24h' as finding, o.business_id, b.slug, o.status, count(*) as orders, min(o.created_at) as oldest
  from public.orders o
  join public.businesses b on b.id = o.business_id
 where o.status not in ('delivered', 'cancelled', 'canceled', 'rejected')
   and o.created_at < clock_timestamp() - interval '24 hours'
 group by o.business_id, b.slug, o.status
 order by oldest;

-- D2. INFORMATIVA. Lo que van a borrar las dos podas diarias en su primera corrida
--     (cupos de pago de más de un día; recibos de webhook rechazados de más de 30).
select 'payment_traces_first_purge' as finding,
       (select count(*) from public.payment_rate_limit_buckets k
         where k.bucket_started_at < clock_timestamp() - interval '1 day') as rate_limit_buckets,
       (select count(*) from public.payment_webhook_receipts w
         where w.processing_status = 'rejected_signature' and not w.signature_valid
           and w.received_at < clock_timestamp() - interval '30 days') as rejected_receipts;

-- D3. INFORMATIVA. Renglones de pedidos cuyo producto ya no existe: quedan sin SKU
--     (20261001225000 completa los demás con el SKU que el producto tiene hoy).
select 'order_lines_without_product' as finding, count(*) as order_lines
  from public.order_items oi
 where oi.product_uuid is null;

-- ── E · Filas que las migraciones escriben ───────────────────────────────────

-- E1. INFORMATIVA. Negocios marcados `qa_fixture`: 20261001180000 les carga techos
--     propios (2000 pedidos por origen cada 10 minutos, 2000 sin atender por origen,
--     5000 por comercio) donde no tengan uno. Un comercio real no lleva esa marca.
select 'qa_fixture_businesses_get_ceilings' as finding, b.id as business_id, b.slug, b.status, b.ordering_verified
  from public.businesses b
 where b.qa_fixture
 order by b.slug;

-- E2. Pedidos de Mercado Pago con alcohol que hoy no tienen la confirmación de edad.
--     `will_fill` los completa 20261001200300 con lo que guardó su sesión (les sube la
--     revisión: conviene aplicar con el local cerrado). `left_out` no los toca, porque
--     la fila no cumple una restricción heredada o la sesión no tiene el dato: esos se
--     revisan a mano. Después de aplicar, `will_fill` tiene que dar 0.
select 'age_confirmation_backfill' as finding,
       count(*) filter (where t.session_has_pair and not t.legacy_row) as will_fill,
       count(*) filter (where not t.session_has_pair or t.legacy_row) as left_out
  from (
    select coalesce(s.age_confirmed_at is not null and s.age_confirmation_policy between 18 and 99, false) as session_has_pair,
           ((o.delivery_location_confirmed_at is not null
              and (o.delivery_location_source is null or o.delivery_latitude is null or o.delivery_longitude is null))
            or (o.delivery_address_label is not null
              and char_length(btrim(o.delivery_address_label)) not between 1 and 60)) as legacy_row
      from public.orders o
      join public.checkout_sessions s on s.completed_order_id = o.id
     where o.payment_method = 'mercadopago'
       and s.contains_alcohol
       and o.age_confirmed_at is null
       and o.age_confirmation_policy is null
  ) t
having count(*) > 0;

-- E3. INFORMATIVA. Renglones de pedidos que 20261001225000 completa con el SKU que el
--     producto tiene hoy, y los que quedan sin SKU porque su producto no tiene uno.
select 'order_lines_sku_backfill' as finding,
       count(*) filter (where p.sku is not null) as lines_filled,
       count(*) filter (where p.sku is null) as lines_whose_product_has_no_sku
  from public.order_items oi
  join public.products p on p.id = oi.product_uuid;
