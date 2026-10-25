/*
 * Emulador de la API de Mercado Pago para el banco de cobros. NO es Mercado Pago y nada de lo que pasa acá prueba que
 * Mercado Pago se comporte así: es un contrato ejecutable con el que se ejercita, de punta a punta, TODO el código de
 * La Taba (funciones Edge reales, PostgREST real, base y migraciones reales) sin red y sin dinero.
 *
 * Las formas salen de la evidencia medida contra el Mercado Pago real en QA (docs/audit/mercadopago-final-20261023/
 * causa-raiz-20261023: preferencias `<collector>-<uuid>`, `marketplace` NONE o `MP-MKT-<aplicación>`, pagos de 12
 * dígitos con `live_mode: true` aun entre usuarios de prueba, `preference_id` ausente en el pago y alcanzable por la
 * orden, OTHE → rejected/cc_rejected_other_reason, CONT → in_process/pending_contingency, IPN `?id&topic` además del
 * webhook `?data.id&type`) y de la documentación oficial (firma `id:<data.id>;request-id:<x-request-id>;ts:<ts>;`).
 *
 * Lo que el emulador NO decide por La Taba: cada lectura de un pago exige el token del vendedor que lo cobró, igual
 * que la API real; un token de otro vendedor recibe 404.
 */
import http from 'node:http';
import { createHash, createHmac, randomBytes, randomUUID } from 'node:crypto';

const MP_DATE = (ms) => {
  // Mercado Pago responde en hora de Argentina con milisegundos: 2026-10-23T15:44:56.000-04:00 (medido).
  const local = new Date(ms - 3 * 3600_000).toISOString().replace('Z', '');
  return `${local}-03:00`;
};
const sha256 = (value) => createHash('sha256').update(value).digest('base64url');
const json = (status, body, headers = {}) => ({ status, body, headers });
const notFound = (what) => json(404, { message: `${what} not found`, error: 'not_found', status: 404, cause: [{ code: 2000, description: `${what} not found` }] });
const unauthorized = () => json(401, { message: 'invalid access token', error: 'unauthorized', status: 401, cause: [{ code: 2, description: 'invalid access token' }] });

/** Escenarios de las tarjetas de prueba oficiales (titular de la tarjeta). */
export const CARD_SCENARIOS = Object.freeze({
  APRO: { status: 'approved', status_detail: 'accredited' },
  OTHE: { status: 'rejected', status_detail: 'cc_rejected_other_reason' },
  CONT: { status: 'in_process', status_detail: 'pending_contingency' },
  CALL: { status: 'rejected', status_detail: 'cc_rejected_call_for_authorize' },
  FUND: { status: 'rejected', status_detail: 'cc_rejected_insufficient_amount' },
  SECU: { status: 'rejected', status_detail: 'cc_rejected_bad_filled_security_code' },
  EXPI: { status: 'rejected', status_detail: 'cc_rejected_bad_filled_date' },
  FORM: { status: 'rejected', status_detail: 'cc_rejected_bad_filled_other' },
  // Medio offline (Rapipago / Pago Fácil): queda pendiente hasta que se paga en el local.
  TICKET: { status: 'pending', status_detail: 'pending_waiting_payment', payment_method_id: 'rapipago', payment_type_id: 'ticket' },
});

