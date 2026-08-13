-- ═══════════════════════════════════════════════════════════════════════════
-- EL DÍA COMERCIAL LO DEFINE EL NEGOCIO, NO EL TELÉFONO QUE ABRE EL PANEL (F32)
--
-- ESTADO: PREPARADA, NO APLICADA.
--
-- QUÉ ESTABA MAL
-- --------------
-- `prepare_daily_reconciliation` recibía la zona horaria COMO PARÁMETRO y la
-- usaba tal cual para recortar el día:
--
--     v_start := p_business_date::timestamp at time zone p_timezone;
--     v_end   := (p_business_date + 1)::timestamp at time zone p_timezone;
--
-- Ese `p_timezone` sale del navegador: `js/business/business-operations-center.js`
-- lo arma con `Intl.DateTimeFormat().resolvedOptions().timeZone` y lo manda en
-- un input oculto (`business-panel-render.js`). La función sólo comprobaba que
-- el nombre existiera en `pg_timezone_names`, así que 'UTC', 'Europe/Madrid' o
-- cualquiera de las ~600 zonas válidas pasaban el control.
--
-- POR QUÉ ES GRAVE, Y NO SÓLO FEO
-- -------------------------------
-- El cierre de caja es el ÚNICO registro comercial de día que este sistema
-- congela para siempre: `close_daily_reconciliation` vuelve a leer la ventana
-- YA GUARDADA, la mete en un SHA-256 y a partir de ahí un trigger de
-- inmutabilidad bloquea UPDATE y DELETE, y `unique (business_id, business_date)`
-- impide reemplazarla. No hay asiento compensatorio como en
-- `inventory_movements`. Una ventana mal calculada queda firmada y no se puede
-- corregir nunca.
--
-- Con un dispositivo en UTC y `business_date = 2026-08-13`, la ventana pasa a
-- ser [12-ago 21:00 ART, 13-ago 21:00 ART): toda la noche del 12 —el horario
-- pico de una bebida— cae fuera del día al que pertenece. `pos_payments` sólo
-- tiene `created_at`, así que la ventana es la única autoridad sobre a qué día
-- pertenece cada cobro: la plata se corre de día, aparece una diferencia de
-- caja fantasma y el operador queda obligado a escribir una explicación falsa
-- de 5 a 500 caracteres, que también se firma.
--
-- LA INTENCIÓN YA ESTABA ESCRITA EN EL REPO
-- -----------------------------------------
-- `business-panel-render.js` define `PANEL_TIMEZONE` fijo y comenta: «la zona va
-- explícita y no la del navegador: el Panel se abre desde el teléfono que haya,
-- y la hora de un pedido no puede cambiar según qué aparato lo mire». Y
-- `business_is_open` (20260812210000) ya lee `businesses.operating_timezone` y
-- se niega a responder si falta. El cierre del día era el hueco que quedaba.
--
-- QUÉ CAMBIA
-- ----------
--   1. La ventana se calcula con `businesses.operating_timezone`. `p_timezone`
--      se sigue aceptando por compatibilidad de firma pero YA NO DECIDE NADA:
--      un cliente viejo, desactualizado o manipulado no puede correr el día.
--      Es a propósito que se ignore en vez de rechazarse: así el arreglo no
--      depende de que todos los navegadores se actualicen a la vez, y no existe
--      ninguna combinación de cliente que vuelva a torcer la ventana.
--   2. Si el negocio no tiene huso, o el huso guardado no es válido, NO se
--      prepara el cierre: falla cerrado con la misma lógica que `business_is_open`
--      («exigir un horario sin saber en qué huso leerlo no se puede evaluar»).
--      Es preferible un cierre que no sale a un cierre firmado que miente.
--   3. La columna `timezone` de la fila guarda el huso REALMENTE usado, así que
--      la evidencia dice con qué zona se calculó y no hay que deducirlo.
--   4. Se completa `operating_timezone` en los negocios que ya declaraban
--      `alcohol_timezone`. NO se adivina ninguna zona: se copia el valor que el
--      propio negocio ya tenía configurado y validado, sólo donde falta, y sólo
--      si es un nombre IANA real. Un negocio sin ninguna de las dos queda como
--      está y su cierre falla cerrado hasta que una persona la configure.
--   5. `operating_timezone` y `alcohol_timezone` pasan a validarse contra
--      `pg_timezone_names` al escribirse. Se valida por catálogo, no con una
--      lista a mano, y por trigger porque un CHECK no puede consultar tablas.
--
-- LO QUE NO CAMBIA
-- ----------------
-- Ni el snapshot, ni el hash, ni la inmutabilidad, ni la idempotencia, ni la
-- autorización, ni `close_daily_reconciliation`, ni la ventana de alcohol, ni
-- `alcohol_sales_enabled`. Los sellos absolutos (order_events, alertas,
-- scheduler, payment_intents, tracking) siguen en UTC con intervalos relativos,
-- que es lo correcto: sólo el DÍA COMERCIAL necesita huso.
--
-- CÓMO SE REVIERTE
-- ----------------
-- Volver a aplicar `prepare_daily_reconciliation` de 20260802180000 y borrar el
-- trigger. El backfill no se revierte solo: es dato, y borrarlo devolvería el
-- sistema a fallar cerrado.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── 1. Validación por catálogo ──────────────────────────────────────────────
create or replace function public.businesses_validate_timezones()
returns trigger
language plpgsql
set search_path = pg_catalog, public, extensions, pg_temp
as $validate_tz$
begin
  if nullif(btrim(coalesce(new.operating_timezone, '')), '') is not null
    and not exists (select 1 from pg_catalog.pg_timezone_names where name = new.operating_timezone) then
    raise exception 'operating_timezone invalida: %', new.operating_timezone using errcode = '22023';
  end if;
  if nullif(btrim(coalesce(new.alcohol_timezone, '')), '') is not null
    and not exists (select 1 from pg_catalog.pg_timezone_names where name = new.alcohol_timezone) then
    raise exception 'alcohol_timezone invalida: %', new.alcohol_timezone using errcode = '22023';
  end if;
  return new;
