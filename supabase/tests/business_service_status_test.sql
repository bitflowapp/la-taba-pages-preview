-- TABA · EL ESTADO DEL SERVICIO: UNA SOLA RESPUESTA, LA MISMA QUE COBRA EL PEDIDO
--
-- `get_business_service_status(negocio, instante)` contesta, por canal (delivery, pickup,
-- alcohol): OPEN o CLOSED, por qué está cerrado, cuándo abre y cuándo cierra. Acá se prueba:
--
--   · el contrato y los privilegios: la ejecuta anon, las internas no, y la respuesta no
--     lleva nada que anon no pueda saber ya;
--   · una tabla de instantes: bordes (apertura incluida, cierre excluido), franjas que se
--     tocan (el cierre es el final del tramo continuo), cruce de medianoche (el cierre cae
--     al día siguiente), día sin servicio, cierre por excepción, horario especial, 24/7;
--   · alcohol: la ventana de la política Y la grilla del canal, las dos;
--   · los cambios de hora en dos husos que los tienen (America/Santiago, Europe/Madrid),
--     incluida la hora que se repite y la que no existe;
--   · el interruptor manual y la habilitación mandan sobre el horario;
--   · falla cerrada: exigido sin franjas, sin huso o con un huso inválido;
--   · sin exigir horario: abierto y sin cierre;
--   · PROPIEDAD: en dos semanas de instantes, OPEN equivale a `business_is_open`, y
--     `opens_at` / `closes_at` son el primer instante en que `business_is_open` cambia;
--   · ACUERDO CON EL ALTA: por la RPC pública del pedido, OPEN crea el pedido y CLOSED
--     recibe BUSINESS_CLOSED (o el rechazo de alcohol), sin tocar el stock.
--
-- Ningún caso depende de la hora de la máquina: los instantes son explícitos y, donde el
-- alta usa su propio reloj, el comercio está abierto las 24 horas o cerrado tres días.
--
-- Todo transaccional: termina en rollback.

begin;
create extension if not exists pgtap with schema extensions;
select plan(131);

-- ── Fixture ────────────────────────────────────────────────────────────────
insert into auth.users(id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,is_anonymous,created_at,updated_at)
values
  ('d6400000-0000-4000-8000-0000000000a1','authenticated','authenticated','estado-owner@example.invalid','',now(),'{}','{}',false,now(),now()),
  ('d6400000-0000-4000-8000-0000000000a9','authenticated','authenticated',null,'',null,'{}','{}',true,now(),now());

create temporary table estado_ids (clave text primary key, id uuid not null) on commit drop;
insert into estado_ids values
  ('H',   'd6400000-0000-4000-8000-0000000000b1'),   -- Buenos Aires, horario exigido, con excepciones y alcohol
  ('247', 'd6400000-0000-4000-8000-0000000000b2'),   -- Buenos Aires, 00:00-24:00 los siete dias
  ('N',   'd6400000-0000-4000-8000-0000000000b3'),   -- sin exigir horario
  ('Z',   'd6400000-0000-4000-8000-0000000000b4'),   -- exigido y sin una franja
  ('I',   'd6400000-0000-4000-8000-0000000000b5'),   -- inactivo
  ('SCL', 'd6400000-0000-4000-8000-0000000000b6'),   -- America/Santiago
  ('MAD', 'd6400000-0000-4000-8000-0000000000b7'),   -- Europe/Madrid
  ('O',   'd6400000-0000-4000-8000-0000000000b8'),   -- el que recibe pedidos de verdad
  ('X',   'd6400000-0000-4000-8000-0000000000ff');   -- no existe

insert into public.businesses(id,name,slug,status,is_active,currency_code,address,pickup_enabled,delivery_enabled,delivery_fee,minimum_delivery_subtotal,
  operating_timezone,hours_enforced,ordering_verified,ordering_verified_at,ordering_verified_by,ordering_enabled,order_intake_guard_mode)
select i.id, 'Estado ' || i.clave, 'estado-' || lower(i.clave), 'open', i.clave <> 'I', 'ARS', 'Mendoza 827, Neuquen', true, true, 0, 0,
       case i.clave when 'SCL' then 'America/Santiago' when 'MAD' then 'Europe/Madrid' else 'America/Argentina/Buenos_Aires' end,
       i.clave not in ('N'), true, now(), 'd6400000-0000-4000-8000-0000000000a1', i.clave <> 'I', 'off'
  from estado_ids i where i.clave <> 'X';

create function pg_temp.id(p_clave text) returns uuid language sql stable as $$
  select id from estado_ids where clave = p_clave
$$;
create function pg_temp.franja(p_clave text, p_canal text, p_dias integer[], p_abre text, p_cierra text) returns void language sql as $$
  insert into public.business_service_hours(business_id,channel,weekday,opens_at,closes_at)
  select pg_temp.id(p_clave), p_canal, d, p_abre::time, p_cierra::time from unnest(p_dias) d
$$;

-- H · 2026-10-05 es lunes.
select pg_temp.franja('H', 'delivery', array[1,2,3,4], '09:00', '13:00');
select pg_temp.franja('H', 'delivery', array[1,2,3,4], '13:00', '18:00');
select pg_temp.franja('H', 'delivery', array[2,4], '21:00', '23:30');
select pg_temp.franja('H', 'delivery', array[5,6], '20:00', '02:00');
select pg_temp.franja('H', 'pickup', array[1,2,3,4,5,6], '10:00', '20:00');
select pg_temp.franja('H', 'alcohol', array[0,1,2,3,4,5,6], '12:00', '23:30');
update public.businesses
   set alcohol_sales_enabled = true, alcohol_minimum_age = 18, alcohol_sales_start = '10:00', alcohol_sales_end = '22:00',
       alcohol_timezone = 'America/Argentina/Buenos_Aires', alcohol_hours_enforced = true
 where id = pg_temp.id('H');
insert into public.business_service_exceptions(business_id,channel,on_date,is_closed,opens_at,closes_at,note) values
  (pg_temp.id('H'),'all','2026-10-07',true,null,null,'feriado secreto'),
  (pg_temp.id('H'),'delivery','2026-10-08',false,'10:00','15:00',null),
  (pg_temp.id('H'),'delivery','2026-10-10',true,null,null,null),
  (pg_temp.id('H'),'all','2026-10-13',false,'22:00','03:00',null),
  (pg_temp.id('H'),'all','2026-10-17',true,null,null,null),
  (pg_temp.id('H'),'delivery','2026-10-17',false,'22:00','02:00',null);

