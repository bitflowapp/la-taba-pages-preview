// TABA · CORE FISCAL ADOPTADO · WORKER CANONICO CONTRA EL ESQUEMA REAL DE LA TABA
//
// La Taba no tiene worker fiscal propio: corre el de bitflowapp/taba-fiscal en el
// SHA que fija fiscal-core.json. Esta verificacion lo ejecuta de punta a punta
// contra una base descartable YA migrada con la cadena real de La Taba (base +
// migraciones de adopcion), sin red, sin credenciales y sin ARCA:
//
//   · FiscalWorker, SupabaseFiscalStore, SupabasePrivateArtifactStorage y
//     FiscalArtifactWorker son los del core compilado en ese SHA. Hablan HTTP con
//     PostgREST/Storage emulados sobre la base (postgrest-shim.mjs): argumentos
//     por NOMBRE, rol service_role, errores PGRST.
//   · ARCA es FakeArca del core (WSFEv1 a nivel SOAP, homologacion): toda
//     autorizacion es SIMULADA y ningun pedido sale de la maquina (el fetch
//     global queda bloqueado mientras corre).
//   · Los pedidos los hace el repositorio REAL del Panel de La Taba
//     (js/repositories/supabase-fiscal-repository.js) y la impresion la toma el
//     gateway REAL del agente local (supabase/functions/_shared/print-agent-gateway.ts).
//   · Los importes salen de un snapshot impositivo SINTETICO de prueba: no es
//     politica contable. Una venta real sigue sin facturarse
//     (ACCOUNTING_POLICY_REQUIRED, ver fiscal_core_contract_test.sql).
//
// Escenarios
//   A  E2E: pedido del Panel → claim → reserve → FakeArca → authorize → persist →
//      PDF privado → trabajo de impresion → agente (claim, printing, printed).
//      Esperado: 1 comprobante, 1 numero, 1 autorizacion simulada, 1 PDF, 1 trabajo.
//   B  Recuperacion. B1: ARCA procesa, la respuesta se pierde y la consulta
//      tambien; B2: el worker cae antes de registrar el resultado. Un worker nuevo
//      concilia con FECompConsultar: mismo numero, mismo CAE, ningun reenvio.
//   C  Concurrencia: 10/50/100 pedidos simultaneos por los cuatro canales y 3
//      workers canonicos a la vez: 1 comprobante por venta, numeros 1..3.
//   D  Aislamiento: el worker de un CUIT no toca otro; otro negocio no pide, no
//      actua ni lee lo ajeno.
//   E  El contrato del worker anterior de La Taba ya no resuelve (PGRST202).
//   F  Un conflicto de PDF responde PT409 (409 inmediato), nunca 40001.
//
//   TABA_LOCAL_FISCAL_DB=1 TABA_FISCAL_DIR=<checkout de taba-fiscal en el SHA fijado, compilado> \
//     npm run fiscal:core:verify -- postgres://postgres@127.0.0.1:55461/<base-descartable>
//
// PHYSICAL_PRINT: NOT_VERIFIED. El agente es simulado y no hay impresora.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash, randomBytes, randomInt, randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createSupabaseShim } from './postgrest-shim.mjs';

const ROOT = path.resolve(import.meta.dirname, '..', '..');
const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'fiscal-core.json'), 'utf8'));
const SYNTHETIC_TAX = { net_amount: '2066.12', tax_amount: '433.88', tax_code: '5', exempt_amount: '0.00', non_taxed_amount: '0.00', other_taxes_amount: '0.00', fixture: 'SINTETICO_NO_ES_POLITICA_CONTABLE' };
const INVOICE_TYPE = 6;
const sha256 = (value) => createHash('sha256').update(value).digest('hex');

// ── Worker canonico: el checkout fijado, sin cambios locales y compilado ─────
export async function loadCanonicalCore(coreDir = process.env.TABA_FISCAL_DIR) {
  const pinned = manifest.canonical_source.sha;
  assert.ok(coreDir, `TABA_FISCAL_DIR: checkout de ${manifest.canonical_source.repository} en ${pinned}`);
  const git = (...args) => execFileSync('git', ['-C', coreDir, ...args], { encoding: 'utf8' }).trim();
  const head = git('rev-parse', 'HEAD');
  assert.equal(head, pinned, `TABA_FISCAL_DIR esta en ${head}; fiscal-core.json fija ${pinned}`);
  assert.equal(git('status', '--porcelain', '--', manifest.worker.path), '', 'el worker canonico tiene cambios locales: no es el SHA fijado');
  const bridge = path.join(coreDir, manifest.worker.path);
  // dist no se versiona: tiene que estar compilado despues del ultimo cambio de sus fuentes.
  const sources = ['src', path.join('tests', 'support')].flatMap((dir) => fs.readdirSync(path.join(bridge, dir))
    .filter((name) => name.endsWith('.ts')).map((name) => fs.statSync(path.join(bridge, dir, name)).mtimeMs));
  const newestSource = Math.max(...sources);
  const modules = {
    worker: 'dist/src/worker.js', wsfe: 'dist/src/wsfe.js', store: 'dist/src/store.js', artifacts: 'dist/src/artifact-worker.js',
    fakeArca: 'dist/tests/support/fake-arca.js', support: 'dist/tests/support/worker.js',
  };
  const loaded = {};
  for (const [key, file] of Object.entries(modules)) {
    const target = path.join(bridge, file);
    assert.ok(fs.existsSync(target) && fs.statSync(target).mtimeMs >= newestSource, `${file} falta o es anterior a sus fuentes: npm ci && npm run build en ${bridge}`);
    loaded[key] = await import(pathToFileURL(target).href);
  }
  return {
    head,
    FiscalWorker: loaded.worker.FiscalWorker,
    WsfeClient: loaded.wsfe.WsfeClient,
    SupabaseFiscalStore: loaded.store.SupabaseFiscalStore,
    SupabasePrivateArtifactStorage: loaded.store.SupabasePrivateArtifactStorage,
    FiscalArtifactWorker: loaded.artifacts.FiscalArtifactWorker,
    FakeArca: loaded.fakeArca.FakeArca,
    arcaConfig: loaded.support.arcaConfig,
    ticket: loaded.support.ticket,
    recordingLogger: loaded.support.recordingLogger,
  };
}

