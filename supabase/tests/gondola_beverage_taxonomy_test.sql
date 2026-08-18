-- TABA2 · La goldola y la base hablan el mismo idioma de categorias.
--
-- Lo que la migracion 20260818040000 fija, en una linea:
--
--     LOS TRECE nombres de la gondola se aceptan, y cada uno slugifica a un id
--     que la vitrina conoce.
--     LOS DOCE anteriores siguen valiendo, para los datos ya guardados.
--     LA COHERENCIA de alcohol parte por la misma linea que usa el cliente.
--
-- Los casos negativos van por ALTA NUEVA, no por UPDATE. La razon la enseno el
-- ensayo de la 108: `products_fail_close_master_change` desverifica la fila en
-- cuanto cambian sus datos maestros, asi que un UPDATE nunca llega a chocar
-- contra la restriccion y mediria el trigger en vez del contrato.
--
-- Todo transaccional: termina en rollback y no deja una fila.

begin;
create extension if not exists pgtap with schema extensions;
select plan(20);

insert into auth.users(id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
values ('ea000000-0000-4000-8000-000000000001','authenticated','authenticated','gondola@example.invalid','',now(),'{}','{}',now(),now());

insert into public.businesses(id,name,status,slug,is_active)
values ('eb000000-0000-4000-8000-000000000001','TABA gondola','open','taba-gondola',true);

-- Un alta comercial completa y sin imagen —legitima desde la 108—. Cada caso
-- pisa solamente la categoria, la bandera de alcohol o la edad minima.
create function pg_temp.alta(
  p_sku text,
  p_categoria text,
  p_alcohol boolean,
  p_edad int default null
) returns void language sql as $$
  insert into public.products(
    business_id, name, description, category, subcategory, brand, presentation,
    capacity, capacity_value, capacity_unit, packaging_type, variant,
    external_id, sku, units_per_pack, price, stock, is_active, available,
    is_alcoholic, minimum_age, is_verified, verified_at, verified_by,
    sort_order, price_status, catalog_origin)
  values (
    'eb000000-0000-4000-8000-000000000001', 'Producto ' || p_sku,
    'Alta de ensayo de taxonomia.', p_categoria, 'ensayo', 'Marca Ensayo',
    'Original', '473 ml', 473, 'ml', 'lata', 'Original',
    'ext-' || p_sku, p_sku, 1, 2050, 12, true, true,
    p_alcohol, p_edad, true, now(), 'ea000000-0000-4000-8000-000000000001',
    0, 'confirmed', 'commercial');
$$;

-- ── 1..7 · las siete categorias SIN alcohol de la gondola ──────────────────
select lives_ok($$select pg_temp.alta('g-gaseosas','Gaseosas',false)$$, 'Gaseosas sin alcohol se publica');
select lives_ok($$select pg_temp.alta('g-mixers','Mixers',false)$$, 'Mixers sin alcohol se publica');
select lives_ok($$select pg_temp.alta('g-energizantes','Energizantes',false)$$, 'Energizantes sin alcohol se publica');
select lives_ok($$select pg_temp.alta('g-aguas','Aguas',false)$$, 'Aguas sin alcohol se publica');
select lives_ok($$select pg_temp.alta('g-saborizadas','Aguas saborizadas',false)$$, 'Aguas saborizadas sin alcohol se publica');
select lives_ok($$select pg_temp.alta('g-isotonicas','Isotónicas',false)$$, 'Isotónicas sin alcohol se publica');
select lives_ok($$select pg_temp.alta('g-hielo','Hielo',false)$$, 'Hielo sin alcohol se publica');

-- ── 8..13 · las seis categorias CON alcohol de la gondola ──────────────────
select lives_ok($$select pg_temp.alta('g-cervezas','Cervezas',true,18)$$, 'Cervezas con alcohol y +18 se publica');
select lives_ok($$select pg_temp.alta('g-fernet','Fernet',true,18)$$, 'Fernet con alcohol y +18 se publica');
select lives_ok($$select pg_temp.alta('g-aperitivos','Aperitivos',true,18)$$, 'Aperitivos con alcohol y +18 se publica');
select lives_ok($$select pg_temp.alta('g-vinos','Vinos',true,18)$$, 'Vinos con alcohol y +18 se publica');
select lives_ok($$select pg_temp.alta('g-espumantes','Espumantes',true,18)$$, 'Espumantes con alcohol y +18 se publica');
select lives_ok($$select pg_temp.alta('g-destilados','Destilados',true,18)$$, 'Destilados con alcohol y +18 se publica');

-- ── 14 · el vocabulario anterior no se rompio ──────────────────────────────
select lives_ok(
  $$select pg_temp.alta('g-legacy','Vinos y espumantes',true,18)$$,
  'un nombre del vocabulario anterior sigue siendo valido para los datos guardados'
);

-- ── 15..17 · lo que sigue afuera ───────────────────────────────────────────
select throws_ok(
  $$select pg_temp.alta('g-inventada','Bebidas',false)$$,
  null, null,
  'una categoria que nadie declaro no se puede publicar'
);
select throws_ok(
  $$select pg_temp.alta('g-fernet-sin-alcohol','Fernet',false)$$,
  null, null,
  'un fernet sin alcohol es incoherente y se rechaza'
);
select throws_ok(
  $$select pg_temp.alta('g-gaseosa-con-alcohol','Gaseosas',true,18)$$,
  null, null,
  'una gaseosa con alcohol es incoherente y se rechaza'
);

-- ── 18..19 · la edad minima viaja con el alcohol, y solo con el ────────────
select throws_ok(
  $$select pg_temp.alta('g-vino-sin-edad','Vinos',true)$$,
  null, null,
  'alcohol sin edad minima no se publica'
);
select throws_ok(
  $$select pg_temp.alta('g-agua-con-edad','Aguas',false,18)$$,
  null, null,
  'una edad minima sobre un producto sin alcohol no se acepta'
);

-- ── 20 · las trece entraron de verdad ──────────────────────────────────────
select is(
  (select count(distinct category)::int from public.products
    where business_id = 'eb000000-0000-4000-8000-000000000001'
      and is_verified
      and category in ('Gaseosas','Mixers','Energizantes','Aguas','Aguas saborizadas',
                       'Isotónicas','Hielo','Cervezas','Fernet','Aperitivos',
                       'Vinos','Espumantes','Destilados')),
  13,
  'las trece categorias de la gondola quedan publicables'
);

select * from finish();
rollback;
