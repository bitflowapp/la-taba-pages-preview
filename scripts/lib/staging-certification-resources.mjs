import { randomBytes, randomUUID } from 'node:crypto';
import { assertStagingCertificationTarget } from './staging-certification-target.mjs';

const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const timeoutMs = 15_000;

// Each step is registered before the next write. A failed revocation must not
// prevent the independent ban, and a failed resource cleanup must fail the run.
export function certificationCleanup() {
  const tasks = [];
  let completion;
  return {
    add(name, task) {
      if (completion) throw new Error('STAGING_CERTIFICATION_CLEANUP_ALREADY_STARTED');
      tasks.push({ name, task });
    },
    run() {
      completion ||= (async () => {
        const failed = [];
        for (const { name, task } of tasks.reverse()) {
          try { await task(); } catch { failed.push(name); }
        }
        return failed;
      })();
      return completion;
    },
  };
}

export function requireCertificationResult(result, name, { requireOk = false } = {}) {
  if (!result || result.error || result.data?.ok === false
    || (requireOk && result.data?.ok !== true)) {
    throw new Error(`STAGING_CERTIFICATION_${name}_FAILED`);
  }
  return result.data;
}

export function boundedCertificationClient(createClient, url, key, options = {}, signal) {
  return createClient(url, key, {
    ...options,
    auth: { autoRefreshToken: false, persistSession: false, ...options.auth },
    global: { ...options.global, fetch(input, init = {}) {
      const signals = [AbortSignal.timeout(timeoutMs), signal, init.signal, input?.signal].filter(Boolean);
      return fetch(input, { ...init, signal: AbortSignal.any(signals) });
    } },
  });
}

export function certificationInterruption() {
  const controller = new AbortController();
  const stop = () => controller.abort(new Error('STAGING_CERTIFICATION_INTERRUPTED'));
  for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, stop);
  return {
    signal: controller.signal,
    close() { for (const signal of ['SIGINT', 'SIGTERM']) process.off(signal, stop); },
  };
}

export async function createCertificationActor({ service, cleanupService, clientFor, target, role, cleanup }) {
  assertStagingCertificationTarget(target);
  if (!['customer', 'staff', 'rider'].includes(role)) throw new Error('STAGING_CERTIFICATION_ROLE_REJECTED');
  const email = `cert-${role}-${randomUUID()}@staging.local`;
  const password = `Cert-${randomBytes(18).toString('base64url')}`;
  const data = requireCertificationResult(await service.auth.admin.createUser({ email, password, email_confirm: true }), 'ACTOR_CREATE');
  const userId = data?.user?.id;
  if (!uuid.test(userId || '')) throw new Error('STAGING_CERTIFICATION_ACTOR_ID_UNVERIFIED');
  cleanup.add(`ban_${role}`, async () => {
    const banned = requireCertificationResult(await cleanupService.auth.admin.updateUserById(userId, { ban_duration: '876000h' }), 'ACTOR_BAN');
    if (banned?.user?.id !== userId || !(Date.parse(banned.user.banned_until) > Date.now())) {
      throw new Error('STAGING_CERTIFICATION_ACTOR_BAN_UNVERIFIED');
    }
  });
  if (role !== 'customer') {
    cleanup.add(`membership_${role}`, async () => {
      const rows = requireCertificationResult(await cleanupService.from('business_members')
        .update({ is_active: false }).eq('business_id', target.businessId).eq('user_id', userId)
        .select('user_id,is_active'), 'MEMBERSHIP_REVOKE');
      if (!Array.isArray(rows) || rows.some(row => row.user_id !== userId || row.is_active !== false)) {
        throw new Error('STAGING_CERTIFICATION_MEMBERSHIP_REVOKE_UNVERIFIED');
      }
    });
    requireCertificationResult(await service.from('business_members')
      .insert({ business_id: target.businessId, user_id: userId, role, is_active: true }), 'MEMBERSHIP_CREATE');
  }
  const client = clientFor();
  const cleanupClient = clientFor({ cleanup: true });
  // Cleanup uses the same session but a separate bounded transport unaffected
  // by the run's cancellation signal. No plaintext credentials are persisted.
  const signedIn = requireCertificationResult(await client.auth.signInWithPassword({ email, password }), 'ACTOR_LOGIN');
  if (!signedIn?.session?.access_token || !signedIn?.session?.refresh_token) {
    throw new Error('STAGING_CERTIFICATION_ACTOR_SESSION_UNVERIFIED');
  }
  requireCertificationResult(await cleanupClient.auth.setSession(signedIn.session), 'CLEANUP_SESSION');
  cleanup.add(`logout_${role}`, async () => {
    requireCertificationResult(await cleanupClient.auth.signOut({ scope: 'local' }), 'ACTOR_LOGOUT');
  });
  if (role !== 'customer') {
    cleanup.add(`session_${role}`, async () => {
      requireCertificationResult(await cleanupClient.rpc('identity_close_own_session', { p_business_id: target.businessId }), 'SESSION_CLOSE');
    });
    const registration = requireCertificationResult(await client.rpc('identity_register_session', {
      p_business_id: target.businessId,
      p_client: role === 'rider' ? 'rider_android' : 'panel_web',
      p_device_label: 'staging-certification', p_device_key_hash: null,
      p_app_version: 'staging-certifier',
    }), 'SESSION_REGISTER', { requireOk: true });
    if (!registration.session_id) throw new Error('STAGING_CERTIFICATION_SESSION_ID_UNVERIFIED');
  }
  return { userId, client, cleanupClient };
}

