// TABA · CORE FISCAL ADOPTADO · CARRERAS REALES SOBRE EL ESQUEMA DE LA TABA
//
// pgTAP corre en una sola transaccion: no puede probar que pasa cuando el
// Panel, el celular, WhatsApp y una automatizacion piden la MISMA factura a la
// vez. Esto abre una conexion por solicitud en vuelo (como PostgREST, con un
// pool acotado: max 50 conexiones por defecto, dentro del limite del
// contenedor de CI) y confirma cada una al terminar.
//
//   1. 10, 50 y 100 solicitudes simultaneas (PANEL, MOBILE, WHATSAPP,
//      AUTOMATION; claves distintas y repetidas) por la misma venta POS valida.
//      Esperado: 1 intencion, 1 comprobante, 1 fila de cola; todas devuelven
//      el mismo id; cada canal queda auditado.
//   2. N workers reclaman, reservan y cierran a la vez (SQL, sin codigo del
//      worker): 1 reclamo gana, 1 numero, 1 autorizacion; los demas reciben
//      TF001 o nada. La autorizacion es SIMULADA (CAE sintetico de prueba).
//   3. Aislamiento: otro negocio y otro CUIT no convergen ni reclaman.
//
// El snapshot impositivo de estas ventas es SINTETICO y de prueba: no es
// politica contable (La Taba no define IVA por producto en esta fase).
//
// La usan scripts/run-release-v5-db.mjs (CI, contenedor sin red) y la corrida
// local contra una base descartable YA migrada con la cadena real de La Taba:
//   TABA_LOCAL_FISCAL_DB=1 node scripts/fiscal-core/intent-race.mjs postgres://postgres@127.0.0.1:55461/taba
import assert from 'node:assert/strict';
import path from 'node:path';
import process from 'node:process';

const BUSINESS = 'b0f10000-0000-4000-8000-0000000000a1';
const OTHER_BUSINESS = 'b0f10000-0000-4000-8000-0000000000b2';
const OWNER = 'a0f10000-0000-4000-8000-0000000000a1';
const STAFF = 'a0f10000-0000-4000-8000-0000000000a2';
const STAFF2 = 'a0f10000-0000-4000-8000-0000000000a3';
const OTHER_OWNER = 'a0f10000-0000-4000-8000-0000000000b1';
const SESSION = { [OWNER]: 'c0f10000-0000-4000-8000-0000000000a1', [STAFF]: 'c0f10000-0000-4000-8000-0000000000a2', [STAFF2]: 'c0f10000-0000-4000-8000-0000000000a3', [OTHER_OWNER]: 'c0f10000-0000-4000-8000-0000000000b1' };
const CUIT = '20444444442';
const PRODUCT = 'e0f10000-0000-4000-8000-0000000000a1';
const SYNTHETIC_TAX = { net_amount: '2066.12', tax_amount: '433.88', tax_code: '5', exempt_amount: '0.00', non_taxed_amount: '0.00', other_taxes_amount: '0.00', fixture: 'SINTETICO_NO_ES_POLITICA_CONTABLE' };
const saleId = (n) => `d0f10000-0000-4000-8000-${String(n).padStart(12, '0')}`;

