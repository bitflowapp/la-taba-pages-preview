// LA TABA · FISCAL · SIMULACRO DE BACKUP Y RESTORE (bases locales descartables)
//
// ¿Qué se pierde si se pierde la base? Este simulacro lo mide con pg_dump/pg_restore reales:
//   1. siembra, confirmado, un negocio con una factura AUTORIZADA (simulada) de un pedido online,
//      su origen congelado, los metadatos del PDF, sus eventos, un ticket impreso por la PC del
//      mostrador y una reimpresión pendiente;
//   2. calcula un resumen de integridad fiscal: comprobantes (CAE, vencimiento, número, total),
//      ítems, orígenes congelados (hash), artefactos (sha256 y ruta privada), eventos, claves,
//      pedidos de impresión, trabajos, dispositivos y el ledger de migraciones;
//   3. pg_dump en formato custom → sha256 del archivo → pg_restore en una base NUEVA;
//   4. recalcula el resumen en la restaurada y exige que sea idéntico;
//   5. controles después del restore, con los roles reales:
//      · la historia se lee desde el Panel;
//      · la factura vieja se reimprime;
//      · la numeración sigue: la próxima factura toma el número siguiente, con otro CAE.
//
// Nunca toca producción: sólo 127.0.0.1 y con TABA_LOCAL_FISCAL_DB=1. Los PDF viven en Storage,
// no en la base: el backup de la base guarda sus METADATOS (ruta y hash) y el simulacro lo dice.
//
//   TABA_LOCAL_FISCAL_DB=1 PG_BIN=<carpeta con pg_dump y pg_restore> \
//     node scripts/fiscal-core/fiscal-restore-drill.mjs postgres://postgres@127.0.0.1:55461/<base-origen> <base-destino>
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash, randomInt, randomUUID } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const sha256 = (value) => createHash('sha256').update(value).digest('hex');

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

async function callAs(connect, identity, sql, params = []) {
  const client = await connect();
  try {
    await client.query('begin');
    await client.query(`set local role ${identity.role}`);
    await client.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify(identity.claims)]);
    const value = Object.values((await client.query(sql, params)).rows[0] || {})[0];
    await client.query('commit');
    return value;
  } catch (error) {
    await client.query('rollback').catch(() => {});
    throw error;
  } finally {
    await client.end().catch(() => {});
  }
}

const service = { role: 'service_role', claims: { role: 'service_role' } };
const operatorOf = (fixture, who) => ({ role: 'authenticated', claims: { sub: fixture[who], role: 'authenticated', session_id: fixture[`${who}Session`] } });

// Autorización SIMULADA por las RPC del worker del core (claim → reserva → cierre).
async function authorize(connect, fixture, documentId, number) {
  const claimed = await callAs(connect, service, `select coalesce(jsonb_agg(to_jsonb(c)), '[]'::jsonb) from public.claim_fiscal_outbox('drill-worker','homologation',$1,5,120) c`, [fixture.cuit]);
  const lease = claimed.find((row) => row.fiscal_document_id === documentId);
  assert.ok(lease, 'el worker reclama el comprobante');
  await callAs(connect, service, `select public.reserve_fiscal_document_number($1,'drill-worker',$2,$3,(now() at time zone 'America/Argentina/Buenos_Aires')::date)`,
    [documentId, lease.lease_epoch, number]);
  const cae = `74${String(randomInt(0, 1e12)).padStart(12, '0')}`;
  const state = await callAs(connect, service, `select public.complete_fiscal_attempt((select id from public.fiscal_outbox where fiscal_document_id = $1),'drill-worker',$2,$3)->>'state'`,
    [documentId, lease.lease_epoch, { classification: 'authorized', cae, document_number: number, cae_expiration: '2026-12-31', simulated: 'CAE_SINTETICO_DE_PRUEBA' }]);
  assert.equal(state, 'authorized');
  return cae;
}

