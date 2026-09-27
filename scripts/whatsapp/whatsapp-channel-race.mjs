// LA TABA · WHATSAPP · CARRERAS REALES SOBRE EL ESQUEMA DE LA TABA
//
// pgTAP corre en una sola transacción: no puede probar qué pasa cuando Meta reentrega el mismo
// mensaje varias veces a la vez, cuando diez teléfonos canjean el mismo código, o cuando el
// Panel, el celular, una automatización y un SI de WhatsApp piden la misma factura juntos.
// Esto abre una conexión por pedido en vuelo (como PostgREST, con un pool acotado) y confirma
// cada una al terminar.
//
//   DEDUP 2/10/100 ....... el mismo wa_message_id entregado N veces a la vez: 1 fila, 1 respuesta.
//   PAIRING .............. 10 teléfonos canjean el mismo código a la vez: 1 vínculo.
//   PAIRING_BRUTE_FORCE .. 20 secretos malos a la vez contra un código: 5 contados, código anulado.
//   CHAOS ................ Panel + Mobile + Automation + el SI reenviado 5 veces + un segundo SI:
//                          1 comprobante, 1 origen congelado, la confirmación se consume una vez.
//
// La política comercial y la clasificación son FIXTURES SINTÉTICOS de prueba. La usan
// scripts/run-release-v5-db.mjs (CI) y la corrida local:
//   TABA_LOCAL_FISCAL_DB=1 node scripts/whatsapp/whatsapp-channel-race.mjs <postgres-url-descartable>
import assert from 'node:assert/strict';
import path from 'node:path';
import process from 'node:process';

const BUSINESS = 'b0f30000-0000-4000-8000-0000000000a1';
const OWNER = 'a0f30000-0000-4000-8000-0000000000a1';
const STAFF = 'a0f30000-0000-4000-8000-0000000000a2';
const STAFF2 = 'a0f30000-0000-4000-8000-0000000000a3';
const SESSION = { [OWNER]: 'c0f30000-0000-4000-8000-0000000000a1', [STAFF]: 'c0f30000-0000-4000-8000-0000000000a2', [STAFF2]: 'c0f30000-0000-4000-8000-0000000000a3' };
const PRODUCT = 'e0f30000-0000-4000-8000-0000000000a1';
const ORDER = 'd0f30000-0000-4000-8000-0000000000a1';
const ORDER_CODE = 'WAR-1';
const PHONE = '5492995551001';
const NUMBER_ID = '109876543210';

