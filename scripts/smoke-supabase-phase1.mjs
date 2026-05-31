#!/usr/bin/env node

const SUPABASE_URL = String(process.env.SUPABASE_URL || '').trim();
const SUPABASE_ANON_KEY = String(process.env.SUPABASE_ANON_KEY || '').trim();
const BUSINESS_ID = String(process.env.BUSINESS_ID || '').trim();
const SEED_BUSINESS_ID = '00000000-0000-4000-8000-000000000001';

const DEMO_LAT = -38.9516;
const DEMO_LNG = -68.0591;

main().catch((error) => {
  if (error instanceof SmokeFailure) {
    printFailure(error);
    process.exit(1);
  }

  printFailure(new SmokeFailure({
    endpoint: error?.endpoint || 'unknown',
    method: error?.method || 'unknown',
    status: error?.status || 0,
    body: error?.body || error?.message || 'Unexpected error',
    recommendation: 'Revisar la conectividad y la configuración de entorno.',
  }));
  process.exit(1);
});

async function main() {
  if (!SUPABASE_URL) {
    throw new SmokeFailure({
      endpoint: 'env',
      method: 'ENV',
      status: 0,
      body: 'Falta SUPABASE_URL.',
      recommendation: 'Definí SUPABASE_URL con la URL del proyecto Supabase.',
    });
  }

  if (!SUPABASE_ANON_KEY) {
    throw new SmokeFailure({
      endpoint: 'env',
      method: 'ENV',
      status: 0,
      body: 'Falta SUPABASE_ANON_KEY.',
      recommendation: 'Definí SUPABASE_ANON_KEY sin imprimirla completa en consola.',
    });
  }

  const baseUrl = SUPABASE_URL.replace(/\/+$/, '');
  const restBase = `${baseUrl}/rest/v1`;

  console.log(`Supabase URL: ${baseUrl}`);
  console.log(`Supabase anon key: ${redactKey(SUPABASE_ANON_KEY)}`);

  const health = await restRequest(restBase, '/businesses?select=id&limit=1', { method: 'GET' });
  const healthRows = asRows(health.payload);
  console.log(`REST OK: businesses query returned ${healthRows.length} row(s)`);

  const businessId = await resolveBusinessId(restBase);
  console.log(`Business ID: ${businessId}`);

  const { orderPayload, expectedTotals, code } = buildOrderPayload(businessId);
  const rpcResult = await callCreateOrderWithItems(restBase, orderPayload);
  const rpcRows = asRows(rpcResult.payload);
  const createdOrder = extractOrder(rpcResult.payload);

  let orderId = createdOrder?.id || rpcRows[0]?.id || null;
  let orderRow = null;
  if (!orderId) {
    const byCode = await fetchRows(restBase, `/orders?code=eq.${encodeURIComponent(code)}&select=*,order_items(*),order_events(*),rider_locations(*)&limit=1`, 'GET');
    orderRow = extractOrder(byCode.payload);
    orderId = orderRow?.id || null;
  }
  if (!orderId) {
    throw new SmokeFailure({
      endpoint: 'POST /rest/v1/rpc/create_order_with_items',
      method: 'POST',
      status: rpcResult.status,
      body: summarizeBody(rpcResult.payload),
      recommendation: 'El RPC respondió sin devolver el pedido creado.',
    });
  }

  orderRow = orderRow || await fetchOrderByIdOrCode(restBase, orderId, code);
  verifyCreatedOrder(orderRow, expectedTotals);

  const orderItems = await fetchRows(restBase, `/order_items?order_id=eq.${encodeURIComponent(orderRow.id)}&select=id,order_id,quantity,unit_price,subtotal&order=created_at.asc`, 'GET');
  if (!asRows(orderItems.payload).length) {
    throw new SmokeFailure({
      endpoint: `GET /rest/v1/order_items?order_id=eq.${encodeURIComponent(orderRow.id)}`,
      method: 'GET',
      status: orderItems.status,
      body: summarizeBody(orderItems.payload),
      recommendation: 'Faltan order_items: revisar la migración base o el RPC.',
    });
  }

  const orderEvents = await fetchRows(restBase, `/order_events?order_id=eq.${encodeURIComponent(orderRow.id)}&select=id,type,created_at&order=created_at.asc`, 'GET');
  if (!asRows(orderEvents.payload).length) {
    throw new SmokeFailure({
      endpoint: `GET /rest/v1/order_events?order_id=eq.${encodeURIComponent(orderRow.id)}`,
      method: 'GET',
      status: orderEvents.status,
      body: summarizeBody(orderEvents.payload),
      recommendation: 'Faltan order_events: revisar la migración hardening o el RPC.',
    });
  }

  const patchResult = await restRequest(restBase, `/orders?id=eq.${encodeURIComponent(orderRow.id)}&select=id,status,updated_at`, {
    method: 'PATCH',
    body: { status: 'preparing' },
  });
  const patchedOrder = extractOrder(patchResult.payload);
  const patchedId = patchedOrder?.id || asRows(patchResult.payload)[0]?.id || orderRow.id;
  if (patchedId !== orderRow.id) {
    throw new SmokeFailure({
      endpoint: 'PATCH /rest/v1/orders',
      method: 'PATCH',
      status: patchResult.status,
      body: summarizeBody(patchResult.payload),
      recommendation: 'La actualización devolvió un pedido distinto al esperado.',
    });
  }

  const riderLocationResult = await restRequest(restBase, '/rider_locations?select=id,order_id,source,lat,lng,created_at', {
    method: 'POST',
    body: {
      order_id: orderRow.id,
      rider_id: null,
      source: 'simulation',
      lat: DEMO_LAT,
      lng: DEMO_LNG,
      accuracy: 8,
      heading: 90,
      speed: 0,
      created_at: new Date().toISOString(),
    },
  });
  const riderLocationRow = extractRow(riderLocationResult.payload);
  if (!riderLocationRow?.id) {
    throw new SmokeFailure({
      endpoint: 'POST /rest/v1/rider_locations',
      method: 'POST',
      status: riderLocationResult.status,
      body: summarizeBody(riderLocationResult.payload),
      recommendation: 'No se insertó rider_locations; revisar RLS o la tabla base.',
    });
  }

  const finalOrderResult = await fetchRows(restBase, `/orders?id=eq.${encodeURIComponent(orderRow.id)}&select=id,status,subtotal,delivery_fee,total,updated_at&limit=1`, 'GET');
  const finalOrder = extractOrder(finalOrderResult.payload);
  if (!finalOrder) {
    throw new SmokeFailure({
      endpoint: `GET /rest/v1/orders?id=eq.${encodeURIComponent(orderRow.id)}`,
      method: 'GET',
      status: finalOrderResult.status,
      body: summarizeBody(finalOrderResult.payload),
      recommendation: 'No se pudo leer el pedido final persistido.',
    });
  }

  if (String(finalOrder.status || '').trim() !== 'preparing') {
    throw new SmokeFailure({
      endpoint: `GET /rest/v1/orders?id=eq.${encodeURIComponent(orderRow.id)}`,
      method: 'GET',
      status: finalOrderResult.status,
      body: summarizeBody(finalOrderResult.payload),
      recommendation: 'El cambio de estado no quedó persistido.',
    });
  }

  verifyCreatedOrder(finalOrder, expectedTotals);

  console.log('PASS Supabase Phase 1 smoke test');
  console.log(`Order ID: ${orderRow.id}`);
  console.log(`Order code: ${orderRow.code || code}`);
  console.log(`Order status: ${finalOrder.status}`);
  console.log(`Rider location: ${riderLocationRow.id}`);
}

