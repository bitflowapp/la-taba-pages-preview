// LA TABA · WHATSAPP FISCAL V2 · DE PUNTA A PUNTA CONTRA EL ESQUEMA REAL
//
// Lo que ni pgTAP ni las pruebas de Deno cubren juntos: el gateway REAL del webhook
// (supabase/functions/_shared/whatsapp-webhook-gateway.ts) con pedidos HTTP firmados como los
// de Meta, contra una base descartable YA migrada con la cadena de La Taba, por PostgREST
// emulado (scripts/fiscal-core/postgrest-shim.mjs), y el worker CANÓNICO del core autorizando
// contra FakeArca. Sin red, sin credenciales de Meta y sin ARCA:
//
//   · la Graph API es un doble que registra cada envío;
//   · el App Secret y el verify token son de prueba;
//   · toda autorización es SIMULADA.
//
// Escenarios
//   SIGNATURE ...... sin firma o con otro secreto: 401 y nada en la base.
//   PAIRING ........ el Panel pide el código (RPC real) y el teléfono lo canjea por el webhook.
//   BATCH .......... un lote firmado con "facturar" y "si": se procesan en orden; el comprobante
//                    es del PEDIDO, por WHATSAPP, con el usuario vinculado como actor.
//   REDELIVERY ×5 .. Meta reentrega el mismo lote 5 veces a la vez: nada se repite.
//   RESTART ........ otro gateway, otras conexiones: el estado sigue en la base.
//   WORKER_E2E ..... worker canónico + FakeArca + PDF real: "estado" manda el texto y el PDF por
//                    la ruta privada del ARTEFACTO vigente (el objeto existe y es un PDF).
//   STALE .......... un SI vencido no factura.
//   MEMBERSHIP ..... dado de baja entre el facturar y el SI: no factura.
//   REVOCATION ..... el dueño revoca el vínculo desde el Panel: el teléfono deja de operar.
//
//   TABA_LOCAL_FISCAL_DB=1 TABA_FISCAL_DIR=<taba-fiscal en el SHA fijado, compilado> \
//     npm run whatsapp:verify -- postgres://postgres@127.0.0.1:55461/<base-descartable>
//
// REAL_META: NOT_VERIFIED (sin número de WhatsApp Business ni credenciales).
import assert from 'node:assert/strict';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { createSupabaseShim } from '../fiscal-core/postgrest-shim.mjs';
import { loadCanonicalCore } from '../fiscal-core/verify-canonical-worker.mjs';

const ROOT = path.resolve(import.meta.dirname, '..', '..');
const NUMBER = '109876543210';
const CUIT = '20123456786';
const sha256 = (value) => createHash('sha256').update(value).digest('hex');

async function loadGateway() {
  try {
    return await import(pathToFileURL(path.join(ROOT, 'supabase', 'functions', '_shared', 'whatsapp-webhook-gateway.ts')).href);
  } catch (error) {
    if (['ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX', 'ERR_UNKNOWN_FILE_EXTENSION'].includes(error.code)) {
      throw new Error('el gateway es TypeScript: correr con node --experimental-transform-types (npm run whatsapp:verify)');
    }
    throw error;
  }
}

