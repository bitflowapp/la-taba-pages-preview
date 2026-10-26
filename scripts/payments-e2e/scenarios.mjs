// Escenarios del banco de cobros. Cada uno recorre las funciones como lo harían el navegador del comprador, el Panel
// del comercio, Mercado Pago (emulado) y el cron, y verifica el resultado en la base real del banco.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

import { drainWorker, sleep, userToken } from './lib.mjs';
import { CATALOG, DELIVERY_FEE, checkoutPayload } from './seed.mjs';

const REFUND_CONFIRMATION = 'I_UNDERSTAND_THIS_REQUESTS_A_MERCADO_PAGO_REFUND';
const CANCELLATION_CONFIRMATION = 'I_UNDERSTAND_THIS_REQUESTS_A_MERCADO_PAGO_CANCELLATION';

const money = (value) => Number(Number(value).toFixed(2));
const priceOf = (key) => money([...CATALOG.A, ...CATALOG.B].find((product) => product.key === key).price);

// ------------------------------------------------------------------------------------------------- personas

function owner(ctx, key) {
  ctx.people ??= {};
  const name = `owner${key}`;
  if (!ctx.people[name]) {
    const person = { id: ctx.ids.owners[key], email: `owner-${key.toLowerCase()}@bench.invalid`, sessionId: randomUUID() };
    person.token = userToken(person, ctx.stack.jwtSecret);
    ctx.people[name] = person;
  }
  return ctx.people[name];
}

function customer(ctx, key = 'one') {
  ctx.people ??= {};
  const name = `customer-${key}`;
  if (!ctx.people[name]) {
    const person = { id: ctx.ids.customers[key], email: `cliente-${key}@bench.invalid`, sessionId: randomUUID() };
    person.token = userToken(person, ctx.stack.jwtSecret);
    ctx.people[name] = person;
  }
  return ctx.people[name];
}

