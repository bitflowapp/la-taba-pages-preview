-- ============================================================================
--  La Taba · facturar pedidos online con el core fiscal (adaptador comercial)
-- ============================================================================
--
--  online_order <> pos_sale. Un pedido se factura COMO PEDIDO (source_type =
--  'online_order', source_id = orders.id): nunca como una venta POS sintetica, nunca
--  con un pago inventado, nunca con un snapshot impositivo inventado.
--
--  UNA sola evaluacion decide si un pedido se puede facturar y arma el origen congelado
--  que exige el core: private.commercial_order_fiscal_evaluation. La usan el Panel, el
--  celular, WhatsApp y las automatizaciones; la UI solo la muestra. Razones posibles:
--    QA_ORDER_NOT_BILLABLE        pedido QA, sin cobro de prueba o con un producto de prueba: nunca se factura
--    ORDER_CANCELLED              cancelado o rechazado
--    FISCAL_PROFILE_DISABLED      perfil fiscal inexistente, apagado o sin ambiente
--    HOMOLOGATION_NOT_AUTHORIZED  homologacion sin la autorizacion del perfil
--    PRODUCTION_BLOCKED           produccion sin sus compuertas aprobadas
--    ACCOUNTING_POLICY_REQUIRED   falta la politica fiscal del core o la comercial
--    ORDER_NOT_BILLABLE_YET       todavia no llego el momento que fija la politica
--    PAYMENT_REQUIRED             el pago no esta en el estado que exige la politica
--    PAYMENT_METHOD_NOT_INVOICEABLE  la politica no factura ese medio de pago
--    INVALID_TOTAL                importes o cantidades que no se pueden facturar exactos
--    INVALID_PRODUCT_REFERENCE    un item que no se puede atar a un producto del negocio
--    MISSING_TAX_CLASSIFICATION   un producto sin clasificacion impositiva
--    DISCOUNT_NOT_INVOICEABLE     hay descuento y la politica no lo factura
--    DELIVERY_NOT_INVOICEABLE     hay envio y la politica no lo factura
--    FISCAL_PARAMETERS_REQUIRED   una alicuota que no esta en la tabla vigente de ARCA
--    RECIPIENT_DATA_REQUIRED      el total exige identificar al consumidor final
--
--  El calculo (con la politica aprobada, nunca por defecto): precios con IVA incluido,
--  IVA por alicuota sobre el total del grupo y repartido a las lineas al centavo (resto
--  mayor), descuento prorrateado por bruto de item, envio como linea con su alicuota o
--  excluido con motivo. El core valida todo de nuevo al congelar (ARCA 10051 incluido).
--
--  Facturar e imprimir: el pedido de impresion es DURABLE (fiscal_print_requests). Se
--  cumple cuando el comprobante se autoriza, con la cola real del agente local y la
--  misma clave que la impresion automatica: un solo primer ticket por comprobante.
-- ============================================================================

-- ---- reparto al centavo por resto mayor ------------------------------------------
create or replace function private.allocate_cents(p_total bigint, p_weights bigint[])
returns bigint[]
language plpgsql
immutable
set search_path = pg_catalog
as $allocate_cents$
declare
  v_n integer := coalesce(array_length(p_weights, 1), 0);
  v_sum numeric := 0;
  v_out bigint[] := '{}';
  v_rest numeric[] := '{}';
  v_share numeric;
  v_left bigint;
  v_index integer;
begin
  if p_total is null or p_total < 0 then raise exception 'reparto invalido' using errcode = '22023'; end if;
  for v_index in 1 .. v_n loop
    if p_weights[v_index] is null or p_weights[v_index] < 0 then raise exception 'reparto invalido' using errcode = '22023'; end if;
    v_sum := v_sum + p_weights[v_index];
  end loop;
  if v_sum = 0 then
    if p_total <> 0 then raise exception 'reparto sin base' using errcode = '22023'; end if;
    return case when v_n = 0 then '{}'::bigint[] else array_fill(0::bigint, array[v_n]) end;
  end if;
  for v_index in 1 .. v_n loop
    v_share := p_total::numeric * p_weights[v_index] / v_sum;
    v_out := v_out || floor(v_share)::bigint;
    v_rest := v_rest || (v_share - floor(v_share));
  end loop;
  v_left := p_total - (select sum(x) from unnest(v_out) x);
  for v_index in
    select r.idx from unnest(v_rest) with ordinality as r(rest, idx) order by r.rest desc, r.idx limit v_left
  loop
    v_out[v_index] := v_out[v_index] + 1;
  end loop;
  return v_out;
end;
$allocate_cents$;

