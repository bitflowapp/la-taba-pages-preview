/*
 * READ-ONLY. Compara el catálogo vivo contra la fotografía tomada ANTES de la
 * curación de vidriera y afirma, campo por campo, que lo único que se movió es
 * lo aprobado: un producto oculto, diecinueve filas de tags, y la verificación
 * que el fail-close bajó y hubo que restablecer.
 *
 * Cualquier otra diferencia —un precio, un stock, un sort_order, una imagen,
 * una categoría— es una falla.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { conToken } from './lib/supabase-cli-token.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BUSINESS_ID = '00000000-0000-4000-8000-000000000001';
const OCULTADO = 'fanta-naranja-botella-pet-1500-ml-pack-x6';
const RECOMENDADOS = [
  'coca-cola-original-2250ml', 'coca-cola-zero-2250ml', 'sprite-original-2250ml',
  'fanta-naranja-2250ml', 'pepsi-original-2000ml', 'benedictino-sin-gas-2250ml',
  'villavicencio-sin-gas-1500ml', 'coca-cola-original-botella-pet-500-ml-pack-x12',
  'paso-de-los-toros-tonica-1500ml', 'aquarius-pomelo-2250ml',
  'red-bull-original-250ml', 'speed-original-473ml',
];
const INMUTABLES = ['name', 'brand', 'category', 'subcategory', 'variant', 'presentation', 'capacity',
  'capacity_value', 'capacity_unit', 'packaging_type', 'units_per_pack', 'sold_as_pack', 'price',
  'price_status', 'stock', 'is_active', 'is_verified', 'is_alcoholic', 'minimum_age', 'sort_order',
  'catalog_origin', 'image_url'];

const { antes } = JSON.parse(readFileSync(
  path.join(ROOT, 'artifacts', 'taba2-go-live-audit', 'curacion-vidriera-antes-despues.json'), 'utf8'));
const porSku = new Map(antes.map((p) => [p.external_id, p]));
const lit = (v) => `'${String(v).replaceAll("'", "''")}'`;

let rojo = 0;
const medir = (nombre, ok, detalle = '') => {
  console.log(`  ${ok ? 'OK  ' : 'MAL '} ${nombre}${detalle ? ` · ${detalle}` : ''}`);
  if (!ok) rojo += 1;
};

await conToken(async (token) => {
  const sql = async (query) => {
    const r = await fetch('https://api.supabase.com/v1/projects/wwcpogltfgzgkrlilbcd/database/query', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', 'User-Agent': 'taba2-verificar-vidriera/1.0' },
      body: JSON.stringify({ query }),
    });
    const t = await r.text();
    if (!r.ok) throw new Error(`HTTP ${r.status} · ${t.slice(0, 800)}`);
    return t ? JSON.parse(t) : null;
  };

  const vivo = await sql(`select external_id, name, brand, category, subcategory, variant, presentation,
      capacity, capacity_value::text as capacity_value, capacity_unit, packaging_type, units_per_pack, sold_as_pack,
      price::text as price, price_status, stock, available, is_active, is_verified, is_alcoholic, minimum_age,
      sort_order, catalog_origin, coalesce(image_url,'') as image_url, coalesce(tags,'{}')::text[] as tags,
      verified_by::text as verified_by
    from public.products where business_id = ${lit(BUSINESS_ID)} order by external_id;`);

  console.log('\n── 1 · nada fuera de lo aprobado se movió ──');
  const movidos = [];
  for (const fila of vivo) {
    const previo = porSku.get(fila.external_id);
    if (!previo) { movidos.push(`${fila.external_id}: producto nuevo inesperado`); continue; }
    for (const campo of INMUTABLES) {
      if (String(previo[campo]) !== String(fila[campo])) movidos.push(`${fila.external_id}.${campo}: «${previo[campo]}» → «${fila[campo]}»`);
    }
  }
  medir('las 72 filas conservan precio, stock, sort_order, imagen, categoría y verificación', movidos.length === 0,
    movidos.slice(0, 5).join(' | ') || 'ninguna diferencia');
  medir('el catálogo sigue teniendo 72 productos', vivo.length === 72, `${vivo.length}`);

  console.log('\n── 2 · el único producto ocultado ──');
  const cambiosAvailable = vivo.filter((f) => f.available !== porSku.get(f.external_id)?.available).map((f) => f.external_id);
  medir('sólo un producto cambió su disponibilidad', cambiosAvailable.length === 1, cambiosAvailable.join(', '));
  medir('y es el pack x6 de Fanta', cambiosAvailable[0] === OCULTADO, cambiosAvailable[0] || '(ninguno)');
  const fanta = vivo.find((f) => f.external_id === OCULTADO);
  medir('el ocultado conserva su stock', String(fanta.stock) === String(porSku.get(OCULTADO).stock), `stock ${fanta.stock}`);
  medir('el ocultado conserva su precio', String(fanta.price) === String(porSku.get(OCULTADO).price), `precio ${fanta.price}`);

  console.log('\n── 3 · la vidriera ──');
  const curados = vivo.filter((f) => f.tags.some((t) => /^recomendado-\d{1,2}$/.test(t)));
  medir('hay exactamente 12 productos curados', curados.length === 12, `${curados.length}`);
  const orden = curados
    .map((f) => ({ sku: f.external_id, rank: Number(/^recomendado-(\d{1,2})$/.exec(f.tags.find((t) => /^recomendado-/.test(t)))[1]) }))
    .sort((a, b) => a.rank - b.rank)
    .map((x) => x.sku);
  medir('están en el orden aprobado, del 1 al 12', JSON.stringify(orden) === JSON.stringify(RECOMENDADOS),
    orden.slice(0, 4).join(' > '));
  medir('los 12 son comprables', curados.every((f) => f.available && f.is_active && f.is_verified && Number(f.stock) > 0));
  medir('ninguno de los 12 es alcohólico', curados.every((f) => !f.is_alcoholic));
  const heredado = vivo.filter((f) => f.tags.includes('más vendido'));
  medir('la métrica inventada «más vendido» ya no existe en el catálogo', heredado.length === 0, `${heredado.length} filas`);

  console.log('\n── 4 · las compuertas que no se tocan ──');
  const comprables = vivo.filter((f) => f.available && f.is_active && f.is_verified);
  medir('quedan 32 comprables', comprables.length === 32, `${comprables.length}`);
  medir('0 alcohólicos comprables', comprables.filter((f) => f.is_alcoholic).length === 0);
  medir('los 27 alcohólicos siguen cargados y cerrados', vivo.filter((f) => f.is_alcoholic).length === 27);
  medir('las 72 filas siguen verificadas', vivo.every((f) => f.is_verified === true));
  medir('ninguna quedó sin verificador', vivo.every((f) => f.verified_by));
  const [negocio] = await sql(`select alcohol_sales_enabled from public.businesses where id = ${lit(BUSINESS_ID)};`);
  medir('alcohol_sales_enabled sigue en false', negocio.alcohol_sales_enabled === false);
  const stockVivo = vivo.reduce((suma, f) => suma + Number(f.stock), 0);
  const stockPrevio = antes.reduce((suma, f) => suma + Number(f.stock), 0);
  medir('el stock total no se movió', stockVivo === stockPrevio, `${stockVivo}`);

  console.log('\n── 5 · pedidos ──');
  const [pedidos] = await sql("select count(*)::int as total, (select status from public.orders where public_code='LT-0001') as lt_estado, (select total::text from public.orders where public_code='LT-0001') as lt_total from public.orders;");
  medir('sigue habiendo un solo pedido', pedidos.total === 1, `${pedidos.total}`);
  medir('LT-0001 intacto', pedidos.lt_estado === 'on_the_way' && pedidos.lt_total === '17100.00', `${pedidos.lt_estado} · ${pedidos.lt_total}`);
});

console.log(rojo === 0 ? '\nVERIFICACIÓN DE BASE: PASS' : `\nVERIFICACIÓN DE BASE: ${rojo} fallas`);
process.exit(rojo === 0 ? 0 : 1);