async function seed(admin) {
  const fixture = {
    business: randomUUID(), owner: randomUUID(), staff: randomUUID(), ownerSession: randomUUID(), staffSession: randomUUID(),
    product: randomUUID(), orders: {}, phone: `54929955${String(Math.floor(Math.random() * 90000) + 10000)}`,
  };
  const tag = fixture.business.slice(0, 8);
  await admin.query('begin');
  try {
    await admin.query(`insert into auth.users(id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
      values ($1,'authenticated','authenticated',$3,'',now(),'{}','{}',now(),now()), ($2,'authenticated','authenticated',$4,'',now(),'{}','{}',now(),now())`,
    [fixture.owner, fixture.staff, `wa-verify-${tag}-owner@example.invalid`, `wa-verify-${tag}-staff@example.invalid`]);
    await admin.query(`insert into public.businesses(id,name,status,slug,is_active,operating_timezone) values ($1,'TABA VERIFICACION WHATSAPP','open',$2,true,'America/Argentina/Buenos_Aires')`,
      [fixture.business, `taba-verificacion-whatsapp-${tag}`]);
    await admin.query(`insert into public.business_members(business_id,user_id,role,is_active) values ($1,$2,'owner',true),($1,$3,'staff',true)`,
      [fixture.business, fixture.owner, fixture.staff]);
    await admin.query(`insert into public.identity_sessions(session_id,user_id,business_id,role_at_login,client) values ($1,$2,$5,'owner','panel_web'),($3,$4,$5,'staff','panel_web')`,
      [fixture.ownerSession, fixture.owner, fixture.staffSession, fixture.staff, fixture.business]);
    await admin.query(`insert into public.products(id,business_id,name,description,category,price,image_url,is_active,brand,subcategory,presentation,capacity,packaging_type,stock,available,is_alcoholic,tags,is_verified,verified_at,verified_by,external_id,variant,capacity_value,capacity_unit,catalog_origin,units_per_pack)
      values ($1,$2,'Gaseosa 2,25 L','Fixture','Aguas',1250,'https://example.invalid/p.webp',true,'Marca','Pruebas','Unidad','1 u','unidad',100,false,false,'{}',false,null,null,$3,'Unidad',1,'unidad','commercial',1)`,
    [fixture.product, fixture.business, `wa-verify-${tag}`]);
    await admin.query(`insert into public.fiscal_profiles(business_id,legal_name,cuit,tax_condition,business_address,environment,point_of_sale,default_currency,default_concept,
        invoice_policy,is_enabled,default_recipient_condition,accountant_review_status,certificate_fingerprint_sha256,certificate_expires_at,homologation_authorized_at,homologation_authorized_by)
      values ($1,'TABA VERIFICACION WHATSAPP SRL',$2,'Responsable Inscripto','Direccion fixture','homologation',7,'PES',1,'manual',true,'Consumidor Final','approved',$3,now()+interval '90 days',now(),$4)`,
    [fixture.business, CUIT, sha256(`certificado-sintetico-${tag}`), fixture.owner]);
    await admin.query(`insert into public.fiscal_parameter_snapshots(environment,parameter_type,version,values_json,synchronized_at) values
        ('homologation','document_types',$1,'[{"Id":6},{"Id":8}]'::jsonb,now()),
        ('homologation','recipient_document_types',$1,'[{"Id":99}]'::jsonb,now()),
        ('homologation','recipient_vat_conditions',$1,'[{"Id":5}]'::jsonb,now()),
        ('homologation','vat_types',$1,'{"IvaTipo":[{"Id":"5","Desc":"21%"}]}'::jsonb,now())`, [`wa-verify-${tag}`]);
    await admin.query(`insert into public.fiscal_accounting_policies(business_id,environment,policy_version,valid_from,issuer_condition,recipient_condition,concept,invoice_type,credit_note_type,
        recipient_document_type,recipient_document_number,enabled,accountant_review_status,approved_by,approved_at,notes,recipient_vat_condition_id)
      values ($1,'homologation',$2,current_date,'Responsable Inscripto','Consumidor Final',1,6,8,99,'0',true,'approved',$3,now(),'Fixture sintetico; no constituye politica contable.',5)`,
    [fixture.business, `wa-verify-${tag}`, fixture.owner]);
    await admin.query(`insert into public.commercial_fiscal_policies(business_id,policy_version,valid_from,status,billing_moment,mercadopago_rule,cash_rule,coordinate_rule,
        vat_computation,delivery_treatment,delivery_vat_code,discount_treatment,final_consumer_id_threshold,credit_note_policy,accountant_reference,approved_by,approved_at)
      values ($1,$2,current_date,'approved','after_payment_confirmed','require_approved','require_confirmed','require_confirmed',
        'price_includes_vat_per_rate','invoice_as_line',5,'prorate_by_item_gross',1000000,'manual_review_only','FIXTURE DE PRUEBA - no es politica contable',$3,now())`,
    [fixture.business, `wa-verify-${tag}`, fixture.owner]);
    await admin.query(`insert into public.product_fiscal_classifications(business_id,product_id,classification,vat_code,source,classified_by) values ($1,$2,'taxed',5,'accountant',$3)`,
      [fixture.business, fixture.product, fixture.owner]);
    for (const n of [1, 2, 3]) {
      const id = randomUUID();
      fixture.orders[n] = { id, code: `WAV-${tag.slice(0, 4).toUpperCase()}${n}` };
      await admin.query(`insert into public.orders(id,business_id,code,public_code,status,fulfillment_type,delivery_mode,client_request_id,customer_name,customer_phone,payment_method,subtotal,discount_total,delivery_fee,total)
        values ($1,$2,$3,$3,'accepted','pickup','pickup',$4,'CLIENTE_SINTETICO','+540000000000','cash',2500,0,0,2500)`, [id, fixture.business, fixture.orders[n].code, `wa-verify-${tag}-${n}`]);
      await admin.query(`insert into public.order_items(order_id,product_id,product_uuid,name,quantity,unit,unit_price,subtotal) values ($1,null,$2,'Gaseosa 2,25 L',2,'u',1250,2500)`, [id, fixture.product]);
      await admin.query(`update public.orders set manual_payment_status='confirmed', manual_payment_method='cash', manual_payment_confirmed_at=now(), manual_payment_confirmed_by=$2 where id=$1`,
        [id, fixture.staff]);
    }
    await admin.query('commit');
  } catch (error) {
    await admin.query('rollback').catch(() => {});
    throw error;
  }
  return fixture;
}

