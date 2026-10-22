-- ============================================================================
--  Endurecimiento de seguridad y de crecimiento antes de abrir al público.
-- ============================================================================
--
--  Cada sección dice qué se midió en el código, por qué se cambia y qué NO se
--  toca. Forward-only: no borra columnas, no reescribe los núcleos de pedido ni
--  de checkout, no toca filas comerciales.
--
--  1. Límites por cliente para pedidos y checkouts (P0).
--     `create_order_with_items` sólo exige `auth.uid()` —una sesión anónima
--     alcanza— y su núcleo descuenta stock sin mirar al cliente. Las columnas
--     `businesses.max_pending_orders_per_customer` y
--     `order_rate_limit_per_10_minutes` existen desde 20260725060000 (líneas
--     28-29) y NADIE las imponía en el pedido en efectivo; el checkout sólo
--     imponía la segunda y sólo contando sesiones (20260813020000, ~498).
--     Un trigger BEFORE INSERT en `orders` y en `checkout_sessions` las impone
--     en un solo lugar, sin reemplazar los núcleos.
--  2. La ventana QA también cierra pedidos (P1). `open_qa_window` deja el
--     tenant en `open` (20260925090000, ~97-99) y sólo la política de productos
--     mira `qa_window_until`; el núcleo (20260812220000, ~315-321) y el checkout
--     (20260813020000, ~469-476) miran `status`. Un runner QA caído dejaba el
--     tenant tomando pedidos hasta que corriera el barrido. Se rechaza en el
--     mismo trigger del punto 1.
--  3. Retención (P1): `payment_rate_limit_buckets` y los recibos de webhook con
--     firma inválida crecen sin techo; los usuarios anónimos sin rastro también.
--     Funciones de purga sólo para service_role y una tarea pg_cron INACTIVA.
--  4. Los RPC de combos dejan de ser públicos (P2).
--  5. `check_scheduler_watchdog` sólo acepta un origen con forma de slug (P2).
--  6. Los tres stubs privados A1-A4 fijan search_path (P2).
--  7. El personal deja de poder escribir `products.stock` directo (P2/P1).
--
--  REVERSIÓN (sólo si hiciera falta): `drop trigger orders_enforce_customer_admission
--  on public.orders; drop trigger checkout_sessions_enforce_customer_admission on
--  public.checkout_sessions;`, `select cron.unschedule('taba-security-retention-sweep');`,
--  `grant execute on function public.list_business_combos(uuid),
--  public.resolve_business_combo(uuid,text,integer) to anon, authenticated;` y
--  `grant update (stock) on table public.products to authenticated;`. El resto
--  (índices, funciones de purga, search_path) puede quedar.
-- ============================================================================

