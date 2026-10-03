// CERTIFICACIÓN E-COMMERCE — el tenant de la corrida.
//
// Cada corrida crea y usa SU PROPIO negocio (`tenantIdentity` en env.mjs: en Staging,
// TABA_ECOMMERCE_FINAL_<fecha>_<hora>), y sólo vuelve a usar uno anterior cuando se lo
// piden por su slug (`--reuse-tenant`). Es un tenant QA (`qa_fixture`): la tienda sólo
// es visible mientras dura una ventana QA que abre el dueño, y si una corrida se corta,
// el barrido de la base lo cierra solo cuando la ventana vence. Al terminar queda
// cerrado, con los pedidos online deshabilitados y sus operadores suspendidos.
//
// NUNCA SE TOCA UN NEGOCIO QUE LA HERRAMIENTA NO CREÓ. Un negocio se reconoce como
// propio por construcción: `qa_fixture`, el nombre que le corresponde a su slug, todos
// sus miembros con el prefijo de correo del tenant en un dominio que no existe, sólo
// productos fixture y sólo pedidos y checkouts con la clave del certificador. Si algo de
// eso no se cumple, la corrida se frena y tampoco «limpia».
//
// QUIÉN ESCRIBE QUÉ
//   · `service_role` (anotado en la evidencia, propósito + acción + hora): crea el
//     negocio, crea/rehabilita identidades, la PRIMERA membresía de dueño (no hay
//     quién la apruebe), los datos maestros de los productos fixture, la
//     verificación de plataforma, y la limpieza de identidades.
//   · el DUEÑO, con su sesión y por las RPC reales del Panel: dirección, formas de
//     entrega, envío y mínimo, horarios, zonas, exigencias, publicación del
//     catálogo, stock, altas del equipo, abrir y cerrar.
//
// POR QUÉ LOS OPERADORES Y LOS PAGADORES NO SE BORRAN
//   Los recibos de comandos, la auditoría de configuración, los movimientos de
//   stock y las ofertas a riders guardan a su autor con ON DELETE RESTRICT, y una
//   sesión de checkout guarda igual a su cliente: quien operó un pedido o pagó por
//   Mercado Pago no se puede borrar de Auth. Esas identidades son persistentes
//   (`op-…`); entre corridas quedan sin sesión, con contraseña desconocida y con el
//   acceso suspendido. Los clientes de pedidos en efectivo y las identidades de prueba
//   de cada corrida sí se borran.
import { randomUUID } from 'node:crypto';
import { GRID_24X7, PROTECTED_BUSINESS_IDS, TENANT, VERDICTS, isGuardStop, nowIso, randomPassword, rowOf, shortId, sleep, sqlText, sqlUuid, sqlUuidList,
  createTenantGuard } from './env.mjs';
import { brief, createHttp, pool, refusal, refusalStatus, refused } from './http.mjs';

export const BAN_FOREVER = '876000h';
export const TERMINAL_STATUSES = Object.freeze(['delivered', 'cancelled', 'canceled', 'rejected']);
export const TERMINAL_SQL = "('delivered','cancelled','canceled','rejected')";
// Una sesión de checkout que todavía retiene stock o puede terminar en un pedido.
export const OPEN_SESSION_SQL = "('created','validating','ready_for_payment','redirected','payment_pending','payment_approved','finalizing_order','retrying')";

export const DELIVERY = Object.freeze({
  businessFee: 900,
  businessMinimum: 3000,
  zones: Object.freeze([
    Object.freeze({ key: 'centro', name: 'Centro', fee: 1200, minimum: null, priority: 10 }),
    Object.freeze({ key: 'oeste', name: 'Oeste', fee: null, minimum: 5000, priority: 20 }),
  ]),
  pin: Object.freeze({ city: 'Neuquen Capital', neighborhood: 'Centro', lat: -38.9516, lng: -68.0591 }),
});

const MASTER = Object.freeze({ brand: 'Cert', category: 'Aguas', subcategory: 'Sin gas', variant: 'Botella', capacityValue: 500,
  capacityUnit: 'ml', packagingType: 'Botella' });
// Cada producto fixture tiene UN rol. Las claves (sku) no parecen de QA a propósito:
// el alta comercial rechaza un sku con forma de fixture.
export const FIXTURES = Object.freeze({
  MAIN: Object.freeze({ role: 'MAIN', sku: 'ecomcert-main', name: 'Cert Agua Principal 500 ml', price: 1500, stock: 500, state: 'published', sort: 10 }),
  LAST_UNIT: Object.freeze({ role: 'LAST_UNIT', sku: 'ecomcert-last-unit', name: 'Cert Agua Ultima Unidad 500 ml', price: 2400, stock: 1, state: 'published', sort: 20 }),
  PRICE_CHANGE: Object.freeze({ role: 'PRICE_CHANGE', sku: 'ecomcert-price-change', name: 'Cert Agua Precio 500 ml', price: 1800, stock: 100, state: 'published', sort: 30 }),
  HIDE: Object.freeze({ role: 'HIDE', sku: 'ecomcert-hide', name: 'Cert Agua Ocultable 500 ml', price: 1200, stock: 50, state: 'published', sort: 40 }),
  PERF: Object.freeze({ role: 'PERF', sku: 'ecomcert-perf', name: 'Cert Agua Rendimiento 500 ml', price: 1000, stock: 5000, state: 'published', sort: 50 }),
  PENDING_PRICE: Object.freeze({ role: 'PENDING_PRICE', sku: 'ecomcert-pending-price', name: 'Cert Agua Sin Precio 500 ml', price: 0, stock: 20, state: 'pending', sort: 60 }),
  HIDDEN: Object.freeze({ role: 'HIDDEN', sku: 'ecomcert-hidden', name: 'Cert Agua Oculta 500 ml', price: 1300, stock: 30, state: 'hidden', sort: 70 }),
});
// El único producto del segundo negocio de la corrida.
export const SECOND_FIXTURE = Object.freeze({ sku: 'ecomcert-segundo', name: 'Cert Agua Segundo Negocio 500 ml', price: 1100, stock: 40, state: 'published', sort: 10 });

export const OPERATORS = Object.freeze([
  Object.freeze({ role: 'owner', label: 'owner', access: null, client: 'panel_web', fullName: 'QA Ecom Cert Owner' }),
  Object.freeze({ role: 'admin', label: 'admin', access: 'panel', client: 'panel_web', fullName: 'QA Ecom Cert Admin' }),
  Object.freeze({ role: 'staff', label: 'staff', access: 'panel', client: 'panel_web', fullName: 'QA Ecom Cert Staff' }),
  Object.freeze({ role: 'rider', label: 'rider1', access: 'rider', client: 'rider_android', fullName: 'QA Ecom Cert Rider Uno', phone: '+54 299 555 0101' }),
  Object.freeze({ role: 'rider', label: 'rider2', access: 'rider', client: 'rider_android', fullName: 'QA Ecom Cert Rider Dos', phone: '+54 299 555 0102' }),
]);

// Límites amplios para todo lo que no sea probar los límites mismos: toda la corrida sale de UN origen de red.
// El tope de unidades también va amplio: con el valor por defecto (120) el guardián rechaza un pedido de
// 1001 unidades ANTES de que el alta valide la cantidad del renglón, y la fase de precios dejaría de
// probar esa validación (20261001180000). Que el tope frena se prueba aparte, en `certifyIntakeLimits`.
export const ROOMY_INTAKE_LIMITS = Object.freeze({ order_rate_limit_per_10_minutes: 100000, max_pending_orders_per_customer: 100000,
  order_ip_rate_limit_per_10_minutes: 100000, max_pending_orders_per_ip: 100000, order_business_rate_limit_per_10_minutes: 100000,
  max_units_per_unpaid_order: 100000, order_intake_guard_mode: 'enforce' });

class TenantStop extends Error {}
export const isTenantStop = (error) => error instanceof TenantStop;

