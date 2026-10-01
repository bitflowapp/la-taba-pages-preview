// TABA · Alta de pedidos · INYECCIÓN DE FALLAS
//
// Qué pasa con un pedido cuando algo se rompe EN EL MEDIO. Cada ensayo provoca una
// falla real contra una base descartable y después mide lo mismo: que no quede un
// pedido a medias, que el stock cuente la misma historia que los pedidos, y que el
// reintento del cliente —con la MISMA clave— termine en exactamente un pedido.
//
//   1. timeout de sentencia        la base corta el alta a mitad de camino
//   2. timeout de lock             otro proceso tiene tomada la fila del producto
//   3. backend muerto              el proceso de base muere con la transacción abierta
//   4. respuesta perdida           el pedido se confirmó y el cliente nunca se enteró
//   5. pedido duplicado            el mismo envío llega varias veces a la vez
//   6. caída del servidor          (opcional) la base se cae en plena ráfaga y vuelve
//   7. notificación repetida       el mismo aviso de pago llega veinte veces
//
// No es un Supabase: es PostgreSQL con las migraciones aplicadas. Lo que prueba es
// la atomicidad y la idempotencia del backend, que viven en la base.
//
//   TABA_LOCAL_INTAKE_DB=1 node scripts/order-intake/failure-injection-drill.mjs postgres://postgres@127.0.0.1:55432/taba \
//     [--pg-ctl <ruta a pg_ctl> --data <directorio de datos> [--pg-options "<opciones de arranque>"]] [--out reporte.json]
//
// El ensayo 6 sólo corre si se pasan --pg-ctl y --data: reinicia el servidor entero,
// así que la base tiene que ser de un cluster propio y descartable.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import process from 'node:process';

const BUSINESS = 'b7300000-0000-4000-8000-0000000000a1';
const PRODUCT = 'c7300000-0000-4000-8000-0000000000a1';
const OWNER = 'a7300000-0000-4000-8000-0000000000ff';
const STOCK = 100000;
const customer = (index) => `a7300000-0000-4000-8000-${String(index).padStart(12, '0')}`;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const args = process.argv.slice(2);
const option = (name) => { const index = args.indexOf(name); return index < 0 ? '' : args[index + 1] || ''; };

if (process.env.TABA_LOCAL_INTAKE_DB !== '1') {
  console.error('Refusing to run without TABA_LOCAL_INTAKE_DB=1: this drill breaks things on purpose in a disposable database.');
  process.exit(2);
}
const url = args[0];
if (!url || !['127.0.0.1', 'localhost'].includes(new URL(url).hostname)) {
  console.error('usage: TABA_LOCAL_INTAKE_DB=1 node scripts/order-intake/failure-injection-drill.mjs <postgres url on localhost> [--pg-ctl <path> --data <dir>] [--out file.json]');
  process.exit(2);
}
const { default: pg } = await import('pg');
const connect = async (extra = {}) => {
  const client = new pg.Client({ connectionString: url, ...extra });
  client.on('error', () => {});   // un backend que matamos a propósito no puede tumbar el proceso
  await client.connect();
  return client;
};

const results = [];
const record = (drill, name, pass, observed) => {
  results.push({ drill, name, result: pass ? 'PASS' : 'FAIL', observed });
  console.log(`${pass ? 'PASS' : 'FAIL'} [${drill}] ${name}${pass ? '' : ` -> ${JSON.stringify(observed)}`}`);
};

const payload = (key, quantity = 1) => JSON.stringify({
  business_id: BUSINESS,
  client_request_id: key,
  tracking_token: `${key}-${'t'.repeat(40)}`.slice(0, 48),
  items: [{ product_id: PRODUCT, quantity }],
  customer_name: 'Cliente Falla',
  customer_phone: '2996209137',
  delivery_mode: 'pickup',
  payment_method: 'cash',
});
const claims = (customerId) => JSON.stringify({ sub: customerId, role: 'authenticated' });

// Un alta como la hace PostgREST: una transacción por pedido.
async function order(customerId, key, { before = null, quantity = 1 } = {}) {
  let client;
  try {
    client = await connect();
  } catch (error) {
    // Servidor caído: el cliente ni siquiera llegó a hablar con la base.
    return { ok: false, code: error.code || 'CONNECTION', message: error.message };
  }
  try {
    await client.query('begin');
    await client.query(`select set_config('request.jwt.claims', $1, true)`, [claims(customerId)]);
    if (before) await client.query(before);
    const { rows } = await client.query('select public.create_order_with_items($1::jsonb) as result', [payload(key, quantity)]);
    await client.query('commit');
    return { ok: true, id: rows[0].result.id };
  } catch (error) {
    await client.query('rollback').catch(() => {});
    return { ok: false, code: error.code, message: error.message };
  } finally { await client.end().catch(() => {}); }
}

