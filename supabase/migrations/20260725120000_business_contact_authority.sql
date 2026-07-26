-- Server-authoritative business contact channel.
-- Apply after 20260725110000_catalog_publication_authority.sql.
--
-- A phone number is never presented as a verified customer-support channel
-- merely because text exists in businesses.whatsapp_phone. An authenticated
-- owner/admin must use the RPC below; the server validates and stamps the
-- authorization, and any later phone change fails closed automatically.

alter table public.businesses
  add column if not exists whatsapp_verified boolean not null default false;

alter table public.businesses
  add column if not exists whatsapp_verified_at timestamptz;

alter table public.businesses
  add column if not exists whatsapp_verified_by uuid
  references auth.users(id) on delete set null;

update public.businesses
   set whatsapp_verified = false,
       whatsapp_verified_at = null,
       whatsapp_verified_by = null;

alter table public.businesses
  drop constraint if exists businesses_whatsapp_verification_complete;

alter table public.businesses
  add constraint businesses_whatsapp_verification_complete
  check (
    (
      not whatsapp_verified
      and whatsapp_verified_at is null
      and whatsapp_verified_by is null
    )
    or (
      whatsapp_verified
      and whatsapp_verified_at is not null
      and whatsapp_verified_by is not null
      and char_length(
        regexp_replace(coalesce(whatsapp_phone, ''), '[^0-9]', '', 'g')
      ) between 8 and 15
    )
  );

create or replace function public.fail_close_business_whatsapp_change()
returns trigger
language plpgsql
set search_path = pg_catalog, public, extensions, pg_temp
as $$
begin
  if tg_op = 'INSERT' then
    new.whatsapp_verified := false;
    new.whatsapp_verified_at := null;
    new.whatsapp_verified_by := null;
  elsif new.whatsapp_phone is distinct from old.whatsapp_phone
     or (
       old.whatsapp_verified_by is not null
       and new.whatsapp_verified_by is null
     ) then
    new.whatsapp_verified := false;
    new.whatsapp_verified_at := null;
    new.whatsapp_verified_by := null;
  end if;
  return new;
end;
$$;

drop trigger if exists businesses_fail_close_whatsapp_change
on public.businesses;

create trigger businesses_fail_close_whatsapp_change
before insert or update of whatsapp_phone, whatsapp_verified_by on public.businesses
for each row execute function public.fail_close_business_whatsapp_change();

create or replace function public.set_business_whatsapp_contact(
  p_business_id uuid,
  p_whatsapp_phone text,
  p_verified boolean default false
)
returns table (
  whatsapp_phone text,
  whatsapp_verified boolean,
  whatsapp_verified_at timestamptz
)
language plpgsql
security definer
set search_path = pg_catalog, public, extensions, pg_temp
as $$
declare
  v_digits text;
begin
  if auth.uid() is null
     or not public.has_business_role(p_business_id, array['owner', 'admin']) then
    raise exception 'Only an active owner/admin can authorize the business contact channel.';
  end if;

  v_digits := regexp_replace(coalesce(p_whatsapp_phone, ''), '[^0-9]', '', 'g');
  if v_digits <> '' and char_length(v_digits) not between 8 and 15 then
    raise exception 'WhatsApp phone must contain between 8 and 15 digits.';
  end if;
  if coalesce(p_verified, false) and v_digits = '' then
    raise exception 'A valid WhatsApp phone is required before verification.';
  end if;

  -- First rotate the number and invalidate the previous authority stamp.
  update public.businesses b
     set whatsapp_phone = nullif(v_digits, ''),
         whatsapp_verified = false,
         whatsapp_verified_at = null,
         whatsapp_verified_by = null,
         updated_at = statement_timestamp()
   where b.id = p_business_id;
  if not found then
    raise exception 'Business not found.';
  end if;

  -- Verification is a separate update so the phone-change trigger cannot
  -- preserve an old stamp or override this newly authenticated decision.
  if coalesce(p_verified, false) then
    update public.businesses b
       set whatsapp_verified = true,
           whatsapp_verified_at = statement_timestamp(),
           whatsapp_verified_by = auth.uid(),
           updated_at = statement_timestamp()
     where b.id = p_business_id;
  end if;

  return query
  select b.whatsapp_phone, b.whatsapp_verified, b.whatsapp_verified_at
    from public.businesses b
   where b.id = p_business_id;
end;
$$;

create or replace function public.get_public_business_contact(
  p_business_id uuid
)
returns table (
  whatsapp_phone text,
  whatsapp_verified boolean
)
language sql
stable
security definer
set search_path = pg_catalog, public, extensions, pg_temp
as $$
  select
    regexp_replace(b.whatsapp_phone, '[^0-9]', '', 'g'),
    true
  from public.businesses b
  where b.id = p_business_id
    and b.is_active = true
    and b.whatsapp_verified = true
    and b.whatsapp_verified_at is not null
    and b.whatsapp_verified_by is not null
    and char_length(
      regexp_replace(coalesce(b.whatsapp_phone, ''), '[^0-9]', '', 'g')
    ) between 8 and 15
  limit 1;
$$;

-- Remove the historic table-wide grants. Browser clients may update normal
-- operating fields, but verification flags and the WhatsApp number itself are
-- readable/writable only through authoritative server paths.
revoke select, update on table public.businesses from anon, authenticated;

grant select (
  id,
  name,
  address,
  currency_code,
  ordering_enabled,
  ordering_verified,
  delivery_enabled,
  pickup_enabled,
  delivery_fee,
  minimum_delivery_subtotal,
  is_active,
  status
) on public.businesses to anon, authenticated;

grant update (
  name,
  status,
  phone,
  address,
  is_active,
  ordering_enabled,
  currency_code,
  delivery_enabled,
  pickup_enabled,
  delivery_fee,
  minimum_delivery_subtotal,
  alcohol_sales_enabled,
  alcohol_minimum_age,
  alcohol_sales_start,
  alcohol_sales_end,
  alcohol_timezone,
  order_rate_limit_per_10_minutes,
  max_pending_orders_per_customer,
  stock_reservation_minutes,
  abandoned_order_minutes,
  captcha_required
) on public.businesses to authenticated;

revoke all on function public.fail_close_business_whatsapp_change()
from public, anon, authenticated;
revoke all on function public.set_business_whatsapp_contact(uuid, text, boolean)
from public, anon, authenticated;
revoke all on function public.get_public_business_contact(uuid)
from public, anon, authenticated;
grant execute on function public.set_business_whatsapp_contact(uuid, text, boolean)
to authenticated;
grant execute on function public.get_public_business_contact(uuid)
to anon, authenticated;

comment on function public.set_business_whatsapp_contact(uuid, text, boolean) is
  'Owner/admin-only authority for a public WhatsApp channel. Validates digits, rotates the number fail-closed and records a server timestamp plus actor.';

comment on function public.get_public_business_contact(uuid) is
  'Returns the normalized contact only for an active business with a complete server-authoritative verification stamp; otherwise returns no rows.';
