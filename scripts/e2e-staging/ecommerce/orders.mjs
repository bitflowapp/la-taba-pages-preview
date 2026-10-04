// CERTIFICACIÓN E-COMMERCE — pedidos: el contrato del cliente y la verdad de la base.
//
// El payload es el mismo que arma la tienda (`createOrderInternal` del repositorio
// web): ítems con `product_id` + `quantity` y nada de plata. La verdad se lee
// SIEMPRE con el observador de sólo lectura.
import { TENANT, nowIso, randomToken, rowOf, sha, shortId, sqlText, sqlUuid, sqlUuidList } from './env.mjs';
import { DELIVERY, FIXTURES, TERMINAL_SQL, normalizeFixtures, settleOrders } from './tenant.mjs';
import { createSupabaseOrderRepository } from '../../../js/repositories/supabase_order_repository.js';

const memoryStorage = () => { const m = new Map(); return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k) }; };

// Claves que nombran un dato de una persona. Un documento que sale hacia afuera (el seguimiento público, la
// traza de un pedido, la salud) no puede traer ninguna.
export const PII_KEYS = /customer|phone|whatsapp|email|street|address|neighbo|apartment|floor|notes|latitude|longitude|^lat$|^lng$|tracking_token|delivery_code|password/i;
// Qué de una persona aparece en un documento: por clave (en cualquier nivel) y por valor (sus datos, tal cual).
// `allowKeys` son claves del documento que se llaman parecido y no son un dato personal (se dicen una por una).
export function piiLeaks(document, people = [], { allowKeys = [] } = {}) {
  const leaks = [];
  const visit = (value, trail) => {
    if (Array.isArray(value)) { value.forEach((item, index) => visit(item, `${trail}[${index}]`)); return; }
    if (value && typeof value === 'object') {
      for (const [key, child] of Object.entries(value)) {
        if (PII_KEYS.test(key) && !allowKeys.includes(key) && child !== null && child !== undefined) leaks.push(`key:${trail}.${key}`);
        visit(child, `${trail}.${key}`);
      }
    }
  };
  visit(document, '$');
  const text = JSON.stringify(document ?? null);
  for (const person of people.filter(Boolean)) {
    for (const [field, value] of Object.entries({ name: person.name, phone: person.phone, email: person.email, userId: person.userId })) {
      if (value && String(value).length >= 6 && text.includes(String(value))) leaks.push(`value:${field}`);
    }
  }
  for (const needle of ['Calle Certificacion', 'Calle Sin Punto']) if (text.includes(needle)) leaks.push('value:street');
  return leaks;
}

// Clave de la app Rider: android- + sha256("op:id:revision:code") (Domain.kt · RiderCommands.key).
export const riderKey = (operation, id, revision, code = '') => `android-${sha(`${operation}:${id}:${revision}:${code}`)}`;
export const STOREFRONT_PRODUCT_COLUMNS = Object.freeze(['id', 'business_id', 'external_id', 'sku', 'name', 'brand', 'description', 'category',
  'subcategory', 'variant', 'presentation', 'capacity_value', 'capacity_unit', 'capacity', 'packaging_type', 'units_per_pack', 'sold_as_pack',
  'price', 'price_status', 'stock', 'available', 'chilled', 'is_alcoholic', 'minimum_age', 'image_url', 'image_sha256', 'image_thumbnail_url',
  'image_thumbnail_sha256', 'source_image_sha256', 'tags', 'sort_order', 'is_active', 'is_verified']);
// La consulta de góndola de la tienda (js/repositories/supabase_order_repository.js · loadCatalog):
// mismas columnas, mismos filtros, mismo orden.
export const storefrontCatalogQuery = (businessId) => `products?select=${STOREFRONT_PRODUCT_COLUMNS.join(',')}`
  + `&business_id=eq.${businessId}&is_active=eq.true&is_verified=eq.true`
  + '&or=(available.eq.true,and(is_alcoholic.is.true,available.is.false,image_url.not.is.null))'
  + '&order=sort_order.asc,name.asc';
// El historial del cliente en la tienda (fetchOrders): sus pedidos del comercio, con ítems.
export const customerHistoryQuery = (businessId) => `orders?select=*,order_items(*)&business_id=eq.${businessId}&order=created_at.desc&limit=100`;