export class MercadoPagoEmulator {
  /**
   * @param {object} options
   * @param {'test'|'production'} options.environment
   * @param {{clientId:string, clientSecret:string, ownerId:number, webhookSecret:string}} options.application
   * @param {Array<{id:number, nickname:string, email:string, kind:'seller'|'buyer'|'owner'}>} options.users
   * @param {(url:string, init:RequestInit) => Promise<Response>} options.deliver  entrega de notificaciones
   */
  constructor({ environment, application, users, deliver }) {
    this.environment = environment;
    this.application = application;
    this.deliver = deliver;
    this.users = new Map(users.map((user) => [user.id, user]));
    this.tokens = new Map();
    this.codes = new Map();
    this.preferences = new Map();
    this.payments = new Map();
    this.merchantOrders = new Map();
    this.chargebacks = new Map();
    this.idempotency = new Map();
    this.calls = [];
    this.deliveries = [];
    this.nextPaymentId = 190000000000 + Math.floor(Math.random() * 1000) * 1000;
    this.nextOrderId = 46000000000 + Math.floor(Math.random() * 1000) * 1000;
    this.nextRefundId = 3500000000 + Math.floor(Math.random() * 1000) * 1000;
    this.nextEventId = 120000000000;
    // Comportamientos configurables, para reproducir lo que se midió en QA y lo que todavía no se pudo medir.
    this.options = {
      // R-MKT-1: qué `user_id` trae el cuerpo del webhook de un pago marketplace. 'seller' (lo que dice la
      // documentación) u 'owner' (el dueño de la aplicación integradora, el caso que QA nunca pudo descartar).
      notificationUserId: 'seller',
      // QA 23/10: «401 Unauthorized use of live credentials», cause 7, en todo reembolso por API con usuarios de prueba.
      refundsBlockedInTest: false,
      // El dueño de la integradora lee con su propio token los pagos marketplace (no documentado: por defecto no).
      ownerReadsMarketplacePayments: false,
      // Firma de las notificaciones: 'valid' (clave de la aplicación) o 'foreign' (clave que La Taba no tiene, como
      // las de prueba de Checkout Pro firmadas por la aplicación de prueba autoaprovisionada).
      signature: 'valid',
      // Además del webhook, el feed IPN viejo (`?topic=payment&id=` y `?topic=merchant_order&id=`), sin firma válida.
      legacyIpn: true,
    };
  }

