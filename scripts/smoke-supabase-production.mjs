#!/usr/bin/env node

import { randomBytes } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import { normalizeBrowserSupabaseKey } from '../js/core/runtime-config.js';

const REQUIRED_CONFIRMATION = 'I_UNDERSTAND_THIS_CREATES_AN_ORDER';
const url = String(process.env.SUPABASE_URL || '').trim().replace(/\/+$/, '');
const publishableKey = String(
  process.env.SUPABASE_PUBLISHABLE_KEY
  || process.env.SUPABASE_ANON_KEY
  || '',
).trim();
const businessId = String(process.env.SUPABASE_BUSINESS_ID || '').trim();
const staffEmail = String(process.env.SUPABASE_STAFF_EMAIL || '').trim();
const staffPassword = String(process.env.SUPABASE_STAFF_PASSWORD || '');
const customerPhone = String(process.env.TABA_SMOKE_CUSTOMER_PHONE || '').trim();
const customerName = String(process.env.TABA_SMOKE_CUSTOMER_NAME || 'TABA smoke test').trim();
const requestedMode = String(process.env.TABA_SMOKE_DELIVERY_MODE || '').trim().toLowerCase();
const streetAddress = String(process.env.TABA_SMOKE_STREET_ADDRESS || '').trim();

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const TERMINAL_STATUSES = new Set(['delivered', 'cancelled', 'canceled', 'rejected']);
const REALTIME_TIMEOUT_MS = 15_000;

