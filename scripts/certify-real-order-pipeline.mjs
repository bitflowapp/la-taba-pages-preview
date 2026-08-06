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
import { randomUUID, randomBytes } from 'node:crypto';

const CONFIRMATION = 'I_UNDERSTAND_THIS_MUTATES_STAGING';

const env = (name) => String(process.env[name] || '').trim();

const SUPABASE_URL = env('SUPABASE_URL');
const SERVICE_ROLE_KEY = env('SUPABASE_SERVICE_ROLE_KEY');
const ANON_KEY = env('SUPABASE_ANON_KEY');
const BUSINESS_ID = env('TABA_BUSINESS_ID');

if (env('TABA_CERTIFY_CONFIRM') !== CONFIRMATION) {
  console.error(`Definí TABA_CERTIFY_CONFIRM=${CONFIRMATION} para correr la certificación.`);
  process.exit(2);
}
for (const [name, value] of Object.entries({ SUPABASE_URL, SERVICE_ROLE_KEY, ANON_KEY, BUSINESS_ID })) {
  if (!value) {
    console.error(`Falta ${name}.`);
    process.exit(2);
  }
}
if (/(^|\.)la-taba-demo\./.test(SUPABASE_URL)) {
  console.error('La certificación nunca corre contra la-taba-demo.');
  process.exit(2);
}

const service = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const results = [];
const cleanup = [];
let failures = 0;

function check(name, condition, detail = '') {
  const ok = Boolean(condition);
  if (!ok) failures += 1;
  results.push({ ok, name, detail });
  console.log(`${ok ? 'OK  ' : 'FAIL'}  ${name}${detail ? `  — ${detail}` : ''}`);
  return ok;
}

function token() {
  return randomBytes(32).toString('hex');
}

function requestId(prefix) {
  return `${prefix}_${randomBytes(12).toString('hex')}`;
}

async function createActor(role) {
  const email = `cert-${role}-${randomUUID()}@staging.local`;
  const password = `Cert-${randomBytes(18).toString('base64url')}`;
  const { data, error } = await service.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  if (error) throw new Error(`No se pudo crear el actor ${role}: ${error.message}`);
  const userId = data.user.id;
  if (role !== 'customer') {
    const { error: memberError } = await service
      .from('business_members')
      .insert({ business_id: BUSINESS_ID, user_id: userId, role, is_active: true });
    if (memberError) throw new Error(`No se pudo dar rol ${role}: ${memberError.message}`);
  }
  // El actor no se borra: quedó como sujeto de los eventos de auditoría del
  // pedido, y borrarlo destruiría esa evidencia. Se le retira la capacidad de
  // operar, que es lo que hace falta.
  cleanup.push(async () => {
    await service.from('business_members')
      .update({ is_active: false })
      .eq('business_id', BUSINESS_ID)
      .eq('user_id', userId);
    await service.auth.admin.updateUserById(userId, { ban_duration: '876000h' });
  });
  const client = createClient(SUPABASE_URL, ANON_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { error: signInError } = await client.auth.signInWithPassword({ email, password });
  if (signInError) throw new Error(`No se pudo iniciar sesión ${role}: ${signInError.message}`);
  return { role, userId, client };
}

/**
 * Deja el pedido de certificación fuera de la operación real sin borrarlo: si
 * todavía no terminó se lo cancela — lo que devuelve el stock cuando el pedido
 * no salió a la calle — y después se lo marca QA. Un pedido entregado se
 * conserva entregado: el stock consumido es correcto.
 */
async function retireCertificationOrder(orderId, staff, reason) {
  const current = await orderRow(orderId, 'id,status,revision,origin');
  if (!current) return;
  if (!['delivered', 'cancelled', 'canceled', 'rejected'].includes(current.status)) {
    await staff.client.rpc('transition_order', {
      p_order_id: orderId,
      p_expected_revision: current.revision,
      p_new_status: 'cancelled',
      p_idempotency_key: requestId('cert_retire'),
    });
  }
  await service.rpc('classify_order_as_qa', { p_order_id: orderId, p_reason: reason });
}

async function orderRow(orderId, columns = '*') {
  const { data } = await service.from('orders').select(columns).eq('id', orderId).maybeSingle();
  return data || null;
}

async function productRow(productId) {
  const { data } = await service.from('products').select('id,name,stock,price').eq('id', productId).maybeSingle();
  return data || null;
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
  };
}

