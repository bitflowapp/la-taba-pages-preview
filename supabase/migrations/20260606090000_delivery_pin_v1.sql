-- La Taba - Delivery PIN v1
--
-- Adds a short proof-of-delivery code for delivery orders. The frontend sends
-- one on checkout, and this trigger also backfills/generates one server-side so
-- older clients and existing rows remain usable.

alter table public.orders add column if not exists delivery_pin text;
alter table public.orders add column if not exists delivery_pin_confirmed_at timestamptz;

alter table public.orders drop constraint if exists orders_delivery_pin_format;
alter table public.orders add constraint orders_delivery_pin_format check (
  delivery_pin is null or delivery_pin ~ '^[0-9]{4}$'
);

create or replace function public.generate_delivery_pin()
returns text
language sql
volatile
as $$
  select lpad(floor(random() * 10000)::int::text, 4, '0')
$$;

create or replace function public.set_order_delivery_pin()
returns trigger
language plpgsql
as $$
begin
  if coalesce(new.delivery_mode, new.fulfillment_type, 'delivery') = 'pickup' then
    new.delivery_pin := null;
    return new;
  end if;

  if new.delivery_pin is null or btrim(new.delivery_pin) = '' then
    new.delivery_pin := public.generate_delivery_pin();
  else
    new.delivery_pin := regexp_replace(new.delivery_pin, '\D', '', 'g');
  end if;

  if new.delivery_pin !~ '^[0-9]{4}$' then
    raise exception 'delivery_pin debe tener 4 digitos' using errcode = '22023';
  end if;

  return new;
end;
$$;

drop trigger if exists orders_set_delivery_pin on public.orders;
create trigger orders_set_delivery_pin
before insert or update of delivery_pin, delivery_mode, fulfillment_type
on public.orders
for each row execute function public.set_order_delivery_pin();

update public.orders
   set delivery_pin = public.generate_delivery_pin()
 where coalesce(delivery_mode, fulfillment_type, 'delivery') = 'delivery'
   and (delivery_pin is null or delivery_pin !~ '^[0-9]{4}$');

update public.orders
   set delivery_pin = null
 where coalesce(delivery_mode, fulfillment_type, 'delivery') = 'pickup'
   and delivery_pin is not null;

comment on column public.orders.delivery_pin is
  'Delivery PIN v1: 4-digit customer code required by the rider UI before marking delivery as delivered.';

comment on column public.orders.delivery_pin_confirmed_at is
  'Delivery PIN v1: demo/local timestamp set after the rider confirms delivery with the customer code.';