-- ===== 1 y 2. Admisión de pedidos y checkouts por cliente ===================
--
-- QUÉ CUENTA
--   · pendientes: pedidos del mismo cliente en el mismo comercio que todavía no
--     terminaron —el mismo vocabulario de la bandeja del Panel
--     (BUSINESS_INBOX_DATABASE_STATUSES en js/core/business-order-intake.js)—
--     más checkouts de Mercado Pago que siguen pagables: estado previo al pago y
--     sin vencer. Esos checkouts retienen stock igual que un pedido.
--   · ritmo: pedidos en efectivo/coordinados y checkouts creados en los últimos
--     10 minutos. El pedido de Mercado Pago no se cuenta dos veces: su checkout
--     ya contó.
--   · columna NULL = sin límite, igual que hoy.
--
-- QUÉ NO SE RECHAZA NUNCA
--   El pedido de Mercado Pago lo inserta `finalize_paid_checkout_session`
--   cuando el dinero YA se movió (20260812220000, ~13-15): un raise ahí sería
--   un pago tomado con la transacción revertida en loop. Su límite se aplicó al
--   crear el checkout. Declarar 'mercadopago' en el camino de efectivo no
--   saltea nada: el constraint trigger diferido `orders_assert_payment_modality`
--   (20260806170000) revierte al COMMIT todo pedido Mercado Pago sin un intent
--   verificado y completado.
--
-- LOS REINTENTOS IDEMPOTENTES NO LLEGAN ACÁ
--   El núcleo (20260812220000, ~252-302) y `create_checkout_session`
--   (20260813020000, ~451-463) toman un lock por (comercio, client_request_id),
--   BUSCAN la fila existente y la devuelven antes de cualquier INSERT. Un
--   reintento del mismo pedido no dispara este trigger aunque el cliente ya
--   esté en el límite.
--
-- CONCURRENCIA
--   Sin un lock, N altas simultáneas del mismo cliente cuentan todas lo mismo y
--   pasan todas. Se serializa por (tabla, comercio, cliente) y sólo cuando el
--   comercio configuró algún límite. Una clave por tabla, y no una común, a
--   propósito: el pedido en efectivo llega a este INSERT con los productos ya
--   bloqueados y el checkout los bloquea DESPUÉS de insertar su sesión; con una
--   clave común, efectivo y checkout simultáneos del mismo cliente sobre el
--   mismo producto se bloquearían en orden inverso. Lo que se cede es que esas
--   dos vías, en el mismo instante exacto, puedan pasarse por una unidad.
--
-- ERRORES (para el mensaje del frontend; el texto va en message + details)
--   54000 'demasiados pedidos sin terminar en este comercio'  detail ORDER_PENDING_LIMIT
--   54000 'demasiados pedidos en los ultimos 10 minutos'      detail ORDER_RATE_LIMIT
--   55000 'el negocio no esta habilitado para recibir pedidos' detail QA_WINDOW_CLOSED
--   El tercero usa a propósito la misma frase que el núcleo para un comercio no
--   habilitado: el storefront ya la traduce.
create or replace function public.enforce_customer_order_admission()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $enforce_customer_order_admission$
declare
  v_customer uuid;
  v_business record;
  v_pending integer;
  v_recent integer;
begin
  if tg_table_name = 'orders' then
    if new.payment_method = 'mercadopago' or new.customer_user_id is null then
      return new;
    end if;
    v_customer := new.customer_user_id;
  else
    v_customer := new.customer_id;
  end if;

  select b.qa_fixture, b.qa_window_until,
         b.max_pending_orders_per_customer, b.order_rate_limit_per_10_minutes
    into v_business
    from public.businesses b
   where b.id = new.business_id;
  if not found then
    -- La clave foránea rechaza la fila con su propio error.
    return new;
  end if;

  -- Falla cerrado aunque el barrido `taba-qa-window-expiry` no corra: es la
  -- misma condición que ya usa la política pública de productos.
  if v_business.qa_fixture
     and coalesce(v_business.qa_window_until, '-infinity'::timestamptz) <= clock_timestamp() then
    raise exception 'el negocio no esta habilitado para recibir pedidos'
      using errcode = '55000',
            detail = 'QA_WINDOW_CLOSED',
            hint = 'la ventana QA del comercio esta cerrada o vencida';
  end if;

  if v_business.max_pending_orders_per_customer is null
     and v_business.order_rate_limit_per_10_minutes is null then
    return new;
  end if;

  perform pg_advisory_xact_lock(hashtextextended(
    'taba:customer-order-admission:' || tg_table_name || ':' || new.business_id::text || ':' || v_customer::text,
    0));

  if v_business.max_pending_orders_per_customer is not null then
    select (select count(*)
              from public.orders o
             where o.business_id = new.business_id
               and o.customer_user_id = v_customer
               and o.status in ('received', 'submitted', 'accepted', 'preparing', 'ready',
                                'assigned', 'picked_up', 'on_the_way', 'arrived', 'arriving'))
         + (select count(*)
              from public.checkout_sessions s
             where s.business_id = new.business_id
               and s.customer_id = v_customer
               and s.status in ('created', 'validating', 'ready_for_payment', 'redirected',
                                'payment_pending', 'retrying')
               and s.expires_at > clock_timestamp())
      into v_pending;
    if v_pending >= v_business.max_pending_orders_per_customer then
      raise exception 'demasiados pedidos sin terminar en este comercio'
        using errcode = '54000',
              detail = 'ORDER_PENDING_LIMIT',
              hint = 'esperar a que se entregue o se cancele un pedido anterior';
    end if;
  end if;

  if v_business.order_rate_limit_per_10_minutes is not null then
    select (select count(*)
              from public.orders o
             where o.business_id = new.business_id
               and o.customer_user_id = v_customer
               and o.payment_method is distinct from 'mercadopago'
               and o.created_at >= clock_timestamp() - interval '10 minutes')
         + (select count(*)
              from public.checkout_sessions s
             where s.business_id = new.business_id
               and s.customer_id = v_customer
               and s.created_at >= clock_timestamp() - interval '10 minutes')
      into v_recent;
    if v_recent >= v_business.order_rate_limit_per_10_minutes then
      raise exception 'demasiados pedidos en los ultimos 10 minutos'
        using errcode = '54000',
              detail = 'ORDER_RATE_LIMIT',
              hint = 'reintentar en unos minutos';
    end if;
  end if;

  return new;
