/*
 * Lleva un pedido REAL del storefront por el circuito operativo completo:
 * Panel acepta, prepara y deja listo; el rider lo toma, retira, sale, llega y
 * entrega con el código del cliente.
 *
 * Usa actores con rol real —no el service_role— para que cada RPC evalúe su
 * `auth.uid()` y sus políticas igual que en la operación.
 *
 * Requiere la sesion vigente del cliente QA que creo el pedido. Nunca cambia
 * email/password ni toma control de una cuenta para completar la prueba.
 */
import { createClient } from '@supabase/supabase-js';
import { randomBytes } from 'node:crypto';
import {
  assertStagingCertificationTarget,
  verifyStagingCertificationIdentity,
  verifyStagingCertificationOrder,
} from './lib/staging-certification-target.mjs';

import {
  boundedCertificationClient, certificationCleanup, certificationInterruption,
  createCertificationActor, requireCertificationResult, verifyCertificationCustomer,
  retireCertificationCircuitOrder,
} from './lib/staging-certification-resources.mjs';

async function runCertification() {
const env = (name) => String(process.env[name] || '').trim();

const URL = env('SUPABASE_URL');
const SERVICE = env('SUPABASE_SERVICE_ROLE_KEY');
const ANON = env('SUPABASE_ANON_KEY');
const BUSINESS = env('TABA_BUSINESS_ID');
const preflightOnly = process.argv.includes('--preflight-only');
const CODE = process.argv.slice(2).find((argument) => !argument.startsWith('--'));
const certificationTarget = {
  supabaseUrl: URL,
  businessId: BUSINESS,
  confirmation: env('TABA_CERTIFY_CONFIRM'),
};

try {
  assertStagingCertificationTarget(certificationTarget);
} catch (error) {
  console.error(error.message);
  process.exitCode = 2; return;
}
for (const [name, value] of Object.entries({
  SUPABASE_URL: URL,
  SUPABASE_SERVICE_ROLE_KEY: SERVICE,
  SUPABASE_ANON_KEY: ANON,
  TABA_BUSINESS_ID: BUSINESS,
})) {
  if (!value) { console.error(`Falta ${name}.`); process.exitCode = 2; return; }
}
if (!preflightOnly && !CODE) { console.error('Indica el pedido: npm run certify:circuit:staging -- LT-00XX'); process.exitCode = 2; return; }

const interruption = certificationInterruption();
try {
const service = boundedCertificationClient(createClient, URL, SERVICE, {}, interruption.signal);
const cleanupService = boundedCertificationClient(createClient, URL, SERVICE);
const clientFor = ({ cleanup: cleaning = false, accessToken } = {}) =>
  boundedCertificationClient(createClient, URL, ANON,
    accessToken ? { global: { headers: { Authorization: `Bearer ${accessToken}` } } } : {},
    cleaning ? undefined : interruption.signal);
let pedido;
try {
  const identity = await verifyStagingCertificationIdentity(service, certificationTarget);
  if (preflightOnly) {
    console.log(JSON.stringify({ ok: true, readOnly: true, scope: 'staging_identity_only',
      projectRef: identity.projectRef, businessId: identity.businessId, paymentEnvironment: 'test' }));
    return;
  }
  pedido = await verifyStagingCertificationOrder(service, certificationTarget, CODE);
  if (pedido.status !== 'received' || pedido.assigned_rider_user_id) {
    throw new Error('STAGING_CERTIFICATION_FRESH_UNASSIGNED_QA_ORDER_REQUIRED');
  }
} catch (error) {
  console.error(error.message);
  process.exitCode = 2; return;
}
const customerToken = env('TABA_CERTIFY_CUSTOMER_ACCESS_TOKEN');
const customer = clientFor({ accessToken: customerToken });
try { await verifyCertificationCustomer(customer, customerToken, pedido.customer_user_id); }
catch (error) { console.error(error.message); process.exitCode = 2; return; }
const limpieza = certificationCleanup();
let fallas = 0;
const check = (ok, name, detail = '') => {
  if (!ok) fallas += 1;
  console.log(`${ok ? 'OK  ' : 'FAIL'}  ${name}${detail ? `  - ${detail}` : ''}`);
  if (!ok) throw new Error('STAGING_CERTIFICATION_CHECK_FAILED');
};
const rid = (prefix) => `${prefix}_${randomBytes(12).toString('hex')}`;
const token = () => randomBytes(32).toString('hex');

async function actor(role) {
  return createCertificationActor({ service, cleanupService, clientFor,
    target: certificationTarget, role, cleanup: limpieza });
}

const fila = async (columns = '*') => {
  const row = requireCertificationResult(await service.from('orders').select(columns)
    .eq('business_id', BUSINESS).eq('id', pedido.id).eq('customer_user_id', pedido.customer_user_id)
    .eq('public_code', CODE).single(), 'ORDER_READ');
  if (!row) throw new Error('STAGING_CERTIFICATION_QA_ORDER_NOT_FOUND');
  return row;
};

try {
  console.log(`pedido ${CODE}: ${pedido.status} · $${pedido.total} · origin=${pedido.origin}\n`);

  const previo = await fila('status,assigned_rider_user_id');
  if (previo.status !== 'received' || previo.assigned_rider_user_id) {
    throw new Error('STAGING_CERTIFICATION_ORDER_CHANGED_BEFORE_ACTORS');
  }
  const staff = await actor('staff');
  limpieza.add('qa_order', () => retireCertificationCircuitOrder({
    service: cleanupService, staffClient: staff.cleanupClient, target: certificationTarget,
    orderId: pedido.id, customerId: pedido.customer_user_id, publicCode: CODE,
    idempotencyKey: rid('rc_retire'),
  }));
  const rider = await actor('rider');

  // ── Panel ────────────────────────────────────────────────────────────────
  const bandeja = await staff.client.from('orders')
    .select('public_code,status').eq('business_id', BUSINESS).eq('origin', 'production')
    .in('status', ['received', 'accepted', 'preparing', 'ready']);
  check(!bandeja.error && (bandeja.data || []).some((r) => r.public_code === CODE),
    'el Panel ve el pedido en su bandeja', JSON.stringify((bandeja.data || []).map((r) => r.public_code)));

  let actual = await fila('status,revision,assigned_rider_user_id');

  for (const estado of ['accepted', 'preparing', 'ready']) {
    const r = await staff.client.rpc('transition_order', {
      p_order_id: pedido.id,
      p_expected_revision: actual.revision,
      p_new_status: estado,
      p_idempotency_key: rid('rc'),
    });
    actual = await fila('status,revision');
    check(!r.error && actual.status === estado, `el Panel lo mueve a ${estado}`, r.error?.message || actual.status);
  }

  const atrasada = await staff.client.rpc('transition_order', {
    p_order_id: pedido.id, p_expected_revision: 1, p_new_status: 'delivered', p_idempotency_key: rid('rc_stale'),
  });
  actual = await fila('status,revision');
  check(Boolean(atrasada.error) && actual.status === 'ready', 'una revisión atrasada no puede mover el pedido',
    atrasada.error ? 'rechazado' : actual.status);

  // ── Rider ────────────────────────────────────────────────────────────────
  const cola = await rider.client.rpc('list_available_rider_orders', { p_business_id: BUSINESS });
  check(!cola.error && (cola.data || []).some((o) => o.public_code === CODE),
    'el rider ve el pedido asignable', cola.error?.message || String((cola.data || []).length));

  const claimKey = rid('rc_claim');
  const claim = await rider.client.rpc('claim_delivery_order', {
    p_business_id: BUSINESS, p_public_code: CODE, p_expected_revision: actual.revision, p_idempotency_key: claimKey,
  });
  check(!claim.error, 'el rider toma el pedido', claim.error?.message || 'ok');
  actual = await fila('status,revision,assigned_rider_user_id');
  check(actual.assigned_rider_user_id === rider.userId, 'queda asignado a ese rider', actual.status);

  const otra = await rider.client.rpc('claim_delivery_order', {
    p_business_id: BUSINESS, p_public_code: CODE, p_expected_revision: actual.revision, p_idempotency_key: claimKey,
  });
  check(!otra.error && otra.data?.idempotent_no_op === true, 'tomarlo dos veces es un no-op idempotente',
    JSON.stringify(otra.data || otra.error?.message).slice(0, 60));

  // El rider no usa `transition_order`: tiene sus propios contratos, y el
  // orden importa — `start_rider_delivery` sólo acepta un pedido ya retirado.
  for (const [rpc, estado] of [
    ['mark_delivery_picked_up', 'picked_up'],
    ['start_rider_delivery', 'on_the_way'],
    ['mark_rider_arrived', 'arrived'],
  ]) {
    actual = await fila('status,revision');
    const r = await rider.client.rpc(rpc, {
      p_order_id: pedido.id, p_expected_revision: actual.revision, p_idempotency_key: rid('rc'),
    });
    actual = await fila('status,revision');
    check(!r.error && actual.status === estado, `el rider marca ${estado}`, r.error?.message || actual.status);
  }

  // ── El cliente pide su código ────────────────────────────────────────────
  if (fallas) throw new Error('STAGING_CERTIFICATION_STOPPED_BEFORE_CUSTOMER_RECOVERY');
  const latest = await verifyStagingCertificationOrder(service, certificationTarget, CODE);
  if (latest.id !== pedido.id || latest.customer_user_id !== pedido.customer_user_id) {
    throw new Error('STAGING_CERTIFICATION_CUSTOMER_CHANGED');
  }
  await verifyCertificationCustomer(customer, customerToken, pedido.customer_user_id);

  const nuevoToken = token();
  const recuperado = await customer.rpc('recover_order_tracking_access', {
    p_order_id: pedido.id, p_new_tracking_token: nuevoToken,
  });
  const codigo = String(
    recuperado?.data?.delivery_code || recuperado?.data?.code
    || (typeof recuperado?.data === 'string' ? recuperado.data : ''),
  ).trim();
  check(Boolean(codigo), 'el cliente obtiene su código de entrega',
    recuperado?.error?.message || (codigo ? 'emitido' : JSON.stringify(recuperado?.data)));

  // ── Entrega ──────────────────────────────────────────────────────────────
  actual = await fila('status,revision');
  const malo = await rider.client.rpc('confirm_delivery_code', {
    p_order_id: pedido.id, p_expected_revision: actual.revision,
    p_delivery_code: '000000', p_idempotency_key: rid('rc_wrong'),
  });
  actual = await fila('status,revision');
  check(malo.data?.ok !== true && actual.status === 'arrived',
    'un código incorrecto no cierra el pedido', `status=${actual.status}`);

  const bien = await rider.client.rpc('confirm_delivery_code', {
    p_order_id: pedido.id, p_expected_revision: actual.revision,
    p_delivery_code: codigo, p_idempotency_key: rid('rc_deliver'),
  });
  actual = await fila('status,delivered_at,subtotal,discount_total,total');
  check(!bien.error && actual.status === 'delivered', 'el pedido se entrega con el código del cliente',
    bien.error?.message || `${actual.status} @ ${actual.delivered_at}`);
  check(actual.total === pedido.total && actual.discount_total === pedido.discount_total
    && actual.subtotal === pedido.subtotal,
    'el dinero no se movió en todo el circuito',
    `subtotal=${actual.subtotal} desc=${actual.discount_total} total=${actual.total}`);
} finally {
  for (const name of await limpieza.run()) {
    fallas += 1;
    console.error(`limpieza: ${name} FAILED`);
  }
}

console.log(`\n=== ${fallas ? `${fallas} FALLAS` : 'circuito operativo completo, todo verde'} ===`);
process.exitCode = fallas ? 1 : 0;

} finally { interruption.close(); }
}
await runCertification().catch(error => {
  console.error(/^STAGING_CERTIFICATION_[A-Z_]+(?::[A-Z_0-9]+)?$/.test(error?.message)
    ? error.message : 'STAGING_CERTIFICATION_RUN_FAILED');
  process.exitCode = 1;
});