-- ---- estado REAL del pago (nunca 'confirmed' inventado) -----------------------------
create or replace function private.order_payment_state(p_order public.orders)
returns text
language sql
stable
security definer
set search_path = pg_catalog, public, pg_temp
as $order_payment_state$
  select case
    when (p_order).payment_method = 'qa_no_charge' then 'not_applicable'
    when (p_order).payment_method = 'mercadopago' then (
      select case
        when bool_or(pi.internal_status in ('refunded', 'partially_refunded', 'charged_back') or pi.refunded_amount > 0) then 'refunded'
        when bool_or(pi.internal_status in ('approved', 'approved_order_pending', 'completed')) then 'confirmed'
        else 'pending' end
        from public.payment_intents pi where pi.order_id = (p_order).id)
    when (p_order).payment_method in ('cash', 'coordinate') then case (p_order).manual_payment_status
      when 'confirmed' then 'confirmed' when 'reversed' then 'reversed' else 'pending' end
    else 'unknown' end
$order_payment_state$;

-- ---- referencia comercial -> producto canonico ---------------------------------------
-- order_items.product_id es TEXTO (historico): puede ser el uuid, un external_id o un sku.
-- Nunca se castea a uuid sin probar que lo es; ambiguo o ajeno: null (INVALID_PRODUCT_REFERENCE).
create or replace function private.commercial_order_item_product(p_business_id uuid, p_product_uuid uuid, p_product_ref text)
returns uuid
language plpgsql
stable
security definer
set search_path = pg_catalog, public, pg_temp
as $commercial_order_item_product$
declare
  v_ids uuid[];
begin
  if p_product_uuid is not null then
    return (select p.id from public.products p where p.id = p_product_uuid and p.business_id = p_business_id);
  end if;
  if btrim(coalesce(p_product_ref, '')) = '' then return null; end if;
  if p_product_ref ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    return (select p.id from public.products p where p.id = p_product_ref::uuid and p.business_id = p_business_id);
  end if;
  select array_agg(distinct p.id) into v_ids from public.products p
   where p.business_id = p_business_id and (p.external_id = p_product_ref or p.sku = p_product_ref);
  return case when cardinality(v_ids) = 1 then v_ids[1] end;
end;
$commercial_order_item_product$;

-- ---- la evaluacion unica ---------------------------------------------------------------
create or replace function private.commercial_order_fiscal_evaluation(p_business_id uuid, p_order_id uuid, p_build_snapshot boolean default true)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, extensions, pg_temp
as $commercial_order_fiscal_evaluation$
declare
  c_accepted_or_later constant text[] := array['accepted', 'preparing', 'ready', 'assigned', 'picked_up', 'on_the_way', 'arriving', 'arrived', 'delivered'];
  v_order public.orders%rowtype;
  v_document_id uuid;
  v_profile public.fiscal_profiles%rowtype;
  v_core_policy public.fiscal_accounting_policies%rowtype;
  v_policy public.commercial_fiscal_policies%rowtype;
  v_has_policy boolean := false;
  v_reasons jsonb := '[]'::jsonb;
  v_payment text;
  v_rule text;
  v_item record;
  v_product uuid;
  v_class public.product_fiscal_classifications%rowtype;
  v_items_total numeric := 0;
  v_count integer := 0;
  v_codes integer[] := '{}';
  v_code integer;
  -- lineas (paralelas): items primero, envio al final
  v_kind text[] := '{}';
  v_desc text[] := '{}';
  v_qty numeric[] := '{}';
  v_price numeric[] := '{}';
  v_gross bigint[] := '{}';
  v_discount bigint[] := '{}';
  v_class_of text[] := '{}';
  v_code_of integer[] := '{}';
  v_ref jsonb[] := '{}';
  v_net bigint[];
  v_tax bigint[];
  v_after bigint[];
  v_idx integer[];
  v_weights bigint[];
  v_share bigint[];
  v_group_gross bigint;
  v_group_net bigint;
  v_item_count integer;
  v_excluded numeric := 0;
  v_lines jsonb := '[]'::jsonb;
  v_i integer;
  v_j integer;
