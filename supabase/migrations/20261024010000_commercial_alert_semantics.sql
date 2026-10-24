-- ============================================================================
--  Alertas que el comercio puede leer: una compra abandonada no es una emergencia,
--  y un pedido con el pago devuelto tiene que decir que hay que cerrarlo.
-- ============================================================================
--
--  1. CHECKOUT_PROVIDER_UNVERIFIED. Desde 20261022110000 (hallazgo forense F08) la
--     alerta queda abierta hasta cerrarse con evidencia: vencimiento + 24 h + tres
--     consultas al proveedor sin novedades. Esa regla NO cambia. Lo que cambia es la
--     gravedad: era CRÍTICA siempre, y un cliente que abandona en Mercado Pago —lo
--     más común en cualquier tienda— dejaba al Panel diciendo «Frená y resolvé
--     ahora · Resolvelas antes de seguir cobrando o entregando» durante un día
--     entero. Medido en QA el 23/10: cuatro críticas abiertas, las cuatro con 21 a
--     35 consultas a Mercado Pago y ningún pago.
--
--     Ahora la gravedad dice si la verificación funciona:
--       · nunca hubo una respuesta del proveedor para esa compra (vendedor sin
--         conectar, procesador caído, proveedor que no contesta) → CRITICAL:
--         no se sabe si alguien pagó;
--       · hubo respuestas, pero la última tiene más de 3 h (la escalera de
--         consultas nunca espera más de 1 h) → CRITICAL: la verificación se frenó;
--       · se consulta en hora y el proveedor no registra ningún pago → INFO:
--         compra sin terminar, en vigilancia.
--     Si aparece un pago, la alerta se cierra como siempre (provider_payment_id).
--
--  2. ORDER_PAYMENT_REVERSED_OPEN (nueva, ACTION_REQUIRED). Un pedido cuyo pago
--     volvió al comprador —por importes, `order_payment_is_financially_reversed`— y
--     que sigue abierto. La base ya impide avanzarlo (55000) y permite cancelarlo;
--     faltaba decirle a alguien que lo cierre. Medido en QA el 23/10: LT-0087 quedó
--     `received` después de «Devolver dinero» y la única alerta era
--     ORDER_NOT_ACCEPTED, que pide «aceptalo o cancelalo»: aceptar falla. Esos
--     pedidos salen de ORDER_NOT_ACCEPTED y de ORDER_STALLED.
--
--  Nada de esto mueve dinero, stock ni estados: sólo qué se avisa y con qué
--  gravedad. Cada reemplazo falla cerrado si el texto desplegado no es el esperado.
--  Rollback: docs/migrations/rollback/20261024010000_commercial_alert_semantics.rollback.sql
-- ============================================================================

create or replace function private.checkout_provider_watch_state(p_payment_intent_id uuid) returns text
language sql stable security definer set search_path = pg_catalog, public, pg_temp as $$
  -- Las mismas lecturas que cuenta enqueue_checkout_provider_probes: vacías o con pagos sin dinero.
  select case
    when max(pe.server_recorded_at) is null then 'never_verified'
    when max(pe.server_recorded_at) < clock_timestamp() - interval '3 hours' then 'verification_stalled'
    else 'watching'
  end
  from public.payment_events pe
  where pe.payment_intent_id = p_payment_intent_id
    and pe.event_type in ('payment.provider_probe_empty', 'payment.provider_probe_seen') $$;

revoke all on function private.checkout_provider_watch_state(uuid) from public;

comment on function private.checkout_provider_watch_state(uuid) is
  'never_verified | verification_stalled | watching: si la verificación con el proveedor de un checkout sin pago está funcionando.';

