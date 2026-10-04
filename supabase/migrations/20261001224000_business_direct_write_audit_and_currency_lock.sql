-- Todo lo que el dueño o el encargado pueden escribir directo sobre `businesses` queda
-- auditado, y la moneda de un comercio verificado no se cambia.
--
-- QUÉ ESTABA ABIERTO (medido el 2026-10-01 sobre las 159 migraciones anteriores)
--
--   `authenticated` tiene UPDATE por columna sobre 25 columnas de `businesses`, y la
--   policy «production owners update business ordering» se lo permite a owner y admin.
--   El trigger de auditoría (`audit_business_commercial_change`) sólo miraba el envío,
--   el mínimo, el radio y las exigencias. Con una sesión de encargado, cinco PATCH
--   seguidos sobre un comercio verificado:
--
--     1. habilitar la venta de alcohol (edad, franja y zona horaria);
--     2. `captcha_required = false` y los topes de pedidos en NULL;
--     3. `status = 'paused'` sin pasar por `set_business_open_state`;
--     4. `currency_code = 'USD'`;
--     5. nombre y teléfono;
--
--   fueron aceptados los cinco y dejaron CERO filas en `business_config_audit`. Con la
--   moneda en USD el pedido en efectivo sigue naciendo con importes en pesos rotulados
--   USD, el checkout de Mercado Pago deja de funcionar y esos pedidos no se pueden
--   facturar. La única restricción era `currency_code ~ '^[A-Z]{3}$'`.
--
--   El Panel web no usa estos permisos (no hay un solo `.update(` sobre `businesses` en
--   `js/`); sí los usa la herramienta de política de alcohol
--   (`scripts/controlled-production/alcohol-policy.mjs`) con la sesión del dueño. Por
--   eso el permiso NO se quita: se audita.
--
-- QUÉ QUEDA
--
--   1. Las 25 columnas del permiso quedan cubiertas, con estado completo antes y
--      después y con actor:
--
--        delivery_pricing  delivery_fee, minimum_delivery_subtotal        (ya estaba)
--        alcohol           alcohol_sales_enabled, alcohol_minimum_age,
--                          alcohol_sales_start, alcohol_sales_end, alcohol_timezone
--        abuse_limits      order_rate_limit_per_10_minutes,
--                          max_pending_orders_per_customer, stock_reservation_minutes,
--                          abandoned_order_minutes, captcha_required,
--                          order_ip_rate_limit_per_10_minutes, max_pending_orders_per_ip,
--                          order_business_rate_limit_per_10_minutes,
--                          max_units_per_unpaid_order, order_intake_guard_mode
--        currency          currency_code
--        open_state        status, is_active, ordering_enabled
--        fulfillment       delivery_enabled, pickup_enabled
--        contact           name, address, phone
--
--      `alcohol`, `abuse_limits` y `currency` no tienen ninguna RPC que las escriba:
--      se auditan pase por donde pase el cambio, igual que el envío y el mínimo.
--      `order_intake_guard_mode` no está en el permiso (apagar el guardián es de la
--      plataforma) y entra igual: es el cambio que más importa dejar escrito.
--
--      `open_state`, `fulfillment` y `contact` ya las auditan sus RPC
--      (`set_business_open_state`, `set_business_fulfillment`, `set_business_address`).
--      Para no escribir cada cambio dos veces, el trigger nuevo sólo corre cuando la
--      sentencia la ejecuta un rol de la API (`authenticated`, `service_role`, `anon`):
--      dentro de una RPC SECURITY DEFINER el rol de la sentencia es su dueño y el
--      trigger no se dispara. La condición va en el WHEN del trigger porque es el único
--      lugar donde se ve el rol que ejecuta la sentencia: adentro de una función
--      SECURITY DEFINER `current_user` ya es el dueño.
--
--   2. `currency_code` queda fijo mientras `ordering_verified` sea verdadero, para
--      todos los roles. Para cambiarlo hay que revocar antes la verificación
--      (`platform_revoke_business_ordering`), que es un acto de plataforma auditado.
--
-- QUÉ NO CAMBIA
--
--   · El permiso por columna y la policy: owner y admin siguen pudiendo escribir.
--   · Las filas `delivery_pricing` y `enforcement` que ya escribía el trigger.
--   · Las RPC auditadas: siguen escribiendo UNA fila por cambio, la suya.
--   · Ningún dato de `businesses`.
--
-- Forward-only.
-- Reversión: docs/migrations/rollback/20261001224000_business_direct_write_audit_and_currency_lock.rollback.sql