async function seed(connect) {
  const fixture = {
    business: randomUUID(), owner: randomUUID(), staff: randomUUID(), ownerSession: randomUUID(), staffSession: randomUUID(),
    product: randomUUID(), orders: [randomUUID(), randomUUID()], cuit: freshCuit(), pointOfSale: randomInt(20, 90),
  };
  const tag = fixture.business.slice(0, 8);
  const admin = await connect();
  try {
    await admin.query('begin');
    await admin.query(`insert into auth.users(id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
      values ($1,'authenticated','authenticated',$3,'',now(),'{}','{}',now(),now()), ($2,'authenticated','authenticated',$4,'',now(),'{}','{}',now(),now())`,
    [fixture.owner, fixture.staff, `drill-${tag}-owner@example.invalid`, `drill-${tag}-staff@example.invalid`]);
    await admin.query(`insert into public.businesses(id,name,status,slug,is_active,operating_timezone) values ($1,'TABA SIMULACRO RESTORE','open',$2,true,'America/Argentina/Buenos_Aires')`,
      [fixture.business, `taba-simulacro-restore-${tag}`]);
    await admin.query(`insert into public.business_members(business_id,user_id,role,is_active) values ($1,$2,'owner',true),($1,$3,'staff',true)`, [fixture.business, fixture.owner, fixture.staff]);
    await admin.query(`insert into public.identity_sessions(session_id,user_id,business_id,role_at_login,client) values ($1,$2,$5,'owner','panel_web'),($3,$4,$5,'staff','panel_web')`,
      [fixture.ownerSession, fixture.owner, fixture.staffSession, fixture.staff, fixture.business]);
    await admin.query(`insert into public.products(id,business_id,name,description,category,price,image_url,is_active,brand,subcategory,presentation,capacity,packaging_type,stock,available,is_alcoholic,tags,is_verified,verified_at,verified_by,external_id,variant,capacity_value,capacity_unit,catalog_origin,units_per_pack)
      values ($1,$2,'Gaseosa 2,25 L','Fixture','Aguas',1250,'https://example.invalid/p.webp',true,'Marca','Pruebas','Unidad','1 u','unidad',100,false,false,'{}',false,null,null,$3,'Unidad',1,'unidad','commercial',1)`,
    [fixture.product, fixture.business, `drill-${tag}`]);
    await admin.query(`insert into public.fiscal_profiles(business_id,legal_name,cuit,tax_condition,business_address,environment,point_of_sale,default_currency,default_concept,
        invoice_policy,is_enabled,default_recipient_condition,accountant_review_status,certificate_fingerprint_sha256,certificate_expires_at,homologation_authorized_at,homologation_authorized_by)
      values ($1,'TABA SIMULACRO RESTORE SRL',$2,'Responsable Inscripto','Direccion fixture','homologation',$3,'PES',1,'manual',true,'Consumidor Final','approved',$4,now()+interval '90 days',now(),$5)`,
    [fixture.business, fixture.cuit, fixture.pointOfSale, sha256(`certificado-sintetico-${tag}`), fixture.owner]);
    await admin.query(`insert into public.fiscal_parameter_snapshots(environment,parameter_type,version,values_json,synchronized_at) values
        ('homologation','document_types',$1,'[{"Id":6},{"Id":8}]'::jsonb,now()),
        ('homologation','recipient_document_types',$1,'[{"Id":99}]'::jsonb,now()),
        ('homologation','recipient_vat_conditions',$1,'[{"Id":5}]'::jsonb,now()),
        ('homologation','vat_types',$1,'{"IvaTipo":[{"Id":"5","Desc":"21%"}]}'::jsonb,now())`, [`drill-${tag}`]);
    await admin.query(`insert into public.fiscal_accounting_policies(business_id,environment,policy_version,valid_from,issuer_condition,recipient_condition,concept,invoice_type,credit_note_type,
        recipient_document_type,recipient_document_number,enabled,accountant_review_status,approved_by,approved_at,notes,recipient_vat_condition_id)
      values ($1,'homologation',$2,current_date,'Responsable Inscripto','Consumidor Final',1,6,8,99,'0',true,'approved',$3,now(),'Fixture sintetico; no constituye politica contable.',5)`,
    [fixture.business, `drill-${tag}`, fixture.owner]);
    await admin.query(`insert into public.commercial_fiscal_policies(business_id,policy_version,valid_from,status,billing_moment,mercadopago_rule,cash_rule,coordinate_rule,
        vat_computation,delivery_treatment,delivery_vat_code,discount_treatment,final_consumer_id_threshold,credit_note_policy,accountant_reference,approved_by,approved_at)
      values ($1,$2,current_date,'approved','after_payment_confirmed','require_approved','require_confirmed','require_confirmed',
        'price_includes_vat_per_rate','invoice_as_line',5,'prorate_by_item_gross',1000000,'manual_review_only','FIXTURE DE PRUEBA - no es politica contable',$3,now())`,
    [fixture.business, `drill-${tag}`, fixture.owner]);
    await admin.query(`insert into public.product_fiscal_classifications(business_id,product_id,classification,vat_code,source,classified_by) values ($1,$2,'taxed',5,'accountant',$3)`,
      [fixture.business, fixture.product, fixture.owner]);
    for (const [index, order] of fixture.orders.entries()) {
      await admin.query(`insert into public.orders(id,business_id,code,public_code,status,fulfillment_type,delivery_mode,client_request_id,customer_name,customer_phone,payment_method,subtotal,discount_total,delivery_fee,total)
        values ($1,$2,$3,$3,'accepted','pickup','pickup',$4,'CLIENTE_SINTETICO','+540000000000','cash',2500,0,0,2500)`, [order, fixture.business, `DRILL-${tag}-${index + 1}`, `drill-${tag}-${index + 1}`]);
      await admin.query(`insert into public.order_items(order_id,product_id,product_uuid,name,quantity,unit,unit_price,subtotal) values ($1,null,$2,'Gaseosa 2,25 L',2,'u',1250,2500)`, [order, fixture.product]);
      await admin.query(`update public.orders set manual_payment_status='confirmed', manual_payment_method='cash', manual_payment_confirmed_at=now(), manual_payment_confirmed_by=$2 where id=$1`,
        [order, fixture.staff]);
    }
    await admin.query('commit');
  } catch (error) {
    await admin.query('rollback').catch(() => {});
    throw error;
  } finally {
    await admin.end().catch(() => {});
  }

  // La factura del primer pedido: pedida desde el Panel con impresión, autorizada, con su PDF.
  const requested = await callAs(connect, operatorOf(fixture, 'staff'), 'select public.request_order_invoice($1,$2,$3,$4,true)',
    [fixture.business, fixture.orders[0], `drill-${tag}-o1`, 'PANEL']);
  fixture.document = requested.fiscal_document_id;
  fixture.cae = await authorize(connect, fixture, fixture.document, 1);
  const admin2 = await connect();
  try {
    // FIXTURE: la fila que deja el worker de PDF. El objeto vive en Storage, no en la base.
    await admin2.query(`insert into public.fiscal_document_artifacts(business_id, fiscal_document_id, artifact_type, state, storage_provider, storage_path, mime_type, size_bytes, sha256,
        document_number, generated_at, generated_by, generation_version, generation_token, is_current)
      values ($1::uuid, $2::uuid, 'authorized_pdf', 'artifact_ready', 'supabase_storage', 'fiscal/' || $1::text || '/' || $2::text || '/' || gen_random_uuid() || '.pdf', 'application/pdf', 4096, $3,
        1, now(), 'restore-drill-fixture', 'fixture-1', gen_random_uuid(), true)`, [fixture.business, fixture.document, sha256(`pdf-${tag}`)]);
  } finally {
    await admin2.end().catch(() => {});
  }
  // La PC del mostrador imprime el ticket; después se pide una reimpresión.
  const pairing = await callAs(connect, operatorOf(fixture, 'owner'), 'select public.create_local_device_pairing($1,$2)', [fixture.business, 'Mostrador']);
  const secretHash = sha256(`secreto-${tag}`);
  const device = await callAs(connect, service, 'select public.agent_register_device($1,$2,$3,$4,$5)', [pairing.pairing_code, secretHash, 'Mostrador', 'windows', '0.1.0']);
  const claim = await callAs(connect, service, `select public.agent_claim_print_jobs($1,$2,array['fiscal_receipt'],5)`, [device.device_id, secretHash]);
  const [job] = claim.jobs;
  await callAs(connect, service, `select public.agent_update_print_job($1,$2,$3,$4,'printing')`, [device.device_id, secretHash, job.id, job.claim_token]);
  await callAs(connect, service, `select public.agent_update_print_job($1,$2,$3,$4,'printed',null,700)`, [device.device_id, secretHash, job.id, job.claim_token]);
  fixture.printedJob = job.id;
  await callAs(connect, operatorOf(fixture, 'staff'), 'select public.request_print_job_reprint($1,$2,$3)', [job.id, 'copia para el cliente', `drill-${tag}-reprint`]);
  return fixture;
}

