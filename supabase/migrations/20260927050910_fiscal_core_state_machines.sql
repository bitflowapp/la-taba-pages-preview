-- ============================================================================
--  ADOPCION DEL CORE FISCAL · maquinas de estado fiscal, PDF e impresion
-- ============================================================================
--
--  Fuente canonica: bitflowapp/taba-fiscal@26d2f4cb9e379789b52e4a85e88f39910b0e852f (PR #1)
--    database/migrations/20260926210000_fiscal_state_machines.sql
--  Los cuerpos de funcion, checks y backfills se copian textuales de la fuente
--  (ver docs/TABA-FISCAL-CORE-ADOPTION.md): La Taba ejecuta el mismo contrato.
--  No se reaplica ninguna migracion historica: esto es el DELTA desde
--  20260926160000_local_print_agent.sql (cabeza de La Taba) al contrato del core.
--
--  Efectos:
--    · fiscal: queued -> authorizing|retry_wait|failed; retry_wait -> authorizing|failed; authorizing -> authorized|rejected|ambiguous|manual_review;
--    ·         ambiguous -> authorized|authorizing|manual_review; authorized -> credited; el resto es final;
--    · un comprobante nace en queued sin numero/CAE/envios; lo pedido no cambia despues de encolado; lo autorizado es inmutable (55000);
--    · PDF: distinto de artifact_pending solo si esta autorizado; su falla nunca revierte un CAE; lease del PDF con epoch;
--    · print_jobs (cola del agente local, ya en CONTROLLED_PRODUCTION): queued -> claimed|cancelled; claimed -> printing|queued|failed|needs_review;
--    ·         printing -> printed|queued|failed|needs_review; needs_review -> printed|failed; reimprimir es otro trabajo.
--
-- ============================================================================
--
--  ---- Encabezado original en taba-fiscal (210000); sus rutas son de ese repositorio ----
-- ============================================================================
--  Maquinas de estado en la base: fiscal, PDF e impresion.
-- ============================================================================
--
--  QUE SE MIDIO (tests/database/fiscal_state_machine_test.sql, escribiendo
--  como postgres): las tablas aceptaban cualquier estado. Se podia insertar un
--  comprobante ya "authorized" con un CAE inventado, saltar de queued a
--  authorized, rechazar sin envio, volver de authorized a rejected o a pedir
--  CAE, "resolver" una ambiguedad sin evidencia, tener un PDF listo de un
--  comprobante sin autorizar e imprimir sin reclamo. Y si encolar el PDF
--  fallaba dentro de la transaccion de autorizacion, se perdia la
--  autorizacion.
--
--  CONTRATO QUE QUEDA (nombres existentes, sin migracion cosmetica):
--
--    Fiscal (fiscal_documents.state)
--      queued      -> authorizing | retry_wait | failed
--      retry_wait  -> authorizing | failed
--      authorizing -> authorized | rejected | ambiguous | manual_review
--      ambiguous   -> authorized | authorizing (reenvio) | manual_review
--      authorized  -> credited
--      rejected, failed, manual_review, credited: finales. Resolver una
--      revision manual requiere una RPC auditada que todavia no existe.
--      Un comprobante nace en queued, sin numero, CAE ni envios.
--      Columnas (revision adversarial, S6): la identidad nunca cambia; lo
--      pedido (importes, receptor, snapshots, items) solo mientras se arma, en
--      queued sin numero ni lease; el numero y la fecha solo al reservar; el
--      numero solo se libera con un rechazo; el registro de envios crece de a
--      uno al empezar cada envio; CAE solo al autorizar. Un autorizado solo
--      cambia de estado y en el ciclo de su PDF (55000). Nada que pudo llegar
--      a ARCA se borra.
--      (pending = queued/retry_wait, processing = authorizing,
--       ambiguous/reconciling = ambiguous.)
--
--    PDF (fiscal_documents.artifact_state): distinto de artifact_pending solo
--      si el comprobante esta autorizado; un fallo reintentable queda
--      pendiente, el definitivo queda fallido. Encolar el PDF nunca revierte
--      la autorizacion: si falla, queda el evento artifact_enqueue_failed y se
--      regenera con request_fiscal_artifact_regeneration.
--
--    Impresion (print_jobs.status, contrato del agente local)
--      queued       -> claimed | cancelled
--      claimed      -> printing | queued | failed | needs_review
--      printing     -> printed | queued | failed | needs_review
--      needs_review -> printed | failed
--      printed, failed, cancelled: finales (reimprimir es otro trabajo).
--      (sending = printing; spooler accepted / completed = printed;
--       failed_not_sent = queued|failed via not_printed; unknown = needs_review.)
--
--    Lease del PDF (S9): epoch por claim, como el del worker fiscal; una
--    replica vieja no completa ni da por fallido un PDF ajeno.
--
--  Violaciones: SQLSTATE TF004 (55000 para lo ya autorizado).
-- ============================================================================

create or replace function private.fiscal_state_transition_allowed(p_from text, p_to text)
returns boolean
language sql
immutable
set search_path = pg_catalog, pg_temp
as $fiscal_state_transition_allowed$
  select (p_from, p_to) in (
    ('queued', 'authorizing'), ('queued', 'retry_wait'), ('queued', 'failed'),
    ('retry_wait', 'authorizing'), ('retry_wait', 'failed'),
    ('authorizing', 'authorized'), ('authorizing', 'rejected'), ('authorizing', 'ambiguous'), ('authorizing', 'manual_review'),
    ('ambiguous', 'authorized'), ('ambiguous', 'authorizing'), ('ambiguous', 'manual_review'),
    ('authorized', 'credited')
  );
$fiscal_state_transition_allowed$;

-- Un comprobante se arma en la transaccion que lo encola: despues es lo que se envia a ARCA.
create or replace function private.fiscal_document_under_construction(p_document public.fiscal_documents)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public, pg_temp
as $fiscal_document_under_construction$
  select p_document.state = 'queued' and p_document.document_number is null and p_document.dispatch_count = 0
     and not exists (select 1 from public.fiscal_outbox o where o.fiscal_document_id = p_document.id and o.state = 'leased');
$fiscal_document_under_construction$;

-- SECURITY DEFINER: el trigger corre con el rol que escribe; sin esto, una escritura directa de
-- service_role fallaba con "permission denied for schema private" en vez de evaluar el contrato.
-- Las transiciones y las columnas se controlan juntas (revision adversarial, S6): el numero, la
-- fecha, el registro de envios y el CAE solo cambian en su transicion; lo pedido no cambia despues
-- de encolado; un autorizado es inmutable (55000, protect_authorized_fiscal_document) y los demas
-- finales no cambian.
create or replace function private.fiscal_documents_guard_state()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $fiscal_documents_guard_state$
declare
  v_reserving boolean;
  v_resending boolean;
  v_authorizing boolean;
  v_rejecting boolean;
begin
  if tg_op = 'INSERT' then
    if new.state is distinct from 'queued' or new.document_number is not null or new.cae is not null
       or new.authorized_at is not null or coalesce(new.dispatch_count, 0) <> 0 or new.last_dispatch_at is not null then
      raise exception 'un comprobante nace en queued, sin numero, CAE ni envios (recibido: %)', new.state using errcode = 'TF004';
    end if;
    return new;
  end if;
  if new.state is distinct from old.state and not private.fiscal_state_transition_allowed(old.state, new.state) then
    raise exception 'transicion fiscal invalida: % -> %', old.state, new.state using errcode = 'TF004';
  end if;
  if old.state in ('authorized', 'credited') then
    return new; -- inmutabilidad de lo autorizado: protect_authorized_fiscal_document (55000)
  end if;
  if old.state in ('rejected', 'failed', 'manual_review') then
    if to_jsonb(new) is distinct from to_jsonb(old) then
      raise exception 'un comprobante en % es final y no se modifica', old.state using errcode = 'TF004';
    end if;
    return new;
  end if;

  if (new.id, new.business_id, new.source_type, new.source_id, new.document_intent, new.environment, new.cuit,
      new.point_of_sale, new.document_type, new.idempotency_key, new.associated_document_id, new.created_at)
     is distinct from
     (old.id, old.business_id, old.source_type, old.source_id, old.document_intent, old.environment, old.cuit,
      old.point_of_sale, old.document_type, old.idempotency_key, old.associated_document_id, old.created_at) then
    raise exception 'la identidad de un comprobante fiscal es inmutable' using errcode = 'TF004';
  end if;
  if not private.fiscal_document_under_construction(old)
     and (new.concept, new.currency, new.currency_rate, new.recipient_type, new.recipient_document_type,
          new.recipient_document_number, new.recipient_vat_condition_id, new.net_amount, new.tax_amount, new.exempt_amount,
          new.non_taxed_amount, new.other_taxes_amount, new.total_amount, new.issuer_snapshot, new.recipient_snapshot,
          new.associated_document_snapshot, new.fiscal_policy_version, new.credit_kind, new.credit_reason)
         is distinct from
         (old.concept, old.currency, old.currency_rate, old.recipient_type, old.recipient_document_type,
          old.recipient_document_number, old.recipient_vat_condition_id, old.net_amount, old.tax_amount, old.exempt_amount,
          old.non_taxed_amount, old.other_taxes_amount, old.total_amount, old.issuer_snapshot, old.recipient_snapshot,
          old.associated_document_snapshot, old.fiscal_policy_version, old.credit_kind, old.credit_reason) then
    raise exception 'el pedido fiscal ya no se modifica: es lo que se envia a ARCA' using errcode = 'TF004';
  end if;

  v_reserving := old.state in ('queued', 'retry_wait') and new.state = 'authorizing';
  v_resending := old.state = 'ambiguous' and new.state = 'authorizing';
  v_authorizing := old.state in ('authorizing', 'ambiguous') and new.state = 'authorized';
  v_rejecting := old.state = 'authorizing' and new.state = 'rejected';

  if new.document_number is distinct from old.document_number
     and not ((v_reserving and old.document_number is null and new.document_number is not null)
              or (v_rejecting and new.document_number is null)) then
    raise exception 'el numero fiscal solo se reserva al empezar el envio y solo lo libera un rechazo verificado' using errcode = 'TF004';
  end if;
  if new.issue_date is distinct from old.issue_date and not v_reserving then
    raise exception 'la fecha del comprobante se fija al reservar el numero' using errcode = 'TF004';
  end if;
  if v_reserving or v_resending
     or (new.dispatch_count, new.last_dispatch_at) is distinct from (old.dispatch_count, old.last_dispatch_at) then
    if not ((v_reserving or v_resending)
            and new.dispatch_count = old.dispatch_count + 1
            and new.last_dispatch_at is not null
            and (old.last_dispatch_at is null or new.last_dispatch_at >= old.last_dispatch_at)) then
      raise exception 'cada envio se registra antes de salir, de a uno, y el registro no se reescribe' using errcode = 'TF004';
    end if;
  end if;
  if (new.cae, new.cae_expiration, new.authorized_at) is distinct from (old.cae, old.cae_expiration, old.authorized_at)
     and not v_authorizing then
    raise exception 'CAE, vencimiento y fecha de autorizacion solo se registran al autorizar' using errcode = 'TF004';
  end if;
  if v_authorizing and (new.cae is null or new.authorized_at is null) then
    raise exception 'no hay autorizacion sin CAE' using errcode = 'TF004';
  end if;
  return new;
end;
$fiscal_documents_guard_state$;

drop trigger if exists fiscal_documents_guard_state on public.fiscal_documents;
create trigger fiscal_documents_guard_state
  before insert or update on public.fiscal_documents
  for each row execute function private.fiscal_documents_guard_state();

-- Lo autorizado es inmutable salvo el estado (credited, lo controla el guard) y el ciclo de su PDF.
-- Antes la lista de columnas protegidas dejaba afuera fecha, vencimiento del CAE, receptor, entorno y
-- la evidencia de la autorizacion. Tampoco se borra nada que pudo llegar a ARCA.
create or replace function public.protect_authorized_fiscal_document()
returns trigger
language plpgsql
set search_path = pg_catalog, public, pg_temp
as $protect_fiscal$
declare
  v_mutable constant text[] := array['state', 'artifact_state', 'artifact_error_code', 'artifact_error_message', 'artifact_updated_at'];
begin
  if tg_op = 'DELETE' and old.state in ('authorized', 'credited') then
    raise exception 'un comprobante autorizado no se elimina' using errcode = '55000';
  end if;
  if tg_op = 'DELETE' and (old.document_number is not null or old.dispatch_count > 0) then
    raise exception 'un comprobante que pudo llegar a ARCA no se elimina' using errcode = '55000';
  end if;
  if tg_op = 'UPDATE' and old.state in ('authorized', 'credited')
     and (to_jsonb(new) - v_mutable) is distinct from (to_jsonb(old) - v_mutable) then
    raise exception 'los datos autorizados son inmutables' using errcode = '55000';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end;
$protect_fiscal$;

-- Los items son parte de lo enviado: se congelan junto con el pedido (tambien contra altas nuevas).
create or replace function public.protect_authorized_fiscal_document_item()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $protect_fiscal_item$
declare
  v_document public.fiscal_documents%rowtype;
begin
  if tg_op = 'UPDATE' and new.fiscal_document_id is distinct from old.fiscal_document_id then
    raise exception 'un item no cambia de comprobante' using errcode = '55000';
  end if;
  select d.* into v_document from public.fiscal_documents d
   where d.id = case when tg_op = 'DELETE' then old.fiscal_document_id else new.fiscal_document_id end;
  if v_document.state in ('authorized', 'credited') then
    raise exception 'los items de un comprobante autorizado son inmutables' using errcode = '55000';
  end if;
  if found and not private.fiscal_document_under_construction(v_document) then
    raise exception 'los items de un comprobante encolado para enviar son inmutables' using errcode = '55000';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end;
$protect_fiscal_item$;

drop trigger if exists fiscal_document_items_protect_authorized on public.fiscal_document_items;
create trigger fiscal_document_items_protect_authorized
  before insert or update or delete on public.fiscal_document_items
  for each row execute function public.protect_authorized_fiscal_document_item();

alter table public.fiscal_documents drop constraint if exists fiscal_documents_artifact_requires_authorization;
alter table public.fiscal_documents add constraint fiscal_documents_artifact_requires_authorization
  check (artifact_state = 'artifact_pending' or state in ('authorized', 'credited'));

-- El PDF es posterior a la autorizacion: su falla nunca revierte un CAE.
create or replace function public.enqueue_authorized_fiscal_artifact()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, extensions, pg_temp
as $enqueue_authorized_fiscal_artifact$
begin
  if new.state = 'authorized' and old.state is distinct from 'authorized' then
    begin
      insert into public.fiscal_artifact_outbox(fiscal_document_id)
      values (new.id)
      on conflict(fiscal_document_id) do nothing;
      update public.fiscal_documents
        set artifact_state = 'artifact_pending', artifact_error_code = null, artifact_error_message = null, artifact_updated_at = now()
        where id = new.id;
      insert into public.fiscal_events(fiscal_document_id, event_type, actor_type, sanitized_detail)
      values (new.id, 'artifact_pending', 'system', jsonb_build_object('required', true));
    exception when others then
      raise warning 'no se pudo encolar el PDF fiscal de %: % (%)', new.id, sqlerrm, sqlstate;
      begin
        insert into public.fiscal_events(fiscal_document_id, event_type, actor_type, sanitized_detail)
        values (new.id, 'artifact_enqueue_failed', 'system', jsonb_build_object('sqlstate', sqlstate, 'recovery', 'request_fiscal_artifact_regeneration'));
      exception when others then
        raise warning 'tampoco se pudo auditar la falla del PDF de %: %', new.id, sqlerrm;
      end;
    end;
  end if;
  return new;
end;
$enqueue_authorized_fiscal_artifact$;

-- == Lease del PDF con epoch (revision adversarial, S9) ======================
-- Las replicas comparten FISCAL_WORKER_ID: el duenio del lease no distingue a la replica vieja,
-- que podia dar por fallido (dead letter) un PDF que la vigente estaba por completar. Cada claim
-- incrementa lease_epoch; completar y fallar exigen el epoch vigente (NULL nunca coincide).
alter table public.fiscal_artifact_outbox
  add column if not exists lease_epoch bigint not null default 0 check (lease_epoch >= 0);

create or replace function public.claim_fiscal_artifact_outbox(
  p_worker_id text,
  p_limit integer default 5,
  p_lease_seconds integer default 120
)
returns setof public.fiscal_artifact_outbox
language plpgsql
security definer
set search_path = pg_catalog, public, extensions, pg_temp
as $claim_fiscal_artifact_outbox$
begin
  if btrim(coalesce(p_worker_id,'')) !~ '^[A-Za-z0-9._-]{3,80}$'
    or coalesce(p_limit, 0) not between 1 and 50
    or coalesce(p_lease_seconds, 0) not between 30 and 300
  then raise exception 'parametros de lease de artefacto invalidos' using errcode = '22023'; end if;

  return query
  with candidates as (
    select o.id
    from public.fiscal_artifact_outbox o
    where (o.state in ('pending','retry_wait') and o.next_attempt_at <= now())
       or (o.state = 'leased' and o.lease_deadline < now())
    order by o.next_attempt_at, o.created_at
    for update skip locked
    limit p_limit
  ), claimed as (
    update public.fiscal_artifact_outbox o
      set state = 'leased', lease_owner = p_worker_id, lease_epoch = o.lease_epoch + 1,
          lease_deadline = now() + make_interval(secs => p_lease_seconds),
          attempt_count = o.attempt_count + 1
    from candidates c
    where o.id = c.id
    returning o.*
  ), documented as (
    update public.fiscal_documents d
      set artifact_state = 'artifact_generating', artifact_error_code = null,
          artifact_error_message = null, artifact_updated_at = now()
    from claimed c
    where d.id = c.fiscal_document_id
    returning d.id
  )
  select c.* from claimed c;
end;
$claim_fiscal_artifact_outbox$;

drop function if exists public.complete_fiscal_artifact(uuid, text, jsonb);
drop function if exists public.complete_fiscal_artifact_unchecked(uuid, text, jsonb);

create function public.complete_fiscal_artifact(
  p_artifact_outbox_id uuid,
  p_worker_id text,
  p_lease_epoch bigint,
  p_artifact jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, extensions, pg_temp
as $complete_fiscal_artifact$
declare
  v_outbox public.fiscal_artifact_outbox%rowtype;
  v_document public.fiscal_documents%rowtype;
  v_artifact public.fiscal_document_artifacts%rowtype;
  v_supersedes uuid;
  v_expected_path text;
  v_sha256 text;
  v_size bigint;
begin
  if not (coalesce(p_artifact, '{}'::jsonb) ?& array[
    'artifact_type','storage_provider','storage_path','mime_type','size_bytes',
    'sha256','generated_at','generated_by','generation_version'
  ]) then
    raise exception 'metadata de artefacto incompleta' using errcode = '22023';
  end if;
  if coalesce(p_artifact,'{}'::jsonb) - array['artifact_type','storage_provider','storage_path','mime_type','size_bytes','sha256','generated_at','generated_by','generation_version'] <> '{}'::jsonb then
    raise exception 'metadata de artefacto no permitida' using errcode = '22023';
  end if;
  select o.* into v_outbox from public.fiscal_artifact_outbox o where o.id = p_artifact_outbox_id for update;
  if not found or p_lease_epoch is null or v_outbox.state <> 'leased' or v_outbox.lease_owner is distinct from p_worker_id
     or v_outbox.lease_epoch is distinct from p_lease_epoch or v_outbox.lease_deadline <= now() then
    raise exception 'lease de artefacto invalido' using errcode = '40001';
  end if;
  select d.* into v_document from public.fiscal_documents d where d.id = v_outbox.fiscal_document_id for share;
  if v_document.state not in ('authorized','credited') or v_document.cae !~ '^[0-9]{14}$' or v_document.document_number is null then
    raise exception 'el comprobante no esta autorizado para generar PDF' using errcode = 'P0001';
  end if;
  v_expected_path := public.fiscal_artifact_storage_path(v_document.business_id, v_document.id, v_outbox.generation_token);
  v_sha256 := lower(coalesce(p_artifact->>'sha256',''));
  v_size := coalesce((p_artifact->>'size_bytes')::bigint, 0);
  if p_artifact->>'artifact_type' <> 'authorized_pdf'
    or p_artifact->>'storage_provider' <> 'supabase_storage'
    or p_artifact->>'storage_path' <> v_expected_path
    or p_artifact->>'mime_type' <> 'application/pdf'
    or v_sha256 !~ '^[0-9a-f]{64}$'
    or v_size not between 1 and 16777216
    or char_length(coalesce(p_artifact->>'generation_version','')) not between 1 and 80
    or char_length(coalesce(p_artifact->>'generated_by','')) not between 3 and 80
  then raise exception 'metadata de artefacto invalida' using errcode = '22023'; end if;

  select a.* into v_artifact from public.fiscal_document_artifacts a where a.generation_token = v_outbox.generation_token for update;
  if found then
    update public.fiscal_artifact_outbox set state = 'completed', processed_at = now(), lease_owner = null, lease_deadline = null where id = v_outbox.id;
    update public.fiscal_documents set artifact_state = 'artifact_ready', artifact_error_code = null, artifact_error_message = null, artifact_updated_at = now() where id = v_document.id;
    return jsonb_build_object('artifact_id', v_artifact.id, 'idempotent_replay', true);
  end if;

  select a.id into v_supersedes
  from public.fiscal_document_artifacts a
  where a.fiscal_document_id = v_document.id and a.artifact_type = 'authorized_pdf' and a.is_current
  for update;

  update public.fiscal_document_artifacts
    set is_current = false, state = 'artifact_superseded', superseded_at = now()
    where id = v_supersedes;

  insert into public.fiscal_document_artifacts(
    business_id, fiscal_document_id, artifact_type, state, storage_provider, storage_path,
    mime_type, size_bytes, sha256, document_number, generated_at, generated_by,
    generation_version, generation_token, is_current, supersedes_artifact_id
  ) values (
    v_document.business_id, v_document.id, 'authorized_pdf', 'artifact_ready', 'supabase_storage', v_expected_path,
    'application/pdf', v_size, v_sha256, v_document.document_number,
    coalesce((p_artifact->>'generated_at')::timestamptz, now()), p_artifact->>'generated_by',
    p_artifact->>'generation_version', v_outbox.generation_token, true, v_supersedes
  ) returning * into v_artifact;

  update public.fiscal_artifact_outbox
    set state = 'completed', processed_at = now(), lease_owner = null, lease_deadline = null,
        last_error_code = null, last_error_message = null
    where id = v_outbox.id;
  update public.fiscal_documents
    set artifact_state = 'artifact_ready', artifact_error_code = null, artifact_error_message = null, artifact_updated_at = now()
    where id = v_document.id;
  insert into public.fiscal_events(fiscal_document_id, event_type, actor_type, sanitized_detail)
  values (v_document.id, 'artifact_ready', 'worker', jsonb_build_object(
    'artifact_id', v_artifact.id, 'sha256', v_sha256, 'size_bytes', v_size,
    'generation_version', v_artifact.generation_version, 'supersedes_artifact_id', v_supersedes
  ));
  return jsonb_build_object('artifact_id', v_artifact.id, 'idempotent_replay', false);
end;
$complete_fiscal_artifact$;

-- Un fallo reintentable deja el PDF pendiente (lo que ya informaba la respuesta); solo el definitivo lo deja fallido.
drop function if exists public.fail_fiscal_artifact(uuid, text, text, text, boolean);

create function public.fail_fiscal_artifact(
  p_artifact_outbox_id uuid,
  p_worker_id text,
  p_lease_epoch bigint,
  p_error_code text,
  p_error_message text,
  p_retryable boolean default true
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, extensions, pg_temp
as $fail_fiscal_artifact$
declare
  v_outbox public.fiscal_artifact_outbox%rowtype;
  v_dead_letter boolean;
begin
  if coalesce(p_error_code,'') !~ '^[A-Z0-9_]{3,80}$' then raise exception 'codigo de artefacto invalido' using errcode = '22023'; end if;
  select o.* into v_outbox from public.fiscal_artifact_outbox o where o.id = p_artifact_outbox_id for update;
  if not found or p_lease_epoch is null or v_outbox.state <> 'leased' or v_outbox.lease_owner is distinct from p_worker_id
     or v_outbox.lease_epoch is distinct from p_lease_epoch then
    raise exception 'lease de artefacto invalido' using errcode = '40001';
  end if;
  v_dead_letter := not coalesce(p_retryable, true) or v_outbox.attempt_count >= 8;
  update public.fiscal_artifact_outbox
    set state = case when v_dead_letter then 'dead_letter' else 'retry_wait' end,
        processed_at = case when v_dead_letter then now() else null end,
        next_attempt_at = case when v_dead_letter then next_attempt_at else now() + least(interval '30 minutes', make_interval(secs => 30 * (2 ^ least(attempt_count, 6)))) end,
        lease_owner = null, lease_deadline = null,
        last_error_code = p_error_code, last_error_message = left(coalesce(p_error_message,''), 300)
    where id = v_outbox.id;
  update public.fiscal_documents
    set artifact_state = case when v_dead_letter then 'artifact_failed' else 'artifact_pending' end, artifact_error_code = p_error_code,
        artifact_error_message = left(coalesce(p_error_message,''), 300), artifact_updated_at = now()
    where id = v_outbox.fiscal_document_id;
  insert into public.fiscal_events(fiscal_document_id, event_type, actor_type, sanitized_detail)
  values (v_outbox.fiscal_document_id, 'artifact_failed', 'worker', jsonb_build_object('error_code', p_error_code, 'retryable', not v_dead_letter, 'lease_epoch', p_lease_epoch));
  return jsonb_build_object('fiscal_document_id', v_outbox.fiscal_document_id, 'state', case when v_dead_letter then 'artifact_failed' else 'artifact_pending' end);
end;
$fail_fiscal_artifact$;

revoke all on function public.claim_fiscal_artifact_outbox(text, integer, integer),
  public.complete_fiscal_artifact(uuid, text, bigint, jsonb),
  public.fail_fiscal_artifact(uuid, text, bigint, text, text, boolean)
from public, anon, authenticated;
grant execute on function public.claim_fiscal_artifact_outbox(text, integer, integer),
  public.complete_fiscal_artifact(uuid, text, bigint, jsonb),
  public.fail_fiscal_artifact(uuid, text, bigint, text, text, boolean)
to service_role;
create or replace function private.print_job_transition_allowed(p_from text, p_to text)
returns boolean
language sql
immutable
set search_path = pg_catalog, pg_temp
as $print_job_transition_allowed$
  select (p_from, p_to) in (
    ('queued', 'claimed'), ('queued', 'cancelled'),
    ('claimed', 'printing'), ('claimed', 'queued'), ('claimed', 'failed'), ('claimed', 'needs_review'),
    ('printing', 'printed'), ('printing', 'queued'), ('printing', 'failed'), ('printing', 'needs_review'),
    ('needs_review', 'printed'), ('needs_review', 'failed')
  );
$print_job_transition_allowed$;

create or replace function private.print_jobs_guard_status()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $print_jobs_guard_status$
begin
  if tg_op = 'INSERT' then
    if new.status is distinct from 'queued' then
      raise exception 'un trabajo de impresion nace en queued (recibido: %)', new.status using errcode = 'TF004';
    end if;
    return new;
  end if;
  if new.status is distinct from old.status and not private.print_job_transition_allowed(old.status, new.status) then
    raise exception 'transicion de impresion invalida: % -> %', old.status, new.status using errcode = 'TF004';
  end if;
  return new;
end;
$print_jobs_guard_status$;

drop trigger if exists print_jobs_guard_status on public.print_jobs;
create trigger print_jobs_guard_status
  before insert or update of status on public.print_jobs
  for each row execute function private.print_jobs_guard_status();

revoke all on function private.fiscal_state_transition_allowed(text, text),
  private.fiscal_document_under_construction(public.fiscal_documents),
  private.fiscal_documents_guard_state(),
  private.print_job_transition_allowed(text, text),
  private.print_jobs_guard_status()
from public, anon, authenticated;
