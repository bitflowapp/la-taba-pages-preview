/*
 * Revertir un lote comercial: el paso que le faltaba al camino de la planilla.
 *
 * POR QUÉ EXISTE
 * --------------
 * `import-commercial-catalog.mjs` valida la planilla, muestra el plan y lo
 * aplica en una transacción. Desde 20261001210000 la base guarda, de cada lote,
 * la imagen de antes y de después de cada producto, y sabe deshacerlo
 * (`rollback_commercial_catalog_batch`). Lo que no había era una forma de
 * pedírselo sin escribir SQL: un precio mal cargado se arreglaba subiendo otra
 * planilla a mano, con el error vendiendo mientras tanto.
 *
 * NO DECIDE NADA POR SU CUENTA. Qué se restaura lo resuelve la base, producto
 * por producto: vuelve a la imagen anterior sólo donde nadie cambió precio,
 * estado del precio, intención del comercio o verificación después del lote; lo
 * que cambió después se informa y no se pisa; el stock nunca se restaura a
 * ciegas; un alta no se borra. Esta herramienta muestra el lote y después
 * muestra, tal cual, lo que la base contestó.
 *
 *   node scripts/rollback-commercial-catalog.mjs --list                      # los últimos lotes
 *   node scripts/rollback-commercial-catalog.mjs <lote>                      # qué cambió ese lote (no escribe)
 *   node scripts/rollback-commercial-catalog.mjs <lote> --apply --target supabase
 *
 * Usa las mismas credenciales que el importador: SUPABASE_URL, la clave
 * publicable, el token de un dueño o encargado en SUPABASE_ACCESS_TOKEN y
 * TABA_BUSINESS_ID. Antes de leer nada dice contra qué proyecto y qué comercio
 * va a trabajar.
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readCommercialCredentials } from './import-commercial-catalog.mjs';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** Los lotes que la base sabe revertir. Una publicación suelta o una reversión no lo son. */
export const REVERSIBLE_SOURCES = Object.freeze(['commercial_batch', 'commercial_plan']);

const SOURCE_LABELS = Object.freeze({
  commercial_batch: 'lote del Panel',
  commercial_plan: 'planilla',
  publication: 'publicación',
  unpublish: 'despublicación',
  verification: 'verificación',
  scanned_product: 'producto escaneado',
  rollback: 'reversión',
});

// El orden en que se muestran los campos de la imagen de un producto.
const IMAGE_FIELDS = Object.freeze([
  ['price', 'precio'],
  ['price_status', 'estado del precio'],
  ['stock', 'stock disponible'],
  ['merchant_available', 'el comercio lo ofrece'],
  ['available', 'a la venta'],
  ['is_verified', 'verificado'],
]);

const OUTCOME_LABELS = Object.freeze({
  restored: 'RESTAURADO',
  skipped_changed: 'NO SE TOCÓ (cambió después del lote)',
  skipped_created: 'NO SE TOCÓ (es un alta: no se borra)',
  unchanged: 'SIN CAMBIO (el lote no lo había movido)',
});

export function parseRollbackArgs(args = []) {
  const known = ['--list', '--apply', '--target', '--limit', '--json'];
  const unknown = args.filter((argument) => argument.startsWith('--') && !known.includes(argument));
  if (unknown.length) throw new Error(`Flag desconocido: ${unknown[0]}.`);
  const valueOf = (flag) => {
    const index = args.indexOf(flag);
    if (index < 0) return '';
    const value = args[index + 1];
    if (!value || value.startsWith('--')) throw new Error(`${flag} requiere un valor.`);
    return value;
  };
  const target = valueOf('--target');
  const limitRaw = valueOf('--limit');
  const limit = limitRaw ? Number(limitRaw) : 20;
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new Error('--limit tiene que ser un entero entre 1 y 100.');
  const positionals = args.filter((argument, index) => (
    !argument.startsWith('--') && args[index - 1] !== '--target' && args[index - 1] !== '--limit'
  ));
  const list = args.includes('--list');
  const apply = args.includes('--apply');
  const json = args.includes('--json');
  if (list) {
    if (apply) throw new Error('--list no escribe: no se combina con --apply.');
    if (positionals.length) throw new Error('--list no lleva lote.');
    return { mode: 'list', limit, json };
  }
  if (positionals.length !== 1) throw new Error('Indicá exactamente un lote, o --list para verlos.');
  if (!UUID.test(positionals[0])) throw new Error('El lote es un UUID: copialo de --list o de la salida del importador.');
  if (apply && !target) {
    throw new Error('--apply exige --target: revertir sin decir dónde es exactamente lo que esta herramienta evita.');
  }
  if (apply && target !== 'supabase') {
    throw new Error(`Destino «${target}» desconocido. El único destino es --target supabase.`);
  }
  return { mode: apply ? 'apply' : 'preview', batchId: positionals[0].toLowerCase(), json };
}

