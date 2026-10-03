// FASE trace — la traza de un pedido, por CADA referencia con la que alguien pregunta.
//
// Soporte tiene que poder llegar a un pedido con lo que tenga a mano: el código que ve el
// cliente, la clave de la solicitud, el id del checkout, el id del pago que muestra
// Mercado Pago, la referencia externa, la preferencia… `get_order_trace(negocio,
// referencia)` resuelve todas. Acá se arma un pedido en efectivo y uno pagado, se le
// pregunta con cada una de sus referencias y se afirma que todas llegan al MISMO pedido
// y dicen por cuál criterio lo encontraron.
//
// La traza es para leer en una pantalla de soporte: no lleva un dato de la persona (ni
// nombre, ni teléfono, ni domicilio, ni el token de seguimiento, ni el código de
// entrega). Y es del comercio: un cliente, un repartidor o el dueño de otro negocio no
// la obtienen.
import { nowIso, shortId, sqlUuid } from '../env.mjs';
import { CODES, brief, refusal, refused } from '../http.mjs';
import { piiLeaks } from '../orders.mjs';
import { ensureSecondBusiness } from '../tenant.mjs';

const P = 'trace';
// Cada referencia de un pedido y el criterio (`resolved_by`) con el que la traza dice haberlo encontrado.
const MANUAL_KINDS = Object.freeze({ order_id: 'order_id', public_code: 'public_code', client_request_id: 'order_client_request_id', tracking_token_id: 'tracking_token_id',
  correlation_id: 'correlation_id' });
const PAID_KINDS = Object.freeze({ order_id: 'order_id', public_code: 'public_code', client_request_id: 'order_client_request_id', tracking_token_id: 'tracking_token_id',
  correlation_id: 'correlation_id', checkout_session_id: 'checkout_session_id', payment_intent_id: 'payment_intent_id', payment_attempt_id: 'payment_attempt_id',
  checkout_client_request_id: 'checkout_client_request_id', provider_payment_id: 'provider_payment_id', external_reference: 'external_reference',
  preference_id: 'preference_id', merchant_order_id: 'merchant_order_id' });
const PAID_CHECKS = Object.freeze(['PAID_ORDER_IS_FOUND_BY_EVERY_REFERENCE', 'PAID_ORDER_TRACE_TELLS_THE_WHOLE_CHAIN', 'PAID_ORDER_TRACE_CARRIES_NO_PERSONAL_DATA']);
// Claves del documento que se parecen a un dato personal y no lo son: la lista de ids de los tokens de seguimiento (nunca el token).
const NOT_PERSONAL = Object.freeze(['tracking_tokens']);

