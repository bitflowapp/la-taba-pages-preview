// LA TABA · FACTURAR PEDIDOS DESDE LA BANDEJA, CONTRA LA BASE REAL (V2)
//
// Las demás suites del Panel responden con datos inventados. Esta no: los pedidos y cada
// operación fiscal de la bandeja llegan a PostgreSQL —el esquema REAL de La Taba, migrado
// con su cadena completa— por un PostgREST emulado (scripts/fiscal-core/postgrest-shim.mjs:
// argumentos por nombre, rol `authenticated` con los claims de la sesión del navegador,
// RLS, errores PGRST). La autorización la hace el worker CANÓNICO del core
// (bitflowapp/taba-fiscal en el SHA de fiscal-core.json) contra FakeArca: el CAE es de
// PRUEBA y la pantalla lo tiene que decir.
//
// Lo que se prueba con el navegador y la base, no con un mock que devuelve lo esperado:
//   · los botones salen de la evaluación del servidor (READY/BLOCKED y sus razones);
//   · el click llama la RPC real con el pedido (uuid), el canal PANEL y una clave estable;
//   · el estado que se ve es el de la base, y recargar muestra exactamente lo mismo;
//   · un pedido ya facturado no ofrece facturar otra vez y no nace otro comprobante;
//   · si la base cambió entre el dibujo y el click, manda el servidor (fail closed);
//   · imprimir espera a la autorización; la PC sin conexión se dice como tal;
//   · reimprimir llama la RPC real: trabajo nuevo con reprint_of, sin otro CAE;
//   · ningún error crudo (SQL, PGRST) llega a la pantalla;
//   · lo mismo en un teléfono (390×844, táctil, sin Tauri).
//
// Uso (base local descartable y recién migrada; nunca producción):
//   TABA_E2E_FISCAL_DB=postgres://postgres@127.0.0.1:55461/<base> \
//   TABA_FISCAL_DIR=<checkout de taba-fiscal en el SHA fijado, compilado> \
//     npx playwright test tests/e2e/order-fiscal-real-db.spec.mjs --project=chromium
//
// Sin esas variables se omite: el job de navegador de CI no tiene una base descartable.
// La política comercial, la clasificación y el CUIT son FIXTURES SINTÉTICOS de prueba.
// PHYSICAL_PRINT: NOT_VERIFIED (la PC de impresión se simula con las RPC reales del agente).
import { createHash, randomBytes } from 'node:crypto';

import { expect, test } from '@playwright/test';
import pg from 'pg';

import {
  BUSINESS_ID,
  OWNER_ID,
  STAFF_ID,
  STAFF_SESSION_ID,
  SUPABASE_URL,
  instalarDatosDePrueba,
} from '../../scripts/lib/business-panel-fixtures.mjs';
import { createSupabaseShim } from '../../scripts/fiscal-core/postgrest-shim.mjs';

const DB_URL = process.env.TABA_E2E_FISCAL_DB || '';
const CORE_DIR = process.env.TABA_FISCAL_DIR || '';
const OWNER_SESSION_ID = '55555555-5555-4555-8555-555555555555';
// CUIT sintético con dígito verificador válido (el de las pruebas pgTAP): no es de nadie.
const CUIT = '20123456786';
const TELEFONO = { width: 390, height: 844 };
const STAFF = { sub: STAFF_ID, role: 'authenticated', session_id: STAFF_SESSION_ID };
const OWNER = { sub: OWNER_ID, role: 'authenticated', session_id: OWNER_SESSION_ID };
const sha256 = (value) => createHash('sha256').update(value).digest('hex');

const PRODUCTO = {
  gaseosa: 'f1000000-0000-4000-8000-000000000001',
  queso: 'f1000000-0000-4000-8000-000000000002',
  hielo: 'f1000000-0000-4000-8000-000000000003',
};
const QUESO_LEGADO = 'LEG-QUESO-E2E';
const PEDIDO = {
  // Envío + 2 gaseosas (por uuid) + 0,5 kg de queso (producto legado por external_id), cobrado.
  delivery: { id: 'f2000000-0000-4000-8000-000000000001', code: 'LT-9101', cobrado: true },
  // Efectivo sin cobrar.
  sinCobrar: { id: 'f2000000-0000-4000-8000-000000000002', code: 'LT-9102', cobrado: false },
  // Se factura desde el teléfono.
  movil: { id: 'f2000000-0000-4000-8000-000000000003', code: 'LT-9103', cobrado: true },
  // Un producto sin clasificación impositiva.
  sinClasificar: { id: 'f2000000-0000-4000-8000-000000000004', code: 'LT-9104', cobrado: true },
  // READY al dibujarse; el dueño devuelve el cobro antes del click.
  revertido: { id: 'f2000000-0000-4000-8000-000000000005', code: 'LT-9105', cobrado: true },
  // El servidor contesta con un error crudo de PostgREST.
  errorCrudo: { id: 'f2000000-0000-4000-8000-000000000006', code: 'LT-9106', cobrado: true },
};
// Solo esto llega a la base; el resto del Panel sigue con los datos de la biblioteca.
const RPC_REALES = new Set(['get_order_fiscal_states', 'request_order_invoice', 'request_print_job_reprint', 'get_local_print_status']);
// Las dos formas con que el Panel lee pedidos (bandeja y lista reciente).
const ORDERS_SELECTS = new Set(['*,order_items(*),order_combos(*)', '*,order_items(*)']);

