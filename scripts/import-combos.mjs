#!/usr/bin/env node
/**
 * Importa el manifiesto de combos al contrato backend.
 *
 * El manifiesto (`js/combos-data.js`, derivado de `data/combos.csv`) declara QUÉ
 * contiene cada combo y qué descuento decidió el comercio. Nunca precios. Este
 * importador traduce eso a `product_combos` + `product_combo_components`
 * resolviendo cada SKU contra el catálogo vivo del negocio.
 *
 * Es fail-closed en lo que importa:
 *
 *   * un combo cuyo componente no existe en el catálogo del negocio NO se
 *     importa: importarlo dejaría una promesa que el mostrador no puede armar,
 *     y el motivo se reporta en vez de silenciarse;
 *   * `--approve` es explícito. Sin él los combos entran como
 *     PENDIENTE_APROBACION_COMERCIAL y la góndola no los ofrece;
 *   * nunca escribe un precio. Ni de combo ni de componente.
 *
 *   TABA_COMBOS_CONFIRM=I_UNDERSTAND_THIS_MUTATES_STAGING \
 *   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... TABA_BUSINESS_ID=... \
 *   node scripts/import-combos.mjs [--approve] [--dry-run]
 */

import { COMBO_MANIFEST } from '../js/combos-data.js';

const CONFIRMATION = 'I_UNDERSTAND_THIS_MUTATES_STAGING';
const env = (name) => String(process.env[name] || '').trim();

const SUPABASE_URL = env('SUPABASE_URL').replace(/\/+$/, '');
const SERVICE_ROLE_KEY = env('SUPABASE_SERVICE_ROLE_KEY');
const BUSINESS_ID = env('TABA_BUSINESS_ID');
const approve = process.argv.includes('--approve');
const dryRun = process.argv.includes('--dry-run');

if (env('TABA_COMBOS_CONFIRM') !== CONFIRMATION) {
  console.error(`Definí TABA_COMBOS_CONFIRM=${CONFIRMATION} para importar combos.`);
  process.exit(2);
}
for (const [name, value] of Object.entries({ SUPABASE_URL, SERVICE_ROLE_KEY, BUSINESS_ID })) {
  if (!value) {
    console.error(`Falta ${name}.`);
    process.exit(2);
  }
}
if (/(^|\.)la-taba-demo\./.test(SUPABASE_URL)) {
  console.error('El importador nunca corre contra la-taba-demo.');
  process.exit(2);
}

async function rest(pathAndQuery, init = {}) {
  const response = await fetch(`${SUPABASE_URL}/rest/v1/${pathAndQuery}`, {
    ...init,
    headers: {
      apikey: SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
      'Content-Type': 'application/json',
      ...(init.headers || {}),
    },
  });
  const text = await response.text();
  let body = null;
  try { body = text ? JSON.parse(text) : null; } catch { body = text; }
  if (!response.ok) {
    throw new Error(`${init.method || 'GET'} ${pathAndQuery} → ${response.status} ${JSON.stringify(body)}`);
  }
  return body;
}

const products = await rest(
  `products?select=id,sku,name,price,price_status,stock,available,is_active,is_verified,is_alcoholic`
  + `&business_id=eq.${BUSINESS_ID}&limit=2000`,
);
const bySku = new Map(products.filter((p) => p.sku).map((p) => [String(p.sku), p]));

const imported = [];
const skipped = [];

for (const [index, combo] of COMBO_MANIFEST.entries()) {
  const missing = combo.components
    .map((component) => component.sku)
    .filter((sku) => !bySku.has(sku));
  if (missing.length) {
    skipped.push({ comboId: combo.comboId, reason: `componentes ausentes del catálogo: ${missing.join(', ')}` });
    continue;
  }

  // Una sustitución que no está en el catálogo simplemente no se ofrece; no
  // bloquea el combo, porque el combo se puede armar igual con su componente
  // titular. Prometerla sí sería el problema.
  const row = {
    business_id: BUSINESS_ID,
    combo_id: combo.comboId,
    name: combo.name,
    tagline: combo.tagline || null,
    description: combo.description || null,
    category_id: combo.categoryId || null,
    terms: combo.terms || null,
    discount_percentage: combo.discountPercentage,
    price_rounding: 100,
    is_active: true,
    sort_order: index,
    approval_status: approve ? 'APROBADO_COMERCIAL' : 'PENDIENTE_APROBACION_COMERCIAL',
    approved_at: approve ? new Date().toISOString() : null,
    approval_note: approve
      ? 'Descuento del manifiesto comercial habilitado al cerrar el contrato de precio de combos en backend.'
      : null,
  };

  if (dryRun) {
    imported.push({ comboId: combo.comboId, components: combo.components.length, dryRun: true });
    continue;
  }

  const [saved] = await rest('product_combos?on_conflict=business_id,combo_id', {
    method: 'POST',
    headers: { Prefer: 'resolution=merge-duplicates,return=representation' },
    body: JSON.stringify([row]),
  });

  // Los componentes se reemplazan enteros: un combo al que le sacaron una lata
  // no puede quedar con la lata vieja colgada.
  await rest(`product_combo_components?combo_id=eq.${saved.id}`, { method: 'DELETE' });
  const components = combo.components.map((component, position) => ({
    combo_id: saved.id,
    product_id: bySku.get(component.sku).id,
    quantity: component.quantity,
    sort_order: position,
  }));
  const savedComponents = await rest('product_combo_components', {
    method: 'POST',
    headers: { Prefer: 'return=representation' },
    body: JSON.stringify(components),
  });

  const substitutions = [];
  for (const [position, component] of combo.components.entries()) {
    const componentRow = savedComponents.find((c) => c.product_id === bySku.get(component.sku).id);
    for (const sku of component.substitutions || []) {
      const candidate = bySku.get(sku);
      if (!candidate || !componentRow) continue;
      substitutions.push({ component_id: componentRow.id, product_id: candidate.id });
    }
    void position;
  }
  if (substitutions.length) {
    await rest('product_combo_substitutions?on_conflict=component_id,product_id', {
      method: 'POST',
      headers: { Prefer: 'resolution=merge-duplicates' },
      body: JSON.stringify(substitutions),
    });
  }

  imported.push({ comboId: combo.comboId, components: components.length, substitutions: substitutions.length });
}

console.log(`Combos del manifiesto: ${COMBO_MANIFEST.length}`);
console.log(`Importados: ${imported.length}${approve ? ' (aprobados)' : ' (pendientes de aprobación)'}`);
for (const row of imported) {
  console.log(`  OK   ${row.comboId} — ${row.components} componentes${row.substitutions ? `, ${row.substitutions} sustituciones` : ''}${row.dryRun ? ' [dry-run]' : ''}`);
}
console.log(`No importados: ${skipped.length}`);
for (const row of skipped) {
  console.log(`  SKIP ${row.comboId} — ${row.reason}`);
}

if (!dryRun) {
  const resolved = await rest(`rpc/list_business_combos`, {
    method: 'POST',
    body: JSON.stringify({ p_business_id: BUSINESS_ID }),
  });
  console.log(`\nGóndola resuelta por el backend: ${resolved.length} combo(s) comprables o bloqueados`);
  for (const combo of resolved) {
    const price = combo.purchasable
      ? `$${combo.list_price} → $${combo.promotional_price} (ahorro $${combo.savings}, stock ${combo.stock})`
      : `bloqueado: ${(combo.blockers || []).join(' ')}`;
    console.log(`  ${combo.purchasable ? 'COBRABLE' : 'BLOQUEADO'}  ${combo.combo_id} — ${price}`);
  }
}