-- 247 y O · los siete dias, las 24 horas, los dos canales.
select pg_temp.franja(c, canal, array[0,1,2,3,4,5,6], '00:00', '24:00')
  from unnest(array['247','O']) c, unnest(array['delivery','pickup']) canal;

-- SCL · delivery 09:00-21:00, retiro 20:00-02:00. MAD · delivery 09:00-21:00, retiro con
-- bordes dentro de la hora que cambia (01:00-02:30 y 02:45-05:00).
select pg_temp.franja('SCL', 'delivery', array[0,1,2,3,4,5,6], '09:00', '21:00');
select pg_temp.franja('SCL', 'pickup', array[0,1,2,3,4,5,6], '20:00', '02:00');
select pg_temp.franja('MAD', 'delivery', array[0,1,2,3,4,5,6], '09:00', '21:00');
select pg_temp.franja('MAD', 'pickup', array[0,1,2,3,4,5,6], '01:00', '02:30');
select pg_temp.franja('MAD', 'pickup', array[0,1,2,3,4,5,6], '02:45', '05:00');

-- Productos de O: una gaseosa y una cerveza.
insert into public.products(id,business_id,name,category,subcategory,price,price_status,is_active,brand,
    variant,presentation,capacity_value,capacity_unit,capacity,packaging_type,
    stock,available,merchant_available,is_alcoholic,minimum_age,tags,is_verified,verified_at,verified_by,
    external_id,sku,catalog_origin,units_per_pack)
values
  ('d6400000-0000-4000-8000-0000000000c1',pg_temp.id('O'),'Lata Estado','Gaseosas','Cola',1000,'confirmed',true,'Marca',
    'Lata','Lata',473,'ml','473 ml','lata',50,true,true,false,null,'{}',true,now(),'d6400000-0000-4000-8000-0000000000a1',
    'estado-lata','estado-lata','commercial',1),
  ('d6400000-0000-4000-8000-0000000000c2',pg_temp.id('O'),'Cerveza Estado','Cervezas','Rubia',2000,'confirmed',true,'Marca',
    'Botella','Botella',1,'l','1 l','botella',50,true,true,true,18,'{}',true,now(),'d6400000-0000-4000-8000-0000000000a1',
    'estado-cerveza','estado-cerveza','commercial',1);

-- El estado de un canal en una linea: estado | motivo | abre | cierra (hora del huso pedido).
create function pg_temp.hora(p_instante timestamptz, p_huso text) returns text language sql stable as $$
  select to_char(p_instante at time zone p_huso,
    case when date_part('second', p_instante) = 0 then 'YYYY-MM-DD HH24:MI' else 'YYYY-MM-DD HH24:MI:SS.US' end)
$$;
-- plpgsql y no sql: una funcion sql se expande en la consulta y repetiria la llamada por
-- cada campo que se lee de la respuesta.
create function pg_temp.estado(p_clave text, p_canal text, p_cuando timestamptz, p_huso text default 'America/Argentina/Buenos_Aires')
returns text language plpgsql stable as $$
declare
  c jsonb := public.get_business_service_status(pg_temp.id(p_clave), p_cuando) -> 'channels' -> p_canal;
begin
  return concat_ws(' | ', c ->> 'state', coalesce(c ->> 'reason', '-'),
           coalesce(pg_temp.hora((c ->> 'opens_at')::timestamptz, p_huso), '-'),
           coalesce(pg_temp.hora((c ->> 'closes_at')::timestamptz, p_huso), '-'));
end $$;
create function pg_temp.ba(p_local text) returns timestamptz language sql immutable as $$
  select (p_local || ' America/Argentina/Buenos_Aires')::timestamptz
$$;

-- ══ 1 · CONTRATO Y PRIVILEGIOS ═══════════════════════════════════════════════
select ok(
  has_function_privilege('anon', 'public.get_business_service_status(uuid,timestamptz)', 'EXECUTE')
  and has_function_privilege('authenticated', 'public.get_business_service_status(uuid,timestamptz)', 'EXECUTE'),
  'el estado del servicio lo consulta anon y cualquier cliente');

select is(
  (select count(*)::integer from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in ('business_schedule_runs', 'business_windows_between', 'business_alcohol_policy_runs',
                        'timezone_offset_segments', 'business_day_windows', 'business_is_open', 'business_next_open_at')
      and (has_function_privilege('anon', p.oid, 'EXECUTE') or has_function_privilege('authenticated', p.oid, 'EXECUTE'))),
  0, 'ninguna de las internas del horario es ejecutable por un rol de cliente');

select ok(
  (select p.prosecdef and p.provolatile = 's'
          and exists (select 1 from unnest(p.proconfig) cfg where cfg like 'search_path=pg_catalog, public, pg_temp')
     from pg_proc p where p.oid = 'public.get_business_service_status(uuid,timestamptz)'::regprocedure),
  'corre como su dueño, con search_path fijado, y es STABLE');

select is(
  (select array_agg(k order by k) from jsonb_object_keys(public.get_business_service_status(pg_temp.id('H'), pg_temp.ba('2026-10-05 12:00'))) k),
  array['business_id', 'channels', 'evaluated_at', 'hours_enforced', 'timezone'],
  'la respuesta trae exactamente negocio, canales, instante evaluado, si se exige el horario y el huso');

select is(
  (select array_agg(canal || ':' || claves order by canal)
     from (select c.key as canal, (select string_agg(k, ',' order by k) from jsonb_object_keys(c.value) k) as claves
             from jsonb_each(public.get_business_service_status(pg_temp.id('H'), pg_temp.ba('2026-10-05 12:00')) -> 'channels') c) s),
  array['alcohol:closes_at,opens_at,reason,state', 'delivery:closes_at,opens_at,reason,state', 'pickup:closes_at,opens_at,reason,state'],
  'cada canal trae exactamente estado, motivo, apertura y cierre');

select ok(
  public.get_business_service_status(pg_temp.id('H'), pg_temp.ba('2026-10-07 12:00'))::text !~ '(feriado|d6400000-0000-4000-8000-0000000000a1|@)',
  'no expone la nota de la excepcion, ni quien verifico, ni un correo');

select is(
  (public.get_business_service_status(pg_temp.id('H'), pg_temp.ba('2026-10-05 12:00')) ->> 'evaluated_at')::timestamptz,
  pg_temp.ba('2026-10-05 12:00'), 'evaluated_at es el instante que se pregunto');

select is(
  (public.get_business_service_status(pg_temp.id('H')) ->> 'evaluated_at')::timestamptz, now(),
  'sin instante, evalua ahora');

