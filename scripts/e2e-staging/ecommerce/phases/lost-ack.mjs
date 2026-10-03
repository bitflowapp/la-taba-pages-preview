// FASE lost-ack — la respuesta que se pierde en el camino.
//
// El caso que más pedidos duplica en la calle: el servidor recibe el pedido, lo procesa,
// contesta… y la respuesta no llega (el teléfono perdió señal, el proxy cortó). Quien
// llamó no sabe si entró y reintenta. Acá se provoca de verdad: la request sale por un
// socket propio, el observador confirma que la base ya la procesó, y el socket se
// destruye sin haber leído la respuesta (`http.lostResponse`). Después se reintenta
// EXACTAMENTE lo mismo, como hace cada cliente.
//
// Se hace con cada comando que mueve stock o dinero: el alta del pedido, un comando del
// comercio, la cancelación del comercio y la del cliente, la sesión de checkout, la
// finalización de un pago y el pedido de reembolso. El resultado tiene que ser siempre
// el mismo: un pedido, un efecto, el stock una vez, el dinero una vez.
import { randomUUID } from 'node:crypto';
import { nowIso, shortId, sqlText, sqlUuid } from '../env.mjs';
import { brief } from '../http.mjs';

const P = 'lost-ack';
const PAYMENT_CHECKS = Object.freeze(['CHECKOUT_RETRY_AFTER_A_LOST_RESPONSE_RETURNS_THE_SAME_SESSION_AND_RESERVES_ONCE', 'FINALIZE_RETRY_AFTER_A_LOST_RESPONSE_RETURNS_THE_SAME_ORDER']);
const REFUND_CHECKS = Object.freeze(['REFUND_REQUEST_RETRY_AFTER_A_LOST_RESPONSE_IS_THE_SAME_REFUND', 'REFUND_RESULT_RETRY_AFTER_A_LOST_RESPONSE_REFUNDS_ONCE']);
const lossOf = (lost) => ({ lost: lost.lost, mode: lost.mode, requestSent: lost.dropped.requestSent, serverProcessed: lost.dropped.serverProcessed,
  responseDeliveredToCaller: lost.dropped.responseDeliveredToCaller, waitedMs: lost.dropped.waitedMs });

