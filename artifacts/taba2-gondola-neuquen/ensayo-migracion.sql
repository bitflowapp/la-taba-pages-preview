-- ENSAYO de la migración 20260818040000 contra el esquema REAL de producción.
--
-- No escribe nada. Aplica el DDL, prueba los casos, arma el informe y después
-- lo tira adentro de una excepción: la excepción aborta la transacción, y eso
-- GARANTIZA el rollback —no depende de que nadie se acuerde de escribirlo—. El
-- informe vuelve en el cuerpo del error.
--
-- Es la misma técnica con la que se ensayó la 108 antes de aplicarla.
--
-- Cómo se corre (Management API, el mismo canal de todo lo demás):
--
--   POST https://api.supabase.com/v1/projects/wwcpogltfgzgkrlilbcd/database/query
--   { "query": "<este archivo>" }
--
-- Lo que hay que leer en la respuesta: el error trae el informe. Si dice
-- 13/13 positivos y 5/5 negativos, la migración hace lo que dice.

do $ensayo$
declare
  v_negocio uuid;
  v_persona uuid;
  v_ok int := 0;
  v_esperados int := 0;
  v_rechazos int := 0;
  v_rechazos_esperados int := 0;
  v_informe text := '';
  v_categoria text;
  v_antes int;
  v_despues int;
begin
  select id into v_negocio from public.businesses order by created_at limit 1;
  select id into v_persona from auth.users order by created_at limit 1;
  if v_negocio is null or v_persona is null then
    raise exception 'ENSAYO IMPOSIBLE: falta el negocio o una identidad en auth.users.';
  end if;

  select count(*) into v_antes from public.products;

  -- ── 1 · el DDL de la migración, tal cual ─────────────────────────────────
  alter table public.products drop constraint if exists products_verified_canonical_beverage_category;
  alter table public.products add constraint products_verified_canonical_beverage_category check (
    not is_verified or category in (
      'Promos','Jugos','Energéticas','Vinos y espumantes','Gins y vodkas',
      'Whisky y destilados','Picadas y deli','Hielo y extras',
      'Gaseosas','Mixers','Energizantes','Aguas','Aguas saborizadas','Isotónicas','Hielo',
      'Cervezas','Fernet','Aperitivos','Vinos','Espumantes','Destilados'));

  alter table public.products drop constraint if exists products_verified_alcohol_coherence;
  alter table public.products add constraint products_verified_alcohol_coherence check (
    not is_verified or (
      ((category in ('Cervezas','Fernet','Aperitivos','Vinos','Espumantes','Destilados',
                     'Vinos y espumantes','Gins y vodkas','Whisky y destilados')
        and is_alcoholic is true)
       or (category in ('Gaseosas','Mixers','Energizantes','Aguas','Aguas saborizadas',
                        'Isotónicas','Hielo','Jugos','Energéticas','Picadas y deli','Hielo y extras')
        and is_alcoholic is false)
       or (category = 'Promos' and is_alcoholic is not null))
      and ((is_alcoholic is true and minimum_age is not null and minimum_age between 18 and 99)
        or (is_alcoholic is false and minimum_age is null))));

  v_informe := v_informe || E'DDL aplicado sin error sobre el esquema vigente.\n';

  -- ── 2 · las 13 categorías de la góndola tienen que ENTRAR ────────────────
  foreach v_categoria in array array['Gaseosas','Mixers','Energizantes','Aguas',
      'Aguas saborizadas','Isotónicas','Hielo','Cervezas','Fernet','Aperitivos',
      'Vinos','Espumantes','Destilados']
  loop
    v_esperados := v_esperados + 1;
    begin
      insert into public.products(
        business_id,name,description,category,subcategory,brand,presentation,capacity,
        capacity_value,capacity_unit,packaging_type,variant,external_id,sku,units_per_pack,
        price,stock,is_active,available,is_alcoholic,minimum_age,is_verified,verified_at,
        verified_by,sort_order,price_status,catalog_origin)
      values (v_negocio,'Ensayo '||v_categoria,'alta de ensayo',v_categoria,'ensayo','Ensayo',
        'Original','473 ml',473,'ml','lata','Original',
        'ensayo-'||lower(replace(v_categoria,' ','-')),'ensayo-'||lower(replace(v_categoria,' ','-')),
        1,2050,12,true,true,
        v_categoria in ('Cervezas','Fernet','Aperitivos','Vinos','Espumantes','Destilados'),
        case when v_categoria in ('Cervezas','Fernet','Aperitivos','Vinos','Espumantes','Destilados')
             then 18 else null end,
        true,now(),v_persona,0,'confirmed','commercial');
      v_ok := v_ok + 1;
    exception when others then
      v_informe := v_informe || format(E'  FALLA POSITIVA · %s: %s\n', v_categoria, sqlerrm);
    end;
  end loop;

  -- ── 3 · lo que tiene que seguir AFUERA ───────────────────────────────────
  foreach v_categoria in array array['Bebidas','Cervezas|sin-alcohol','Gaseosas|con-alcohol',
      'Vinos|sin-edad','Aguas|con-edad']
  loop
    v_rechazos_esperados := v_rechazos_esperados + 1;
    begin
      insert into public.products(
        business_id,name,description,category,subcategory,brand,presentation,capacity,
        capacity_value,capacity_unit,packaging_type,variant,external_id,sku,units_per_pack,
        price,stock,is_active,available,is_alcoholic,minimum_age,is_verified,verified_at,
        verified_by,sort_order,price_status,catalog_origin)
      values (v_negocio,'Ensayo negativo','alta de ensayo',
        split_part(v_categoria,'|',1),'ensayo','Ensayo','Original','473 ml',473,'ml','lata','Original',
        'ensayo-neg-'||md5(v_categoria),'ensayo-neg-'||md5(v_categoria),1,2050,12,true,true,
        case split_part(v_categoria,'|',2)
          when 'sin-alcohol' then false when 'con-alcohol' then true
          when 'sin-edad' then true else false end,
        case split_part(v_categoria,'|',2)
          when 'sin-alcohol' then null when 'con-alcohol' then 18
          when 'sin-edad' then null when 'con-edad' then 18 else null end,
        true,now(),v_persona,0,'confirmed','commercial');
      v_informe := v_informe || format(E'  FALLA NEGATIVA · %s ENTRÓ y no debía\n', v_categoria);
    exception when others then
      v_rechazos := v_rechazos + 1;
    end;
  end loop;

  select count(*) into v_despues from public.products;

  v_informe := format(
    E'\n===== ENSAYO 20260818040000 · góndola de Neuquén =====\n%s'
     'positivos  %s/%s categorías de la góndola aceptadas\n'
     'negativos  %s/%s altas incoherentes rechazadas\n'
     'filas      %s antes · %s durante el ensayo (todas se van con el rollback)\n'
     'veredicto  %s\n'
     '=====================================================',
    v_informe, v_ok, v_esperados, v_rechazos, v_rechazos_esperados, v_antes, v_despues,
    case when v_ok = v_esperados and v_rechazos = v_rechazos_esperados
         then 'LA MIGRACIÓN HACE LO QUE DICE' else 'REVISAR: hay casos que no dieron' end);

  -- La excepción es el mecanismo, no un accidente: aborta y garantiza que nada
  -- de esto quede escrito.
  raise exception '%', v_informe;
end
$ensayo$;
