-- Facturación automática: una sola puerta, y sólo se abre si todo está listo.
--
-- Antes, prender la automatización era guardar un formulario:
-- configure_fiscal_profile aceptaba invoice_policy='on_payment_confirmed' e
-- is_enabled=true sin mirar nada más, y el disparador de pedidos se conformaba
-- con esos dos campos. Con el certificado sin cargar, la política contable sin
-- aprobar o las tablas oficiales vencidas, cada pedido pagado encolaba una
-- intención que no podía terminar en ningún lado: se acumulaban en
-- manual_review y el operador se enteraba tarde y de a montones.
--
-- Ahora hay un solo predicado de alistamiento —fiscal_automation_is_ready— y
-- una sola función que enciende la automatización, que lo exige. El disparador
-- vuelve a verificarlo en cada pedido, así que una marca vieja no alcanza para
-- generar basura. Y tocar un dato fiscal apaga la automatización: la
-- verificación que la justificaba dejó de ser cierta.

alter table public.fiscal_profiles
  add column if not exists automation_activated_at timestamptz,
  add column if not exists automation_activated_by uuid references auth.users(id) on delete restrict,
  add column if not exists automation_suspended_at timestamptz,
  add column if not exists automation_suspended_reason text;

alter table public.fiscal_profile_events drop constraint if exists fiscal_profile_events_event_type_check;
alter table public.fiscal_profile_events add constraint fiscal_profile_events_event_type_check
  check (event_type in ('homologation_authorized','accountant_review_recorded',
                        'accounting_policy_proposed','accounting_policy_approved','accounting_policy_revoked',
                        'automation_activated','automation_deactivated','automation_suspended'));

-- ===== 1. El predicado: una sola definición de "listo para facturar solo" =====

create or replace function public.fiscal_automation_blockers(p_business_id uuid)
returns text[]
language plpgsql
stable
security definer
set search_path = pg_catalog, public, pg_temp
as $fiscal_automation_blockers$
declare
  v_profile public.fiscal_profiles%rowtype;
  v_blockers text[] := array[]::text[];
  v_environment text;
  v_type text;
  v_policy_ok boolean := false;