// Lo que la prueba de escritorio deja para la de teléfono.
const facturado = { documentId: null, cae: null, firstJob: null, arca: null };

test.describe.configure({ mode: 'serial' });
test.skip(!DB_URL || !CORE_DIR, 'Solo local: TABA_E2E_FISCAL_DB (base recién migrada y descartable) y TABA_FISCAL_DIR (core fijado y compilado).');

// ── La base ────────────────────────────────────────────────────────────────────
async function conectar() {
  const client = new pg.Client({ connectionString: DB_URL });
  client.on('error', () => {});
  await client.connect();
  return client;
}

async function consultar(sql, params = []) {
  const client = await conectar();
  try {
    return (await client.query(sql, params)).rows;
  } finally {
    await client.end().catch(() => {});
  }
}

async function comoOperador(claims, sql, params) {
  const client = await conectar();
  try {
    await client.query('begin');
    await client.query('set local role authenticated');
    await client.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify(claims)]);
    const { rows } = await client.query(sql, params);
    await client.query('commit');
    return rows;
  } catch (error) {
    await client.query('rollback').catch(() => {});
    throw error;
  } finally {
    await client.end().catch(() => {});
  }
}

const rpcDe = (claims, label) => createSupabaseShim(conectar, { claims, label }).rpcClient();