async function main() {
  validateEnvironment();
  console.log(`Supabase: ${url}`);
  console.log(`Business: ${businessId}`);
  console.log(`Publishable key: ${redact(publishableKey)}`);

  const customer = productionClient();
  const staff = productionClient();
  let realtimeChannel = null;
  let createdOrderId = '';
  let latestStatus = '';

  try {
    const customerSession = await customer.auth.signInAnonymously({
      options: { data: { taba_actor: 'production_smoke_customer' } },
    });
    assertNoError(customerSession.error, 'Anonymous Auth no está habilitado o no respondió.');
    assert(
      customerSession.data?.session?.user?.is_anonymous === true,
      'La sesión de cliente no quedó identificada como anónima.',
    );
    pass('Auth anónima del cliente');

    const staffSignIn = await staff.auth.signInWithPassword({
      email: staffEmail,
      password: staffPassword,
    });
    assertNoError(staffSignIn.error, 'No se pudo autenticar la cuenta operativa.');
    const staffUserId = staffSignIn.data?.user?.id;
    assert(staffUserId, 'Supabase Auth no devolvió el usuario operativo.');

    const membership = await staff
      .from('business_members')
      .select('business_id,user_id,role,is_active')
      .eq('business_id', businessId)
      .eq('user_id', staffUserId)
      .eq('is_active', true)
      .maybeSingle();
    assertNoError(membership.error, 'No se pudo verificar la membresía operativa.');
    assert(
      ['owner', 'admin', 'staff'].includes(membership.data?.role),
      'La cuenta no tiene rol owner/admin/staff activo para este comercio.',
    );
    pass(`Auth y membresía operativa (${membership.data.role})`);

    const business = await loadBusiness(customer);
    const product = await loadVerifiedProduct(customer);
    const deliveryMode = chooseDeliveryMode(business);
    if (deliveryMode === 'delivery') {
      assert(streetAddress, 'TABA_SMOKE_STREET_ADDRESS es obligatorio cuando el smoke usa delivery.');
    }

    const request = buildRequest({ productId: product.id, deliveryMode });
    const firstCreate = await customer.rpc('create_order_with_items', { payload: request.payload });
    assertNoError(firstCreate.error, 'El RPC create_order_with_items rechazó el pedido válido.');
    const firstOrder = orderFrom(firstCreate.data);
    assert(firstOrder?.id, 'El RPC no devolvió el ID autoritativo del pedido.');
    createdOrderId = firstOrder.id;
    latestStatus = normalizeStatus(firstOrder.status);

    verifyAuthoritativeTotals({ order: firstOrder, product, business, deliveryMode });
    pass('creación con precios, totales, estado e IDs autoritativos');

    const retryCreate = await customer.rpc('create_order_with_items', { payload: request.payload });
    assertNoError(retryCreate.error, 'El reintento idempotente falló.');
    const retriedOrder = orderFrom(retryCreate.data);
    assert(retriedOrder?.id === createdOrderId, 'El reintento idempotente creó otro pedido.');
    pass('idempotencia del alta');

    const changedPayload = {
      ...request.payload,
      items: [{ product_id: product.id, quantity: 2 }],
    };
    const changedRetry = await customer.rpc('create_order_with_items', { payload: changedPayload });
    assert(
      Boolean(changedRetry.error),
      'El servidor aceptó reutilizar la clave idempotente con otro contenido.',
    );
    pass('rechazo de clave idempotente reutilizada');

    const ownOrder = await customer
      .from('orders')
      .select('id,status,subtotal,delivery_fee,total,currency_code,order_items(*)')
      .eq('id', createdOrderId)
      .maybeSingle();
    assertNoError(ownOrder.error, 'El cliente no pudo releer su propio pedido.');
    assert(ownOrder.data?.id === createdOrderId, 'El pedido no quedó persistido para su cliente.');

    const outsider = productionClient();
    const hiddenOrder = await outsider
      .from('orders')
      .select('id')
      .eq('id', createdOrderId)
      .maybeSingle();
    assert(
      !hiddenOrder.data,
      'Un visitante sin sesión ni token pudo leer el pedido.',
    );

    const tokenClient = productionClient({
      headers: { 'x-order-token': request.trackingToken },
    });
    const tokenOrder = await tokenClient
      .from('orders')
      .select('id,status,total')
      .eq('id', createdOrderId)
      .maybeSingle();
    assertNoError(tokenOrder.error, 'La lectura con token público vigente falló.');
    assert(tokenOrder.data?.id === createdOrderId, 'El token público no habilitó su pedido.');
    pass('RLS de cliente, visitante y token de seguimiento');

    const directMutation = await customer
      .from('orders')
      .update({ status: 'delivered' })
      .eq('id', createdOrderId)
      .select('id,status');
    assert(
      Boolean(directMutation.error) || !directMutation.data?.length,
      'El cliente pudo mutar orders directamente.',
    );
    const unchanged = await fetchOrder(customer, createdOrderId);
    assert(
      normalizeStatus(unchanged.status) === latestStatus,
      'El intento de UPDATE directo cambió el estado.',
    );
    pass('bloqueo de mutación directa por RLS/privilegios');

    const stockAfterCreate = await fetchProductAsStaff(staff, product.id);
    assert(
      Number(stockAfterCreate.stock) === Number(product.stock) - 1,
      'El stock no refleja exactamente una reserva después del reintento.',
    );
    pass('reserva atómica de stock sin doble descuento');

    const realtime = await subscribeToOrder(customer, createdOrderId);
    realtimeChannel = realtime.channel;
    pass('suscripción Realtime autenticada');

    const accepted = await staff.rpc('change_order_status', {
      p_order_id: createdOrderId,
      p_expected_status: latestStatus,
      p_new_status: 'accepted',
    });
    assertNoError(accepted.error, 'El negocio no pudo aceptar el pedido por RPC.');
    latestStatus = normalizeStatus(orderFrom(accepted.data)?.status);
    assert(latestStatus === 'accepted', 'El estado autoritativo no quedó en accepted.');

    const realtimeEvent = await realtime.nextUpdate;
    assert(
      realtimeEvent?.new?.id === createdOrderId
      && normalizeStatus(realtimeEvent.new.status) === 'accepted',
      'Realtime no entregó la transición accepted al cliente.',
    );

    const customerAccepted = await fetchOrder(customer, createdOrderId);
    assert(
      normalizeStatus(customerAccepted.status) === 'accepted',
      'El cliente no pudo observar el nuevo estado persistido.',
    );
    pass('negocio → Realtime → cliente');

    const cancelled = await staff.rpc('change_order_status', {
      p_order_id: createdOrderId,
      p_expected_status: 'accepted',
      p_new_status: 'cancelled',
    });
    assertNoError(cancelled.error, 'No se pudo cancelar el pedido de smoke para liberar stock.');
    latestStatus = normalizeStatus(orderFrom(cancelled.data)?.status);
    assert(latestStatus === 'cancelled', 'El pedido de smoke no terminó cancelado.');

    const restoredProduct = await fetchProductAsStaff(staff, product.id);
    assert(
      Number(restoredProduct.stock) === Number(product.stock),
      'La cancelación no restauró exactamente el stock reservado.',
    );
    pass('cancelación y restauración exacta de stock');

    console.log(`PASS smoke productivo completo (pedido ${createdOrderId}, cancelado)`);
  } finally {
    if (realtimeChannel) await customer.removeChannel(realtimeChannel).catch(() => undefined);
    if (createdOrderId && !TERMINAL_STATUSES.has(latestStatus)) {
      await bestEffortCancel({ staff, orderId: createdOrderId });
    }
    await Promise.allSettled([
      customer.auth.signOut({ scope: 'local' }),
      staff.auth.signOut({ scope: 'local' }),
    ]);
  }
}