-- ── 1. Los ámbitos nuevos de la auditoría ───────────────────────────────────
-- Se SUMAN a los que el CHECK ya admite, leyéndolos del CHECK vigente: si otra
-- migración agregó un ámbito antes que ésta, no se lo pisa con una lista escrita a
-- mano.
do $scopes$
declare
  v_scopes text;
begin
  -- Se escribe como `array['a', 'b', ...]`, la misma forma que usan las migraciones
  -- anteriores: así el CHECK se puede volver a leer y ampliar del mismo modo.
  select string_agg(quote_literal(s.scope), ', ' order by s.scope)
    into v_scopes
    from (
      select m[1] as scope
        from pg_constraint c
        cross join lateral regexp_matches(pg_get_constraintdef(c.oid), '''([a-z_]+)''', 'g') as m
       where c.conrelid = 'public.business_config_audit'::regclass
         and c.conname = 'business_config_audit_scope_check'
      union
      select unnest(array['alcohol', 'abuse_limits', 'currency'])
    ) s;

  alter table public.business_config_audit drop constraint if exists business_config_audit_scope_check;
  execute format(
    'alter table public.business_config_audit add constraint business_config_audit_scope_check check (scope = any (array[%s]))',
    v_scopes);
end
$scopes$;

-- ── 2. El trigger que ya existía: tres ámbitos más ──────────────────────────
create or replace function public.audit_business_commercial_change()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_actor uuid := auth.uid();
  v_pricing_changed boolean;
  v_enforcement_changed boolean;
  v_alcohol_changed boolean;
  v_limits_changed boolean;
