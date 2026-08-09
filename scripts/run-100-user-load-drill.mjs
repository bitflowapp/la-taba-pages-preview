/*
 * ¿Qué pasa cuando compran 100 personas a la vez?
 *
 * POR QUÉ EXISTE
 * --------------
 * Todo lo certificado hasta acá se midió con UNA sesión por vez. Un piloto de
 * 100 clientes no falla por lo que hace una persona: falla por lo que hacen dos
 * al mismo tiempo sobre la última unidad, por el que toca «Confirmar» dos veces
 * porque la red tardó, y por el que reintenta.
 *
 * Corre contra una base PostgreSQL EFÍMERA Y PROPIA, con la cadena de
 * migraciones real y la RPC real de compra —`create_order_with_items`—. No toca
 * staging, no toca datos de nadie y no mueve un peso. Cada sesión es una
 * conexión de verdad —un `psql` propio—, así que la concurrencia es real y no
 * simulada dentro de una transacción.
 *
 * QUÉ MIDE
 *   A · contención: 100 personas sobre un stock que no alcanza para todas
 *   B · doble click: el mismo pedido enviado dos veces a la vez
 *   C · mezcla realista con latencias
 *
 *   node scripts/run-100-user-load-drill.mjs
 *   TABA_LOAD_SESSIONS=100 TABA_LOAD_CONCURRENCY=40 node scripts/run-100-user-load-drill.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DOCKER = process.platform === 'win32' ? 'docker.exe' : 'docker';
const IMAGE = process.env.TABA_DRILL_IMAGE || 'public.ecr.aws/supabase/postgres:17.6.1.147';
const SOURCE_STACK = process.env.TABA_PLATFORM_SCHEMA_CONTAINER || 'supabase_db_la-taba-pages';
const CONTAINER = `taba2-load-drill-${process.pid}`;
const DB = 'taba2_load_drill';

const BUSINESS_ID = '00000000-0000-4000-8000-000000000001';
const OWNER_ID = '00000000-0000-4000-8000-0000000000aa';
const SESIONES = Number(process.env.TABA_LOAD_SESSIONS || 100);
const CONCURRENCIA = Number(process.env.TABA_LOAD_CONCURRENCY || 40);
const STOCK_ESCASO = Number(process.env.TABA_LOAD_STOCK || 40);

const RECONCILIATION_REF = process.env.TABA_RECONCILIATION_REF || 'release/taba2-pilot-rc2';
const RECONCILIATION_FILE = '20260807155000_rider_map_location_contract_reconciliation.sql';

const checks = [];
const check = (name, ok, detail = '') => {
  checks.push({ name, ok, detail });
  console.log(`${ok ? 'OK  ' : 'FALLA'} ${name}${detail ? ` — ${detail}` : ''}`);
};

const sleepSync = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

function docker(args, options = {}) {
  return execFileSync(DOCKER, args, {
    cwd: ROOT, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024, input: options.input,
    stdio: options.input ? ['pipe', 'pipe', 'pipe'] : ['ignore', 'pipe', 'pipe'],
  });
}

function psql(sql, { expectFailure = false } = {}) {
  const r = spawnSync(DOCKER, ['exec', '-i', CONTAINER, 'psql', '-U', 'postgres', '-d', DB,
    '-v', 'ON_ERROR_STOP=1', '-q', '-X', '-A', '-t'],
  { cwd: ROOT, encoding: 'utf8', input: sql, maxBuffer: 256 * 1024 * 1024 });
  if (!expectFailure && r.status !== 0) {
    const detail = [r.error?.message, r.stderr, r.stdout].filter(Boolean).join('\n').trim();
    throw new Error(`psql falló (${r.status}): ${detail}\n--- SQL ---\n${String(sql).slice(0, 700)}`);
  }
  return { status: r.status, stdout: (r.stdout || '').trim(), stderr: (r.stderr || '').trim() };
}

/** Una sesión concurrente = un proceso psql propio = una conexión real. */
function psqlAsync(sql) {
  return new Promise((resolve) => {
    const inicio = process.hrtime.bigint();
    const hijo = spawn(DOCKER, ['exec', '-i', CONTAINER, 'psql', '-U', 'postgres', '-d', DB,
      '-v', 'ON_ERROR_STOP=1', '-q', '-X', '-A', '-t'], { cwd: ROOT });
    let out = ''; let err = '';
    hijo.stdout.on('data', (d) => { out += d; });
    hijo.stderr.on('data', (d) => { err += d; });
    hijo.on('close', (status) => resolve({
      status, stdout: out.trim(), stderr: err.trim(),
      ms: Number(process.hrtime.bigint() - inicio) / 1e6,
    }));
    hijo.stdin.end(sql);
  });
}