function validateEnvironment() {
  assert(
    process.env.TABA_SMOKE_CONFIRM === REQUIRED_CONFIRMATION,
    `Definí TABA_SMOKE_CONFIRM=${REQUIRED_CONFIRMATION} para autorizar el pedido de prueba.`,
  );
  assert(isAllowedUrl(url), 'SUPABASE_URL debe ser HTTPS o un loopback HTTP local.');
  assert(
    normalizeBrowserSupabaseKey(publishableKey) === publishableKey,
    'Falta una SUPABASE_PUBLISHABLE_KEY/ANON_KEY pública; no uses service_role ni sb_secret_.',
  );
  assert(UUID_PATTERN.test(businessId), 'SUPABASE_BUSINESS_ID debe ser un UUID válido.');
  assert(staffEmail && staffPassword, 'Faltan SUPABASE_STAFF_EMAIL/SUPABASE_STAFF_PASSWORD.');
  assert(customerPhone.length >= 6, 'Falta TABA_SMOKE_CUSTOMER_PHONE válido.');
  assert(customerName && customerName.length <= 120, 'TABA_SMOKE_CUSTOMER_NAME no es válido.');
  assert(
    !requestedMode || ['delivery', 'pickup'].includes(requestedMode),
    'TABA_SMOKE_DELIVERY_MODE sólo admite delivery o pickup.',
  );
}

function productionClient({ headers = {} } = {}) {
  return createClient(url, publishableKey, {
    auth: {
      autoRefreshToken: false,
      detectSessionInUrl: false,
      persistSession: false,
    },
    global: { headers },
  });
}

async function loadBusiness(client) {
  const result = await client
    .from('businesses')
    .select([
      'id',
      'currency_code',
      'delivery_enabled',
      'pickup_enabled',
      'delivery_fee',
      'minimum_delivery_subtotal',
      'ordering_enabled',
      'ordering_verified',
      'is_active',
      'status',
    ].join(','))
    .eq('id', businessId)
    .maybeSingle();
  assertNoError(result.error, 'No se pudo leer la configuración del comercio.');
  const business = result.data;
  assert(business, 'El comercio configurado no existe o RLS lo oculta.');
  assert(
    business.is_active
    && business.status === 'open'
    && business.ordering_enabled
    && business.ordering_verified,
    'El comercio no está verificado y habilitado para pedidos.',
  );
  return business;
}

