-- Guardas incrementales para instalaciones que ya aplicaron el cierre documental inicial.

alter function public.request_credit_note(uuid,text,text,jsonb,text)
  rename to request_credit_note_unchecked;

create function public.request_credit_note(
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
  return public.request_credit_note_unchecked(
    p_original_document_id, p_reason, p_credit_kind, p_lines, p_idempotency_key
  );
end;
$request_credit_note_guard$;

alter function public.complete_fiscal_artifact(uuid,text,jsonb)
  rename to complete_fiscal_artifact_unchecked;

create function public.complete_fiscal_artifact(
  p_artifact_outbox_id uuid,
  p_worker_id text,
  p_artifact jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, extensions, pg_temp
as $complete_fiscal_artifact_guard$
begin
  if not (coalesce(p_artifact, '{}'::jsonb) ?& array[
    'artifact_type','storage_provider','storage_path','mime_type','size_bytes',
    'sha256','generated_at','generated_by','generation_version'
  ]) then
    raise exception 'metadata de artefacto incompleta' using errcode = '22023';
  end if;
  return public.complete_fiscal_artifact_unchecked(p_artifact_outbox_id, p_worker_id, p_artifact);
end;
$complete_fiscal_artifact_guard$;

revoke all on function public.request_credit_note_unchecked(uuid,text,text,jsonb,text),
  public.complete_fiscal_artifact_unchecked(uuid,text,jsonb)
from public, anon, authenticated, service_role;

revoke all on function public.request_credit_note(uuid,text,text,jsonb,text),
  public.complete_fiscal_artifact(uuid,text,jsonb)
from public, anon, authenticated;

grant execute on function public.request_credit_note(uuid,text,text,jsonb,text) to authenticated;
grant execute on function public.complete_fiscal_artifact(uuid,text,jsonb) to service_role;

comment on function public.request_credit_note(uuid,text,text,jsonb,text) is
  'Valida lineas JSON antes de invocar el flujo idempotente de notas de credito.';
comment on function public.complete_fiscal_artifact(uuid,text,jsonb) is
  'Exige metadata documental completa antes de persistir un artefacto privado.';