/** Corre las tareas con un techo de simultaneidad, como una cola de verdad. */
async function enOlas(tareas, tope) {
  const resultados = new Array(tareas.length);
  let siguiente = 0;
  const trabajador = async () => {
    for (;;) {
      const i = siguiente; siguiente += 1;
      if (i >= tareas.length) return;
      resultados[i] = await tareas[i]();
    }
  };
  await Promise.all(Array.from({ length: Math.min(tope, tareas.length) }, trabajador));
  return resultados;
}

const pct = (v, p) => (v.length ? [...v].sort((a, b) => a - b)[Math.min(v.length - 1, Math.floor((p / 100) * v.length))] : 0);
const clienteId = (n) => `10000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const token = (semilla) => crypto.createHash('sha256').update(String(semilla)).digest('hex');

/** Un pedido, como lo manda el navegador: misma RPC, mismo payload. */
function comprar({ cliente, pedidoId, productId, cantidad = 1 }) {
  const payload = JSON.stringify({
    business_id: BUSINESS_ID,
    client_request_id: pedidoId,
    tracking_token: token(pedidoId),
    items: [{ product_id: productId, quantity: cantidad }],
    customer_name: `Cliente ${cliente}`,
    customer_phone: '2990000000',
    delivery_mode: 'pickup',
    payment_method: 'coordinate',
    age_confirmed: true,
  }).replace(/'/g, "''");
  return `select set_config('request.jwt.claims', '{"sub":"${clienteId(cliente)}"}', false);
select public.create_order_with_items('${payload}'::jsonb) is not null;`;
}

const cleanup = () => { try { docker(['rm', '-f', CONTAINER]); } catch { /* ya no está */ } };

// ── arranque ────────────────────────────────────────────────────────────────
console.log(`Contenedor propio: ${CONTAINER}  ·  ${SESIONES} sesiones, hasta ${CONCURRENCIA} simultáneas\n`);
process.on('exit', cleanup);

docker(['run', '-d', '--name', CONTAINER, '-e', 'POSTGRES_HOST_AUTH_METHOD=trust',
  '-e', 'POSTGRES_PASSWORD=postgres', IMAGE]);
let listo = false;
for (let i = 0; i < 90; i += 1) {
  if (spawnSync(DOCKER, ['exec', CONTAINER, 'pg_isready', '-U', 'postgres'], { encoding: 'utf8' }).status === 0) { listo = true; break; }
  sleepSync(1000);
}
if (!listo) throw new Error('el contenedor no llegó a estar listo');

docker(['exec', CONTAINER, 'bash', '-lc',
  `mkdir -p /etc/postgresql-custom/conf.d && printf "cron.database_name = '${DB}'\\n" > /etc/postgresql-custom/conf.d/pg_cron.conf`]);
docker(['exec', CONTAINER, 'createdb', '-U', 'postgres', DB]);
docker(['restart', CONTAINER]);
for (let i = 0; i < 90; i += 1) {
  if (spawnSync(DOCKER, ['exec', CONTAINER, 'pg_isready', '-U', 'postgres'], { encoding: 'utf8' }).status === 0) break;
  sleepSync(1000);
}
check('contenedor propio listo', true, CONTAINER);

psql(docker(['exec', SOURCE_STACK, 'pg_dump', '-U', 'postgres', '-d', 'postgres',
  '--schema-only', '--schema=auth', '--schema=storage', '--no-owner', '--no-privileges']));
psql(`
  create schema if not exists extensions;
  create extension if not exists "uuid-ossp" schema extensions;
  create extension if not exists pgcrypto schema extensions;
  create extension if not exists pg_cron;
  do $$ begin
    if not exists (select 1 from pg_roles where rolname='anon') then create role anon nologin noinherit; end if;
    if not exists (select 1 from pg_roles where rolname='authenticated') then create role authenticated nologin noinherit; end if;
    if not exists (select 1 from pg_roles where rolname='service_role') then create role service_role nologin noinherit bypassrls; end if;
    if not exists (select 1 from pg_roles where rolname='authenticator') then create role authenticator login noinherit; end if;
    if not exists (select 1 from pg_roles where rolname='supabase_admin') then create role supabase_admin login superuser; end if;
  end $$;