async function resolveBusinessId(restBase) {
  const requestedBusinessId = BUSINESS_ID || SEED_BUSINESS_ID;
  const result = await fetchRows(restBase, `/businesses?id=eq.${encodeURIComponent(requestedBusinessId)}&select=id,name,status&limit=1`, 'GET');
  const row = asRows(result.payload)[0] || null;
  if (row?.id) return row.id;

  throw new SmokeFailure({
    endpoint: `GET /rest/v1/businesses?id=eq.${encodeURIComponent(requestedBusinessId)}`,
    method: 'GET',
    status: result.status,
    body: summarizeBody(result.payload),
    recommendation: 'Business demo no encontrado. Aplicá migración/seed o pasá BUSINESS_ID.',
  });
}

function buildOrderPayload(businessId) {
  const code = `SMK-${new Date().toISOString().slice(2, 10).replace(/-/g, '')}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
  const itemsPayload = [
    {
      product_id: 'smoke-burger',
      name: 'Smoke burger',
      quantity: 2,
      unit: 'unidad',
      unit_price: 5000,
      subtotal: 10000,
    },
  ];
  const subtotal = itemsPayload.reduce((sum, item) => sum + Number(item.subtotal || 0), 0);
  const deliveryFee = 1500;
  const total = subtotal + deliveryFee;

  return {
    code,
    expectedTotals: { subtotal, deliveryFee, total },
    itemsPayload,
    orderPayload: {
      business_id: businessId,
      code,
      status: 'submitted',
      fulfillment_type: 'delivery',
      customer_name: 'Smoke Test',
      customer_phone: '2995550000',
      customer_whatsapp: '2995550000',
      address_label: 'Cipolletti, Neuquén',
      address_lat: DEMO_LAT,
      address_lng: DEMO_LNG,
      notes: 'Smoke test de Supabase phase 1',
      payment_method: 'cash',
      subtotal,
      delivery_fee: deliveryFee,
      total,
      items: itemsPayload,
    },
  };
}

async function callCreateOrderWithItems(restBase, orderPayload) {
  return restRequest(restBase, '/rpc/create_order_with_items', {
    method: 'POST',
    body: {
      payload: orderPayload,
    },
  });
}

async function fetchOrderByIdOrCode(restBase, orderId, code) {
  const byId = await fetchRows(restBase, `/orders?id=eq.${encodeURIComponent(orderId)}&select=*,order_items(*),order_events(*),rider_locations(*)&limit=1`, 'GET');
  const idRow = extractOrder(byId.payload);
  if (idRow?.id) return idRow;

  const byCode = await fetchRows(restBase, `/orders?code=eq.${encodeURIComponent(code)}&select=*,order_items(*),order_events(*),rider_locations(*)&limit=1`, 'GET');
  const codeRow = extractOrder(byCode.payload);
  if (codeRow?.id) return codeRow;

  throw new SmokeFailure({
    endpoint: `GET /rest/v1/orders?id=eq.${encodeURIComponent(orderId)}`,
    method: 'GET',
    status: byId.status,
    body: summarizeBody(byId.payload),
    recommendation: 'No se encontró el pedido creado por el RPC.',
  });
}

function verifyCreatedOrder(orderRow, expectedTotals) {
  if (!orderRow?.id) {
    throw new SmokeFailure({
      endpoint: 'GET /rest/v1/orders',
      method: 'GET',
      status: 0,
      body: 'El pedido creado no existe.',
      recommendation: 'No se pudo recuperar el pedido después del RPC.',
    });
  }

  const subtotal = Number(orderRow.subtotal);
  const deliveryFee = Number(orderRow.delivery_fee);
  const total = Number(orderRow.total);

  if (!Number.isFinite(subtotal) || !Number.isFinite(deliveryFee) || !Number.isFinite(total)) {
    throw new SmokeFailure({
      endpoint: 'GET /rest/v1/orders',
      method: 'GET',
      status: 0,
      body: summarizeBody(orderRow),
      recommendation: 'El pedido no expone totales numéricos válidos.',
    });
  }

  if (subtotal !== expectedTotals.subtotal || deliveryFee !== expectedTotals.deliveryFee || total !== expectedTotals.total || total !== subtotal + deliveryFee) {
    throw new SmokeFailure({
      endpoint: 'GET /rest/v1/orders',
      method: 'GET',
      status: 0,
      body: summarizeBody(orderRow),
      recommendation: 'Los totales del pedido no cierran con los items y delivery_fee.',
    });
  }
}

async function fetchRows(restBase, path, method = 'GET') {
  return restRequest(restBase, path, { method });
}

async function restRequest(restBase, path, { method = 'GET', body } = {}) {
  const url = `${restBase}${path}`;
  let response;
  try {
    response = await fetch(url, {
      method,
      headers: {
        apikey: SUPABASE_ANON_KEY,
        Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
        ...(body == null ? {} : { 'Content-Type': 'application/json', Prefer: 'return=representation' }),
      },
      body: body == null ? undefined : JSON.stringify(body),
    });
  } catch (error) {
    throw new SmokeFailure({
      endpoint: `${method} ${path}`,
      method,
      status: 0,
      body: error?.message || 'Network error',
      recommendation: 'SUPABASE_URL inválida o proyecto inaccesible.',
    });
  }

  const text = await response.text();
  const payload = parseJson(text);

  if (!response.ok) {
    throw buildFailure({ path, method, status: response.status, payload, text });
  }

  return { status: response.status, payload, text };
}

function buildFailure({ path, method, status, payload, text }) {
  const bodyText = summarizeBody(payload ?? text);
  const endpoint = `${method} ${path}`;

  if (status === 404) {
    if (path.startsWith('/businesses') || path.startsWith('/orders') || path.startsWith('/order_items') || path.startsWith('/riders') || path.startsWith('/rider_locations') || path.startsWith('/order_events')) {
      return new SmokeFailure({
        endpoint,
        method,
        status,
        body: bodyText,
        recommendation: 'Falta aplicar migración base.',
      });
    }
    if (path.startsWith('/rpc/create_order_with_items')) {
      return new SmokeFailure({
        endpoint,
        method,
        status,
        body: bodyText,
        recommendation: 'Falta aplicar migración hardening: create_order_with_items no existe.',
      });
    }
  }

  if (status === 401 || status === 403) {
    return new SmokeFailure({
      endpoint,
      method,
      status,
      body: bodyText,
      recommendation: 'Anon key inválida o RLS bloqueando la operación.',
    });
  }

  if (status === 404 || String(bodyText).toLowerCase().includes('pgrst202') || String(bodyText).toLowerCase().includes('could not find function')) {
    return new SmokeFailure({
      endpoint,
      method,
      status,
      body: bodyText,
      recommendation: 'Falta aplicar migración hardening: create_order_with_items no existe.',
    });
  }

  if (path.startsWith('/businesses') && /relation .* does not exist/i.test(bodyText)) {
    return new SmokeFailure({
      endpoint,
      method,
      status,
      body: bodyText,
      recommendation: 'Falta aplicar migración base.',
    });
  }

  if (path.startsWith('/businesses') && /no rows/i.test(bodyText)) {
    return new SmokeFailure({
      endpoint,
      method,
      status,
      body: bodyText,
      recommendation: 'Business demo no encontrado. Aplicá migración/seed o pasá BUSINESS_ID.',
    });
  }

  return new SmokeFailure({
    endpoint,
    method,
    status,
    body: bodyText,
    recommendation: 'Revisar el cuerpo de respuesta y la política RLS aplicada al endpoint.',
  });
}

function parseJson(text) {
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch (_) {
    return text;
  }
}

function extractOrder(payload) {
  if (Array.isArray(payload)) return payload.find((row) => row && typeof row === 'object' && 'id' in row) || null;
  if (payload && typeof payload === 'object') {
    if (payload.order && typeof payload.order === 'object') return payload.order;
    if (payload.data && typeof payload.data === 'object' && !Array.isArray(payload.data)) return payload.data;
    if ('id' in payload) return payload;
  }
  return null;
}

function extractRow(payload) {
  if (Array.isArray(payload)) return payload[0] || null;
  if (payload && typeof payload === 'object') {
    if (payload.data && typeof payload.data === 'object' && !Array.isArray(payload.data)) return payload.data;
    return payload;
  }
  return null;
}

function asRows(payload) {
  if (Array.isArray(payload)) return payload;
  if (payload && typeof payload === 'object') {
    if (Array.isArray(payload.data)) return payload.data;
    if (Array.isArray(payload.rows)) return payload.rows;
    if ('id' in payload) return [payload];
  }
  return [];
}

function summarizeBody(payload) {
  const raw = typeof payload === 'string' ? payload : JSON.stringify(payload);
  if (!raw) return '(empty)';
  return raw.length > 480 ? `${raw.slice(0, 477)}...` : raw;
}

function redactKey(value) {
  const raw = String(value || '').trim();
  if (!raw) return '(empty)';
  if (raw.length <= 8) return `${raw.slice(0, 2)}...${raw.slice(-2)}`;
  return `${raw.slice(0, 3)}...${raw.slice(-4)}`;
}

function printFailure(error) {
  console.error('FAIL Supabase Phase 1 smoke test');
  console.error(`endpoint: ${error.endpoint}`);
  console.error(`method: ${error.method}`);
  console.error(`status: ${error.status}`);
  console.error(`body: ${summarizeBody(error.body)}`);
  console.error(`recommendation: ${error.recommendation}`);
}

class SmokeFailure extends Error {
  constructor({ endpoint, method, status, body, recommendation }) {
    super(recommendation || 'Supabase smoke test failed.');
    this.name = 'SmokeFailure';
    this.endpoint = endpoint;
    this.method = method;
    this.status = status;
    this.body = body;
    this.recommendation = recommendation;
  }
}