async function sembrar() {
  const host = new URL(DB_URL).hostname;
  if (!['127.0.0.1', 'localhost', '[::1]'].includes(host)) throw new Error('solo bases locales descartables');
  const [{ usada }] = await consultar('select exists (select 1 from public.businesses where id = $1) as usada', [BUSINESS_ID]);
  if (usada) throw new Error('TABA_E2E_FISCAL_DB tiene que ser una base recién migrada: el negocio de prueba ya existe');
  const pedidos = Object.values(PEDIDO);
  const client = await conectar();
  try {
    await client.query('begin');
    await client.query(`
      insert into auth.users(id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at) values
        ('${OWNER_ID}','authenticated','authenticated','duenio@la-taba.test','',now(),'{}','{}',now(),now()),
        ('${STAFF_ID}','authenticated','authenticated','empleado@la-taba.test','',now(),'{}','{}',now(),now());
      insert into public.businesses(id,name,status,slug,is_active,operating_timezone)
        values ('${BUSINESS_ID}','La Taba E2E fiscal','open','la-taba-e2e-fiscal',true,'America/Argentina/Buenos_Aires');
      insert into public.business_members(business_id,user_id,role,is_active)
        values ('${BUSINESS_ID}','${OWNER_ID}','owner',true), ('${BUSINESS_ID}','${STAFF_ID}','staff',true);
      insert into public.identity_sessions(session_id,user_id,business_id,role_at_login,client) values
        ('${OWNER_SESSION_ID}','${OWNER_ID}','${BUSINESS_ID}','owner','panel_web'),
        ('${STAFF_SESSION_ID}','${STAFF_ID}','${BUSINESS_ID}','staff','panel_web');
      insert into public.products(id,business_id,name,description,category,price,image_url,is_active,brand,subcategory,presentation,capacity,packaging_type,stock,available,is_alcoholic,tags,is_verified,verified_at,verified_by,external_id,variant,capacity_value,capacity_unit,catalog_origin,units_per_pack)
      select p.id::uuid, '${BUSINESS_ID}', p.name, 'Fixture E2E', p.category, p.price, 'https://example.invalid/p.webp', true, 'Marca', 'Pruebas', p.presentation, p.capacity,
             p.packaging, 100, false, false, '{}', false, null, null, p.ext, p.presentation, 1, p.unit, 'commercial', 1
        from (values ('${PRODUCTO.gaseosa}','Gaseosa 2,25 L','Aguas',1250,'Unidad','1 u','unidad','e2e-gaseosa','unidad'),
                     ('${PRODUCTO.queso}','Queso por kg','Almacen',9800,'Kilo','1 kg','granel','${QUESO_LEGADO}','kg'),
                     ('${PRODUCTO.hielo}','Hielo 2 kg','Aguas',1000,'Unidad','1 u','unidad','e2e-hielo','unidad'))
             as p(id,name,category,price,presentation,capacity,packaging,ext,unit);
      insert into public.fiscal_profiles(business_id,legal_name,cuit,tax_condition,business_address,environment,point_of_sale,default_currency,default_concept,
        invoice_policy,is_enabled,default_recipient_condition,accountant_review_status,certificate_fingerprint_sha256,certificate_expires_at,homologation_authorized_at,homologation_authorized_by)
      values ('${BUSINESS_ID}','LA TABA E2E SRL','${CUIT}','Responsable Inscripto','Direccion fixture','homologation',6,'PES',1,'manual',true,'Consumidor Final','approved',
        repeat('e',64),now()+interval '90 days',now(),'${OWNER_ID}');
      insert into public.fiscal_parameter_snapshots(environment,parameter_type,version,values_json,synchronized_at) values
        ('homologation','document_types','e2e-fixture','[{"Id":6},{"Id":8}]'::jsonb,now()),
        ('homologation','recipient_document_types','e2e-fixture','[{"Id":99}]'::jsonb,now()),
        ('homologation','recipient_vat_conditions','e2e-fixture','[{"Id":5}]'::jsonb,now()),
        ('homologation','vat_types','e2e-fixture','{"IvaTipo":[{"Id":"4","Desc":"10.5%"},{"Id":"5","Desc":"21%"}]}'::jsonb,now());
      insert into public.fiscal_accounting_policies(business_id,environment,policy_version,valid_from,issuer_condition,recipient_condition,concept,invoice_type,credit_note_type,
        recipient_document_type,recipient_document_number,enabled,accountant_review_status,approved_by,approved_at,notes,recipient_vat_condition_id)
      values ('${BUSINESS_ID}','homologation','e2e-fixture',current_date,'Responsable Inscripto','Consumidor Final',1,6,8,99,'0',true,'approved',
        '${OWNER_ID}',now(),'Fixture sintetico; no constituye politica contable.',5);
      insert into public.commercial_fiscal_policies(business_id,policy_version,valid_from,status,billing_moment,mercadopago_rule,cash_rule,coordinate_rule,
        vat_computation,delivery_treatment,delivery_vat_code,delivery_line_description,discount_treatment,final_consumer_id_threshold,credit_note_policy,
        accountant_reference,approved_by,approved_at,notes)
      values ('${BUSINESS_ID}','e2e-fixture-v1',current_date,'approved','after_payment_confirmed','require_approved','require_confirmed','require_confirmed',
        'price_includes_vat_per_rate','invoice_as_line',5,'Envío','prorate_by_item_gross',1000000.00,'manual_review_only',
        'FIXTURE DE PRUEBA - no es politica contable','${OWNER_ID}',now(),'Solo para la prueba E2E.');
      insert into public.product_fiscal_classifications(business_id,product_id,classification,vat_code,source,classified_by) values
        ('${BUSINESS_ID}','${PRODUCTO.gaseosa}','taxed',5,'accountant','${OWNER_ID}'),
        ('${BUSINESS_ID}','${PRODUCTO.queso}','taxed',4,'accountant','${OWNER_ID}');
      insert into public.orders(id,business_id,code,public_code,status,fulfillment_type,delivery_mode,client_request_id,customer_name,customer_phone,payment_method,
        subtotal,discount_total,delivery_fee,total,currency_code,address_label,delivery_location_source,delivery_latitude,delivery_longitude,delivery_location_confirmed_at)
      values ('${PEDIDO.delivery.id}','${BUSINESS_ID}','LT-9101','LT-9101','accepted','delivery','delivery','e2e-fiscal-9101','Lucía Fernández','2995550101','cash',
               7400,0,1210,8610,'ARS','Mendoza 851, Centro, Neuquén','gps',-38.95,-68.06,now())
           ${pedidos.filter((p) => p !== PEDIDO.delivery).map((p) => `,
             ('${p.id}','${BUSINESS_ID}','${p.code}','${p.code}','accepted','pickup','pickup','e2e-fiscal-${p.code.slice(3)}','Cliente ${p.code}','2995550199','cash',
               ${p === PEDIDO.sinClasificar ? 1000 : 1250},0,0,${p === PEDIDO.sinClasificar ? 1000 : 1250},'ARS',null,null,null,null,null)`).join('')};
      insert into public.order_items(order_id,product_id,product_uuid,name,quantity,unit,unit_price,subtotal) values
        ('${PEDIDO.delivery.id}', null, '${PRODUCTO.gaseosa}', 'Gaseosa 2,25 L', 2, 'u', 1250, 2500),
        ('${PEDIDO.delivery.id}', '${QUESO_LEGADO}', null, 'Queso por kg', 0.5, 'kg', 9800, 4900),
        ('${PEDIDO.sinClasificar.id}', null, '${PRODUCTO.hielo}', 'Hielo 2 kg', 1, 'u', 1000, 1000)
        ${pedidos.filter((p) => ![PEDIDO.delivery, PEDIDO.sinClasificar].includes(p))
          .map((p) => `, ('${p.id}', null, '${PRODUCTO.gaseosa}', 'Gaseosa 2,25 L', 1, 'u', 1250, 1250)`).join('')};`);
    await client.query('commit');
  } catch (error) {
    await client.query('rollback').catch(() => {});
    throw error;
  } finally {
    await client.end().catch(() => {});
  }
  // El cobro en efectivo lo registra el empleado con la RPC REAL del mostrador.
  const empleado = rpcDe(STAFF, 'staff');
  for (const pedido of pedidos.filter((p) => p.cobrado)) {
    const cobro = await empleado.rpc('confirm_manual_order_payment', {
      p_order_id: pedido.id, p_expected_revision: 1, p_actual_method: 'cash', p_idempotency_key: `e2e-cobro-${pedido.code}`,
    });
    if (cobro.error) throw new Error(`cobro de ${pedido.code}: ${JSON.stringify(cobro.error)}`);
  }
}