// La foto que tiene que cerrar después de cada falla.
async function truth(admin) {
  const { rows } = await admin.query(`select
      (select count(*)::int from public.orders where business_id = $1) as orders,
      (select coalesce(sum(oi.quantity), 0)::int from public.order_items oi join public.orders o on o.id = oi.order_id where o.business_id = $1) as units_in_orders,
      (select $3::int - stock from public.products where id = $2) as units_out,
      (select count(*)::int from public.orders o where o.business_id = $1 and not exists (select 1 from public.order_items oi where oi.order_id = o.id)) as orders_without_items,
      (select count(*)::int from public.orders o where o.business_id = $1 and not exists (select 1 from public.order_public_tokens t where t.order_id = o.id)) as orders_without_token,
      (select count(*)::int from public.orders o where o.business_id = $1 and not exists (select 1 from public.order_events e where e.order_id = o.id)) as orders_without_event,
      (select count(*)::int from private.order_intake_log where business_id = $1) as admissions,
      (select stock from public.products where id = $2) as stock`, [BUSINESS, PRODUCT, STOCK]);
  return rows[0];
}
const coherent = (t) => t.units_in_orders === t.units_out && t.orders_without_items === 0 && t.orders_without_token === 0
  && t.orders_without_event === 0 && t.admissions === t.orders && t.stock >= 0;

async function fixture(admin) {
  await admin.query(`insert into auth.users(id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
    values ($1,'authenticated','authenticated','failure-drill-owner@example.invalid','',now(),'{}','{}',now(),now())`, [OWNER]);
  for (let index = 1; index <= 80; index += 1) {
    await admin.query(`insert into auth.users(id,aud,role,encrypted_password,raw_app_meta_data,raw_user_meta_data,is_anonymous,created_at,updated_at)
      values ($1,'authenticated','authenticated','','{}','{}',true,now(),now())`, [customer(index)]);
  }
  await admin.query(`insert into public.businesses(id,name,slug,status,is_active,ordering_enabled,ordering_verified,
      ordering_verified_at,ordering_verified_by,currency_code,pickup_enabled,delivery_enabled,delivery_fee,minimum_delivery_subtotal,
      max_pending_orders_per_customer,order_rate_limit_per_10_minutes,order_ip_rate_limit_per_10_minutes,
      max_pending_orders_per_ip,order_business_rate_limit_per_10_minutes)
    values ($1,'TABA ENSAYO DE FALLAS','taba-ensayo-de-fallas','open',true,true,true,now(),$2,'ARS',true,false,0,0,
      1000,1000,1000,1000,5000)`, [BUSINESS, OWNER]);
  await admin.query(`insert into public.products(id,business_id,name,category,subcategory,price,price_status,is_active,brand,
      variant,presentation,capacity_value,capacity_unit,capacity,packaging_type,stock,available,merchant_available,is_alcoholic,
      tags,is_verified,verified_at,verified_by,external_id,sku,catalog_origin,units_per_pack)
    values ($1,$2,'Lata Falla','Gaseosas','Cola',1000,'confirmed',true,'Marca','Lata','Lata',473,'ml','473 ml','lata',
      $3,true,true,false,'{}',true,now(),$4,'failure-drill-sku','failure-drill-sku','commercial',1)`, [PRODUCT, BUSINESS, STOCK, OWNER]);
}

let admin = await connect();
await fixture(admin);

// ── 1 · timeout de sentencia ────────────────────────────────────────────────
{
  const failed = await order(customer(1), 'failure-timeout-0001', { before: `set local statement_timeout = '1ms'; select pg_sleep(0.01)` });
  const after = await truth(admin);
  record('statement_timeout', 'la base corta el alta: el cliente recibe un error', !failed.ok && failed.code === '57014', failed);
  record('statement_timeout', 'no queda nada a medias', after.orders === 0 && coherent(after), after);
  const retry = await order(customer(1), 'failure-timeout-0001');
  const final = await truth(admin);
  record('statement_timeout', 'el reintento con la misma clave crea un solo pedido', retry.ok && final.orders === 1 && coherent(final), { retry, final });
}

