/*
 * Aplica a PRODUCCIÓN la curación de sort_order generada por
 * scripts/generar-curacion-sort-order.mjs (artifacts/.../curacion-sort-order.sql).
 *
 * SÓLO sort_order. Exige la misma autorización por entorno que el lote de altas
 * más --confirmado-por-humano; espera 72 productos (el lote de altas ya
 * aplicado); toma un snapshot de price/stock/available/is_verified de los 72
 * ANTES y lo compara byte a byte DESPUÉS, porque la única columna que puede
 * moverse es sort_order. Verifica que la secuencia final sea exactamente la
 * del preview (72 valores distintos, 10..720) y que Gaseosas arranque por las
 * botellas familiares.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { BUSINESS_ID } from '../catalog/gondola-retail-final-proposal.mjs';
import { conToken } from './lib/supabase-cli-token.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const REF_PRODUCCION = 'wwcpogltfgzgkrlilbcd';
const AUTORIZACION = 'I_AUTHORIZE_TABA2_GONDOLA_RETAIL_FINAL_PRODUCTION_INSERT';
const SQL_PATH = path.join(ROOT, 'artifacts', 'taba2-gondola-retail-final', 'curacion-sort-order.sql');

const banderas = new Map();
for (const a of process.argv.slice(2)) {
  if (!a.startsWith('--')) continue;
  const i = a.indexOf('=');
  if (i === -1) banderas.set(a.slice(2), true);
  else banderas.set(a.slice(2, i), a.slice(i + 1));
}
const abortar = (m) => { console.error(`ABORTAR: ${m}`); process.exit(2); };
if (String(banderas.get('ref') || '') !== REF_PRODUCCION) abortar(`--ref debe ser ${REF_PRODUCCION}.`);
const aplicar = banderas.has('aplicar');
if (aplicar && process.env.TABA2_GONDOLA_RETAIL_FINAL_PRODUCTION_APPLY !== AUTORIZACION) abortar('falta la autorización por entorno.');
if (aplicar && !banderas.has('confirmado-por-humano')) abortar('--aplicar exige --confirmado-por-humano.');

const sqlTexto = readFileSync(SQL_PATH, 'utf8');
const asignaciones = [...sqlTexto.matchAll(/set sort_order = (\d+), updated_at = now\(\) where business_id = '[^']+' and external_id = '([^']+)'/g)]
  .map((m) => ({ external_id: m[2], sort_order: Number(m[1]) }));
if (asignaciones.length !== 72) abortar(`el SQL trae ${asignaciones.length} asignaciones y se esperaban 72.`);
if (/\b(insert|delete|drop|alter|truncate)\b/i.test(sqlTexto.replace(/--[^\n]*/g, ''))) abortar('el SQL contiene algo que no es UPDATE de sort_order.');
const lit = (v) => `'${String(v).replaceAll("'", "''")}'`;

await conToken(async (token) => {
  const sql = async (query) => {
    const r = await fetch(`https://api.supabase.com/v1/projects/${REF_PRODUCCION}/database/query`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', 'User-Agent': 'taba2-curacion-sort-order/1.0' },
      body: JSON.stringify({ query }),
    });
    const t = await r.text();
    if (!r.ok) throw new Error(`HTTP ${r.status} · ${t.slice(0, 1200)}`);
    return t ? JSON.parse(t) : null;
  };
  const snapshot = () => sql(`select external_id, price::text as price, stock, available, is_verified, is_active, image_url, sort_order
      from public.products where business_id = ${lit(BUSINESS_ID)} order by external_id;`);

  const antes = await snapshot();
  console.log(`ANTES   ${antes.length} productos · sort_order distintos: ${new Set(antes.map((p) => p.sort_order)).size}`);
  if (antes.length !== 72) abortar(`producción tiene ${antes.length} productos; la curación espera 72.`);
  const faltan = asignaciones.filter((a) => !antes.some((p) => p.external_id === a.external_id));
  if (faltan.length) abortar(`${faltan.length} SKU del SQL no existen en producción: ${faltan.map((f) => f.external_id).join(', ')}`);

  if (!aplicar) {
    console.log('ENSAYO: no se escribió nada. 72 asignaciones listas; --aplicar --confirmado-por-humano para escribir.');
    return;
  }
  await sql(sqlTexto);
  const despues = await snapshot();
  const fallas = [];
  for (let i = 0; i < antes.length; i += 1) {
    const a = antes[i]; const d = despues[i];
    if (a.external_id !== d.external_id) { fallas.push(`desalineado en ${i}`); break; }
    for (const campo of ['price', 'stock', 'available', 'is_verified', 'is_active', 'image_url']) {
      if (String(a[campo]) !== String(d[campo])) fallas.push(`${a.external_id}: ${campo} cambió ${a[campo]} → ${d[campo]}`);
    }
    const esperado = asignaciones.find((x) => x.external_id === a.external_id)?.sort_order;
    if (d.sort_order !== esperado) fallas.push(`${a.external_id}: sort_order ${d.sort_order} ≠ ${esperado}`);
  }
  const valores = despues.map((p) => p.sort_order);
  if (new Set(valores).size !== 72) fallas.push('los 72 sort_order no son distintos');
  const gaseosas = despues.filter((p) => ['coca-cola-original-2250ml', 'coca-cola-original-pet-1500ml', 'coca-cola-original-botella-pet-500-ml-pack-x12', 'coca-cola-original-pet-500ml', 'coca-cola-original-lata-354ml'].includes(p.external_id))
    .sort((x, y) => x.sort_order - y.sort_order).map((p) => p.external_id);
  const ordenEsperado = ['coca-cola-original-2250ml', 'coca-cola-original-pet-1500ml', 'coca-cola-original-botella-pet-500-ml-pack-x12', 'coca-cola-original-pet-500ml', 'coca-cola-original-lata-354ml'];
  if (JSON.stringify(gaseosas) !== JSON.stringify(ordenEsperado)) fallas.push(`la línea Coca-Cola Original no quedó familiar-primero: ${gaseosas.join(' > ')}`);
  console.log(`DESPUÉS ${despues.length} productos · sort_order distintos: ${new Set(valores).size} · min ${Math.min(...valores)} · max ${Math.max(...valores)}`);
  console.log(`Coca-Cola Original: ${gaseosas.join(' > ')}`);
  if (fallas.length) {
    for (const f of fallas) console.error(`ERROR ${f}`);
    process.exitCode = 1;
    return;
  }
  console.log('OK · curación aplicada: sólo sort_order cambió, 72 valores distintos, familiar-primero verificado.');
});
