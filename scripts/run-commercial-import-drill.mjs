/*
 * Simulacro de la carga comercial contra una base PostgreSQL REAL y descartable.
 *
 * QUÉ PRUEBA
 * ----------
 * Que `apply_commercial_catalog_batch` cumple lo que promete cuando corre de
 * verdad, no cuando lo dice un comentario: que una fila mala deshace el lote
 * ENTERO, que un precio ausente no se lee como cero, que publicar sin precio,
 * sin stock o sin imagen aprobada no ocurre, y que los productos que la planilla
 * no menciona quedan byte a byte como estaban.
 *
 * DÓNDE CORRE
 * -----------
 * En un contenedor PROPIO, creado y borrado por este script. No usa el stack de
 * nadie más: la migración de pg_cron exige tocar un GUC del clúster y reiniciar,
 * y hacer eso sobre el contenedor de otra sesión le voltea la base a medio
 * trabajo. Del stack ajeno se LEE una sola cosa —el esquema `auth`/`storage`,
 * con `pg_dump --schema-only`— porque son esquemas que crean los servicios de
 * Supabase y no las migraciones de este repo.
 *
 * QUÉ NO HACE
 * -----------
 * No escribe un solo valor sintético sobre el catálogo comercial real. Los
 * precios de este simulacro viven exclusivamente en la base efímera; los SKU se
 * copian del catálogo para que la prueba sea representativa, pero nada vuelve a
 * `catalog/products.csv`, a staging ni a producción.
 *
 *   node scripts/run-commercial-import-drill.mjs
 */
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { buildCommercialPlan, readCatalogIndex } from './import-commercial-catalog.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DOCKER = process.platform === 'win32' ? 'docker.exe' : 'docker';
const IMAGE = process.env.TABA_DRILL_IMAGE || 'public.ecr.aws/supabase/postgres:17.6.1.147';
const SOURCE_STACK = process.env.TABA_PLATFORM_SCHEMA_CONTAINER || 'supabase_db_la-taba-pages';
const CONTAINER = `taba2-onboarding-drill-${process.pid}`;
const DB = 'taba2_onboarding_drill';

const BUSINESS_ID = '00000000-0000-4000-8000-000000000001';
const OWNER_ID = '00000000-0000-4000-8000-0000000000aa';

// La cadena de migraciones de ESTA rama no replica desde cero: `20260807170000`
// altera tablas de `private` que crea una migración del repo del Rider todavía
// no canonizada acá. release/taba2-pilot-rc2 la canonizó; el simulacro la LEE de
// esa rama —sin tocarla y sin traerla a esta— para poder llegar a lo que sí se
// está probando. Está anotado desde el 8 de agosto en taba2-pilot-rc2-candidate.txt.
const RECONCILIATION_REF = process.env.TABA_RECONCILIATION_REF || 'release/taba2-pilot-rc2';
const RECONCILIATION_FILE = '20260807155000_rider_map_location_contract_reconciliation.sql';

const checks = [];
const check = (name, ok, detail = '') => {
  checks.push({ name, ok, detail });
  console.log(`${ok ? 'OK  ' : 'FALLA'} ${name}${detail ? ` — ${detail}` : ''}`);
};

// Espera sincrónica sin depender del shell: `timeout` en Windows y `sleep` en
// POSIX se llaman igual y hacen cosas distintas, y con Git Bash en el PATH el
// que gana no es el que uno cree.
function sleepSync(milliseconds) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, milliseconds);
}

function docker(args, options = {}) {
  return execFileSync(DOCKER, args, {
    cwd: ROOT,
    encoding: 'utf8',
    maxBuffer: 256 * 1024 * 1024,
    input: options.input,
    stdio: options.input ? ['pipe', 'pipe', 'pipe'] : ['ignore', 'pipe', 'pipe'],
  });
}

function psql(sql, { db = DB, expectFailure = false } = {}) {
  const result = spawnSync(DOCKER, [
    'exec', '-i', CONTAINER, 'psql', '-U', 'postgres', '-d', db,
    '-v', 'ON_ERROR_STOP=1', '-q', '-X', '-A', '-t',
  ], { cwd: ROOT, encoding: 'utf8', input: sql, maxBuffer: 256 * 1024 * 1024 });
  if (!expectFailure && result.status !== 0) {
    const detail = [
      result.error ? `spawn: ${result.error.message}` : '',
      result.stderr || '',
      result.stdout || '',
    ].filter(Boolean).join('\n').trim();
    throw new Error(`psql falló (status=${result.status}): ${detail || 'sin salida'}\n--- SQL ---\n${String(sql).slice(0, 600)}`);
  }
  return { status: result.status, stdout: (result.stdout || '').trim(), stderr: (result.stderr || '').trim() };
}

// 20260814030000 (identity_requires_registered_session) le sumó una segunda
// exigencia a has_business_role/identity_member_role: no alcanza con `sub` en
// el JWT, la sesión tiene que estar en identity_sessions (identity_register_
// session, lo mismo que hace el Panel al entrar). Sin esto, CUALQUIER RPC
// detrás de has_business_role —incluida apply_commercial_catalog_batch—
// rechaza con "Only an active owner/admin..." aunque business_members diga
// owner. SESSION_ID es fija y sintética: sólo tiene que coincidir entre el
// alta (más abajo) y cada conexión nueva que abre `asOwner`.
const SESSION_ID = '00000000-0000-4000-8000-0000000000bb';

/** Ejecuta como owner autenticado: `auth.uid()` y la sesión registrada leen `request.jwt.claims`. */
function asOwner(sql, options = {}) {
  return psql(
    `select set_config('request.jwt.claims', '{"sub":"${OWNER_ID}","session_id":"${SESSION_ID}"}', false);\n${sql}`,
    options,
  );
}

// Elenco para set_commercial_product_publication (20260819060000): además del
// owner de arriba hace falta un admin (el otro rol que la RPC autoriza), un
// staff (tiene inventory.receive pero NO products.publish — es exactamente lo
// que la migración deja afuera a propósito) y alguien sin ningún business_members
// para este negocio — el mismo resultado que un Rider o un Customer, que ni
// siquiera tienen fila ahí.
const ADMIN_ID = '00000000-0000-4000-8000-0000000000cc';
const STAFF_ID = '00000000-0000-4000-8000-0000000000dd';
const OUTSIDER_ID = '00000000-0000-4000-8000-0000000000ee';
const ADMIN_SESSION = '00000000-0000-4000-8000-0000000000c1';
const STAFF_SESSION = '00000000-0000-4000-8000-0000000000d1';
const OUTSIDER_SESSION = '00000000-0000-4000-8000-0000000000e1';
// Nunca pasa por identity_register_session: es EXACTAMENTE una sesión no
// registrada con un `sub` real y un rol real — el caso que 20260814030000
// existe para cerrar.
const UNREGISTERED_SESSION = '00000000-0000-4000-8000-0000000000f1';

function asUser(userId, sessionId, sql, options = {}) {
  return psql(
    `select set_config('request.jwt.claims', '{"sub":"${userId}","session_id":"${sessionId}"}', false);\n${sql}`,
    options,
  );
}