begin
  v_pricing_changed :=
    new.delivery_fee is distinct from old.delivery_fee
    or new.minimum_delivery_subtotal is distinct from old.minimum_delivery_subtotal
    or new.delivery_max_radius_meters is distinct from old.delivery_max_radius_meters;
  v_enforcement_changed :=
    new.hours_enforced is distinct from old.hours_enforced
    or new.delivery_zone_enforced is distinct from old.delivery_zone_enforced
    or new.alcohol_hours_enforced is distinct from old.alcohol_hours_enforced
    or new.operating_timezone is distinct from old.operating_timezone;
  v_alcohol_changed :=
    new.alcohol_sales_enabled is distinct from old.alcohol_sales_enabled
    or new.alcohol_minimum_age is distinct from old.alcohol_minimum_age
    or new.alcohol_sales_start is distinct from old.alcohol_sales_start
    or new.alcohol_sales_end is distinct from old.alcohol_sales_end
    or new.alcohol_timezone is distinct from old.alcohol_timezone;
  v_limits_changed :=
    new.order_rate_limit_per_10_minutes is distinct from old.order_rate_limit_per_10_minutes
    or new.max_pending_orders_per_customer is distinct from old.max_pending_orders_per_customer
    or new.stock_reservation_minutes is distinct from old.stock_reservation_minutes
    or new.abandoned_order_minutes is distinct from old.abandoned_order_minutes
    or new.captcha_required is distinct from old.captcha_required
    or new.order_ip_rate_limit_per_10_minutes is distinct from old.order_ip_rate_limit_per_10_minutes
    or new.max_pending_orders_per_ip is distinct from old.max_pending_orders_per_ip
    or new.order_business_rate_limit_per_10_minutes is distinct from old.order_business_rate_limit_per_10_minutes
    or new.max_units_per_unpaid_order is distinct from old.max_units_per_unpaid_order
    or new.order_intake_guard_mode is distinct from old.order_intake_guard_mode;

  if v_pricing_changed then
    insert into public.business_config_audit (business_id, scope, action, actor_kind, actor_id, before, after)
    values (
      new.id, 'delivery_pricing', 'updated',
      case when v_actor is null then 'service' else 'user' end, v_actor,
      jsonb_build_object(
        'delivery_fee', old.delivery_fee,
        'minimum_delivery_subtotal', old.minimum_delivery_subtotal,
        'delivery_max_radius_meters', old.delivery_max_radius_meters),
      jsonb_build_object(
        'delivery_fee', new.delivery_fee,
        'minimum_delivery_subtotal', new.minimum_delivery_subtotal,
        'delivery_max_radius_meters', new.delivery_max_radius_meters)
    );
  end if;

  if v_enforcement_changed then
    insert into public.business_config_audit (business_id, scope, action, actor_kind, actor_id, before, after)
    values (
      new.id, 'enforcement',
      case
        when (new.hours_enforced and not old.hours_enforced)
          or (new.delivery_zone_enforced and not old.delivery_zone_enforced)
          or (new.alcohol_hours_enforced and not old.alcohol_hours_enforced) then 'enabled'
        when (old.hours_enforced and not new.hours_enforced)
          or (old.delivery_zone_enforced and not new.delivery_zone_enforced)
          or (old.alcohol_hours_enforced and not new.alcohol_hours_enforced) then 'disabled'
        else 'updated'
      end,
      case when v_actor is null then 'service' else 'user' end, v_actor,
      jsonb_build_object(
        'hours_enforced', old.hours_enforced,
        'delivery_zone_enforced', old.delivery_zone_enforced,
        'alcohol_hours_enforced', old.alcohol_hours_enforced,
        'operating_timezone', old.operating_timezone),
      jsonb_build_object(
        'hours_enforced', new.hours_enforced,
        'delivery_zone_enforced', new.delivery_zone_enforced,
        'alcohol_hours_enforced', new.alcohol_hours_enforced,
        'operating_timezone', new.operating_timezone)
    );
  end if;

  -- Habilitar el alcohol depende de una licencia: tiene que poder decirse quién lo
  -- hizo y cuándo.
  if v_alcohol_changed then
    insert into public.business_config_audit (business_id, scope, action, actor_kind, actor_id, before, after)
    values (
      new.id, 'alcohol',
      case
        when new.alcohol_sales_enabled and not old.alcohol_sales_enabled then 'enabled'
        when old.alcohol_sales_enabled and not new.alcohol_sales_enabled then 'disabled'
        else 'updated'
      end,
      case when v_actor is null then 'service' else 'user' end, v_actor,
      jsonb_build_object(
        'alcohol_sales_enabled', old.alcohol_sales_enabled,
        'alcohol_minimum_age', old.alcohol_minimum_age,
        'alcohol_sales_start', old.alcohol_sales_start,
        'alcohol_sales_end', old.alcohol_sales_end,
        'alcohol_timezone', old.alcohol_timezone),
      jsonb_build_object(
        'alcohol_sales_enabled', new.alcohol_sales_enabled,
        'alcohol_minimum_age', new.alcohol_minimum_age,
        'alcohol_sales_start', new.alcohol_sales_start,
        'alcohol_sales_end', new.alcohol_sales_end,
        'alcohol_timezone', new.alcohol_timezone)
    );
  end if;

  -- Los topes contra el abuso se pueden aflojar hasta dejarlos en nada: el cambio
  -- queda escrito con todos sus valores.
  if v_limits_changed then
    insert into public.business_config_audit (business_id, scope, action, actor_kind, actor_id, before, after)
    values (
      new.id, 'abuse_limits', 'updated',
      case when v_actor is null then 'service' else 'user' end, v_actor,
      jsonb_build_object(
        'order_rate_limit_per_10_minutes', old.order_rate_limit_per_10_minutes,
        'max_pending_orders_per_customer', old.max_pending_orders_per_customer,
        'stock_reservation_minutes', old.stock_reservation_minutes,
        'abandoned_order_minutes', old.abandoned_order_minutes,
        'captcha_required', old.captcha_required,
        'order_ip_rate_limit_per_10_minutes', old.order_ip_rate_limit_per_10_minutes,
        'max_pending_orders_per_ip', old.max_pending_orders_per_ip,
        'order_business_rate_limit_per_10_minutes', old.order_business_rate_limit_per_10_minutes,
        'max_units_per_unpaid_order', old.max_units_per_unpaid_order,
        'order_intake_guard_mode', old.order_intake_guard_mode),
      jsonb_build_object(
        'order_rate_limit_per_10_minutes', new.order_rate_limit_per_10_minutes,
        'max_pending_orders_per_customer', new.max_pending_orders_per_customer,
        'stock_reservation_minutes', new.stock_reservation_minutes,
        'abandoned_order_minutes', new.abandoned_order_minutes,
        'captcha_required', new.captcha_required,
        'order_ip_rate_limit_per_10_minutes', new.order_ip_rate_limit_per_10_minutes,
        'max_pending_orders_per_ip', new.max_pending_orders_per_ip,
        'order_business_rate_limit_per_10_minutes', new.order_business_rate_limit_per_10_minutes,
        'max_units_per_unpaid_order', new.max_units_per_unpaid_order,
        'order_intake_guard_mode', new.order_intake_guard_mode)
    );
  end if;

  if new.currency_code is distinct from old.currency_code then
    insert into public.business_config_audit (business_id, scope, action, actor_kind, actor_id, before, after)
    values (
      new.id, 'currency', 'updated',
      case when v_actor is null then 'service' else 'user' end, v_actor,
      jsonb_build_object('currency_code', old.currency_code),
      jsonb_build_object('currency_code', new.currency_code)
    );
  end if;

  return new;
