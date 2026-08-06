-- La modalidad de pago deja de ser opcional y pasa a ser verificable.
--
-- Medido el 2026-08-06 sobre la-taba-staging: 9 pedidos tenían payment_method
-- NULL. `get_rider_queue` calcula el monto a cobrar con
-- `case when payment_method = 'cash' then total end`, así que un pedido sin
-- modalidad llega a la moto sin decir si hay que cobrar o no. En un piloto eso
-- es cobrar dos veces o no cobrar nunca.
--
-- Además, "Mercado Pago" tiene que significar algo comprobable: que existe un
-- payment_intent verificado contra el proveedor y ligado a ese pedido. Sin esa
-- atadura, `payment_method = 'mercadopago'` es sólo un texto que alguien pudo
-- escribir.

update public.orders
   set payment_method = 'qa_no_charge'
 where payment_method is null
   and origin = 'qa';

update public.orders
   set payment_method = 'coordinate'
 where payment_method is null;

alter table public.orders alter column payment_method set not null;

alter table public.orders drop constraint if exists orders_payment_method_valid;
alter table public.orders add constraint orders_payment_method_valid check (
  payment_method in ('mercadopago', 'cash', 'coordinate', 'qa_no_charge')
);

-- Un pedido de operación real nunca puede declararse "sin cargo por QA".
alter table public.orders drop constraint if exists orders_qa_payment_method_requires_qa_origin;
alter table public.orders add constraint orders_qa_payment_method_requires_qa_origin check (
  payment_method <> 'qa_no_charge' or origin = 'qa'
);

-- ===== "mercadopago" exige pago verificado contra el proveedor =====
-- Se valida como constraint trigger diferido porque
-- `finalize_paid_checkout_session` inserta el pedido y recién después liga el
-- intent; al COMMIT la atadura ya tiene que existir.
create or replace function public.assert_order_payment_modality()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
begin
  if new.payment_method <> 'mercadopago' then
    return null;
  end if;
  if not exists (
    select 1
      from public.payment_intents pi
     where pi.order_id = new.id
       and pi.provider = 'mercadopago'
       and pi.internal_status = 'completed'
  ) then
    raise exception
      'pedido % declara pago Mercado Pago sin intent verificado y completado', new.public_code
      using errcode = '23514';
  end if;
  return null;
end;
$$;

drop trigger if exists orders_assert_payment_modality on public.orders;
create constraint trigger orders_assert_payment_modality
after insert or update of payment_method, id on public.orders
deferrable initially deferred
for each row execute function public.assert_order_payment_modality();

comment on constraint orders_payment_method_valid on public.orders is
  'Modalidad de pago explícita: Mercado Pago, efectivo, coordinado o QA sin cargo.';
comment on function public.assert_order_payment_modality() is
  'Un pedido Mercado Pago debe tener un payment_intent verificado y completado ligado a él.';
