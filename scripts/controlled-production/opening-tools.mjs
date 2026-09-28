// Herramientas compartidas de la apertura del comercio real (CONTROLLED_PRODUCTION).
//
// La regla de todo este directorio: el script NO decide qué falta. Pregunta a
// `get_store_opening_readiness` —la misma RPC que lee el Panel— y lo traduce con
// `js/core/store-opening-readiness.js`, así la terminal y el Panel dicen
// exactamente lo mismo. Lo único propio de acá son las pruebas técnicas (que la
// web y la base respondan y que lo anónimo siga cerrado), que el Panel no ve.
//
// Nunca imprime claves, tokens ni correos.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createClient } from '@supabase/supabase-js';
import { loadTargetKeys } from './target-keys.mjs';
import { openingItemMark, presentOpeningReadiness } from '../../js/core/store-opening-readiness.js';

export const CP_REF = 'tkanbadcglszlcyfjvpv';
export const CP_SITE = 'https://la-taba-commercial-pilot.pages.dev';
export const REAL_BUSINESS_SLUG = 'la-taba-cp';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const OPTIONS = { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SLUG = /^[a-z0-9][a-z0-9-]{1,79}$/;

/** Lee `--nombre valor` sin sorpresas: un flag sin valor es un error, no un vacío. */
export function readOption(args, name, fallback = '') {
  const index = args.indexOf(name);
  if (index < 0) return fallback;
  const value = args[index + 1];
  if (value === undefined || value.startsWith('--')) throw Error(`${name} necesita un valor.`);
  return value;
}

export function parseMinProducts(args, fallback = 1) {
  const raw = readOption(args, '--min-products', String(fallback));
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 1 || value > 500) throw Error('--min-products va de 1 a 500.');
  return value;
}

/** Clientes de CP: servicio (sólo en la máquina del operador) y anónimo. */
export async function connectControlledProduction({ requireSecret = true } = {}) {
  const keys = await loadTargetKeys('controlled-production', { requireSecret });
  assert.equal(keys.ref, CP_REF, 'WRONG_TARGET');
  return {
    keys,
    admin: requireSecret ? createClient(keys.url, keys.secret, OPTIONS) : null,
    anon: createClient(keys.url, keys.publishable, OPTIONS),
  };
}

/** El comercio por su identificador legible (`la-taba-cp`) o por su id. */
export async function resolveBusiness(admin, reference = REAL_BUSINESS_SLUG) {
  const value = String(reference || '').trim();
  if (!UUID.test(value) && !SLUG.test(value)) throw Error('BUSINESS_REFERENCE_INVALID');
  const query = admin.from('businesses').select('id,slug,name,status,qa_fixture');
  const { data, error } = await (UUID.test(value) ? query.eq('id', value) : query.eq('slug', value)).maybeSingle();
  if (error) throw Error(`BUSINESS_READ:${error.code || 'ERROR'}`);
  if (!data) throw Error('BUSINESS_NOT_FOUND');
  return data;
}

export async function readOpeningReadiness(client, businessId, minProducts = 1) {
  const { data, error } = await client.rpc('get_store_opening_readiness', {
    p_business_id: businessId, p_min_products: minProducts,
  });
  if (error) throw Error(`READINESS_RPC:${error.code || 'ERROR'}`);
  return data;
}

/** El reporte en texto: una línea por compuerta, y qué hacer con lo pendiente. */
export function renderOpeningLines(presented, { verbose = false } = {}) {
  const lines = [];
  for (const group of presented.groups) {
    lines.push('', group.label.toUpperCase());
    for (const item of group.items) {
      if (item.status === 'na' && !verbose) continue;
      lines.push(`${openingItemMark(item)} ${item.title.padEnd(34)} ${item.reason}`);
      if (item.action && item.status !== 'pass') {
        lines.push(`    → ${item.action}${item.where ? ` · ${item.where}` : ''}`);
      }
    }
  }
  return lines;
}

/** El formato estable para máquinas y evidencia: code, title, reason, action, where_to_fix. */
export function openingReportJson(payload, presented, extra = {}) {
  return {
    at: new Date().toISOString(),
    business: payload.business,
    min_products: payload.min_products,
    verdict: presented.canOpen ? 'READY' : 'BLOCKED',
    commercial_ready: presented.commercialReady,
    can_open: presented.canOpen,
    accepting_orders: presented.accepting,
    blockers: presented.pending.map((item) => ({
      code: item.code, title: item.title, reason: item.reason, action: item.action, where_to_fix: item.where,
    })),
    items: presented.items.map((item) => ({
      code: item.code, group: item.group, status: item.status, blocking: item.blocking, title: item.title,
      reason: item.reason, action: item.action, where_to_fix: item.where,
    })),
    counts: payload.counts,
    ...extra,
  };
}