export function createOrders(ctx) {
  const tenantId = ctx.tenant.id;
  const notes = `${ctx.runId} QA certificacion ecommerce ${ctx.env.target.environment.toLowerCase()} no despachar`;
  const newRequestId = (label) => `${TENANT.requestPrefix}${String(label).replace(/[^A-Za-z0-9_-]/g, '-').slice(0, 30)}-${ctx.runTag}-${shortId(4)}`;
  const newToken = () => ctx.redactor.secret(randomToken());
  const product = (role) => {
    const p = ctx.tenant.products[role];
    if (!p?.id) throw Error(`FIXTURE_NOT_READY:${role}`);
    return p;
  };

  // `inline`: dirección escrita en el pedido (sin dirección guardada), con su punto confirmado.
  function payload({ customer, items, role = 'MAIN', quantity = 1, mode = 'pickup', payment = 'cash', requestId, token, label = 'order',
    neighborhood = DELIVERY.pin.neighborhood, inline = false, pin = true, extra = {} }) {
    const base = { business_id: tenantId, client_request_id: requestId || newRequestId(label), tracking_token: token || newToken(),
      items: items || [{ product_id: product(role).id, quantity }], customer_name: customer.name, customer_phone: customer.phone,
      delivery_mode: mode, payment_method: payment, age_confirmed: false, customer_notes: notes };
    if (mode === 'delivery') {
      if (!inline && customer.addressId) {
        Object.assign(base, { customer_address_id: customer.addressId, customer_street_address: 'Calle Certificacion 101', customer_neighborhood: neighborhood });
      } else {
        Object.assign(base, { customer_street_address: 'Calle Certificacion 202', customer_neighborhood: neighborhood, delivery_address_source: 'manual' });
        if (pin) {
          Object.assign(base, { delivery_latitude: DELIVERY.pin.lat, delivery_longitude: DELIVERY.pin.lng, delivery_geolocation_accuracy: 10,
            delivery_location_source: 'map_pin', delivery_location_confirmed_at: nowIso() });
        }
      }
    }
    return { ...base, ...extra };
  }

  // Alta por el contrato del cliente. La intención queda en el ledger ANTES de enviarse.
  async function create(customer, options = {}) {
    const body = options.payload || payload({ customer, ...options });
    const entry = { label: options.label || 'order', clientRequestId: body.client_request_id, id: null, publicCode: null, at: nowIso() };
    ctx.ledger.orders.push(entry);
    if (!options.quiet) ctx.persist();
    const r = await ctx.http.call(customer, 'create_order_with_items', { payload: body }, options.call || {});
    const order = r.ok ? rowOf(r.data) : null;
    if (order?.id) { entry.id = order.id; entry.publicCode = order.public_code; if (!options.quiet) ctx.persist(); }
    return { r, order: order?.id ? order : null, payload: body, requestId: body.client_request_id, token: body.tracking_token };
  }

  const transition = (actor, orderId, status, revision, key) => ctx.http.call(actor, 'transition_order', { p_order_id: orderId, p_expected_revision: revision,
    p_new_status: status, p_idempotency_key: key || `ecomcert-tx-${shortId(8)}` });
  const cancel = (actor, orderId, revision, reason, key) => ctx.http.call(actor, 'cancel_order', { p_order_id: orderId, p_expected_revision: revision,
    p_reason: reason || `${ctx.runId} QA cancelacion`, p_idempotency_key: key || `ecomcert-cx-${shortId(8)}` });
  const tracking = (publicId, token, actor = null) => ctx.http.call(actor, 'get_public_order_tracking', { p_public_id: publicId },
    { headers: token ? { 'x-order-token': token } : {} });

  // ── Verdad de la base ──────────────────────────────────────────────────────
  const state = async (orderId) => (await ctx.env.observe(`select id, public_code, status, revision, origin, assigned_rider_user_id, manual_payment_status,
    inventory_released_at, acknowledged_at, subtotal, delivery_fee, total, updated_at from public.orders where id = ${sqlUuid(orderId)}`))[0] || null;

  const truth = async (orderId) => (await ctx.env.observe(`select row_to_json(o) as order_row,
    (select json_agg(row_to_json(i) order by i.created_at, i.id) from public.order_items i where i.order_id = o.id) as items,
    (select json_agg(json_build_object('sequence', e.sequence, 'event_type', e.event_type, 'actor_role', e.actor_role, 'actor_user_id', e.actor_user_id,
       'metadata', e.metadata, 'created_at', e.created_at) order by e.sequence) from public.order_events e where e.order_id = o.id) as events,
    (select count(*) from public.order_public_tokens t where t.order_id = o.id)::int as tracking_tokens,
    (select count(*) from public.order_delivery_handoffs h where h.order_id = o.id)::int as handoffs,
    (select json_agg(json_build_object('status', f.status, 'rider', f.rider_user_id, 'version', f.version)) from public.rider_order_offers f where f.order_id = o.id) as offers,
    (select json_agg(json_build_object('command', r.command_type, 'key_hash', md5(r.idempotency_key))) from public.business_command_receipts r where r.order_id = o.id) as receipts,
    (select count(*) from public.rider_locations l where l.order_id = o.id)::int as rider_locations
    from public.orders o where o.id = ${sqlUuid(orderId)} and o.business_id = ${sqlUuid(tenantId)}`))[0] || null;

  // Productos fixture por rol, tal como están ahora.
  async function fixtures() {
    const rows = await ctx.env.observe(`select id, sku, name, price, price_status, stock, available, merchant_available, is_verified, is_active
      from public.products where business_id = ${sqlUuid(tenantId)}`);
    return Object.fromEntries(Object.values(FIXTURES).map((f) => [f.role, rows.find((r) => r.sku === f.sku) || null]));
  }

  // Una foto del tenant para afirmar «no se creó nada»: pedidos, ítems, eventos y stock.
  async function footprint() {
    const row = (await ctx.env.observe(`select
      (select count(*) from public.orders where business_id = ${sqlUuid(tenantId)})::int as orders,
      (select count(*) from public.order_items i join public.orders o on o.id = i.order_id where o.business_id = ${sqlUuid(tenantId)})::int as items,
      (select count(*) from public.order_events where business_id = ${sqlUuid(tenantId)})::int as events,
      (select count(*) from public.order_public_tokens t join public.orders o on o.id = t.order_id where o.business_id = ${sqlUuid(tenantId)})::int as tokens,
      (select count(*) from public.inventory_movements where business_id = ${sqlUuid(tenantId)})::int as movements,
      (select json_object_agg(sku, stock order by sku) from public.products where business_id = ${sqlUuid(tenantId)}) as stock,
      (select json_object_agg(sku, available order by sku) from public.products where business_id = ${sqlUuid(tenantId)}) as available`))[0];
    return row;
  }
  // Qué cambió entre dos fotos (vacío = nada).
  // Las claves se ordenan antes de comparar: el orden de un objeto JSON no es un dato.
  const stable = (value) => (value && typeof value === 'object' ? JSON.stringify(Object.keys(value).sort().map((k) => [k, value[k]])) : JSON.stringify(value));
  const footprintDiff = (a, b) => ['orders', 'items', 'events', 'tokens', 'stock', 'available']
    .filter((key) => stable(a[key]) !== stable(b[key])).map((key) => ({ key, before: a[key], after: b[key] }));
  const sameFootprint = (a, b) => footprintDiff(a, b).length === 0;

  const byRequestIds = (requestIds) => ctx.env.observe(`select id, public_code, status, revision, client_request_id, customer_user_id
    from public.orders where business_id = ${sqlUuid(tenantId)} and client_request_id in (${requestIds.map(sqlText).join(',') || "''"})`);
  const countByPrefix = async (prefix) => (await ctx.env.observe(`select count(*)::int as n, count(*) filter (where status not in ${TERMINAL_SQL})::int as open
    from public.orders where business_id = ${sqlUuid(tenantId)} and client_request_id like ${sqlText(`${prefix}%`)}`))[0];
  const statesOf = (orderIds) => ctx.env.observe(`select id, status, revision, inventory_released_at, manual_payment_status from public.orders where id in (${sqlUuidList(orderIds)})`);

  // ── Rider: las mismas llamadas que hace la app Android ──────────────────────
  async function riderAvailability(rider, value) {
    const board = await ctx.http.call(rider, 'get_rider_delivery_board');
    const version = Number(board.data?.availability_version || 0);
    const r = await ctx.http.call(rider, 'set_rider_availability', { p_business_id: tenantId, p_available: value, p_expected_version: version,
      p_idempotency_key: riderKey('availability', tenantId, version, String(value)) });
    if (value) await ctx.http.call(rider, 'heartbeat_rider_availability', { p_business_id: tenantId });
    return r;
  }
  // Un paso del rider sobre un pedido, con la clave que arma la app (operación + pedido + revisión).
  async function riderStep(rider, fn, orderId, { code = '' } = {}) {
    const before = await state(orderId);
    const params = { p_order_id: orderId, p_expected_revision: Number(before.revision), ...(code ? { p_delivery_code: code } : {}),
      p_idempotency_key: riderKey(fn, orderId, before.revision, code) };
    const r = await ctx.http.call(rider, fn, params);
    const after = await state(orderId);
    return { r, before, after, params };
  }
  const offer = (staffActor, orderId, riderUserId) => ctx.http.call(staffActor, 'offer_order_to_rider', { p_order_id: orderId, p_expected_status: 'ready',
    p_expected_rider_user_id: null, p_new_rider_user_id: riderUserId });
  const statusChain = (events) => (events || []).filter((e) => e.event_type === 'order.status_changed').map((e) => `${e.metadata.previous_status}>${e.metadata.next_status}`);
  const countEvents = (events, type) => (events || []).filter((e) => e.event_type === type).length;

  // El MISMO repositorio que usa el Panel, con la sesión de un operador del tenant.
  const panelRepository = (actor) => createSupabaseOrderRepository({ client: actor.client, businessId: tenantId, storage: memoryStorage(),
    durableStorage: memoryStorage(), windowRef: undefined, documentRef: undefined });

  // Cierre de fase: pedidos del tenant cerrados por el camino real y fixtures en su estado declarado.
  async function settle(reason = 'cierre de fase') {
    const settled = await settleOrders(ctx);
    const fixtureSteps = await normalizeFixtures(ctx, { reason });
    return { settled, fixtureSteps };
  }

  // Lleva un pedido hasta `status` por las transiciones del comercio, una por una y con la revisión vigente.
  const BUSINESS_PATH = ['accepted', 'preparing', 'ready'];
  async function advance(actor, orderId, status) {
    const steps = [];
    let current = await state(orderId);
    for (const next of BUSINESS_PATH.slice(0, BUSINESS_PATH.indexOf(status) + 1)) {
      if (BUSINESS_PATH.indexOf(current.status) >= BUSINESS_PATH.indexOf(next)) continue;
      const r = await transition(actor, orderId, next, Number(current.revision));
      steps.push({ status: next, http: r.status, code: r.code });
      current = await state(orderId);
      if (!r.ok) break;
    }
    return { state: current, steps, ok: current.status === status };
  }

  // Todos los identificadores con los que alguien puede preguntar por un pedido: los suyos y, si se pagó por
  // Mercado Pago, los de su checkout, su intento de pago y el proveedor. Los lee el observador.
  async function references(orderId) {
    return (await ctx.env.observe(`select o.id as order_id, o.public_code, o.client_request_id, o.correlation_id,
      (select t.id from public.order_public_tokens t where t.order_id = o.id order by t.created_at limit 1) as tracking_token_id,
      s.id as checkout_session_id, s.client_request_id as checkout_client_request_id,
      i.id as payment_intent_id, i.provider_payment_id, i.external_reference, i.preference_id, i.provider_merchant_order_id as merchant_order_id,
      (select a.id from public.payment_attempts a where a.payment_intent_id = i.id order by a.attempt_number desc limit 1) as payment_attempt_id
      from public.orders o
      left join public.checkout_sessions s on s.completed_order_id = o.id
      left join public.payment_intents i on i.checkout_session_id = s.id
      where o.id = ${sqlUuid(orderId)}`))[0] || null;
  }

  // Dónde están las unidades de un producto: en la góndola, apartadas por un checkout vivo, o en un pedido que
  // no las devolvió. La suma no cambia mientras nadie corrija el stock a mano: es la cuenta de conservación.
  async function unitsOf(productId) {
    return (await ctx.env.observe(`select p.stock,
      coalesce((select sum(r.quantity) from public.inventory_reservations r where r.product_id = p.id and r.status = 'active'), 0)::int as reserved,
      coalesce((select sum(i.quantity) from public.order_items i join public.orders o on o.id = i.order_id
         where i.product_uuid = p.id and o.inventory_released_at is null), 0)::int as in_orders
      from public.products p where p.id = ${sqlUuid(productId)}`))[0];
  }

  return { notes, newRequestId, newToken, product, payload, create, transition, cancel, tracking, state, truth, fixtures, footprint, sameFootprint, footprintDiff,
    byRequestIds, countByPrefix, statesOf, settle, panelRepository, advance, references, unitsOf,
    riderAvailability, riderStep, offer, statusChain, countEvents };
}
