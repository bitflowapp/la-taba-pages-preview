// FASE rider — la entrega de punta a punta, y quién NO puede dar cada paso.
//
// Dos caminos de entrega con envío:
//
//   · con repartidor: oferta (rechazada por uno, retirada por el comercio, aceptada por
//     otro), retiro, en camino, llegó, código equivocado, código correcto, entregado;
//   · con envío propio del comercio: el mostrador despacha y cierra con el código que
//     trae el cliente (`confirm_business_delivery_code`).
//
// La fase `lifecycle` recorre el camino feliz del repartidor. Acá va lo que lo rodea: el
// repartidor que no es el asignado no puede dar ningún paso ni ver el pedido, un cliente
// no ofrece pedidos, el comercio no cierra un pedido que lleva un repartidor, un código
// equivocado no entrega y —reenviado tal cual, como reintenta una app sin señal— gasta
// UN intento, no uno por copia.
import { randomUUID } from 'node:crypto';
import { nowIso, shortId, sqlUuid } from '../env.mjs';
import { CODES, brief, refusal, refused } from '../http.mjs';

const P = 'rider';
const SELF_DELIVERY_CHECKS = Object.freeze(['BUSINESS_CANNOT_CLOSE_AN_ORDER_CARRIED_BY_A_RIDER', 'BUSINESS_DISPATCHES_ITS_OWN_DELIVERY', 'RIDER_CANNOT_CONFIRM_A_BUSINESS_OWN_DELIVERY',
  'BUSINESS_WRONG_CODE_DOES_NOT_DELIVER', 'BUSINESS_WRONG_CODE_RESENT_WITH_THE_SAME_KEY_COUNTS_ONE_ATTEMPT', 'BUSINESS_DELIVERY_WITH_A_STALE_REVISION_IS_REFUSED',
  'BUSINESS_CLOSES_ITS_OWN_DELIVERY_WITH_THE_CUSTOMER_CODE', 'BUSINESS_DELIVERY_REPLAY_RETURNS_THE_RECEIPT']);
const result = (r) => (r.ok ? { http: r.status, ok: r.data?.ok ?? null, code: r.data?.code ?? r.data?.outcome ?? null } : brief(r));
// Un «no» del dominio: la RPC contesta 200 con `ok: false` y un código estable.
const declined = (r, code) => r.status === 200 && r.data?.ok === false && r.data?.code === code;