select is(
  (public.get_business_service_status(pg_temp.id('H'), null) ->> 'evaluated_at')::timestamptz, now(),
  'un instante NULL tambien es ahora');

select is(
  public.get_business_service_status(pg_temp.id('H'), pg_temp.ba('2026-10-05 12:00')) ->> 'timezone',
  'America/Argentina/Buenos_Aires', 'informa el huso del comercio');

select is(
  (public.get_business_service_status(pg_temp.id('H'), pg_temp.ba('2026-10-05 12:00')) ->> 'hours_enforced')::boolean
    and not (public.get_business_service_status(pg_temp.id('N'), pg_temp.ba('2026-10-05 12:00')) ->> 'hours_enforced')::boolean,
  true, 'informa si el horario se exige');

set local role anon;
select set_config('request.jwt.claims', '{"role":"anon"}', true);
select is(
  public.get_business_service_status('d6400000-0000-4000-8000-0000000000b2', '2026-10-05 15:00+00') -> 'channels' -> 'delivery' ->> 'state',
  'OPEN', 'anon la llama de verdad y recibe una respuesta');
select throws_ok(
  $$select public.get_business_service_status('d6400000-0000-4000-8000-0000000000b2', 'infinity')$$,
  '22023', 'instante invalido', 'un instante infinito se rechaza como entrada invalida, no con un error interno');
select throws_ok(
  $$select public.get_business_service_status('d6400000-0000-4000-8000-0000000000b2', '-infinity')$$,
  '22023', 'instante invalido', 'tambien el infinito negativo');
select throws_ok(
  $$select public.get_business_service_status('d6400000-0000-4000-8000-0000000000b2', '294276-12-31 23:59:59+00')$$,
  '22023', 'instante invalido', 'y un instante al borde del calendario, que desbordaria al mirar dos semanas adelante');
select throws_ok(
  $$select public.business_is_open('d6400000-0000-4000-8000-0000000000b2', 'delivery', now())$$,
  '42501', null, 'y anon sigue sin poder llamar a la primitiva');
reset role;

