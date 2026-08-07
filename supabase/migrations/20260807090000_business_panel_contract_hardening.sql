-- Endurecimiento del contrato del Panel del negocio.
--
-- Cada bloque cierra un hueco medido en la auditoría del Panel contra las
-- migraciones reales; ninguno cambia la semántica de un flujo que funciona.
--
-- 1. Los RPC de packing superseded seguían ejecutables: permitían confirmar o
--    deshacer sin receipt ni request_hash, salteando la idempotencia que el
--    Panel garantiza por la outbox durable.
-- 2. Los artefactos fiscales se listaban y autorizaban con `is_business_member`
--    a secas: un rider activo podía listar comprobantes y obtener la URL
--    firmada del PDF. El resto del módulo fiscal exige rol explícito.
-- 3. `configure_fiscal_profile` aceptaba `default_concept` nulo o fuera de
--    (1,2,3); el error recién explotaba como constraint crudo al emitir.
-- 4. `publish_catalog_product_draft` pasaba `p_package_type` sin validar al
--    insert; el operador recibía un error de constraint en vez de un 22023.
-- 5. `transition_operational_alert` re-escribía actor y hora al repetir un
--    "Ya la vi": un reintento reatribuía el reconocimiento a otro operador.
-- 6. `set_business_open_state` dejaba que `staff` marque el negocio `closed`;
--    cerrar es una decisión comercial del mismo calibre que firmar el día.
-- 7. Las cuatro funciones de comandos del negocio rechazaban claves con `:`
--    mientras packing (20260802200000) y fiscal (20260802170000) las aceptan.
--    El Panel web generaba claves con `:`: TODA transición, cancelación,
--    reconocimiento y estimación de la UI moría en 22023. Se acepta el mismo
--    alfabeto que el resto de los receipts; el cliente además sanea a guiones.

-- ===== 1. Superseded packing: revocar ejecución =====

revoke execute on function public.confirm_packing_session(uuid, text) from public, anon, authenticated;
revoke execute on function public.undo_last_packing_scan(uuid) from public, anon, authenticated;

comment on function public.confirm_packing_session(uuid, text) is
  'SUPERSEDED por confirm_packing_session_once: sin receipts ni request_hash. Ejecución revocada.';
comment on function public.undo_last_packing_scan(uuid) is
  'SUPERSEDED por revert_packing_scan: sin receipts ni request_hash. Ejecución revocada.';

-- ===== 2. Artefactos fiscales: rol explícito, no membresía a secas =====

create or replace function public.list_fiscal_document_artifacts(p_business_id uuid)
returns table(
  fiscal_document_id uuid,
  artifact_id uuid,
  artifact_type text,
  artifact_state text,
  mime_type text,
  size_bytes bigint,
  sha256 text,
  document_number bigint,
  generated_at timestamptz,
  generation_version text,
  is_current boolean
)
language plpgsql
security definer
set search_path = pg_catalog, public, extensions, pg_temp
as $list_fiscal_document_artifacts$
begin
  if not public.has_business_role(p_business_id, array['owner', 'admin', 'staff']) then
    raise exception 'operador no autorizado' using errcode = '42501';
  end if;
  return query
  select a.fiscal_document_id, a.id, a.artifact_type, d.artifact_state, a.mime_type, a.size_bytes,
         a.sha256, a.document_number, a.generated_at, a.generation_version, a.is_current
  from public.fiscal_document_artifacts a
  join public.fiscal_documents d on d.id = a.fiscal_document_id
  where a.business_id = p_business_id and a.is_current
  order by a.generated_at desc;
end;
$list_fiscal_document_artifacts$;

