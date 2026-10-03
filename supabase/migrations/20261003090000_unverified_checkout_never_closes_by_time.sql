-- TABA · UN CHECKOUT QUE NADIE VERIFICÓ NO SE CIERRA POR TIEMPO (PAY-PROBE-02 y PAY-PROBE-03)
--
-- QUÉ PASABA (reproducido sobre la rama con sus 208 migraciones, base local del gate)
--
--   Un checkout llega a Mercado Pago (tiene preferencia), el aviso del proveedor no se
--   procesa, el comprador no vuelve y la sesión vence. La alerta CHECKOUT_PROVIDER_UNVERIFIED
--   («llegó a Mercado Pago y venció sin confirmación del proveedor») se abre y el barrido de
--   verdad del proveedor pregunta. Si ninguna respuesta prueba que no hubo pago —todos los
--   vacíos fueron NO concluyentes porque la conexión del vendedor cambió (20261002060000), o
--   la sonda nunca llegó a responder—, a las 48 horas:
--
--     · la condición de la alerta tenía `cs.created_at > now() - 48 horas`, así que dejaba de
--       cumplirse y reconcile_operational_alerts_for_business la cerraba sola con «Condición
--       ausente en la reconciliación automática.»;
--     · el barrido tenía la misma ventana y dejaba de preguntar.
--
--   Medido: a las 47 horas las dos alertas abiertas; a las 49 horas las dos resueltas por el
--   sistema y ninguna sonda encolada. Un estado en el que pudo haberse movido dinero quedaba
--   cerrado como si no hubiera pasado nada: es el mismo final silencioso que PAY-PROBE-01
--   corrigió para los vacíos, corrido 48 horas más tarde (PAY-PROBE-02).
--
--   Y un caso que no tenía ninguna alerta (PAY-PROBE-03): el comprador paga con tarjeta y
--   Mercado Pago deja el pago en revisión manual (`in_process`, puede tardar más de dos días
--   hábiles). La sesión vence, el stock se libera y el intent queda «expired» con el pago
--   guardado. La alerta de checkout sin verificar exige que NO haya pago guardado, así que
--   no lo ve nunca, y pasadas las 48 horas el barrido deja de releerlo: si el proveedor lo
--   aprueba al tercer día y el aviso no llega, cobro sin pedido y sin señal. Medido: ninguna
--   alerta a las 47 ni a las 49 horas, y ninguna sonda a las 49.
--
-- QUÉ CAMBIA
--
--   · CHECKOUT_PROVIDER_UNVERIFIED no se cierra por tiempo. Dentro de las 48 horas, igual que
--     antes: la cierra una prueba, y una resolución a mano la reabre la corrida siguiente.
--     Pasada la ventana sigue abierta hasta que la cierre una PRUEBA (sin pago guardado, un
--     vacío concluyente; el resultado final del proveedor; el pedido) o una PERSONA: el dueño
--     o un encargado activo que, pasada la ventana, la da por resuelta con su nota
--     (transition_operational_alert). Esa resolución vale mientras el pago que esa persona
--     tenía a la vista siga igual: la evidencia de la alerta guarda el pago sin resultado final
--     y su estado (o ninguno); otro pago, otro estado o un pago donde no había ninguno la
--     reabren, y una relectura igual no (lo posterior a la revisión manda, como en
--     PAYMENT_NEEDS_REVIEW, sin depender de horas). La resolución de un empleado no cuenta (no
--     ve el cobro).
--   · Pasada la ventana, «sin verificar» incluye también un pago que el proveedor todavía no
--     resolvió (`pending`, `in_process`, `authorized`, la misma lista que el registro de
--     pagos trata como no final), sea el que el cobro tiene guardado u OTRO de la misma
--     preferencia: si el comprador reintentó y el guardado es un rechazo, el primero puede
--     seguir en revisión manual en Mercado Pago. Se mira el último estado de cada pago y la
--     sonda relee el que sigue sin resolver por su id. Para ese caso un vacío no prueba nada:
--     la sonda empieza a los 90 segundos, antes de que el comprador pague, y con el pago
--     guardado lo lee por su id y no vuelve a anotar vacíos; el vacío que haya es de antes del
--     pago. Se cierra cuando el proveedor da un resultado final: un rechazo o una cancelación
--     (no hubo dinero) o una aprobación, que el registro de pagos manda a revisión con su
--     propia alerta. La evidencia de la alerta dice el estado del proveedor.
--   · El barrido no abandona esos checkouts: pasadas las 48 horas, una sonda por día hasta los
--     30 días, contada desde la última pregunta (un vacío o un trabajo encolado, aunque haya
--     fallado). Lo mismo para un checkout cuyo pago guardado fue rechazado o cancelado: la
--     búsqueda por la referencia externa prefiere un pago aprobado, así que un pago anterior
--     cuyos avisos se perdieron y que se aprueba tarde aparece en la búsqueda del día. La
--     resolución de una persona cierra la alerta, no la sonda: se sigue preguntando. Lo que
--     pasó la ventana va con un cupo propio por corrida (un quinto del límite), así que una
--     tanda que vence junta (después de un corte del planificador o del worker) no demora a
--     los checkouts de las últimas 48 horas, que siguen primero. Si el
--     pago aparece o se resuelve, el worker lo asienta por el camino de siempre y lo toman las
--     alertas de cobro aprobado sin pedido o de revisión, que no tienen ventana.
--   · Una marca de agua por entorno (`private.payment_safety_watermarks`, escrita al aplicar:
--     ahora menos 48 horas): todo checkout que todavía estaba dentro de la ventana cuando esto
--     se aplica queda vigilado; lo anterior no se resucita como alertas críticas y lo sigue
--     mostrando la conciliación (scripts/payments/reconcile-payments.mjs). Sin la fila, la
--     marca vale «desde siempre»: ante la duda, se avisa.
--   · El costo por minuto no crece con la historia: el barrido y la alerta filtran primero lo
--     barato (fechas, estados, el reloj leído una vez) y las funciones auxiliares corren sólo
--     sobre lo que queda. Pasados los 30 días de sondas, un checkout se mira sólo mientras su
--     alerta siga viva (abierta, reconocida o resuelta por una persona) o, con un pago guardado
--     con resultado final, si otro pago suyo sin resultado se asentó en los últimos 30 días (la
--     alerta se abre en la corrida siguiente al asiento y después la sostiene su alerta viva): la
--     reconciliación lee esos asientos por un índice parcial por fecha, no toda la historia de la
--     plataforma. El barrido descarta por índice lo ya preguntado en las últimas 24 horas antes
--     de evaluar el ritmo de cada fila.
--
-- QUÉ NO CAMBIA
--
--   · Firmas, SECURITY DEFINER, search_path y permisos (el barrido y la reconciliación, sólo
--     service_role; las auxiliares, ningún rol de cliente). El envoltorio de la frontera HTTP
--     del barrido (20261002090000) queda letra por letra.
--   · Qué es un vacío concluyente, la ventana de 48 horas y su ritmo (8 + 2/6/24 horas, 30
--     minutos para un no concluyente), y todas las demás ramas de la reconciliación.
--   · Ninguna fila existente: no se escribe ni se borra nada fuera de la marca de agua.
--   · Costo para el proveedor: a lo sumo una consulta por día, durante 30 días, por checkout
--     sin verificar o con el pago guardado rechazado o cancelado. Tres índices parciales: el de
--     una sola clase de trabajo de la cola y dos de los asientos de pagos sin resultado final
--     (por cobro y por fecha).
--
-- Prueba: supabase/tests/unverified_checkout_never_closes_by_time_test.sql
-- Generada de las definiciones vivas (pg_get_functiondef) con reemplazos que tienen que
-- coincidir exactamente una vez; se niega a correr si alguna de las tres ya no tiene el
-- cuerpo del que se generó. Forward-only. Reversión:
--   docs/migrations/rollback/20261003090000_unverified_checkout_never_closes_by_time.rollback.sql

do $generated_from_guard$
declare
  v_row record;
  v_actual text;
begin
  for v_row in
    select * from (values
      ('private.provider_probe_is_due(uuid,timestamptz)', '527187a827aa6abe0abb832be820da39', '43efcbc2c2c4dc344d1965a6ce29b60b'),
      ('public.enqueue_checkout_provider_probes(integer)', '24eb443ab5e712f436f17a4d67803686', '99d062259616cb67e24a16ebe0dc3e34'),
      ('public.reconcile_operational_alerts_for_business(uuid)', 'dfb440ae088f4674986af94183463e78', '40673b9efadd1f5550db1658b17b5db3')
    ) as t(signature, generated_from, applied)
  loop
    select md5(replace(p.prosrc, E'\r', '')) into v_actual
      from pg_proc p where p.oid = to_regprocedure(v_row.signature);
    if v_actual is null or v_actual not in (v_row.generated_from, v_row.applied) then
      raise exception 'ROLLOUT_BLOCKED: % no tiene el cuerpo del que se generó 20261003090000; otra migración la redefinió: regenerar sobre la definición vigente', v_row.signature
        using errcode = 'P0001';
    end if;
  end loop;
