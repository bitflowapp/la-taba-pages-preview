// Los datos de prueba del Panel del negocio en modo PRODUCCION.
//
// Los comparten dos consumidores que tienen que ver LO MISMO: el guion de
// capturas (`scripts/business-panel-responsive.mjs`) y la suite responsive de
// Playwright (`tests/e2e/panel-responsive.spec.mjs`). Con una copia en cada
// lado, la primera vez que alguien agregue un pedido a uno de los dos, las
// capturas y el gate dejan de hablar del mismo tablero sin que nadie lo note.
//
// No tocan Supabase, Mercado Pago ni ARCA: interceptan las llamadas del cliente
// y responden con datos inventados. Ninguna captura contiene datos reales.

export const SUPABASE_URL = 'https://taba-panel-responsive.supabase.co';
export const BUSINESS_ID = '11111111-1111-4111-8111-111111111111';
export const OWNER_ID = '22222222-2222-4222-8222-222222222222';
export const RIDER_A = '33333333-3333-4333-8333-333333333333';
export const RIDER_B = '44444444-4444-4444-8444-444444444444';
/** La clave la deriva supabase-js del primer segmento del host. */
export const STORAGE_KEY = 'sb-taba-panel-responsive-auth-token';

export async function instalarDatosDePrueba(page, { conSesion = true } = {}) {
  await page.route(`${SUPABASE_URL}/**`, async (route) => {
    const url = new URL(route.request().url());
    const p = url.pathname;
    if (p.endsWith('/auth/v1/user')) return json(route, sesionDuenio().user);
    if (p.includes('/auth/v1/token')) return json(route, sesionDuenio());
    if (p.includes('/auth/v1/logout')) return route.fulfill({ status: 204, body: '' });
    // La autoridad del rol es la compuerta del backend, no la tabla: el Panel
    // pregunta por `identity_current_context` y sin `session_id` se queda en la
    // tarjeta de acceso. Es la misma respuesta que da produccion cuando la
    // cuenta SI tiene membresia.
    if (p.includes('/rpc/identity_current_context')) {
      return json(route, {
        user_id: OWNER_ID, business_id: BUSINESS_ID, role: 'owner',
        session_id: '55555555-5555-4555-8555-555555555555',
        permissions: ['orders.read', 'orders.write', 'payments.read', 'catalog.write'],
      });
    }
    if (p.includes('/rpc/register_identity_session') || p.includes('/rpc/identity_register_session')) {
      return json(route, { ok: true, session_id: '55555555-5555-4555-8555-555555555555', role: 'owner' });
    }
    if (p.includes('/rest/v1/business_members')) {
      return json(route, { business_id: BUSINESS_ID, user_id: OWNER_ID, role: 'owner', is_active: true });
    }
    if (p.includes('/rest/v1/businesses')) return json(route, negocio());
    if (p.includes('/rest/v1/orders')) return json(route, pedidos());
    if (p.includes('/rpc/list_active_business_riders')) return json(route, riders());
    if (p.includes('/rpc/list_rider_order_offers')) return json(route, []);
    if (p.includes('/rpc/get_production_operation_center')) return json(route, centroDeOperacion());
    if (p.includes('/rpc/get_mercadopago_activation_status')) return json(route, mercadoPago());
    if (p.includes('/rpc/list_business_payments')) return json(route, pagos());
    if (p.includes('/rpc/get_arca_activation_status')) return json(route, arca());
    if (p.includes('/rpc/get_business_opening_status')) return json(route, apertura());
    if (p.includes('/rest/v1/fiscal_profiles')) return json(route, perfilFiscal());
    if (p.includes('/rest/v1/products')) return json(route, []);
    return json(route, []);
  });

  await page.addInitScript(({ businessId, supabaseUrl, storageKey, sesion }) => {
    globalThis.__LA_TABA_RUNTIME_CONFIG__ = {
      mode: 'production',
      repository: {
        provider: 'supabase', deploymentEnvironment: 'staging', supabaseUrl,
        publishableKey: 'sb_publishable_panel_responsive', businessId, pollMs: 60_000,
      },
    };
    // La clave la deriva supabase-js del primer segmento del host.
    if (sesion) localStorage.setItem(storageKey, JSON.stringify(sesion));
    globalThis.__TAURI__ = { core: { invoke: async (comando) => {
      if (comando === 'initialize_business_runtime') return true;
      if (comando === 'outbox_list') return [];
      if (comando === 'outbox_get' || comando === 'outbox_find_by_idempotency_key') return null;
      if (comando === 'outbox_put') return true;
      if (comando === 'list_printers') return [{ name: 'EPSON TM-T20 (mostrador)', isDefault: true }];
      if (comando === 'probe_printer') return { name: 'EPSON TM-T20 (mostrador)', reachable: true, outOfPaper: false, error: false, queuedJobs: 0 };
      if (comando === 'check_for_signed_update') return { configured: false, available: false, currentVersion: '0.1.0', version: null };
      return true;
    } } };
  }, { businessId: BUSINESS_ID, supabaseUrl: SUPABASE_URL, storageKey: STORAGE_KEY, sesion: conSesion ? sesionDuenio() : null });
}