// ── 2 · timeout de lock ─────────────────────────────────────────────────────
{
  const holder = await connect();
  await holder.query('begin');
  await holder.query('select 1 from public.products where id = $1 for update', [PRODUCT]);
  const before = await truth(admin);
  const blocked = await order(customer(2), 'failure-lock-0001', { before: `set local lock_timeout = '300ms'` });
  const during = await truth(admin);
  record('lock_timeout', 'con la fila del producto tomada el alta se rinde con un error de lock', !blocked.ok && blocked.code === '55P03', blocked);
  record('lock_timeout', 'y no deja nada escrito', during.orders === before.orders && coherent(during), during);
  await holder.query('rollback');
  await holder.end();
  const retry = await order(customer(2), 'failure-lock-0001');
  const final = await truth(admin);
  record('lock_timeout', 'liberado el lock, el reintento entra una vez', retry.ok && final.orders === before.orders + 1 && coherent(final), { retry, final });
}

// ── 3 · backend muerto con la transacción abierta ───────────────────────────
{
  const before = await truth(admin);
  const victim = await connect();
  await victim.query('begin');
  await victim.query(`select set_config('request.jwt.claims', $1, true)`, [claims(customer(3))]);
  const { rows: pidRows } = await victim.query('select pg_backend_pid() as pid');
  const { rows: created } = await victim.query('select public.create_order_with_items($1::jsonb) as result', [payload('failure-kill-0001')]);
  // El pedido existe dentro de esa transacción y todavía no se confirmó.
  await admin.query('select pg_terminate_backend($1)', [pidRows[0].pid]);
  await sleep(300);
  await victim.end().catch(() => {});
  const after = await truth(admin);
  record('backend_killed', 'el alta habia devuelto un pedido dentro de la transaccion', Boolean(created[0].result.id), created[0].result.id);
  record('backend_killed', 'muerto el backend antes del commit, el pedido no existe y el stock no se movio',
    after.orders === before.orders && after.stock === before.stock && coherent(after), after);
  const retry = await order(customer(3), 'failure-kill-0001');
  const final = await truth(admin);
  record('backend_killed', 'el reintento crea el pedido una sola vez', retry.ok && final.orders === before.orders + 1 && coherent(final), { retry, final });
}

// ── 4 · respuesta perdida ───────────────────────────────────────────────────
{
  const before = await truth(admin);
  const first = await order(customer(4), 'failure-lost-0001');   // confirmado; el cliente «no recibió» la respuesta
  const retries = await Promise.all([1, 2, 3].map(() => order(customer(4), 'failure-lost-0001')));
  const final = await truth(admin);
  record('lost_response', 'los reintentos devuelven el MISMO pedido', first.ok && retries.every((r) => r.ok && r.id === first.id), { first, retries });
  record('lost_response', 'un solo pedido, una sola unidad descontada, una sola admision',
    final.orders === before.orders + 1 && final.units_out === before.units_out + 1 && coherent(final), final);
  // La misma clave con OTRO contenido no se confunde con un reintento.
  const tampered = await order(customer(4), 'failure-lost-0001', { quantity: 2 });
  record('lost_response', 'la misma clave con otro contenido se rechaza', !tampered.ok && tampered.code === '23505', tampered);
}

// ── 5 · pedido duplicado ────────────────────────────────────────────────────
{
  const before = await truth(admin);
  const burst = await Promise.all(Array.from({ length: 25 }, () => order(customer(5), 'failure-dup-0001')));
  const final = await truth(admin);
  record('duplicate_request', '25 envios simultaneos del mismo pedido: todos responden el mismo id',
    burst.every((r) => r.ok) && new Set(burst.map((r) => r.id)).size === 1, { distinct: new Set(burst.map((r) => r.id)).size });
  record('duplicate_request', 'y existe un solo pedido', final.orders === before.orders + 1 && coherent(final), final);
}