// ── Pruebas técnicas ──────────────────────────────────────────────────────────
// Lo que el comercio no ve y tiene que estar bien antes de que importe lo demás.
// Todas son de lectura: ninguna escribe en CP.

async function rpcAnswer(client, name, args) {
  try {
    const { error } = await client.rpc(name, args);
    return { exists: !error || error.code !== 'PGRST202', code: error?.code || 'OK' };
  } catch (_) {
    return { exists: false, code: 'NETWORK' };
  }
}

const NONE = '00000000-0000-4000-8000-000000000000';

export async function technicalChecks({ anon, admin, businessId, site = CP_SITE, fetchImpl = fetch, runPulse = true }) {
  const checks = [];
  const add = (id, label, ok, detail) => checks.push({ id, label, ok: Boolean(ok), detail });

  // Sistema: la web publicada responde con su versión y la base con la preparación.
  let version = null;
  try {
    const response = await fetchImpl(`${site}/version.json?t=${Date.now()}`, { cache: 'no-store', signal: AbortSignal.timeout(20_000) });
    version = response.ok ? await response.json() : null;
  } catch (_) { version = null; }
  let readiness = null;
  try { readiness = await readOpeningReadiness(admin, businessId, 1); } catch (_) { readiness = null; }
  add('SYSTEM', 'Sistema', Boolean(version?.commit) && Boolean(readiness?.items),
    `web ${String(version?.commit || '?').slice(0, 7)}${version?.runtime ? ` (${version.runtime})` : ''} · base ${readiness?.items ? 'responde' : 'sin respuesta'}`);

  // Seguridad: lo anónimo no lee la preparación, no verifica y no ve pedidos.
  const anonReadiness = await rpcAnswer(anon, 'get_store_opening_readiness', { p_business_id: businessId, p_min_products: 1 });
  const anonVerify = await rpcAnswer(anon, 'platform_verify_business_ordering', {
    p_business_id: businessId, p_verifier_email: 'nadie@example.invalid', p_confirm_slug: 'x', p_min_products: 1, p_note: null,
  });
  const anonOrders = await anon.from('orders').select('id').eq('business_id', businessId).limit(1);
  const ordersClosed = Boolean(anonOrders.error) || (Array.isArray(anonOrders.data) && anonOrders.data.length === 0);
  add('SECURITY', 'Seguridad', anonReadiness.code !== 'OK' && anonVerify.code !== 'OK' && ordersClosed,
    `anónimo: preparación ${anonReadiness.code === 'OK' ? 'ABIERTA' : 'cerrada'} · verificación ${anonVerify.code === 'OK' ? 'ABIERTA' : 'cerrada'} · pedidos ${ordersClosed ? 'no visibles' : 'VISIBLES'}`);

  // Pedidos: el alta existe y exige un cliente autenticado.
  const order = await rpcAnswer(anon, 'create_order_with_items', { payload: {} });
  add('ORDERS', 'Pedidos', order.exists && order.code !== 'OK', `alta de pedidos ${order.exists ? 'presente y cerrada sin sesión' : 'AUSENTE'}`);

  // Rider: la bandeja del repartidor existe y exige sesión.
  const rider = await rpcAnswer(anon, 'get_rider_delivery_board', {});
  add('RIDER_BACKEND', 'Rider backend', rider.exists && rider.code !== 'OK', `bandeja del repartidor ${rider.exists ? 'presente' : 'AUSENTE'}`);

  // Pago manual: el registro del cobro existe y la base lo ofrece siempre.
  const manual = await rpcAnswer(anon, 'confirm_manual_order_payment', {
    p_order_id: NONE, p_expected_revision: 0, p_actual_method: 'cash', p_idempotency_key: 'opening-check-probe',
  });
  const manualItem = readiness?.items?.find((item) => item.code === 'PAYMENT_MANUAL');
  add('MANUAL_PAYMENT', 'Pago manual', manual.exists && manualItem?.status === 'pass',
    `efectivo y transferencia a coordinar ${manual.exists ? 'disponibles' : 'SIN REGISTRO DE COBRO'}`);

  // Operación: el pulso operativo (sólo lectura) sobre el mismo comercio.
  if (runPulse) {
    const pulse = spawnSync(process.execPath, [path.join(ROOT, 'scripts/controlled-production/ops-pulse.mjs'),
      '--target', 'controlled-production', '--business-id', businessId, '--hours', '24'],
    { cwd: ROOT, encoding: 'utf8', timeout: 180_000, windowsHide: true });
    let status = 'SIN RESPUESTA';
    try { status = JSON.parse(pulse.stdout).status || status; } catch (_) { /* salida no JSON */ }
    add('OPERATIONS', 'Operación', pulse.status === 0 && status === 'HEALTHY', `pulso operativo ${status}`);
  }
  return { checks, readiness, version };
}

export function presentFrom(payload) {
  return presentOpeningReadiness(payload);
}