-- ══ 2 · TABLA DE INSTANTES ═══════════════════════════════════════════════════
create temporary table estado_casos (n serial, clave text, canal text, cuando timestamptz, huso text, esperado text, que text) on commit drop;
insert into estado_casos (clave, canal, cuando, huso, esperado, que)
select v.clave, v.canal, pg_temp.ba(v.cuando), 'America/Argentina/Buenos_Aires', v.esperado, v.que
  from (values
  -- delivery · bordes y franjas que se tocan
  ('H','delivery','2026-10-05 08:59:59','CLOSED | outside_hours | 2026-10-05 09:00 | -', 'antes de abrir: dice a que hora abre'),
  ('H','delivery','2026-10-05 09:00:00','OPEN | - | - | 2026-10-05 18:00', 'en la apertura: abierto, y cierra al final del tramo continuo (no a las 13)'),
  ('H','delivery','2026-10-05 13:00:00','OPEN | - | - | 2026-10-05 18:00', 'en la union de dos franjas sigue abierto'),
  ('H','delivery','2026-10-05 17:59:59','OPEN | - | - | 2026-10-05 18:00', 'un segundo antes del cierre'),
  ('H','delivery','2026-10-05 18:00:00','CLOSED | outside_hours | 2026-10-06 09:00 | -', 'en el cierre: cerrado, abre mañana'),
  -- turno partido
  ('H','delivery','2026-10-06 19:30:00','CLOSED | outside_hours | 2026-10-06 21:00 | -', 'entre dos turnos: abre en el segundo'),
  ('H','delivery','2026-10-06 22:00:00','OPEN | - | - | 2026-10-06 23:30', 'segundo turno'),
  -- cierre por excepcion y horario especial
  ('H','delivery','2026-10-06 23:30:00','CLOSED | outside_hours | 2026-10-08 10:00 | -', 'saltea el dia cerrado y abre con el horario especial'),
  ('H','delivery','2026-10-07 12:00:00','CLOSED | exception_closed | 2026-10-08 10:00 | -', 'dia cerrado por excepcion'),
  ('H','delivery','2026-10-08 09:30:00','CLOSED | outside_hours | 2026-10-08 10:00 | -', 'el horario especial reemplaza a la grilla'),
  ('H','delivery','2026-10-08 10:00:00','OPEN | - | - | 2026-10-08 15:00', 'horario especial: abierto hasta su cierre'),
  ('H','delivery','2026-10-08 16:00:00','CLOSED | outside_hours | 2026-10-09 20:00 | -', 'horario especial: el turno de la noche de la grilla no vale'),
  -- cruce de medianoche contra un dia cerrado
  ('H','delivery','2026-10-09 23:00:00','OPEN | - | - | 2026-10-10 00:00', 'la franja cruza, pero mañana esta cerrado: cierra a la medianoche'),
  ('H','delivery','2026-10-10 01:00:00','CLOSED | exception_closed | 2026-10-12 09:00 | -', 'el dia cerrado no recibe arrastre'),
  ('H','delivery','2026-10-11 12:00:00','CLOSED | outside_hours | 2026-10-12 09:00 | -', 'dia sin servicio'),
  -- horario especial que cruza la medianoche
  ('H','delivery','2026-10-13 12:00:00','CLOSED | outside_hours | 2026-10-13 22:00 | -', 'especial `all`: abre a las 22'),
  ('H','delivery','2026-10-13 23:00:00','OPEN | - | - | 2026-10-14 03:00', 'especial que cruza: el cierre cae al dia siguiente'),
  ('H','delivery','2026-10-14 02:59:00','OPEN | - | - | 2026-10-14 03:00', 'arrastre del especial'),
  ('H','delivery','2026-10-14 03:00:00','CLOSED | outside_hours | 2026-10-14 09:00 | -', 'termino el arrastre'),
  -- cierre y especial la misma fecha
  ('H','delivery','2026-10-16 23:00:00','OPEN | - | - | 2026-10-17 00:00', 'viernes: cierra a la medianoche del sabado cerrado'),
  ('H','delivery','2026-10-17 23:00:00','CLOSED | exception_closed | 2026-10-19 09:00 | -', 'cierre y especial la misma fecha: cerrado'),
  ('H','delivery','2026-10-18 01:00:00','CLOSED | outside_hours | 2026-10-19 09:00 | -', 'y sin arrastre al dia siguiente'),
  -- cruce de medianoche semanal
  ('H','delivery','2026-10-23 21:00:00','OPEN | - | - | 2026-10-24 02:00', 'franja que cruza: el cierre es mañana a las 02'),
  ('H','delivery','2026-10-24 01:59:59','OPEN | - | - | 2026-10-24 02:00', 'arrastre: abierto hasta las 02'),
  ('H','delivery','2026-10-24 02:00:00','CLOSED | outside_hours | 2026-10-24 20:00 | -', 'fin del arrastre: abre a la noche'),
  ('H','delivery','2026-10-25 01:00:00','OPEN | - | - | 2026-10-25 02:00', 'domingo sin franjas propias: abierto por el arrastre del sabado'),
  -- retiro: otro horario, mismas reglas
  ('H','pickup','2026-10-05 12:00:00','OPEN | - | - | 2026-10-05 20:00', 'retiro tiene su propio horario'),
  ('H','pickup','2026-10-05 20:00:00','CLOSED | outside_hours | 2026-10-06 10:00 | -', 'retiro cerrado mientras delivery pudo seguir'),
  ('H','pickup','2026-10-07 12:00:00','CLOSED | exception_closed | 2026-10-08 10:00 | -', 'el cierre `all` cierra el retiro; el especial de delivery no lo toca'),
  ('H','pickup','2026-10-11 12:00:00','CLOSED | outside_hours | 2026-10-12 10:00 | -', 'retiro: domingo sin servicio'),
  ('H','pickup','2026-10-13 12:00:00','CLOSED | outside_hours | 2026-10-13 22:00 | -', 'el horario especial `all` rige tambien para el retiro'),
  -- alcohol: la ventana de la politica (10:00-22:00, extremos incluidos) Y la grilla (12:00-23:30)
  ('H','alcohol','2026-10-05 11:00:00','CLOSED | outside_hours | 2026-10-05 12:00 | -', 'alcohol: la politica ya abrio, la grilla todavia no'),
  ('H','alcohol','2026-10-05 12:00:00','OPEN | - | - | 2026-10-05 22:00:00.000001', 'alcohol: cierra con la politica, que incluye las 22:00:00 exactas'),
  ('H','alcohol','2026-10-05 22:00:00','OPEN | - | - | 2026-10-05 22:00:00.000001', 'alcohol: las 22:00:00 exactas todavia venden, como en el alta'),
  ('H','alcohol','2026-10-05 22:00:00.000001','CLOSED | outside_hours | 2026-10-06 12:00 | -', 'alcohol: un microsegundo despues, no'),
  ('H','alcohol','2026-10-05 22:30:00','CLOSED | outside_hours | 2026-10-06 12:00 | -', 'alcohol: la grilla sigue abierta pero la politica cerro'),
  ('H','alcohol','2026-10-07 13:00:00','CLOSED | exception_closed | 2026-10-08 12:00 | -', 'alcohol: el cierre `all` lo cierra'),
  ('H','alcohol','2026-10-13 13:00:00','OPEN | - | - | 2026-10-13 22:00:00.000001', 'alcohol: el horario especial `all` no le cambia la ventana'),
  ('H','alcohol','2026-10-13 23:00:00','CLOSED | outside_hours | 2026-10-14 12:00 | -', 'alcohol: ni lo extiende a la noche'),
  -- 24/7
  ('247','delivery','2026-10-05 03:00:00','OPEN | - | - | -', '24/7: abierto de madrugada y sin cierre'),
  ('247','delivery','2026-10-11 23:59:59','OPEN | - | - | -', '24/7: la medianoche no es un cierre'),
  ('247','pickup','2026-10-12 00:00:00','OPEN | - | - | -', '24/7: tampoco el primer instante del dia'),
  ('247','alcohol','2026-10-05 12:00:00','CLOSED | alcohol_disabled | - | -', 'sin politica de alcohol: no se vende'),
  -- sin exigencia y sin franjas
  ('N','delivery','2026-10-05 04:00:00','OPEN | - | - | -', 'sin exigir horario: abierto a cualquier hora, sin cierre'),
  ('N','pickup','2026-10-11 23:30:00','OPEN | - | - | -', 'sin exigir horario: tambien el retiro'),
  ('Z','delivery','2026-10-05 12:00:00','CLOSED | hours_not_configured | - | -', 'exigido y sin franjas: cerrado, sin apertura que prometer'),
  ('Z','pickup','2026-10-05 12:00:00','CLOSED | hours_not_configured | - | -', 'y lo mismo el retiro'),
  -- inactivo e inexistente
  ('I','delivery','2026-10-05 12:00:00','CLOSED | business_inactive | - | -', 'comercio inactivo'),
  ('X','delivery','2026-10-05 12:00:00','CLOSED | business_inactive | - | -', 'comercio inexistente: la misma respuesta')
  ) v(clave, canal, cuando, esperado, que);

-- Cambios de hora. La columna esperada va en UTC: la hora local se repite o no existe.
-- Los instantes de abajo salen de la base de husos del servidor. Si este control falla, la
-- base trae otras reglas para 2026 y los casos que siguen fallan por eso, no por el motor.
select is(
  array[
    (timestamptz '2026-04-05 02:59:59+00' at time zone 'America/Santiago')::text, (timestamptz '2026-04-05 03:00:00+00' at time zone 'America/Santiago')::text,
    (timestamptz '2026-09-06 03:59:59+00' at time zone 'America/Santiago')::text, (timestamptz '2026-09-06 04:00:00+00' at time zone 'America/Santiago')::text,
    (timestamptz '2026-03-29 00:59:59+00' at time zone 'Europe/Madrid')::text, (timestamptz '2026-03-29 01:00:00+00' at time zone 'Europe/Madrid')::text,
    (timestamptz '2026-10-25 00:59:59+00' at time zone 'Europe/Madrid')::text, (timestamptz '2026-10-25 01:00:00+00' at time zone 'Europe/Madrid')::text],
  array[
    '2026-04-04 23:59:59', '2026-04-04 23:00:00',
    '2026-09-05 23:59:59', '2026-09-06 01:00:00',
    '2026-03-29 01:59:59', '2026-03-29 03:00:00',
    '2026-10-25 02:59:59', '2026-10-25 02:00:00'],
  'precondicion: la base de husos trae los cuatro cambios de hora de 2026 que usa este ensayo (Santiago y Madrid)');
