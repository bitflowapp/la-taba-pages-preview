-- TABA · EL MOTOR DE HORARIOS, EN LA BASE
--
-- `business_is_open`, `business_day_windows` y `business_next_open_at` deciden si un
-- pedido nace. Hasta acá su única prueba en la base era el caso 24/7. Esto fija, con
-- instantes explícitos y sin mirar el reloj de la máquina:
--
--   · el borde de cada franja: la apertura incluida, el cierre excluido;
--   · el turno partido y dos franjas que se tocan;
--   · el cruce de medianoche: la COLA la aporta el día que abre y el ARRASTRE el día
--     siguiente, y un día sin franjas propias igual recibe el arrastre;
--   · el día sin servicio;
--   · la excepción de cierre, que apaga la fecha entera incluido el arrastre que le llegaba;
--   · la excepción de horario especial, que reemplaza a la grilla de esa fecha;
--   · el cierre que convive con un horario especial en la misma fecha: gana el cierre y
--     no deja franja que arrastrar (antes abría de 00:00 a 02:00 del día siguiente);
--   · un horario especial `all` no ensancha la ventana del canal `alcohol`;
--   · exigir horario sin una franja es estar cerrado; no exigirlo es estar abierto;
--   · la próxima apertura saltea los días cerrados.
--
-- Todo transaccional: termina en rollback.

begin;
create extension if not exists pgtap with schema extensions;
select plan(71);

