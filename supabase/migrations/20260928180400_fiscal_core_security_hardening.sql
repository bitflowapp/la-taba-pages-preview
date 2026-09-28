-- ============================================================================
--  ADOPCION DEL CORE FISCAL · autorizacion antes del lock y sin oraculo de existencia
-- ============================================================================
--
--  Fuente canonica: bitflowapp/taba-fiscal@26d2f4cb9e379789b52e4a85e88f39910b0e852f (PR #1)
--    database/migrations/20260926220000_fiscal_security_hardening.sql
--  Los cuerpos de funcion, checks y backfills se copian textuales de la fuente
--  (ver docs/TABA-FISCAL-CORE-ADOPTION.md): La Taba ejecuta el mismo contrato.
--  No se reaplica ninguna migracion historica: esto es el DELTA desde
--  20260926160000_local_print_agent.sql (cabeza de La Taba) al contrato del core.
--  Excepcion de La Taba (ademas de quitar 'viewer', ver abajo): los conflictos
--  se elevan con PT409, no con 40001. PostgREST toma 40001 como falla de
--  serializacion y reintenta la transaccion hasta el 504 del gateway (~125 s, medido
--  en Staging); 20260924200000_revision_conflicts_answer_409 lo prohibio en La Taba.
--
--  Efectos:
--    · request_fiscal_artifact_regeneration, authorize_fiscal_artifact_access, request_credit_note, request_fiscal_print_job y
--    · update_fiscal_print_job autorizan en el mismo WHERE que toma el lock: "no existe" y "no es tuyo" son el mismo 42501;
--    · la regeneracion del PDF bloquea en el mismo orden que el worker de PDF (sin deadlock);
--    · grants explicitos por funcion (nunca en bloque).
--
--  No se adopta (sin efecto en La Taba o reemplazado mas adelante):
--    · las 8 policies de lectura con el rol 'viewer': La Taba no tiene ese rol (business_members_role_check: owner|admin|staff|rider)
--    ·   y ya limita las lecturas fiscales a owner|admin|staff (20260814050000); reescribirlas no cambia nada. Por la misma razon,
--    ·   list_fiscal_document_artifacts y authorize_fiscal_artifact_access se adoptan SIN 'viewer'.
--    · revocar EXECUTE de anon: La Taba ya lo hizo en 20260816122000; se repite igual (idempotente).
--
-- ============================================================================
--
--  ---- Encabezado original en taba-fiscal (220000); sus rutas son de ese repositorio ----
-- TABA FISCAL - MENOR PRIVILEGIO Y AISLAMIENTO ENTRE NEGOCIOS
--
-- Auditoria sobre la cadena completa de migraciones; la prueba es
-- tests/database/fiscal_isolation_test.sql.
--
-- 1. Ocho funciones SECURITY DEFINER eran ejecutables por anon: las default
--    privileges de Supabase dan EXECUTE a PUBLIC, anon y authenticated, y sus
--    migraciones nunca lo revocaron. Cinco son RPC del panel
--    (authorize_arca_homologation, authorize_fiscal_artifact_access,
--    list_fiscal_document_artifacts, request_fiscal_artifact_regeneration,
--    update_fiscal_print_job): verificaban el rol, pero anon no tiene por que
--    llegar al cuerpo. Las otras son funciones de trigger: no se invocan fuera
--    de un trigger y PostgreSQL no verifica EXECUTE al disparar, asi que
--    revocarlo no cambia ningun trigger (lo cubre la misma suite).
-- 2. notification_outbox (cola de avisos de pedidos) no tenia RLS y daba ALL a
--    anon y authenticated. No es fiscal: la extraccion la arrastro desde una
--    migracion mixta de La Taba. Se endurece aparte, en
--    20260926221000_commercial_notification_outbox_hardening.sql, para que La
--    Taba pueda adoptarla (ver docs/SOURCE-PROVENANCE.md §7).
-- 3. Toda lectura fiscal usaba is_business_member: cualquier miembro, tambien
--    el repartidor, leia comprobantes (con el CUIT/DNI del cliente), perfiles
--    fiscales y descargaba PDFs. Pasa a una lista explicita del back office:
--    owner, admin, staff (cajero) y viewer (solo lectura). Un rol nuevo de La
--    Taba no gana acceso fiscal hasta que se lo agregue aca.
-- 4. request_fiscal_artifact_regeneration, authorize_fiscal_artifact_access y
--    request_credit_note respondian P0002 a un id inexistente y 42501 a uno de
--    otro negocio: un oraculo de existencia entre negocios. Ahora "no existe" y
--    "no es tuyo" son el mismo 42501, y el rol se verifica en el mismo WHERE que
--    toma el lock: un usuario de B ya no bloquea, ni por un instante, una fila
--    de A (antes el FOR UPDATE/FOR SHARE corria antes del chequeo).
--
-- 5. Revision adversarial: la regeneracion del PDF bloquea en el mismo orden
--    que el worker de PDF (S7) y ninguna validacion deja pasar un NULL.
--
-- No se renombra nada ni se tocan funciones de La Taba (is_business_member,
-- has_business_role): solo grants, policies y el orden de la autorizacion.

-- == 1. Lecturas directas: lista explicita del back office ===================

-- == 2. RPC: autorizar antes de tocar la fila, un solo error =================
create or replace function public.request_fiscal_artifact_regeneration(p_fiscal_document_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, extensions, pg_temp
as $request_fiscal_artifact_regeneration$
declare
  v_document public.fiscal_documents%rowtype;
  v_outbox public.fiscal_artifact_outbox%rowtype;
  v_has_outbox boolean;
begin
  -- Se autoriza sin tomar locks: "no existe" y "no es tuyo" son el mismo 42501 y nadie bloquea filas ajenas.
  perform 1 from public.fiscal_documents d
   where d.id = p_fiscal_document_id and public.has_business_role(d.business_id, array['owner', 'admin']);
  if not found then raise exception 'comprobante fiscal inexistente o sin permiso (owner/admin)' using errcode = '42501'; end if;
  -- Mismo orden de locks que el worker de PDF (outbox -> comprobante): antes, comprobante -> outbox
  -- contra un fail/complete del worker terminaba en deadlock (revision adversarial, S7).
  select o.* into v_outbox from public.fiscal_artifact_outbox o where o.fiscal_document_id = p_fiscal_document_id for update;
  v_has_outbox := found;
  select d.* into v_document from public.fiscal_documents d where d.id = p_fiscal_document_id for update;
  if v_document.state not in ('authorized','credited') then raise exception 'solo se regenera un comprobante autorizado' using errcode = 'P0001'; end if;
  if v_has_outbox and v_outbox.state = 'leased' and v_outbox.lease_deadline > now() then raise exception 'ya existe una generacion en curso' using errcode = 'PT409'; end if;
  if v_has_outbox then
    update public.fiscal_artifact_outbox
      set state = 'pending', generation_token = gen_random_uuid(), lease_owner = null, lease_deadline = null,
          next_attempt_at = now(), last_error_code = null, last_error_message = null, processed_at = null
      where id = v_outbox.id;
  else
    -- Sin fila que bloquear: si otra regeneracion la creo recien, ya hay una generacion pendiente.
    insert into public.fiscal_artifact_outbox(fiscal_document_id) values (v_document.id)
    on conflict (fiscal_document_id) do nothing;
  end if;
  update public.fiscal_documents
    set artifact_state = 'artifact_pending', artifact_error_code = null, artifact_error_message = null, artifact_updated_at = now()
    where id = v_document.id;
  insert into public.fiscal_events(fiscal_document_id, event_type, actor_type, actor_id, sanitized_detail)
  values(v_document.id, 'artifact_regeneration_requested', 'operator', auth.uid(), jsonb_build_object('authorized', true));
  return jsonb_build_object('fiscal_document_id', v_document.id, 'artifact_state', 'artifact_pending');
end;
$request_fiscal_artifact_regeneration$;

create or replace function public.list_fiscal_document_artifacts(p_business_id uuid)
returns table(
  fiscal_document_id uuid,
  artifact_id uuid,
  artifact_type text,
  artifact_state text,
  mime_type text,
  size_bytes bigint,
  sha256 text,
  document_number bigint,
  generated_at timestamptz,
  generation_version text,
  is_current boolean
)
language plpgsql
security definer
set search_path = pg_catalog, public, extensions, pg_temp
as $list_fiscal_document_artifacts$
begin
  if not public.has_business_role(p_business_id, array['owner', 'admin', 'staff']) then
    raise exception 'operador no autorizado' using errcode = '42501';
  end if;
  return query
  select a.fiscal_document_id, a.id, a.artifact_type, d.artifact_state, a.mime_type, a.size_bytes,
         a.sha256, a.document_number, a.generated_at, a.generation_version, a.is_current
  from public.fiscal_document_artifacts a
  join public.fiscal_documents d on d.id = a.fiscal_document_id
  where a.business_id = p_business_id and a.is_current
  order by a.generated_at desc;
end;
$list_fiscal_document_artifacts$;

create or replace function public.authorize_fiscal_artifact_access(
  p_artifact_id uuid,
  p_action text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, extensions, pg_temp
as $authorize_fiscal_artifact_access$
declare
  v_artifact public.fiscal_document_artifacts%rowtype;
begin
  if coalesce(p_action,'') not in ('preview','download','print') then raise exception 'accion de artefacto invalida' using errcode = '22023'; end if;
  select a.* into v_artifact from public.fiscal_document_artifacts a
   where a.id = p_artifact_id and public.has_business_role(a.business_id, array['owner', 'admin', 'staff']);
  if not found then raise exception 'artefacto fiscal inexistente o sin permiso' using errcode = '42501'; end if;
  -- Recien aca, y solo para el propio negocio, se distingue "no esta listo".
  if not v_artifact.is_current or v_artifact.state <> 'artifact_ready' then
    raise exception 'artefacto fiscal no disponible' using errcode = 'P0002';
  end if;
  insert into public.fiscal_events(fiscal_document_id, event_type, actor_type, actor_id, sanitized_detail)
  values(v_artifact.fiscal_document_id, concat('artifact_', p_action, '_authorized'), 'operator', auth.uid(), jsonb_build_object('artifact_id', v_artifact.id));
  return jsonb_build_object(
    'artifact_id', v_artifact.id,
    'mime_type', v_artifact.mime_type,
    'sha256', v_artifact.sha256,
    'expires_in_seconds', 60
  );
end;
$authorize_fiscal_artifact_access$;

create or replace function public.request_fiscal_print_job(
  p_fiscal_document_id uuid,
  p_artifact_id uuid,
  p_printer_name_hash text,
  p_format text,
  p_copies integer,
  p_idempotency_key text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, extensions, pg_temp
as $request_fiscal_print_job$
declare
  v_document public.fiscal_documents%rowtype;
  v_artifact public.fiscal_document_artifacts%rowtype;
  v_job public.fiscal_print_jobs%rowtype;
begin
  if coalesce(p_printer_name_hash,'') !~ '^[0-9a-f]{64}$'
    or coalesce(p_format,'') not in ('a4','thermal')
    or coalesce(p_copies, 0) not between 1 and 5
    or coalesce(p_idempotency_key,'') !~ '^[A-Za-z0-9:_-]{8,128}$'
  then raise exception 'solicitud de impresion invalida' using errcode = '22023'; end if;
  select d.* into v_document from public.fiscal_documents d
   where d.id = p_fiscal_document_id and public.has_business_role(d.business_id, array['owner', 'admin', 'staff'])
   for share;
  if not found then raise exception 'operador no autorizado' using errcode = '42501'; end if;
  perform pg_advisory_xact_lock(hashtextextended('taba-fiscal:print-key:' || v_document.business_id::text || ':' || p_idempotency_key, 0));
  select j.* into v_job from public.fiscal_print_jobs j where j.business_id = v_document.business_id and j.idempotency_key = p_idempotency_key;
  if found then
    -- Misma clave: misma reimpresion o conflicto explicito, nunca otra en silencio.
    if v_job.fiscal_document_id <> v_document.id or v_job.artifact_id <> p_artifact_id or v_job.printer_name_hash <> p_printer_name_hash
       or v_job.format <> p_format or v_job.copies <> p_copies then
      raise exception 'idempotency_key reutilizada con otra solicitud' using errcode = '23505', hint = 'IDEMPOTENCY_KEY_REUSED';
    end if;
    return jsonb_build_object('print_job_id', v_job.id, 'status', v_job.status, 'idempotent_replay', true);
  end if;
  select a.* into v_artifact from public.fiscal_document_artifacts a
    where a.id = p_artifact_id and a.fiscal_document_id = v_document.id and a.is_current and a.state = 'artifact_ready'
    for share;
  if not found then raise exception 'PDF fiscal no disponible para impresion' using errcode = 'P0001'; end if;
  insert into public.fiscal_print_jobs(business_id, fiscal_document_id, artifact_id, printer_name_hash, format, copies, requested_by, idempotency_key)
  values(v_document.business_id, v_document.id, v_artifact.id, p_printer_name_hash, p_format, p_copies, auth.uid(), p_idempotency_key)
  returning * into v_job;
  insert into public.fiscal_events(fiscal_document_id, event_type, actor_type, actor_id, sanitized_detail)
  values(v_document.id, 'print_queued', 'operator', auth.uid(), jsonb_build_object('print_job_id', v_job.id, 'artifact_id', v_artifact.id, 'format', p_format, 'copies', p_copies));
  return jsonb_build_object('print_job_id', v_job.id, 'status', v_job.status, 'idempotent_replay', false);
end;
$request_fiscal_print_job$;

create or replace function public.update_fiscal_print_job(
  p_print_job_id uuid,
  p_status text,
  p_error_code text default null
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, extensions, pg_temp
as $update_fiscal_print_job$
declare
  v_job public.fiscal_print_jobs%rowtype;
begin
  if coalesce(p_status,'') not in ('queued','sent_to_spooler','completed_when_verifiable','failed','unknown')
    or (p_error_code is not null and p_error_code !~ '^[A-Z0-9_]{3,80}$')
  then raise exception 'estado de impresion invalido' using errcode = '22023'; end if;
  select j.* into v_job from public.fiscal_print_jobs j
   where j.id = p_print_job_id and public.has_business_role(j.business_id, array['owner', 'admin', 'staff'])
   for update;
  if not found then raise exception 'operador no autorizado' using errcode = '42501'; end if;
  if v_job.status = 'completed_when_verifiable' then return jsonb_build_object('print_job_id', v_job.id, 'status', v_job.status, 'idempotent_replay', true); end if;
  update public.fiscal_print_jobs
    set status = p_status,
        error_code = case when p_status = 'failed' then p_error_code else null end,
        completed_at = case when p_status = 'completed_when_verifiable' then now() else null end
    where id = v_job.id
    returning * into v_job;
  insert into public.fiscal_events(fiscal_document_id, event_type, actor_type, actor_id, sanitized_detail)
  values(v_job.fiscal_document_id, concat('print_', p_status), 'operator', auth.uid(), jsonb_build_object('print_job_id', v_job.id, 'error_code', case when p_status = 'failed' then p_error_code else null end));
  return jsonb_build_object('print_job_id', v_job.id, 'status', v_job.status, 'idempotent_replay', false);
end;
$update_fiscal_print_job$;

-- request_credit_note_unchecked (no ejecutable por ningun rol) sigue siendo el
-- flujo completo; la guarda publica autoriza antes de que tome el lock.
create or replace function public.request_credit_note(
  p_original_document_id uuid,
  p_reason text,
  p_credit_kind text,
  p_lines jsonb,
  p_idempotency_key text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, extensions, pg_temp
as $request_credit_note_guard$
begin
  if p_lines is null or jsonb_typeof(p_lines) <> 'array' then
    raise exception 'lineas de nota invalidas' using errcode = '22023';
  end if;
  if not exists (
    select 1 from public.fiscal_documents d
     where d.id = p_original_document_id and public.has_business_role(d.business_id, array['owner', 'admin'])
  ) then
    raise exception 'comprobante original inexistente o sin permiso (owner/admin)' using errcode = '42501';
  end if;
  return public.request_credit_note_unchecked(
    p_original_document_id, p_reason, p_credit_kind, p_lines, p_idempotency_key
  );
end;
$request_credit_note_guard$;

-- == 3. Grants explicitos (nunca en bloque) ==================================
revoke all on function
  public.authorize_arca_homologation(uuid, text),
  public.authorize_fiscal_artifact_access(uuid, text),
  public.list_fiscal_document_artifacts(uuid),
  public.request_fiscal_artifact_regeneration(uuid),
  public.update_fiscal_print_job(uuid, text, text),
  public.request_fiscal_print_job(uuid, uuid, text, text, integer, text),
  public.request_credit_note(uuid, text, text, jsonb, text)
from public, anon;
grant execute on function
  public.authorize_arca_homologation(uuid, text),
  public.authorize_fiscal_artifact_access(uuid, text),
  public.list_fiscal_document_artifacts(uuid),
  public.request_fiscal_artifact_regeneration(uuid),
  public.update_fiscal_print_job(uuid, text, text),
  public.request_fiscal_print_job(uuid, uuid, text, text, integer, text),
  public.request_credit_note(uuid, text, text, jsonb, text)
to authenticated;

revoke all on function
  public.assert_fiscal_execution_authorized(),
  public.enqueue_authorized_fiscal_artifact(),
  public.protect_authorized_fiscal_document(),
  public.protect_authorized_fiscal_document_item()
from public, anon, authenticated;