// ── Identidades ──────────────────────────────────────────────────────────────
// Los ingresos con contraseña van en serie y espaciados: el límite del endpoint
// de tokens es por dirección de red y, en Staging, esa dirección la comparte otra persona.
export function createIdentities(ctx) {
  let chain = Promise.resolve();
  let last = 0;
  // Cuánto se insiste cuando GoTrue contesta 429. El límite de ingresos es por dirección y por ventana: el destino
  // dice cuántos intentos y cada cuánto (en el stack la ventana de GoTrue es de cinco minutos, y entera puede tocar
  // esperarla). Cada espera queda en el log y la cuenta de frenos en el ledger.
  const retry = ctx.env.target.signInRetry ?? { attempts: 6, baseMs: 5000 };
  const signIn = (email, password, { gapMs = ctx.flags.signInGapMs } = {}) => {
    const task = async () => {
      const wait = last + gapMs - Date.now();
      if (wait > 0) await sleep(wait);
      for (let attempt = 1; ; attempt += 1) {
        last = Date.now();
        const client = ctx.env.newClient();
        const { data, error } = await client.auth.signInWithPassword({ email, password });
        if (!error && data?.session) {
          ctx.redactor.secret(data.session.access_token);
          ctx.redactor.secret(data.session.refresh_token);
          return { client, jwt: data.session.access_token, userId: data.user.id };
        }
        const limited = error?.status === 429 || /rate limit/i.test(String(error?.message || ''));
        if (!limited || attempt >= retry.attempts) throw Error(`LOGIN_FAILED:${error?.code || error?.status || 'NO_SESSION'}${limited ? ':RATE_LIMITED' : ''}`);
        ctx.ledger.signInRateLimited = (ctx.ledger.signInRateLimited || 0) + 1;
        ctx.log(`ingreso limitado por tasa (GoTrue 429): espera ${(retry.baseMs * attempt) / 1000} s, intento ${attempt + 1} de ${retry.attempts}`);
        await sleep(retry.baseMs * attempt);
      }
    };
    const result = chain.then(task, task);
    chain = result.catch(() => {});
    return result;
  };

  // La sesión de equipo de un operador en UN negocio (el tenant, o el segundo negocio de la corrida).
  const registerSession = async (actor, client, label, businessId = ctx.tenant.id) => {
    const r = await ctx.http.call(actor, 'identity_register_session', { p_business_id: businessId, p_client: client,
      p_device_label: `${ctx.runId} ${label}`, p_device_key_hash: null, p_app_version: TENANT.appVersion });
    if (!r.ok || !r.data?.ok) throw Error(`SESSION_REFUSED:${label}:${r.code || r.data?.code}`);
    actor.sessionId = r.data.session_id;
    actor.sessionRole = r.data.role;
    actor.sessionBusinessId = businessId;
    ctx.liveSessions.add(r.data.session_id);
    ctx.ledger.sessions.push({ label, userId: actor.userId, sessionId: r.data.session_id, businessId, client, closed: false, at: nowIso() });
    ctx.persist();
    return r.data;
  };

  // Usuario de UNA corrida (cliente o identidad de prueba). Se anota antes de crearse.
  async function createRunUser(label, kind, metadata = {}) {
    const email = ctx.identity.runUserEmail(label);
    const password = ctx.redactor.secret(randomPassword());
    const entry = { kind, label, email, userId: null, deleted: false, at: nowIso() };
    ctx.ledger.users.push(entry);
    ctx.persist();
    const created = await ctx.serviceRole('provision', `auth.admin.createUser (${kind} ${label})`, (admin) => admin.auth.admin.createUser({
      email, password, email_confirm: true, user_metadata: { taba_qa: true, qa_run: ctx.runId, ...metadata } }));
    if (created.error || !created.data?.user) throw Error(`CREATE_USER_FAILED:${label}:${created.error?.code || created.error?.status}`);
    entry.userId = created.data.user.id;
    ctx.persist();
    const session = await signIn(email, password);
    return { label, kind, role: kind, userId: entry.userId, email, password, jwt: session.jwt, client: session.client };
  }

  // Una identidad PERSISTENTE del tenant (operador, pagador, dueño del segundo negocio). Si ya existe se le
  // rota la contraseña (no se guarda en ningún lado) y se le levanta la suspensión; después entra.
  // `signIn: false` la deja creada y sin sesión: un pagador cuyo checkout lo crea la Edge Function con la clave
  // de servicio no necesita un token, y cada ingreso con contraseña gasta el límite de GoTrue de esa dirección.
  async function persistent(label, { fullName, existing = null, actor = 'team', signIn: withSession = true } = {}) {
    const email = ctx.identity.operatorEmail(label);
    const password = ctx.redactor.secret(randomPassword());
    let userId = existing?.id || null;
    if (!userId) {
      const created = await ctx.serviceRole('provision', `auth.admin.createUser (persistent ${label})`, (admin) => admin.auth.admin.createUser({
        email, password, email_confirm: true, user_metadata: { taba_actor: actor, taba_qa: true, display_name: fullName } }));
      if (created.error || !created.data?.user) throw Error(`OPERATOR_CREATE_FAILED:${label}:${created.error?.code || created.error?.status}`);
      userId = created.data.user.id;
    } else if (withSession) {
      const updated = await ctx.serviceRole('provision', `auth.admin.updateUserById (persistent ${label}: rotate password, lift suspension)`,
        (admin) => admin.auth.admin.updateUserById(userId, { password, ban_duration: 'none' }));
      if (updated.error) throw Error(`OPERATOR_ENABLE_FAILED:${label}:${updated.error.code || updated.error.status}`);
    }
    if (!withSession) return { label, userId, email, jwt: null, client: null };
    const session = await signIn(email, password);
    return { label, userId, email, jwt: session.jwt, client: session.client };
  }

  let customerSeq = 0;
  const nextPhone = () => { customerSeq += 1; return `2995${String(410000 + ((Date.now() + customerSeq * 7919) % 580000)).padStart(6, '0')}`; };
  async function createCustomer(label, { address = true } = {}) {
    const actor = await createRunUser(label, 'customer', { taba_actor: 'customer' });
    actor.name = `QA Cert ${label}`.slice(0, 60);
    actor.phone = nextPhone();
    const profile = await ctx.http.call(actor, 'upsert_current_customer_profile', { p_name: actor.name, p_phone: actor.phone });
    if (!profile.ok) throw Error(`CUSTOMER_PROFILE_FAILED:${label}:${profile.code}`);
    if (address) {
      const saved = await ctx.http.call(actor, 'upsert_current_customer_address', { p_address: { label: 'Casa', street: 'Calle Certificacion',
        streetNumber: String(100 + customerSeq), city: DELIVERY.pin.city, neighborhood: DELIVERY.pin.neighborhood,
        latitude: DELIVERY.pin.lat, longitude: DELIVERY.pin.lng, geolocationAccuracy: 10, source: 'gps', locationSource: 'map_pin',
        locationConfirmedAt: nowIso(), isDefault: true } });
      if (!saved.ok || !saved.data?.address?.id) throw Error(`CUSTOMER_ADDRESS_FAILED:${label}:${saved.code || saved.data?.code}`);
      actor.addressId = saved.data.address.id;
    }
    return actor;
  }

  // Sesión anónima real (la que usa la tienda). El presupuesto es compartido: tope duro por corrida.
  async function createAnonymousCustomer(label) {
    if (ctx.flags.noAnonymous) return null;
    if (ctx.ledger.anonymousSignIns >= 3) throw Error('ANONYMOUS_SIGN_IN_BUDGET_EXHAUSTED');
    ctx.ledger.anonymousSignIns += 1;
    const entry = { kind: 'anonymous_customer', label, email: null, userId: null, deleted: false, at: nowIso() };
    ctx.ledger.users.push(entry);
    ctx.persist();
    const client = ctx.env.newClient();
    const { data, error } = await client.auth.signInAnonymously({ options: { data: { taba_actor: 'customer', qa_run: ctx.runId } } });
    if (error || !data?.session) throw Error(`ANON_SIGNIN_FAILED:${error?.code || error?.status}`);
    ctx.redactor.secret(data.session.access_token);
    ctx.redactor.secret(data.session.refresh_token);
    entry.userId = data.user.id;
    ctx.persist();
    customerSeq += 1;
    const actor = { label, kind: 'anonymous_customer', role: 'customer', userId: data.user.id, jwt: data.session.access_token, client,
      isAnonymous: data.user.is_anonymous === true, name: `QA Cert ${label}`.slice(0, 60), phone: `2995${String(400000 + customerSeq).padStart(6, '0')}` };
    const profile = await ctx.http.call(actor, 'upsert_current_customer_profile', { p_name: actor.name, p_phone: actor.phone });
    const saved = await ctx.http.call(actor, 'upsert_current_customer_address', { p_address: { label: 'Casa', street: 'Calle Certificacion',
      streetNumber: String(700 + customerSeq), city: DELIVERY.pin.city, neighborhood: DELIVERY.pin.neighborhood,
      latitude: DELIVERY.pin.lat, longitude: DELIVERY.pin.lng, geolocationAccuracy: 10, source: 'gps', locationSource: 'map_pin',
      locationConfirmedAt: nowIso(), isDefault: true } });
    if (!profile.ok || !saved.ok) throw Error(`ANON_CUSTOMER_SETUP_FAILED:${profile.code}:${saved.code}`);
    actor.addressId = saved.data?.address?.id;
    return actor;
  }

  // Los clientes se reusan dentro de la invocación: menos identidades, menos ingresos.
  const customers = new Map();
  async function customer(label, options) {
    if (!customers.has(label)) customers.set(label, await createCustomer(label, options));
    return customers.get(label);
  }

  // MUCHOS clientes de una vez, para la carga y para los límites: cada uno es una cuenta con su sesión y nada
  // más (sin perfil ni dirección: el pedido lleva nombre y teléfono). Se piden por etiqueta y se reusan: quien
  // pide treinta y después cien recibe los mismos treinta primero.
  const crowds = new Map();
  async function crowd(label, count) {
    if (!crowds.has(label)) crowds.set(label, []);
    const members = crowds.get(label);
    const missing = Array.from({ length: Math.max(0, count - members.length) }, (_, i) => members.length + i);
    // Las altas van de a cuatro; los ingresos se ordenan solos detrás del espaciado de `signIn`.
    const created = await pool(missing, Math.min(4, Math.max(1, missing.length)), async (index) => {
      const actor = await createRunUser(`${label}-${String(index + 1).padStart(3, '0')}`, 'customer', { taba_actor: 'customer' });
      actor.name = `QA Cert ${label} ${index + 1}`.slice(0, 60);
      actor.phone = nextPhone();
      actor.index = index;
      return actor;
    });
    members.push(...created.sort((a, b) => a.index - b.index));
    return members.slice(0, count);
  }

  // Los que PAGAN por Mercado Pago. Son persistentes porque una sesión de checkout guarda a su cliente con
  // ON DELETE RESTRICT: no se podrían borrar al terminar. Quedan suspendidos entre corridas, como los operadores.
  // `signIn: false` los devuelve sin token (alcanza para todo lo que hace la Edge Function con la clave de
  // servicio); a uno que después necesite su sesión se le abre en ese momento.
  // `pool` separa a los pagadores de una fase que los deja marcados —la de abuso los manda al enfriamiento— de
  // los que usan las demás: un pagador frenado no puede ser el que otra fase necesita para cobrar.
  const payerPools = new Map();
  async function payers(count, { signIn: withSession = true, pool = 'payer' } = {}) {
    if (!/^[a-z][a-z-]{2,20}$/.test(pool)) throw Error(`PAYER_POOL_INVALID:${pool}`);
    if (!payerPools.has(pool)) {
      const rows = await ctx.env.observe(`select id, email from auth.users where email like ${sqlText(ctx.identity.operatorEmail(`${pool}-%`))}`);
      payerPools.set(pool, { existing: Object.fromEntries(rows.map((row) => [row.email, row])), ready: [] });
    }
    const list = payerPools.get(pool);
    const profile = (index) => ({ kind: 'payer', role: 'customer', name: `QA Cert Pagador ${pool === 'payer' ? '' : `${pool} `}${index}`.replace(/\s+/g, ' ').trim(),
      phone: `54929955${String((pool === 'payer' ? 10000 : 60000) + index).padStart(5, '0')}` });
    while (list.ready.length < count) {
      const index = list.ready.length + 1;
      const label = `${pool}-${String(index).padStart(3, '0')}`;
      const identity = await persistent(label, { fullName: `QA Ecom Cert Pagador ${index}`, existing: list.existing[ctx.identity.operatorEmail(label)], actor: 'customer',
        signIn: withSession });
      list.ready.push({ ...identity, ...profile(index) });
    }
    if (withSession) {
      for (const [position, payer] of list.ready.slice(0, count).entries()) {
        if (payer.jwt) continue;
        const identity = await persistent(payer.label, { fullName: `QA Ecom Cert Pagador ${position + 1}`, existing: { id: payer.userId }, actor: 'customer' });
        list.ready[position] = { ...identity, ...profile(position + 1) };
      }
    }
    return list.ready.slice(0, count);
  }

  return { signIn, registerSession, createRunUser, createCustomer, createAnonymousCustomer, customer, crowd, persistent, payers };
}

// ── Lecturas del tenant (observador) ─────────────────────────────────────────
export async function readTenant(ctx) {
  const identity = ctx.identity;
  const row = (await ctx.env.observe(`select
    (select row_to_json(b) from (select id, slug, name, status, is_active, ordering_enabled, ordering_verified, ordering_verified_by, currency_code,
       operating_timezone, hours_enforced, delivery_zone_enforced, alcohol_hours_enforced, delivery_enabled, pickup_enabled, delivery_fee,
       minimum_delivery_subtotal, delivery_max_radius_meters, rider_presence_required, qa_fixture, qa_window_until, address,
       abandoned_order_minutes, order_rate_limit_per_10_minutes, max_pending_orders_per_customer
       from public.businesses where slug = ${sqlText(identity.slug)}) b) as business,
    (select json_agg(json_build_object('id', u.id, 'email', u.email, 'banned', u.banned_until is not null and u.banned_until > now(),
       'confirmed', u.email_confirmed_at is not null)) from auth.users u where u.email like ${sqlText(identity.operatorEmailPattern)}) as operators,
    (select count(*) from auth.users u where u.email like ${sqlText(identity.emailPattern)} and u.email not like ${sqlText(identity.operatorEmailPattern)})::int as run_users`))[0];
  return { business: row.business || null, operators: row.operators || [], runUsers: row.run_users };
}

export async function readTenantDetail(ctx, tenantId) {
  const ours = sqlText(`${TENANT.requestPrefix}%`);
  return (await ctx.env.observe(`select
    (select json_agg(json_build_object('user_id', m.user_id, 'role', m.role, 'is_active', m.is_active, 'email', u.email)) from public.business_members m
       left join auth.users u on u.id = m.user_id where m.business_id = ${sqlUuid(tenantId)}) as members,
    (select json_agg(json_build_object('channel', h.channel, 'weekday', h.weekday, 'opens_at', to_char(h.opens_at, 'HH24:MI'), 'closes_at', to_char(h.closes_at, 'HH24:MI'))
       order by h.channel, h.weekday, h.opens_at) from public.business_service_hours h where h.business_id = ${sqlUuid(tenantId)}) as hours,
    (select json_agg(json_build_object('id', e.id, 'channel', e.channel, 'on_date', e.on_date, 'is_closed', e.is_closed)) from public.business_service_exceptions e where e.business_id = ${sqlUuid(tenantId)}) as exceptions,
    (select json_agg(json_build_object('id', z.id, 'name', z.name, 'is_active', z.is_active, 'match_kind', z.match_kind, 'area', z.area_normalized,
       'delivery_fee', z.delivery_fee, 'minimum_subtotal', z.minimum_subtotal, 'priority', z.priority)) from public.delivery_zones z where z.business_id = ${sqlUuid(tenantId)}) as zones,
    (select json_agg(json_build_object('id', p.id, 'sku', p.sku, 'name', p.name, 'price', p.price, 'price_status', p.price_status, 'stock', p.stock,
       'available', p.available, 'merchant_available', p.merchant_available, 'is_active', p.is_active, 'is_verified', p.is_verified,
       'catalog_origin', p.catalog_origin, 'is_alcoholic', p.is_alcoholic) order by p.sort_order) from public.products p where p.business_id = ${sqlUuid(tenantId)}) as products,
    (select exists (select 1 from private.rider_map_business_locations l where l.business_id = ${sqlUuid(tenantId)} and l.human_verified)) as location_verified,
    (select count(*) from public.orders o where o.business_id = ${sqlUuid(tenantId)} and o.client_request_id not like ${ours}
       and not exists (select 1 from public.checkout_sessions s where s.completed_order_id = o.id and s.client_request_id like ${ours}))::int as foreign_orders,
    (select count(*) from public.orders o where o.business_id = ${sqlUuid(tenantId)})::int as orders,
    (select count(*) from public.orders o where o.business_id = ${sqlUuid(tenantId)} and o.status not in ${TERMINAL_SQL})::int as open_orders,
    (select count(*) from public.checkout_sessions s where s.business_id = ${sqlUuid(tenantId)})::int as checkout_sessions,
    (select count(*) from public.checkout_sessions s where s.business_id = ${sqlUuid(tenantId)} and s.client_request_id not like ${ours})::int as foreign_checkout_sessions,
    (select count(*) from public.payment_intents i where i.business_id = ${sqlUuid(tenantId)})::int as payment_intents,
    (select count(*) from public.payment_intents i left join public.checkout_sessions s on s.id = i.checkout_session_id
       where i.business_id = ${sqlUuid(tenantId)} and (s.id is null or s.client_request_id not like ${ours}))::int as foreign_payment_intents`))[0];
}

