-- ============================================================================
--  Mercado Pago: desvincular sin dejar cobros a ciegas, enterarse de una
--  revocación y que el dueño pueda APAGAR el cobro online por su cuenta.
-- ============================================================================
--
--  1. `mp_disconnect` borraba la autorización del vendedor aunque hubiera pagos
--     sin cerrar, devoluciones o cancelaciones en curso, o avisos en la cola.
--     Todos esos casos necesitan consultar a Mercado Pago con el token del
--     vendedor: después de desvincular quedaban sin resolver. Ahora
--     `mp_disconnect_checked` pausa primero el cobro online (ningún comprador
--     nuevo entra a pagar) y desvincula SÓLO si no queda nada pendiente, con la
--     conexión bloqueada en la misma transacción. El historial no se borra.
--  2. Si el vendedor revoca el permiso desde su cuenta, Mercado Pago avisa por
--     el tema «Vinculación de aplicaciones». Ese aviso dispara una verificación
--     con Mercado Pago; si la revocación se confirma, `mp_mark_seller_deauthorized`
--     deja la conexión en «requiere reconexión», descarta la autorización que ya
--     no sirve y apaga el cobro online. Nunca enciende nada.
--  3. `account_label`: apodo y correo enmascarado de la cuenta vinculada, para
--     que el dueño confirme que autorizó la cuenta correcta (personal o del
--     comercio). No es un secreto ni un identificador técnico.
--  4. `pause_mercadopago_payments`: el dueño o el encargado pueden APAGAR el
--     cobro online en cualquier entorno, auditado. Encender sigue siendo una
--     decisión del operador (operator_set_mercadopago_for_business).
-- ============================================================================

alter table public.mp_seller_connections
  add column if not exists account_label text,
  add column if not exists deauthorized_at timestamptz;

alter table public.mp_seller_connections drop constraint if exists mp_seller_connections_account_label_check;
alter table public.mp_seller_connections add constraint mp_seller_connections_account_label_check
  check (account_label is null or char_length(account_label) between 1 and 120);

-- Lo que todavía necesita a Mercado Pago para cerrarse. Sólo lectura.
create or replace function public.mp_disconnect_preflight(p_business_id uuid, p_environment text)
returns jsonb
language sql
stable
security invoker
set search_path = pg_catalog, public, pg_temp
as $mp_disconnect_preflight$
  with intents as (
    select i.id, i.internal_status, i.checkout_session_id, i.approved_at
      from public.payment_intents i
     where i.business_id = p_business_id and i.environment = p_environment and i.provider = 'mercadopago'
  )
  select jsonb_build_object(
    -- Un pago que Mercado Pago todavía puede aprobar, o uno aprobado sin pedido.
    -- Los checkouts en curso cuentan mientras su sesión no venció: el comprador
    -- puede estar pagando ahora mismo.
    'open_payments', (select count(*) from intents i
       where i.internal_status in ('pending', 'in_process', 'approved_order_pending', 'ambiguous', 'security_review_required')
          or (i.internal_status in ('created', 'preference_creating', 'preference_created', 'redirected')
              and exists (select 1 from public.checkout_sessions s
                           where s.id = i.checkout_session_id and s.expires_at > now() - interval '15 minutes'))),
    'refunds_in_progress', (select count(*) from public.payment_refunds r join intents i on i.id = r.payment_intent_id
       where r.status in ('requested', 'processing', 'ambiguous')),
    'cancellations_in_progress', (select count(*) from public.payment_cancellations c join intents i on i.id = c.payment_intent_id
       where c.status in ('requested', 'processing', 'ambiguous')),
    'queued_jobs', (select count(*) from public.payment_outbox o
       where o.status in ('pending', 'claimed', 'processing', 'retry_wait')
         and (o.payment_intent_id in (select id from intents)
              or o.webhook_receipt_id in (select w.id from public.payment_webhook_receipts w
                                           where w.seller_business_id = p_business_id and w.environment = p_environment))),
    -- Informativo: después de desvincular, estas devoluciones se hacen desde la
    -- cuenta de Mercado Pago del comercio, no desde el panel.
    'approved_last_180_days', (select count(*) from intents i
       where i.internal_status in ('approved', 'completed', 'partially_refunded')
         and i.approved_at > now() - interval '180 days')
  );
$mp_disconnect_preflight$;

-- Pausa SIEMPRE (en una transacción propia si no se ejecuta), y desvincula sólo
-- con p_execute y sin nada pendiente. Dos llamadas: la primera deja la pausa
-- confirmada antes de mirar lo pendiente, así un checkout que arrancaba en ese
-- instante queda contado en la segunda.
create or replace function public.mp_disconnect_checked(p_business_id uuid, p_environment text, p_execute boolean)
returns jsonb
language plpgsql
security invoker
set search_path = pg_catalog, public, pg_temp
as $mp_disconnect_checked$
declare
  v_pending jsonb;
  v_blocking bigint;