/** GET /rest/v1/orders como PostgREST: filtros, orden y límite del cliente; RLS del empleado; embebidos reales. */
async function pedidosReales(url, claims) {
  const q = url.searchParams;
  const conocidos = new Set(['select', 'business_id', 'origin', 'status', 'order', 'limit', 'id', 'public_code']);
  const orden = String(q.get('order') || 'created_at.asc').split(',').map((part) => /^(created_at|id)\.(asc|desc)$/.exec(part));
  if ([...q.keys()].some((key) => !conocidos.has(key)) || !ORDERS_SELECTS.has(q.get('select')) || orden.some((part) => !part)) {
    return { status: 400, body: { code: 'PGRST100', message: `consulta no emulada: ${url.search}` } };
  }
  const eq = (name) => (String(q.get(name) || '').startsWith('eq.') ? q.get(name).slice(3) : null);
  const estados = /^in\.\((.*)\)$/.exec(q.get('status') || '')?.[1]?.split(',').map((value) => value.trim()) ?? null;
  const combos = q.get('select').includes('order_combos(*)')
    ? `, 'order_combos', coalesce((select jsonb_agg(to_jsonb(c) order by c.created_at, c.id) from public.order_combos c where c.order_id = o.id), '[]'::jsonb)`
    : '';
  const [{ v: filas }] = await comoOperador(claims, `
    select coalesce(jsonb_agg(fila order by n), '[]'::jsonb) as v from (
      select to_jsonb(o) || jsonb_build_object(
               'order_items', coalesce((select jsonb_agg(to_jsonb(i) order by i.created_at, i.id) from public.order_items i where i.order_id = o.id), '[]'::jsonb)${combos}) as fila,
             row_number() over (order by ${orden.map(([, column, direction]) => `o.${column} ${direction}`).join(', ')}) as n
        from public.orders o
       where ($1::uuid is null or o.business_id = $1::uuid)
         and ($2::text is null or o.origin = $2)
         and ($3::text[] is null or o.status = any($3::text[]))
         and ($4::uuid is null or o.id = $4::uuid)
         and ($5::text is null or o.public_code = $5)
       order by n
       limit $6) t`,
  [eq('business_id'), eq('origin'), estados, eq('id'), eq('public_code'), Number(q.get('limit') || 1000)]);
  return { status: 200, body: eq('id') || eq('public_code') ? filas[0] ?? null : filas };
}

/**
 * Los pedidos y las RPC fiscales van a la base; lo demás, a la biblioteca de datos de prueba.
 * Playwright resuelve primero la ruta registrada MÁS TARDE, así que esto va encima.
 */
async function conectarBaseReal(page, claims) {
  const shim = createSupabaseShim(conectar, { claims, label: 'panel' });
  await page.route(`${SUPABASE_URL}/**`, async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const rpc = /^\/rest\/v1\/rpc\/([a-z_]+)$/.exec(url.pathname)?.[1];
    const esPedidos = url.pathname === '/rest/v1/orders' && request.method() === 'GET';
    if (!(rpc && RPC_REALES.has(rpc)) && !esPedidos) return route.fallback();
    // La base recibe los claims de la sesión que tiene el navegador, como con GoTrue.
    let sub = null;
    try {
      const token = String(request.headers().authorization || '').replace(/^Bearer\s+/i, '');
      sub = JSON.parse(Buffer.from(token.split('.')[1] || '', 'base64url').toString('utf8')).sub;
    } catch {
      sub = null;
    }
    if (sub !== claims.sub) return route.fulfill({ status: 401, contentType: 'application/json', body: JSON.stringify({ message: 'sesión distinta' }) });
    if (esPedidos) {
      const { status, body } = await pedidosReales(url, claims);
      return route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
    }
    const response = await shim.fetch(request.url(), { method: request.method(), headers: request.headers(), body: request.postData() });
    return route.fulfill({ status: response.status, contentType: 'application/json', body: await response.text() });
  });
}

/** Cada RPC fiscal que el navegador manda, con su cuerpo. */
function registrarRpc(page) {
  const enviadas = [];
  page.on('request', (request) => {
    const rpc = /\/rest\/v1\/rpc\/([a-z_]+)$/.exec(request.url())?.[1];
    if (rpc && RPC_REALES.has(rpc)) enviadas.push({ rpc, body: JSON.parse(request.postData() || '{}') });
  });
  return enviadas;
}