async function loadGateway() {
  try {
    return await import(pathToFileURL(path.join(ROOT, 'supabase', 'functions', '_shared', 'print-agent-gateway.ts')).href);
  } catch (error) {
    if (['ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX', 'ERR_UNKNOWN_FILE_EXTENSION'].includes(error.code)) {
      throw new Error('el gateway del agente es TypeScript: correr con node --experimental-transform-types (npm run fiscal:core:verify)');
    }
    throw error;
  }
}

// ── Fixture: negocios, operadores con sesion, perfil homologado, politica y ventas ──
function cuitFor(ten) {
  const weights = [5, 4, 3, 2, 7, 6, 5, 4, 3, 2];
  const sum = [...ten].reduce((total, digit, index) => total + Number(digit) * weights[index], 0);
  const check = 11 - (sum % 11);
  return check === 10 ? null : `${ten}${check === 11 ? 0 : check}`;
}

function freshCuit() {
  for (;;) {
    const cuit = cuitFor(`20${randomInt(10_000_000, 100_000_000)}`);
    if (cuit) return cuit;
  }
}

async function seedBusiness(admin, label, pointOfSale) {
  const tag = randomUUID().slice(0, 8);
  const fixture = {
    label, pointOfSale, cuit: freshCuit(), business: randomUUID(), owner: randomUUID(), staff: randomUUID(),
    ownerSession: randomUUID(), staffSession: randomUUID(), product: randomUUID(),
  };
  await admin.query(`insert into auth.users(id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
    values ($1,'authenticated','authenticated',$3,'',now(),'{}','{}',now(),now()), ($2,'authenticated','authenticated',$4,'',now(),'{}','{}',now(),now())`,
  [fixture.owner, fixture.staff, `verify-${tag}-owner@example.invalid`, `verify-${tag}-staff@example.invalid`]);
  await admin.query(`insert into public.businesses(id,name,status,slug,is_active,operating_timezone)
    values ($1,$2,'open',$3,true,'America/Argentina/Buenos_Aires')`, [fixture.business, `TABA VERIFICACION ${label}`, `taba-verificacion-${label.toLowerCase()}-${tag}`]);
  await admin.query(`insert into public.business_members(business_id,user_id,role,is_active) values ($1,$2,'owner',true),($1,$3,'staff',true)`,
    [fixture.business, fixture.owner, fixture.staff]);
  await admin.query(`insert into public.identity_sessions(session_id,user_id,business_id,role_at_login,client)
    values ($1,$2,$5,'owner','panel_web'),($3,$4,$5,'staff','panel_web')`, [fixture.ownerSession, fixture.owner, fixture.staffSession, fixture.staff, fixture.business]);
  await admin.query(`insert into public.products(id,business_id,name,description,category,price,image_url,is_active,brand,subcategory,presentation,capacity,packaging_type,stock,available,is_alcoholic,tags,is_verified,verified_at,verified_by,external_id,variant,capacity_value,capacity_unit,catalog_origin,units_per_pack)
    values($1,$2,'Producto verificacion','Fixture','Aguas',1250,'https://example.invalid/p.webp',true,'Marca','Pruebas','Unidad','1 u','unidad',100,false,false,'{}',false,null,null,$3,'Unidad',1,'unidad','test_only',1)`,
  [fixture.product, fixture.business, `fiscal-verify-${tag}`]);
  await admin.query(`insert into public.fiscal_profiles(business_id,legal_name,cuit,tax_condition,business_address,environment,point_of_sale,default_currency,default_concept,
      invoice_policy,is_enabled,default_recipient_condition,accountant_review_status,certificate_fingerprint_sha256,certificate_expires_at,homologation_authorized_at,homologation_authorized_by)
    values($1,$2,$3,'Responsable Inscripto','Direccion fiscal fixture','homologation',$4,'PES',1,'manual',true,'Consumidor Final','approved',$5,now()+interval '90 days',now(),$6)`,
  [fixture.business, `TABA VERIFICACION ${label} SRL`, fixture.cuit, pointOfSale, sha256(`certificado-sintetico-${tag}`), fixture.owner]);
  await admin.query(`insert into public.fiscal_accounting_policies(business_id,environment,policy_version,valid_from,issuer_condition,recipient_condition,concept,invoice_type,credit_note_type,
      recipient_document_type,recipient_document_number,enabled,accountant_review_status,approved_by,approved_at,notes,recipient_vat_condition_id)
    values($1,'homologation',$2,current_date,'Responsable Inscripto','Consumidor Final',1,6,8,99,'0',true,'approved',$3,now(),'Fixture sintetico; no constituye politica contable.',5)`,
  [fixture.business, `fiscal-verify-${tag}`, fixture.owner]);
  return fixture;
}

