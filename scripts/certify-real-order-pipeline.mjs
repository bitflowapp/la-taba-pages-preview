#!/usr/bin/env node
/**
 * Certificación viva del circuito real de pedidos de TABA2.
 *
 * No prueba SQL contra un archivo: le pide al backend desplegado que haga el
 * recorrido completo — cliente, checkout, validación, pedido, Panel, rider,
 * entrega — y comprueba las invariantes una por una contra la base real.
 *
 * Es deliberadamente fail-closed: sin confirmación explícita y sin credenciales
 * de servicio no hace nada. Muta el proyecto de staging; nunca apuntarlo a
 * producción.
 *
 *   TABA_CERTIFY_CONFIRM=I_UNDERSTAND_THIS_MUTATES_STAGING \
 *   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... SUPABASE_ANON_KEY=... \
 *   TABA_BUSINESS_ID=... node scripts/certify-real-order-pipeline.mjs
 */

import { createClient } from '@supabase/supabase-js';
import { randomBytes } from 'node:crypto';
import {
  assertStagingCertificationTarget,
  verifyStagingCertificationIdentity,
} from './lib/staging-certification-target.mjs';
import {
  boundedCertificationClient, certificationCleanup, certificationInterruption,
  createCertificationActor, requireCertificationResult, verifyCertificationFixtures,
  ownedCertificationCheckout, releaseCertificationCheckout,
} from './lib/staging-certification-resources.mjs';