export const fixtureRows = (detail) => Object.fromEntries((detail.products || []).map((p) => [p.sku, p]));

// Lo que hace «nuestro» a un negocio, leído del observador. Lo usan el preflight y el alta: las dos caras del
// mismo resguardo (un tenant con algo que no creamos no se usa ni se limpia).
export function tenantStrangers(ctx, business, detail) {
  const reasons = [];
  if (PROTECTED_BUSINESS_IDS.includes(business.id)) reasons.push('PROTECTED_BUSINESS');
  if (business.qa_fixture !== true) reasons.push('NOT_A_QA_FIXTURE');
  if (business.name !== ctx.identity.name) reasons.push(`NAME_IS_NOT_THE_ONE_OF_ITS_SLUG:${business.name}`);
  if (detail.foreign_orders > 0) reasons.push(`ORDERS_NOT_CREATED_BY_THE_RUNNER:${detail.foreign_orders}`);
  if (detail.foreign_checkout_sessions > 0) reasons.push(`CHECKOUTS_NOT_CREATED_BY_THE_RUNNER:${detail.foreign_checkout_sessions}`);
  if (detail.foreign_payment_intents > 0) reasons.push(`PAYMENT_INTENTS_NOT_CREATED_BY_THE_RUNNER:${detail.foreign_payment_intents}`);
  const unknownProducts = (detail.products || []).filter((p) => !Object.values(FIXTURES).some((f) => f.sku === p.sku));
  if (unknownProducts.length) reasons.push(`UNKNOWN_PRODUCTS:${unknownProducts.map((p) => p.sku).join(',')}`);
  const unknownMembers = (detail.members || []).filter((m) => !String(m.email || '').startsWith(ctx.identity.emailPrefix) || !String(m.email || '').endsWith(`@${TENANT.emailDomain}`));
  if (unknownMembers.length) reasons.push(`UNKNOWN_MEMBERS:${unknownMembers.length}`);
  return reasons;
}

// ── Aprovisionamiento ────────────────────────────────────────────────────────
function must(result, what) {
  if (!result.ok || result.data?.ok === false) {
    throw Error(`${what}:${result.code || result.data?.code || result.status}:${String(result.error?.message || '').slice(0, 120)}`);
  }
  return result.data;
}

async function ensureBusiness(ctx, snapshot) {
  const identity = ctx.identity;
  if (snapshot.business) {
    const b = snapshot.business;
    // Un negocio con este slug ya existe. Sólo se usa si es el de ESTA corrida (lo dice su ledger) o si quien
    // corre pidió reusarlo con su slug. Cualquier otro caso se frena: nada se pisa por coincidencia de nombre.
    const ownRun = ctx.ledger.target.tenantId === b.id;
    if (!ownRun && !ctx.flags.reuseTenant) throw new TenantStop(`TENANT_SLUG_ALREADY_EXISTS_AND_REUSE_WAS_NOT_ASKED:${identity.slug}`);
    if (!b.qa_fixture || b.name !== identity.name) throw new TenantStop(`TENANT_IS_NOT_THE_EXPECTED_QA_FIXTURE:${b.name}`);
    return { id: b.id, created: false };
  }
  if (ctx.flags.reuseTenant) throw new TenantStop(`TENANT_TO_REUSE_NOT_FOUND:${identity.slug}`);
  const id = randomUUID();
  ctx.ledger.businesses.push({ id, slug: identity.slug, name: identity.name, purpose: 'QA tenant of this run', created: true, at: nowIso() });
  ctx.persist();
  const inserted = await ctx.serviceRole('provision', 'insert businesses (QA tenant, closed, qa_fixture)', (admin) => admin.from('businesses').insert({
    id, name: identity.name, slug: identity.slug, status: 'closed', is_active: true, ordering_enabled: false, ordering_verified: false,
    currency_code: TENANT.currency, operating_timezone: TENANT.timezone, address: TENANT.address, delivery_enabled: false, pickup_enabled: false,
    qa_fixture: true }).select('id').single());
  if (inserted.error) throw Error(`TENANT_INSERT_FAILED:${inserted.error.code}:${String(inserted.error.message).slice(0, 120)}`);
  return { id, created: true };
}

async function ensureOperatorIdentity(ctx, spec, existing) {
  const identity = await ctx.identities.persistent(spec.label, { fullName: spec.fullName, existing });
  return { ...identity, role: spec.role, kind: 'operator', spec };
}

// La primera membresía de dueño de un negocio de la corrida: no existe todavía quien pueda aprobarla.
async function createFirstOwner(ctx, businessId, actor, fullName) {
  ctx.guard.assertWrite(businessId);
  await ctx.serviceRole('provision', 'insert business_members (first owner of a business of this run)', async (admin) => {
    const member = await admin.from('business_members').insert({ business_id: businessId, user_id: actor.userId, role: 'owner', is_active: true });
    if (member.error) throw Error(`OWNER_CREATE:${member.error.code}`);
    const security = await admin.from('identity_user_security').upsert({ business_id: businessId, user_id: actor.userId }, { onConflict: 'business_id,user_id' });
    if (security.error) throw Error(`OWNER_SECURITY:${security.error.code}`);
    const profile = await admin.from('staff_profiles').upsert({ business_id: businessId, user_id: actor.userId, full_name: fullName,
      created_by: actor.userId }, { onConflict: 'business_id,user_id' });
    if (profile.error) throw Error(`OWNER_PROFILE:${profile.error.code}`);
  });
}

async function ensureMembership(ctx, actor, members, owner) {
  const current = (members || []).find((m) => m.user_id === actor.userId);
  if (current && current.role !== actor.role) throw new TenantStop(`OPERATOR_ROLE_DRIFT:${actor.label}:${current.role}`);
  if (current?.is_active) return 'active';
  if (actor.role === 'owner') {
    if (current) throw new TenantStop('OWNER_MEMBERSHIP_INACTIVE');
    await createFirstOwner(ctx, ctx.tenant.id, actor, actor.spec.fullName);
    return 'owner_created';
  }
  if (current && !current.is_active) {
    must(await ctx.http.call(owner, 'identity_set_member_active', { p_business_id: ctx.tenant.id, p_user_id: actor.userId, p_is_active: true,
      p_reason: 'QA certificacion reactivacion' }), `MEMBER_ENABLE:${actor.label}`);
    return 'reactivated';
  }
  return joinTeam(ctx, actor, owner, { access: actor.spec.access, role: actor.role, fullName: actor.spec.fullName, phone: actor.spec.phone });
}

// Camino de dominio para sumar a alguien al equipo: la persona pide acceso y el dueño lo aprueba.
export async function joinTeam(ctx, actor, owner, { access, role, fullName, phone = null }) {
  const asked = must(await ctx.http.call(actor, 'request_business_access', { p_business_id: ctx.tenant.id, p_access: access,
    p_full_name: fullName, p_contact_phone: phone }), `ACCESS_REQUEST:${actor.label}`);
  if (asked.code === 'already_member') return 'already_member';
  const inbox = must(await ctx.http.call(owner, 'identity_list_access_requests', { p_business_id: ctx.tenant.id, p_status: 'pending' }), 'ACCESS_INBOX');
  const request = (Array.isArray(inbox) ? inbox : []).find((row) => row.user_id === actor.userId);
  if (!request?.request_id) throw Error(`ACCESS_REQUEST_NOT_IN_INBOX:${actor.label}`);
  must(await ctx.http.call(owner, 'identity_review_access_request', { p_request_id: request.request_id, p_decision: 'approve',
    p_role: role, p_reason: 'Alta controlada QA' }), `ACCESS_APPROVAL:${actor.label}`);
  return 'approved';
}

const sameHours = (rows, channel) => {
  const own = (rows || []).filter((h) => h.channel === channel);
  return own.length === 7 && [0, 1, 2, 3, 4, 5, 6].every((d) => own.some((h) => h.weekday === d && h.opens_at === '00:00' && ['24:00', '00:00'].includes(h.closes_at)));
};

// Deja la configuración comercial en su forma canónica, por las RPC del dueño.
// Se usa al preparar y al limpiar: una fase que se cortó no deja horarios o zonas torcidos.
export async function restoreConfig(ctx, { status = null } = {}) {
  const owner = ctx.actors.owner;
  const id = ctx.tenant.id;
  const snapshot = (await readTenant(ctx)).business;
  const detail = await readTenantDetail(ctx, id);
  const steps = [];
  const run = async (name, fn, params) => { must(await ctx.http.call(owner, fn, params), `CONFIG_${name}`); steps.push(name); };

  if (snapshot.address !== TENANT.address) await run('address', 'set_business_address', { p_business_id: id, p_address: TENANT.address });
  if (Number(snapshot.delivery_fee) !== DELIVERY.businessFee || Number(snapshot.minimum_delivery_subtotal) !== DELIVERY.businessMinimum
    || snapshot.delivery_fee === null || snapshot.minimum_delivery_subtotal === null || snapshot.delivery_max_radius_meters !== null) {
    await run('pricing', 'set_delivery_pricing', { p_business_id: id, p_delivery_fee: DELIVERY.businessFee, p_minimum_subtotal: DELIVERY.businessMinimum, p_max_radius_meters: null });
  }
  for (const channel of ['delivery', 'pickup']) {
    if (!sameHours(detail.hours, channel)) await run(`hours_${channel}`, 'set_business_service_hours', { p_business_id: id, p_channel: channel, p_hours: GRID_24X7 });
  }
  for (const exception of detail.exceptions || []) {
    await run('exception_removed', 'delete_business_service_exception', { p_business_id: id, p_exception_id: exception.id });
  }
  const zones = {};
  for (const spec of DELIVERY.zones) {
    const current = (detail.zones || []).find((z) => z.name === spec.name);
    const matches = current && current.is_active && current.match_kind === 'declared_area'
      && (current.delivery_fee === null ? null : Number(current.delivery_fee)) === spec.fee
      && (current.minimum_subtotal === null ? null : Number(current.minimum_subtotal)) === spec.minimum;
    if (matches) { zones[spec.key] = { id: current.id, ...spec }; continue; }
    const saved = must(await ctx.http.call(owner, 'upsert_delivery_zone', { p_business_id: id, p_zone: { ...(current ? { id: current.id } : {}), name: spec.name,
      match_kind: 'declared_area', area: spec.name, delivery_fee: spec.fee === null ? null : String(spec.fee),
      minimum_subtotal: spec.minimum === null ? null : String(spec.minimum), priority: spec.priority, is_active: true } }), `CONFIG_zone_${spec.key}`);
    steps.push(`zone_${spec.key}`);
    zones[spec.key] = { id: saved.zone_id, ...spec };
  }
  if (!snapshot.hours_enforced || !snapshot.delivery_zone_enforced || snapshot.alcohol_hours_enforced || snapshot.operating_timezone !== TENANT.timezone) {
    await run('enforcement', 'set_service_enforcement', { p_business_id: id, p_hours_enforced: true, p_delivery_zone_enforced: true,
      p_alcohol_hours_enforced: false, p_timezone: TENANT.timezone });
  }
  // Las formas de entrega van DESPUÉS de las zonas y de la exigencia de cobertura: desde 20261001216000 un
  // comercio verificado no enciende el delivery sin cobertura exigida y una zona activa con su envío (22023,
  // DELIVERY_COVERAGE). Restaurar el tenant entre fases tiene que poder volver a encenderlo ya verificado.
  if (!snapshot.delivery_enabled || !snapshot.pickup_enabled) {
    await run('fulfillment', 'set_business_fulfillment', { p_business_id: id, p_delivery_enabled: true, p_pickup_enabled: true });
  }
  if (snapshot.abandoned_order_minutes !== null) {
    // Columna del dueño (privilegio de columna + política de RLS): la escribe con su sesión. La respuesta se
    // pide con `select=id`: `authenticated` puede ESCRIBIR esta columna pero no leerla, y un PATCH que pide la
    // fila entera de vuelta se rechaza con 403 · 42501 sin escribir nada.
    const r = await ctx.http.restWrite(owner, 'PATCH', `businesses?id=eq.${id}&select=id`, { abandoned_order_minutes: null }, { businessId: id });
    if (!r.ok) throw Error(`CONFIG_abandoned_order_minutes:${r.code || r.status}`);
    steps.push('abandoned_order_minutes');
  }
  if (snapshot.rider_presence_required) await run('presence', 'set_business_rider_presence_policy', { p_business_id: id, p_required: false });
  if (status && snapshot.status !== status && status !== 'open') await run(`status_${status}`, 'set_business_open_state', { p_business_id: id, p_status: status });
  ctx.tenant.zones = zones;
  ctx.tenant.locationVerified = Boolean(detail.location_verified);
  return steps;
}

