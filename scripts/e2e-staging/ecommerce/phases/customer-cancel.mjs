// FASE customer-cancel — el cliente cancela SU pedido, y cada motivo por el que no puede.
//
// `cancel_own_order` deja cancelar sólo un pedido propio, en efectivo o a coordinar, que
// el comercio todavía no tomó ni cobró. Todo lo demás se rechaza con un motivo estable
// en el detalle (`ORDER_ALREADY_TAKEN`, `ORDER_CLOSED`, `MANUAL_PAYMENT_RECORDED`,
// `ORDER_PAID_ONLINE`): es lo que la tienda le muestra al cliente. La fase `cancellation`
// ya prueba que un pedido ajeno contesta como uno inexistente; acá va cada motivo, la
// repetición con la misma clave y que un rechazo no mueve una unidad de stock.
import { randomUUID } from 'node:crypto';
import { shortId } from '../env.mjs';
import { CODES, brief, refusal, refused } from '../http.mjs';

const P = 'customer-cancel';
const PAID_CHECKS = Object.freeze(['PAID_ONLINE_ORDER_IS_NOT_CANCELLABLE_BY_THE_CUSTOMER']);

export default {
  id: P,
  title: 'cancelación por el cliente: el caso válido, su repetición y cada motivo de rechazo',
  requires: ['customer_cancel'],
  async run(ctx) {
    const C = ctx.rec.check;
    const { owner, staff } = ctx.actors;
    const customer = await ctx.identities.customer('customer-cancel', { address: false });
    const stock = async () => (await ctx.orders.fixtures()).MAIN.stock;
    const cancelOwn = (actor, orderId, { key = `ecomcert-own-${shortId(8)}`, reason = null } = {}) => ctx.http.call(actor, 'cancel_own_order',
      { p_order_id: orderId, p_idempotency_key: key, p_reason: reason }).then((r) => ({ r, key }));
    const order = (label, options = {}) => ctx.orders.create(customer, { mode: 'pickup', role: 'MAIN', quantity: 1, label: `customer-cancel:${label}`, ...options });
    const notCancellable = (reason) => ({ details: reason });
    const s0 = await stock();
    const cases = [];
    // Un rechazo: el estado y el código de la tabla, el motivo en el detalle, y el pedido y el stock como estaban.
    const refusedFor = async (name, created, reason, expectedStock) => {
      const before = await ctx.orders.state(created.order.id);
      const { r } = await cancelOwn(customer, created.order.id, { reason: 'ya no lo quiero' });
      const after = await ctx.orders.state(created.order.id);
      const stockNow = await stock();
      cases.push({ name, order: created.order.public_code, answer: brief(r), status: [before.status, after.status] });
      return C(P, name, refused(r, CODES.STATE, notCancellable(reason)) && after.status === before.status && Number(after.revision) === Number(before.revision)
        && after.inventory_released_at === before.inventory_released_at && stockNow === expectedStock,
      { ...brief(r), status: [before.status, after.status], revision: [before.revision, after.revision], stock: stockNow },
      `${refusal(CODES.STATE, notCancellable(reason))}; pedido y stock sin cambios`);
    };

    // ── a. El caso válido: nadie lo tomó ──────────────────────────────────────
    const mine = await order('unattended', { quantity: 2 });
    C(P, 'ORDER_CREATED_AND_STOCK_TAKEN', Boolean(mine.order) && (await stock()) === s0 - 2, brief(mine.r));
    if (!mine.order) return;
    // El motivo lleva un carácter de control en el medio: la base lo cambia por un espacio antes de guardarlo.
    const cancelled = await cancelOwn(customer, mine.order.id, { reason: 'me\u0007equivoque de pedido' });
    let truth = await ctx.orders.truth(mine.order.id);
    const customerEvents = (events) => (events || []).filter((e) => e.event_type === 'order.cancelled_by_customer');
    C(P, 'CUSTOMER_CANCELS_AN_UNATTENDED_ORDER_AND_STOCK_RETURNS_ONCE', cancelled.r.status === 200 && cancelled.r.data?.status === 'cancelled'
      && cancelled.r.data?.cancelled_by_customer === true && cancelled.r.data?.idempotent_no_op === false && truth.order_row.status === 'cancelled'
      && Boolean(truth.order_row.inventory_released_at) && (await stock()) === s0,
    { ...brief(cancelled.r), flags: { no_op: cancelled.r.data?.idempotent_no_op ?? null, by_customer: cancelled.r.data?.cancelled_by_customer ?? null },
      status: truth.order_row.status, stock: await stock() }, { stock: s0 });
    C(P, 'CUSTOMER_CANCEL_LEAVES_ONE_EVENT_WITH_A_CLEAN_REASON', customerEvents(truth.events).length === 1 && customerEvents(truth.events)[0].actor_role === 'customer'
      && customerEvents(truth.events)[0].metadata?.reason === 'me equivoque de pedido'
      && ctx.orders.statusChain(truth.events).filter((s) => s.endsWith('>cancelled')).length === 1,
    { events: truth.events.map((e) => e.event_type), reason: customerEvents(truth.events)[0]?.metadata?.reason ?? null },
    'un evento del cliente, con el motivo sin caracteres de control, y un solo cambio de estado');

    // ── b. La misma cancelación otra vez: no hace nada ────────────────────────
    const eventsBefore = truth.events.length;
    const replay = await cancelOwn(customer, mine.order.id, { key: cancelled.key });
    const otherKey = await cancelOwn(customer, mine.order.id);
    truth = await ctx.orders.truth(mine.order.id);
    C(P, 'SAME_KEY_REPLAY_IS_ANSWERED_AS_A_REPLAY_AND_WRITES_NOTHING', replay.r.status === 200 && replay.r.data?.idempotent_no_op === true && replay.r.data?.idempotent_replay === true
      && truth.events.length === eventsBefore && (await stock()) === s0, { ...brief(replay.r), no_op: replay.r.data?.idempotent_no_op ?? null, replay: replay.r.data?.idempotent_replay ?? null, events: [eventsBefore, truth.events.length] });
    C(P, 'ANOTHER_KEY_ON_A_CANCELLED_ORDER_IS_A_NO_OP_NOT_A_REPLAY', otherKey.r.status === 200 && otherKey.r.data?.idempotent_no_op === true && otherKey.r.data?.idempotent_replay === false
      && truth.events.length === eventsBefore && (await stock()) === s0, { ...brief(otherKey.r), no_op: otherKey.r.data?.idempotent_no_op ?? null, replay: otherKey.r.data?.idempotent_replay ?? null });

    // ── c. A coordinar también se puede cancelar ──────────────────────────────
    const coordinate = await order('coordinate', { payment: 'coordinate' });
    if (coordinate.order) {
      const out = await cancelOwn(customer, coordinate.order.id);
      C(P, 'COORDINATE_ORDER_IS_CANCELLABLE_BY_THE_CUSTOMER', out.r.status === 200 && (await ctx.orders.state(coordinate.order.id)).status === 'cancelled' && (await stock()) === s0, brief(out.r));
    } else { C(P, 'COORDINATE_ORDER_IS_CANCELLABLE_BY_THE_CUSTOMER', false, { setup: brief(coordinate.r) }); }

    // ── d. El comercio ya lo tomó ─────────────────────────────────────────────
    const taken = await order('taken');
    if (taken.order) {
      const advanced = await ctx.orders.advance(staff, taken.order.id, 'accepted');
      if (advanced.ok) await refusedFor('ORDER_ALREADY_TAKEN_IS_REFUSED_WITH_ITS_REASON', taken, 'ORDER_ALREADY_TAKEN', s0 - 1);
      else C(P, 'ORDER_ALREADY_TAKEN_IS_REFUSED_WITH_ITS_REASON', false, { setup: advanced.steps });
    } else { C(P, 'ORDER_ALREADY_TAKEN_IS_REFUSED_WITH_ITS_REASON', false, { setup: brief(taken.r) }); }

    // ── e. Ya está cerrado (entregado) ────────────────────────────────────────
    const closed = await order('closed');
    if (closed.order) {
      const ready = await ctx.orders.advance(staff, closed.order.id, 'ready');
      const delivered = await ctx.orders.transition(staff, closed.order.id, 'delivered', Number(ready.state.revision));
      if (delivered.ok) await refusedFor('DELIVERED_ORDER_IS_REFUSED_AS_CLOSED', closed, 'ORDER_CLOSED', s0 - 2);
      else C(P, 'DELIVERED_ORDER_IS_REFUSED_AS_CLOSED', false, { setup: [ready.steps, brief(delivered)] });
    } else { C(P, 'DELIVERED_ORDER_IS_REFUSED_AS_CLOSED', false, { setup: brief(closed.r) }); }

    // ── f. Tiene un cobro registrado (aunque después se haya devuelto) ────────
    const charged = await order('charged');
    if (charged.order) {
      let st = await ctx.orders.state(charged.order.id);
      const paid = await ctx.http.call(staff, 'confirm_manual_order_payment', { p_order_id: charged.order.id, p_expected_revision: Number(st.revision), p_actual_method: 'cash',
        p_idempotency_key: `ecomcert-pay-${shortId(8)}` });
      st = await ctx.orders.state(charged.order.id);
      if (paid.ok && st.status === 'received' && st.manual_payment_status === 'confirmed') {
        await refusedFor('ORDER_WITH_A_RECORDED_PAYMENT_IS_REFUSED_WITH_ITS_REASON', charged, 'MANUAL_PAYMENT_RECORDED', s0 - 3);
        const reversed = await ctx.http.call(owner, 'reverse_manual_order_payment', { p_order_id: charged.order.id, p_expected_revision: Number(st.revision),
          p_reason: `${ctx.runId} QA devolucion`, p_idempotency_key: `ecomcert-rev-${shortId(8)}` });
        const afterReverse = await ctx.orders.state(charged.order.id);
        if (reversed.ok && afterReverse.manual_payment_status === 'reversed') await refusedFor('ORDER_WITH_A_REVERSED_PAYMENT_STILL_NEEDS_THE_BUSINESS', charged, 'MANUAL_PAYMENT_RECORDED', s0 - 3);
        else C(P, 'ORDER_WITH_A_REVERSED_PAYMENT_STILL_NEEDS_THE_BUSINESS', false, { setup: brief(reversed), payment: afterReverse.manual_payment_status });
      } else {
        // El cobro no se pudo registrar sobre un pedido sin tomar: el motivo no se alcanza por la API y se dice.
        C(P, 'ORDER_WITH_A_RECORDED_PAYMENT_IS_REFUSED_WITH_ITS_REASON', false, { setup: brief(paid), status: st.status, payment: st.manual_payment_status },
          'confirm_manual_order_payment sobre un pedido recibido, y después el rechazo MANUAL_PAYMENT_RECORDED');
      }
    } else { C(P, 'ORDER_WITH_A_RECORDED_PAYMENT_IS_REFUSED_WITH_ITS_REASON', false, { setup: brief(charged.r) }); }

    // ── g. Pagado por Mercado Pago: lo cancela el comercio, que gestiona el reembolso ──
    let paidUnits = 0;
    if (ctx.caps.checkout_payments) {
      try {
        await ctx.payments.ensureFixture();
        const [payer] = await ctx.identities.payers(1);
        const paid = await ctx.payments.paidOrder(payer, { role: 'MAIN', quantity: 1, label: 'customer-cancel-paid' });
        if (paid.ok) {
          paidUnits = 1;
          const before = await ctx.orders.state(paid.session.orderId);
          const { r } = await cancelOwn(payer, paid.session.orderId, { reason: 'ya no lo quiero' });
          const after = await ctx.orders.state(paid.session.orderId);
          C(P, PAID_CHECKS[0], refused(r, CODES.STATE, notCancellable('ORDER_PAID_ONLINE')) && after.status === before.status && Number(after.revision) === Number(before.revision)
            && (await stock()) === s0 - 3 - paidUnits, { ...brief(r), status: [before.status, after.status], stock: await stock() }, `${refusal(CODES.STATE, notCancellable('ORDER_PAID_ONLINE'))}; pedido y stock sin cambios`);
        } else { C(P, PAID_CHECKS[0], false, { setup: paid.step, answer: brief(paid.r) }); }
      } catch (error) { C(P, PAID_CHECKS[0], false, { setup: String(error.message).slice(0, 200) }); }
    } else { for (const name of PAID_CHECKS) ctx.rec.skipCheck(P, name, 'checkout_payments'); }

    // ── h. Entradas inválidas y falta de sesión ───────────────────────────────
    const target = await order('validation');
    if (target.order) {
      const badKey = await cancelOwn(customer, target.order.id, { key: 'corta' });
      const longReason = await cancelOwn(customer, target.order.id, { reason: 'x'.repeat(301) });
      const noSession = await cancelOwn(null, target.order.id);
      const untouched = await ctx.orders.state(target.order.id);
      C(P, 'INVALID_KEY_AND_OVERLONG_REASON_ARE_REFUSED_AS_VALIDATION', refused(badKey.r, CODES.VALIDATION, { message: 'idempotency_key invalida' })
        && refused(longReason.r, CODES.VALIDATION, { message: 'motivo de cancelacion demasiado largo' }) && untouched.status === 'received',
      { key: brief(badKey.r), reason: brief(longReason.r), status: untouched.status }, refusal(CODES.VALIDATION));
      C(P, 'CANCEL_WITHOUT_A_SESSION_IS_REFUSED', refused(noSession.r, CODES.FORBIDDEN, { actor: null }) && (await ctx.orders.state(target.order.id)).status === 'received',
        brief(noSession.r), refusal(CODES.FORBIDDEN, { actor: null }));
    } else { C(P, 'INVALID_KEY_AND_OVERLONG_REASON_ARE_REFUSED_AS_VALIDATION', false, { setup: brief(target.r) }); }
    const missing = await cancelOwn(customer, randomUUID());
    C(P, 'UNKNOWN_ORDER_IS_ANSWERED_AS_NOT_FOUND', refused(missing.r, CODES.NOT_FOUND, { message: 'pedido inexistente' }), brief(missing.r), refusal(CODES.NOT_FOUND, { message: 'pedido inexistente' }));

    const final = await stock();
    C(P, 'REFUSALS_MOVED_NO_STOCK', final === s0 - 4 - paidUnits, { initial: s0, final, heldByOpenOrders: 4 + paidUnits },
      { final: s0 - 4 - paidUnits, why: 'sólo retienen stock los pedidos que siguen abiertos: tomado, entregado, cobrado, el de validación y, si hubo, el pagado' });
    ctx.evidence.write('phase-customer-cancel.json', { cases, stock: { initial: s0, final } });
  },
};