// ── 6 · caída del servidor en plena ráfaga (opcional) ───────────────────────
const pgCtl = option('--pg-ctl');
const dataDir = option('--data');
if (pgCtl && dataDir) {
  const before = await truth(admin);
  const keys = Array.from({ length: 60 }, (_, index) => `failure-crash-${String(index).padStart(4, '0')}`);
  // Las altas salen escalonadas para que el corte las encuentre en todos los estados:
  // unas ya confirmadas, otras con la transacción abierta, otras sin haber llegado.
  const wave = Promise.all(keys.map(async (key, index) => {
    await sleep(index * 15);
    return order(customer(10 + index), key);
  }));
  for (let waited = 0; waited < 5000; waited += 20) {
    const { rows } = await admin.query('select count(*)::int as n from public.orders where business_id = $1', [BUSINESS]);
    if (rows[0].n - before.orders >= 12) break;
    await sleep(20);
  }
  // Caída sin aviso: los backends mueren con lo que tuvieran abierto.
  execFileSync(pgCtl, ['-D', dataDir, '-m', 'immediate', 'stop'], { stdio: 'ignore' });
  const outcomes = await wave;
  await admin.end().catch(() => {});
  // El cluster del ensayo guarda su puerto en su propia configuración: vuelve a levantar igual que estaba.
  const pgOptions = option('--pg-options');
  execFileSync(pgCtl, ['-D', dataDir, '-w', 'start', '-l', `${dataDir}/../drill.log`, ...(pgOptions ? ['-o', pgOptions] : [])], { stdio: 'ignore' });
  for (let attempt = 0; attempt < 40; attempt += 1) {
    try { admin = await connect(); break; } catch { await sleep(500); }
  }
  const afterCrash = await truth(admin);
  const committed = outcomes.filter((r) => r.ok).length;
  record('server_crash', 'la base volvio y lo que quedo es coherente: ningun pedido a medias', coherent(afterCrash), afterCrash);
  record('server_crash', 'el corte llego con pedidos ya confirmados y otros en vuelo',
    afterCrash.orders - before.orders > 0 && afterCrash.orders - before.orders < keys.length,
    { orders_after_crash: afterCrash.orders - before.orders, of: keys.length });
  record('server_crash', 'ningun pedido que el cliente vio confirmado se perdio', afterCrash.orders - before.orders >= committed,
    { confirmed_to_clients: committed, orders_after_crash: afterCrash.orders - before.orders });
  // El cliente reintenta TODO con las mismas claves, haya visto éxito o error.
  const retried = await Promise.all(keys.map((key, index) => order(customer(10 + index), key)));
  const final = await truth(admin);
  record('server_crash', 'reintentando todo con las mismas claves quedan exactamente 60 pedidos',
    retried.every((r) => r.ok) && final.orders === before.orders + 60 && coherent(final), { retried_ok: retried.filter((r) => r.ok).length, final });
} else {
  results.push({ drill: 'server_crash', name: 'caida del servidor en plena rafaga', result: 'NOT_RUN', observed: 'sin --pg-ctl/--data' });
  console.log('NOT_RUN [server_crash] pasar --pg-ctl y --data para ensayar la caida del servidor');
}

// ── 7 · notificación de pago repetida ───────────────────────────────────────
{
  const eventId = `failure-webhook-${Date.now()}`;
  const send = async () => {
    const client = await connect();
    try {
      const { rows } = await client.query(
        `select public.record_mercadopago_webhook_receipt('test', $1, 'payment', '900000001', true, $2, repeat('a', 64)) as receipt`,
        [eventId, `req-${eventId}`]);
      return { ok: true, receipt: rows[0].receipt };
    } catch (error) { return { ok: false, code: error.code, message: error.message }; } finally { await client.end().catch(() => {}); }
  };
  const burst = await Promise.all(Array.from({ length: 20 }, send));
  const { rows } = await admin.query(`select count(*)::int as receipts from public.payment_webhook_receipts where webhook_event_id = $1`, [eventId]);
  const { rows: jobs } = await admin.query(`select count(*)::int as jobs from public.payment_outbox where webhook_receipt_id in
      (select id from public.payment_webhook_receipts where webhook_event_id = $1)`, [eventId]).catch(() => ({ rows: [{ jobs: null }] }));
  record('duplicate_webhook', 'el mismo aviso 20 veces a la vez: ninguna llamada falla', burst.every((r) => r.ok), burst.filter((r) => !r.ok).slice(0, 2));
  record('duplicate_webhook', 'queda un solo recibo', rows[0].receipts === 1, rows[0]);
  record('duplicate_webhook', 'y a lo sumo un trabajo en la cola', jobs[0].jobs === null || jobs[0].jobs <= 1, jobs[0]);
}

const final = await truth(admin);
record('integrity', 'al terminar todos los ensayos: pedidos, renglones, stock y admisiones cuentan la misma historia', coherent(final), final);
await admin.end().catch(() => {});

const failed = results.filter((r) => r.result === 'FAIL').length;
const summary = { drills: [...new Set(results.map((r) => r.drill))], checks: results.length, passed: results.filter((r) => r.result === 'PASS').length,
  failed, not_run: results.filter((r) => r.result === 'NOT_RUN').length, results };
const out = option('--out');
if (out) writeFileSync(out, `${JSON.stringify(summary, null, 1)}\n`);
console.log(`FAILURE_INJECTION: ${summary.passed}/${summary.checks - summary.not_run} PASS${summary.not_run ? `, ${summary.not_run} NOT_RUN` : ''}`);
assert.equal(failed, 0, 'un ensayo de fallas dejo el backend en un estado incoherente');