// Límites del guardián de admisión (sólo si el contrato está desplegado). La plataforma
// es quien los fija en un tenant QA: es aprovisionamiento, va con `service_role`.
export async function setIntakeLimits(ctx, limits, reason) {
  if (!ctx.caps.order_intake_guard) return false;
  ctx.guard.assertWrite(ctx.tenant.id);
  const out = await ctx.serviceRole('provision', `update businesses (intake limits: ${reason})`, (admin) => admin.from('businesses')
    .update(limits).eq('id', ctx.tenant.id).eq('slug', ctx.identity.slug).select('id'));
  if (out.error || out.data?.length !== 1) throw Error(`INTAKE_LIMITS_FAILED:${out.error?.code || 'rows'}`);
  ctx.ledger.tenantChanges.push({ kind: 'intake_limits', reason, limits, at: nowIso() });
  ctx.persist();
  return true;
}

// Lo que el guardián dejó escrito del tenant: frenos contados (por alcance), eventos de abuso y admisiones.
// La lee el observador: son tablas privadas, y un cliente no las ve nunca.
export async function intakeTrail(ctx, businessId = ctx.tenant.id) {
  return (await ctx.env.observe(`select
    (select coalesce(sum(blocked_count), 0) from private.order_intake_blocks where business_id = ${sqlUuid(businessId)})::int as blocks,
    (select coalesce(sum(blocked_count), 0) from private.order_intake_blocks where business_id = ${sqlUuid(businessId)} and scope = 'ip'
       and window_started_at > now() - interval '21 minutes')::int as origin_blocks_recent,
    (select coalesce(json_object_agg(scope || ':' || last_reason, n), '{}'::json) from (select scope, last_reason, sum(blocked_count)::int as n
       from private.order_intake_blocks where business_id = ${sqlUuid(businessId)} group by 1, 2) s) as blocks_by_scope_and_reason,
    (select count(*) from public.order_abuse_events where business_id = ${sqlUuid(businessId)} and event_type like 'order_intake_blocked:%')::int as events,
    (select coalesce(json_object_agg(event_type, n), '{}'::json) from (select event_type, count(*)::int as n from public.order_abuse_events
       where business_id = ${sqlUuid(businessId)} group by 1) e) as events_by_type,
    (select count(*) from private.order_intake_log where business_id = ${sqlUuid(businessId)})::int as admissions,
    (select count(*) from private.order_intake_log where business_id = ${sqlUuid(businessId)} and created_at > now() - interval '10 minutes')::int as admissions_in_window,
    (select coalesce(max(n), 0) from (select count(*)::int as n from private.order_intake_log where business_id = ${sqlUuid(businessId)}
       and created_at > now() - interval '10 minutes' and fingerprint_hash is not null group by fingerprint_hash) f) as busiest_origin_in_window,
    (select (select count(*) from public.orders o where o.business_id = ${sqlUuid(businessId)} and o.created_at > now() - interval '10 minutes' and o.payment_method <> 'mercadopago')
          + (select count(*) from public.checkout_sessions s where s.business_id = ${sqlUuid(businessId)} and s.created_at > now() - interval '10 minutes'))::int as business_window`))[0];
}

// El guardián de admisión FRENA (20261001180000). El tenant corre con límites amplios porque toda la corrida
// sale de pocos clientes y de un solo origen de red; con eso solo, las fases no dicen nada del guardián. Acá
// se le bajan los topes de pedidos SIN ATENDER —por cliente y por origen— y se comprueba por HTTP lo que las
// pruebas de base sólo podían simular: el pedido que pasa el tope vuelve con 429 y Retry-After, queda anotado,
// no nace nada, y un reintento idempotente no se frena. Y el tope de unidades de un pedido sin cobrar, que es
// una validación (400) y no un freno: no se anota.
const INTAKE_LIMIT_CHECKS = Object.freeze(['INTAKE_GUARD_ADMITS_ORDERS_UP_TO_THE_CUSTOMER_PENDING_LIMIT', 'INTAKE_GUARD_REFUSES_THE_ORDER_PAST_THE_CUSTOMER_PENDING_LIMIT',
  'INTAKE_GUARD_REFUSAL_IS_RECORDED_AND_CREATES_NOTHING', 'INTAKE_GUARD_DOES_NOT_REFUSE_AN_IDEMPOTENT_RETRY', 'INTAKE_GUARD_REFUSES_THE_ORDER_PAST_THE_ORIGIN_PENDING_LIMIT',
  'INTAKE_GUARD_IGNORES_A_FORGED_X_FORWARDED_FOR', 'INTAKE_GUARD_REFUSES_AN_UNPAID_ORDER_ABOVE_THE_UNIT_CAP']);
export async function certifyIntakeLimits(ctx) {
  const P = 'tenant';
  const C = ctx.rec.check;
  if (!ctx.caps.order_intake_guard) {
    for (const name of INTAKE_LIMIT_CHECKS) ctx.rec.skipCheck(P, name, 'order_intake_guard');
    return;
  }
  // Una vez por corrida. Cada pasada gasta frenos del origen de red de la corrida, y veinte frenos en dos
  // ventanas de diez minutos dejan a ese origen en enfriamiento: encadenar invocaciones repitiendo la prueba
  // terminaría frenando los pedidos de las fases. La invocación que continúa una corrida retoma el resultado.
  const earlier = ctx.previousChecks.filter((c) => c.phase === P && c.name.startsWith('INTAKE_GUARD_'));
  if (earlier.length && earlier.every((c) => c.result === VERDICTS.PASS)) {
    ctx.rec.restore(earlier);
    return;
  }
  const target = ctx.env.target;
  const recorded = () => intakeTrail(ctx);
  const order = (customer, label, { quantity = 1, ...call } = {}) => ctx.orders.create(customer, { mode: 'pickup', role: 'MAIN', quantity, label: `intake:${label}`, call });
  const limited = (reason) => ({ message: 'ORDER_RATE_LIMITED', details: reason });
  const seen = (out) => ({ ...brief(out.r), retryAfter: out.r.headers.retryAfter ?? null, publicCode: out.order?.public_code || null });
  try {
    // Lo que una corrida cortada haya dejado sin atender contaría contra los topes.
    await ctx.orders.settle('antes de la prueba de limites de admision');
    const a = await ctx.identities.customer('intake-a', { address: false });
    const b = await ctx.identities.customer('intake-b', { address: false });

    // 1. Por cliente: dos pedidos sin atender, y el tercero no entra.
    await setIntakeLimits(ctx, { ...ROOMY_INTAKE_LIMITS, max_pending_orders_per_customer: 2 }, 'prove the pending-orders limit per customer');
    const first = await order(a, 'a-1');
    const second = await order(a, 'a-2');
    C(P, 'INTAKE_GUARD_ADMITS_ORDERS_UP_TO_THE_CUSTOMER_PENDING_LIMIT', Boolean(first.order && second.order), [seen(first), seen(second)]);
    const before = { footprint: await ctx.orders.footprint(), recorded: await recorded() };
    const third = await order(a, 'a-3');
    const after = { footprint: await ctx.orders.footprint(), recorded: await recorded() };
    C(P, 'INTAKE_GUARD_REFUSES_THE_ORDER_PAST_THE_CUSTOMER_PENDING_LIMIT', refused(third.r, 'PT429', limited('customer_pending')) && third.r.headers.retryAfter === '120',
      seen(third), `${refusal('PT429', limited('customer_pending'))} · Retry-After 120`);
    C(P, 'INTAKE_GUARD_REFUSAL_IS_RECORDED_AND_CREATES_NOTHING', ctx.orders.sameFootprint(before.footprint, after.footprint)
      && after.recorded.blocks > before.recorded.blocks && after.recorded.events > before.recorded.events,
    { changed: ctx.orders.footprintDiff(before.footprint, after.footprint), blocks: [before.recorded.blocks, after.recorded.blocks], abuseEvents: [before.recorded.events, after.recorded.events] },
    'ni pedido ni stock; el freno y su evento, anotados');
    const retry = await ctx.http.call(a, 'create_order_with_items', { payload: second.payload });
    C(P, 'INTAKE_GUARD_DOES_NOT_REFUSE_AN_IDEMPOTENT_RETRY', retry.status === 200 && rowOf(retry.data)?.id === second.order?.id, brief(retry), 'HTTP 200 con el mismo pedido');

    // 2. Por origen de red: el cliente A ya tiene dos sin atender desde este origen. Con tope tres por
    // origen, el primero de B entra y el segundo no, aunque B sólo tiene uno: lo frena el origen.
    await setIntakeLimits(ctx, { ...ROOMY_INTAKE_LIMITS, max_pending_orders_per_ip: 3 }, 'prove the pending-orders limit per network origin');
    const admitted = await order(b, 'b-1');
    const stopped = await order(b, 'b-2');
    C(P, 'INTAKE_GUARD_REFUSES_THE_ORDER_PAST_THE_ORIGIN_PENDING_LIMIT', Boolean(admitted.order) && refused(stopped.r, 'PT429', limited('ip_pending'))
      && stopped.r.headers.retryAfter === '120', [seen(admitted), seen(stopped)], `${refusal('PT429', limited('ip_pending'))} · Retry-After 120`);
    // `x-forwarded-for` lo puede escribir el cliente (llega «lo que mandó, origen real»): el guardián no lo mira,
    // así que decir que se viene de otra red no saca a nadie del tope.
    const forged = await order(b, 'b-2-forged-forwarded-for', { headers: { 'x-forwarded-for': '198.51.100.77' } });
    C(P, 'INTAKE_GUARD_IGNORES_A_FORGED_X_FORWARDED_FOR', refused(forged.r, 'PT429', limited('ip_pending')), seen(forged), refusal('PT429', limited('ip_pending')));
    // Que el tope es DE ese origen sólo se puede mostrar donde el origen se elige: el mismo pedido, desde otra red, entra.
    if (target.canChooseOrigin) {
      const elsewhere = await order(b, 'b-other-origin', { origin: target.originOf('intake-other-origin') });
      C(P, 'INTAKE_GUARD_ORIGIN_LIMIT_DOES_NOT_REACH_ANOTHER_ORIGIN', Boolean(elsewhere.order), seen(elsewhere));
    } else {
      ctx.rec.skipOnTarget(P, 'INTAKE_GUARD_ORIGIN_LIMIT_DOES_NOT_REACH_ANOTHER_ORIGIN', target.lacks('origin_choice'));
    }

    // 3. Unidades de un pedido que todavía no se cobró: con tope cinco, cinco entran y seis no.
    await setIntakeLimits(ctx, { ...ROOMY_INTAKE_LIMITS, max_units_per_unpaid_order: 5 }, 'prove the unit cap of an unpaid order');
    const atCap = await order(b, 'b-5-units', { quantity: 5 });
    const blocksBefore = (await recorded()).blocks;
    const aboveCap = await order(b, 'b-6-units', { quantity: 6 });
    const tooLarge = { message: 'ORDER_TOO_LARGE', details: 'hasta 5 unidades' };
    C(P, 'INTAKE_GUARD_REFUSES_AN_UNPAID_ORDER_ABOVE_THE_UNIT_CAP', Boolean(atCap.order) && refused(aboveCap.r, '22023', tooLarge) && (await recorded()).blocks === blocksBefore,
      [seen(atCap), seen(aboveCap)], `${refusal('22023', tooLarge)}, sin anotarlo como freno`);
  } catch (error) {
    if (isGuardStop(error)) throw error;
    C(P, 'INTAKE_LIMITS_PROVED_WITHOUT_RUNNER_ERROR', false, { message: String(error.message).slice(0, 300) });
  } finally {
    await setIntakeLimits(ctx, ROOMY_INTAKE_LIMITS, 'restore the roomy baseline after the limit proof');
    await ctx.orders.settle('despues de la prueba de limites de admision');
  }
}