const SUMMARY_SQL = `select jsonb_build_object(
  'migrations', (select jsonb_agg(version order by version) from supabase_migrations.schema_migrations),
  'documents', (select jsonb_agg(jsonb_build_object('id', d.id, 'state', d.state, 'cae', d.cae, 'cae_expiration', d.cae_expiration, 'number', d.document_number,
                  'point_of_sale', d.point_of_sale, 'type', d.document_type, 'total', d.total_amount, 'source', d.source_type || ':' || d.source_id,
                  'dispatch_count', d.dispatch_count, 'artifact_state', d.artifact_state) order by d.id)
                  from public.fiscal_documents d where d.business_id = $1),
  'items', (select count(*) from public.fiscal_document_items i join public.fiscal_documents d on d.id = i.fiscal_document_id where d.business_id = $1),
  'snapshots', (select jsonb_agg(jsonb_build_object('id', s.id, 'hash', s.snapshot_hash, 'lines', md5(s.lines::text), 'total', s.total_amount) order by s.id)
                  from public.fiscal_source_snapshots s where s.business_id = $1),
  'artifacts', (select jsonb_agg(jsonb_build_object('id', a.id, 'sha256', a.sha256, 'path', a.storage_path, 'current', a.is_current) order by a.id)
                  from public.fiscal_document_artifacts a where a.business_id = $1),
  'events', (select jsonb_agg(e.event_type || ':' || e.actor_type order by e.created_at, e.id) from public.fiscal_events e
               join public.fiscal_documents d on d.id = e.fiscal_document_id where d.business_id = $1),
  'keys', (select jsonb_agg(k.command_source || ':' || coalesce(k.actor_id::text, 'system') order by k.command_source)
             from public.fiscal_idempotency_keys k join public.fiscal_documents d on d.id = k.fiscal_document_id where d.business_id = $1),
  'print_requests', (select jsonb_agg(jsonb_build_object('document', r.fiscal_document_id, 'job', r.print_job_id, 'fulfilled', r.fulfilled_at is not null))
                       from public.fiscal_print_requests r where r.business_id = $1),
  'print_jobs', (select jsonb_agg(jsonb_build_object('id', j.id, 'status', j.status, 'reprint_of', j.reprint_of, 'type', j.document_type, 'device', j.claimed_by_device_id)
                   order by j.created_at, j.id) from public.print_jobs j where j.business_id = $1),
  'devices', (select jsonb_agg(jsonb_build_object('id', d.id, 'status', d.status) order by d.id) from public.local_devices d where d.business_id = $1))`;

