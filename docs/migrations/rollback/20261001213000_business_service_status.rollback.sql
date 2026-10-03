-- REVERSIÓN de 20261001213000_business_service_status.sql
--
-- Qué hace: retira el contrato público del estado del servicio y sus cuatro internas, y
-- devuelve `business_day_windows` a su definición anterior, capturada con
-- pg_get_functiondef sobre las 159 migraciones previas.
--
-- Ojo con lo que vuelve:
--   · la tienda se queda sin una consulta que diga ABIERTO / CERRADO / ABRE A LAS / CIERRA
--     A LAS por canal. Un cliente que ya la llame recibe «función inexistente»: revertir
--     primero el frontend que la use;
--   · una fecha con un cierre `all` y un horario especial del canal vuelve a dejar una
--     franja que se arrastra al día siguiente (abre de 00:00 a la hora de cierre de un día
--     que estuvo cerrado);
--   · un horario especial `all` vuelve a reemplazar la grilla del canal `alcohol`.
--
-- Qué NO hace: no toca una fila. Horarios, excepciones y husos quedan como están, y son
-- válidos para la definición anterior. `business_is_open` y `business_next_open_at` no se
-- habían tocado. No depende de las otras dos migraciones del paquete ni ellas de ésta: se
-- puede revertir sola.
--
-- No toca supabase_migrations.schema_migrations. Después:
--   supabase migration repair --status reverted 20261001213000
begin;

select pg_catalog.pg_advisory_xact_lock(
  pg_catalog.hashtextextended('la-taba:rollback:20261001213000', 0)
);

drop function if exists public.get_business_service_status(uuid, timestamptz);
drop function if exists public.business_alcohol_policy_runs(uuid, timestamptz);
drop function if exists public.business_schedule_runs(uuid, text, timestamptz);
drop function if exists public.business_windows_between(uuid, text, date, date);
drop function if exists public.timezone_offset_segments(text, timestamptz, timestamptz);

-- business_day_windows anterior. CREATE OR REPLACE conserva sus privilegios.
CREATE OR REPLACE FUNCTION public.business_day_windows(p_business_id uuid, p_channel text, p_date date)
 RETURNS TABLE(opens_at time without time zone, closes_at time without time zone)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
  with exception_row as (
    select e.*
      from public.business_service_exceptions e
     where e.business_id = p_business_id
       and e.on_date = p_date
       and e.channel in (p_channel, 'all')
     order by case when e.channel = p_channel then 0 else 1 end
     limit 1
  )
  select x.opens_at, x.closes_at
    from exception_row x
   where not x.is_closed
  union all
  select h.opens_at, h.closes_at
    from public.business_service_hours h
   where h.business_id = p_business_id
     and h.channel = p_channel
     and h.weekday = extract(dow from p_date)::smallint
     and not exists (select 1 from exception_row);
$function$;

comment on function public.business_day_windows(uuid, text, date) is
  'Franjas vigentes para una fecha local. La excepción del día reemplaza al horario recurrente; un cierre explícito devuelve cero filas.';

revoke all on function public.business_day_windows(uuid, text, date) from public, anon, authenticated;

commit;