export async function verifyCertificationFixtures(service, target, { operationalProductId, isolationProductId }) {
  assertStagingCertificationTarget(target);
  if (!uuid.test(operationalProductId || '') || !uuid.test(isolationProductId || '')
    || operationalProductId === isolationProductId) {
    throw new Error('STAGING_CERTIFICATION_EXPLICIT_FIXTURES_REQUIRED');
  }
  const products = [];
  for (const [id, origins] of [[operationalProductId, ['commercial', 'demo_fixture']],
    [isolationProductId, ['test_only', 'staging_only']]]) {
    const row = requireCertificationResult(await service.from('products')
      .select('id,business_id,name,price,stock,catalog_origin,is_active,available,is_verified,merchant_available,price_status,is_alcoholic')
      .eq('business_id', target.businessId).eq('id', id).abortSignal(AbortSignal.timeout(timeoutMs)).maybeSingle(), 'FIXTURE_READ');
    if (!row || row.id !== id || row.business_id !== target.businessId || !origins.includes(row.catalog_origin)
      || row.is_active !== true || row.available !== true || row.is_verified !== true
      || row.merchant_available !== true || row.price_status !== 'confirmed'
      // This harness submits no age confirmation; unknown metadata is unsafe.
      || row.is_alcoholic !== false
      || !Number.isFinite(Number(row.price)) || Number(row.price) <= 0
      || !Number.isInteger(Number(row.stock)) || Number(row.stock) < 2) {
      throw new Error('STAGING_CERTIFICATION_FIXTURE_UNAVAILABLE');
    }
    products.push(row);
  }
  return { realProduct: products[0], qaProduct: products[1] };
}

export async function ownedCertificationCheckout(service, target, sessionId, customerId, requestId) {
  assertStagingCertificationTarget(target);
  if (![sessionId, customerId].every(value => uuid.test(value || '')) || !/^cert_mp_[a-f0-9]{24}$/.test(requestId || '')) {
    throw new Error('STAGING_CERTIFICATION_CHECKOUT_IDENTITY_REQUIRED');
  }
  const row = requireCertificationResult(await service.from('checkout_sessions')
    .select('id,business_id,customer_id,client_request_id,status,created_at,expires_at')
    .eq('id', sessionId).eq('business_id', target.businessId).eq('customer_id', customerId)
    .eq('client_request_id', requestId).abortSignal(AbortSignal.timeout(timeoutMs)).maybeSingle(), 'CHECKOUT_READ');
  if (!row || row.id !== sessionId || row.business_id !== target.businessId
    || row.customer_id !== customerId || row.client_request_id !== requestId) {
    throw new Error('STAGING_CERTIFICATION_CHECKOUT_OWNERSHIP_REJECTED');
  }
  return row;
}