insert into estado_casos (clave, canal, cuando, huso, esperado, que) values
  -- Santiago 2026: el sabado 4 de abril a las 24:00 el reloj vuelve a las 23:00 (03:00 UTC del domingo).
  ('SCL','delivery','2026-04-04 15:00+00','UTC','OPEN | - | - | 2026-04-05 00:00', 'Santiago: cierra a las 21:00 de verano'),
  ('SCL','delivery','2026-04-05 01:00+00','UTC','CLOSED | outside_hours | 2026-04-05 13:00 | -', 'Santiago: la apertura de mañana ya es con la hora de invierno (13:00 UTC, no 12:00)'),
  ('SCL','pickup','2026-04-05 00:00+00','UTC','OPEN | - | - | 2026-04-05 06:00', 'Santiago: la franja 20:00-02:00 dura siete horas reales esa noche'),
  ('SCL','pickup','2026-04-05 03:30+00','UTC','OPEN | - | - | 2026-04-05 06:00', 'Santiago: segunda pasada de las 23:30, sigue abierto'),
  -- Santiago 2026: el sabado 5 de septiembre a las 24:00 el reloj salta a la 01:00 (04:00 UTC del domingo).
  ('SCL','pickup','2026-09-06 01:00+00','UTC','OPEN | - | - | 2026-09-06 05:00', 'Santiago: la misma franja dura cinco horas reales cuando el reloj salta'),
  ('SCL','delivery','2026-09-06 02:00+00','UTC','CLOSED | outside_hours | 2026-09-06 12:00 | -', 'Santiago: la apertura de mañana ya es con la hora de verano'),
  -- Madrid 2026: el domingo 29 de marzo a las 02:00 el reloj salta a las 03:00 (01:00 UTC).
  ('MAD','delivery','2026-03-28 21:00+00','UTC','CLOSED | outside_hours | 2026-03-29 07:00 | -', 'Madrid: abre a las 09:00 de verano'),
  ('MAD','pickup','2026-03-29 00:30+00','UTC','OPEN | - | - | 2026-03-29 03:00', 'Madrid: el cierre de las 02:30 y la apertura de las 02:45 no existen esa noche; el tramo sigue hasta las 05:00'),
  -- Madrid 2026: el domingo 25 de octubre a las 03:00 el reloj vuelve a las 02:00 (01:00 UTC).
  ('MAD','pickup','2026-10-25 00:15+00','UTC','OPEN | - | - | 2026-10-25 00:30', 'Madrid: primera pasada de las 02:15, cierra en la primera pasada de las 02:30'),
  ('MAD','pickup','2026-10-25 00:30+00','UTC','CLOSED | outside_hours | 2026-10-25 00:45 | -', 'Madrid: primera pasada de las 02:30, abre en la primera pasada de las 02:45'),
  ('MAD','pickup','2026-10-25 00:50+00','UTC','OPEN | - | - | 2026-10-25 01:30', 'Madrid: al repetirse la hora vuelve a regir la franja de la 01:00; cierra en la segunda pasada de las 02:30'),
  ('MAD','pickup','2026-10-25 01:30+00','UTC','CLOSED | outside_hours | 2026-10-25 01:45 | -', 'Madrid: segunda pasada de las 02:30');

select is(pg_temp.estado(c.clave, c.canal, c.cuando, c.huso), c.esperado,
          c.clave || ' ' || c.canal || ' ' || pg_temp.hora(c.cuando, c.huso) || ': ' || c.que)
  from estado_casos c order by c.n;

-- ══ 3 · EL INTERRUPTOR MANUAL Y LA HABILITACIÓN MANDAN SOBRE EL HORARIO ══════
-- Lunes al mediodia: por horario, los tres canales de H estan abiertos.
select is(
  (select array_agg(canal || '=' || pg_temp.estado('H', canal, pg_temp.ba('2026-10-05 12:30')) order by canal)
     from unnest(array['delivery','pickup','alcohol']) canal),
  array['alcohol=OPEN | - | - | 2026-10-05 22:00:00.000001', 'delivery=OPEN | - | - | 2026-10-05 18:00', 'pickup=OPEN | - | - | 2026-10-05 20:00'],
  'punto de partida: los tres canales abiertos por horario');

update public.businesses set status = 'paused' where id = pg_temp.id('H');
select is(
  (select array_agg(distinct pg_temp.estado('H', canal, pg_temp.ba('2026-10-05 12:30'))) from unnest(array['delivery','pickup','alcohol']) canal),
  array['CLOSED | business_paused | - | -'], 'pausado a mano: los tres canales cerrados, sin apertura ni cierre que prometer');

update public.businesses set status = 'closed' where id = pg_temp.id('H');
select is(
  (select array_agg(distinct pg_temp.estado('H', canal, pg_temp.ba('2026-10-05 12:30'))) from unnest(array['delivery','pickup','alcohol']) canal),
  array['CLOSED | business_closed | - | -'], 'cerrado a mano: los tres canales cerrados');

update public.businesses set status = 'open', ordering_enabled = false where id = pg_temp.id('H');
select is(
  (select array_agg(distinct pg_temp.estado('H', canal, pg_temp.ba('2026-10-05 12:30'))) from unnest(array['delivery','pickup','alcohol']) canal),
  array['CLOSED | ordering_disabled | - | -'], 'pedidos online apagados: cerrado aunque el local este abierto');

update public.businesses set ordering_enabled = true, pickup_enabled = false where id = pg_temp.id('H');
select is(pg_temp.estado('H', 'pickup', pg_temp.ba('2026-10-05 12:30')), 'CLOSED | channel_disabled | - | -', 'retiro apagado: ese canal cerrado');
select is(pg_temp.estado('H', 'delivery', pg_temp.ba('2026-10-05 12:30')), 'OPEN | - | - | 2026-10-05 18:00', 'y el otro canal sigue abierto');

update public.businesses set pickup_enabled = true, delivery_enabled = false where id = pg_temp.id('H');
select is(pg_temp.estado('H', 'delivery', pg_temp.ba('2026-10-05 12:30')), 'CLOSED | channel_disabled | - | -', 'delivery apagado: ese canal cerrado');

-- Un comercio verificado no vuelve a encender el delivery sin cobertura (20261001216000):
-- se le carga una zona y se exige la cobertura. El estado de servicio no la mira.
insert into public.delivery_zones(business_id,name,is_active,match_kind,area_normalized,boundary,delivery_fee,minimum_subtotal,priority)
values (pg_temp.id('H'),'Centro',true,'declared_area','centro',null,800,0,10);
update public.businesses set delivery_enabled = true, alcohol_sales_enabled = false, delivery_zone_enforced = true where id = pg_temp.id('H');
select is(pg_temp.estado('H', 'alcohol', pg_temp.ba('2026-10-05 12:30')), 'CLOSED | alcohol_disabled | - | -', 'venta de alcohol apagada');
update public.businesses set alcohol_sales_enabled = true where id = pg_temp.id('H');

