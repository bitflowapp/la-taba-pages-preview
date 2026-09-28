-- ============================================================================
--  La Taba · politica fiscal comercial DECLARATIVA para pedidos online
-- ============================================================================
--
--  El core fiscal emite; no decide nada contable. Para que un pedido online se pueda
--  facturar, una persona (el contador del comercio) tiene que declarar y aprobar, por
--  negocio:
--    · billing_moment ............ cuando se factura: pago confirmado, entregado o aceptado;
--    · *_rule .................... que estado de pago habilita la factura, por medio de pago;
--    · vat_computation ........... como se calcula el IVA (hoy: precios con IVA incluido,
--                                  por alicuota);
--    · delivery_* ................ si el envio se factura, con que alicuota, o se excluye;
--    · discount_treatment ........ como se aplican los descuentos;
--    · final_consumer_id_threshold desde que total hay que identificar al consumidor final;
--    · credit_note_policy ........ devoluciones y notas de credito (hoy: revision manual);
--    · accountant_reference ...... quien lo decidio y donde consta.
--  Y cada producto vendible, su clasificacion (product_fiscal_classifications).
--
--  NO HAY DEFAULTS. Sin una politica APROBADA y completa: ACCOUNTING_POLICY_REQUIRED.
--  Sin la clasificacion del producto: MISSING_TAX_CLASSIFICATION. Nunca 0 % ni 21 %
--  "por las dudas". Una politica aprobada no se edita: se retira y se aprueba otra.
--  Las alicuotas son las oficiales de ARCA (3 0 %, 4 10,5 %, 5 21 %, 6 27 %, 8 5 %, 9 2,5 %).
-- ============================================================================

create table if not exists public.commercial_fiscal_policies (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete restrict,
  policy_version text not null check (char_length(btrim(policy_version)) between 1 and 64),
  valid_from date not null,
  status text not null default 'draft' check (status in ('draft', 'approved', 'retired')),
  billing_moment text check (billing_moment in ('after_payment_confirmed', 'after_delivered', 'after_accepted')),
  mercadopago_rule text check (mercadopago_rule in ('require_approved', 'not_invoiceable')),
  cash_rule text check (cash_rule in ('require_confirmed', 'allow_pending', 'not_invoiceable')),
  coordinate_rule text check (coordinate_rule in ('require_confirmed', 'allow_pending', 'not_invoiceable')),
  vat_computation text check (vat_computation in ('price_includes_vat_per_rate')),
  delivery_treatment text check (delivery_treatment in ('invoice_as_line', 'exclude_from_invoice', 'not_invoiceable')),
  delivery_vat_code smallint check (delivery_vat_code in (3, 4, 5, 6, 8, 9)),
  delivery_line_description text check (delivery_line_description is null or char_length(btrim(delivery_line_description)) between 1 and 80),
  discount_treatment text check (discount_treatment in ('prorate_by_item_gross', 'not_invoiceable')),
  final_consumer_id_threshold numeric(14,2) check (final_consumer_id_threshold >= 0),
  credit_note_policy text check (credit_note_policy in ('manual_review_only')),
  accountant_reference text check (accountant_reference is null or char_length(btrim(accountant_reference)) between 3 and 200),
  approved_by uuid references auth.users(id) on delete restrict,
  approved_at timestamptz,
  retired_at timestamptz,
  notes text check (notes is null or char_length(notes) <= 1000),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  constraint commercial_fiscal_policies_version_unique unique (business_id, policy_version),
  constraint commercial_fiscal_policies_approved_is_complete check (
    status = 'draft' or (
      billing_moment is not null and mercadopago_rule is not null and cash_rule is not null and coordinate_rule is not null
      and vat_computation is not null and delivery_treatment is not null and discount_treatment is not null
      and final_consumer_id_threshold is not null and credit_note_policy is not null
      and accountant_reference is not null and approved_by is not null and approved_at is not null)),
  constraint commercial_fiscal_policies_delivery_line_has_rate
    check (delivery_treatment is distinct from 'invoice_as_line' or delivery_vat_code is not null),
  constraint commercial_fiscal_policies_retired_consistent check ((status = 'retired') = (retired_at is not null))
);

create index if not exists commercial_fiscal_policies_active_idx
  on public.commercial_fiscal_policies(business_id, valid_from desc) where status = 'approved';