end;
$validate_tz$;

-- ── 2. Backfill desde el dato que el negocio YA tenía ───────────────────────
-- Se corre ANTES de crear el trigger para no depender del orden de evaluación,
-- y sólo toca filas donde falta el huso y el de alcohol es un nombre real.
update public.businesses b
   set operating_timezone = b.alcohol_timezone
 where nullif(btrim(coalesce(b.operating_timezone, '')), '') is null
   and nullif(btrim(coalesce(b.alcohol_timezone, '')), '') is not null
   and exists (select 1 from pg_catalog.pg_timezone_names n where n.name = b.alcohol_timezone);

drop trigger if exists businesses_validate_timezones_trigger on public.businesses;
create trigger businesses_validate_timezones_trigger
before insert or update of operating_timezone, alcohol_timezone on public.businesses
for each row execute function public.businesses_validate_timezones();

comment on function public.businesses_validate_timezones() is
  'Rechaza husos que no existan en pg_timezone_names. Por catálogo y no por lista fija, y por trigger porque un CHECK no puede consultar tablas.';

-- ── 3. El cierre del día deja de creerle al navegador ──────────────────────
CREATE OR REPLACE FUNCTION public.prepare_daily_reconciliation(p_business_id uuid, p_business_date date, p_timezone text, p_declared_cash numeric, p_difference_note text, p_idempotency_key text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'extensions', 'pg_temp'
AS $function$
declare
  v_run public.daily_reconciliations%rowtype;
  v_snapshot jsonb;
  v_start timestamptz;
  v_end timestamptz;
  v_expected numeric(14,2);
  v_difference numeric(14,2);
  -- El huso AUTORITATIVO. Sale del negocio; `p_timezone` no interviene.
  v_timezone text;
begin
  if not public.has_business_role(p_business_id, array['owner','admin','staff']) then
    raise exception 'operador no autorizado' using errcode = '42501';
  end if;

  -- El día comercial pertenece al negocio. `p_timezone` se ignora a propósito:
  -- ver el encabezado de esta migración.
  select nullif(btrim(coalesce(b.operating_timezone, '')), '')
    into v_timezone
    from public.businesses b
   where b.id = p_business_id;
  if v_timezone is null then
    raise exception 'el negocio no tiene huso horario configurado: no se puede cerrar el dia'
      using errcode = '55000',
            detail = 'businesses.operating_timezone esta vacio',
            hint = 'configurar el huso del negocio antes de preparar un cierre';
  end if;
  if not exists (select 1 from pg_catalog.pg_timezone_names where name = v_timezone) then
    raise exception 'el huso horario del negocio no es valido: %', v_timezone using errcode = '22023';
  end if;

  if p_declared_cash is null or p_declared_cash < 0 or p_declared_cash > 999999999999.99 then
    raise exception 'efectivo declarado invalido' using errcode = '22023';
  end if;
  if btrim(coalesce(p_idempotency_key,'')) !~ '^[A-Za-z0-9:_-]{8,128}$' then
    raise exception 'idempotency_key invalida' using errcode = '22023';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(p_business_id::text || ':' || p_business_date::text, 0));
  select * into v_run from public.daily_reconciliations
  where business_id = p_business_id and prepare_idempotency_key = p_idempotency_key
  for update;
  if found then
    insert into public.daily_reconciliation_events(business_id,reconciliation_id,event_type,actor_id,revision,snapshot_sha256)
    values (p_business_id,v_run.id,'idempotent_replay',auth.uid(),v_run.revision,v_run.snapshot_sha256);
    return jsonb_build_object('ok',true,'reconciliation',to_jsonb(v_run),'idempotent_replay',true);
  end if;
  v_start := p_business_date::timestamp at time zone v_timezone;
  v_end := (p_business_date + 1)::timestamp at time zone v_timezone;
  v_snapshot := public.daily_reconciliation_snapshot_internal(p_business_id,v_start,v_end);
  v_expected := coalesce((v_snapshot #>> '{cash,expected}')::numeric,0);
  v_difference := round(p_declared_cash - v_expected,2);
  if v_difference <> 0 and char_length(btrim(coalesce(p_difference_note,''))) not between 5 and 500 then
    raise exception 'la diferencia de caja requiere una explicacion' using errcode = '22023';
  end if;
  insert into public.daily_reconciliations(
    business_id,business_date,timezone,status,window_start,window_end,snapshot,
    declared_cash,expected_cash,cash_difference,difference_note,open_alerts,
    critical_alerts,prepared_by,prepare_idempotency_key
  ) values (
    p_business_id,p_business_date,v_timezone,'open',v_start,v_end,v_snapshot,
    round(p_declared_cash,2),v_expected,v_difference,nullif(btrim(coalesce(p_difference_note,'')),''),
    (select count(*) from public.operational_alerts a where a.business_id=p_business_id and a.status<>'resolved'),
    (select count(*) from public.operational_alerts a where a.business_id=p_business_id and a.status<>'resolved' and a.severity='CRITICAL'),
    auth.uid(),p_idempotency_key
  )
  on conflict (business_id,business_date) do update set
    timezone=excluded.timezone,window_start=excluded.window_start,window_end=excluded.window_end,
    snapshot=excluded.snapshot,declared_cash=excluded.declared_cash,expected_cash=excluded.expected_cash,
    cash_difference=excluded.cash_difference,difference_note=excluded.difference_note,
    open_alerts=excluded.open_alerts,critical_alerts=excluded.critical_alerts,
    refreshed_at=clock_timestamp(),revision=daily_reconciliations.revision+1,
    prepare_idempotency_key=excluded.prepare_idempotency_key
  where daily_reconciliations.status='open'
  returning * into v_run;
  if not found then
    select * into v_run from public.daily_reconciliations where business_id=p_business_id and business_date=p_business_date;
    return jsonb_build_object('ok',true,'reconciliation',to_jsonb(v_run),'idempotent_replay',true);
  end if;
  insert into public.daily_reconciliation_events(business_id,reconciliation_id,event_type,actor_id,revision)
  values (p_business_id,v_run.id,case when v_run.revision=1 then 'prepared' else 'refreshed' end,auth.uid(),v_run.revision);
  return jsonb_build_object('ok',true,'reconciliation',to_jsonb(v_run),'idempotent_replay',false);
end;
$function$;

comment on function public.prepare_daily_reconciliation(uuid,date,text,numeric,text,text) is
  'Prepara el cierre del dia. La ventana sale de businesses.operating_timezone; p_timezone se acepta por compatibilidad y se ignora. Sin huso configurado no se prepara nada.';