// La plataforma no verifica un comercio sin reglas (20261001215000). El tenant pasa esa compuerta porque tiene
// dueño, horario exigido y cobertura; el negocio descartable de la corrida no tiene nada de eso, y la misma
// llamada de plataforma se tiene que negar diciendo qué falta, sin cambiarlo.
export async function certifyOpeningGate(ctx) {
  const P = 'tenant';
  if (!ctx.caps.opening_rules_gate) {
    ctx.rec.skipCheck(P, 'PLATFORM_REFUSES_TO_VERIFY_A_BUSINESS_WITHOUT_OWNER_AND_ENFORCED_HOURS', 'opening_rules_gate');
    return;
  }
  const other = await ensureThrowawayBusiness(ctx);
  const answer = await ctx.serviceRole('provision', 'rpc platform_verify_business_ordering (throwaway business of this run: a refusal is expected, nothing changes)',
    (admin) => admin.rpc('platform_verify_business_ordering', { p_business_id: other.id, p_verifier_email: ctx.actors.owner.email, p_confirm_slug: other.slug,
      p_min_products: 1, p_note: `${ctx.runId} prueba de la compuerta de apertura` }));
  const blockers = String(answer.error?.details || '').split(',');
  const after = (await ctx.env.observe(`select ordering_verified, ordering_enabled from public.businesses where id = ${sqlUuid(other.id)}`))[0];
  ctx.rec.check(P, 'PLATFORM_REFUSES_TO_VERIFY_A_BUSINESS_WITHOUT_OWNER_AND_ENFORCED_HOURS', answer.status === refusalStatus('55000') && answer.error?.code === '55000'
    && answer.error.message === 'OPENING_NOT_READY' && ['BUSINESS_OWNER', 'SERVICE_HOURS'].every((code) => blockers.includes(code))
    && after.ordering_verified === false && after.ordering_enabled === false,
  { http: answer.status, code: answer.error?.code ?? null, message: answer.error?.message ?? null, blockers, business: after },
  `${refusal('55000', { message: 'OPENING_NOT_READY' })} con BUSINESS_OWNER y SERVICE_HOURS en el detalle`);
}

const fixtureInsertRow = (businessId, f) => ({ business_id: businessId, sku: f.sku, external_id: f.sku, name: f.name, brand: MASTER.brand,
  category: MASTER.category, subcategory: MASTER.subcategory, variant: MASTER.variant, presentation: MASTER.variant,
  capacity_value: MASTER.capacityValue, capacity_unit: MASTER.capacityUnit, capacity: `${MASTER.capacityValue} ${MASTER.capacityUnit}`,
  packaging_type: MASTER.packagingType, units_per_pack: 1, price: f.price, price_status: f.state === 'pending' ? 'pending' : 'confirmed',
  stock: f.stock, is_active: true, available: false, is_verified: false, merchant_available: true, is_alcoholic: false, minimum_age: null,
  catalog_origin: 'commercial', sort_order: f.sort, description: 'Producto de certificacion QA. No es mercaderia real.' });

// Lleva los productos fixture a su estado declarado: datos maestros, precio, stock y publicación.
export async function normalizeFixtures(ctx, { reason = 'restaurar stock declarado' } = {}) {
  const owner = ctx.actors.owner;
  const id = ctx.tenant.id;
  let rows = fixtureRows(await readTenantDetail(ctx, id));
  const done = [];
  for (const f of Object.values(FIXTURES)) {
    const row = rows[f.sku];
    if (!row) {
      ctx.guard.assertWrite(id);
      const ins = await ctx.serviceRole('provision', `insert products (fixture ${f.role}, unverified and hidden)`, (admin) => admin.from('products')
        .insert(fixtureInsertRow(id, f)).select('id').single());
      if (ins.error) throw Error(`FIXTURE_INSERT_FAILED:${f.role}:${ins.error.code}:${String(ins.error.message).slice(0, 160)}`);
      done.push(`insert:${f.role}`);
      continue;
    }
    const wantStatus = f.state === 'pending' ? 'pending' : 'confirmed';
    if (row.name !== f.name || Number(row.price) !== f.price || row.price_status !== wantStatus || !row.is_active || row.catalog_origin !== 'commercial') {
      ctx.guard.assertWrite(id);
      const upd = await ctx.serviceRole('provision', `update products (fixture ${f.role}: master data back to declared)`, (admin) => admin.from('products')
        .update({ name: f.name, price: f.price, price_status: wantStatus, is_active: true }).eq('id', row.id).eq('business_id', id).select('id'));
      if (upd.error || upd.data?.length !== 1) throw Error(`FIXTURE_RESET_FAILED:${f.role}:${upd.error?.code || 'rows'}`);
      done.push(`master:${f.role}`);
    }
    if (row.stock !== f.stock) {
      const delta = f.stock - Number(row.stock ?? 0);
      const moved = await ctx.http.call(owner, 'apply_inventory_movement', { p_business_id: id, p_product_id: row.id, p_barcode_id: null,
        p_movement_type: 'manual_adjustment', p_package_quantity: Math.abs(delta), p_direction: delta > 0 ? 1 : -1, p_reference_type: 'qa_ecom_cert_reset',
        p_reference_id: null, p_reason: `${ctx.runId} QA ${reason}`.slice(0, 280), p_idempotency_key: `ecomcert-stk-${f.sku.slice(9, 20)}-${shortId(6)}` });
      if (!moved.ok) throw Error(`FIXTURE_STOCK_FAILED:${f.role}:${moved.code}:${moved.error?.message}`);
      done.push(`stock:${f.role}:${delta > 0 ? '+' : ''}${delta}`);
    }
  }
  if (done.length) rows = fixtureRows(await readTenantDetail(ctx, id));
  // Publicación: por el camino comercial del dueño (verifica y publica; nunca por SQL).
  const toVerify = Object.values(FIXTURES).filter((f) => f.state !== 'pending' && rows[f.sku] && !rows[f.sku].is_verified);
  if (toVerify.length) {
    const r = await ctx.http.call(owner, 'apply_commercial_catalog_batch', { p_business_id: id, p_rows: toVerify.map((f) => ({ sku: f.sku, publish: true })) });
    if (!r.ok) throw Error(`FIXTURE_PUBLISH_FAILED:${r.code}:${r.error?.message}`);
    done.push(`verified:${toVerify.map((f) => f.role).join('+')}`);
    rows = fixtureRows(await readTenantDetail(ctx, id));
  }
  for (const f of Object.values(FIXTURES)) {
    const row = rows[f.sku];
    if (f.state === 'published' && !(row.available && row.merchant_available)) {
      const r = await ctx.http.call(owner, 'set_commercial_product_publication', { p_business_id: id, p_sku: f.sku, p_publish: true });
      if (!r.ok) throw Error(`FIXTURE_REPUBLISH_FAILED:${f.role}:${r.code}:${r.error?.message}`);
      done.push(`published:${f.role}`);
    }
    if (f.state === 'hidden' && (row.available || row.merchant_available)) {
      const r = await ctx.http.call(owner, 'set_commercial_product_publication', { p_business_id: id, p_sku: f.sku, p_publish: false });
      if (!r.ok) throw Error(`FIXTURE_HIDE_FAILED:${f.role}:${r.code}:${r.error?.message}`);
      done.push(`hidden:${f.role}`);
    }
  }
  rows = done.length ? fixtureRows(await readTenantDetail(ctx, id)) : rows;
  ctx.tenant.products = Object.fromEntries(Object.values(FIXTURES).map((f) => [f.role, { ...f, id: rows[f.sku]?.id, row: rows[f.sku] }]));
  return done;
}

// Un negocio descartable y de esta corrida, sin gente y sin pedidos, para las pruebas negativas de «otro
// negocio» que sólo necesitan que exista (un producto ajeno, un comercio sin reglas). Nace cerrado e inactivo:
// no vende ni se ve, y se borra al terminar.
export async function ensureThrowawayBusiness(ctx) {
  if (ctx.throwaway) return ctx.throwaway;
  const id = randomUUID();
  const productId = randomUUID();
  const slug = `${ctx.identity.throwawaySlugPrefix}${shortId(3)}`;
  ctx.ledger.businesses.push({ id, slug, purpose: 'cross-business negative tests', throwaway: true, deleted: false, at: nowIso() });
  ctx.persist();
  await ctx.serviceRole('provision', 'insert businesses + products (throwaway business of this run: closed, inactive)', async (admin) => {
    const business = await admin.from('businesses').insert({ id, name: `${ctx.identity.name} X ${shortId(2)}`.slice(0, 80), slug, status: 'closed', is_active: false,
      ordering_enabled: false, ordering_verified: false, qa_fixture: true }).select('id').single();
    if (business.error) throw Error(`THROWAWAY_BUSINESS_INSERT:${business.error.code}`);
    const product = await admin.from('products').insert({ ...fixtureInsertRow(id, { sku: 'ecomcert-otro-negocio', name: 'Cert Producto De Otro Negocio', price: 999,
      stock: 10, state: 'published', sort: 1 }), id: productId }).select('id').single();
    if (product.error) throw Error(`THROWAWAY_PRODUCT_INSERT:${product.error.code}`);
  });
  ctx.throwaway = { id, slug, productId, stock: 10 };
  return ctx.throwaway;
}

// EL SEGUNDO NEGOCIO de la corrida, completo: con su dueño, abierto y verificado por el camino de plataforma,
// con un producto a la venta, un cliente y un pedido. Es la otra mitad de las pruebas de privacidad: nadie
// del tenant lee ni cambia nada de este negocio, y nadie de este negocio lee ni cambia nada del tenant.
// También es de la herramienta (mismo prefijo, sufijo `-b`) y queda cerrado al terminar; no se borra porque
// su pedido, como todo pedido, lo retiene.
export async function ensureSecondBusiness(ctx, { withOrder = true, configure = true } = {}) {
  if (ctx.second && (ctx.second.order || !withOrder) && (ctx.second.ready || !configure)) return ctx.second;
  const spec = ctx.identity.second;
  const second = ctx.second || {};
  if (!second.id) {
    const found = (await ctx.env.observe(`select id, name, qa_fixture, status, ordering_verified, ordering_enabled,
      (select json_agg(json_build_object('user_id', m.user_id, 'role', m.role, 'email', u.email)) from public.business_members m left join auth.users u on u.id = m.user_id
         where m.business_id = b.id) as members,
      (select json_agg(json_build_object('id', p.id, 'sku', p.sku, 'stock', p.stock, 'available', p.available, 'is_verified', p.is_verified)) from public.products p where p.business_id = b.id) as products
      from public.businesses b where b.slug = ${sqlText(spec.slug)}`))[0];
    if (found) {
      // Mismo resguardo que el tenant: sólo es nuestro si lo dice todo lo que tiene.
      const strangers = (found.members || []).filter((m) => m.email !== spec.ownerEmail);
      const unknownProducts = (found.products || []).filter((p) => p.sku !== SECOND_FIXTURE.sku);
      if (!found.qa_fixture || found.name !== spec.name || strangers.length || unknownProducts.length || PROTECTED_BUSINESS_IDS.includes(found.id)) {
        throw new TenantStop(`SECOND_BUSINESS_IS_NOT_OURS:${spec.slug}`);
      }
      second.id = found.id;
      second.created = false;
      second.existing = found;
    } else if (!configure) {
      return null;   // quien sólo viene a cerrarlo no lo crea
    } else {
      second.id = randomUUID();
      second.created = true;
      ctx.ledger.businesses.push({ id: second.id, slug: spec.slug, name: spec.name, purpose: 'second complete business of this run (privacy)', second: true, closed: false, at: nowIso() });
      ctx.persist();
      const inserted = await ctx.serviceRole('provision', 'insert businesses (second business of this run, closed, qa_fixture)', (admin) => admin.from('businesses').insert({
        id: second.id, name: spec.name, slug: spec.slug, status: 'closed', is_active: true, ordering_enabled: false, ordering_verified: false,
        currency_code: TENANT.currency, operating_timezone: TENANT.timezone, address: TENANT.address, delivery_enabled: false, pickup_enabled: false,
        qa_fixture: true }).select('id').single());
      if (inserted.error) throw Error(`SECOND_BUSINESS_INSERT_FAILED:${inserted.error.code}:${String(inserted.error.message).slice(0, 120)}`);
    }
    if (!ctx.ledger.businesses.some((b) => b.id === second.id)) {
      ctx.ledger.businesses.push({ id: second.id, slug: spec.slug, name: spec.name, purpose: 'second complete business of this run (privacy)', second: true, closed: false, at: nowIso() });
    }
    ctx.guard.adopt(second.id);
    second.slug = spec.slug;
    ctx.second = second;
    ctx.persist();
  }
  const id = second.id;
  if (!second.owner) {
    const existing = (await ctx.env.observe(`select id, email from auth.users where email = ${sqlText(spec.ownerEmail)}`))[0];
    const owner = { ...(await ctx.identities.persistent('b-owner', { fullName: 'QA Ecom Cert Owner B', existing })), role: 'owner', kind: 'operator' };
    if (!(second.existing?.members || []).some((m) => m.user_id === owner.userId)) await createFirstOwner(ctx, id, owner, 'QA Ecom Cert Owner B');
    await ctx.identities.registerSession(owner, 'panel_web', 'owner-b', id);
    second.owner = owner;
    ctx.extraSessions.push(owner);
  }
  const owner = second.owner;
  if (configure && !second.ready) {
    const run = async (name, fn, params) => must(await ctx.http.call(owner, fn, params), `SECOND_CONFIG_${name}`);
    await run('address', 'set_business_address', { p_business_id: id, p_address: 'Avenida Certificacion 200, Neuquen Capital' });
    await run('hours_pickup', 'set_business_service_hours', { p_business_id: id, p_channel: 'pickup', p_hours: GRID_24X7 });
    // Sólo retiro: sin zonas, la cobertura no se puede exigir (55000, «no hay zonas activas») y la plataforma
    // tampoco la pide para verificar un comercio con el delivery apagado. El horario sí se exige.
    await run('enforcement', 'set_service_enforcement', { p_business_id: id, p_hours_enforced: true, p_delivery_zone_enforced: false,
      p_alcohol_hours_enforced: false, p_timezone: TENANT.timezone });
    await run('fulfillment', 'set_business_fulfillment', { p_business_id: id, p_delivery_enabled: false, p_pickup_enabled: true });
    let product = (second.existing?.products || [])[0] || null;
    if (!product) {
      const ins = await ctx.serviceRole('provision', 'insert products (fixture of the second business, unverified and hidden)', (admin) => admin.from('products')
        .insert(fixtureInsertRow(id, SECOND_FIXTURE)).select('id').single());
      if (ins.error) throw Error(`SECOND_FIXTURE_INSERT_FAILED:${ins.error.code}:${String(ins.error.message).slice(0, 160)}`);
      product = { id: ins.data.id, sku: SECOND_FIXTURE.sku, stock: SECOND_FIXTURE.stock, available: false, is_verified: false };
    }
    if (!(product.available && product.is_verified)) {
      await run('publish', 'apply_commercial_catalog_batch', { p_business_id: id, p_rows: [{ sku: SECOND_FIXTURE.sku, publish: true }] });
    }
    second.product = { id: product.id, ...SECOND_FIXTURE };
    const state = (await ctx.env.observe(`select ordering_verified, ordering_enabled from public.businesses where id = ${sqlUuid(id)}`))[0];
    if (!(state.ordering_verified && state.ordering_enabled)) {
      const verified = await ctx.serviceRole('provision', 'rpc platform_verify_business_ordering (second business of this run)', (admin) => admin.rpc('platform_verify_business_ordering', {
        p_business_id: id, p_verifier_email: owner.email, p_confirm_slug: spec.slug, p_min_products: 1, p_note: `${ctx.runId} segundo negocio QA` }));
      if (verified.error) throw Error(`SECOND_BUSINESS_VERIFY_FAILED:${verified.error.code}:${String(verified.error.details || verified.error.message).slice(0, 160)}`);
    }
    must(await ctx.http.call(owner, 'open_qa_window', { p_business_id: id, p_minutes: 60 }), 'SECOND_BUSINESS_OPEN');
    second.ready = true;
  }
  if (withOrder && !second.order) {
    const customer = await ctx.identities.customer('second-business', { address: false });
    const token = ctx.orders.newToken();
    const out = await ctx.orders.create(customer, { label: 'second-business', payload: { business_id: id, client_request_id: ctx.orders.newRequestId('second-business'),
      tracking_token: token, items: [{ product_id: second.product.id, quantity: 1 }], customer_name: customer.name, customer_phone: customer.phone,
      delivery_mode: 'pickup', payment_method: 'cash', age_confirmed: false, customer_notes: ctx.orders.notes } });
    if (!out.order) throw Error(`SECOND_BUSINESS_ORDER_FAILED:${out.r.code || out.r.status}:${String(out.r.error?.message || '').slice(0, 120)}`);
    second.customer = customer;
    second.order = { id: out.order.id, publicCode: out.order.public_code, token, requestId: out.requestId, total: Number(out.order.total) };
  }
  return second;
}

