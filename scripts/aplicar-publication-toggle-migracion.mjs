/*
 * Aplica la migración 20260819060000 (set_commercial_product_publication) a
 * producción. Mismo canal y mismo patrón de guardas que
 * aplicar-image-optional-gate-migracion.mjs: sólo DDL (una función nueva) más
 * el renglón del ledger, en una sola transacción. No crea ni modifica
 * ninguna fila de `products`.
 *
 * Deliberadamente NO es un "aplicador de cualquier migración": apunta a UN
 * archivo fijo.
 *
 * GUARDAS, todas antes de mutar:
 *   1. el ref del proyecto es explícito y tiene que ser el productivo;
 *   2. si el ledger ya está en 20260819060000 o más, no hace nada;
 *   3. ensayo por omisión: sin --aplicar no escribe nada;
 *   4. --aplicar exige TABA2_PUBLICATION_TOGGLE_APPLY en el entorno —
 *      variable propia, distinta de las tres anteriores;
 *   5. --aplicar exige --confirmado-por-humano;
 *   6. una sola transacción;
 *   7. después de aplicar, releer el ledger Y confirmar que
 *      set_commercial_product_publication existe con la firma esperada Y
 *      que el conteo de productos no cambió ni un número.
 *
 *   node scripts/aplicar-publication-toggle-migracion.mjs --ref=<ref>
 *   node scripts/aplicar-publication-toggle-migracion.mjs --ref=<ref> --aplicar --confirmado-por-humano
 *
 * (los flags van con `=`, no separados por espacio).
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { conToken } from './lib/supabase-cli-token.mjs';

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MIGRACION_NOMBRE = '20260819060000_commercial_product_publication_toggle';
const MIGRACION = path.join(RAIZ, 'supabase/migrations', `${MIGRACION_NOMBRE}.sql`);
const LEDGER_VERSION = '20260819060000';
const REF_PRODUCCION = 'wwcpogltfgzgkrlilbcd';
const BUSINESS_ID = '00000000-0000-4000-8000-000000000001';
const AUTORIZACION = 'I_AUTHORIZE_TABA2_PUBLICATION_TOGGLE_MIGRATION';

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
if (aplicar && process.env.TABA2_PUBLICATION_TOGGLE_APPLY !== AUTORIZACION) {
  abortar(`--aplicar exige TABA2_PUBLICATION_TOGGLE_APPLY="${AUTORIZACION}" en el entorno.`);
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
        'User-Agent': 'taba2-publication-toggle/1.0',
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
  if (String(antes.version) < '20260819050000') {
    abortar('falta 20260819050000 (product_commercial_image_valid) — esta migración la usa. Aplicar esa primero.');
  }

  const [existeAntes] = await sql(
    "select count(*)::int as n from pg_proc where proname = 'set_commercial_product_publication';",
  );
  console.log(`función ANTES    ${existeAntes.n ? 'ya existe (inesperado)' : 'no existe (esperado)'}`);

  const [productosAntes] = await sql(
    `select count(*)::int as n from public.products where business_id = ${lit(BUSINESS_ID)};`,
  );
  console.log(`productos ANTES  ${productosAntes.n}`);

  const ddl = fs.readFileSync(MIGRACION, 'utf8');

  if (!aplicar) {
    console.log('');
    console.log(`ENSAYO: no se escribió nada. Migración lista: ${MIGRACION_NOMBRE}.sql (${ddl.length} bytes).`);
    console.log('Para aplicar: --aplicar --confirmado-por-humano, con TABA2_PUBLICATION_TOGGLE_APPLY en el entorno.');
    return;
  }

  await sql(`begin;\n${ddl}\ninsert into supabase_migrations.schema_migrations(version, name)\n`
    + `values ('${LEDGER_VERSION}', '${MIGRACION_NOMBRE.slice(15)}');\ncommit;`);

  const [despues] = await sql('select max(version) as version from supabase_migrations.schema_migrations;');
  const [funcionDespues] = await sql(
    "select pg_get_function_identity_arguments(oid) as args from pg_proc where proname = 'set_commercial_product_publication';",
  );
  const [productosDespues] = await sql(
    `select count(*)::int as n from public.products where business_id = ${lit(BUSINESS_ID)};`,
  );

  console.log('');
  console.log(`ledger DESPUÉS   ${antes.version} → ${despues.version}`);
  console.log(`función DESPUÉS  set_commercial_product_publication(${funcionDespues?.args || 'AUSENTE'})`);
  console.log(`productos DESPUÉS ${productosDespues.n} (tiene que ser igual a ${productosAntes.n}: esto es DDL, no toca filas)`);

  const fallas = [];
  if (String(despues.version) !== LEDGER_VERSION) fallas.push(`el ledger no avanzó a ${LEDGER_VERSION}`);
  if (!funcionDespues) fallas.push('set_commercial_product_publication no quedó creada');
  if (productosDespues.n !== productosAntes.n) fallas.push(`el conteo de productos cambió: ${productosAntes.n} → ${productosDespues.n}`);

  if (fallas.length) {
    for (const f of fallas) console.error(`ERROR ${f}`);
    process.exitCode = 1;
    return;
  }
  console.log('');
  console.log('OK · migración aplicada. set_commercial_product_publication existe, cero filas de products tocadas.');
});