`);
check('esquemas de plataforma copiados (lectura del stack ajeno)', true);

const dir = path.join(ROOT, 'supabase', 'migrations');
const archivos = fs.readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();
const prestada = execFileSync('git', ['show', `${RECONCILIATION_REF}:supabase/migrations/${RECONCILIATION_FILE}`],
  { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
const cadena = [];
for (const f of archivos) {
  if (f > RECONCILIATION_FILE && !cadena.some((m) => m.nombre === RECONCILIATION_FILE)) {
    cadena.push({ nombre: RECONCILIATION_FILE, sql: prestada });
  }
  cadena.push({ nombre: f, sql: fs.readFileSync(path.join(dir, f), 'utf8') });
}
for (const m of cadena) {
  const r = psql(m.sql, { expectFailure: true });
  if (r.status !== 0 && !/already exists|does not exist/i.test(r.stderr)) {
    throw new Error(`migración ${m.nombre}: ${r.stderr.slice(0, 400)}`);
  }
}
check('cadena de migraciones aplicada', true, `${cadena.length} archivos`);

// ── siembra ─────────────────────────────────────────────────────────────────
psql(`
  insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at)
  values ('${OWNER_ID}'::uuid, '00000000-0000-0000-0000-000000000000'::uuid, 'authenticated', 'authenticated',
    'duenio@carga.local', '', now(), now(), now())
  on conflict (id) do nothing;
  insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at)
  select ('10000000-0000-4000-8000-' || lpad(g::text, 12, '0'))::uuid,
         '00000000-0000-0000-0000-000000000000'::uuid, 'authenticated', 'authenticated',
         'cliente' || g || '@carga.local', '', now(), now(), now()
    from generate_series(1, ${SESIONES}) g
  on conflict (id) do nothing;
  insert into public.businesses (id, name, slug)
  values ('${BUSINESS_ID}', 'La Taba 2 (carga)', 'la-taba-2-carga') on conflict (id) do nothing;
  -- La RPC exige las cuatro: is_active, status='open', ordering_verified y
  -- ordering_enabled. Es la misma compuerta que protege al negocio real de
  -- recibir pedidos antes de estar listo, y el simulacro la atraviesa por el
  -- frente en vez de saltearla.
  -- Y ordering_verified no se puede encender sola: la restricción
  -- businesses_ordering_verified_configuration exige quién y cuándo verificó,
  -- moneda válida y al menos una modalidad de entrega configurada de punta a
  -- punta. Se completa todo, que es lo que haría el negocio real.
  update public.businesses
     set is_active = true, status = 'open',
         currency_code = 'ARS',
         pickup_enabled = true, delivery_enabled = false,
         ordering_verified_at = now(), ordering_verified_by = '${OWNER_ID}',
         ordering_verified = true, ordering_enabled = true
   where id = '${BUSINESS_ID}';
  insert into public.business_members (business_id, user_id, role, is_active)
  values ('${BUSINESS_ID}', '${OWNER_ID}', 'owner', true) on conflict do nothing;