export async function releaseCertificationCheckout(service, target, sessionId, customerId, requestId, terminalStatus = 'cancelled') {
  if (!['cancelled', 'expired'].includes(terminalStatus)) throw new Error('STAGING_CERTIFICATION_RELEASE_STATE_REJECTED');
  const row = await ownedCertificationCheckout(service, target, sessionId, customerId, requestId);
  // Cleanup must not rewrite an already-expired checkout as cancelled.
  if (row.status === 'expired' && terminalStatus === 'cancelled') terminalStatus = 'expired';
  if (!['created', 'validating', 'ready_for_payment', 'redirected', 'payment_pending', 'expired', 'cancelled'].includes(row.status)) {
    throw new Error('STAGING_CERTIFICATION_FINANCIAL_STATE_REJECTED');
  }
  if (terminalStatus === 'expired' && !(Date.parse(row.expires_at) <= Date.now())) {
    throw new Error('STAGING_CERTIFICATION_CHECKOUT_NOT_EXPIRED');
  }
  const result = requireCertificationResult(await service.rpc('release_checkout_session_inventory', {
    p_checkout_session_id: row.id, p_reason: 'staging_certification', p_terminal_status: terminalStatus,
  }), 'CHECKOUT_RELEASE');
  if (result?.skipped || result?.status !== terminalStatus || !Number.isInteger(result?.released)) {
    throw new Error('STAGING_CERTIFICATION_CHECKOUT_RELEASE_UNVERIFIED');
  }
  const after = await ownedCertificationCheckout(service, target, sessionId, customerId, requestId);
  if (after.status !== terminalStatus) throw new Error('STAGING_CERTIFICATION_CHECKOUT_RELEASE_UNVERIFIED');
  return result;
}

export async function verifyCertificationCustomer(client, accessToken, customerId) {
  if (!accessToken) throw new Error('STAGING_CERTIFICATION_CUSTOMER_SESSION_REQUIRED');
  const data = requireCertificationResult(await client.auth.getUser(accessToken), 'CUSTOMER_SESSION_READ');
  const customer = data?.user;
  if (customer?.id !== customerId || customer?.is_anonymous !== true || customer.email || customer.phone) {
    throw new Error('STAGING_CERTIFICATION_CUSTOMER_SESSION_REJECTED');
  }
  return customer;
}

export async function retireCertificationCircuitOrder({ service, staffClient, target,
  orderId, customerId, publicCode, idempotencyKey }) {
  assertStagingCertificationTarget(target);
  if (![orderId, customerId].every(value => uuid.test(value || '')) || !publicCode
    || !/^rc_retire_[a-f0-9]{24}$/.test(idempotencyKey || '')) {
    throw new Error('STAGING_CERTIFICATION_ORDER_IDENTITY_REQUIRED');
  }
  const read = async () => {
    const row = requireCertificationResult(await service.from('orders')
      .select('id,status,revision,origin,business_id,customer_user_id,public_code')
      .eq('business_id', target.businessId).eq('id', orderId)
      .eq('customer_user_id', customerId).eq('public_code', publicCode)
      .abortSignal(AbortSignal.timeout(timeoutMs)).maybeSingle(), 'CLEANUP_ORDER_READ');
    if (row?.id !== orderId || row.business_id !== target.businessId
      || row.customer_user_id !== customerId || row.public_code !== publicCode) {
      throw new Error('STAGING_CERTIFICATION_ORDER_OWNERSHIP_REJECTED');
    }
    return row;
  };
  const current = await read();
  const errors = [];
  if (!['delivered', 'cancelled', 'canceled', 'rejected'].includes(current.status)) {
    try {
      requireCertificationResult(await staffClient.rpc('transition_order', {
        p_order_id: orderId, p_expected_revision: current.revision,
        p_new_status: 'cancelled', p_idempotency_key: idempotencyKey,
      }), 'ORDER_RETIRE');
      if ((await read()).status !== 'cancelled') {
        throw new Error('STAGING_CERTIFICATION_ORDER_RETIRE_UNVERIFIED');
      }
    } catch (error) { errors.push(error); }
  }
  // Classification is independent: even a refused cancellation must suppress
  // pending QA notifications and preserve the order as audit evidence.
  try {
    requireCertificationResult(await service.rpc('classify_order_as_qa', {
      p_order_id: orderId, p_reason: 'operational_certification_run',
    }), 'ORDER_CLASSIFY', { requireOk: true });
    if ((await read()).origin !== 'qa') {
      throw new Error('STAGING_CERTIFICATION_ORDER_CLASSIFY_UNVERIFIED');
    }
  } catch (error) { errors.push(error); }
  if (errors.length) throw new AggregateError(errors, 'STAGING_CERTIFICATION_ORDER_CLEANUP_FAILED');
}