async function documentoDe(orderId) {
  const [fila] = await consultar(`select d.id, d.state, d.document_type, d.point_of_sale, d.document_number::int as number, d.cae, d.dispatch_count,
      (select count(*)::int from public.fiscal_documents x where x.source_type = 'online_order' and x.source_id = $1) as documents,
      (select count(*)::int from public.fiscal_source_snapshots s where s.source_type = 'online_order' and s.source_id = $1) as snapshots,
      (select array_agg(k.command_source || ':' || k.actor_id::text) from public.fiscal_idempotency_keys k where k.fiscal_document_id = d.id) as keys,
      (select jsonb_agg(jsonb_build_object('by', r.requested_by, 'source', r.command_source, 'fulfilled', r.fulfilled_at is not null)) from public.fiscal_print_requests r where r.fiscal_document_id = d.id) as print_requests,
      (select id from public.fiscal_document_artifacts a where a.fiscal_document_id = d.id and a.is_current) as artifact_id
    from public.fiscal_documents d where d.source_type = 'online_order' and d.source_id = $1`, [orderId]);
  return fila || null;
}

// ── El core: worker canónico + FakeArca, sin red ─────────────────────────────────
async function autorizarConElWorkerCanonico() {
  const { loadCanonicalCore } = await import('../../scripts/fiscal-core/verify-canonical-worker.mjs');
  const core = await loadCanonicalCore(CORE_DIR);
  const service = createSupabaseShim(conectar, { label: 'worker' });
  const store = new core.SupabaseFiscalStore(service, service.fetch);
  facturado.arca ??= new core.FakeArca(CUIT);
  const config = core.arcaConfig({ cuit: CUIT }, 'taba-fiscal-worker-e2e');
  const worker = new core.FiscalWorker({
    config, store, wsaa: { login: async () => core.ticket }, wsfe: new core.WsfeClient(config, facturado.arca.fetch), logger: core.recordingLogger(),
  });
  const artifacts = new core.FiscalArtifactWorker({
    workerId: 'taba-fiscal-artifacts-e2e', store, storage: new core.SupabasePrivateArtifactStorage(service, service.fetch), logger: core.recordingLogger(),
  });
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (input) => { throw new Error(`red deshabilitada durante la prueba: ${String(input).slice(0, 80)}`); };
  try {
    const run = await worker.runOnce();
    let pendientes = true;
    for (let round = 0; round < 20 && pendientes; round += 1) pendientes = Boolean((await artifacts.runOnce(10)).claimed);
    return { run, pdfPendientes: pendientes };
  } finally {
    globalThis.fetch = realFetch;
  }
}

// ── La PC de impresión: el dueño la vincula; el agente usa las RPC reales (gateway simulado) ──
async function vincularPc() {
  const pairing = await rpcDe(OWNER, 'owner').rpc('create_local_device_pairing', { p_business_id: BUSINESS_ID, p_device_name: 'Mostrador E2E' });
  expect(pairing.error).toBeNull();
  const gateway = rpcDe({ role: 'service_role' }, 'gateway');
  const secretHash = sha256(randomBytes(32).toString('base64url'));
  const registro = await gateway.rpc('agent_register_device', {
    p_pairing_code: pairing.data.pairing_code, p_secret_hash: secretHash, p_device_name: 'Mostrador E2E', p_platform: 'windows', p_agent_version: '0.1.0',
  });
  expect(registro.error).toBeNull();
  const device = registro.data.device_id;
  return {
    device,
    reclamar: () => gateway.rpc('agent_claim_print_jobs', { p_device_id: device, p_secret_hash: secretHash, p_document_types: ['fiscal_receipt'], p_limit: 5 }),
    actualizar: (job, transition, extra = {}) => gateway.rpc('agent_update_print_job', {
      p_device_id: device, p_secret_hash: secretHash, p_job_id: job.id, p_claim_token: job.claim_token, p_transition: transition, ...extra,
    }),
  };
}

// ── La bandeja ────────────────────────────────────────────────────────────────────
async function abrirBandeja(page) {
  await page.goto('/#business', { waitUntil: 'domcontentloaded' });
  await page.locator('[data-production-workspace="business"]').waitFor({ state: 'visible', timeout: 30_000 });
  await page.locator('[data-production-orders-view]:visible').first().click();
  await page.locator('[data-order-tray]').waitFor({ state: 'visible', timeout: 15_000 });
}

const bloque = (page, pedido) => page.locator(`[data-order-fiscal="${pedido.id}"]`);
const textoDe = async (locator) => (await locator.innerText()).replace(/\s+/g, ' ').trim();
const CRUDO = /PGRST|SQLSTATE|violates|constraint|schema cache|P0001|42501|soap|stack|Error:/i;
/** Lo que ve el mostrador (bandeja y aviso) no trae SQL, PGRST, SOAP ni stacks. */
async function sinJerga(page) {
  await expect(page.locator('[data-order-tray]')).not.toContainText(CRUDO, { useInnerText: true });
  await expect(page.locator('[data-toast]')).not.toContainText(CRUDO, { useInnerText: true });
}

test.beforeAll(async () => {
  await sembrar();
});

