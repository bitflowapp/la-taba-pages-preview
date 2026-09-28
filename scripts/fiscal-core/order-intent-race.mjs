// LA TABA · PEDIDOS ONLINE · CARRERAS REALES SOBRE EL ESQUEMA DE LA TABA
//
// pgTAP corre en una sola transaccion: no puede probar que pasa cuando el Panel, el
// celular, WhatsApp y una automatizacion piden la factura del MISMO pedido a la vez.
// Esto abre una conexion por solicitud en vuelo (como PostgREST, con un pool acotado)
// y confirma cada una al terminar.
//
//   10, 50 y 100 solicitudes simultaneas por la misma orden (request_order_invoice y
//   service_request_order_invoice; claves distintas y repetidas; algunas piden imprimir).
//   Esperado: 1 comprobante, 1 origen congelado, 1 fila de cola, 1 pedido de impresion,
//   ninguna venta POS; cada canal auditado.
//
// La politica comercial y la clasificacion son FIXTURES SINTETICOS de prueba (no son la
// politica contable de nadie). La usan scripts/run-release-v5-db.mjs (CI) y la corrida local:
//   TABA_LOCAL_FISCAL_DB=1 node scripts/fiscal-core/order-intent-race.mjs <postgres-url-descartable>
import assert from 'node:assert/strict';
import path from 'node:path';
import process from 'node:process';

const BUSINESS = 'b0f20000-0000-4000-8000-0000000000a1';
const OWNER = 'a0f20000-0000-4000-8000-0000000000a1';
const STAFF = 'a0f20000-0000-4000-8000-0000000000a2';
const STAFF2 = 'a0f20000-0000-4000-8000-0000000000a3';
const SESSION = { [OWNER]: 'c0f20000-0000-4000-8000-0000000000a1', [STAFF]: 'c0f20000-0000-4000-8000-0000000000a2', [STAFF2]: 'c0f20000-0000-4000-8000-0000000000a3' };
const PRODUCT = 'e0f20000-0000-4000-8000-0000000000a1';
const orderId = (n) => `d0f20000-0000-4000-8000-${String(n).padStart(12, '0')}`;