begin
  select o.* into v_order from public.orders o where o.id = p_order_id and o.business_id = p_business_id;
  if not found then raise exception 'pedido inexistente' using errcode = 'P0002'; end if;

  select d.id into v_document_id from public.fiscal_documents d
   where d.business_id = p_business_id and d.source_type = 'online_order' and d.source_id = p_order_id and d.document_intent = 'invoice';
  if found then
    return jsonb_build_object('status', 'ALREADY_REQUESTED', 'reasons', '[]'::jsonb, 'fiscal_document_id', v_document_id);
  end if;

  if v_order.origin = 'qa' or v_order.payment_method = 'qa_no_charge' then
    return jsonb_build_object('status', 'BLOCKED', 'reasons', jsonb_build_array(jsonb_build_object('code', 'QA_ORDER_NOT_BILLABLE')));
  end if;
  if v_order.status in ('cancelled', 'canceled', 'rejected') then
    return jsonb_build_object('status', 'BLOCKED', 'reasons', jsonb_build_array(jsonb_build_object('code', 'ORDER_CANCELLED')));
  end if;

  -- Perfil fiscal y compuertas de ambiente.
  select fp.* into v_profile from public.fiscal_profiles fp where fp.business_id = p_business_id;
  if not found or not v_profile.is_enabled or v_profile.environment = 'disabled' then
    v_reasons := v_reasons || jsonb_build_object('code', 'FISCAL_PROFILE_DISABLED');
  elsif v_profile.environment = 'homologation' and v_profile.homologation_authorized_at is null then
    v_reasons := v_reasons || jsonb_build_object('code', 'HOMOLOGATION_NOT_AUTHORIZED');
  elsif v_profile.environment = 'production'
        and (v_profile.accountant_review_status <> 'approved' or v_profile.production_gate_status <> 'approved') then
    v_reasons := v_reasons || jsonb_build_object('code', 'PRODUCTION_BLOCKED');
  end if;

  -- Politica fiscal del core: la misma que va a exigir la emision.
  if v_profile.business_id is not null and v_profile.environment <> 'disabled' then
    begin
      select p.* into v_core_policy from public.fiscal_accounting_policies p
       where p.business_id = p_business_id and p.environment = v_profile.environment
         and p.issuer_condition = v_profile.tax_condition and p.recipient_condition = v_profile.default_recipient_condition
         and p.concept = v_profile.default_concept and p.enabled and p.accountant_review_status = 'approved'
         and p.valid_from <= current_date
       order by p.valid_from desc, p.created_at desc limit 1;
      if not found then raise exception 'sin politica' using errcode = 'P0001'; end if;
      v_core_policy := public.resolve_fiscal_accounting_policy(p_business_id, v_profile.environment, v_profile.tax_condition,
        v_profile.default_recipient_condition, v_profile.default_concept, v_core_policy.invoice_type, current_date);
      if v_core_policy.recipient_vat_condition_id is null then raise exception 'sin condicion' using errcode = 'P0001'; end if;
    exception when others then
      v_reasons := v_reasons || jsonb_build_object('code', 'ACCOUNTING_POLICY_REQUIRED', 'scope', 'fiscal');
    end;
  end if;

  -- Politica comercial aprobada y vigente.
  select p.* into v_policy from public.commercial_fiscal_policies p
   where p.business_id = p_business_id and p.status = 'approved' and p.valid_from <= current_date
   order by p.valid_from desc, p.approved_at desc limit 1;
  v_has_policy := found;
  if not v_has_policy then
    v_reasons := v_reasons || jsonb_build_object('code', 'ACCOUNTING_POLICY_REQUIRED', 'scope', 'commercial');
  end if;

  -- Pago y momento fiscal: el estado REAL del pedido contra lo que fija la politica.
  v_payment := private.order_payment_state(v_order);
  if v_has_policy then
    v_rule := case v_order.payment_method
      when 'mercadopago' then v_policy.mercadopago_rule when 'cash' then v_policy.cash_rule
      when 'coordinate' then v_policy.coordinate_rule end;
    if v_rule is null or v_rule = 'not_invoiceable' then
      v_reasons := v_reasons || jsonb_build_object('code', 'PAYMENT_METHOD_NOT_INVOICEABLE', 'payment_method', v_order.payment_method);
    elsif v_payment in ('reversed', 'refunded', 'unknown') then
      v_reasons := v_reasons || jsonb_build_object('code', 'PAYMENT_REQUIRED', 'payment_state', v_payment);
    elsif v_rule in ('require_approved', 'require_confirmed') and v_payment <> 'confirmed' then
      v_reasons := v_reasons || jsonb_build_object('code', 'PAYMENT_REQUIRED', 'payment_state', v_payment);
    end if;
    if (v_policy.billing_moment = 'after_payment_confirmed' and v_payment <> 'confirmed')
       or (v_policy.billing_moment = 'after_delivered' and v_order.status <> 'delivered')
       or (v_policy.billing_moment = 'after_accepted' and not (v_order.status = any (c_accepted_or_later))) then
      v_reasons := v_reasons || jsonb_build_object('code', 'ORDER_NOT_BILLABLE_YET', 'billing_moment', v_policy.billing_moment);
    end if;
  end if;

  -- Importes exactos al centavo.
  if v_order.total <> round(v_order.total, 2) or v_order.subtotal <> round(v_order.subtotal, 2)
     or v_order.discount_total <> round(v_order.discount_total, 2) or v_order.delivery_fee <> round(v_order.delivery_fee, 2)
     or coalesce(nullif(upper(v_order.currency_code), ''), 'ARS') <> 'ARS' then
    v_reasons := v_reasons || jsonb_build_object('code', 'INVALID_TOTAL', 'detail', 'order_amounts');
  end if;

  -- Items: producto canonico y su clasificacion. Cantidades fraccionadas: hasta 3 decimales.
  for v_item in select i.* from public.order_items i where i.order_id = v_order.id order by i.created_at, i.id
  loop
    v_count := v_count + 1;
    v_items_total := v_items_total + v_item.subtotal;
    if v_item.quantity <> round(v_item.quantity, 3) or v_item.unit_price <> round(v_item.unit_price, 2)
       or v_item.subtotal <> round(v_item.subtotal, 2) then
      v_reasons := v_reasons || jsonb_build_object('code', 'INVALID_TOTAL', 'detail', 'item_precision', 'item', v_item.name);
    end if;
    v_product := private.commercial_order_item_product(p_business_id, v_item.product_uuid, v_item.product_id);
    if v_product is null then
      v_reasons := v_reasons || jsonb_build_object('code', 'INVALID_PRODUCT_REFERENCE', 'item', v_item.name);
      continue;
    end if;
    -- Un producto de prueba (test_only/staging_only) nunca se factura, llegue como llegue la
    -- referencia: la clasificacion QA del pedido solo mira product_uuid, no la referencia legada.
    if exists (select 1 from public.products p where p.id = v_product and p.catalog_origin in ('test_only', 'staging_only')) then
      v_reasons := v_reasons || jsonb_build_object('code', 'QA_ORDER_NOT_BILLABLE', 'item', v_item.name);
      continue;
    end if;
    select c.* into v_class from public.product_fiscal_classifications c where c.business_id = p_business_id and c.product_id = v_product;
    if not found then
      v_reasons := v_reasons || jsonb_build_object('code', 'MISSING_TAX_CLASSIFICATION', 'item', v_item.name, 'product_id', v_product);
      continue;
    end if;
    v_kind := v_kind || 'item'::text;
    v_desc := v_desc || left(btrim(v_item.name), 200);
    v_qty := v_qty || v_item.quantity;
    v_price := v_price || v_item.unit_price;
    v_gross := v_gross || round(v_item.subtotal * 100)::bigint;
    v_class_of := v_class_of || v_class.classification;
    v_code_of := array_append(v_code_of, v_class.vat_code::integer);
    v_ref := v_ref || jsonb_build_object('product_id', v_product, 'order_item_id', v_item.id);
    if v_class.vat_code is not null and not (v_class.vat_code = any (v_codes)) then v_codes := v_codes || v_class.vat_code::integer; end if;
  end loop;
  if v_count = 0 or v_items_total <> v_order.subtotal then
    v_reasons := v_reasons || jsonb_build_object('code', 'INVALID_TOTAL', 'detail', 'items_subtotal');
  end if;

  -- Descuento y envio: solo como los declara la politica.
  if v_has_policy and v_order.discount_total > 0 and v_policy.discount_treatment = 'not_invoiceable' then
    v_reasons := v_reasons || jsonb_build_object('code', 'DISCOUNT_NOT_INVOICEABLE');
  end if;
  if v_has_policy and v_order.delivery_fee > 0 then
    if v_policy.delivery_treatment = 'not_invoiceable' then
      v_reasons := v_reasons || jsonb_build_object('code', 'DELIVERY_NOT_INVOICEABLE');
    elsif v_policy.delivery_treatment = 'invoice_as_line' and not (v_policy.delivery_vat_code = any (v_codes)) then
      v_codes := v_codes || v_policy.delivery_vat_code::integer;
    end if;
  end if;

  -- Cada alicuota, en la tabla vigente de ARCA.
  if v_profile.business_id is not null and v_profile.environment in ('homologation', 'production') then
    foreach v_code in array v_codes loop
      if not public.fiscal_has_current_parameter_id(v_profile.environment, 'vat_types', v_code) then
        v_reasons := v_reasons || jsonb_build_object('code', 'FISCAL_PARAMETERS_REQUIRED', 'vat_code', v_code);
      end if;
    end loop;
  end if;

  -- Consumidor final: desde el umbral que declaro el contador hay que identificarlo.
  -- La Taba todavia no captura esos datos: fail closed.
  if v_has_policy and v_order.total >= v_policy.final_consumer_id_threshold then
    v_reasons := v_reasons || jsonb_build_object('code', 'RECIPIENT_DATA_REQUIRED', 'threshold', v_policy.final_consumer_id_threshold);
  end if;

  if jsonb_array_length(v_reasons) > 0 then
    return jsonb_build_object('status', 'BLOCKED', 'reasons', v_reasons);
  end if;
  if not p_build_snapshot then
    return jsonb_build_object('status', 'READY', 'reasons', '[]'::jsonb);
  end if;

  -- ---- origen congelado: lineas al centavo -----------------------------------------
  v_item_count := coalesce(array_length(v_kind, 1), 0);
  v_discount := private.allocate_cents(round(v_order.discount_total * 100)::bigint, v_gross);
  if v_order.delivery_fee > 0 then
    if v_policy.delivery_treatment = 'invoice_as_line' then
      v_kind := v_kind || 'delivery'::text;
      v_desc := v_desc || coalesce(btrim(v_policy.delivery_line_description), 'Envío');
      v_qty := v_qty || 1::numeric;
      v_price := v_price || v_order.delivery_fee;
      v_gross := v_gross || round(v_order.delivery_fee * 100)::bigint;
      v_discount := v_discount || 0::bigint;
      v_class_of := v_class_of || 'taxed'::text;
      v_code_of := array_append(v_code_of, v_policy.delivery_vat_code::integer);
      v_ref := v_ref || jsonb_build_object('delivery', true);
    else
      v_excluded := v_order.delivery_fee;
    end if;
  end if;
  v_net := array_fill(0::bigint, array[array_length(v_kind, 1)]);
  v_tax := array_fill(0::bigint, array[array_length(v_kind, 1)]);
  v_after := array_fill(0::bigint, array[array_length(v_kind, 1)]);
  for v_i in 1 .. array_length(v_kind, 1) loop
    v_after[v_i] := v_gross[v_i] - v_discount[v_i];
  end loop;
  -- IVA por alicuota sobre el total del grupo, repartido a sus lineas por resto mayor.
  foreach v_code in array v_codes loop
    v_idx := '{}';
    v_weights := '{}';
    for v_i in 1 .. array_length(v_kind, 1) loop
      if v_class_of[v_i] = 'taxed' and v_code_of[v_i] = v_code then
        v_idx := v_idx || v_i;
        v_weights := v_weights || v_after[v_i];
      end if;
    end loop;
    continue when coalesce(array_length(v_idx, 1), 0) = 0;
    v_group_gross := (select sum(w) from unnest(v_weights) w);
    v_group_net := round(v_group_gross::numeric / (1 + private.fiscal_vat_rate(v_code) / 100))::bigint;
    v_share := private.allocate_cents(v_group_net, v_weights);
    for v_j in 1 .. array_length(v_idx, 1) loop
      v_net[v_idx[v_j]] := v_share[v_j];
      v_tax[v_idx[v_j]] := v_after[v_idx[v_j]] - v_share[v_j];
    end loop;
  end loop;
  for v_i in 1 .. array_length(v_kind, 1) loop
    v_lines := v_lines || jsonb_build_object(
      'kind', v_kind[v_i], 'description', v_desc[v_i], 'quantity', trim_scale(v_qty[v_i])::text, 'unit_price', to_char(v_price[v_i], 'FM999999999990.00'),
      'gross_amount', to_char(v_gross[v_i] / 100.0, 'FM999999999990.00'),
      'discount_amount', to_char(v_discount[v_i] / 100.0, 'FM999999999990.00'),
      'net_amount', to_char(v_net[v_i] / 100.0, 'FM999999999990.00'),
      'tax_amount', to_char(v_tax[v_i] / 100.0, 'FM999999999990.00'),
      'tax_code', case when v_class_of[v_i] = 'taxed' then to_jsonb(v_code_of[v_i]) else 'null'::jsonb end,
      'exempt_amount', to_char(case when v_class_of[v_i] = 'exempt' then v_after[v_i] else 0 end / 100.0, 'FM999999999990.00'),
      'non_taxed_amount', to_char(case when v_class_of[v_i] = 'non_taxed' then v_after[v_i] else 0 end / 100.0, 'FM999999999990.00'),
      'other_taxes_amount', '0.00',
      'reference', v_ref[v_i]);
  end loop;
  return jsonb_build_object(
    'status', 'READY', 'reasons', '[]'::jsonb,
    'policy', jsonb_build_object('id', v_policy.id, 'policy_version', v_policy.policy_version),
    'snapshot', jsonb_strip_nulls(jsonb_build_object(
      'currency', v_profile.default_currency,
      'source_total', to_char(v_order.total, 'FM999999999990.00'),
      'excluded_amount', to_char(v_excluded, 'FM999999999990.00'),
      'excluded_reason', case when v_excluded > 0 then 'envio excluido por politica ' || v_policy.policy_version end,
      'policy_ref', jsonb_build_object('adapter', 'la-taba/commercial-order', 'policy_version', v_policy.policy_version,
        'policy_id', v_policy.id, 'core_policy_version', v_core_policy.policy_version),
      'lines', v_lines)));