end
$generated_from_guard$;

-- ── 1. La marca de agua de cada entorno ─────────────────────────────────────
create table if not exists private.payment_safety_watermarks (
  name text primary key,
  since timestamptz not null,
  recorded_at timestamptz not null default clock_timestamp(),
  constraint payment_safety_watermarks_name_format check (name ~ '^[a-z_]{3,60}$')
);
alter table private.payment_safety_watermarks enable row level security;
revoke all on table private.payment_safety_watermarks from public, anon, authenticated;

comment on table private.payment_safety_watermarks is
  'Desde cuándo rige cada garantía de pagos en este entorno. unverified_checkout_watch_since: los checkouts creados después siguen vigilados pasada la ventana de 48 horas (20261003090000).';

insert into private.payment_safety_watermarks (name, since)
values ('unverified_checkout_watch_since', clock_timestamp() - interval '48 hours')
on conflict (name) do nothing;

create or replace function private.unverified_checkout_watch_since()
returns timestamptz
language sql
stable
set search_path = pg_catalog, pg_temp
as $function$
  -- Sin la fila, «desde siempre»: ante la duda, se avisa.
  select coalesce(
    (select w.since from private.payment_safety_watermarks w where w.name = 'unverified_checkout_watch_since'),
    '-infinity'::timestamptz
  )
$function$;

revoke all on function private.unverified_checkout_watch_since() from public, anon, authenticated, service_role;
comment on function private.unverified_checkout_watch_since() is
  'Desde cuándo un checkout sin verificar sigue vigilado pasada la ventana de 48 horas en este entorno (20261003090000).';

-- ── 2. «Una persona la dio por resuelta, y el proveedor no dijo nada nuevo» ──
-- La alerta está resuelta y quien la resolvió (transition_operational_alert pide una nota) es hoy
-- dueño o encargado activo del negocio. Vale mientras el pago que esa persona tenía a la vista siga
-- igual. Lo que vio es la evidencia de la alerta, que la reconciliación deja de refrescar cuando la
-- alerta queda resuelta: el pago sin resultado final que había (`unresolved_provider_payment_id`) y su
-- estado (`provider_status`), o ninguno. Si hoy es otro pago, otro estado, o aparece un pago donde no
-- había ninguno, la resolución deja de valer y la alerta se reabre. Una relectura igual no la reabre.
-- Es la regla de PAYMENT_NEEDS_REVIEW (lo posterior a la revisión manda) sin horas de por medio: un
-- pago asentado después del último refresco de la evidencia, o confirmado después, también es nuevo.
-- Se mira el estado vigente de la alerta y no la historia: cuando la reconciliación la reabre, borra
-- su autor y la resolución vieja deja de contar. La alerta se busca por su huella
-- (negocio:código:sujeto), la misma de la reconciliación, por el índice único.
create or replace function private.unverified_checkout_review_holds(
  p_business_id uuid, p_payment_intent_id uuid, p_provider_payment_id text, p_provider_status text)
returns boolean
language sql
stable
set search_path = pg_catalog, public, extensions, pg_temp
as $function$
  select exists (
    select 1
      from public.operational_alerts a
      join public.business_members bm
        on bm.business_id = a.business_id
       and bm.user_id = a.resolved_by
       and bm.role in ('owner', 'admin')
       and bm.is_active
     where a.business_id = p_business_id
       and a.fingerprint = encode(digest(
             p_business_id::text || ':CHECKOUT_PROVIDER_UNVERIFIED:' || p_payment_intent_id::text, 'sha256'), 'hex')
       and a.status = 'resolved'
       and a.resolved_at is not null
       and a.evidence ->> 'unresolved_provider_payment_id' is not distinct from p_provider_payment_id
       and a.evidence ->> 'provider_status' is not distinct from p_provider_status
  )
$function$;

revoke all on function private.unverified_checkout_review_holds(uuid, uuid, text, text) from public, anon, authenticated, service_role;
comment on function private.unverified_checkout_review_holds(uuid, uuid, text, text) is
  'Si la alerta CHECKOUT_PROVIDER_UNVERIFIED de ese cobro está resuelta por el dueño o un encargado activo y el pago sin resultado final que su evidencia mostraba (o ninguno) es el mismo que hoy, con el mismo estado (20261003090000). La reconciliación la consulta sólo pasada la ventana de 48 horas.';

-- El ritmo diario lee el último trabajo de sonda de cada cobro: sin este índice sería una
-- lectura de toda la cola por candidato y por minuto.
create index if not exists payment_outbox_reconcile_history_idx
  on public.payment_outbox (payment_intent_id, created_at desc)
  where topic = 'payment_reconcile';

-- ── 3. El pago del proveedor que sigue sin resultado final ───────────────────
-- El cobro guarda UN pago del proveedor (el más nuevo, salvo uno aprobado). Si el comprador
-- reintenta en la misma preferencia, el guardado puede ser un rechazo mientras el primero sigue
-- en revisión manual en Mercado Pago. Acá se mira cada pago por separado: su último estado
-- conocido (por la hora del proveedor; a igual hora, el último asentado), y de los que siguen
-- sin resultado final (pending, in_process, authorized) el más nuevo.
create or replace function private.unresolved_provider_payment(p_payment_intent_id uuid)
returns table (provider_payment_id text, provider_status text)
language sql
stable
set search_path = pg_catalog, public, pg_temp
as $function$
  select ultimo.provider_event_id, ultimo.provider_status
    from (
      select distinct on (pe.provider_event_id)
             pe.provider_event_id, pe.provider_status,
             coalesce(pe.provider_occurred_at, pe.server_recorded_at) as cuando, pe.sequence
        from public.payment_events pe
       where pe.payment_intent_id = p_payment_intent_id
         and pe.provider_event_id is not null
         and pe.provider_status is not null
       order by pe.provider_event_id, coalesce(pe.provider_occurred_at, pe.server_recorded_at) desc, pe.sequence desc
    ) ultimo
   where ultimo.provider_status in ('pending', 'in_process', 'authorized')
   order by ultimo.cuando desc, ultimo.sequence desc
   limit 1
$function$;

revoke all on function private.unresolved_provider_payment(uuid) from public, anon, authenticated, service_role;
comment on function private.unresolved_provider_payment(uuid) is
  'El pago del proveedor de ese cobro que sigue sin resultado final (pending, in_process, authorized) según su último evento, aunque el cobro tenga guardado otro pago con resultado final (20261003090000). Ninguno: cero filas.';

-- Los asientos de un pago que el proveedor todavía no resolvió son pocos: este índice deja
-- preguntar «¿este cobro tuvo alguna vez un pago sin resultado final?» sin leer el resto del rastro.
create index if not exists payment_events_unresolved_payment_idx
  on public.payment_events (payment_intent_id)
  where provider_event_id is not null and provider_status in ('pending', 'in_process', 'authorized');

-- Los mismos asientos por fecha: la reconciliación pregunta «¿qué cobros tuvieron un pago sin
-- resultado final asentado en los últimos 30 días?» leyendo sólo lo reciente, no toda la historia
-- de la plataforma (corre por negocio y por minuto).
create index if not exists payment_events_unresolved_recent_idx
  on public.payment_events (server_recorded_at)
  where provider_event_id is not null and provider_status in ('pending', 'in_process', 'authorized');

