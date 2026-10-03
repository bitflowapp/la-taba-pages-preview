/*
 * Datos de prueba para el Centro de operación del Panel.
 *
 * Portado de `scripts/business-panel-screenshots.mjs` del repositorio: intercepta
 * las llamadas del Panel y responde con fixtures. NO toca Supabase, ni Mercado
 * Pago, ni ARCA. Ninguna cifra sale de un negocio real.
 */
const SUPABASE_URL = 'https://taba-panel-demo.supabase.co';
const BUSINESS_ID = '11111111-1111-4111-8111-111111111111';
const OWNER_ID = '22222222-2222-4222-8222-222222222222';

export async function installPanelFixtures(context) {
  const session = ownerSession();
  await context.route(`${SUPABASE_URL}/**`, async (route) => {
    const p = new URL(route.request().url()).pathname;
    if (p.endsWith('/auth/v1/user')) return json(route, session.user);
    if (p.includes('/auth/v1/token')) return json(route, session);
    if (p.includes('/rest/v1/business_members')) {
      return json(route, { business_id: BUSINESS_ID, user_id: OWNER_ID, role: 'owner', is_active: true });
    }
    if (p.includes('/rest/v1/businesses')) return json(route, business());
    if (p.includes('/rpc/get_production_operation_center')) return json(route, operationCenter());
    if (p.includes('/rpc/get_mercadopago_activation_status')) return json(route, mercadoPago());
    if (p.includes('/rpc/list_business_payments')) return json(route, payments());
    if (p.includes('/rpc/get_arca_activation_status')) return json(route, arca());
    if (p.includes('/rpc/get_business_opening_status')) return json(route, opening());
    if (p.includes('/rpc/get_fiscal_automation_overview')) return json(route, automationOverview());
    if (p.includes('/rpc/list_fiscal_exceptions')) return json(route, exceptions());
    if (p.includes('/rpc/get_fiscal_policy_status')) return json(route, policyStatus());
    if (p.includes('/rpc/list_fiscal_accounting_policies')) return json(route, accountingPolicies());
    if (p.includes('/rest/v1/fiscal_profiles')) return json(route, fiscalProfile());
    if (p.includes('/rest/v1/fiscal_documents')) return json(route, []);
    if (p.includes('/rpc/list_fiscal_document_artifacts')) return json(route, []);
    return json(route, []);
  });

  await context.addInitScript(({ businessId, persistedSession, supabaseUrl }) => {
    globalThis.__LA_TABA_RUNTIME_CONFIG__ = {
      mode: 'production',
      repository: {
        provider: 'supabase', deploymentEnvironment: 'staging', supabaseUrl,
        publishableKey: 'sb_publishable_demo_video', businessId, pollMs: 60_000,
      },
    };
    try { localStorage.setItem('sb-taba-panel-demo-auth-token', JSON.stringify(persistedSession)); } catch (_) { /* origen sin storage */ }
    globalThis.__TAURI__ = { core: { invoke: async (command) => {
      if (command === 'initialize_business_runtime') return true;
      if (command === 'outbox_list') return [];
      if (command === 'outbox_get' || command === 'outbox_find_by_idempotency_key') return null;
      if (command === 'outbox_put') return true;
      if (command === 'list_printers') return [{ name: 'EPSON TM-T20 (mostrador)', isDefault: true }];
      if (command === 'probe_printer') return { name: 'EPSON TM-T20 (mostrador)', reachable: true, outOfPaper: false, error: false, queuedJobs: 0 };
      if (command === 'check_for_signed_update') return { configured: false, available: false, currentVersion: '0.1.0', version: null };
      return true;
    } } };
  }, { businessId: BUSINESS_ID, persistedSession: session, supabaseUrl: SUPABASE_URL });
}

const json = (route, body) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });

function ownerSession() {
  const expiresAt = Math.floor(Date.now() / 1000) + 3600;
  const encode = (v) => Buffer.from(JSON.stringify(v)).toString('base64url');
  const accessToken = `${encode({ alg: 'none', typ: 'JWT' })}.${encode({ sub: OWNER_ID, exp: expiresAt, role: 'authenticated' })}.signature`;
  return {
    access_token: accessToken, token_type: 'bearer', expires_in: 3600, expires_at: expiresAt,
    refresh_token: 'demo-video-refresh',
    user: { id: OWNER_ID, aud: 'authenticated', role: 'authenticated', email: 'negocio@la-taba.test', is_anonymous: false, user_metadata: { taba_actor: 'owner' } },
  };
}

const business = () => ({
  id: BUSINESS_ID, name: 'La Taba 2', slug: 'la-taba-2', status: 'open', is_active: true,
  ordering_enabled: true, ordering_verified: true, whatsapp_phone: '+5492995550000',
});

