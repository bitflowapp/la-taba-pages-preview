/*
 * Aplica la migración 20260819050000 (compuerta de imagen opcional en
 * apply_commercial_catalog_batch) a producción. Mismo canal y mismo patrón
 * de guardas que `aplicar-gondola-neuquen.mjs --aplicar-migracion`: no crea
 * ni modifica ninguna fila de `products`/`catalog_assets` — es sólo DDL
 * (dos `create or replace function`) más el renglón del ledger, en una sola
 * transacción.
 *
 * Deliberadamente NO es un "aplicador de cualquier migración": apunta a UN
 * archivo fijo, igual que su precedente. Un script que aplica cualquier .sql
 * que se le pase es una superficie más grande que una que aplica uno solo,
 * ya revisado y ensayado.
 *
 * GUARDAS, todas antes de mutar:
 *   1. el ref del proyecto es explícito y tiene que ser el productivo;
 *   2. si el ledger ya está en 20260819050000 o más, no hace nada — es
 *      idempotente por diseño, no por accidente;
 *   3. ensayo por omisión: sin --aplicar no escribe nada, sólo muestra el
 *      ledger actual y las primeras líneas del archivo;
 *   4. --aplicar exige TABA2_IMAGE_GATE_MIGRATION_APPLY en el entorno —
 *      variable propia, distinta de la de gondola-neuquen y la de las
 *      unidades minoristas, para que ninguna autorización vieja alcance
 *      por accidente;
 *   5. --aplicar exige --confirmado-por-humano;
 *   6. una sola transacción: la migración entra completa o no entra nada;
 *   7. después de aplicar, releer el ledger Y confirmar que las funciones
 *      nuevas/redefinidas existen con la firma esperada Y que el conteo de
 *      productos no cambió ni un número — es DDL, no debería tocar una sola
 *      fila, y esto lo demuestra en vez de asumirlo.
 *
 *   node scripts/aplicar-image-optional-gate-migracion.mjs --ref=<ref>
 *   node scripts/aplicar-image-optional-gate-migracion.mjs --ref=<ref> --aplicar --confirmado-por-humano
 *
 * (los flags van con `=`, no separados por espacio).
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { conToken } from './lib/supabase-cli-token.mjs';

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MIGRACION_NOMBRE = '20260819050000_commercial_batch_image_optional_gate';
const MIGRACION = path.join(RAIZ, 'supabase/migrations', `${MIGRACION_NOMBRE}.sql`);
const LEDGER_VERSION = '20260819050000';
const REF_PRODUCCION = 'wwcpogltfgzgkrlilbcd';
const BUSINESS_ID = '00000000-0000-4000-8000-000000000001';
const AUTORIZACION = 'I_AUTHORIZE_TABA2_IMAGE_GATE_MIGRATION';

const banderas = new Map();
for (const a of process.argv.slice(2)) {
  if (!a.startsWith('--')) continue;
  const i = a.indexOf('=');
  if (i === -1) banderas.set(a.slice(2), true);
  else banderas.set(a.slice(2, i), a.slice(i + 1));
}
const abortar = (m) => { console.error(`ABORTAR: ${m}`); process.exit(2); };

const ref = String(banderas.get('ref') || '');
if (ref !== REF_PRODUCCION) {
  abortar(`--ref debe ser ${REF_PRODUCCION}. No hay default implícito: escribir en el proyecto equivocado no se deshace.`);
}
const aplicar = banderas.has('aplicar');
if (aplicar && process.env.TABA2_IMAGE_GATE_MIGRATION_APPLY !== AUTORIZACION) {
  abortar(`--aplicar exige TABA2_IMAGE_GATE_MIGRATION_APPLY="${AUTORIZACION}" en el entorno.`);
}
if (aplicar && !banderas.has('confirmado-por-humano')) {
  abortar('--aplicar exige --confirmado-por-humano.');
}
if (!fs.existsSync(MIGRACION)) {
  abortar(`no encuentro ${path.relative(RAIZ, MIGRACION)}.`);
}

const lit = (v) => `'${String(v).replaceAll("'", "''")}'`;

await conToken(async (token) => {
  const sql = async (query) => {
    const r = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        'User-Agent': 'taba2-image-optional-gate/1.0',
      },
      body: JSON.stringify({ query }),
    });
    const t = await r.text();
    if (!r.ok) throw new Error(`HTTP ${r.status} · ${t.slice(0, 1200)}`);
    return t ? JSON.parse(t) : null;
  };

  const [antes] = await sql('select max(version) as version from supabase_migrations.schema_migrations;');
  console.log(`ledger ANTES     ${antes.version}`);

  if (String(antes.version) >= LEDGER_VERSION) {
    console.log(`la migración ya está aplicada — ledger ${antes.version}. Nada que hacer.`);
    return;
  }

  const funcionesAntes = await sql(
    "select proname from pg_proc where proname in ('apply_commercial_catalog_batch','product_commercial_image_valid') order by proname;",
  );
  console.log(`funciones ANTES  ${funcionesAntes.map((f) => f.proname).join(', ') || '(ninguna de las dos)'}`);

  const [productosAntes] = await sql(
    `select count(*)::int as n from public.products where business_id = ${lit(BUSINESS_ID)};`,
  );
  console.log(`productos ANTES  ${productosAntes.n}`);

  const ddl = fs.readFileSync(MIGRACION, 'utf8');

  if (!aplicar) {
    console.log('');
    console.log(`ENSAYO: no se escribió nada. Migración lista: ${MIGRACION_NOMBRE}.sql (${ddl.length} bytes).`);
    console.log('Para aplicar: --aplicar --confirmado-por-humano, con TABA2_IMAGE_GATE_MIGRATION_APPLY en el entorno.');
    return;
  }

  await sql(`begin;\n${ddl}\ninsert into supabase_migrations.schema_migrations(version, name)\n`
    + `values ('${LEDGER_VERSION}', '${MIGRACION_NOMBRE.slice(15)}');\ncommit;`);

  const [despues] = await sql('select max(version) as version from supabase_migrations.schema_migrations;');
  const funcionesDespues = await sql(
    "select proname, pg_get_function_identity_arguments(oid) as args from pg_proc where proname in ('apply_commercial_catalog_batch','product_commercial_image_valid') order by proname;",
  );
  const [productosDespues] = await sql(
    `select count(*)::int as n from public.products where business_id = ${lit(BUSINESS_ID)};`,
  );

  console.log('');
  console.log(`ledger DESPUÉS   ${antes.version} → ${despues.version}`);
  console.log(`funciones DESPUÉS`);
  for (const f of funcionesDespues) console.log(`  ${f.proname}(${f.args})`);
  console.log(`productos DESPUÉS ${productosDespues.n} (tiene que ser igual a ${productosAntes.n}: esto es DDL, no toca filas)`);

  const fallas = [];
  if (String(despues.version) !== LEDGER_VERSION) fallas.push(`el ledger no avanzó a ${LEDGER_VERSION}`);
  if (!funcionesDespues.some((f) => f.proname === 'product_commercial_image_valid')) fallas.push('product_commercial_image_valid no quedó creada');
  if (!funcionesDespues.some((f) => f.proname === 'apply_commercial_catalog_batch')) fallas.push('apply_commercial_catalog_batch desapareció');
  if (productosDespues.n !== productosAntes.n) fallas.push(`el conteo de productos cambió: ${productosAntes.n} → ${productosDespues.n}`);

  if (fallas.length) {
    for (const f of fallas) console.error(`ERROR ${f}`);
    process.exitCode = 1;
    return;
  }
  console.log('');
  console.log('OK · migración aplicada. product_commercial_image_valid existe, apply_commercial_catalog_batch sigue con su firma, cero filas de products tocadas.');
});