async function main() {
  console.log(`\n=== Certificación del circuito real de pedidos ===\n${SUPABASE_URL}\n`);

  // ---------------------------------------------------------------- baseline
  const { data: lt30Before } = await service
    .from('orders')
    .select('id,status,revision,assigned_rider_user_id,arrived_at,origin')
    .eq('public_code', 'LT-0030')
    .maybeSingle();
  const { count: gpsBefore } = await service
    .from('rider_locations')
    .select('id', { count: 'exact', head: true })
    .eq('order_id', lt30Before?.id || randomUUID());

  const customer = await createActor('customer');
  const staff = await createActor('staff');
  const rider = await createActor('rider');

  // Producto comercial (demo_fixture) => pedido de operación real.
  const { data: realProduct } = await service
    .from('products')
    .select('id,name,price,stock')
    .eq('business_id', BUSINESS_ID)
    .eq('catalog_origin', 'demo_fixture')
    .eq('available', true)
    .eq('is_verified', true)
    .order('price', { ascending: true })
    .limit(1)
    .maybeSingle();
  // Fixture QA deliberado => pedido que nunca entra a la operación real.
  const { data: qaProduct } = await service
    .from('products')
    .select('id,name,price,stock')
    .eq('business_id', BUSINESS_ID)
    .in('catalog_origin', ['test_only', 'staging_only'])
    .eq('available', true)
    .eq('is_verified', true)
    .limit(1)
    .maybeSingle();

  if (!realProduct || !qaProduct) throw new Error('El catálogo de staging no tiene los productos necesarios.');

  // ============================================================ GATE 1: real
  console.log('\n--- Gate 1: pedido real recorre el circuito completo ---');
  const stockBefore = (await productRow(realProduct.id)).stock;
  const realRequestId = requestId('cert_real');
  const realTrackingToken = token();
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
  cleanup.push(() => retireCertificationOrder(realOrderId, staff, 'pipeline_certification_run'));

  let real = await orderRow(realOrderId);
  check('el pedido nace en operación real', real.origin === 'production', `origin=${real.origin}`);
  check('el pedido nace en received', real.status === 'received', `status=${real.status}`);
  check(
    'dirección, teléfono, envío y total llegan completos',
    Boolean(real.customer_phone) && Boolean(real.delivery_street) && Boolean(real.delivery_street_number)
      && Number(real.delivery_fee) > 0 && Number(real.total) === Number(real.subtotal) + Number(real.delivery_fee),
    `tel=${real.customer_phone} calle=${real.delivery_street} ${real.delivery_street_number} envio=${real.delivery_fee} total=${real.total}`,
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

  // ======================================================== GATE 2: QA aparte
  console.log('\n--- Gate 2: el pedido QA queda fuera de la operación real ---');
  const { data: qaCreated, error: qaError } = await customer.client.rpc('create_order_with_items', {
    payload: orderPayload({
      productId: qaProduct.id,
      quantity: 1,
      paymentMethod: 'coordinate',
      clientRequestId: requestId('cert_qa'),
      name: 'Certificacion Fixture QA',
    }),
  });
  if (qaError) throw new Error(`No se pudo crear el pedido QA: ${qaError.message}`);
  const qaOrderId = qaCreated?.id || qaCreated?.order?.id;
  cleanup.push(() => retireCertificationOrder(qaOrderId, staff, 'pipeline_certification_run'));
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
    .eq('id', realOrderId);
  check('no se puede marcar Mercado Pago sin pago verificado', Boolean(fakePaid),
    fakePaid?.message?.slice(0, 90) || 'la base lo aceptó');

  const { data: mpOrders } = await service
    .from('orders')
    .select('id,public_code')
    .eq('payment_method', 'mercadopago');
  let everyMpOrderVerified = true;
  for (const row of mpOrders || []) {
    const { count } = await service
      .from('payment_intents')
      .select('id', { count: 'exact', head: true })
      .eq('order_id', row.id)
      .eq('internal_status', 'completed')
      .eq('provider_status', 'approved');
    if (count !== 1) everyMpOrderVerified = false;
  }
  check('todo pedido Mercado Pago tiene su pago verificado contra el proveedor',
    everyMpOrderVerified, `pedidos=${(mpOrders || []).length}`);

  // ============================================== GATE 4: stock y vencimiento
  console.log('\n--- Gate 4: el stock reservado siempre vuelve ---');

  // Checkout de Mercado Pago: reserva stock, no crea pedido hasta que el pago
  // esté verificado, y devuelve el stock cuando vence.
  const mpStockBefore = (await productRow(realProduct.id)).stock;
  const { data: session, error: sessionError } = await service.rpc('create_checkout_session', {
    p_customer_id: customer.userId,
    p_payload: {
      business_id: BUSINESS_ID,
      client_request_id: requestId('cert_mp'),
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
      },
      age_confirmed: false,
    },
  });
  check('el checkout de Mercado Pago se crea en el backend', !sessionError && Boolean(session),
    sessionError?.message || '');
  const sessionId = session?.checkout_session_id || session?.id;

  const mpStockReserved = (await productRow(realProduct.id)).stock;
  check('abrir el checkout reserva el stock', mpStockReserved === mpStockBefore - 1,
    `${mpStockBefore} -> ${mpStockReserved}`);

  const { count: ordersForSession } = await service
    .from('orders')
    .select('id', { count: 'exact', head: true })
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
  const { data: sessionRowDb } = await service
    .from('checkout_sessions').select('created_at').eq('id', sessionId).maybeSingle();
  const shortExpiry = new Date(Date.parse(sessionRowDb.created_at) + 1_000).toISOString();
  const { data: aged, error: ageError } = await service.from('checkout_sessions')
    .update({ expires_at: shortExpiry })
    .eq('id', sessionId)
    .select('id,expires_at');
  check('el checkout se puede vencer para la prueba', (aged || []).length === 1,
    ageError?.message || `filas=${(aged || []).length}`);
  await service.from('inventory_reservations')
    .update({ expires_at: shortExpiry })
    .eq('checkout_session_id', sessionId)
    .select('id');
  await new Promise((resolve) => { setTimeout(resolve, 2_000); });
  const { data: swept } = await service.rpc('sweep_expired_checkout_sessions');
  const mpStockAfterSweep = (await productRow(realProduct.id)).stock;
  check('el barrido devuelve el stock del checkout abandonado',
    mpStockAfterSweep === mpStockBefore, `${mpStockReserved} -> ${mpStockAfterSweep} (barridas=${swept})`);

  const { data: expiredSession } = await service
    .from('checkout_sessions').select('status').eq('id', sessionId).maybeSingle();
  check('el checkout abandonado queda en expired', expiredSession?.status === 'expired',
    `status=${expiredSession?.status}`);

  const { data: orphanReservations } = await service.rpc('list_stock_reservation_alerts');
  check('no hay reservas vencidas sin liberar', (orphanReservations || []).length === 0,
    `huérfanas=${(orphanReservations || []).length}`);

  const { data: cronJobs } = await service.rpc('sweep_expired_checkout_sessions');
  check('el barrido de checkouts vencidos es ejecutable', Number.isInteger(cronJobs), `liberadas=${cronJobs}`);

  const { data: unfinalized } = await service.rpc('list_unfinalized_paid_checkouts');
  check('ningún pago verificado quedó sin pedido', (unfinalized || []).length === 0,
    `pendientes=${(unfinalized || []).length}`);

  // ============================================ GATE 5: LT-0030 sin tocar
  console.log('\n--- Gate 5: la evidencia protegida sigue intacta ---');
  const { data: lt30After } = await service
    .from('orders')
    .select('id,status,revision,assigned_rider_user_id,arrived_at,origin,origin_reason')
    .eq('public_code', 'LT-0030')
    .maybeSingle();
  const { count: gpsAfter } = await service
    .from('rider_locations')
    .select('id', { count: 'exact', head: true })
    .eq('order_id', lt30After?.id || randomUUID());
  check('LT-0030 conserva estado, revisión, rider y GPS',
    lt30Before && lt30After
      && lt30After.status === lt30Before.status
      && lt30After.revision === lt30Before.revision
      && lt30After.assigned_rider_user_id === lt30Before.assigned_rider_user_id
      && lt30After.arrived_at === lt30Before.arrived_at
      && gpsAfter === gpsBefore,
    `status=${lt30After?.status} revision=${lt30After?.revision} gps=${gpsAfter}`);
  check('LT-0030 quedó clasificado como QA sin perder evidencia',
    lt30After?.origin === 'qa' && Boolean(lt30After?.origin_reason),
    `origin=${lt30After?.origin} motivo=${lt30After?.origin_reason}`);

  for (const code of ['LT-0033', 'LT-0034', 'LT-0035']) {
    const { data: row } = await service
      .from('orders')
      .select('public_code,origin,origin_reason,status,payment_method')
      .eq('public_code', code)
      .maybeSingle();
    const { count: events } = await service
      .from('order_events')
      .select('id', { count: 'exact', head: true })
      .eq('order_id', (await service.from('orders').select('id').eq('public_code', code).maybeSingle()).data?.id);
    check(`${code} clasificado QA y con su evidencia`,
      row?.origin === 'qa' && Boolean(row?.origin_reason) && Number(events) > 0,
      `origin=${row?.origin} motivo=${row?.origin_reason} eventos=${events}`);
  }

  console.log('\n--- Limpieza ---');
}

main()
  .catch((error) => {
    failures += 1;
    console.error(`\nERROR: ${error.message}`);
  })
  .finally(async () => {
    for (const task of cleanup.reverse()) {
      try { await task(); } catch (error) { console.error(`limpieza: ${error.message}`); }
    }
    const passed = results.filter((r) => r.ok).length;
    console.log(`\n=== ${passed}/${results.length} comprobaciones verdes, ${failures} fallas ===`);
    process.exit(failures === 0 ? 0 : 1);
  });