test('Escritorio: facturar e imprimir un pedido real, recargar, imprimir y reimprimir', async ({ page }) => {
  test.setTimeout(180_000);
  await instalarDatosDePrueba(page, { comoEmpleado: true });
  await conectarBaseReal(page, STAFF);
  const enviadas = registrarRpc(page);
  await abrirBandeja(page);

  // 1 · Lo que se ve es la evaluación del servidor: botones solo si está READY.
  const delivery = bloque(page, PEDIDO.delivery);
  await expect(delivery).toHaveAttribute('data-order-fiscal-status', 'READY');
  await expect(delivery).toContainText('Listo para facturar');
  await expect(delivery.getByRole('button', { name: 'Facturar', exact: true })).toBeEnabled();
  await expect(delivery.getByRole('button', { name: 'Facturar e imprimir' })).toBeEnabled();
  const sinCobrar = bloque(page, PEDIDO.sinCobrar);
  await expect(sinCobrar).toHaveAttribute('data-order-fiscal-status', 'BLOCKED');
  await expect(sinCobrar).toContainText('No se puede facturar todavía');
  await expect(sinCobrar).toContainText('Falta confirmar el pago');
  await expect(sinCobrar.getByRole('button', { name: 'Facturar', exact: true })).toBeDisabled();
  await expect(sinCobrar.getByRole('button', { name: 'Facturar e imprimir' })).toBeDisabled();
  await expect(bloque(page, PEDIDO.sinClasificar)).toContainText('Falta la clasificación impositiva de un producto: Hielo 2 kg');
  await expect(bloque(page, PEDIDO.sinClasificar).getByRole('button', { name: 'Facturar', exact: true })).toBeDisabled();

  // 2 · El click llama la RPC real, con el uuid del pedido, el canal y una clave estable.
  const pedida = page.waitForRequest((request) => request.url().endsWith('/rest/v1/rpc/request_order_invoice'));
  await delivery.getByRole('button', { name: 'Facturar e imprimir' }).click();
  const cuerpo = JSON.parse((await pedida).postData());
  expect(cuerpo).toMatchObject({ p_business_id: BUSINESS_ID, p_order_id: PEDIDO.delivery.id, p_command_source: 'PANEL', p_print: true });
  expect(cuerpo.p_idempotency_key).toMatch(/^order-invoice-[A-Za-z0-9_-]{8,}$/);
  await expect(page.locator('[data-toast]')).toContainText('Factura pedida. Se imprime cuando ARCA la autorice.');
  await expect(delivery).toHaveAttribute('data-order-fiscal-status', 'PENDING');
  await expect(delivery.locator('.production-order-fiscal-status')).toContainText('Pendiente');
  await expect(delivery.locator('[data-fiscal-print]')).toHaveText('Se imprime al emitirse');
  await expect(delivery.getByRole('button', { name: /Facturar/ })).toHaveCount(0);

  // En la base: un comprobante del PEDIDO (no una venta POS), su origen congelado, el actor
  // y el canal reales, y el pedido de impresión durable esperando la autorización.
  const pedido = await documentoDe(PEDIDO.delivery.id);
  expect(pedido).toMatchObject({ state: 'queued', documents: 1, snapshots: 1, keys: [`PANEL:${STAFF_ID}`] });
  expect(pedido.print_requests).toEqual([{ by: STAFF_ID, source: 'PANEL', fulfilled: false }]);
  const [{ ventas }] = await consultar('select count(*)::int as ventas from public.pos_sales where business_id = $1', [BUSINESS_ID]);
  expect(ventas, 'un pedido online nunca se factura como venta POS').toBe(0);

  // 3 · Recargar no inventa nada: se vuelve a leer de la base.
  const antes = await textoDe(delivery);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await abrirBandeja(page);
  await expect(delivery).toHaveAttribute('data-order-fiscal-status', 'PENDING');
  expect(await textoDe(delivery)).toBe(antes);

  // 4 · El worker canónico lo autoriza (FakeArca: CAE de PRUEBA) y genera el PDF.
  const { run, pdfPendientes } = await autorizarConElWorkerCanonico();
  expect(run).toEqual({ claimed: 1, completed: 1 });
  expect(pdfPendientes).toBe(false);
  const autorizado = await documentoDe(PEDIDO.delivery.id);
  const [voucher, ...otros] = facturado.arca.vouchers(6, 6);
  expect(otros).toHaveLength(0);
  expect(autorizado).toMatchObject({ state: 'authorized', number: 1, cae: voucher.cae, dispatch_count: 1, documents: 1 });
  expect(autorizado.artifact_id).toBeTruthy();
  expect(autorizado.print_requests).toEqual([{ by: STAFF_ID, source: 'PANEL', fulfilled: true }]);
  Object.assign(facturado, { documentId: autorizado.id, cae: autorizado.cae });

  // 5 · Una PC vinculada pero sin conexión: la impresión queda pendiente y se dice por qué.
  const pc = await vincularPc();
  await consultar(`update public.local_devices set last_seen_at = now() - interval '10 minutes' where id = $1`, [pc.device]);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await abrirBandeja(page);
  await expect(delivery).toHaveAttribute('data-order-fiscal-status', 'ISSUED');
  await expect(delivery).toContainText('Factura emitida');
  await expect(delivery.locator('[data-fiscal-simulation]')).toHaveText('HOMOLOGACIÓN · sin validez fiscal');
  await expect(delivery.locator('.production-order-fiscal-number')).toHaveText(`Factura B 00006-00000001 · CAE de homologación ${autorizado.cae}`);
  await expect(delivery.locator('[data-fiscal-print]')).toHaveText('Impresión pendiente · la PC de impresión está sin conexión');
  await expect(delivery.getByRole('button', { name: /Facturar/ })).toHaveCount(0);
  await expect(delivery.getByRole('button', { name: 'Reimprimir' })).toHaveCount(0);

  // "Ver PDF" pide el acceso con el id del ARTEFACTO vigente (no el del comprobante). La función
  // de acceso privado no se emula: contesta 503 y el mostrador ve un texto sin jerga.
  await page.route(`${SUPABASE_URL}/functions/v1/fiscal-artifact-access`, (route) => route.fulfill({ status: 503, contentType: 'application/json', body: '{"error":"no emulada"}' }));
  const acceso = page.waitForRequest((request) => request.url().endsWith('/functions/v1/fiscal-artifact-access'));
  await delivery.getByRole('button', { name: 'Ver PDF' }).click();
  expect(JSON.parse((await acceso).postData())).toEqual({ artifactId: autorizado.artifact_id, action: 'preview' });
  await expect(page.locator('[data-toast]')).toContainText('No hubo respuesta del servidor. Probá de nuevo en unos segundos.');

  // 6 · El agente vuelve, toma el ticket (con el CAE autorizado) y lo imprime.
  const claim = await pc.reclamar();
  expect(claim.error).toBeNull();
  const [ticket, ...masTickets] = claim.data.jobs;
  expect(masTickets).toHaveLength(0);
  expect(ticket.payload.cae).toBe(autorizado.cae);
  expect((await pc.actualizar(ticket, 'printing')).error).toBeNull();
  expect((await pc.actualizar(ticket, 'printed', { p_duration_ms: 800 })).error).toBeNull();
  facturado.firstJob = ticket.id;
  await page.reload({ waitUntil: 'domcontentloaded' });
  await abrirBandeja(page);
  await expect(delivery.locator('[data-fiscal-print]')).toHaveText('Impreso');

  // 7 · Reimprimir: la RPC real con el trabajo real; un trabajo nuevo, sin otro CAE.
  const reimpresion = page.waitForRequest((request) => request.url().endsWith('/rest/v1/rpc/request_print_job_reprint'));
  await delivery.getByRole('button', { name: 'Reimprimir' }).click();
  const pedidoReimpresion = JSON.parse((await reimpresion).postData());
  expect(pedidoReimpresion).toMatchObject({ p_job_id: ticket.id, p_reason: 'Reimpresión pedida desde el Panel' });
  expect(pedidoReimpresion.p_idempotency_key).toMatch(/^order-reprint-[A-Za-z0-9_-]{8,}$/);
  await expect(page.locator('[data-toast]')).toContainText('Reimpresión enviada a la PC de impresión.');
  await expect(delivery.locator('[data-fiscal-print]')).toHaveText('Impresión pendiente');
  const trabajos = await consultar(`select id, reprint_of, reprint_reason, status from public.print_jobs
    where source_entity_id = $1 and document_type = 'fiscal_receipt' order by created_at, id`, [autorizado.id]);
  expect(trabajos).toHaveLength(2);
  expect(trabajos.find((job) => job.reprint_of)).toMatchObject({ reprint_of: ticket.id, reprint_reason: 'Reimpresión pedida desde el Panel', status: 'queued' });
  const despues = await documentoDe(PEDIDO.delivery.id);
  expect(despues).toMatchObject({ documents: 1, cae: autorizado.cae, dispatch_count: 1 });
  expect(facturado.arca.count('FECAESolicitar'), 'reimprimir no vuelve a pedir CAE').toBe(1);

  // 8 · Recargar muestra exactamente lo mismo; ya facturado no se vuelve a pedir.
  const final = await textoDe(delivery);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await abrirBandeja(page);
  await expect(delivery.locator('[data-fiscal-print]')).toHaveText('Impresión pendiente');
  expect(await textoDe(delivery)).toBe(final);
  expect(enviadas.filter((call) => call.rpc === 'request_order_invoice')).toHaveLength(1);
  await sinJerga(page);
});