export async function verifyWhatsAppChannel(connect, { core, log = console.log } = {}) {
  core ??= await loadCanonicalCore();
  const { handleWhatsAppWebhook, hmacSha256Hex, createGraphSender } = await loadGateway();
  const admin = await connect();
  const one = async (sql, params = []) => (await admin.query(sql, params)).rows[0];
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (input) => { throw new Error(`red deshabilitada durante la verificacion: ${String(input).slice(0, 80)}`); };
  try {
    const fixture = await seed(admin);
    const appSecret = randomBytes(32).toString('hex');
    const service = createSupabaseShim(connect, { label: 'whatsapp' });
    const operator = (who) => createSupabaseShim(connect, {
      claims: { sub: fixture[who], role: 'authenticated', session_id: fixture[`${who}Session`] }, label: who,
    }).rpcClient();
    const graph = [];
    const makeGateway = (shim = service) => {
      const rpc = (name, params) => shim.rpcClient().rpc(name, params);
      return {
        appSecret, verifyToken: 'verify-local', phoneNumberId: NUMBER, rpc,
        send: createGraphSender({
          graphApiVersion: 'v99.0', phoneNumberId: NUMBER, accessToken: 'token-local', rpc,
          // La Graph API de Meta, simulada: registra cada envío.
          fetch: async (url, init) => {
            graph.push({ url, body: JSON.parse(String(init.body)) });
            return new Response(JSON.stringify({ messages: [{ id: `wamid.out.${graph.length}` }] }), { status: 200 });
          },
          // Storage: firma solo objetos que existen (el PDF que subió el worker del core).
          signArtifactUrl: async (bucket, storagePath) => (service.objects.has(storagePath) ? `https://storage.invalid/${bucket}/${storagePath}?firmado` : null),
        }),
        log: () => {},
      };
    };
    let sequence = 0;
    const body = (texts, phone = fixture.phone) => JSON.stringify({
      object: 'whatsapp_business_account',
      entry: [{ id: 'waba', changes: [{ field: 'messages', value: { messaging_product: 'whatsapp', metadata: { phone_number_id: NUMBER },
        messages: texts.map((textBody) => ({ from: phone, id: `wamid.verify.${fixture.business.slice(0, 8)}.${++sequence}`, timestamp: String(Math.floor(Date.now() / 1000)), type: 'text', text: { body: textBody } })) } }] }],
    });
    const deliver = async (raw, gateway = makeGateway(), secret = appSecret) => {
      const signature = `sha256=${await hmacSha256Hex(secret, new TextEncoder().encode(raw))}`;
      const response = await handleWhatsAppWebhook(new Request('https://example.invalid/functions/v1/whatsapp-webhook', {
        method: 'POST', headers: { 'content-type': 'application/json', 'x-hub-signature-256': signature }, body: raw,
      }), gateway);
      return { status: response.status, json: await response.json() };
    };
    const sentTo = (from) => graph.slice(from).map((entry) => entry.body);
    const lastTexts = (from) => sentTo(from).filter((entry) => entry.type === 'text').map((entry) => entry.text.body);
    const report = {};

    // ── SIGNATURE ─────────────────────────────────────────────────────────────────────
    const forged = body(['estado']);
    const unsigned = await handleWhatsAppWebhook(new Request('https://example.invalid/', { method: 'POST', body: forged }), makeGateway());
    const wrong = await deliver(forged, makeGateway(), 'otro-secreto');
    const forgedId = JSON.parse(forged).entry[0].changes[0].value.messages[0].id;
    assert.deepEqual([unsigned.status, wrong.status], [401, 401], 'sin la firma de Meta no se procesa');
    assert.equal((await one('select count(*)::int n from public.whatsapp_inbound_messages where wa_message_id = $1', [forgedId])).n, 0, 'y no queda nada en la base');
    log('WHATSAPP_GATEWAY_SIGNATURE: PASS (sin firma u otro secreto → 401, nada en la base)');

    // ── PAIRING ─────────────────────────────────────────────────────────────────────────
    const pairing = await operator('staff').rpc('create_whatsapp_pairing', { p_business_id: fixture.business });
    assert.equal(pairing.error, null, `código: ${JSON.stringify(pairing.error)}`);
    let mark = graph.length;
    const paired = await deliver(body([`vincular ${pairing.data.code}`]));
    assert.equal(paired.status, 200);
    assert.deepEqual(lastTexts(mark), ['Listo: este WhatsApp quedó vinculado a TABA VERIFICACION WHATSAPP. Escribí ayuda para ver qué podés hacer.']);
    log('WHATSAPP_GATEWAY_PAIRING: PASS (código del Panel, canje por el webhook firmado)');

    // ── BATCH: facturar + si en el mismo lote ─────────────────────────────────────────────
    const order = fixture.orders[1];
    const batch = body([`facturar ${order.code}`, 'si']);
    mark = graph.length;
    const first = await deliver(batch);
    assert.deepEqual([first.status, first.json.processed, first.json.sent], [200, 2, 2], `lote: ${JSON.stringify(first.json)}`);
    const [confirmation, received] = lastTexts(mark);
    assert.match(confirmation, new RegExp(`^Vas a pedir la factura del pedido ${order.code} `));
    assert.match(received, /^Solicitud recibida\. La factura del pedido /);
    const document = await one(`select d.id, d.state,
        (select array_agg(k.command_source || ':' || k.actor_id::text) from public.fiscal_idempotency_keys k where k.fiscal_document_id = d.id) keys
      from public.fiscal_documents d where d.source_type = 'online_order' and d.source_id = $1`, [order.id]);
    assert.deepEqual([document.state, document.keys], ['queued', [`WHATSAPP:${fixture.staff}`]], 'el comprobante es del pedido, por WhatsApp, con el usuario vinculado');
    log('WHATSAPP_GATEWAY_BATCH_IN_ORDER: PASS (facturar y SI del mismo lote, en orden; comprobante del PEDIDO por WHATSAPP)');

    // ── REDELIVERY ×5 ──────────────────────────────────────────────────────────────────────
    mark = graph.length;
    const redelivered = await Promise.all(Array.from({ length: 5 }, () => deliver(batch)));
    assert.ok(redelivered.every((result) => result.status === 200 && result.json.duplicates === 2 && result.json.processed === 0), JSON.stringify(redelivered.map((r) => r.json)));
    assert.equal(graph.length, mark, 'ningún reenvío de Meta genera otra respuesta');
    assert.equal((await one(`select count(*)::int n from public.fiscal_documents where source_type = 'online_order' and source_id = $1`, [order.id])).n, 1);
    log('WHATSAPP_META_REDELIVERY_X5: PASS (5 reentregas simultáneas del lote → 0 procesados, 0 respuestas, 1 comprobante)');

    // ── RESTART: otro gateway, otras conexiones ─────────────────────────────────────────────
    mark = graph.length;
    const restarted = await deliver(body([`estado ${order.code}`]), makeGateway(createSupabaseShim(connect, { label: 'whatsapp-2' })));
    assert.equal(restarted.status, 200);
    assert.match(lastTexts(mark)[0], new RegExp(`^${order.code} · Pendiente\\nHOMOLOGACIÓN · sin validez fiscal$`));
    log('WHATSAPP_RESTART_PERSISTENCE: PASS (otro gateway y otras conexiones leen el mismo estado)');

    // ── WORKER_E2E: worker canónico + FakeArca + PDF real ─────────────────────────────────────
    const store = new core.SupabaseFiscalStore(service, service.fetch);
    const arca = new core.FakeArca(CUIT);
    const config = core.arcaConfig({ cuit: CUIT }, 'taba-fiscal-worker-whatsapp');
    const worker = new core.FiscalWorker({ config, store, wsaa: { login: async () => core.ticket }, wsfe: new core.WsfeClient(config, arca.fetch), logger: core.recordingLogger() });
    assert.deepEqual(await worker.runOnce(), { claimed: 1, completed: 1 }, 'el worker canónico autoriza');
    const artifacts = new core.FiscalArtifactWorker({ workerId: 'taba-fiscal-artifacts-whatsapp', store, storage: new core.SupabasePrivateArtifactStorage(service, service.fetch), logger: core.recordingLogger() });
    for (let round = 0; round < 20; round += 1) if (!(await artifacts.runOnce(10)).claimed) break;
    const authorized = await one(`select d.cae, d.document_number::int number, a.id artifact_id, a.storage_path
      from public.fiscal_documents d join public.fiscal_document_artifacts a on a.fiscal_document_id = d.id and a.is_current
     where d.id = $1 and d.state = 'authorized'`, [document.id]);
    assert.ok(authorized?.artifact_id, 'autorizado y con PDF vigente');
    mark = graph.length;
    const status = await deliver(body([`estado ${order.code}`]));
    assert.equal(status.status, 200);
    const [statusText, pdf] = sentTo(mark);
    assert.equal(statusText.text.body, `${order.code} · Factura emitida\nFactura B 00007-${String(authorized.number).padStart(8, '0')} · CAE de homologación ${authorized.cae}\nHOMOLOGACIÓN · sin validez fiscal`);
    assert.equal(pdf.type, 'document');
    assert.equal(pdf.document.link, `https://storage.invalid/fiscal-documents/${authorized.storage_path}?firmado`, 'el PDF sale de la ruta privada del ARTEFACTO vigente');
    assert.equal(pdf.document.filename, `comprobante-00007-${String(authorized.number).padStart(8, '0')}.pdf`);
    assert.equal(Buffer.from(service.objects.get(authorized.storage_path).subarray(0, 5)).toString('latin1'), '%PDF-', 'y el objeto firmado es el PDF que generó el worker');
    assert.equal(arca.count('FECAESolicitar'), 1, 'un solo FECAESolicitar');
    report.worker_e2e = { cae_simulated: true, artifact_id: authorized.artifact_id, pdf_sent_by_artifact_path: true };
    log('WHATSAPP_WORKER_E2E: PASS (worker canónico + FakeArca estricto → autorizado → PDF real → enviado por la ruta del artefacto vigente)');

    // ── STALE ────────────────────────────────────────────────────────────────────────────
    const stale = fixture.orders[2];
    await deliver(body([`facturar ${stale.code}`]));
    await admin.query(`update public.whatsapp_pending_actions set created_at = now() - interval '10 minutes', expires_at = now() - interval '5 minutes'
      where order_id = $1 and closed_at is null`, [stale.id]);
    mark = graph.length;
    await deliver(body(['si']));
    assert.deepEqual(lastTexts(mark), [`La confirmación venció. Pedila de nuevo: facturar ${stale.code}`]);
    assert.equal((await one(`select count(*)::int n from public.fiscal_documents where source_type = 'online_order' and source_id = $1`, [stale.id])).n, 0);
    log('WHATSAPP_STALE_CONFIRMATION: PASS (un SI vencido no factura)');

    // ── MEMBERSHIP ─────────────────────────────────────────────────────────────────────────
    const third = fixture.orders[3];
    await deliver(body([`facturar ${third.code}`]));
    await admin.query('update public.business_members set is_active = false where business_id = $1 and user_id = $2', [fixture.business, fixture.staff]);
    mark = graph.length;
    await deliver(body(['si']));
    assert.deepEqual(lastTexts(mark), ['Tu usuario ya no puede facturar en ese negocio. No se pidió nada.']);
    assert.equal((await one(`select count(*)::int n from public.fiscal_documents where source_type = 'online_order' and source_id = $1`, [third.id])).n, 0);
    await admin.query('update public.business_members set is_active = true where business_id = $1 and user_id = $2', [fixture.business, fixture.staff]);
    log('WHATSAPP_MEMBERSHIP_REVALIDATION: PASS (dado de baja entre el facturar y el SI → no factura)');

    // ── REVOCATION ─────────────────────────────────────────────────────────────────────────
    const links = await operator('owner').rpc('list_whatsapp_links', { p_business_id: fixture.business });
    assert.equal(links.error, null);
    const revoked = await operator('owner').rpc('revoke_whatsapp_link', { p_link_id: links.data[0].id, p_reason: 'verificacion' });
    assert.equal(revoked.error, null);
    mark = graph.length;
    const after = await deliver(body([`facturar ${third.code}`]));
    assert.equal(after.json.processed, 1);
    assert.deepEqual(lastTexts(mark), ['Este WhatsApp no está vinculado a ningún negocio. Pedí un código en el Panel y mandá: vincular CÓDIGO']);
    log('WHATSAPP_LINK_REVOCATION: PASS (revocado desde el Panel → el teléfono deja de operar)');

    log('REAL_META: NOT_VERIFIED (Graph API simulada; sin número de WhatsApp Business ni credenciales)');
    return report;
  } finally {
    globalThis.fetch = realFetch;
    await admin.end().catch(() => {});
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  assert.equal(process.env.TABA_LOCAL_FISCAL_DB, '1', 'TABA_LOCAL_FISCAL_DB=1 required (base descartable, nunca produccion)');
  const url = process.argv[2];
  assert.ok(url, 'uso: npm run whatsapp:verify -- <postgres-url-de-una-base-local-descartable>');
  assert.match(new URL(url).hostname, /^(127\.0\.0\.1|localhost|\[::1\])$/, 'solo bases locales descartables');
  const { default: pg } = await import('pg');
  const connect = async () => {
    const client = new pg.Client({ connectionString: url });
    client.on('error', () => {});
    await client.connect();
    return client;
  };
  console.log(JSON.stringify(await verifyWhatsAppChannel(connect)));
}
