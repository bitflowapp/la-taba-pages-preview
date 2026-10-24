-- ============================================================================
-- Mercado Pago: salida de soporte para un vínculo con la cuenta equivocada que
-- NUNCA se usó para cobrar.
--
-- Por qué existe. mp_finish_oauth (20260905195357) no deja cambiar de vendedor
-- una vez guardado, ni siquiera después de desvincular: así ningún cobro queda
-- conciliado contra la cuenta de otro. La regla se mantiene. Pero la equivocación
-- más probable del alta comercial es autorizar la cuenta PERSONAL del dueño en
-- vez de la del comercio, y sin esta salida ese comercio queda atado a esa
-- cuenta para siempre, aunque no haya vendido nada.
--
-- Qué hace. Libera el vendedor guardado SÓLO si:
--   * quien la llama es el servidor (service_role): soporte, nunca el panel;
--   * se nombra el vendedor que se libera (p_expected_seller_id), para no
--     liberar otro por error;
--   * el vínculo ya está desvinculado (mp_disconnect_checked, que exige no tener
--     nada pendiente) y no conserva credenciales;
--   * el comercio no tiene NINGÚN intento de pago, de ningún entorno, ni avisos
--     de Mercado Pago ruteados a él: no hay historia que conciliar.
-- Deja auditado el cambio. Después, el dueño vincula la cuenta correcta con el
-- botón de siempre. No habilita cobros ni toca pedidos.
-- ============================================================================

create function public.mp_release_unused_seller_binding(
  p_business_id uuid,
  p_environment text,
  p_expected_seller_id text
)
returns jsonb
language plpgsql
security invoker
set search_path = pg_catalog, public, pg_temp
as $mp_release_unused_seller_binding$
declare
  v_row public.mp_seller_connections%rowtype;
begin
  if p_environment is null or p_environment not in ('test', 'production') then
    raise exception 'invalid_environment' using errcode = '22023';
  end if;
  perform 1 from public.businesses where id = p_business_id for update;
  if not found then
    raise exception 'business_not_found' using errcode = 'P0002';
  end if;
  select * into v_row from public.mp_seller_connections
   where business_id = p_business_id and environment = p_environment
   for update;
  if not found or v_row.seller_id is null then
    raise exception 'no_seller_binding' using errcode = 'P0002';
  end if;
  if v_row.seller_id is distinct from nullif(btrim(coalesce(p_expected_seller_id, '')), '') then
    raise exception 'seller_mismatch' using errcode = 'P0001';
  end if;
  if v_row.status <> 'disconnected' or v_row.protected_tokens is not null or v_row.refresh_owner is not null then
    raise exception 'disconnect_first' using errcode = 'P0001';
  end if;
  if exists (select 1 from public.payment_intents i where i.business_id = p_business_id)
    or exists (select 1 from public.payment_webhook_receipts r where r.seller_business_id = p_business_id) then
    raise exception 'seller_has_payment_history' using errcode = 'P0001';
  end if;

  update public.mp_seller_connections
     set seller_id = null, application_id = null, scopes = '', account_label = null,
         expires_at = null, connected_at = null, last_refresh_at = null, deauthorized_at = null,
         disconnect_requested_at = null, generation = gen_random_uuid(), updated_at = now()
   where business_id = p_business_id and environment = p_environment;
  delete from public.mp_oauth_states where business_id = p_business_id and environment = p_environment;
  update public.business_payment_settings
     set collector_id = null, application_id = null, enabled = false, verified_at = null, updated_at = clock_timestamp()
   where business_id = p_business_id and provider = 'mercadopago' and environment = p_environment;

  insert into public.business_config_audit(business_id, scope, action, actor_kind, before, after)
  values (p_business_id, 'payments', 'deleted', 'service',
    jsonb_build_object('provider', 'mercadopago', 'environment', p_environment,
      'seller_binding', 'released', 'seller_suffix', right(v_row.seller_id, 4)),
    jsonb_build_object('provider', 'mercadopago', 'environment', p_environment, 'seller_binding', null));
  return jsonb_build_object('ok', true, 'released', true, 'environment', p_environment);
end;
$mp_release_unused_seller_binding$;

revoke all on function public.mp_release_unused_seller_binding(uuid, text, text) from public, anon, authenticated;
grant execute on function public.mp_release_unused_seller_binding(uuid, text, text) to service_role;
comment on function public.mp_release_unused_seller_binding(uuid, text, text) is
  'Soporte: libera el vendedor de Mercado Pago de un comercio desvinculado que nunca cobró, para vincular la cuenta correcta.';