export const fixturesAtDeclaredState = (rows) => Object.values(FIXTURES).map((f) => {
  const row = rows[f.sku];
  const stateOk = !row ? false
    : f.state === 'published' ? row.is_verified && row.available && row.merchant_available
      : f.state === 'hidden' ? row.is_verified && !row.available && !row.merchant_available
        : !row.available && row.price_status === 'pending';
  return { role: f.role, declaredStock: f.stock, stock: row?.stock ?? null, stockOk: row?.stock === f.stock,
    priceOk: row ? Number(row.price) === f.price : false, nameOk: row?.name === f.name, stateOk };
});

// Abre la tienda del tenant: verificación de plataforma (camino real) + ventana QA del dueño.
export async function openTenant(ctx) {
  const id = ctx.tenant.id;
  const before = (await readTenant(ctx)).business;
  const record = { verifiedBy: null, verification: null, fallback: null, window: null };
  if (!(before.ordering_verified && before.ordering_enabled)) {
    ctx.guard.assertWrite(id);
    const verified = await ctx.serviceRole('provision', 'rpc platform_verify_business_ordering (QA tenant)', (admin) => admin.rpc('platform_verify_business_ordering', {
      p_business_id: id, p_verifier_email: ctx.actors.owner.email, p_confirm_slug: ctx.identity.slug, p_min_products: 5, p_note: `${ctx.runId} tenant QA` }));
    if (verified.error) {
      // El camino real no aceptó al tenant: se anota por qué y se usan las columnas, también anotado.
      record.fallback = { code: verified.error.code, message: String(verified.error.message).slice(0, 160), details: verified.error.details || null };
      const forced = await ctx.serviceRole('provision', `update businesses (ordering columns; platform_verify refused: ${verified.error.code})`,
        (admin) => admin.from('businesses').update({ ordering_verified: true, ordering_verified_at: nowIso(), ordering_verified_by: ctx.actors.owner.userId,
          ordering_enabled: true }).eq('id', id).eq('slug', ctx.identity.slug).select('id'));
      if (forced.error || forced.data?.length !== 1) throw Error(`TENANT_VERIFY_FAILED:${forced.error?.code || 'rows'}`);
      record.verification = 'columns_set_by_service_role';
    } else {
      record.verification = verified.data?.changed ? 'platform_verify_business_ordering' : 'already_verified';
    }
  } else {
    record.verification = 'already_verified';
  }
  const opened = must(await ctx.http.call(ctx.actors.owner, 'open_qa_window', { p_business_id: id, p_minutes: 60 }), 'TENANT_OPEN');
  record.window = opened.qa_window_until;
  ctx.ledger.tenantChanges.push({ kind: 'opened', ...record, at: nowIso() });
  ctx.persist();
  return record;
}

// Identidades de una corrida anterior SOBRE ESTE TENANT que se cortó antes de borrarlas (sólo pasa cuando el
// tenant se reusa). Son nuestras por construcción (el prefijo del tenant en un dominio que no existe) y no
// operaron pedidos como equipo.
export async function purgeLeftoverRunUsers(ctx) {
  const rows = await ctx.env.observe(`select id, email from auth.users u where (u.email like ${sqlText(ctx.identity.emailPattern)}
    and u.email not like ${sqlText(ctx.identity.operatorEmailPattern)})`);
  const known = new Set(ctx.ledger.users.map((u) => u.userId).filter(Boolean));
  const purged = [];
  for (const row of rows.filter((r) => !known.has(r.id))) {
    const r = await ctx.serviceRole('cleanup', 'auth.admin.deleteUser (leftover run user of an interrupted run on this tenant)', (admin) => admin.auth.admin.deleteUser(row.id));
    purged.push({ id: row.id, ok: !r.error, code: r.error?.code || null });
  }
  if (purged.length) { ctx.ledger.tenantChanges.push({ kind: 'leftover_run_users_purged', count: purged.length, failed: purged.filter((p) => !p.ok).length, at: nowIso() }); ctx.persist(); }
  return purged;
}

// Prepara TODO: negocio, operadores con sesión, configuración, catálogo y apertura.
export async function ensureTenant(ctx) {
  const snapshot = await readTenant(ctx);
  const { id, created } = await ensureBusiness(ctx, snapshot);
  ctx.tenant = { id, slug: ctx.identity.slug, name: ctx.identity.name, created, products: {}, zones: {}, locationVerified: false, notes: [] };
  Object.assign(ctx.ledger.target, { tenantId: id, tenantSlug: ctx.identity.slug, tenantName: ctx.identity.name, tenantReused: !created && Boolean(ctx.flags.reuseTenant) });
  ctx.guard = createTenantGuard(id);
  // Los otros negocios que la corrida ya había creado (una invocación que continúa): el segundo se puede
  // volver a escribir; el descartable sólo figura como señuelo.
  for (const business of ctx.ledger.businesses.filter((b) => b.second)) ctx.guard.adopt(business.id);
  ctx.http = createHttp({ publishableKey: ctx.env.keys.publishable, secretKey: ctx.env.keys.secret, guard: ctx.guard, requests: ctx.requests, target: ctx.env.target,
    latency: ctx.latency, journal: ctx.journal });
  ctx.identities = createIdentities(ctx);
  ctx.persist();

  const detail = await readTenantDetail(ctx, id);
  // El tenant es de esta herramienta y de nadie más: si tiene algo que no creamos, se frena.
  const strangers = snapshot.business ? tenantStrangers(ctx, snapshot.business, detail) : [];
  if (strangers.length) throw new TenantStop(`TENANT_HAS_ROWS_NOT_CREATED_BY_THE_RUNNER:${strangers.join(';')}`);
  await purgeLeftoverRunUsers(ctx);

  ctx.actors = {};
  const byEmail = Object.fromEntries(snapshot.operators.map((o) => [o.email, o]));
  for (const spec of OPERATORS) {
    ctx.actors[spec.label] = await ensureOperatorIdentity(ctx, spec, byEmail[ctx.identity.operatorEmail(spec.label)]);
  }
  const owner = ctx.actors.owner;
  const membershipLog = {};
  membershipLog.owner = await ensureMembership(ctx, owner, detail.members, owner);
  await ctx.identities.registerSession(owner, 'panel_web', 'owner');
  for (const spec of OPERATORS.filter((s) => s.label !== 'owner')) {
    const actor = ctx.actors[spec.label];
    membershipLog[spec.label] = await ensureMembership(ctx, actor, detail.members, owner);
    await ctx.identities.registerSession(actor, spec.client, spec.label);
  }
  const configSteps = await restoreConfig(ctx);
  if (ctx.caps.order_intake_guard) await setIntakeLimits(ctx, ROOMY_INTAKE_LIMITS, 'baseline for a single-origin QA run');
  const fixtureSteps = await normalizeFixtures(ctx, { reason: 'preparacion del tenant' });
  const opening = await openTenant(ctx);
  ctx.tenant.opening = opening;
  if (!ctx.tenant.locationVerified) {
    ctx.tenant.notes.push('DISTANCE_CAP_NOT_EXERCISED: no existe un camino (RPC o tabla expuesta) para que service_role escriba private.rider_map_business_locations; set_delivery_pricing rechaza un tope de distancia sin punto verificado.');
  }
  const after = (await readTenant(ctx)).business;
  ctx.tenant.business = after;
  ctx.evidence.write('tenant.json', { runId: ctx.runId, at: nowIso(), tenant: { id, slug: ctx.identity.slug, name: ctx.identity.name, created, reused: ctx.ledger.target.tenantReused, business: after },
    operators: Object.fromEntries(Object.entries(ctx.actors).map(([label, a]) => [label, { userId: a.userId, role: a.sessionRole, membership: membershipLog[label] }])),
    configSteps, fixtureSteps, opening, zones: ctx.tenant.zones,
    products: Object.fromEntries(Object.entries(ctx.tenant.products).map(([role, p]) => [role, { id: p.id, sku: p.sku, price: p.price, stock: p.stock, state: p.state }])),
    notes: ctx.tenant.notes });
  return ctx.tenant;
}