-- ── 4. Los checkouts sin verificar de un negocio ────────────────────────────
-- La rama CHECKOUT_PROVIDER_UNVERIFIED de la reconciliación, por etapas para que el costo no
-- crezca con la historia (la reconciliación corre por negocio y por minuto): primero lo barato
-- (el reloj leído una vez, estados y fechas), después la prueba de no-pago sobre lo que queda,
-- y la resolución de una persona sólo sobre lo que pasó la ventana.
create or replace function private.unverified_checkout_findings(p_business_id uuid)
returns table (
  payment_intent_id uuid,
  correlation_id uuid,
  checkout_session_id uuid,
  external_reference text,
  probe_window_closed boolean,
  internal_status text,
  provider_status text,
  unresolved_provider_payment_id text,
  empty_probes integer
)
language sql
stable
set search_path = pg_catalog, public, extensions, pg_temp
as $function$
  with reloj as materialized (
    select clock_timestamp() as ahora, private.unverified_checkout_watch_since() as vigilado_desde
  ),
  -- Las alertas de este negocio que siguen vivas: abiertas, reconocidas o resueltas por una
  -- persona (una novedad del proveedor las reabre). Una cerrada por el sistema con una prueba
  -- no vuelve por acá.
  alertas_vivas as materialized (
    select a.subject_id
      from public.operational_alerts a
     where a.business_id = p_business_id
       and a.alert_code = 'CHECKOUT_PROVIDER_UNVERIFIED'
       and (a.status <> 'resolved' or a.resolved_by is not null)
  ),
  candidatos as materialized (
    select pi.id, pi.correlation_id, pi.checkout_session_id, pi.external_reference,
           pi.internal_status, pi.provider_payment_id, pi.provider_status,
           cs.created_at <= r.ahora - interval '48 hours' as fuera_de_ventana
      from reloj r
      cross join public.payment_intents pi
      join public.checkout_sessions cs on cs.id = pi.checkout_session_id
     where pi.business_id = p_business_id
       and pi.order_id is null
       and cs.completed_order_id is null
       and nullif(btrim(coalesce(pi.preference_id, '')), '') is not null
       and pi.internal_status in ('expired', 'redirected', 'pending', 'in_process', 'preference_created')
       and cs.expires_at < r.ahora - interval '20 minutes'
       and (
         -- Dentro de las 48 horas de la sonda, como siempre: sin pago del proveedor.
         (cs.created_at > r.ahora - interval '48 hours' and pi.provider_payment_id is null)
         -- Pasada la ventana, lo posterior a la marca de agua de este entorno: lo anterior lo
         -- sigue mostrando la conciliación (scripts/payments/reconcile-payments.mjs).
         or (
           cs.created_at <= r.ahora - interval '48 hours'
           and cs.created_at > r.vigilado_desde
           and (
             -- Un pago que el proveedor todavía no resolvió (pendiente o en revisión manual,
             -- que puede tardar más de dos días hábiles): la sesión venció y liberó el stock,
             -- y si el proveedor lo aprueba y el aviso no llega es un cobro sin pedido.
             pi.provider_status in ('pending', 'in_process', 'authorized')
             -- Un pago guardado con resultado final y otro del mismo cobro que estuvo sin resolver
             -- (el comprador reintentó en la misma preferencia): si ese otro pago se asentó en los
             -- últimos 30 días, aunque el checkout sea más viejo (la alerta se abre en la primera
             -- corrida del barrido sobre este negocio después del asiento: 30 días es también lo que
             -- 20261003092000 deja sin evaluar a un negocio cerrado y sin checkouts), y después
             -- mientras su alerta siga viva (abierta, reconocida o resuelta por una persona). Las dos
             -- preguntas son acotadas: las alertas de este negocio y los asientos sin resultado final de
             -- los últimos 30 días, por su índice por fecha (now(): la misma hora en toda la corrida, así
             -- la subconsulta se resuelve una sola vez). El costo no crece con la historia.
             or (pi.provider_payment_id is not null
                 and (pi.id in (select v.subject_id from alertas_vivas v)
                      or pi.id in (select pe.payment_intent_id from public.payment_events pe
                                    where pe.provider_event_id is not null
                                      and pe.provider_status in ('pending', 'in_process', 'authorized')
                                      and pe.server_recorded_at > now() - interval '30 days')))
             -- Sin pago: durante los 30 días en que el barrido lo sigue preguntando; después,
             -- mientras su alerta siga viva. Nunca se cierra por tiempo, y lo más viejo no se
             -- vuelve a leer entero en cada corrida.
             or (pi.provider_payment_id is null
                 and (cs.created_at > r.ahora - interval '30 days'
                      or pi.id in (select v.subject_id from alertas_vivas v)))
           )
         )
       )
  ),
  -- Pasada la ventana, con un pago guardado que ya tiene resultado final: ¿hay OTRO pago del
  -- mismo cobro que siga sin resultado? Sólo para estas filas, que son pocas.
  otro_pago as materialized (
    select c.id, u.provider_payment_id, u.provider_status
      from candidatos c
      cross join lateral private.unresolved_provider_payment(c.id) u
     where c.fuera_de_ventana
       and c.provider_payment_id is not null
       and c.provider_status not in ('pending', 'in_process', 'authorized')
  ),
  sin_prueba as materialized (
    select c.*, o.provider_payment_id as otro_pago_id, o.provider_status as otro_pago_estado
      from candidatos c
      left join otro_pago o on o.id = c.id
     where
       -- Con un pago guardado que el proveedor no resolvió, un vacío no prueba nada: la sonda
       -- empieza a los 90 segundos, antes del pago, y con el pago guardado lo lee por su id
       -- sin anotar vacíos. El vacío que haya es de antes del pago.
       (c.provider_payment_id is not null and c.provider_status in ('pending', 'in_process', 'authorized'))
       -- Lo mismo con otro pago del mismo cobro que sigue sin resultado final.
       or o.id is not null
       -- Sin pago, sólo un vacío CONCLUYENTE (buscado con la misma conexión del vendedor que
       -- creó la preferencia) dice que el comprador no pagó. Un vacío buscado con otra
       -- conexión no prueba nada (20261002060000). Los vacíos anteriores a esa migración no
       -- traen la marca y cuentan como concluyentes.
       or (c.provider_payment_id is null and not exists (
         select 1 from public.payment_events pe
          where pe.payment_intent_id = c.id
            and pe.event_type = 'payment.provider_probe_empty'
            and coalesce((pe.details ->> 'conclusive')::boolean, true)
       ))
  ),
  -- El pago a buscar y su estado: el que va en la evidencia y contra el que se compara una resolución.
  con_pago as (
    select s.*,
           coalesce(s.otro_pago_estado, s.provider_status) as estado_a_la_vista,
           coalesce(s.otro_pago_id,
                    case when s.provider_status in ('pending', 'in_process', 'authorized') then s.provider_payment_id end)
             as pago_a_la_vista
      from sin_prueba s
  )
  select c.id, c.correlation_id, c.checkout_session_id, c.external_reference, c.fuera_de_ventana,
         c.internal_status, c.estado_a_la_vista, c.pago_a_la_vista,
         (select count(*)::integer from public.payment_events pe
           where pe.payment_intent_id = c.id
             and pe.event_type = 'payment.provider_probe_empty')
    from con_pago c
   -- Dentro de la ventana, una resolución a mano no la cierra (la corrida siguiente la reabre,
   -- como siempre). Pasada la ventana, la cierra el dueño o un encargado activo mientras el pago
   -- que tenía a la vista siga igual.
   where not c.fuera_de_ventana
      or not private.unverified_checkout_review_holds(p_business_id, c.id, c.pago_a_la_vista, c.estado_a_la_vista)
$function$;

revoke all on function private.unverified_checkout_findings(uuid) from public, anon, authenticated, service_role;
comment on function private.unverified_checkout_findings(uuid) is
  'Checkouts de un negocio que llegaron a Mercado Pago, vencieron y nadie verificó: sin pago del proveedor y sin un vacío concluyente, o, pasadas las 48 horas, con un pago (el guardado u otro de la misma preferencia) que el proveedor no resolvió. Pasada la ventana no se cierran por tiempo: los cierra una prueba o el dueño o un encargado activo, hasta que el proveedor diga algo nuevo (20261003090000). Sólo la usa reconcile_operational_alerts_for_business.';

-- ── 4. La sonda: cada cuánto, pasada la ventana ─────────────────────────────
CREATE OR REPLACE FUNCTION private.provider_probe_is_due(p_payment_intent_id uuid, p_session_created_at timestamp with time zone)
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
  with vacios as (
    select count(*) filter (where coalesce((pe.details ->> 'conclusive')::boolean, true)) as concluyentes,
           max(pe.server_recorded_at) as ultimo,
           (array_agg(coalesce((pe.details ->> 'conclusive')::boolean, true)
              order by pe.server_recorded_at desc, pe.sequence desc))[1] as ultimo_concluyente
      from public.payment_events pe
     where pe.payment_intent_id = p_payment_intent_id
       and pe.event_type = 'payment.provider_probe_empty'
  )
  select case
           -- Pasada la ventana de 48 horas (20261003090000) sólo llegan acá los checkouts que
           -- siguen sin verificar (lo filtra enqueue_checkout_provider_probes): una sonda por
           -- día, contada desde la última pregunta —un vacío o un trabajo encolado, aunque
           -- haya fallado— para que un proveedor caído no se convierta en un trabajo por minuto.
           when p_session_created_at <= clock_timestamp() - interval '48 hours' then
             coalesce(greatest(v.ultimo, (
               select max(po.created_at)
                 from public.payment_outbox po
                where po.payment_intent_id = p_payment_intent_id
                  and po.topic = 'payment_reconcile'
             )), '-infinity'::timestamptz) <= clock_timestamp() - interval '24 hours'
           when v.ultimo is null then true
           when v.ultimo > clock_timestamp() - interval '2 minutes' then false
           when not v.ultimo_concluyente and v.ultimo > clock_timestamp() - interval '30 minutes' then false
           when v.concluyentes < 8 then true
           when v.concluyentes = 8 then p_session_created_at <= clock_timestamp() - interval '2 hours'
           when v.concluyentes = 9 then p_session_created_at <= clock_timestamp() - interval '6 hours'
           when v.concluyentes = 10 then p_session_created_at <= clock_timestamp() - interval '24 hours'
           else false
         end
    from vacios v