test('Escritorio: si la base cambió antes del click, manda el servidor; un error crudo no se muestra', async ({ page }) => {
  test.setTimeout(90_000);
  await instalarDatosDePrueba(page, { comoEmpleado: true });
  await conectarBaseReal(page, STAFF);
  await abrirBandeja(page);

  // El dueño devuelve el cobro (RPC real) con el pedido ya dibujado como READY.
  const revertido = bloque(page, PEDIDO.revertido);
  await expect(revertido).toHaveAttribute('data-order-fiscal-status', 'READY');
  const devolucion = await rpcDe(OWNER, 'owner').rpc('reverse_manual_order_payment', {
    p_order_id: PEDIDO.revertido.id, p_expected_revision: 2, p_reason: 'Prueba E2E: cobro devuelto', p_idempotency_key: 'e2e-devolucion-9105',
  });
  expect(devolucion.error).toBeNull();
  const respuesta = page.waitForResponse((response) => response.url().endsWith('/rest/v1/rpc/request_order_invoice'));
  await revertido.getByRole('button', { name: 'Facturar', exact: true }).click();
  expect((await respuesta).status()).toBe(400);
  await expect(page.locator('[data-toast]')).toContainText('No se puede facturar todavía: El cobro fue revertido');
  await expect(revertido).toHaveAttribute('data-order-fiscal-status', 'BLOCKED');
  await expect(revertido).toContainText('El cobro fue revertido');
  expect(await documentoDe(PEDIDO.revertido.id)).toBeNull();

  // Un error crudo de PostgREST (función ausente en el caché) nunca llega a la pantalla.
  await page.route(`${SUPABASE_URL}/rest/v1/rpc/request_order_invoice`, (route) => route.fulfill({
    status: 404,
    contentType: 'application/json',
    body: JSON.stringify({ code: 'PGRST202', message: 'Could not find the function public.request_order_invoice(p_business_id, p_order_id) in the schema cache', details: null, hint: 'Perhaps you meant public.request_fiscal_document' }),
  }));
  await bloque(page, PEDIDO.errorCrudo).getByRole('button', { name: 'Facturar', exact: true }).click();
  await expect(page.locator('[data-toast]')).toContainText('No se pudo completar la operación. Probá de nuevo.');
  await sinJerga(page);
  expect(await documentoDe(PEDIDO.errorCrudo.id)).toBeNull();
});

