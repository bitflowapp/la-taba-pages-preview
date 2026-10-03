// TABA · Guardián de admisión de pedidos · CARRERAS REALES
//
// pgTAP corre en una sola transacción: no puede probar qué pasa cuando veinte
// pedidos llegan AL MISMO TIEMPO. Esto abre una conexión por pedido y confirma
// cada uno en su propia transacción, como lo hace PostgREST.
//
//   1. UN cliente manda 20 pedidos simultáneos con 20 claves distintas y el tope
//      de pedidos sin atender es 5. Esperado: entran exactamente 5 y los otros 15
//      se frenan con PT429 «customer_pending». Rotar `client_request_id` no
//      alcanza: el conteo se hace bajo un lock por cliente.
//   2. El MISMO pedido (misma clave) llega 20 veces a la vez. Esperado: un solo
//      pedido, las 20 respuestas con el mismo id y una sola admisión contada.
//   3. 30 clientes distintos detrás de UN mismo origen de red mandan un pedido
//      cada uno a la vez y el tope por origen es 12. Esperado: entran exactamente
//      12. Rotar de identidad tampoco alcanza.
//
// En los tres casos el stock descontado coincide con los pedidos que existen: un
// pedido frenado no toca una unidad.
//
// La usan scripts/run-release-v5-db.mjs (CI, contenedor sin red) y la corrida
// local contra una base descartable:
//   TABA_LOCAL_INTAKE_DB=1 node scripts/order-intake/intake-race.mjs postgres://postgres@127.0.0.1:55432/taba
import assert from 'node:assert/strict';
import path from 'node:path';
import process from 'node:process';

const BUSINESS = 'b7200000-0000-4000-8000-0000000000a1';
const PRODUCT = 'c7200000-0000-4000-8000-0000000000a1';
const OWNER = 'a7200000-0000-4000-8000-0000000000ff';
const STOCK = 100000;
const customer = (index) => `a7200000-0000-4000-8000-${String(index).padStart(12, '0')}`;