function unwrap(response, what) {
  if (response?.error) throw new Error(`No se pudo leer ${what}: ${response.error.message || 'error desconocido'}`);
  return response?.data;
}

/** Los últimos lotes del comercio, con cuántos productos tocó cada uno. Sólo lectura. */
export async function listCatalogBatches(client, businessId, { limit = 20 } = {}) {
  const batches = unwrap(await client.from('catalog_change_batches')
    .select('id, source, created_at, rolled_back_at, rollback_batch_id, reverts_batch_id')
    .eq('business_id', businessId)
    .order('created_at', { ascending: false })
    .limit(limit), 'los lotes') || [];
  if (!batches.length) return [];
  const items = unwrap(await client.from('catalog_change_items')
    .select('batch_id, action')
    .in('batch_id', batches.map((batch) => batch.id)), 'los productos de los lotes') || [];
  const counts = new Map();
  for (const item of items) {
    const entry = counts.get(item.batch_id) || { products: 0, moved: 0 };
    entry.products += 1;
    // Un producto que la reversión dejó como estaba (`skipped_*`) no cuenta como movido.
    if (['created', 'updated', 'restored'].includes(item.action)) entry.moved += 1;
    counts.set(item.batch_id, entry);
  }
  return batches.map((batch) => ({ ...batch, ...(counts.get(batch.id) || { products: 0, moved: 0 }) }));
}

/** Un lote con la imagen de antes y de después de cada producto. Sólo lectura. */
export async function readCatalogBatch(client, businessId, batchId) {
  const rows = unwrap(await client.from('catalog_change_batches')
    .select('id, source, created_at, rolled_back_at, rollback_batch_id, reverts_batch_id')
    .eq('business_id', businessId)
    .eq('id', batchId)
    .limit(1), 'el lote') || [];
  if (!rows.length) return null;
  const items = unwrap(await client.from('catalog_change_items')
    .select('sku, action, before, after')
    .eq('batch_id', batchId)
    .order('id', { ascending: true }), 'los productos del lote') || [];
  return { batch: rows[0], items };
}

export async function rollbackCatalogBatch(client, businessId, batchId) {
  if (typeof client?.rpc !== 'function') throw new Error('Cliente Supabase inválido.');
  const response = await client.rpc('rollback_commercial_catalog_batch', {
    p_business_id: businessId,
    p_batch_id: batchId,
  });
  if (response?.error) {
    throw new Error(`El servidor no revirtió el lote: ${response.error.message || 'error desconocido'}`);
  }
  const result = response?.data;
  if (!result || typeof result !== 'object' || result.ok !== true) {
    throw new Error('El servidor contestó algo que no es el resultado de una reversión; no se da por hecha.');
  }
  return result;
}

const shown = (value) => (value === null || value === undefined ? '(vacío)' : String(value));

/** Qué movió el lote en un producto: sólo los campos cuya imagen cambió. */
export function imageChanges(before, after) {
  if (!before || typeof before !== 'object') return [];
  return IMAGE_FIELDS
    .filter(([field]) => JSON.stringify(before[field] ?? null) !== JSON.stringify((after || {})[field] ?? null))
    .map(([field, label]) => ({ field, label, before: before[field] ?? null, after: (after || {})[field] ?? null }));
}

export function describeBatches(batches = []) {
  if (!batches.length) return ['No hay lotes registrados para este comercio.'];
  return batches.map((batch) => {
    const kind = SOURCE_LABELS[batch.source] || batch.source;
    const state = batch.rolled_back_at
      ? `revertido el ${batch.rolled_back_at}`
      : REVERSIBLE_SOURCES.includes(batch.source) ? 'se puede revertir' : 'no es un lote reversible';
    return `  ${batch.id}  ${batch.created_at}  ${kind} · ${batch.moved} de ${batch.products} producto(s) cambiaron · ${state}`;
  });
}

export function describeBatchItems({ batch, items = [] }) {
  const lines = [];
  const kind = SOURCE_LABELS[batch.source] || batch.source;
  lines.push(`Lote ${batch.id} (${kind}), aplicado el ${batch.created_at}.`);
  if (batch.rolled_back_at) lines.push(`Ya fue revertido el ${batch.rolled_back_at}: pedirlo de nuevo devuelve aquel resultado, sin tocar nada.`);
  if (!REVERSIBLE_SOURCES.includes(batch.source)) {
    lines.push('Este cambio no es un lote comercial ni una planilla: la base no lo revierte.');
  }
  lines.push('');
  const moved = items.filter((item) => item.action === 'updated' && imageChanges(item.before, item.after).length);
  const created = items.filter((item) => item.action === 'created');
  const still = items.length - moved.length - created.length;
  if (moved.length) {
    lines.push(`LO QUE EL LOTE CAMBIÓ (${moved.length}) — la reversión vuelve a la izquierda sólo si el producto sigue como a la derecha:`);
    for (const item of moved) {
      lines.push(`  ${item.sku || '(sin SKU)'}`);
      for (const change of imageChanges(item.before, item.after)) {
        lines.push(`      ${change.label}: ${shown(change.before)} → ${shown(change.after)}`);
      }
    }
  } else {
    lines.push('El lote no cambió la imagen de ningún producto existente.');
  }
  if (created.length) {
    lines.push('');
    lines.push(`ALTAS DEL LOTE (${created.length}) — no se borran: quedan como estén.`);
    lines.push(`  ${created.map((item) => item.sku || '(sin SKU)').join(', ')}`);
  }
  if (still > 0) {
    lines.push('');
    lines.push(`Sin cambio en el lote: ${still} producto(s).`);
  }
  return lines;
}

