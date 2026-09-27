-- ============================================================================
--  ADOPCION DEL CORE FISCAL · autoridad del worker (fencing) y ambiguedad de ARCA
-- ============================================================================
--
--  Fuente canonica: bitflowapp/taba-fiscal@26d2f4cb9e379789b52e4a85e88f39910b0e852f (PR #1)
--    database/migrations/20260926190000_fiscal_worker_fencing.sql + 20260926200000_fiscal_ambiguity_reconciliation.sql
--  Los cuerpos de funcion, checks y backfills se copian textuales de la fuente
--  (ver docs/TABA-FISCAL-CORE-ADOPTION.md): La Taba ejecuta el mismo contrato.
--  No se reaplica ninguna migracion historica: esto es el DELTA desde
--  20260926160000_local_print_agent.sql (cabeza de La Taba) al contrato del core.
--
--  Efectos:
--    · lease_epoch (fencing monotono): reserve/complete son compare-and-swap sobre el epoch (TF001 si otro worker reclamo despues);
--    · claim_fiscal_outbox recibe entorno y CUIT: un worker nunca toca comprobantes de otro CUIT/entorno;
--    · dispatch_count/last_dispatch_at: cada FECAESolicitar se registra antes de salir (write-ahead);
--    · begin_fiscal_resend: la base decide el reenvio del MISMO numero (periodo de silencio, tope de 8 envios);
--    · estado manual_review; un rechazo verificado libera el numero; un ambiguo nunca va a dead letter;
--    · datos existentes: lo que pudo llegar a ARCA vuelve a conciliarse (backfill textual de 200000);
--    · las firmas viejas del worker se ELIMINAN: un worker anterior falla cerrado (PGRST202/42883), no reclama ni emite.
--
--  No se adopta (sin efecto en La Taba o reemplazado mas adelante):
--    · las firmas intermedias de 190000 (claim/reserve/complete): se pasa directo a las finales de 200000.
--
-- ============================================================================
--
--  ---- Encabezado original en taba-fiscal (190000); sus rutas son de ese repositorio ----
-- ============================================================================
--  Autoridad de un worker sobre un comprobante: fencing por epoch de lease.
-- ============================================================================
--
--  QUE SE MIDIO (services/arca-fiscal-bridge/tests/db/worker-fencing.test.ts,
--  worker real + PostgreSQL real, todos los workers con el mismo
--  FISCAL_WORKER_ID, como quedan las replicas de un mismo despliegue):
--
--    - un worker pausado con FECAESolicitar en vuelo pierde el lease, otro lo
--      toma y el viejo vuelve: complete_fiscal_attempt le aceptaba el
--      resultado porque lease_owner coincidia. El dueno de un lease era un
--      texto de configuracion, no una autoridad;
--    - claim_fiscal_outbox reclamaba comprobantes de cualquier CUIT y de
--      cualquier entorno: un worker del CUIT X marcaba "failed" los
--      comprobantes del CUIT Y, y un worker de homologacion autorizaba contra
--      homologacion un comprobante de produccion.
--
--  CONTRATO QUE QUEDA:
--
--    fiscal_outbox.lease_epoch es un token de fencing monotono: cada claim lo
--    incrementa y lo devuelve. reserve y complete son compare-and-swap sobre
--    ese epoch bajo FOR UPDATE: si alguien reclamo despues, la escritura se
--    rechaza con SQLSTATE TF001 y el worker descarta su resultado. La
--    autoridad es el epoch, no el reloj: un resultado tardio se acepta solo
--    si nadie reclamo el trabajo mientras tanto (el lease vencido habilita a
--    otro a reclamar; no invalida por si solo lo que ya ocurrio).
--
--    claim_fiscal_outbox recibe el entorno y el CUIT del worker y solo
--    entrega comprobantes de ese entorno y ese CUIT que no esten en un estado
--    final.
--
--  Despliegue: aplicar esta migracion y despues el worker. Un worker anterior
--  falla cerrado (las firmas viejas ya no existen): no reclama ni emite.
-- ============================================================================

--
--  ---- Encabezado original en taba-fiscal (200000); sus rutas son de ese repositorio ----
-- ============================================================================
--  FECAESolicitar con resultado desconocido: nunca rechazado, nunca otro
--  numero, nunca un reenvio sin verificar.
-- ============================================================================
--
--  QUE SE MIDIO (services/arca-fiscal-bridge/tests/db/arca-ambiguity.test.ts
--  y worker-fencing.test.ts, worker real + PostgreSQL real + WSFEv1 simulado):
--
--    - un corte de red o un HTTP 502 DESPUES de que ARCA proceso quedaba como
--      "service_error" con reintento, y un comprobante ya enviado podia pasar
--      a retry_wait perdiendo la marca de ambiguedad;
--    - el reenvio del MISMO numero ocurria en el intento siguiente, sin
--      periodo de silencio: con el pedido original todavia en vuelo (worker
--      pausado, red lenta) salian dos FECAESolicitar por el mismo numero;
--    - un rechazo 10016 se registraba como rechazo definitivo sin consultar a
--      ARCA, aunque el 10016 significara "ese numero ya lo autorizaste vos";
--    - un rechazo definitivo conservaba el numero reservado y bloqueaba la
--      serie para siempre (el siguiente comprobante chocaba con el);
--    - las diferencias con ARCA terminaban en "failed", el mismo estado que un
--      error de configuracion previo a enviar;
--    - despues de 8 intentos un comprobante ambiguo iba a dead letter con el
--      documento en retry_wait: la ambiguedad desaparecia.
--
--  CONTRATO QUE QUEDA:
--
--    dispatch_count / last_dispatch_at: registro previo a cada FECAESolicitar
--      (write-ahead). reserve_fiscal_document_number reserva el numero, fija
--      la fecha del comprobante y registra el primer envio;
--      begin_fiscal_resend registra cada reenvio. Un comprobante con
--      dispatch_count > 0 PUDO llegar a ARCA: solo sale de la ambiguedad con
--      evidencia de ARCA.
--    begin_fiscal_resend autoriza reenviar el MISMO numero solo si: el lease
--      es vigente, el comprobante esta ambiguous, paso el periodo de silencio
--      desde el ultimo envio (5 min x envios, tope 30 min) y no se llego a 8
--      envios (entonces manual_review). La base decide; el worker pide.
--    complete_fiscal_attempt aplica reglas por clasificacion:
--      authorized    -> solo con numero reservado y el mismo numero;
--      rejected      -> solo tras un envio de este lease; libera el numero
--                       (ARCA no lo consumio) y lo deja en la auditoria;
--      ambiguous     -> backoff exponencial con tope; NUNCA dead letter;
--      manual_review -> estado propio, fuera de la cola automatica, conserva
--                       el numero en disputa;
--      service_error -> solo ANTES de cualquier envio: nunca final salvo
--                       REQUIRES_FISCAL_REVIEW; espera acotada y se reintenta.
--    claim_fiscal_outbox: tomar un lease vencido de un comprobante en
--      authorizing lo pasa a ambiguous (el envio pudo haber llegado).
--
--  Datos existentes (todo lo que el worker anterior pudo dejar): con numero en
--  queued/retry_wait/authorizing/ambiguous -> ambiguous con envio registrado,
--  vuelve a conciliarse; "en vuelo" sin numero -> retry_wait; "failed" con
--  numero -> manual_review (y una nota de credito recupera sus asignaciones);
--  "rejected" con numero -> libera el numero, marcado para verificar en ARCA.
--
--  NULL nunca saltea una verificacion: epoch, worker, limites y numero
--  esperado NULL se rechazan (TF001 / 22023).
-- ============================================================================

alter table public.fiscal_outbox
  add column if not exists lease_epoch bigint not null default 0 check (lease_epoch >= 0);

alter table public.fiscal_request_attempts
  add column if not exists lease_epoch bigint;

comment on column public.fiscal_outbox.lease_epoch is
  'Token de fencing: se incrementa en cada claim. reserve y complete exigen el epoch vigente (SQLSTATE TF001 si otro worker reclamo despues).';

alter table public.fiscal_documents
  add column if not exists dispatch_count integer not null default 0 check (dispatch_count >= 0),
  add column if not exists last_dispatch_at timestamptz;

alter table public.fiscal_request_attempts
  add column if not exists document_number bigint;

comment on column public.fiscal_documents.dispatch_count is
  'FECAESolicitar registrados antes de enviarse (write-ahead). Mayor a 0: ARCA pudo haber recibido el comprobante.';
comment on column public.fiscal_documents.last_dispatch_at is
  'Momento del ultimo FECAESolicitar registrado. El reenvio del mismo numero espera el periodo de silencio desde aca.';

alter table public.fiscal_documents drop constraint if exists fiscal_documents_state_check;
alter table public.fiscal_documents add constraint fiscal_documents_state_check check (state in (
  'draft','queued','claiming','authenticating','authorizing','authorized','observed','rejected','ambiguous',
  'retry_wait','failed','credited','manual_review'
));

-- ---- Datos existentes: lo que pudo haberse enviado vuelve a conciliarse ----
-- Todo lo que el worker anterior pudo dejar (queued, retry_wait, authorizing,
-- ambiguous, rejected, failed, con o sin numero) tiene que cumplir el contrato
-- nuevo ANTES de agregar el CHECK: si una sola fila no lo cumple, la migracion
-- aborta y la emision queda detenida (revision adversarial, S1).

-- (a) Con numero y sin resultado confirmado: pudo llegar a ARCA. Se concilia.
--     Incluye los que el worker anterior ya dejo "ambiguous" (sin registro de envio).
with converted as (
  update public.fiscal_documents d
     set state = 'ambiguous', result = 'ambiguous', dispatch_count = greatest(d.dispatch_count, 1),
         last_dispatch_at = coalesce(d.last_dispatch_at, now())
   where d.document_number is not null and d.state in ('queued','retry_wait','authorizing','ambiguous')
  returning d.id
), requeued as (
  update public.fiscal_outbox o
     set state = 'retry_wait', next_attempt_at = now(), processed_at = null, lease_owner = null, lease_deadline = null
    from converted c
   where o.fiscal_document_id = c.id and o.state in ('dead_letter','retry_wait','pending')
  returning o.id
)
insert into public.fiscal_events(fiscal_document_id, event_type, actor_type, sanitized_detail)
select c.id, 'ambiguous_legacy_state', 'system', jsonb_build_object('reason', 'numero reservado sin resultado confirmado')
  from converted c;

-- (b) "En vuelo" sin numero: nada pudo enviarse con un numero (el worker
--     anterior reservaba antes de enviar). Vuelve a la cola, sin envios.
with unnumbered as (
  update public.fiscal_documents d
     set state = 'retry_wait', result = 'service_error'
   where d.document_number is null and d.state in ('authorizing','ambiguous')
  returning d.id
), requeued as (
  update public.fiscal_outbox o
     set state = 'retry_wait', next_attempt_at = now(), processed_at = null, lease_owner = null, lease_deadline = null
    from unnumbered u
   where o.fiscal_document_id = u.id and o.state in ('dead_letter','retry_wait','pending')
  returning o.id
)
insert into public.fiscal_events(fiscal_document_id, event_type, actor_type, sanitized_detail)
select u.id, 'retry_legacy_state', 'system', jsonb_build_object('reason', 'en vuelo sin numero reservado: nada se envio')
  from unnumbered u;

-- (c) "failed" con numero: pudo llegar a ARCA -> revision humana. Si es una
--     nota de credito, el codigo anterior libero sus asignaciones: se vuelven a
--     reservar, o la misma factura se podria acreditar dos veces (S4).
with reviewed as (
  update public.fiscal_documents d
     set state = 'manual_review', result = 'manual_review', dispatch_count = greatest(d.dispatch_count, 1),
         last_dispatch_at = coalesce(d.last_dispatch_at, now())
   where d.document_number is not null and d.state = 'failed'
  returning d.id
), rereserved as (
  update public.fiscal_credit_allocations a
     set state = 'reserved'
    from reviewed r
   where a.credit_document_id = r.id and a.state = 'released'
  returning a.credit_document_id
)
insert into public.fiscal_events(fiscal_document_id, event_type, actor_type, sanitized_detail)
select r.id, 'manual_review_legacy_state', 'system', jsonb_build_object(
    'reason', 'fallo despues de reservar numero',
    'credit_allocations_rereserved', (select count(*) from rereserved x where x.credit_document_id = r.id))
  from reviewed r;

-- (d) "rejected" con numero: el codigo anterior no liberaba el numero y la
--     serie quedaba bloqueada para siempre (S5). ARCA decide la numeracion
--     (el siguiente es el ultimo autorizado + 1), asi que liberarlo nunca
--     reutiliza un numero que ARCA consumio. Ese rechazo no se verifico con
--     FECompConsultar: queda marcado para confirmarlo en ARCA.
with legacy as (
  select d.id, d.document_number from public.fiscal_documents d
   where d.document_number is not null and d.state = 'rejected'
), released as (
  update public.fiscal_documents d
     set document_number = null
    from legacy l
   where d.id = l.id
  returning d.id
)
insert into public.fiscal_events(fiscal_document_id, event_type, actor_type, sanitized_detail)
select l.id, 'legacy_rejection_number_released', 'system', jsonb_build_object(
    'released_document_number', l.document_number,
    'verification_required', 'rechazo anterior a la verificacion con FECompConsultar: confirmar en ARCA que el numero no quedo autorizado')
  from legacy l
  join released r on r.id = l.id;

alter table public.fiscal_documents add constraint fiscal_documents_dispatch_consistency check (
  (state not in ('authorizing','ambiguous') or (document_number is not null and dispatch_count >= 1 and last_dispatch_at is not null))
  and (state not in ('queued','retry_wait') or (document_number is null and dispatch_count = 0))
);

-- ---- Politica de reenvio (una sola fuente de verdad) ------------------------
create or replace function private.fiscal_resend_quiet_period(p_dispatch_count integer)
returns interval
language sql
immutable
set search_path = pg_catalog, pg_temp
as $fiscal_resend_quiet_period$
  select least(interval '30 minutes', make_interval(mins => 5 * greatest(p_dispatch_count, 1)));
$fiscal_resend_quiet_period$;

create or replace function private.fiscal_max_dispatches()
returns integer
language sql
immutable
set search_path = pg_catalog, pg_temp
as $fiscal_max_dispatches$
  select 8;
$fiscal_max_dispatches$;

create or replace function private.fiscal_reconcile_backoff(p_attempt integer)
returns interval
language sql
immutable
set search_path = pg_catalog, pg_temp
as $fiscal_reconcile_backoff$
  select least(interval '30 minutes', make_interval(secs => 60 * (2 ^ least(greatest(p_attempt, 1) - 1, 5))));
$fiscal_reconcile_backoff$;

-- Margen minimo de lease para EMPEZAR un envio: el transporte corta a los 20 s,
-- asi que el envio termina (o se da por perdido) antes de que otro pueda reclamar.
create or replace function private.fiscal_dispatch_margin()
returns interval
language sql
immutable
set search_path = pg_catalog, pg_temp
as $fiscal_dispatch_margin$
  select interval '30 seconds';
$fiscal_dispatch_margin$;

-- Firmas del worker anterior (La Taba 20260802160000) y las intermedias de 190000: no deben sobrevivir.
drop function if exists public.claim_fiscal_outbox(text, integer, integer);
drop function if exists public.reserve_fiscal_document_number(uuid, text, bigint);
drop function if exists public.complete_fiscal_attempt(uuid, text, jsonb);
drop function if exists public.claim_fiscal_outbox(text, text, text, integer, integer);
drop function if exists public.reserve_fiscal_document_number(uuid, text, bigint, bigint);
drop function if exists public.complete_fiscal_attempt(uuid, text, bigint, jsonb);

-- ---- claim: tomar un envio en vuelo lo vuelve ambiguo ------------------------
create function public.claim_fiscal_outbox(
  p_worker_id text,
  p_environment text,
  p_cuit text,
  p_limit integer default 1,
  p_lease_seconds integer default 120
)
returns setof public.fiscal_outbox
language plpgsql
security definer
set search_path = pg_catalog, public, extensions, pg_temp
as $claim_fiscal_outbox$
declare
  v_row public.fiscal_outbox%rowtype;
begin
  if btrim(coalesce(p_worker_id,'')) !~ '^[A-Za-z0-9._-]{3,80}$'
    or coalesce(p_environment,'') not in ('homologation','production')
    or coalesce(p_cuit,'') !~ '^[0-9]{11}$'
    or coalesce(p_limit, 0) not between 1 and 50
    or coalesce(p_lease_seconds, 0) not between 30 and 300
  then raise exception 'parametros de lease invalidos' using errcode='22023'; end if;
  for v_row in
    select o.*
      from public.fiscal_outbox o
      join public.fiscal_documents d on d.id = o.fiscal_document_id
     where ((o.state in ('pending','retry_wait') and o.next_attempt_at <= now()) or (o.state = 'leased' and o.lease_deadline < now()))
       and d.environment = p_environment
       and d.cuit = p_cuit
       and d.state in ('queued','retry_wait','authorizing','ambiguous')
     order by o.next_attempt_at, o.created_at
     for update of o skip locked
     limit p_limit
  loop
    if v_row.state = 'leased' then
      -- El dueno anterior perdio la autoridad; si estaba enviando, el resultado es desconocido.
      update public.fiscal_documents
         set state = 'ambiguous', result = 'ambiguous'
       where id = v_row.fiscal_document_id and state = 'authorizing';
      if found then
        insert into public.fiscal_events(fiscal_document_id, event_type, actor_type, sanitized_detail)
        values (v_row.fiscal_document_id, 'lease_expired_during_dispatch', 'system',
          jsonb_build_object('previous_lease_epoch', v_row.lease_epoch, 'previous_owner', v_row.lease_owner));
      end if;
    end if;
    update public.fiscal_outbox o
       set state = 'leased', lease_owner = p_worker_id, lease_epoch = o.lease_epoch + 1,
           lease_deadline = now() + make_interval(secs => p_lease_seconds), attempt_count = o.attempt_count + 1
     where o.id = v_row.id
    returning o.* into v_row;
    return next v_row;
  end loop;
end;
$claim_fiscal_outbox$;

-- ---- reserva: numero + fecha + primer envio, todo antes de enviar ------------
create function public.reserve_fiscal_document_number(
  p_document_id uuid,
  p_worker_id text,
  p_lease_epoch bigint,
  p_expected_number bigint,
  p_issue_date date
)
returns public.fiscal_documents
language plpgsql
security definer
set search_path = pg_catalog, public, extensions, pg_temp
as $reserve_fiscal_document_number$
declare
  v_document public.fiscal_documents%rowtype;
  v_outbox public.fiscal_outbox%rowtype;
  v_today date := (now() at time zone 'America/Argentina/Buenos_Aires')::date;
begin
  if coalesce(p_expected_number, 0) < 1 or p_issue_date is null or abs(p_issue_date - v_today) > 1 then
    raise exception 'numero o fecha fiscal invalidos' using errcode='22023';
  end if;
  select o.* into v_outbox from public.fiscal_outbox o where o.fiscal_document_id = p_document_id for update;
  if not found or p_lease_epoch is null or v_outbox.state <> 'leased' or v_outbox.lease_owner is distinct from p_worker_id
     or v_outbox.lease_epoch is distinct from p_lease_epoch or v_outbox.lease_deadline <= now() + private.fiscal_dispatch_margin() then
    raise exception 'lease fiscal perdido: no reservar ni emitir' using errcode='TF001';
  end if;
  select d.* into v_document from public.fiscal_documents d where d.id = p_document_id for update;
  if not found then raise exception 'documento fiscal inexistente' using errcode='P0002'; end if;
  -- Un comprobante que ya tiene numero o ya se envio se concilia; nunca se reserva de nuevo.
  if v_document.document_number is not null or v_document.dispatch_count > 0 or v_document.state not in ('queued','retry_wait') then
    raise exception 'el comprobante ya tiene numero o envio registrado: conciliar' using errcode='TF006';
  end if;
  if v_document.document_type < 1 then raise exception 'tipo de comprobante requiere revision fiscal' using errcode='22023'; end if;
  perform pg_advisory_xact_lock(hashtextextended(concat_ws(':',v_document.environment,v_document.cuit,v_document.point_of_sale,v_document.document_type),0));
  if exists(select 1 from public.fiscal_documents d where d.environment=v_document.environment and d.cuit=v_document.cuit and d.point_of_sale=v_document.point_of_sale and d.document_type=v_document.document_type and d.document_number=p_expected_number and d.id<>v_document.id) then
    raise exception 'numero fiscal retenido por otro comprobante de la serie' using errcode='TF002';
  end if;
  update public.fiscal_documents
     set document_number = p_expected_number, issue_date = p_issue_date, state = 'authorizing',
         dispatch_count = 1, last_dispatch_at = now()
   where id = p_document_id
  returning * into v_document;
  -- Empieza la fase de envio: la conciliacion no hereda el backoff de las esperas previas.
  update public.fiscal_outbox set attempt_count = 1 where id = v_outbox.id;
  insert into public.fiscal_events(fiscal_document_id, event_type, actor_type, sanitized_detail)
  values (v_document.id, 'number_reserved', 'worker', jsonb_build_object('document_number', p_expected_number, 'issue_date', p_issue_date, 'lease_epoch', p_lease_epoch));
  return v_document;
end;
$reserve_fiscal_document_number$;

-- ---- reenvio del MISMO numero: decide la base -------------------------------
create or replace function public.begin_fiscal_resend(
  p_document_id uuid,
  p_worker_id text,
  p_lease_epoch bigint,
  p_expected_number bigint
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, extensions, pg_temp
as $begin_fiscal_resend$
declare
  v_document public.fiscal_documents%rowtype;
  v_outbox public.fiscal_outbox%rowtype;
  v_ready_at timestamptz;
begin
  select o.* into v_outbox from public.fiscal_outbox o where o.fiscal_document_id = p_document_id for update;
  if not found or p_lease_epoch is null or v_outbox.state <> 'leased' or v_outbox.lease_owner is distinct from p_worker_id
     or v_outbox.lease_epoch is distinct from p_lease_epoch or v_outbox.lease_deadline <= now() + private.fiscal_dispatch_margin() then
    raise exception 'lease fiscal perdido: no reenviar' using errcode='TF001';
  end if;
  select d.* into v_document from public.fiscal_documents d where d.id = p_document_id for update;
  if not found or v_document.state <> 'ambiguous' or v_document.document_number is distinct from p_expected_number then
    raise exception 'solo se reenvia el mismo numero de un comprobante ambiguo' using errcode='TF004';
  end if;
  if v_document.dispatch_count >= private.fiscal_max_dispatches() then
    return jsonb_build_object('allowed', false, 'reason', 'MAX_DISPATCHES', 'dispatch_count', v_document.dispatch_count);
  end if;
  v_ready_at := v_document.last_dispatch_at + private.fiscal_resend_quiet_period(v_document.dispatch_count);
  if now() < v_ready_at then
    return jsonb_build_object('allowed', false, 'reason', 'QUIET_PERIOD', 'dispatch_count', v_document.dispatch_count,
      'retry_after_seconds', ceil(extract(epoch from v_ready_at - now()))::integer);
  end if;
  update public.fiscal_documents
     set state = 'authorizing', dispatch_count = dispatch_count + 1, last_dispatch_at = now()
   where id = p_document_id
  returning * into v_document;
  insert into public.fiscal_events(fiscal_document_id, event_type, actor_type, sanitized_detail)
  values (v_document.id, 'resend_started', 'worker', jsonb_build_object('document_number', v_document.document_number, 'dispatch_count', v_document.dispatch_count, 'lease_epoch', p_lease_epoch));
  return jsonb_build_object('allowed', true, 'dispatch_count', v_document.dispatch_count);
end;
$begin_fiscal_resend$;

-- ---- resultado de un intento ------------------------------------------------
create function public.complete_fiscal_attempt(
  p_outbox_id uuid,
  p_worker_id text,
  p_lease_epoch bigint,
  p_result jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, extensions, pg_temp
as $complete_fiscal_attempt$
declare
  v_outbox public.fiscal_outbox%rowtype;
  v_document public.fiscal_documents%rowtype;
  v_class text := p_result->>'classification';
  v_error_code text := nullif(left(coalesce(p_result->>'error_code',''),80),'');
  v_cae text := regexp_replace(coalesce(p_result->>'cae',''),'[^0-9]','','g');
  v_number bigint;
  v_dispatched boolean;
  v_released bigint;
begin
  if v_class is null or v_class not in ('authorized','authorized_with_observations','rejected','ambiguous','manual_review','service_error') then
    raise exception 'clasificacion fiscal invalida' using errcode='22023';
  end if;
  select o.* into v_outbox from public.fiscal_outbox o where o.id=p_outbox_id for update;
  if not found or p_lease_epoch is null or v_outbox.state <> 'leased' or v_outbox.lease_owner is distinct from p_worker_id
     or v_outbox.lease_epoch is distinct from p_lease_epoch then
    raise exception 'lease fiscal perdido: resultado descartado' using errcode='TF001';
  end if;
  select d.* into v_document from public.fiscal_documents d where d.id=v_outbox.fiscal_document_id for update;
  v_dispatched := v_document.dispatch_count > 0;
  insert into public.fiscal_request_attempts(fiscal_document_id,outbox_id,request_id,operation,result_class,request_hash,response_hash,duration_ms,error_code,error_message,lease_epoch,document_number)
  values(v_document.id,v_outbox.id,left(coalesce(p_result->>'request_id',gen_random_uuid()::text),128),left(coalesce(p_result->>'operation','FECAESolicitar'),80),v_class,left(p_result->>'request_hash',128),left(p_result->>'response_hash',128),greatest(0,coalesce((p_result->>'duration_ms')::integer,0)),v_error_code,left(p_result->>'error_message',300),p_lease_epoch,v_document.document_number);

  -- Compatibilidad: un worker anterior informaba la revision como service_error con codigo.
  if v_class = 'service_error' and v_error_code in ('REQUIRES_FISCAL_REVIEW','ARCA_RECONCILIATION_MISMATCH') and v_dispatched then
    v_class := 'manual_review';
  end if;

  if v_class in ('authorized','authorized_with_observations') then
    v_number := case when coalesce(p_result->>'document_number','') ~ '^[0-9]{1,18}$' then (p_result->>'document_number')::bigint end;
    if v_document.state not in ('authorizing','ambiguous') or not v_dispatched or v_document.document_number is null then
      raise exception 'no hay envio registrado que autorizar' using errcode='TF004';
    end if;
    if v_number is distinct from v_document.document_number or length(v_cae) <> 14 then
      raise exception 'la autorizacion no corresponde al numero reservado' using errcode='TF004';
    end if;
    if coalesce(p_result->>'issue_date','') <> '' and (p_result->>'issue_date')::date is distinct from v_document.issue_date then
      raise exception 'la autorizacion no corresponde a la fecha reservada' using errcode='TF004';
    end if;
    update public.fiscal_documents
       set state='authorized', result=v_class, cae=v_cae, cae_expiration=(nullif(p_result->>'cae_expiration',''))::date,
           observations=coalesce(p_result->'observations','[]'::jsonb), request_hash=p_result->>'request_hash',
           response_hash=p_result->>'response_hash', authorized_at=now()
     where id=v_document.id returning * into v_document;
    if v_document.document_intent='credit_note' then update public.fiscal_credit_allocations set state='authorized' where credit_document_id=v_document.id and state='reserved'; end if;
    update public.fiscal_outbox set state='completed',processed_at=now(),lease_owner=null,lease_deadline=null,last_error_code=null,last_error_message=null where id=v_outbox.id;

  elsif v_class = 'rejected' then
    -- Un rechazo es respuesta a un envio de ESTE lease (authorizing). ARCA no consumio el numero:
    -- se libera para la serie y queda en la auditoria.
    if v_document.state <> 'authorizing' then
      raise exception 'un rechazo requiere un envio en curso' using errcode='TF004';
    end if;
    v_released := v_document.document_number;
    update public.fiscal_documents
       set state='rejected', result='rejected', document_number=null,
           observations=coalesce(p_result->'observations','[]'::jsonb), errors=coalesce(p_result->'errors','[]'::jsonb)
     where id=v_document.id returning * into v_document;
    if v_document.document_intent='credit_note' then update public.fiscal_credit_allocations set state='released' where credit_document_id=v_document.id and state='reserved'; end if;
    update public.fiscal_outbox set state='dead_letter',processed_at=now(),lease_owner=null,lease_deadline=null,last_error_code='ARCA_REJECTED',last_error_message=left(coalesce(p_result->>'error_message',''),300) where id=v_outbox.id;

  elsif v_class = 'ambiguous' then
    if not v_dispatched or v_document.state not in ('authorizing','ambiguous') then
      raise exception 'no hay envio registrado: no puede ser ambiguo' using errcode='TF004';
    end if;
    update public.fiscal_documents set state='ambiguous', result='ambiguous', errors=coalesce(p_result->'errors','[]'::jsonb) where id=v_document.id;
    -- STILL_UNKNOWN: se sigue consultando con backoff; nunca dead letter mientras no haya evidencia.
    update public.fiscal_outbox
       set state='retry_wait', next_attempt_at=now()+private.fiscal_reconcile_backoff(v_outbox.attempt_count),
           lease_owner=null, lease_deadline=null, last_error_code=coalesce(v_error_code,'AMBIGUOUS'),
           last_error_message=left(coalesce(p_result->>'error_message','Se consultara a ARCA antes de cualquier reenvio'),300)
     where id=v_outbox.id;

  elsif v_class = 'manual_review' then
    if not v_dispatched or v_document.state not in ('authorizing','ambiguous') then
      raise exception 'manual_review es para un comprobante enviado' using errcode='TF004';
    end if;
    update public.fiscal_documents set state='manual_review', result='manual_review', errors=coalesce(p_result->'errors','[]'::jsonb) where id=v_document.id;
    update public.fiscal_outbox set state='dead_letter',processed_at=now(),lease_owner=null,lease_deadline=null,
           last_error_code=coalesce(v_error_code,'ARCA_RECONCILIATION_MISMATCH'),
           last_error_message=left(coalesce(p_result->>'error_message','Requiere revision humana: no se reemite'),300)
     where id=v_outbox.id;

  else -- service_error: fallo ANTES de cualquier envio
    if v_dispatched or v_document.state not in ('queued','retry_wait') then
      raise exception 'un comprobante enviado no admite service_error: es ambiguo' using errcode='TF004';
    end if;
    if v_error_code = 'REQUIRES_FISCAL_REVIEW' then
      -- El comprobante no se puede enviar como esta (datos o politica fiscal): final.
      update public.fiscal_documents set state='failed', result='configuration_error', errors=coalesce(p_result->'errors','[]'::jsonb) where id=v_document.id;
      if v_document.document_intent='credit_note' then update public.fiscal_credit_allocations set state='released' where credit_document_id=v_document.id and state='reserved'; end if;
      update public.fiscal_outbox set state='dead_letter',processed_at=now(),lease_owner=null,lease_deadline=null,
             last_error_code=v_error_code, last_error_message=left(coalesce(p_result->>'error_message','Requiere datos fiscales o revision'),300)
       where id=v_outbox.id;
    else
      -- Nada llego a ARCA, asi que nunca es final (revision adversarial, W1): un certificado
      -- vencido, el reloj, un HTTP 4xx, un corte largo o una serie bloqueada se resuelven afuera
      -- y la venta se factura sola cuando el entorno vuelve. Espera acotada, nunca dead letter.
      update public.fiscal_documents
         set state='retry_wait', result=case when v_error_code='FISCAL_SERIES_BLOCKED' then 'series_blocked' else 'service_error' end
       where id=v_document.id;
      update public.fiscal_outbox
         set state='retry_wait',
             next_attempt_at=now() + case
               -- La serie espera a que otro comprobante resuelva su numero: 30 s, 60 s, ... tope 5 min (S5).
               when v_error_code='FISCAL_SERIES_BLOCKED' then least(interval '5 minutes', make_interval(secs=>30*(2^least(greatest(v_outbox.attempt_count,1)-1,4))))
               -- Lo que no se arregla reintentando (certificado, reloj, permisos): el tope, sin martillar a ARCA.
               when coalesce(p_result->>'retryable','')='false' then interval '30 minutes'
               else private.fiscal_reconcile_backoff(v_outbox.attempt_count) end,
             lease_owner=null, lease_deadline=null, last_error_code=coalesce(v_error_code,'SERVICE_ERROR'),
             last_error_message=left(coalesce(p_result->>'error_message', case when v_error_code='FISCAL_SERIES_BLOCKED' then 'Serie bloqueada por un comprobante sin resolver' else '' end),300)
       where id=v_outbox.id;
      -- Cada episodio (un codigo distinto del anterior) queda visible una vez, con quien retiene la serie.
      if v_outbox.last_error_code is distinct from coalesce(v_error_code,'SERVICE_ERROR') then
        insert into public.fiscal_events(fiscal_document_id, event_type, actor_type, sanitized_detail)
        values (v_document.id, 'dispatch_blocked', 'system', jsonb_strip_nulls(jsonb_build_object(
          'error_code', coalesce(v_error_code,'SERVICE_ERROR'),
          'holders', case when v_error_code='FISCAL_SERIES_BLOCKED' then (
            select jsonb_agg(jsonb_build_object('fiscal_document_id', h.id, 'state', h.state, 'document_number', h.document_number) order by h.document_number)
              from public.fiscal_documents h
             where h.environment=v_document.environment and h.cuit=v_document.cuit and h.point_of_sale=v_document.point_of_sale
               and h.document_type=v_document.document_type and h.id<>v_document.id and h.document_number is not null
               and h.state in ('authorizing','ambiguous','manual_review')) end)));
      end if;
    end if;
  end if;

  insert into public.fiscal_events(fiscal_document_id,event_type,actor_type,sanitized_detail)
  values(v_document.id, v_class, 'worker',
    (p_result-'token'-'sign'-'certificate'-'private_key'-'service_role')
      || jsonb_strip_nulls(jsonb_build_object('lease_epoch', p_lease_epoch, 'released_document_number', v_released)));
  return jsonb_build_object('fiscal_document_id',v_document.id,'state',(select state from public.fiscal_documents where id=v_document.id));
end;
$complete_fiscal_attempt$;

revoke all on function private.fiscal_resend_quiet_period(integer), private.fiscal_max_dispatches(),
  private.fiscal_reconcile_backoff(integer), private.fiscal_dispatch_margin()
from public, anon, authenticated;

revoke all on function public.claim_fiscal_outbox(text, text, text, integer, integer),
  public.reserve_fiscal_document_number(uuid, text, bigint, bigint, date),
  public.begin_fiscal_resend(uuid, text, bigint, bigint),
  public.complete_fiscal_attempt(uuid, text, bigint, jsonb)
from public, anon, authenticated;

grant execute on function public.claim_fiscal_outbox(text, text, text, integer, integer),
  public.reserve_fiscal_document_number(uuid, text, bigint, bigint, date),
  public.begin_fiscal_resend(uuid, text, bigint, bigint),
  public.complete_fiscal_attempt(uuid, text, bigint, jsonb)
to service_role;

comment on function public.begin_fiscal_resend(uuid, text, bigint, bigint) is
  'El worker pide reenviar el MISMO numero de un comprobante ambiguo; la base lo autoriza solo con lease vigente, periodo de silencio cumplido y menos de 8 envios.';

comment on function public.claim_fiscal_outbox(text, text, text, integer, integer) is
  'RPC privada del worker fiscal: reclama con SKIP LOCKED solo comprobantes de su entorno y su CUIT, e incrementa lease_epoch (token de fencing).';