async function seed(admin) {
  await admin.query(`insert into auth.users(id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
    select u, 'authenticated','authenticated', 'fiscal-race-' || right(u::text, 4) || '@example.invalid','',now(),'{}','{}',now(),now()
      from unnest($1::uuid[]) u`, [[OWNER, STAFF, STAFF2, OTHER_OWNER]]);
  await admin.query(`insert into public.businesses(id,name,status,slug,is_active,operating_timezone) values
    ($1,'TABA CARRERA FISCAL','open','taba-carrera-fiscal',true,'America/Argentina/Buenos_Aires'),
    ($2,'TABA CARRERA FISCAL OTRO','open','taba-carrera-fiscal-otro',true,'America/Argentina/Buenos_Aires')`, [BUSINESS, OTHER_BUSINESS]);
  await admin.query(`insert into public.business_members(business_id,user_id,role,is_active) values
    ($1,$2,'owner',true),($1,$3,'staff',true),($1,$4,'staff',true),($5,$6,'owner',true)`, [BUSINESS, OWNER, STAFF, STAFF2, OTHER_BUSINESS, OTHER_OWNER]);
  for (const [user, business] of [[OWNER, BUSINESS], [STAFF, BUSINESS], [STAFF2, BUSINESS], [OTHER_OWNER, OTHER_BUSINESS]]) {
    const role = user === OWNER || user === OTHER_OWNER ? 'owner' : 'staff';
    await admin.query(`insert into public.identity_sessions(session_id,user_id,business_id,role_at_login,client) values ($1,$2,$3,$4,'panel_web')`, [SESSION[user], user, business, role]);
  }
  await admin.query(`insert into public.products(id,business_id,name,description,category,price,image_url,is_active,brand,subcategory,presentation,capacity,packaging_type,stock,available,is_alcoholic,tags,is_verified,verified_at,verified_by,external_id,variant,capacity_value,capacity_unit,catalog_origin,units_per_pack)
    values($1,$2,'Producto carrera','Fixture','Aguas',1250,'https://example.invalid/p.webp',true,'Marca','Pruebas','Unidad','1 u','unidad',100,false,false,'{}',false,null,null,'fiscal-race-fixture','Unidad',1,'unidad','test_only',1)`, [PRODUCT, BUSINESS]);
  await admin.query(`insert into public.fiscal_profiles(business_id,legal_name,cuit,tax_condition,business_address,environment,point_of_sale,default_currency,default_concept,
      invoice_policy,is_enabled,default_recipient_condition,accountant_review_status,certificate_fingerprint_sha256,certificate_expires_at,homologation_authorized_at,homologation_authorized_by)
    values($1,'TABA CARRERA FISCAL SRL',$2,'Responsable Inscripto','Direccion fixture','homologation',7,'PES',1,'manual',true,'Consumidor Final','approved',repeat('f',64),now()+interval '90 days',now(),$3)`, [BUSINESS, CUIT, OWNER]);
  await admin.query(`insert into public.fiscal_parameter_snapshots(environment,parameter_type,version,values_json,synchronized_at) values
      ('homologation','document_types','fiscal-race-v1','[{"Id":6},{"Id":8}]'::jsonb,now()),
      ('homologation','recipient_document_types','fiscal-race-v1','[{"Id":99}]'::jsonb,now()),
      ('homologation','recipient_vat_conditions','fiscal-race-v1','[{"Id":5}]'::jsonb,now())
    on conflict (environment,parameter_type,version) do nothing`);
  await admin.query(`insert into public.fiscal_accounting_policies(business_id,environment,policy_version,valid_from,issuer_condition,recipient_condition,concept,invoice_type,credit_note_type,
      recipient_document_type,recipient_document_number,enabled,accountant_review_status,approved_by,approved_at,notes,recipient_vat_condition_id)
    values($1,'homologation','fiscal-race-v1',current_date,'Responsable Inscripto','Consumidor Final',1,6,8,99,'0',true,'approved',$2,now(),'Fixture sintetico; no constituye politica contable.',5)`, [BUSINESS, OWNER]);
  for (const n of [10, 50, 100, 7]) {
    await admin.query(`insert into public.pos_sales(id,business_id,operator_id,state,subtotal,total,currency,idempotency_key,completed_at)
      values ($1,$2,$3,'completed',2500,2500,'PES',$4,now())`, [saleId(n), BUSINESS, STAFF, `fiscal-race-sale-${n}`]);
    await admin.query(`insert into public.pos_sale_items(sale_id,product_id,product_name,quantity,unit_price,line_total,tax_snapshot)
      values ($1,$2,'Producto carrera',2,1250,2500,$3)`, [saleId(n), PRODUCT, SYNTHETIC_TAX]);
  }
}

// Una solicitud = una conexion propia, su transaccion, su rol y sus claims (como PostgREST).
async function callAs(connect, identity, sql, params) {
  const client = await connect();
  try {
    await client.query('begin');
    await client.query(`set local role ${identity.role}`);
    await client.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify(identity.claims)]);
    const value = Object.values((await client.query(sql, params)).rows[0] || {})[0];
    await client.query('commit');
    return { ok: true, value };
  } catch (error) {
    await client.query('rollback').catch(() => {});
    return { ok: false, code: error.code, message: error.message };
  } finally {
    await client.end().catch(() => {});
  }
}

const operator = (user) => ({ role: 'authenticated', claims: { sub: user, role: 'authenticated', session_id: SESSION[user] } });
const service = { role: 'service_role', claims: { role: 'service_role' } };