end;
$$;

revoke all on function public.audit_business_commercial_change() from public, anon, authenticated;

-- ── 3. La escritura directa de lo que las RPC ya auditan ────────────────────
create or replace function public.audit_business_direct_write()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_actor uuid := auth.uid();
  v_kind text := case when auth.uid() is null then 'service' else 'user' end;
begin
  if new.status is distinct from old.status
     or new.is_active is distinct from old.is_active
     or new.ordering_enabled is distinct from old.ordering_enabled then
    insert into public.business_config_audit (business_id, scope, action, actor_kind, actor_id, before, after)
    values (
      new.id, 'open_state', 'updated', v_kind, v_actor,
      jsonb_build_object('status', old.status, 'is_active', old.is_active, 'ordering_enabled', old.ordering_enabled),
      jsonb_build_object('status', new.status, 'is_active', new.is_active, 'ordering_enabled', new.ordering_enabled)
    );
  end if;

  if new.delivery_enabled is distinct from old.delivery_enabled
     or new.pickup_enabled is distinct from old.pickup_enabled then
    insert into public.business_config_audit (business_id, scope, action, actor_kind, actor_id, before, after)
    values (
      new.id, 'fulfillment', 'updated', v_kind, v_actor,
      jsonb_build_object('delivery_enabled', old.delivery_enabled, 'pickup_enabled', old.pickup_enabled),
      jsonb_build_object('delivery_enabled', new.delivery_enabled, 'pickup_enabled', new.pickup_enabled)
    );
  end if;

  if new.name is distinct from old.name
     or new.address is distinct from old.address
     or new.phone is distinct from old.phone then
    insert into public.business_config_audit (business_id, scope, action, actor_kind, actor_id, before, after)
    values (
      new.id, 'contact', 'updated', v_kind, v_actor,
      jsonb_build_object('name', old.name, 'address', old.address, 'phone', old.phone),
      jsonb_build_object('name', new.name, 'address', new.address, 'phone', new.phone)
    );
  end if;

  return new;
end;
$$;

revoke all on function public.audit_business_direct_write() from public, anon, authenticated;

drop trigger if exists businesses_audit_direct_write on public.businesses;
create trigger businesses_audit_direct_write
  after update on public.businesses
  for each row
  when (current_user in ('anon', 'authenticated', 'service_role'))
  execute function public.audit_business_direct_write();

comment on function public.audit_business_direct_write() is
  'Audita la escritura directa (rol de la API) de estado, entrega y datos del local. Las RPC que escriben esas columnas auditan por su cuenta y no disparan este trigger.';

-- ── 4. La moneda de un comercio verificado ──────────────────────────────────
create or replace function public.guard_business_currency_code()
returns trigger
language plpgsql
set search_path = pg_catalog, public, pg_temp
as $$
begin
  raise exception 'la moneda de un comercio con pedidos verificados no se cambia'
    using errcode = '55000',
          detail = format('currency_code %s -> %s', old.currency_code, coalesce(new.currency_code, 'NULL')),
          hint = 'revocar primero la verificacion de pedidos del comercio';
end;
$$;

revoke all on function public.guard_business_currency_code() from public, anon, authenticated;

-- Compara columnas, no `UPDATE OF`: también frena un valor que otro trigger BEFORE
-- haya cambiado en el camino.
drop trigger if exists businesses_lock_verified_currency on public.businesses;
create trigger businesses_lock_verified_currency
  before update on public.businesses
  for each row
  when (old.ordering_verified and new.currency_code is distinct from old.currency_code)
  execute function public.guard_business_currency_code();

comment on function public.guard_business_currency_code() is
  'La moneda queda fija mientras ordering_verified sea verdadero: los pedidos ya tomados estan rotulados con ella.';