begin
  perform 1 from public.mp_seller_connections
   where business_id = p_business_id and environment = p_environment for update;
  update public.business_payment_settings set enabled = false, updated_at = now()
   where business_id = p_business_id and environment = p_environment and enabled;
  v_pending := public.mp_disconnect_preflight(p_business_id, p_environment);
  v_blocking := (v_pending->>'open_payments')::bigint + (v_pending->>'refunds_in_progress')::bigint
    + (v_pending->>'cancellations_in_progress')::bigint + (v_pending->>'queued_jobs')::bigint;
  if v_blocking > 0 then
    return jsonb_build_object('ok', false, 'code', 'pending_operations', 'paused', true, 'pending', v_pending);
  end if;
  if not coalesce(p_execute, false) then
    return jsonb_build_object('ok', false, 'code', 'ready_to_disconnect', 'paused', true, 'pending', v_pending);
  end if;
  perform public.mp_disconnect(p_business_id, p_environment);
  return jsonb_build_object('ok', true, 'paused', true, 'pending', v_pending);
end;
$mp_disconnect_checked$;

-- Revocación CONFIRMADA por Mercado Pago (la renovación de la autorización
-- respondió invalid_grant). El aviso de «Vinculación de aplicaciones» sólo
-- dispara esa verificación: su cuerpo no está cubierto por la firma, así que no
-- se le cree por sí mismo. Sólo degrada; nunca conecta ni habilita.
create or replace function public.mp_mark_seller_deauthorized(p_business_id uuid, p_environment text)
returns boolean
language plpgsql
security invoker
set search_path = pg_catalog, public, pg_temp
as $mp_mark_seller_deauthorized$
begin
  update public.mp_seller_connections
     set status = 'requires_reauthorization', protected_tokens = null, generation = gen_random_uuid(),
         refresh_owner = null, refresh_started_at = null, deauthorized_at = now(), updated_at = now()
   where business_id = p_business_id and environment = p_environment
     and status in ('connected', 'requires_reauthorization');
  if not found then return false; end if;
  update public.business_payment_settings set enabled = false, updated_at = now()
   where business_id = p_business_id and environment = p_environment and enabled;
  delete from public.mp_oauth_states where business_id = p_business_id and environment = p_environment;
  return true;
end;
$mp_mark_seller_deauthorized$;

-- El dueño o el encargado pueden apagar el cobro online desde el panel, en
-- cualquier entorno. Prender queda del lado del operador.
create or replace function public.pause_mercadopago_payments(p_business_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $pause_mercadopago_payments$
declare
  v_before public.business_payment_settings%rowtype;
begin
  if not public.has_business_role(p_business_id, array['owner', 'admin']) then
    raise exception 'pausar los cobros online requiere owner o admin' using errcode = '42501';
  end if;
  select * into v_before from public.business_payment_settings
   where business_id = p_business_id and provider = 'mercadopago' for update;
  if v_before.id is null or not v_before.enabled then
    return jsonb_build_object('ok', true, 'changed', false, 'enabled', false);
  end if;
  update public.business_payment_settings set enabled = false, updated_at = clock_timestamp() where id = v_before.id;
  insert into public.business_config_audit(business_id, scope, action, actor_kind, actor_id, before, after)
  values (p_business_id, 'payments', 'disabled', 'user', auth.uid(),
    jsonb_build_object('provider', 'mercadopago', 'enabled', true, 'environment', v_before.environment),
    jsonb_build_object('provider', 'mercadopago', 'enabled', false, 'environment', v_before.environment));
  return jsonb_build_object('ok', true, 'changed', true, 'enabled', false);
end;
$pause_mercadopago_payments$;

revoke all on function public.mp_disconnect_preflight(uuid, text) from public, anon, authenticated;
revoke all on function public.mp_disconnect_checked(uuid, text, boolean) from public, anon, authenticated;
revoke all on function public.mp_mark_seller_deauthorized(uuid, text) from public, anon, authenticated;
revoke all on function public.pause_mercadopago_payments(uuid) from public, anon;
grant execute on function public.mp_disconnect_preflight(uuid, text) to service_role;
grant execute on function public.mp_disconnect_checked(uuid, text, boolean) to service_role;
grant execute on function public.mp_mark_seller_deauthorized(uuid, text) to service_role;
grant execute on function public.pause_mercadopago_payments(uuid) to authenticated, service_role;