select is(
  public.get_business_service_status(pg_temp.id('I'), pg_temp.ba('2026-10-05 12:00')) - 'business_id',
  public.get_business_service_status(pg_temp.id('X'), pg_temp.ba('2026-10-05 12:00')) - 'business_id',
  'un comercio inactivo y uno inexistente contestan exactamente lo mismo');
select is(
  public.get_business_service_status(pg_temp.id('I'), pg_temp.ba('2026-10-05 12:00')) -> 'timezone', 'null'::jsonb,
  'y no revelan huso ni configuracion');

-- ══ 4 · FALLA CERRADA SIN HUSO ═══════════════════════════════════════════════
-- La tabla prohibe exigir horario sin huso y un trigger prohibe un huso desconocido. Se
-- retiran SOLO dentro de esta transaccion para comprobar que, si el dato llegara mal por
-- otra via, la respuesta es cerrado y no un error ni un abierto.
alter table public.businesses drop constraint businesses_hours_need_timezone;
alter table public.businesses disable trigger businesses_validate_timezones_trigger;
update public.businesses set operating_timezone = null where id = pg_temp.id('247');
select is(pg_temp.estado('247', 'delivery', pg_temp.ba('2026-10-05 12:00')), 'CLOSED | timezone_missing | - | -',
  'horario exigido sin huso: cerrado');
select is(public.business_is_open(pg_temp.id('247'), 'delivery', pg_temp.ba('2026-10-05 12:00')), false,
  'igual que la primitiva del alta');
update public.businesses set operating_timezone = 'Marte/Fobos' where id = pg_temp.id('247');
select is(pg_temp.estado('247', 'pickup', pg_temp.ba('2026-10-05 12:00')), 'CLOSED | timezone_missing | - | -',
  'horario exigido con un huso que no existe: cerrado');
update public.businesses set operating_timezone = 'America/Argentina/Buenos_Aires' where id = pg_temp.id('247');
alter table public.businesses enable trigger businesses_validate_timezones_trigger;
alter table public.businesses add constraint businesses_hours_need_timezone check (
  (not hours_enforced and not alcohol_hours_enforced)
  or (operating_timezone is not null and btrim(operating_timezone) <> ''));
select is(pg_temp.estado('247', 'delivery', pg_temp.ba('2026-10-05 12:00')), 'OPEN | - | - | -', 'con el huso de vuelta, abierto');

-- ══ 5 · LA LECTURA POR RANGO ES LA PRIMITIVA, FECHA POR FECHA ════════════════
select is(
  (select count(*)::integer
     from estado_ids i
     cross join unnest(array['delivery','pickup','alcohol']) canal
     cross join generate_series(timestamp '2026-10-01', '2026-10-31', interval '1 day') d
    where i.clave in ('H', '247', 'Z', 'MAD')
      and (select coalesce(string_agg(w.opens_at || '-' || w.closes_at, ' ' order by w.opens_at, w.closes_at), '')
             from public.business_day_windows(i.id, canal, d::date) w)
          is distinct from
          (select coalesce(string_agg(w.opens_at || '-' || w.closes_at, ' ' order by w.opens_at, w.closes_at), '')
             from public.business_windows_between(i.id, canal, date '2026-10-01', date '2026-10-31') w
            where w.local_date = d::date)),
  0, 'business_windows_between contesta lo mismo que business_day_windows en cada fecha de octubre, canal y comercio');

-- ══ 6 · PROPIEDAD: EL ESTADO ES `business_is_open`, Y LOS INSTANTES SON SUS CAMBIOS ═══
-- El oraculo se arma SOLO con `business_is_open`, con un paso que divide a todos los bordes
-- del fixture (30 minutos en H, 15 en los husos con cambio de hora): entre dos puntos del
-- oraculo el estado no cambia. Para cada muestra: el estado tiene que coincidir, y
-- `closes_at` / `opens_at` tienen que ser el primer instante en que el oraculo cambia.
create temporary table estado_oraculo (canal text, t timestamptz, abierto boolean, primary key (canal, t)) on commit drop;
create temporary table estado_muestras (t timestamptz primary key, respuesta jsonb) on commit drop;

create function pg_temp.cargar(p_clave text, p_canales text[], p_desde timestamptz, p_hasta timestamptz, p_adelante interval,
  p_paso interval, p_cada integer)
returns integer language plpgsql as $$
begin
  delete from estado_oraculo;
  delete from estado_muestras;
  insert into estado_oraculo
    select c, g, public.business_is_open(pg_temp.id(p_clave), c, g)
      from unnest(p_canales) c, generate_series(p_desde, p_hasta + p_adelante, p_paso) g;
  insert into estado_muestras
    select s.g, public.get_business_service_status(pg_temp.id(p_clave), s.g)
      from generate_series(p_desde, p_hasta, p_paso) with ordinality as s(g, n)
     where (s.n - 1) % p_cada = 0;
  return (select count(*)::integer from estado_muestras);
end $$;

create function pg_temp.diferencias() returns text language sql stable as $$
  with vistas as (
    select o.canal, m.t, o.abierto, m.respuesta -> 'channels' -> o.canal as c,
           (select min(n.t) from estado_oraculo n where n.canal = o.canal and n.t > m.t and not n.abierto) as cierra,
           (select min(n.t) from estado_oraculo n where n.canal = o.canal and n.t > m.t and n.abierto) as abre
      from estado_muestras m
      join estado_oraculo o on o.t = m.t
  ),
  malas as (
    select v.canal, v.t,
           case
             when (v.c ->> 'state') is distinct from case when v.abierto then 'OPEN' else 'CLOSED' end then 'estado'
             when v.abierto and (v.c ->> 'closes_at')::timestamptz is distinct from v.cierra then 'cierre'
             when not v.abierto and (v.c ->> 'opens_at')::timestamptz is distinct from v.abre then 'apertura'
             when v.abierto and (v.c ->> 'opens_at' is not null or v.c ->> 'reason' is not null) then 'sobra apertura o motivo'
             when not v.abierto and (v.c ->> 'closes_at' is not null or v.c ->> 'reason' is null) then 'sobra cierre o falta motivo'
           end as problema,
           v.c, v.cierra, v.abre
      from vistas v
  )
  select coalesce(
    (select string_agg(format('%s %s %s: %s (oraculo cierra=%s abre=%s)', m.canal, m.t at time zone 'UTC', m.problema, m.c, m.cierra at time zone 'UTC', m.abre at time zone 'UTC'), E'\n')
       from (select * from malas where problema is not null order by t, canal limit 5) m),
    'sin diferencias')
