/*
 * Verifica las campañas PUBLICADAS contra el catálogo de producción (sólo lectura,
 * con la clave publicable que ya viaja en el navegador) o contra una instantánea.
 *
 *   npm run campaigns:verify-live                         catálogo en línea
 *   npm run campaigns:verify-live -- --snapshot=<ruta>    instantánea guardada
 *   npm run campaigns:verify-live -- --write-snapshot     refresca tests/fixtures/catalog-live.json
 *
 * Sale con código 1 si una campaña encendida y aprobada no cumple.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CAMPAIGNS } from '../../js/campaigns/campaign-config.js';
import { STORE_COLUMNS, evaluateCampaignsAgainstRows } from './live-catalog-gate.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const SNAPSHOT_PATH = path.join(ROOT, 'tests/fixtures/catalog-live.json');
const argument = (name) => process.argv.find((value) => value.startsWith(`--${name}`))?.split('=')[1] ?? (process.argv.includes(`--${name}`) ? true : null);

async function fetchLiveRows() {
  const configUrl = process.env.TABA_RUNTIME_CONFIG_URL || 'https://la-taba.pages.dev/runtime-config.js';
  const source = await (await fetch(configUrl)).text();
  const grab = (key) => source.match(new RegExp(`${key}:\\s*'([^']+)'`))?.[1];
  const supabaseUrl = grab('supabaseUrl');
  const key = grab('publishableKey');
  const businessId = grab('businessId');
  if (!supabaseUrl || !key || !businessId) throw new Error(`No pude leer la configuración pública de ${configUrl}.`);
  const url = `${supabaseUrl}/rest/v1/products?select=${STORE_COLUMNS.join(',')}&business_id=eq.${businessId}&order=sku`;
  const response = await fetch(url, { headers: { apikey: key, authorization: `Bearer ${key}` } });
  if (!response.ok) throw new Error(`El catálogo respondió ${response.status}.`);
  return { rows: await response.json(), supabaseUrl, businessId, origin: configUrl };
}

const snapshotArg = argument('snapshot');
let rows;
let supabaseUrl = '';
let businessId;
let origin;
if (typeof snapshotArg === 'string') {
  const file = JSON.parse(fs.readFileSync(path.resolve(snapshotArg), 'utf8'));
  ({ products: rows, supabaseUrl = '', businessId } = file);
  origin = `instantánea ${snapshotArg} (${file.capturedAt})`;
} else {
  ({ rows, supabaseUrl, businessId, origin } = await fetchLiveRows());
  if (argument('write-snapshot')) {
    const snapshot = {
      capturedAt: new Date().toISOString(),
      source: `Lectura de sólo lectura del catálogo público de producción (${origin}). Sólo las columnas que pide la tienda; ni costos ni autores.`,
      supabaseUrl,
      businessId,
      products: rows.map((row) => Object.fromEntries(STORE_COLUMNS.map((column) => [column, row[column] ?? null]))),
    };
    fs.writeFileSync(SNAPSHOT_PATH, `${JSON.stringify(snapshot, null, 2)}\n`);
    console.log(`Instantánea escrita: ${path.relative(ROOT, SNAPSHOT_PATH)} (${rows.length} productos).`);
  }
}

const report = await evaluateCampaignsAgainstRows(rows, CAMPAIGNS, { supabaseUrl, businessId });
console.log(`CATALOGO: ${origin}`);
console.log(`PRODUCTOS_EN_BASE: ${report.rowCount}  VISIBLES_PARA_EL_CLIENTE: ${report.catalogCount}`);
console.log(`CAMPAIGNS_LIVE_CONFIGURED: ${report.live.length}   CAMPAIGNS_PENDING: ${report.pending.length}`);
for (const entry of report.live) {
  console.log(`\n${entry.ok ? 'PASS' : 'FAIL'}  ${entry.id}  ->  ${entry.sku}`);
  if (entry.product) console.log(`      ${entry.product.name} · ${entry.product.capacity} · ${entry.product.packagingType} · $${entry.product.price} · stock ${entry.product.stock}`);
  for (const [flag, value] of Object.entries(entry.flags)) console.log(`      ${flag}: ${value ? 'YES' : 'NO'}`);
  if (entry.problems.length) console.log(`      problemas: ${entry.problems.join(', ')}`);
}
for (const entry of report.pending) console.log(`\nPENDIENTE  ${entry.id}  (${entry.approval}: ${entry.reason})`);
const failed = report.live.filter((entry) => !entry.ok);
console.log(`\nREAL_PRODUCT_GATE: ${report.live.length && !failed.length ? 'PASS' : 'FAIL'}`);
process.exit(report.live.length && !failed.length ? 0 : 1);
