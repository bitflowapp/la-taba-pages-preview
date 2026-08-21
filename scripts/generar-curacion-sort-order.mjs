/*
 * Genera el lote de curación de sort_order para la góndola final de 72 SKU.
 *
 * POR QUÉ EXISTE: la auditoría de UX del 2026-08-21 midió que la home abre
 * Gaseosas con los packs de 500 ml ARRIBA de las botellas familiares. La causa
 * es histórica: los 4 packs previos llevan sort_order 1..4 (antes que los 10..520
 * del lote Neuquén) y las 4 unidades minoristas quedaron en 0. Además las 12
 * altas nuevas nacen con sort_order 0: sin curación quedarían TODAS arriba de
 * todo. La regla del dueño: familiar primero; 500 ml nunca arriba de 1,5 L.
 *
 * QUÉ HACE: lee producción (SOLO SELECT), junta los 60 actuales + las 12 altas
 * propuestas, y asigna una secuencia global nueva en pasos de 10:
 *   · los bloques de categoría conservan su orden macro actual (el del lote
 *     Neuquén, definido por el mínimo sort_order vigente de cada categoría);
 *     'Jugos' (nueva) se intercala después de 'Aguas', como en el orden
 *     preferido del cliente (js/ui.js preferredOrder);
 *   · adentro de cada categoría: banda A = formatos familiares/primarios
 *     (KEEP_HIGH_PRIORITY, las altas nuevas unitarias, y en Cervezas los packs
 *     x6 — ahí el pack ES el formato deseable); banda B = packs de gaseosas
 *     (PACK_OK); banda C = formatos chicos (KEEP_SECONDARY, FAMILY_SIZE_MISSING);
 *   · adentro de cada banda: capacidad total descendente (capacity_value ×
 *     units_per_pack) y después nombre, para que 2,25 L preceda a 1,5 L y ésta
 *     a 500 ml siempre.
 *
 * SALIDA (no toca la base):
 *   artifacts/taba2-gondola-retail-final/curacion-sort-order.sql   (UPDATEs)
 *   artifacts/taba2-gondola-retail-final/curacion-sort-order-preview.md
 *
 * El SQL sólo escribe la columna sort_order, en una transacción, con guardas de
 * conteo. Se aplica DESPUÉS del lote de altas (cubre los 72) y con gate humano.
 */
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { BUSINESS_ID, PRODUCTOS_PROPUESTOS } from '../catalog/gondola-retail-final-proposal.mjs';
import { GONDOLA_RETAIL_FINAL_CLASSIFICATIONS } from '../catalog/gondola-retail-final-classifications.mjs';
import { conToken } from './lib/supabase-cli-token.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const lit = (v) => `'${String(v).replaceAll("'", "''")}'`;

const clasePorSku = new Map(GONDOLA_RETAIL_FINAL_CLASSIFICATIONS.map((c) => [c.sku, c.classification]));

const vivos = await conToken(async (token) => {
  const r = await fetch(`https://api.supabase.com/v1/projects/wwcpogltfgzgkrlilbcd/database/query`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', 'User-Agent': 'taba2-curacion-sort-order/1.0' },
    body: JSON.stringify({ query: `select external_id, name, category, sort_order, sold_as_pack, units_per_pack,
        capacity_value::float as capacity_value, is_alcoholic
      from public.products where business_id = ${lit(BUSINESS_ID)} order by sort_order, name;` }),
  });
  const t = await r.text();
  if (!r.ok) throw new Error(`HTTP ${r.status} · ${t.slice(0, 500)}`);
  return JSON.parse(t);
});

if (vivos.length !== 60) {
  console.error(`ABORTAR: producción tiene ${vivos.length} productos y esta curación se genera sobre 60 (+12 propuestos). Regenerar tras verificar.`);
  process.exit(2);
}

// Las 12 altas propuestas, con la forma mínima que necesita la regla.
const nuevas = PRODUCTOS_PROPUESTOS.map((p) => ({
  external_id: p.externalId,
  name: p.name,
  category: p.category,
  sort_order: 0,
  sold_as_pack: p.soldAsPack,
  units_per_pack: p.unitsPerPack,
  capacity_value: Number(p.capacityValue),
  is_alcoholic: p.alcoholic,
  nueva: true,
}));

const todos = [...vivos.map((v) => ({ ...v, nueva: false })), ...nuevas];

// Orden macro de categorías: el vigente (mínimo sort_order actual >0 por
// categoría); las nuevas categorías se intercalan por regla explícita.
const minPorCategoria = new Map();
for (const p of vivos) {
  const min = minPorCategoria.get(p.category);
  const so = p.sort_order > 0 ? p.sort_order : 999; // los 0/1..4 no definen el macro-orden
  if (min === undefined || so < min) minPorCategoria.set(p.category, so);
}
const categoriasVigentes = [...minPorCategoria.entries()].sort((a, b) => a[1] - b[1]).map(([c]) => c);
const categorias = [...categoriasVigentes];
if (!categorias.includes('Jugos')) {
  const iAguas = categorias.indexOf('Aguas');
  categorias.splice(iAguas === -1 ? categorias.length : iAguas + 1, 0, 'Jugos');
}
for (const c of new Set(todos.map((p) => p.category))) {
  if (!categorias.includes(c)) categorias.push(c);
}

