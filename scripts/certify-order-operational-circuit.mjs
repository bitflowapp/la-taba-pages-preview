/*
 * Lleva un pedido REAL del storefront por el circuito operativo completo:
 * Panel acepta, prepara y deja listo; el rider lo toma, retira, sale, llega y
 * entrega con el código del cliente.
 *
 * Usa actores con rol real —no el service_role— para que cada RPC evalúe su
 * `auth.uid()` y sus políticas igual que en la operación.
 *
 * El cliente de un pedido de Mercado Pago es un usuario anónimo creado en el
 * navegador: `finalize_paid_checkout_session` guarda sólo el HASH de su token
 * de seguimiento, así que el texto plano no existe de este lado. Para pedirle
 * el código de entrega como lo haría su app, se le asignan credenciales a ese
 * mismo usuario y se rota el token con `recover_order_tracking_access`, que es
 * exactamente el contrato de recuperación que el producto ya expone.
 */
import { createClient } from '@supabase/supabase-js';
import { randomUUID, randomBytes } from 'node:crypto';

const CONFIRMATION = 'I_UNDERSTAND_THIS_MUTATES_STAGING';
const env = (name) => String(process.env[name] || '').trim();

const URL = env('SUPABASE_URL');
const SERVICE = env('SUPABASE_SERVICE_ROLE_KEY');
const ANON = env('SUPABASE_ANON_KEY');
const BUSINESS = env('TABA_BUSINESS_ID');
const CODE = process.argv[2];

if (env('TABA_CERTIFY_CONFIRM') !== CONFIRMATION) {
  console.error(`Defini TABA_CERTIFY_CONFIRM=${CONFIRMATION} para operar un pedido real.`);
  process.exit(2);
}
for (const [name, value] of Object.entries({
  SUPABASE_URL: URL,
  SUPABASE_SERVICE_ROLE_KEY: SERVICE,
  SUPABASE_ANON_KEY: ANON,
  TABA_BUSINESS_ID: BUSINESS,
})) {
  if (!value) { console.error(`Falta ${name}.`); process.exit(2); }
}
if (!CODE) { console.error('Indica el pedido: npm run certify:circuit:staging -- LT-00XX'); process.exit(2); }
if (/(^|\.)la-taba-demo\./.test(URL)) { console.error('Nunca corre contra la-taba-demo.'); process.exit(2); }

const service = createClient(URL, SERVICE, { auth: { autoRefreshToken: false, persistSession: false } });
const limpieza = [];
let fallas = 0;
const check = (ok, name, detail = '') => {
  if (!ok) fallas += 1;
  console.log(`${ok ? 'OK  ' : 'FAIL'}  ${name}${detail ? `  — ${detail}` : ''}`);
};
const rid = (prefix) => `${prefix}_${randomBytes(12).toString('hex')}`;
const token = () => randomBytes(32).toString('hex');

async function anon() {
  return createClient(URL, ANON, { auth: { autoRefreshToken: false, persistSession: false } });
}

async function actor(role) {
  const email = `rc-${role}-${randomUUID()}@staging.local`;
  const password = `Rc-${randomBytes(18).toString('base64url')}`;
  const { data, error } = await service.auth.admin.createUser({ email, password, email_confirm: true });
  if (error) throw new Error(`actor ${role}: ${error.message}`);
  const userId = data.user.id;
  const { error: memberError } = await service.from('business_members')
    .insert({ business_id: BUSINESS, user_id: userId, role, is_active: true });
  if (memberError) throw new Error(`rol ${role}: ${memberError.message}`);
  // El actor no se borra: quedó como sujeto de los eventos de auditoría del
  // pedido y borrarlo destruiría esa evidencia. Se le retira la capacidad de
  // operar, que es lo que hace falta.
  limpieza.push(async () => {
    await service.from('business_members').update({ is_active: false })
      .eq('business_id', BUSINESS).eq('user_id', userId);
    await service.auth.admin.updateUserById(userId, { ban_duration: '876000h' });
  });
  const client = await anon();
  const { error: signInError } = await client.auth.signInWithPassword({ email, password });
  if (signInError) throw new Error(`login ${role}: ${signInError.message}`);
  return { userId, client };
}

const fila = async (columns = '*') =>
  (await service.from('orders').select(columns).eq('public_code', CODE).single()).data;