do $$
declare
  v_def text;
  v_new text;
  v_old_unverified constant text :=
       E'      select\n'
    || E'        ''CRITICAL'', ''CHECKOUT_PROVIDER_UNVERIFIED'', ''payment_intent'',\n'
    || E'        pi.id, pi.correlation_id,\n'
    || E'        ''Checkout que llegó a Mercado Pago y venció sin confirmación del proveedor.'',\n'
    || E'        ''Buscar el pago en Mercado Pago por la referencia externa; si existe, reembolsar o materializar el pedido.'',\n'
    || E'        jsonb_build_object(\n'
    || E'          ''payment_intent_id'', pi.id,\n';
  v_new_unverified constant text :=
       E'      select\n'
    || E'        case when private.checkout_provider_watch_state(pi.id) = ''watching'' then ''INFO'' else ''CRITICAL'' end,\n'
    || E'        ''CHECKOUT_PROVIDER_UNVERIFIED'', ''payment_intent'',\n'
    || E'        pi.id, pi.correlation_id,\n'
    || E'        case when private.checkout_provider_watch_state(pi.id) = ''watching''\n'
    || E'          then ''Compra sin terminar en Mercado Pago: el proveedor no registra ningún pago y se sigue consultando.''\n'
    || E'          else ''Checkout que llegó a Mercado Pago y no se pudo verificar con el proveedor.'' end,\n'
    || E'        case when private.checkout_provider_watch_state(pi.id) = ''watching''\n'
    || E'          then ''Nada que hacer: si el pago aparece, el pedido se arma o se avisa. La consulta sigue hasta 24 h después del vencimiento.''\n'
    || E'          else ''Revisar que Mercado Pago siga conectado y buscar el pago por la referencia externa; si existe, materializar el pedido o devolver el dinero.'' end,\n'
    || E'        jsonb_build_object(\n'
    || E'          ''payment_intent_id'', pi.id,\n'
    || E'          ''verification'', private.checkout_provider_watch_state(pi.id),\n';
  v_old_not_accepted constant text :=
       E'        and o.status in (''submitted'',''received'')\n'
    || E'        and coalesce(o.origin, ''production'') <> ''qa''\n'
    || E'        and o.acknowledged_at is null\n';
  v_old_stalled constant text :=
       E'        and o.status in (''accepted'',''preparing'')\n'
    || E'        and coalesce(o.origin, ''production'') <> ''qa''\n';
  v_reversed_guard constant text := E'        and not public.order_payment_is_financially_reversed(o.id)\n';
  v_tail constant text := E'    ) findings\n  loop';
begin
  v_def := pg_get_functiondef('public.reconcile_operational_alerts_for_business(uuid)'::regprocedure);

  -- Each pattern must appear exactly once: a second copy would mean the function is not the one this was written for.
  if (length(v_def) - length(replace(v_def, v_old_unverified, ''))) / length(v_old_unverified) <> 1
    or (length(v_def) - length(replace(v_def, v_old_not_accepted, ''))) / length(v_old_not_accepted) <> 1
    or (length(v_def) - length(replace(v_def, v_old_stalled, ''))) / length(v_old_stalled) <> 1
    or (length(v_def) - length(replace(v_def, v_tail, ''))) / length(v_tail) <> 1 then
    raise exception 'COMMERCIAL_ALERT_SEMANTICS_PATTERN_MISMATCH';
  end if;

  v_new := replace(v_def, v_old_unverified, v_new_unverified);
  v_new := replace(v_new, v_old_not_accepted, v_old_not_accepted || v_reversed_guard);
  v_new := replace(v_new, v_old_stalled, v_old_stalled || v_reversed_guard);
  v_new := replace(v_new, v_tail,
       E'\n      union all\n\n'
    || E'      select\n'
    || E'        ''ACTION_REQUIRED'', ''ORDER_PAYMENT_REVERSED_OPEN'', ''order'',\n'
    || E'        o.id, o.correlation_id,\n'
    || E'        ''Pedido con el pago devuelto que sigue abierto.''::text,\n'
    || E'        ''Cancelarlo desde Pedidos con el motivo de la devolución; no prepararlo ni entregarlo. Si no salió del local, el stock vuelve solo.''::text,\n'
    || E'        jsonb_build_object(''order_id'', o.id, ''public_code'', o.public_code, ''status'', o.status)\n'
    || E'      from public.orders o\n'
    || E'      where o.business_id = p_business_id\n'
    || E'        and public.normalize_order_status_vocabulary(o.status) not in (''cancelled'', ''rejected'', ''delivered'', ''completed'')\n'
    || E'        and public.order_payment_is_financially_reversed(o.id)\n'
    || v_tail);

  execute v_new;
end $$;