async function seedSale(admin, fixture) {
  const sale = randomUUID();
  await admin.query(`insert into public.pos_sales(id,business_id,operator_id,state,subtotal,total,currency,idempotency_key,completed_at)
    values ($1,$2,$3,'completed',2500,2500,'PES',$4,now())`, [sale, fixture.business, fixture.staff, `fiscal-verify-sale-${sale}`]);
  await admin.query(`insert into public.pos_sale_items(sale_id,product_id,product_name,quantity,unit_price,line_total,tax_snapshot)
    values ($1,$2,'Producto verificacion',2,1250,2500,$3)`, [sale, fixture.product, SYNTHETIC_TAX]);
  return sale;
}

async function one(admin, sql, params = []) {
  return (await admin.query(sql, params)).rows[0];
}

function documentState(admin, id) {
  return one(admin, `select d.state, d.document_number::int as number, d.cae, d.dispatch_count, d.artifact_state, o.state as outbox_state,
      (select count(*)::int from public.fiscal_request_attempts a where a.fiscal_document_id = d.id) as attempts,
      (select count(*)::int from public.print_jobs j where j.source_entity_id = d.id and j.document_type = 'fiscal_receipt') as print_jobs
    from public.fiscal_documents d left join public.fiscal_outbox o on o.fiscal_document_id = d.id
   where d.id = $1`, [id]);
}

// Viaje en el tiempo, como las pruebas del core: vence la espera o el lease en lugar de dormir.
function dueNow(admin, documentIds) {
  return admin.query(`update public.fiscal_outbox set next_attempt_at = now() - interval '1 second'
    where fiscal_document_id = any($1::uuid[]) and state in ('pending','retry_wait')`, [documentIds]);
}

function expireLease(admin, documentId) {
  return admin.query(`update public.fiscal_outbox set lease_deadline = now() - interval '1 second'
    where fiscal_document_id = $1 and state = 'leased'`, [documentId]);
}

async function storm(tasks, lanes) {
  const results = new Array(tasks.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(lanes, tasks.length) }, async () => {
    for (;;) {
      const index = next++;
      if (index >= tasks.length) return;
      results[index] = await tasks[index]();
    }
  }));
  return results;
}