async function loadVerifiedProduct(client) {
  const result = await client
    .from('products')
    .select('id,name,price,stock,available,is_active,is_verified')
    .eq('business_id', businessId)
    .eq('is_active', true)
    .eq('is_verified', true)
    .eq('available', true)
    .gt('stock', 0)
    .order('id', { ascending: true })
    .limit(1)
    .maybeSingle();
  assertNoError(result.error, 'No se pudo leer el catálogo verificado.');
  assert(result.data?.id, 'No hay un producto verificado y con stock para ejecutar el smoke.');
  return result.data;
}

function chooseDeliveryMode(business) {
  const mode = requestedMode
    || (business.pickup_enabled ? 'pickup' : 'delivery');
  assert(
    mode === 'pickup' ? business.pickup_enabled : business.delivery_enabled,
    `El comercio no tiene ${mode} habilitado.`,
  );
  return mode;
}

function buildRequest({ productId, deliveryMode }) {
  const trackingToken = randomBytes(32).toString('base64url');
  const clientRequestId = `smoke_${Date.now()}_${randomBytes(6).toString('hex')}`;
  return {
    trackingToken,
    payload: {
      business_id: businessId,
      client_request_id: clientRequestId,
      tracking_token: trackingToken,
      items: [{ product_id: productId, quantity: 1 }],
      customer_name: customerName,
      customer_phone: customerPhone,
      delivery_mode: deliveryMode,
      ...(deliveryMode === 'delivery' ? { customer_street_address: streetAddress } : {}),
    },
  };
}

function verifyAuthoritativeTotals({ order, product, business, deliveryMode }) {
  const items = Array.isArray(order.order_items) ? order.order_items : [];
  assert(items.length === 1, 'El pedido persistido no tiene exactamente una línea.');
  assert(Number(items[0].quantity) === 1, 'La cantidad persistida no coincide.');
  assert(money(items[0].unit_price) === money(product.price), 'El precio unitario no coincide con el catálogo.');
  assert(money(order.subtotal) === money(product.price), 'El subtotal autoritativo es incorrecto.');
  const expectedFee = deliveryMode === 'delivery' ? money(business.delivery_fee) : 0;
  assert(money(order.delivery_fee) === expectedFee, 'El costo de entrega autoritativo es incorrecto.');
  assert(
    money(order.total) === money(order.subtotal) + money(order.delivery_fee),
    'El total no coincide con subtotal + entrega.',
  );
  assert(UUID_PATTERN.test(order.id), 'El ID autoritativo no es UUID.');
  assert(['received', 'submitted'].includes(String(order.status || '')), 'El servidor aceptó un estado inicial inesperado.');
}

async function fetchOrder(client, orderId) {
  const result = await client
    .from('orders')
    .select('id,status,subtotal,delivery_fee,total')
    .eq('id', orderId)
    .maybeSingle();
  assertNoError(result.error, 'No se pudo releer el pedido.');
  assert(result.data?.id === orderId, 'El pedido persistido no está accesible para el actor esperado.');
  return result.data;
}

async function fetchProductAsStaff(client, productId) {
  const result = await client
    .from('products')
    .select('id,stock,available')
    .eq('id', productId)
    .maybeSingle();
  assertNoError(result.error, 'El equipo no pudo verificar el stock.');
  assert(result.data?.id === productId, 'El producto no quedó accesible al equipo.');
  return result.data;
}