$function$;

revoke all on function private.provider_probe_is_due(uuid,timestamptz) from public, anon, authenticated, service_role;
comment on function private.provider_probe_is_due(uuid,timestamptz) is
  'Si toca volver a preguntarle al proveedor por un checkout: 8 vacíos concluyentes cada 2 minutos, tres tardíos a las 2, 6 y 24 horas, un vacío no concluyente espera 30 minutos sin gastar el tope (20261002060000) y, pasadas las 48 horas, una sonda por día para el checkout que sigue sin verificar (20261003090000).';

-- ── 5. El barrido: un checkout sin verificar no se abandona a las 48 horas ──
CREATE OR REPLACE FUNCTION public.enqueue_checkout_provider_probes(p_limit integer DEFAULT 50)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
declare
  -- la-taba:api-boundary v1: 55000 -> 409 y P0002 -> 404 sólo por la API (request.method) y sólo en el marco más externo.
  -- El cuerpo de la función es el bloque anidado, letra por letra. Generado por scripts/db/wrap-api-boundary.mjs.
  _api_state text;
  _api_message text;
  _api_detail text;
  _api_hint text;
  _api_context text;
begin

declare
  v_inserted integer;
begin
  with
  -- Por etapas (20261003090000): el reloj se lee una vez y lo barato va primero —fechas y
  -- estados—; la prueba de no-pago corre sobre lo que queda, y el ritmo de la sonda (una
  -- función por fila) sólo sobre lo que sigue sin verificar. El costo por minuto no crece
  -- con la historia de checkouts abandonados.
  reloj as materialized (
    select clock_timestamp() as ahora, private.unverified_checkout_watch_since() as vigilado_desde
  ),
  ventana as materialized (
    select pi.id, pi.provider_payment_id, pi.provider_status, cs.created_at,
           cs.created_at <= r.ahora - interval '48 hours' as fuera_de_ventana
      from reloj r
      cross join public.payment_intents pi
      join public.checkout_sessions cs on cs.id = pi.checkout_session_id
     where cs.completed_order_id is null
       and pi.order_id is null
       -- El comprador llego a ver Mercado Pago: sin preferencia no hay nada que
       -- preguntar, porque nunca hubo donde pagar.
       and nullif(btrim(coalesce(pi.preference_id, '')), '') is not null
       and nullif(btrim(coalesce(pi.external_reference, '')), '') is not null
       and pi.internal_status not in (
         'completed', 'refunded', 'partially_refunded', 'charged_back',
         'security_review_required'
       )
       and cs.created_at < r.ahora - interval '90 seconds'
       and cs.created_at > r.ahora - interval '30 days'
       -- 48 horas de sondas, como siempre, con la misma ventana que la alerta
       -- CHECKOUT_PROVIDER_UNVERIFIED. Pasada esa ventana, y hasta los 30 días, un checkout
       -- que llegó a Mercado Pago y sigue SIN VERIFICAR no se abandona: una sonda por día
       -- (20261003090000). La alerta de esos mismos checkouts tampoco se cierra por tiempo,
       -- así que ningún «no sabemos» queda sin que nadie lo consulte.
       and (
         cs.created_at > r.ahora - interval '48 hours'
         -- Sin pago del proveedor, con un pago que el proveedor todavía no resolvió (pendiente o
         -- en revisión), o con uno guardado con resultado final y OTRO de la misma preferencia
         -- sin resolver: las tres cosas pueden terminar en dinero cobrado (abajo se distinguen).
         or (
           cs.created_at > r.vigilado_desde
           and pi.internal_status in ('expired', 'redirected', 'pending', 'in_process', 'preference_created')
         )
       )
  ),
  -- Pasada la ventana, con un pago guardado que ya tiene resultado final: ¿hay otro pago del
  -- mismo cobro que siga sin resultado? Sólo para estas filas, que son pocas.
  otro_pago as materialized (
    select v.id, u.provider_payment_id
      from ventana v
      cross join lateral private.unresolved_provider_payment(v.id) u
     where v.fuera_de_ventana
       and v.provider_payment_id is not null
       and v.provider_status not in ('pending', 'in_process', 'authorized')
       and v.id in (select pe.payment_intent_id from public.payment_events pe
                     where pe.provider_event_id is not null
                       and pe.provider_status in ('pending', 'in_process', 'authorized'))
  ),
  sin_verificar as materialized (
    select v.*, o.provider_payment_id as otro_pago_id
      from ventana v
      left join otro_pago o on o.id = v.id
     where not v.fuera_de_ventana
        -- Con un pago guardado que el proveedor no resolvió, un vacío no prueba nada: es de
        -- antes del pago (la sonda empieza a los 90 segundos y, con el pago guardado, lo lee
        -- por su id sin anotar vacíos). Lo mismo con otro pago del cobro sin resultado final.
        or (v.provider_payment_id is not null and v.provider_status in ('pending', 'in_process', 'authorized'))
        or o.id is not null
        -- Con el pago guardado rechazado o cancelado, la sonda busca por la referencia externa,
        -- que prefiere un pago aprobado: un pago anterior que nunca se asentó (sus avisos se
        -- perdieron) y se aprueba tarde aparece en la búsqueda del día.
        or v.provider_status in ('rejected', 'cancelled', 'canceled')
        -- Sin pago, un vacío concluyente prueba que el comprador no pagó.
        or (v.provider_payment_id is null and not exists (
          select 1 from public.payment_events pe
           where pe.payment_intent_id = v.id
             and pe.event_type = 'payment.provider_probe_empty'
             and coalesce((pe.details ->> 'conclusive')::boolean, true)
        ))
  ),
  -- La resolución del dueño o de un encargado cierra la alerta, no la sonda: se sigue
  -- preguntando una vez por día hasta los 30 días.
  -- Cada clase con su cupo: lo de las últimas 48 horas primero, con el límite entero (el
  -- comprador puede estar pagando ahora mismo), y lo que pasó la ventana con un cupo propio de
  -- un quinto del límite, para que una tanda que vence junta (después de un corte del
  -- planificador o del worker) no demore a los checkouts nuevos ni llene la cola del worker
  -- delante de los avisos (20261003090000).
  dentro as (
    select s.id, s.provider_payment_id, s.provider_status, s.otro_pago_id
      from sin_verificar s
     where not s.fuera_de_ventana
       and not exists (
         select 1 from public.payment_outbox po
          where po.payment_intent_id = s.id
            and po.topic = 'payment_reconcile'
            and po.status in ('pending', 'claimed', 'processing', 'retry_wait')
       )
       -- Hasta 8 vacíos CONCLUYENTES, uno cada 2 minutos, como antes. Después, tres
       -- sondas tardías (a las 2, 6 y 24 horas del checkout): un vacío temprano no
       -- prueba que no haya pago — el índice de búsqueda del proveedor puede venir
       -- atrasado y la conexión del vendedor puede cambiar en el medio. Un vacío NO
       -- concluyente no gasta el tope, pero espera 30 minutos para volver a
       -- preguntar (20261002060000; medido en Staging: 8 vacíos en 30 minutos y un
       -- pago aprobado que la misma búsqueda encuentra después).
       and private.provider_probe_is_due(s.id, s.created_at)
     order by s.created_at
     limit greatest(1, least(coalesce(p_limit, 50), 200))
  ),
  -- Lo que pasó la ventana: una sonda por día, contada desde la última pregunta (un trabajo de
  -- sonda, en curso o terminado, o un vacío). Esa cuenta se hace acá, por los índices, y el cupo se
  -- corta ANTES de la función del ritmo: en una tanda que vence junta la función corre sólo sobre
  -- las filas del cupo, no sobre toda la tanda en cada corrida.
  fuera_previa as materialized (
    select s.id, s.provider_payment_id, s.provider_status, s.otro_pago_id, s.created_at
      from reloj r
      cross join sin_verificar s
     where s.fuera_de_ventana
       and not exists (
         select 1 from public.payment_outbox po
          where po.payment_intent_id = s.id
            and po.topic = 'payment_reconcile'
            and (po.status in ('pending', 'claimed', 'processing', 'retry_wait')
                 or po.created_at > r.ahora - interval '24 hours')
       )
       and not exists (
         select 1 from public.payment_events pe
          where pe.payment_intent_id = s.id
            and pe.event_type = 'payment.provider_probe_empty'
            and pe.server_recorded_at > r.ahora - interval '24 hours'
       )
     order by s.created_at
     limit greatest(1, least(coalesce(p_limit, 50), 200) / 5)
  ),
  fuera as (
    select f.id, f.provider_payment_id, f.provider_status, f.otro_pago_id
      from fuera_previa f
     where private.provider_probe_is_due(f.id, f.created_at)
  ),
  candidatos as (
    select * from dentro
    union all
    select * from fuera
  )
  insert into public.payment_outbox (payment_intent_id, topic, resource_id)
  -- Un pago rechazado o cancelado no es el que hay que volver a leer: el
  -- comprador pudo pagar con otro medio en la misma preferencia, y fijar el id
  -- rechazado en el trabajo dejaba a la sonda ciega al reintento.
  -- Esto solo NO alcanza. Con el trabajo sin `resource_id` el worker lee hoy
  -- `payment_intents.provider_payment_id`, que sigue siendo el pago rechazado;
  -- la busqueda por referencia externa (que prefiere un pago aprobado) empieza
  -- cuando el worker deja de usar ese id si el estado guardado es rechazado o
  -- cancelado. Hasta ese cambio la sonda se comporta igual que antes.
  select c.id, 'payment_reconcile',
         -- Pasada la ventana, si otro pago del mismo cobro sigue sin resultado final, la sonda
         -- relee ESE pago por su id (20261003090000).
         case when c.otro_pago_id is not null then c.otro_pago_id
              when c.provider_status in ('rejected', 'cancelled', 'canceled') then null
              else c.provider_payment_id end
    from candidatos c
  on conflict do nothing;
  get diagnostics v_inserted = row_count;
  return coalesce(v_inserted, 0);
