/*
 * Cuenta, SIN ESCRIBIR NADA, cuantos checkouts reales de staging llegaron a
 * Mercado Pago y nunca se volvieron pedido: la poblacion que el barrido de
 * verdad del proveedor (20260809180000) va a empezar a mirar.
 *
 * Solo SELECT a traves de PostgREST. No llama a ninguna funcion que escriba
 * -ni refresh_operational_alerts, ni enqueue_checkout_provider_probes-, no crea
 * pedidos y no toca el ledger de migraciones. Se puede correr con el lock de
 * staging tomado por otra sesion.
 *
 *   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... node scripts/measure-staging-orphan-checkouts.mjs
 */
import { createClient } from '@supabase/supabase-js';

const URL = String(process.env.SUPABASE_URL || '').trim();
const SERVICE = String(process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
if (!URL || !SERVICE) { console.error('Faltan SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY.'); process.exit(2); }
if (/la-taba-demo/.test(URL)) { console.error('Nunca corre contra la-taba-demo.'); process.exit(2); }

const db = createClient(URL, SERVICE, { auth: { autoRefreshToken: false, persistSession: false } });

const { data: intents, error } = await db
  .from('payment_intents')
  .select('id, checkout_session_id, internal_status, provider_status, provider_payment_id, preference_id, external_reference, order_id, created_at')
  .order('created_at', { ascending: false })
  .limit(1000);
if (error) { console.error(`lectura fallida: ${error.message}`); process.exit(1); }

const { data: sesiones, error: errorSesiones } = await db
  .from('checkout_sessions')
  .select('id, status, total, expires_at, created_at, completed_order_id, manual_review_reason')
  .order('created_at', { ascending: false })
  .limit(1000);
if (errorSesiones) { console.error(`lectura fallida: ${errorSesiones.message}`); process.exit(1); }

const porSesion = new Map(sesiones.map((s) => [s.id, s]));
const TERMINALES_DE_DINERO = new Set(['completed', 'refunded', 'partially_refunded', 'charged_back']);

const llegaronAlProveedor = intents.filter((i) => i.preference_id);
const sinPedido = llegaronAlProveedor.filter((i) => {
  const s = porSesion.get(i.checkout_session_id);
  return !i.order_id && s && !s.completed_order_id;
});
// La poblacion exacta que el barrido va a consultar.
const sondeables = sinPedido.filter((i) =>
  !TERMINALES_DE_DINERO.has(i.internal_status)
  && i.internal_status !== 'security_review_required'
  && i.external_reference);
// El caso invisible: nunca supimos nada del proveedor.
const nuncaConfirmados = sondeables.filter((i) => !i.provider_payment_id);
// Cobrado y sin pedido: hoy visible solo si el estado quedo en revision.
const cobradosSinPedido = sinPedido.filter((i) => i.provider_status === 'approved');

const porEstado = {};
for (const i of sinPedido) porEstado[i.internal_status] = (porEstado[i.internal_status] || 0) + 1;

const dinero = sondeables.reduce((total, i) => {
  const s = porSesion.get(i.checkout_session_id);
  return total + Number(s?.total || 0);
}, 0);

console.log('MEDICION DE STAGING — SOLO LECTURA, CERO ESCRITURAS\n');
console.log(`payment_intents leidos ................... ${intents.length}`);
console.log(`  llegaron a Mercado Pago (preference) ... ${llegaronAlProveedor.length}`);
console.log(`  de esos, sin pedido .................... ${sinPedido.length}`);
console.log(`  el barrido nuevo los consultaria ....... ${sondeables.length}`);
console.log(`  NUNCA confirmados por el proveedor ..... ${nuncaConfirmados.length}  <- hoy invisibles`);
console.log(`  cobrados y sin pedido .................. ${cobradosSinPedido.length}`);
console.log(`  monto en juego de los consultables ..... $${dinero.toFixed(2)}`);
console.log('\nsin pedido, por estado interno:');
for (const [estado, n] of Object.entries(porEstado).sort((a, b) => b[1] - a[1])) {
  console.log(`  ${estado.padEnd(30, '.')} ${n}`);
}
console.log('\nlos 10 mas recientes que el barrido tomaria (sin datos de persona):');
for (const i of sondeables.slice(0, 10)) {
  const s = porSesion.get(i.checkout_session_id);
  const vencida = s?.expires_at && new Date(s.expires_at) < new Date();
  console.log(`  ${i.created_at?.slice(0, 19)}  ${String(i.internal_status).padEnd(20)} `
    + `sesion=${String(s?.status || '?').padEnd(22)} ${vencida ? 'vencida' : 'viva   '} $${Number(s?.total || 0).toFixed(2)}`);
}
