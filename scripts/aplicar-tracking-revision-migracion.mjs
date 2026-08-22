/*
 * Aplica la migración 20260822210000 a producción: que una lectura del cliente
 * deje de subir la revisión del pedido y, con eso, deje de invalidar la oferta
 * viva del repartidor.
 *
 * Mismo canal y mismas guardas que aplicar-publication-toggle-migracion.mjs.
 * Es SÓLO DDL —un `create or replace function`— más el renglón del ledger, en
 * una sola transacción. No toca ni una fila de `orders`, y lo comprueba.
 *
 * Deliberadamente NO es un «aplicador de cualquier migración»: apunta a UN
 * archivo fijo.
 *
 * GUARDAS, todas antes de mutar:
 *   1. el ref del proyecto es explícito y tiene que ser el productivo;
 *   2. si el ledger ya está en 20260822210000 o más, no hace nada;
 *   3. la función que se va a reemplazar tiene que existir y tener HOY el
 *      defecto —el UPDATE sin condición—; si ya está arreglada, no se toca;
 *   4. ensayo por omisión: sin --aplicar no escribe nada;
 *   5. --aplicar exige TABA2_TRACKING_REVISION_APPLY en el entorno;
 *   6. --aplicar exige --confirmado-por-humano;
 *   7. una sola transacción;
 *   8. después: el ledger avanzó, la función nueva tiene la condición, y NI UNA
 *      revisión de pedido se movió.
 *
 *   node scripts/aplicar-tracking-revision-migracion.mjs --ref=<ref>
 *   node scripts/aplicar-tracking-revision-migracion.mjs --ref=<ref> --aplicar --confirmado-por-humano
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { conToken } from './lib/supabase-cli-token.mjs';

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MIGRACION_NOMBRE = '20260822210000_tracking_recovery_keeps_order_revision';
const MIGRACION = path.join(RAIZ, 'supabase/migrations', `${MIGRACION_NOMBRE}.sql`);
const LEDGER_VERSION = '20260822210000';
const REF_PRODUCCION = 'wwcpogltfgzgkrlilbcd';
const AUTORIZACION = 'I_AUTHORIZE_TABA2_TRACKING_REVISION_MIGRATION';
const FUNCION = 'recover_order_tracking_access';
const CONDICION = 'delivery_code_required is distinct from true';
/*
 * Y el regex del token, que NO es un detalle. La migración 20260725130000 ya
 * había corregido `{32,256}` —PostgreSQL no acepta repeticiones mayores a 255 y
 * la función levantaba `2201B` en cada llamada— y reescribir el cuerpo desde el
 * archivo donde la función nació revirtió ese arreglo sin que nada estático lo
 * notara. Por eso acá se comprueban las DOS propiedades, y «ya aplicada» sólo
 * cuenta si las dos están.
 */
const REGEX_SANO = '{32,255}[A-Za-z0-9_-]?';
const REGEX_ROTO = '{32,256}';

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
  abortar(`--ref debe ser ${REF_PRODUCCION}. No hay default implícito.`);
}
const aplicar = banderas.has('aplicar');
if (aplicar && process.env.TABA2_TRACKING_REVISION_APPLY !== AUTORIZACION) {
  abortar(`--aplicar exige TABA2_TRACKING_REVISION_APPLY="${AUTORIZACION}" en el entorno.`);
}
if (aplicar && !banderas.has('confirmado-por-humano')) {
  abortar('--aplicar exige --confirmado-por-humano.');
}
if (!fs.existsSync(MIGRACION)) abortar(`no encuentro ${path.relative(RAIZ, MIGRACION)}.`);

