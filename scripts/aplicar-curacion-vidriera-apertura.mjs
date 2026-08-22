/*
 * La curación de vidriera de la apertura, aprobada por el dueño el 2026-08-22.
 *
 * DOS COSAS, Y NINGUNA MÁS:
 *   1. ocultar UN producto —el pack x6 de Fanta— poniendo `available=false`.
 *      No se borra, no se toca su stock, no se toca su precio, no se toca su
 *      historial: vuelve con un solo UPDATE el día que el dueño quiera.
 *   2. escribir la vidriera en los tags: quitar `más vendido` (una métrica de
 *      ventas que nunca existió: el comercio tiene UN pedido) y poner
 *      `recomendado-01` … `recomendado-12` en los doce aprobados, en su orden.
 *
 * NO toca: stock, precio, sort_order, imágenes, categoría, alcohol, pedidos,
 * ni ninguna otra columna. Se demuestra: se fotografían las 72 filas completas
 * ANTES y se comparan DESPUÉS campo por campo, y las únicas diferencias
 * admitidas son `available` del pack de Fanta, los `tags` de las trece filas
 * previstas y sus `updated_at`.
 *
 * Los tags nuevos se calculan en JS a partir de los tags REALES de cada fila y
 * se escriben como literal, así el UPDATE es determinístico y lo que se
 * verifica después es exactamente lo que se pidió escribir. Es idempotente:
 * limpia cualquier `recomendado-NN` previo antes de poner el suyo.
 *
 *   node scripts/aplicar-curacion-vidriera-apertura.mjs --ref=<ref>
 *   node scripts/aplicar-curacion-vidriera-apertura.mjs --ref=<ref> --aplicar --confirmado-por-humano
 */
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { conToken } from './lib/supabase-cli-token.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const REF_PRODUCCION = 'wwcpogltfgzgkrlilbcd';
const BUSINESS_ID = '00000000-0000-4000-8000-000000000001';
const AUTORIZACION = 'I_AUTHORIZE_TABA2_LAUNCH_SHELF_CURATION';
const TAG_HEREDADO = 'más vendido';
const OCULTAR = 'fanta-naranja-botella-pet-1500-ml-pack-x6';

// Los doce aprobados, EN SU ORDEN. El índice es el número del tag.
const RECOMENDADOS = [
  'coca-cola-original-2250ml',
  'coca-cola-zero-2250ml',
  'sprite-original-2250ml',
  'fanta-naranja-2250ml',
  'pepsi-original-2000ml',
  'benedictino-sin-gas-2250ml',
  'villavicencio-sin-gas-1500ml',
  'coca-cola-original-botella-pet-500-ml-pack-x12',
  'paso-de-los-toros-tonica-1500ml',
  'aquarius-pomelo-2250ml',
  'red-bull-original-250ml',
  'speed-original-473ml',
];

const banderas = new Set(process.argv.slice(2));
const abortar = (m) => { console.error(`ABORTAR: ${m}`); process.exit(2); };
if (!banderas.has(`--ref=${REF_PRODUCCION}`)) abortar(`exige --ref=${REF_PRODUCCION} explícito.`);
const aplicar = banderas.has('--aplicar');
if (aplicar && process.env.TABA2_LAUNCH_SHELF_CURATION_APPLY !== AUTORIZACION) {
  abortar(`--aplicar exige TABA2_LAUNCH_SHELF_CURATION_APPLY="${AUTORIZACION}" en el entorno.`);
}
if (aplicar && !banderas.has('--confirmado-por-humano')) abortar('--aplicar exige --confirmado-por-humano.');

const lit = (v) => `'${String(v).replaceAll("'", "''")}'`;
const arrayLit = (valores) => `array[${valores.map(lit).join(',')}]::text[]`;
const rank = (indice) => `recomendado-${String(indice + 1).padStart(2, '0')}`;
const esRecomendadoTag = (tag) => /^recomendado-\d{1,2}$/.test(String(tag).trim().toLowerCase());

