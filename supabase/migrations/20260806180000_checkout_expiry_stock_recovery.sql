-- El stock reservado por un checkout abandonado vuelve solo.
--
-- Medido el 2026-08-06 sobre la-taba-staging: 4 sesiones `redirected` ya
-- vencidas retenían 4 reservas `active`, con el stock del producto descontado.
-- `expire_checkout_sessions` existía y cubría exactamente ese estado, pero
-- **nadie la llamaba**: no había cron, ni trigger, ni worker. Cada comprador que
-- abre Mercado Pago y no paga descontaba stock para siempre. Con 10 productos y
-- una expiración de 15 minutos, un día de tráfico deja el catálogo en cero sin
-- haber vendido nada.
--
-- El outbox de pagos ya tenía su cron (20260803120000). Esto le da a la
-- recuperación de inventario la misma clase de garantía.

create extension if not exists pg_cron with schema pg_catalog;

create or replace function public.sweep_expired_checkout_sessions()
returns integer
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_released integer;
begin
  -- `expire_checkout_sessions` toma las sesiones con `for update skip locked`,
  -- así que dos barridos concurrentes no se pisan ni bloquean un checkout vivo.
  v_released := public.expire_checkout_sessions(200);
  return coalesce(v_released, 0);
end;
$$;

do $$
begin
  perform cron.schedule(
    'taba-checkout-expiry-sweep',
    '* * * * *',
    'select public.sweep_expired_checkout_sessions();'
  );
end;
$$;

-- ===== Alerta operativa: reserva huérfana =====
-- Si una reserva sigue `active` mucho después de vencida, el barrido no está
-- corriendo y el stock se está drenando en silencio. Eso tiene que ser visible
-- antes de que el negocio descubra que no puede vender.
create or replace function public.list_stock_reservation_alerts()
returns table (
  severity text,
  checkout_session_id uuid,
  product_id uuid,
  quantity integer,
  expired_for interval,
  state text,
  action text
)
language sql
stable
security definer
set search_path = pg_catalog, public, pg_temp
as $$
  select
    case when r.expires_at < clock_timestamp() - interval '30 minutes' then 'critical' else 'warning' end,
    r.checkout_session_id,
    r.product_id,
    r.quantity,
    clock_timestamp() - r.expires_at,
    'stock_reservation_not_released',
    'verify_taba_checkout_expiry_sweep_cron_then_run_sweep_expired_checkout_sessions'
  from public.inventory_reservations r
  where r.status = 'active'
    and r.expires_at < clock_timestamp() - interval '5 minutes'
  order by r.expires_at;
$$;

revoke all on function public.sweep_expired_checkout_sessions() from public, anon, authenticated;
grant execute on function public.sweep_expired_checkout_sessions() to service_role;
revoke all on function public.list_stock_reservation_alerts() from public, anon, authenticated;
grant execute on function public.list_stock_reservation_alerts() to service_role;

comment on function public.sweep_expired_checkout_sessions() is
  'Libera el stock de los checkouts vencidos; agendada cada minuto por pg_cron.';
comment on function public.list_stock_reservation_alerts() is
  'Reservas de stock vencidas y no liberadas: señal de que el barrido no está corriendo.';