function json(route, body) {
  return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
}

export function sesionDuenio() {
  const expira = Math.floor(Date.parse('2099-01-01T00:00:00Z') / 1000);
  const enc = (v) => Buffer.from(JSON.stringify(v)).toString('base64url');
  const access = `${enc({ alg: 'none', typ: 'JWT' })}.${enc({ sub: OWNER_ID, exp: expira, role: 'authenticated' })}.firma`;
  return {
    access_token: access, token_type: 'bearer', expires_in: 3600, expires_at: expira,
    refresh_token: 'panel-responsive-refresh',
    user: {
      id: OWNER_ID, aud: 'authenticated', role: 'authenticated',
      email: 'duenio@la-taba.test', is_anonymous: false, user_metadata: { taba_actor: 'owner' },
    },
  };
}

function negocio() {
  return {
    id: BUSINESS_ID, name: 'La Taba', slug: 'la-taba', status: 'open', is_active: true,
    ordering_enabled: true, ordering_verified: true, whatsapp_phone: '+5492995550000',
  };
}

// Seis pedidos que cubren el arco de la bandeja del negocio. Los estados son
// los de `BUSINESS_INBOX_STATUSES`: 'delivered' y 'canceled' NO entran a la
// bandeja -el repositorio los rechaza con 'estado fuera de bandeja'- asi que
// ponerlos aca no probaria una pantalla, probaria un error de datos.
export function pedidos() {
  const ahora = Date.now();
  const hace = (min) => new Date(ahora - min * 60_000).toISOString();
  const base = (n, estado, min, extra = {}) => ({
    id: `00000000-0000-4000-8000-00000000000${n}`,
    public_code: `LT-20${40 + n}`,
    business_id: BUSINESS_ID,
    status: estado,
    created_at: hace(min),
    updated_at: hace(Math.max(0, min - 2)),
    revision: n,
    currency_code: 'ARS',
    payment_method: extra.payment_method || 'cash',
    delivery_mode: extra.delivery_mode || 'delivery',
    customer_name: extra.customer_name,
    customer_phone: extra.customer_phone,
    address_label: extra.address_label || 'Mendoza 851, Centro, Neuquén',
    delivery_street: 'Mendoza', delivery_street_number: '851',
    delivery_city: 'Neuquén', delivery_province: 'Neuquén',
    customer_notes: extra.customer_notes || null,
    subtotal: extra.subtotal, delivery_fee: extra.delivery_fee ?? 1990,
    discount_total: extra.discount_total ?? 0,
    total: extra.total,
    assigned_rider_user_id: extra.assigned_rider_user_id || null,
    order_items: extra.order_items,
    order_events: [],
    order_combos: [],
  });

  return [
    base(1, 'submitted', 3, {
      customer_name: 'Lucía Fernández', customer_phone: '2995550101',
      customer_notes: 'Tocar timbre del portón gris, el perro ladra pero no muerde.',
      subtotal: 12800, total: 14790,
      order_items: [
        { id: 'i1', product_uuid: '99999999-9999-4999-8999-999999999901', name: 'Cerveza Patagonia Amber Lager 730 ml', product_name: 'Cerveza Patagonia Amber Lager 730 ml', quantity: 4, unit_price: 2400, unit_label: 'botella', unit: 'botella' },
        { id: 'i2', product_uuid: '99999999-9999-4999-8999-999999999902', name: 'Papas fritas clásicas 150 g', product_name: 'Papas fritas clásicas 150 g', quantity: 2, unit_price: 1600, unit_label: 'paquete', unit: 'paquete' },
      ],
    }),
    base(2, 'submitted', 9, {
      customer_name: 'Martín Ojeda', customer_phone: '2995550102',
      delivery_mode: 'pickup', delivery_fee: 0,
      payment_method: 'mercadopago',
      subtotal: 8600, total: 8600,
      order_items: [
        { id: 'i3', product_uuid: '99999999-9999-4999-8999-999999999903', name: 'Fernet Branca 750 ml', product_name: 'Fernet Branca 750 ml', quantity: 1, unit_price: 8600, unit_label: 'botella', unit: 'botella' },
      ],
    }),
    base(3, 'preparing', 18, {
      customer_name: 'Sofía Quintriqueo', customer_phone: '2995550103',
      subtotal: 21400, total: 23390,
      address_label: 'Bahía Blanca 1240, Alta Barda, Neuquén',
      order_items: [
        { id: 'i4', product_uuid: '99999999-9999-4999-8999-999999999904', name: 'Vino Malbec Reserva 750 ml', product_name: 'Vino Malbec Reserva 750 ml', quantity: 2, unit_price: 7900, unit_label: 'botella', unit: 'botella' },
        { id: 'i5', product_uuid: '99999999-9999-4999-8999-999999999905', name: 'Agua tónica 1,5 L', product_name: 'Agua tónica 1,5 L', quantity: 3, unit_price: 1200, unit_label: 'botella', unit: 'botella' },
        { id: 'i6', product_uuid: '99999999-9999-4999-8999-999999999906', name: 'Maní salado 200 g', product_name: 'Maní salado 200 g', quantity: 1, unit_price: 2000, unit_label: 'paquete', unit: 'paquete' },
      ],
    }),
    base(4, 'ready', 26, {
      customer_name: 'Diego Arriagada', customer_phone: '2995550104',
      subtotal: 9600, total: 11590,
      order_items: [
        { id: 'i7', product_uuid: '99999999-9999-4999-8999-999999999907', name: 'Gaseosa cola 2,25 L', product_name: 'Gaseosa cola 2,25 L', quantity: 4, unit_price: 2400, unit_label: 'botella', unit: 'botella' },
      ],
    }),
    base(5, 'on_the_way', 41, {
      customer_name: 'Valentina Ruiz', customer_phone: '2995550105',
      assigned_rider_user_id: RIDER_A,
      subtotal: 15200, total: 17190,
      address_label: 'Chubut 455, Villa Florencia, Neuquén',
      order_items: [
        { id: 'i8', product_uuid: '99999999-9999-4999-8999-999999999908', name: 'Cerveza artesanal IPA 500 ml', product_name: 'Cerveza artesanal IPA 500 ml', quantity: 6, unit_price: 2200, unit_label: 'botella', unit: 'botella' },
        { id: 'i9', product_uuid: '99999999-9999-4999-8999-999999999909', name: 'Hielo en cubos 3 kg', product_name: 'Hielo en cubos 3 kg', quantity: 1, unit_price: 2000, unit_label: 'bolsa', unit: 'bolsa' },
      ],
    }),
    base(6, 'arrived', 96, {
      customer_name: 'Ramiro Paillalef', customer_phone: '2995550106',
      assigned_rider_user_id: RIDER_B,
      subtotal: 6400, total: 8390,
      order_items: [
        { id: 'i10', product_uuid: '99999999-9999-4999-8999-999999999910', name: 'Sidra 910 ml', product_name: 'Sidra 910 ml', quantity: 2, unit_price: 3200, unit_label: 'botella', unit: 'botella' },
      ],
    }),
  ];
}