export async function runOrderIntakeRace(connect, { log = console.log } = {}) {
  const admin = await connect();
  try {
    await admin.query(`insert into auth.users(id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
      values ($1,'authenticated','authenticated','intake-race-owner@example.invalid','',now(),'{}','{}',now(),now())`, [OWNER]);
    for (let index = 1; index <= 40; index += 1) {
      await admin.query(`insert into auth.users(id,aud,role,encrypted_password,raw_app_meta_data,raw_user_meta_data,is_anonymous,created_at,updated_at)
        values ($1,'authenticated','authenticated','','{}','{}',true,now(),now())`, [customer(index)]);
    }
    await admin.query(`insert into public.businesses(id,name,slug,status,is_active,ordering_enabled,ordering_verified,
        ordering_verified_at,ordering_verified_by,currency_code,pickup_enabled,delivery_enabled,delivery_fee,minimum_delivery_subtotal,
        max_pending_orders_per_customer,order_rate_limit_per_10_minutes,order_ip_rate_limit_per_10_minutes,
        max_pending_orders_per_ip,order_business_rate_limit_per_10_minutes)
      values ($1,'TABA CARRERA DE ADMISION','taba-carrera-admision','open',true,true,true,now(),$2,'ARS',true,false,0,0,
        5,1000,12,1000,1000)`, [BUSINESS, OWNER]);
    await admin.query(`insert into public.products(id,business_id,name,category,subcategory,price,price_status,is_active,brand,
        variant,presentation,capacity_value,capacity_unit,capacity,packaging_type,stock,available,merchant_available,is_alcoholic,
        tags,is_verified,verified_at,verified_by,external_id,sku,catalog_origin,units_per_pack)
      values ($1,$2,'Lata Carrera','Gaseosas','Cola',1000,'confirmed',true,'Marca','Lata','Lata',473,'ml','473 ml','lata',
        $3,true,true,false,'{}',true,now(),$4,'intake-race-sku','intake-race-sku','commercial',1)`, [PRODUCT, BUSINESS, STOCK, OWNER]);

    const order = async (customerId, key, headers = null) => {
      const client = await connect();
      try {
        await client.query('begin');
        await client.query(`select set_config('request.jwt.claims', $1, true), set_config('request.headers', $2, true)`,
          [JSON.stringify({ sub: customerId, role: 'authenticated' }), headers ? JSON.stringify(headers) : '']);
        const { rows } = await client.query('select public.create_order_with_items($1::jsonb) as result', [JSON.stringify({
          business_id: BUSINESS,
          client_request_id: key,
          tracking_token: `${key}-${'t'.repeat(40)}`.slice(0, 48),
          items: [{ product_id: PRODUCT, quantity: 1 }],
          customer_name: 'Cliente Carrera',
          customer_phone: '2996209137',
          delivery_mode: 'pickup',
          payment_method: 'cash',
        })]);
        await client.query('commit');
        return { ok: true, id: rows[0].result.id };
      } catch (error) {
        await client.query('rollback').catch(() => {});
        return { ok: false, code: error.code, detail: error.detail || error.message };
      } finally { await client.end(); }
    };
    const blockedBy = (results, detail) => results.filter((result) => !result.ok && result.code === 'PT429' && result.detail === detail).length;

    // ── 1 · un cliente, veinte claves distintas ────────────────────────────
    const rotating = await Promise.all(Array.from({ length: 20 }, (_, index) =>
      order(customer(1), `intake-race-rot-${String(index).padStart(4, '0')}`)));
    assert.equal(rotating.filter((result) => result.ok).length, 5, 'entran exactamente los 5 que permite el tope de pendientes');
    assert.equal(blockedBy(rotating, 'customer_pending'), 15, 'los otros 15 se frenan por pendientes, ninguno por otro motivo');
    log('ORDER_INTAKE_RACE: 20 pedidos simultaneos de un cliente con 20 claves, tope 5 -> entran 5: PASS');

    // ── 2 · el mismo pedido veinte veces ───────────────────────────────────
    const same = await Promise.all(Array.from({ length: 20 }, () => order(customer(2), 'intake-race-same-0001')));
    assert.ok(same.every((result) => result.ok), 'un reintento idempotente nunca se frena');
    assert.equal(new Set(same.map((result) => result.id)).size, 1, 'las 20 respuestas son el mismo pedido');
    const { rows: sameRows } = await admin.query(`select
        (select count(*)::int from public.orders where business_id = $1 and client_request_id = 'intake-race-same-0001') as orders,
        (select count(*)::int from private.order_intake_log l join public.orders o on o.id = l.order_id
          where o.business_id = $1 and o.client_request_id = 'intake-race-same-0001') as admissions`, [BUSINESS]);
    assert.deepEqual(sameRows[0], { orders: 1, admissions: 1 });
    log('ORDER_INTAKE_SAME_KEY_RACE: el mismo pedido 20 veces a la vez -> 1 pedido, 1 admision: PASS');

    // ── 3 · treinta identidades, un origen ─────────────────────────────────
    const origin = await Promise.all(Array.from({ length: 30 }, (_, index) =>
      order(customer(10 + index), `intake-race-ip-${String(index).padStart(4, '0')}`, { 'cf-connecting-ip': '203.0.113.50' })));
    assert.equal(origin.filter((result) => result.ok).length, 12, 'entran exactamente los 12 que permite el tope por origen');
    assert.equal(blockedBy(origin, 'ip_rate'), 18, 'los otros 18 se frenan por origen');
    log('ORDER_INTAKE_ORIGIN_RACE: 30 identidades desde un origen, tope 12 -> entran 12: PASS');

    // ── El stock cuenta la misma historia que los pedidos ──────────────────
    const { rows: totals } = await admin.query(`select
        (select count(*)::int from public.orders where business_id = $1) as orders,
        (select $3::int - stock from public.products where id = $2) as units_out,
        (select count(*)::int from private.order_intake_log where business_id = $1) as admissions`, [BUSINESS, PRODUCT, STOCK]);
    assert.deepEqual(totals[0], { orders: 18, units_out: 18, admissions: 18 });
    log('ORDER_INTAKE_STOCK_INTEGRITY: 18 pedidos, 18 unidades descontadas, 18 admisiones: PASS');
  } finally {
    await admin.end();
  }
}

const invoked = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(import.meta.filename);
if (invoked) {
  if (process.env.TABA_LOCAL_INTAKE_DB !== '1') {
    console.error('Refusing to run without TABA_LOCAL_INTAKE_DB=1: this suite writes fixtures into a disposable database.');
    process.exit(2);
  }
  const url = process.argv[2];
  if (!url) {
    console.error('usage: TABA_LOCAL_INTAKE_DB=1 node scripts/order-intake/intake-race.mjs <postgres url of a disposable database>');
    process.exit(2);
  }
  const target = new URL(url);
  // `?host=` (o `hostaddr`) pisa el host de la URL en el cliente de pg: con eso una URL «local» podía
  // conectar a otra máquina. No se aceptan, y el host del cliente se vuelve a mirar antes de conectar.
  assert.ok(['127.0.0.1', 'localhost'].includes(target.hostname) && !target.searchParams.has('host') && !target.searchParams.has('hostaddr'),
    'solo contra una base local descartable');
  const { default: pg } = await import('pg');
  await runOrderIntakeRace(async () => {
    const client = new pg.Client({ connectionString: url, statement_timeout: 30_000 });
    assert.ok(['127.0.0.1', 'localhost'].includes(client.host), 'solo contra una base local descartable');
    await client.connect();
    return client;
  });
}
