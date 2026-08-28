-- TABA 24/7 · «Abierto las 24 horas» se escribe 00:00 - 24:00.
--
-- Lo que fija este ensayo, en tres lineas:
--
--     UN CANAL con 00:00-24:00 los siete dias esta abierto a cualquier hora,
--     con la exigencia de horario ENCENDIDA.
--     EL CANAL DE ALCOHOL no se abre por eso: tiene su propia grilla y su
--     propia bandera.
--     UN HORARIO COMERCIAL normal sigue cerrando de madrugada.
--
-- Los cinco instantes del encargo -23:59, 00:00, 02:00, 05:00 y 12:00- se
-- prueban en el huso del comercio, que es el unico que decide.
--
-- Todo transaccional: termina en rollback y no deja una fila.
--
-- Correr con: supabase test db --local supabase/tests/horario_24x7_test.sql

begin;
create extension if not exists pgtap with schema extensions;
select plan(14);

insert into public.businesses(id, name, status, slug, is_active, hours_enforced, alcohol_hours_enforced, operating_timezone)
values (
  'ec000000-0000-4000-8000-000000000001',
  'TABA 24/7',
  'open',
  'taba-24x7',
  true,
  true,
  true,
  'America/Argentina/Buenos_Aires'
);

-- El canal de PEDIDOS abierto las 24 horas: un dia completo por dia.
insert into public.business_service_hours(business_id, channel, weekday, opens_at, closes_at)
select 'ec000000-0000-4000-8000-000000000001', 'delivery', d, time '00:00', time '24:00'
  from generate_series(0, 6) as d;

-- El canal de ALCOHOL, en cambio, con una ventana acotada. Son filas distintas:
-- que el comercio abra toda la noche no toca esta grilla.
insert into public.business_service_hours(business_id, channel, weekday, opens_at, closes_at)
select 'ec000000-0000-4000-8000-000000000001', 'alcohol', d, time '10:00', time '22:00'
  from generate_series(0, 6) as d;

-- Un instante local expresado en el huso del comercio.
create function pg_temp.momento(p_fecha date, p_hora text) returns timestamptz
language sql stable as $$
  select (p_fecha::timestamp + p_hora::time) at time zone 'America/Argentina/Buenos_Aires';
$$;

-- ── 1..5 · Los cinco instantes del encargo, con el canal 24/7 ────────────────
select ok(
  public.business_is_open('ec000000-0000-4000-8000-000000000001', 'delivery', pg_temp.momento(date '2026-09-02', '23:59')),
  '23:59 con 00:00-24:00 esta abierto'
);
select ok(
  public.business_is_open('ec000000-0000-4000-8000-000000000001', 'delivery', pg_temp.momento(date '2026-09-02', '00:00')),
  '00:00 con 00:00-24:00 esta abierto'
);
select ok(
  public.business_is_open('ec000000-0000-4000-8000-000000000001', 'delivery', pg_temp.momento(date '2026-09-02', '02:00')),
  '02:00 con 00:00-24:00 esta abierto'
);
select ok(
  public.business_is_open('ec000000-0000-4000-8000-000000000001', 'delivery', pg_temp.momento(date '2026-09-02', '05:00')),
  '05:00 con 00:00-24:00 esta abierto'
);
select ok(
  public.business_is_open('ec000000-0000-4000-8000-000000000001', 'delivery', pg_temp.momento(date '2026-09-02', '12:00')),
  '12:00 con 00:00-24:00 esta abierto'
);

-- ── 6 · Los siete dias, no solo el miercoles ─────────────────────────────────
select is(
  (select count(*) from generate_series(0, 6) as d
    where public.business_is_open(
      'ec000000-0000-4000-8000-000000000001', 'delivery',
      pg_temp.momento(date '2026-08-30' + d, '03:33'))),
  7::bigint,
  'los siete dias estan abiertos a las 03:33'
);

-- ── 7..9 · EL ALCOHOL NO SE ABRE POR EL HORARIO GENERAL ──────────────────────
select ok(
  not public.business_is_open('ec000000-0000-4000-8000-000000000001', 'alcohol', pg_temp.momento(date '2026-09-02', '03:00')),
  'el canal de alcohol sigue cerrado a las 03:00 aunque el comercio este abierto'
);
select ok(
  not public.business_is_open('ec000000-0000-4000-8000-000000000001', 'alcohol', pg_temp.momento(date '2026-09-02', '23:00')),
  'el canal de alcohol sigue cerrado a las 23:00'
);
select ok(
  public.business_is_open('ec000000-0000-4000-8000-000000000001', 'alcohol', pg_temp.momento(date '2026-09-02', '15:00')),
  'el canal de alcohol abre dentro de SU ventana'
);

-- ── 10 · La bandera de alcohol es propia ─────────────────────────────────────
update public.businesses set alcohol_hours_enforced = false
 where id = 'ec000000-0000-4000-8000-000000000001';
select ok(
  public.business_is_open('ec000000-0000-4000-8000-000000000001', 'alcohol', pg_temp.momento(date '2026-09-02', '03:00')),
  'apagar alcohol_hours_enforced afecta al canal alcohol y a ningun otro'
);
update public.businesses set alcohol_hours_enforced = true
 where id = 'ec000000-0000-4000-8000-000000000001';

-- ── 11..13 · Un horario comercial normal sigue cerrando ──────────────────────
delete from public.business_service_hours
 where business_id = 'ec000000-0000-4000-8000-000000000001' and channel = 'delivery';
insert into public.business_service_hours(business_id, channel, weekday, opens_at, closes_at)
select 'ec000000-0000-4000-8000-000000000001', 'delivery', d, time '09:00', time '21:00'
  from generate_series(0, 6) as d;

select ok(
  not public.business_is_open('ec000000-0000-4000-8000-000000000001', 'delivery', pg_temp.momento(date '2026-09-02', '02:00')),
  '02:00 con 09:00-21:00 esta cerrado'
);
select ok(
  public.business_is_open('ec000000-0000-4000-8000-000000000001', 'delivery', pg_temp.momento(date '2026-09-02', '12:00')),
  '12:00 con 09:00-21:00 esta abierto'
);
select ok(
  not public.business_is_open('ec000000-0000-4000-8000-000000000001', 'delivery', pg_temp.momento(date '2026-09-02', '21:00')),
  '21:00 en punto ya cerro: el intervalo es semiabierto'
);

-- ── 14 · Una franja de ancho cero sigue prohibida ────────────────────────────
-- «Cero» y «todo el dia» tienen que poder distinguirse, y por eso el dia
-- completo se escribe 24:00 y no 00:00-00:00.
select throws_ok(
  $$insert into public.business_service_hours(business_id, channel, weekday, opens_at, closes_at)
    values ('ec000000-0000-4000-8000-000000000001', 'pickup', 1, time '00:00', time '00:00')$$,
  '23514',
  null,
  'una franja de ancho cero sigue rechazada'
);

select * from finish();
rollback;