end;
$commercial_order_fiscal_evaluation$;

-- ---- facturar e imprimir: pedido de impresion durable -------------------------------
create table if not exists public.fiscal_print_requests (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete restrict,
  fiscal_document_id uuid not null unique references public.fiscal_documents(id) on delete restrict,
  requested_by uuid references auth.users(id) on delete set null,
  requested_by_type text not null check (requested_by_type in ('operator', 'system')),
  command_source text check (command_source is null or command_source in ('PANEL', 'MOBILE', 'WHATSAPP', 'AUTOMATION')),
  created_at timestamptz not null default now(),
  fulfilled_at timestamptz,
  print_job_id uuid references public.print_jobs(id) on delete restrict,
  last_error text check (last_error is null or char_length(last_error) <= 200),
  constraint fiscal_print_requests_fulfilled_consistent check ((fulfilled_at is null) = (print_job_id is null)),
  constraint fiscal_print_requests_operator_has_actor check (requested_by_type <> 'operator' or requested_by is not null)
);
alter table public.fiscal_print_requests enable row level security;
revoke all on public.fiscal_print_requests from public, anon, authenticated, service_role;
grant select on public.fiscal_print_requests to authenticated, service_role;
drop policy if exists "fiscal print requests readable by back office" on public.fiscal_print_requests;
create policy "fiscal print requests readable by back office" on public.fiscal_print_requests
  for select to authenticated using (public.has_business_role(business_id, array['owner', 'admin', 'staff']));