export default {
  id: P,
  title: 'respuesta perdida: el reintento devuelve lo mismo y nada se duplica (pedido, comando, cancelación, checkout, pago, reembolso)',
  requires: [],
  async run(ctx) {
    const C = ctx.rec.check;
    const id = ctx.tenant.id;
    const { owner, staff } = ctx.actors;
    const customer = await ctx.identities.customer('lost-ack', { address: false });
    const stock = async () => (await ctx.orders.fixtures()).MAIN.stock;
    const s0 = await stock();
    const tally = { lostOrders: 0, duplicateOrders: 0, doubleStock: 0, doubleRefund: 0 };
    const scenarios = [];

    // ── 1. El alta del pedido ─────────────────────────────────────────────────
    const body = ctx.orders.payload({ customer, role: 'MAIN', quantity: 2, mode: 'pickup', label: 'lost-ack' });
    ctx.ledger.orders.push({ label: 'lost-ack', clientRequestId: body.client_request_id, id: null, publicCode: null, at: nowIso() });
    ctx.persist();
    const found = () => ctx.orders.byRequestIds([body.client_request_id]);
    const lost = await ctx.http.lostResponse(customer, 'create_order_with_items', { payload: body }, async () => (await found()).length === 1);
    const afterLoss = await found();
    C(P, 'ORDER_WAS_PROCESSED_AND_ITS_RESPONSE_NEVER_REACHED_THE_CALLER', lost.lost && afterLoss.length === 1 && (await stock()) === s0 - 2, { ...lossOf(lost), ordersInDatabase: afterLoss.length, stock: await stock() },
      'la base tiene el pedido y el stock descontado; quien llamó no leyó la respuesta');
    if (afterLoss.length !== 1) { tally.lostOrders += 1; ctx.evidence.write('phase-lost-ack.json', { scenarios, tally }); return; }
    const O = afterLoss[0].id;
    const t0 = await ctx.orders.truth(O);
    const retry = await ctx.orders.create(customer, { payload: body, label: 'lost-ack', quiet: true });
    const retryAgain = await ctx.orders.create(customer, { payload: body, label: 'lost-ack', quiet: true });
    const sameKey = await found();
    const t1 = await ctx.orders.truth(O);
    C(P, 'RETRY_AFTER_A_LOST_RESPONSE_RETURNS_THE_SAME_ORDER', retry.r.status === 200 && retry.order?.id === O && retryAgain.r.status === 200 && retryAgain.order?.id === O
      && retry.order.public_code === afterLoss[0].public_code, { first: brief(retry.r), second: brief(retryAgain.r), sameId: retry.order?.id === O });
    C(P, 'LOST_RESPONSE_AND_RETRIES_LEAVE_ONE_ORDER_AND_TAKE_STOCK_ONCE', sameKey.length === 1 && t1.items.length === 1 && ctx.orders.countEvents(t1.events, 'order.received') === 1
      && t1.tracking_tokens === 1 && t1.events.length === t0.events.length && Number(t1.order_row.revision) === Number(t0.order_row.revision) && (await stock()) === s0 - 2,
    { orders: sameKey.length, items: t1.items.length, received: ctx.orders.countEvents(t1.events, 'order.received'), tokens: t1.tracking_tokens,
      events: [t0.events.length, t1.events.length], revision: [t0.order_row.revision, t1.order_row.revision], stock: await stock() }, { orders: 1, stock: s0 - 2 });
    if (sameKey.length > 1) tally.duplicateOrders += sameKey.length - 1;
    if ((await stock()) !== s0 - 2) tally.doubleStock += 1;
    scenarios.push({ command: 'create_order_with_items', order: afterLoss[0].public_code, loss: lossOf(lost) });

    // ── 2. Un comando del comercio (aceptar) ──────────────────────────────────
    const acceptParams = { p_order_id: O, p_expected_revision: Number(t1.order_row.revision), p_new_status: 'accepted', p_idempotency_key: `ecomcert-lost-acc-${shortId(6)}` };
    const lostAccept = await ctx.http.lostResponse(staff, 'transition_order', acceptParams, async () => (await ctx.orders.state(O)).status === 'accepted');
    const acceptRetry = await ctx.http.call(staff, 'transition_order', acceptParams);
    const t2 = await ctx.orders.truth(O);
    C(P, 'STAFF_COMMAND_RETRY_AFTER_A_LOST_RESPONSE_REPLAYS_ITS_RECEIPT', lostAccept.lost && acceptRetry.status === 200 && acceptRetry.data?.idempotent_replay === true
      && acceptRetry.data?.status === 'accepted' && ctx.orders.statusChain(t2.events).filter((s) => s === 'received>accepted').length === 1
      && Number(t2.order_row.revision) === Number(t1.order_row.revision) + 1,
    { ...lossOf(lostAccept), retry: brief(acceptRetry), replay: acceptRetry.data?.idempotent_replay ?? null, chain: ctx.orders.statusChain(t2.events), revision: [t1.order_row.revision, t2.order_row.revision] },
    'el reintento devuelve el recibo guardado: una transición, un evento, una revisión');
    scenarios.push({ command: 'transition_order', loss: lossOf(lostAccept) });

    // ── 3. La cancelación del comercio: el stock vuelve UNA vez ────────────────
    const cancelParams = { p_order_id: O, p_expected_revision: Number(t2.order_row.revision), p_reason: `${ctx.runId} QA respuesta perdida`, p_idempotency_key: `ecomcert-lost-can-${shortId(6)}` };
    const lostCancel = await ctx.http.lostResponse(owner, 'cancel_order', cancelParams, async () => (await ctx.orders.state(O)).status === 'cancelled');
    const stockAfterLostCancel = await stock();
    const cancelRetry = await ctx.http.call(owner, 'cancel_order', cancelParams);
    const t3 = await ctx.orders.truth(O);
    C(P, 'CANCEL_RETRY_AFTER_A_LOST_RESPONSE_RETURNS_STOCK_ONCE', lostCancel.lost && stockAfterLostCancel === s0 && cancelRetry.status === 200 && cancelRetry.data?.idempotent_replay === true
      && (await stock()) === s0 && ctx.orders.statusChain(t3.events).filter((s) => s.endsWith('>cancelled')).length === 1 && ctx.orders.countEvents(t3.events, 'business_cancel_reason') === 1,
    { ...lossOf(lostCancel), retry: brief(cancelRetry), replay: cancelRetry.data?.idempotent_replay ?? null, stock: [stockAfterLostCancel, await stock()],
      cancelReasons: ctx.orders.countEvents(t3.events, 'business_cancel_reason') }, { stock: s0 });
    if ((await stock()) !== s0) tally.doubleStock += 1;
    scenarios.push({ command: 'cancel_order', loss: lossOf(lostCancel) });

    // ── 4. La cancelación del cliente ─────────────────────────────────────────
    if (ctx.caps.customer_cancel) {
      const second = await ctx.orders.create(customer, { mode: 'pickup', role: 'MAIN', quantity: 1, label: 'lost-ack-own' });
      if (second.order) {
        const ownParams = { p_order_id: second.order.id, p_idempotency_key: `ecomcert-lost-own-${shortId(6)}`, p_reason: 'sin señal' };
        const lostOwn = await ctx.http.lostResponse(customer, 'cancel_own_order', ownParams, async () => (await ctx.orders.state(second.order.id)).status === 'cancelled');
        const ownRetry = await ctx.http.call(customer, 'cancel_own_order', ownParams);
        const truth = await ctx.orders.truth(second.order.id);
        C(P, 'CUSTOMER_CANCEL_RETRY_AFTER_A_LOST_RESPONSE_IS_A_REPLAY', lostOwn.lost && ownRetry.status === 200 && ownRetry.data?.idempotent_no_op === true && ownRetry.data?.idempotent_replay === true
          && (await stock()) === s0 && truth.events.filter((e) => e.event_type === 'order.cancelled_by_customer').length === 1,
        { ...lossOf(lostOwn), retry: brief(ownRetry), replay: ownRetry.data?.idempotent_replay ?? null, stock: await stock() }, { stock: s0 });
        if ((await stock()) !== s0) tally.doubleStock += 1;
        scenarios.push({ command: 'cancel_own_order', loss: lossOf(lostOwn) });
      } else { C(P, 'CUSTOMER_CANCEL_RETRY_AFTER_A_LOST_RESPONSE_IS_A_REPLAY', false, { setup: brief(second.r) }); }
    } else { ctx.rec.skipCheck(P, 'CUSTOMER_CANCEL_RETRY_AFTER_A_LOST_RESPONSE_IS_A_REPLAY', 'customer_cancel'); }

    // ── 5. El checkout y la finalización del pago (lo que llama la Edge Function) ──
    if (!ctx.caps.checkout_payments) {
      for (const name of [...PAYMENT_CHECKS, ...REFUND_CHECKS]) ctx.rec.skipCheck(P, name, 'checkout_payments');
    } else {
      await ctx.payments.ensureFixture();
      const [payer] = await ctx.identities.payers(1);
      const checkout = ctx.payments.sessionPayload(payer, { role: 'MAIN', quantity: 1, label: 'lost-ack' });
      ctx.ledger.checkouts.push({ label: 'lost-ack', clientRequestId: checkout.client_request_id, sessionId: null, at: nowIso() });
      ctx.persist();
      const sessions = () => ctx.env.observe(`select s.id, s.status, (select count(*)::int from public.inventory_reservations r where r.checkout_session_id = s.id) as reservations,
        (select count(*)::int from public.payment_intents i where i.checkout_session_id = s.id) as intents
        from public.checkout_sessions s where s.business_id = ${sqlUuid(id)} and s.client_request_id = ${sqlText(checkout.client_request_id)}`);
      const sessionParams = { p_customer_id: payer.userId, p_payload: checkout };
      const lostSession = await ctx.lostEdgeRpc('create_checkout_session', sessionParams, async () => (await sessions()).length === 1);
      const stockAfterLostSession = await stock();
      const again = await ctx.payments.createSession(payer, { payload: checkout, label: 'lost-ack', quiet: true });
      const rows = await sessions();
      C(P, PAYMENT_CHECKS[0], lostSession.lost && again.r.status === 200 && again.session?.id === rows[0]?.id && rows.length === 1 && rows[0].reservations === 1 && rows[0].intents === 1
        && stockAfterLostSession === s0 - 1 && (await stock()) === s0 - 1,
      { ...lossOf(lostSession), retry: brief(again.r), sessions: rows.length, reservations: rows[0]?.reservations ?? null, intents: rows[0]?.intents ?? null, stock: [stockAfterLostSession, await stock()] },
      { sessions: 1, reservations: 1, stock: s0 - 1 });
      if ((await stock()) !== s0 - 1) tally.doubleStock += 1;
      scenarios.push({ command: 'create_checkout_session', loss: lossOf(lostSession) });

      const session = again.session;
      let paid = null;
      if (session) {
        const redirected = await ctx.payments.redirect(session);
        const approved = redirected.ok ? await ctx.payments.snapshot(session, 'approved') : { ok: false };
        if (approved.ok && approved.data?.finalize_required === true) {
          const lostFinalize = await ctx.lostEdgeRpc('finalize_paid_checkout_session', { p_checkout_session_id: session.id },
            async () => Boolean((await ctx.payments.state(session.id)).order_id));
          const finalizeRetry = await ctx.payments.finalize(session);
          const state = await ctx.payments.state(session.id);
          C(P, PAYMENT_CHECKS[1], lostFinalize.lost && finalizeRetry.status === 200 && finalizeRetry.data?.idempotent === true && finalizeRetry.data?.order_id === state.order_id
            && state.orders === 1 && JSON.stringify(state.reservations) === JSON.stringify(['converted:1:-']) && (await stock()) === s0 - 1,
          { ...lossOf(lostFinalize), retry: brief(finalizeRetry), idempotent: finalizeRetry.data?.idempotent ?? null, orders: state.orders, reservations: state.reservations, stock: await stock() },
          { orders: 1, reservations: ['converted:1:-'], stock: s0 - 1 });
          if (state.orders > 1) tally.duplicateOrders += state.orders - 1;
          if (state.orders < 1) tally.lostOrders += 1;
          scenarios.push({ command: 'finalize_paid_checkout_session', loss: lossOf(lostFinalize) });
          paid = { session, state };
        } else { C(P, PAYMENT_CHECKS[1], false, { setup: redirected.ok ? brief(approved) : { step: redirected.step, answer: brief(redirected.r) } }); }
      } else { C(P, PAYMENT_CHECKS[1], false, { setup: brief(again.r) }); }

      // ── 6. El reembolso: el pedido y el resultado ───────────────────────────
      if (!ctx.caps.payment_refunds) {
        for (const name of REFUND_CHECKS) ctx.rec.skipCheck(P, name, 'payment_refunds');
      } else if (!paid) {
        for (const name of REFUND_CHECKS) C(P, name, false, { setup: 'no hay un pedido pagado sobre el que pedir el reembolso' });
      } else {
        const intentId = paid.state.intent_id;
        const key = randomUUID();
        const refundParams = { p_payment_intent_id: intentId, p_amount: null, p_idempotency_key: key, p_reason: `${ctx.runId} QA respuesta perdida` };
        const refunds = async () => (await ctx.payments.state(paid.session.id)).refunds;
        const lostRefund = await ctx.http.lostResponse(owner, 'prepare_payment_refund_v2', refundParams, async () => (await refunds()).length === 1);
        const refundRetry = await ctx.http.call(owner, 'prepare_payment_refund_v2', refundParams);
        const afterRetry = await refunds();
        C(P, REFUND_CHECKS[0], lostRefund.lost && refundRetry.status === 200 && refundRetry.data?.idempotent === true && refundRetry.data?.refund_id === afterRetry[0]?.id && afterRetry.length === 1,
          { ...lossOf(lostRefund), retry: brief(refundRetry), idempotent: refundRetry.data?.idempotent ?? null, refunds: afterRetry.length }, { refunds: 1 });
        const refund = afterRetry[0];
        if (refund) {
          const providerRefundId = `${Date.now()}77`;
          const identity = await ctx.edgeRpc('record_payment_refund_identity', { p_refund_id: refund.id, p_payment_intent_id: intentId, p_provider_payment_id: paid.state.provider_payment_id,
            p_idempotency_key: key, p_provider_refund_id: providerRefundId });
          const responseParams = { p_refund_id: refund.id, p_provider_refund_id: providerRefundId, p_status: 'approved', p_amount: Number(refund.amount),
            p_response_hash: 'c'.repeat(64) };
          const lostResult = await ctx.lostEdgeRpc('record_payment_refund_response_v2', responseParams, async () => (await refunds())[0]?.status === 'approved');
          const resultRetry = await ctx.edgeRpc('record_payment_refund_response_v2', responseParams);
          const state = await ctx.payments.state(paid.session.id);
          const approvedEvents = state.events.filter((e) => e === 'payment.refund_approved').length;
          C(P, REFUND_CHECKS[1], identity.ok && lostResult.lost && resultRetry.status === 200 && resultRetry.data?.idempotent === true && Number(state.refunded_amount) === Number(state.paid_amount)
            && state.intent === 'refunded' && approvedEvents === 1 && state.refunds.length === 1,
          { ...lossOf(lostResult), retry: brief(resultRetry), idempotent: resultRetry.data?.idempotent ?? null, paid: state.paid_amount, refunded: state.refunded_amount, refundEvents: approvedEvents },
          'el resultado se asienta una vez: devuelto = cobrado, un evento, un reembolso');
          if (Number(state.refunded_amount) > Number(state.paid_amount) || approvedEvents > 1 || state.refunds.length > 1) tally.doubleRefund += 1;
          scenarios.push({ command: 'prepare_payment_refund_v2 + record_payment_refund_response_v2', loss: [lossOf(lostRefund), lossOf(lostResult)] });
        } else { C(P, REFUND_CHECKS[1], false, { setup: 'el pedido de reembolso no quedó en la base' }); }
      }
    }

    C(P, 'NOTHING_LOST_AND_NOTHING_DUPLICATED', Object.values(tally).every((n) => n === 0), tally, { lostOrders: 0, duplicateOrders: 0, doubleStock: 0, doubleRefund: 0 });
    ctx.evidence.write('phase-lost-ack.json', { technique: 'own socket; the observer confirms the database processed the request; the socket is destroyed without reading the response', scenarios, tally });
  },
};
