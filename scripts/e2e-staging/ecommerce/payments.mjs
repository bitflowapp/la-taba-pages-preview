// CERTIFICACIÓN E-COMMERCE — el cobro por Mercado Pago, en el borde de la base.
//
// Acá NO se llama a Mercado Pago, nunca. Se hace lo que hacen las Edge Functions de
// pago DESPUÉS de hablar con el proveedor: las mismas RPC, en el mismo orden y con la
// misma clave de servicio, con lo que el proveedor habría contestado puesto a mano.
//
//   mercadopago-create-checkout-session   create_checkout_session            (reserva stock)
//   mercadopago-create-preference         prepare_mercadopago_preference_v2
//                                         get_mercadopago_payment_authority_v2
//                                         record_mercadopago_preference_created_v2
//   mercadopago-payment-worker            record_mercadopago_payment_snapshot (lo que dice el proveedor del pago)
//                                         finalize_paid_checkout_session      (el pedido; la reserva se convierte)
//   mercadopago-refund                    prepare_payment_refund_v2           (con la sesión del dueño)
//                                         record_payment_refund_identity
//                                         record_payment_refund_response_v2
//
// Todo identificador «del proveedor» (preferencia, pago, orden, reembolso) es inventado
// por esta herramienta y lleva su prefijo. Lo que se certifica es la mitad de la base:
// que el dinero y el stock cierran sea cual sea el orden en que lleguen las respuestas.
//
// EL COMERCIO «COBRA» CON UN VENDEDOR DE UTILERÍA. Para que la base deje crear una
// sesión, el tenant necesita `business_payment_settings` habilitado y una conexión de
// vendedor: se cargan con `service_role` (aprovisionamiento, anotado), en ambiente
// `test`, con un cobrador y una aplicación que no existen y sin credenciales (el campo
// de tokens lleva un texto fijo que no descifra nada). Al terminar quedan apagados.
import { createHash, randomUUID } from 'node:crypto';
import { TENANT, nowIso, shortId, sqlText, sqlUuid } from './env.mjs';
import { OPEN_SESSION_SQL } from './tenant.mjs';
import { brief, pool } from './http.mjs';

const sha256 = (value) => createHash('sha256').update(String(value)).digest('hex');
const ENVIRONMENT = 'test';
const SESSION_MINUTES = 10;
// No es una credencial ni lo parece: es el texto que ocupa el lugar del material cifrado del vendedor.
const NO_CREDENTIALS = 'certification-fixture-without-credentials';