function riders() {
  return [
    { rider_user_id: RIDER_A, id: RIDER_A, display_name: 'Nahuel Cárdenas', active_order_count: 1, max_active_orders: 3, is_active: true },
    { rider_user_id: RIDER_B, id: RIDER_B, display_name: 'Camila Antileo', active_order_count: 3, max_active_orders: 3, is_active: true },
  ];
}

function centroDeOperacion() {
  return {
    generated_at: new Date().toISOString(),
    business_id: BUSINESS_ID,
    metrics: {
      new_orders: 2, delayed_orders: 1, pending_payments: 2, payments_in_review: 1,
      orders_without_stock: 0, packing_incomplete: 1, active_deliveries: 1,
      riders_without_signal: 0, fiscal_documents_pending: 1, failed_prints: 0,
      pending_credit_notes: 0, blocked_outboxes: 0, reconciliations_required: 1,
    },
    alerts: [
      {
        id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', severity: 'CRITICAL', status: 'open',
        code: 'PAYMENT_APPROVED_WITHOUT_ORDER', correlation_id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
        last_seen_at: new Date().toISOString(), occurrence_count: 1,
      },
      {
        id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', severity: 'ACTION_REQUIRED', status: 'open',
        code: 'PRINT_JOB_FAILED', correlation_id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
        last_seen_at: new Date().toISOString(), occurrence_count: 2,
      },
    ],
    recent_closures: [],
  };
}