// ── Limpieza ─────────────────────────────────────────────────────────────────
// Sólo recursos del tenant y de la corrida. El pedido se cierra por las RPC reales. Cancela el DUEÑO: es el
// único rol que puede cancelar con cualquier política de permisos (que el operador pueda o no es justamente
// lo que el registro de hallazgos tiene abierto), y la limpieza no puede depender de eso.
export async function settleOrders(ctx, { concurrency = 6 } = {}) {
  const { owner } = ctx.actors;
  const id = ctx.tenant.id;
  // Primero lo cobrado por Mercado Pago: un pedido pagado no se cancela sin devolver antes el dinero, y una
  // sesión de checkout abierta retiene stock.
  const payments = ctx.payments && ctx.caps.checkout_payments ? await ctx.payments.settle() : { touched: 0, failures: [] };
  const rows = await ctx.env.observe(`select o.id, o.public_code, o.status, o.revision, o.origin, o.manual_payment_status
    from public.orders o where o.business_id = ${sqlUuid(id)} and (o.status not in ${TERMINAL_SQL} or o.origin <> 'qa' or o.manual_payment_status = 'confirmed')
    order by o.created_at`);
  const failures = [...payments.failures];
  const reason = `${ctx.runId.replaceAll('-', '_')}`;
  await pool(rows, Math.min(concurrency, Math.max(1, rows.length)), async (row) => {
    try {
      let revision = Number(row.revision);
      let status = row.status;
      if (row.manual_payment_status === 'confirmed') {
        const r = await ctx.http.call(owner, 'reverse_manual_order_payment', { p_order_id: row.id, p_expected_revision: revision,
          p_reason: `${ctx.runId} QA sin dinero real`, p_idempotency_key: `ecomcert-rev-${row.id.replaceAll('-', '').slice(0, 24)}` });
        if (!r.ok) failures.push({ order: row.public_code, step: 'reverse_payment', ...brief(r) });
        else revision = Number(r.data?.revision ?? revision + 1);
      }
      if (!TERMINAL_STATUSES.includes(status)) {
        let r = await ctx.http.call(owner, 'cancel_order', { p_order_id: row.id, p_expected_revision: revision, p_reason: `${ctx.runId} QA limpieza`,
          p_idempotency_key: `ecomcert-clean-${row.id.replaceAll('-', '').slice(0, 20)}-${revision}` });
        // La revisión se movió entre la lectura y la cancelación (otro comando sobre el pedido; desde 20261001194000
        // un reintento del cliente ya no la mueve), o la base estaba saturada —recién terminada la fase de carga— y
        // la sentencia venció (57014) o la respuesta no llegó: se lee de nuevo y se repite una vez. La cancelación
        // lleva clave de idempotencia por revisión, así que repetirla no cancela dos veces.
        if (!r.ok && (['PT409', '57014'].includes(String(r.code)) || r.status === 0)) {
          if (r.code !== 'PT409') await sleep(2000);
          const fresh = (await ctx.env.observe(`select revision, status from public.orders where id = ${sqlUuid(row.id)}`))[0];
          if (!TERMINAL_STATUSES.includes(fresh.status)) {
            r = await ctx.http.call(owner, 'cancel_order', { p_order_id: row.id, p_expected_revision: Number(fresh.revision), p_reason: `${ctx.runId} QA limpieza`,
              p_idempotency_key: `ecomcert-clean-${row.id.replaceAll('-', '').slice(0, 20)}-${fresh.revision}` });
          } else { r = { ok: true }; }
        }
        if (!r.ok) failures.push({ order: row.public_code, step: 'cancel', ...brief(r) });
        else status = 'cancelled';
      }
      if (row.origin !== 'qa') {
        const r = await ctx.http.call(owner, 'classify_order_as_qa', { p_order_id: row.id, p_reason: reason });
        if (!r.ok || r.data?.ok !== true) failures.push({ order: row.public_code, step: 'classify_qa', ...brief(r) });
      }
    } catch (error) { failures.push({ order: row.public_code, step: 'exception', message: String(error.message).slice(0, 160) }); }
  });
  return { touched: rows.length + payments.touched, failures };
}

async function ridersOff(ctx) {
  const out = [];
  for (const label of ['rider1', 'rider2']) {
    const rider = ctx.actors[label];
    if (!rider) continue;
    const board = await ctx.http.call(rider, 'get_rider_delivery_board');
    if (board.ok && board.data?.available === false) { out.push({ label, ok: true, code: 'already_off' }); continue; }
    const version = Number(board.data?.availability_version || 0);
    const r = await ctx.http.call(rider, 'set_rider_availability', { p_business_id: ctx.tenant.id, p_available: false, p_expected_version: version,
      p_idempotency_key: `ecomcert-avail-off-${label}-${shortId(4)}` });
    out.push({ label, ok: r.ok && r.data?.ok !== false, code: r.code || r.data?.code });
  }
  return out;
}

// El segundo negocio vuelve a su reposo: su pedido cerrado y clasificado QA, la ventana cerrada y los pedidos
// online deshabilitados por la plataforma. Lo hace SU dueño, por las mismas RPC que el tenant.
async function closeSecondBusiness(ctx, step) {
  const entry = ctx.ledger.businesses.find((b) => b.second);
  if (!entry) return null;
  const second = await ensureSecondBusiness(ctx, { withOrder: false, configure: false });
  if (!second) { entry.closed = true; return null; }   // se anotó y no llegó a nacer
  const owner = second.owner;
  const id = second.id;
  const rows = await ctx.env.observe(`select o.id, o.public_code, o.status, o.revision, o.origin from public.orders o where o.business_id = ${sqlUuid(id)}
    and (o.status not in ${TERMINAL_SQL} or o.origin <> 'qa') order by o.created_at`);
  for (const row of rows) {
    if (!TERMINAL_STATUSES.includes(row.status)) {
      const r = await ctx.http.call(owner, 'cancel_order', { p_order_id: row.id, p_expected_revision: Number(row.revision), p_reason: `${ctx.runId} QA limpieza`,
        p_idempotency_key: `ecomcert-clean-${row.id.replaceAll('-', '').slice(0, 20)}-${row.revision}` });
      step(`second business: cancel ${row.public_code}`, r.ok, r.code || null);
    }
    if (row.origin !== 'qa') {
      const r = await ctx.http.call(owner, 'classify_order_as_qa', { p_order_id: row.id, p_reason: ctx.runId.replaceAll('-', '_') });
      step(`second business: classify ${row.public_code}`, r.ok && r.data?.ok === true, r.code || r.data?.code || null);
    }
  }
  const closed = await ctx.http.call(owner, 'close_qa_window', { p_business_id: id });
  const revoked = await ctx.serviceRole('cleanup', 'rpc platform_revoke_business_ordering (second business of this run at rest)', (admin) => admin.rpc('platform_revoke_business_ordering', {
    p_business_id: id, p_actor_email: owner.email, p_confirm_slug: second.slug, p_reason: `${ctx.runId} fin de corrida QA` }));
  step('second business closed and ordering disabled', closed.ok && !revoked.error, revoked.error?.code || closed.code || null);
  entry.closed = closed.ok && !revoked.error;
  return second;
}