await conToken(async (token) => {
  const sql = async (query) => {
    const r = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        'User-Agent': 'taba2-tracking-revision/1.0',
      },
      body: JSON.stringify({ query }),
    });
    const t = await r.text();
    if (!r.ok) throw new Error(`HTTP ${r.status} · ${t.slice(0, 1200)}`);
    return t ? JSON.parse(t) : null;
  };

  const [antes] = await sql('select max(version) as version from supabase_migrations.schema_migrations;');
  console.log(`ledger ANTES      ${antes.version}`);

  const [definicionAntes] = await sql(
    `select pg_get_functiondef(oid) as cuerpo from pg_proc where proname = '${FUNCION}' limit 1;`,
  );
  if (!definicionAntes?.cuerpo) abortar(`la función ${FUNCION} no existe en producción.`);
  const cuerpoAntes = String(definicionAntes.cuerpo);
  const tieneCondicion = cuerpoAntes.includes(CONDICION);
  const regexSano = cuerpoAntes.includes(REGEX_SANO) && !cuerpoAntes.includes(REGEX_ROTO);
  console.log(`condición ANTES   ${tieneCondicion ? 'puesta' : 'AUSENTE (el defecto original)'}`);
  console.log(`regex ANTES       ${regexSano ? 'sano' : 'ROTO ({32,256} no compila en PostgreSQL)'}`);

  if (tieneCondicion && regexSano) {
    console.log('la función ya está bien en producción, con las dos propiedades. No se toca nada.');
    return;
  }
  if (String(antes.version) >= LEDGER_VERSION && tieneCondicion && regexSano) {
    console.log(`la migración ya está aplicada — ledger ${antes.version}. Nada que hacer.`);
    return;
  }

  const [revisiones] = await sql(
    'select count(*)::int as pedidos, coalesce(sum(revision), 0)::bigint as suma from public.orders;',
  );
  console.log(`pedidos ANTES     ${revisiones.pedidos} · suma de revisiones ${revisiones.suma}`);

  const ddl = fs.readFileSync(MIGRACION, 'utf8');
  if (!aplicar) {
    console.log('');
    console.log(`ENSAYO: no se escribió nada. Migración lista: ${MIGRACION_NOMBRE}.sql (${ddl.length} bytes).`);
    console.log('Para aplicar: --aplicar --confirmado-por-humano, con TABA2_TRACKING_REVISION_APPLY en el entorno.');
    return;
  }

  /*
   * El renglón del ledger sólo se escribe si no está. Esta migración puede
   * tener que volver a correr sobre un ledger que ya la nombra: pasó el mismo
   * 2026-08-22, cuando la primera aplicación dejó la condición puesta pero
   * revirtió sin querer el arreglo del regex del token. Reparar no es avanzar.
   */
  const yaEnElLedger = String(antes.version) >= LEDGER_VERSION;
  const renglon = yaEnElLedger
    ? ''
    : `insert into supabase_migrations.schema_migrations(version, name)\n`
      + `values ('${LEDGER_VERSION}', '${MIGRACION_NOMBRE.slice(15)}');\n`;
  console.log(yaEnElLedger ? 'ledger: ya nombra esta migración; se REPARA la función' : 'ledger: se agrega el renglón');
  await sql(`begin;\n${ddl}\n${renglon}commit;`);

  const [despues] = await sql('select max(version) as version from supabase_migrations.schema_migrations;');
  const [definicionDespues] = await sql(
    `select pg_get_functiondef(oid) as cuerpo from pg_proc where proname = '${FUNCION}' limit 1;`,
  );
  const [revisionesDespues] = await sql(
    'select count(*)::int as pedidos, coalesce(sum(revision), 0)::bigint as suma from public.orders;',
  );

  console.log('');
  console.log(`ledger DESPUÉS    ${antes.version} → ${despues.version}`);
  console.log(`función DESPUÉS   ${String(definicionDespues?.cuerpo || '').includes(CONDICION) ? 'con la condición puesta' : 'SIN la condición'}`);
  console.log(`pedidos DESPUÉS   ${revisionesDespues.pedidos} · suma de revisiones ${revisionesDespues.suma}`);

  const cuerpoDespues = String(definicionDespues?.cuerpo || '');
  console.log(`regex DESPUÉS     ${cuerpoDespues.includes(REGEX_SANO) && !cuerpoDespues.includes(REGEX_ROTO) ? 'sano' : 'ROTO'}`);
  const fallas = [];
  if (String(despues.version) !== LEDGER_VERSION) fallas.push(`el ledger no avanzó a ${LEDGER_VERSION}`);
  if (!cuerpoDespues.includes(CONDICION)) fallas.push('la función no quedó con la condición');
  if (!cuerpoDespues.includes(REGEX_SANO) || cuerpoDespues.includes(REGEX_ROTO)) {
    fallas.push('el regex del token quedó roto: PostgreSQL no acepta repeticiones mayores a 255');
  }
  if (revisionesDespues.pedidos !== revisiones.pedidos) fallas.push('cambió la cantidad de pedidos');
  if (String(revisionesDespues.suma) !== String(revisiones.suma)) {
    fallas.push('se movió alguna revisión de pedido: esto es DDL y no puede tocar filas');
  }
  if (fallas.length) {
    console.error(`\nFALLA: ${fallas.join(' · ')}`);
    process.exit(1);
  }
  console.log('\nAPLICADA. Una lectura del cliente ya no sube la revisión del pedido.');
});