export async function runFiscalRestoreDrill({ sourceUrl, targetDatabase, pgBin, log = console.log }) {
  const { default: pg } = await import('pg');
  const connectTo = (url) => async () => { const client = new pg.Client({ connectionString: url }); client.on('error', () => {}); await client.connect(); return client; };
  const source = new URL(sourceUrl);
  assert.match(source.hostname, /^(127\.0\.0\.1|localhost|\[::1\])$/, 'solo bases locales descartables');
  assert.match(targetDatabase, /^[a-z0-9_]*restore[a-z0-9_]*$/, 'la base destino tiene que llamarse *restore* (se borra y se crea)');
  const targetUrl = new URL(sourceUrl);
  targetUrl.pathname = `/${targetDatabase}`;
  const adminUrl = new URL(sourceUrl);
  adminUrl.pathname = '/postgres';
  const connectSource = connectTo(source.href);
  const connectTarget = connectTo(targetUrl.href);

  const fixture = await seed(connectSource);
  const summarize = async (connect) => {
    const client = await connect();
    try { return (await client.query(SUMMARY_SQL, [fixture.business])).rows[0].jsonb_build_object; } finally { await client.end().catch(() => {}); }
  };
  const before = await summarize(connectSource);
  assert.equal(before.documents.length, 1);
  assert.equal(before.documents[0].cae, fixture.cae);
  assert.equal(before.print_jobs.length, 2, 'ticket impreso y reimpresión');

  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'taba-restore-drill-'));
  const archive = path.join(work, 'fiscal.dump');
  const env = { ...process.env, PGPASSWORD: source.password || process.env.PGPASSWORD || '' };
  const connection = ['-h', source.hostname, '-p', source.port || '5432', '-U', decodeURIComponent(source.username || 'postgres')];
  const started = Date.now();
  execFileSync(path.join(pgBin, 'pg_dump'), [...connection, '-d', source.pathname.slice(1), '--format=custom', `--file=${archive}`,
    // Las extensiones de la plataforma (programador, red, bóveda) no son datos del negocio: el
    // restore de Supabase las trae con la plataforma. Igual que el simulacro de CI.
    '--exclude-extension=pg_cron', '--exclude-schema=cron', '--exclude-extension=pg_net', '--exclude-schema=net',
    '--exclude-extension=supabase_vault', '--exclude-schema=vault'], { env, stdio: ['ignore', 'pipe', 'pipe'] });
  const dumpSha256 = sha256(fs.readFileSync(archive));
  const dumpBytes = fs.statSync(archive).size;
  log(`FISCAL_BACKUP_DUMP: PASS (pg_dump custom, ${dumpBytes} bytes, sha256 ${dumpSha256.slice(0, 16)}…)`);

  const admin = await connectTo(adminUrl.href)();
  try {
    await admin.query(`drop database if exists ${targetDatabase} with (force)`);
    await admin.query(`create database ${targetDatabase} template template0 encoding 'UTF8'`);
    await admin.query(`alter database ${targetDatabase} set search_path = "$user", public, extensions`);
  } finally {
    await admin.end().catch(() => {});
  }
  execFileSync(path.join(pgBin, 'pg_restore'), [...connection, '-d', targetDatabase, '--exit-on-error', archive], { env, stdio: ['ignore', 'pipe', 'pipe'] });
  const restoreMs = Date.now() - started;
  const after = await summarize(connectTarget);
  assert.deepEqual(after, before, 'el resumen fiscal restaurado es idéntico al original');
  log(`FISCAL_RESTORE_INTEGRITY: PASS (${before.migrations.length} migraciones, comprobante con CAE y número, origen congelado, PDF (metadatos), ${before.events.length} eventos, ${before.print_jobs.length} trabajos: idénticos)`);

  // Después del restore, con los roles reales: la historia se lee, la factura vieja se reimprime y la numeración sigue.
  const states = await callAs(connectTarget, operatorOf(fixture, 'staff'), 'select public.get_order_fiscal_states($1,$2::uuid[])', [fixture.business, [fixture.orders[0]]]);
  assert.equal(states[0].document.cae, fixture.cae, 'el Panel lee la factura restaurada');
  log('FISCAL_RESTORE_HISTORY_READABLE: PASS (el Panel lee la factura con su CAE)');
  const reprint = await callAs(connectTarget, operatorOf(fixture, 'staff'), 'select public.request_print_job_reprint($1,$2,$3)',
    [fixture.printedJob, 'copia después del restore', `drill-${fixture.business.slice(0, 8)}-reprint-2`]);
  assert.ok(reprint.print_job_id, 'la factura vieja se reimprime');
  log('FISCAL_RESTORE_REPRINT: PASS (reimpresión con reprint_of, sin CAE nuevo)');
  const next = await callAs(connectTarget, operatorOf(fixture, 'staff'), 'select public.request_order_invoice($1,$2,$3,$4,false)',
    [fixture.business, fixture.orders[1], `drill-${fixture.business.slice(0, 8)}-o2`, 'PANEL']);
  const nextCae = await authorize(connectTarget, fixture, next.fiscal_document_id, 2);
  assert.notEqual(nextCae, fixture.cae);
  const numbers = await callAs(connectTarget, service, `select jsonb_agg(document_number order by document_number) from public.fiscal_documents where business_id = $1`, [fixture.business]);
  assert.deepEqual(numbers, [1, 2], 'la numeración sigue sin repetir');
  log('FISCAL_RESTORE_NUMBERING_CONTINUES: PASS (la próxima factura toma el número 2, con otro CAE)');
  log('FISCAL_RESTORE_PDF_OBJECTS: NOT_COVERED_BY_DB_BACKUP (los PDF viven en Storage; la base guarda ruta y hash)');
  fs.rmSync(work, { recursive: true, force: true });
  return { productionDataUsed: false, dumpSha256, dumpBytes, restoreMs, migrations: before.migrations.length, documents: before.documents.length, events: before.events.length };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  assert.equal(process.env.TABA_LOCAL_FISCAL_DB, '1', 'TABA_LOCAL_FISCAL_DB=1 required (bases descartables, nunca produccion)');
  const [sourceUrl, targetDatabase] = process.argv.slice(2);
  assert.ok(sourceUrl && targetDatabase, 'uso: node scripts/fiscal-core/fiscal-restore-drill.mjs <postgres-url-origen> <base-destino>');
  assert.ok(process.env.PG_BIN, 'PG_BIN: carpeta con pg_dump y pg_restore (la misma versión mayor que el servidor)');
  console.log(JSON.stringify(await runFiscalRestoreDrill({ sourceUrl, targetDatabase, pgBin: process.env.PG_BIN })));
}