begin
  select fp.* into v_profile from public.fiscal_profiles fp where fp.business_id = p_business_id;
  if not found then return array['PROFILE_MISSING']; end if;
  v_environment := coalesce(v_profile.environment, 'disabled');

  if v_environment = 'disabled' then v_blockers := v_blockers || 'ENVIRONMENT_DISABLED'::text; end if;
  if not v_profile.is_enabled then v_blockers := v_blockers || 'PROFILE_NOT_ENABLED'::text; end if;

  -- Datos del negocio.
  if coalesce(btrim(v_profile.legal_name), '') = '' then v_blockers := v_blockers || 'LEGAL_NAME_MISSING'::text; end if;
  if not public.fiscal_cuit_is_valid(v_profile.cuit) then v_blockers := v_blockers || 'CUIT_INVALID'::text; end if;
  if coalesce(btrim(v_profile.business_address), '') = '' then v_blockers := v_blockers || 'ADDRESS_MISSING'::text; end if;

  -- Situación fiscal.
  if coalesce(btrim(v_profile.tax_condition), '') = '' then v_blockers := v_blockers || 'TAX_CONDITION_MISSING'::text; end if;
  if coalesce(btrim(v_profile.default_recipient_condition), '') = '' then v_blockers := v_blockers || 'RECIPIENT_CONDITION_MISSING'::text; end if;
  if coalesce(v_profile.default_concept, 0) not in (1,2,3) then v_blockers := v_blockers || 'CONCEPT_MISSING'::text; end if;
  if coalesce(v_profile.accountant_review_status, 'pending') <> 'approved' then v_blockers := v_blockers || 'ACCOUNTANT_REVIEW_PENDING'::text; end if;

  -- Punto de venta.
  if coalesce(v_profile.point_of_sale, 0) not between 1 and 99999 then v_blockers := v_blockers || 'POINT_OF_SALE_MISSING'::text; end if;

  -- Certificado: cargado, del CUIT del negocio y sin vencer.
  if v_profile.certificate_fingerprint_sha256 is null then
    v_blockers := v_blockers || 'CERTIFICATE_MISSING'::text;
  else
    if v_profile.certificate_expires_at is not null and v_profile.certificate_expires_at <= clock_timestamp() then
      v_blockers := v_blockers || 'CERTIFICATE_EXPIRED'::text;
    end if;
    if v_profile.certificate_subject_cuit is not null and v_profile.cuit is not null
       and v_profile.certificate_subject_cuit <> v_profile.cuit then
      v_blockers := v_blockers || 'CERTIFICATE_CUIT_MISMATCH'::text;
    end if;
  end if;
  if coalesce(v_profile.delegation_status, 'pending') <> 'verified' then v_blockers := v_blockers || 'DELEGATION_PENDING'::text; end if;

  -- Verificación: el puente habló con ARCA y el ambiente está autorizado.
  if v_profile.connection_ok_at is null then v_blockers := v_blockers || 'CONNECTION_NOT_VERIFIED'::text; end if;
  if v_environment = 'homologation' and v_profile.homologation_authorized_at is null then
    v_blockers := v_blockers || 'HOMOLOGATION_NOT_AUTHORIZED'::text;
  end if;
  if v_environment = 'production' and coalesce(v_profile.production_gate_status, 'blocked') <> 'approved' then
    v_blockers := v_blockers || 'PRODUCTION_GATE_BLOCKED'::text;
  end if;

  -- Reglas: política contable aprobada y tablas oficiales frescas.
  if v_environment in ('homologation','production') then
    foreach v_type in array array['document_types','recipient_document_types','vat_types','currencies','concepts','points_of_sale','vat_receptor_conditions']
    loop
      if not exists (
        select 1 from public.fiscal_parameter_snapshots s
        where s.environment = v_environment and s.parameter_type = v_type
          and s.synchronized_at >= now() - interval '7 days'
      ) then
        v_blockers := v_blockers || 'OFFICIAL_TABLES_STALE'::text;
        exit;
      end if;
    end loop;

    select true into v_policy_ok
    from public.fiscal_accounting_policies p
    where p.business_id = p_business_id and p.environment = v_environment
      and p.enabled and p.accountant_review_status = 'approved' and p.revoked_at is null
      and p.valid_from <= current_date
    limit 1;
    if not coalesce(v_policy_ok, false) then v_blockers := v_blockers || 'ACCOUNTING_POLICY_NOT_APPROVED'::text; end if;
  end if;

  return v_blockers;
end;
$fiscal_automation_blockers$;

comment on function public.fiscal_automation_blockers(uuid) is
  'Codigos de lo que impide facturar automaticamente. Vacio = listo. Es la unica definicion de alistamiento.';

create or replace function public.fiscal_automation_is_ready(p_business_id uuid)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public, pg_temp
as $$
  select coalesce(array_length(public.fiscal_automation_blockers(p_business_id), 1), 0) = 0
$$;

revoke execute on function public.fiscal_automation_blockers(uuid) from public, anon, authenticated;
revoke execute on function public.fiscal_automation_is_ready(uuid) from public, anon, authenticated;

-- ===== 2. La única puerta para encender la automatización =====

