-- REVERSIÓN de 20261001180000_order_intake_guard.sql
--
-- Devuelve las dos puertas de admisión a sus funciones anteriores SIN copiar ningún
-- cuerpo: la migración las había renombrado, y acá se les devuelve el nombre.
--
--   create_order_with_items_confirmed_location  ->  create_order_with_items
--   create_checkout_session_reserving           ->  create_checkout_session
--
-- Ojo con lo que vuelve a quedar abierto: el pedido en efectivo sin ningún límite
-- (una identidad anónima puede crear pedidos sin tope) y el checkout con el único
-- freno que tenía antes. Sólo usar para volver atrás un despliegue.
--
-- Se conserva: `order_abuse_events` (existía antes; las filas `order_intake_*`
-- quedan como historia). Se pierde: el rastro privado de admisiones y de frenos
-- (ventanas de minutos, no es evidencia durable) y la sal del HMAC de origen.
-- Se niega a correr si algún negocio real cargó límites propios: esos valores son
-- una decisión del dueño y hay que exportarlos antes.
--
-- No toca supabase_migrations.schema_migrations. Después:
--   supabase migration repair --status reverted 20261001180000
begin;

do $guard$
declare
  v_configured integer;
begin
  select count(*) into v_configured
    from public.businesses b
   where not b.qa_fixture
     and (b.order_intake_guard_mode <> 'enforce'
       or b.order_ip_rate_limit_per_10_minutes is not null
       or b.max_pending_orders_per_ip is not null
       or b.order_business_rate_limit_per_10_minutes is not null
       or b.max_units_per_unpaid_order is not null);
  if v_configured > 0 then
    raise exception 'ROLLBACK_BLOCKED: % negocio(s) tienen configuracion propia del guardian de admision; exportarla antes de revertir', v_configured;
  end if;
end
$guard$;

do $unschedule$
begin
  perform cron.unschedule('taba-order-intake-purge');
exception
  when others then null;   -- el job ya no estaba
end
$unschedule$;

-- Puerta 1.
drop function public.create_order_with_items(jsonb);
alter function public.create_order_with_items_confirmed_location(jsonb) rename to create_order_with_items;
revoke all on function public.create_order_with_items(jsonb) from public, anon;
grant execute on function public.create_order_with_items(jsonb) to authenticated, service_role;

-- Puerta 2.
drop function public.create_checkout_session(uuid, jsonb);
alter function public.create_checkout_session_reserving(uuid, jsonb) rename to create_checkout_session;
revoke all on function public.create_checkout_session(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.create_checkout_session(uuid, jsonb) to service_role;

drop function public.purge_order_intake_traces(integer);
drop function private.order_intake_record_accept(uuid, uuid, text, uuid, uuid, bigint);
drop function private.order_intake_guard(public.businesses, uuid, text, bigint, text, text);
drop function private.order_intake_record_block(uuid, uuid, bytea, text, text, boolean);
drop function private.order_intake_evaluate(public.businesses, uuid, bytea, text);
drop function private.order_intake_client_fingerprint();
drop function private.order_intake_defaults();

drop table private.order_intake_blocks;
drop table private.order_intake_log;
drop table private.order_intake_secret;

drop index if exists public.checkout_sessions_business_created_idx;
drop index if exists public.order_abuse_events_business_created_idx;

alter table public.businesses drop constraint if exists businesses_order_intake_guard_valid;
alter table public.businesses
  drop column if exists order_intake_guard_mode,
  drop column if exists order_ip_rate_limit_per_10_minutes,
  drop column if exists max_pending_orders_per_ip,
  drop column if exists order_business_rate_limit_per_10_minutes,
  drop column if exists max_units_per_unpaid_order;

comment on column public.businesses.order_rate_limit_per_10_minutes is null;
comment on column public.businesses.max_pending_orders_per_customer is null;

commit;