$$;

-- H · dos semanas, delivery y retiro, una muestra cada dos horas.
select is(pg_temp.cargar('H', array['delivery','pickup'], pg_temp.ba('2026-10-04 00:00'), pg_temp.ba('2026-10-18 00:00'), interval '3 days',
  interval '30 minutes', 4), 169, 'H: dos semanas de instantes, una muestra cada dos horas');
select ok(
  (select count(*) filter (where abierto) > 100 and count(*) filter (where not abierto) > 100 from estado_oraculo where canal = 'delivery'),
  'H: el oraculo tiene abiertos y cerrados (la propiedad no es vacia)');
select is(pg_temp.diferencias(), 'sin diferencias',
  'PROPIEDAD H: en dos semanas, OPEN equivale a business_is_open y los instantes son sus cambios (delivery y retiro)');

-- H · alcohol: el estado es exactamente las dos compuertas que aplica el alta.
create function pg_temp.alcohol_segun_el_alta(p_id uuid, p_at timestamptz) returns boolean language sql stable as $$
  select (case when b.alcohol_sales_start <= b.alcohol_sales_end
               then (p_at at time zone b.alcohol_timezone)::time between b.alcohol_sales_start and b.alcohol_sales_end
               else not ((p_at at time zone b.alcohol_timezone)::time between b.alcohol_sales_end and b.alcohol_sales_start) end)
         and (not b.alcohol_hours_enforced or public.business_is_open(p_id, 'alcohol', p_at))
    from public.businesses b where b.id = p_id
$$;
select is(
  (select count(*)::integer from estado_muestras m
    where (m.respuesta -> 'channels' -> 'alcohol' ->> 'state' = 'OPEN') is distinct from pg_temp.alcohol_segun_el_alta(pg_temp.id('H'), m.t)),
  0, 'PROPIEDAD H: alcohol OPEN equivale a la ventana de la politica Y la grilla del canal, como en el alta');
select ok(
  (select count(*) filter (where m.respuesta -> 'channels' -> 'alcohol' ->> 'state' = 'OPEN') > 30
      and count(*) filter (where m.respuesta -> 'channels' -> 'alcohol' ->> 'state' = 'CLOSED') > 30 from estado_muestras m),
  'H: hay muestras con alcohol abierto y con alcohol cerrado');

-- Sin cambios de hora, `opens_at` es lo que contesta `business_next_open_at`.
select is(
  (select count(*)::integer from estado_muestras m
    where m.respuesta -> 'channels' -> 'delivery' ->> 'state' = 'CLOSED'
      and (m.respuesta -> 'channels' -> 'delivery' ->> 'opens_at')::timestamptz
          is distinct from public.business_next_open_at(pg_temp.id('H'), 'delivery', m.t)),
  0, 'H: opens_at coincide con business_next_open_at en todas las muestras cerradas');

-- Cambios de hora: cada 15 minutos, doce horas alrededor de cada cambio.
select is(pg_temp.cargar('SCL', array['delivery','pickup'], '2026-04-04 21:00+00', '2026-04-05 09:00+00', interval '36 hours',
  interval '15 minutes', 1), 49, 'Santiago, fin del horario de verano (03:00 UTC): doce horas cada 15 minutos');
select is(pg_temp.diferencias(), 'sin diferencias', 'PROPIEDAD Santiago, hora repetida: estado e instantes exactos');
select is(pg_temp.cargar('SCL', array['delivery','pickup'], '2026-09-05 22:00+00', '2026-09-06 10:00+00', interval '36 hours',
  interval '15 minutes', 1), 49, 'Santiago, comienzo del horario de verano (04:00 UTC)');
select is(pg_temp.diferencias(), 'sin diferencias', 'PROPIEDAD Santiago, hora inexistente: estado e instantes exactos');
select is(pg_temp.cargar('MAD', array['delivery','pickup'], '2026-03-28 19:00+00', '2026-03-29 07:00+00', interval '36 hours',
  interval '15 minutes', 1), 49, 'Madrid, comienzo del horario de verano (01:00 UTC)');
select is(pg_temp.diferencias(), 'sin diferencias', 'PROPIEDAD Madrid, hora inexistente con bordes adentro: estado e instantes exactos');
select is(pg_temp.cargar('MAD', array['delivery','pickup'], '2026-10-24 19:00+00', '2026-10-25 07:00+00', interval '36 hours',
  interval '15 minutes', 1), 49, 'Madrid, fin del horario de verano (01:00 UTC)');
select is(pg_temp.diferencias(), 'sin diferencias', 'PROPIEDAD Madrid, hora repetida con bordes adentro: estado e instantes exactos');

-- ══ 7 · ACUERDO CON EL ALTA DEL PEDIDO, POR LA RPC PÚBLICA ═══════════════════
-- El alta usa su propio reloj. Por eso O esta abierto las 24 horas, o cerrado por
-- excepcion ayer, hoy y mañana: el resultado no depende de la hora en que corra esto.
create function pg_temp.pedir(p_clave text, p_producto uuid, p_extra jsonb default '{}'::jsonb) returns jsonb
language plpgsql as $$
declare
  v_result jsonb;
  v_detail text;
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', 'd6400000-0000-4000-8000-0000000000a9', 'role', 'authenticated')::text, true);
  begin
    v_result := public.create_order_with_items(jsonb_build_object(
      'business_id', pg_temp.id('O'),
      'client_request_id', 'estado-' || p_clave,
      'tracking_token', md5(p_clave) || md5(p_clave || 'estado'),
      'items', jsonb_build_array(jsonb_build_object('product_id', p_producto, 'quantity', 1)),
      'customer_name', 'Cliente Estado',
      'customer_phone', '2996209137',
      'delivery_mode', 'pickup',
      'payment_method', 'cash') || p_extra);
    return jsonb_build_object('ok', v_result ? 'id');
  exception when others then
    get stacked diagnostics v_detail = pg_exception_detail;
    return jsonb_build_object('ok', false, 'sqlstate', sqlstate, 'message', sqlerrm, 'detail', v_detail);
  end;
end $$;
create function pg_temp.ahora(p_canal text) returns text language plpgsql stable as $$
declare
  c jsonb := public.get_business_service_status(pg_temp.id('O')) -> 'channels' -> p_canal;
begin
  return (c ->> 'state') || coalesce(' ' || (c ->> 'reason'), '');
end $$;

