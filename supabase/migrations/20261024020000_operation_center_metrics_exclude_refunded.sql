-- ============================================================================
--  Centro de operación: un pedido con el pago devuelto no es «nuevo» ni «demorado».
-- ============================================================================
--
--  20261024010000 sacó a esos pedidos de ORDER_NOT_ACCEPTED y ORDER_STALLED y los
--  avisa como ORDER_PAYMENT_REVERSED_OPEN («cancelalo»). Las tarjetas del centro
--  de operación seguían contándolos como «Pedidos nuevos — esperan que los
--  aceptes» y «Pedidos demorados — pasaron del tiempo que prometiste» (en rojo):
--  medido en el preview de QA el 24/10 con LT-0087, dos órdenes contradictorias
--  para el mismo pedido. Se excluyen de esas dos métricas; siguen contando en
--  «Pedidos que necesitan una persona», que es lo que son.
--
--  Sólo cambia qué se cuenta. Falla cerrado si el texto desplegado no es el esperado.
--  Rollback: docs/migrations/rollback/20261024020000_operation_center_metrics_exclude_refunded.rollback.sql
-- ============================================================================
do $$
declare
  v_def text;
  v_new text;
  v_new_orders constant text := E'and o.status in (''submitted'',''received'') and o.created_at>=clock_timestamp()-interval ''24 hours''),\n';
  v_delayed constant text := E'and coalesce(o.acknowledged_at,o.created_at)+make_interval(mins=>coalesce(o.preparation_estimate_minutes,30))<clock_timestamp()),\n';
  v_guard constant text := ' and not public.order_payment_is_financially_reversed(o.id)';
begin
  v_def := pg_get_functiondef('public.get_production_operation_center(uuid)'::regprocedure);
  if (length(v_def) - length(replace(v_def, v_new_orders, ''))) / length(v_new_orders) <> 1
    or (length(v_def) - length(replace(v_def, v_delayed, ''))) / length(v_delayed) <> 1 then
    raise exception 'OPERATION_CENTER_METRICS_PATTERN_MISMATCH';
  end if;
  v_new := replace(v_def, v_new_orders, replace(v_new_orders, E'),\n', v_guard || E'),\n'));
  v_new := replace(v_new, v_delayed, replace(v_delayed, E'),\n', v_guard || E'),\n'));
  execute v_new;
end $$;