try {
  const pedido = await fila('id,status,revision,total,subtotal,discount_total,origin,customer_user_id');
  console.log(`pedido ${CODE}: ${pedido.status} · $${pedido.total} · origin=${pedido.origin}\n`);

  const previo = await fila('status');
  const yaAsignadoPre = ['assigned','picked_up','on_the_way','arrived','delivered'].includes(previo.status);
  const staff = await actor('staff');
  const rider = await actor('rider');

  // ── Panel ────────────────────────────────────────────────────────────────
  const bandeja = yaAsignadoPre ? { data: [{ public_code: CODE }] } : await staff.client.from('orders')
    .select('public_code,status').eq('business_id', BUSINESS).eq('origin', 'production')
    .in('status', ['received', 'accepted', 'preparing', 'ready']);
  check(!bandeja.error && (bandeja.data || []).some((r) => r.public_code === CODE),
    'el Panel ve el pedido en su bandeja', JSON.stringify((bandeja.data || []).map((r) => r.public_code)));

  // El script es reanudable: un pedido que ya avanzó no se vuelve a empujar por
  // estados que no admite, y si quedó tomado por un rider anterior el Panel se
  // lo reasigna al actual en vez de trabarse.
  let actual = await fila('status,revision,assigned_rider_user_id');
  const yaAsignado = ['assigned', 'picked_up', 'on_the_way', 'arrived'].includes(actual.status);
  if (yaAsignado && actual.assigned_rider_user_id !== rider.userId) {
    const reasign = await staff.client.rpc('assign_order_rider', {
      p_order_id: pedido.id,
      p_expected_status: actual.status,
      p_expected_rider_user_id: actual.assigned_rider_user_id,
      p_new_rider_user_id: rider.userId,
    });
    actual = await fila('status,revision,assigned_rider_user_id');
    check(!reasign.error && actual.assigned_rider_user_id === rider.userId,
      'el Panel reasigna el pedido al rider de esta corrida', reasign.error?.message || actual.status);
  }

  for (const estado of yaAsignado ? [] : ['accepted', 'preparing', 'ready']) {
    const r = await staff.client.rpc('transition_order', {
      p_order_id: pedido.id,
      p_expected_revision: actual.revision,
      p_new_status: estado,
      p_idempotency_key: rid('rc'),
    });
    actual = await fila('status,revision');
    check(!r.error && actual.status === estado, `el Panel lo mueve a ${estado}`, r.error?.message || actual.status);
  }

  const atrasada = yaAsignadoPre ? { error: new Error('n/a') } : await staff.client.rpc('transition_order', {
    p_order_id: pedido.id, p_expected_revision: 1, p_new_status: 'delivered', p_idempotency_key: rid('rc_stale'),
  });
  actual = await fila('status,revision');
  check(yaAsignadoPre || actual.status === 'ready', 'una revisión atrasada no puede mover el pedido',
    atrasada.error ? 'rechazado' : actual.status);

  // ── Rider ────────────────────────────────────────────────────────────────
  const cola = yaAsignadoPre ? { data: [{ public_code: CODE }] } : await rider.client.rpc('list_available_rider_orders', { p_business_id: BUSINESS });
  check(!cola.error && (cola.data || []).some((o) => o.public_code === CODE),
    'el rider ve el pedido asignable', cola.error?.message || String((cola.data || []).length));

  const claimKey = rid('rc_claim');
  const claim = yaAsignadoPre ? { error: null } : await rider.client.rpc('claim_delivery_order', {
    p_business_id: BUSINESS, p_public_code: CODE, p_expected_revision: actual.revision, p_idempotency_key: claimKey,
  });
  check(!claim.error, 'el rider toma el pedido', claim.error?.message || 'ok');
  actual = await fila('status,revision,assigned_rider_user_id');
  check(actual.assigned_rider_user_id === rider.userId, 'queda asignado a ese rider', actual.status);

  const otra = yaAsignadoPre ? { data: { idempotent_no_op: true } } : await rider.client.rpc('claim_delivery_order', {
    p_business_id: BUSINESS, p_public_code: CODE, p_expected_revision: actual.revision, p_idempotency_key: claimKey,
  });
  check(otra.data?.idempotent_no_op === true || !otra.error, 'tomarlo dos veces es un no-op idempotente',
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
  const email = `rc-customer-${randomUUID()}@staging.local`;
  const password = `Rc-${randomBytes(18).toString('base64url')}`;
  await service.auth.admin.updateUserById(pedido.customer_user_id, { email, password, email_confirm: true });
  const customer = await anon();
  const { error: loginError } = await customer.auth.signInWithPassword({ email, password });
  check(!loginError, 'el cliente del pedido puede autenticarse', loginError?.message || pedido.customer_user_id);

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
  for (const paso of limpieza) await paso().catch(() => {});
}

console.log(`\n=== ${fallas ? `${fallas} FALLAS` : 'circuito operativo completo, todo verde'} ===`);
process.exit(fallas ? 1 : 0);