function banda(p) {
  if (p.category === 'Cervezas') {
    // En cerveza el pack x6 es el formato deseable; botellas grandes después;
    // latas y botellas chicas al final.
    if (p.sold_as_pack) return 0;
    if ((p.capacity_value || 0) >= 710) return 1;
    return 2;
  }
  if (p.nueva) return p.sold_as_pack ? 1 : 0; // altas unitarias = familiares
  const clase = clasePorSku.get(p.external_id);
  if (clase === 'KEEP_HIGH_PRIORITY') return 0;
  if (clase === 'PACK_OK') return 1;
  return 2; // KEEP_SECONDARY, FAMILY_SIZE_MISSING y cualquier otra
}

function capacidadTotal(p) {
  return (p.capacity_value || 0) * (p.units_per_pack || 1);
}

const asignaciones = [];
let cursor = 10;
for (const categoria of categorias) {
  const delBloque = todos.filter((p) => p.category === categoria);
  delBloque.sort((a, b) => banda(a) - banda(b)
    || capacidadTotal(b) - capacidadTotal(a)
    || a.name.localeCompare(b.name, 'es'));
  for (const p of delBloque) {
    asignaciones.push({ ...p, sort_order_nuevo: cursor });
    cursor += 10;
  }
}

const cambios = asignaciones.filter((a) => a.sort_order !== a.sort_order_nuevo || a.nueva);

// ── SQL: sólo sort_order, transacción única, con guardas ─────────────────────
const lineas = [];
lineas.push('-- Curación de sort_order de la góndola final (72 SKU).');
lineas.push('-- Generado por scripts/generar-curacion-sort-order.mjs. No editar a mano.');
lineas.push('-- SÓLO escribe products.sort_order. Nada más: ni stock, ni precio, ni available.');
lineas.push('-- Se aplica DESPUÉS del lote de 12 altas (espera 72 filas) y con gate humano.');
lineas.push('begin;');
lineas.push('do $curacion$');
lineas.push('begin');
lineas.push(`  if (select count(*) from public.products where business_id = ${lit(BUSINESS_ID)}) <> 72 then`);
lineas.push(`    raise exception 'la curación espera 72 productos (60 + 12 altas aplicadas). Abortado.';`);
lineas.push('  end if;');
lineas.push('end');
lineas.push('$curacion$;');
for (const a of asignaciones) {
  lineas.push(`update public.products set sort_order = ${a.sort_order_nuevo}, updated_at = now() where business_id = ${lit(BUSINESS_ID)} and external_id = ${lit(a.external_id)};`);
}
lineas.push('commit;');
lineas.push('');
lineas.push('-- Relectura: la secuencia final por categoría.');
lineas.push(`select category, sort_order, external_id, name from public.products where business_id = ${lit(BUSINESS_ID)} order by sort_order;`);

const sqlPath = path.join(ROOT, 'artifacts', 'taba2-gondola-retail-final', 'curacion-sort-order.sql');
writeFileSync(sqlPath, `${lineas.join('\n')}\n`);

// ── Preview humano ───────────────────────────────────────────────────────────
const md = [];
md.push('# Curación de sort_order — preview (72 SKU)');
md.push('');
md.push(`Generado ${new Date().toISOString()} desde producción viva (60) + las 12 altas propuestas.`);
md.push('Regla: bloques de categoría en su orden vigente (Jugos después de Aguas); adentro,');
md.push('familiar/primario → packs → chicos; y por capacidad total descendente. Sólo cambia `sort_order`.');
md.push('');
for (const categoria of categorias) {
  const delBloque = asignaciones.filter((a) => a.category === categoria);
  if (!delBloque.length) continue;
  md.push(`## ${categoria}`);
  md.push('');
  md.push('| nuevo | antes | SKU | banda |');
  md.push('|---|---|---|---|');
  for (const a of delBloque) {
    const etiquetas = categoria === 'Cervezas'
      ? ['pack x6 (formato deseable)', 'botella grande', 'lata/botella suelta']
      : ['familiar/primario', 'pack', 'chico/secundario'];
    md.push(`| ${a.sort_order_nuevo} | ${a.nueva ? 'ALTA' : a.sort_order} | ${a.external_id} | ${etiquetas[banda(a)]} |`);
  }
  md.push('');
}
const mdPath = path.join(ROOT, 'artifacts', 'taba2-gondola-retail-final', 'curacion-sort-order-preview.md');
writeFileSync(mdPath, `${md.join('\n')}\n`);

console.log(`72 asignaciones (${cambios.length} cambian) · bloques: ${categorias.join(' · ')}`);
console.log(`SQL:     ${sqlPath}`);
console.log(`Preview: ${mdPath}`);