`);

const CATALOGO = [
  { sku: 'carga-escaso-lata-473ml', nombre: 'Escaso', stock: STOCK_ESCASO, precio: 3900 },
  { sku: 'carga-abundante-lata-473ml', nombre: 'Abundante', stock: 5000, precio: 2925 },
  { sku: 'carga-medio-lata-473ml', nombre: 'Medio', stock: 500, precio: 3400 },
];

for (const p of CATALOGO) {
  const safeSku = p.sku.replace(/[^a-z0-9-]/gi, '-');
  const masterSha = crypto.createHash('sha256').update(`${p.sku}:master`).digest('hex');
  const thumbSha = crypto.createHash('sha256').update(`${p.sku}:thumb`).digest('hex');
  const sourceSha = crypto.createHash('sha256').update(`${p.sku}:source`).digest('hex');
  const assetId = crypto.randomUUID();
  psql(`
    with ident as (
      select public.catalog_image_identity_sha256('${p.sku}', '${p.sku}', '${sourceSha}') as identity_sha256
    ), rutas as (
      select i.identity_sha256,
             public.catalog_asset_path('${safeSku}', i.identity_sha256, 'master', '${masterSha}') as master_path,
             public.catalog_asset_path('${safeSku}', i.identity_sha256, 'thumbnail', '${thumbSha}') as thumbnail_path
        from ident i
    )
    insert into public.catalog_assets
      (id, business_id, external_id, sku, safe_sku, identity_sha256,
       master_path, master_sha256, master_binding_sha256,
       thumbnail_path, thumbnail_sha256, thumbnail_binding_sha256,
       source_sha256, source_url, rights_status, rights_reference, approved_at, approved_by)
    select '${assetId}', '${BUSINESS_ID}', '${p.sku}', '${p.sku}', '${safeSku}', r.identity_sha256,
           r.master_path, '${masterSha}',
           public.catalog_asset_binding_sha256(r.identity_sha256, 'master', '${sourceSha}', '${masterSha}', 1000, 1000, r.master_path),
           r.thumbnail_path, '${thumbSha}',
           public.catalog_asset_binding_sha256(r.identity_sha256, 'thumbnail', '${sourceSha}', '${thumbSha}', 400, 400, r.thumbnail_path),
           '${sourceSha}', 'https://carga.local/${p.sku}', 'PROPIO', 'carga', now(), '${OWNER_ID}'
      from rutas r on conflict do nothing;

    insert into public.products
      (business_id, external_id, sku, name, brand, category, subcategory, variant, presentation,
       capacity_value, capacity_unit, capacity, packaging_type, units_per_pack,
       price, stock, is_active, available, is_verified, is_alcoholic, minimum_age,
       image_url, image_sha256, image_thumbnail_url, image_thumbnail_sha256, source_image_sha256,
       catalog_asset_id, sort_order)
    select '${BUSINESS_ID}', '${p.sku}', '${p.sku}', $sem$${p.nombre}$sem$, 'Marca', 'Gaseosas', 'cola',
           'Original', 'Original', 473, 'ml', '473 ml', 'lata', 1,
           0, null, true, false, false, false, null,
           ca.master_path, ca.master_sha256, ca.thumbnail_path, ca.thumbnail_sha256, ca.source_sha256,
           ca.id, 0
      from public.catalog_assets ca where ca.id = '${assetId}'
    on conflict (business_id, external_id) do nothing;
  `);
}

// Se publican por la puerta comercial, que es la única segura.
const filas = CATALOGO.map((p) => ({ sku: p.sku, price: p.precio, stock: p.stock, publish: true }));
psql(`select set_config('request.jwt.claims', '{"sub":"${OWNER_ID}"}', false);
select count(*) from public.apply_commercial_catalog_batch('${BUSINESS_ID}'::uuid, '${JSON.stringify(filas).replace(/'/g, "''")}'::jsonb);`);

const ids = {};
for (const p of CATALOGO) {
  ids[p.sku] = psql(`select id from public.products where business_id='${BUSINESS_ID}' and sku='${p.sku}';`).stdout;
}
const comprables = psql(`select count(*) from public.products where business_id='${BUSINESS_ID}'
  and available and is_active and is_verified and price_status='confirmed' and price>0 and stock is not null and stock>0;`).stdout;
check('catálogo sembrado y publicado', Number(comprables) === CATALOGO.length,
  `${comprables} comprables · escaso=${STOCK_ESCASO} u.`);