const operationCenter = () => ({
  generated_at: new Date().toISOString(),
  business_id: BUSINESS_ID,
  metrics: {
    new_orders: 3, delayed_orders: 1, pending_payments: 2, payments_in_review: 1,
    orders_without_stock: 0, packing_incomplete: 2, active_deliveries: 2,
    riders_without_signal: 0, fiscal_documents_pending: 1, failed_prints: 1,
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
});

const mercadoPago = () => ({
  settings_present: true, enabled: true, environment: 'test', currency: 'ARS', reserve_stock: true,
  collector_configured: true, application_configured: true,
  collector_id_short: '8877', application_id_short: '2233',
  configured_at: new Date().toISOString(), credentials_loaded: true,
  signed_notice_at: new Date().toISOString(), rejected_notices_recent: 0,
  test_payment_at: new Date().toISOString(), test_payment_order_created: true,
  test_payment_stock_applied: true, storefront_ready: true, production_review_status: 'not_requested',
});

const payments = () => {
  const now = new Date().toISOString();
  return [
    { payment_intent_id: 'p-1', internal_status: 'approved_order_pending', amount: 8400, currency: 'ARS', method: 'Tarjeta de crédito', created_at: now, can_reconcile: true, payment_id_short: '445566' },
    { payment_intent_id: 'p-2', internal_status: 'completed', order_public_code: 'LT-2043', amount: 12600, currency: 'ARS', method: 'Tarjeta de débito', approved_at: now, can_refund: true, can_reconcile: true, payment_id_short: '778899' },
    { payment_intent_id: 'p-3', internal_status: 'in_process', order_public_code: 'LT-2044', amount: 5300, currency: 'ARS', method: 'Efectivo en sucursal', created_at: now, can_cancel: true },
    { payment_intent_id: 'p-4', internal_status: 'rejected', amount: 4100, currency: 'ARS', method: 'Tarjeta de crédito', created_at: now },
  ];
};

const arca = () => ({
  legal_name: 'La Taba 2 SRL', cuit: '30712345678', cuit_valid: true,
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
});

const opening = () => ({
  generated_at: new Date().toISOString(), business_status: 'open',
  backend: { status: 'ok', detail: 'El sistema del negocio respondió.' },
  payments: { status: 'ok', detail: 'Los cobros por la web están activos.' },
  fiscal: { status: 'ok', detail: 'La facturación está activa.' },
  riders: { status: 'ok', detail: '2 repartidor(es) disponible(s).' },
  queues: { status: 'ok', detail: 'No quedó nada trabado de antes.' },
  open_orders: 4,
});

/*
 * Escenario SINTÉTICO de facturación, en ambiente de HOMOLOGACIÓN.
 *
 * Ninguna de estas cifras salió de una venta real y ningún comprobante se
 * emitió. Describen cómo se vería el tablero el día que la facturación
 * automática esté encendida: es el objetivo del trabajo, no un estado actual.
 * Producción sigue bloqueada (`production` en cero, gate `blocked`).
 */
const automationOverview = () => ({
  ready: true,
  automation_active: true,
  automation_mode: 'automatic',
  automation_suspended_at: null,
  automation_suspended_reason: null,
  blockers: [],
  today: { date: new Date().toISOString().slice(0, 10), eligible: 12, automatic: 11, pending: 1, rejected: 0, attention: 1 },
  totals_by_environment: {
    homologation: { authorized: 11, pending: 1, rejected: 0 },
    production: { authorized: 0, pending: 0, rejected: 0 },
  },
});

const exceptions = () => ([{
  exception_id: 'ex-0001', kind: 'missing_fiscal_data', code: null,
  severity: 'action_required', document_label: 'Venta LT-0104',
  total_amount: 9466, environment: 'homologation', occurred_at: new Date().toISOString(),
}]);

const policyStatus = () => ({
  business_id: BUSINESS_ID, production_gate_status: 'blocked',
  accountant_review_status: 'approved', environment: 'homologation',
  policy_approved: true, policy_updated_at: new Date().toISOString(),
});

const accountingPolicies = () => ([{
  policy_id: 'pol-1', status: 'approved', document_type: 6, vat_rate_id: 5,
  receiver_condition: 'Consumidor Final', approved_at: new Date().toISOString(),
}]);

const fiscalProfile = () => ({
  business_id: BUSINESS_ID, legal_name: 'La Taba 2 SRL', cuit: '30712345678',
  tax_condition: 'Responsable Inscripto', business_address: 'Mendoza 827, Neuquén',
  environment: 'homologation', point_of_sale: 4, is_enabled: true,
  accountant_review_status: 'approved', production_gate_status: 'blocked',
});