-- ── Fixture ────────────────────────────────────────────────────────────────
insert into auth.users(id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
values ('d6300000-0000-4000-8000-0000000000a1','authenticated','authenticated','motor-owner@example.invalid','',now(),'{}','{}',now(),now());

-- H: Buenos Aires, horario exigido. 2026-10-05 es lunes.
--   delivery  lun-jue 09:00-13:00 y 13:00-18:00 (se tocan) · mar y jue 21:00-23:30 (turno partido)
--             vie y sab 20:00-02:00 (cruza) · domingo sin servicio
--   alcohol   todos los dias 10:00-22:00, exigido
-- N: sin exigencia. Z: exigencia encendida y ninguna franja.
insert into public.businesses(id,name,slug,status,is_active,currency_code,pickup_enabled,delivery_enabled,delivery_fee,minimum_delivery_subtotal,
  operating_timezone,hours_enforced,alcohol_hours_enforced)
values
  ('d6300000-0000-4000-8000-0000000000b1','Motor H','motor-h','open',true,'ARS',true,true,0,0,'America/Argentina/Buenos_Aires',true,true),
  ('d6300000-0000-4000-8000-0000000000b2','Motor N','motor-n','open',true,'ARS',true,true,0,0,'America/Argentina/Buenos_Aires',false,false),
  ('d6300000-0000-4000-8000-0000000000b3','Motor Z','motor-z','open',true,'ARS',true,true,0,0,'America/Argentina/Buenos_Aires',true,false);

insert into public.business_service_hours(business_id,channel,weekday,opens_at,closes_at)
select 'd6300000-0000-4000-8000-0000000000b1', 'delivery', d, o::time, c::time
  from (values (1,'09:00','13:00'),(2,'09:00','13:00'),(3,'09:00','13:00'),(4,'09:00','13:00'),
               (1,'13:00','18:00'),(2,'13:00','18:00'),(3,'13:00','18:00'),(4,'13:00','18:00'),
               (2,'21:00','23:30'),(4,'21:00','23:30'),
               (5,'20:00','02:00'),(6,'20:00','02:00')) v(d,o,c);
insert into public.business_service_hours(business_id,channel,weekday,opens_at,closes_at)
select 'd6300000-0000-4000-8000-0000000000b1', 'alcohol', d, '10:00', '22:00' from generate_series(0,6) d;

insert into public.business_service_exceptions(business_id,channel,on_date,is_closed,opens_at,closes_at,note) values
  ('d6300000-0000-4000-8000-0000000000b1','all','2026-10-07',true,null,null,'miercoles cerrado'),
  ('d6300000-0000-4000-8000-0000000000b1','delivery','2026-10-08',false,'10:00','15:00','jueves horario especial'),
  ('d6300000-0000-4000-8000-0000000000b1','delivery','2026-10-10',true,null,null,'sabado cerrado: sin arrastre del viernes'),
  ('d6300000-0000-4000-8000-0000000000b1','all','2026-10-13',false,'22:00','03:00','martes especial que cruza'),
  ('d6300000-0000-4000-8000-0000000000b1','all','2026-10-17',true,null,null,'sabado: cierre general'),
  ('d6300000-0000-4000-8000-0000000000b1','delivery','2026-10-17',false,'22:00','02:00','y un especial del canal la misma fecha');

create function pg_temp.abierto(p_channel text, p_local text) returns boolean language sql stable as $$
  select public.business_is_open('d6300000-0000-4000-8000-0000000000b1', p_channel, (p_local || ' America/Argentina/Buenos_Aires')::timestamptz)
$$;
create function pg_temp.franjas(p_channel text, p_date date) returns text language sql stable as $$
  select coalesce(string_agg(to_char(w.opens_at, 'HH24:MI') || '-' || to_char(w.closes_at, 'HH24:MI'), ' ' order by w.opens_at), '')
    from public.business_day_windows('d6300000-0000-4000-8000-0000000000b1', p_channel, p_date) w
$$;
create function pg_temp.proxima(p_local text) returns text language sql stable as $$
  select to_char(public.business_next_open_at('d6300000-0000-4000-8000-0000000000b1', 'delivery',
    (p_local || ' America/Argentina/Buenos_Aires')::timestamptz) at time zone 'America/Argentina/Buenos_Aires', 'YYYY-MM-DD HH24:MI')
$$;

-- ══ 1 · PRIVILEGIOS: las primitivas no son del navegador ═════════════════════
select ok(
  not has_function_privilege('anon', 'public.business_is_open(uuid,text,timestamptz)', 'EXECUTE')
  and not has_function_privilege('authenticated', 'public.business_is_open(uuid,text,timestamptz)', 'EXECUTE')
  and not has_function_privilege('anon', 'public.business_day_windows(uuid,text,date)', 'EXECUTE')
  and not has_function_privilege('authenticated', 'public.business_day_windows(uuid,text,date)', 'EXECUTE')
  and not has_function_privilege('anon', 'public.business_next_open_at(uuid,text,timestamptz)', 'EXECUTE')
  and not has_function_privilege('authenticated', 'public.business_next_open_at(uuid,text,timestamptz)', 'EXECUTE'),
  'las tres primitivas del horario no las ejecuta ni anon ni una persona');

-- ══ 2 · LAS FRANJAS DE UNA FECHA ═════════════════════════════════════════════
select is(pg_temp.franjas('delivery', '2026-10-05'), '09:00-13:00 13:00-18:00', 'lunes: dos franjas que se tocan');
select is(pg_temp.franjas('delivery', '2026-10-06'), '09:00-13:00 13:00-18:00 21:00-23:30', 'martes: ademas el turno de la noche');
select is(pg_temp.franjas('delivery', '2026-10-11'), '', 'domingo: sin servicio, cero franjas');
select is(pg_temp.franjas('delivery', '2026-10-07'), '', 'un cierre `all` devuelve cero franjas');
select is(pg_temp.franjas('delivery', '2026-10-08'), '10:00-15:00', 'un horario especial reemplaza a la grilla de esa fecha');
select is(pg_temp.franjas('delivery', '2026-10-13'), '22:00-03:00', 'un horario especial `all` rige para el canal de venta');
select is(pg_temp.franjas('pickup', '2026-10-13'), '22:00-03:00', 'y tambien para el retiro');
select is(pg_temp.franjas('delivery', '2026-10-17'), '',
  'F-08: con un cierre y un horario especial en la misma fecha, la fecha esta cerrada');
select is(pg_temp.franjas('alcohol', '2026-10-13'), '10:00-22:00',
  'F-08: un horario especial `all` no reemplaza la ventana del canal alcohol');
select is(pg_temp.franjas('alcohol', '2026-10-07'), '', 'un cierre `all` si cierra el canal alcohol');
select is(pg_temp.franjas('alcohol', '2026-10-08'), '10:00-22:00', 'un horario especial de delivery no toca el canal alcohol');

-- ══ 3 · ABIERTO O CERRADO, INSTANTE POR INSTANTE ═════════════════════════════
create temporary table motor_casos (n serial, canal text, cuando text, esperado boolean, motivo text) on commit drop;
insert into motor_casos (canal, cuando, esperado, motivo) values
  -- Bordes: la apertura esta incluida, el cierre no.
  ('delivery', '2026-10-05 08:59:59.999999', false, 'un microsegundo antes de abrir esta cerrado'),
  ('delivery', '2026-10-05 09:00:00',        true,  'en el instante de apertura esta abierto'),
  ('delivery', '2026-10-05 12:59:59',        true,  'abierto antes de la union de las dos franjas'),
  ('delivery', '2026-10-05 13:00:00',        true,  'y en la union: una termina donde empieza la otra'),
  ('delivery', '2026-10-05 17:59:59.999999', true,  'un microsegundo antes de cerrar esta abierto'),
  ('delivery', '2026-10-05 18:00:00',        false, 'en el instante de cierre esta cerrado'),
  -- Turno partido.
  ('delivery', '2026-10-06 19:30:00',        false, 'martes entre los dos turnos: cerrado'),
  ('delivery', '2026-10-06 21:00:00',        true,  'martes segundo turno: abre'),
  ('delivery', '2026-10-06 23:29:59',        true,  'martes segundo turno: sigue abierto'),
  ('delivery', '2026-10-06 23:30:00',        false, 'martes segundo turno: cierra'),
  -- Cierre por excepcion: toda la fecha local.
  ('delivery', '2026-10-07 00:00:00',        false, 'miercoles cerrado desde el primer instante'),
  ('delivery', '2026-10-07 12:00:00',        false, 'miercoles cerrado al mediodia aunque la grilla diga abierto'),
  ('delivery', '2026-10-07 23:59:59',        false, 'miercoles cerrado hasta el ultimo instante'),
  -- Horario especial: reemplaza, no suma.
  ('delivery', '2026-10-08 09:30:00',        false, 'jueves especial: la grilla de 09:00 no vale'),
  ('delivery', '2026-10-08 10:00:00',        true,  'jueves especial: abre a las 10'),
  ('delivery', '2026-10-08 14:59:59',        true,  'jueves especial: abierto hasta las 15'),
  ('delivery', '2026-10-08 15:00:00',        false, 'jueves especial: cierra a las 15'),
  ('delivery', '2026-10-08 22:00:00',        false, 'jueves especial: el turno de la noche de la grilla tampoco vale'),
  -- Cruce de medianoche: cola del viernes, arrastre del sabado.
  ('delivery', '2026-10-09 19:59:59',        false, 'viernes antes de las 20: cerrado'),
  ('delivery', '2026-10-09 20:00:00',        true,  'viernes a las 20: abre'),
  ('delivery', '2026-10-09 23:59:59.999999', true,  'viernes: abierto hasta el ultimo instante del dia'),
  ('delivery', '2026-10-10 00:00:00',        false, 'sabado cerrado por excepcion: el arrastre del viernes no entra'),
  ('delivery', '2026-10-10 01:00:00',        false, 'sabado cerrado: 01:00 cerrado'),
  ('delivery', '2026-10-10 21:00:00',        false, 'sabado cerrado: tampoco su franja propia'),
  ('delivery', '2026-10-11 01:00:00',        false, 'domingo 01:00: un dia cerrado no deja arrastre'),
  ('delivery', '2026-10-11 12:00:00',        false, 'domingo: sin servicio'),
  -- Horario especial `all` que cruza la medianoche.
  ('delivery', '2026-10-13 12:00:00',        false, 'martes especial: la grilla del mediodia no vale'),
  ('delivery', '2026-10-13 22:00:00',        true,  'martes especial: abre a las 22'),
  ('delivery', '2026-10-14 02:59:59',        true,  'miercoles: arrastre del especial hasta las 03'),
  ('delivery', '2026-10-14 03:00:00',        false, 'miercoles 03:00: termino el arrastre'),
  ('delivery', '2026-10-14 09:00:00',        true,  'miercoles: vuelve la grilla'),
  -- Cierre + especial la misma fecha (F-08).
  ('delivery', '2026-10-16 23:00:00',        true,  'viernes 16: abierto por su cola'),
  ('delivery', '2026-10-17 00:30:00',        false, 'sabado 17 cerrado: el arrastre del viernes no entra'),
  ('delivery', '2026-10-17 23:00:00',        false, 'sabado 17 cerrado: el horario especial del canal no lo abre'),
  ('delivery', '2026-10-18 01:00:00',        false, 'F-08: domingo 18 a la 01:00 cerrado, un dia cerrado no deja arrastre'),
  -- Cruce semanal completo, sin excepciones.
  ('delivery', '2026-10-23 21:00:00',        true,  'viernes 23: cola'),
  ('delivery', '2026-10-24 01:59:59',        true,  'sabado 24: arrastre del viernes'),
  ('delivery', '2026-10-24 02:00:00',        false, 'sabado 24 02:00: termino el arrastre'),
  ('delivery', '2026-10-24 12:00:00',        false, 'sabado 24 mediodia: la franja propia todavia no empezo'),
  ('delivery', '2026-10-24 20:00:00',        true,  'sabado 24: su propia cola'),
  ('delivery', '2026-10-25 01:00:00',        true,  'domingo 25: sin franjas propias, recibe el arrastre del sabado'),
  ('delivery', '2026-10-25 02:00:00',        false, 'domingo 25 02:00: cerrado'),
  -- Retiro no tiene franjas en este comercio: exigido y sin franjas, cerrado.
  ('pickup',   '2026-10-05 12:00:00',        false, 'un canal exigido sin franjas esta cerrado'),
  ('pickup',   '2026-10-13 23:00:00',        true,  'salvo la fecha en que una excepcion `all` le da horario'),
  -- Alcohol: su ventana, no la del comercio.
  ('alcohol',  '2026-10-05 09:59:59',        false, 'alcohol antes de su ventana'),
  ('alcohol',  '2026-10-05 10:00:00',        true,  'alcohol en su ventana'),
  ('alcohol',  '2026-10-05 22:00:00',        false, 'alcohol al cierre de su ventana'),
  ('alcohol',  '2026-10-13 23:00:00',        false, 'F-08: el horario especial `all` hasta las 03 no vende alcohol a las 23'),
  ('alcohol',  '2026-10-13 12:00:00',        true,  'F-08: ni le quita su ventana propia'),
  ('alcohol',  '2026-10-07 12:00:00',        false, 'el cierre `all` cierra tambien el alcohol');

select is(pg_temp.abierto(c.canal, c.cuando), c.esperado, c.canal || ' ' || c.cuando || ': ' || c.motivo)
  from motor_casos c order by c.n;

-- ══ 4 · FALLA CERRADA Y EXIGENCIA APAGADA ════════════════════════════════════
select is(public.business_is_open('d6300000-0000-4000-8000-0000000000b3', 'delivery', '2026-10-05 12:00-03'), false,
  'exigencia encendida sin una sola franja: cerrado');
select is(public.business_next_open_at('d6300000-0000-4000-8000-0000000000b3', 'delivery', '2026-10-05 12:00-03'), null,
  'y sin proxima apertura');
select is(public.business_is_open('d6300000-0000-4000-8000-0000000000b2', 'delivery', '2026-10-05 04:00-03'), true,
  'exigencia apagada: abierto a cualquier hora');
select is(public.business_is_open('d6300000-0000-4000-8000-0000000000b1', 'otro', '2026-10-05 12:00-03'), false,
  'un canal que no existe esta cerrado');
select is(public.business_is_open('d6300000-0000-4000-8000-0000000000ff', 'delivery', '2026-10-05 12:00-03'), false,
  'un comercio que no existe esta cerrado');

-- ══ 5 · LA PRÓXIMA APERTURA ══════════════════════════════════════════════════
select is(pg_temp.proxima('2026-10-05 08:00'), '2026-10-05 09:00', 'antes de abrir: hoy a las 09');
select is(pg_temp.proxima('2026-10-06 23:45'), '2026-10-08 10:00', 'saltea el miercoles cerrado y cae en el horario especial del jueves');
select is(pg_temp.proxima('2026-10-10 12:00'), '2026-10-12 09:00', 'desde el sabado cerrado: saltea el domingo sin servicio');
select is(pg_temp.proxima('2026-10-17 12:00'), '2026-10-19 09:00',
  'F-08: el sabado con cierre y especial no ofrece apertura, y coincide con business_is_open');

select * from finish();
rollback;