function requestFor(index, sale) {
  const channel = ['PANEL', 'MOBILE', 'WHATSAPP', 'AUTOMATION'][index % 4];
  // Claves: algunas repetidas (doble clic, reintento de red), la mayoria distintas (otra pestania, otro canal).
  const key = index % 5 === 0 ? `race:${sale.slice(-4)}:shared` : `race:${sale.slice(-4)}:${channel.toLowerCase()}:${index}`;
  if (channel === 'PANEL') return { channel, identity: operator(index % 2 ? OWNER : STAFF), sql: 'select public.request_fiscal_document($1,$2,$3,$4,$5,$6) as r', params: [BUSINESS, 'pos_sale', sale, 'invoice', key, 'PANEL'] };
  if (channel === 'MOBILE') return { channel, identity: operator(STAFF2), sql: 'select public.request_fiscal_document($1,$2,$3,$4,$5,$6) as r', params: [BUSINESS, 'pos_sale', sale, 'invoice', key, 'MOBILE'] };
  if (channel === 'WHATSAPP') return { channel, identity: service, sql: 'select public.service_request_fiscal_document($1,$2,$3,$4,$5,$6,$7) as r', params: [BUSINESS, 'pos_sale', sale, 'invoice', key, 'WHATSAPP', STAFF] };
  return { channel, identity: service, sql: 'select public.service_request_fiscal_document($1,$2,$3,$4,$5,$6,$7) as r', params: [BUSINESS, 'pos_sale', sale, 'invoice', key, 'AUTOMATION', null] };
}

// Dispara todo a la vez con un pool acotado: cada "hilo" toma la siguiente solicitud apenas termina la anterior.
async function storm(connect, requests, maxConnections) {
  const results = new Array(requests.length);
  let next = 0;
  const lanes = Array.from({ length: Math.min(maxConnections, requests.length) }, async () => {
    for (;;) {
      const index = next++;
      if (index >= requests.length) return;
      const request = requests[index];
      results[index] = { channel: request.channel, ...(await callAs(connect, request.identity, request.sql, request.params)) };
    }
  });
  await Promise.all(lanes);
  return results;
}