end;
$enforce_customer_order_admission$;

-- Función de trigger: no la ejecuta nadie directamente. El privilegio se mira
-- al CREATE TRIGGER, no cuando dispara.
revoke all on function public.enforce_customer_order_admission() from public, anon, authenticated;

drop trigger if exists orders_enforce_customer_admission on public.orders;
create trigger orders_enforce_customer_admission
before insert on public.orders
for each row execute function public.enforce_customer_order_admission();

drop trigger if exists checkout_sessions_enforce_customer_admission on public.checkout_sessions;
create trigger checkout_sessions_enforce_customer_admission
before insert on public.checkout_sessions
for each row execute function public.enforce_customer_order_admission();

-- Los dos conteos recorren (comercio, cliente) y filtran por estado o por fecha.
-- Para `orders` sólo existía (customer_user_id, created_at); para
-- `checkout_sessions`, el único (business_id, customer_id, client_request_id),
-- que obliga a leer todas las sesiones del cliente para contar las recientes.
create index if not exists orders_business_customer_created_idx
  on public.orders (business_id, customer_user_id, created_at desc)
  where customer_user_id is not null;
create index if not exists checkout_sessions_business_customer_created_idx
  on public.checkout_sessions (business_id, customer_id, created_at desc);

comment on function public.enforce_customer_order_admission() is
  'Admisión de pedidos en efectivo y checkouts: ventana QA, pedidos sin terminar y ritmo por cliente y comercio (NULL = sin límite). Nunca rechaza el pedido de un pago ya aprobado.';

-- ===== 3. Retención: lo que crece sin techo ================================
--
-- `consume_payment_rate_limit` inserta un bucket por (scope, sujeto, ventana) y
-- nadie lo borra. Las ventanas duran como mucho 3600 s (la función rechaza más),
-- así que un bucket de más de un día no se vuelve a consultar nunca.
create index if not exists payment_rate_limit_buckets_started_idx
  on public.payment_rate_limit_buckets (bucket_started_at);

create or replace function public.purge_expired_payment_rate_limit_buckets(p_limit integer default 5000)
returns integer
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $purge_expired_payment_rate_limit_buckets$
declare
  v_limit integer := least(greatest(coalesce(p_limit, 5000), 1), 50000);
  v_deleted integer;
begin
  with doomed as (
    select b.scope, b.subject_hash, b.bucket_started_at
      from public.payment_rate_limit_buckets b
     where b.bucket_started_at < clock_timestamp() - interval '1 day'
     order by b.bucket_started_at
     limit v_limit
     for update skip locked
  )
  delete from public.payment_rate_limit_buckets b
   using doomed d
   where b.scope = d.scope
     and b.subject_hash = d.subject_hash
     and b.bucket_started_at = d.bucket_started_at;
  get diagnostics v_deleted = row_count;
  return v_deleted;
end;
$purge_expired_payment_rate_limit_buckets$;

-- Un aviso con firma inválida es evidencia de ataque o de un secreto mal
-- cargado, no un evento del proveedor. `list_webhook_signature_alerts` mira las
-- últimas 24 h y una entrega válida posterior PROMUEVE la fila
-- (20260908070341); a los 14 días ninguna de las dos cosas la necesita. Nunca se
-- borra un recibo válido ni uno que algún evento u outbox todavía referencie.
create index if not exists payment_webhook_receipts_rejected_received_idx
  on public.payment_webhook_receipts (received_at)
  where not signature_valid;

create or replace function public.purge_rejected_webhook_receipts(p_limit integer default 1000)
returns integer
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $purge_rejected_webhook_receipts$
declare
  v_limit integer := least(greatest(coalesce(p_limit, 1000), 1), 50000);
  v_deleted integer;