  async start() {
    this.server = http.createServer((request, response) => this.#handle(request, response));
    await new Promise((resolve) => this.server.listen(0, '127.0.0.1', resolve));
    this.url = `http://127.0.0.1:${this.server.address().port}`;
    return this.url;
  }

  async stop() {
    if (!this.server) return;
    // Las conexiones keep-alive del host de funciones mantendrían vivo el servidor para siempre.
    this.server.closeAllConnections();
    await new Promise((resolve) => this.server.close(resolve));
  }

  // ---------------------------------------------------------------- control del banco (no es API de Mercado Pago)

  /** El vendedor inicia sesión en Mercado Pago y autoriza la aplicación: devuelve la URL a la que lo redirige. */
  consent(authorizationUrl, sellerId, { deny = false } = {}) {
    const url = new URL(authorizationUrl);
    if (url.origin !== 'https://auth.mercadopago.com.ar' || url.pathname !== '/authorization') throw new Error('authorization URL ajena');
    const params = url.searchParams;
    if (params.get('client_id') !== this.application.clientId || params.get('response_type') !== 'code' ||
      params.get('platform_id') !== 'mp' || !params.get('state') || !params.get('redirect_uri')) {
      throw new Error('authorization URL inválida');
    }
    if (params.get('code_challenge_method') !== 'S256' || !/^[\w-]{43}$/.test(params.get('code_challenge') || '')) {
      throw new Error('PKCE S256 obligatorio');
    }
    const redirect = new URL(params.get('redirect_uri'));
    redirect.searchParams.set('state', params.get('state'));
    if (deny) {
      redirect.searchParams.set('error', 'access_denied');
      return redirect.toString();
    }
    const seller = this.#user(sellerId);
    const code = `TG-${randomBytes(12).toString('hex')}-${seller.id}`;
    this.codes.set(code, {
      clientId: this.application.clientId, sellerId: seller.id, redirectUri: params.get('redirect_uri'),
      challenge: params.get('code_challenge'), expiresAt: Date.now() + 10 * 60_000, used: false,
    });
    redirect.searchParams.set('code', code);
    return redirect.toString();
  }

  /** El comprador paga una preferencia en Checkout Pro. Devuelve el pago creado. */
  async pay(preferenceId, { buyerId, scenario = 'APRO', paymentMethod = 'master', notify = true } = {}) {
    const preference = this.preferences.get(preferenceId);
    if (!preference) throw new Error('preferencia inexistente');
    if (preference.expires && Date.parse(preference.expiration_date_to) <= Date.now()) {
      throw new Error('PREFERENCE_EXPIRED');
    }
    const buyer = this.#user(buyerId);
    const outcome = CARD_SCENARIOS[scenario];
    if (!outcome) throw new Error(`escenario desconocido ${scenario}`);
    const excluded = (preference.payment_methods?.excluded_payment_types || []).map((type) => type.id);
    if (excluded.includes(outcome.payment_type_id || (paymentMethod === 'account_money' ? 'account_money' : 'credit_card'))) {
      throw new Error('PAYMENT_TYPE_EXCLUDED');
    }
    const now = Date.now();
    const amount = Number(preference.items.reduce((sum, item) => sum + item.unit_price * item.quantity, 0).toFixed(2));
    let order = [...this.merchantOrders.values()].find((candidate) => candidate.preference_id === preferenceId);
    if (!order) {
      order = {
        id: this.nextOrderId++, preference_id: preferenceId, external_reference: preference.external_reference,
        collector: { id: preference.collector_id }, marketplace: preference.marketplace, payments: [], status: 'opened',
        order_status: 'payment_required', total_amount: amount, paid_amount: 0, date_created: MP_DATE(now), last_updated: MP_DATE(now),
      };
      this.merchantOrders.set(order.id, order);
    }
    const id = this.nextPaymentId++;
    const fee = Number(preference.marketplace_fee || 0);
    const payment = {
      id, date_created: MP_DATE(now), date_last_updated: MP_DATE(now),
      date_approved: outcome.status === 'approved' ? MP_DATE(now + 1000) : null,
      money_release_date: outcome.status === 'approved' ? MP_DATE(now + 14 * 86400_000) : null,
      operation_type: 'regular_payment', status: outcome.status, status_detail: outcome.status_detail,
      payment_method_id: outcome.payment_method_id || paymentMethod,
      payment_type_id: outcome.payment_type_id || (paymentMethod === 'account_money' ? 'account_money' : 'credit_card'),
      currency_id: 'ARS', transaction_amount: amount, transaction_amount_refunded: 0, installments: 1,
      description: preference.items[0]?.title || '', live_mode: true, captured: true, binary_mode: Boolean(preference.binary_mode),
      collector_id: preference.collector_id, marketplace: preference.marketplace,
      payer: { id: buyer.id, email: buyer.email, identification: { type: 'DNI', number: '12345678' } },
      external_reference: preference.external_reference, metadata: preference.metadata || {},
      order: { id: order.id, type: 'mercadopago' }, refunds: [],
      fee_details: [
        { type: 'mercadopago_fee', amount: Number((amount * 0.0629).toFixed(2)), fee_payer: 'collector' },
        ...(fee > 0 ? [{ type: 'application_fee', amount: fee, fee_payer: 'collector' }] : []),
      ],
      statement_descriptor: preference.statement_descriptor || null,
      notification_url: preference.notification_url,
    };
    this.payments.set(id, payment);
    order.payments.push({ id, status: payment.status, transaction_amount: amount });
    this.#refreshOrder(order);
    if (notify) await this.notifyPayment(id, 'payment.created');
    return payment;
  }

  /** Mercado Pago resuelve un pago pendiente (CONT acreditado o rechazado, ticket pagado). */
  async settle(paymentId, status = 'approved', { notify = true } = {}) {
    const payment = this.payments.get(Number(paymentId));
    if (!payment) throw new Error('pago inexistente');
    const now = Date.now();
    payment.status = status;
    payment.status_detail = status === 'approved' ? 'accredited' : status === 'rejected' ? 'cc_rejected_other_reason' : status;
    payment.date_last_updated = MP_DATE(now);
    if (status === 'approved') payment.date_approved = MP_DATE(now);
    this.#refreshOrder(this.merchantOrders.get(payment.order.id));
    if (notify) await this.notifyPayment(paymentId, 'payment.updated');
    return payment;
  }

  /** Un contracargo sobre un pago aprobado. */
  async chargeback(paymentId, { notify = true } = {}) {
    const payment = this.payments.get(Number(paymentId));
    const id = `${payment.id}${randomBytes(2).toString('hex')}`;
    const now = Date.now();
    this.chargebacks.set(id, {
      id, payments: [payment.id], currency: 'ARS', amount: payment.transaction_amount, coverage_applied: false,
      coverage_eligible: true, documentation_required: true, documentation_status: 'pending', status: 'open',
      date_created: MP_DATE(now), date_last_updated: MP_DATE(now), collector_id: payment.collector_id, live_mode: true,
    });
    payment.status = 'charged_back';
    payment.status_detail = 'in_process';
    payment.date_last_updated = MP_DATE(now);
    if (notify) {
      await this.notify(payment, 'chargebacks', id, 'chargebacks.created');
      await this.notifyPayment(paymentId, 'payment.updated');
    }
    return id;
  }

  /** Entrega (de nuevo, si se quiere) la notificación firmada de un pago. */
  async notifyPayment(paymentId, action = 'payment.updated', { requestId, eventId } = {}) {
    const payment = this.payments.get(Number(paymentId));
    const result = await this.notify(payment, 'payment', String(payment.id), action, { requestId, eventId });
    if (this.options.legacyIpn) {
      await this.#deliverIpn(payment, 'payment', String(payment.id));
      await this.#deliverIpn(payment, 'merchant_order', String(payment.order.id));
    }
    return result;
  }

  async notify(payment, type, dataId, action, { requestId = randomUUID(), eventId = this.nextEventId++, userId, timestamp } = {}) {
    const target = new URL(payment.notification_url);
    target.searchParams.set('data.id', dataId);
    target.searchParams.set('type', type);
    const ts = String(timestamp ?? Math.floor(Date.now() / 1000));
    const manifest = `id:${dataId.toLowerCase()};request-id:${requestId};ts:${ts};`;
    // 'foreign': una clave al azar que La Taba no conoce (como la de la aplicación de prueba autoaprovisionada).
    this.foreignKey ??= randomBytes(32).toString('hex');
    const secret = this.options.signature === 'valid' ? this.application.webhookSecret : this.foreignKey;
    const v1 = createHmac('sha256', secret).update(manifest).digest('hex');
    const sender = userId ?? (this.options.notificationUserId === 'owner' && payment.marketplace !== 'NONE'
      ? this.application.ownerId : payment.collector_id);
    const body = {
      action, api_version: 'v1', data: { id: dataId }, date_created: MP_DATE(Date.now()), id: eventId,
      live_mode: true, type, user_id: sender,
    };
    return this.#send(target.toString(), {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-signature': `ts=${ts},v1=${v1}`, 'x-request-id': requestId,
        'user-agent': 'MercadoPago WebHook v1.0 payment' },
      body: JSON.stringify(body),
    }, { type, dataId, action, userId: sender, requestId, shape: 'webhook' });
  }

  async #deliverIpn(payment, topic, id) {
    const target = new URL(payment.notification_url);
    target.searchParams.set('id', id);
    target.searchParams.set('topic', topic);
    const ts = String(Math.floor(Date.now() / 1000));
    return this.#send(target.toString(), {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-signature': `ts=${ts},v1=${'0'.repeat(64)}`, 'x-request-id': randomUUID() },
      body: JSON.stringify({ resource: id, topic }),
    }, { type: topic, dataId: id, shape: 'legacy_ipn' });
  }

  async #send(url, init, meta) {
    const entry = { at: new Date().toISOString(), url, ...meta };
    try {
      const response = await this.deliver(url, init);
      entry.status = response.status;
      entry.response = await response.json().catch(() => null);
    } catch (error) {
      entry.status = 0;
      entry.error = String(error?.message || error);
    }
    this.deliveries.push(entry);
    return entry;
  }

  #refreshOrder(order) {
    if (!order) return;
    order.payments = order.payments.map((summary) => {
      const payment = this.payments.get(summary.id);
      return { id: payment.id, status: payment.status, transaction_amount: payment.transaction_amount };
    });
    const paid = order.payments.filter((summary) => summary.status === 'approved')
      .reduce((sum, summary) => sum + summary.transaction_amount, 0);
    order.paid_amount = paid;
    order.order_status = paid >= order.total_amount ? 'paid' : 'payment_required';
    order.status = paid >= order.total_amount ? 'closed' : 'opened';
    order.last_updated = MP_DATE(Date.now());
  }

  #user(id) {
    const user = this.users.get(Number(id));
    if (!user) throw new Error(`usuario ${id} inexistente`);
    return user;
  }

  #issue(userId, kind, clientId) {
    const token = `APP_USR-${clientId}-${new Date().toISOString().slice(2, 10).replaceAll('-', '')}-${randomBytes(16).toString('hex')}-${userId}`;
    const refresh = kind === 'oauth' ? `TG-${randomBytes(12).toString('hex')}-${userId}` : null;
    const expiresIn = kind === 'oauth' ? 15_552_000 : 21_600;
    this.tokens.set(token, { userId, kind, clientId, expiresAt: Date.now() + expiresIn * 1000, revoked: false });
    if (refresh) this.tokens.set(refresh, { userId, kind: 'refresh', clientId, revoked: false });
    return { token, refresh, expiresIn };
  }

  /** Revoca los tokens de un vendedor (desvinculó la aplicación desde su cuenta). */
  revokeSeller(sellerId) {
    for (const entry of this.tokens.values()) if (entry.userId === Number(sellerId)) entry.revoked = true;
  }

  /** Vence el access token vigente de un vendedor (el refresh sigue sirviendo). */
  expireAccessTokens(sellerId) {
    for (const entry of this.tokens.values()) {
      if (entry.userId === Number(sellerId) && entry.kind === 'oauth') entry.expiresAt = Date.now() - 1000;
    }
  }

  // ---------------------------------------------------------------- API

  async #handle(request, response) {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    const raw = Buffer.concat(chunks).toString('utf8');
    const url = new URL(request.url, 'https://api.mercadopago.com');
    const auth = /^Bearer\s+(\S+)$/i.exec(request.headers.authorization || '')?.[1] || '';
    let result;
    try {
      result = await this.#route(request.method, url, raw, auth, request.headers['x-idempotency-key'] || '');
    } catch (error) {
      result = json(500, { message: String(error?.message || error), error: 'internal_error', status: 500 });
    }
    const entry = this.tokens.get(auth);
    this.calls.push({ method: request.method, path: url.pathname, query: url.search, status: result.status,
      subject: entry ? entry.userId : null, idempotencyKey: request.headers['x-idempotency-key'] || null,
      body: raw && request.method !== 'GET' && !url.pathname.startsWith('/oauth') ? safeJson(raw) : undefined });
    const requestId = randomUUID();
    response.writeHead(result.status, { 'content-type': 'application/json', 'x-request-id': requestId, ...result.headers });
    response.end(result.body === undefined ? '' : JSON.stringify(result.body));
  }

  #subject(auth) {
    const entry = this.tokens.get(auth);
    if (!entry || entry.revoked || entry.kind === 'refresh' || !(entry.expiresAt > Date.now())) return null;
    return entry;
  }

  async #route(method, url, raw, auth, idempotencyKey) {
    const path = url.pathname;
    if (method === 'POST' && path === '/oauth/token') return this.#oauthToken(safeJson(raw) || Object.fromEntries(new URLSearchParams(raw)));
    const subject = this.#subject(auth);
    if (!subject) return unauthorized();
    if (method === 'GET' && path === '/users/me') {
      const user = this.#user(subject.userId);
      return json(200, {
        id: user.id, nickname: user.nickname, first_name: user.first_name || user.nickname, last_name: user.last_name || '',
        email: user.email, site_id: 'MLA', country_id: 'AR', user_type: 'normal',
        tags: this.environment === 'test' ? ['test_user', 'normal'] : ['normal'],
      });
    }
    // Idempotencia: misma clave, mismo autor, misma operación → la misma respuesta (documentado para pagos,
    // preferencias y reembolsos). Nunca se ejecuta dos veces.
    const replayKey = idempotencyKey && method !== 'GET' ? `${subject.userId}:${method}:${path}:${idempotencyKey}` : '';
    if (replayKey && this.idempotency.has(replayKey)) return this.idempotency.get(replayKey);
    const result = await this.#api(method, path, url, raw, subject);
    if (replayKey && result.status < 500) this.idempotency.set(replayKey, result);
    return result;
  }

  #oauthToken(body) {
    if (body.client_id !== this.application.clientId || body.client_secret !== this.application.clientSecret) {
      return json(400, { message: 'invalid client_id or client_secret', error: 'invalid_client', status: 400 });
    }
    if (body.grant_type === 'client_credentials') {
      const issued = this.#issue(this.application.ownerId, 'client_credentials', body.client_id);
      return json(200, { access_token: issued.token, token_type: 'Bearer', expires_in: issued.expiresIn,
        scope: 'offline_access payments read write', user_id: this.application.ownerId, live_mode: true });
    }
    if (body.grant_type === 'authorization_code') {
      const grant = this.codes.get(body.code);
      if (!grant || grant.used || grant.expiresAt < Date.now() || grant.redirectUri !== body.redirect_uri ||
        sha256(String(body.code_verifier || '')) !== grant.challenge) {
        return json(400, { message: 'invalid_grant', error: 'invalid_grant', status: 400 });
      }
      grant.used = true;
      return this.#grant(grant.sellerId, body);
    }
    if (body.grant_type === 'refresh_token') {
      const entry = this.tokens.get(body.refresh_token);
      if (!entry || entry.kind !== 'refresh' || entry.revoked) {
        return json(400, { message: 'invalid_grant', error: 'invalid_grant', status: 400 });
      }
      entry.revoked = true; // el refresh rota
      return this.#grant(entry.userId, body);
    }
    return json(400, { message: 'unsupported_grant_type', error: 'unsupported_grant_type', status: 400 });
  }

  #grant(userId, body) {
    if (body.test_token === true || body.test_token === 'true') {
      // Credencial de sandbox vieja: La Taba la rechaza (seller-oauth.ts isSandboxAccessToken).
      return json(200, { access_token: `TEST-${randomBytes(16).toString('hex')}-${userId}`, token_type: 'Bearer', expires_in: 15_552_000,
        scope: 'offline_access payments read write', user_id: userId, refresh_token: `TG-${randomBytes(8).toString('hex')}`, live_mode: false });
    }
    const issued = this.#issue(userId, 'oauth', body.client_id);
    return json(200, { access_token: issued.token, token_type: 'Bearer', expires_in: issued.expiresIn,
      scope: 'offline_access payments read write', user_id: userId, refresh_token: issued.refresh,
      public_key: `APP_USR-${randomUUID()}`, live_mode: true });
  }

  async #api(method, path, url, raw, subject) {
    let match;
    if (method === 'POST' && path === '/checkout/preferences') return this.#createPreference(safeJson(raw), subject);
    if (method === 'GET' && path === '/checkout/preferences/search') {
      const reference = url.searchParams.get('external_reference');
      const elements = [...this.preferences.values()]
        .filter((preference) => preference.collector_id === subject.userId && (!reference || preference.external_reference === reference))
        .map((preference) => ({ id: preference.id, external_reference: preference.external_reference, collector_id: preference.collector_id,
          client_id: preference.client_id, date_created: preference.date_created, expires: preference.expires }));
      return json(200, { elements, next_offset: elements.length, total: elements.length });
    }
    if (method === 'GET' && (match = /^\/checkout\/preferences\/([^/]+)$/.exec(path))) {
      const preference = this.preferences.get(decodeURIComponent(match[1]));
      if (!preference || preference.collector_id !== subject.userId) return notFound('Preference');
      return json(200, preference);
    }
    if (method === 'GET' && path === '/v1/payments/search') return this.#searchPayments(url, subject);
    if ((match = /^\/v1\/payments\/(\d+)$/.exec(path))) {
      const payment = this.#readablePayment(match[1], subject);
      if (!payment) return notFound('Payment');
      if (method === 'GET') return json(200, payment);
      if (method === 'PUT') return this.#updatePayment(payment, safeJson(raw));
    }
    if ((match = /^\/v1\/payments\/(\d+)\/refunds$/.exec(path))) {
      const payment = this.#readablePayment(match[1], subject);
      if (!payment) return notFound('Payment');
      if (method === 'GET') return json(200, payment.refunds);
      if (method === 'POST') return this.#refund(payment, safeJson(raw) || {});
    }
    if (method === 'GET' && (match = /^\/v1\/payments\/(\d+)\/refunds\/(\d+)$/.exec(path))) {
      const payment = this.#readablePayment(match[1], subject);
      const refund = payment?.refunds.find((candidate) => String(candidate.id) === match[2]);
      return refund ? json(200, refund) : notFound('Refund');
    }
    if (method === 'GET' && (match = /^\/merchant_orders\/(\d+)$/.exec(path))) {
      const order = this.merchantOrders.get(Number(match[1]));
      if (!order || order.collector.id !== subject.userId) return notFound('Merchant Order');
      return json(200, order);
    }
    if (method === 'GET' && (match = /^\/v1\/chargebacks\/(\w+)$/.exec(path))) {
      const chargeback = this.chargebacks.get(match[1]);
      if (!chargeback || chargeback.collector_id !== subject.userId) return notFound('Chargeback');
      return json(200, chargeback);
    }
    return json(404, { message: `resource ${method} ${path} not found`, error: 'not_found', status: 404 });
  }

  #readablePayment(id, subject) {
    const payment = this.payments.get(Number(id));
    if (!payment) return null;
    if (payment.collector_id === subject.userId) return payment;
    if (this.options.ownerReadsMarketplacePayments && payment.marketplace !== 'NONE' && subject.userId === this.application.ownerId) return payment;
    return null;
  }

  #createPreference(body, subject) {
    const fail = (message) => json(400, { message, error: 'bad_request', status: 400, cause: [] });
    if (!body || typeof body !== 'object') return fail('invalid body');
    if (subject.kind !== 'oauth' && subject.kind !== 'client_credentials') return fail('invalid credentials');
    const items = Array.isArray(body.items) ? body.items : [];
    if (!items.length) return fail('items needed');
    for (const item of items) {
      if (typeof item.title !== 'string' || !item.title.trim()) return fail('item.title needed');
      if (!Number.isInteger(item.quantity) || item.quantity < 1) return fail('item.quantity invalid');
      if (typeof item.unit_price !== 'number' || !(item.unit_price > 0)) return fail('item.unit_price invalid');
      if (item.currency_id !== 'ARS') return fail('item.currency_id invalid');
    }
    if (body.notification_url && !/^https:\/\//.test(body.notification_url)) return fail('notification_url must be https');
    if (body.auto_return && !body.back_urls?.success) return fail('auto_return invalid. back_url.success must be defined');
    if (typeof body.external_reference === 'string' && body.external_reference.length > 256) return fail('external_reference too long');
    const total = items.reduce((sum, item) => sum + item.unit_price * item.quantity, 0);
    const collector = subject.userId;
    // Con un token OAuth de la aplicación de OTRO dueño, el pago es marketplace (medido: MP-MKT-<aplicación>).
    const marketplace = subject.kind === 'oauth' && collector !== this.application.ownerId ? `MP-MKT-${subject.clientId}` : 'NONE';
    const fee = body.marketplace_fee === undefined ? 0 : Number(body.marketplace_fee);
    if (!Number.isFinite(fee) || fee < 0 || fee >= total) return fail('marketplace_fee invalid');
    if (fee > 0 && marketplace === 'NONE') return fail('marketplace_fee requires a marketplace preference');
    const id = `${collector}-${randomUUID()}`;
    const now = Date.now();
    const preference = {
      id, collector_id: collector, client_id: subject.clientId, marketplace, marketplace_fee: fee, operation_type: 'regular_payment',
      site_id: 'MLA', date_created: MP_DATE(now), items: items.map((item) => ({ ...item, description: item.description ?? '' })),
      payer: body.payer || {}, back_urls: body.back_urls || {}, auto_return: body.auto_return || '',
      notification_url: body.notification_url || null, external_reference: body.external_reference || '',
      expires: body.expires === true, expiration_date_from: body.expiration_date_from || null,
      expiration_date_to: body.expiration_date_to || null, metadata: body.metadata || {}, payment_methods: body.payment_methods || {},
      statement_descriptor: body.statement_descriptor || null, binary_mode: Boolean(body.binary_mode),
      init_point: `https://www.mercadopago.com.ar/checkout/v1/redirect?pref_id=${id}`,
      sandbox_init_point: `https://sandbox.mercadopago.com.ar/checkout/v1/redirect?pref_id=${id}`,
    };
    this.preferences.set(id, preference);
    return json(201, preference);
  }

  #searchPayments(url, subject) {
    const params = url.searchParams;
    let results = [...this.payments.values()].filter((payment) => payment.collector_id === subject.userId);
    if (params.get('external_reference')) results = results.filter((payment) => payment.external_reference === params.get('external_reference'));
    const range = params.get('range');
    if (range === 'date_last_updated') {
      const begin = Date.parse(params.get('begin_date') || '');
      const end = Date.parse(params.get('end_date') || '');
      results = results.filter((payment) => {
        const at = Date.parse(payment.date_last_updated);
        return (!Number.isFinite(begin) || at >= begin) && (!Number.isFinite(end) || at <= end);
      });
    }
    const sortKey = params.get('sort') || 'date_created';
    const direction = params.get('criteria') === 'desc' ? -1 : 1;
    results.sort((left, right) => direction * (Date.parse(left[sortKey]) - Date.parse(right[sortKey]) || left.id - right.id));
    const limit = Math.min(Number(params.get('limit') || 30), 100);
    const offset = Number(params.get('offset') || 0);
    return json(200, { paging: { total: results.length, limit, offset }, results: results.slice(offset, offset + limit) });
  }

  async #updatePayment(payment, body) {
    if (body?.status !== 'cancelled') return json(400, { message: 'invalid status', error: 'bad_request', status: 400 });
    if (!['pending', 'in_process', 'authorized'].includes(payment.status)) {
      return json(400, { message: 'Invalid action for the payment status', error: 'bad_request', status: 400, cause: [{ code: 2063, description: 'invalid status' }] });
    }
    payment.status = 'cancelled';
    payment.status_detail = 'by_collector';
    payment.date_last_updated = MP_DATE(Date.now());
    this.#refreshOrder(this.merchantOrders.get(payment.order.id));
    queueMicrotask(() => this.notifyPayment(payment.id, 'payment.updated'));
    return json(200, payment);
  }

  #refund(payment, body) {
    if (this.environment === 'test' && this.options.refundsBlockedInTest) {
      return json(401, { message: 'Unauthorized use of live credentials', error: 'unauthorized', status: 401, cause: [{ code: 7, description: 'Unauthorized use of live credentials' }] });
    }
    if (payment.status !== 'approved') {
      return json(400, { message: 'Invalid action for the payment status', error: 'bad_request', status: 400, cause: [{ code: 2063, description: 'invalid status' }] });
    }
    const refunded = payment.refunds.reduce((sum, refund) => sum + refund.amount, 0);
    const remaining = Number((payment.transaction_amount - refunded).toFixed(2));
    const amount = body.amount === undefined ? remaining : Number(body.amount);
    if (!(amount > 0) || amount > remaining + 1e-9) {
      return json(400, { message: 'Invalid refund amount', error: 'bad_request', status: 400, cause: [{ code: 2085, description: 'invalid amount' }] });
    }
    const now = Date.now();
    const refund = {
      id: this.nextRefundId++, payment_id: payment.id, amount: Number(amount.toFixed(2)), metadata: {},
      source: { id: String(payment.collector_id), name: 'collector', type: 'collector' }, date_created: MP_DATE(now),
      unique_sequence_number: null, refund_mode: 'standard', adjustment_amount: 0, status: 'approved', reason: null,
      amount_refunded_to_payer: Number(amount.toFixed(2)), partition_details: [],
    };
    payment.refunds.push(refund);
    payment.transaction_amount_refunded = Number((refunded + refund.amount).toFixed(2));
    if (payment.transaction_amount_refunded >= payment.transaction_amount) {
      payment.status = 'refunded';
      payment.status_detail = 'refunded';
    } else {
      payment.status_detail = 'partially_refunded';
    }
    payment.date_last_updated = MP_DATE(now);
    queueMicrotask(() => this.notifyPayment(payment.id, 'payment.updated'));
    return json(201, refund);
  }
}

function safeJson(raw) {
  try { return raw ? JSON.parse(raw) : null; } catch { return null; }
}