end;
exception
  when sqlstate '55000' or sqlstate 'P0002' then
    get stacked diagnostics _api_state = returned_sqlstate, _api_message = message_text,
                            _api_detail = pg_exception_detail, _api_hint = pg_exception_hint;
    get diagnostics _api_context = pg_context;
    if nullif(pg_catalog.current_setting('request.method', true), '') is not null
       and pg_catalog.array_length(pg_catalog.string_to_array(_api_context, E'\n'), 1) = 1 then
      raise sqlstate 'PGRST' using
        message = pg_catalog.json_build_object('code', _api_state, 'message', _api_message,
                                               'details', nullif(_api_detail, ''), 'hint', nullif(_api_hint, ''))::text,
        detail = pg_catalog.json_build_object('status', case _api_state when 'P0002' then 404 else 409 end,
                                              'headers', pg_catalog.json_build_object())::text;
    end if;
    raise;
end;
$function$;

revoke all on function public.enqueue_checkout_provider_probes(integer) from public, anon, authenticated;
grant execute on function public.enqueue_checkout_provider_probes(integer) to service_role;
comment on function public.enqueue_checkout_provider_probes(integer) is
  'Encola una consulta al proveedor por cada checkout que llegó a Mercado Pago y todavía no es pedido. Acotada: 90 s de gracia, 8 vacíos concluyentes uno cada 2 minutos, tres sondas tardías a las 2, 6 y 24 horas, un vacío no concluyente espera 30 minutos, 48 horas en total; pasada esa ventana, el checkout que sigue sin verificar (sin pago y sin vacío concluyente, con un pago que el proveedor no resolvió, o con el pago guardado rechazado o cancelado) recibe una sonda por día hasta los 30 días, aunque una persona haya resuelto su alerta, con un cupo propio de un quinto del límite por corrida: lo de las últimas 48 horas va primero (20261003090000).';

-- ── 6. La alerta: no se cierra por tiempo ──────────────────────────────────
CREATE OR REPLACE FUNCTION public.reconcile_operational_alerts_for_business(p_business_id uuid)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'extensions', 'pg_temp'
AS $function$
declare
  v_finding record;
  v_alert_id uuid;
  v_previous_status text;
  v_previous_seen timestamptz;
  v_fingerprint text;
  v_seen text[] := '{}'::text[];
  v_count integer := 0;
  -- Lo mismo que mira la sonda externa: ¿el barrido corrió en los últimos 10 minutos?
  v_scheduler_alive boolean := coalesce((public.scheduler_heartbeat() ->> 'healthy')::boolean, false);