function mercadoPago() {
  return {
    settings_present: true, enabled: true, environment: 'test', currency: 'ARS', reserve_stock: true,
    collector_configured: true, application_configured: true,
    collector_id_short: '8877', application_id_short: '2233',
    configured_at: new Date().toISOString(), credentials_loaded: true,
    signed_notice_at: new Date().toISOString(), rejected_notices_recent: 0,
    test_payment_at: new Date().toISOString(), test_payment_order_created: true,
    test_payment_stock_applied: true, storefront_ready: true, production_review_status: 'not_requested',
  };
}

function pagos() {
  const ahora = new Date().toISOString();
  return [
    { payment_intent_id: 'p-1', internal_status: 'approved_order_pending', amount: 8600, currency: 'ARS', method: 'Tarjeta de crédito', created_at: ahora, can_reconcile: true, payment_id_short: '445566' },
    { payment_intent_id: 'p-2', internal_status: 'completed', order_public_code: 'LT-2045', amount: 17190, currency: 'ARS', method: 'Tarjeta de débito', approved_at: ahora, can_refund: true, can_reconcile: true, payment_id_short: '778899' },
    { payment_intent_id: 'p-3', internal_status: 'in_process', order_public_code: 'LT-2044', amount: 11590, currency: 'ARS', method: 'Efectivo en sucursal', created_at: ahora, can_cancel: true },
  ];
}

function arca() {
  return {
    legal_name: 'La Taba SRL', cuit: '30712345678', cuit_valid: true,
    tax_condition: 'Responsable Inscripto', business_address: 'Mendoza 827, Neuquén',
    accountant_review_status: 'approved', environment: 'homologation', point_of_sale: 4,
    certificate_loaded: true,
    certificate_expires_at: new Date(Date.now() + 200 * 86_400_000).toISOString(),
    certificate_cuit_mismatch: false, delegation_status: 'verified',
    connection_ok_at: new Date().toISOString(), homologation_authorized_at: new Date().toISOString(),
    homologated_invoices: 1, homologated_credit_notes: 0,
    pending_documents: 1, stalled_documents: 0,
    last_document_label: 'FA 4 00000001', last_document_at: new Date().toISOString(),
    last_document_failed: false, last_error_code: null, last_error_at: null,
    artifact_verified_at: null, print_verified_at: null,
  };
}

function apertura() {
  return {
    generated_at: new Date().toISOString(), business_status: 'open',
    backend: { status: 'ok', detail: 'El sistema del negocio respondió.' },
    payments: { status: 'ok', detail: 'Los cobros por la web están activos.' },
    fiscal: { status: 'ok', detail: 'La facturación está activa.' },
    riders: { status: 'ok', detail: '2 repartidor(es) disponible(s).' },
    queues: { status: 'ok', detail: 'No quedó nada trabado de antes.' },
    open_orders: 4,
  };
}

function perfilFiscal() {
  return {
    business_id: BUSINESS_ID, legal_name: 'La Taba SRL', cuit: '30712345678',
    tax_condition: 'Responsable Inscripto', business_address: 'Mendoza 827, Neuquén',
    environment: 'homologation', point_of_sale: 4, is_enabled: true,
    accountant_review_status: 'approved', production_gate_status: 'blocked',
  };
}
