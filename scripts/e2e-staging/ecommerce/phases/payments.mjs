// FASE payments — el cobro por Mercado Pago en el borde de la base, como lo manejan las Edge Functions.
//
// Nunca se llama al proveedor: se hace lo que hacen `mercadopago-create-checkout-session`,
// `mercadopago-create-preference`, `mercadopago-payment-worker` y `mercadopago-refund`
// DESPUÉS de hablar con él, con su misma clave de servicio y en su mismo orden
// (`payments.mjs`), con lo que el proveedor habría contestado puesto a mano:
//
//   sesión → prepare_mercadopago_preference_v2 → record_mercadopago_preference_created_v2
//          → record_mercadopago_payment_snapshot → finalize_paid_checkout_session
//
// Y se afirma lo que importa de cada orden de llegada posible: un pago aprobado es UN
// pedido y descuenta el stock UNA vez; el mismo aviso dos veces no duplica nada; un
// pendiente o un rechazado seguidos de un aprobado en la misma preferencia terminan en un
// solo pedido; un aprobado que llega con la reserva vencida no crea el pedido solo, va a
// revisión y levanta una alerta; el reembolso total deja cancelar y el stock vuelve una
// vez; el mismo pedido de reembolso repetido es un reembolso.
//
// La conservación se lleva sobre el producto principal: stock + unidades reservadas por
// sesiones vivas + unidades en pedidos que no las devolvieron no cambia en toda la fase.
import { randomUUID } from 'node:crypto';
import { nowIso, sqlUuid } from '../env.mjs';
import { CODES, brief, refusal, refused } from '../http.mjs';

const P = 'payments';
const REFUND_CHECKS = Object.freeze(['MANUAL_REVIEW_PAYMENT_IS_REFUNDED_WITHOUT_RELEASING_STOCK_TWICE', 'A_PAID_ORDER_IS_NOT_CANCELLED_BEFORE_ITS_REFUND',
  'FULL_REFUND_THEN_CANCEL_RETURNS_STOCK_ONCE', 'DUPLICATE_REFUND_REQUESTS_ARE_ONE_REFUND']);
const count = (list, value) => (list || []).filter((entry) => entry === value).length;
const stateOf = (s) => (s ? { session: s.session, intent: s.intent, orders: s.orders, reservations: s.reservations, paid: s.paid_amount, refunded: s.refunded_amount,
  review: s.review, provider: s.provider_payment_id, events: s.events } : null);