async function seed(admin) {
  await admin.query(`insert into auth.users(id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
    select u,'authenticated','authenticated','wa-race-' || right(u::text, 4) || '@example.invalid','',now(),'{}','{}',now(),now()
      from unnest($1::uuid[]) u`, [[OWNER, STAFF, STAFF2]]);
  await admin.query(`insert into public.businesses(id,name,status,slug,is_active,operating_timezone)
    values ($1,'TABA CARRERA WHATSAPP','open','taba-carrera-whatsapp',true,'America/Argentina/Buenos_Aires')`, [BUSINESS]);
  await admin.query(`insert into public.business_members(business_id,user_id,role,is_active) values ($1,$2,'owner',true),($1,$3,'staff',true),($1,$4,'staff',true)`,
    [BUSINESS, OWNER, STAFF, STAFF2]);
  for (const user of [OWNER, STAFF, STAFF2]) {
    await admin.query(`insert into public.identity_sessions(session_id,user_id,business_id,role_at_login,client) values ($1,$2,$3,$4,'panel_web')`,
      [SESSION[user], user, BUSINESS, user === OWNER ? 'owner' : 'staff']);
  }
  await admin.query(`insert into public.products(id,business_id,name,description,category,price,image_url,is_active,brand,subcategory,presentation,capacity,packaging_type,stock,available,is_alcoholic,tags,is_verified,verified_at,verified_by,external_id,variant,capacity_value,capacity_unit,catalog_origin,units_per_pack)
    values ($1,$2,'Producto carrera WhatsApp','Fixture','Aguas',1250,'https://example.invalid/p.webp',true,'Marca','Pruebas','Unidad','1 u','unidad',100,false,false,'{}',false,null,null,'wa-race-fixture','Unidad',1,'unidad','commercial',1)`,
  [PRODUCT, BUSINESS]);
  await admin.query(`insert into public.fiscal_profiles(business_id,legal_name,cuit,tax_condition,business_address,environment,point_of_sale,default_currency,default_concept,
      invoice_policy,is_enabled,default_recipient_condition,accountant_review_status,certificate_fingerprint_sha256,certificate_expires_at,homologation_authorized_at,homologation_authorized_by)
    values ($1,'TABA CARRERA WHATSAPP SRL','20444444445','Responsable Inscripto','Direccion fixture','homologation',9,'PES',1,'manual',true,'Consumidor Final','approved',repeat('c',64),now()+interval '90 days',now(),$2)`,
  [BUSINESS, OWNER]);
  await admin.query(`insert into public.fiscal_parameter_snapshots(environment,parameter_type,version,values_json,synchronized_at) values
      ('homologation','document_types','wa-race-v1','[{"Id":6},{"Id":8}]'::jsonb,now()),
      ('homologation','recipient_document_types','wa-race-v1','[{"Id":99}]'::jsonb,now()),
      ('homologation','recipient_vat_conditions','wa-race-v1','[{"Id":5}]'::jsonb,now()),
      ('homologation','vat_types','wa-race-v1','{"IvaTipo":[{"Id":"5","Desc":"21%"}]}'::jsonb,now())
    on conflict (environment,parameter_type,version) do nothing`);
  await admin.query(`insert into public.fiscal_accounting_policies(business_id,environment,policy_version,valid_from,issuer_condition,recipient_condition,concept,invoice_type,credit_note_type,
      recipient_document_type,recipient_document_number,enabled,accountant_review_status,approved_by,approved_at,notes,recipient_vat_condition_id)
    values ($1,'homologation','wa-race-v1',current_date,'Responsable Inscripto','Consumidor Final',1,6,8,99,'0',true,'approved',$2,now(),'Fixture sintetico; no constituye politica contable.',5)`,
  [BUSINESS, OWNER]);
  await admin.query(`insert into public.commercial_fiscal_policies(business_id,policy_version,valid_from,status,billing_moment,mercadopago_rule,cash_rule,coordinate_rule,
      vat_computation,delivery_treatment,delivery_vat_code,discount_treatment,final_consumer_id_threshold,credit_note_policy,accountant_reference,approved_by,approved_at)
    values ($1,'wa-race-fixture',current_date,'approved','after_payment_confirmed','require_approved','require_confirmed','require_confirmed',
      'price_includes_vat_per_rate','invoice_as_line',5,'prorate_by_item_gross',1000000,'manual_review_only','FIXTURE DE PRUEBA - no es politica contable',$2,now())`,
  [BUSINESS, OWNER]);
  await admin.query(`insert into public.product_fiscal_classifications(business_id,product_id,classification,vat_code,source,classified_by)
    values ($1,$2,'taxed',5,'accountant',$3)`, [BUSINESS, PRODUCT, OWNER]);
  await admin.query(`insert into public.orders(id,business_id,code,public_code,status,fulfillment_type,delivery_mode,client_request_id,customer_name,customer_phone,payment_method,subtotal,discount_total,delivery_fee,total)
    values ($1,$2,$3,$3,'accepted','pickup','pickup','wa-race-0001','CLIENTE_SINTETICO','+540000000000','cash',2500,0,0,2500)`, [ORDER, BUSINESS, ORDER_CODE]);
  await admin.query(`insert into public.order_items(order_id,product_id,product_uuid,name,quantity,unit,unit_price,subtotal) values ($1,null,$2,'Producto carrera WhatsApp',2,'u',1250,2500)`,
    [ORDER, PRODUCT]);
  await admin.query(`update public.orders set manual_payment_status='confirmed', manual_payment_method='cash', manual_payment_confirmed_at=now(), manual_payment_confirmed_by=$2 where id=$1`,
    [ORDER, STAFF]);
}

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
const inbound = (id, phone, text) => ({ identity: service, sql: 'select public.whatsapp_handle_inbound($1,$2,$3,$4,$5) as r', params: [id, phone, NUMBER_ID, 'text', text] });

async function storm(connect, requests, maxConnections) {
  const results = new Array(requests.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(maxConnections, requests.length) }, async () => {
    for (;;) {
      const index = next++;
      if (index >= requests.length) return;
      const request = requests[index];
      results[index] = await callAs(connect, request.identity, request.sql, request.params);
    }
  }));
  return results;
}

async function pairingCode(connect, user) {
  const created = await callAs(connect, operator(user), 'select public.create_whatsapp_pairing($1) as r', [BUSINESS]);
  assert.ok(created.ok, `vinculación: ${JSON.stringify(created)}`);
  return created.value.code;
}

