// FASE cancellation — cancelar devuelve el stock una vez, y sólo cuando corresponde.
import { randomUUID } from 'node:crypto';
import { shortId } from '../env.mjs';
import { brief, refusal, refused } from '../http.mjs';
import { FIXTURES } from '../tenant.mjs';

const P = 'cancellation';

export default {
  id: P,
  title: 'cancelación: antes y después de aceptar, con cobro confirmado, dos cancelaciones a la vez y la del propio cliente',
  requires: [],
  async run(ctx) {
    const C = ctx.rec.check;
    // Cancelar y rechazar piden orders.cancel del catálogo (20261002050000, AUTHZ-04): el dueño y el encargado
    // (admin) lo tienen; el empleado no. Las cancelaciones del comercio las hace el encargado.
    const { owner, admin, staff } = ctx.actors;
    const customer = await ctx.identities.customer('cancellation', { address: false });
    const stock = async () => (await ctx.orders.fixtures()).MAIN.stock;
    const reason = `${ctx.runId} QA cancelacion`;
    const cases = [];

    // ── a. Antes de aceptar ──────────────────────────────────────────────────
    const s0 = await stock();
    const a = await ctx.orders.create(customer, { mode: 'pickup', role: 'MAIN', quantity: 3, label: 'cancel-before-accept' });
    C(P, 'ORDER_A_CREATED_AND_STOCK_TAKEN', Boolean(a.order) && (await stock()) === s0 - 3, brief(a.r));
    if (!a.order) return;
    let st = await ctx.orders.state(a.order.id);
    const staffTry = await ctx.orders.cancel(staff, a.order.id, Number(st.revision), `${reason} empleado`);
    st = await ctx.orders.state(a.order.id);
    C(P, 'STAFF_CANCEL_REFUSED_PERMISSION_REQUIRED', refused(staffTry, '42501', { actor: 'staff', details: 'PERMISSION_REQUIRED' }) && st.status === 'received'
      && (await stock()) === s0 - 3, { ...brief(staffTry), status: st.status, stock: await stock() }, refusal('42501', { actor: 'staff', details: 'PERMISSION_REQUIRED' }));
    const cancelA = await ctx.orders.cancel(admin, a.order.id, Number(st.revision), reason);
    let truth = await ctx.orders.truth(a.order.id);
    C(P, 'CANCEL_BEFORE_ACCEPTANCE_RETURNS_STOCK_ONCE', cancelA.ok && truth.order_row.status === 'cancelled' && Boolean(truth.order_row.inventory_released_at) && (await stock()) === s0,
      { ...brief(cancelA), status: truth.order_row.status, released: truth.order_row.inventory_released_at, stock: await stock() }, { stock: s0 });
    const releaseEvents = truth.events.filter((e) => e.event_type === 'order.status_changed' && e.metadata.next_status === 'cancelled');
    C(P, 'CANCEL_WRITES_ONE_STATUS_EVENT_WITH_INVENTORY_RELEASED', releaseEvents.length === 1 && releaseEvents[0].metadata.inventory_released === true
      && ctx.orders.countEvents(truth.events, 'business_cancel_reason') === 1, { events: truth.events.map((e) => e.event_type) });
    // Segunda cancelación (otra clave, revisión vigente): no hace nada.
    st = await ctx.orders.state(a.order.id);
    const eventsBefore = truth.events.length;
    const again = await ctx.orders.cancel(admin, a.order.id, Number(st.revision), `${reason} segundo intento`);
    truth = await ctx.orders.truth(a.order.id);
    C(P, 'SECOND_CANCEL_DOES_NOT_RETURN_STOCK_AGAIN', (await stock()) === s0 && truth.order_row.status === 'cancelled' && Number(truth.order_row.revision) === Number(st.revision)
      && ctx.orders.statusChain(truth.events).filter((s) => s.endsWith('>cancelled')).length === 1, { ...brief(again), stock: await stock(), revision: [st.revision, truth.order_row.revision] });
    C(P, 'SECOND_CANCEL_IS_A_NO_OP_THAT_WRITES_NOTHING', again.ok && again.data?.idempotent_no_op === true && truth.events.length === eventsBefore
      && ctx.orders.countEvents(truth.events, 'business_cancel_reason') === 1 && (truth.receipts || []).filter((r) => r.command === 'cancel_order').length === 1,
    { response: again.ok ? { idempotent_no_op: again.data?.idempotent_no_op ?? null } : brief(again), events: [eventsBefore, truth.events.length],
      cancelReasons: ctx.orders.countEvents(truth.events, 'business_cancel_reason'), cancelReceipts: (truth.receipts || []).filter((r) => r.command === 'cancel_order').length },
    'sin evento, sin motivo y sin recibo nuevos');
    cases.push({ case: 'before-accept', order: a.order.public_code, events: truth.events.map((e) => e.event_type) });

    // ── b. Después de aceptar ────────────────────────────────────────────────
    const s1 = await stock();
    const b = await ctx.orders.create(customer, { mode: 'pickup', role: 'MAIN', quantity: 2, label: 'cancel-after-accept' });
    if (b.order) {
      st = await ctx.orders.state(b.order.id);
      const acc = await ctx.orders.transition(staff, b.order.id, 'accepted', Number(st.revision));
      st = await ctx.orders.state(b.order.id);
      const cancelB = await ctx.orders.cancel(admin, b.order.id, Number(st.revision), reason);
      truth = await ctx.orders.truth(b.order.id);
      C(P, 'CANCEL_AFTER_ACCEPTANCE_RETURNS_STOCK_ONCE', acc.ok && cancelB.ok && truth.order_row.status === 'cancelled' && Boolean(truth.order_row.inventory_released_at)
        && (await stock()) === s1 && JSON.stringify(ctx.orders.statusChain(truth.events)) === JSON.stringify(['received>accepted', 'accepted>cancelled']),
      { accept: brief(acc), cancel: brief(cancelB), chain: ctx.orders.statusChain(truth.events), stock: await stock() }, { stock: s1 });
    } else { C(P, 'CANCEL_AFTER_ACCEPTANCE_RETURNS_STOCK_ONCE', false, brief(b.r)); }

    // ── c. Con el cobro manual confirmado: no se cancela ─────────────────────
    const s2 = await stock();
    const c = await ctx.orders.create(customer, { mode: 'pickup', role: 'MAIN', quantity: 1, label: 'cancel-with-payment' });
    if (c.order) {
      st = await ctx.orders.state(c.order.id);
      await ctx.orders.transition(staff, c.order.id, 'accepted', Number(st.revision));
      st = await ctx.orders.state(c.order.id);
      const paid = await ctx.http.call(staff, 'confirm_manual_order_payment', { p_order_id: c.order.id, p_expected_revision: Number(st.revision), p_actual_method: 'cash',
        p_idempotency_key: `ecomcert-pay-${shortId(8)}` });
      st = await ctx.orders.state(c.order.id);
      const blocked = await ctx.orders.cancel(admin, c.order.id, Number(st.revision), reason);
      const afterBlocked = await ctx.orders.state(c.order.id);
      C(P, 'CANCEL_REFUSED_WHILE_MANUAL_PAYMENT_IS_CONFIRMED', paid.ok && refused(blocked, '55000') && afterBlocked.status === 'accepted'
        && afterBlocked.inventory_released_at === null && (await stock()) === s2 - 1, { pay: brief(paid), cancel: brief(blocked), status: afterBlocked.status, stock: await stock() }, `${refusal('55000')} y nada cambia`);
      const reversed = await ctx.http.call(owner, 'reverse_manual_order_payment', { p_order_id: c.order.id, p_expected_revision: Number(afterBlocked.revision),
        p_reason: `${ctx.runId} QA devolucion antes de cancelar`, p_idempotency_key: `ecomcert-rev-${shortId(8)}` });
      st = await ctx.orders.state(c.order.id);
      const cancelC = await ctx.orders.cancel(admin, c.order.id, Number(st.revision), reason);
      const afterCancel = await ctx.orders.state(c.order.id);
      C(P, 'CANCEL_ALLOWED_AFTER_PAYMENT_REVERSAL', reversed.ok && cancelC.ok && afterCancel.status === 'cancelled' && afterCancel.manual_payment_status === 'reversed' && (await stock()) === s2,
        { reverse: brief(reversed), cancel: brief(cancelC), status: afterCancel.status, payment: afterCancel.manual_payment_status, stock: await stock() }, { stock: s2 });
    } else { C(P, 'CANCEL_REFUSED_WHILE_MANUAL_PAYMENT_IS_CONFIRMED', false, brief(c.r)); }

    // ── d. Dos cancelaciones a la vez ────────────────────────────────────────
    const s3 = await stock();
    const d = await ctx.orders.create(customer, { mode: 'pickup', role: 'MAIN', quantity: 4, label: 'cancel-concurrent' });
    if (d.order) {
      st = await ctx.orders.state(d.order.id);
      const [one, two] = await Promise.all([
        ctx.orders.cancel(admin, d.order.id, Number(st.revision), `${reason} A`),
        ctx.orders.cancel(owner, d.order.id, Number(st.revision), `${reason} B`),
      ]);
      truth = await ctx.orders.truth(d.order.id);
      const winners = [one, two].filter((r) => r.ok && r.data?.idempotent_no_op !== true).length;
      C(P, 'TWO_CONCURRENT_CANCELS_RETURN_STOCK_ONCE', (await stock()) === s3 && truth.order_row.status === 'cancelled'
        && ctx.orders.statusChain(truth.events).filter((s) => s.endsWith('>cancelled')).length === 1,
      { admin: brief(one), owner: brief(two), stock: await stock(), chain: ctx.orders.statusChain(truth.events) }, { stock: s3 });
      C(P, 'TWO_CONCURRENT_CANCELS_HAVE_ONE_WINNER', winners === 1 && [one, two].some((r) => refused(r, 'PT409') || r.data?.idempotent_no_op === true),
        { admin: one.ok ? { ok: true, no_op: one.data?.idempotent_no_op ?? false } : brief(one), owner: two.ok ? { ok: true, no_op: two.data?.idempotent_no_op ?? false } : brief(two) });
      C(P, 'TWO_CONCURRENT_CANCELS_LEAVE_ONE_CANCEL_REASON', ctx.orders.countEvents(truth.events, 'business_cancel_reason') === 1,
        { reasons: ctx.orders.countEvents(truth.events, 'business_cancel_reason') });
    } else { C(P, 'TWO_CONCURRENT_CANCELS_RETURN_STOCK_ONCE', false, brief(d.r)); }

    // ── e. Un pedido cancelado no se vuelve a operar ─────────────────────────
    st = await ctx.orders.state(a.order.id);
    const revive = await ctx.orders.transition(staff, a.order.id, 'accepted', Number(st.revision));
    C(P, 'CANCELLED_ORDER_CANNOT_BE_REOPENED', refused(revive, '23514') && (await ctx.orders.state(a.order.id)).status === 'cancelled', brief(revive), refusal('23514'));

    // ── f. Lo que depende de contratos todavía no desplegados ────────────────
    if (ctx.caps.customer_cancel) {
      const s4 = await stock();
      const mine = await ctx.orders.create(customer, { mode: 'pickup', role: 'MAIN', quantity: 2, label: 'cancel-by-customer' });
      // Antes de que su dueño lo cancele, lo intenta OTRO cliente. El contrato (20261001192000) es que un pedido
      // ajeno conteste exactamente igual que uno que no existe —P0002 «pedido inexistente»— y que no se toque.
      const stranger = await ctx.identities.customer('cancellation-stranger', { address: false });
      const cancelAs = (actor, orderId, why = null) => ctx.http.call(actor, 'cancel_own_order', { p_order_id: orderId, p_idempotency_key: `ecomcert-own-${shortId(8)}`, p_reason: why });
      const answer = (r) => ({ http: r.status, code: r.code, message: r.error?.message ?? null, details: r.error?.details ?? null, hint: r.error?.hint ?? null });
      const foreign = mine.order ? await cancelAs(stranger, mine.order.id) : { ok: false };
      const missing = await cancelAs(stranger, randomUUID());
      const untouched = mine.order ? await ctx.orders.state(mine.order.id) : null;
      C(P, 'FOREIGN_ORDER_IS_ANSWERED_EXACTLY_LIKE_A_MISSING_ONE', !foreign.ok && foreign.code === 'P0002' && JSON.stringify(answer(foreign)) === JSON.stringify(answer(missing))
        && untouched?.status === 'received' && untouched.inventory_released_at === null && (await stock()) === s4 - 2,
      { foreign: answer(foreign), missing: answer(missing), order: untouched?.status }, 'la misma respuesta P0002 para los dos, y el pedido intacto');
      // «No existe» es un error de quien llama. Salía con HTTP 500 (C-2: PostgREST contesta 500 a toda la familia P0
      // salvo P0001, el mismo mecanismo de API-01 con otro SQLSTATE); desde 20261002090000 la frontera contesta 404.
      C(P, 'ORDER_NOT_FOUND_IS_ANSWERED_AS_A_CLIENT_ERROR', missing.code === 'P0002' && missing.status >= 400 && missing.status < 500, brief(missing), 'HTTP 4xx · P0002');
      const own = mine.order ? await cancelAs(customer, mine.order.id, 'me equivoque de pedido') : { ok: false };
      const after = mine.order ? await ctx.orders.state(mine.order.id) : null;
      C(P, 'CUSTOMER_CANCELS_OWN_UNATTENDED_ORDER', own.ok && after?.status === 'cancelled' && Boolean(after.inventory_released_at) && (await stock()) === s4, { ...brief(own), status: after?.status, stock: await stock() });
    } else {
      for (const name of ['FOREIGN_ORDER_IS_ANSWERED_EXACTLY_LIKE_A_MISSING_ONE', 'ORDER_NOT_FOUND_IS_ANSWERED_AS_A_CLIENT_ERROR', 'CUSTOMER_CANCELS_OWN_UNATTENDED_ORDER']) ctx.rec.skipCheck(P, name, 'customer_cancel');
    }
    if (!ctx.caps.order_expiry) ctx.rec.skipCheck(P, 'UNATTENDED_ORDER_IS_CANCELLED_BY_TIMEOUT', 'order_expiry');
    if (ctx.caps.cancel_republish) {
      const lastBefore = (await ctx.orders.fixtures()).LAST_UNIT;
      const lastOrder = await ctx.orders.create(customer, { mode: 'pickup', role: 'LAST_UNIT', quantity: 1, label: 'cancel-republish' });
      const soldOut = (await ctx.orders.fixtures()).LAST_UNIT;
      const cancelled = lastOrder.order ? await ctx.orders.cancel(admin, lastOrder.order.id, Number(lastOrder.order.revision), reason) : { ok: false };
      const back = (await ctx.orders.fixtures()).LAST_UNIT;
      C(P, 'CANCEL_REPUBLISHES_A_PRODUCT_WHOSE_STOCK_RETURNS', lastBefore.available && soldOut.stock === 0 && !soldOut.available && cancelled.ok && back.stock === FIXTURES.LAST_UNIT.stock && back.available === true,
        { before: lastBefore.available, soldOut: soldOut.available, cancel: brief(cancelled), after: { stock: back.stock, available: back.available } });
    } else { ctx.rec.skipCheck(P, 'CANCEL_REPUBLISHES_A_PRODUCT_WHOSE_STOCK_RETURNS', 'cancel_republish'); }

    ctx.evidence.write('phase-cancellation.json', { cases, stock: { initial: s0, final: await stock() } });
  },
};