-- Cumple el pedido de impresion si el comprobante ya esta autorizado. Mismo idempotency key
-- que la impresion automatica: un solo primer ticket por comprobante (las copias se piden
-- con request_print_job_reprint).
create or replace function private.commercial_fulfill_fiscal_print(p_document_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $commercial_fulfill_fiscal_print$
declare
  v_request public.fiscal_print_requests%rowtype;
  v_document public.fiscal_documents%rowtype;
  v_job jsonb;
begin
  select r.* into v_request from public.fiscal_print_requests r where r.fiscal_document_id = p_document_id for update;
  if not found then return null; end if;
  if v_request.fulfilled_at is not null then
    return jsonb_build_object('status', 'fulfilled', 'print_job_id', v_request.print_job_id);
  end if;
  select d.* into v_document from public.fiscal_documents d where d.id = p_document_id;
  if v_document.state not in ('authorized', 'credited') then
    return jsonb_build_object('status', 'waiting_authorization');
  end if;
  v_job := private.print_enqueue(v_document.business_id, 'fiscal_receipt', v_document.id,
    private.fiscal_receipt_print_payload(v_document.id),
    case when v_request.requested_by_type = 'operator' then 'panel' else 'automatic' end,
    v_request.requested_by, 'auto:fiscal_receipt:' || v_document.id::text, null, null,
    case when v_request.requested_by_type = 'operator' then 'user' else 'system' end, null);
  update public.fiscal_print_requests
     set fulfilled_at = now(), print_job_id = (v_job->>'print_job_id')::uuid, last_error = null
   where id = v_request.id;
  return jsonb_build_object('status', 'fulfilled', 'print_job_id', (v_job->>'print_job_id')::uuid);
end;
$commercial_fulfill_fiscal_print$;

create or replace function private.commercial_register_fiscal_print(p_document_id uuid, p_actor_id uuid, p_actor_type text, p_command_source text)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $commercial_register_fiscal_print$
begin
  insert into public.fiscal_print_requests(business_id, fiscal_document_id, requested_by, requested_by_type, command_source)
  select d.business_id, d.id, p_actor_id, p_actor_type, p_command_source from public.fiscal_documents d where d.id = p_document_id
  on conflict (fiscal_document_id) do nothing;
  return private.commercial_fulfill_fiscal_print(p_document_id);
end;
$commercial_register_fiscal_print$;

-- Al autorizarse, se cumple el pedido de impresion pendiente. Imprimir nunca frena una
-- autorizacion: si falla, queda anotado y el Panel ofrece imprimir.
create or replace function private.fiscal_documents_fulfill_print_requests()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $fiscal_documents_fulfill_print_requests$
begin
  if new.state = 'authorized' and old.state is distinct from new.state then
    begin
      perform private.commercial_fulfill_fiscal_print(new.id);
    exception when others then
      update public.fiscal_print_requests set last_error = left(sqlstate || ': ' || sqlerrm, 200)
       where fiscal_document_id = new.id and fulfilled_at is null;
      raise warning 'impresion fiscal pedida omitida para %: % (%)', new.id, sqlerrm, sqlstate;
    end;
  end if;
  return null;
end;
$fiscal_documents_fulfill_print_requests$;

drop trigger if exists fiscal_documents_fulfill_print_requests on public.fiscal_documents;
create trigger fiscal_documents_fulfill_print_requests after update of state on public.fiscal_documents
for each row execute function private.fiscal_documents_fulfill_print_requests();

-- ---- pedir la factura de un pedido ---------------------------------------------------
-- Preparar es del adaptador: serializar, evaluar y congelar el origen. Emitir es del core, por
-- sus entradas publicas (la unica ruta a private.fiscal_request_invoice sigue siendo esa):
-- el adaptador nunca abre un camino paralelo de emision.
create or replace function private.commercial_prepare_order_invoice(
  p_business_id uuid,
  p_order_id uuid,
  p_actor_id uuid,
  p_actor_type text
)
returns text
language plpgsql
security definer
set search_path = pg_catalog, public, extensions, pg_temp
as $commercial_prepare_order_invoice$
declare
  v_evaluation jsonb;
begin
  if p_business_id is null or p_order_id is null then raise exception 'pedido invalido' using errcode = '22023'; end if;
  -- El mismo lock que toma el core para esta intencion: evaluar, congelar y encolar es atomico
  -- frente a cualquier otro canal pidiendo la misma factura (el core lo vuelve a tomar: reentrante).
  perform pg_advisory_xact_lock(hashtextextended('taba-fiscal:intent:'
    || private.fiscal_invoice_fingerprint(p_business_id, 'online_order', p_order_id, 'invoice'), 0));
  v_evaluation := private.commercial_order_fiscal_evaluation(p_business_id, p_order_id, true);
  if v_evaluation->>'status' = 'BLOCKED' then
    raise exception 'pedido no facturable' using errcode = 'P0001', hint = 'ORDER_NOT_FISCALLY_READY',
      detail = (v_evaluation->'reasons')::text;
  end if;
  if v_evaluation->>'status' = 'READY' then
    perform private.fiscal_freeze_source_snapshot(p_business_id, 'online_order', p_order_id, v_evaluation->'snapshot', p_actor_id, p_actor_type);
  end if;
  return v_evaluation->>'status';
end;
$commercial_prepare_order_invoice$;

-- Panel y celular: el operador autenticado es el actor. Nunca un cliente ni un rider.
create or replace function public.request_order_invoice(
  p_business_id uuid,
  p_order_id uuid,
  p_idempotency_key text,
  p_command_source text default null,
  p_print boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, extensions, pg_temp
as $request_order_invoice$
declare
  v_result jsonb;
  v_print jsonb;
begin
  if not public.has_business_role(p_business_id, array['owner', 'admin', 'staff']) then
    raise exception 'operador no autorizado' using errcode = '42501';
  end if;
  if p_command_source is not null and p_command_source not in ('PANEL', 'MOBILE') then
    raise exception 'canal invalido' using errcode = '22023';
  end if;
  perform private.commercial_prepare_order_invoice(p_business_id, p_order_id, auth.uid(), 'operator');
  v_result := public.request_fiscal_document(p_business_id, 'online_order', p_order_id, 'invoice', p_idempotency_key, p_command_source);
  if coalesce(p_print, false) then
    v_print := private.commercial_register_fiscal_print((v_result->>'fiscal_document_id')::uuid, auth.uid(), 'operator', p_command_source);
  end if;
  return v_result || jsonb_build_object('print', v_print);
end;
$request_order_invoice$;

-- Canales de servidor (WhatsApp, automatizaciones): las guardas de La Taba antes de preparar;
-- despues, la entrada de servidor del core (que las vuelve a aplicar).
create or replace function public.service_request_order_invoice(
  p_business_id uuid,
  p_order_id uuid,
  p_idempotency_key text,
  p_command_source text,
  p_actor_id uuid default null,
  p_print boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, extensions, pg_temp
as $service_request_order_invoice$
declare
  v_result jsonb;
  v_print jsonb;
begin
  if coalesce(public.identity_jwt_claims() ->> 'role', '') <> 'service_role' then
    raise exception 'canal de servidor no autorizado' using errcode = '42501';
  end if;
  if p_command_source is null or p_command_source not in ('WHATSAPP', 'AUTOMATION') then
    raise exception 'canal de servicio invalido' using errcode = '22023';
  end if;
  if p_command_source = 'WHATSAPP' and p_actor_id is null then
    raise exception 'un pedido por WhatsApp requiere el usuario que lo hizo' using errcode = '22023';
  end if;
  if p_actor_id is not null and not exists (
    select 1 from public.business_members m
     where m.business_id = p_business_id and m.user_id = p_actor_id and m.is_active and m.role in ('owner', 'admin', 'staff')) then
    raise exception 'actor ajeno al negocio' using errcode = '42501';
  end if;
  perform private.commercial_prepare_order_invoice(p_business_id, p_order_id, p_actor_id, 'system');
  v_result := public.service_request_fiscal_document(p_business_id, 'online_order', p_order_id, 'invoice', p_idempotency_key,
    p_command_source, p_actor_id);
  if coalesce(p_print, false) then
    v_print := private.commercial_register_fiscal_print((v_result->>'fiscal_document_id')::uuid, p_actor_id, 'system', p_command_source);
  end if;
  return v_result || jsonb_build_object('print', v_print);
end;
$service_request_order_invoice$;

-- ---- lo que ve el Panel: el estado REAL por pedido ---------------------------------------
-- Una sola lectura para la bandeja: evaluacion (sin armar el origen) o el comprobante real,
-- su PDF vigente y su impresion. Nada de esto vive en el cliente.
create or replace function public.get_order_fiscal_states(p_business_id uuid, p_order_ids uuid[])
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, extensions, pg_temp
as $get_order_fiscal_states$
declare
  v_order_id uuid;
  v_out jsonb := '[]'::jsonb;
  v_document public.fiscal_documents%rowtype;
  v_evaluation jsonb;
begin
  if not public.has_business_role(p_business_id, array['owner', 'admin', 'staff']) then
    raise exception 'operador no autorizado' using errcode = '42501';
  end if;
  if p_order_ids is null or cardinality(p_order_ids) > 100 then
    raise exception 'lista de pedidos invalida' using errcode = '22023';
  end if;
  foreach v_order_id in array p_order_ids loop
    continue when not exists (select 1 from public.orders o where o.id = v_order_id and o.business_id = p_business_id);
    select d.* into v_document from public.fiscal_documents d
     where d.business_id = p_business_id and d.source_type = 'online_order' and d.source_id = v_order_id and d.document_intent = 'invoice';
    if found then
      v_out := v_out || jsonb_build_object(
        'order_id', v_order_id,
        'readiness', jsonb_build_object('status', 'ALREADY_REQUESTED', 'reasons', '[]'::jsonb),
        'document', jsonb_build_object(
          'id', v_document.id, 'state', v_document.state, 'environment', v_document.environment,
          'document_type', v_document.document_type, 'point_of_sale', v_document.point_of_sale,
          'document_number', v_document.document_number,
          'cae', case when v_document.state in ('authorized', 'credited') then v_document.cae end,
          'cae_expiration', case when v_document.state in ('authorized', 'credited') then v_document.cae_expiration end,
          'authorized_at', v_document.authorized_at, 'total_amount', v_document.total_amount,
          'artifact_state', v_document.artifact_state,
          'artifact_id', (select a.id from public.fiscal_document_artifacts a
                           where a.fiscal_document_id = v_document.id and a.is_current and a.state = 'artifact_ready' limit 1)),
        'print', jsonb_build_object(
          'requested', exists (select 1 from public.fiscal_print_requests r where r.fiscal_document_id = v_document.id),
          'request_error', (select r.last_error is not null from public.fiscal_print_requests r where r.fiscal_document_id = v_document.id),
          'latest_job', (select jsonb_build_object('id', j.id, 'status', j.status, 'reprint_of', j.reprint_of, 'created_at', j.created_at)
                           from public.print_jobs j
                          where j.business_id = p_business_id and j.document_type = 'fiscal_receipt' and j.source_entity_id = v_document.id
                          order by j.created_at desc, j.id desc limit 1),
          'jobs', (select count(*) from public.print_jobs j
                    where j.business_id = p_business_id and j.document_type = 'fiscal_receipt' and j.source_entity_id = v_document.id)));
    else
      v_evaluation := private.commercial_order_fiscal_evaluation(p_business_id, v_order_id, false);
      v_out := v_out || jsonb_build_object('order_id', v_order_id,
        'readiness', jsonb_build_object('status', v_evaluation->>'status', 'reasons', coalesce(v_evaluation->'reasons', '[]'::jsonb)),
        'document', null, 'print', null);
    end if;
  end loop;
  return v_out;
end;
$get_order_fiscal_states$;

-- ---- permisos ------------------------------------------------------------------------
revoke all on function private.allocate_cents(bigint, bigint[]) from public;
revoke all on function private.order_payment_state(public.orders) from public;
revoke all on function private.commercial_order_item_product(uuid, uuid, text) from public;
revoke all on function private.commercial_order_fiscal_evaluation(uuid, uuid, boolean) from public;
revoke all on function private.commercial_fulfill_fiscal_print(uuid) from public;
revoke all on function private.commercial_register_fiscal_print(uuid, uuid, text, text) from public;
revoke all on function private.fiscal_documents_fulfill_print_requests() from public;
revoke all on function private.commercial_prepare_order_invoice(uuid, uuid, uuid, text) from public;
revoke all on function public.request_order_invoice(uuid, uuid, text, text, boolean) from public, anon, authenticated, service_role;
grant execute on function public.request_order_invoice(uuid, uuid, text, text, boolean) to authenticated;
revoke all on function public.service_request_order_invoice(uuid, uuid, text, text, uuid, boolean) from public, anon, authenticated, service_role;
grant execute on function public.service_request_order_invoice(uuid, uuid, text, text, uuid, boolean) to service_role;
revoke all on function public.get_order_fiscal_states(uuid, uuid[]) from public, anon, authenticated, service_role;
grant execute on function public.get_order_fiscal_states(uuid, uuid[]) to authenticated;

comment on function public.request_order_invoice(uuid, uuid, text, text, boolean) is
  'Factura un pedido online (Panel/celular) con el core fiscal. Falla cerrado con P0001 ORDER_NOT_FISCALLY_READY y las razones en detail.';
comment on function public.get_order_fiscal_states(uuid, uuid[]) is
  'Estado fiscal REAL por pedido: evaluacion o comprobante, PDF vigente e impresion.';
