-- ============================================================================
-- INTEGRACIÓN COMERCIAL LA TABA <-> TABA FISCAL
--
-- Responsabilidades:
--   - La Taba: negocios, pedidos, ventas comerciales, cobros, usuarios y roles.
--   - Taba Fiscal: intención fiscal, comprobantes, ARCA, CAE, PDF, QR, print jobs.
--
-- Invariante:
--   Un Pedido -> Una Venta Comercial -> Una Intención Fiscal -> Un Comprobante
-- ============================================================================

-- 1. Vinculación del pedido con el comprobante fiscal y la venta comercial
alter table public.orders add column if not exists fiscal_document_id uuid references public.fiscal_documents(id) on delete set null;
alter table public.orders add column if not exists fiscal_sale_id uuid references public.pos_sales(id) on delete set null;

create index if not exists orders_fiscal_document_id_idx on public.orders(fiscal_document_id);
create index if not exists orders_fiscal_sale_id_idx on public.orders(fiscal_sale_id);

-- 2. Hardening de notification_outbox adoptado desde taba-fiscal (20260926221000)
alter table public.notification_outbox enable row level security;
revoke all on table public.notification_outbox from public, anon, authenticated;
grant select on table public.notification_outbox to authenticated;
drop policy if exists "back office reads its notifications" on public.notification_outbox;
create policy "back office reads its notifications" on public.notification_outbox
  for select to authenticated
  using (public.has_business_role(business_id, array['owner', 'admin', 'staff']));

revoke all on function public.enqueue_new_order_notification() from public, anon, authenticated;

-- 3. Tablas de vinculación y deduplicación para canal WhatsApp
create table if not exists public.whatsapp_pairings (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  wa_id text not null,
  linked_at timestamptz not null default now(),
  revoked_at timestamptz,
  created_at timestamptz not null default now()
);

create unique index if not exists whatsapp_pairings_active_idx
  on public.whatsapp_pairings(business_id, wa_id)
  where revoked_at is null;

create index if not exists whatsapp_pairings_wa_id_idx
  on public.whatsapp_pairings(wa_id);

alter table public.whatsapp_pairings enable row level security;
revoke all on table public.whatsapp_pairings from public, anon, authenticated;
grant select on table public.whatsapp_pairings to authenticated;

drop policy if exists "members view whatsapp pairings" on public.whatsapp_pairings;
create policy "members view whatsapp pairings" on public.whatsapp_pairings
  for select to authenticated
  using (public.has_business_role(business_id, array['owner', 'admin', 'staff']));

create table if not exists public.whatsapp_pairing_codes (
  code text not null primary key,
  business_id uuid not null references public.businesses(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '10 minutes'),
  used_at timestamptz
);

alter table public.whatsapp_pairing_codes enable row level security;
revoke all on table public.whatsapp_pairing_codes from public, anon, authenticated;

create table if not exists public.whatsapp_incoming_messages (
  wa_message_id text primary key,
  wa_id text not null,
  business_id uuid references public.businesses(id) on delete set null,
  payload jsonb not null,
  processed_at timestamptz not null default now()
);

alter table public.whatsapp_incoming_messages enable row level security;
revoke all on table public.whatsapp_incoming_messages from public, anon, authenticated;

-- 4. RPC comercial: Generación de código temporal de vinculación WhatsApp
create or replace function public.create_whatsapp_pairing_code(p_business_id uuid)
returns text
language plpgsql
security definer
set search_path = pg_catalog, public, extensions, pg_temp
as $create_pairing_code$
declare
  v_code text;
begin
  if not public.has_business_role(p_business_id, array['owner', 'admin']) then
    raise exception 'operador no autorizado para vincular whatsapp' using errcode = '42501';
  end if;

  -- Generar código de 6 dígitos legible (alfanumérico sin caracteres ambiguos)
  v_code := 'TAB-' || upper(substr(md5(random()::text || clock_timestamp()::text), 1, 6));

  insert into public.whatsapp_pairing_codes(code, business_id, user_id)
  values (v_code, p_business_id, auth.uid());

  return v_code;
end;
$create_pairing_code$;

grant execute on function public.create_whatsapp_pairing_code(uuid) to authenticated;