export async function teardown(ctx, { keepOpen = false } = {}) {
  const P = 'teardown';
  const identity = ctx.identity;
  const steps = [];
  const step = (name, ok, detail = null) => { steps.push({ name, ok: Boolean(ok), detail, at: nowIso() }); ctx.log(`${ok ? 'OK ' : 'ERR'} limpieza ${name}`); return ok; };
  const guarded = async (name, task) => { try { return await task(); } catch (error) { step(name, false, String(error.message).slice(0, 200)); return null; } };
  for (const timer of ctx.timers || []) clearInterval(timer);
  const id = ctx.tenant?.id;
  const { owner } = ctx.actors || {};
  if (!id || !owner) { ctx.rec.check(P, 'TENANT_AND_OWNER_AVAILABLE_FOR_CLEANUP', false, { tenant: Boolean(id), owner: Boolean(owner) }); return; }

  // 1. Pedidos: devolución de cobros, cancelación por el camino del comercio, clasificación QA.
  await guarded('orders', async () => {
    const settled = await settleOrders(ctx);
    step(`orders settled (${settled.touched})`, settled.failures.length === 0, settled.failures.slice(0, 10));
  });
  // 2. Ofertas a riders que hayan quedado vivas, y disponibilidad en false.
  await guarded('offers', async () => {
    const offers = await ctx.env.observe(`select id from public.rider_order_offers where business_id = ${sqlUuid(id)} and status = 'pending'`);
    for (const offer of offers) {
      const r = await ctx.http.call(ctx.actors.staff, 'withdraw_rider_order_offer', { p_offer_id: offer.id });
      step('withdraw pending offer', r.ok, r.code || r.data?.code);
    }
  });
  await guarded('riders', async () => { for (const r of await ridersOff(ctx)) step(`availability off ${r.label}`, r.ok, r.code); });
  // 3. Configuración canónica y stock declarado (caminos reales del dueño).
  await guarded('config', async () => {
    if ((await readTenant(ctx)).business.status === 'paused') {
      must(await ctx.http.call(owner, 'set_business_open_state', { p_business_id: id, p_status: 'open' }), 'CONFIG_status_open');
    }
    step('config restored', true, await restoreConfig(ctx));
  });
  if (ctx.caps.order_intake_guard) await guarded('intake limits', async () => step('intake limits baseline', await setIntakeLimits(ctx, ROOMY_INTAKE_LIMITS, 'restore baseline at cleanup')));
  await guarded('fixtures', async () => step('fixtures at declared state', true, await normalizeFixtures(ctx, { reason: 'limpieza de la corrida' })));
  // El cobro por Mercado Pago del tenant queda apagado y su vendedor de utilería desconectado: en reposo el
  // tenant no figura entre los comercios que cobran.
  if (ctx.payments && ctx.caps.checkout_payments) await guarded('payment fixture', async () => { const off = await ctx.payments.disableFixture(); if (off) step('payment fixture disabled', off.ok, off.detail); });
  // 4. Cierre del tenant: ventana QA cerrada por el dueño y pedidos online deshabilitados por la plataforma.
  if (!keepOpen) {
    await guarded('close', async () => {
      must(await ctx.http.call(owner, 'close_qa_window', { p_business_id: id }), 'TENANT_CLOSE');
      ctx.guard.assertWrite(id);
      const revoked = await ctx.serviceRole('cleanup', 'rpc platform_revoke_business_ordering (QA tenant at rest)', (admin) => admin.rpc('platform_revoke_business_ordering', {
        p_business_id: id, p_actor_email: owner.email, p_confirm_slug: identity.slug, p_reason: `${ctx.runId} fin de corrida QA` }));
      step('tenant closed and ordering disabled', !revoked.error, revoked.error?.code || null);
    });
    await guarded('second business', () => closeSecondBusiness(ctx, step));
  }
  // 5. Sesiones: las que quedaron sin dueño (corridas cortadas) las revoca el dueño; las propias se cierran solas.
  await guarded('stale sessions', async () => {
    const live = [...ctx.liveSessions];
    const stale = await ctx.env.observe(`select session_id from public.identity_sessions where business_id = ${sqlUuid(id)} and revoked_at is null
      and session_id not in (${sqlUuidList(live)})`);
    for (const row of stale) {
      const r = await ctx.http.call(owner, 'identity_revoke_session', { p_session_id: row.session_id });
      step('revoke stale session', r.ok && r.data?.ok === true, r.code || r.data?.code);
    }
  });
  for (const actor of [...(ctx.extraSessions || []), ...Object.values(ctx.actors).filter((a) => a.label !== 'owner'), owner]) {
    if (!actor?.sessionId) continue;
    if (keepOpen && actor.sessionBusinessId && actor.sessionBusinessId !== id) continue;   // el segundo negocio sigue abierto: su dueño también
    await guarded(`close session ${actor.label}`, async () => {
      const r = await ctx.http.call(actor, 'identity_close_own_session', { p_business_id: actor.sessionBusinessId || id });
      const entry = ctx.ledger.sessions.find((s) => s.sessionId === actor.sessionId);
      if (entry) entry.closed = r.ok && r.data?.ok === true;
      // Una sesión que la prueba ya revocó contesta sin rol: está cerrada igual.
      step(`close session ${actor.label}`, (r.ok && r.data?.ok === true) || actor.expectRevoked === true, r.code || r.data?.code);
    });
  }
  ctx.persist();
  // 6. `service_role` SÓLO para identidades y el negocio descartable de esta corrida.
  for (const business of ctx.ledger.businesses.filter((b) => b.throwaway && !b.deleted)) {
    await guarded('throwaway business', async () => {
      const r = await ctx.serviceRole('cleanup', 'delete businesses (throwaway business of this run)', (admin) => admin.from('businesses')
        .delete().eq('id', business.id).like('slug', `${identity.throwawaySlugPrefix}%`).select('id'));
      business.deleted = !r.error;
      step('delete throwaway business', !r.error, r.error?.code || null);
    });
  }
  const leftovers = ctx.ledger.users.filter((u) => !u.deleted);
  await pool(leftovers, Math.min(4, Math.max(1, leftovers.length)), (user) => guarded(`delete user ${user.label}`, async () => {
    let userId = user.userId;
    if (!userId && user.email) {
      userId = (await ctx.env.observe(`select id from auth.users where email = ${sqlText(user.email)}`))[0]?.id || null;
      if (!userId) { user.deleted = true; return; }
    }
    if (!userId) { user.deleted = true; return; }
    const r = await ctx.serviceRole('cleanup', `auth.admin.deleteUser (${user.kind})`, (admin) => admin.auth.admin.deleteUser(userId));
    user.deleted = !r.error || r.error?.status === 404;
    if (!user.deleted) user.deleteError = { status: r.error.status || null, code: r.error.code || null, message: String(r.error.message || '').slice(0, 160) };
    if (!user.deleted || leftovers.length <= 20) step(`delete user ${user.label}`, user.deleted, user.deleteError || null);
  }));
  if (leftovers.length > 20) step(`run users deleted (${leftovers.filter((u) => u.deleted).length} of ${leftovers.length})`, leftovers.every((u) => u.deleted));
  if (!keepOpen) {
    // Todas las identidades persistentes del tenant, estén o no en esta invocación: operadores, pagadores y el
    // dueño del segundo negocio. Acceso suspendido y contraseña descartada.
    const persistentUsers = await guarded('persistent identities', () => ctx.env.observe(`select id, email from auth.users u where u.email like ${sqlText(identity.operatorEmailPattern)}`)) || [];
    await pool(persistentUsers, Math.min(4, Math.max(1, persistentUsers.length)), (user) => guarded('suspend persistent identity', async () => {
      const r = await ctx.serviceRole('cleanup', 'auth.admin.updateUserById (persistent identity: suspend access, discard password)',
        (admin) => admin.auth.admin.updateUserById(user.id, { password: randomPassword(), ban_duration: BAN_FOREVER }));
      if (r.error || persistentUsers.length <= 12) step(`suspend ${String(user.email).split('@')[0].slice(identity.emailPrefix.length)}`, !r.error, r.error?.code || null);
    }));
    if (persistentUsers.length > 12) step(`persistent identities suspended (${persistentUsers.length})`, true);
  }
  ctx.persist();

  // 7. Verificación posterior, con el observador.
  const runUserIds = ctx.ledger.users.map((u) => u.userId).filter(Boolean);
  const secondId = ctx.ledger.businesses.find((b) => b.second)?.id || null;
  const post = (await ctx.env.observe(`select
    (select count(*) from public.orders where business_id = ${sqlUuid(id)} and status not in ${TERMINAL_SQL})::int as open_orders,
    (select count(*) from public.orders where business_id = ${sqlUuid(id)} and origin <> 'qa')::int as non_qa_orders,
    (select count(*) from public.orders where business_id = ${sqlUuid(id)} and manual_payment_status = 'confirmed')::int as confirmed_payments,
    (select count(*) from public.orders where business_id = ${sqlUuid(id)})::int as orders,
    (select count(*) from public.rider_order_offers where business_id = ${sqlUuid(id)} and status = 'pending')::int as pending_offers,
    (select count(*) from public.notification_outbox n join public.orders o on o.id = n.aggregate_id where o.business_id = ${sqlUuid(id)} and n.state = 'pending')::int as pending_notifications,
    (select count(*) from public.inventory_reservations r join public.products p on p.id = r.product_id where p.business_id = ${sqlUuid(id)} and r.status in ('active','pending','reserved'))::int as reservations,
    (select count(*) from public.rider_locations l join public.orders o on o.id = l.order_id where o.business_id = ${sqlUuid(id)})::int as rider_locations,
    (select count(*) from public.checkout_sessions s where s.business_id = ${sqlUuid(id)})::int as checkout_sessions,
    (select count(*) from public.checkout_sessions s where s.business_id = ${sqlUuid(id)} and s.status in ${OPEN_SESSION_SQL})::int as open_checkout_sessions,
    (select count(*) from public.payment_intents i where i.business_id = ${sqlUuid(id)} and i.paid_amount is not null and i.refunded_amount < i.paid_amount)::int as payments_not_refunded,
    (select count(*) from public.payment_outbox po join public.payment_intents i on i.id = po.payment_intent_id where i.business_id = ${sqlUuid(id)} and po.status <> 'completed')::int as payment_outbox_jobs,
    (select json_build_object('enabled', s.enabled, 'seller', (select c.status from public.mp_seller_connections c where c.business_id = s.business_id and c.environment = s.environment))
       from public.business_payment_settings s where s.business_id = ${sqlUuid(id)}) as payment_fixture,
    (select count(*) from auth.users where id in (${sqlUuidList(runUserIds)}))::int as run_users_left,
    (select count(*) from auth.users u where u.email like ${sqlText(identity.emailPattern)} and u.email not like ${sqlText(identity.operatorEmailPattern)})::int as any_run_users_left,
    (select count(*) from public.identity_sessions where business_id = ${sqlUuid(id)} and revoked_at is null)::int as open_sessions,
    (select json_agg(json_build_object('rider', rider_user_id, 'available', available)) from public.rider_availability where business_id = ${sqlUuid(id)}) as riders,
    (select count(*) from public.businesses where slug like ${sqlText(`${identity.throwawaySlugPrefix}%`)})::int as throwaway_businesses,
    (select count(*) from public.business_service_exceptions where business_id = ${sqlUuid(id)})::int as exceptions,
    (select count(*) from public.delivery_zones where business_id = ${sqlUuid(id)} and not is_active)::int as inactive_zones,
    (select count(*) from auth.users u where u.email like ${sqlText(identity.operatorEmailPattern)})::int as persistent_identities,
    (select count(*) from auth.users u where u.email like ${sqlText(identity.operatorEmailPattern)} and (u.banned_until is null or u.banned_until <= now()))::int as operators_not_suspended,
    (select row_to_json(b) from (select status, is_active, ordering_enabled, ordering_verified, qa_fixture, qa_window_until, hours_enforced, delivery_zone_enforced,
       delivery_enabled, pickup_enabled, delivery_fee, minimum_delivery_subtotal, alcohol_sales_enabled from public.businesses where id = ${sqlUuid(id)}) b) as business,
    ${secondId ? `(select row_to_json(b) from (select status, ordering_enabled, ordering_verified, qa_fixture, qa_window_until,
       (select count(*) from public.orders o where o.business_id = x.id and o.status not in ${TERMINAL_SQL})::int as open_orders,
       (select count(*) from public.orders o where o.business_id = x.id and o.origin <> 'qa')::int as non_qa_orders,
       (select count(*) from public.identity_sessions s where s.business_id = x.id and s.revoked_at is null)::int as open_sessions
       from public.businesses x where x.id = ${sqlUuid(secondId)}) b)` : 'null::json'} as second_business`))[0];
  const fixtures = fixturesAtDeclaredState(fixtureRows(await readTenantDetail(ctx, id)));
  const C = ctx.rec.check;
  C(P, 'NO_OPEN_ORDERS_IN_TENANT', post.open_orders === 0, { open: post.open_orders, total: post.orders });
  C(P, 'ALL_TENANT_ORDERS_CLASSIFIED_QA', post.non_qa_orders === 0, { nonQa: post.non_qa_orders });
  C(P, 'NO_CONFIRMED_MANUAL_PAYMENT_LEFT', post.confirmed_payments === 0, { confirmed: post.confirmed_payments });
  C(P, 'NO_PENDING_OFFERS_NOTIFICATIONS_RESERVATIONS_GPS', post.pending_offers === 0 && post.pending_notifications === 0 && post.reservations === 0 && post.rider_locations === 0,
    { offers: post.pending_offers, notifications: post.pending_notifications, reservations: post.reservations, gps: post.rider_locations });
  if (post.checkout_sessions > 0) {
    // Sólo cuando la corrida usó el camino de Mercado Pago: ninguna sesión que retenga stock, ningún cobro sin
    // devolver, nada en la cola de pagos y el cobro del tenant apagado.
    C(P, 'NO_OPEN_CHECKOUT_SESSION_AND_NO_PAYMENT_LEFT_UNREFUNDED', post.open_checkout_sessions === 0 && post.payments_not_refunded === 0 && post.payment_outbox_jobs === 0,
      { checkoutSessions: post.checkout_sessions, open: post.open_checkout_sessions, paymentsNotRefunded: post.payments_not_refunded, outboxJobs: post.payment_outbox_jobs });
    C(P, 'PAYMENT_FIXTURE_SWITCHED_OFF_AT_REST', keepOpen || (post.payment_fixture?.enabled === false && post.payment_fixture?.seller !== 'connected'), post.payment_fixture);
  }
  C(P, 'RUN_USERS_DELETED', post.run_users_left === 0 && post.any_run_users_left === 0, { byId: post.run_users_left, withTheTenantPrefix: post.any_run_users_left });
  C(P, 'THROWAWAY_BUSINESS_DELETED', post.throwaway_businesses === 0, { left: post.throwaway_businesses });
  C(P, 'NO_OPEN_IDENTITY_SESSIONS_IN_TENANT', post.open_sessions === 0, { open: post.open_sessions });
  C(P, 'RIDERS_UNAVAILABLE', (post.riders || []).every((r) => r.available === false), post.riders);
  C(P, 'FIXTURE_STOCK_AT_DECLARED_VALUE', fixtures.every((f) => f.stockOk), fixtures.map((f) => `${f.role}:${f.stock}/${f.declaredStock}`));
  C(P, 'FIXTURE_PRICE_NAME_AND_PUBLICATION_AT_DECLARED_STATE', fixtures.every((f) => f.priceOk && f.nameOk && f.stateOk), fixtures.filter((f) => !(f.priceOk && f.nameOk && f.stateOk)));
  C(P, 'TENANT_CONFIG_CANONICAL', post.exceptions === 0 && post.inactive_zones === 0 && post.business.hours_enforced && post.business.delivery_zone_enforced
    && post.business.delivery_enabled && post.business.pickup_enabled && Number(post.business.delivery_fee) === DELIVERY.businessFee
    && Number(post.business.minimum_delivery_subtotal) === DELIVERY.businessMinimum && post.business.alcohol_sales_enabled !== true,
  { exceptions: post.exceptions, inactiveZones: post.inactive_zones, business: post.business });
  if (keepOpen) {
    C(P, 'TENANT_LEFT_OPEN_ON_REQUEST_WITH_QA_WINDOW', post.business.status === 'open' && post.business.qa_fixture && Boolean(post.business.qa_window_until), post.business);
  } else {
    C(P, 'TENANT_CLOSED_AND_ORDERING_DISABLED', post.business.status === 'closed' && !post.business.ordering_enabled && !post.business.ordering_verified
      && post.business.qa_window_until === null, post.business);
    if (post.second_business) {
      C(P, 'SECOND_BUSINESS_CLOSED_WITH_ITS_ORDER_SETTLED', post.second_business.status === 'closed' && !post.second_business.ordering_enabled && !post.second_business.ordering_verified
        && post.second_business.qa_window_until === null && post.second_business.open_orders === 0 && post.second_business.non_qa_orders === 0
        && post.second_business.open_sessions === 0, post.second_business);
    }
    // La suspensión es de GoTrue: donde no existe, la fila la escribió el sustituto y no prueba nada.
    const withoutGotrue = ctx.env.target.lacks('gotrue');
    if (withoutGotrue) ctx.rec.skipOnTarget(P, 'OPERATORS_SUSPENDED_BETWEEN_RUNS', withoutGotrue);
    else C(P, 'OPERATORS_SUSPENDED_BETWEEN_RUNS', post.operators_not_suspended === 0, { persistentIdentities: post.persistent_identities, notSuspended: post.operators_not_suspended });
  }
  C(P, 'CLEANUP_STEPS_ALL_OK', steps.every((s) => s.ok), steps.filter((s) => !s.ok));
  ctx.ledger.finishedAt = nowIso();
  ctx.persist();
  return { steps, post, fixtures, retainedByDesign: [
    `businesses row of the QA tenant «${identity.name}» (closed, ordering disabled, qa_fixture) with its hours, zones and fixture products`,
    ...(secondId ? [`businesses row of the second business «${identity.second.name}» (closed, ordering disabled, qa_fixture): its order retains it`] : []),
    `persistent identities of the tenant (${post.persistent_identities}: operators, paying customers, the owner of the second business), suspended and with the password discarded: command receipts, config audit, inventory movements, rider offers and checkout sessions reference them with ON DELETE RESTRICT`,
    'orders of the tenant (origin=qa, terminal) with order_items / order_events / order_public_tokens / order_delivery_handoffs: append-only audit',
    'inventory_movements of the tenant (manual_adjustment qa_ecom_cert_reset): append-only ledger',
    'business_command_receipts, business_config_audit, rider_delivery_operations, delivery_confirmation_attempts, identity_sessions (revoked) and identity_audit_events of the tenant',
    'notification_outbox rows of the tenant: processed and suppressed when the order is classified QA',
    ...(post.checkout_sessions > 0 ? ['checkout_sessions, payment_intents, payment_attempts, payment_events and payment_refunds of the tenant (all refunded or never charged; provider ids are invented, no provider was called)',
      'business_payment_settings (disabled) and mp_seller_connections (disconnected, no credentials) of the tenant'] : []),
  ] };
}

export { rowOf };