export function createPayments(ctx) {
  const id = ctx.tenant.id;
  const tag = id.slice(0, 8);
  const fixture = Object.freeze({ collector: `ecomcert-collector-${tag}`, application: `ecomcert-application-${tag}`, environment: ENVIRONMENT });
  let fixtureReady = false;
  let sequence = 0;
  const next = () => { sequence += 1; return `${ctx.runTag}-${shortId(3)}-${sequence}`; };
  // Toda llamada con la clave de servicio de este archivo es una que en producción hace una Edge Function:
  // `ctx.edgeRpc` la deja contada en el ledger (por fase y por función) y la manda por el transporte propio.
  const service = (fn, params, options) => ctx.edgeRpc(fn, params, options);

  // ── El vendedor de utilería ────────────────────────────────────────────────
  async function ensureFixture() {
    if (fixtureReady) return fixture;
    ctx.guard.assertWrite(id);
    await ctx.serviceRole('provision', 'upsert business_payment_settings + mp_seller_connections (certification seller: test environment, no credentials)', async (admin) => {
      const settings = await admin.from('business_payment_settings').upsert({ business_id: id, provider: 'mercadopago', enabled: true, environment: ENVIRONMENT,
        checkout_mode: 'checkout_pro', currency: TENANT.currency, reserve_stock: true, collector_id: fixture.collector, application_id: fixture.application,
        preference_expiration_minutes: SESSION_MINUTES, configured_at: nowIso(), verified_at: nowIso() }, { onConflict: 'business_id,provider' }).select('business_id');
      if (settings.error) throw Error(`PAYMENT_SETTINGS_FIXTURE:${settings.error.code}:${String(settings.error.message).slice(0, 120)}`);
      const seller = await admin.from('mp_seller_connections').upsert({ business_id: id, environment: ENVIRONMENT, seller_id: fixture.collector,
        application_id: fixture.application, status: 'connected', protected_tokens: NO_CREDENTIALS, connected_at: nowIso(),
        expires_at: new Date(Date.now() + 30 * 86_400_000).toISOString() }, { onConflict: 'business_id,environment' }).select('business_id');
      if (seller.error) throw Error(`SELLER_CONNECTION_FIXTURE:${seller.error.code}:${String(seller.error.message).slice(0, 120)}`);
    });
    ctx.ledger.tenantChanges.push({ kind: 'payment_fixture_enabled', collector: fixture.collector, at: nowIso() });
    ctx.persist();
    fixtureReady = true;
    return fixture;
  }

  // En reposo el tenant no cobra: el cobro queda apagado y el vendedor desconectado y sin material.
  async function disableFixture() {
    const row = (await ctx.env.observe(`select s.enabled, (select c.status from public.mp_seller_connections c where c.business_id = s.business_id and c.environment = s.environment) as seller
      from public.business_payment_settings s where s.business_id = ${sqlUuid(id)}`))[0];
    if (!row) return null;
    if (row.enabled === false && row.seller !== 'connected') { fixtureReady = false; return { ok: true, detail: 'already off' }; }
    ctx.guard.assertWrite(id);
    const out = await ctx.serviceRole('cleanup', 'update business_payment_settings + mp_seller_connections (certification seller switched off)', async (admin) => {
      const settings = await admin.from('business_payment_settings').update({ enabled: false }).eq('business_id', id).eq('provider', 'mercadopago').select('business_id');
      const seller = await admin.from('mp_seller_connections').update({ status: 'disconnected', protected_tokens: null }).eq('business_id', id).eq('environment', ENVIRONMENT).select('business_id');
      return { settings: settings.error?.code || null, seller: seller.error?.code || null };
    });
    fixtureReady = false;
    return { ok: !out.settings && !out.seller, detail: out };
  }

  // ── Lo que hace cada Edge Function ─────────────────────────────────────────
  const sessionPayload = (payer, { items, role = 'MAIN', quantity = 1, key, label = 'checkout', extra = {} }) => ({
    business_id: id, client_request_id: key || `${TENANT.requestPrefix}co-${String(label).replace(/[^A-Za-z0-9_-]/g, '-').slice(0, 24)}-${next()}`,
    items: items || [{ product_id: ctx.orders.product(role).id, quantity }], fulfillment_type: 'pickup',
    contact: { name: payer.name, phone: payer.phone }, address: {}, age_confirmed: false, payment_method: 'mercadopago', ...extra });

  // mercadopago-create-checkout-session: la sesión, con el stock ya reservado.
  async function createSession(payer, options = {}) {
    const payload = options.payload || sessionPayload(payer, options);
    const entry = { label: options.label || 'checkout', clientRequestId: payload.client_request_id, sessionId: null, at: nowIso() };
    if (!options.quiet) { ctx.ledger.checkouts.push(entry); ctx.persist(); }
    const r = await service('create_checkout_session', { p_customer_id: payer.userId, p_payload: payload });
    const session = r.ok && r.data?.checkout_session_id ? { id: r.data.checkout_session_id, intentId: r.data.payment_intent_id, total: Number(r.data.total),
      status: r.data.status, expiresAt: r.data.expires_at, payer, payload, ref: next() } : null;
    if (session && !options.quiet) { entry.sessionId = session.id; ctx.persist(); }
    return { r, session, payload };
  }

  // mercadopago-create-preference, paso 1: el intento de preferencia.
  const prepare = (session, { newAttempt = false } = {}) => service('prepare_mercadopago_preference_v2',
    { p_checkout_session_id: session.id, p_customer_id: session.payer.userId, p_new_attempt: newAttempt });
  const authority = (session, attemptId) => service('get_mercadopago_payment_authority_v2',
    { p_business_id: id, p_environment: ENVIRONMENT, p_checkout_session_id: session.id, p_customer_id: session.payer.userId, p_payment_attempt_id: attemptId });
  // …paso 2: lo que «contestó el proveedor» al crear la preferencia. Las URL son las que la base exige que
  // tenga un enlace de pago; nadie las abre.
  const recordPreference = (session, attemptId, authorityVersion, preferenceId = `ECOMCERT-PREF-${session.ref}`) => service('record_mercadopago_preference_created_v2', {
    p_business_id: id, p_environment: ENVIRONMENT, p_checkout_session_id: session.id, p_customer_id: session.payer.userId, p_payment_attempt_id: attemptId,
    p_expected_authority: authorityVersion, p_preference_id: preferenceId,
    p_init_point: `https://www.mercadopago.com.ar/checkout/v1/redirect?pref_id=${preferenceId}`,
    p_sandbox_init_point: `https://sandbox.mercadopago.com.ar/checkout/v1/redirect?pref_id=${preferenceId}`,
    p_response_hash: sha256(`preference:${preferenceId}`), p_provider_request_id: `ecomcert-req-${session.ref}` });

  // Sesión con su preferencia asentada: el comprador «está en Checkout Pro».
  async function redirect(session) {
    const prepared = await prepare(session);
    if (!prepared.ok || !prepared.data?.payment_attempt_id) return { ok: false, step: 'prepare', r: prepared };
    const authorized = await authority(session, prepared.data.payment_attempt_id);
    if (!authorized.ok || !authorized.data?.authority_version) return { ok: false, step: 'authority', r: authorized };
    session.attemptId = prepared.data.payment_attempt_id;
    // La referencia externa la pone la base al crear el intento: el aviso del proveedor la repite tal cual.
    session.externalReference = prepared.data.external_reference ?? null;
    session.preferenceId = `ECOMCERT-PREF-${session.ref}`;
    const recorded = await recordPreference(session, session.attemptId, authorized.data.authority_version, session.preferenceId);
    return { ok: recorded.ok, step: 'record', r: recorded, prepared, authorized };
  }

  // mercadopago-payment-worker: lo que el proveedor dice de UN pago. La misma semilla es la misma respuesta
  // del proveedor (un aviso repetido); otro `paymentId` es otro pago sobre la misma preferencia.
  function snapshot(session, status, { paymentId = `ECOMCERT-PAY-${session.ref}`, seed = `${status}`, amount = session.total, source = 'webhook', extra = {} } = {}) {
    return service('record_mercadopago_payment_snapshot', { p_payment_intent_id: session.intentId, p_source: source, p_webhook_receipt_id: null, p_snapshot: {
      provider_payment_id: paymentId, external_reference: session.externalReference ?? `taba2:checkout:${session.id}`, preference_id: session.preferenceId ?? null,
      merchant_order_id: `ECOMCERT-MO-${session.ref}`, collector_id: fixture.collector, application_id: '', currency: 'ARS',
      transaction_amount: Number(amount).toFixed(2), status, status_detail: status === 'approved' ? 'accredited' : `cert_${status}`, payment_method: 'visa', live_mode: false,
      provider_occurred_at: nowIso(), refunded_amount: '0.00', payer_email_hash: sha256(`payer:${session.payer.userId}`),
      raw_response_hash: sha256(`${paymentId}:${seed}`), ...extra } });
  }
  const finalize = (session) => service('finalize_paid_checkout_session', { p_checkout_session_id: session.id });

  // Un pedido pagado, de punta a punta. Devuelve cada respuesta para quien quiera afirmar sobre ellas.
  async function paidOrder(payer, options = {}) {
    const created = await createSession(payer, options);
    if (!created.session) return { ok: false, step: 'session', r: created.r };
    const session = created.session;
    const redirected = await redirect(session);
    if (!redirected.ok) return { ok: false, step: redirected.step, r: redirected.r, session };
    const approved = await snapshot(session, 'approved');
    if (!approved.ok || approved.data?.finalize_required !== true) return { ok: false, step: 'snapshot', r: approved, session };
    const finalized = await finalize(session);
    if (!finalized.ok || !finalized.data?.order_id) return { ok: false, step: 'finalize', r: finalized, session };
    session.orderId = finalized.data.order_id;
    session.paymentId = `ECOMCERT-PAY-${session.ref}`;
    return { ok: true, session, created, redirected, approved, finalized };
  }

  // mercadopago-refund: el dueño pide el reembolso con SU sesión…
  const requestRefund = (actor, intentId, { amount = null, key = randomUUID(), reason = `${ctx.runId} QA sin dinero real` } = {}) => ctx.http.call(actor, 'prepare_payment_refund_v2',
    { p_payment_intent_id: intentId, p_amount: amount, p_idempotency_key: key, p_reason: reason }).then((r) => ({ r, key }));
  // …y la función asienta lo que «contestó el proveedor»: primero la identidad del reembolso, después el resultado.
  let refundSequence = 0;
  async function settleRefund({ refundId, intentId, paymentId, key, amount, status = 'approved' }) {
    refundSequence += 1;
    const providerRefundId = `${Date.now()}${String(refundSequence).padStart(4, '0')}`;
    const identity = await service('record_payment_refund_identity', { p_refund_id: refundId, p_payment_intent_id: intentId, p_provider_payment_id: paymentId,
      p_idempotency_key: key, p_provider_refund_id: providerRefundId });
    const response = await service('record_payment_refund_response_v2', { p_refund_id: refundId, p_provider_refund_id: providerRefundId, p_status: status,
      p_amount: amount, p_response_hash: sha256(`refund:${providerRefundId}:${status}`) });
    return { identity, response, providerRefundId, ok: identity.ok && identity.data === true && response.ok && response.data?.ok === true };
  }

  // ── Verdad de la base ──────────────────────────────────────────────────────
  const state = async (sessionId) => (await ctx.env.observe(`select cs.status as session, cs.revision::int as session_revision, cs.completed_order_id as order_id, cs.expires_at,
      cs.manual_review_reason, pi.id as intent_id, pi.internal_status as intent, pi.order_id as intent_order_id, pi.provider_status, pi.provider_payment_id,
      pi.paid_amount, pi.refunded_amount, pi.expected_amount, pi.security_review_reason as review, pi.preference_id,
      (select coalesce(json_agg(r.status || ':' || r.quantity || ':' || coalesce(r.release_reason, '-') order by r.reservation_generation, r.id), '[]'::json)
         from public.inventory_reservations r where r.checkout_session_id = cs.id) as reservations,
      (select count(*)::int from public.orders o where o.business_id = cs.business_id and o.client_request_id = 'mp_' || replace(cs.id::text, '-', '')) as orders,
      (select coalesce(json_agg(e.event_type order by e.sequence), '[]'::json) from public.payment_events e where e.payment_intent_id = pi.id) as events,
      (select coalesce(json_agg(a.attempt_number || ':' || a.status order by a.attempt_number), '[]'::json) from public.payment_attempts a where a.payment_intent_id = pi.id) as attempts,
      (select coalesce(json_agg(json_build_object('id', f.id, 'status', f.status, 'amount', f.amount, 'key', f.idempotency_key, 'order_id', f.order_id) order by f.requested_at), '[]'::json)
         from public.payment_refunds f where f.payment_intent_id = pi.id) as refunds
    from public.checkout_sessions cs join public.payment_intents pi on pi.checkout_session_id = cs.id where cs.id = ${sqlUuid(sessionId)}`))[0] || null;

  // Envejecer una sesión: ella y sus reservas vencieron hace un minuto. Donde la base es de quien corre (local,
  // stack) va por la conexión directa; en Staging, con `service_role` sobre las filas del propio tenant. Las dos
  // formas quedan anotadas. Es lo único que reemplaza a esperar el plazo real de la sesión.
  async function ageSession(sessionId, why) {
    const database = ctx.env.target.database;
    if (database) {
      const entry = { at: nowIso(), what: `age checkout session ${sessionId.slice(0, 8)} and its reservations: expired one minute ago`, why, rows: null };
      ctx.ledger.databaseInterventions.push(entry);
      ctx.persist();
      const sessions = await database.write(`update public.checkout_sessions set created_at = clock_timestamp() - interval '2 hours',
        expires_at = clock_timestamp() - interval '1 minute' where id = $1 and business_id = $2`, [sessionId, id]);
      const reservations = await database.write(`update public.inventory_reservations set created_at = clock_timestamp() - interval '2 hours',
        expires_at = clock_timestamp() - interval '1 minute' where checkout_session_id = $1 and status = 'active'`, [sessionId]);
      entry.rows = { checkout_sessions: sessions.rowCount, inventory_reservations: reservations.rowCount };
      ctx.persist();
      return { ok: sessions.rowCount === 1, via: 'direct database connection (the runner owns this database)', rows: entry.rows };
    }
    ctx.guard.assertWrite(id);
    const past = { created_at: new Date(Date.now() - 2 * 3_600_000).toISOString(), expires_at: new Date(Date.now() - 60_000).toISOString() };
    const out = await ctx.serviceRole('provision', `update checkout_sessions + inventory_reservations (age session ${sessionId.slice(0, 8)} of the tenant: ${why})`, async (admin) => {
      const sessions = await admin.from('checkout_sessions').update(past).eq('id', sessionId).eq('business_id', id).select('id');
      const reservations = await admin.from('inventory_reservations').update(past).eq('checkout_session_id', sessionId).eq('status', 'active').select('id');
      return { sessions: sessions.error?.code || sessions.data?.length, reservations: reservations.error?.code || reservations.data?.length };
    });
    return { ok: out.sessions === 1, via: 'service_role over the rows of the tenant (the runner does not own this database)', rows: out };
  }

  // ── Limpieza ───────────────────────────────────────────────────────────────
  // Lo cobrado se devuelve entero y ninguna sesión queda reteniendo stock. No cancela pedidos: eso lo hace la
  // limpieza de pedidos, que viene después y ya los encuentra con el dinero devuelto.
  async function settle() {
    const failures = [];
    const fail = (what, r, extra = {}) => failures.push({ step: what, ...brief(r), ...extra });
    const rows = await ctx.env.observe(`select cs.id as session_id, cs.status as session, cs.customer_id, pi.id as intent_id, pi.internal_status as intent, pi.order_id,
        pi.provider_payment_id, pi.paid_amount, pi.refunded_amount, pi.provider_status
      from public.checkout_sessions cs join public.payment_intents pi on pi.checkout_session_id = cs.id
      where cs.business_id = ${sqlUuid(id)} and cs.client_request_id like ${sqlText(`${TENANT.requestPrefix}%`)}
        and (cs.status in ${OPEN_SESSION_SQL} or (pi.paid_amount is not null and pi.refunded_amount < pi.paid_amount))
      order by cs.created_at`);
    if (!rows.length) return { touched: 0, failures };
    const owner = ctx.actors.owner;
    // 1. Un cobro aprobado al que le falta el pedido: se finaliza (queda un pedido pagado, que abajo se devuelve).
    const approved = rows.filter((row) => ['payment_approved', 'finalizing_order'].includes(row.session) && ['approved', 'approved_order_pending'].includes(row.intent));
    await pool(approved, Math.min(6, Math.max(1, approved.length)), async (row) => {
      const r = await service('finalize_paid_checkout_session', { p_checkout_session_id: row.session_id });
      if (!r.ok) fail('finalize', r, { session: row.session_id.slice(0, 8) });
    });
    // 2. Sesiones que nadie pagó: vencen ya y el barrido —la misma función que corre el planificador— devuelve el stock.
    const open = rows.filter((row) => !approved.includes(row) && ['created', 'validating', 'ready_for_payment', 'redirected', 'payment_pending', 'retrying'].includes(row.session)
      && !(Number(row.paid_amount) > 0));
    for (const row of open) {
      const aged = await ageSession(row.session_id, 'cleanup: nobody is going to pay it');
      if (!aged.ok) failures.push({ step: 'age_session', session: row.session_id.slice(0, 8), detail: aged.rows });
    }
    if (open.length) {
      const swept = await service('sweep_expired_checkout_sessions', {});
      if (!swept.ok) fail('sweep_expired_checkout_sessions', swept);
    }
    // 3. Todo lo cobrado y no devuelto: el dueño pide el reembolso total y se asienta la respuesta.
    const paid = await ctx.env.observe(`select pi.id as intent_id, pi.provider_payment_id, pi.paid_amount, pi.refunded_amount, pi.internal_status as intent
      from public.payment_intents pi join public.checkout_sessions cs on cs.id = pi.checkout_session_id
      where cs.business_id = ${sqlUuid(id)} and cs.client_request_id like ${sqlText(`${TENANT.requestPrefix}%`)}
        and pi.paid_amount is not null and pi.refunded_amount < pi.paid_amount and pi.provider_payment_id is not null`);
    await pool(paid, Math.min(6, Math.max(1, paid.length)), async (row) => {
      const asked = await requestRefund(owner, row.intent_id, { reason: `${ctx.runId} QA limpieza sin dinero real` });
      if (!asked.r.ok || !asked.r.data?.refund_id) { fail('refund_request', asked.r, { intent: row.intent_id.slice(0, 8), status: row.intent }); return; }
      const settled = await settleRefund({ refundId: asked.r.data.refund_id, intentId: row.intent_id, paymentId: row.provider_payment_id,
        key: asked.r.data.idempotency_key, amount: Number(asked.r.data.amount) });
      if (!settled.ok) fail('refund_settle', settled.response.ok ? settled.identity : settled.response, { intent: row.intent_id.slice(0, 8) });
    });
    return { touched: rows.length, failures };
  }

  return { fixture, ensureFixture, disableFixture, sessionPayload, createSession, prepare, authority, recordPreference, redirect, snapshot, finalize, paidOrder,
    requestRefund, settleRefund, state, ageSession, settle };
}