-- 5. RPC comercial: Facturación de Pedido hacia Taba Fiscal
create or replace function public.bill_commercial_order(
  p_order_id uuid,
  p_idempotency_key text default null,
  p_command_source text default 'PANEL',
  p_request_print boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, extensions, pg_temp
as $bill_order$
declare
  v_order public.orders%rowtype;
  v_item record;
  v_sale_id uuid;
  v_sale public.pos_sales%rowtype;
  v_fiscal_key text;
  v_res jsonb;
  v_fiscal_doc_id uuid;
  v_doc public.fiscal_documents%rowtype;
  v_subtotal numeric(12,2) := 0;
  v_total numeric(12,2) := 0;
  v_method text;
  v_actor_id uuid;
begin
  -- Serializar operación por pedido para evitar carreras concurrentes en la creación de la venta
  perform pg_advisory_xact_lock(hashtextextended('taba:bill-order:' || p_order_id::text, 0));

  select * into v_order from public.orders where id = p_order_id for update;
  if not found then
    raise exception 'pedido no encontrado' using errcode = 'P0002';
  end if;

  -- Validar canal y autorizar actor
  if coalesce(p_command_source, '') not in ('PANEL', 'MOBILE', 'WHATSAPP', 'AUTOMATION') then
    raise exception 'canal comercial no reconocido' using errcode = '22023';
  end if;

  if p_command_source in ('PANEL', 'MOBILE') then
    if not public.has_business_role(v_order.business_id, array['owner', 'admin', 'staff']) then
      raise exception 'operador no autorizado' using errcode = '42501';
    end if;
    v_actor_id := auth.uid();
  else
    -- WHATSAPP / AUTOMATION llamado por service_role
    v_actor_id := null;
  end if;

  -- Verificar si el pedido ya tiene comprobante fiscal asignado
  if v_order.fiscal_document_id is not null then
    select * into v_doc from public.fiscal_documents where id = v_order.fiscal_document_id;
    if found then
      return jsonb_build_object(
        'ok', true,
        'order_id', p_order_id,
        'fiscal_document_id', v_doc.id,
        'state', v_doc.state,
        'cae', v_doc.cae,
        'document_number', v_doc.document_number,
        'idempotent_replay', true
      );
    end if;
  end if;

  -- Asegurar la venta comercial subyacente (pos_sales)
  v_sale_id := v_order.fiscal_sale_id;
  if v_sale_id is null then
    select id into v_sale_id from public.pos_sales
    where business_id = v_order.business_id
      and idempotency_key = 'order-sale:' || p_order_id::text;
  end if;

  if v_sale_id is null then
    v_subtotal := v_order.subtotal;
    v_total := v_order.total;

    -- Mapear medio de pago a vocabulario POS
    v_method := case
      when v_order.payment_method in ('mercadopago', 'qr') then 'qr'
      when v_order.payment_method in ('credit_card', 'credit') then 'credit_card'
      when v_order.payment_method in ('debit_card', 'debit') then 'debit_card'
      when v_order.payment_method in ('transfer') then 'transfer'
      else 'cash'
    end;

    insert into public.pos_sales(
      business_id, operator_id, state, subtotal, total, currency, idempotency_key, completed_at
    ) values (
      v_order.business_id,
      coalesce(v_actor_id, v_order.user_id, '00000000-0000-0000-0000-000000000000'::uuid),
      'completed',
      v_subtotal,
      v_total,
      'ARS',
      'order-sale:' || p_order_id::text,
      now()
    ) returning * into v_sale;
    v_sale_id := v_sale.id;

    -- Copiar items preservando importes y generando tax_snapshot canónico
    for v_item in select * from public.order_items where order_id = p_order_id loop
      insert into public.pos_sale_items(
        sale_id, product_id, product_name, quantity, unit_price, line_total, tax_snapshot
      ) values (
        v_sale_id,
        coalesce(nullif(v_item.product_id, '')::uuid, gen_random_uuid()),
        v_item.name,
        v_item.quantity::integer,
        v_item.unit_price,
        v_item.subtotal,
        jsonb_build_object(
          'net_amount', trim_scale(v_item.subtotal::numeric)::text,
          'tax_amount', '0.00',
          'exempt_amount', '0.00',
          'non_taxed_amount', '0.00',
          'other_taxes_amount', '0.00'
        )
      );
    end loop;

    insert into public.pos_payments(sale_id, payment_method, amount, status)
    values (v_sale_id, v_method, v_total, 'confirmed');

    update public.orders set fiscal_sale_id = v_sale_id where id = p_order_id;
  end if;

  -- Preparar clave de idempotencia fiscal
  v_fiscal_key := coalesce(
    nullif(btrim(p_idempotency_key), ''),
    'order-invoice:' || p_order_id::text
  );

  -- Invocar el motor fiscal autoritativo respetando los privilegios del canal
  if p_command_source in ('PANEL', 'MOBILE') then
    v_res := public.request_fiscal_document(
      v_order.business_id,
      'pos_sale',
      v_sale_id,
      'invoice',
      v_fiscal_key,
      p_command_source
    );
  else
    v_res := public.service_request_fiscal_document(
      v_order.business_id,
      'pos_sale',
      v_sale_id,
      'invoice',
      v_fiscal_key,
      p_command_source,
      v_actor_id
    );
  end if;

  v_fiscal_doc_id := (v_res->>'fiscal_document_id')::uuid;

  update public.orders
  set fiscal_document_id = v_fiscal_doc_id
  where id = p_order_id;

  return jsonb_build_object(
    'ok', true,
    'order_id', p_order_id,
    'fiscal_document_id', v_fiscal_doc_id,
    'state', v_res->>'state',
    'idempotent_replay', coalesce((v_res->>'idempotent_replay')::boolean, false),
    'request_print', p_request_print
  );
end;
$bill_order$;

grant execute on function public.bill_commercial_order(uuid, text, text, boolean) to authenticated;
grant execute on function public.bill_commercial_order(uuid, text, text, boolean) to service_role;

comment on function public.bill_commercial_order(uuid, text, text, boolean) is
  'Puente comercial entre Pedidos de La Taba y Taba Fiscal. Asegura pos_sales e invoca request_fiscal_document / service_request_fiscal_document de forma idempotente.';