export async function verifyCanonicalWorker(connect, { core, log = console.log, lanes = Number(process.env.FISCAL_RACE_MAX_CONNECTIONS || 50) } = {}) {
  core ??= await loadCanonicalCore();
  const gateway = await loadGateway();
  const { createSupabaseFiscalRepository } = await import(pathToFileURL(path.join(ROOT, 'js', 'repositories', 'supabase-fiscal-repository.js')).href);
  const admin = await connect();
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (input) => { throw new Error(`red deshabilitada durante la verificacion: ${String(input).slice(0, 80)}`); };
  try {
    const schema = await one(admin, `select
        to_regprocedure('public.service_request_fiscal_document(uuid,text,uuid,text,text,text,uuid)') is not null as adopted,
        to_regprocedure('public.claim_fiscal_outbox(text,integer,integer)') is null as legacy_dropped`);
    assert.ok(schema.adopted && schema.legacy_dropped, 'la base no tiene el core adoptado: migrarla con la cadena de La Taba');
    log(`FISCAL_CORE_WORKER_SOURCE: ${manifest.canonical_source.repository}@${core.head} (${manifest.worker.path}, compilado)`);

    const workerCalls = [];
    const clientCalls = [];
    const service = createSupabaseShim(connect, { calls: workerCalls, label: 'worker' });
    const channels = createSupabaseShim(connect, { calls: clientCalls, label: 'service_channel' });
    const operator = (fixture, who) => createSupabaseShim(connect, {
      claims: { sub: fixture[who], role: 'authenticated', session_id: fixture[`${who}Session`] }, calls: clientCalls, label: `${fixture.label}:${who}`,
    }).rpcClient();
    const panel = (fixture, who, businessId = fixture.business) => createSupabaseFiscalRepository({ client: operator(fixture, who), businessId });
    const serverChannel = (fixture, sale, key, source, actor) => channels.rpcClient().rpc('service_request_fiscal_document', {
      p_business_id: fixture.business, p_source_type: 'pos_sale', p_source_id: sale, p_document_intent: 'invoice', p_idempotency_key: key, p_command_source: source, p_actor_id: actor,
    });
    const store = new core.SupabaseFiscalStore(service, service.fetch);
    const canonicalWorker = (fixture, arca, workerId, workerStore = store) => {
      const config = core.arcaConfig({ cuit: fixture.cuit }, workerId);
      const logger = core.recordingLogger();
      return { logger, worker: new core.FiscalWorker({ config, store: workerStore, wsaa: { login: async () => core.ticket }, wsfe: new core.WsfeClient(config, arca.fetch), logger }) };
    };
    const artifactWorker = new core.FiscalArtifactWorker({
      workerId: 'taba-fiscal-artifacts-01', store, storage: new core.SupabasePrivateArtifactStorage(service, service.fetch), logger: core.recordingLogger(),
    });
    const drainArtifacts = async () => {
      for (let round = 0; round < 20; round += 1) if (!(await artifactWorker.runOnce(10)).claimed) return;
      throw new Error('la cola de PDF no se vacia');
    };
    const agent = (deviceToken) => async (body) => {
      const headers = { 'content-type': 'application/json', ...(deviceToken ? { authorization: `Bearer ${deviceToken}` } : {}) };
      const response = await gateway.handleGatewayRequest(
        new Request('http://print-agent-gateway.invalid/', { method: 'POST', headers, body: JSON.stringify(body) }),
        { rpc: (name, params) => channels.rpcClient().rpc(name, params) },
      );
      return { status: response.status, body: await response.json() };
    };
    // El owner activa la impresion fiscal automatica y vincula una PC; el agente se registra por el gateway.
    const pairAgent = async (fixture) => {
      const owner = operator(fixture, 'owner');
      const configured = await owner.rpc('configure_business_print_settings', { p_business_id: fixture.business, p_settings: { auto_print_enabled: true, fiscal_receipt_auto: true } });
      assert.equal(configured.error, null, `impresion automatica: ${JSON.stringify(configured.error)}`);
      const pairing = await owner.rpc('create_local_device_pairing', { p_business_id: fixture.business, p_device_name: `Mostrador ${fixture.label}` });
      assert.equal(pairing.error, null, `vinculacion: ${JSON.stringify(pairing.error)}`);
      const secret = randomBytes(32).toString('base64url');
      const registered = await agent(null)({
        action: 'register', pairing_code: pairing.data.pairing_code, secret_hash: sha256(secret), device_name: `Mostrador ${fixture.label}`, platform: 'windows', agent_version: '0.1.0',
      });
      assert.equal(registered.status, 200, `registro del agente: ${JSON.stringify(registered.body)}`);
      return agent(`tla1.${registered.body.device_id}.${secret}`);
    };

    // Parametros de ARCA: los guarda el store canonico, con la misma RPC y los mismos nombres que en produccion.
    const version = `fiscal-core-verify-${Date.now()}`;
    for (const [parameterType, operation, values] of [
      ['document_types', 'FEParamGetTiposCbte', [{ Id: 6 }, { Id: 8 }, { Id: 11 }, { Id: 13 }]],
      ['recipient_document_types', 'FEParamGetTiposDoc', [{ Id: 96 }, { Id: 99 }]],
      ['recipient_vat_conditions', 'FEParamGetCondicionIvaReceptor', [{ Id: 5 }]],
    ]) {
      await store.saveParameterSnapshot({
        environment: 'homologation', parameterType, operation, version, synchronizedAt: new Date().toISOString(), values,
        requestHash: sha256(`${version}:${parameterType}:request`), responseHash: sha256(`${version}:${parameterType}:response`),
      });
    }
    const report = {};

    // ══ A · E2E ═══════════════════════════════════════════════════════════════
    const a = await seedBusiness(admin, 'A', 11);
    const arcaA = new core.FakeArca(a.cuit);
    const agentA = await pairAgent(a);
    const saleA = await seedSale(admin, a);
    const requested = await panel(a, 'staff').requestDocument({ sourceType: 'pos_sale', sourceId: saleA, idempotencyKey: `verify-a-panel-${saleA}` });
    assert.equal(requested.ok, true, `pedido del Panel: ${JSON.stringify(requested)}`);
    const docA = requested.data.fiscal_document_id;
    const workerA = canonicalWorker(a, arcaA, 'taba-fiscal-worker-01');
    assert.deepEqual(await workerA.worker.runOnce(), { claimed: 1, completed: 1 }, 'el worker canonico toma y cierra el comprobante');
    const [voucherA, ...extraA] = arcaA.vouchers(a.pointOfSale, INVOICE_TYPE);
    assert.equal(extraA.length, 0, 'ARCA simulado: un solo comprobante');
    const authorizedA = await documentState(admin, docA);
    assert.deepEqual([authorizedA.state, authorizedA.number, authorizedA.cae, authorizedA.dispatch_count, authorizedA.attempts],
      ['authorized', 1, voucherA.cae, 1, 1], `persistencia: ${JSON.stringify(authorizedA)}`);
    assert.equal(arcaA.count('FECAESolicitar'), 1, 'un solo FECAESolicitar');

    await drainArtifacts();
    const artifactsA = (await admin.query(`select id, storage_path, sha256, size_bytes::int as size_bytes, state, is_current
      from public.fiscal_document_artifacts where fiscal_document_id = $1`, [docA])).rows;
    assert.equal(artifactsA.length, 1, 'un solo PDF');
    const [artifactA] = artifactsA;
    const pdf = service.objects.get(artifactA.storage_path);
    assert.ok(pdf, `PDF privado en ${artifactA.storage_path}`);
    assert.equal(Buffer.from(pdf.subarray(0, 5)).toString('latin1'), '%PDF-', 'el objeto es un PDF');
    assert.deepEqual([sha256(pdf), pdf.byteLength, artifactA.state, artifactA.is_current], [artifactA.sha256, artifactA.size_bytes, 'artifact_ready', true], 'hash y tamanio registrados');
    assert.equal((await documentState(admin, docA)).artifact_state, 'artifact_ready');
    const grant = await operator(a, 'staff').rpc('authorize_fiscal_artifact_access', { p_artifact_id: artifactA.id, p_action: 'download' });
    assert.equal(grant.data?.artifact_id, artifactA.id, `el staff del negocio accede a su PDF: ${JSON.stringify(grant.error)}`);
    const listed = await panel(a, 'staff').listArtifacts();
    assert.ok(listed.ok && JSON.stringify(listed.data).includes(artifactA.id), 'el Panel lista el PDF');

    const claimedA = await agentA({ action: 'claim', document_types: ['fiscal_receipt'], limit: 5 });
    assert.equal(claimedA.status, 200, `claim del agente: ${JSON.stringify(claimedA.body)}`);
    assert.equal(claimedA.body.jobs.length, 1, 'un solo trabajo de impresion');
    const [jobA] = claimedA.body.jobs;
    assert.deepEqual([jobA.payload.cae, Number(jobA.payload.voucher.number)], [voucherA.cae, 1], 'el ticket lleva el CAE y el numero autorizados');
    for (const transition of ['printing', 'printed']) {
      const updated = await agentA({ action: 'update', job_id: jobA.id, claim_token: jobA.claim_token, transition, ...(transition === 'printed' ? { duration_ms: 850 } : {}) });
      assert.equal(updated.status, 200, `agente ${transition}: ${JSON.stringify(updated.body)}`);
    }
    const printedA = await one(admin, `select count(*)::int as jobs, min(status) as status from public.print_jobs where source_entity_id = $1 and document_type = 'fiscal_receipt'`, [docA]);
    assert.deepEqual([printedA.jobs, printedA.status], [1, 'printed']);

    const replayA = await serverChannel(a, saleA, `verify-a-whatsapp-${saleA}`, 'WHATSAPP', a.staff);
    assert.deepEqual([replayA.error, replayA.data?.fiscal_document_id, replayA.data?.idempotent_replay], [null, docA, true], 'WhatsApp converge al mismo comprobante');
    assert.deepEqual(await workerA.worker.runOnce(), { claimed: 0, completed: 0 }, 'nada nuevo para emitir');
    const totalsA = await one(admin, `select (select count(*)::int from public.fiscal_documents where source_type = 'pos_sale' and source_id = $1) as documents`, [saleA]);
    assert.deepEqual([totalsA.documents, arcaA.count('FECAESolicitar'), (await documentState(admin, docA)).print_jobs], [1, 1, 1], 'el pedido repetido no emite ni imprime de nuevo');
    report.e2e = { documents: 1, number: authorizedA.number, fecaesolicitar: 1, artifacts: 1, print_jobs: 1, print_contract: 'claim>printing>printed (agente simulado)' };
    log('FISCAL_CORE_WORKER_E2E: PASS (1 comprobante, 1 numero, 1 autorizacion SIMULADA, 1 PDF, 1 trabajo de impresion; WhatsApp repetido no reemite)');

    // ══ B · Recuperacion ══════════════════════════════════════════════════════
    // B1: ARCA procesa, la respuesta se pierde y la consulta inmediata tambien falla.
    const saleB1 = await seedSale(admin, a);
    const docB1 = (await panel(a, 'staff').requestDocument({ sourceType: 'pos_sale', sourceId: saleB1, idempotencyKey: `verify-b1-panel-${saleB1}` })).data.fiscal_document_id;
    arcaA.fault('FECAESolicitar', { kind: 'drop-response' }).fault('FECompConsultar', { kind: 'drop-request' });
    assert.deepEqual(await canonicalWorker(a, arcaA, 'taba-fiscal-worker-01').worker.runOnce(), { claimed: 1, completed: 1 });
    const lostB1 = await documentState(admin, docB1);
    const voucherB1 = arcaA.vouchers(a.pointOfSale, INVOICE_TYPE).find((voucher) => voucher.number === 2);
    assert.ok(voucherB1, 'ARCA simulado proceso el numero 2');
    assert.deepEqual([lostB1.state, lostB1.number, lostB1.cae, lostB1.dispatch_count, lostB1.outbox_state], ['ambiguous', 2, null, 1, 'retry_wait'],
      `sin respuesta el comprobante queda ambiguo: ${JSON.stringify(lostB1)}`);
    await dueNow(admin, [docB1]);
    // Reinicio: instancia nueva (cliente WSFE y logger nuevos) contra el mismo ARCA.
    assert.deepEqual(await canonicalWorker(a, arcaA, 'taba-fiscal-worker-01').worker.runOnce(), { claimed: 1, completed: 1 });
    const recoveredB1 = await documentState(admin, docB1);
    assert.deepEqual([recoveredB1.state, recoveredB1.number, recoveredB1.cae, recoveredB1.dispatch_count, recoveredB1.print_jobs],
      ['authorized', 2, voucherB1.cae, 1, 1], `conciliado con el CAE que ARCA emitio: ${JSON.stringify(recoveredB1)}`);
    assert.equal(arcaA.count('FECAESolicitar'), 2, 'la recuperacion no reenvio');
    log('FISCAL_CORE_WORKER_RECOVERY_RESPONSE_LOST: PASS (ambiguo → reinicio → FECompConsultar → autorizado con el mismo numero y CAE; 0 reenvios)');

    // B2: el worker cae despues de que ARCA autorizo y antes de registrarlo (el CAE solo quedo en su log).
    const saleB2 = await seedSale(admin, a);
    const docB2 = (await panel(a, 'staff').requestDocument({ sourceType: 'pos_sale', sourceId: saleB2, idempotencyKey: `verify-b2-panel-${saleB2}` })).data.fiscal_document_id;
    const dying = new Proxy(store, {
      get(target, property) {
        if (property === 'complete') return async () => { throw Object.assign(new Error('el proceso termino antes de registrar el resultado'), { code: 'DATABASE_UNAVAILABLE', retryable: true }); };
        const value = target[property];
        return typeof value === 'function' ? value.bind(target) : value;
      },
    });
    const crashed = canonicalWorker(a, arcaA, 'taba-fiscal-worker-01', dying);
    assert.deepEqual(await crashed.worker.runOnce(), { claimed: 1, completed: 0 });
    const loggedCae = crashed.logger.events.find((event) => event.event === 'fiscal_complete_failed')?.detail.cae;
    const hungB2 = await documentState(admin, docB2);
    assert.deepEqual([hungB2.state, hungB2.number, hungB2.cae, hungB2.dispatch_count, hungB2.outbox_state], ['authorizing', 3, null, 1, 'leased'],
      `el comprobante queda enviandose con el lease del worker caido: ${JSON.stringify(hungB2)}`);
    assert.equal(arcaA.vouchers(a.pointOfSale, INVOICE_TYPE).find((voucher) => voucher.number === 3)?.cae, loggedCae, 'ARCA simulado autorizo el numero 3');
    await expireLease(admin, docB2);
    assert.deepEqual(await canonicalWorker(a, arcaA, 'taba-fiscal-worker-02').worker.runOnce(), { claimed: 1, completed: 1 });
    const recoveredB2 = await documentState(admin, docB2);
    assert.deepEqual([recoveredB2.state, recoveredB2.number, recoveredB2.cae, recoveredB2.dispatch_count, recoveredB2.print_jobs],
      ['authorized', 3, loggedCae, 1, 1], `el worker nuevo concilia: ${JSON.stringify(recoveredB2)}`);
    const expiredEvent = await one(admin, `select count(*)::int as n from public.fiscal_events where fiscal_document_id = $1 and event_type = 'lease_expired_during_dispatch'`, [docB2]);
    assert.equal(expiredEvent.n, 1, 'queda auditado que el lease vencio en pleno envio');
    assert.equal(arcaA.count('FECAESolicitar'), 3, 'ningun reenvio en toda la recuperacion');
    report.recovery = { response_lost: 'ambiguous>restart>FECompConsultar>authorized', crash_before_persist: 'lease_expired>ambiguous>FECompConsultar>authorized', resends: 0 };
    log('FISCAL_CORE_WORKER_RECOVERY_CRASH_BEFORE_PERSIST: PASS (lease vencido → ambiguo auditado → worker nuevo concilia el CAE del log; 0 reenvios)');

    // ══ C · Concurrencia: pedidos por los cuatro canales y 3 workers a la vez ══
    const c = await seedBusiness(admin, 'C', 12);
    const arcaC = new core.FakeArca(c.cuit);
    const docsC = [];
    for (const size of [10, 50, 100]) {
      const sale = await seedSale(admin, c);
      const keyFor = (index) => (index % 5 === 0 ? `verify-c:${sale.slice(0, 8)}:shared` : `verify-c:${sale.slice(0, 8)}:${index}`);
      const tasks = Array.from({ length: size }, (_, index) => {
        const key = keyFor(index);
        switch (index % 4) {
          case 0: return async () => {
            const result = await panel(c, index % 8 ? 'owner' : 'staff').requestDocument({ sourceType: 'pos_sale', sourceId: sale, idempotencyKey: key });
            return result.ok ? { data: result.data } : { error: result };
          };
          case 1: return async () => operator(c, 'staff').rpc('request_fiscal_document', {
            p_business_id: c.business, p_source_type: 'pos_sale', p_source_id: sale, p_document_intent: 'invoice', p_idempotency_key: key, p_command_source: 'MOBILE',
          });
          case 2: return async () => serverChannel(c, sale, key, 'WHATSAPP', c.staff);
          default: return async () => serverChannel(c, sale, key, 'AUTOMATION', null);
        }
      });
      const results = await storm(tasks, lanes);
      const failures = results.filter((result) => result.error);
      assert.equal(failures.length, 0, `${size} pedidos: ${JSON.stringify(failures.slice(0, 3))}`);
      const ids = new Set(results.map((result) => result.data.fiscal_document_id));
      assert.equal(ids.size, 1, `${size} pedidos devolvieron ${ids.size} comprobantes`);
      assert.equal(results.filter((result) => result.data.idempotent_replay === false).length, 1, 'un solo pedido crea la intencion');
      const [doc] = ids;
      const row = await one(admin, `select
          (select count(*)::int from public.fiscal_documents where source_type = 'pos_sale' and source_id = $1) as documents,
          (select count(*)::int from public.fiscal_outbox where fiscal_document_id = $2) as outbox,
          (select count(*)::int from public.fiscal_idempotency_keys where fiscal_document_id = $2) as keys`, [sale, doc]);
      assert.deepEqual([row.documents, row.outbox, row.keys], [1, 1, new Set(Array.from({ length: size }, (_, index) => keyFor(index))).size], `${size}: comprobante, cola y claves`);
      docsC.push(doc);
      report[`concurrency_${size}`] = { requests: size, documents: 1, outbox: 1, keys: row.keys };
      log(`FISCAL_CORE_WORKER_CONCURRENCY_${size}: PASS (${size} pedidos PANEL/MOBILE/WHATSAPP/AUTOMATION por PostgREST → 1 comprobante, ${row.keys} claves)`);
    }
    const workersC = ['c1', 'c2', 'c3'].map((suffix) => canonicalWorker(c, arcaC, `taba-fiscal-worker-${suffix}`));
    let rounds = 0;
    for (; rounds < 10; rounds += 1) {
      await Promise.all(workersC.map(({ worker }) => worker.runOnce(5)));
      const pending = await one(admin, `select count(*)::int as n from public.fiscal_documents where id = any($1::uuid[]) and state <> 'authorized'`, [docsC]);
      if (!pending.n) break;
      await dueNow(admin, docsC);
    }
    const finalC = (await admin.query(`select state, document_number::int as number, dispatch_count
      from public.fiscal_documents where id = any($1::uuid[]) order by document_number`, [docsC])).rows.map((row) => [row.state, row.number, row.dispatch_count]);
    assert.deepEqual(finalC, [['authorized', 1, 1], ['authorized', 2, 1], ['authorized', 3, 1]], `3 workers: numeros correlativos, un envio cada uno: ${JSON.stringify(finalC)}`);
    assert.deepEqual([arcaC.count('FECAESolicitar'), arcaC.count('FECAESolicitar', 'authorized')], [3, 3], 'ARCA simulado: 3 envios, 3 autorizados, ningun rechazo por correlatividad');
    const blocked = workerCalls.filter((call) => call.code === 'TF002').length;
    report.concurrent_workers = { workers: 3, documents: 3, numbers: [1, 2, 3], fecaesolicitar: 3, series_blocked_retries: blocked, rounds: rounds + 1 };
    log(`FISCAL_CORE_WORKER_CONCURRENT_WORKERS: PASS (3 workers canonicos: numeros 1..3, 3 FECAESolicitar, ${blocked} reservas esperaron la serie (TF002))`);

    // ══ D · Aislamiento ═══════════════════════════════════════════════════════
    const d = await seedBusiness(admin, 'D', 13);
    const arcaD = new core.FakeArca(d.cuit);
    const agentD = await pairAgent(d);
    const foreignSale = await seedSale(admin, a);
    const foreign = [
      (await panel(d, 'owner', a.business).requestDocument({ sourceType: 'pos_sale', sourceId: foreignSale, idempotencyKey: `verify-d-foreign-panel-${foreignSale}` })).ok,
      (await panel(d, 'owner').requestDocument({ sourceType: 'pos_sale', sourceId: foreignSale, idempotencyKey: `verify-d-foreign-own-${foreignSale}` })).ok,
      (await serverChannel(a, foreignSale, `verify-d-foreign-wa-${foreignSale}`, 'WHATSAPP', d.owner)).error === null,
      (await operator(d, 'owner').rpc('authorize_fiscal_artifact_access', { p_artifact_id: artifactA.id, p_action: 'download' })).error === null,
    ];
    assert.deepEqual(foreign, [false, false, false, false], 'otro negocio no pide, no actua ni lee lo ajeno');
    assert.equal((await one(admin, `select count(*)::int as n from public.fiscal_documents where source_id = $1`, [foreignSale])).n, 0, 'ningun comprobante nacio de un pedido ajeno');
    const saleD = await seedSale(admin, d);
    const docD = (await panel(d, 'staff').requestDocument({ sourceType: 'pos_sale', sourceId: saleD, idempotencyKey: `verify-d-panel-${saleD}` })).data.fiscal_document_id;
    assert.deepEqual(await canonicalWorker(a, arcaA, 'taba-fiscal-worker-01').worker.runOnce(), { claimed: 0, completed: 0 }, 'el worker del CUIT A no toma D');
    assert.deepEqual(await workersC[0].worker.runOnce(), { claimed: 0, completed: 0 }, 'el worker del CUIT C no toma D');
    const untouchedD = await documentState(admin, docD);
    assert.deepEqual([untouchedD.state, untouchedD.number, arcaA.count('FECAESolicitar'), arcaC.count('FECAESolicitar')], ['queued', null, 3, 3], 'D sigue en cola, intacto');
    assert.deepEqual(await canonicalWorker(d, arcaD, 'taba-fiscal-worker-d1').worker.runOnce(), { claimed: 1, completed: 1 });
    const authorizedD = await documentState(admin, docD);
    assert.deepEqual([authorizedD.state, authorizedD.number, authorizedD.print_jobs], ['authorized', 1, 1], 'D autoriza en su propia serie');
    // Cada agente ve solo su negocio: el de A recibe sus tickets pendientes (B1, B2), nunca el de D.
    const issuers = async (agentFor) => {
      const claimed = await agentFor({ action: 'claim', document_types: ['fiscal_receipt', 'order_ticket', 'kitchen_ticket'], limit: 10 });
      assert.equal(claimed.status, 200, JSON.stringify(claimed.body));
      return claimed.body.jobs.map((job) => job.payload.issuer.cuit);
    };
    assert.deepEqual(await issuers(agentA), [a.cuit, a.cuit], 'el agente de A no recibe trabajos de otro negocio');
    assert.deepEqual(await issuers(agentD), [d.cuit], 'el agente de D recibe solo el suyo');
    report.tenant_isolation = { foreign_request_panel: 'denied', foreign_request_own_business: 'denied', foreign_actor_whatsapp: 'denied', foreign_artifact: 'denied', other_cuit_worker_claims: 0, agents: 'own business only' };
    log('FISCAL_CORE_WORKER_TENANT_ISOLATION: PASS (pedido, actor y PDF ajenos denegados; cada worker solo reclama su CUIT; cada agente solo su negocio)');

    // ══ E · El contrato del worker anterior ya no existe ═══════════════════════
    const legacyCalls = [];
    const legacy = createSupabaseShim(connect, { calls: legacyCalls, label: 'legacy_worker' }).rpcClient();
    for (const [name, args] of [
      ['claim_fiscal_outbox', { p_worker_id: 'arca-fiscal-bridge-legacy', p_limit: 5, p_lease_seconds: 90 }],
      ['reserve_fiscal_document_number', { p_document_id: docD, p_worker_id: 'arca-fiscal-bridge-legacy', p_expected_number: 2 }],
      ['complete_fiscal_attempt', { p_outbox_id: randomUUID(), p_worker_id: 'arca-fiscal-bridge-legacy', p_result: { classification: 'authorized' } }],
      ['complete_fiscal_artifact', { p_artifact_outbox_id: randomUUID(), p_worker_id: 'arca-fiscal-bridge-legacy', p_artifact: {} }],
      ['fail_fiscal_artifact', { p_artifact_outbox_id: randomUUID(), p_worker_id: 'arca-fiscal-bridge-legacy', p_error_code: 'LEGACY', p_error_message: 'legacy', p_retryable: true }],
    ]) {
      const result = await legacy.rpc(name, args);
      assert.deepEqual([result.status, result.error?.code], [404, 'PGRST202'], `${name}: el contrato del worker anterior sigue resolviendo`);
    }
    report.legacy_worker_contract = 'PGRST202 (claim, reserve, complete, complete/fail artifact)';
    log('FISCAL_CORE_LEGACY_WORKER_CONTRACT: PASS (el worker anterior no puede reclamar, reservar ni cerrar: PGRST202)');

    // ══ F · Conflicto de PDF: 409 inmediato (PT409), nunca 40001 ═══════════════
    // El core eleva 40001 y su worker de PDF lo espera; PostgREST lo reintenta hasta el 504.
    // La Taba adopta PT409: el store canonico lo recibe como 409 no reintentable.
    const probeCalls = [];
    const probe = createSupabaseShim(connect, { calls: probeCalls, label: 'pdf_probe' });
    const probeStore = new core.SupabaseFiscalStore(probe, probe.fetch);
    const [pdfJob] = await probeStore.claimArtifacts('taba-fiscal-artifacts-02', 1);
    assert.ok(pdfJob, 'queda un PDF pendiente para reclamar');
    const stale = await probeStore.failArtifact(pdfJob.outboxId, 'taba-fiscal-artifacts-02', pdfJob.leaseEpoch - 1, 'PDF_LEASE_VIEJO', 'lease viejo', true)
      .then(() => null, (error) => error);
    assert.deepEqual([stale?.sqlState, stale?.retryable], ['PT409', false], 'un resultado de PDF con lease viejo recibe PT409 (409), no un 40001 que PostgREST reintentaria');
    await probeStore.failArtifact(pdfJob.outboxId, 'taba-fiscal-artifacts-02', pdfJob.leaseEpoch, 'PDF_VERIFICACION', 'devuelto por la verificacion', true);
    assert.deepEqual(probeCalls.map((call) => call.code ?? 'ok'), ['ok', 'PT409', 'ok']);
    report.pdf_conflict = 'PT409 -> HTTP 409, no reintentable (el worker de PDF del core todavia espera 40001)';
    log('FISCAL_CORE_PDF_CONFLICT: PASS (lease de PDF viejo → PT409/409 inmediato; el worker de PDF del core espera 40001: pendiente en el core)');

    // ══ Contrato HTTP: el worker canonico nunca choco con la base ═════════════
    const unexpected = workerCalls.filter((call) => !call.ok && call.code !== 'TF002');
    assert.deepEqual(unexpected, [], 'el worker canonico no tuvo errores de contrato');
    const unresolved = clientCalls.filter((call) => ['PGRST202', 'PGRST203', 'NOT_EMULATED', '40001'].includes(call.code));
    assert.deepEqual(unresolved, [], 'ningun cliente de La Taba llamo una funcion inexistente o ambigua, ni recibio un 40001 que PostgREST reintentaria');
    report.worker_routes = [...new Set(workerCalls.map((call) => call.route))].sort();
    report.client_routes = [...new Set(clientCalls.map((call) => call.route))].sort();
    log(`FISCAL_CORE_WORKER_HTTP_CONTRACT: PASS (${workerCalls.length} llamadas del worker, ${clientCalls.length} de clientes de La Taba; rutas del worker: ${report.worker_routes.join(', ')})`);
    log('PHYSICAL_PRINT: NOT_VERIFIED (agente simulado, sin impresora)');
    return report;
  } finally {
    globalThis.fetch = realFetch;
    await admin.end().catch(() => {});
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  assert.equal(process.env.TABA_LOCAL_FISCAL_DB, '1', 'TABA_LOCAL_FISCAL_DB=1 required (base descartable, nunca produccion)');
  const url = process.argv[2];
  assert.ok(url, 'uso: npm run fiscal:core:verify -- <postgres-url-de-una-base-local-descartable>');
  assert.match(new URL(url).hostname, /^(127\.0\.0\.1|localhost|\[::1\])$/, 'solo bases locales descartables');
  const { default: pg } = await import('pg');
  const connect = async () => {
    const client = new pg.Client({ connectionString: url });
    client.on('error', () => {});
    await client.connect();
    return client;
  };
  console.log(JSON.stringify(await verifyCanonicalWorker(connect)));
}
