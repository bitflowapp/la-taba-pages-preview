-- Verificación previa de la migración 20261003090000 (PAY-PROBE-02 y PAY-PROBE-03: un checkout sin verificar, o
-- con un pago que el proveedor no resolvió, no se cierra por tiempo).
--
-- SÓLO LECTURA: no cambia nada. Se corre en cada entorno ANTES de aplicar la migración y otra vez DESPUÉS, y se
-- guardan las dos salidas, igual que las verificaciones de 20261001 y 20261002. No usa ninguna tabla, columna ni
-- función nueva: corre igual en los dos momentos.
--
-- La migración no borra ni reescribe filas: escribe su marca de agua («ahora menos 48 horas») y cambia reglas.
-- Las consultas dicen QUÉ checkouts quedan vigilados pasadas las 48 horas por haber estado dentro de la ventana al
-- aplicarla, y qué historia queda afuera (la sigue mostrando scripts/payments/reconcile-payments.mjs).
--
--   node scripts/release/run-readonly-checks.mjs --target staging|controlled-production \
--     --file docs/migrations/checks/20261003_unverified_checkout_preflight.sql --out <privado>/preflight-3.json
--
-- Cada consulta es una sola sentencia y devuelve una columna `finding` con su nombre.

-- U1. INFORMATIVA. Checkouts que llegaron a Mercado Pago, vencieron, no tienen pago del proveedor y no tienen un
--     vacío concluyente, DENTRO de las 48 horas: con la migración, su alerta CHECKOUT_PROVIDER_UNVERIFIED ya no se
--     cierra sola al cumplir las 48 horas.
select 'unverified_checkouts_inside_window' as finding, pi.business_id, b.slug, pi.environment,
       count(*) as intents, min(cs.created_at) as oldest
  from public.payment_intents pi
  join public.checkout_sessions cs on cs.id = pi.checkout_session_id
  join public.businesses b on b.id = pi.business_id
 where pi.order_id is null
   and cs.completed_order_id is null
   and nullif(btrim(coalesce(pi.preference_id, '')), '') is not null
   and pi.provider_payment_id is null
   and pi.internal_status in ('expired', 'redirected', 'pending', 'in_process', 'preference_created')
   and cs.created_at > clock_timestamp() - interval '48 hours'
   and not exists (
     select 1 from public.payment_events pe
      where pe.payment_intent_id = pi.id
        and pe.event_type = 'payment.provider_probe_empty'
        and coalesce((pe.details ->> 'conclusive')::boolean, true)
   )
 group by pi.business_id, b.slug, pi.environment
 order by b.slug, pi.environment;

-- U2. Pagos del proveedor sin resultado final (pending, in_process, authorized) sobre checkouts sin pedido, por
--     antigüedad. Los de menos de 48 horas quedan vigilados con la migración (aunque la sonda haya anotado un
--     vacío antes del pago: con un pago guardado, un vacío no prueba nada); los anteriores a la marca de agua NO
--     abren alerta: una fila «older_than_48h» es un cobro que alguien tiene que mirar en Mercado Pago a mano.
select 'provider_payments_without_final_result' as finding, pi.business_id, b.slug, pi.environment,
       pi.provider_status,
       case when cs.created_at > clock_timestamp() - interval '48 hours' then 'inside_48h' else 'older_than_48h' end as age,
       count(*) as intents, min(cs.created_at) as oldest
  from public.payment_intents pi
  join public.checkout_sessions cs on cs.id = pi.checkout_session_id
  join public.businesses b on b.id = pi.business_id
 where pi.order_id is null
   and cs.completed_order_id is null
   and pi.provider_payment_id is not null
   and pi.provider_status in ('pending', 'in_process', 'authorized')
 group by pi.business_id, b.slug, pi.environment, pi.provider_status,
          case when cs.created_at > clock_timestamp() - interval '48 hours' then 'inside_48h' else 'older_than_48h' end
 order by b.slug, pi.environment, pi.provider_status;

-- U3. INFORMATIVA. Alertas CHECKOUT_PROVIDER_UNVERIFIED que el sistema cerró solo (sin autor), según lo que hay
--     HOY en su cobro. Cerró con una prueba si hay pedido, un pago con resultado final del proveedor, un vacío
--     concluyente sin pago guardado, o el cobro salió de los estados vigilados; «sin_prueba» es el final
--     silencioso que la migración corrige. Antes de aplicarla puede haber filas «sin_prueba»: son la historia (la
--     muestra la conciliación). Después no tiene que aparecer ninguna «sin_prueba» nueva de un checkout creado
--     después de la marca de agua (la hora de aplicación menos 48 horas): comparar `last_closed` y
--     `newest_checkout` de esa fila entre la salida de antes y la de después. Las demás clases sí crecen: son
--     cierres con prueba.
select 'unverified_alerts_closed_by_the_system' as finding, a.business_id, b.slug,
       case
         when pi.id is null then 'sin_cobro'
         when pi.order_id is not null or cs.completed_order_id is not null then 'pedido'
         when pi.provider_payment_id is not null
              and coalesce(pi.provider_status, '') not in ('pending', 'in_process', 'authorized')
           then 'pago_con_resultado_final'
         when pi.internal_status not in ('expired', 'redirected', 'pending', 'in_process', 'preference_created')
           then 'cobro_fuera_de_los_estados_vigilados'
         when pi.provider_payment_id is null and exists (
           select 1 from public.payment_events pe
            where pe.payment_intent_id = pi.id
              and pe.event_type = 'payment.provider_probe_empty'
              and coalesce((pe.details ->> 'conclusive')::boolean, true)
         ) then 'vacio_concluyente'
         else 'sin_prueba'
       end as closed_with,
       count(*) as alerts, max(a.resolved_at) as last_closed, max(cs.created_at) as newest_checkout
  from public.operational_alerts a
  join public.businesses b on b.id = a.business_id
  left join public.payment_intents pi on pi.id = a.subject_id
  left join public.checkout_sessions cs on cs.id = pi.checkout_session_id
 where a.alert_code = 'CHECKOUT_PROVIDER_UNVERIFIED'
   and a.status = 'resolved'
   and a.resolved_by is null
 group by a.business_id, b.slug, closed_with
 order by b.slug, closed_with;
