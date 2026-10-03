-- Reversión de 20261003091000_operation_center_counts_provider_notification_jobs.sql
--
-- Devuelve get_production_operation_center a su definición anterior, letra por letra, con los mismos permisos y
-- comentario. No toca filas. Se niega si otra migración la redefinió después (acepta el cuerpo de 20261003091000 o
-- el anterior, así que correrla dos veces no falla).
begin;

select pg_catalog.pg_advisory_xact_lock(
  pg_catalog.hashtextextended('la-taba:rollback:20261003091000', 0)
);

do $redefinition_guard$
declare
  v_actual text;
begin
  select md5(replace(p.prosrc, E'\r', '')) into v_actual from pg_proc p where p.oid = to_regprocedure('public.get_production_operation_center(uuid)');
  if v_actual is null or v_actual not in ('e0c74086c1967e1964df8f8f2577f884', '9d97a883dc143aeaec4832aeb6caaef0') then
    raise exception 'ROLLBACK_BLOCKED: public.get_production_operation_center(uuid) no tiene el cuerpo esperado; otra migración la redefinió'
      using errcode = 'P0001';
  end if;
end
$redefinition_guard$;

CREATE OR REPLACE FUNCTION public.get_production_operation_center(p_business_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
declare
  v_result jsonb;
begin
  if not public.has_business_role(p_business_id,array['owner','admin','staff']) then
    raise exception 'operador no autorizado' using errcode='42501';
  end if;
  perform public.refresh_operational_alerts(p_business_id);
  select jsonb_build_object(
    'generated_at',clock_timestamp(),
    'business_id',p_business_id,
    'metrics',jsonb_build_object(
      'new_orders',(select count(*) from public.orders o where o.business_id=p_business_id and o.status in ('submitted','received') and o.created_at>=clock_timestamp()-interval '24 hours'),
      'delayed_orders',(select count(*) from public.orders o where o.business_id=p_business_id and o.status not in ('delivered','canceled','cancelled','rejected') and coalesce(o.acknowledged_at,o.created_at)+make_interval(mins=>coalesce(o.preparation_estimate_minutes,30))<clock_timestamp()),
      'pending_payments',(select count(*) from public.payment_intents pi where pi.business_id=p_business_id and pi.internal_status in ('created','preference_creating','preference_created','redirected','pending','in_process')),
      'payments_in_review',(select count(*) from public.payment_intents pi where pi.business_id=p_business_id and pi.internal_status in ('ambiguous','security_review_required','approved_order_pending')),
      'orders_without_stock',(select count(*) from public.checkout_sessions cs where cs.business_id=p_business_id and cs.status='manual_review_required' and coalesce(cs.manual_review_reason,'') like '%reservation%'),
      'packing_incomplete',(select count(*) from public.order_packing_sessions ps where ps.business_id=p_business_id and ps.status in ('not_started','in_progress','complete','exception_required')),
      'active_deliveries',(select count(*) from public.orders o where o.business_id=p_business_id and o.status in ('assigned','picked_up','on_the_way','arrived')),
      'riders_without_signal',(select count(*) from public.operational_alerts a where a.business_id=p_business_id and a.alert_code='RIDER_SIGNAL_STALE' and a.status<>'resolved'),
      'fiscal_documents_pending',(select count(*) from public.fiscal_documents fd where fd.business_id=p_business_id and (fd.state in ('draft','queued','claiming','authenticating','authorizing','ambiguous','retry_wait','failed') or (fd.state='authorized' and fd.artifact_state<>'artifact_ready'))),
      'failed_prints',(select count(*) from public.fiscal_print_jobs pj where pj.business_id=p_business_id and pj.status in ('failed','unknown')),
      'pending_credit_notes',(select count(*) from public.fiscal_documents fd where fd.business_id=p_business_id and fd.document_intent='credit_note' and (fd.state<>'authorized' or fd.artifact_state<>'artifact_ready')),
      'blocked_outboxes',(
        (select count(*) from public.payment_outbox po join public.payment_intents pi on pi.id=po.payment_intent_id where pi.business_id=p_business_id and po.status in ('failed','dead_letter'))
        +(select count(*) from public.fiscal_outbox fo join public.fiscal_documents fd on fd.id=fo.fiscal_document_id where fd.business_id=p_business_id and fo.state='dead_letter')
        +(select count(*) from public.fiscal_artifact_outbox fao join public.fiscal_documents fd on fd.id=fao.fiscal_document_id where fd.business_id=p_business_id and fao.state='dead_letter')
      ),
      'reconciliations_required',(
        (select count(*) from public.payment_intents pi where pi.business_id=p_business_id and pi.internal_status in ('ambiguous','security_review_required','approved_order_pending'))
        +(select count(*) from public.payment_refunds pr join public.payment_intents pi on pi.id=pr.payment_intent_id where pi.business_id=p_business_id and pr.status='ambiguous')
        +(select count(*) from public.payment_cancellations pc join public.payment_intents pi on pi.id=pc.payment_intent_id where pi.business_id=p_business_id and pc.status='ambiguous')
        +(select count(*) from public.fiscal_documents fd where fd.business_id=p_business_id and fd.state='ambiguous')
      )
    ),
    'alerts',coalesce((select jsonb_agg(jsonb_build_object(
      'id',a.id,'severity',a.severity,'code',a.alert_code,'status',a.status,
      'summary',a.summary,'required_action',a.required_action,
      'subject_type',a.subject_type,'subject_id',a.subject_id,
      'correlation_id',a.correlation_id,'last_seen_at',a.last_seen_at,
      'occurrence_count',a.occurrence_count
    ) order by case a.severity when 'CRITICAL' then 1 when 'ACTION_REQUIRED' then 2 when 'WARNING' then 3 else 4 end,a.last_seen_at desc)
      from public.operational_alerts a where a.business_id=p_business_id and a.status<>'resolved'),'[]'::jsonb),
    'recent_closures',coalesce((select jsonb_agg(to_jsonb(r) order by r.business_date desc)
      from (select id,business_date,status,revision,declared_cash,expected_cash,cash_difference,difference_note,open_alerts,critical_alerts,snapshot_sha256,prepared_at,closed_at
        from public.daily_reconciliations where business_id=p_business_id order by business_date desc limit 14) r),'[]'::jsonb),
    'health',public.build_operational_health(p_business_id)
  ) into v_result;
  return v_result;
end;
$function$;

comment on function public.get_production_operation_center(uuid) is
  'Estado autoritativo del Centro de operacion, ahora con la salud operativa medida en el mismo viaje.';

commit;