begin
  for v_finding in
    -- El planificador se lee UNA vez por reconciliación: lo consultan tres cláusulas
    -- y cada referencia a la función era otra lectura completa del historial.
    with scheduler as materialized (
      select * from public.list_scheduler_health()
    )
    select * from (
      select
        'CRITICAL'::text as severity,
        'PAYMENT_APPROVED_WITHOUT_ORDER'::text as alert_code,
        'payment_intent'::text as subject_type,
        pi.id as subject_id,
        pi.correlation_id,
        'Pago aprobado sin pedido operativo.'::text as summary,
        'Reconciliar el pago y finalizar el pedido; no cobrar nuevamente.'::text as required_action,
        jsonb_build_object('payment_intent_id', pi.id, 'status', pi.internal_status) as evidence
      from public.payment_intents pi
      where pi.business_id = p_business_id
        and pi.internal_status in ('approved','approved_order_pending')
        and pi.order_id is null
        -- Desde que el cobro se aprobó, no desde la última escritura del intent: una
        -- relectura del mismo pago reescribe `updated_at` y no puede cerrar la alerta.
        and coalesce(pi.approved_at, pi.updated_at) < clock_timestamp() - interval '5 minutes'

      union all

      select
        'ACTION_REQUIRED', 'PAYMENT_RECONCILIATION_REQUIRED', 'payment_intent',
        pi.id, pi.correlation_id,
        'Pago con resultado ambiguo o revisión de seguridad.',
        'Consultar el proveedor y comparar importe, moneda y referencia antes de continuar.',
        jsonb_build_object('payment_intent_id', pi.id, 'status', pi.internal_status)
      from public.payment_intents pi
      where pi.business_id = p_business_id
        and pi.internal_status in ('ambiguous','security_review_required')

      union all

      select
        'CRITICAL', 'CHECKOUT_PROVIDER_UNVERIFIED', 'payment_intent',
        u.payment_intent_id, u.correlation_id,
        'Checkout que llegó a Mercado Pago y venció sin confirmación del proveedor.',
        'Buscar el pago en Mercado Pago por la referencia externa; si existe, reembolsar o materializar el pedido. Si no existe, pasadas las 48 horas de sondas el dueño o un encargado la da por resuelta con una nota: no se cierra sola.',
        jsonb_build_object(
          'payment_intent_id', u.payment_intent_id,
          'checkout_session_id', u.checkout_session_id,
          'external_reference', u.external_reference,
          'probe_window_closed', u.probe_window_closed,
          'status', u.internal_status,
          'provider_status', u.provider_status,
          'unresolved_provider_payment_id', u.unresolved_provider_payment_id,
          'empty_probes', u.empty_probes
        )
      -- Sin pago del proveedor y sin un vacío concluyente; o, pasadas las 48 horas, con un
      -- pago (el guardado u otro de la misma preferencia) que el proveedor todavía no resolvió.
      -- Dentro de la ventana, como siempre. Pasada
      -- la ventana NO se cierra por tiempo: la cierra una prueba o el dueño o un encargado
      -- activo con su nota, hasta que el proveedor diga algo nuevo (20261003090000). Medido
      -- antes: a las 49 horas la reconciliación la daba por «condición ausente» y el barrido
      -- dejaba de preguntar.
      from private.unverified_checkout_findings(p_business_id) u

      union all

      select
        'ACTION_REQUIRED', 'ORDER_READY_WITHOUT_RIDER', 'order',
        o.id, o.correlation_id,
        'Pedido listo para entregar y sin Rider asignado.',
        'Asignar un Rider desde el Panel o avisar al cliente si la entrega se demora.',
        jsonb_build_object('order_id', o.id, 'public_code', o.public_code, 'ready_since', coalesce(o.ready_at, o.updated_at))
      from public.orders o
      where o.business_id = p_business_id
        and o.status = 'ready'
        and coalesce(o.fulfillment_type, o.delivery_mode) = 'delivery'
        and o.assigned_rider_user_id is null
        and coalesce(o.ready_at, o.updated_at) < clock_timestamp() - interval '15 minutes'

      union all

      select
        'ACTION_REQUIRED', 'STOCK_RESERVATION_STUCK', 'checkout_session',
        cs.id, cs.correlation_id,
        'Hay stock reservado por un checkout vencido que no se liberó.',
        'Verificar el barrido de expiración; el stock retenido no se puede vender.',
        jsonb_build_object('checkout_session_id', cs.id, 'expired_for', clock_timestamp() - cs.expires_at)
      from public.checkout_sessions cs
      where cs.business_id = p_business_id
        and exists (
          select 1 from public.inventory_reservations r
           where r.checkout_session_id = cs.id
             and r.status = 'active'
             and r.expires_at < clock_timestamp() - interval '5 minutes'
        )

      union all

      select
        'CRITICAL', 'FISCAL_AUTHORIZATION_AMBIGUOUS', 'fiscal_document',
        fd.id, fd.correlation_id,
        'La autorización fiscal es ambigua.',
        'Consultar ARCA por tipo, punto de venta y número; no volver a emitir a ciegas.',
        jsonb_build_object('fiscal_document_id', fd.id, 'state', fd.state)
      from public.fiscal_documents fd
      where fd.business_id = p_business_id and fd.state = 'ambiguous'

      union all

      select
        case when fo.state = 'dead_letter' then 'CRITICAL' else 'ACTION_REQUIRED' end,
        'FISCAL_OUTBOX_STALLED', 'fiscal_document',
        fd.id, fd.correlation_id,
        'La cola fiscal no progresa.',
        'Revisar conectividad y worker; conservar número e idempotencia antes de reintentar.',
        jsonb_build_object('fiscal_document_id', fd.id, 'outbox_state', fo.state, 'attempts', fo.attempt_count)
      from public.fiscal_outbox fo
      join public.fiscal_documents fd on fd.id = fo.fiscal_document_id
      where fd.business_id = p_business_id
        and (
          fo.state = 'dead_letter'
          or (fo.state in ('pending','retry_wait') and fo.next_attempt_at < clock_timestamp() - interval '15 minutes')
          or (fo.state = 'leased' and fo.lease_deadline < clock_timestamp())
        )

      union all

      select
        case when po.status = 'dead_letter' then 'CRITICAL' else 'ACTION_REQUIRED' end,
        'PAYMENT_OUTBOX_STALLED', 'payment_intent',
        pi.id, pi.correlation_id,
        'La cola de pagos no progresa.',
        'Revisar el worker y reconciliar con Mercado Pago usando la misma referencia.',
        jsonb_build_object('payment_intent_id', pi.id, 'outbox_status', po.status, 'attempts', po.attempts)
      from public.payment_outbox po
      join public.payment_intents pi on pi.id = po.payment_intent_id
      where pi.business_id = p_business_id
        and (
          po.status in ('failed','dead_letter')
          or (po.status in ('pending','retry_wait') and po.next_attempt_at < clock_timestamp() - interval '15 minutes')
          or (po.status in ('claimed','processing') and po.lease_expires_at < clock_timestamp())
        )

      union all

      select
        'ACTION_REQUIRED', 'FISCAL_ARTIFACT_STALLED', 'fiscal_document',
        fd.id, fd.correlation_id,
        'El PDF fiscal no está disponible.',
        'Revisar Storage y el worker de artefactos; no modificar el CAE autorizado.',
        jsonb_build_object('fiscal_document_id', fd.id, 'artifact_state', fd.artifact_state, 'outbox_state', fao.state)
      from public.fiscal_documents fd
      left join public.fiscal_artifact_outbox fao on fao.fiscal_document_id = fd.id
      where fd.business_id = p_business_id
        and fd.state = 'authorized'
        and fd.artifact_state in ('artifact_failed','artifact_pending','artifact_generating')
        and coalesce(fao.created_at, fd.authorized_at, fd.created_at) < clock_timestamp() - interval '10 minutes'

      union all

      select
        'ACTION_REQUIRED', 'PRINT_JOB_FAILED', 'print_job',
        pj.id, pj.correlation_id,
        'Una impresión fiscal falló o no pudo verificarse.',
        'Comprobar impresora y papel, abrir la vista previa y reimprimir sólo si corresponde.',
        jsonb_build_object('print_job_id', pj.id, 'status', pj.status, 'error_code', pj.error_code)
      from public.fiscal_print_jobs pj
      where pj.business_id = p_business_id and pj.status in ('failed','unknown')

      union all

      select
        'WARNING', 'RIDER_SIGNAL_STALE', 'order',
        o.id, o.correlation_id,
        'Rider sin señal reciente durante una entrega activa.',
        'Contactar al Rider y verificar el estado sin inventar una ubicación.',
        jsonb_build_object('order_id', o.id, 'status', o.status)
      from public.orders o
      left join lateral (
        select rl.created_at
        from public.rider_locations rl
        where rl.order_id = o.id
        order by rl.created_at desc
        limit 1
      ) last_location on true
      where o.business_id = p_business_id
        and o.status in ('assigned','picked_up','on_the_way','arrived')
        and coalesce(last_location.created_at, o.updated_at) < clock_timestamp() - interval '5 minutes'

      union all

      select
        shs.severity, shs.signal_code, 'service_health', shs.id,
        shs.correlation_id,
        'Un servicio operativo reportó estado degradado.',
        'Abrir diagnóstico y ejecutar el runbook indicado para el servicio.',
        jsonb_build_object('signal_id', shs.id, 'service', shs.service, 'status', shs.status)
      from public.service_health_signals shs
      where shs.business_id = p_business_id
        and shs.expires_at > clock_timestamp()
        and shs.status <> 'healthy'

      union all

      select
        'CRITICAL', 'PAYMENT_WORKER_IDLE', 'service_health',
        md5('payment_worker_idle')::uuid, null::uuid,
        'La cola de cobros tiene trabajo vencido y nadie lo está tomando.',
        'Confirmar cada pago en Mercado Pago antes de entregar; el procesamiento automático no está corriendo.',
        jsonb_build_object(
          'due_jobs', q.due_jobs,
          'oldest_due_minutes', round(q.oldest_due_minutes),
          'last_progress_at', q.last_touch
        )
      from (
        select
          count(*) as due_jobs,
          max(po.updated_at) as last_touch,
          extract(epoch from (
            clock_timestamp() - min(coalesce(po.next_attempt_at, po.lease_expires_at))
          )) / 60 as oldest_due_minutes
        from public.payment_outbox po
        join public.payment_intents pi on pi.id = po.payment_intent_id
        where pi.business_id = p_business_id
          and (
            (po.status in ('pending','retry_wait') and po.next_attempt_at < clock_timestamp() - interval '5 minutes')
            or (po.status in ('claimed','processing') and po.lease_expires_at < clock_timestamp() - interval '5 minutes')
          )
      ) q
      where q.due_jobs > 0
        and q.last_touch < clock_timestamp() - interval '5 minutes'

      union all

      select
        'CRITICAL', 'SCHEDULER_JOB_FAILING', 'service_health',
        md5(sh.job_name)::uuid, null::uuid,
        'Una tarea automática del sistema viene fallando.',
        'Revisar la configuración del servicio; mientras falle, los cobros y el stock dependen de que alguien mire el Panel.',
        jsonb_build_object(
          'job', sh.job_name,
          'schedule', sh.schedule,
          'failures_since_success', sh.failures_since_success,
          'last_success_at', sh.last_success_at
        )
      from scheduler sh
      where sh.active
        and sh.failures_since_success >= 3

      union all

      select
        'CRITICAL', 'SCHEDULER_JOB_STALLED', 'service_health',
        md5(sh.job_name || ':stalled')::uuid, null::uuid,
        'Una tarea automática del sistema dejó de ejecutarse.',
        'Revisar el estado del servicio; el stock reservado y los cobros pendientes no se están destrabando solos.',
        jsonb_build_object(
          'job', sh.job_name,
          'schedule', sh.schedule,
          'last_success_at', sh.last_success_at,
          'last_start', sh.last_start
        )
      from scheduler sh
      where sh.active
        -- El silencio tolerado sale de la programación de cada tarea (15 minutos para
        -- las de cada minuto, como siempre): una tarea horaria no está detenida a los
        -- 16 minutos de haber corrido.
        and coalesce(sh.last_success_at, '-infinity'::timestamptz)
            < clock_timestamp() - private.scheduler_job_stale_after(sh.schedule)
        -- ===== LA CORRECCIÓN =====
        -- Detenida exige haber estado en marcha alguna vez: o hubo un éxito, o
        -- lleva más de quince minutos arrancada sin terminar nunca —una tarea
        -- colgada, que sí hay que decir—. Una tarea que arrancó hace segundos y
        -- todavía no terminó no es ninguna de las dos: es una tarea nueva.
        and (
          sh.last_success_at is not null
          -- Una tarea del inventario que todavía no corrió nunca se mide desde que se
          -- la espera, no desde siempre: recién desplegada no es una tarea detenida.
          or coalesce(
               sh.last_start,
               (select e.expected_since from private.scheduler_expected_jobs e where e.job_name = sh.job_name),
               '-infinity'::timestamptz
             ) < clock_timestamp() - private.scheduler_job_stale_after(sh.schedule)
        )
        and sh.failures_since_success < 3
        and exists (
          select 1 from scheduler alive
           where alive.last_success_at > clock_timestamp() - interval '5 minutes'
        )

      union all

      select
        'ACTION_REQUIRED', 'ORDER_NOT_ACCEPTED', 'order',
        o.id, o.correlation_id,
        'Entró un pedido y todavía nadie lo aceptó.',
        'Abrí Pedidos y aceptalo o cancelalo; el cliente está esperando una respuesta.',
        jsonb_build_object(
          'order_id', o.id,
          'public_code', o.public_code,
          'waiting_minutes', round(extract(epoch from (clock_timestamp() - o.created_at)) / 60)
        )
      from public.orders o
      where o.business_id = p_business_id
        and o.status in ('submitted','received')
        and coalesce(o.origin, 'production') <> 'qa'
        and o.acknowledged_at is null
        and o.created_at < clock_timestamp() - interval '10 minutes'
        -- Sin horizonte de 24 horas: mientras el pedido siga abierto sigue reteniendo
        -- stock y alguien tiene que resolverlo. La alerta no vence sola; la cierra
        -- atender, cancelar o vencer el pedido.

      union all

      select
        'ACTION_REQUIRED', 'ORDER_STALLED', 'order',
        o.id, o.correlation_id,
        'Un pedido aceptado dejó de avanzar.',
        'Abrí Pedidos y movelo o avisale al cliente; pasó bastante del tiempo que le prometiste.',
        jsonb_build_object(
          'order_id', o.id,
          'public_code', o.public_code,
          'status', o.status,
          'promised_minutes', coalesce(o.preparation_estimate_minutes, 30),
          'stalled_minutes', round(extract(epoch from (
            clock_timestamp() - coalesce(o.acknowledged_at, o.created_at)
          )) / 60)
        )
      from public.orders o
      where o.business_id = p_business_id
        and o.status in ('accepted','preparing')
        and coalesce(o.origin, 'production') <> 'qa'
        and coalesce(o.acknowledged_at, o.created_at)
            + make_interval(mins => coalesce(o.preparation_estimate_minutes, 30) + 30)
            < clock_timestamp()
        -- Sin horizonte de 24 horas: mientras el pedido siga abierto sigue reteniendo
        -- stock y alguien tiene que resolverlo. La alerta no vence sola; la cierra
        -- atender, cancelar o vencer el pedido.

      -- ======================================================================
      --  NUEVO · Mercado Pago encendido y la cuenta vinculada no puede cobrar.
      -- ======================================================================
      --  El checkout ya lo retira solo: get_mercadopago_checkout_availability
      --  exige una conexión que pueda cobrar. Por eso mismo el cliente no ve
      --  nada roto y el local no se entera: «Mercado Pago» desaparece del
      --  checkout sin que nadie sepa por qué. Una sola alerta por negocio y
      --  entorno; la evidencia dice el estado de la conexión, nunca la cuenta
      --  ni una credencial.
      union all

      select
        'ACTION_REQUIRED', 'MERCADOPAGO_SELLER_CANNOT_CHARGE', 'service_health',
        md5('mercadopago_seller:' || s.business_id::text || ':' || s.environment)::uuid, null::uuid,
        'Mercado Pago está habilitado pero la cuenta vinculada no puede cobrar.',
        'Reconectá Mercado Pago desde el Panel. Mientras tanto el checkout no lo ofrece y el cobro manual sigue disponible.',
        jsonb_build_object(
          'environment', s.environment,
          'connection_status', case
            when c.business_id is null then 'missing'
            when c.status <> 'connected' then c.status
            when c.protected_tokens is null then 'without_credentials'
            else 'account_mismatch'
          end
        )
      from public.business_payment_settings s
      left join public.mp_seller_connections c
        on c.business_id = s.business_id
       and c.environment = s.environment
      where s.business_id = p_business_id
        and s.provider = 'mercadopago'
        and s.enabled
        and (
          c.business_id is null
          or c.status <> 'connected'
          or c.protected_tokens is null
          or c.seller_id is distinct from s.collector_id
          or c.application_id is distinct from s.application_id
        )

      -- ======================================================================
      --  NUEVO (20261002011000) · lo que hasta acá no levantaba ninguna alerta.
      --  Todo lo de abajo son ramas agregadas; las de arriba no se tocaron.
      -- ======================================================================

      -- Una tarea del inventario que no está programada. La salud del planificador
      -- arma su lista con lo que existe en `cron.job`: una tarea borrada dejaba de
      -- figurar y nada la echaba de menos. Sin pg_cron no hay contra qué comparar:
      -- ese caso lo dicen la sonda del vigilante y `get_ecommerce_health`.
      -- Como las otras dos alertas del planificador, la condición es de toda la
      -- plataforma y se anota una vez por negocio.
      union all

      select
        'CRITICAL', 'SCHEDULER_JOB_MISSING', 'service_health',
        md5(e.job_name || ':missing')::uuid, null::uuid,
        'Una tarea automática del sistema no está programada.',
        'Volver a programar la tarea; mientras falte, lo que hace no ocurre solo y depende de que alguien mire el Panel.',
        jsonb_build_object(
          'job', e.job_name,
          'purpose', e.purpose,
          'expected_since', e.expected_since
        )
      from private.scheduler_expected_jobs e
      where to_regclass('cron.job') is not null
        and to_regclass('cron.job_run_details') is not null
        and not exists (select 1 from scheduler sh where sh.job_name = e.job_name)

      -- Una tarea del inventario que existe pero está apagada. Las dos ramas de
      -- arriba filtran `sh.active`: una tarea apagada no figuraba ni fallando ni
      -- detenida, y apagar una tarea detenida CERRABA su alerta.
      union all

      select
        'CRITICAL', 'SCHEDULER_JOB_DISABLED', 'service_health',
        md5(sh.job_name || ':disabled')::uuid, null::uuid,
        'Una tarea automática del sistema está apagada.',
        'Volver a encender la tarea; mientras esté apagada, lo que hace no ocurre solo y depende de que alguien mire el Panel.',
        jsonb_build_object(
          'job', sh.job_name,
          'schedule', sh.schedule,
          'purpose', e.purpose,
          'last_success_at', sh.last_success_at
        )
      from scheduler sh
      join private.scheduler_expected_jobs e on e.job_name = sh.job_name
      where not sh.active

      -- Un aviso de Mercado Pago se encola SIN intento de pago (todavía no se sabe de
      -- qué checkout es) y la rama PAYMENT_OUTBOX_STALLED de arriba lo pierde en su
      -- JOIN. Su negocio es el del vendedor que lo recibió, igual que en
      -- `build_operational_health`. Mismos umbrales que la rama de arriba. El sujeto
      -- es el trabajo de la cola: no hay intento al que apuntar. Si el aviso habla de
      -- un pago que algún cobro del negocio ya conoce, lleva la correlación de ese
      -- cobro (la misma regla con la que la traza del pedido une avisos y cobros).
      union all

      select
        case when po.status = 'dead_letter' then 'CRITICAL' else 'ACTION_REQUIRED' end,
        'PAYMENT_OUTBOX_STALLED', 'payment_outbox',
        po.id,
        (select known.correlation_id
           from public.payment_intents known
          where known.business_id = p_business_id
            and known.provider = wr.provider
            and known.environment = wr.environment
            and known.provider_payment_id = po.resource_id),
        'La cola de pagos no progresa.',
        'Revisar el worker y buscar el pago en Mercado Pago por su identificador: el aviso llegó y todavía no se pudo procesar.',
        jsonb_build_object(
          'payment_outbox_id', po.id,
          'topic', po.topic,
          'outbox_status', po.status,
          'attempts', po.attempts,
          'webhook_receipt_id', po.webhook_receipt_id,
          'environment', wr.environment,
          'provider_resource_id', left(po.resource_id, 64)
        )
      from public.payment_outbox po
      join public.payment_webhook_receipts wr on wr.id = po.webhook_receipt_id
      where po.payment_intent_id is null
        and wr.seller_business_id = p_business_id
        and (
          po.status in ('failed','dead_letter')
          or (po.status in ('pending','retry_wait') and po.next_attempt_at < clock_timestamp() - interval '15 minutes')
          or (po.status in ('claimed','processing') and po.lease_expires_at < clock_timestamp())
        )

      -- Lo mismo para PAYMENT_WORKER_IDLE: los avisos del vendedor vencidos que nadie
      -- toma. Va con su propio sujeto para no pisar la cuenta de la rama de arriba,
      -- que sigue contando los trabajos con intento.
      union all

      select
        'CRITICAL', 'PAYMENT_WORKER_IDLE', 'service_health',
        md5('payment_worker_idle:provider_notifications')::uuid, null::uuid,
        'Hay avisos de Mercado Pago vencidos en la cola y nadie los está tomando.',
        'Confirmar cada pago en Mercado Pago antes de entregar; el procesamiento automático no está corriendo.',
        jsonb_build_object(
          'scope', 'provider_notifications',
          'due_jobs', q.due_jobs,
          'oldest_due_minutes', round(q.oldest_due_minutes),
          'last_progress_at', q.last_touch
        )
      from (
        select
          count(*) as due_jobs,
          max(po.updated_at) as last_touch,
          extract(epoch from (
            clock_timestamp() - min(coalesce(po.next_attempt_at, po.lease_expires_at))
          )) / 60 as oldest_due_minutes
        from public.payment_outbox po
        join public.payment_webhook_receipts wr on wr.id = po.webhook_receipt_id
        where po.payment_intent_id is null
          and wr.seller_business_id = p_business_id
          and (
            (po.status in ('pending','retry_wait') and po.next_attempt_at < clock_timestamp() - interval '5 minutes')
            or (po.status in ('claimed','processing') and po.lease_expires_at < clock_timestamp() - interval '5 minutes')
          )
      ) q
      where q.due_jobs > 0
        and q.last_touch < clock_timestamp() - interval '5 minutes'

      -- Una devolución que no terminó. `requested` no deja ningún trabajo en la cola
      -- (la fila nace antes de llamar al proveedor): si la llamada muere ahí, nada la
      -- mueve y bloquea cualquier otra devolución del mismo cobro. Los 15 minutos son
      -- un umbral técnico, no una regla del comercio: el mismo que la cola de pagos de
      -- arriba le da a un trabajo antes de decir que no progresa, y más que los cinco
      -- minutos después de los cuales `resolve_stuck_payment_refund` ya deja destrabar
      -- la solicitud (la llamada al proveedor se corta a los 12 segundos): cuando la
      -- alerta se abre, el destrabe ya está disponible. Se miden desde que se pidió, no
      -- desde el último reintento: un reintento no puede cerrar la alerta. No vence
      -- sola: se cierra cuando la devolución llega a un estado final (`approved`,
      -- `rejected` o `failed`; los tres dejan pedir otra).
      union all

      select
        'ACTION_REQUIRED', 'REFUND_NEEDS_ATTENTION', 'payment_refund',
        pr.id, pi.correlation_id,
        'Una devolución de dinero quedó a medias.',
        'Revisar en Mercado Pago si la devolución salió; no pedir otra por el mismo cobro hasta resolver ésta.',
        jsonb_build_object(
          'refund_id', pr.id,
          'payment_intent_id', pi.id,
          'order_id', pr.order_id,
          'status', pr.status,
          'waiting_minutes', round(extract(epoch from (clock_timestamp() - pr.requested_at)) / 60),
          'has_provider_identity', pr.provider_refund_id is not null,
          'resolution_mode', pr.resolution_mode
        )
      from public.payment_refunds pr
      join public.payment_intents pi on pi.id = pr.payment_intent_id
      where pi.business_id = p_business_id
        and pr.status in ('requested','processing','ambiguous')
        and pr.requested_at < clock_timestamp() - interval '15 minutes'

      -- Hechos de un cobro que hasta acá eran sólo una fila de `payment_events`: otro
      -- pago aprobado sobre el mismo checkout (el cliente pagó dos veces y el Panel
      -- sólo reembolsa el pago del pedido), una anomalía informada después de creado
      -- el pedido, o el proveedor informando reclamo o contracargo. Una alerta por
      -- cobro, con todos sus motivos; es crítica cuando hay un pago duplicado sin
      -- devolver. Cuándo deja de figurar cada motivo, en
      -- `private.payment_review_findings`; ninguno por tiempo.
      union all

      select
        case when r.duplicate_payment_ids is not null then 'CRITICAL' else 'ACTION_REQUIRED' end,
        'PAYMENT_NEEDS_REVIEW', 'payment_intent',
        r.payment_intent_id, r.correlation_id,
        case when r.duplicate_payment_ids is not null
          then 'El cliente pagó dos veces la misma compra en Mercado Pago.'
          else 'Un cobro de Mercado Pago necesita que una persona lo revise.' end,
        case when r.duplicate_payment_ids is not null
          then 'Devolver el pago duplicado desde el panel de Mercado Pago: desde el Panel sólo se reembolsa el pago del pedido. Se cierra sola cuando Mercado Pago informa la devolución.'
          else 'Abrir el pago en Mercado Pago y revisar el reclamo, el contracargo o la diferencia informada; después, el dueño o un encargado da esta alerta por resuelta con una nota.' end,
        jsonb_strip_nulls(jsonb_build_object(
          'payment_intent_id', r.payment_intent_id,
          'order_id', r.order_id,
          'provider_payment_id', r.provider_payment_id,
          'reasons', array_remove(array[
            case when r.duplicate_payment_ids is not null then 'duplicate_charge' end,
            case when r.anomaly_reasons is not null then 'post_completion_anomaly' end,
            case when r.dispute_provider_status is not null then 'provider_dispute' end
          ], null),
          'duplicate_provider_payment_ids', (r.duplicate_payment_ids)[1:5],
          'duplicate_payments', cardinality(r.duplicate_payment_ids),
          'anomaly_reasons', (r.anomaly_reasons)[1:5],
          'anomaly_provider_statuses', (r.anomaly_provider_statuses)[1:5],
          'provider_status', r.dispute_provider_status
        ))
      from private.payment_review_findings(p_business_id) r
    ) findings
  loop
    v_fingerprint := encode(digest(
      p_business_id::text || ':' || v_finding.alert_code || ':' || coalesce(v_finding.subject_id::text, 'none'),
      'sha256'
    ), 'hex');
    v_seen := array_append(v_seen, v_fingerprint);
    select status,last_seen_at into v_previous_status,v_previous_seen
    from public.operational_alerts
    where business_id = p_business_id and fingerprint = v_fingerprint
    for update;

    insert into public.operational_alerts(
      business_id, fingerprint, severity, alert_code, subject_type, subject_id,
      correlation_id, status, summary, required_action, evidence
    ) values (
      p_business_id, v_fingerprint, v_finding.severity,
      v_finding.alert_code, v_finding.subject_type, v_finding.subject_id,
      v_finding.correlation_id, 'open', v_finding.summary,
      v_finding.required_action, v_finding.evidence
    )
    on conflict (business_id, fingerprint) do update set
      severity = excluded.severity,
      correlation_id = excluded.correlation_id,
      status = case when operational_alerts.status = 'resolved' then 'open' else operational_alerts.status end,
      summary = excluded.summary,
      required_action = excluded.required_action,
      evidence = excluded.evidence,
      last_seen_at = clock_timestamp(),
      occurrence_count = operational_alerts.occurrence_count + case
        when operational_alerts.last_seen_at < clock_timestamp() - interval '1 minute' then 1 else 0 end,
      resolved_by = case when operational_alerts.status = 'resolved' then null else operational_alerts.resolved_by end,
      resolved_at = case when operational_alerts.status = 'resolved' then null else operational_alerts.resolved_at end,
      resolution_note = case when operational_alerts.status = 'resolved' then null else operational_alerts.resolution_note end,
      acknowledged_by = case when operational_alerts.status = 'resolved' then null else operational_alerts.acknowledged_by end,
      acknowledged_at = case when operational_alerts.status = 'resolved' then null else operational_alerts.acknowledged_at end,
      updated_at = clock_timestamp()
    returning id into v_alert_id;

    if v_previous_status is null or v_previous_status = 'resolved'
      or v_previous_seen < clock_timestamp() - interval '15 minutes' then
      insert into public.operational_alert_events(business_id, alert_id, event_type, detail)
      values (
        p_business_id,
        v_alert_id,
        case when v_previous_status is null then 'detected' when v_previous_status = 'resolved' then 'reopened' else 'redetected' end,
        jsonb_build_object('alert_code', v_finding.alert_code)
      );
    end if;
    v_count := v_count + 1;
  end loop;

  update public.operational_alerts
  set status = 'resolved', resolved_at = clock_timestamp(), resolution_note = 'Condición ausente en la reconciliación automática.', updated_at = clock_timestamp()
  where business_id = p_business_id
    and status <> 'resolved'
    and not (fingerprint = any(v_seen))
    -- SCHEDULER_WATCHDOG_STALE no la produce esta función: la escribe la sonda, y
    -- por eso nunca está entre lo visto. Mientras el barrido siga sin correr no es
    -- una «condición ausente»: se deja como está. Cuando vuelve, la cierran la
    -- sonda, el propio barrido o esta misma línea en la corrida siguiente.
    and not (alert_code = 'SCHEDULER_WATCHDOG_STALE' and not v_scheduler_alive);

  insert into public.operational_alert_events(business_id, alert_id, event_type, detail)
  select p_business_id, a.id, 'resolved', jsonb_build_object('resolution', 'automatic_condition_cleared')
  from public.operational_alerts a
  where a.business_id = p_business_id
    and a.status = 'resolved'
    and a.resolved_at >= transaction_timestamp()
    and a.resolved_by is null;

  return v_count;
end;
$function$;

revoke all on function public.reconcile_operational_alerts_for_business(uuid) from public, anon, authenticated;
grant execute on function public.reconcile_operational_alerts_for_business(uuid) to service_role;
comment on function public.reconcile_operational_alerts_for_business(uuid) is
  'Calcula y reconcilia las alertas operativas de un negocio SIN exigir sesion. Incluye Mercado Pago encendido con una cuenta de vendedor que no puede cobrar.';