function callPublication(userId, sessionId, sku, publish, options = {}) {
  return asUser(userId, sessionId,
    `select applied_sku, applied_available, applied_is_verified, applied_price, applied_stock, applied_price_status\n`
    + `  from public.set_commercial_product_publication(${lit(BUSINESS_ID)}, ${lit(sku)}, ${publish});`,
    options);
}

function productSnapshot(sku) {
  return psql(
    `select coalesce(price::text,'∅') || '|' || coalesce(stock::text,'∅') || '|' || available
       from public.products where business_id=${lit(BUSINESS_ID)} and sku=${lit(sku)};`,
  ).stdout;
}

const lit = (v) => `'${String(v).replaceAll("'", "''")}'`;

function applyBatch(rows, options = {}) {
  const payload = JSON.stringify(rows).replace(/'/g, "''");
  return asOwner(
    `select count(*) from public.apply_commercial_catalog_batch('${BUSINESS_ID}'::uuid, '${payload}'::jsonb);`,
    options,
  );
}

function productState(sku) {
  const row = psql(
    `select coalesce(price::text,'∅') || '|' || coalesce(stock::text,'∅') || '|' || available || '|' || is_verified
       from public.products where business_id='${BUSINESS_ID}' and sku='${sku}';`,
  ).stdout;
  return row;
}

/** El estado según el contrato, en una palabra. */
function commercialState(sku) {
  return psql(
    `select public.product_commercial_state(price_status, price, stock, is_active, is_verified, available)
       from public.products where business_id='${BUSINESS_ID}' and sku='${sku}';`,
  ).stdout;
}

function priceStatus(sku) {
  return psql(
    `select price_status from public.products where business_id='${BUSINESS_ID}' and sku='${sku}';`,
  ).stdout;
}

function cleanup() {
  try { docker(['rm', '-f', CONTAINER]); } catch { /* ya no está */ }
}

// ── arranque ────────────────────────────────────────────────────────────────
console.log(`Contenedor propio: ${CONTAINER}`);
process.on('exit', cleanup);
try {
  docker(['run', '-d', '--name', CONTAINER, '-e', 'POSTGRES_HOST_AUTH_METHOD=trust',
    '-e', 'POSTGRES_PASSWORD=postgres', IMAGE]);

  let ready = false;
  for (let attempt = 0; attempt < 90; attempt += 1) {
    const probe = spawnSync(DOCKER, ['exec', CONTAINER, 'pg_isready', '-U', 'postgres'], { encoding: 'utf8' });
    if (probe.status === 0) { ready = true; break; }
    sleepSync(1000);
  }
  if (!ready) throw new Error('El contenedor no llegó a estar listo.');
  check('contenedor propio listo', true, CONTAINER);

  // pg_cron sólo se instala desde la base que declara `cron.database_name`.
  // Se apunta el GUC de ESTE clúster —no el de nadie más— y se reinicia.
  docker(['exec', CONTAINER, 'bash', '-lc',
    `mkdir -p /etc/postgresql-custom/conf.d && printf "cron.database_name = '${DB}'\\n" > /etc/postgresql-custom/conf.d/pg_cron.conf`]);
  // `pg_isready` puede contestar "accepting connections" para el health check
  // un instante antes de que el propio servidor pueda ejecutar `createdb` —se
  // midió acá, con la máquina bajo la carga de otros stacks de Supabase ya
  // corriendo (7,7 GB de límite del VM, compartido). Es transitorio: reintenta
  // en vez de abortar el simulacro entero por una carrera de arranque.
  for (let attempt = 0; ; attempt += 1) {
    try {
      docker(['exec', CONTAINER, 'createdb', '-U', 'postgres', DB]);
      break;
    } catch (error) {
      if (attempt >= 5) throw error;
      sleepSync(1500);
    }
  }
  docker(['restart', CONTAINER]);
  for (let attempt = 0; attempt < 90; attempt += 1) {
    const probe = spawnSync(DOCKER, ['exec', CONTAINER, 'pg_isready', '-U', 'postgres'], { encoding: 'utf8' });
    if (probe.status === 0) break;
    sleepSync(1000);
  }

  // `auth` y `storage` los crean los servicios de Supabase, no las migraciones.
  // Se copian SÓLO el esquema desde un stack levantado: lectura pura.
  const platformSchemas = docker(['exec', SOURCE_STACK, 'pg_dump', '-U', 'postgres', '-d', 'postgres',
    '--schema-only', '--schema=auth', '--schema=storage', '--no-owner', '--no-privileges']);
  psql(platformSchemas);
  psql(`
    create schema if not exists extensions;
    grant usage on schema extensions to anon, authenticated, service_role;
    create extension if not exists pgcrypto with schema extensions;
    create schema if not exists vault;
  `);
  check('esquemas de plataforma copiados (lectura del stack ajeno)', true);

  // `private.rider_map_business_locations` la crea una migración del repo del
  // Rider que en esta rama todavía no está canonizada: `20260807170000` la
  // altera y aborta con «schema "private" does not exist». Es el hueco que
  // release/taba2-pilot-rc2 cierra con su migración de reconciliación, y está
  // anotado desde el 8 de agosto en taba2-pilot-rc2-candidate.txt. No es un
  // defecto de esta rama ni de este simulacro: se declara como fixture del
  // clúster, igual que `extensions` y `vault`, para poder ejercitar lo que sí
  // se está probando acá.
  // Se usa la migración de reconciliación TAL CUAL la escribió la sesión de
  // RC2, leída de su rama sin tocarla, y se aplica EN SU POSICIÓN cronológica:
  // fuera de orden falla, porque ella también depende de lo que crearon las
  // anteriores. Reescribir a mano las tablas que crea sería inventar un esquema
  // parecido y probar contra algo que no existe.
  const reconciliation = execFileSync('git',
    ['show', `${RECONCILIATION_REF}:supabase/migrations/${RECONCILIATION_FILE}`],
    { cwd: ROOT, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });

  const own = fs.readdirSync(path.join(ROOT, 'supabase', 'migrations'))
    .filter((name) => name.endsWith('.sql'))
    .map((name) => ({ name, sql: fs.readFileSync(path.join(ROOT, 'supabase', 'migrations', name), 'utf8') }));
  const migrations = [...own, { name: RECONCILIATION_FILE, sql: reconciliation, borrowed: true }]
    .sort((a, b) => a.name.localeCompare(b.name));

  for (const migration of migrations) {
    const applied = psql(migration.sql, { expectFailure: true });
    if (applied.status !== 0) {
      // psql escupe NOTICE por cada `drop constraint if exists`; lo que importa
      // es la línea de ERROR, que puede estar cincuenta líneas más abajo.
      const output = `${applied.stderr || ''}\n${applied.stdout || ''}`;
      const detail = output.split('\n').filter((line) => /ERROR|FATAL|DETAIL|HINT/.test(line)).slice(0, 4);
      throw new Error(`migración ${migration.name}: ${detail.join(' / ') || 'sin detalle'}`);
    }
  }
  check('cadena de migraciones aplicada', true,
    `${migrations.length} archivos (uno prestado de ${RECONCILIATION_REF})`);

  // ── semilla ───────────────────────────────────────────────────────────────
  // Identidad copiada del catálogo real para que la prueba sea representativa.
  // Los VALORES comerciales de este simulacro son sintéticos y viven sólo acá.
  const catalog = readCatalogIndex(fs.readFileSync(path.join(ROOT, 'catalog/products.csv'), 'utf8'));
  const sample = [...catalog.values()]
    .filter((product) => !/-pack-\d+$/.test(product.sku))
    .slice(0, 6);
  const seedRows = sample.map((product, index) => {
    const assetId = crypto.randomUUID();
    return { product, assetId, index };
  });

  psql(`
    insert into auth.users (id, instance_id, aud, role, email, encrypted_password, created_at, updated_at)
    values ('${OWNER_ID}', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
            'owner@drill.local', '', now(), now())
    on conflict (id) do nothing;
    insert into public.businesses (id, name, slug, alcohol_sales_enabled)
    values ('${BUSINESS_ID}', 'La Taba 2 (simulacro)', 'la-taba-2-simulacro', false)
    on conflict (id) do nothing;
    insert into public.business_members (business_id, user_id, role, is_active)
    values ('${BUSINESS_ID}', '${OWNER_ID}', 'owner', true)
    on conflict do nothing;
  `);

  // Sin esto, has_business_role rechaza a partir de 20260814030000: la
  // membresía sola ya no alcanza, la sesión tiene que estar registrada.
  const registro = asOwner(`select public.identity_register_session('${BUSINESS_ID}'::uuid, 'panel_web');`);
  check('sesión de owner registrada (identity_register_session)',
    /"ok"\s*:\s*true/.test(registro.stdout), registro.stdout);

  // Los sha de identidad, las rutas y los bindings los calcula la BASE con sus
  // propias funciones: un `catalog_assets` tiene un CHECK que exige exactamente
  // eso, y escribirlos a mano desde Node sería inventar una versión paralela del
  // contrato que el día que cambie no se entera.
  for (const { product, assetId } of seedRows) {
    const safeSku = product.sku.replace(/[^a-z0-9-]/gi, '-');
    const masterSha = crypto.createHash('sha256').update(`${product.sku}:master`).digest('hex');
    const thumbSha = crypto.createHash('sha256').update(`${product.sku}:thumb`).digest('hex');
    const sourceSha = crypto.createHash('sha256').update(`${product.sku}:source`).digest('hex');
    psql(`
      with ident as (
        select public.catalog_image_identity_sha256(
          '${product.sku}', '${product.sku}', '${sourceSha}'
        ) as identity_sha256
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
         source_sha256, source_url, rights_status, rights_reference,
         approved_at, approved_by)
      select '${assetId}', '${BUSINESS_ID}', '${product.sku}', '${product.sku}', '${safeSku}',
             r.identity_sha256,
             r.master_path, '${masterSha}',
             public.catalog_asset_binding_sha256(r.identity_sha256, 'master', '${sourceSha}', '${masterSha}', 1000, 1000, r.master_path),
             r.thumbnail_path, '${thumbSha}',
             public.catalog_asset_binding_sha256(r.identity_sha256, 'thumbnail', '${sourceSha}', '${thumbSha}', 400, 400, r.thumbnail_path),
             '${sourceSha}', 'https://simulacro.local/${product.sku}', 'PROPIO', 'simulacro',
             now(), '${OWNER_ID}'
        from rutas r
      on conflict do nothing;

      -- is_alcoholic=false y minimum_age=null explicitos: la base exige
      -- coherencia de alcohol por categoria para poder VERIFICAR un producto
      -- (products_verified_alcohol_coherence), y un NULL no es un false.
      -- Una semilla a medio declarar no se puede publicar, que es justamente
      -- lo que este simulacro necesita poder hacer.
      -- Los datos maestros van completos porque products_verified_master_data
      -- exige marca, subcategoria, presentacion, capacidad y envase no vacios
      -- para poder verificar. Es el mismo piso que impone el alta real.
      insert into public.products
        (business_id, external_id, sku, name, brand, category, subcategory,
         variant, presentation, capacity_value, capacity_unit, capacity, packaging_type, units_per_pack,
         price, stock, is_active, available, is_verified,
         is_alcoholic, minimum_age,
         image_url, image_sha256, image_thumbnail_url, image_thumbnail_sha256, source_image_sha256,
         catalog_asset_id, sort_order)
      select '${BUSINESS_ID}', '${product.sku}', '${product.sku}',
             $sem$${product.name}$sem$, $sem$${product.brand || 'Marca'}$sem$, 'Gaseosas', 'cola',
             -- presentation = variant y capacity = capacity_value||' '||unit:
             -- products_verified_publication_authority los compara literalmente.
             'Original', 'Original', 473, 'ml', '473 ml', 'lata', 1,
             0, null, true, false, false,
             false, null,
             ca.master_path, ca.master_sha256, ca.thumbnail_path, ca.thumbnail_sha256, ca.source_sha256,
             ca.id, 0
        from public.catalog_assets ca
       where ca.id = '${assetId}'
      on conflict (business_id, external_id) do nothing;
    `);
  }
  // `products.price` es `not null check (price >= 0)`: la base NO puede
  // representar «todavía no tiene precio» con un NULL, y lo termina guardando
  // como 0. O sea que el peligro que este simulacro persigue no es hipotético:
  // está horneado en el esquema. La única defensa posible es que nada publique
  // ni venda con precio 0, y eso es lo que se prueba abajo.
  psql(`update public.products
           set price = 0, price_status = 'pending'
         where business_id='${BUSINESS_ID}';`);
  const conPrecioCero = psql(
    `select count(*) from public.products where business_id='${BUSINESS_ID}' and price = 0;`,
  ).stdout;
  check('la base guarda «sin precio» como 0, no como NULL',
    Number(conPrecioCero) === seedRows.length, `${conPrecioCero} filas en 0`);
  const estadoInicial = psql(
    `select distinct public.product_commercial_state(price_status, price, stock, is_active, is_verified, available)
       from public.products where business_id='${BUSINESS_ID}';`,
  ).stdout;
  check('el contrato nombra ese estado «precio_pendiente»', estadoInicial === 'precio_pendiente', estadoInicial);
  const seeded = psql(`select count(*) from public.products where business_id='${BUSINESS_ID}';`).stdout;
  check('catálogo sembrado en la base efímera', Number(seeded) === seedRows.length, `${seeded} productos`);

  const [uno, dos, tres, ...resto] = seedRows.map((entry) => entry.product.sku);
  const intacto = resto[0];
  const estadoInicialIntacto = productState(intacto);

  // ── 1. carga inicial de precio y stock ────────────────────────────────────
  applyBatch([
    { sku: uno, price: '3900', stock: 24 },
    { sku: dos, price: '2925.50', stock: 0 },
  ]);
  check('precio y stock se cargan', productState(uno).startsWith('3900.00|24|'), productState(uno));
  check('stock 0 es válido y no publica', productState(dos) === '2925.50|0|false|false', productState(dos));

  // ── 2. los omitidos no se tocan ───────────────────────────────────────────
  check('un producto que la planilla no menciona queda igual',
    productState(intacto) === estadoInicialIntacto, `${estadoInicialIntacto} → ${productState(intacto)}`);

  // ── 3. precio ausente NO es cero ──────────────────────────────────────────
  applyBatch([{ sku: uno, stock: 30 }]);
  check('cargar sólo stock no borra el precio', productState(uno).startsWith('3900.00|30|'), productState(uno));

  // ── 4. una fila mala deshace el lote entero ───────────────────────────────
  const antes = productState(uno);
  const rollback = applyBatch([
    { sku: uno, price: '4500' },
    { sku: 'sku-que-no-existe', price: '100' },
  ], { expectFailure: true });
  check('un SKU desconocido aborta el lote', rollback.status !== 0, rollback.stderr.split('\n')[0] || '');
  check('y la fila buena del mismo lote NO quedó aplicada',
    productState(uno) === antes, `${antes} → ${productState(uno)}`);

  // ── 5. precio cero rechazado ──────────────────────────────────────────────
  const cero = applyBatch([{ sku: uno, price: '0' }], { expectFailure: true });
  check('precio cero rechazado', cero.status !== 0, cero.stderr.split('\n').find((l) => l.includes('ERROR')) || '');
  check('el precio siguió intacto tras el rechazo', productState(uno) === antes, productState(uno));

  // ── 6. negativos rechazados ───────────────────────────────────────────────
  const negativo = applyBatch([{ sku: uno, stock: -5 }], { expectFailure: true });
  check('stock negativo rechazado', negativo.status !== 0, negativo.stderr.split('\n').find((l) => l.includes('ERROR')) || '');

  // ── 7. duplicados rechazados ──────────────────────────────────────────────
  const duplicado = applyBatch([{ sku: uno, price: '1000' }, { sku: uno, price: '2000' }], { expectFailure: true });
  check('SKU duplicado en el mismo lote rechazado', duplicado.status !== 0,
    duplicado.stderr.split('\n').find((l) => l.includes('ERROR')) || '');

  // ── 8. SKU de QA rechazado ────────────────────────────────────────────────
  const qa = applyBatch([{ sku: 'bebida-qa-sintetica-STAGING-ONLY', price: '400' }], { expectFailure: true });
  check('SKU con pinta de fixture de QA rechazado', qa.status !== 0,
    qa.stderr.split('\n').find((l) => l.includes('ERROR')) || '');

  // ── 9. publicación: exige precio, stock e imagen aprobada ─────────────────
  const sinStock = applyBatch([{ sku: dos, publish: true }], { expectFailure: true });
  check('publicar con stock 0 rechazado', sinStock.status !== 0,
    sinStock.stderr.split('\n').find((l) => l.includes('ERROR')) || '');

  // `tres` sigue con el precio 0 que la base usa para «sin precio». Publicarlo
  // sería exactamente el peligro: un producto a cero pesos en la góndola.
  const sinPrecio = applyBatch([{ sku: tres, publish: true, stock: 5 }], { expectFailure: true });
  check('publicar un producto con precio 0 rechazado', sinPrecio.status !== 0,
    sinPrecio.stderr.split('\n').find((l) => l.includes('ERROR')) || '');

  applyBatch([{ sku: uno, publish: true }]);
  check('publicar con precio, stock e imagen aprobada funciona',
    productState(uno) === '3900.00|30|true|true', productState(uno));

  // ── 10. cambiar un precio conserva la publicación ─────────────────────────
  // El disparador de la tabla despublica —cuenta el precio como dato maestro—
  // y el RPC republica explícitamente en la misma transacción, pero sólo si
  // sigue cumpliendo todas las compuertas. El resultado neto: la góndola no se
  // cae por una lista de precios nueva.
  applyBatch([{ sku: uno, price: '4100' }]);
  check('cambiar el precio conserva la publicación',
    productState(uno) === '4100.00|30|true|true', productState(uno));

  // Y la republicación NO es un salvoconducto: si el producto deja de cumplir,
  // se queda abajo aunque estuviera publicado.
  applyBatch([{ sku: uno, price: '4200', stock: 0 }]);
  check('si el stock cae a 0, republicar no lo levanta',
    productState(uno) === '4200.00|0|false|false', productState(uno));

  // ── 11. imagen sin autoridad: no publica ──────────────────────────────────
  psql(`update public.products set image_url = 'assets/otra/cosa.webp' where sku='${tres}' and business_id='${BUSINESS_ID}';`);
  const sinAsset = applyBatch([{ sku: tres, price: '1500', stock: 3, publish: true }], { expectFailure: true });
  check('publicar con imagen que no coincide con el registro aprobado rechazado',
    sinAsset.status !== 0, sinAsset.stderr.split('\n').find((l) => l.includes('ERROR')) || '');

  // ── 12. LAS SIETE TRANSICIONES DEL CONTRATO ───────────────────────────────
  const t = resto[1] || tres;
  psql(`update public.products
           set price = 0, price_status = 'pending', stock = null,
               available = false, is_verified = false, verified_at = null, verified_by = null
         where business_id='${BUSINESS_ID}' and sku='${t}';`);

  // (1) pendiente → confirmado: cargar el precio ES confirmarlo.
  check('T1 · el punto de partida es precio_pendiente', commercialState(t) === 'precio_pendiente', commercialState(t));
  applyBatch([{ sku: t, price: '1500' }]);
  check('T1 · pendiente → confirmado, y el estado del precio acompaña',
    priceStatus(t) === 'confirmed' && commercialState(t) === 'stock_pendiente',
    `price_status=${priceStatus(t)} estado=${commercialState(t)}`);

  // (2) confirmado → nuevo precio.
  applyBatch([{ sku: t, price: '1750' }]);
  check('T2 · confirmado → nuevo precio', productState(t).startsWith('1750.00|∅|'), productState(t));

  // (3) stock pendiente → 10.
  applyBatch([{ sku: t, stock: 10 }]);
  // Deja de ser `stock_pendiente`, pero todavía no es publicable: este producto
  // nunca se verificó, así que el contrato lo llama `no_publicado`.
  check('T3 · stock pendiente → 10, y deja de ser stock_pendiente',
    productState(t).startsWith('1750.00|10|') && commercialState(t) === 'no_publicado',
    `${productState(t)} · ${commercialState(t)}`);

  applyBatch([{ sku: t, publish: true }]);
  check('T3b · con precio y stock, publicar funciona', commercialState(t) === 'comprable', commercialState(t));

  // (4) 10 → 0: se agota y deja de poder comprarse, sin perder el precio.
  applyBatch([{ sku: t, stock: 0 }]);
  // `available` cae y el estado pasa a `agotado`. `is_verified` NO se toca:
  // quedarse sin stock no invalida la revisión de identidad ni de imagen, y
  // exigir una nueva verificación para reponer sería trabajo inventado.
  check('T4 · 10 → 0 bloquea la compra y conserva el precio',
    productState(t) === '1750.00|0|false|true' && commercialState(t) === 'agotado',
    `${productState(t)} · ${commercialState(t)}`);

  // (5) 0 → 10: repone. No se republica solo, porque al agotarse dejó de estar
  // publicado; hay que volver a decirlo.
  applyBatch([{ sku: t, stock: 10 }]);
  check('T5 · 0 → 10 vuelve a ser publicable pero no se publica solo',
    commercialState(t) === 'publicable_no_publicado', commercialState(t));
  applyBatch([{ sku: t, publish: true }]);
  check('T5b · y al publicarlo vuelve a ser comprable', commercialState(t) === 'comprable', commercialState(t));

  // (6) lote mixto con una fila inválida: nada se aplica.
  const antesMixto = productState(t);
  const mixto = applyBatch([
    { sku: t, price: '9999' },
    { sku: uno, price: '8888' },
    { sku: dos, stock: -1 },
  ], { expectFailure: true });
  check('T6 · un lote mixto con una fila inválida se rechaza entero', mixto.status !== 0,
    mixto.stderr.split('\n').find((l) => l.includes('ERROR')) || '');

  // (7) rollback total: ninguna de las dos filas buenas quedó escrita.
  check('T7 · rollback total: ninguna fila buena del lote quedó aplicada',
    productState(t) === antesMixto && !productState(uno).startsWith('8888'),
    `${t}=${productState(t)} · ${uno}=${productState(uno)}`);

  // ── 13. la tabla impide un comprable sin precio confirmado ────────────────
  // Aunque alguien escriba `available` directo, que el grant lo permite.
  const forzado = psql(
    `update public.products set price_status='pending' where business_id='${BUSINESS_ID}' and sku='${t}';`,
    { expectFailure: true },
  );
  check('la tabla impide dejar comprable un producto con precio pendiente',
    forzado.status !== 0,
    forzado.stderr.split('\n').find((l) => l.includes('ERROR') || l.includes('constraint')) || '');

  // Y devolverlo a pendiente por la puerta comercial sí funciona, porque apaga
  // la venta en el mismo movimiento.
  applyBatch([{ sku: t, price_pending: true }]);
  // Apaga la venta —`available` en falso— sin des-verificar: el producto sigue
  // siendo el mismo, lo que dejó de estar confirmado es cuánto sale.
  const trasPendiente = productState(t);
  check('volver a «precio pendiente» por la puerta comercial apaga la venta',
    commercialState(t) === 'precio_pendiente' && trasPendiente.split('|')[2] === 'false',
    `${commercialState(t)} · ${trasPendiente}`);

  // ── 14. el plan del importador coincide con lo que acepta el servidor ─────
  const sheet = [
    'sku,producto,categoria,alcohol,precio,stock,publicar,notas',
    `${uno},Producto uno,Gaseosas,no,4100,30,si,`,
    `${dos},Producto dos,Gaseosas,no,2925.50,0,no,`,
  ].join('\n');
  const plan = buildCommercialPlan(sheet, { catalog, imageExists: () => true });
  check('el importador valida la misma planilla sin errores', plan.errors.length === 0,
    plan.errors.join(' | ') || `${plan.rows.length} filas`);

  // ── 15. product_commercial_image_valid — la autoridad de la 108, invocada ──
  // Migración 20260819050000. Todo lo de arriba (T1..T7, publicar/republicar)
  // ya prueba que la puerta sigue exigiendo precio+stock+imagen COMPLETA
  // cuando hay imagen — corrió contra la función NUEVA sin que se le tocara
  // una sola línea a esos casos. Acá se agrega lo que la 108 sumó y la puerta
  // vieja no sabía: que la ausencia de imagen es un estado válido, no un
  // motivo de rechazo.
  const imageValid = (sku) => psql(
    `select public.product_commercial_image_valid(p)
       from public.products p where p.business_id='${BUSINESS_ID}' and p.sku='${sku}';`,
  ).stdout;

  const asset2 = seedRows[1].assetId; // el activo REAL de "dos", para el préstamo ajeno.

  // 15.1 · CASO A — sin imagen, producto por lo demás válido → PASS.
  psql(`
    insert into public.products
      (business_id, external_id, sku, name, brand, category, subcategory,
       variant, presentation, capacity_value, capacity_unit, capacity, packaging_type,
       units_per_pack, sold_as_pack, price, stock, is_active, available, is_verified,
       is_alcoholic, minimum_age, catalog_origin, sort_order)
    values
      ('${BUSINESS_ID}', 'taba-image-gate-caso-a', 'taba-image-gate-caso-a',
       'Producto sin imagen', 'Marca', 'Gaseosas', 'cola', '500 ml', '500 ml',
       500, 'ml', '500 ml', 'Botella PET', 1, false, 2290, 0, true, false, false,
       false, null, 'commercial', 0);
  `);
  check('15.1 · CASO A (6 columnas de imagen en null) → product_commercial_image_valid = true',
    imageValid('taba-image-gate-caso-a') === 't', imageValid('taba-image-gate-caso-a'));
  applyBatch([{ sku: 'taba-image-gate-caso-a', stock: 24, publish: true }]);
  check('15.1b · publicar SIN imagen, con precio y stock reales, funciona (era el bloqueo real)',
    productState('taba-image-gate-caso-a') === '2290.00|24|true|true',
    productState('taba-image-gate-caso-a'));

  // 15.2 · CASO B — imagen completa y aprobada → PASS. Usa el asset REAL que
  // ya quedó ligado a "uno" al sembrar el catálogo (packshot legítimo).
  check('15.2 · CASO B (imagen completa, asset real ligado) → product_commercial_image_valid = true',
    imageValid(uno) === 't', imageValid(uno));

  // 15.3 · 1 de 6 columnas de imagen pobladas → FAIL. Sólo se puede insertar
  // así con is_verified=false (con true, products_verified_publication_authority
  // ya lo rechazaría antes de llegar a esta prueba — la tabla protege lo mismo
  // por su lado, y esto prueba que la función dice lo mismo que la tabla).
  psql(`
    insert into public.products
      (business_id, external_id, sku, name, brand, category, subcategory,
       variant, presentation, capacity_value, capacity_unit, capacity, packaging_type,
       units_per_pack, sold_as_pack, price, stock, is_active, available, is_verified,
       is_alcoholic, minimum_age, catalog_origin, sort_order, image_url)
    values
      ('${BUSINESS_ID}', 'taba-image-gate-parcial', 'taba-image-gate-parcial',
       'Producto con imagen a medias', 'Marca', 'Gaseosas', 'cola', '500 ml', '500 ml',
       500, 'ml', '500 ml', 'Botella PET', 1, false, 2290, 10, true, false, false,
       false, null, 'commercial', 0, 'assets/products/huerfano-deadbeef-deadbeef.webp');
  `);
  check('15.3 · 1 de 6 columnas (sólo image_url) → product_commercial_image_valid = false',
    imageValid('taba-image-gate-parcial') === 'f', imageValid('taba-image-gate-parcial'));
  const parcial = applyBatch([{ sku: 'taba-image-gate-parcial', publish: true }], { expectFailure: true });
  check('15.3b · publicar con imagen a medias rechazado', parcial.status !== 0,
    parcial.stderr.split('\n').find((l) => l.includes('ERROR')) || '');

  // 15.4 · asset ajeno — imagen con el formato perfecto, pero el catalog_asset_id
  // (real, existente) y los hashes son los de OTRO producto (los de "dos").
  // Es la versión alcanzable de "asset inexistente": la FK
  // products_catalog_asset_id_fkey ya hace estructuralmente imposible apuntar a
  // un id que no existe en catalog_assets, así que el peligro real —y el que
  // esta prueba mide— es apuntar a uno que SÍ existe pero no es el propio: el
  // mismo riesgo que "una imagen de pack usada como unidad".
  psql(`
    insert into public.products
      (business_id, external_id, sku, name, brand, category, subcategory,
       variant, presentation, capacity_value, capacity_unit, capacity, packaging_type,
       units_per_pack, sold_as_pack, price, stock, is_active, available, is_verified,
       is_alcoholic, minimum_age, catalog_origin, sort_order,
       image_url, image_sha256, image_thumbnail_url, image_thumbnail_sha256,
       source_image_sha256, catalog_asset_id)
    select '${BUSINESS_ID}', 'taba-image-gate-ajeno', 'taba-image-gate-ajeno',
           'Producto con foto prestada', 'Marca', 'Gaseosas', 'cola', '500 ml', '500 ml',
           500, 'ml', '500 ml', 'Botella PET', 1, false, 2290, 10, true, false, false,
           false, null, 'commercial', 0,
           ca.master_path, ca.master_sha256, ca.thumbnail_path, ca.thumbnail_sha256,
           ca.source_sha256, ca.id
      from public.catalog_assets ca where ca.id = '${asset2}';
  `);
  check('15.4 · asset real pero de OTRO sku/producto → product_commercial_image_valid = false',
    imageValid('taba-image-gate-ajeno') === 'f', imageValid('taba-image-gate-ajeno'));
  const ajeno = applyBatch([{ sku: 'taba-image-gate-ajeno', publish: true }], { expectFailure: true });
  check('15.4b · publicar con la foto de otro producto rechazado', ajeno.status !== 0,
    ajeno.stderr.split('\n').find((l) => l.includes('ERROR')) || '');
  const fkAsset = psql(
    `update public.products set catalog_asset_id = gen_random_uuid()
       where business_id='${BUSINESS_ID}' and sku='taba-image-gate-ajeno';`,
    { expectFailure: true },
  );
  check('15.4c · un catalog_asset_id que no existe en absoluto ya lo bloquea la FK, antes de llegar a esta función',
    fkAsset.status !== 0, fkAsset.stderr.split('\n').find((l) => l.includes('ERROR') || l.includes('violat')) || '');

  // 15.5 · alcohol — el gate de imagen y el de alcohol son ortogonales. Un
  // producto CON alcohol y SIN imagen (la forma real de los 23 con alcohol que
  // ya viven en producción) tiene que poder publicarse igual, sin que la
  // categoría/edad mínima interfieran con la pregunta de imagen ni al revés.
  psql(`
    insert into public.products
      (business_id, external_id, sku, name, brand, category, subcategory,
       variant, presentation, capacity_value, capacity_unit, capacity, packaging_type,
       units_per_pack, sold_as_pack, price, stock, is_active, available, is_verified,
       is_alcoholic, minimum_age, catalog_origin, sort_order)
    values
      ('${BUSINESS_ID}', 'taba-image-gate-alcohol', 'taba-image-gate-alcohol',
       'Cerveza sin foto', 'Marca', 'Cervezas', 'lager', 'Lata 473 ml', 'Lata 473 ml',
       473, 'ml', '473 ml', 'lata', 1, false, 2650, 0, true, false, false,
       true, 18, 'commercial', 0);
  `);
  check('15.5 · con alcohol y sin imagen → product_commercial_image_valid sigue siendo true',
    imageValid('taba-image-gate-alcohol') === 't', imageValid('taba-image-gate-alcohol'));
  applyBatch([{ sku: 'taba-image-gate-alcohol', stock: 12, publish: true }]);
  check('15.5b · publicar cerveza sin imagen funciona; el gate de alcohol (edad/categoría) sigue exigido aparte',
    productState('taba-image-gate-alcohol') === '2650.00|12|true|true',
    productState('taba-image-gate-alcohol'));

  // ── 16. CONTROL NEGATIVO ESPECÍFICO — los 4 SKU minoristas reales ──────────
  // No usa los SKU reales ni sus GTIN: reproduce la MISMA forma que hoy tienen
  // en producción (catalog_origin=commercial, sold_as_pack=false,
  // units_per_pack=1, is_verified=true YA, stock=0, available=false, las 6
  // columnas de imagen en null) y demuestra que pueden pasar a stock>0 y
  // available=true por la puerta comercial, sin tocar ni una columna de
  // imagen.
  psql(`
    insert into public.products
      (business_id, external_id, sku, name, brand, category, subcategory,
       variant, presentation, capacity_value, capacity_unit, capacity, packaging_type,
       units_per_pack, sold_as_pack, price, price_status, stock, chilled, is_alcoholic,
       minimum_age, sort_order, tags, catalog_origin, is_active,
       is_verified, verified_at, verified_by, available, updated_at)
    values
      ('${BUSINESS_ID}', 'espejo-coca-cola-original-pet-500ml', 'espejo-coca-cola-original-pet-500ml',
       'Coca-Cola Original', 'Coca-Cola', 'Gaseosas', 'Cola', '500 ml', '500 ml',
       500, 'ml', '500 ml', 'Botella PET', 1, false,
       2290, 'confirmed', 0, false, false, null, 0, array[]::text[], 'commercial', true,
       true, now(), '${OWNER_ID}', false, now());
  `);
  const espejoAntes = productState('espejo-coca-cola-original-pet-500ml');
  check('16.1 · el espejo arranca IDÉNTICO al estado real de los 4 SKU: stock 0, no disponible, ya verificado',
    espejoAntes === '2290.00|0|false|true', espejoAntes);
  const imagenAntes = psql(
    `select coalesce(image_url,'∅')||'|'||coalesce(catalog_asset_id::text,'∅')
       from public.products where business_id='${BUSINESS_ID}' and sku='espejo-coca-cola-original-pet-500ml';`,
  ).stdout;

  // Recepción de mercadería real: sólo stock, ninguna columna de imagen.
  applyBatch([{ sku: 'espejo-coca-cola-original-pet-500ml', stock: 24, publish: true }]);
  const espejoDespues = productState('espejo-coca-cola-original-pet-500ml');
  const imagenDespues = psql(
    `select coalesce(image_url,'∅')||'|'||coalesce(catalog_asset_id::text,'∅')
       from public.products where business_id='${BUSINESS_ID}' and sku='espejo-coca-cola-original-pet-500ml';`,
  ).stdout;
  check('16.2 · CONTROL NEGATIVO: stock 0/no-disponible → stock 24/disponible, SIN foto',
    espejoDespues === '2290.00|24|true|true', `${espejoAntes} → ${espejoDespues}`);
  check('16.3 · y las columnas de imagen no se tocaron: siguen las 6 en null (∅|∅)',
    imagenAntes === '∅|∅' && imagenDespues === '∅|∅', `${imagenAntes} → ${imagenDespues}`);

  // ── 17. set_commercial_product_publication (20260819060000) ───────────────
  psql(`
    insert into auth.users (id, instance_id, aud, role, email, encrypted_password, created_at, updated_at)
    values
      ('${ADMIN_ID}', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'admin@drill.local', '', now(), now()),
      ('${STAFF_ID}', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'staff@drill.local', '', now(), now()),
      ('${OUTSIDER_ID}', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'outsider@drill.local', '', now(), now())
    on conflict (id) do nothing;
    insert into public.business_members (business_id, user_id, role, is_active)
    values
      ('${BUSINESS_ID}', '${ADMIN_ID}', 'admin', true),
      ('${BUSINESS_ID}', '${STAFF_ID}', 'staff', true)
    on conflict do nothing;
  `);
  const adminRegistro = asUser(ADMIN_ID, ADMIN_SESSION, `select public.identity_register_session('${BUSINESS_ID}'::uuid, 'panel_web');`);
  const staffRegistro = asUser(STAFF_ID, STAFF_SESSION, `select public.identity_register_session('${BUSINESS_ID}'::uuid, 'panel_web');`);
  check('17.0 · sesiones de admin y staff registradas (outsider queda deliberadamente sin business_members; UNREGISTERED_SESSION deliberadamente nunca se registra)',
    /"ok"\s*:\s*true/.test(adminRegistro.stdout) && /"ok"\s*:\s*true/.test(staffRegistro.stdout),
    `${adminRegistro.stdout} · ${staffRegistro.stdout}`);

  psql(`
    insert into public.products
      (business_id, external_id, sku, name, brand, category, subcategory,
       variant, presentation, capacity_value, capacity_unit, capacity, packaging_type,
       units_per_pack, sold_as_pack, price, price_status, stock, chilled, is_alcoholic,
       minimum_age, sort_order, tags, catalog_origin, is_active,
       is_verified, verified_at, verified_by, available, updated_at)
    values
      (${lit(BUSINESS_ID)}, 'taba-publish-ready', 'taba-publish-ready', 'Publicar Listo', 'Marca', 'Gaseosas', 'cola',
       '500 ml', '500 ml', 500, 'ml', '500 ml', 'Botella PET', 1, false,
       2290, 'confirmed', 24, false, false, null, 0, array[]::text[], 'commercial', true,
       true, now(), ${lit(OWNER_ID)}, false, now()),
      (${lit(BUSINESS_ID)}, 'taba-publish-nostock', 'taba-publish-nostock', 'Publicar Sin Stock', 'Marca', 'Gaseosas', 'cola',
       '500 ml', '500 ml', 500, 'ml', '500 ml', 'Botella PET', 1, false,
       2290, 'confirmed', 0, false, false, null, 0, array[]::text[], 'commercial', true,
       true, now(), ${lit(OWNER_ID)}, false, now()),
      (${lit(BUSINESS_ID)}, 'taba-publish-partial-image', 'taba-publish-partial-image', 'Publicar Parcial', 'Marca', 'Gaseosas', 'cola',
       '500 ml', '500 ml', 500, 'ml', '500 ml', 'Botella PET', 1, false,
       2290, 'confirmed', 10, false, false, null, 0, array[]::text[], 'commercial', true,
       true, now(), ${lit(OWNER_ID)}, false, now()),
      (${lit(BUSINESS_ID)}, 'taba-publish-unverified', 'taba-publish-unverified', 'Publicar Sin Verificar', 'Marca', 'Gaseosas', 'cola',
       '500 ml', '500 ml', 500, 'ml', '500 ml', 'Botella PET', 1, false,
       2290, 'confirmed', 10, false, false, null, 0, array[]::text[], 'commercial', true,
       false, null, null, false, now()),
      (${lit(BUSINESS_ID)}, 'taba-publish-alcohol', 'taba-publish-alcohol', 'Publicar Alcohol', 'Marca', 'Cervezas', 'lager',
       'Lata 473 ml', 'Lata 473 ml', 473, 'ml', '473 ml', 'lata', 1, false,
       2650, 'confirmed', 12, false, true, 18, 0, array[]::text[], 'commercial', true,
       true, now(), ${lit(OWNER_ID)}, false, now());
    update public.products set image_url = 'assets/products/huerfano-a1b2c3d4e5f6a1b2.webp'
     where business_id=${lit(BUSINESS_ID)} and sku='taba-publish-partial-image';

    insert into public.products
      (business_id, external_id, sku, name, brand, category, subcategory,
       variant, presentation, capacity_value, capacity_unit, capacity, packaging_type,
       units_per_pack, sold_as_pack, price, price_status, stock, chilled, is_alcoholic,
       minimum_age, sort_order, tags, catalog_origin, is_active,
       is_verified, verified_at, verified_by, available, updated_at,
       image_url, image_sha256, image_thumbnail_url, image_thumbnail_sha256, source_image_sha256, catalog_asset_id)
    select ${lit(BUSINESS_ID)}, 'taba-publish-foreign-asset', 'taba-publish-foreign-asset', 'Publicar Foto Prestada', 'Marca', 'Gaseosas', 'cola',
       '500 ml', '500 ml', 500, 'ml', '500 ml', 'Botella PET', 1, false,
       2290, 'confirmed', 10, false, false, null, 0, array[]::text[], 'commercial', true,
       true, now(), ${lit(OWNER_ID)}, false, now(),
       ca.master_path, ca.master_sha256, ca.thumbnail_path, ca.thumbnail_sha256, ca.source_sha256, ca.id
      from public.catalog_assets ca where ca.id = ${lit(asset2)};
  `);
  check('17.1 · productos de prueba sembrados para la matriz de publicación', true, '6 filas nuevas');
  // El UPDATE de arriba (sólo image_url, sobre una fila ya is_verified=true) pasa
  // por `products_fail_close_master_change` (20260725110000): cualquier cambio a
  // un dato maestro —image_url incluido— de una fila verificada la desverifica en
  // el mismo movimiento. Por eso NO se puede construir "verificado + imagen a
  // medias" ni con una fila real: es un estado inalcanzable por cualquier vía de
  // escritura, no sólo por esta RPC. La prueba de "1 de 6 → false" en la función
  // pura ya está en 15.3 (con is_verified=false, la única forma de que esa fila
  // exista); acá lo que queda demostrado es la otra mitad: aunque la imagen esté a
  // medias, el motivo real de rechazo para publicar es "no verificado" — y con eso
  // ninguna publicación revive un producto a medio configurar.
  const diagPartial = psql(`select is_verified, coalesce(image_url,'∅'), coalesce(catalog_asset_id::text,'∅')
      from public.products where business_id=${lit(BUSINESS_ID)} and sku='taba-publish-partial-image';`).stdout;
  check('17.1-diag · el trigger fail-close ya desverificó la fila al tocar image_url (prueba que ese estado no sobrevive)',
    diagPartial.startsWith('f|'), diagPartial);

  // ── 18. matriz de roles ─────────────────────────────────────────────────
  const ownerPublish = callPublication(OWNER_ID, SESSION_ID, 'taba-publish-ready', true);
  check('18.1 · owner publica', ownerPublish.status === 0 && ownerPublish.stdout.includes('taba-publish-ready|t|'), ownerPublish.stdout);
  callPublication(OWNER_ID, SESSION_ID, 'taba-publish-ready', false);

  const adminPublish = callPublication(ADMIN_ID, ADMIN_SESSION, 'taba-publish-ready', true);
  check('18.2 · admin publica (el contrato lo permite: mismo array [owner,admin] que apply_commercial_catalog_batch)',
    adminPublish.status === 0 && adminPublish.stdout.includes('taba-publish-ready|t|'), adminPublish.stdout);
  callPublication(OWNER_ID, SESSION_ID, 'taba-publish-ready', false);

  const staffPublish = callPublication(STAFF_ID, STAFF_SESSION, 'taba-publish-ready', true, { expectFailure: true });
  check('18.3 · staff sin permiso → FAIL (products.publish no está en STAFF_CAPABILITIES)', staffPublish.status !== 0,
    staffPublish.stderr.split('\n').find((l) => l.includes('ERROR')) || '');

  const outsiderPublish = callPublication(OUTSIDER_ID, OUTSIDER_SESSION, 'taba-publish-ready', true, { expectFailure: true });
  check('18.4 · rider/customer (sin business_members para este negocio) → FAIL', outsiderPublish.status !== 0,
    outsiderPublish.stderr.split('\n').find((l) => l.includes('ERROR')) || '');

  const unregisteredPublish = callPublication(OWNER_ID, UNREGISTERED_SESSION, 'taba-publish-ready', true, { expectFailure: true });
  check('18.5 · owner real pero con session_id nunca registrado en identity_sessions → FAIL', unregisteredPublish.status !== 0,
    unregisteredPublish.stderr.split('\n').find((l) => l.includes('ERROR')) || '');

  // ── 19. matriz de estado del producto ──────────────────────────────────
  const nostock = callPublication(OWNER_ID, SESSION_ID, 'taba-publish-nostock', true, { expectFailure: true });
  check('19.1 · stock 0 → FAIL', nostock.status !== 0, nostock.stderr.split('\n').find((l) => l.includes('ERROR')) || '');

  const withStock = callPublication(OWNER_ID, SESSION_ID, 'taba-publish-ready', true);
  check('19.2 · stock >0 + sin imagen (6 NULL) + verificado + precio confirmado → PASS',
    withStock.status === 0 && withStock.stdout.includes('|t|'), withStock.stdout);

  // "Verificado + imagen a medias" no es una fila que pueda existir (ver 17.1-diag):
  // el trigger fail-close ya la desverificó al escribir sólo image_url. Publicarla
  // igual rechaza — por la compuerta de verificación, la que corresponde para una
  // fila que de hecho no está verificada — y la prueba de que la FUNCIÓN de imagen
  // en sí misma dice `false` ante 1 de 6 columnas está en 15.3, con una fila que si
  // puede existir en ese estado (is_verified=false).
  const partialImage = callPublication(OWNER_ID, SESSION_ID, 'taba-publish-partial-image', true, { expectFailure: true });
  check('19.3 · metadata de imagen parcial (inalcanzable ya verificada; rechaza igual, por no-verificado) → FAIL',
    partialImage.status !== 0, partialImage.stderr.split('\n').find((l) => l.includes('ERROR')) || '');

  const foreignAsset = callPublication(OWNER_ID, SESSION_ID, 'taba-publish-foreign-asset', true, { expectFailure: true });
  check('19.4 · asset inválido/ajeno (formato perfecto, pero de otro producto) → FAIL', foreignAsset.status !== 0,
    foreignAsset.stderr.split('\n').find((l) => l.includes('ERROR')) || '');

  const unverified = callPublication(OWNER_ID, SESSION_ID, 'taba-publish-unverified', true, { expectFailure: true });
  check('19.5 · is_verified=false → FAIL, y el mensaje dirige a verificar primero (esta RPC nunca verifica)',
    unverified.status !== 0 && /not verified yet/.test(unverified.stderr), unverified.stderr.split('\n').find((l) => l.includes('ERROR')) || '');

  const alcoholBlocked = callPublication(OWNER_ID, SESSION_ID, 'taba-publish-alcohol', true, { expectFailure: true });
  check('19.6 · alcohol sin alcohol_sales_enabled → FAIL con el mensaje de la compuerta de licencia',
    alcoholBlocked.status !== 0 && /license gate/.test(alcoholBlocked.stderr), alcoholBlocked.stderr.split('\n').find((l) => l.includes('ERROR')) || '');

  // ── 20. ocultar, y qué NO toca ─────────────────────────────────────────
  const antesOcultar = productSnapshot('taba-publish-ready');
  const hide = callPublication(OWNER_ID, SESSION_ID, 'taba-publish-ready', false);
  check('20.1 · ocultar → PASS', hide.status === 0 && hide.stdout.includes('|f|'), hide.stdout);
  const despuesOcultar = productSnapshot('taba-publish-ready');
  check('20.2 · ocultar no toca precio ni stock, sólo available',
    antesOcultar.split('|').slice(0, 2).join('|') === despuesOcultar.split('|').slice(0, 2).join('|'),
    `${antesOcultar} → ${despuesOcultar}`);

  const finalReady = productSnapshot('taba-publish-ready');
  check('20.3 · precio/stock de taba-publish-ready siguen 2290.00|24 tras publicar/ocultar varias veces',
    finalReady.startsWith('2290.00|24|'), finalReady);

  const alcoholFlagAntes = psql(`select alcohol_sales_enabled from public.businesses where id=${lit(BUSINESS_ID)};`).stdout;
  callPublication(OWNER_ID, SESSION_ID, 'taba-publish-alcohol', true, { expectFailure: true });
  const alcoholFlagDespues = psql(`select alcohol_sales_enabled from public.businesses where id=${lit(BUSINESS_ID)};`).stdout;
  check('20.4 · alcohol_sales_enabled del negocio no se mueve — no se puede habilitar alcohol por esta vía, ni por accidente',
    alcoholFlagAntes === alcoholFlagDespues, `${alcoholFlagAntes} → ${alcoholFlagDespues}`);

  const otroAntes = productSnapshot('taba-publish-alcohol');
  callPublication(OWNER_ID, SESSION_ID, 'taba-publish-ready', true);
  callPublication(OWNER_ID, SESSION_ID, 'taba-publish-ready', false);
  const otroDespues = productSnapshot('taba-publish-alcohol');
  check('20.5 · publicar/ocultar taba-publish-ready no toca ningún otro producto',
    otroAntes === otroDespues, `${otroAntes} → ${otroDespues}`);
} catch (error) {
  check('el simulacro completó sin excepciones', false, String(error.message || error).split('\n')[0]);
} finally {
  cleanup();
}

console.log('');
const failed = checks.filter((entry) => !entry.ok);
console.log(`${checks.length - failed.length}/${checks.length} OK`);
if (failed.length) {
  for (const entry of failed) console.log(`  - ${entry.name}: ${entry.detail}`);
  process.exitCode = 1;
}