begin
  with doomed as (
    select r.id
      from public.payment_webhook_receipts r
     where not r.signature_valid
       and r.received_at < clock_timestamp() - interval '14 days'
       and not exists (select 1 from public.payment_outbox o where o.webhook_receipt_id = r.id)
       and not exists (select 1 from public.payment_events e where e.webhook_receipt_id = r.id)
     order by r.received_at
     limit v_limit
     for update of r skip locked
  )
  delete from public.payment_webhook_receipts r
   using doomed d
   where r.id = d.id;
  get diagnostics v_deleted = row_count;
  return v_deleted;
end;
$purge_rejected_webhook_receipts$;

-- Cada visitante de la tienda abre una sesión anónima. Se borra SÓLO la que:
-- es anónima, tiene más de 30 días, no entró ni refrescó su sesión en 30 días y
-- no está referenciada por NINGUNA clave foránea hacia auth.users fuera del
-- esquema auth (pedidos, perfiles, direcciones, checkouts, eventos, membresías,
-- auditoría…). La lista de claves se lee del catálogo en cada corrida: una tabla
-- nueva que apunte a auth.users protege a sus usuarios sin tocar esta función.
-- Si apareciera una clave compuesta hacia auth.users no se borra nada.
create or replace function public.purge_stale_anonymous_users(p_limit integer default 200)
returns integer
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $purge_stale_anonymous_users$
declare
  v_limit integer := least(greatest(coalesce(p_limit, 200), 1), 1000);
  v_guards text := '';
  v_fk record;
  v_deleted integer;
begin
  if exists (
    select 1 from pg_constraint c
     where c.contype = 'f'
       and c.confrelid = 'auth.users'::regclass
       and c.connamespace <> 'auth'::regnamespace
       and cardinality(c.conkey) <> 1
  ) then
    raise exception 'clave foranea compuesta hacia auth.users: purga de anonimos omitida'
      using errcode = '55000';
  end if;

  for v_fk in
    select c.conrelid::regclass::text as table_name, a.attname::text as column_name
      from pg_constraint c
      join pg_attribute a on a.attrelid = c.conrelid and a.attnum = c.conkey[1]
     where c.contype = 'f'
       and c.confrelid = 'auth.users'::regclass
       and c.connamespace <> 'auth'::regnamespace
     order by 1, 2
  loop
    v_guards := v_guards || format(
      ' and not exists (select 1 from %s t where t.%I = u.id)', v_fk.table_name, v_fk.column_name);
  end loop;

  execute format($purge$
    with doomed as (
      select u.id
        from auth.users u
       where u.is_anonymous is true
         and u.created_at < clock_timestamp() - interval '30 days'
         and coalesce(u.last_sign_in_at, u.created_at) < clock_timestamp() - interval '30 days'
         and not exists (
           select 1 from auth.sessions s
            where s.user_id = u.id
              and coalesce(s.updated_at, s.created_at) >= clock_timestamp() - interval '30 days')
         %s
       order by u.created_at
       limit %s
       for update of u skip locked
    )
    delete from auth.users u using doomed d where u.id = d.id
  $purge$, v_guards, v_limit);
  get diagnostics v_deleted = row_count;
  return v_deleted;
end;
$purge_stale_anonymous_users$;

-- Una sola tarea para las tres purgas. Si la purga de anónimos no tiene permiso
-- sobre auth.users en este proyecto, o el esquema auth no trae `is_anonymous`,
-- se omite con un WARNING y las otras dos siguen: no se pierde la limpieza de
-- lo que más crece por un permiso del proveedor. Cualquier otro error sí hace
-- fallar la tarea, y `list_scheduler_health` lo muestra.
create or replace function public.run_security_retention_sweep()
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $run_security_retention_sweep$
declare
  v_buckets integer;
  v_receipts integer;
  v_users integer;
  v_users_skipped text;