async function subscribeToOrder(client, orderId) {
  let resolveUpdate;
  let rejectUpdate;
  const nextUpdate = new Promise((resolve, reject) => {
    resolveUpdate = resolve;
    rejectUpdate = reject;
  });
  let resolveSubscribed;
  let rejectSubscribed;
  const subscribed = new Promise((resolve, reject) => {
    resolveSubscribed = resolve;
    rejectSubscribed = reject;
  });

  const channel = client
    .channel(`taba-production-smoke-${orderId}`)
    .on('postgres_changes', {
      event: 'UPDATE',
      schema: 'public',
      table: 'orders',
      filter: `id=eq.${orderId}`,
    }, resolveUpdate)
    .subscribe((status, error) => {
      if (status === 'SUBSCRIBED') resolveSubscribed();
      if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
        rejectSubscribed(error || new Error(status));
        rejectUpdate(error || new Error(status));
      }
    });

  await withTimeout(subscribed, REALTIME_TIMEOUT_MS, 'Realtime no alcanzó el estado SUBSCRIBED.');
  return {
    channel,
    nextUpdate: withTimeout(nextUpdate, REALTIME_TIMEOUT_MS, 'Realtime no recibió el UPDATE del pedido.'),
  };
}

async function bestEffortCancel({ staff, orderId }) {
  try {
    const session = await staff.auth.getSession();
    if (!session.data?.session) {
      const signIn = await staff.auth.signInWithPassword({
        email: staffEmail,
        password: staffPassword,
      });
      if (signIn.error) {
        console.error('ATENCIÓN: no se pudo reautenticar para cancelar el pedido de smoke.');
        return;
      }
    }

    const current = await fetchOrder(staff, orderId);
    const status = normalizeStatus(current.status);
    if (TERMINAL_STATUSES.has(status)) return;
    const result = await staff.rpc('change_order_status', {
      p_order_id: orderId,
      p_expected_status: status,
      p_new_status: 'cancelled',
    });
    if (result.error) console.error('ATENCIÓN: no se pudo cancelar automáticamente el pedido de smoke.');
  } catch (_) {
    console.error('ATENCIÓN: verificá y cancelá manualmente el pedido de smoke si quedó abierto.');
  }
}

function orderFrom(value) {
  if (Array.isArray(value)) return value[0] || null;
  if (value?.order && typeof value.order === 'object') return value.order;
  return value && typeof value === 'object' ? value : null;
}

function normalizeStatus(value) {
  const status = String(value || '').toLowerCase();
  if (status === 'received') return 'submitted';
  if (status === 'canceled') return 'cancelled';
  return status;
}

function money(value) {
  const amount = Number(value);
  assert(Number.isFinite(amount), 'El backend devolvió un importe no numérico.');
  return Math.round(amount * 100) / 100;
}

function withTimeout(promise, timeoutMs, message) {
  let timer;
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(new SmokeFailure(message)), timeoutMs);
    }),
  ]).finally(() => clearTimeout(timer));
}

function assertNoError(error, message) {
  if (error) throw new SmokeFailure(`${message} ${safeMessage(error.message || '')}`.trim(), error);
}

function assert(condition, message) {
  if (!condition) throw new SmokeFailure(message);
}

function pass(label) {
  console.log(`PASS ${label}`);
}

function redact(value) {
  if (!value) return '(vacía)';
  if (value.length < 12) return '***';
  return `${value.slice(0, 5)}…${value.slice(-4)}`;
}

function safeMessage(value) {
  return String(value || '')
    .replaceAll(publishableKey, '[publishable-key]')
    .replaceAll(staffPassword, '[password]')
    .slice(0, 500);
}

function isAllowedUrl(value) {
  try {
    const parsed = new URL(value);
    const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(parsed.hostname);
    return !parsed.username
      && !parsed.password
      && (parsed.protocol === 'https:' || (parsed.protocol === 'http:' && loopback));
  } catch (_) {
    return false;
  }
}

class SmokeFailure extends Error {
  constructor(message, cause) {
    super(message, { cause });
    this.name = 'SmokeFailure';
  }
}

main().catch((error) => {
  const message = error instanceof SmokeFailure
    ? error.message
    : 'Falla inesperada durante el smoke productivo.';
  console.error(`FAIL: ${message}`);
  if (error?.cause?.message) console.error(`Detalle: ${safeMessage(error.cause.message)}`);
  process.exitCode = 1;
});
