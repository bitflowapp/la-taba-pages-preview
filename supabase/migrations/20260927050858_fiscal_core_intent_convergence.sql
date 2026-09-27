-- ============================================================================
--  ADOPCION DEL CORE FISCAL · una venta, una intencion, un comprobante
-- ============================================================================
--
--  Fuente canonica: bitflowapp/taba-fiscal@26d2f4cb9e379789b52e4a85e88f39910b0e852f (PR #1)
--    database/migrations/20260926180000_fiscal_intent_convergence.sql
--  Los cuerpos de funcion, checks y backfills se copian textuales de la fuente
--  (ver docs/TABA-FISCAL-CORE-ADOPTION.md): La Taba ejecuta el mismo contrato.
--  No se reaplica ninguna migracion historica: esto es el DELTA desde
--  20260926160000_local_print_agent.sql (cabeza de La Taba) al contrato del core.
--
--  Efectos:
--    · identidad de la intencion = (business_id, source_type, source_id, document_intent), serializada con advisory locks;
--    · fiscal_idempotency_keys: cada clave aceptada ligada a la huella de su solicitud (misma clave + otra solicitud = 23505 IDEMPOTENCY_KEY_REUSED);
--    · CommandSource (PANEL | MOBILE | WHATSAPP | AUTOMATION) solo como auditoria, nunca identidad;
--    · una sola ruta de emision: private.fiscal_request_invoice, con dos entradas (Panel/celular y servidor);
--    · online_order sigue BLOQUEADO: 'facturacion online requiere politica fiscal validada' (P0001);
--    · sin politica contable o sin snapshot impositivo: fiscal_policy_review_required (P0001), nunca un dato inventado;
--    · backfill: toda clave ya usada queda registrada con su huella.
--
--  No se adopta (sin efecto en La Taba o reemplazado mas adelante):
--    · request_fiscal_print_job de 180000: la version final llega con el endurecimiento de seguridad.
--
-- ============================================================================
--
--  ---- Encabezado original en taba-fiscal (180000); sus rutas son de ese repositorio ----
-- ============================================================================
--  Una venta -> una intencion fiscal -> un comprobante, aun con concurrencia.
-- ============================================================================
--
--  QUE SE MIDIO (PostgreSQL real, transacciones concurrentes reales;
--  services/arca-fiscal-bridge/tests/db/fiscal-intent.test.ts):
--
--    - la base nunca termino con dos facturas para una venta (lo impide un
--      UNIQUE), pero las solicitudes NO convergian:
--        . dos pedidos simultaneos con la misma clave: uno moria en deadlock
--          (FOR SHARE sobre pos_sales + UPDATE de la misma fila);
--        . otra idempotency key para la misma venta: 23505 al cliente;
--        . 100 pedidos concurrentes: 1 exito, 99 deadlocks;
--    - una clave usada solo en un replay no quedaba ligada a su venta;
--    - request_credit_note y request_fiscal_print_job devolvian en silencio
--      la fila existente cuando la misma clave llegaba con otro contenido;
--    - no existia CommandSource ni una entrada para canales de servidor.
--
--  CONTRATO QUE QUEDA:
--
--    identidad de la intencion = (business_id, source_type, source_id,
--      document_intent). Se serializa con un advisory lock sobre esa identidad
--      y luego sobre la clave (orden fijo: sin ciclos). Dos claves o dos
--      canales para la misma venta convergen en el mismo comprobante. La nota
--      de credito respeta el mismo orden: clave primero, factura despues.
--    NULL nunca pasa una validacion (coalesce en cada una).
--    idempotency key = una solicitud concreta. fiscal_idempotency_keys liga
--      cada clave aceptada (tambien las de un replay) a la huella de su
--      solicitud: la misma clave con otro contenido es 23505 con
--      HINT = 'IDEMPOTENCY_KEY_REUSED'. No es un segundo sistema de
--      idempotencia: la unicidad sigue siendo la de la intencion.
--    CommandSource (PANEL | MOBILE | WHATSAPP | AUTOMATION) = metadata del
--      comando: se audita en fiscal_events y en la clave, nunca forma parte
--      de la identidad. PANEL/MOBILE entran por request_fiscal_document
--      (authenticated, owner/admin/staff); WHATSAPP/AUTOMATION por
--      service_request_fiscal_document (solo service_role). Ambas usan la
--      misma funcion privada: una sola ruta de emision.
--
--  Compatibilidad: request_fiscal_document conserva los 5 parametros de
--  siempre; p_command_source es opcional (null = cliente anterior).
-- ============================================================================

create table if not exists public.fiscal_idempotency_keys (
  business_id uuid not null references public.businesses(id) on delete restrict,
  idempotency_key text not null check (char_length(idempotency_key) between 1 and 200),
  request_kind text not null check (request_kind in ('invoice', 'credit_note')),
  -- null solo en filas anteriores a este contrato (notas de credito sin huella).
  request_fingerprint text check (request_fingerprint is null or request_fingerprint ~ '^[0-9a-f]{64}$'),
  fiscal_document_id uuid not null references public.fiscal_documents(id) on delete restrict,
  command_source text check (command_source is null or command_source in ('PANEL', 'MOBILE', 'WHATSAPP', 'AUTOMATION')),
  actor_id uuid,
  created_at timestamptz not null default now(),
  primary key (business_id, idempotency_key)
);

create index if not exists fiscal_idempotency_keys_document_idx on public.fiscal_idempotency_keys(fiscal_document_id);

alter table public.fiscal_idempotency_keys enable row level security;
revoke all on table public.fiscal_idempotency_keys from public, anon, authenticated;

comment on table public.fiscal_idempotency_keys is
  'Cada idempotency key aceptada y la huella de su solicitud. La misma clave con otro contenido es un conflicto explicito. Solo funciones SECURITY DEFINER escriben aca.';

create or replace function private.fiscal_invoice_fingerprint(p_business_id uuid, p_source_type text, p_source_id uuid, p_document_intent text)
returns text
language sql
immutable
set search_path = pg_catalog, pg_temp
as $fiscal_invoice_fingerprint$
  select encode(sha256(convert_to(concat_ws('|', 'fiscal-intent:v1', p_business_id::text, p_source_type, p_source_id::text, p_document_intent), 'UTF8')), 'hex');
$fiscal_invoice_fingerprint$;

create or replace function private.fiscal_canonical_amount(p_value text)
returns text
language sql
immutable
set search_path = pg_catalog, pg_temp
as $fiscal_canonical_amount$
  select case when p_value ~ '^[0-9]+([.][0-9]+)?$' then trim_scale(p_value::numeric)::text else coalesce(p_value, '') end;
$fiscal_canonical_amount$;

-- Huella de una nota de credito: comprobante original, tipo, motivo y lineas
-- (orden y formato numerico normalizados: 0.5 y 0.50 son la misma linea).
create or replace function private.fiscal_credit_note_fingerprint(p_original_document_id uuid, p_credit_kind text, p_reason text, p_lines jsonb)
returns text
language sql
immutable
set search_path = pg_catalog, pg_temp
as $fiscal_credit_note_fingerprint$
  select encode(sha256(convert_to(concat_ws('|', 'credit-note:v1', p_original_document_id::text, p_credit_kind, btrim(coalesce(p_reason, '')),
    coalesce((select string_agg(concat_ws(':', lower(line->>'original_item_id'), private.fiscal_canonical_amount(line->>'quantity'),
                                          private.fiscal_canonical_amount(line->>'net_amount'), private.fiscal_canonical_amount(line->>'tax_amount')),
                                ',' order by lower(line->>'original_item_id'))
                from jsonb_array_elements(case when jsonb_typeof(p_lines) = 'array' then p_lines else '[]'::jsonb end) line), '')), 'UTF8')), 'hex');
$fiscal_credit_note_fingerprint$;

-- Cada solicitud que converge en una intencion existente queda auditada con su canal.
create or replace function private.fiscal_record_intent_replay(p_document public.fiscal_documents, p_command_source text, p_actor_id uuid, p_actor_type text, p_reason text)
returns void
language sql
security definer
set search_path = pg_catalog, public, pg_temp
as $fiscal_record_intent_replay$
  insert into public.fiscal_events(fiscal_document_id, event_type, actor_type, actor_id, sanitized_detail)
  values (p_document.id, 'intent_replayed', p_actor_type, p_actor_id,
    jsonb_strip_nulls(jsonb_build_object('command_source', p_command_source, 'reason', p_reason, 'state', p_document.state)));
$fiscal_record_intent_replay$;

create or replace function private.fiscal_request_invoice(
  p_business_id uuid,
  p_source_type text,
  p_source_id uuid,
  p_document_intent text,
  p_idempotency_key text,
  p_command_source text,
  p_actor_id uuid,
  p_actor_type text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, extensions, pg_temp
as $fiscal_request_invoice$
declare
  v_profile public.fiscal_profiles%rowtype;
  v_sale public.pos_sales%rowtype;
  v_document public.fiscal_documents%rowtype;
  v_existing public.fiscal_documents%rowtype;
  v_policy public.fiscal_accounting_policies%rowtype;
  v_item public.pos_sale_items%rowtype;
  v_net numeric(14,2) := 0;
  v_tax numeric(14,2) := 0;
  v_exempt numeric(14,2) := 0;
  v_non_taxed numeric(14,2) := 0;
  v_other_taxes numeric(14,2) := 0;
  v_total numeric(14,2) := 0;
  v_tax_code integer;
  v_fingerprint text;
  v_key public.fiscal_idempotency_keys%rowtype;
begin
  -- NULL nunca pasa una validacion: sin estos coalesce, un NULL hacia el IF nulo y seguia de largo
  -- sin identidad (y sin lock: pg_advisory_xact_lock(NULL) no bloquea nada).
  if coalesce(p_source_type,'') not in ('pos_sale','online_order') or coalesce(p_document_intent,'') <> 'invoice' or coalesce(p_idempotency_key,'') !~ '^[A-Za-z0-9:_-]{8,128}$' then raise exception 'intencion fiscal no soportada' using errcode = '22023'; end if;
  if p_business_id is null or p_source_id is null then raise exception 'intencion fiscal no soportada' using errcode = '22023'; end if;
  if coalesce(p_actor_type,'') not in ('operator','system') then raise exception 'actor fiscal invalido' using errcode = '22023'; end if;
  v_fingerprint := private.fiscal_invoice_fingerprint(p_business_id, p_source_type, p_source_id, p_document_intent);

  -- Una venta, una intencion: se serializa por la identidad logica (cualquier
  -- clave, cualquier canal) y despues por la clave. Orden fijo: sin ciclos.
  perform pg_advisory_xact_lock(hashtextextended('taba-fiscal:intent:' || v_fingerprint, 0));
  perform pg_advisory_xact_lock(hashtextextended('taba-fiscal:key:' || p_business_id::text || ':' || p_idempotency_key, 0));

  -- Misma clave: tiene que ser la misma solicitud. Otra venta con esta clave es un conflicto explicito.
  select k.* into v_key from public.fiscal_idempotency_keys k where k.business_id = p_business_id and k.idempotency_key = p_idempotency_key;
  if found then
    if v_key.request_kind <> 'invoice' or v_key.request_fingerprint is distinct from v_fingerprint then
      raise exception 'idempotency_key reutilizada con otra solicitud' using errcode = '23505', hint = 'IDEMPOTENCY_KEY_REUSED';
    end if;
    select d.* into v_existing from public.fiscal_documents d where d.id = v_key.fiscal_document_id;
    perform private.fiscal_record_intent_replay(v_existing, p_command_source, p_actor_id, p_actor_type, 'same_key');
    return jsonb_build_object('fiscal_document_id',v_existing.id,'state',v_existing.state,'idempotent_replay',true);
  end if;

  -- Otra clave, misma venta: converge en la intencion existente y la clave queda ligada a ella.
  select d.* into v_existing from public.fiscal_documents d
   where d.business_id = p_business_id and d.source_type = p_source_type and d.source_id = p_source_id and d.document_intent = p_document_intent;
  if found then
    insert into public.fiscal_idempotency_keys(business_id, idempotency_key, request_kind, request_fingerprint, fiscal_document_id, command_source, actor_id)
    values (p_business_id, p_idempotency_key, 'invoice', v_fingerprint, v_existing.id, p_command_source, p_actor_id);
    perform private.fiscal_record_intent_replay(v_existing, p_command_source, p_actor_id, p_actor_type, 'same_intent');
    return jsonb_build_object('fiscal_document_id',v_existing.id,'state',v_existing.state,'idempotent_replay',true);
  end if;
  select fp.* into v_profile from public.fiscal_profiles fp where fp.business_id = p_business_id for share;
  if not found or not v_profile.is_enabled or v_profile.environment = 'disabled' then raise exception 'fiscalizacion deshabilitada' using errcode = 'P0001'; end if;
  if v_profile.environment = 'production' and (v_profile.accountant_review_status <> 'approved' or v_profile.production_gate_status <> 'approved') then raise exception 'produccion fiscal bloqueada' using errcode = '42501'; end if;
  if p_source_type <> 'pos_sale' then raise exception 'facturacion online requiere politica fiscal validada' using errcode='P0001'; end if;
  select s.* into v_sale from public.pos_sales s where s.id = p_source_id and s.business_id = p_business_id and s.state in ('completed_fiscal_pending','completed') for update;
  if not found then raise exception 'venta no confirmada' using errcode='P0002'; end if;
  if btrim(coalesce(v_profile.default_recipient_condition,'')) = '' then raise exception 'fiscal_policy_review_required' using errcode='P0001'; end if;

  select p.* into v_policy from public.fiscal_accounting_policies p
  where p.business_id = p_business_id and p.environment = v_profile.environment
    and p.issuer_condition = v_profile.tax_condition and p.recipient_condition = v_profile.default_recipient_condition
    and p.concept = v_profile.default_concept and p.enabled and p.accountant_review_status = 'approved'
    and p.valid_from <= current_date
  order by p.valid_from desc, p.created_at desc limit 1 for share;
  if not found then raise exception 'fiscal_policy_review_required' using errcode='P0001'; end if;
  v_policy := public.resolve_fiscal_accounting_policy(p_business_id, v_profile.environment, v_profile.tax_condition, v_profile.default_recipient_condition, v_profile.default_concept, v_policy.invoice_type, current_date);
  -- RG 5616: una factura nueva no se encola sin la condicion del receptor.
  if v_policy.recipient_vat_condition_id is null then raise exception 'fiscal_policy_review_required' using errcode='P0001'; end if;

  for v_item in select * from public.pos_sale_items i where i.sale_id = v_sale.id order by i.id
  loop
    if not (v_item.tax_snapshot ?& array['net_amount','tax_amount','exempt_amount','non_taxed_amount','other_taxes_amount'])
      or coalesce(v_item.tax_snapshot->>'net_amount','') !~ '^[0-9]+([.][0-9]{1,2})?$'
      or coalesce(v_item.tax_snapshot->>'tax_amount','') !~ '^[0-9]+([.][0-9]{1,2})?$'
      or coalesce(v_item.tax_snapshot->>'exempt_amount','') !~ '^[0-9]+([.][0-9]{1,2})?$'
      or coalesce(v_item.tax_snapshot->>'non_taxed_amount','') !~ '^[0-9]+([.][0-9]{1,2})?$'
      or coalesce(v_item.tax_snapshot->>'other_taxes_amount','') !~ '^[0-9]+([.][0-9]{1,2})?$'
    then raise exception 'fiscal_policy_review_required' using errcode='P0001'; end if;
    v_tax_code := case when coalesce(v_item.tax_snapshot->>'tax_code','') ~ '^[0-9]+$' then (v_item.tax_snapshot->>'tax_code')::integer else null end;
    if (v_item.tax_snapshot->>'tax_amount')::numeric > 0 and v_tax_code is null then raise exception 'fiscal_policy_review_required' using errcode='P0001'; end if;
    v_net := v_net + (v_item.tax_snapshot->>'net_amount')::numeric;
    v_tax := v_tax + (v_item.tax_snapshot->>'tax_amount')::numeric;
    v_exempt := v_exempt + (v_item.tax_snapshot->>'exempt_amount')::numeric;
    v_non_taxed := v_non_taxed + (v_item.tax_snapshot->>'non_taxed_amount')::numeric;
    v_other_taxes := v_other_taxes + (v_item.tax_snapshot->>'other_taxes_amount')::numeric;
  end loop;
  v_total := v_net + v_tax + v_exempt + v_non_taxed + v_other_taxes;
  if abs(v_total - v_sale.total) > 0.01 then raise exception 'snapshot impositivo no coincide con la venta' using errcode='23514'; end if;

  insert into public.fiscal_documents(
    business_id,source_type,source_id,document_intent,environment,cuit,point_of_sale,document_type,concept,currency,currency_rate,
    recipient_type,recipient_document_type,recipient_document_number,recipient_vat_condition_id,net_amount,tax_amount,exempt_amount,non_taxed_amount,other_taxes_amount,total_amount,
    state,idempotency_key,issuer_snapshot,recipient_snapshot,fiscal_policy_version
  ) values (
    p_business_id,p_source_type,p_source_id,p_document_intent,v_profile.environment,v_profile.cuit,v_profile.point_of_sale,v_policy.invoice_type,v_profile.default_concept,v_profile.default_currency,1,
    v_profile.default_recipient_condition,v_policy.recipient_document_type,v_policy.recipient_document_number,v_policy.recipient_vat_condition_id,v_net,v_tax,v_exempt,v_non_taxed,v_other_taxes,v_total,
    'queued',p_idempotency_key,
    jsonb_build_object('legal_name',v_profile.legal_name,'cuit',v_profile.cuit,'tax_condition',v_profile.tax_condition,'address',v_profile.business_address,'gross_income_number',v_profile.gross_income_number),
    jsonb_build_object('condition',v_profile.default_recipient_condition,'vat_condition_id',v_policy.recipient_vat_condition_id,'document_type',v_policy.recipient_document_type,'document_number',v_policy.recipient_document_number),
    v_policy.policy_version
  ) returning * into v_document;
  for v_item in select * from public.pos_sale_items i where i.sale_id = v_sale.id order by i.id
  loop
    v_tax_code := case when coalesce(v_item.tax_snapshot->>'tax_code','') ~ '^[0-9]+$' then (v_item.tax_snapshot->>'tax_code')::integer else null end;
    insert into public.fiscal_document_items(fiscal_document_id,description,quantity,unit_price,net_amount,tax_amount,tax_code,exempt_amount,non_taxed_amount,other_taxes_amount,tax_snapshot)
    values(v_document.id,v_item.product_name,v_item.quantity,v_item.unit_price,(v_item.tax_snapshot->>'net_amount')::numeric,(v_item.tax_snapshot->>'tax_amount')::numeric,v_tax_code,(v_item.tax_snapshot->>'exempt_amount')::numeric,(v_item.tax_snapshot->>'non_taxed_amount')::numeric,(v_item.tax_snapshot->>'other_taxes_amount')::numeric,v_item.tax_snapshot);
  end loop;
  update public.pos_sales set fiscal_document_id = v_document.id, state = 'completed_fiscal_pending' where id = v_sale.id;
  insert into public.fiscal_outbox(fiscal_document_id) values(v_document.id);
  insert into public.fiscal_idempotency_keys(business_id, idempotency_key, request_kind, request_fingerprint, fiscal_document_id, command_source, actor_id)
  values (p_business_id, p_idempotency_key, 'invoice', v_fingerprint, v_document.id, p_command_source, p_actor_id);
  insert into public.fiscal_events(fiscal_document_id,event_type,actor_type,actor_id,sanitized_detail)
  values(v_document.id,'queued',p_actor_type,p_actor_id,jsonb_strip_nulls(jsonb_build_object('source_type',p_source_type,'policy_version',v_policy.policy_version,'recipient_vat_condition_id',v_policy.recipient_vat_condition_id,'command_source',p_command_source)));
  return jsonb_build_object('fiscal_document_id',v_document.id,'state','queued','idempotent_replay',false);
end;
$fiscal_request_invoice$;

create or replace function public.request_credit_note_unchecked(
  p_original_document_id uuid,
  p_reason text,
  p_credit_kind text,
  p_lines jsonb,
  p_idempotency_key text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, extensions, pg_temp
as $request_credit_note_unchecked$
declare
  v_original public.fiscal_documents%rowtype;
  v_document public.fiscal_documents%rowtype;
  v_existing public.fiscal_documents%rowtype;
  v_profile public.fiscal_profiles%rowtype;
  v_policy public.fiscal_accounting_policies%rowtype;
  v_line jsonb;
  v_item public.fiscal_document_items%rowtype;
  v_reserved_quantity numeric(14,3);
  v_reserved_net numeric(14,2);
  v_reserved_tax numeric(14,2);
  v_reserved_exempt numeric(14,2);
  v_reserved_non_taxed numeric(14,2);
  v_reserved_other numeric(14,2);
  v_quantity numeric(14,3);
  v_net numeric(14,2);
  v_tax numeric(14,2);
  v_exempt numeric(14,2);
  v_non_taxed numeric(14,2);
  v_other numeric(14,2);
  v_total numeric(14,2) := 0;
  v_total_net numeric(14,2) := 0;
  v_total_tax numeric(14,2) := 0;
  v_total_exempt numeric(14,2) := 0;
  v_total_non_taxed numeric(14,2) := 0;
  v_total_other numeric(14,2) := 0;
  v_issuer_condition text;
  v_recipient_condition text;
  v_fingerprint text;
  v_key public.fiscal_idempotency_keys%rowtype;
begin
  -- coalesce: un tipo NULL hacia nulo el IF y la nota salteaba la validacion y la politica contable (S3).
  if coalesce(p_credit_kind,'') not in ('total','partial','commercial_adjustment')
    or jsonb_typeof(coalesce(p_lines,'[]'::jsonb)) <> 'array'
    or jsonb_array_length(coalesce(p_lines,'[]'::jsonb)) > 200
    or char_length(btrim(coalesce(p_reason,''))) not between 5 and 300
    or coalesce(p_idempotency_key,'') !~ '^[A-Za-z0-9:_-]{8,128}$'
  then raise exception 'solicitud de nota de credito invalida' using errcode='22023'; end if;
  -- Mismo orden de locks que la factura (clave -> filas), o una factura que se repite con esta
  -- clave y esta nota se bloquean mutuamente (S8): se autoriza leyendo sin lock, se toma la
  -- clave y recien despues el original.
  select d.* into v_original from public.fiscal_documents d where d.id = p_original_document_id;
  if not found or not public.has_business_role(v_original.business_id,array['owner','admin']) then
    raise exception 'comprobante original inexistente o sin permiso (owner/admin)' using errcode='42501';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('taba-fiscal:key:' || v_original.business_id::text || ':' || p_idempotency_key, 0));
  select d.* into v_original from public.fiscal_documents d where d.id = p_original_document_id for update;
  if v_original.state not in ('authorized','credited') or v_original.document_intent <> 'invoice' or v_original.document_type < 1 then raise exception 'solo una factura autorizada admite nota de credito' using errcode='P0001'; end if;
  v_fingerprint := private.fiscal_credit_note_fingerprint(v_original.id, p_credit_kind, p_reason, p_lines);
  select k.* into v_key from public.fiscal_idempotency_keys k where k.business_id = v_original.business_id and k.idempotency_key = p_idempotency_key;
  if found then
    select d.* into v_existing from public.fiscal_documents d where d.id = v_key.fiscal_document_id;
    -- Filas anteriores a este contrato no tienen huella: se conserva la regla vieja.
    if v_key.request_kind <> 'credit_note'
       or (v_key.request_fingerprint is not null and v_key.request_fingerprint <> v_fingerprint)
       or (v_key.request_fingerprint is null and v_existing.associated_document_id is distinct from v_original.id) then
      raise exception 'idempotency_key reutilizada con otra solicitud' using errcode='23505', hint = 'IDEMPOTENCY_KEY_REUSED';
    end if;
    return jsonb_build_object('fiscal_document_id',v_existing.id,'state',v_existing.state,'idempotent_replay',true);
  end if;
  select fp.* into v_profile from public.fiscal_profiles fp where fp.business_id = v_original.business_id for share;
  v_issuer_condition := coalesce(nullif(btrim(v_original.issuer_snapshot->>'tax_condition'),''), v_profile.tax_condition, '');
  v_recipient_condition := coalesce(nullif(btrim(v_original.recipient_snapshot->>'condition'),''), nullif(btrim(v_original.recipient_type),''), '');
  v_policy := public.resolve_fiscal_accounting_policy(v_original.business_id, v_original.environment, v_issuer_condition, v_recipient_condition, v_original.concept, v_original.document_type, current_date);
  if p_credit_kind = 'commercial_adjustment' and not v_policy.allow_commercial_adjustment then raise exception 'fiscal_policy_review_required' using errcode='P0001'; end if;
  if p_credit_kind = 'total' and jsonb_array_length(p_lines) <> 0 then raise exception 'nota total no admite lineas manuales' using errcode='22023'; end if;
  if p_credit_kind <> 'total' and jsonb_array_length(p_lines) = 0 then raise exception 'nota parcial requiere lineas precisas' using errcode='22023'; end if;
  if p_credit_kind <> 'total' and (select count(distinct value->>'original_item_id') from jsonb_array_elements(p_lines)) <> jsonb_array_length(p_lines) then raise exception 'lineas de nota duplicadas' using errcode='22023'; end if;

  insert into public.fiscal_documents(
    business_id,source_type,source_id,document_intent,environment,cuit,point_of_sale,document_type,concept,currency,currency_rate,
    recipient_type,recipient_document_type,recipient_document_number,net_amount,tax_amount,exempt_amount,non_taxed_amount,other_taxes_amount,total_amount,
    state,idempotency_key,associated_document_id,issuer_snapshot,recipient_snapshot,associated_document_snapshot,fiscal_policy_version,credit_kind,credit_reason
  ) values (
    v_original.business_id,'credit_note',gen_random_uuid(),'credit_note',v_original.environment,v_original.cuit,v_original.point_of_sale,v_policy.credit_note_type,v_original.concept,v_original.currency,v_original.currency_rate,
    v_original.recipient_type,v_original.recipient_document_type,v_original.recipient_document_number,0,0,0,0,0,0,
    'queued',p_idempotency_key,v_original.id,v_original.issuer_snapshot,v_original.recipient_snapshot,
    jsonb_build_object('fiscal_document_id',v_original.id,'document_type',v_original.document_type,'point_of_sale',v_original.point_of_sale,'document_number',v_original.document_number,'issue_date',v_original.issue_date,'cae',v_original.cae),
    v_policy.policy_version,p_credit_kind,btrim(p_reason)
  ) returning * into v_document;

  if p_credit_kind = 'total' then
    for v_item in select * from public.fiscal_document_items i where i.fiscal_document_id = v_original.id order by i.id for share
    loop
      select coalesce(sum(a.quantity) filter(where a.state in ('reserved','authorized')),0),
             coalesce(sum(a.net_amount) filter(where a.state in ('reserved','authorized')),0),
             coalesce(sum(a.tax_amount) filter(where a.state in ('reserved','authorized')),0),
             coalesce(sum(a.exempt_amount) filter(where a.state in ('reserved','authorized')),0),
             coalesce(sum(a.non_taxed_amount) filter(where a.state in ('reserved','authorized')),0),
             coalesce(sum(a.other_taxes_amount) filter(where a.state in ('reserved','authorized')),0)
        into v_reserved_quantity,v_reserved_net,v_reserved_tax,v_reserved_exempt,v_reserved_non_taxed,v_reserved_other
      from public.fiscal_credit_allocations a where a.original_item_id = v_item.id;
      v_quantity := v_item.quantity - v_reserved_quantity;
      v_net := v_item.net_amount - v_reserved_net;
      v_tax := v_item.tax_amount - v_reserved_tax;
      v_exempt := v_item.exempt_amount - v_reserved_exempt;
      v_non_taxed := v_item.non_taxed_amount - v_reserved_non_taxed;
      v_other := v_item.other_taxes_amount - v_reserved_other;
      if v_quantity <= 0 or (v_net + v_tax + v_exempt + v_non_taxed + v_other) <= 0 then continue; end if;
      insert into public.fiscal_document_items(fiscal_document_id,description,quantity,unit_price,net_amount,tax_amount,tax_code,exempt_amount,non_taxed_amount,other_taxes_amount,tax_snapshot)
      values(v_document.id,concat('Nota de credito: ',v_item.description),v_quantity,round((v_net+v_tax+v_exempt+v_non_taxed+v_other)/v_quantity,2),v_net,v_tax,v_item.tax_code,v_exempt,v_non_taxed,v_other,v_item.tax_snapshot);
      insert into public.fiscal_credit_allocations(business_id,original_document_id,original_item_id,credit_document_id,quantity,net_amount,tax_amount,exempt_amount,non_taxed_amount,other_taxes_amount,total_amount,snapshot)
      values(v_original.business_id,v_original.id,v_item.id,v_document.id,v_quantity,v_net,v_tax,v_exempt,v_non_taxed,v_other,v_net+v_tax+v_exempt+v_non_taxed+v_other,jsonb_build_object('original_item_id',v_item.id,'original_quantity',v_item.quantity,'credit_kind',p_credit_kind));
      v_total_net := v_total_net + v_net; v_total_tax := v_total_tax + v_tax; v_total_exempt := v_total_exempt + v_exempt; v_total_non_taxed := v_total_non_taxed + v_non_taxed; v_total_other := v_total_other + v_other;
    end loop;
  else
    for v_line in select value from jsonb_array_elements(p_lines)
    loop
      if v_line - array['original_item_id','quantity','net_amount','tax_amount'] <> '{}'::jsonb
        or coalesce(v_line->>'original_item_id','') !~ '^[0-9a-fA-F-]{36}$'
        or coalesce(v_line->>'quantity','') !~ '^[0-9]+([.][0-9]{1,3})?$'
      then raise exception 'linea de nota invalida' using errcode='22023'; end if;
      select i.* into v_item from public.fiscal_document_items i where i.id = (v_line->>'original_item_id')::uuid and i.fiscal_document_id = v_original.id for share;
      if not found then raise exception 'item original invalido' using errcode='P0002'; end if;
      select coalesce(sum(a.quantity) filter(where a.state in ('reserved','authorized')),0),
             coalesce(sum(a.net_amount) filter(where a.state in ('reserved','authorized')),0),
             coalesce(sum(a.tax_amount) filter(where a.state in ('reserved','authorized')),0),
             coalesce(sum(a.exempt_amount) filter(where a.state in ('reserved','authorized')),0),
             coalesce(sum(a.non_taxed_amount) filter(where a.state in ('reserved','authorized')),0),
             coalesce(sum(a.other_taxes_amount) filter(where a.state in ('reserved','authorized')),0)
        into v_reserved_quantity,v_reserved_net,v_reserved_tax,v_reserved_exempt,v_reserved_non_taxed,v_reserved_other
      from public.fiscal_credit_allocations a where a.original_item_id = v_item.id;
      v_quantity := (v_line->>'quantity')::numeric;
      if v_quantity <= 0 or v_quantity > v_item.quantity - v_reserved_quantity then raise exception 'importe o cantidad excede el saldo acreditable' using errcode='23514'; end if;
      if p_credit_kind = 'partial' then
        if v_quantity = v_item.quantity - v_reserved_quantity then
          v_net := v_item.net_amount - v_reserved_net; v_tax := v_item.tax_amount - v_reserved_tax; v_exempt := v_item.exempt_amount - v_reserved_exempt; v_non_taxed := v_item.non_taxed_amount - v_reserved_non_taxed; v_other := v_item.other_taxes_amount - v_reserved_other;
        else
          v_net := round(v_item.net_amount * v_quantity / v_item.quantity,2); v_tax := round(v_item.tax_amount * v_quantity / v_item.quantity,2); v_exempt := round(v_item.exempt_amount * v_quantity / v_item.quantity,2); v_non_taxed := round(v_item.non_taxed_amount * v_quantity / v_item.quantity,2); v_other := round(v_item.other_taxes_amount * v_quantity / v_item.quantity,2);
        end if;
      else
        if coalesce(v_line->>'net_amount','') !~ '^[0-9]+([.][0-9]{1,2})?$' or coalesce(v_line->>'tax_amount','') !~ '^[0-9]+([.][0-9]{1,2})?$' then raise exception 'ajuste comercial requiere importes precisos' using errcode='22023'; end if;
        v_net := (v_line->>'net_amount')::numeric; v_tax := (v_line->>'tax_amount')::numeric; v_exempt := 0; v_non_taxed := 0; v_other := 0;
        if v_net > v_item.net_amount - v_reserved_net or v_tax > v_item.tax_amount - v_reserved_tax then raise exception 'importe o cantidad excede el saldo acreditable' using errcode='23514'; end if;
      end if;
      if v_net + v_tax + v_exempt + v_non_taxed + v_other <= 0 then raise exception 'nota de credito sin importe' using errcode='22023'; end if;
      insert into public.fiscal_document_items(fiscal_document_id,description,quantity,unit_price,net_amount,tax_amount,tax_code,exempt_amount,non_taxed_amount,other_taxes_amount,tax_snapshot)
      values(v_document.id,concat('Nota de credito: ',v_item.description),v_quantity,round((v_net+v_tax+v_exempt+v_non_taxed+v_other)/v_quantity,2),v_net,v_tax,v_item.tax_code,v_exempt,v_non_taxed,v_other,v_item.tax_snapshot);
      insert into public.fiscal_credit_allocations(business_id,original_document_id,original_item_id,credit_document_id,quantity,net_amount,tax_amount,exempt_amount,non_taxed_amount,other_taxes_amount,total_amount,snapshot)
      values(v_original.business_id,v_original.id,v_item.id,v_document.id,v_quantity,v_net,v_tax,v_exempt,v_non_taxed,v_other,v_net+v_tax+v_exempt+v_non_taxed+v_other,jsonb_build_object('original_item_id',v_item.id,'original_quantity',v_item.quantity,'credit_kind',p_credit_kind));
      v_total_net := v_total_net + v_net; v_total_tax := v_total_tax + v_tax; v_total_exempt := v_total_exempt + v_exempt; v_total_non_taxed := v_total_non_taxed + v_non_taxed; v_total_other := v_total_other + v_other;
    end loop;
  end if;
  v_total := v_total_net + v_total_tax + v_total_exempt + v_total_non_taxed + v_total_other;
  if v_total <= 0 then raise exception 'no existe saldo acreditable' using errcode='23514'; end if;
  update public.fiscal_documents
    set net_amount=v_total_net,tax_amount=v_total_tax,exempt_amount=v_total_exempt,non_taxed_amount=v_total_non_taxed,other_taxes_amount=v_total_other,total_amount=v_total
    where id=v_document.id;
  insert into public.fiscal_outbox(fiscal_document_id) values(v_document.id);
  insert into public.fiscal_idempotency_keys(business_id, idempotency_key, request_kind, request_fingerprint, fiscal_document_id, actor_id)
  values (v_original.business_id, p_idempotency_key, 'credit_note', v_fingerprint, v_document.id, auth.uid());
  insert into public.fiscal_events(fiscal_document_id,event_type,actor_type,actor_id,sanitized_detail)
  values(v_document.id,'credit_note_queued','operator',auth.uid(),jsonb_build_object('reason',btrim(p_reason),'associated_document_id',v_original.id,'credit_kind',p_credit_kind,'policy_version',v_policy.policy_version));
  return jsonb_build_object('fiscal_document_id',v_document.id,'state','queued','idempotent_replay',false);
end;
$request_credit_note_unchecked$;

drop function if exists public.request_fiscal_document(uuid, text, uuid, text, text);

create function public.request_fiscal_document(
  p_business_id uuid,
  p_source_type text,
  p_source_id uuid,
  p_document_intent text,
  p_idempotency_key text,
  p_command_source text default null
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, extensions, pg_temp
as $request_fiscal_document$
begin
  if not public.has_business_role(p_business_id, array['owner','admin','staff']) then raise exception 'operador no autorizado' using errcode = '42501'; end if;
  -- Un operador humano pide desde el Panel o el celular. Los canales de servidor tienen su propia entrada.
  if p_command_source is not null and p_command_source not in ('PANEL','MOBILE') then
    raise exception 'canal no permitido para un operador' using errcode = '22023';
  end if;
  return private.fiscal_request_invoice(p_business_id, p_source_type, p_source_id, p_document_intent, p_idempotency_key, p_command_source, auth.uid(), 'operator');
end;
$request_fiscal_document$;

create or replace function public.service_request_fiscal_document(
  p_business_id uuid,
  p_source_type text,
  p_source_id uuid,
  p_document_intent text,
  p_idempotency_key text,
  p_command_source text,
  p_actor_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, extensions, pg_temp
as $service_request_fiscal_document$
begin
  if p_command_source is null or p_command_source not in ('WHATSAPP','AUTOMATION') then
    raise exception 'canal de servicio invalido' using errcode = '22023';
  end if;
  -- El actor es opcional (un cobro automatico no tiene persona); si viene, tiene que ser del negocio.
  if p_actor_id is not null and not exists (
    select 1 from public.business_members m where m.business_id = p_business_id and m.user_id = p_actor_id and m.is_active
  ) then
    raise exception 'actor ajeno al negocio' using errcode = '42501';
  end if;
  return private.fiscal_request_invoice(p_business_id, p_source_type, p_source_id, p_document_intent, p_idempotency_key, p_command_source, p_actor_id, 'system');
end;
$service_request_fiscal_document$;

-- Toda clave ya usada queda registrada con la huella de su solicitud.
insert into public.fiscal_idempotency_keys(business_id, idempotency_key, request_kind, request_fingerprint, fiscal_document_id, created_at)
select d.business_id, d.idempotency_key, d.document_intent,
       case when d.document_intent = 'invoice' then private.fiscal_invoice_fingerprint(d.business_id, d.source_type, d.source_id, d.document_intent) end,
       d.id, d.created_at
  from public.fiscal_documents d
on conflict (business_id, idempotency_key) do nothing;

revoke all on function private.fiscal_invoice_fingerprint(uuid, text, uuid, text),
  private.fiscal_canonical_amount(text),
  private.fiscal_credit_note_fingerprint(uuid, text, text, jsonb),
  private.fiscal_record_intent_replay(public.fiscal_documents, text, uuid, text, text),
  private.fiscal_request_invoice(uuid, text, uuid, text, text, text, uuid, text)
from public, anon, authenticated;

revoke all on function public.request_fiscal_document(uuid, text, uuid, text, text, text) from public, anon, authenticated, service_role;
grant execute on function public.request_fiscal_document(uuid, text, uuid, text, text, text) to authenticated;

revoke all on function public.service_request_fiscal_document(uuid, text, uuid, text, text, text, uuid) from public, anon, authenticated;
grant execute on function public.service_request_fiscal_document(uuid, text, uuid, text, text, text, uuid) to service_role;

revoke all on function public.request_credit_note_unchecked(uuid, text, text, jsonb, text) from public, anon, authenticated, service_role;

comment on function public.request_fiscal_document(uuid, text, uuid, text, text, text) is
  'Intencion fiscal desde el Panel o el celular (owner/admin/staff). Converge por (business_id, source_type, source_id, document_intent); CommandSource es solo auditoria.';
comment on function public.service_request_fiscal_document(uuid, text, uuid, text, text, text, uuid) is
  'Intencion fiscal desde un canal de servidor (WHATSAPP, AUTOMATION). Solo service_role. Misma ruta y misma identidad que request_fiscal_document.';