test('Teléfono: el mismo estado real, facturar con un toque, sin desborde', async ({ browser }) => {
  test.setTimeout(120_000);
  expect(facturado.cae, 'la prueba de escritorio corre antes').toBeTruthy();
  const context = await browser.newContext({ viewport: TELEFONO, isMobile: true, hasTouch: true });
  const page = await context.newPage();
  try {
    await instalarDatosDePrueba(page, { comoEmpleado: true });
    // Un teléfono no tiene Tauri: plataforma de navegador, como el mostrador desde el celular.
    await page.addInitScript(() => {
      try {
        delete globalThis.__TAURI__;
      } catch {
        globalThis.__TAURI__ = undefined;
      }
    });
    await conectarBaseReal(page, STAFF);
    const enviadas = registrarRpc(page);
    await abrirBandeja(page);

    // El pedido facturado en la PC se ve igual acá: la verdad está en la base.
    const delivery = bloque(page, PEDIDO.delivery);
    await expect(delivery).toHaveAttribute('data-order-fiscal-status', 'ISSUED');
    await expect(delivery.locator('.production-order-fiscal-number')).toHaveText(`Factura B 00006-00000001 · CAE de homologación ${facturado.cae}`);
    await expect(delivery.locator('[data-fiscal-simulation]')).toHaveText('HOMOLOGACIÓN · sin validez fiscal');
    await expect(delivery.getByRole('button', { name: /Facturar/ })).toHaveCount(0);

    // Facturar (sin imprimir) con un toque.
    const movil = bloque(page, PEDIDO.movil);
    await movil.scrollIntoViewIfNeeded();
    await expect(movil).toHaveAttribute('data-order-fiscal-status', 'READY');
    for (const boton of await movil.locator('button:not([disabled])').all()) {
      const caja = await boton.boundingBox();
      expect(Math.min(caja.width, caja.height), `${await boton.innerText()} se puede tocar`).toBeGreaterThanOrEqual(44);
    }
    const pedida = page.waitForRequest((request) => request.url().endsWith('/rest/v1/rpc/request_order_invoice'));
    await movil.getByRole('button', { name: 'Facturar', exact: true }).tap();
    expect(JSON.parse((await pedida).postData())).toMatchObject({ p_order_id: PEDIDO.movil.id, p_command_source: 'PANEL', p_print: false });
    await expect(movil).toHaveAttribute('data-order-fiscal-status', 'PENDING');
    await expect(movil.locator('[data-fiscal-print]')).toHaveCount(0);
    const documento = await documentoDe(PEDIDO.movil.id);
    expect(documento).toMatchObject({ state: 'queued', documents: 1, keys: [`PANEL:${STAFF_ID}`], print_requests: null });

    const sinDesborde = await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
    expect(sinDesborde, 'la bandeja con el bloque fiscal no desborda a 390px').toBe(true);

    // Recargar: el mismo estado, leído de la base.
    const antes = await textoDe(movil);
    await page.reload({ waitUntil: 'domcontentloaded' });
    await abrirBandeja(page);
    await expect(movil).toHaveAttribute('data-order-fiscal-status', 'PENDING');
    expect(await textoDe(movil)).toBe(antes);
    expect(enviadas.filter((call) => call.rpc === 'request_order_invoice')).toHaveLength(1);
    await sinJerga(page);
  } finally {
    await context.close();
  }
});