create or replace function public.set_fiscal_automation(
  p_business_id uuid,
  p_mode text,
  p_confirmation text default ''
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, extensions, pg_temp
as $set_fiscal_automation$
declare
  v_profile public.fiscal_profiles%rowtype;
  v_blockers text[];
  v_mode text := coalesce(nullif(btrim(p_mode), ''), 'manual');
begin
  if not public.has_business_role(p_business_id, array['owner','admin']) then
    raise exception 'owner/admin requerido' using errcode = '42501';
  end if;
  if v_mode not in ('manual','on_payment_confirmed','on_order_accepted','on_ready','on_delivered') then
    raise exception 'modo de facturacion automatica invalido' using errcode = '22023';
  end if;

  select fp.* into v_profile from public.fiscal_profiles fp where fp.business_id = p_business_id for update;
  if not found then raise exception 'perfil fiscal inexistente' using errcode = '22023'; end if;

  if v_mode = 'manual' then
    -- Apagar siempre se puede, y no pide frase: frenar nunca es la operación peligrosa.
    update public.fiscal_profiles
      set invoice_policy = 'manual', automation_activated_at = null, automation_activated_by = null,
          automation_suspended_at = null, automation_suspended_reason = null, updated_at = now()
      where business_id = p_business_id;
    insert into public.fiscal_profile_events(business_id, event_type, actor_id, detail)
      values (p_business_id, 'automation_deactivated', auth.uid(), jsonb_build_object('previous_mode', v_profile.invoice_policy));
    return public.get_fiscal_automation_overview(p_business_id);
  end if;

  if btrim(coalesce(p_confirmation, '')) <> 'I_ACTIVATE_AUTOMATIC_FISCAL_INVOICING' then
    raise exception 'fiscal_automation_confirmation_required' using errcode = '22023';
  end if;

  v_blockers := public.fiscal_automation_blockers(p_business_id);
  if coalesce(array_length(v_blockers, 1), 0) > 0 then
    -- El detalle viaja como códigos: el Panel los traduce, nadie ve un SOAP.
    raise exception 'fiscal_automation_not_ready' using errcode = '22023', detail = array_to_string(v_blockers, ',');
  end if;

  update public.fiscal_profiles
    set invoice_policy = v_mode, automation_activated_at = clock_timestamp(), automation_activated_by = auth.uid(),
        automation_suspended_at = null, automation_suspended_reason = null, updated_at = now()
    where business_id = p_business_id;
  insert into public.fiscal_profile_events(business_id, event_type, actor_id, detail)
    values (p_business_id, 'automation_activated', auth.uid(), jsonb_build_object('mode', v_mode));

  return public.get_fiscal_automation_overview(p_business_id);
end;
$set_fiscal_automation$;

comment on function public.set_fiscal_automation(uuid, text, text) is
  'Unico camino para encender la facturacion automatica. Exige alistamiento completo y frase exacta.';

revoke execute on function public.set_fiscal_automation(uuid, text, text) from public, anon;
grant execute on function public.set_fiscal_automation(uuid, text, text) to authenticated;

-- Suspensión: la usa el propio backend cuando cambia algo que sostenía la
-- automatización. No la puede llamar el navegador.
create or replace function public.suspend_fiscal_automation(p_business_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public, extensions, pg_temp
as $suspend_fiscal_automation$
begin
  update public.fiscal_profiles
    set invoice_policy = 'manual', automation_activated_at = null, automation_activated_by = null,
        automation_suspended_at = clock_timestamp(),
        automation_suspended_reason = left(coalesce(p_reason, 'CONFIGURATION_CHANGED'), 80),
        updated_at = now()
    where business_id = p_business_id and invoice_policy <> 'manual';
  if found then
    insert into public.fiscal_profile_events(business_id, event_type, actor_id, detail)
      values (p_business_id, 'automation_suspended', coalesce(auth.uid(), p_business_id),
              jsonb_build_object('reason', left(coalesce(p_reason, 'CONFIGURATION_CHANGED'), 80)));
  end if;
end;
$suspend_fiscal_automation$;

revoke execute on function public.suspend_fiscal_automation(uuid, text) from public, anon, authenticated;

-- ===== 3. Guardar el perfil no enciende nada, y apaga si algo cambió =====

create or replace function public.configure_fiscal_profile(
  p_business_id uuid,
  p_profile jsonb
)
returns public.fiscal_profiles
language plpgsql
security definer
set search_path = pg_catalog, public, extensions, pg_temp
as $configure_profile_gated$
declare
  v_result public.fiscal_profiles%rowtype;
  v_previous public.fiscal_profiles%rowtype;
  v_material_change boolean := false;
begin
  if not public.has_business_role(p_business_id,array['owner','admin']) then raise exception 'owner/admin requerido' using errcode='42501'; end if;
  if coalesce(p_profile,'{}'::jsonb)-array['legal_name','cuit','tax_condition','gross_income_number','business_address','environment','point_of_sale','default_currency','default_concept','invoice_policy','is_enabled','default_recipient_condition'] <> '{}'::jsonb then raise exception 'payload fiscal no permitido' using errcode='22023'; end if;
  if coalesce(p_profile->>'environment','disabled') not in ('disabled','homologation') then raise exception 'produccion no se configura desde el panel' using errcode='42501'; end if;
  -- Guardar el formulario no puede encender la facturación automática: para eso
  -- está set_fiscal_automation, que exige el alistamiento completo.
  if coalesce(nullif(btrim(p_profile->>'invoice_policy'),''),'manual') <> 'manual' then
    raise exception 'fiscal_automation_requires_activation' using errcode='22023';
  end if;
  if coalesce((p_profile->>'default_concept')::integer, 1) not in (1, 2, 3) then
    raise exception 'concepto fiscal invalido (1=productos, 2=servicios, 3=mixto)' using errcode = '22023';
  end if;
  if (p_profile->>'is_enabled')::boolean and (
    coalesce(p_profile->>'environment','disabled')='disabled'
    or coalesce(p_profile->>'cuit','') !~ '^[0-9]{11}$'
    or coalesce((p_profile->>'point_of_sale')::integer,0) not between 1 and 99999
    or btrim(coalesce(p_profile->>'legal_name',''))=''
    or btrim(coalesce(p_profile->>'tax_condition',''))=''
    or btrim(coalesce(p_profile->>'default_recipient_condition',''))=''
  ) then raise exception 'perfil fiscal incompleto' using errcode='22023'; end if;

  select fp.* into v_previous from public.fiscal_profiles fp where fp.business_id = p_business_id;

  insert into public.fiscal_profiles(business_id,legal_name,cuit,tax_condition,gross_income_number,business_address,environment,point_of_sale,default_currency,default_concept,is_enabled,default_recipient_condition,updated_at)
  values(p_business_id,nullif(btrim(p_profile->>'legal_name'),''),nullif(regexp_replace(coalesce(p_profile->>'cuit',''),'[^0-9]','','g'),''),nullif(btrim(p_profile->>'tax_condition'),''),nullif(btrim(p_profile->>'gross_income_number'),''),nullif(btrim(p_profile->>'business_address'),''),coalesce(p_profile->>'environment','disabled'),(p_profile->>'point_of_sale')::integer,coalesce(nullif(btrim(p_profile->>'default_currency'),''),'PES'),coalesce((p_profile->>'default_concept')::integer, 1),coalesce((p_profile->>'is_enabled')::boolean,false),nullif(btrim(p_profile->>'default_recipient_condition'),''),now())
  on conflict(business_id) do update set
    legal_name=excluded.legal_name,cuit=excluded.cuit,tax_condition=excluded.tax_condition,
    gross_income_number=excluded.gross_income_number,business_address=excluded.business_address,
    environment=excluded.environment,point_of_sale=excluded.point_of_sale,
    default_currency=excluded.default_currency,default_concept=excluded.default_concept,
    is_enabled=excluded.is_enabled,
    default_recipient_condition=excluded.default_recipient_condition,updated_at=now()
  returning * into v_result;

  -- Cambiar un dato fiscal invalida la verificación que justificaba automatizar.
  -- Guardar sin cambiar nada no apaga nada.
  if v_previous.business_id is not null then
    v_material_change :=
      v_previous.cuit is distinct from v_result.cuit
      or v_previous.legal_name is distinct from v_result.legal_name
      or v_previous.tax_condition is distinct from v_result.tax_condition
      or v_previous.business_address is distinct from v_result.business_address
      or v_previous.environment is distinct from v_result.environment
      or v_previous.point_of_sale is distinct from v_result.point_of_sale
      or v_previous.default_currency is distinct from v_result.default_currency
      or v_previous.default_concept is distinct from v_result.default_concept
      or v_previous.default_recipient_condition is distinct from v_result.default_recipient_condition
      or v_previous.is_enabled is distinct from v_result.is_enabled;
    if v_material_change then
      perform public.suspend_fiscal_automation(p_business_id, 'PROFILE_CHANGED');
      select fp.* into v_result from public.fiscal_profiles fp where fp.business_id = p_business_id;
    end if;
  end if;

  return v_result;
end;
$configure_profile_gated$;

-- Tocar la política contable la devuelve a revisión, y una automatización que se
-- apoyaba en ella deja de tener con qué facturar. Se apaga sola. Aprobar una
-- política, en cambio, no apaga nada: la fila queda utilizable.
create or replace function public.suspend_fiscal_automation_on_policy_change()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, extensions, pg_temp
as $suspend_on_policy_change$
declare
  v_business uuid := coalesce(new.business_id, old.business_id);
  v_usable boolean := tg_op <> 'DELETE'
    and coalesce(new.enabled, false)
    and coalesce(new.accountant_review_status, 'pending') = 'approved'
    and new.revoked_at is null;
begin
  if not v_usable then
    perform public.suspend_fiscal_automation(v_business, 'ACCOUNTING_POLICY_CHANGED');
  end if;
  return null;
end;
$suspend_on_policy_change$;

drop trigger if exists fiscal_policies_suspend_automation on public.fiscal_accounting_policies;
create trigger fiscal_policies_suspend_automation
after insert or update or delete on public.fiscal_accounting_policies
for each row execute function public.suspend_fiscal_automation_on_policy_change();

-- ===== 4. El disparador vuelve a verificar; una marca vieja no alcanza =====

create or replace function public.enqueue_order_fiscal_intent()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, extensions, pg_temp
as $enqueue_order_fiscal_intent_gated$
declare
  v_profile public.fiscal_profiles%rowtype;
  v_should boolean := false;
  v_reason text := '';
begin
  begin
    select fp.* into v_profile from public.fiscal_profiles fp where fp.business_id = new.business_id;
    if not found or not v_profile.is_enabled or v_profile.environment = 'disabled' then return new; end if;
    if v_profile.invoice_policy = 'manual' or v_profile.automation_activated_at is null then return new; end if;

    if tg_op = 'INSERT' then
      -- finalize_checkout_session sólo crea el pedido con un pago verificado.
      if v_profile.invoice_policy = 'on_payment_confirmed' and new.payment_method = 'mercadopago' then
        v_should := true; v_reason := 'payment_confirmed';
      end if;
    elsif new.status is distinct from old.status then
      if v_profile.invoice_policy = 'on_order_accepted' and new.status = 'accepted' then
        v_should := true; v_reason := 'order_accepted';
      elsif v_profile.invoice_policy = 'on_ready' and new.status = 'ready' then
        v_should := true; v_reason := 'order_ready';
      elsif v_profile.invoice_policy = 'on_delivered' and new.status = 'delivered' then
        v_should := true; v_reason := 'order_delivered';
      elsif v_profile.invoice_policy = 'on_payment_confirmed'
        and new.status = 'delivered' and coalesce(new.payment_method,'') <> 'mercadopago' then
        v_should := true; v_reason := 'cash_collected';
      end if;
    end if;

    -- Se vuelve a mirar el alistamiento acá y no sólo al activar: si mientras
    -- tanto venció el certificado o se revocó la política, encolar una intención
    -- que no puede terminar sólo sirve para llenar la bandeja de excepciones.
    if v_should and not public.fiscal_automation_is_ready(new.business_id) then
      perform public.suspend_fiscal_automation(new.business_id, 'READINESS_LOST');
      v_should := false;
    end if;

    if v_should then perform public.enqueue_fiscal_emission_intent(new.business_id, 'online_order', new.id, v_reason); end if;
  exception when others then
    -- Facturar es importante; cobrar y entregar lo es más. El error queda en el
    -- perfil, no en la transacción del pedido.
    begin
      update public.fiscal_profiles
        set last_error_code = 'FISCAL_INTENT_ENQUEUE_FAILED', last_error_at = clock_timestamp()
        where business_id = new.business_id;
    exception when others then null;
    end;
  end;
  return new;
end;
$enqueue_order_fiscal_intent_gated$;

-- ===== 5. Lo que ve el Panel: alistamiento + números de hoy =====

create or replace function public.get_fiscal_automation_overview(p_business_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public, extensions, pg_temp
as $get_fiscal_automation_overview$
declare
  v_profile public.fiscal_profiles%rowtype;
  v_blockers text[];
  v_today date := (clock_timestamp() at time zone 'America/Argentina/Buenos_Aires')::date;
begin
  if not public.has_business_role(p_business_id, array['owner','admin','staff']) then
    raise exception 'operador no autorizado' using errcode = '42501';
  end if;
  select fp.* into v_profile from public.fiscal_profiles fp where fp.business_id = p_business_id;
  v_blockers := public.fiscal_automation_blockers(p_business_id);

  return jsonb_build_object(
    'generated_at', clock_timestamp(),
    'environment', coalesce(v_profile.environment, 'disabled'),
    'automation_mode', coalesce(v_profile.invoice_policy, 'manual'),
    'automation_active', coalesce(v_profile.invoice_policy, 'manual') <> 'manual' and v_profile.automation_activated_at is not null,
    'automation_activated_at', v_profile.automation_activated_at,
    'automation_suspended_at', v_profile.automation_suspended_at,
    'automation_suspended_reason', v_profile.automation_suspended_reason,
    'ready', coalesce(array_length(v_blockers, 1), 0) = 0,
    'blockers', to_jsonb(v_blockers),
    'today', jsonb_build_object(
      'date', v_today,
      -- Elegibles: pedidos del día que ya pasaron de borrador y no se cancelaron,
      -- más las ventas de mostrador cobradas. Es el universo sobre el que la
      -- automatización tiene algo que decir.
      'eligible', (
        select count(*) from public.orders o
         where o.business_id = p_business_id
           and (o.created_at at time zone 'America/Argentina/Buenos_Aires')::date = v_today
           and o.status not in ('draft','submitted','canceled')
      ) + (
        select count(*) from public.pos_sales s
         where s.business_id = p_business_id
           and (s.created_at at time zone 'America/Argentina/Buenos_Aires')::date = v_today
           and s.state in ('completed','completed_fiscal_pending')
      ),
      'automatic', (
        select count(*) from public.fiscal_documents d
         join public.fiscal_emission_intents i on i.fiscal_document_id = d.id
         where d.business_id = p_business_id and d.state in ('authorized','credited')
           and (d.created_at at time zone 'America/Argentina/Buenos_Aires')::date = v_today
      ),
      'pending', (
        select count(*) from public.fiscal_documents d
         where d.business_id = p_business_id
           and d.state in ('draft','queued','claiming','authenticating','authorizing','retry_wait','ambiguous')
           and (d.created_at at time zone 'America/Argentina/Buenos_Aires')::date = v_today
      ),
      'rejected', (
        select count(*) from public.fiscal_documents d
         where d.business_id = p_business_id and d.state = 'rejected'
           and (d.created_at at time zone 'America/Argentina/Buenos_Aires')::date = v_today
      ),
      'attention', (
        select count(*) from public.fiscal_documents d
         where d.business_id = p_business_id and d.state in ('failed','manual_review')
           and (d.created_at at time zone 'America/Argentina/Buenos_Aires')::date = v_today
      )
    ),
    -- Las pruebas de homologación no son ventas: se cuentan aparte para que
    -- nadie lea un número de QA como facturación del negocio.
    'totals_by_environment', (
      select coalesce(jsonb_object_agg(t.environment, t.counts), '{}'::jsonb) from (
        select d.environment, jsonb_build_object(
                 'authorized', count(*) filter (where d.state in ('authorized','credited')),
                 'rejected', count(*) filter (where d.state = 'rejected'),
                 'attention', count(*) filter (where d.state in ('failed','manual_review')),
                 'pending', count(*) filter (where d.state in ('draft','queued','claiming','authenticating','authorizing','retry_wait','ambiguous'))
               ) as counts
          from public.fiscal_documents d
         where d.business_id = p_business_id
         group by d.environment
      ) t
    ),
    'exceptions_open', (
      select count(*) from public.fiscal_documents d
       where d.business_id = p_business_id and d.state in ('failed','manual_review','rejected')
    ) + (
      select count(*) from public.fiscal_emission_intents i
       where i.business_id = p_business_id and i.state = 'manual_review'
    )
  );
end;
$get_fiscal_automation_overview$;

revoke execute on function public.get_fiscal_automation_overview(uuid) from public, anon;
grant execute on function public.get_fiscal_automation_overview(uuid) to authenticated;

-- ===== 6. La bandeja: sólo excepciones reales, y sin una línea de SOAP =====

create or replace function public.list_fiscal_exceptions(p_business_id uuid, p_limit integer default 50)
returns table (
  exception_id text,
  kind text,
  severity text,
  source_type text,
  source_id uuid,
  fiscal_document_id uuid,
  document_label text,
  total_amount numeric,
  environment text,
  code text,
  occurred_at timestamptz
)
language plpgsql
stable
security definer
set search_path = pg_catalog, public, extensions, pg_temp
as $list_fiscal_exceptions$
declare
  v_limit integer := least(greatest(coalesce(p_limit, 50), 1), 200);
  v_blockers text[];
begin
  if not public.has_business_role(p_business_id, array['owner','admin','staff']) then
    raise exception 'operador no autorizado' using errcode = '42501';
  end if;
  v_blockers := public.fiscal_automation_blockers(p_business_id);

  return query
  with tray as (
  -- Configuración: una sola fila, no una por comprobante. El operador tiene un
  -- problema, no cuarenta.
  select
    'config:' || b.code as exception_id,
    case when b.code in ('CERTIFICATE_EXPIRED','CERTIFICATE_CUIT_MISMATCH','CERTIFICATE_MISSING')
         then 'certificate' else 'configuration' end as kind,
    'blocking'::text as severity,
    null::text as source_type, null::uuid as source_id, null::uuid as fiscal_document_id,
    null::text as document_label, null::numeric as total_amount,
    (select coalesce(fp.environment,'disabled') from public.fiscal_profiles fp where fp.business_id = p_business_id) as environment,
    b.code as code,
    null::timestamptz as occurred_at
  from unnest(v_blockers) as b(code)
  where exists (select 1 from public.fiscal_profiles fp where fp.business_id = p_business_id and fp.is_enabled)

  union all

  -- Comprobantes que no pueden avanzar solos. El motivo viaja como código: el
  -- texto crudo de ARCA no llega nunca a esta pantalla.
  select
    'document:' || d.id::text,
    case
      when d.state = 'rejected' then 'rejected'
      when d.result = 'configuration_error' then 'missing_fiscal_data'
      when coalesce(o.last_error_code, '') in ('INVALID_TAX_TOTALS','REQUIRES_FISCAL_REVIEW') then 'amount_mismatch'
      when coalesce(o.last_error_code, '') = 'AMBIGUOUS' then 'ambiguous'
      else 'unrecoverable'
    end,
    case when d.state = 'rejected' then 'action_required' else 'blocking' end,
    d.source_type, d.source_id, d.id,
    concat_ws('-', lpad(d.point_of_sale::text, 5, '0'), lpad(coalesce(d.document_number, 0)::text, 8, '0')),
    d.total_amount, d.environment,
    -- Sólo códigos. El texto que devuelve ARCA no tiene camino hasta esta
    -- pantalla, así que no hay forma de que un SOAP crudo llegue al operador.
    coalesce(nullif(o.last_error_code, ''), upper(coalesce(nullif(d.result, ''), d.state))),
    coalesce(d.authorized_at, d.created_at)
  from public.fiscal_documents d
  left join public.fiscal_outbox o on o.fiscal_document_id = d.id
  where d.business_id = p_business_id and d.state in ('rejected','failed','manual_review')

  union all

  -- Intenciones que ni llegaron a ser comprobante.
  select
    'intent:' || i.id::text, 'missing_fiscal_data', 'blocking',
    i.source_type, i.source_id, null::uuid, null::text, null::numeric,
    (select coalesce(fp.environment,'disabled') from public.fiscal_profiles fp where fp.business_id = p_business_id),
    coalesce(nullif(i.last_error_code, ''), 'FISCAL_DATA_MISSING'),
    coalesce(i.updated_at, i.created_at)
  from public.fiscal_emission_intents i
  where i.business_id = p_business_id and i.state = 'manual_review'
  )
  select t.exception_id, t.kind, t.severity, t.source_type, t.source_id, t.fiscal_document_id,
         t.document_label, t.total_amount, t.environment, t.code, t.occurred_at
    from tray t
   order by t.severity, t.occurred_at desc nulls first
   limit v_limit;
end;
$list_fiscal_exceptions$;

revoke execute on function public.list_fiscal_exceptions(uuid, integer) from public, anon;
grant execute on function public.list_fiscal_exceptions(uuid, integer) to authenticated;
