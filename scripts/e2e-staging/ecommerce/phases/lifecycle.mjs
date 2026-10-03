// FASE lifecycle — UN pedido, de punta a punta, por los contratos reales de cada cliente.
//
//   cliente (alta, seguimiento con token, código de entrega, historial)
//   comercio (acuse, aceptar, preparar, listo, oferta al rider, cobro en efectivo)
//   rider (disponible, aceptar, retirar, en camino + ubicación, llegó, código)
// y un segundo pedido de retiro que cierra el comercio.
import { randomUUID } from 'node:crypto';
import { jwtClaims, nowIso, shortId, sleep } from '../env.mjs';
import { brief } from '../http.mjs';
import { customerHistoryQuery } from '../orders.mjs';

const P = 'lifecycle';
const DELIVERY_CHAIN = ['received>accepted', 'accepted>preparing', 'preparing>ready', 'ready>assigned', 'assigned>picked_up',
  'picked_up>on_the_way', 'on_the_way>arrived', 'arrived>delivered'];
const PICKUP_CHAIN = ['received>accepted', 'accepted>preparing', 'preparing>ready', 'ready>delivered'];
const PII_KEYS = /customer|phone|name|address|street|user_id|notes|token|business_id|^id$|email/i;

export default {
  id: P,
  title: 'ciclo de vida completo: delivery en efectivo con rider y código, y un retiro',
  requires: [],
  async run(ctx) {
    const C = ctx.rec.check;
    const id = ctx.tenant.id;
    const { staff, rider1, rider2 } = ctx.actors;
    // El cliente real de la tienda es una sesión anónima; se usa una sola por corrida.
    const anonymous = await ctx.identities.createAnonymousCustomer('lifecycle');
    const customer = anonymous || await ctx.identities.customer('lifecycle');
    // Que la tienda consiga una sesión anónima es un hecho de GoTrue. Donde no existe, el token lleva el mismo
    // claim `is_anonymous` y el backend lo trata igual, pero el ingreso en sí no se probó. Donde GoTrue es real
    // (Staging, el stack) se afirma sobre el token que emitió: es anónimo, es de un usuario y trae su sesión.
    const withoutGotrue = ctx.env.target.lacks('gotrue');
    if (anonymous && withoutGotrue) ctx.rec.skipOnTarget(P, 'CUSTOMER_IS_AN_ANONYMOUS_STOREFRONT_SESSION', withoutGotrue);
    else if (anonymous) {
      const claims = jwtClaims(anonymous.jwt) || {};
      C(P, 'CUSTOMER_IS_AN_ANONYMOUS_STOREFRONT_SESSION', Boolean(anonymous.userId && anonymous.addressId) && claims.is_anonymous === true && claims.role === 'authenticated'
        && claims.sub === anonymous.userId && Boolean(claims.session_id),
      { anonymous: true, claims: { is_anonymous: claims.is_anonymous ?? null, role: claims.role ?? null, subIsTheUser: claims.sub === anonymous.userId, hasSessionId: Boolean(claims.session_id) } },
      'un token de Auth con is_anonymous, rol authenticated, su usuario y su session_id');
    }
    const s0 = (await ctx.orders.fixtures()).MAIN.stock;
    const stages = [];
    const panel = ctx.orders.panelRepository(staff);

    // ── Alta ──────────────────────────────────────────────────────────────────
    const created = await ctx.orders.create(customer, { mode: 'delivery', role: 'MAIN', quantity: 2, payment: 'cash', label: 'lifecycle-delivery' });
    C(P, 'CUSTOMER_CREATES_DELIVERY_CASH_ORDER', Boolean(created.order) && created.order.status === 'received' && created.order.payment_method === 'cash'
      && created.order.delivery_mode === 'delivery', brief(created.r));
    if (!created.order) return;
    const O = created.order.id;
    const code = created.order.public_code;
    const track = async (stage) => {
      const r = await ctx.orders.tracking(code, created.token);
      stages.push({ stage, at: nowIso(), tracking: r.data ? { status: r.data.status, revision: r.data.revision, location_quality: r.data.location_quality, hasRiderLocation: Boolean(r.data.rider_location) } : null });
      return r;
    };
    const first = await track('received');
    C(P, 'TRACKING_RECEIVED', first.ok && first.data?.status === 'received' && first.data?.public_code === code, { ...brief(first), status: first.data?.status });
    const dtoKeys = Object.keys(first.data || {});
    const dtoText = JSON.stringify(first.data || {});
    C(P, 'TRACKING_DTO_HAS_NO_PII', dtoKeys.length > 0 && !dtoKeys.some((k) => PII_KEYS.test(k)) && !dtoText.includes(customer.phone) && !dtoText.includes(customer.name)
      && !dtoText.includes('Calle Certificacion') && !dtoText.includes(customer.userId), dtoKeys);
    const inbox = await panel.fetchBusinessOrderSnapshot();
    const inboxRow = inbox.ok ? (inbox.rows || []).find((row) => row.id === O) : null;
    C(P, 'PANEL_INBOX_SHOWS_THE_NEW_ORDER', Boolean(inboxRow) && inboxRow.status === 'received' && Number(inboxRow.total) === Number(created.order.total)
      && inboxRow.order_items?.length === 1 && Number(inboxRow.order_items[0].quantity) === 2, { ok: inbox.ok, code: inbox.code || null, found: Boolean(inboxRow), status: inboxRow?.status });

    // ── Comercio ──────────────────────────────────────────────────────────────
    let state = await ctx.orders.state(O);
    const ack = await ctx.http.call(staff, 'acknowledge_order', { p_order_id: O, p_expected_revision: Number(state.revision), p_idempotency_key: `ecomcert-ack-${shortId(8)}` });
    state = await ctx.orders.state(O);
    C(P, 'STAFF_ACKNOWLEDGES', ack.ok && Boolean(state.acknowledged_at) && state.status === 'received', { ...brief(ack), acknowledged_at: state.acknowledged_at });
    for (const [status, name] of [['accepted', 'STAFF_ACCEPTS'], ['preparing', 'STAFF_STARTS_PREPARING'], ['ready', 'STAFF_MARKS_READY']]) {
      const r = await ctx.orders.transition(staff, O, status, Number(state.revision));
      state = await ctx.orders.state(O);
      const t = await track(status);
      C(P, name, r.ok && state.status === status && t.data?.status === status, { ...brief(r), database: state.status, tracking: t.data?.status });
    }

    // ── Rider ─────────────────────────────────────────────────────────────────
    const available = await ctx.orders.riderAvailability(rider1, true);
    ctx.timers.push(setInterval(() => { void ctx.http.call(rider1, 'heartbeat_rider_availability', { p_business_id: id }); }, 30_000));
    const board0 = await ctx.http.call(rider1, 'get_rider_delivery_board');
    const presence = await ctx.http.call(staff, 'list_business_rider_availability', { p_business_id: id });
    C(P, 'RIDER_AVAILABLE_AND_VISIBLE_TO_THE_PANEL', available.ok && board0.data?.available === true && presence.ok && JSON.stringify(presence.data || '').includes(rider1.userId),
      { set: available.data?.code || available.code, board: board0.data?.available, panel: brief(presence) });
    const offered = await ctx.orders.offer(staff, O, rider1.userId);
    C(P, 'STAFF_OFFERS_THE_ORDER_TO_THE_RIDER', offered.ok && offered.data?.ok === true && offered.data?.code === 'offered', offered.data || brief(offered));
    const board1 = await ctx.http.call(rider1, 'get_rider_delivery_board');
    const board2 = await ctx.http.call(rider2, 'get_rider_delivery_board');
    const offerOnBoard = (board1.data?.offers || []).find((f) => (f.offer_id || f.id) === offered.data?.offer_id);
    C(P, 'RIDER_BOARD_SHOWS_THE_OFFER_ONLY_TO_ITS_RIDER', Boolean(offerOnBoard) && !(board2.data?.offers || []).some((f) => (f.offer_id || f.id) === offered.data?.offer_id),
      { rider1Offers: (board1.data?.offers || []).length, rider2Offers: (board2.data?.offers || []).length });
    const accepted = await ctx.http.call(rider1, 'accept_rider_order_offer', { p_offer_id: offered.data?.offer_id,
      p_expected_version: Number(offerOnBoard?.version ?? offered.data?.version), p_idempotency_key: `android-${shortId(32)}` });
    state = await ctx.orders.state(O);
    let t = await track('assigned');
    C(P, 'RIDER_ACCEPTS_AND_IS_ASSIGNED', accepted.ok && accepted.data?.ok === true && state.status === 'assigned' && state.assigned_rider_user_id === rider1.userId
      && t.data?.status === 'assigned', { code: accepted.data?.code || accepted.code, database: state.status, tracking: t.data?.status });
    const board3 = await ctx.http.call(rider1, 'get_rider_delivery_board');
    const riderOrder = (board3.data?.orders || []).find((o) => o.id === O);
    C(P, 'RIDER_BOARD_SHOWS_THE_ASSIGNED_ORDER', Boolean(riderOrder) && riderOrder.status === 'assigned' && Number(riderOrder.total) === Number(created.order.total)
      && Boolean(riderOrder.customer_location), { found: Boolean(riderOrder), status: riderOrder?.status, total: riderOrder?.total, hasCustomerLocation: Boolean(riderOrder?.customer_location) });
    const picked = await ctx.orders.riderStep(rider1, 'mark_delivery_picked_up', O);
    t = await track('picked_up');
    C(P, 'RIDER_PICKS_UP', picked.r.ok && picked.r.data?.ok === true && picked.after.status === 'picked_up' && t.data?.status === 'picked_up', { code: picked.r.data?.code || picked.r.code, tracking: t.data?.status });
    const started = await ctx.orders.riderStep(rider1, 'start_rider_delivery', O);
    const gps = await ctx.http.call(rider1, 'publish_rider_location_fanout', { p_lat: -38.9488, p_lng: -68.0562, p_accuracy: 12, p_heading: 210, p_speed: 6,
      p_captured_at: nowIso(), p_idempotency_key: randomUUID(), p_is_mock: false });
    await sleep(600);
    t = await track('on_the_way');
    C(P, 'RIDER_ON_THE_WAY_WITH_LOCATION_PUBLISHED', started.r.ok && started.after.status === 'on_the_way' && gps.ok && gps.data?.ok !== false && t.data?.status === 'on_the_way',
      { start: started.r.data?.code || started.r.code, gps: gps.data?.code || gps.code, tracking: t.data?.status });
    C(P, 'TRACKING_SHOWS_ONLY_A_COARSE_RIDER_LOCATION', Boolean(t.data?.rider_location) && Number(t.data.rider_location.accuracy) >= 100
      && (String(t.data.rider_location.lat).split('.')[1] || '').length <= 4 && (String(t.data.rider_location.lng).split('.')[1] || '').length <= 4,
    t.data?.rider_location ? { lat: t.data.rider_location.lat, lng: t.data.rider_location.lng, accuracy: t.data.rider_location.accuracy, quality: t.data.location_quality } : null);
    const arrived = await ctx.orders.riderStep(rider1, 'mark_rider_arrived', O);
    t = await track('arrived');
    C(P, 'RIDER_ARRIVES', arrived.r.ok && arrived.after.status === 'arrived' && t.data?.status === 'arrived', { code: arrived.r.data?.code || arrived.r.code, tracking: t.data?.status });

    // ── Código de entrega ─────────────────────────────────────────────────────
    const issued = await ctx.http.call(customer, 'issue_order_delivery_code', { p_order_id: O, p_tracking_token: created.token });
    const deliveryCode = ctx.redactor.secret(String(issued.data?.delivery_code || ''));
    C(P, 'CUSTOMER_OBTAINS_THE_DELIVERY_CODE', issued.ok && /^[0-9]{4}$/.test(deliveryCode), brief(issued));
    const wrongCode = String(((Number(deliveryCode) - 1000 + 1) % 9000) + 1000);
    const wrong = await ctx.orders.riderStep(rider1, 'confirm_delivery_code', O, { code: wrongCode });
    C(P, 'WRONG_DELIVERY_CODE_DOES_NOT_DELIVER', wrong.r.ok && wrong.r.data?.ok === false && wrong.r.data?.code === 'incorrect_code' && wrong.after.status === 'arrived',
      { code: wrong.r.data?.code || wrong.r.code, status: wrong.after.status });
    const confirmed = await ctx.orders.riderStep(rider1, 'confirm_delivery_code', O, { code: deliveryCode });
    t = await track('delivered');
    C(P, 'DELIVERY_CODE_CONFIRMED_AND_DELIVERED', confirmed.r.ok && confirmed.r.data?.ok === true && confirmed.after.status === 'delivered'
      && (t.data === null || t.data?.status === 'delivered'), { outcome: confirmed.r.data?.outcome || confirmed.r.code, database: confirmed.after.status, tracking: t.data?.status ?? 'hidden' });

    // ── Cobro en efectivo, confirmado por el comercio ─────────────────────────
    state = await ctx.orders.state(O);
    const paid = await ctx.http.call(staff, 'confirm_manual_order_payment', { p_order_id: O, p_expected_revision: Number(state.revision), p_actual_method: 'cash',
      p_idempotency_key: `ecomcert-pay-${shortId(8)}` });
    const truth = await ctx.orders.truth(O);
    C(P, 'STAFF_CONFIRMS_THE_CASH_PAYMENT', paid.ok && paid.data?.ok === true && truth.order_row.manual_payment_status === 'confirmed' && truth.order_row.manual_payment_method === 'cash'
      && ctx.orders.countEvents(truth.events, 'order.manual_payment_confirmed') === 1, { ...brief(paid), status: truth.order_row.manual_payment_status });

    // ── Verdad de la base ─────────────────────────────────────────────────────
    const events = truth.events || [];
    const chain = ctx.orders.statusChain(events);
    const row = truth.order_row;
    C(P, 'EVENT_CHAIN_COMPLETE_AND_ORDERED', JSON.stringify(chain) === JSON.stringify(DELIVERY_CHAIN), chain, DELIVERY_CHAIN);
    C(P, 'EVENT_SEQUENCE_AND_TIME_MONOTONIC', events.every((e, i) => i === 0 || (Number(e.sequence) > Number(events[i - 1].sequence) && Date.parse(e.created_at) >= Date.parse(events[i - 1].created_at))),
      events.map((e) => `${e.sequence}:${e.event_type}`));
    C(P, 'EVENT_ACTORS_MATCH_ROLES', events.filter((e) => e.event_type === 'order.status_changed').every((e) => (['accepted', 'preparing', 'ready'].includes(e.metadata.next_status)
      ? e.actor_role === 'business' : e.actor_role === 'rider')) && events[0]?.event_type === 'order.received' && events[0]?.actor_role === 'customer',
    events.map((e) => `${e.event_type}:${e.actor_role}`));
    const stamps = ['created_at', 'acknowledged_at', 'accepted_at', 'preparing_at', 'ready_at', 'picked_up_at', 'arrived_at', 'delivered_at'];
    C(P, 'ORDER_TIMESTAMPS_SET_AND_ORDERED', stamps.map((k) => Date.parse(row[k])).every((v, i, all) => Number.isFinite(v) && (i === 0 || v >= all[i - 1])), stamps.map((k) => `${k}=${row[k]}`));
    C(P, 'GPS_TRAIL_PURGED_AT_DELIVERY', truth.rider_locations === 0, { riderLocations: truth.rider_locations });
    const inboxAfter = await panel.fetchBusinessOrderSnapshot();
    C(P, 'PANEL_INBOX_RELEASES_THE_DELIVERED_ORDER', inboxAfter.ok && !(inboxAfter.rows || []).some((r) => r.id === O), { ok: inboxAfter.ok });
    const riderAfter = await ctx.http.restGet(rider1, `orders?select=id&id=eq.${O}`);
    C(P, 'RIDER_LOSES_ACCESS_AFTER_DELIVERY', riderAfter.status === 200 && riderAfter.rows?.length === 0, { ...brief(riderAfter), rows: riderAfter.rows?.length });

    // ── Segundo pedido: retiro, lo cierra el comercio ─────────────────────────
    const pickup = await ctx.orders.create(customer, { mode: 'pickup', role: 'MAIN', quantity: 1, payment: 'cash', label: 'lifecycle-pickup' });
    C(P, 'CUSTOMER_CREATES_PICKUP_ORDER', Boolean(pickup.order), brief(pickup.r));
    if (pickup.order) {
      let p = await ctx.orders.state(pickup.order.id);
      const steps = [];
      for (const status of ['accepted', 'preparing', 'ready', 'delivered']) {
        const r = await ctx.orders.transition(staff, pickup.order.id, status, Number(p.revision));
        p = await ctx.orders.state(pickup.order.id);
        steps.push({ status, ...brief(r), database: p.status });
      }
      const pickupTruth = await ctx.orders.truth(pickup.order.id);
      C(P, 'PICKUP_COMPLETED_BY_THE_BUSINESS', p.status === 'delivered' && JSON.stringify(ctx.orders.statusChain(pickupTruth.events)) === JSON.stringify(PICKUP_CHAIN)
        && Boolean(pickupTruth.order_row.delivered_at) && Number(pickupTruth.order_row.delivery_fee) === 0, steps);
    }

    // ── Historial del cliente (la consulta de la tienda) ──────────────────────
    const history = await ctx.http.restGet(customer, customerHistoryQuery(id));
    const mine = history.rows || [];
    C(P, 'CUSTOMER_HISTORY_SHOWS_OWN_ORDERS_WITH_ITEMS', history.status === 200 && mine.some((o) => o.id === O && o.status === 'delivered' && o.order_items?.length === 1)
      && (!pickup.order || mine.some((o) => o.id === pickup.order.id && o.status === 'delivered')) && mine.every((o) => o.customer_user_id === customer.userId),
    { ...brief(history), rows: mine.map((o) => `${o.public_code}:${o.status}:${o.order_items?.length}`) });

    const s1 = (await ctx.orders.fixtures()).MAIN.stock;
    C(P, 'STOCK_DECREMENTED_EXACTLY_ONCE', s1 === s0 - 2 - (pickup.order ? 1 : 0), { initial: s0, final: s1 }, { final: s0 - 2 - (pickup.order ? 1 : 0) });
    ctx.evidence.write('phase-lifecycle.json', { order: code, anonymousCustomer: Boolean(anonymous), stages, chain, events: events.map((e) => ({ sequence: e.sequence, type: e.event_type, actor: e.actor_role, at: e.created_at })),
      timestamps: Object.fromEntries(stamps.map((k) => [k, row[k]])), trackingDtoKeys: dtoKeys, pickupOrder: pickup.order?.public_code || null });
  },
};
