-- Additive draft metadata only. No order, stock, payment or public catalog change.
alter table public.catalog_product_drafts alter column scanned_gtin drop not null;
alter table public.catalog_product_drafts
  add column if not exists commercial_details jsonb not null default '{}'::jsonb
  check (jsonb_typeof(commercial_details) = 'object' and octet_length(commercial_details::text) <= 16000);

create index if not exists catalog_drafts_business_pending_created_idx
  on public.catalog_product_drafts(business_id, created_at desc) where status = 'pending_review';

create or replace function public.save_catalog_product_draft_details(p_draft_id uuid, p_details jsonb)
returns public.catalog_product_drafts
language plpgsql security definer
set search_path = pg_catalog, public, extensions, pg_temp
as $$
declare
  v_draft public.catalog_product_drafts%rowtype;
  v_key text;
  v_value jsonb;
  v_text text;
begin
  select * into v_draft from public.catalog_product_drafts where id = p_draft_id for update;
  if not found or auth.uid() is null or not public.has_business_role(v_draft.business_id, array['owner','admin','staff']) then
    raise exception 'No podés editar este borrador.' using errcode = '42501';
  end if;
  if v_draft.status <> 'pending_review' then
    raise exception 'El borrador ya fue revisado.' using errcode = '22023';
  end if;
  if p_details is null or jsonb_typeof(p_details) <> 'object' or octet_length(p_details::text) > 16000
    or p_details - array['name','brand','category','variant','capacityValue','capacityUnit','packageType','unitsPerPack','stock','price','cost','pricePending','pricingMode','unitQuantity','pricePerKg'] <> '{}'::jsonb then
    raise exception 'Revisá los datos del borrador.' using errcode = '22023';
  end if;
  for v_key, v_value in select key,value from jsonb_each(p_details) loop
    if jsonb_typeof(v_value) not in ('string','number','boolean','null') then
      raise exception 'Dato de borrador inválido.' using errcode = '22023';
    end if;
    v_text := p_details ->> v_key;
    if length(v_text) > 180 then raise exception 'El dato es demasiado largo.' using errcode = '22023'; end if;
    if v_key in ('capacityValue','unitsPerPack','stock','price','cost','unitQuantity','pricePerKg') and coalesce(v_text,'') <> '' then
      if v_text !~ '^[0-9]+([.][0-9]{1,3})?$' or v_text::numeric > 999999999 then
        raise exception 'Revisá cantidades e importes.' using errcode = '22023';
      end if;
      if v_key in ('stock','unitsPerPack') and v_text::numeric <> trunc(v_text::numeric) then
        raise exception 'El stock de envases y las unidades son enteros.' using errcode = '22023';
      end if;
    end if;
  end loop;
  if coalesce(p_details->>'pricingMode','unit') not in ('unit','fixed_weight','variable_weight') then
    raise exception 'Modalidad de venta inválida.' using errcode = '22023';
  end if;
  update public.catalog_product_drafts set commercial_details = p_details,
    suggested_name = nullif(p_details->>'name',''), suggested_brand = nullif(p_details->>'brand',''),
    suggested_category = nullif(p_details->>'category',''), suggested_presentation = nullif(p_details->>'variant','')
    where id = p_draft_id returning * into v_draft;
  return v_draft;
end;
$$;
revoke all on function public.save_catalog_product_draft_details(uuid,jsonb) from public, anon;
grant execute on function public.save_catalog_product_draft_details(uuid,jsonb) to authenticated;

-- No conversion of variable weight to "one product = one kilogram" is allowed.
-- The existing publish RPC transitions this row before returning its product.
-- Raising here rolls that entire transaction back, including any product insert.
create or replace function public.guard_variable_weight_draft_publication()
returns trigger language plpgsql
set search_path = pg_catalog, public, pg_temp
as $$
begin
  if new.status = 'approved' and new.scanned_gtin is null then
    raise exception 'Completá el código real del producto antes de revisar la publicación.' using errcode = '23514';
  end if;
  if new.status = 'approved' and new.commercial_details->>'pricingMode' = 'variable_weight' then
    raise exception 'La venta por peso variable necesita un circuito de pesaje y cobro. Guardá el borrador sin publicar.' using errcode = '23514';
  end if;
  return new;