create or replace function public.authorize_fiscal_artifact_access(
  p_artifact_id uuid,
  p_action text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, extensions, pg_temp
as $authorize_fiscal_artifact_access$
declare
  v_artifact public.fiscal_document_artifacts%rowtype;
begin
  if p_action not in ('preview','download','print') then raise exception 'accion de artefacto invalida' using errcode = '22023'; end if;
  select a.* into v_artifact from public.fiscal_document_artifacts a where a.id = p_artifact_id and a.is_current and a.state = 'artifact_ready';
  if not found then raise exception 'artefacto fiscal no disponible' using errcode = 'P0002'; end if;
  if not public.has_business_role(v_artifact.business_id, array['owner', 'admin', 'staff']) then
    raise exception 'operador no autorizado' using errcode = '42501';
  end if;
  insert into public.fiscal_events(fiscal_document_id, event_type, actor_type, actor_id, sanitized_detail)
  values(v_artifact.fiscal_document_id, concat('artifact_', p_action, '_authorized'), 'operator', auth.uid(), jsonb_build_object('artifact_id', v_artifact.id));
  return jsonb_build_object(
    'artifact_id', v_artifact.id,
    'mime_type', v_artifact.mime_type,
    'sha256', v_artifact.sha256,
    'expires_in_seconds', 60
  );
end;
$authorize_fiscal_artifact_access$;

-- ===== 3. Perfil fiscal: default_concept validado al configurar =====

create or replace function public.configure_fiscal_profile(
  p_business_id uuid,
  p_profile jsonb
)
returns public.fiscal_profiles
language plpgsql
security definer
set search_path = pg_catalog, public, extensions, pg_temp
as $configure_profile_hardened$
declare v_result public.fiscal_profiles%rowtype;
begin
  if not public.has_business_role(p_business_id,array['owner','admin']) then raise exception 'owner/admin requerido' using errcode='42501'; end if;
  if coalesce(p_profile,'{}'::jsonb)-array['legal_name','cuit','tax_condition','gross_income_number','business_address','environment','point_of_sale','default_currency','default_concept','invoice_policy','is_enabled','default_recipient_condition'] <> '{}'::jsonb then raise exception 'payload fiscal no permitido' using errcode='22023'; end if;
  if coalesce(p_profile->>'environment','disabled') not in ('disabled','homologation') then raise exception 'produccion no se configura desde el panel' using errcode='42501'; end if;
  -- El concepto por defecto entra validado o no entra: sin esto, un perfil con
  -- concepto nulo o fuera de (1,2,3) recién explota al emitir el comprobante.
  if coalesce((p_profile->>'default_concept')::integer, 1) not in (1, 2, 3) then
    raise exception 'concepto fiscal invalido (1=productos, 2=servicios, 3=mixto)' using errcode = '22023';
  end if;
  if (p_profile->>'is_enabled')::boolean and (
    coalesce(p_profile->>'environment','disabled')='disabled'
    or coalesce(p_profile->>'cuit','') !~ '^[0-9]{11}$'
    or coalesce((p_profile->>'point_of_sale')::integer,0) not between 1 and 99999
    or btrim(coalesce(p_profile->>'legal_name',''))=''
    or btrim(coalesce(p_profile->>'tax_condition',''))=''
    or btrim(coalesce(p_profile->>'default_recipient_condition',''))=''
  ) then raise exception 'perfil fiscal incompleto' using errcode='22023'; end if;
  insert into public.fiscal_profiles(business_id,legal_name,cuit,tax_condition,gross_income_number,business_address,environment,point_of_sale,default_currency,default_concept,invoice_policy,is_enabled,default_recipient_condition,updated_at)
  values(p_business_id,nullif(btrim(p_profile->>'legal_name'),''),nullif(regexp_replace(coalesce(p_profile->>'cuit',''),'[^0-9]','','g'),''),nullif(btrim(p_profile->>'tax_condition'),''),nullif(btrim(p_profile->>'gross_income_number'),''),nullif(btrim(p_profile->>'business_address'),''),coalesce(p_profile->>'environment','disabled'),(p_profile->>'point_of_sale')::integer,coalesce(nullif(btrim(p_profile->>'default_currency'),''),'PES'),coalesce((p_profile->>'default_concept')::integer, 1),coalesce(nullif(btrim(p_profile->>'invoice_policy'),''),'manual'),coalesce((p_profile->>'is_enabled')::boolean,false),nullif(btrim(p_profile->>'default_recipient_condition'),''),now())
  on conflict(business_id) do update set
    legal_name=excluded.legal_name,cuit=excluded.cuit,tax_condition=excluded.tax_condition,
    gross_income_number=excluded.gross_income_number,business_address=excluded.business_address,
    environment=excluded.environment,point_of_sale=excluded.point_of_sale,
    default_currency=excluded.default_currency,default_concept=excluded.default_concept,
    invoice_policy=excluded.invoice_policy,is_enabled=excluded.is_enabled,
    default_recipient_condition=excluded.default_recipient_condition,updated_at=now()
  returning * into v_result;
  return v_result;
end;
$configure_profile_hardened$;

-- ===== 4. Alta de producto: package_type validado con error saneado =====

create or replace function public.publish_catalog_product_draft(
  p_draft_id uuid,
  p_name text,
  p_category text,
  p_price numeric,
  p_package_type text,
  p_unit_factor integer
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, extensions, pg_temp
as $publish_draft_hardened$
declare
  v_draft public.catalog_product_drafts%rowtype;
  v_product public.products%rowtype;
  v_barcode_type text;
begin
  select d.* into v_draft from public.catalog_product_drafts d where d.id = p_draft_id for update;
  if not found then raise exception 'borrador inexistente' using errcode = 'P0002'; end if;
  if not public.has_business_role(v_draft.business_id, array['owner', 'admin']) then raise exception 'revision owner/admin requerida' using errcode = '42501'; end if;
  if v_draft.status <> 'pending_review' then raise exception 'borrador ya revisado' using errcode = 'P0001'; end if;
  if char_length(btrim(coalesce(p_name, ''))) not between 2 and 160 or char_length(btrim(coalesce(p_category, ''))) not between 2 and 80 or p_price < 0 or p_unit_factor < 1 then raise exception 'datos de producto invalidos' using errcode = '22023'; end if;
  -- Antes el valor viajaba sin filtrar al insert y el operador recibía el
  -- nombre del constraint de PostgreSQL en vez de un motivo operable.
  if coalesce(p_package_type, '') not in ('unit', 'pack', 'case', 'internal') then
    raise exception 'presentacion invalida (unit, pack, case o internal)' using errcode = '22023';
  end if;
  insert into public.products(business_id, name, category, price, stock, available, is_active, is_verified, catalog_origin)
  values (v_draft.business_id, btrim(p_name), btrim(p_category), p_price, 0, false, false, false, 'commercial')
  returning * into v_product;
  v_barcode_type := case length(v_draft.scanned_gtin) when 8 then 'EAN-8' when 12 then 'UPC-A' when 13 then 'EAN-13' else 'GTIN-14' end;
  insert into public.product_barcodes(business_id, product_id, gtin, barcode_type, package_type, unit_factor, is_primary, source, verified_at, created_by)
  values (v_draft.business_id, v_product.id, v_draft.scanned_gtin, v_barcode_type, p_package_type, p_unit_factor, true, 'manual', now(), auth.uid());
  update public.catalog_product_drafts set status = 'approved', reviewed_by = auth.uid(), reviewed_at = now(), product_id = v_product.id where id = v_draft.id;
  return jsonb_build_object('draft_id', v_draft.id, 'product_id', v_product.id, 'gtin', v_draft.scanned_gtin, 'published', false, 'requires_catalog_verification', true);
end;
$publish_draft_hardened$;

-- ===== 5. Alertas: el "Ya la vi" repetido no reatribuye el reconocimiento =====

create or replace function public.transition_operational_alert(
  p_alert_id uuid,
  p_target_status text,
  p_note text default null
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $transition_operational_alert$
declare
  v_alert public.operational_alerts%rowtype;
begin
  select * into v_alert
  from public.operational_alerts
  where id = p_alert_id
  for update;
  if not found then raise exception 'alerta inexistente' using errcode = 'P0002'; end if;
  if not public.has_business_role(v_alert.business_id, array['owner','admin','staff']) then
    raise exception 'operador no autorizado' using errcode = '42501';
  end if;
  if p_target_status not in ('acknowledged','resolved') then
    raise exception 'transicion de alerta invalida' using errcode = '22023';
  end if;
  if p_target_status = 'resolved' and char_length(btrim(coalesce(p_note, ''))) not between 5 and 500 then
    raise exception 'la resolucion requiere una nota' using errcode = '22023';
  end if;
  if v_alert.status = 'resolved' then
    return jsonb_build_object('ok', true, 'alert_id', v_alert.id, 'status', v_alert.status, 'idempotent_replay', true);
  end if;
  -- El reconocimiento registra QUIÉN la vio primero: un reintento (u otro
  -- operador repitiendo el gesto) no reescribe al actor ni la hora.
  if p_target_status = 'acknowledged' and v_alert.status = 'acknowledged' then
    return jsonb_build_object('ok', true, 'alert_id', v_alert.id, 'status', v_alert.status, 'idempotent_replay', true);
  end if;
  if p_target_status = 'acknowledged' then
    update public.operational_alerts
    set status = 'acknowledged', acknowledged_by = auth.uid(), acknowledged_at = clock_timestamp(), updated_at = clock_timestamp()
    where id = v_alert.id;
  else
    update public.operational_alerts
    set status = 'resolved', resolved_by = auth.uid(), resolved_at = clock_timestamp(), resolution_note = btrim(p_note), updated_at = clock_timestamp()
    where id = v_alert.id;
  end if;
  insert into public.operational_alert_events(business_id, alert_id, event_type, actor_id, detail)
  values (v_alert.business_id, v_alert.id, p_target_status, auth.uid(), jsonb_build_object('note', nullif(btrim(coalesce(p_note,'')),'')));
  return jsonb_build_object('ok', true, 'alert_id', v_alert.id, 'status', p_target_status, 'idempotent_replay', false);
end;
$transition_operational_alert$;

-- ===== 6. Cerrar el negocio lo firma el dueño o el encargado =====

create or replace function public.set_business_open_state(
  p_business_id uuid,
  p_status text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $set_business_open_state$
declare
  v_business public.businesses%rowtype;
begin
  if not public.has_business_role(p_business_id, array['owner', 'admin', 'staff']) then
    raise exception 'operador no autorizado' using errcode = '42501';
  end if;
  if p_status not in ('open', 'paused', 'closed') then
    raise exception 'estado de negocio invalido' using errcode = '22023';
  end if;
  -- Abrir o pausar es operación del día y lo puede hacer el equipo; cerrar el
  -- negocio es una decisión comercial del mismo calibre que firmar el cierre.
  if p_status = 'closed' and not public.has_business_role(p_business_id, array['owner', 'admin']) then
    raise exception 'cerrar el negocio requiere owner o admin' using errcode = '42501';
  end if;

  update public.businesses set status = p_status, updated_at = now()
   where id = p_business_id
  returning * into v_business;
  if not found then
    raise exception 'negocio inexistente' using errcode = 'P0002';
  end if;

  return jsonb_build_object('ok', true, 'status', v_business.status);
end;
$set_business_open_state$;

-- ===== 7. Claves de comando: mismo alfabeto que packing y fiscal =====
-- Fuente exacta de 20260802160000 (transition_order, cancel_order,
-- acknowledge_order, set_preparation_estimate); el ÚNICO cambio en cada una es
-- la clase de caracteres del regex de p_idempotency_key: se agrega ':'.

create or replace function public.transition_order(
  p_order_id uuid,
  p_expected_revision bigint,
  p_new_status text,
  p_idempotency_key text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, extensions, pg_temp
as $transition_idempotent$
declare
  v_order public.orders%rowtype;
  v_existing public.business_command_receipts%rowtype;
  v_hash text;
  v_result jsonb;
begin
  if auth.uid() is null then raise exception 'autenticacion requerida' using errcode = '42501'; end if;
  if btrim(coalesce(p_idempotency_key, '')) !~ '^[A-Za-z0-9:_-]{8,128}$' then raise exception 'idempotency_key invalida' using errcode = '22023'; end if;
  select o.* into v_order from public.orders o where o.id = p_order_id for update;
  if not found then raise exception 'pedido inexistente' using errcode = 'P0002'; end if;
  if not public.has_business_role(v_order.business_id, array['owner', 'admin', 'staff']) then raise exception 'operador no autorizado' using errcode = '42501'; end if;
  v_hash := public.business_command_request_hash('transition_order', p_order_id, jsonb_build_object('expected_revision', p_expected_revision, 'new_status', public.normalize_order_status_vocabulary(p_new_status)));
  select r.* into v_existing from public.business_command_receipts r where r.business_id = v_order.business_id and r.idempotency_key = p_idempotency_key;
  if found then
    if v_existing.request_hash <> v_hash then raise exception 'idempotency_key reutilizada con otro payload' using errcode = '23505'; end if;
    return v_existing.result || jsonb_build_object('idempotent_replay', true);
  end if;
  v_result := public.transition_order(p_order_id, p_expected_revision, p_new_status);
  insert into public.business_command_receipts(business_id, order_id, actor_user_id, command_type, idempotency_key, request_hash, result)
  values (v_order.business_id, p_order_id, auth.uid(), 'transition_order', p_idempotency_key, v_hash, v_result);
  return v_result || jsonb_build_object('idempotent_replay', false);
end;
$transition_idempotent$;

create or replace function public.cancel_order(
  p_order_id uuid,
  p_expected_revision bigint,
  p_reason text,
  p_idempotency_key text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, extensions, pg_temp
as $cancel$
declare
  v_order public.orders%rowtype;
  v_existing public.business_command_receipts%rowtype;
  v_hash text;
  v_result jsonb;
begin
  if auth.uid() is null then raise exception 'autenticacion requerida' using errcode = '42501'; end if;
  if char_length(btrim(coalesce(p_reason, ''))) not between 3 and 300 then raise exception 'motivo de cancelacion requerido' using errcode = '22023'; end if;
  if btrim(coalesce(p_idempotency_key, '')) !~ '^[A-Za-z0-9:_-]{8,128}$' then raise exception 'idempotency_key invalida' using errcode = '22023'; end if;
  select o.* into v_order from public.orders o where o.id = p_order_id for update;
  if not found then raise exception 'pedido inexistente' using errcode = 'P0002'; end if;
  if not public.has_business_role(v_order.business_id, array['owner', 'admin', 'staff']) then raise exception 'operador no autorizado' using errcode = '42501'; end if;
  v_hash := public.business_command_request_hash('cancel_order', p_order_id, jsonb_build_object('expected_revision', p_expected_revision, 'reason', btrim(p_reason)));
  select r.* into v_existing from public.business_command_receipts r where r.business_id = v_order.business_id and r.idempotency_key = p_idempotency_key;
  if found then
    if v_existing.request_hash <> v_hash then raise exception 'idempotency_key reutilizada con otro payload' using errcode = '23505'; end if;
    return v_existing.result || jsonb_build_object('idempotent_replay', true);
  end if;
  v_result := public.transition_order(p_order_id, p_expected_revision, 'canceled');
  insert into public.order_events(order_id, business_id, actor_user_id, actor_role, event_type, message, metadata)
  values (p_order_id, v_order.business_id, auth.uid(), 'business', 'business_cancel_reason', 'Cancelacion registrada.', jsonb_build_object('reason', btrim(p_reason)));
  insert into public.business_command_receipts(business_id, order_id, actor_user_id, command_type, idempotency_key, request_hash, result)
  values (v_order.business_id, p_order_id, auth.uid(), 'cancel_order', p_idempotency_key, v_hash, v_result);
  return v_result || jsonb_build_object('idempotent_replay', false);
end;
$cancel$;

create or replace function public.acknowledge_order(
  p_order_id uuid,
  p_expected_revision bigint,
  p_idempotency_key text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, extensions, pg_temp
as $ack$
declare
  v_order public.orders%rowtype;
  v_existing public.business_command_receipts%rowtype;
  v_hash text;
  v_result jsonb;
begin
  if auth.uid() is null then raise exception 'autenticacion requerida' using errcode = '42501'; end if;
  if p_expected_revision is null or p_expected_revision < 1 then raise exception 'expected_revision requerido' using errcode = '22023'; end if;
  if btrim(coalesce(p_idempotency_key, '')) !~ '^[A-Za-z0-9:_-]{8,128}$' then raise exception 'idempotency_key invalida' using errcode = '22023'; end if;

  select o.* into v_order from public.orders o where o.id = p_order_id for update;
  if not found then raise exception 'pedido inexistente' using errcode = 'P0002'; end if;
  if not public.has_business_role(v_order.business_id, array['owner', 'admin', 'staff']) then raise exception 'operador no autorizado' using errcode = '42501'; end if;

  v_hash := public.business_command_request_hash('acknowledge_order', p_order_id, jsonb_build_object('expected_revision', p_expected_revision));
  select r.* into v_existing from public.business_command_receipts r
   where r.business_id = v_order.business_id and r.idempotency_key = p_idempotency_key;
  if found then
    if v_existing.request_hash <> v_hash then raise exception 'idempotency_key reutilizada con otro payload' using errcode = '23505'; end if;
    return v_existing.result || jsonb_build_object('idempotent_replay', true);
  end if;
  if v_order.revision <> p_expected_revision then raise exception 'revision desactualizada' using errcode = '40001'; end if;
  if public.normalize_order_status_vocabulary(v_order.status) not in ('submitted', 'accepted', 'preparing') then raise exception 'pedido no reconocible en estado actual' using errcode = 'P0001'; end if;

  update public.orders set acknowledged_at = coalesce(acknowledged_at, now()), acknowledged_by = coalesce(acknowledged_by, auth.uid()) where id = p_order_id;
  insert into public.order_events(order_id, business_id, actor_user_id, actor_role, event_type, message, metadata)
  values (p_order_id, v_order.business_id, auth.uid(), 'business', 'business_acknowledged', 'Pedido reconocido por el negocio.', '{}'::jsonb);
  select to_jsonb(o) into v_result from public.orders o where o.id = p_order_id;
  insert into public.business_command_receipts(business_id, order_id, actor_user_id, command_type, idempotency_key, request_hash, result)
  values (v_order.business_id, p_order_id, auth.uid(), 'acknowledge_order', p_idempotency_key, v_hash, v_result);
  return v_result || jsonb_build_object('idempotent_replay', false);
end;
$ack$;

create or replace function public.set_preparation_estimate(
  p_order_id uuid,
  p_expected_revision bigint,
  p_minutes integer,
  p_idempotency_key text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, extensions, pg_temp
as $estimate$
declare
  v_order public.orders%rowtype;
  v_existing public.business_command_receipts%rowtype;
  v_hash text;
  v_result jsonb;
begin
  if auth.uid() is null then raise exception 'autenticacion requerida' using errcode = '42501'; end if;
  if p_minutes not between 1 and 240 then raise exception 'minutos fuera de rango' using errcode = '22023'; end if;
  if btrim(coalesce(p_idempotency_key, '')) !~ '^[A-Za-z0-9:_-]{8,128}$' then raise exception 'idempotency_key invalida' using errcode = '22023'; end if;
  select o.* into v_order from public.orders o where o.id = p_order_id for update;
  if not found then raise exception 'pedido inexistente' using errcode = 'P0002'; end if;
  if not public.has_business_role(v_order.business_id, array['owner', 'admin', 'staff']) then raise exception 'operador no autorizado' using errcode = '42501'; end if;
  v_hash := public.business_command_request_hash('set_preparation_estimate', p_order_id, jsonb_build_object('expected_revision', p_expected_revision, 'minutes', p_minutes));
  select r.* into v_existing from public.business_command_receipts r where r.business_id = v_order.business_id and r.idempotency_key = p_idempotency_key;
  if found then
    if v_existing.request_hash <> v_hash then raise exception 'idempotency_key reutilizada con otro payload' using errcode = '23505'; end if;
    return v_existing.result || jsonb_build_object('idempotent_replay', true);
  end if;
  if v_order.revision <> p_expected_revision then raise exception 'revision desactualizada' using errcode = '40001'; end if;
  if public.normalize_order_status_vocabulary(v_order.status) not in ('submitted', 'accepted', 'preparing') then raise exception 'estado no permite estimacion' using errcode = 'P0001'; end if;
  update public.orders set preparation_estimate_minutes = p_minutes where id = p_order_id;
  insert into public.order_events(order_id, business_id, actor_user_id, actor_role, event_type, message, metadata)
  values (p_order_id, v_order.business_id, auth.uid(), 'business', 'preparation_estimate_set', 'Tiempo de preparacion actualizado.', jsonb_build_object('minutes', p_minutes));
  select to_jsonb(o) into v_result from public.orders o where o.id = p_order_id;
  insert into public.business_command_receipts(business_id, order_id, actor_user_id, command_type, idempotency_key, request_hash, result)
  values (v_order.business_id, p_order_id, auth.uid(), 'set_preparation_estimate', p_idempotency_key, v_hash, v_result);
  return v_result || jsonb_build_object('idempotent_replay', false);
end;
$estimate$;