-- Abierto 24/7.
select is(pg_temp.ahora('pickup'), 'OPEN', 'O abierto las 24 horas: el estado dice OPEN');
select is(pg_temp.pedir('abierto-0001', 'd6400000-0000-4000-8000-0000000000c1'), '{"ok": true}'::jsonb,
  'y el alta crea el pedido');

-- Cerrado por excepcion ayer, hoy y mañana (fecha local del comercio).
insert into public.business_service_exceptions(business_id, channel, on_date, is_closed)
select pg_temp.id('O'), 'all', (now() at time zone 'America/Argentina/Buenos_Aires')::date + d, true from generate_series(-1, 1) d;
select is(pg_temp.ahora('pickup'), 'CLOSED exception_closed', 'O cerrado por excepcion: el estado dice CLOSED y por que');
select is(
  (public.get_business_service_status(pg_temp.id('O')) -> 'channels' -> 'pickup' ->> 'opens_at')::timestamptz,
  (((now() at time zone 'America/Argentina/Buenos_Aires')::date + 2)::timestamp at time zone 'America/Argentina/Buenos_Aires'),
  'y promete la apertura del primer dia sin excepcion, a las 00:00');
select is(pg_temp.pedir('cerrado-0001', 'd6400000-0000-4000-8000-0000000000c1') - 'detail',
  '{"ok": false, "sqlstate": "55000", "message": "BUSINESS_CLOSED"}'::jsonb,
  'y el alta responde BUSINESS_CLOSED');
select is((select stock from public.products where id = 'd6400000-0000-4000-8000-0000000000c1'), 49,
  'el pedido rechazado no toco el stock (49 = el unico pedido que entro)');
select is((select count(*)::integer from public.orders where business_id = pg_temp.id('O')), 1,
  'ni dejo un pedido');
select is(pg_temp.pedir('abierto-0001', 'd6400000-0000-4000-8000-0000000000c1'), '{"ok": true}'::jsonb,
  'el reintento del pedido que ya existia se responde aunque ahora este cerrado: no es un pedido nuevo');
delete from public.business_service_exceptions where business_id = pg_temp.id('O');

-- Exigido y sin franjas.
delete from public.business_service_hours where business_id = pg_temp.id('O') and channel = 'pickup';
select is(pg_temp.ahora('pickup'), 'CLOSED hours_not_configured', 'O sin franjas de retiro: CLOSED hours_not_configured');
select is(pg_temp.pedir('sin-franjas-0001', 'd6400000-0000-4000-8000-0000000000c1') ->> 'message', 'BUSINESS_CLOSED',
  'y el alta responde BUSINESS_CLOSED');
select pg_temp.franja('O', 'pickup', array[0,1,2,3,4,5,6], '00:00', '24:00');

-- Pausado a mano.
update public.businesses set status = 'paused' where id = pg_temp.id('O');
select is(pg_temp.ahora('pickup'), 'CLOSED business_paused', 'O pausado: CLOSED business_paused');
select is(pg_temp.pedir('pausado-0001', 'd6400000-0000-4000-8000-0000000000c1') - 'detail',
  '{"ok": false, "sqlstate": "55000", "message": "el negocio no esta habilitado para recibir pedidos"}'::jsonb,
  'y el alta rechaza el pedido');
update public.businesses set status = 'open' where id = pg_temp.id('O');

-- Alcohol sin politica.
select is(pg_temp.ahora('alcohol'), 'CLOSED alcohol_disabled', 'O sin politica de alcohol: CLOSED alcohol_disabled');
select is(pg_temp.pedir('cerveza-0001', 'd6400000-0000-4000-8000-0000000000c2', '{"age_confirmed": true}') ->> 'message',
  'politica de alcohol no configurada', 'y el alta rechaza la cerveza');

-- Alcohol con politica todo el dia y sin grilla exigida.
update public.businesses
   set alcohol_sales_enabled = true, alcohol_minimum_age = 18, alcohol_sales_start = '00:00', alcohol_sales_end = '24:00',
       alcohol_timezone = 'America/Argentina/Buenos_Aires'
 where id = pg_temp.id('O');
select is(pg_temp.ahora('alcohol'), 'OPEN', 'O con politica de alcohol todo el dia: OPEN');
select is(pg_temp.pedir('cerveza-0002', 'd6400000-0000-4000-8000-0000000000c2', '{"age_confirmed": true}'), '{"ok": true}'::jsonb,
  'y el alta vende la cerveza');

-- Grilla de alcohol exigida y sin franjas.
update public.businesses set alcohol_hours_enforced = true where id = pg_temp.id('O');
select is(pg_temp.ahora('alcohol'), 'CLOSED hours_not_configured', 'O con la grilla de alcohol exigida y vacia: CLOSED hours_not_configured');
select is(pg_temp.pedir('cerveza-0003', 'd6400000-0000-4000-8000-0000000000c2', '{"age_confirmed": true}') - 'detail',
  '{"ok": false, "sqlstate": "55000", "message": "ALCOHOL_WINDOW_CLOSED"}'::jsonb,
  'y el alta responde ALCOHOL_WINDOW_CLOSED');
select is(pg_temp.ahora('pickup'), 'OPEN', 'mientras tanto el retiro sigue abierto');
select is(pg_temp.pedir('gaseosa-0002', 'd6400000-0000-4000-8000-0000000000c1'), '{"ok": true}'::jsonb,
  'y la gaseosa se vende');

-- Grilla de alcohol las 24 horas.
select pg_temp.franja('O', 'alcohol', array[0,1,2,3,4,5,6], '00:00', '24:00');
select is(pg_temp.ahora('alcohol'), 'OPEN', 'O con la grilla de alcohol cargada: OPEN');
select is(pg_temp.pedir('cerveza-0004', 'd6400000-0000-4000-8000-0000000000c2', '{"age_confirmed": true}'), '{"ok": true}'::jsonb,
  'y el alta vende la cerveza');

-- La politica cerrada a toda hora (ventana que cruza la medianoche y no deja un instante).
update public.businesses set alcohol_sales_start = '23:59:59.999999', alcohol_sales_end = '00:00' where id = pg_temp.id('O');
select is(pg_temp.ahora('alcohol'), 'CLOSED outside_hours', 'O con la ventana de la politica cerrada: CLOSED outside_hours aunque la grilla este abierta');
select is(pg_temp.pedir('cerveza-0005', 'd6400000-0000-4000-8000-0000000000c2', '{"age_confirmed": true}') - 'detail',
  '{"ok": false, "sqlstate": "55000", "message": "venta de alcohol fuera de horario"}'::jsonb,
  'y el alta responde fuera de horario');

select * from finish();
rollback;