end;
$$;
revoke all on function public.guard_variable_weight_draft_publication() from public, anon, authenticated;
create trigger commerce_v3_guard_weight_draft
  before insert or update on public.catalog_product_drafts
  for each row execute function public.guard_variable_weight_draft_publication();

comment on column public.catalog_product_drafts.commercial_details is
  'Private review data. unitQuantity is kg for weight modes; pricePerKg is ARS/kg. No estimated or final charge is created from a draft.';

create or replace function public.create_manual_catalog_product_draft(p_business_id uuid, p_idempotency_key text)
returns public.catalog_product_drafts
language plpgsql security definer
set search_path = pg_catalog, public, extensions, pg_temp
as $$
declare v_draft public.catalog_product_drafts%rowtype;
begin
  if auth.uid() is null or not public.has_business_role(p_business_id, array['owner','admin','staff']) then
    raise exception 'No podés crear productos en este negocio.' using errcode = '42501';
  end if;
  if coalesce(p_idempotency_key,'') !~ '^[A-Za-z0-9_-]{8,128}$' then
    raise exception 'Solicitud inválida.' using errcode = '22023';
  end if;
  insert into public.catalog_product_drafts(business_id, scanned_gtin, source, idempotency_key, created_by)
    values(p_business_id, null, 'manual', p_idempotency_key, auth.uid())
    on conflict (business_id,idempotency_key) do nothing;
  select * into v_draft from public.catalog_product_drafts
    where business_id = p_business_id and idempotency_key = p_idempotency_key;
  return v_draft;
end;
$$;
revoke all on function public.create_manual_catalog_product_draft(uuid,text) from public, anon;
grant execute on function public.create_manual_catalog_product_draft(uuid,text) to authenticated;

create or replace function public.bind_catalog_product_draft_code(p_draft_id uuid, p_gtin text)
returns public.catalog_product_drafts
language plpgsql security definer
set search_path = pg_catalog, public, extensions, pg_temp
as $$
declare v_draft public.catalog_product_drafts%rowtype;
begin
  select * into v_draft from public.catalog_product_drafts where id = p_draft_id for update;
  if not found or auth.uid() is null or not public.has_business_role(v_draft.business_id, array['owner','admin','staff']) then
    raise exception 'No podés editar este borrador.' using errcode = '42501';
  end if;
  if v_draft.status <> 'pending_review' or v_draft.scanned_gtin is not null then
    raise exception 'Este borrador ya tiene un código o fue revisado.' using errcode = '22023';
  end if;
  if p_gtin is null or p_gtin !~ '^[0-9]{8}$|^[0-9]{12}$|^[0-9]{13}$|^[0-9]{14}$' or not public.gtin_check_digit_valid(p_gtin) then
    raise exception 'Revisá el código de barras del producto.' using errcode = '22023';
  end if;
  if exists(select 1 from public.product_barcodes where business_id = v_draft.business_id and gtin = p_gtin)
    or exists(select 1 from public.catalog_product_drafts where business_id = v_draft.business_id and scanned_gtin = p_gtin and status = 'pending_review') then
    raise exception 'Ese código ya existe. Abrí el producto o borrador original.' using errcode = '23505';
  end if;
  update public.catalog_product_drafts set scanned_gtin = p_gtin where id = p_draft_id returning * into v_draft;
  return v_draft;
end;
$$;
revoke all on function public.bind_catalog_product_draft_code(uuid,text) from public, anon;
grant execute on function public.bind_catalog_product_draft_code(uuid,text) to authenticated;