export default {
  id: P,
  title: 'pagos en el borde de la base: aprobado, pendiente, rechazado y aprobado, aviso repetido, aprobado tarde, reembolso y cancelación',
  requires: ['checkout_payments'],
  async run(ctx) {
    const C = ctx.rec.check;
    const id = ctx.tenant.id;
    const target = ctx.env.target;
    const { owner } = ctx.actors;
    const pay = ctx.payments;
    await pay.ensureFixture();
    // Ninguno de estos pagadores necesita un token: todo lo que se hace en su nombre lo hace la Edge Function
    // con la clave de servicio, y el reembolso lo pide el dueño con la suya.
    const payers = await ctx.identities.payers(6, { signIn: false });
    const main = ctx.orders.product('MAIN');
    const units = () => ctx.orders.unitsOf(main.id);
    const total = (u) => Number(u.stock) + Number(u.reserved) + Number(u.in_orders);
    const start = await units();
    const evidence = { start };
    const session = async (payer, label) => {
      const created = await pay.createSession(payer, { role: 'MAIN', quantity: 1, label });
      if (!created.session) throw Error(`PAYMENT_SESSION_NOT_CREATED:${label}:${created.r.status}:${created.r.code}`);
      const redirected = await pay.redirect(created.session);
      if (!redirected.ok) throw Error(`PAYMENT_PREFERENCE_NOT_RECORDED:${label}:${redirected.step}:${redirected.r?.code ?? redirected.r?.status}`);
      return created.session;
    };

    // ── 1. Aprobado: un pedido, el stock una vez ─────────────────────────────
    const a = await pay.paidOrder(payers[0], { role: 'MAIN', quantity: 1, label: 'payments-approved' });
    const aState = a.session ? await pay.state(a.session.id) : null;
    const afterA = await units();
    C(P, 'APPROVED_PAYMENT_BECOMES_ONE_ORDER_AND_TAKES_STOCK_ONCE', a.ok && aState?.orders === 1 && aState.session === 'completed' && aState.intent === 'completed'
      && JSON.stringify(aState.reservations) === JSON.stringify(['converted:1:-']) && Number(aState.paid_amount) === a.session.total
      && afterA.stock === start.stock - 1 && afterA.reserved === start.reserved && total(afterA) === total(start),
    { setup: a.ok ? null : { step: a.step, answer: brief(a.r) }, state: stateOf(aState), units: [start, afterA] }, 'un pedido, la reserva convertida, el intento completo y una unidad menos en la góndola');
    if (!a.ok) { ctx.evidence.write('phase-payments.json', evidence); return; }

    // ── 2. El mismo aviso aprobado dos veces ─────────────────────────────────
    // a) Después del pedido: el aviso repetido no reabre nada y finalizar otra vez devuelve el mismo pedido.
    const replay = await pay.snapshot(a.session, 'approved');
    const refinal = await pay.finalize(a.session);
    const aAgain = await pay.state(a.session.id);
    // b) Antes del pedido: el aviso llega dos veces y la finalización también.
    const d = await session(payers[1], 'payments-duplicate-notice');
    const d1 = await pay.snapshot(d, 'approved');
    const d2 = await pay.snapshot(d, 'approved');
    const f1 = await pay.finalize(d);
    const f2 = await pay.finalize(d);
    const dState = await pay.state(d.id);
    C(P, 'THE_SAME_APPROVED_NOTICE_TWICE_IS_ONE_PAYMENT_AND_ONE_ORDER', replay.ok && replay.data?.finalize_required === false && refinal.data?.idempotent === true
      && refinal.data?.order_id === aState.order_id && aAgain.orders === 1 && count(aAgain.events, 'payment.approved') === 1
      && d1.data?.finalize_required === true && d2.ok && Boolean(f1.data?.order_id) && f2.data?.idempotent === true && f2.data?.order_id === f1.data?.order_id
      && dState.orders === 1 && count(dState.events, 'payment.approved') === 1,
    { afterOrder: { replay: replay.data ?? brief(replay), finalize: refinal.data ?? brief(refinal), events: aAgain.events },
      beforeOrder: { first: d1.data ?? brief(d1), second: d2.data ?? brief(d2), finalize: [f1.data?.order_id ?? brief(f1), f2.data ?? brief(f2)], state: stateOf(dState) } },
    'un evento de aprobado, un pedido y la misma respuesta a la finalización repetida, llegue el aviso antes o después del pedido');

    // ── 3. Pendiente y después aprobado ──────────────────────────────────────
    const c = await session(payers[2], 'payments-pending-then-approved');
    const pending = await pay.snapshot(c, 'pending', { seed: 'pending' });
    const cMid = await pay.state(c.id);
    const cApproved = await pay.snapshot(c, 'approved', { seed: 'approved' });
    const cFinal = await pay.finalize(c);
    const cState = await pay.state(c.id);
    C(P, 'PENDING_THEN_APPROVED_IS_ONE_ORDER', pending.ok && cMid.intent === 'pending' && cMid.session === 'payment_pending' && cMid.orders === 0
      && JSON.stringify(cMid.reservations) === JSON.stringify(['active:1:-']) && cApproved.data?.finalize_required === true && Boolean(cFinal.data?.order_id)
      && cState.orders === 1 && cState.intent === 'completed', { pending: stateOf(cMid), approved: cApproved.data ?? brief(cApproved), final: stateOf(cState) },
    'mientras está pendiente no hay pedido y la reserva sigue viva; el aprobado termina en un pedido');

    // ── 4. Rechazado y después aprobado, en la misma preferencia ─────────────
    // El comprador sigue en Checkout Pro y paga con otro medio: otro pago del proveedor sobre la misma preferencia.
    const r = await session(payers[3], 'payments-rejected-then-approved');
    const rejectedId = `ECOMCERT-PAY-${r.ref}-R`;
    const approvedId = `ECOMCERT-PAY-${r.ref}-A`;
    const rejected = await pay.snapshot(r, 'rejected', { paymentId: rejectedId, seed: 'rejected' });
    const rMid = await pay.state(r.id);
    const rApproved = await pay.snapshot(r, 'approved', { paymentId: approvedId, seed: 'approved' });
    const rFinal = await pay.finalize(r);
    const rState = await pay.state(r.id);
    r.paymentId = approvedId;
    C(P, 'REJECTED_THEN_APPROVED_IN_THE_SAME_PREFERENCE_IS_ONE_ORDER', rejected.ok && rMid.intent === 'rejected' && rMid.orders === 0
      && JSON.stringify(rMid.reservations) === JSON.stringify(['active:1:-']) && rApproved.data?.finalize_required === true && Boolean(rFinal.data?.order_id)
      && rState.orders === 1 && rState.provider_payment_id === approvedId && rState.intent === 'completed',
    { rejected: stateOf(rMid), approved: rApproved.data ?? brief(rApproved), final: stateOf(rState) },
    'el rechazo no libera la reserva ni crea nada; el pago aprobado se queda con la identidad y termina en un solo pedido');

    // ── 5. Aprobado después de que venció la reserva ─────────────────────────
    const late = await session(payers[4], 'payments-late-approval');
    const aged = await pay.ageSession(late.id, 'late approval: the reservation expires before the provider approves');
    // El barrido es el que corre el planificador; donde el planificador corre de verdad puede ganarle a esta llamada.
    const swept = await ctx.edgeRpc('sweep_expired_checkout_sessions', {});
    const expired = await pay.state(late.id);
    const afterExpiry = await units();
    const lateApproved = await pay.snapshot(late, 'approved');
    const lateState = await pay.state(late.id);
    const afterLate = await units();
    C(P, 'LATE_APPROVAL_AFTER_EXPIRY_GOES_TO_MANUAL_REVIEW_WITHOUT_AN_ORDER', aged.ok && swept.ok && expired.session === 'expired'
      && JSON.stringify(expired.reservations) === JSON.stringify(['released:1:checkout_expired']) && lateApproved.data?.manual_review_required === true
      && lateApproved.data?.finalize_required === false && lateState.orders === 0 && lateState.intent === 'security_review_required'
      && lateState.review === 'approved_after_reservation_expired' && lateState.session === 'manual_review_required'
      && afterLate.stock === afterExpiry.stock && afterLate.reserved === afterExpiry.reserved,
    { aged: aged.via, sweep: brief(swept), expired: stateOf(expired), late: lateApproved.data ?? brief(lateApproved), state: stateOf(lateState), units: [afterExpiry, afterLate] },
    'la reserva vencida vuelve a la góndola; el aprobado tardío no crea el pedido ni vuelve a tomar stock: queda en revisión manual');
    const refreshed = await ctx.http.call(owner, 'refresh_operational_alerts', { p_business_id: id });
    const alerts = await ctx.env.observe(`select alert_code, status, severity from public.operational_alerts
      where business_id = ${sqlUuid(id)} and subject_id = ${sqlUuid(late.intentId)}`);
    C(P, 'LATE_APPROVAL_RAISES_A_RECONCILIATION_ALERT', refreshed.ok && alerts.some((alert) => alert.alert_code === 'PAYMENT_RECONCILIATION_REQUIRED' && alert.status === 'open'),
      { refresh: brief(refreshed), alerts }, 'una alerta PAYMENT_RECONCILIATION_REQUIRED abierta sobre ese cobro');

    // ── 6. Aprobado sin pedido: la alerta persistente ────────────────────────
    // Un cobro aprobado al que no le llega el pedido levanta PAYMENT_APPROVED_WITHOUT_ORDER a los cinco minutos. Donde
    // la base es de quien corre, la aprobación se corre cinco minutos y medio hacia atrás en lugar de esperar.
    const noOwnership = target.lacks('database_ownership');
    if (noOwnership) ctx.rec.skipOnTarget(P, 'APPROVED_WITHOUT_ORDER_RAISES_A_PERSISTENT_ALERT_UNTIL_THE_ORDER_EXISTS', noOwnership);
    else {
      const e = await session(payers[5], 'payments-approved-without-order');
      const approvedOnly = await pay.snapshot(e, 'approved');
      const entry = { at: nowIso(), what: `age payment_intents.approved_at of ${e.intentId.slice(0, 8)} by 5.5 minutes`, why: 'PAYMENT_APPROVED_WITHOUT_ORDER fires after five minutes', rows: null };
      ctx.ledger.databaseInterventions.push(entry);
      ctx.persist();
      let agedApproval = null;
      try {
        agedApproval = await target.database.write(`update public.payment_intents set approved_at = clock_timestamp() - interval '330 seconds'
          where id = $1 and business_id = $2 and internal_status = 'approved_order_pending'`, [e.intentId, id]);
        entry.rows = { payment_intents: agedApproval.rowCount };
      } catch (error) { entry.rows = { error: String(error.message).slice(0, 160) }; }
      ctx.persist();
      await ctx.http.call(owner, 'refresh_operational_alerts', { p_business_id: id });
      const open = await ctx.env.observe(`select status from public.operational_alerts where business_id = ${sqlUuid(id)} and subject_id = ${sqlUuid(e.intentId)}
        and alert_code = 'PAYMENT_APPROVED_WITHOUT_ORDER'`);
      const finalized = await pay.finalize(e);
      await ctx.http.call(owner, 'refresh_operational_alerts', { p_business_id: id });
      const after = await ctx.env.observe(`select status from public.operational_alerts where business_id = ${sqlUuid(id)} and subject_id = ${sqlUuid(e.intentId)}
        and alert_code = 'PAYMENT_APPROVED_WITHOUT_ORDER'`);
      C(P, 'APPROVED_WITHOUT_ORDER_RAISES_A_PERSISTENT_ALERT_UNTIL_THE_ORDER_EXISTS', approvedOnly.data?.finalize_required === true && agedApproval?.rowCount === 1
        && open.length === 1 && open[0].status === 'open' && Boolean(finalized.data?.order_id) && after.length === 1 && after[0].status === 'resolved',
      { intervention: entry.rows, alertWhileApprovedWithoutOrder: open, finalize: finalized.data?.order_id ? 'order created' : brief(finalized), alertAfterOrder: after },
      'abierta mientras el cobro aprobado no tiene pedido; resuelta en cuanto el pedido existe (la aprobación se envejeció por la conexión directa: la base es de esta corrida)');
    }

    // ── 7. Reembolsos ────────────────────────────────────────────────────────
    if (!ctx.caps.payment_refunds) {
      for (const name of REFUND_CHECKS) ctx.rec.skipCheck(P, name, 'payment_refunds');
    } else {
      // a. El dinero del aprobado tardío vuelve sin tocar el stock otra vez (la reserva ya había vuelto al vencer).
      const beforeLateRefund = await units();
      const lateRefund = await pay.requestRefund(owner, late.intentId, { reason: `${ctx.runId} QA aprobado tardio sin dinero real` });
      const lateSettled = lateRefund.r.ok ? await pay.settleRefund({ refundId: lateRefund.r.data.refund_id, intentId: late.intentId, paymentId: lateState.provider_payment_id,
        key: lateRefund.r.data.idempotency_key, amount: Number(lateRefund.r.data.amount) }) : { ok: false };
      const lateFinal = await pay.state(late.id);
      const afterLateRefund = await units();
      C(P, REFUND_CHECKS[0], lateRefund.r.ok && lateSettled.ok && Number(lateFinal.refunded_amount) === Number(lateFinal.paid_amount) && lateFinal.orders === 0
        && afterLateRefund.stock === beforeLateRefund.stock && afterLateRefund.reserved === beforeLateRefund.reserved,
      { request: lateRefund.r.data ?? brief(lateRefund.r), state: stateOf(lateFinal), units: [beforeLateRefund, afterLateRefund] }, 'devuelto = cobrado, sin pedido y sin mover el stock');

      // b. El pedido pagado no se cancela antes de devolver el dinero.
      const orderA = aState.order_id;
      let st = await ctx.orders.state(orderA);
      const beforeRefund = await units();
      const early = await ctx.orders.cancel(owner, orderA, Number(st.revision), `${ctx.runId} QA cancelar antes del reembolso`);
      const stillOpen = await ctx.orders.state(orderA);
      const blocked = { message: 'pedido cobrado por Mercado Pago' };
      C(P, REFUND_CHECKS[1], refused(early, CODES.STATE, blocked) && stillOpen.status === st.status && Number(stillOpen.revision) === Number(st.revision)
        && (await units()).stock === beforeRefund.stock, { cancel: brief(early), status: [st.status, stillOpen.status] }, `${refusal(CODES.STATE, blocked)} y nada cambia`);

      // c. Reembolso total, después la cancelación: el stock vuelve UNA vez.
      const asked = await pay.requestRefund(owner, a.session.intentId, { reason: `${ctx.runId} QA reembolso total sin dinero real` });
      const settled = asked.r.ok ? await pay.settleRefund({ refundId: asked.r.data.refund_id, intentId: a.session.intentId, paymentId: a.session.paymentId,
        key: asked.r.data.idempotency_key, amount: Number(asked.r.data.amount) }) : { ok: false };
      const refundedA = await pay.state(a.session.id);
      st = await ctx.orders.state(orderA);
      const cancelled = await ctx.orders.cancel(owner, orderA, Number(st.revision), `${ctx.runId} QA cancelar despues del reembolso`);
      const afterCancel = await units();
      st = await ctx.orders.state(orderA);
      const again = await ctx.orders.cancel(owner, orderA, Number(st.revision), `${ctx.runId} QA segunda cancelacion`);
      const afterAgain = await units();
      C(P, REFUND_CHECKS[2], asked.r.ok && settled.ok && refundedA.intent === 'refunded' && Number(refundedA.refunded_amount) === Number(refundedA.paid_amount)
        && cancelled.ok && st.status === 'cancelled' && Boolean(st.inventory_released_at) && afterCancel.stock === beforeRefund.stock + 1
        && afterCancel.in_orders === beforeRefund.in_orders - 1 && again.ok && again.data?.idempotent_no_op === true && afterAgain.stock === afterCancel.stock,
      { refund: asked.r.data ?? brief(asked.r), state: stateOf(refundedA), cancel: brief(cancelled), second: again.ok ? { no_op: again.data?.idempotent_no_op ?? null } : brief(again),
        units: [beforeRefund, afterCancel, afterAgain] }, 'reembolsado entero; la cancelación devuelve una unidad y la segunda no hace nada');

      // d. El mismo pedido de reembolso repetido es UN reembolso (cobro del punto 3).
      const key = randomUUID();
      const first = await pay.requestRefund(owner, c.intentId, { key });
      const same = await pay.requestRefund(owner, c.intentId, { key });
      const otherKey = await pay.requestRefund(owner, c.intentId, { key: randomUUID() });
      const settledC = first.r.ok ? await pay.settleRefund({ refundId: first.r.data.refund_id, intentId: c.intentId, paymentId: cState.provider_payment_id,
        key, amount: Number(first.r.data.amount) }) : { ok: false };
      const nothingLeft = await pay.requestRefund(owner, c.intentId, { key: randomUUID() });
      const refundedC = await pay.state(c.id);
      // Devuelto entero, el cobro ya no admite otro reembolso: «no reembolsable en su estado actual» (55000).
      const invalid = { message: 'pago no reembolsable en su estado actual' };
      C(P, REFUND_CHECKS[3], first.r.ok && first.r.data?.idempotent === false && same.r.data?.refund_id === first.r.data?.refund_id && same.r.data?.idempotent === true
        && otherKey.r.data?.refund_id === first.r.data?.refund_id && otherKey.r.data?.idempotent === true && settledC.ok && refused(nothingLeft.r, CODES.STATE, invalid)
        && refundedC.refunds.length === 1 && refundedC.refunds[0].status === 'approved' && Number(refundedC.refunded_amount) === Number(refundedC.paid_amount)
        && count(refundedC.events, 'payment.refund_approved') === 1,
      { first: first.r.data ?? brief(first.r), sameKey: same.r.data ?? brief(same.r), otherKeyWhileInFlight: otherKey.r.data ?? brief(otherKey.r), afterRefund: brief(nothingLeft.r),
        refunds: refundedC.refunds.map((f) => ({ status: f.status, amount: f.amount })) }, `la misma solicitud con la misma clave o con otra mientras está en curso; después ${refusal(CODES.STATE, invalid)}`);
    }

    // ── 8. Conservación ──────────────────────────────────────────────────────
    const end = await units();
    evidence.end = end;
    C(P, 'STOCK_IS_CONSERVED_ACROSS_EVERY_PAYMENT_SCENARIO', total(end) === total(start) && end.stock >= 0,
      { start, end, conserved: total(start) }, 'stock + reservado + en pedidos, igual al principio y al final de la fase');
    ctx.evidence.write('phase-payments.json', evidence);
  },
};