// ── A · contención: más gente que stock ─────────────────────────────────────
console.log(`\n── A · ${SESIONES} personas sobre ${STOCK_ESCASO} unidades ──`);
const stockAntes = Number(psql(`select stock from public.products where sku='${CATALOGO[0].sku}';`).stdout);
const tareasA = Array.from({ length: SESIONES }, (_, i) => () => psqlAsync(
  comprar({ cliente: i + 1, pedidoId: `carga-a-${String(i + 1).padStart(4, '0')}`, productId: ids[CATALOGO[0].sku] }),
));
const inicioA = Date.now();
const resA = await enOlas(tareasA, CONCURRENCIA);
const duracionA = (Date.now() - inicioA) / 1000;

const okA = resA.filter((r) => r.status === 0).length;
const rechazoA = resA.filter((r) => r.status !== 0);
// Cuando el stock llega a 0 el contrato comercial apaga `available`, así que la
// negativa que ve la persona 41 es «producto no disponible», no «sin stock».
// Es un rechazo limpio y correcto; lo que NO está bien es que el mensaje lleve
// el UUID del producto en vez de su nombre —queda anotado como P1 de operación—.
const RECHAZO_LIMPIO = /stock|insuficiente|agotad|no disponible/i;
const sinStock = rechazoA.filter((r) => RECHAZO_LIMPIO.test(r.stderr)).length;
const otrosA = rechazoA.length - sinStock;
const stockDespues = Number(psql(`select stock from public.products where sku='${CATALOGO[0].sku}';`).stdout);
const pedidosA = Number(psql(`select count(*) from public.orders where business_id='${BUSINESS_ID}' and client_request_id like 'carga-a-%';`).stdout);
const vendidasA = Number(psql(`select coalesce(sum(oi.quantity),0) from public.order_items oi
  join public.orders o on o.id=oi.order_id where o.client_request_id like 'carga-a-%';`).stdout);

console.log(`   ${okA} compraron · ${sinStock} rechazadas por stock · ${otrosA} por otra causa · ${duracionA.toFixed(1)} s`);
console.log(`   stock ${stockAntes} → ${stockDespues} · pedidos ${pedidosA} · unidades vendidas ${vendidasA}`);
check('A · nunca se vende más stock del que hay', vendidasA <= stockAntes, `${vendidasA} vendidas de ${stockAntes}`);
check('A · el stock nunca queda negativo', stockDespues >= 0, `stock final ${stockDespues}`);
check('A · lo vendido y lo descontado coinciden', stockAntes - stockDespues === vendidasA,
  `${stockAntes}-${stockDespues} = ${stockAntes - stockDespues} vs ${vendidasA}`);
check('A · un pedido por persona que compró', pedidosA === okA, `${pedidosA} pedidos / ${okA} éxitos`);
check('A · las que no entraron fueron rechazadas limpio, no con un error raro',
  otrosA === 0, otrosA ? rechazoA.find((r) => !/stock|insuficiente|agotad/i.test(r.stderr))?.stderr.slice(0, 150) : 'todas por stock');

// ── B · doble click ─────────────────────────────────────────────────────────
const PARES = Math.min(40, SESIONES);
console.log(`\n── B · ${PARES} personas tocando «Confirmar» dos veces a la vez ──`);
const tareasB = [];
for (let i = 0; i < PARES; i += 1) {
  const sql = comprar({ cliente: i + 1, pedidoId: `carga-b-${String(i + 1).padStart(4, '0')}`, productId: ids[CATALOGO[1].sku] });
  tareasB.push(() => psqlAsync(sql), () => psqlAsync(sql));
}
const resB = await enOlas(tareasB, CONCURRENCIA);
const pedidosB = Number(psql(`select count(*) from public.orders where business_id='${BUSINESS_ID}' and client_request_id like 'carga-b-%';`).stdout);
const distintosB = Number(psql(`select count(distinct client_request_id) from public.orders where client_request_id like 'carga-b-%';`).stdout);
const unidadesB = Number(psql(`select coalesce(sum(oi.quantity),0) from public.order_items oi
  join public.orders o on o.id=oi.order_id where o.client_request_id like 'carga-b-%';`).stdout);