export async function runWhatsAppChannelRace(connect, { log = console.log, maxConnections = Number(process.env.FISCAL_RACE_MAX_CONNECTIONS || 50) } = {}) {
  const admin = await connect();
  const one = async (sql, params) => (await admin.query(sql, params)).rows[0];
  try {
    await admin.query('begin');
    try {
      await seed(admin);
      await admin.query('commit');
    } catch (error) {
      await admin.query('rollback').catch(() => {});
      throw error;
    }
    const report = {};

    // El teléfono del empleado, vinculado con las RPC reales.
    const linked = await callAs(connect, service, 'select public.whatsapp_handle_inbound($1,$2,$3,$4,$5) as r',
      ['wamid.race.link', PHONE, NUMBER_ID, 'text', `vincular ${await pairingCode(connect, STAFF)}`]);
    assert.equal(linked.value?.outcome, 'paired', `vincular: ${JSON.stringify(linked)}`);

    // ── DEDUP: Meta reentrega el mismo mensaje N veces a la vez ──────────────────────────
    for (const size of [2, 10, 100]) {
      const id = `wamid.race.dedup.${size}`;
      const results = await storm(connect, Array.from({ length: size }, () => inbound(id, PHONE, 'ayuda')), maxConnections);
      const failures = results.filter((result) => !result.ok);
      assert.equal(failures.length, 0, `dedup ${size}: ${JSON.stringify(failures.slice(0, 3))}`);
      assert.equal(results.filter((result) => result.value.duplicate === false).length, 1, `dedup ${size}: una sola entrega se procesa`);
      const row = await one(`select (select count(*)::int from public.whatsapp_inbound_messages where wa_message_id = $1) inbound,
                                    (select count(*)::int from public.whatsapp_outbound_messages where inbound_message_id = $1) outbound`, [id]);
      assert.deepEqual([row.inbound, row.outbound], [1, 1], `dedup ${size}: 1 fila y 1 respuesta`);
      report[`dedup_${size}`] = { deliveries: size, processed: 1, replies: 1 };
      log(`WHATSAPP_DEDUP_${size}: PASS (${size} entregas simultáneas del mismo mensaje → 1 procesado, 1 respuesta)`);
    }

    // ── PAIRING: diez teléfonos canjean el mismo código a la vez ──────────────────────────
    const code = await pairingCode(connect, STAFF2);
    const phones = Array.from({ length: 10 }, (_, index) => `54929955520${String(index).padStart(2, '0')}`);
    const redeemed = await storm(connect, phones.map((phone, index) => inbound(`wamid.race.pair.${index}`, phone, `vincular ${code}`)), maxConnections);
    assert.equal(redeemed.filter((result) => !result.ok).length, 0, `canje: ${JSON.stringify(redeemed.filter((result) => !result.ok).slice(0, 3))}`);
    assert.equal(redeemed.filter((result) => result.value.outcome === 'paired').length, 1, 'un solo teléfono se vincula');
    const pairing = await one(`select p.id, p.consumed_at is not null consumed,
        (select count(*)::int from public.whatsapp_links l where l.pairing_id = p.id) links
      from public.whatsapp_pairings p where p.selector = $1`, [code.slice(0, 4)]);
    assert.deepEqual([pairing.consumed, pairing.links], [true, 1], 'el código se consume una vez y deja un vínculo');
    report.pairing = { phones: 10, links: 1 };
    log('WHATSAPP_PAIRING_RACE: PASS (10 teléfonos con el mismo código a la vez → 1 vínculo)');

    // ── PAIRING_BRUTE_FORCE: veinte secretos malos a la vez contra un código ───────────────
    const target = await pairingCode(connect, STAFF2);
    const guesses = Array.from({ length: 20 }, (_, index) => inbound(`wamid.race.guess.${index}`, `54929955530${String(index).padStart(2, '0')}`,
      `vincular ${target.slice(0, 5)}ZZZZ-ZZZZ`));
    const guessed = await storm(connect, guesses, maxConnections);
    assert.equal(guessed.filter((result) => !result.ok || result.value.outcome === 'paired').length, 0, 'ningún secreto malo vincula');
    const attacked = await one('select attempt_count, revoked_at is not null revoked from public.whatsapp_pairings where selector = $1', [target.slice(0, 4)]);
    assert.deepEqual([attacked.attempt_count, attacked.revoked], [5, true], 'cinco intentos contados y el código anulado');
    const late = await callAs(connect, service, 'select public.whatsapp_handle_inbound($1,$2,$3,$4,$5) as r',
      ['wamid.race.guess.right', '5492995553099', NUMBER_ID, 'text', `vincular ${target}`]);
    assert.equal(late.value?.outcome, 'pairing_invalid', 'el secreto correcto ya no revive el código');
    report.pairing_brute_force = { guesses: 20, counted: 5, revoked: true };
    log('WHATSAPP_PAIRING_BRUTE_FORCE_RACE: PASS (20 secretos malos simultáneos → 5 contados, código anulado)');

    // ── CHAOS: todos los canales y Meta reentregando, sobre el mismo pedido ─────────────────
    const asked = await callAs(connect, service, 'select public.whatsapp_handle_inbound($1,$2,$3,$4,$5) as r',
      ['wamid.race.facturar', PHONE, NUMBER_ID, 'text', `facturar ${ORDER_CODE}`]);
    assert.equal(asked.value?.outcome, 'confirmation_requested', `facturar: ${JSON.stringify(asked)}`);
    const chaos = [
      ...Array.from({ length: 5 }, () => inbound('wamid.race.si', PHONE, 'si')),
      inbound('wamid.race.si.2', PHONE, 'si'),
      { identity: operator(STAFF), sql: 'select public.request_order_invoice($1,$2,$3,$4,$5) as r', params: [BUSINESS, ORDER, 'wa-race-panel-0001', 'PANEL', false] },
      { identity: operator(STAFF2), sql: 'select public.request_order_invoice($1,$2,$3,$4,$5) as r', params: [BUSINESS, ORDER, 'wa-race-mobile-0001', 'MOBILE', false] },
      { identity: service, sql: 'select public.service_request_order_invoice($1,$2,$3,$4,$5,$6) as r', params: [BUSINESS, ORDER, 'wa-race-auto-0001', 'AUTOMATION', null, false] },
    ];
    const chaotic = await storm(connect, chaos.sort(() => Math.random() - 0.5), maxConnections);
    assert.equal(chaotic.filter((result) => !result.ok).length, 0, `caos: ${JSON.stringify(chaotic.filter((result) => !result.ok).slice(0, 3))}`);
    const state = await one(`select
        (select count(*)::int from public.fiscal_documents where source_type = 'online_order' and source_id = $1) documents,
        (select count(*)::int from public.fiscal_source_snapshots where source_type = 'online_order' and source_id = $1) snapshots,
        (select count(*)::int from public.whatsapp_pending_actions where order_id = $1 and closed_reason = 'confirmed') confirmed,
        (select count(*)::int from public.whatsapp_inbound_messages where wa_message_id = 'wamid.race.si') si_rows,
        (select count(*)::int from public.whatsapp_outbound_messages where inbound_message_id = 'wamid.race.si') si_replies,
        (select count(*)::int from public.whatsapp_inbound_messages where wa_message_id in ('wamid.race.si', 'wamid.race.si.2') and outcome = 'invoice_requested') si_confirmed,
        (select array_agg(distinct e.sanitized_detail->>'command_source' order by e.sanitized_detail->>'command_source')
           from public.fiscal_events e join public.fiscal_documents d on d.id = e.fiscal_document_id where d.source_id = $1) channels`, [ORDER]);
    assert.deepEqual([state.documents, state.snapshots, state.confirmed, state.si_rows, state.si_replies, state.si_confirmed],
      [1, 1, 1, 1, 1, 1], `caos: ${JSON.stringify(state)}`);
    assert.deepEqual(state.channels, ['AUTOMATION', 'MOBILE', 'PANEL', 'WHATSAPP'], 'cada canal auditado');
    report.chaos = { requests: chaos.length, documents: 1, snapshots: 1, confirmations_consumed: 1, channels: state.channels };
    log(`WHATSAPP_REAL_DB_CHAOS: PASS (${chaos.length} pedidos: Panel, Mobile, Automation, SI reenviado ×5 y otro SI → 1 comprobante, 1 origen, 1 confirmación)`);
    return report;
  } finally {
    await admin.end().catch(() => {});
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'))) {
  assert.equal(process.env.TABA_LOCAL_FISCAL_DB, '1', 'TABA_LOCAL_FISCAL_DB=1 required (base descartable, nunca produccion)');
  const url = process.argv[2];
  assert.ok(url, 'uso: node scripts/whatsapp/whatsapp-channel-race.mjs <postgres-url-de-una-base-descartable>');
  const { default: pg } = await import('pg');
  const connect = async () => { const client = new pg.Client({ connectionString: url }); client.on('error', () => {}); await client.connect(); return client; };
  console.log(JSON.stringify(await runWhatsAppChannelRace(connect)));
}