export default {
  id: P,
  title: 'entrega: oferta, rechazo y retiro de oferta, pasos del repartidor, código de entrega y envío propio del comercio',
  requires: [],
  async run(ctx) {
    const C = ctx.rec.check;
    const id = ctx.tenant.id;
    const { staff, rider1, rider2 } = ctx.actors;
    const customer = await ctx.identities.customer('rider');
    const other = await ctx.identities.customer('rider-other', { address: false });
    const s0 = (await ctx.orders.fixtures()).MAIN.stock;
    const handoff = async (orderId) => (await ctx.env.observe(`select h.failed_attempts, h.confirmed_at is not null as confirmed, h.confirmed_by_user_id, h.locked_until is not null as locked,
      (select coalesce(json_object_agg(a.result, a.n), '{}'::json) from (select result, count(*)::int as n from public.delivery_confirmation_attempts where order_id = h.order_id group by result) a) as attempts
      from public.order_delivery_handoffs h where h.order_id = ${sqlUuid(orderId)}`))[0] || null;
    const offerRow = async (offerId) => (await ctx.env.observe(`select status, version, rider_user_id from public.rider_order_offers where id = ${sqlUuid(offerId)}`))[0] || null;
    const accept = (rider, offer) => ctx.http.call(rider, 'accept_rider_order_offer', { p_offer_id: offer.offer_id, p_expected_version: Number(offer.version), p_idempotency_key: `android-${shortId(32)}` });
    const wrongCodeOf = (code) => String(((Number(code) - 1000 + 1) % 9000) + 1000);
    const log = [];

    // ── 1. Un pedido con envío, listo, y dos repartidores disponibles ─────────
    const created = await ctx.orders.create(customer, { mode: 'delivery', role: 'MAIN', quantity: 2, payment: 'cash', label: 'rider-delivery' });
    C(P, 'DELIVERY_ORDER_CREATED', Boolean(created.order), brief(created.r));
    if (!created.order) return;
    const O = created.order.id;
    const ready = await ctx.orders.advance(staff, O, 'ready');
    const on1 = await ctx.orders.riderAvailability(rider1, true);
    const on2 = await ctx.orders.riderAvailability(rider2, true);
    for (const rider of [rider1, rider2]) ctx.timers.push(setInterval(() => { void ctx.http.call(rider, 'heartbeat_rider_availability', { p_business_id: id }); }, 30_000));
    C(P, 'ORDER_READY_AND_BOTH_RIDERS_AVAILABLE', ready.ok && on1.ok && on2.ok, { order: ready.steps, rider1: result(on1), rider2: result(on2) });
    if (!ready.ok) return;

    // ── 2. Quién puede ofrecer, y qué pasa cuando el repartidor dice que no ───
    const byCustomer = await ctx.orders.offer(customer, O, rider1.userId);
    C(P, 'CUSTOMER_CANNOT_OFFER_AN_ORDER_TO_A_RIDER', refused(byCustomer, CODES.FORBIDDEN) && (await ctx.orders.state(O)).status === 'ready', brief(byCustomer), refusal(CODES.FORBIDDEN));
    const first = await ctx.orders.offer(staff, O, rider1.userId);
    C(P, 'STAFF_OFFERS_THE_ORDER', first.status === 200 && first.data?.ok === true && first.data?.code === 'offered', result(first));
    const stranger = await accept(rider2, first.data || {});
    const afterStranger = await ctx.orders.state(O);
    C(P, 'ANOTHER_RIDER_CANNOT_ACCEPT_SOMEONE_ELSES_OFFER', !(stranger.ok && stranger.data?.ok === true) && afterStranger.status === 'ready' && afterStranger.assigned_rider_user_id === null
      && (await offerRow(first.data?.offer_id))?.status === 'pending', { answer: result(stranger), order: afterStranger.status, assigned: afterStranger.assigned_rider_user_id },
    'la oferta sigue pendiente y el pedido sin repartidor');
    const badReason = await ctx.http.call(rider1, 'reject_rider_order_offer', { p_offer_id: first.data?.offer_id, p_expected_version: Number(first.data?.version),
      p_reason_code: 'porque si', p_idempotency_key: `android-${shortId(32)}` });
    C(P, 'REJECT_WITH_AN_UNKNOWN_REASON_IS_REFUSED_AS_VALIDATION', refused(badReason, CODES.VALIDATION), brief(badReason), refusal(CODES.VALIDATION));
    const rejectParams = { p_offer_id: first.data?.offer_id, p_expected_version: Number(first.data?.version), p_reason_code: 'too_far', p_idempotency_key: `android-${shortId(32)}` };
    const rejected = await ctx.http.call(rider1, 'reject_rider_order_offer', rejectParams);
    const rejectedAgain = await ctx.http.call(rider1, 'reject_rider_order_offer', rejectParams);
    let truth = await ctx.orders.truth(O);
    C(P, 'RIDER_REJECTS_THE_OFFER_AND_THE_ORDER_STAYS_READY', rejected.status === 200 && rejected.data?.ok === true && rejected.data?.code === 'rejected' && truth.order_row.status === 'ready'
      && truth.order_row.assigned_rider_user_id === null && ctx.orders.countEvents(truth.events, 'order.rider_rejected_offer') === 1,
    { answer: result(rejected), status: truth.order_row.status, events: ctx.orders.countEvents(truth.events, 'order.rider_rejected_offer') });
    C(P, 'REJECT_REPLAY_IS_A_NO_OP', rejectedAgain.status === 200 && rejectedAgain.data?.idempotent_no_op === true
      && ctx.orders.countEvents((await ctx.orders.truth(O)).events, 'order.rider_rejected_offer') === 1, result(rejectedAgain));
    const tooLate = await accept(rider1, first.data || {});
    C(P, 'A_REJECTED_OFFER_CANNOT_BE_ACCEPTED_AFTERWARDS', !(tooLate.ok && tooLate.data?.ok === true) && (await ctx.orders.state(O)).status === 'ready', result(tooLate));

    // ── 3. El comercio retira una oferta: ya no se puede aceptar ──────────────
    const second = await ctx.orders.offer(staff, O, rider2.userId);
    const byRider = await ctx.http.call(rider2, 'withdraw_rider_order_offer', { p_offer_id: second.data?.offer_id });
    const withdrawn = await ctx.http.call(staff, 'withdraw_rider_order_offer', { p_offer_id: second.data?.offer_id });
    const afterWithdraw = await accept(rider2, second.data || {});
    const stateAfterWithdraw = await ctx.orders.state(O);
    C(P, 'ONLY_THE_BUSINESS_WITHDRAWS_AN_OFFER', refused(byRider, CODES.FORBIDDEN) && withdrawn.status === 200 && withdrawn.data?.ok === true && withdrawn.data?.code === 'withdrawn',
      { rider: brief(byRider), staff: result(withdrawn) }, `${refusal(CODES.FORBIDDEN)} para el repartidor; el comercio la retira`);
    C(P, 'A_WITHDRAWN_OFFER_CANNOT_BE_ACCEPTED', second.data?.code === 'offered' && !(afterWithdraw.ok && afterWithdraw.data?.ok === true) && stateAfterWithdraw.status === 'ready'
      && stateAfterWithdraw.assigned_rider_user_id === null, { offer: result(second), accept: result(afterWithdraw), order: stateAfterWithdraw.status });

    // ── 4. Quien rechazó no vuelve a recibir el mismo pedido; el otro lo acepta ──
    // El rechazo es definitivo para ESE repartidor y ESE pedido: el comercio no se lo puede volver a ofrecer.
    // La oferta retirada, en cambio, no marca al repartidor: se le puede ofrecer de nuevo.
    const again = await ctx.orders.offer(staff, O, rider1.userId);
    C(P, 'A_RIDER_WHO_REJECTED_IS_NOT_OFFERED_THE_SAME_ORDER_AGAIN', declined(again, 'already_rejected_by_rider') && (await ctx.orders.state(O)).status === 'ready',
      result(again), 'HTTP 200 · ok false · already_rejected_by_rider');
    // Desde acá el pedido es del repartidor 2 (al que se le retiró la oferta) y el repartidor 1 es el que no está asignado.
    const assigned = rider2;
    const otherRider = rider1;
    const third = await ctx.orders.offer(staff, O, assigned.userId);
    const accepted = await accept(assigned, third.data || {});
    let state = await ctx.orders.state(O);
    C(P, 'RIDER_ACCEPTS_A_NEW_OFFER_AND_IS_ASSIGNED', third.data?.code === 'offered' && accepted.status === 200 && accepted.data?.ok === true && state.status === 'assigned'
      && state.assigned_rider_user_id === assigned.userId, { offer: result(third), accept: result(accepted), status: state.status });
    if (state.status !== 'assigned') { ctx.evidence.write('phase-rider.json', { log, stoppedAt: 'assignment' }); return; }
    const seenByAssigned = await ctx.http.restGet(assigned, `orders?select=id,status&id=eq.${O}`);
    const seenByOther = await ctx.http.restGet(otherRider, `orders?select=id,status&id=eq.${O}`);
    C(P, 'ONLY_THE_ASSIGNED_RIDER_SEES_THE_ORDER', seenByAssigned.status === 200 && seenByAssigned.rows?.length === 1 && seenByOther.status === 200 && seenByOther.rows?.length === 0,
      { assigned: { ...brief(seenByAssigned), rows: seenByAssigned.rows?.length }, other: { ...brief(seenByOther), rows: seenByOther.rows?.length } });
    const intruder = {};
    for (const fn of ['mark_delivery_picked_up', 'start_rider_delivery', 'mark_rider_arrived']) {
      intruder[fn] = await ctx.http.call(otherRider, fn, { p_order_id: O, p_expected_revision: Number(state.revision), p_idempotency_key: `android-${shortId(32)}` });
    }
    C(P, 'A_RIDER_WHO_IS_NOT_ASSIGNED_CANNOT_MOVE_THE_ORDER', Object.values(intruder).every((r) => declined(r, 'not_assigned')) && (await ctx.orders.state(O)).status === 'assigned',
      Object.fromEntries(Object.entries(intruder).map(([fn, r]) => [fn, result(r)])), 'HTTP 200 · ok false · not_assigned en los tres pasos, y el pedido sigue asignado');
    if (ctx.caps.business_self_delivery) {
      const overRider = await ctx.http.call(staff, 'confirm_business_delivery_code', { p_order_id: O, p_expected_revision: Number(state.revision), p_delivery_code: '0000',
        p_idempotency_key: `ecomcert-self-${shortId(8)}` });
      C(P, SELF_DELIVERY_CHECKS[0], refused(overRider, CODES.FORBIDDEN, { message: 'repartidor asignado' }) && (await ctx.orders.state(O)).status === 'assigned', brief(overRider),
        refusal(CODES.FORBIDDEN, { message: 'repartidor asignado' }));
    }

    // ── 5. Retiro, en camino, llegó ───────────────────────────────────────────
    const stale = await ctx.http.call(assigned, 'mark_delivery_picked_up', { p_order_id: O, p_expected_revision: Number(state.revision) - 1, p_idempotency_key: `android-${shortId(32)}` });
    C(P, 'PICK_UP_WITH_A_STALE_REVISION_IS_DECLINED', declined(stale, 'stale_revision') && (await ctx.orders.state(O)).status === 'assigned', result(stale), 'HTTP 200 · ok false · stale_revision');
    const tooEarly = await ctx.orders.riderStep(assigned, 'mark_rider_arrived', O);
    C(P, 'ARRIVING_BEFORE_PICKING_UP_IS_DECLINED', tooEarly.r.status === 200 && tooEarly.r.data?.ok === false && tooEarly.after.status === 'assigned', result(tooEarly.r));
    const steps = {};
    for (const [fn, status] of [['mark_delivery_picked_up', 'picked_up'], ['start_rider_delivery', 'on_the_way'], ['mark_rider_arrived', 'arrived']]) {
      const step = await ctx.orders.riderStep(assigned, fn, O);
      steps[fn] = { ...result(step.r), status: step.after.status, expected: status };
      if (fn === 'start_rider_delivery') {
        await ctx.http.call(assigned, 'publish_rider_location_fanout', { p_lat: -38.9488, p_lng: -68.0562, p_accuracy: 12, p_heading: 210, p_speed: 6,
          p_captured_at: nowIso(), p_idempotency_key: randomUUID(), p_is_mock: false });
      }
    }
    C(P, 'RIDER_PICKS_UP_STARTS_AND_ARRIVES', Object.values(steps).every((s) => s.ok === true && s.status === s.expected), steps);
    state = await ctx.orders.state(O);

    // ── 6. El código de entrega ───────────────────────────────────────────────
    const byOther = await ctx.http.call(other, 'issue_order_delivery_code', { p_order_id: O, p_tracking_token: created.token });
    C(P, 'ANOTHER_CUSTOMER_CANNOT_OBTAIN_THE_DELIVERY_CODE', refused(byOther, CODES.FORBIDDEN), brief(byOther), refusal(CODES.FORBIDDEN));
    const issued = await ctx.http.call(customer, 'issue_order_delivery_code', { p_order_id: O, p_tracking_token: created.token });
    const code = ctx.redactor.secret(String(issued.data?.delivery_code || ''));
    C(P, 'CUSTOMER_OBTAINS_THE_DELIVERY_CODE', issued.status === 200 && /^[0-9]{4}$/.test(code), brief(issued));
    const wrong = await ctx.orders.riderStep(assigned, 'confirm_delivery_code', O, { code: wrongCodeOf(code) });
    const wrongAgain = await ctx.http.call(assigned, 'confirm_delivery_code', wrong.params);
    let seen = await handoff(O);
    C(P, 'WRONG_CODE_DOES_NOT_DELIVER', declined(wrong.r, 'incorrect_code') && wrong.after.status === 'arrived' && wrong.r.data?.remaining_attempts === 4,
      { ...result(wrong.r), remaining: wrong.r.data?.remaining_attempts ?? null, status: wrong.after.status });
    C(P, 'WRONG_CODE_RESENT_WITH_THE_SAME_KEY_COUNTS_ONE_ATTEMPT', wrongAgain.status === 200 && wrongAgain.data?.code === 'incorrect_code' && wrongAgain.data?.idempotent_no_op === true
      && seen?.failed_attempts === 1, { replay: result(wrongAgain), no_op: wrongAgain.data?.idempotent_no_op ?? null, failedAttempts: seen?.failed_attempts ?? null, attempts: seen?.attempts },
    'el reenvío devuelve el mismo resultado y el contador de intentos fallidos queda en 1');
    const byOtherRider = await ctx.http.call(otherRider, 'confirm_delivery_code', { p_order_id: O, p_expected_revision: Number(state.revision), p_delivery_code: code,
      p_idempotency_key: `android-${shortId(32)}` });
    C(P, 'THE_RIGHT_CODE_FROM_ANOTHER_RIDER_DOES_NOT_DELIVER', declined(byOtherRider, 'not_assigned') && (await ctx.orders.state(O)).status === 'arrived', result(byOtherRider),
      'HTTP 200 · ok false · not_assigned');
    const confirmed = await ctx.orders.riderStep(assigned, 'confirm_delivery_code', O, { code });
    seen = await handoff(O);
    truth = await ctx.orders.truth(O);
    C(P, 'RIGHT_CODE_DELIVERS_AND_THE_HANDOFF_NAMES_THE_RIDER', confirmed.r.status === 200 && confirmed.r.data?.ok === true && confirmed.after.status === 'delivered' && seen?.confirmed === true
      && seen.confirmed_by_user_id === assigned.userId && Boolean(truth.order_row.delivered_at), { ...result(confirmed.r), status: confirmed.after.status, handoff: seen });
    const afterDelivery = await ctx.http.restGet(assigned, `orders?select=id&id=eq.${O}`);
    C(P, 'RIDER_LOSES_THE_ORDER_ONCE_DELIVERED', afterDelivery.status === 200 && afterDelivery.rows?.length === 0 && truth.rider_locations === 0,
      { rows: afterDelivery.rows?.length ?? null, gpsRows: truth.rider_locations });
    log.push({ order: created.order.public_code, chain: ctx.orders.statusChain(truth.events), steps });

    // ── 7. Envío propio del comercio ──────────────────────────────────────────
    if (!ctx.caps.business_self_delivery) {
      for (const name of SELF_DELIVERY_CHECKS) ctx.rec.skipCheck(P, name, 'business_self_delivery');
    } else {
      const own = await ctx.orders.create(customer, { mode: 'delivery', role: 'MAIN', quantity: 2, payment: 'cash', label: 'rider-business-own' });
      const B = own.order?.id;
      const prepared = B ? await ctx.orders.advance(staff, B, 'ready') : { ok: false, steps: [brief(own.r)] };
      const dispatched = prepared.ok ? await ctx.orders.transition(staff, B, 'on_the_way', Number(prepared.state.revision)) : { ok: false };
      let own0 = B ? await ctx.orders.state(B) : null;
      C(P, SELF_DELIVERY_CHECKS[1], Boolean(B) && dispatched.ok && own0.status === 'on_the_way' && own0.assigned_rider_user_id === null, { prepare: prepared.steps, dispatch: brief(dispatched), status: own0?.status });
      if (B && own0.status === 'on_the_way') {
        const ownIssued = await ctx.http.call(customer, 'issue_order_delivery_code', { p_order_id: B, p_tracking_token: own.token });
        const ownCode = ctx.redactor.secret(String(ownIssued.data?.delivery_code || ''));
        const close = (typed, key, revision = Number(own0.revision)) => ctx.http.call(staff, 'confirm_business_delivery_code', { p_order_id: B, p_expected_revision: revision,
          p_delivery_code: typed, p_idempotency_key: key });
        const byRider = await ctx.http.call(rider1, 'confirm_delivery_code', { p_order_id: B, p_expected_revision: Number(own0.revision), p_delivery_code: ownCode,
          p_idempotency_key: `android-${shortId(32)}` });
        C(P, SELF_DELIVERY_CHECKS[2], declined(byRider, 'not_assigned') && (await ctx.orders.state(B)).status === 'on_the_way', result(byRider), 'HTTP 200 · ok false · not_assigned');
        const typoKey = `ecomcert-self-typo-${shortId(6)}`;
        const typo = await close(wrongCodeOf(ownCode), typoKey);
        const afterTypo = await handoff(B);
        C(P, SELF_DELIVERY_CHECKS[3], declined(typo, 'incorrect_code') && typo.data?.remaining_attempts === 4 && (await ctx.orders.state(B)).status === 'on_the_way' && afterTypo?.failed_attempts === 1,
          { ...result(typo), remaining: typo.data?.remaining_attempts ?? null, failedAttempts: afterTypo?.failed_attempts ?? null });
        // El mismo envío otra vez (la misma clave, el mismo código): es UN intento lógico. Lo que no puede
        // pasar es que un reintento de red le gaste al cliente los cinco intentos de su código.
        const typoAgain = await close(wrongCodeOf(ownCode), typoKey);
        const afterTypoAgain = await handoff(B);
        C(P, SELF_DELIVERY_CHECKS[4], typoAgain.status === 200 && typoAgain.data?.code === 'incorrect_code' && afterTypoAgain?.failed_attempts === 1,
          { replay: result(typoAgain), remaining: typoAgain.data?.remaining_attempts ?? null, failedAttempts: afterTypoAgain?.failed_attempts ?? null, attempts: afterTypoAgain?.attempts },
          'el reenvío con la misma clave no suma un intento fallido: el contador queda en 1');
        own0 = await ctx.orders.state(B);
        const staleClose = await close(ownCode, `ecomcert-self-stale-${shortId(6)}`, Number(own0.revision) - 1);
        C(P, SELF_DELIVERY_CHECKS[5], refused(staleClose, CODES.STALE_REVISION) && (await ctx.orders.state(B)).status === 'on_the_way', brief(staleClose), refusal(CODES.STALE_REVISION));
        const closeKey = `ecomcert-self-close-${shortId(6)}`;
        const closed = await close(ownCode, closeKey);
        const closedTruth = await ctx.orders.truth(B);
        const closedHandoff = await handoff(B);
        C(P, SELF_DELIVERY_CHECKS[6], closed.status === 200 && closed.data?.ok === true && closed.data?.outcome === 'confirmed' && closed.data?.code_verified === true
          && closedTruth.order_row.status === 'delivered' && closedHandoff?.confirmed === true && closedHandoff.confirmed_by_user_id === staff.userId
          && ctx.orders.countEvents(closedTruth.events, 'order.business_self_delivery') === 1,
        { ...result(closed), verified: closed.data?.code_verified ?? null, status: closedTruth.order_row.status, handoff: closedHandoff,
          selfDeliveryEvents: ctx.orders.countEvents(closedTruth.events, 'order.business_self_delivery') });
        const replay = await close(ownCode, closeKey);
        const afterReplay = await ctx.orders.truth(B);
        C(P, SELF_DELIVERY_CHECKS[7], replay.status === 200 && replay.data?.idempotent_replay === true && Number(afterReplay.order_row.revision) === Number(closedTruth.order_row.revision)
          && ctx.orders.countEvents(afterReplay.events, 'order.business_self_delivery') === 1, { ...result(replay), replay: replay.data?.idempotent_replay ?? null });
        log.push({ order: own.order.public_code, chain: ctx.orders.statusChain(closedTruth.events) });
      } else {
        for (const name of SELF_DELIVERY_CHECKS.slice(2)) C(P, name, false, { setup: 'el pedido no llegó a «en camino» por el envío propio', dispatch: brief(dispatched) });
      }
    }

    const s1 = (await ctx.orders.fixtures()).MAIN.stock;
    const delivered = 2 + (ctx.caps.business_self_delivery ? 2 : 0);
    C(P, 'STOCK_LEFT_ONCE_PER_DELIVERED_ORDER', s1 === s0 - delivered, { initial: s0, final: s1 }, { final: s0 - delivered });
    ctx.evidence.write('phase-rider.json', { log });
  },
};