begin
  v_buckets := public.purge_expired_payment_rate_limit_buckets(5000);
  v_receipts := public.purge_rejected_webhook_receipts(1000);
  begin
    v_users := public.purge_stale_anonymous_users(200);
  exception when insufficient_privilege or undefined_column or undefined_table
                 or object_not_in_prerequisite_state then
    v_users := null;
    v_users_skipped := sqlstate;
    raise warning 'purga de usuarios anonimos omitida: % (%)', sqlerrm, sqlstate;
  end;
  return jsonb_build_object(
    'rate_limit_buckets', v_buckets,
    'rejected_webhook_receipts', v_receipts,
    'anonymous_users', v_users,
    'anonymous_users_skipped', v_users_skipped
  );
end;
$run_security_retention_sweep$;

revoke all on function public.purge_expired_payment_rate_limit_buckets(integer) from public, anon, authenticated;
revoke all on function public.purge_rejected_webhook_receipts(integer) from public, anon, authenticated;
revoke all on function public.purge_stale_anonymous_users(integer) from public, anon, authenticated;
revoke all on function public.run_security_retention_sweep() from public, anon, authenticated;
grant execute on function public.purge_expired_payment_rate_limit_buckets(integer) to service_role;
grant execute on function public.purge_rejected_webhook_receipts(integer) to service_role;
grant execute on function public.purge_stale_anonymous_users(integer) to service_role;
grant execute on function public.run_security_retention_sweep() to service_role;

comment on function public.purge_expired_payment_rate_limit_buckets(integer) is
  'Borra buckets de rate limit de pagos con más de 1 día (ninguna ventana dura más de 1 h). Por lotes; sólo service_role.';
comment on function public.purge_rejected_webhook_receipts(integer) is
  'Borra recibos de webhook con firma inválida de más de 14 días que nada referencia. Por lotes; sólo service_role.';
comment on function public.purge_stale_anonymous_users(integer) is
  'Borra usuarios anónimos de más de 30 días, sin actividad en 30 días y sin ninguna referencia por clave foránea fuera de auth. Por lotes; sólo service_role.';
comment on function public.run_security_retention_sweep() is
  'Tarea taba-security-retention-sweep: las tres purgas de retención. La de anónimos se omite con WARNING si el proyecto no la permite.';

-- Cada 5 minutos, no una vez por día: `evaluate_operational_alerts` marca
-- SCHEDULER_JOB_STALLED (CRÍTICA) a toda tarea ACTIVA sin éxito en 15 minutos
-- (20260925220000). Por lotes, cada corrida es barata.
--
-- Se crea INACTIVA. Es la convención de la recuperación: bootstrap-hosted.mjs
-- pausa todas las taba-* después de cada migración y
-- scripts/recovery/qa-schedulers.mjs las enciende de a una. Para activarla:
--   select cron.alter_job(jobid, active := true) from cron.job
--    where jobname = 'taba-security-retention-sweep';
do $schedule_security_retention$
declare
  v_job bigint;
begin
  v_job := cron.schedule(
    'taba-security-retention-sweep',
    '*/5 * * * *',
    'select public.run_security_retention_sweep();'
  );
  perform cron.alter_job(v_job, active := false);
end;
$schedule_security_retention$;

-- ===== 4. Los RPC de combos dejan de ser públicos ===========================
-- Los dos son SECURITY DEFINER y leen `product_combos` y `products` sin RLS:
-- `resolve_business_combo` devolvía, de CUALQUIER negocio —cerrado, tenant QA
-- fuera de su ventana, combo inactivo o sin aprobar—, nombre, SKU y stock
-- derivado de productos que la política pública no muestra.
-- Quién los llama (verificado 2026-10-21): el storefront y el Panel NO —ningún
-- `rpc('list_business_combos'|'resolve_business_combo')` en js/, pago/,
-- cuenta/ ni catalog/; la tienda deriva los combos en el navegador
-- (js/core/combos.js) desde el catálogo público—. El único llamador es
-- scripts/import-combos.mjs, con la clave de servicio. Dentro de la base sólo
-- `list_business_combos` llama a `resolve_business_combo`, como definer.
revoke all on function public.list_business_combos(uuid) from public, anon, authenticated;
revoke all on function public.resolve_business_combo(uuid, text, integer) from public, anon, authenticated;
grant execute on function public.list_business_combos(uuid) to service_role;
grant execute on function public.resolve_business_combo(uuid, text, integer) to service_role;