/** El Panel registra la sesión del dueño al entrar (identity_register_session), igual que en producción. */
async function panelLogin(ctx, key) {
  const person = owner(ctx, key);
  if (person.registered) return person;
  const response = await fetch(`${ctx.stack.restUrl}/rpc/identity_register_session`, {
    method: 'POST', headers: { authorization: `Bearer ${person.token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ p_business_id: ctx.ids.businesses[key], p_client: 'panel_web' }),
  });
  const body = await response.json();
  assert.equal(body?.ok, true, `registro de sesión del Panel ${key}: ${JSON.stringify(body)}`);
  person.registered = true;
  return person;
}

async function rpcAsService(ctx, name, args) {
  const response = await fetch(`${ctx.stack.restUrl}/rpc/${name}`, {
    method: 'POST', headers: { authorization: `Bearer ${ctx.env.SUPABASE_SERVICE_ROLE_KEY}`, 'content-type': 'application/json' },
    body: JSON.stringify(args),
  });
  const text = await response.text();
  return { status: response.status, json: text ? JSON.parse(text) : null };
}

const one = async (ctx, sql, params = []) => (await ctx.stack.query(sql, params)).rows[0];
const all = async (ctx, sql, params = []) => (await ctx.stack.query(sql, params)).rows;

// ------------------------------------------------------------------------------------------------- flujos

async function connectSeller(ctx, key, sellerId) {
  const person = await panelLogin(ctx, key);
  const started = await ctx.functions.call('mercadopago-connect', {
    token: person.token, body: { business_id: ctx.ids.businesses[key], action: 'connect' },
  });
  assert.equal(started.status, 200, `connect ${key}: ${started.text}`);
  const authorization = new URL(started.json.authorization_url);
  // La persona inicia sesión en Mercado Pago y autoriza; el navegador vuelve al callback.
  const back = new URL(ctx.emulator.consent(authorization.toString(), sellerId));
  const callback = await ctx.functions.call('mercadopago-oauth-callback', { method: 'GET', query: back.search, headers: {} });
  assert.equal(callback.status, 303, `callback ${key}: ${callback.status} ${callback.text}`);
  const result = new URL(callback.location).searchParams.get('mp_connection');
  return { result, authorization };
}

async function enableForSales(ctx, key) {
  if (ctx.environment !== 'production') return null;
  // Producción: vincular NO habilita cobros. Lo hace el operador, con la revisión productiva confirmada.
  const enabled = await rpcAsService(ctx, 'operator_set_mercadopago_for_business', {
    p_business_id: ctx.ids.businesses[key], p_environment: 'production', p_enabled: true,
    p_expected_application_id: ctx.clientId, p_production_review_approved: true,
  });
  assert.equal(enabled.status, 200, `operador ${key}: ${JSON.stringify(enabled.json)}`);
  return enabled.json;
}

async function startCheckout(ctx, { business = 'A', buyer = 'one', items, delivery = false, payload } = {}) {
  const person = customer(ctx, buyer);
  const body = payload || checkoutPayload(ctx.ids.businesses[business], items, { delivery });
  const session = await ctx.functions.call('mercadopago-create-checkout-session', { token: person.token, body, ip: `200.1.1.${buyer.length}` });
  if (session.status !== 200) return { failed: session };
  const checkout = session.json.checkout;
  const sessionId = checkout.checkout_session_id;
  const preference = await ctx.functions.call('mercadopago-create-preference', { token: person.token, body: { checkout_session_id: sessionId } });
  assert.equal(preference.status, 200, `create-preference: ${preference.text}`);
  const initPoint = new URL(preference.json.init_point);
  const preferenceId = initPoint.searchParams.get('pref_id');
  return { person, checkout, sessionId, preferenceId, initPoint: initPoint.toString(), sent: ctx.emulator.preferences.get(preferenceId) };
}

/** El comprador vuelve a La Taba: la pantalla de resultado pregunta al servidor (nunca confía en la URL de retorno). */
async function returnPage(ctx, purchase) {
  const status = await ctx.functions.call('mercadopago-checkout-status', {
    token: purchase.person.token, body: { checkout_session_id: purchase.sessionId },
  });
  assert.equal(status.status, 200, `checkout-status: ${status.text}`);
  return status.json.checkout;
}

async function snapshot(ctx, sessionId) {
  const session = await one(ctx, `select cs.status, cs.total::text, cs.delivery_fee::text, cs.completed_order_id,
      pi.id as intent_id, pi.internal_status, pi.provider_status, pi.provider_payment_id, pi.expected_amount::text,
      pi.paid_amount::text, pi.refunded_amount::text, pi.security_review_reason, pi.order_id, pi.business_id
    from public.checkout_sessions cs join public.payment_intents pi on pi.checkout_session_id = cs.id where cs.id = $1`, [sessionId]);
  const orders = await all(ctx, `select o.id, o.public_code, o.status, o.total::text, o.payment_method from public.orders o
    where o.id in (select order_id from public.payment_intents where checkout_session_id = $1 and order_id is not null)
       or o.id = (select completed_order_id from public.checkout_sessions where id = $1)`, [sessionId]);
  const reservations = await all(ctx, `select r.status, r.quantity, r.release_reason from public.inventory_reservations r
    where r.checkout_session_id = $1 order by r.created_at`, [sessionId]);
  const discrepancies = await all(ctx, `select kind, severity, status from public.payment_discrepancies where checkout_session_id = $1`, [sessionId]);
  // Para diagnosticar un escenario rojo: los trabajos de la cola de este checkout (por intención o por sus avisos).
  const jobs = await all(ctx, `select o.topic, o.status, o.attempts, o.last_error from public.payment_outbox o
    where o.payment_intent_id = $1::uuid or o.webhook_receipt_id in (select r.id from public.payment_webhook_receipts r
      where r.resource_id in (select p.provider_payment_id from public.payment_provider_payments p where p.payment_intent_id = $1::uuid)
         or r.resource_id in (select provider_payment_id from public.payment_intents where id = $1::uuid))
    order by o.created_at`, [session?.intent_id ?? null]);
  return { ...session, orders, reservations, discrepancies, jobs, last_worker_runs: (ctx.workerLog || []).slice(-4) };
}

const stockOf = async (ctx, key) => Number((await one(ctx, 'select stock from public.products where id = $1', [ctx.ids.products[key]])).stock);
const ordersOfBusiness = async (ctx, key) => Number((await one(ctx,
  `select count(*)::int as n from public.orders where business_id = $1 and payment_method = 'mercadopago'`, [ctx.ids.businesses[key]])).n);

async function worker(ctx) {
  const runs = await drainWorker(ctx.functions, ctx.workerSecret);
  ctx.workerLog ??= [];
  ctx.workerLog.push(...runs);
  return runs;
}

/** Simula el paso del tiempo para la cola: los reintentos programados quedan listos ya (sólo el banco hace esto). */
async function fastForwardQueue(ctx) {
  await ctx.stack.query(`update public.payment_outbox set next_attempt_at = now() where status in ('pending', 'retry') and next_attempt_at > now()`);
}

// ------------------------------------------------------------------------------------------------- escenarios

export const SCENARIOS = [
  {
    id: 'oauth',
    title: 'Vinculación OAuth de cada vendedor (PKCE S256, state de un solo uso, tokens sellados), cuenta ya usada y cuenta de la plataforma rechazadas',
    stopOnFailure: true,
    async run(ctx) {
      const a = await connectSeller(ctx, 'A', ctx.sellers.A);
      assert.equal(a.result, 'connected');
      assert.equal(a.authorization.searchParams.get('code_challenge_method'), 'S256');
      const b = await connectSeller(ctx, 'B', ctx.sellers.B);
      assert.equal(b.result, 'connected');
      // La cuenta que ya cobra para A no puede cobrar para C.
      const reused = await connectSeller(ctx, 'C', ctx.sellers.A);
      assert.equal(reused.result, 'seller_in_use');
      let platform = null;
      if (ctx.environment === 'production') {
        // La cuenta dueña de La Taba Delivery nunca queda como vendedor de un comercio.
        platform = await connectSeller(ctx, 'C', ctx.application.ownerId);
        assert.equal(platform.result, 'integrator_account');
      }
      const rows = await all(ctx, `select c.business_id, c.seller_id, c.status, c.application_id, left(c.protected_tokens, 3) as sealed,
          s.enabled, s.collector_id, s.environment from public.mp_seller_connections c
        left join public.business_payment_settings s on s.business_id = c.business_id order by c.seller_id nulls last`);
      const linked = rows.filter((row) => row.status === 'connected');
      assert.deepEqual(linked.map((row) => row.seller_id).sort(), [String(ctx.sellers.A), String(ctx.sellers.B)]);
      assert.ok(linked.every((row) => row.sealed === 'v1.' && row.application_id === ctx.clientId));
      // Ningún token en claro en la base.
      const leaked = await one(ctx, `select count(*)::int as n from public.mp_seller_connections where protected_tokens like '%APP_USR-%'`);
      assert.equal(leaked.n, 0);
      const verify = await ctx.functions.call('mercadopago-connect', {
        token: owner(ctx, 'A').token, body: { business_id: ctx.ids.businesses.A, action: 'verify' },
      });
      assert.equal(verify.status, 200, verify.text);
      assert.equal(verify.json.verification?.seller_identity_verified, true, JSON.stringify(verify.json));
      assert.equal(verify.json.verification?.integrator_environment_matches, true);
      assert.equal(verify.json.verification?.seller_is_integrator, false);
      const enabledA = await enableForSales(ctx, 'A');
      const enabledB = await enableForSales(ctx, 'B');
      const settings = await all(ctx, `select business_id, enabled, environment, production_review_status, collector_id from public.business_payment_settings order by collector_id`);
      assert.ok(settings.filter((row) => row.enabled).length === 2, `dos comercios habilitados: ${JSON.stringify(settings)}`);
      return {
        connected: { A: a.result, B: b.result }, seller_reused_by_other_business: reused.result, platform_account_as_seller: platform?.result ?? 'n/a (sólo producción)',
        verification: verify.json.verification ? Object.fromEntries(Object.entries(verify.json.verification).filter(([key]) => key !== 'checked_at')) : null,
        operator_enable: enabledA || enabledB ? { A: enabledA?.ok ?? null, B: enabledB?.ok ?? null } : 'n/a (prueba: vincular habilita)',
        settings,
      };
    },
  },
  {
    id: 'apro',
    title: 'Compra aprobada (APRO): carrito → sesión → preferencia con importes del servidor → pago → webhook firmado → worker → pedido y stock',
    stopOnFailure: true,
    async run(ctx) {
      const stockBefore = { agua: await stockOf(ctx, 'agua'), gaseosa: await stockOf(ctx, 'gaseosa'), papas: await stockOf(ctx, 'papas') };
      const items = [{ product_id: ctx.ids.products.agua, quantity: 2 }, { product_id: ctx.ids.products.gaseosa, quantity: 1 }, { product_id: ctx.ids.products.papas, quantity: 3 }];
      const purchase = await startCheckout(ctx, { items, delivery: true });
      assert.ok(!purchase.failed, `checkout: ${purchase.failed?.text}`);
      const expected = money(priceOf('agua') * 2 + priceOf('gaseosa') + priceOf('papas') * 3 + Number(DELIVERY_FEE));
      assert.equal(money(purchase.checkout.total), expected, 'total calculado por el servidor');
      // La preferencia que recibió Mercado Pago: precios de la base, envío como renglón, referencia y URLs del servidor.
      const sent = purchase.sent;
      const sentTotal = money(sent.items.reduce((sum, item) => sum + item.unit_price * item.quantity, 0));
      assert.equal(sentTotal, expected);
      assert.ok(sent.items.some((item) => item.id === 'taba-delivery-fee' && money(item.unit_price) === money(DELIVERY_FEE)));
      assert.equal(sent.external_reference, `taba2:checkout:${purchase.sessionId}`);
      assert.equal(sent.notification_url, `https://${ctx.ref}.supabase.co/functions/v1/mercadopago-webhook`);
      assert.equal(sent.back_urls.success, `${ctx.origin}/pago/resultado`);
      assert.equal(sent.auto_return, 'approved');
      assert.equal(sent.collector_id, ctx.sellers.A);
      assert.equal(sent.marketplace, `MP-MKT-${ctx.clientId}`, 'integradora ≠ vendedor: pago marketplace');
      const reserved = await snapshot(ctx, purchase.sessionId);
      assert.equal(reserved.status, 'redirected');
      assert.equal(await stockOf(ctx, 'agua'), stockBefore.agua - 2, 'la reserva descuenta al iniciar el checkout');
      // El retorno del navegador ANTES del pago no confirma nada.
      const early = await returnPage(ctx, purchase);
      assert.notEqual(early.status, 'completed');
      const payment = await ctx.emulator.pay(purchase.preferenceId, { buyerId: ctx.buyers.one, scenario: 'APRO' });
      const webhook = ctx.emulator.deliveries.filter((entry) => entry.dataId === String(payment.id) && entry.shape === 'webhook').at(-1);
      assert.equal(webhook.status, 201, `webhook: ${JSON.stringify(webhook)}`);
      const runs = await worker(ctx);
      const after = await snapshot(ctx, purchase.sessionId);
      assert.equal(after.status, 'completed', JSON.stringify(after));
      assert.equal(after.internal_status, 'completed');
      assert.equal(after.provider_payment_id, String(payment.id));
      assert.equal(money(after.paid_amount), expected);
      assert.equal(after.orders.length, 1);
      assert.equal(money(after.orders[0].total), expected);
      assert.equal(after.discrepancies.length, 0, JSON.stringify(after.discrepancies));
      assert.ok(after.reservations.every((reservation) => reservation.status === 'converted'));
      const stockAfter = { agua: await stockOf(ctx, 'agua'), gaseosa: await stockOf(ctx, 'gaseosa'), papas: await stockOf(ctx, 'papas') };
      assert.deepEqual(stockAfter, { agua: stockBefore.agua - 2, gaseosa: stockBefore.gaseosa - 1, papas: stockBefore.papas - 3 }, 'stock descontado una sola vez');
      const page = await returnPage(ctx, purchase);
      assert.equal(page.status, 'completed');
      ctx.apro = { purchase, payment, expected };
      return {
        checkout_session_id: purchase.sessionId, preference_id: purchase.preferenceId, provider_payment_id: String(payment.id),
        total_server: expected, preference_items: sent.items.map(({ id, title, quantity, unit_price }) => ({ id, title, quantity, unit_price })),
        marketplace: sent.marketplace, collector_id: sent.collector_id, webhook_http: webhook.status,
        worker_runs: runs, order: after.orders[0], stock_before: stockBefore, stock_after: stockAfter, return_page_status: page.status,
      };
    },
  },
  {
    id: 'duplicates',
    title: 'Webhooks duplicados, concurrentes, IPN viejo, firma falsa y firma vencida: ninguna operación se repite',
    async run(ctx) {
      assert.ok(ctx.apro, 'requiere el escenario apro');
      const { purchase, payment } = ctx.apro;
      const stock = await stockOf(ctx, 'agua');
      const orders = await ordersOfBusiness(ctx, 'A');
      // 1) La MISMA notificación (mismo x-request-id y evento) tres veces, y 2) cinco notificaciones nuevas a la vez.
      const requestId = randomUUID();
      const same = [];
      for (let index = 0; index < 3; index += 1) {
        same.push(await ctx.emulator.notify(payment, 'payment', String(payment.id), 'payment.updated', { requestId, eventId: 777000111 }));
      }
      const concurrent = await Promise.all(Array.from({ length: 5 }, () => ctx.emulator.notify(payment, 'payment', String(payment.id), 'payment.updated')));
      // 3) Una firma con la clave equivocada y 4) una firma de hace 10 minutos.
      ctx.emulator.options.signature = 'foreign';
      const forged = await ctx.emulator.notify(payment, 'payment', String(payment.id), 'payment.updated');
      ctx.emulator.options.signature = 'valid';
      const stale = await ctx.emulator.notify(payment, 'payment', String(payment.id), 'payment.updated', { timestamp: Math.floor(Date.now() / 1000) - 600 });
      const runs = await worker(ctx);
      const after = await snapshot(ctx, purchase.sessionId);
      assert.equal(after.orders.length, 1);
      assert.equal(await ordersOfBusiness(ctx, 'A'), orders);
      assert.equal(await stockOf(ctx, 'agua'), stock);
      assert.deepEqual(same.map((entry) => entry.status), [201, 201, 201]);
      assert.equal(same[1].response?.duplicate, true, 'el reenvío idéntico se reconoce como duplicado');
      assert.ok(concurrent.every((entry) => entry.status === 201));
      assert.equal(forged.status, 401);
      assert.equal(stale.status, 401);
      const ipn = ctx.emulator.deliveries.filter((entry) => entry.shape === 'legacy_ipn' && entry.dataId === String(payment.id));
      assert.ok(ipn.length > 0 && ipn.every((entry) => entry.status === 200 && entry.response?.ignored === 'legacy_ipn'));
      const receipts = await all(ctx, `select signature_valid, processing_status, count(*)::int as n from public.payment_webhook_receipts
        where resource_id = $1 group by 1, 2 order by 1, 2`, [String(payment.id)]);
      return { same_notification_x3: same.map((entry) => ({ http: entry.status, duplicate: entry.response?.duplicate })),
        concurrent_x5: concurrent.map((entry) => entry.status), forged_signature: forged.status, stale_signature: stale.status,
        legacy_ipn: ipn.map((entry) => entry.status), receipts, worker_runs: runs, orders_for_session: after.orders.length };
    },
  },
  {
    id: 'rejected_then_approved',
    title: 'Pago rechazado (OTHE): el pedido no se crea, la reserva se conserva y el reintento aprobado crea un solo pedido',
    async run(ctx) {
      const stockBefore = await stockOf(ctx, 'gaseosa');
      const purchase = await startCheckout(ctx, { buyer: 'two', items: [{ product_id: ctx.ids.products.gaseosa, quantity: 2 }] });
      const rejected = await ctx.emulator.pay(purchase.preferenceId, { buyerId: ctx.buyers.two, scenario: 'OTHE' });
      await worker(ctx);
      const afterReject = await snapshot(ctx, purchase.sessionId);
      assert.equal(afterReject.internal_status, 'rejected');
      assert.equal(afterReject.orders.length, 0);
      assert.ok(afterReject.reservations.every((reservation) => reservation.status === 'active'), 'la reserva sigue mientras el checkout vive');
      assert.equal(await stockOf(ctx, 'gaseosa'), stockBefore - 2);
      const page = await returnPage(ctx, purchase);
      assert.notEqual(page.status, 'completed');
      const approved = await ctx.emulator.pay(purchase.preferenceId, { buyerId: ctx.buyers.two, scenario: 'APRO' });
      await worker(ctx);
      const after = await snapshot(ctx, purchase.sessionId);
      assert.equal(after.status, 'completed', JSON.stringify(after));
      assert.equal(after.provider_payment_id, String(approved.id));
      assert.equal(after.orders.length, 1);
      assert.equal(await stockOf(ctx, 'gaseosa'), stockBefore - 2, 'el reintento no descuenta otra vez');
      assert.equal(after.discrepancies.length, 0, JSON.stringify(after.discrepancies));
      return { rejected_payment: { id: String(rejected.id), status: rejected.status, status_detail: rejected.status_detail },
        after_reject: { session: afterReject.status, intent: afterReject.internal_status, reservations: afterReject.reservations.map((r) => r.status) },
        approved_payment: String(approved.id), final: { session: after.status, orders: after.orders.length } };
    },
  },
  {
    id: 'pending_then_approved',
    title: 'Pago pendiente (CONT): queda en proceso sin pedido y se completa una sola vez cuando Mercado Pago lo acredita',
    async run(ctx) {
      const purchase = await startCheckout(ctx, { items: [{ product_id: ctx.ids.products.agua, quantity: 1 }] });
      const pending = await ctx.emulator.pay(purchase.preferenceId, { buyerId: ctx.buyers.one, scenario: 'CONT' });
      const asPaid = { status: pending.status, status_detail: pending.status_detail };
      await worker(ctx);
      const during = await snapshot(ctx, purchase.sessionId);
      assert.equal(during.internal_status, 'in_process');
      assert.equal(during.status, 'payment_pending');
      assert.equal(during.orders.length, 0);
      await ctx.emulator.settle(pending.id, 'approved');
      await worker(ctx);
      const after = await snapshot(ctx, purchase.sessionId);
      assert.equal(after.status, 'completed', JSON.stringify(after));
      assert.equal(after.orders.length, 1);
      return { pending: { ...asPaid, session: during.status, intent: during.internal_status },
        settled: { session: after.status, intent: after.internal_status, orders: after.orders.length } };
    },
  },
  {
    id: 'pending_cancelled',
    title: 'Pago offline pendiente cancelado por el comercio: el stock vuelve y no hay pedido',
    async run(ctx) {
      await ctx.stack.query(`update public.business_payment_settings set allow_offline_payment_methods = true where business_id = $1`, [ctx.ids.businesses.A]);
      const before = await stockOf(ctx, 'papas');
      const purchase = await startCheckout(ctx, { items: [{ product_id: ctx.ids.products.papas, quantity: 2 }] });
      const ticket = await ctx.emulator.pay(purchase.preferenceId, { buyerId: ctx.buyers.one, scenario: 'TICKET' });
      await worker(ctx);
      const during = await snapshot(ctx, purchase.sessionId);
      assert.equal(during.internal_status, 'pending');
      assert.equal(await stockOf(ctx, 'papas'), before - 2);
      const person = await panelLogin(ctx, 'A');
      const cancelled = await ctx.functions.call('mercadopago-cancel-payment', { token: person.token, body: {
        payment_intent_id: during.intent_id, idempotency_key: randomUUID(), confirmation: CANCELLATION_CONFIRMATION } });
      assert.equal(cancelled.status, 200, cancelled.text);
      await sleep(200);
      await worker(ctx);
      const after = await snapshot(ctx, purchase.sessionId);
      assert.equal(ctx.emulator.payments.get(ticket.id).status, 'cancelled');
      assert.equal(after.internal_status, 'cancelled', JSON.stringify(after));
      assert.equal(after.orders.length, 0);
      assert.equal(await stockOf(ctx, 'papas'), before, 'la cancelación devuelve el stock');
      await ctx.stack.query(`update public.business_payment_settings set allow_offline_payment_methods = false where business_id = $1`, [ctx.ids.businesses.A]);
      return { payment: String(ticket.id), cancellation_http: cancelled.status, intent: after.internal_status, session: after.status,
        reservations: after.reservations.map((r) => `${r.status}:${r.release_reason}`), stock: { before, after: await stockOf(ctx, 'papas') } };
    },
  },
  {
    id: 'abandoned_expired',
    title: 'Checkout abandonado: al vencer, el barrido libera la reserva una sola vez',
    async run(ctx) {
      const before = await stockOf(ctx, 'gaseosa');
      const purchase = await startCheckout(ctx, { items: [{ product_id: ctx.ids.products.gaseosa, quantity: 1 }] });
      assert.equal(await stockOf(ctx, 'gaseosa'), before - 1);
      // El banco adelanta el reloj del checkout; el barrido es el mismo que corre el cron.
      await ctx.stack.query(`update public.checkout_sessions set created_at = now() - interval '2 hours', expires_at = now() - interval '1 second'
        where id = $1`, [purchase.sessionId]);
      await ctx.stack.query(`update public.inventory_reservations set created_at = now() - interval '2 hours', expires_at = now() - interval '1 second'
        where checkout_session_id = $1`, [purchase.sessionId]);
      const swept = await one(ctx, 'select public.sweep_expired_checkout_sessions() as n');
      const again = await one(ctx, 'select public.sweep_expired_checkout_sessions() as n');
      const after = await snapshot(ctx, purchase.sessionId);
      assert.equal(after.status, 'expired', JSON.stringify(after));
      assert.equal(await stockOf(ctx, 'gaseosa'), before, 'stock liberado');
      // La preferencia vence en Mercado Pago a la misma hora (expiration_date_to = vencimiento del checkout).
      assert.equal(Date.parse(purchase.sent.expiration_date_to), Date.parse(purchase.checkout.expires_at));
      purchase.sent.expiration_date_to = new Date(Date.now() - 1000).toISOString();
      await assert.rejects(ctx.emulator.pay(purchase.preferenceId, { buyerId: ctx.buyers.one }), /PREFERENCE_EXPIRED/);
      return { swept: Number(swept.n), second_sweep: Number(again.n), session: after.status, reservations: after.reservations.map((r) => `${r.status}:${r.release_reason}`),
        stock: { before, after: await stockOf(ctx, 'gaseosa') } };
    },
  },
  {
    id: 'late_approval_after_expiry',
    title: 'Pago aprobado DESPUÉS de vencida la reserva: se vuelve a tomar el stock y se crea un solo pedido; sin stock, revisión manual visible',
    async run(ctx) {
      const before = await stockOf(ctx, 'papas');
      const purchase = await startCheckout(ctx, { buyer: 'two', items: [{ product_id: ctx.ids.products.papas, quantity: 1 }] });
      await ctx.stack.query(`update public.checkout_sessions set created_at = now() - interval '2 hours', expires_at = now() - interval '1 second'
        where id = $1`, [purchase.sessionId]);
      await ctx.stack.query(`update public.inventory_reservations set created_at = now() - interval '2 hours', expires_at = now() - interval '1 second'
        where checkout_session_id = $1`, [purchase.sessionId]);
      await one(ctx, 'select public.sweep_expired_checkout_sessions() as n');
      assert.equal(await stockOf(ctx, 'papas'), before, 'la reserva vencida devolvió el stock');
      // En Mercado Pago la preferencia todavía se podía pagar (reloj del proveedor, pago en curso): llega aprobado.
      const payment = await ctx.emulator.pay(purchase.preferenceId, { buyerId: ctx.buyers.two, scenario: 'APRO' });
      await worker(ctx);
      const after = await snapshot(ctx, purchase.sessionId);
      assert.equal(after.status, 'completed', JSON.stringify(after));
      assert.equal(after.orders.length, 1);
      assert.equal(await stockOf(ctx, 'papas'), before - 1, 'se vuelve a descontar UNA vez');
      // La misma situación sin stock: el dinero no se pierde ni se inventa un pedido; queda un caso visible.
      const last = await startCheckout(ctx, { buyer: 'three', items: [{ product_id: ctx.ids.products.agua, quantity: 2 }] });
      await ctx.stack.query(`update public.checkout_sessions set created_at = now() - interval '2 hours', expires_at = now() - interval '1 second' where id = $1`, [last.sessionId]);
      await ctx.stack.query(`update public.inventory_reservations set created_at = now() - interval '2 hours', expires_at = now() - interval '1 second' where checkout_session_id = $1`, [last.sessionId]);
      await one(ctx, 'select public.sweep_expired_checkout_sessions() as n');
      const stockAgua = await stockOf(ctx, 'agua');
      await ctx.stack.query('update public.products set stock = 1 where id = $1', [ctx.ids.products.agua]);
      const paidLate = await ctx.emulator.pay(last.preferenceId, { buyerId: ctx.buyers.one, scenario: 'APRO' });
      await worker(ctx);
      const held = await snapshot(ctx, last.sessionId);
      await ctx.stack.query('update public.products set stock = $2 where id = $1', [ctx.ids.products.agua, stockAgua]);
      assert.equal(held.orders.length, 0);
      assert.equal(held.status, 'manual_review_required', JSON.stringify(held));
      assert.ok(held.discrepancies.some((item) => item.kind === 'paid_without_order' && item.status === 'open'), JSON.stringify(held.discrepancies));
      // Procedimiento del comercio (MANUAL-OPERACION-WALTER): devolver el dinero desde el Panel y cerrar el caso con evidencia.
      const person = await panelLogin(ctx, 'A');
      const refund = await ctx.functions.call('mercadopago-refund', { token: person.token, body: {
        payment_intent_id: held.intent_id, idempotency_key: randomUUID(), reason: 'Sin stock al acreditarse el pago', confirmation: REFUND_CONFIRMATION } });
      await sleep(200);
      await fastForwardQueue(ctx);
      await worker(ctx);
      const open = await all(ctx, `select id, kind from public.payment_discrepancies where checkout_session_id = $1 and status = 'open'`, [last.sessionId]);
      const resolutions = [];
      for (const item of open) {
        const response = await fetch(`${ctx.stack.restUrl}/rpc/resolve_payment_discrepancy`, {
          method: 'POST', headers: { authorization: `Bearer ${person.token}`, 'content-type': 'application/json' },
          body: JSON.stringify({ p_id: item.id, p_resolution: 'refunded_in_provider', p_note: `Devolución total por API, http ${refund.status}` }),
        });
        resolutions.push({ kind: item.kind, http: response.status });
      }
      const closed = await snapshot(ctx, last.sessionId);
      assert.equal(refund.status, 200, `devolución del pago sin stock: ${refund.text}`);
      assert.ok(closed.discrepancies.every((item) => item.status !== 'open'), JSON.stringify(closed.discrepancies));
      assert.equal(ctx.emulator.payments.get(paidLate.id).status, 'refunded');
      return { with_stock: { payment: String(payment.id), session: after.status, orders: after.orders.length },
        without_stock: { payment: String(paidLate.id), session: held.status, intent: held.internal_status, reason: held.security_review_reason,
          discrepancies_before: held.discrepancies, operator_refund_http: refund.status, resolutions,
          intent_after: closed.internal_status, refunded_amount: closed.refunded_amount } };
    },
  },
  {
    id: 'refunds',
    title: 'Devoluciones por API: parcial con centavos, reintento idempotente y total del resto, conciliadas una sola vez',
    async run(ctx) {
      assert.ok(ctx.apro, 'requiere el escenario apro');
      const { purchase, payment, expected } = ctx.apro;
      const person = await panelLogin(ctx, 'A');
      const intent = await snapshot(ctx, purchase.sessionId);
      const partialKey = randomUUID();
      const partial = await ctx.functions.call('mercadopago-refund', { token: person.token, body: {
        payment_intent_id: intent.intent_id, idempotency_key: partialKey, amount: 8.2, reason: 'Faltó un producto', confirmation: REFUND_CONFIRMATION } });
      assert.equal(partial.status, 200, `reembolso parcial de 8,20: ${partial.status} ${partial.text}`);
      const repeated = await ctx.functions.call('mercadopago-refund', { token: person.token, body: {
        payment_intent_id: intent.intent_id, idempotency_key: partialKey, amount: 8.2, reason: 'Faltó un producto', confirmation: REFUND_CONFIRMATION } });
      const rest = money(expected - 8.2);
      const total = await ctx.functions.call('mercadopago-refund', { token: person.token, body: {
        payment_intent_id: intent.intent_id, idempotency_key: randomUUID(), reason: 'Pedido cancelado', confirmation: REFUND_CONFIRMATION } });
      assert.equal(total.status, 200, `reembolso del resto: ${total.status} ${total.text}`);
      await sleep(200);
      await fastForwardQueue(ctx);
      await worker(ctx);
      const refunds = await all(ctx, `select amount::text, status, origin, provider_refund_id is not null as has_provider_id
        from public.payment_refunds where payment_intent_id = $1 order by requested_at`, [intent.intent_id]);
      const posts = ctx.emulator.calls.filter((call) => call.method === 'POST' && call.path === `/v1/payments/${payment.id}/refunds`);
      const after = await snapshot(ctx, purchase.sessionId);
      assert.deepEqual(refunds.map((refund) => [money(refund.amount), refund.status]), [[8.2, 'approved'], [rest, 'approved']]);
      assert.equal(posts.length, 2, 'dos pedidos de reembolso al proveedor, ni uno más');
      assert.equal(money(after.refunded_amount), expected);
      assert.equal(after.internal_status, 'refunded');
      assert.equal(ctx.emulator.payments.get(payment.id).status, 'refunded');
      assert.equal(after.discrepancies.filter((item) => item.status === 'open').length, 0, JSON.stringify(after.discrepancies));
      return { partial: { http: partial.status, amount: 8.2 }, repeated_same_key: { http: repeated.status, code: repeated.json?.code ?? repeated.json?.status },
        rest: { http: total.status, amount: rest }, provider_refund_posts: posts.length, refunds,
        intent: { status: after.internal_status, refunded_amount: after.refunded_amount }, order: after.orders[0] };
    },
  },
  {
    id: 'marketplace_owner_user_id',
    title: 'R-MKT-1: el aviso de un pago marketplace trae el user_id del DUEÑO de la integradora y el pago se acredita igual en el comercio correcto',
    async run(ctx) {
      ctx.emulator.options.notificationUserId = 'owner';
      try {
        const purchase = await startCheckout(ctx, { business: 'B', items: [{ product_id: ctx.ids.products.alfajor, quantity: 2 }] });
        assert.equal(purchase.sent.marketplace, `MP-MKT-${ctx.clientId}`);
        const payment = await ctx.emulator.pay(purchase.preferenceId, { buyerId: ctx.buyers.two, scenario: 'APRO' });
        const webhook = ctx.emulator.deliveries.filter((entry) => entry.dataId === String(payment.id) && entry.shape === 'webhook').at(-1);
        assert.equal(webhook.userId, ctx.application.ownerId);
        const runs = await worker(ctx);
        const after = await snapshot(ctx, purchase.sessionId);
        const receipt = await one(ctx, `select signature_valid, processing_status, seller_business_id from public.payment_webhook_receipts
          where resource_id = $1 and signature_valid order by received_at desc limit 1`, [String(payment.id)]);
        assert.equal(webhook.status, 201, `el webhook firmado tiene que rutearse: ${JSON.stringify(webhook.response)}`);
        assert.equal(receipt?.seller_business_id, ctx.ids.businesses.B);
        assert.equal(after.status, 'completed', JSON.stringify(after));
        assert.equal(after.business_id, ctx.ids.businesses.B);
        assert.equal(after.orders.length, 1);
        return { notification_user_id: webhook.userId, integrator_owner: ctx.application.ownerId, webhook_http: webhook.status,
          routed_business: receipt?.seller_business_id === ctx.ids.businesses.B ? 'B' : receipt?.seller_business_id, worker_runs: runs,
          session: after.status, orders: after.orders.length };
      } finally {
        ctx.emulator.options.notificationUserId = 'seller';
      }
    },
  },
  {
    id: 'isolation',
    title: 'R-MKT-3: un comercio no puede leer ni acreditarse el cobro de otro, aunque el aviso apunte a su vendedor; el cobro queda en quien lo cobró',
    async run(ctx) {
      const ordersA = await ordersOfBusiness(ctx, 'A');
      const purchase = await startCheckout(ctx, { business: 'B', items: [{ product_id: ctx.ids.products.alfajor, quantity: 1 }] });
      const payment = await ctx.emulator.pay(purchase.preferenceId, { buyerId: ctx.buyers.one, scenario: 'APRO', notify: false });
      // Un aviso firmado del pago de B, con la pista de usuario del vendedor A.
      const misleading = await ctx.emulator.notify(payment, 'payment', String(payment.id), 'payment.created', { userId: ctx.sellers.A });
      // El token de A no ve el pago de B (404, como la API real); el de B sí, como su cobrador.
      const readsAsA = ctx.emulator.calls.filter((call) => call.path === `/v1/payments/${payment.id}` && call.subject === ctx.sellers.A);
      const readsAsB = ctx.emulator.calls.filter((call) => call.path === `/v1/payments/${payment.id}` && call.subject === ctx.sellers.B);
      const receipt = await one(ctx, `select seller_business_id from public.payment_webhook_receipts
        where resource_id = $1 and signature_valid order by received_at desc limit 1`, [String(payment.id)]);
      await worker(ctx);
      const after = await snapshot(ctx, purchase.sessionId);
      assert.equal(misleading.status, 201, `el aviso se rutea a quien cobró: ${JSON.stringify(misleading.response)}`);
      assert.equal(receipt?.seller_business_id, ctx.ids.businesses.B, 'nunca al comercio de la pista');
      assert.ok(readsAsA.length >= 1 && readsAsA.every((call) => call.status === 404));
      assert.ok(readsAsB.some((call) => call.status === 200));
      assert.equal(after.status, 'completed', JSON.stringify(after));
      assert.equal(after.business_id, ctx.ids.businesses.B);
      assert.equal(await ordersOfBusiness(ctx, 'A'), ordersA, 'A no recibe ningún pedido');
      // Y la otra mitad del aislamiento: un comercio no puede leer los pagos de otro desde su vínculo.
      const crossRead = await fetch(`${ctx.emulator.url}/v1/payments/${payment.id}`, { headers: { authorization: 'Bearer token-inexistente' } });
      return { misleading_hint_seller: 'A', webhook_http: misleading.status, routed_business: 'B',
        provider_reads_with_token_A: readsAsA.map((call) => call.status), provider_reads_with_token_B: readsAsB.map((call) => call.status),
        orders_business_A_unchanged: ordersA, session_B: after.status, anonymous_read: crossRead.status };
    },
  },
  {
    id: 'webhook_lost_truth_sweep',
    title: 'El aviso nunca llega: el barrido de verdad del proveedor encuentra el pago y crea el pedido una sola vez',
    async run(ctx) {
      const purchase = await startCheckout(ctx, { items: [{ product_id: ctx.ids.products.agua, quantity: 1 }] });
      const payment = await ctx.emulator.pay(purchase.preferenceId, { buyerId: ctx.buyers.two, scenario: 'APRO', notify: false });
      const before = await snapshot(ctx, purchase.sessionId);
      assert.notEqual(before.status, 'completed');
      // El cron que encola sondas al proveedor para los checkouts que se fueron a Mercado Pago (los de más de 90 s).
      await ctx.stack.query(`update public.checkout_sessions set created_at = now() - interval '3 minutes' where id = $1`, [purchase.sessionId]);
      const probes = await one(ctx, 'select public.enqueue_checkout_provider_probes() as n');
      const runs = await worker(ctx);
      let after = await snapshot(ctx, purchase.sessionId);
      if (after.status !== 'completed') {
        // Segunda pasada del cron, como pasaría un minuto después.
        await fastForwardQueue(ctx);
        await one(ctx, 'select public.enqueue_checkout_provider_probes() as n');
        runs.push(...await worker(ctx));
        after = await snapshot(ctx, purchase.sessionId);
      }
      assert.equal(after.status, 'completed', JSON.stringify(after));
      assert.equal(after.provider_payment_id, String(payment.id));
      assert.equal(after.orders.length, 1);
      return { probes_enqueued: probes.n, worker_runs: runs, session: after.status, orders: after.orders.length };
    },
  },
  {
    id: 'last_unit_race',
    title: 'Última unidad: dos compradores a la vez, una sola reserva, sin sobreventa',
    async run(ctx) {
      const before = await stockOf(ctx, 'ultima');
      assert.equal(before, 1);
      const [first, second] = await Promise.all(['one', 'two'].map((buyer) => ctx.functions.call('mercadopago-create-checkout-session', {
        token: customer(ctx, buyer).token, ip: `200.2.2.${buyer.length}`,
        body: checkoutPayload(ctx.ids.businesses.A, [{ product_id: ctx.ids.products.ultima, quantity: 1 }]) })));
      const statuses = [first.status, second.status].sort();
      assert.deepEqual(statuses, [200, 409], `una reserva y un rechazo: ${first.text} / ${second.text}`);
      assert.equal(await stockOf(ctx, 'ultima'), 0);
      const active = await one(ctx, `select count(*)::int as n from public.inventory_reservations where product_id = $1 and status = 'active'`, [ctx.ids.products.ultima]);
      assert.equal(active.n, 1);
      return { responses: [first.status, second.status], stock_after: 0, active_reservations: active.n };
    },
  },
  {
    id: 'tampering',
    title: 'El navegador no decide importes: total, precio o preferencia inyectados se rechazan',
    async run(ctx) {
      const person = customer(ctx, 'three');
      const base = checkoutPayload(ctx.ids.businesses.A, [{ product_id: ctx.ids.products.agua, quantity: 1 }]);
      const withTotal = await ctx.functions.call('mercadopago-create-checkout-session', { token: person.token, body: { ...base, total: 1 } });
      const withPrice = await ctx.functions.call('mercadopago-create-checkout-session', { token: person.token,
        body: { ...base, client_request_id: `bench${randomUUID().replaceAll('-', '')}`, items: [{ product_id: ctx.ids.products.agua, quantity: 1, unit_price: 1 }] } });
      const anonymous = await ctx.functions.call('mercadopago-create-checkout-session', { body: base });
      assert.equal(withTotal.status, 409);
      assert.equal(withPrice.status, 409);
      assert.equal(anonymous.status, 401);
      // Otro cliente no puede ver ni preparar el pago de un checkout ajeno.
      assert.ok(ctx.apro, 'requiere el escenario apro');
      const foreign = await ctx.functions.call('mercadopago-checkout-status', { token: person.token, body: { checkout_session_id: ctx.apro.purchase.sessionId } });
      const foreignPreference = await ctx.functions.call('mercadopago-create-preference', { token: person.token, body: { checkout_session_id: ctx.apro.purchase.sessionId } });
      assert.equal(foreign.status, 404);
      assert.equal(foreignPreference.status, 409);
      return { client_total: withTotal.status, client_unit_price: withPrice.status, without_session: anonymous.status,
        foreign_status: foreign.status, foreign_preference: foreignPreference.status };
    },
  },
  {
    id: 'token_refresh',
    title: 'Token del vendedor vencido: se renueva con el refresh (que rota) y el cobro sigue sin reconectar',
    async run(ctx) {
      ctx.emulator.expireAccessTokens(ctx.sellers.A);
      await ctx.stack.query(`update public.mp_seller_connections set expires_at = now() - interval '1 minute' where business_id = $1`, [ctx.ids.businesses.A]);
      const purchase = await startCheckout(ctx, { items: [{ product_id: ctx.ids.products.agua, quantity: 1 }] });
      const refreshed = await one(ctx, `select status, expires_at > now() + interval '1 day' as renewed, last_refresh_at is not null as refreshed
        from public.mp_seller_connections where business_id = $1`, [ctx.ids.businesses.A]);
      const grants = ctx.emulator.calls.filter((call) => call.path === '/oauth/token').map((call) => call.status);
      const payment = await ctx.emulator.pay(purchase.preferenceId, { buyerId: ctx.buyers.one, scenario: 'APRO' });
      await worker(ctx);
      const after = await snapshot(ctx, purchase.sessionId);
      assert.equal(refreshed.status, 'connected');
      assert.equal(refreshed.renewed, true);
      assert.equal(after.status, 'completed', JSON.stringify(after));
      return { connection: refreshed, oauth_token_calls: grants, payment: String(payment.id), session: after.status };
    },
  },
  {
    id: 'activation_assistant',
    title: 'El asistente de activación contra las funciones reales: dominio, callback, webhook, CORS, worker, integradora y clave del webhook',
    async run(ctx) {
      const { networkChecks, integratorCheck, webhookSecretCheck } = await import('../mercadopago/asistente-activacion.mjs');
      const target = { name: ctx.environment === 'production' ? 'production' : 'qa', ref: ctx.ref, origin: ctx.origin,
        mercadoPagoApplicationId: ctx.clientId, provisioned: true };
      // El sitio no forma parte del banco: se sirve lo mínimo que publica Deploy production.
      const site = { '/': ['<!doctype html><title>La Taba</title>', 'text/html'],
        '/runtime-config.js': [`window.TABA_RUNTIME_CONFIG = { supabaseUrl: 'https://${ctx.ref}.supabase.co' };`, 'text/javascript'],
        '/release-identity.json': [JSON.stringify({ cacheName: 'la-taba-runtime-v168-pago-retorno' }), 'application/json'] };
      const routed = async (url, init = {}) => {
        const target2 = new URL(url);
        if (target2.origin === `https://${ctx.ref}.supabase.co`) {
          return fetch(`${ctx.functions.gateway}${target2.pathname}${target2.search}`, { ...init, headers: { ...(init.headers || {}), 'x-forwarded-for': '190.0.0.77' } });
        }
        if (target2.origin === 'https://api.mercadopago.com') return fetch(`${ctx.emulator.url}${target2.pathname}${target2.search}`, init);
        if (target2.origin === ctx.origin && site[target2.pathname]) {
          return new Response(site[target2.pathname][0], { status: 200, headers: { 'content-type': site[target2.pathname][1] } });
        }
        throw new Error(`destino ajeno al banco: ${target2.origin}`);
      };
      const receiptsBefore = await one(ctx, 'select count(*)::int as n from public.payment_webhook_receipts');
      const network = await networkChecks(target, routed);
      assert.ok(network.ok, JSON.stringify(network.rows.filter((row) => !row.ok)));
      const integrator = await integratorCheck(target, ctx.application.clientSecret, routed);
      assert.equal(integrator.ok, true, JSON.stringify(integrator));
      const wrongIntegrator = await integratorCheck(target, 'un-client-secret-que-no-es-el-de-la-app', routed);
      assert.equal(wrongIntegrator.ok, false);
      const good = await webhookSecretCheck(target, ctx.application.webhookSecret, routed);
      assert.equal(good.verdict, 'clave_coincide', JSON.stringify(good));
      const receiptsAfterGood = await one(ctx, 'select count(*)::int as n from public.payment_webhook_receipts');
      assert.equal(receiptsAfterGood.n, receiptsBefore.n, 'las sondas de red y la de la clave correcta no guardan nada');
      const bad = await webhookSecretCheck(target, 'b'.repeat(40), routed);
      assert.equal(bad.verdict, 'clave_distinta', JSON.stringify(bad));
      const receiptsAfterBad = await one(ctx, 'select count(*)::int as n from public.payment_webhook_receipts');
      assert.equal(receiptsAfterBad.n, receiptsBefore.n + 1, 'la clave equivocada deja exactamente la fila que el asistente avisa');
      return { network: network.rows.map(({ id, observed, ok }) => ({ id, observed, ok })),
        integrator: { owner_id: integrator.owner_id, owner_is_test_user: integrator.owner_is_test_user, wrong_secret: wrongIntegrator.step },
        webhook_secret: { right: good.verdict, wrong: bad.verdict }, receipts_written: { probes_and_right_key: 0, wrong_key: 1 } };
    },
  },
  {
    id: 'reconciliation_clean',
    title: 'Conciliación final: cada cobro aprobado tiene un pedido, cada pedido un cobro, y no quedan discrepancias abiertas',
    async run(ctx) {
      await fastForwardQueue(ctx);
      const runs = await worker(ctx);
      const open = await all(ctx, `select kind, severity, count(*)::int as n from public.payment_discrepancies where status = 'open' group by 1, 2`);
      const unpaidOrders = await one(ctx, `select count(*)::int as n from public.orders o where o.payment_method = 'mercadopago'
        and not exists (select 1 from public.payment_intents pi where pi.order_id = o.id and pi.paid_amount is not null)`);
      const paidWithoutOrder = await one(ctx, `select count(*)::int as n from public.payment_intents
        where internal_status in ('approved_order_pending') and order_id is null`);
      const duplicateOrders = await one(ctx, `select count(*)::int as n from (select order_id from public.payment_intents
        where order_id is not null group by order_id having count(*) > 1) d`);
      const deadJobs = await all(ctx, `select topic, status, last_error, count(*)::int as n from public.payment_outbox
        where status not in ('completed') group by 1, 2, 3`);
      assert.equal(unpaidOrders.n, 0);
      assert.equal(paidWithoutOrder.n, 0);
      assert.equal(duplicateOrders.n, 0);
      assert.deepEqual(open, [], JSON.stringify(open));
      return { open_discrepancies: open, orders_without_payment: unpaidOrders.n, payments_without_order: paidWithoutOrder.n,
        duplicate_orders: duplicateOrders.n, outbox_not_completed: deadJobs, final_worker_runs: runs };
    },
  },
];
