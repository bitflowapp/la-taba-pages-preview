-- Rollback de 20260926160000: apaga la impresión del mostrador.
--
-- Qué hace: saca los triggers de impresión automática (pedidos y comprobantes
-- fiscales dejan de encolar), retira todas las RPC del Panel, del agente y del
-- operador, y los helpers privados. Desde ese momento ningún agente puede
-- autenticarse ni reclamar nada: la gateway recibe «function does not exist».
--
-- Qué NO hace: no borra local_devices, print_jobs ni print_job_events. Son
-- evidencia durable (qué se imprimió, quién reimprimió y por qué) y la
-- auditoría es inmutable por diseño. Quedan sin grants para anon y
-- authenticated. El ámbito 'printing' de business_config_audit también se
-- conserva: es un superconjunto del anterior y no habilita nada por sí mismo.
--
-- Pedidos, pagos, stock y el contrato fiscal no dependen de estas tablas: el
-- rollback no los toca.
begin;

drop trigger if exists orders_enqueue_print_jobs on public.orders;
drop trigger if exists fiscal_documents_enqueue_print_job on public.fiscal_documents;

drop function if exists public.create_local_device_pairing(uuid, text);
drop function if exists public.revoke_local_device(uuid, text);
drop function if exists public.get_local_print_status(uuid);
drop function if exists public.configure_business_print_settings(uuid, jsonb);
drop function if exists public.request_order_print_job(uuid, text, text);
drop function if exists public.request_print_job_reprint(uuid, text, text);
drop function if exists public.resolve_print_job_review(uuid, text, text);
drop function if exists public.cancel_print_job(uuid, text);
drop function if exists public.agent_register_device(text, text, text, text, text);
drop function if exists public.agent_heartbeat(uuid, text, jsonb);
drop function if exists public.agent_claim_print_jobs(uuid, text, text[], integer);
drop function if exists public.agent_update_print_job(uuid, text, uuid, uuid, text, text, integer);
drop function if exists public.agent_request_reprint(uuid, text, uuid, text, text, text);
drop function if exists public.agent_rotate_device_secret(uuid, text, text);
drop function if exists public.operator_create_local_device_pairing(uuid, text);
drop function if exists public.operator_revoke_local_device(uuid, text);

drop function if exists private.orders_enqueue_print_jobs();
drop function if exists private.fiscal_documents_enqueue_print_job();
drop function if exists private.local_device_revoke(uuid, text, uuid, text);
drop function if exists private.print_request_reprint(uuid, uuid, text, text, text, uuid, text, uuid, text);
drop function if exists private.print_expire_leases(uuid);
drop function if exists private.print_enqueue(uuid, text, uuid, jsonb, text, uuid, text, uuid, text, text, uuid);
drop function if exists private.fiscal_receipt_print_payload(uuid);
drop function if exists private.fiscal_qr_url(public.fiscal_documents);
drop function if exists private.fiscal_compact_json(text);
drop function if exists private.fiscal_voucher_label(integer);
drop function if exists private.order_print_payload(uuid, text);
drop function if exists private.print_payment_label(text, text, text);
drop function if exists private.print_job_log(public.print_jobs, text, text, uuid, uuid, text, jsonb);
drop function if exists private.local_device_authenticate(uuid, text);
drop function if exists private.local_device_create_pairing(uuid, text, uuid, text);
drop function if exists private.local_device_normalize_code(text);
drop function if exists private.local_device_pairing_code();

-- Los triggers de protección siguen: nadie inserta un ticket fiscal sin CAE ni
-- edita la auditoría aunque las tablas queden huérfanas.
revoke all on table public.local_devices, public.local_device_pairings, public.business_print_settings,
  public.print_jobs, public.print_job_events from anon, authenticated;

-- Sin agentes activos: una credencial vieja no vuelve a servir si la función
-- se restaura más tarde.
update public.local_devices
   set status = 'revoked', revoked_at = coalesce(revoked_at, now()), revoke_reason = coalesce(revoke_reason, 'rollback 20260926160000'),
       secret_hash = null, pending_secret_hash = null
 where status = 'active';

commit;