await conToken(async (token) => {
  const sql = async (query) => {
    const r = await fetch(`https://api.supabase.com/v1/projects/${REF_PRODUCCION}/database/query`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', 'User-Agent': 'taba2-curacion-vidriera/1.0' },
      body: JSON.stringify({ query }),
    });
    const t = await r.text();
    if (!r.ok) throw new Error(`HTTP ${r.status} · ${t.slice(0, 1200)}`);
    return t ? JSON.parse(t) : null;
  };
  // La fotografía COMPLETA de las 72 filas: todo lo que no se puede mover.
  const fotografia = () => sql(`select external_id, name, brand, category, subcategory, variant, presentation,
      capacity, capacity_value::text as capacity_value, capacity_unit, packaging_type, units_per_pack, sold_as_pack,
      price::text as price, price_status, stock, available, is_active, is_verified, is_alcoholic, minimum_age,
      sort_order, catalog_origin, coalesce(image_url,'') as image_url, coalesce(tags,'{}')::text[] as tags
    from public.products where business_id = ${lit(BUSINESS_ID)} order by external_id;`);

  const [negocio] = await sql(`select name, status, is_active, alcohol_sales_enabled from public.businesses where id = ${lit(BUSINESS_ID)};`);
  if (!negocio) abortar('el negocio canónico no existe.');
  if (negocio.alcohol_sales_enabled === true) abortar('alcohol_sales_enabled está en true: fuera del alcance de esta curación.');

  const antes = await fotografia();
  const porSku = new Map(antes.map((p) => [p.external_id, p]));
  const comprablesAntes = antes.filter((p) => p.available && p.is_active && p.is_verified);
  const [pedidosAntes] = await sql("select count(*)::int as total, (select total::text from public.orders where public_code='LT-0001') as lt0001 from public.orders;");

  console.log(`negocio        ${negocio.name} · ${negocio.status} · alcohol=${negocio.alcohol_sales_enabled}`);
  console.log(`ANTES          ${antes.length} productos · ${comprablesAntes.length} comprables · ${pedidosAntes.total} pedidos · LT-0001 total ${pedidosAntes.lt0001}`);

  if (antes.length !== 72) abortar(`se esperaban 72 productos y hay ${antes.length}.`);
  if (comprablesAntes.length !== 33) abortar(`se esperaban 33 comprables y hay ${comprablesAntes.length}.`);

  // ── Guardas de las dos operaciones ────────────────────────────────────────
  const aOcultar = porSku.get(OCULTAR);
  if (!aOcultar) abortar(`${OCULTAR} no existe.`);
  if (aOcultar.available !== true) abortar(`${OCULTAR} ya está oculto: nada que hacer.`);
  if (aOcultar.is_alcoholic) abortar(`${OCULTAR} es alcohólico: fuera de alcance.`);

  for (const sku of RECOMENDADOS) {
    const fila = porSku.get(sku);
    if (!fila) abortar(`recomendado inexistente: ${sku}`);
    if (!fila.available || !fila.is_active || !fila.is_verified) abortar(`recomendado no comprable: ${sku}`);
    if (fila.is_alcoholic) abortar(`recomendado alcohólico: ${sku}`);
    if (Number(fila.stock) <= 0) abortar(`recomendado sin stock: ${sku}`);
  }
  if (new Set(RECOMENDADOS).size !== 12) abortar('la lista de recomendados no tiene 12 SKU distintos.');
  if (RECOMENDADOS.includes(OCULTAR)) abortar('el producto a ocultar no puede estar entre los recomendados.');

  // ── Los tags que va a tener cada fila, calculados desde los reales ────────
  const tagsFinales = new Map();
  RECOMENDADOS.forEach((sku, indice) => {
    const actuales = porSku.get(sku).tags || [];
    const limpios = actuales.filter((t) => t !== TAG_HEREDADO && !esRecomendadoTag(t));
    tagsFinales.set(sku, [...limpios, rank(indice)]);
  });
  // Los que conservan el tag heredado y NO entran a la vidriera: se les quita.
  for (const fila of antes) {
    if (tagsFinales.has(fila.external_id)) continue;
    const actuales = fila.tags || [];
    if (!actuales.some((t) => t === TAG_HEREDADO || esRecomendadoTag(t))) continue;
    tagsFinales.set(fila.external_id, actuales.filter((t) => t !== TAG_HEREDADO && !esRecomendadoTag(t)));
  }

  console.log('');
  console.log(`ocultar        ${OCULTAR} · precio ${aOcultar.price} · stock ${aOcultar.stock} (ninguno de los dos se toca)`);
  console.log(`vidriera       ${RECOMENDADOS.length} recomendados · ${tagsFinales.size} filas de tags a escribir`);
  for (const [sku, tags] of tagsFinales) {
    const antesTags = (porSku.get(sku).tags || []).join(', ') || '(sin tags)';
    console.log(`  ${sku}\n      ${antesTags}  ->  ${tags.join(', ') || '(sin tags)'}`);
  }

  if (!aplicar) {
    console.log('');
    console.log('ENSAYO: no se escribió nada. Para aplicar: --aplicar --confirmado-por-humano con la variable de autorización.');
    return;
  }

  // ── LAS DOS ESCRITURAS, en una transacción ────────────────────────────────
  const sentencias = ['begin;'];
  sentencias.push(`update public.products set available = false, updated_at = now()
     where business_id = ${lit(BUSINESS_ID)} and external_id = ${lit(OCULTAR)} and available = true;`);
  for (const [sku, tags] of tagsFinales) {
    sentencias.push(`update public.products set tags = ${arrayLit(tags)}, updated_at = now()
       where business_id = ${lit(BUSINESS_ID)} and external_id = ${lit(sku)};`);
  }
  sentencias.push('commit;');
  console.log('');
  console.log(`APLICANDO ${sentencias.length - 2} sentencias en una transacción…`);
  await sql(sentencias.join('\n'));

  // ── Verificación: sólo cambió lo previsto ─────────────────────────────────
  const despues = await fotografia();
  const porSkuDespues = new Map(despues.map((p) => [p.external_id, p]));
  const fallas = [];
  const INMUTABLES = ['name', 'brand', 'category', 'subcategory', 'variant', 'presentation', 'capacity',
    'capacity_value', 'capacity_unit', 'packaging_type', 'units_per_pack', 'sold_as_pack', 'price',
    'price_status', 'stock', 'is_active', 'is_verified', 'is_alcoholic', 'minimum_age', 'sort_order',
    'catalog_origin', 'image_url'];

  if (despues.length !== antes.length) fallas.push(`el catálogo cambió de tamaño: ${antes.length} → ${despues.length}`);
  for (const previo of antes) {
    const actual = porSkuDespues.get(previo.external_id);
    if (!actual) { fallas.push(`${previo.external_id}: desapareció`); continue; }
    for (const campo of INMUTABLES) {
      if (String(previo[campo]) !== String(actual[campo])) {
        fallas.push(`${previo.external_id}: ${campo} cambió «${previo[campo]}» → «${actual[campo]}»`);
      }
    }
    // available: sólo el producto ocultado.
    const esperadoAvailable = previo.external_id === OCULTAR ? false : previo.available;
    if (actual.available !== esperadoAvailable) {
      fallas.push(`${previo.external_id}: available ${previo.available} → ${actual.available} (esperado ${esperadoAvailable})`);
    }
    // tags: sólo las filas previstas, y exactamente lo calculado.
    const esperadoTags = tagsFinales.get(previo.external_id) ?? previo.tags;
    if (JSON.stringify(actual.tags) !== JSON.stringify(esperadoTags)) {
      fallas.push(`${previo.external_id}: tags ${JSON.stringify(actual.tags)} ≠ ${JSON.stringify(esperadoTags)}`);
    }
  }

  const comprablesDespues = despues.filter((p) => p.available && p.is_active && p.is_verified);
  if (comprablesDespues.length !== 32) fallas.push(`los comprables no quedaron en 32: ${comprablesDespues.length}`);
  if (comprablesDespues.some((p) => p.is_alcoholic)) fallas.push('quedó un alcohólico comprable');
  const conHeredado = despues.filter((p) => (p.tags || []).includes(TAG_HEREDADO));
  if (conHeredado.length) fallas.push(`quedaron ${conHeredado.length} filas con «${TAG_HEREDADO}»`);
  for (const [indice, sku] of RECOMENDADOS.entries()) {
    const tags = porSkuDespues.get(sku)?.tags || [];
    if (!tags.includes(rank(indice))) fallas.push(`${sku}: no quedó con ${rank(indice)}`);
  }
  const curados = despues.filter((p) => (p.tags || []).some(esRecomendadoTag));
  if (curados.length !== 12) fallas.push(`hay ${curados.length} productos curados y tienen que ser 12`);

  const [pedidosDespues] = await sql("select count(*)::int as total, (select total::text from public.orders where public_code='LT-0001') as lt0001 from public.orders;");
  if (pedidosDespues.total !== pedidosAntes.total) fallas.push(`la cantidad de pedidos cambió: ${pedidosAntes.total} → ${pedidosDespues.total}`);
  if (pedidosDespues.lt0001 !== pedidosAntes.lt0001) fallas.push(`LT-0001 cambió: ${pedidosAntes.lt0001} → ${pedidosDespues.lt0001}`);

  console.log('');
  console.log(`DESPUÉS        ${despues.length} productos · ${comprablesDespues.length} comprables · ${pedidosDespues.total} pedidos · LT-0001 total ${pedidosDespues.lt0001}`);
  writeFileSync(path.join(ROOT, 'artifacts', 'taba2-go-live-audit', 'curacion-vidriera-antes-despues.json'),
    `${JSON.stringify({ antes, despues, tagsFinales: [...tagsFinales], ocultado: OCULTAR }, null, 2)}\n`);

  if (fallas.length) {
    for (const f of fallas) console.error(`ERROR ${f}`);
    process.exitCode = 1;
    return;
  }
  console.log('');
  console.log('OK · 1 producto oculto (sin tocar su stock ni su precio), 12 recomendados escritos en orden,');
  console.log('     ninguna otra columna de ninguna de las 72 filas se movió, y LT-0001 sigue igual.');
});