export async function runFiscalIntentRace(connect, { log = console.log, maxConnections = Number(process.env.FISCAL_RACE_MAX_CONNECTIONS || 50) } = {}) {
  const admin = await connect();
  try {
    await seed(admin);
    const report = {};
    for (const size of [10, 50, 100]) {
      const sale = saleId(size);
      const results = await storm(connect, Array.from({ length: size }, (_, index) => requestFor(index, sale)), maxConnections);
      const failures = results.filter((r) => !r.ok);
      assert.equal(failures.length, 0, `${size} solicitudes: ${JSON.stringify(failures.slice(0, 3))}`);
      const ids = new Set(results.map((r) => r.value.fiscal_document_id));
      assert.equal(ids.size, 1, `${size} solicitudes devolvieron ${ids.size} comprobantes distintos`);
      assert.equal(results.filter((r) => r.value.idempotent_replay === false).length, 1, 'exactamente una solicitud crea la intencion');
      const [row] = (await admin.query(`select
          (select count(*)::int from public.fiscal_documents where source_type = 'pos_sale' and source_id = $1) documents,
          (select count(*)::int from public.fiscal_outbox o join public.fiscal_documents d on d.id = o.fiscal_document_id where d.source_id = $1) outbox,
          (select count(*)::int from public.fiscal_idempotency_keys k join public.fiscal_documents d on d.id = k.fiscal_document_id where d.source_id = $1) keys,
          (select array_agg(distinct e.sanitized_detail->>'command_source' order by e.sanitized_detail->>'command_source')
             from public.fiscal_events e join public.fiscal_documents d on d.id = e.fiscal_document_id where d.source_id = $1) channels`, [sale])).rows;
      assert.deepEqual([row.documents, row.outbox], [1, 1], `${size}: comprobantes/cola`);
      const distinctKeys = new Set(Array.from({ length: size }, (_, index) => requestFor(index, sale).params[4])).size;
      assert.equal(row.keys, distinctKeys, `${size}: cada clave distinta queda ligada una vez al mismo comprobante`);
      assert.deepEqual(row.channels, ['AUTOMATION', 'MOBILE', 'PANEL', 'WHATSAPP'], `${size}: CommandSource auditado por canal`);
      report[size] = { requests: size, documents: row.documents, outbox: row.outbox, keys: row.keys, channels: row.channels.length };
      log(`FISCAL_INTENT_RACE_${size}: PASS (1 intencion, 1 comprobante, ${row.keys} claves ligadas, 4 canales auditados)`);
    }

    // ── 2 · workers simultaneos sobre el mismo comprobante (fencing en la base) ──
    const doc = (await admin.query('select id from public.fiscal_documents where source_id = $1', [saleId(100)])).rows[0].id;
    const workers = 12;
    const claims = await storm(connect, Array.from({ length: workers }, (_, w) => ({
      channel: 'WORKER', identity: service, params: [],
      sql: `select coalesce(jsonb_agg(to_jsonb(c)), '[]'::jsonb) from public.claim_fiscal_outbox('race-worker-${w}','homologation','${CUIT}',5,120) c`,
    })), workers);
    const leases = claims.flatMap((c, w) => (c.ok ? c.value.map((row) => ({ ...row, worker: `race-worker-${w}` })) : []));
    assert.equal(leases.filter((l) => l.fiscal_document_id === doc).length, 1, `${workers} workers: un solo reclamo gana`);
    const lease = leases.find((l) => l.fiscal_document_id === doc);
    const issueDate = (await admin.query(`select (now() at time zone 'America/Argentina/Buenos_Aires')::date::text d`)).rows[0].d;
    const reserves = await storm(connect, Array.from({ length: workers }, (_, w) => ({
      channel: 'WORKER', identity: service,
      sql: 'select (public.reserve_fiscal_document_number($1,$2,$3,1,$4::date)).document_number',
      params: [doc, w === 0 ? lease.worker : `race-worker-${w}`, w === 0 ? lease.lease_epoch : 0, issueDate],
    })), workers);
    assert.equal(reserves.filter((r) => r.ok).length, 1, 'un solo worker reserva numero');
    assert.ok(reserves.filter((r) => !r.ok).every((r) => r.code === 'TF001'), 'el resto: TF001 (lease ajeno o epoch viejo)');
    const completes = await storm(connect, Array.from({ length: workers }, (_, w) => ({
      channel: 'WORKER', identity: service,
      sql: `select public.complete_fiscal_attempt((select id from public.fiscal_outbox where fiscal_document_id = $1), $2, $3, $4::jsonb)`,
      params: [doc, w === 0 ? lease.worker : `race-worker-${w}`, w === 0 ? lease.lease_epoch : lease.lease_epoch + 1,
        JSON.stringify({ classification: 'authorized', cae: '74000000000100', document_number: 1, cae_expiration: issueDate, simulated: 'CAE_SINTETICO_DE_PRUEBA' })],
    })), workers);
    assert.equal(completes.filter((r) => r.ok).length, 1, 'un solo resultado se acepta');
    const [final] = (await admin.query(`select state, document_number, cae,
        (select count(*)::int from public.fiscal_request_attempts where fiscal_document_id = $1) attempts,
        (select count(*)::int from public.fiscal_documents where cuit = $2 and document_number is not null) numbers
      from public.fiscal_documents where id = $1`, [doc, CUIT])).rows;
    assert.deepEqual([final.state, Number(final.document_number), final.attempts, final.numbers], ['authorized', 1, 1, 1],
      'workers simultaneos: 1 numero, 1 autorizacion, 1 intento registrado');
    log(`FISCAL_WORKER_FENCING_RACE_${workers}: PASS (1 reclamo, 1 numero, 1 autorizacion simulada)`);

    // ── 3 · aislamiento: otro negocio, otro CUIT ─────────────────────────────
    const foreign = await storm(connect, [
      { channel: 'PANEL', identity: operator(OTHER_OWNER), sql: 'select public.request_fiscal_document($1,$2,$3,$4,$5,$6) as r', params: [BUSINESS, 'pos_sale', saleId(7), 'invoice', 'race:foreign:panel:0001', 'PANEL'] },
      { channel: 'WHATSAPP', identity: service, sql: 'select public.service_request_fiscal_document($1,$2,$3,$4,$5,$6,$7) as r', params: [BUSINESS, 'pos_sale', saleId(7), 'invoice', 'race:foreign:wa:0001', 'WHATSAPP', OTHER_OWNER] },
      { channel: 'WORKER', identity: service, sql: `select count(*)::int from public.claim_fiscal_outbox('race-foreign-worker','homologation','20555555553',50,120)`, params: [] },
    ], 3);
    assert.deepEqual(foreign.slice(0, 2).map((r) => r.code), ['42501', '42501'], 'otro negocio no pide la factura de esta venta, ni por el Panel ni como actor de WhatsApp');
    assert.ok(foreign[2].ok, 'un worker de otro CUIT reclama sin error');
    const [isolated] = (await admin.query(`select (select count(*)::int from public.fiscal_documents where source_id = $1) docs`, [saleId(7)])).rows;
    assert.equal(isolated.docs, 0, 'ningun comprobante nacio de un pedido ajeno');
    log('FISCAL_TENANT_ISOLATION_RACE: PASS');
    return report;
  } finally {
    await admin.end().catch(() => {});
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'))) {
  assert.equal(process.env.TABA_LOCAL_FISCAL_DB, '1', 'TABA_LOCAL_FISCAL_DB=1 required (base descartable, nunca produccion)');
  const url = process.argv[2];
  assert.ok(url, 'uso: node scripts/fiscal-core/intent-race.mjs <postgres-url-de-una-base-descartable>');
  const { default: pg } = await import('pg');
  const connect = async () => { const client = new pg.Client({ connectionString: url }); client.on('error', () => {}); await client.connect(); return client; };
  await runFiscalIntentRace(connect);
}