-- Aprobada, la politica es la que se aplico: no se edita ni se borra. Solo se retira.
create or replace function private.commercial_fiscal_policies_guard()
returns trigger
language plpgsql
set search_path = pg_catalog, public, pg_temp
as $commercial_fiscal_policies_guard$
begin
  if tg_op = 'DELETE' then
    if old.status <> 'draft' then
      raise exception 'una politica aprobada o retirada no se borra' using errcode = '55000';
    end if;
    return old;
  end if;
  if old.status = 'retired' then
    raise exception 'una politica retirada es final' using errcode = '55000';
  end if;
  if old.status = 'approved' and (new.status <> 'retired'
     or (to_jsonb(new) - array['status', 'retired_at']) is distinct from (to_jsonb(old) - array['status', 'retired_at'])) then
    raise exception 'una politica aprobada no se edita: se retira y se aprueba otra' using errcode = '55000';
  end if;
  return new;
end;
$commercial_fiscal_policies_guard$;

drop trigger if exists commercial_fiscal_policies_guard on public.commercial_fiscal_policies;
create trigger commercial_fiscal_policies_guard before update or delete on public.commercial_fiscal_policies
for each row execute function private.commercial_fiscal_policies_guard();

-- ---- clasificacion impositiva POR PRODUCTO ---------------------------------------
create table if not exists public.product_fiscal_classifications (
  business_id uuid not null references public.businesses(id) on delete restrict,
  product_id uuid not null references public.products(id) on delete restrict,
  classification text not null check (classification in ('taxed', 'exempt', 'non_taxed')),
  vat_code smallint check (vat_code in (3, 4, 5, 6, 8, 9)),
  source text not null check (source in ('accountant', 'owner_confirmed')),
  classified_by uuid not null references auth.users(id) on delete restrict,
  classified_at timestamptz not null default now(),
  primary key (business_id, product_id),
  constraint product_fiscal_classifications_taxed_has_rate check ((classification = 'taxed') = (vat_code is not null))
);

create or replace function private.product_fiscal_classifications_same_business()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $product_fiscal_classifications_same_business$
begin
  perform 1 from public.products p where p.id = new.product_id and p.business_id = new.business_id;
  if not found then
    raise exception 'el producto no es de este negocio' using errcode = '42501';
  end if;
  return new;
end;
$product_fiscal_classifications_same_business$;

drop trigger if exists product_fiscal_classifications_same_business on public.product_fiscal_classifications;
create trigger product_fiscal_classifications_same_business before insert or update on public.product_fiscal_classifications
for each row execute function private.product_fiscal_classifications_same_business();

-- ---- acceso ------------------------------------------------------------------------
-- El back office LEE la politica y las clasificaciones (el Panel explica que falta).
-- Las escribe un operador con service_role despues de la decision del contador: no hay
-- una pantalla que invente valores.
alter table public.commercial_fiscal_policies enable row level security;
alter table public.product_fiscal_classifications enable row level security;
revoke all on public.commercial_fiscal_policies, public.product_fiscal_classifications from public, anon, authenticated, service_role;
grant select on public.commercial_fiscal_policies, public.product_fiscal_classifications to authenticated;
grant select, insert, update on public.commercial_fiscal_policies, public.product_fiscal_classifications to service_role;
drop policy if exists "commercial fiscal policy readable by back office" on public.commercial_fiscal_policies;
create policy "commercial fiscal policy readable by back office" on public.commercial_fiscal_policies
  for select to authenticated using (public.has_business_role(business_id, array['owner', 'admin', 'staff']));
drop policy if exists "product fiscal classification readable by back office" on public.product_fiscal_classifications;
create policy "product fiscal classification readable by back office" on public.product_fiscal_classifications
  for select to authenticated using (public.has_business_role(business_id, array['owner', 'admin', 'staff']));

revoke all on function private.commercial_fiscal_policies_guard() from public;
revoke all on function private.product_fiscal_classifications_same_business() from public;

comment on table public.commercial_fiscal_policies is
  'Politica fiscal comercial declarativa (pedidos online). Sin una aprobada y completa: ACCOUNTING_POLICY_REQUIRED. No hay defaults.';
comment on table public.product_fiscal_classifications is
  'Clasificacion impositiva por producto (gravado con alicuota oficial, exento o no gravado). Sin ella: MISSING_TAX_CLASSIFICATION.';