export function renderRollbackResult(result) {
  const lines = [];
  lines.push(result.replay
    ? 'El lote ya estaba revertido: este es el resultado de aquella reversión. No se tocó nada ahora.'
    : `Reversión registrada como lote ${result.batch_id}.`);
  lines.push(`  restaurados ................. ${Number(result.restored ?? 0)}`);
  lines.push(`  no tocados (cambiaron) ...... ${Number(result.skipped_changed ?? 0)}`);
  lines.push(`  no tocados (altas) .......... ${Number(result.skipped_created ?? 0)}`);
  lines.push(`  sin cambio .................. ${Number(result.unchanged ?? 0)}`);
  if (Number(result.holds_reopened ?? 0)) lines.push(`  vuelven a quedar retenidos .. ${Number(result.holds_reopened)}`);
  if (Number(result.off_sale_intent_on ?? 0)) lines.push(`  fuera de venta con intención  ${Number(result.off_sale_intent_on)}`);
  const items = Array.isArray(result.items) ? result.items : [];
  if (items.length) lines.push('');
  for (const item of items) {
    const outcome = OUTCOME_LABELS[item.outcome] || String(item.outcome || '');
    const details = [];
    if (Array.isArray(item.changed_fields) && item.changed_fields.length) details.push(`cambió: ${item.changed_fields.join(', ')}`);
    if (item.stock) details.push(`stock: ${item.stock}`);
    if (item.publication) details.push(`publicación: ${item.publication}`);
    if (item.hold) details.push(`retención: ${item.hold}`);
    lines.push(`  ${item.sku || '(sin SKU)'} — ${outcome}${details.length ? ` · ${details.join(' · ')}` : ''}`);
    lines.push(`      queda: precio ${shown(item.price)} (${shown(item.price_status)}), stock disponible ${shown(item.available_stock)}, a la venta ${shown(item.available)}`);
  }
  return lines;
}

export async function runRollback(options, { client, businessId, out = console.log } = {}) {
  if (options.mode === 'list') {
    const batches = await listCatalogBatches(client, businessId, { limit: options.limit });
    if (options.json) out(JSON.stringify(batches, null, 2));
    else for (const line of describeBatches(batches)) out(line);
    return { mode: 'list', batches: batches.length };
  }
  const found = await readCatalogBatch(client, businessId, options.batchId);
  if (!found) throw new Error('Ese lote no existe para este comercio (o esta cuenta no puede verlo).');
  if (options.mode === 'preview') {
    if (options.json) out(JSON.stringify(found, null, 2));
    else {
      for (const line of describeBatchItems(found)) out(line);
      out('');
      out('No se escribió nada. Para revertir: --apply --target supabase');
    }
    return { mode: 'preview', items: found.items.length };
  }
  if (!REVERSIBLE_SOURCES.includes(found.batch.source)) {
    throw new Error('Ese cambio no es un lote comercial ni una planilla: la base no lo revierte.');
  }
  const result = await rollbackCatalogBatch(client, businessId, options.batchId);
  if (options.json) out(JSON.stringify(result, null, 2));
  else for (const line of renderRollbackResult(result)) out(line);
  return { mode: 'apply', restored: Number(result.restored ?? 0), replay: result.replay === true };
}

async function main(args) {
  let options;
  try {
    options = parseRollbackArgs(args);
  } catch (error) {
    console.error(`ERROR ${error.message}`);
    console.error('Uso: node scripts/rollback-commercial-catalog.mjs --list | <lote> [--apply --target supabase]');
    process.exitCode = 2;
    return;
  }
  try {
    const { url, publishableKey, accessToken, businessId } = readCommercialCredentials(process.env);
    // Con --json la salida estándar es SÓLO el dato: esta línea va a stderr.
    console.error(`Proyecto: ${new URL(url).hostname} · comercio ${businessId} · ${options.mode === 'apply' ? 'REVERSIÓN' : 'sólo lectura'}`);
    const { createClient } = await import('@supabase/supabase-js');
    const client = createClient(url, publishableKey, {
      auth: { autoRefreshToken: false, detectSessionInUrl: false, persistSession: false },
      global: { headers: { Authorization: `Bearer ${accessToken}` } },
    });
    await runRollback(options, { client, businessId });
  } catch (error) {
    console.error(`ERROR ${error.message}`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  await main(process.argv.slice(2));
}
