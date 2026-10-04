// FASE idempotency — repetir una operación deja UN solo efecto.
//
// Alta, transición, acuse, cancelación, oferta, pasos del rider, código de entrega:
// cada una se repite (y el alta, veinte veces a la vez) y la base tiene que mostrar un
// pedido, un evento por transición y un único movimiento de stock.
import { shortId } from '../env.mjs';
import { brief, refusal, refused } from '../http.mjs';

const P = 'idempotency';
const EXPECTED_CHAIN = ['received>accepted', 'accepted>preparing', 'preparing>ready', 'ready>assigned', 'assigned>picked_up',
  'picked_up>on_the_way', 'on_the_way>arrived', 'arrived>delivered'];

export default {
  id: P,
  title: 'idempotencia: alta, transiciones, acuse, cancelación, rider y código de entrega',
  requires: [],
  async run(ctx) {
    const C = ctx.rec.check;
    const { staff, admin, rider1 } = ctx.actors;
    const a = await ctx.identities.customer('idempotency-a');
    const b = await ctx.identities.customer('idempotency-b');
    const main = ctx.orders.product('MAIN');
    const s0 = (await ctx.orders.fixtures()).MAIN.stock;
    const create = (actor, payload) => ctx.http.call(actor, 'create_order_with_items', { payload });
    const sameOrder = (r, orderId) => r.ok && (Array.isArray(r.data) ? r.data[0] : r.data)?.id === orderId;

    // ── Alta con envío (pedido X) ────────────────────────────────────────────
    const x = await ctx.orders.create(a, { mode: 'delivery', role: 'MAIN', quantity: 2, label: 'idempotency-x' });
    C(P, 'DELIVERY_ORDER_CREATED', Boolean(x.order), brief(x.r));
    if (!x.order) return;
    const X = x.order.id;
    const t0 = await ctx.orders.truth(X);
    const replay = await create(a, x.payload);
    const replays = await Promise.all(Array.from({ length: 20 }, () => create(a, x.payload)));
    const otherPayload = await create(a, { ...x.payload, items: [{ product_id: main.id, quantity: 3 }] });
    const otherCustomer = await create(b, { ...x.payload, customer_address_id: b.addressId });
    const t1 = await ctx.orders.truth(X);
    const sameKey = await ctx.orders.byRequestIds([x.requestId]);
    const s1 = (await ctx.orders.fixtures()).MAIN.stock;
    C(P, 'CREATE_REPLAY_RETURNS_THE_SAME_ORDER', sameOrder(replay, X), brief(replay));
    C(P, 'CREATE_20_CONCURRENT_REPLAYS_RETURN_THE_SAME_ORDER', replays.every((r) => r.status === 200 && sameOrder(r, X)),
      replays.map((r) => `${r.status}:${sameOrder(r, X) ? 'same' : r.code}`));
    C(P, 'CREATE_SAME_KEY_DIFFERENT_PAYLOAD_REJECTED', refused(otherPayload, '23505'), brief(otherPayload), refusal('23505'));
    C(P, 'CREATE_SAME_KEY_OTHER_CUSTOMER_REJECTED', refused(otherCustomer, '23505'), brief(otherCustomer), refusal('23505'));
    C(P, 'CREATE_REPLAYS_LEAVE_EXACTLY_ONE_ORDER', sameKey.length === 1 && t1.items.length === 1 && ctx.orders.countEvents(t1.events, 'order.received') === 1
      && t1.tracking_tokens === 1 && t1.handoffs === 1 && t1.events.length === t0.events.length,
    { orders: sameKey.length, items: t1.items.length, received: ctx.orders.countEvents(t1.events, 'order.received'), tokens: t1.tracking_tokens, handoffs: t1.handoffs, events: [t0.events.length, t1.events.length] });
    C(P, 'CREATE_REPLAYS_MOVE_STOCK_ONCE', s1 === s0 - 2, { initial: s0, after: s1 }, { after: s0 - 2 });
    C(P, 'DELIVERY_REPLAYS_DO_NOT_TOUCH_THE_ORDER_ROW', Number(t1.order_row.revision) === Number(t0.order_row.revision) && t1.order_row.updated_at === t0.order_row.updated_at,
      { revision: [t0.order_row.revision, t1.order_row.revision], updated_at: [t0.order_row.updated_at, t1.order_row.updated_at] }, 'revisión y updated_at sin cambios');

    // ── Alta de retiro (pedido Y) ────────────────────────────────────────────
    const y = await ctx.orders.create(a, { mode: 'pickup', role: 'MAIN', quantity: 1, label: 'idempotency-y' });
    C(P, 'PICKUP_ORDER_CREATED', Boolean(y.order), brief(y.r));
    if (!y.order) return;
    const Y = y.order.id;
    const y0 = await ctx.orders.state(Y);
    const pickupReplays = [];
    for (let i = 0; i < 3; i += 1) pickupReplays.push(await create(a, y.payload));
    const y1 = await ctx.orders.state(Y);
    C(P, 'PICKUP_REPLAYS_RETURN_THE_SAME_ORDER', pickupReplays.every((r) => sameOrder(r, Y)), pickupReplays.map(brief));
    C(P, 'PICKUP_REPLAYS_DO_NOT_TOUCH_THE_ORDER_ROW', Number(y1.revision) === Number(y0.revision) && y1.updated_at === y0.updated_at,
      { revision: [y0.revision, y1.revision], updated_at: [y0.updated_at, y1.updated_at] }, 'revisión y updated_at sin cambios');

    // ── Acuse del comercio ───────────────────────────────────────────────────
    let rev = Number(t1.order_row.revision);
    const ackParams = { p_order_id: X, p_expected_revision: rev, p_idempotency_key: `ecomcert-ack-${shortId(8)}` };
    const ack = await ctx.http.call(staff, 'acknowledge_order', ackParams);
    const afterAck = await ctx.orders.state(X);
    const ackReplay = await ctx.http.call(staff, 'acknowledge_order', ackParams);
    const afterAckReplay = await ctx.orders.truth(X);
    C(P, 'ACKNOWLEDGE_REPLAY_IS_IDEMPOTENT', ack.ok && ackReplay.ok && ackReplay.data?.idempotent_replay === true
      && ctx.orders.countEvents(afterAckReplay.events, 'business_acknowledged') === 1 && Number(afterAckReplay.order_row.revision) === Number(afterAck.revision),
    { first: brief(ack), replay: ackReplay.data?.idempotent_replay, events: ctx.orders.countEvents(afterAckReplay.events, 'business_acknowledged'), revision: [afterAck.revision, afterAckReplay.order_row.revision] });

    // ── Transición del comercio ──────────────────────────────────────────────
    rev = Number(afterAckReplay.order_row.revision);
    const acceptKey = `ecomcert-acc-${shortId(8)}`;
    const accepted = await ctx.orders.transition(staff, X, 'accepted', rev, acceptKey);
    const acceptedReplay = await ctx.orders.transition(staff, X, 'accepted', rev, acceptKey);
    const reusedKey = await ctx.orders.transition(staff, X, 'preparing', rev + 1, acceptKey);
    const afterAccept = await ctx.orders.truth(X);
    C(P, 'TRANSITION_REPLAY_IS_IDEMPOTENT', accepted.ok && acceptedReplay.ok && acceptedReplay.data?.idempotent_replay === true && afterAccept.order_row.status === 'accepted'
      && Number(afterAccept.order_row.revision) === rev + 1 && ctx.orders.statusChain(afterAccept.events).filter((s) => s === 'received>accepted').length === 1,
    { first: brief(accepted), replay: acceptedReplay.data?.idempotent_replay, revision: afterAccept.order_row.revision, chain: ctx.orders.statusChain(afterAccept.events) });
    C(P, 'TRANSITION_KEY_REUSED_WITH_OTHER_PAYLOAD_REJECTED', refused(reusedKey, '23505') && afterAccept.order_row.status === 'accepted', brief(reusedKey), refusal('23505'));

    // ── Cancelación del comercio (sobre Y) ───────────────────────────────────
    const cancelKey = `ecomcert-can-${shortId(8)}`;
    const reason = `${ctx.runId} QA cancelacion idempotente`;
    const cancelled = await ctx.orders.cancel(admin, Y, Number(y1.revision), reason, cancelKey);
    const cancelledReplay = await ctx.orders.cancel(admin, Y, Number(y1.revision), reason, cancelKey);
    const yTruth = await ctx.orders.truth(Y);
    const s2 = (await ctx.orders.fixtures()).MAIN.stock;
    C(P, 'CANCEL_REPLAY_IS_IDEMPOTENT', cancelled.ok && cancelledReplay.ok && cancelledReplay.data?.idempotent_replay === true && yTruth.order_row.status === 'cancelled'
      && ctx.orders.statusChain(yTruth.events).filter((s) => s.endsWith('>cancelled')).length === 1 && ctx.orders.countEvents(yTruth.events, 'business_cancel_reason') === 1,
    { first: brief(cancelled), replay: cancelledReplay.data?.idempotent_replay, chain: ctx.orders.statusChain(yTruth.events), reasons: ctx.orders.countEvents(yTruth.events, 'business_cancel_reason') });
    C(P, 'CANCEL_REPLAY_RETURNS_STOCK_ONCE', s2 === s0 - 2, { stock: s2 }, { stock: s0 - 2 });

    // ── Rider (sobre X) ──────────────────────────────────────────────────────
    rev = Number(afterAccept.order_row.revision);
    const prep = await ctx.orders.transition(staff, X, 'preparing', rev);
    const ready = await ctx.orders.transition(staff, X, 'ready', rev + 1);
    C(P, 'ORDER_READY_FOR_RIDER', prep.ok && ready.ok, { preparing: brief(prep), ready: brief(ready) });
    const offered = await ctx.orders.offer(staff, X, rider1.userId);
    const offeredAgain = await ctx.orders.offer(staff, X, rider1.userId);
    C(P, 'OFFER_REPLAY_DOES_NOT_CREATE_A_SECOND_OFFER', offered.ok && offered.data?.code === 'offered' && offeredAgain.data?.code === 'already_offered'
      && offeredAgain.data?.offer?.offer_id === offered.data?.offer_id, { first: offered.data?.code || offered.code, again: offeredAgain.data?.code || offeredAgain.code });
    const acceptParams = { p_offer_id: offered.data?.offer_id, p_expected_version: Number(offered.data?.version), p_idempotency_key: `android-${shortId(32)}` };
    const riderAccept = await ctx.http.call(rider1, 'accept_rider_order_offer', acceptParams);
    const afterRiderAccept = await ctx.orders.state(X);
    const riderAcceptReplay = await ctx.http.call(rider1, 'accept_rider_order_offer', acceptParams);
    C(P, 'RIDER_ACCEPT_REPLAY_IS_IDEMPOTENT', riderAccept.ok && riderAccept.data?.ok === true && afterRiderAccept.status === 'assigned' && riderAcceptReplay.ok
      && riderAcceptReplay.data?.idempotent_no_op === true && Number((await ctx.orders.state(X)).revision) === Number(afterRiderAccept.revision),
    { first: riderAccept.data?.code || riderAccept.code, replay: riderAcceptReplay.data?.idempotent_no_op, status: afterRiderAccept.status });
    for (const [fn, status] of [['mark_delivery_picked_up', 'picked_up'], ['start_rider_delivery', 'on_the_way'], ['mark_rider_arrived', 'arrived']]) {
      const step = await ctx.orders.riderStep(rider1, fn, X);
      const again = await ctx.http.call(rider1, fn, step.params);
      const afterAgain = await ctx.orders.state(X);
      C(P, `RIDER_${fn.toUpperCase()}_REPLAY_IS_IDEMPOTENT`, step.r.ok && step.r.data?.ok === true && step.after.status === status && again.ok
        && again.data?.idempotent_no_op === true && Number(afterAgain.revision) === Number(step.after.revision) && afterAgain.status === status,
      { first: step.r.data?.code || step.r.code, replay: again.data?.idempotent_no_op ?? again.code, status: afterAgain.status });
    }

    // ── Código de entrega ────────────────────────────────────────────────────
    const issue = () => ctx.http.call(a, 'issue_order_delivery_code', { p_order_id: X, p_tracking_token: x.token });
    const issued = await issue();
    const issuedAgain = await issue();
    const code = ctx.redactor.secret(String(issued.data?.delivery_code || ''));
    const handoffs = (await ctx.orders.truth(X)).handoffs;
    C(P, 'DELIVERY_CODE_ISSUE_REPLAY_RETURNS_THE_SAME_CODE', issued.ok && /^[0-9]{4}$/.test(code) && String(issuedAgain.data?.delivery_code) === code && handoffs === 1,
      { first: brief(issued), sameCode: String(issuedAgain.data?.delivery_code) === code, handoffs });
    const confirm = await ctx.orders.riderStep(rider1, 'confirm_delivery_code', X, { code });
    const confirmReplay = await ctx.http.call(rider1, 'confirm_delivery_code', confirm.params);
    const delivered = await ctx.orders.state(X);
    const newKey = await ctx.orders.riderStep(rider1, 'confirm_delivery_code', X, { code });
    C(P, 'DELIVERY_CODE_CONFIRM_REPLAY_DOES_NOT_REDELIVER', confirm.r.ok && confirm.r.data?.ok === true && confirm.after.status === 'delivered'
      && confirmReplay.data?.idempotent_no_op === true && newKey.r.data?.outcome === 'already_delivered' && Number(newKey.after.revision) === Number(delivered.revision),
    { first: confirm.r.data?.outcome || confirm.r.code, sameKey: confirmReplay.data?.idempotent_no_op ?? confirmReplay.code, newKey: newKey.r.data?.outcome || newKey.r.code });

    // ── Un efecto por operación ──────────────────────────────────────────────
    const final = await ctx.orders.truth(X);
    const chain = ctx.orders.statusChain(final.events);
    const s3 = (await ctx.orders.fixtures()).MAIN.stock;
    C(P, 'EXACTLY_ONE_EVENT_PER_TRANSITION', JSON.stringify(chain) === JSON.stringify(EXPECTED_CHAIN), chain, EXPECTED_CHAIN);
    C(P, 'SINGLE_OFFER_AND_SINGLE_ACCEPT_EVENTS', ctx.orders.countEvents(final.events, 'order.rider_offered') === 1 && ctx.orders.countEvents(final.events, 'order.rider_accepted_offer') === 1
      && (final.offers || []).length === 1, { offered: ctx.orders.countEvents(final.events, 'order.rider_offered'), accepted: ctx.orders.countEvents(final.events, 'order.rider_accepted_offer'), offers: final.offers });
    C(P, 'STOCK_MOVED_EXACTLY_ONCE_OVERALL', s3 === s0 - 2, { initial: s0, final: s3 }, { final: s0 - 2 });
    ctx.evidence.write('phase-idempotency.json', { orderX: x.order.public_code, orderY: y.order.public_code, chain,
      events: final.events.map((e) => `${e.sequence}:${e.event_type}:${e.actor_role}`), receipts: final.receipts, stock: { initial: s0, afterCreate: s1, afterCancel: s2, final: s3 } });
  },
};