async function runCertification() {
const env = (name) => String(process.env[name] || '').trim();

const SUPABASE_URL = env('SUPABASE_URL');
const SERVICE_ROLE_KEY = env('SUPABASE_SERVICE_ROLE_KEY');
const ANON_KEY = env('SUPABASE_ANON_KEY');
const BUSINESS_ID = env('TABA_BUSINESS_ID');
const certificationTarget = {
  supabaseUrl: SUPABASE_URL,
  businessId: BUSINESS_ID,
  confirmation: env('TABA_CERTIFY_CONFIRM'),
};

try {
  assertStagingCertificationTarget(certificationTarget);
} catch (error) {
  console.error(error.message);
  process.exitCode = 2;
  return;
}
for (const [name, value] of Object.entries({ SUPABASE_URL, SERVICE_ROLE_KEY, ANON_KEY, BUSINESS_ID })) {
  if (!value) {
    console.error(`Falta ${name}.`);
    process.exitCode = 2;
    return;
  }
}
const interruption = certificationInterruption();
try {
const service = boundedCertificationClient(createClient, SUPABASE_URL, SERVICE_ROLE_KEY, {}, interruption.signal);
const cleanupService = boundedCertificationClient(createClient, SUPABASE_URL, SERVICE_ROLE_KEY);
const clientFor = ({ cleanup: cleaning = false } = {}) =>
  boundedCertificationClient(createClient, SUPABASE_URL, ANON_KEY, {}, cleaning ? undefined : interruption.signal);
let fixtures;
try {
  const identity = await verifyStagingCertificationIdentity(service, certificationTarget);
  if (process.argv.includes('--preflight-only')) {
    console.log(JSON.stringify({ ok: true, readOnly: true, scope: 'staging_identity_only',
      projectRef: identity.projectRef, businessId: identity.businessId, paymentEnvironment: 'test' }));
    return;
  }
  fixtures = await verifyCertificationFixtures(service, certificationTarget, {
    operationalProductId: env('TABA_CERTIFY_OPERATIONAL_PRODUCT_ID'),
    isolationProductId: env('TABA_CERTIFY_ISOLATION_PRODUCT_ID'),
  });
  if (process.argv.includes('--fixtures-preflight-only')) {
    console.log(JSON.stringify({ ok: true, readOnly: true, scope: 'staging_identity_and_fixtures',
      businessId: identity.businessId, operationalProductId: fixtures.realProduct.id,
      isolationProductId: fixtures.qaProduct.id }));
    return;
  }
} catch (error) {
  console.error(error.message);
  process.exitCode = 2;
  return;
}

const results = [];
const cleanup = certificationCleanup();
const ownedOrders = new Map();
let failures = 0;

function check(name, condition, detail = '') {
  const ok = Boolean(condition);
  if (!ok) failures += 1;
  results.push({ ok, name, detail });
  console.log(`${ok ? 'OK  ' : 'FAIL'}  ${name}${detail ? `  - ${detail}` : ''}`);
  if (!ok) throw new Error('STAGING_CERTIFICATION_CHECK_FAILED');
  return ok;
}

function token() {
  return randomBytes(32).toString('hex');
}

function requestId(prefix) {
  return `${prefix}_${randomBytes(12).toString('hex')}`;
}

async function createActor(role) {
  return createCertificationActor({ service, cleanupService, clientFor,
    target: certificationTarget, role, cleanup });
}

function createTrackingClient(trackingToken) {
  return boundedCertificationClient(createClient, SUPABASE_URL, ANON_KEY, {
    global: { headers: { 'x-order-token': trackingToken } },
  }, interruption.signal);
}

/**
 * Deja el pedido de certificación fuera de la operación real sin borrarlo: si
 * todavía no terminó se lo cancela — lo que devuelve el stock cuando el pedido
 * no salió a la calle — y después se lo marca QA. Un pedido entregado se
 * conserva entregado. Cuando la certificación llegó a entrega, repone la
 * unidad con un movimiento auditable para no degradar el catálogo de staging.
 */
async function retireCertificationOrder(orderId, staff, reason, { productId = null, quantity = 0 } = {}) {
  const current = await orderRow(orderId, 'id,status,revision,origin', cleanupService);
  const errors = [];
  if (!['delivered', 'cancelled', 'canceled', 'rejected'].includes(current.status)) {
    try {
      requireCertificationResult(await staff.cleanupClient.rpc('transition_order', {
        p_order_id: orderId, p_expected_revision: current.revision,
        p_new_status: 'cancelled', p_idempotency_key: requestId('cert_retire'),
      }), 'ORDER_RETIRE');
      const after = await orderRow(orderId, 'status', cleanupService);
      if (after.status !== 'cancelled') throw new Error('STAGING_CERTIFICATION_ORDER_RETIRE_UNVERIFIED');
    } catch (error) { errors.push(error); }
  }
  // Even a failed cancellation must not leave a test order in the real inbox.
  try {
    requireCertificationResult(await cleanupService.rpc('classify_order_as_qa', {
      p_order_id: orderId, p_reason: reason,
    }), 'ORDER_CLASSIFY', { requireOk: true });
    const after = await orderRow(orderId, 'origin', cleanupService);
    if (after.origin !== 'qa') throw new Error('STAGING_CERTIFICATION_ORDER_CLASSIFY_UNVERIFIED');
  } catch (error) { errors.push(error); }
  if (current.status === 'delivered' && productId && quantity > 0) {
    try {
      const movement = requireCertificationResult(await staff.cleanupClient.rpc('apply_inventory_movement', {
        p_business_id: BUSINESS_ID, p_product_id: productId, p_barcode_id: null,
        p_movement_type: 'manual_adjustment', p_package_quantity: quantity, p_direction: 1,
        p_reference_type: 'qa_certification_order', p_reference_id: orderId,
        p_reason: 'Reposicion posterior a certificacion integral de staging',
        p_idempotency_key: `cert_restore_${String(orderId).replaceAll('-', '')}`,
      }), 'STOCK_RESTORE');
      if (Number(movement?.quantity_delta) !== quantity) throw new Error('STAGING_CERTIFICATION_STOCK_RESTORE_UNVERIFIED');
    } catch (error) { errors.push(error); }
  }
  if (errors.length) throw new AggregateError(errors, 'STAGING_CERTIFICATION_ORDER_CLEANUP_FAILED');
}

async function orderRow(orderId, columns = '*', client = service) {
  const owner = ownedOrders.get(orderId);
  if (!owner) throw new Error('STAGING_CERTIFICATION_ORDER_NOT_OWNED');
  const row = requireCertificationResult(await client.from('orders')
    .select(columns === '*' ? '*' : `business_id,customer_user_id,client_request_id,${columns}`)
    .eq('business_id', BUSINESS_ID).eq('id', orderId)
    .eq('customer_user_id', owner.customerId).eq('client_request_id', owner.requestId).maybeSingle(), 'ORDER_READ');
  if (!row || row.business_id !== BUSINESS_ID || row.customer_user_id !== owner.customerId
    || row.client_request_id !== owner.requestId) throw new Error('STAGING_CERTIFICATION_ORDER_OWNERSHIP_REJECTED');
  return row;
}

async function productRow(productId) {
  if (![fixtures.realProduct.id, fixtures.qaProduct.id].includes(productId)) {
    throw new Error('STAGING_CERTIFICATION_PRODUCT_NOT_SELECTED');
  }
  const row = requireCertificationResult(await service.from('products').select('id,business_id,name,stock,price')
    .eq('business_id', BUSINESS_ID).eq('id', productId).maybeSingle(), 'PRODUCT_READ');
  if (!row || row.business_id !== BUSINESS_ID) throw new Error('STAGING_CERTIFICATION_PRODUCT_OWNERSHIP_REJECTED');
  return row;
}

function orderPayload({ productId, quantity, paymentMethod, clientRequestId, name, trackingToken }) {
  return {
    business_id: BUSINESS_ID,
    client_request_id: clientRequestId,
    tracking_token: trackingToken || token(),
    items: [{ product_id: productId, quantity }],
    customer_name: name,
    customer_phone: '2995551000',
    delivery_mode: 'delivery',
    payment_method: paymentMethod,
    age_confirmed: false,
    customer_street_address: 'Avenida Certificacion 1234',
    address_label: 'Avenida Certificacion 1234',
    customer_neighborhood: 'Centro',
    delivery_street: 'Avenida Certificacion',
    delivery_street_number: '1234',
    delivery_city: 'Neuquen',
    delivery_province: 'Neuquen',
    delivery_latitude: -38.9516,
    delivery_longitude: -68.0591,
    delivery_geolocation_accuracy: 18,
    delivery_address_source: 'manual',
    delivery_location_source: 'map_pin',
    delivery_location_confirmed_at: new Date().toISOString(),
  };
}

async function main() {
  console.log(`\n=== Certificación del circuito real de pedidos ===\n${SUPABASE_URL}\n`);

  // Explicit selection prevents this helper from choosing shared catalog rows.
  // Current commercial QA products are valid; demo_fixture is not a requirement.
  const { realProduct, qaProduct } = fixtures;
  const baselineColumns = 'id,status,revision,assigned_rider_user_id,arrived_at,origin,origin_reason,updated_at';
  const baseline = requireCertificationResult(await service.from('orders').select(baselineColumns)
    .eq('business_id', BUSINESS_ID).order('id').limit(100), 'BASELINE_READ');

  const customer = await createActor('customer');
  const staff = await createActor('staff');
  const rider = await createActor('rider');

  // ============================================================ GATE 1: real
  console.log('\n--- Gate 1: pedido real recorre el circuito completo ---');
  const stockBefore = (await productRow(realProduct.id)).stock;
  const realRequestId = requestId('cert_real');
  const realTrackingToken = token();
  const trackingClient = createTrackingClient(realTrackingToken);
  const { data: created, error: createError } = await customer.client.rpc('create_order_with_items', {
    payload: orderPayload({
      productId: realProduct.id,
      quantity: 1,
      paymentMethod: 'coordinate',
      clientRequestId: realRequestId,
      name: 'Certificacion Circuito Real',
      trackingToken: realTrackingToken,
    }),
  });
  if (createError) throw new Error(`No se pudo crear el pedido real: ${createError.message}`);
  const realOrderId = created?.id || created?.order?.id;
  check('el checkout crea exactamente un pedido', Boolean(realOrderId), `id=${realOrderId}`);
  ownedOrders.set(realOrderId, { customerId: customer.userId, requestId: realRequestId });
  cleanup.add('real_order', () => retireCertificationOrder(
    realOrderId,
    staff,
    'pipeline_certification_run',
    { productId: realProduct.id, quantity: 1 },
  ));

  let real = await orderRow(realOrderId);
  check('el pedido nace en operación real', real.origin === 'production', `origin=${real.origin}`);
  check('el pedido nace en received', real.status === 'received', `status=${real.status}`);
  check(
    'dirección, teléfono, envío y total llegan completos',
    Boolean(real.customer_phone) && Boolean(real.delivery_street) && Boolean(real.delivery_street_number)
      && Number(real.delivery_fee) > 0 && Number(real.total) === Number(real.subtotal) + Number(real.delivery_fee),
    `tel=${real.customer_phone} calle=${real.delivery_street} ${real.delivery_street_number} envio=${real.delivery_fee} total=${real.total}`,
  );

  const { data: trackingBeforeAssignment, error: trackingBeforeError } = await trackingClient.rpc(
    'get_public_order_tracking',
    { p_public_id: realOrderId },
  );
  check(
    'el cliente ve el pedido sin inventar rider antes de la asignación',
    !trackingBeforeError
      && trackingBeforeAssignment?.status === 'received'
      && trackingBeforeAssignment?.location_quality === 'unavailable'
      && !trackingBeforeAssignment?.rider_location,
    trackingBeforeError?.message
      || `status=${trackingBeforeAssignment?.status} quality=${trackingBeforeAssignment?.location_quality}`,
  );

  const stockAfter = (await productRow(realProduct.id)).stock;
  check('el stock se descuenta al crear el pedido', stockAfter === stockBefore - 1, `${stockBefore} -> ${stockAfter}`);

  const { data: dup, error: dupError } = await customer.client.rpc('create_order_with_items', {
    payload: orderPayload({
      productId: realProduct.id,
      quantity: 1,
      paymentMethod: 'coordinate',
      clientRequestId: realRequestId,
      name: 'Certificacion Circuito Real',
      trackingToken: realTrackingToken,
    }),
  });
  const dupId = dup?.id || dup?.order?.id;
  const { count: sameRequestCount } = await service
    .from('orders')
    .select('id', { count: 'exact', head: true })
    .eq('business_id', BUSINESS_ID).eq('customer_user_id', customer.userId)
    .eq('client_request_id', realRequestId);
  // La invariante es el dato, no la forma de la respuesta: un mismo
  // client_request_id no puede producir un segundo pedido, se lo replique o se
  // lo rechace.
  check('reintentar el mismo pedido no duplica', sameRequestCount === 1,
    `filas=${sameRequestCount} replay=${dupId === realOrderId ? 'mismo pedido' : (dupError?.code || 'rechazado')}`);
  const stockAfterRetry = (await productRow(realProduct.id)).stock;
  check('el reintento no vuelve a descontar stock', stockAfterRetry === stockAfter, `stock=${stockAfterRetry}`);

  // Panel
  const { data: inbox } = await staff.client
    .from('orders')
    .select('id,public_code,origin,status')
    .eq('business_id', BUSINESS_ID)
    .eq('origin', 'production')
    .in('status', ['submitted', 'received', 'accepted', 'preparing', 'ready', 'assigned', 'picked_up', 'on_the_way', 'arrived', 'arriving']);
  const inboxIds = (inbox || []).map((row) => row.id);
  check('el Panel recibe el pedido real', inboxIds.includes(realOrderId), `bandeja=${inboxIds.length}`);
  check('el Panel lo recibe una sola vez', inboxIds.filter((id) => id === realOrderId).length === 1);

  const { count: notifications } = await service
    .from('notification_outbox')
    .select('id', { count: 'exact', head: true })
    .eq('aggregate_id', realOrderId)
    .eq('event_type', 'new_order');
  check('se encola un único aviso de pedido nuevo', notifications === 1, `avisos=${notifications}`);

  // Aceptación y preparación
  for (const next of ['accepted', 'preparing', 'ready']) {
    real = await orderRow(realOrderId);
    const { error } = await staff.client.rpc('transition_order', {
      p_order_id: realOrderId,
      p_expected_revision: real.revision,
      p_new_status: next,
      p_idempotency_key: requestId('cert'),
    });
    if (error) throw new Error(`No se pudo pasar a ${next}: ${error.message}`);
  }
  real = await orderRow(realOrderId);
  check('el negocio acepta, prepara y deja listo el pedido', real.status === 'ready', `status=${real.status}`);

  const { data: staleTransition } = await staff.client.rpc('transition_order', {
    p_order_id: realOrderId,
    p_expected_revision: 1,
    p_new_status: 'delivered',
    p_idempotency_key: requestId('cert'),
  }).then((r) => ({ data: r.error ? 'rechazado' : 'aceptado' }));
  check('una revisión atrasada no puede mover el pedido', staleTransition === 'rechazado');

  // Rider
  const { data: available } = await rider.client.rpc('list_available_rider_orders', { p_business_id: BUSINESS_ID });
  const availableCodes = (available || []).map((row) => row.public_code);
  check('el rider ve el pedido asignable', availableCodes.includes(real.public_code), `cola=${availableCodes.join(',') || 'vacía'}`);

  // `claim_delivery_order` es el contrato canónico; la sobrecarga
  // `claim_available_rider_order` quedó revocada en 20260802102000.
  const claimKey = requestId('cert_claim');
  const { data: claimed, error: claimError } = await rider.client.rpc('claim_delivery_order', {
    p_business_id: BUSINESS_ID,
    p_public_code: real.public_code,
    p_expected_revision: real.revision,
    p_idempotency_key: claimKey,
  });
  if (claimError) throw new Error(`El rider no pudo tomar el pedido: ${claimError.message}`);
  check('el rider toma el pedido y queda asignado', claimed?.ok === true, `code=${claimed?.code || 'ok'}`);
  real = await orderRow(realOrderId);
  check('el pedido queda asignado a ese rider',
    real.status === 'assigned' && real.assigned_rider_user_id === rider.userId, `status=${real.status}`);

  const { data: reclaimed } = await rider.client.rpc('claim_delivery_order', {
    p_business_id: BUSINESS_ID,
    p_public_code: real.public_code,
    p_expected_revision: real.revision,
    p_idempotency_key: claimKey,
  });
  check('tomarlo dos veces es un no-op idempotente', reclaimed?.idempotent_no_op === true);

  // El contrato exige retiro antes de ruta: `start_rider_delivery` sólo acepta
  // un pedido ya `picked_up`.
  real = await orderRow(realOrderId);
  const { data: pickedUp } = await rider.client.rpc('mark_delivery_picked_up', {
    p_order_id: realOrderId,
    p_expected_revision: real.revision,
    p_idempotency_key: requestId('cert_pickup'),
  });
  real = await orderRow(realOrderId);
  check('el rider registra el retiro', pickedUp?.ok === true && real.status === 'picked_up',
    `status=${real.status} code=${pickedUp?.code || 'ok'}`);

  real = await orderRow(realOrderId);
  const { data: started } = await rider.client.rpc('start_rider_delivery', {
    p_order_id: realOrderId,
    p_expected_revision: real.revision,
    p_idempotency_key: requestId('cert_start'),
  });
  real = await orderRow(realOrderId);
  check('el pedido queda en camino tras el retiro',
    started?.ok === true && real.status === 'on_the_way',
    `status=${real.status} code=${started?.code || 'ok'}`);

  const { data: gpsReceipt, error: gpsError } = await rider.client.rpc('publish_rider_location_receipt', {
    p_order_id: realOrderId,
    p_expected_revision: real.revision,
    p_lat: -38.9516,
    p_lng: -68.0591,
    p_accuracy: 18,
    p_heading: 90,
    p_speed: 8,
    p_captured_at: new Date().toISOString(),
    p_idempotency_key: requestId('cert_gps'),
    p_is_mock: false,
  });
  check(
    'el backend acepta el fix GPS y devuelve recibo explícito',
    !gpsError && gpsReceipt?.ok === true && gpsReceipt?.code === 'accepted',
    gpsError?.message || `ok=${gpsReceipt?.ok} code=${gpsReceipt?.code || 'sin_codigo'}`,
  );

  const { data: throttledReceipt, error: throttledError } = await rider.client.rpc(
    'publish_rider_location_receipt',
    {
      p_order_id: realOrderId,
      p_expected_revision: real.revision,
      p_lat: -38.9516,
      p_lng: -68.0591,
      p_accuracy: 18,
      p_heading: 90,
      p_speed: 8,
      p_captured_at: new Date().toISOString(),
      p_idempotency_key: requestId('cert_gps_throttle'),
      p_is_mock: false,
    },
  );
  check(
    'el servidor respeta el throttle GPS de cinco segundos',
    !throttledError && throttledReceipt?.ok === false && throttledReceipt?.code === 'throttled',
    throttledError?.message || `ok=${throttledReceipt?.ok} code=${throttledReceipt?.code || 'sin_codigo'}`,
  );

  const { data: liveTracking, error: liveTrackingError } = await trackingClient.rpc(
    'get_public_order_tracking',
    { p_public_id: realOrderId },
  );
  check(
    'Customer recibe tracking válido sin Null Island',
    !liveTrackingError
      && liveTracking?.status === 'on_the_way'
      && liveTracking?.location_quality === 'valid'
      && Number.isFinite(Number(liveTracking?.rider_location?.lat))
      && Number.isFinite(Number(liveTracking?.rider_location?.lng))
      && Number(liveTracking.rider_location.lat) !== 0
      && Number(liveTracking.rider_location.lng) !== 0,
    liveTrackingError?.message
      || `status=${liveTracking?.status} quality=${liveTracking?.location_quality}`,
  );

  const { data: arrived } = await rider.client.rpc('mark_rider_arrived', {
    p_order_id: realOrderId,
    p_expected_revision: real.revision,
    p_idempotency_key: requestId('cert_arrive'),
  });
  real = await orderRow(realOrderId);
  check('el rider marca la llegada', arrived?.ok === true && real.status === 'arrived',
    `status=${real.status} code=${arrived?.code || 'ok'}`);

  const { data: issuedCode, error: issueError } = await customer.client.rpc('issue_order_delivery_code', {
    p_order_id: realOrderId,
    p_tracking_token: realTrackingToken,
  });
  const deliveryCode = String(
    issuedCode?.delivery_code || issuedCode?.code || (typeof issuedCode === 'string' ? issuedCode : ''),
  ).trim();
  check('el cliente obtiene su código de entrega', Boolean(deliveryCode),
    issueError?.message || `code=${deliveryCode ? 'emitido' : JSON.stringify(issuedCode)}`);

  real = await orderRow(realOrderId);
  const { data: wrongCode } = await rider.client.rpc('confirm_delivery_code', {
    p_order_id: realOrderId,
    p_expected_revision: real.revision,
    p_delivery_code: '000000',
    p_idempotency_key: requestId('cert_wrong'),
  });
  real = await orderRow(realOrderId);
  check('un código de entrega incorrecto no cierra el pedido',
    wrongCode?.ok !== true && real.status !== 'delivered',
    `status=${real.status} code=${wrongCode?.code || 'rechazado'}`);

  real = await orderRow(realOrderId);
  const { data: delivered, error: deliverError } = await rider.client.rpc('confirm_delivery_code', {
    p_order_id: realOrderId,
    p_expected_revision: real.revision,
    p_delivery_code: deliveryCode,
    p_idempotency_key: requestId('cert_deliver'),
  });
  real = await orderRow(realOrderId);
  check('el pedido se entrega con el código del cliente',
    delivered?.ok === true && real.status === 'delivered',
    `status=${real.status} code=${delivered?.code || deliverError?.message || 'ok'}`);
  const { data: finalState } = await service.rpc('order_pipeline_state', { p_order_status: real.status });
  check('el circuito termina en el estado canónico delivered',
    finalState === 'delivered' && Boolean(real.delivered_at), `estado=${finalState} entregado=${real.delivered_at}`);

  const { data: terminalTracking, error: terminalTrackingError } = await trackingClient.rpc(
    'get_public_order_tracking',
    { p_public_id: realOrderId },
  );
  check(
    'Customer conserva la ventana terminal y el GPS queda purgado al entregar',
    !terminalTrackingError
      && terminalTracking?.status === 'delivered'
      && Date.parse(terminalTracking?.terminal_visible_until || '') > Date.now()
      && terminalTracking?.location_quality === 'unavailable'
      && !terminalTracking?.rider_location,
    terminalTrackingError?.message
      || `status=${terminalTracking?.status} quality=${terminalTracking?.location_quality}`,
  );
  console.log(`DEMO_ORDER_EVIDENCE ${JSON.stringify({
    publicCode: real.public_code,
    createdAt: real.created_at,
    acceptedAt: real.accepted_at,
    readyAt: real.ready_at,
    dispatchedAt: real.dispatched_at || real.picked_up_at,
    arrivedAt: real.arrived_at,
    deliveredAt: real.delivered_at,
    status: real.status,
  })}`);

  // ======================================================== GATE 2: QA aparte
  console.log('\n--- Gate 2: el pedido QA queda fuera de la operación real ---');
  const qaRequestId = requestId('cert_qa');
  const { data: qaCreated, error: qaError } = await customer.client.rpc('create_order_with_items', {
    payload: orderPayload({
      productId: qaProduct.id,
      quantity: 1,
      paymentMethod: 'coordinate',
      clientRequestId: qaRequestId,
      name: 'Certificacion Fixture QA',
    }),
  });
  if (qaError) throw new Error(`No se pudo crear el pedido QA: ${qaError.message}`);
  const qaOrderId = qaCreated?.id || qaCreated?.order?.id;
  ownedOrders.set(qaOrderId, { customerId: customer.userId, requestId: qaRequestId });
  cleanup.add('isolation_order', () => retireCertificationOrder(qaOrderId, staff, 'pipeline_certification_run'));
  const qaOrder = await orderRow(qaOrderId);
  check('un pedido con fixture QA se clasifica solo', qaOrder.origin === 'qa', `origin=${qaOrder.origin} motivo=${qaOrder.origin_reason}`);

  const { data: inboxAfterQa } = await staff.client
    .from('orders')
    .select('id')
    .eq('business_id', BUSINESS_ID)
    .eq('origin', 'production')
    .in('status', ['submitted', 'received', 'accepted', 'preparing', 'ready']);
  check('el pedido QA no entra a la bandeja del Panel',
    !(inboxAfterQa || []).map((r) => r.id).includes(qaOrderId));

  const { data: qaNotification } = await service
    .from('notification_outbox')
    .select('state,payload')
    .eq('aggregate_id', qaOrderId)
    .eq('event_type', 'new_order')
    .maybeSingle();
  check('el pedido QA no suena en el Panel',
    qaNotification?.state === 'processed' && qaNotification?.payload?.suppressed === true,
    `state=${qaNotification?.state}`);

  // Se lo lleva a ready para probar el aislamiento del rider en el mismo estado
  // en el que un pedido real sí sería visible.
  for (const next of ['accepted', 'preparing', 'ready']) {
    const current = await orderRow(qaOrderId);
    await staff.client.rpc('transition_order', {
      p_order_id: qaOrderId,
      p_expected_revision: current.revision,
      p_new_status: next,
      p_idempotency_key: requestId('cert'),
    });
  }
  const qaReady = await orderRow(qaOrderId);
  const { data: availableWithQa } = await rider.client.rpc('list_available_rider_orders', { p_business_id: BUSINESS_ID });
  check('el rider nunca ve un pedido QA aunque esté listo',
    qaReady.status === 'ready' && !(availableWithQa || []).map((r) => r.public_code).includes(qaReady.public_code),
    `status=${qaReady.status}`);

  const { data: qaClaim, error: qaClaimError } = await rider.client.rpc('claim_delivery_order', {
    p_business_id: BUSINESS_ID,
    p_public_code: qaReady.public_code,
    p_expected_revision: qaReady.revision,
    p_idempotency_key: requestId('cert_qa_claim'),
  });
  const qaOrderAfterClaim = await orderRow(qaOrderId);
  check('el rider no puede tomar un pedido QA ni sabiendo el código',
    (Boolean(qaClaimError) || qaClaim?.ok === false) && qaOrderAfterClaim.assigned_rider_user_id === null,
    `code=${qaClaim?.code || qaClaimError?.code || 'lo tomó'}`);

  const { data: pipeline } = await staff.client.rpc('list_operational_pipeline', {
    p_business_id: BUSINESS_ID,
    p_include_qa: false,
  });
  const pipelineIds = (pipeline || []).map((row) => row.reference_id);
  check('el circuito operativo excluye QA por defecto',
    pipelineIds.includes(realOrderId) && !pipelineIds.includes(qaOrderId));
  const { data: pipelineWithQa } = await staff.client.rpc('list_operational_pipeline', {
    p_business_id: BUSINESS_ID,
    p_include_qa: true,
  });
  check('la evidencia QA sigue siendo consultable a pedido',
    (pipelineWithQa || []).map((row) => row.reference_id).includes(qaOrderId));

  // =============================================== GATE 3: pago no falsificable
  console.log('\n--- Gate 3: nadie declara un pago que no ocurrió ---');
  const { error: fakePaid } = await service
    .from('orders')
    .update({ payment_method: 'mercadopago' })
    .eq('business_id', BUSINESS_ID).eq('customer_user_id', customer.userId)
    .eq('client_request_id', realRequestId).eq('id', realOrderId);
  check('no se puede marcar Mercado Pago sin pago verificado', Boolean(fakePaid),
    fakePaid?.message?.slice(0, 90) || 'la base lo aceptó');

  const { count: inventedPayment, error: paymentReadError } = await service.from('payment_intents')
    .select('id', { count: 'exact', head: true }).eq('order_id', realOrderId)
    .eq('internal_status', 'completed').eq('provider_status', 'approved');
  check('el pedido de esta corrida no inventa un pago aprobado', !paymentReadError && inventedPayment === 0);
  console.log('PAYMENT_PROVIDER_CERTIFICATION NOT_EXERCISED');

  // ============================================== GATE 4: stock y vencimiento
  console.log('\n--- Gate 4: el stock reservado siempre vuelve ---');

  // Checkout de Mercado Pago: reserva stock, no crea pedido hasta que el pago
  // esté verificado, y devuelve el stock cuando vence.
  const mpStockBefore = (await productRow(realProduct.id)).stock;
  const mpRequestId = requestId('cert_mp');
  const { data: session, error: sessionError } = await service.rpc('create_checkout_session', {
    p_customer_id: customer.userId,
    p_payload: {
      business_id: BUSINESS_ID,
      client_request_id: mpRequestId,
      payment_method: 'mercadopago',
      fulfillment_type: 'delivery',
      items: [{ product_id: realProduct.id, quantity: 1 }],
      contact: { name: 'Certificacion Checkout MP', phone: '2995551000' },
      address: {
        street: 'Avenida Certificacion',
        street_number: '1234',
        city: 'Neuquen',
        province: 'Neuquen',
        source: 'manual',
        latitude: -38.9516,
        longitude: -68.0591,
        geolocation_accuracy: 18,
        location_source: 'map_pin',
        location_confirmed_at: new Date().toISOString(),
      },
      age_confirmed: false,
    },
  });
  check('el checkout de Mercado Pago se crea en el backend', !sessionError && Boolean(session),
    sessionError?.message || '');
  if (sessionError || !session) {
    throw new Error(`El checkout de Mercado Pago no quedó disponible: ${sessionError?.message || 'respuesta vacía'}`);
  }
  const sessionId = session?.checkout_session_id || session?.id;
  cleanup.add('checkout', () => releaseCertificationCheckout(cleanupService, certificationTarget,
    sessionId, customer.userId, mpRequestId));
  await ownedCertificationCheckout(service, certificationTarget, sessionId, customer.userId, mpRequestId);

  const mpStockReserved = (await productRow(realProduct.id)).stock;
  check('abrir el checkout reserva el stock', mpStockReserved === mpStockBefore - 1,
    `${mpStockBefore} -> ${mpStockReserved}`);

  const { count: ordersForSession } = await service
    .from('orders')
    .select('id', { count: 'exact', head: true })
    .eq('business_id', BUSINESS_ID).eq('customer_user_id', customer.userId)
    .eq('client_request_id', `mp_${String(sessionId).replace(/-/g, '')}`);
  check('un checkout sin pago verificado no crea ningún pedido', ordersForSession === 0,
    `pedidos=${ordersForSession}`);

  const { data: pendingPipeline } = await staff.client.rpc('list_operational_pipeline', {
    p_business_id: BUSINESS_ID,
    p_include_qa: true,
  });
  const sessionRow = (pendingPipeline || []).find((row) => row.reference_id === sessionId);
  check('el circuito muestra el checkout como pending', sessionRow?.pipeline_state === 'pending',
    `estado=${sessionRow?.pipeline_state}`);

  // Se acorta la ventana en vez de mandarla al pasado: `checkout_sessions_expiry_check`
  // exige expires_at > created_at, y tiene razón — una sesión no puede nacer vencida.
  const sessionRowDb = await ownedCertificationCheckout(service, certificationTarget, sessionId, customer.userId, mpRequestId);
  const shortExpiry = new Date(Date.parse(sessionRowDb.created_at) + 1_000).toISOString();
  const aged = requireCertificationResult(await service.from('checkout_sessions')
    .update({ expires_at: shortExpiry }).eq('business_id', BUSINESS_ID).eq('customer_id', customer.userId)
    .eq('client_request_id', mpRequestId).eq('id', sessionId).select('id,expires_at'), 'CHECKOUT_AGE');
  if (aged?.length !== 1 || aged[0].id !== sessionId) throw new Error('STAGING_CERTIFICATION_CHECKOUT_AGE_UNVERIFIED');
  requireCertificationResult(await service.from('inventory_reservations')
    .update({ expires_at: shortExpiry }).eq('checkout_session_id', sessionId)
    .eq('product_id', realProduct.id).select('id'), 'RESERVATION_AGE');
  await new Promise(resolve => setTimeout(resolve, 2_000));
  interruption.signal.throwIfAborted();
  const released = await releaseCertificationCheckout(service, certificationTarget,
    sessionId, customer.userId, mpRequestId, 'expired');
  const mpStockAfterRelease = (await productRow(realProduct.id)).stock;
  check('liberar solo este checkout devuelve su stock', mpStockAfterRelease === mpStockBefore,
    `stock=${mpStockAfterRelease} reservas=${released.released}`);
  const expiredSession = await ownedCertificationCheckout(service, certificationTarget, sessionId, customer.userId, mpRequestId);
  check('el checkout propio queda expired', expiredSession.status === 'expired');
  const { count: activeReservations, error: reservationError } = await service.from('inventory_reservations')
    .select('id', { count: 'exact', head: true }).eq('checkout_session_id', sessionId).eq('status', 'active');
  check('este checkout no deja reservas activas', !reservationError && activeReservations === 0);
  const again = await releaseCertificationCheckout(service, certificationTarget,
    sessionId, customer.userId, mpRequestId, 'expired');
  check('la segunda liberacion propia es idempotente', again.released === 0
    && (await productRow(realProduct.id)).stock === mpStockBefore);
  console.log('GLOBAL_EXPIRY_CRON_CERTIFICATION NOT_EXERCISED');

  // Preserve a bounded, declared baseline rather than require old public codes.
  if (baseline.length) {
    const after = requireCertificationResult(await service.from('orders').select(baselineColumns)
      .eq('business_id', BUSINESS_ID).in('id', baseline.map(row => row.id)).order('id'), 'BASELINE_READ');
    check('la muestra previa del tenant QA conserva estado y revision', JSON.stringify(after) === JSON.stringify(baseline),
      `pedidos_muestreados=${baseline.length}`);
  } else {
    console.log('PREEXISTING_QA_ORDER_BASELINE NOT_EXERCISED:EMPTY');
  }

  console.log('\n--- Limpieza ---');
}

await main()
  .catch((error) => {
    if (error.message !== 'STAGING_CERTIFICATION_CHECK_FAILED') failures += 1;
    console.error(/^STAGING_CERTIFICATION_[A-Z_]+(?::[A-Z_0-9]+)?$/.test(error.message)
      ? error.message : 'STAGING_CERTIFICATION_RUN_FAILED');
  })
  .finally(async () => {
    for (const name of await cleanup.run()) {
      failures += 1;
      console.error(`limpieza: ${name} FAILED`);
    }
    const passed = results.filter((r) => r.ok).length;
    console.log(`\n=== ${passed}/${results.length} comprobaciones verdes, ${failures} fallas ===`);
    process.exitCode = failures === 0 ? 0 : 1;
  });

} finally { interruption.close(); }
}
await runCertification().catch(() => {
  console.error('STAGING_CERTIFICATION_RUN_FAILED');
  process.exitCode = 1;
});