-- ===== 5. El watchdog no escribe texto arbitrario en una alerta ==============
-- `check_scheduler_watchdog` es anónima a propósito (la llama
-- .github/workflows/scheduler-watchdog.yml con la clave publicable) y guarda
-- `p_source` en la evidencia de la alerta y en su evento. Hasta 40 caracteres
-- cualesquiera de un extraño terminaban frente al operador («llamá al…»). Ahora
-- sólo un slug; cualquier otra cosa se registra como 'external'. Los orígenes
-- reales —github_actions, cloudflare_cron, order_traffic, ensayo— cumplen.
-- Cuerpo idéntico a 20260810150000 salvo `v_source`. CREATE OR REPLACE conserva
-- los privilegios: anon sigue pudiendo ejecutarla.
create or replace function public.check_scheduler_watchdog(p_source text default 'external')
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, extensions, pg_temp
as $check_scheduler_watchdog$
declare
  v_beat jsonb;
  v_healthy boolean;
  v_age numeric;
  v_last timestamptz;
  v_source text := case
    when btrim(coalesce(p_source, '')) ~ '^[a-z0-9_.-]{1,40}$' then btrim(p_source)
    else 'external'
  end;
  v_business record;
  v_alert public.operational_alerts;
  v_fingerprint text;
  v_alert_id uuid;
  v_subject uuid := md5('scheduler_watchdog')::uuid;
  v_action text := 'ninguna';
  v_touched integer := 0;
begin
  v_beat := public.scheduler_heartbeat();
  v_healthy := coalesce((v_beat ->> 'healthy')::boolean, false);
  v_age := nullif(v_beat ->> 'age_seconds', '')::numeric;
  v_last := nullif(v_beat ->> 'last_run_at', '')::timestamptz;

  -- Dos sondas al mismo tiempo no tienen nada que agregar la una a la otra.
  if not pg_try_advisory_xact_lock(hashtext('taba:scheduler_watchdog')) then
    return v_beat || jsonb_build_object('action', 'omitida', 'reason', 'otra comprobación en curso');
  end if;

  for v_business in
    select b.id from public.businesses b where b.status <> 'closed' order by b.id
  loop
    v_fingerprint := encode(digest(
      v_business.id::text || ':SCHEDULER_WATCHDOG_STALE:' || v_subject::text, 'sha256'
    ), 'hex');

    select * into v_alert from public.operational_alerts
     where business_id = v_business.id and fingerprint = v_fingerprint
     for update;

    if v_healthy then
      -- Vuelve sola, sin esperar a que el barrido reviva.
      if v_alert.id is not null and v_alert.status <> 'resolved' then
        update public.operational_alerts
           set status = 'resolved', resolved_at = clock_timestamp(),
               resolution_note = 'El barrido volvió a correr; la sonda externa lo confirmó.',
               updated_at = clock_timestamp()
         where id = v_alert.id;
        insert into public.operational_alert_events(business_id, alert_id, event_type, detail)
        values (v_business.id, v_alert.id, 'resolved',
          jsonb_build_object('resolution', 'scheduler_recovered', 'source', v_source));
        v_action := 'resuelta';
        v_touched := v_touched + 1;
      end if;
      continue;
    end if;

    -- No sano. Se escribe como mucho una vez por minuto, la llamen las veces
    -- que la llamen: la alerta ya abierta y reciente no se vuelve a tocar.
    if v_alert.id is not null and v_alert.status <> 'resolved'
      and v_alert.last_seen_at > clock_timestamp() - interval '60 seconds' then
      v_action := 'sin cambios';
      continue;
    end if;

    insert into public.operational_alerts(
      business_id, fingerprint, severity, alert_code, subject_type, subject_id,
      status, summary, required_action, evidence
    ) values (
      v_business.id, v_fingerprint, 'CRITICAL', 'SCHEDULER_WATCHDOG_STALE',
      'service_health', v_subject, 'open',
      'La vigilancia automática dejó de correr.',
      'El sistema ya no se está revisando solo: mirá el Panel hasta que vuelva y avisá a soporte.',
      jsonb_build_object(
        'last_run_at', v_last,
        'age_seconds', v_age,
        'stale_after_seconds', 600,
        'observed_by', v_source
      )
    )
    on conflict (business_id, fingerprint) do update set
      severity = 'CRITICAL',
      status = case when operational_alerts.status = 'resolved' then 'open' else operational_alerts.status end,
      summary = excluded.summary,
      required_action = excluded.required_action,
      evidence = excluded.evidence,
      last_seen_at = clock_timestamp(),
      occurrence_count = operational_alerts.occurrence_count + case
        when operational_alerts.last_seen_at < clock_timestamp() - interval '1 minute' then 1 else 0 end,
      resolved_by = null, resolved_at = null, resolution_note = null,
      acknowledged_by = case when operational_alerts.status = 'resolved' then null else operational_alerts.acknowledged_by end,
      acknowledged_at = case when operational_alerts.status = 'resolved' then null else operational_alerts.acknowledged_at end,
      updated_at = clock_timestamp()
    returning id into v_alert_id;

    -- Un evento por episodio, no por comprobación.
    if v_alert.id is null or v_alert.status = 'resolved' then
      insert into public.operational_alert_events(business_id, alert_id, event_type, detail)
      values (
        v_business.id, v_alert_id,
        case when v_alert.id is null then 'detected' else 'reopened' end,
        jsonb_build_object('alert_code', 'SCHEDULER_WATCHDOG_STALE', 'source', v_source)
      );
    end if;
    v_action := 'abierta';
    v_touched := v_touched + 1;
  end loop;

  return v_beat || jsonb_build_object('action', v_action, 'businesses_touched', v_touched, 'source', v_source);
