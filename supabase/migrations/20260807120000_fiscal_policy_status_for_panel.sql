-- Lo que el Panel necesita para dejar de mentir sobre la facturación.
--
-- get_arca_activation_status ya informa certificado, delegación y conexión, pero
-- no sabía nada de la política contable ni de las tablas oficiales, que son
-- justo las dos cosas sin las cuales no se emite nada. En vez de reescribir esa
-- función entera, se agrega una vecina con lo que faltaba y el Panel las une.

create or replace function public.get_fiscal_policy_status(p_business_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public, extensions, pg_temp
as $get_fiscal_policy_status$
declare
  v_profile public.fiscal_profiles%rowtype;
  v_policy public.fiscal_accounting_policies%rowtype;
  v_environment text;
  v_parameters_ok boolean := false;
  v_missing text[] := array[]::text[];
  v_type text;
begin
  if not public.has_business_role(p_business_id, array['owner','admin','staff']) then
    raise exception 'operador no autorizado' using errcode = '42501';
  end if;
  select fp.* into v_profile from public.fiscal_profiles fp where fp.business_id = p_business_id;
  v_environment := coalesce(v_profile.environment, 'disabled');

  -- Una tabla oficial vieja no sirve: resolve_active_fiscal_policy exige que el
  -- snapshot tenga menos de siete días, así que el Panel mide lo mismo.
  if v_environment in ('homologation','production') then
    foreach v_type in array array['document_types','recipient_document_types','vat_types','currencies','concepts','points_of_sale','vat_receptor_conditions']
    loop
      if not exists (
        select 1 from public.fiscal_parameter_snapshots s
        where s.environment = v_environment and s.parameter_type = v_type
          and s.synchronized_at >= now() - interval '7 days'
      ) then
        v_missing := v_missing || v_type;
      end if;
    end loop;
    v_parameters_ok := array_length(v_missing, 1) is null;
  end if;

  select p.* into v_policy
  from public.fiscal_accounting_policies p
  where p.business_id = p_business_id
    and p.environment = v_environment
    and p.enabled and p.accountant_review_status = 'approved' and p.revoked_at is null
    and p.valid_from <= current_date
  order by p.valid_from desc, p.created_at desc
  limit 1;

  return jsonb_build_object(
    'accounting_policy_ready', found and v_parameters_ok,
    'accounting_policy_version', v_policy.policy_version,
    'accounting_policy_sources', coalesce(v_policy.authorized_sources, array[]::text[]),
    'accounting_policy_declared', exists (
      select 1 from public.fiscal_accounting_policies p
      where p.business_id = p_business_id and p.environment = v_environment and p.revoked_at is null
    ),
    'fiscal_parameters_synchronized', v_parameters_ok,
    'fiscal_parameters_missing', to_jsonb(v_missing),
    'intents_requiring_attention', (
      select count(*) from public.fiscal_emission_intents i
      where i.business_id = p_business_id and i.state = 'manual_review'
    ),
    'intents_waiting', (
      select count(*) from public.fiscal_emission_intents i
      where i.business_id = p_business_id and i.state in ('pending','processing')
    ),
    'documents_requiring_attention', (
      select count(*) from public.fiscal_documents d
      where d.business_id = p_business_id and d.state in ('failed','manual_review')
    )
  );
end;
$get_fiscal_policy_status$;

comment on function public.get_fiscal_policy_status(uuid) is
  'Estado de la política contable y de las tablas oficiales para el Panel. Sólo hechos verificables; ningún secreto.';

revoke all on function public.get_fiscal_policy_status(uuid) from public, anon;
grant execute on function public.get_fiscal_policy_status(uuid) to authenticated;