async function seed(admin) {
  await admin.query(`insert into auth.users(id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
    select u,'authenticated','authenticated','order-race-' || right(u::text, 4) || '@example.invalid','',now(),'{}','{}',now(),now()
      from unnest($1::uuid[]) u`, [[OWNER, STAFF, STAFF2]]);
  await admin.query(`insert into public.businesses(id,name,status,slug,is_active,operating_timezone)
    values ($1,'TABA CARRERA PEDIDOS','open','taba-carrera-pedidos',true,'America/Argentina/Buenos_Aires')`, [BUSINESS]);
  await admin.query(`insert into public.business_members(business_id,user_id,role,is_active) values ($1,$2,'owner',true),($1,$3,'staff',true),($1,$4,'staff',true)`,
    [BUSINESS, OWNER, STAFF, STAFF2]);
  for (const user of [OWNER, STAFF, STAFF2]) {
    await admin.query(`insert into public.identity_sessions(session_id,user_id,business_id,role_at_login,client) values ($1,$2,$3,$4,'panel_web')`,
      [SESSION[user], user, BUSINESS, user === OWNER ? 'owner' : 'staff']);
  }
  await admin.query(`insert into public.products(id,business_id,name,description,category,price,image_url,is_active,brand,subcategory,presentation,capacity,packaging_type,stock,available,is_alcoholic,tags,is_verified,verified_at,verified_by,external_id,variant,capacity_value,capacity_unit,catalog_origin,units_per_pack)
    values ($1,$2,'Producto carrera pedidos','Fixture','Aguas',1250,'https://example.invalid/p.webp',true,'Marca','Pruebas','Unidad','1 u','unidad',100,false,false,'{}',false,null,null,'order-race-fixture','Unidad',1,'unidad','commercial',1)`,
  [PRODUCT, BUSINESS]);
  await admin.query(`insert into public.fiscal_profiles(business_id,legal_name,cuit,tax_condition,business_address,environment,point_of_sale,default_currency,default_concept,
      invoice_policy,is_enabled,default_recipient_condition,accountant_review_status,certificate_fingerprint_sha256,certificate_expires_at,homologation_authorized_at,homologation_authorized_by)
    values ($1,'TABA CARRERA PEDIDOS SRL','20555555553','Responsable Inscripto','Direccion fixture','homologation',8,'PES',1,'manual',true,'Consumidor Final','approved',repeat('e',64),now()+interval '90 days',now(),$2)`,
  [BUSINESS, OWNER]);
  await admin.query(`insert into public.fiscal_parameter_snapshots(environment,parameter_type,version,values_json,synchronized_at) values
      ('homologation','document_types','order-race-v1','[{"Id":6},{"Id":8}]'::jsonb,now()),
      ('homologation','recipient_document_types','order-race-v1','[{"Id":99}]'::jsonb,now()),
      ('homologation','recipient_vat_conditions','order-race-v1','[{"Id":5}]'::jsonb,now()),
      ('homologation','vat_types','order-race-v1','{"IvaTipo":[{"Id":"5","Desc":"21%"}]}'::jsonb,now())
    on conflict (environment,parameter_type,version) do nothing`);
  await admin.query(`insert into public.fiscal_accounting_policies(business_id,environment,policy_version,valid_from,issuer_condition,recipient_condition,concept,invoice_type,credit_note_type,
      recipient_document_type,recipient_document_number,enabled,accountant_review_status,approved_by,approved_at,notes,recipient_vat_condition_id)
    values ($1,'homologation','order-race-v1',current_date,'Responsable Inscripto','Consumidor Final',1,6,8,99,'0',true,'approved',$2,now(),'Fixture sintetico; no constituye politica contable.',5)`,
  [BUSINESS, OWNER]);
  await admin.query(`insert into public.commercial_fiscal_policies(business_id,policy_version,valid_from,status,billing_moment,mercadopago_rule,cash_rule,coordinate_rule,
      vat_computation,delivery_treatment,delivery_vat_code,discount_treatment,final_consumer_id_threshold,credit_note_policy,accountant_reference,approved_by,approved_at)
    values ($1,'order-race-fixture',current_date,'approved','after_payment_confirmed','require_approved','require_confirmed','require_confirmed',
      'price_includes_vat_per_rate','invoice_as_line',5,'prorate_by_item_gross',1000000,'manual_review_only','FIXTURE DE PRUEBA - no es politica contable',$2,now())`,
  [BUSINESS, OWNER]);
  await admin.query(`insert into public.product_fiscal_classifications(business_id,product_id,classification,vat_code,source,classified_by)
    values ($1,$2,'taxed',5,'accountant',$3)`, [BUSINESS, PRODUCT, OWNER]);
  for (const n of [10, 50, 100]) {
    // Un delivery exige un punto de entrega confirmado por el cliente (DELIVERY_LOCATION_REQUIRED).
    await admin.query(`insert into public.orders(id,business_id,code,public_code,status,fulfillment_type,delivery_mode,client_request_id,customer_name,customer_phone,payment_method,subtotal,discount_total,delivery_fee,total,
        delivery_location_source,delivery_latitude,delivery_longitude,delivery_location_confirmed_at)
      values ($1,$2,$3,$3,'accepted','delivery','delivery',$4,'CLIENTE_SINTETICO','+540000000000','cash',2500,0,605,3105,'gps',-38.95,-68.06,now())`,
    [orderId(n), BUSINESS, `RACE-${n}`, `order-race-${String(n).padStart(4, '0')}`]);
    await admin.query(`insert into public.order_items(order_id,product_id,product_uuid,name,quantity,unit,unit_price,subtotal) values ($1,null,$2,'Producto carrera pedidos',2,'u',1250,2500)`,
      [orderId(n), PRODUCT]);
    await admin.query(`update public.orders set manual_payment_status='confirmed', manual_payment_method='cash', manual_payment_confirmed_at=now(), manual_payment_confirmed_by=$2 where id=$1`,
      [orderId(n), STAFF]);
  }
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

function requestFor(index, order) {
  const channel = ['PANEL', 'MOBILE', 'WHATSAPP', 'AUTOMATION'][index % 4];
  const key = index % 5 === 0 ? `order-race:${order.slice(-4)}:shared` : `order-race:${order.slice(-4)}:${channel.toLowerCase()}:${index}`;
  const print = index % 7 === 0;
  if (channel === 'PANEL') return { identity: operator(index % 2 ? OWNER : STAFF), sql: 'select public.request_order_invoice($1,$2,$3,$4,$5) as r', params: [BUSINESS, order, key, 'PANEL', print] };
  if (channel === 'MOBILE') return { identity: operator(STAFF2), sql: 'select public.request_order_invoice($1,$2,$3,$4,$5) as r', params: [BUSINESS, order, key, 'MOBILE', print] };
  if (channel === 'WHATSAPP') return { identity: service, sql: 'select public.service_request_order_invoice($1,$2,$3,$4,$5,$6) as r', params: [BUSINESS, order, key, 'WHATSAPP', STAFF, print] };
  return { identity: service, sql: 'select public.service_request_order_invoice($1,$2,$3,$4,$5,$6) as r', params: [BUSINESS, order, key, 'AUTOMATION', null, print] };
}

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

export async function runOrderIntentRace(connect, { log = console.log, maxConnections = Number(process.env.FISCAL_RACE_MAX_CONNECTIONS || 50) } = {}) {
  const admin = await connect();
  try {
    await admin.query('begin');
    try {
      await seed(admin);
      await admin.query('commit');
    } catch (error) {
      await admin.query('rollback').catch(() => {});
      throw error;
    }
    const posBefore = Number((await admin.query('select count(*) from public.pos_sales')).rows[0].count);
    const report = {};
    for (const size of [10, 50, 100]) {
      const order = orderId(size);
      const requests = Array.from({ length: size }, (_, index) => requestFor(index, order));
      const results = await storm(connect, requests, maxConnections);
      const failures = results.filter((r) => !r.ok);
      assert.equal(failures.length, 0, `${size} solicitudes: ${JSON.stringify(failures.slice(0, 3))}`);
      const ids = new Set(results.map((r) => r.value.fiscal_document_id));
      assert.equal(ids.size, 1, `${size} solicitudes devolvieron ${ids.size} comprobantes`);
      assert.equal(results.filter((r) => r.value.idempotent_replay === false).length, 1, 'una sola solicitud crea la intencion');
      const [row] = (await admin.query(`select
          (select count(*)::int from public.fiscal_documents where source_type = 'online_order' and source_id = $1) documents,
          (select count(*)::int from public.fiscal_source_snapshots where source_type = 'online_order' and source_id = $1) snapshots,
          (select count(*)::int from public.fiscal_outbox o join public.fiscal_documents d on d.id = o.fiscal_document_id where d.source_id = $1) outbox,
          (select count(*)::int from public.fiscal_print_requests r join public.fiscal_documents d on d.id = r.fiscal_document_id where d.source_id = $1) print_requests,
          (select count(*)::int from public.fiscal_idempotency_keys k join public.fiscal_documents d on d.id = k.fiscal_document_id where d.source_id = $1) keys,
          (select array_agg(distinct e.sanitized_detail->>'command_source' order by e.sanitized_detail->>'command_source')
             from public.fiscal_events e join public.fiscal_documents d on d.id = e.fiscal_document_id where d.source_id = $1) channels`, [order])).rows;
      const distinctKeys = new Set(requests.map((request) => request.params[2])).size;
      assert.deepEqual([row.documents, row.snapshots, row.outbox, row.print_requests, row.keys],
        [1, 1, 1, 1, distinctKeys], `${size}: comprobante, origen congelado, cola, pedido de impresion y claves`);
      assert.deepEqual(row.channels, ['AUTOMATION', 'MOBILE', 'PANEL', 'WHATSAPP'], `${size}: CommandSource auditado por canal`);
      report[size] = { requests: size, documents: 1, snapshots: 1, print_requests: 1, keys: row.keys };
      log(`FISCAL_ORDER_INTENT_RACE_${size}: PASS (1 comprobante, 1 origen congelado, 1 pedido de impresion, ${row.keys} claves, 4 canales)`);
    }
    const posAfter = Number((await admin.query('select count(*) from public.pos_sales')).rows[0].count);
    assert.equal(posAfter, posBefore, 'ninguna venta POS sintetica');
    log('FISCAL_ORDER_NO_SYNTHETIC_POS_SALE: PASS');
    return report;
  } finally {
    await admin.end().catch(() => {});
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'))) {
  assert.equal(process.env.TABA_LOCAL_FISCAL_DB, '1', 'TABA_LOCAL_FISCAL_DB=1 required (base descartable, nunca produccion)');
  const url = process.argv[2];
  assert.ok(url, 'uso: node scripts/fiscal-core/order-intent-race.mjs <postgres-url-de-una-base-descartable>');
  const { default: pg } = await import('pg');
  const connect = async () => { const client = new pg.Client({ connectionString: url }); client.on('error', () => {}); await client.connect(); return client; };
  await runOrderIntentRace(connect);
}
