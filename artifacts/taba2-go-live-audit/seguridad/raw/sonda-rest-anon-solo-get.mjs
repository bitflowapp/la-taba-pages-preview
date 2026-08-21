// Sonda READ-ONLY del camino real PostgREST con rol anon (clave publishable).
// SÓLO peticiones GET: sin signup, sin RPC, sin escrituras de ningún tipo.
// Reemplaza la parte de lectura de production-security-smoke.mjs, que no se
// corre en esta auditoría porque crea y borra una identidad en producción.
import fs from 'node:fs';

const cfg = fs.readFileSync(
  'artifacts/taba2-go-live-audit/seguridad/raw/cliente/descargas/runtime-config.js',
  'utf8',
);
const KEY = (cfg.match(/sb_publishable_[A-Za-z0-9_-]+/) || [])[0];
if (!KEY) { console.error('no encontré la clave publishable en runtime-config.js'); process.exit(2); }
const BASE = 'https://wwcpogltfgzgkrlilbcd.supabase.co';

const TABLAS_CERRADAS = [
  'orders', 'order_items', 'order_events', 'customers', 'customer_addresses',
  'rider_profiles', 'rider_locations', 'rider_order_offers', 'payment_attempts',
  'payment_outbox', 'checkout_sessions', 'fiscal_documents', 'business_members',
  'staff_profiles', 'identity_sessions', 'operational_alerts',
  'operational_sweep_runs', 'identity_audit_events', 'business_config_audit',
  'business_command_receipts', 'order_public_tokens', 'identity_user_security',
  'payment_webhook_receipts', 'delivery_outbox', 'notification_outbox',
];
const TABLAS_VITRINA = ['products', 'businesses', 'catalog_assets', 'product_combos', 'product_barcodes'];

async function probar(tabla) {
  const r = await fetch(`${BASE}/rest/v1/${tabla}?select=*&limit=1`, {
    headers: { apikey: KEY, Authorization: `Bearer ${KEY}`, 'User-Agent': 'taba2-go-live-audit-readonly/1.0' },
  });
  const text = await r.text();
  let filas = null; let err = '';
  try {
    const body = JSON.parse(text);
    if (Array.isArray(body)) filas = body.length;
    else err = (body.code || '') + ' ' + (body.message || '').slice(0, 60);
  } catch { err = text.slice(0, 60); }
  return { tabla, status: r.status, filas, err: err.trim() };
}

console.log('--- SONDA REST anon (SÓLO GET) contra producción ---');
let fugas = 0;
console.log('· tablas que deben estar CERRADAS:');
for (const t of TABLAS_CERRADAS) {
  const r = await probar(t);
  const abierta = r.status === 200 && r.filas > 0;
  if (abierta) fugas += 1;
  console.log(`  ${abierta ? 'FUGA ' : 'ok   '} ${t.padEnd(26)} HTTP ${r.status} filas=${r.filas ?? '-'} ${r.err}`);
}
console.log('· vitrina pública (informativo):');
for (const t of TABLAS_VITRINA) {
  const r = await probar(t);
  console.log(`        ${t.padEnd(26)} HTTP ${r.status} filas=${r.filas ?? '-'} ${r.err}`);
}
console.log(fugas === 0 ? 'RESULTADO: ninguna tabla cerrada devolvió filas a anon' : `RESULTADO: ${fugas} FUGA(S)`);
process.exit(fugas === 0 ? 0 : 1);