end;
$check_scheduler_watchdog$;

comment on function public.check_scheduler_watchdog(text) is
  'Sonda del planificador: mide el atraso real del barrido, abre la alerta cuando esta muerto y la cierra cuando vuelve. No confia en el llamador; el origen sólo se registra si es un slug ([a-z0-9_.-], hasta 40), si no queda external. Escribe como mucho una vez por minuto.';

-- ===== 6. Stubs privados A1-A4 con search_path fijo =========================
-- 20260909050330 (~381-386) los dejó como entradas que sólo hacen raise, sin
-- `set search_path`: son los tres «function_search_path_mutable» del asesor de
-- seguridad alojado. Vacío alcanza: el cuerpo no nombra ningún objeto. El
-- EXECUTE ya lo había cerrado el bucle final de esa migración; se repite por si
-- un CREATE OR REPLACE posterior lo hubiera reabierto.
alter function private.set_a1_a4_payment_dispatch_paused_v3(text, text, text, boolean)
  set search_path = '';
alter function private.create_a1_a4_drain_attestation_v3(text, text, text, text, text, text, text,
  timestamptz, timestamptz, timestamptz, timestamptz, text, jsonb)
  set search_path = '';
alter function private.execute_a1_a4_legacy_contract_v3(uuid, text, text, text, text, text, text)
  set search_path = '';
revoke all on function private.set_a1_a4_payment_dispatch_paused_v3(text, text, text, boolean)
  from public, anon, authenticated, service_role;
revoke all on function private.create_a1_a4_drain_attestation_v3(text, text, text, text, text, text, text,
  timestamptz, timestamptz, timestamptz, timestamptz, text, jsonb)
  from public, anon, authenticated, service_role;
revoke all on function private.execute_a1_a4_legacy_contract_v3(uuid, text, text, text, text, text, text)
  from public, anon, authenticated, service_role;

-- ===== 7. El stock se mueve con movimiento, no con un PATCH ================
-- 20260725110000 (~1071-1073) dejó UPDATE por columna sobre (stock, available,
-- is_active, sort_order) para authenticated, y la política «production team
-- updates products» (20260725030000, ~1298-1302) deja pasar al staff: un PATCH a
-- /rest/v1/products cambiaba el stock sin movimiento de inventario, sin
-- auditoría y sin el recálculo de `available`.
-- Quién lo usa (verificado 2026-10-21): nadie. js/ no tiene ningún
-- `.from('products').update(` ni PATCH a products; el Panel mueve stock por
-- `apply_inventory_movement`, `apply_commercial_catalog_batch` y las RPC pos_*,
-- todas SECURITY DEFINER (ninguna función INVOKER escribe products). El único
-- UPDATE directo de stock en scripts/ usa la clave de servicio
-- (scripts/recovery/verify-realtime.mjs). available, is_active y sort_order no
-- se tocan.
revoke update (stock) on table public.products from authenticated;