export default {
  id: P,
  title: 'traza de un pedido: cada tipo de referencia, sin datos personales, sólo para el equipo del comercio',
  requires: ['order_trace'],
  async run(ctx) {
    const C = ctx.rec.check;
    const A = ctx.tenant.id;
    const { owner, staff, rider1 } = ctx.actors;
    const trace = (actor, reference, businessId = A) => ctx.http.call(actor, 'get_order_trace', { p_business_id: businessId, p_reference: reference });
    const stagesOf = (document) => [...new Set((document?.timeline || []).map((entry) => entry.stage))];
    const eventsOf = (document) => (document?.timeline || []).map((entry) => entry.event);
    const gapsOf = (document) => (document?.gaps || []).map((gap) => gap.code);
    const evidence = { manual: null, paid: null };
    // Pregunta por cada referencia del pedido y junta lo que no llegó a él.
    const askEvery = async (references, kinds, orderId) => {
      const answers = {};
      for (const [name, expectedKind] of Object.entries(kinds)) {
        const reference = references[name];
        if (!reference) { answers[name] = { missingReference: true }; continue; }
        const r = await trace(staff, String(reference));
        answers[name] = { http: r.status, found: r.data?.found ?? null, resolvedBy: r.data?.resolved_by ?? null, expectedKind, order: r.data?.identifiers?.order_id ?? null,
          ok: r.status === 200 && r.data?.found === true && r.data.resolved_by === expectedKind && r.data.identifiers?.order_id === orderId };
      }
      return answers;
    };
    const wrongOnes = (answers) => Object.fromEntries(Object.entries(answers).filter(([, a]) => !a.ok));

    // ── 1. Un pedido en efectivo, con algo de historia ────────────────────────
    const customer = await ctx.identities.customer('trace');
    const created = await ctx.orders.create(customer, { mode: 'delivery', role: 'MAIN', quantity: 2, label: 'trace-manual' });
    C(P, 'ORDER_CREATED_FOR_THE_TRACE', Boolean(created.order), brief(created.r));
    if (!created.order) return;
    const O = created.order.id;
    await ctx.orders.advance(staff, O, 'accepted');
    const issued = await ctx.http.call(customer, 'issue_order_delivery_code', { p_order_id: O, p_tracking_token: created.token });
    const deliveryCode = ctx.redactor.secret(String(issued.data?.delivery_code || ''));
    const references = await ctx.orders.references(O);
    const manual = await askEvery(references, MANUAL_KINDS, O);
    C(P, 'MANUAL_ORDER_IS_FOUND_BY_EVERY_REFERENCE', Object.values(manual).every((a) => a.ok), Object.keys(wrongOnes(manual)).length ? wrongOnes(manual) : { references: Object.keys(manual) },
      'cinco referencias, todas resuelven el mismo pedido y dicen por cuál criterio');
    const lowercase = await trace(staff, String(references.public_code).toLowerCase());
    C(P, 'PUBLIC_CODE_IS_FOUND_IN_ANY_CASE', lowercase.data?.found === true && lowercase.data.identifiers?.order_id === O, { found: lowercase.data?.found ?? null, resolvedBy: lowercase.data?.resolved_by ?? null });
    const document = (await trace(staff, O)).data;
    evidence.manual = { order: created.order.public_code, resolvedBy: Object.fromEntries(Object.entries(manual).map(([k, a]) => [k, a.resolvedBy])), stages: stagesOf(document), gaps: gapsOf(document),
      timelineRows: document?.timeline_rows ?? null };
    C(P, 'MANUAL_ORDER_TRACE_TELLS_THE_WHOLE_CHAIN', document?.found === true && document.identifiers?.public_code === created.order.public_code
      && document.state?.order?.status === 'accepted' && document.state?.payment?.method === 'cash' && document.state?.stock?.order_units === 2
      && ['order.created', 'stock.order_item_committed', 'tracking.token_issued', 'intake.admitted', 'order.status_changed', 'handoff.code_issued'].every((event) => eventsOf(document).includes(event))
      && gapsOf(document).includes('checkout_not_applicable') && document.truncated === false,
    { status: document?.state?.order?.status ?? null, payment: document?.state?.payment?.method ?? null, units: document?.state?.stock?.order_units ?? null,
      events: [...new Set(eventsOf(document))], gaps: gapsOf(document) }, 'el pedido, su stock, su token, su admisión, su cambio de estado y su código emitido, en una sola línea de tiempo');
    const leaks = piiLeaks(document, [customer], { allowKeys: NOT_PERSONAL });
    const text = JSON.stringify(document || {});
    C(P, 'MANUAL_ORDER_TRACE_CARRIES_NO_PERSONAL_DATA', leaks.length === 0 && !text.includes(created.token) && (deliveryCode.length !== 4 || !new RegExp(`"${deliveryCode}"`).test(text)),
      { leaks, hasTrackingToken: text.includes(created.token), bytes: text.length }, 'ni nombre, ni teléfono, ni domicilio, ni el token de seguimiento, ni el código de entrega');

    // ── 2. Quién puede pedirla ────────────────────────────────────────────────
    const second = await ensureSecondBusiness(ctx, { withOrder: false });
    const asked = {
      customer: await trace(customer, O),
      rider: await trace(rider1, O),
      foreign_owner: await trace(second.owner, O),
      without_a_business: await ctx.http.call(staff, 'get_order_trace', { p_business_id: null, p_reference: O }),
    };
    const anonymous = await trace(null, O);
    C(P, 'ONLY_THE_TEAM_OF_THE_BUSINESS_GETS_THE_TRACE', Object.values(asked).every((r) => refused(r, CODES.FORBIDDEN, { message: 'operador no autorizado' }))
      && refused(anonymous, CODES.FORBIDDEN, { actor: null }), { ...Object.fromEntries(Object.entries(asked).map(([k, r]) => [k, brief(r)])), anonymous: brief(anonymous) },
    `${refusal(CODES.FORBIDDEN, { message: 'operador no autorizado' })} para cliente, repartidor, dueño de otro negocio y negocio nulo; ${refusal(CODES.FORBIDDEN, { actor: null })} sin sesión`);
    const byOwner = await trace(owner, O);
    C(P, 'OWNER_AND_STAFF_GET_THE_SAME_TRACE', byOwner.status === 200 && byOwner.data?.found === true && byOwner.data.identifiers?.order_id === O, { http: byOwner.status, found: byOwner.data?.found ?? null });

    // ── 3. Lo que no existe ───────────────────────────────────────────────────
    const nothing = { random_uuid: await trace(staff, ctx.guard.decoy()), unknown_text: await trace(staff, `no-existe-${shortId(6)}`), empty: await trace(staff, ''),
      overlong: await trace(staff, 'x'.repeat(201)) };
    C(P, 'UNKNOWN_REFERENCES_ARE_ANSWERED_NOT_FOUND', Object.values(nothing).every((r) => r.status === 200 && r.data?.found === false && r.data.reason === 'not_found'),
      Object.fromEntries(Object.entries(nothing).map(([k, r]) => [k, { http: r.status, found: r.data?.found ?? null, reason: r.data?.reason ?? null }])), 'HTTP 200 · found false · not_found');

    // ── 4. Un pedido pagado: la cadena checkout → pago → pedido ───────────────
    if (!ctx.caps.checkout_payments) {
      for (const name of PAID_CHECKS) ctx.rec.skipCheck(P, name, 'checkout_payments');
    } else {
      await ctx.payments.ensureFixture();
      const [payer] = await ctx.identities.payers(1);
      const paid = await ctx.payments.paidOrder(payer, { role: 'MAIN', quantity: 1, label: 'trace-paid' });
      if (!paid.ok) {
        for (const name of PAID_CHECKS) C(P, name, false, { setup: paid.step, answer: brief(paid.r) });
      } else {
        const paidReferences = await ctx.orders.references(paid.session.orderId);
        const answers = await askEvery(paidReferences, PAID_KINDS, paid.session.orderId);
        C(P, PAID_CHECKS[0], Object.values(answers).every((a) => a.ok), Object.keys(wrongOnes(answers)).length ? wrongOnes(answers) : { references: Object.keys(answers) },
          'trece referencias (las del pedido, las del checkout, las del pago y las del proveedor), todas resuelven el mismo pedido');
        const paidDocument = (await trace(staff, paid.session.orderId)).data;
        const expected = ['checkout.session_created', 'stock.reserved', 'stock.reservation_converted', 'payment.intent_created', 'payment.approved', 'order.created'];
        evidence.paid = { resolvedBy: Object.fromEntries(Object.entries(answers).map(([k, a]) => [k, a.resolvedBy])), stages: stagesOf(paidDocument), gaps: gapsOf(paidDocument) };
        C(P, PAID_CHECKS[1], paidDocument?.found === true && paidDocument.state?.payment?.state === 'completed' && paidDocument.state?.checkout?.status === 'completed'
          && Number(paidDocument.state?.payment?.paid_amount) === paid.session.total && paidDocument.state?.stock?.reservations?.converted === 1
          && expected.every((event) => eventsOf(paidDocument).includes(event)) && !gapsOf(paidDocument).includes('payment_approved_without_order')
          && paidDocument.identifiers?.checkout_session_id === paid.session.id && paidDocument.identifiers?.payment_intent_id === paid.session.intentId,
        { payment: paidDocument?.state?.payment?.state ?? null, checkout: paidDocument?.state?.checkout?.status ?? null, reservations: paidDocument?.state?.stock?.reservations ?? null,
          missingEvents: expected.filter((event) => !eventsOf(paidDocument).includes(event)), gaps: gapsOf(paidDocument) });
        const paidLeaks = piiLeaks(paidDocument, [payer], { allowKeys: NOT_PERSONAL });
        C(P, PAID_CHECKS[2], paidLeaks.length === 0, { leaks: paidLeaks, bytes: JSON.stringify(paidDocument || {}).length });
      }
    }

    // ── 5. Un aviso del proveedor que ningún cobro registra ───────────────────
    // «Mercado Pago dice que cobró y acá no hay nada»: la traza lo encuentra por el id de pago del aviso. El aviso
    // se asienta por la RPC que usa la función de webhooks, con un tema que no encola nada (no hay a quién consultar).
    const withoutReceipts = ctx.env.target.lacks('webhook_receipts');
    if (!ctx.caps.checkout_payments) ctx.rec.skipCheck(P, 'PROVIDER_NOTICE_WITHOUT_A_PAYMENT_IS_FOUND_BY_ITS_RESOURCE_ID', 'checkout_payments');
    else if (withoutReceipts) ctx.rec.skipOnTarget(P, 'PROVIDER_NOTICE_WITHOUT_A_PAYMENT_IS_FOUND_BY_ITS_RESOURCE_ID', withoutReceipts);
    else {
      await ctx.payments.ensureFixture();
      const resource = `ECOMCERT-ORPHAN-${ctx.runTag}-${shortId(3)}`;
      const receipt = await ctx.edgeRpc('mp_record_seller_webhook', { p_environment: 'test', p_webhook_event_id: `ecomcert-evt-${shortId(6)}`, p_event_type: 'merchant_order',
        p_resource_id: resource, p_signature_valid: true, p_request_id: `ecomcert-req-${shortId(6)}`, p_payload_hash: 'a'.repeat(64), p_business_id: A });
      ctx.ledger.tenantChanges.push({ kind: 'webhook_receipt_recorded', resource, at: nowIso() }); ctx.persist();
      const orphan = await trace(staff, resource);
      const jobs = receipt.data?.receipt_id ? (await ctx.env.observe(`select count(*)::int as n from public.payment_outbox where webhook_receipt_id = ${sqlUuid(receipt.data.receipt_id)}`))[0].n : null;
      C(P, 'PROVIDER_NOTICE_WITHOUT_A_PAYMENT_IS_FOUND_BY_ITS_RESOURCE_ID', receipt.status === 200 && receipt.data?.queued === false && jobs === 0 && orphan.status === 200
        && orphan.data?.found === true && orphan.data.resolved_by === 'webhook_resource_id' && gapsOf(orphan.data).includes('payment_not_linked_to_checkout')
        && eventsOf(orphan.data).includes('webhook.received'),
      { receipt: { ...brief(receipt), queued: receipt.data?.queued ?? null, outboxJobs: jobs }, found: orphan.data?.found ?? null, resolvedBy: orphan.data?.resolved_by ?? null, gaps: gapsOf(orphan.data) },
      'la traza lo resuelve por `webhook_resource_id` y dice que ese pago no está unido a ningún checkout');
    }

    ctx.evidence.write('phase-trace.json', evidence);
  },
};