const okB = resB.filter((r) => r.status === 0).length;
console.log(`   ${resB.length} envíos (${PARES} pedidos × 2) · ${okB} aceptados por la RPC`);
console.log(`   pedidos creados ${pedidosB} · distintos ${distintosB} · unidades ${unidadesB}`);
check('B · el doble click no duplica el pedido', pedidosB === PARES, `${pedidosB} pedidos de ${PARES} personas`);
check('B · ni duplica las unidades cobradas', unidadesB === PARES, `${unidadesB} unidades`);

// ── C · mezcla realista ─────────────────────────────────────────────────────
console.log(`\n── C · ${SESIONES} sesiones sobre catálogo mixto ──`);
const tareasC = Array.from({ length: SESIONES }, (_, i) => {
  const p = CATALOGO[(i % 2) + 1];
  return () => psqlAsync(comprar({
    cliente: (i % SESIONES) + 1,
    pedidoId: `carga-c-${String(i + 1).padStart(4, '0')}`,
    productId: ids[p.sku],
    cantidad: (i % 3) + 1,
  }));
});
const inicioC = Date.now();
const resC = await enOlas(tareasC, CONCURRENCIA);
const duracionC = (Date.now() - inicioC) / 1000;
const latC = resC.filter((r) => r.status === 0).map((r) => r.ms);
const okC = latC.length;
const pedidosC = Number(psql(`select count(*) from public.orders where client_request_id like 'carga-c-%';`).stdout);
console.log(`   ${okC}/${SESIONES} completaron · ${duracionC.toFixed(1)} s · ${(okC / duracionC).toFixed(1)} pedidos/s`);
console.log(`   latencia p50 ${pct(latC, 50).toFixed(0)} ms · p95 ${pct(latC, 95).toFixed(0)} ms · máx ${Math.max(0, ...latC).toFixed(0)} ms`);
check('C · todas las sesiones terminaron sin error', okC === SESIONES, `${okC}/${SESIONES}`);
check('C · un pedido por sesión, sin duplicados', pedidosC === SESIONES, `${pedidosC} pedidos`);

// ── integridad final ────────────────────────────────────────────────────────
const negativos = Number(psql(`select count(*) from public.products where stock < 0;`).stdout);
const huerfanos = Number(psql(`select count(*) from public.order_items oi
  left join public.orders o on o.id=oi.order_id where o.id is null;`).stdout);
const sinItems = Number(psql(`select count(*) from public.orders o
  where not exists (select 1 from public.order_items oi where oi.order_id=o.id);`).stdout);
const duplicados = Number(psql(`select count(*) from (
  select business_id, client_request_id from public.orders group by 1,2 having count(*)>1) d;`).stdout);
console.log('');
check('ningún producto quedó con stock negativo', negativos === 0, `${negativos}`);
check('ningún ítem quedó huérfano de su pedido', huerfanos === 0, `${huerfanos}`);
check('ningún pedido quedó sin ítems (venta ambigua)', sinItems === 0, `${sinItems}`);
check('ningún client_request_id produjo dos pedidos', duplicados === 0, `${duplicados}`);

const salida = process.env.TABA_LOAD_REPORT;
if (salida) {
  fs.writeFileSync(salida, JSON.stringify({
    sesiones: SESIONES, concurrencia: CONCURRENCIA,
    A: { ok: okA, sinStock, otros: otrosA, stockAntes, stockDespues, vendidas: vendidasA, segundos: duracionA },
    B: { envios: resB.length, pedidos: pedidosB, unidades: unidadesB },
    C: { ok: okC, pedidos: pedidosC, segundos: duracionC, p50: pct(latC, 50), p95: pct(latC, 95), max: Math.max(0, ...latC) },
    integridad: { negativos, huerfanos, sinItems, duplicados },
    checks,
  }, null, 2));
}

console.log('');
const fallidos = checks.filter((c) => !c.ok);
console.log(`${checks.length - fallidos.length}/${checks.length} OK`);
if (fallidos.length) { for (const f of fallidos) console.log(`  - ${f.name}: ${f.detail}`); process.exitCode = 1; }
