/*
 * Arma (pero no aplica) el plan de enriquecimiento de los 11 GTIN propuestos
 * para SKU que YA existen (`BARCODES_EXISTENTES_PROPUESTOS`, en
 * `catalog/gondola-retail-final-proposal.mjs`).
 *
 * OPERACIÓN APARTE, GATE APARTE — a propósito
 * --------------------------------------------
 * Esto NO es parte del lote de las 12 altas (`gondola-retail-final-plan.mjs`).
 * Enriquecer un código de barras de un SKU ya publicado y una alta nueva son
 * dos riesgos distintos: la primera toca `product_barcodes` de un producto
 * que un cliente puede tener en el carrito ahora mismo; la segunda no toca
 * nada que ya exista. Mezclarlas en una sola transacción condiciona el éxito
 * de una a la otra sin necesidad. El dueño pidió explícitamente no mezclarlas.
 *
 * HOJA PURA: no abre la red, no lee credenciales y no escribe en ninguna base.
 * Sólo agrega filas a `product_barcodes` — nunca toca `products` (ni precio,
 * ni stock, ni disponibilidad de los 11 SKU existentes cambia).
 *
 *   node scripts/gondola-retail-final-barcode-enrichment-plan.mjs
 *   node scripts/gondola-retail-final-barcode-enrichment-plan.mjs --sql \
 *        --verificado-por=<uuid-del-dueño>
 *
 * ESTADO: preparado 2026-08-21. NO ejecutado. Queda para un gate humano propio,
 * después y aparte del de las 12 altas.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { BARCODES_EXISTENTES_PROPUESTOS, BUSINESS_ID, PRODUCTOS_PROPUESTOS } from '../catalog/gondola-retail-final-proposal.mjs';
import { RETAIL_UNIDADES } from '../catalog/retail-unidades.mjs';
import { loadCatalogSkus } from './catalog-images/catalog-skus.mjs';
import { gtinDigitoVerificadorValido } from './retail-unidades-plan.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/**
 * Contrato local: cada enriquecimiento tiene que apuntar a un SKU que YA está
 * entre los 60 actuales (nunca a una de las 12 altas todavía no aplicadas —
 * ese acoplamiento es justo lo que este script existe para evitar), el GTIN
 * tiene que ser un EAN-13 válido (`product_barcodes_gtin_format`), y no puede
 * repetirse ni chocar con un GTIN ya conocido localmente (unidades minoristas
 * o las 12 altas propuestas aparte).
 */
export async function revisarEnriquecimiento(filas) {
  const problemas = [];
  const { skus: actuales } = await loadCatalogSkus(ROOT);
  const skusActuales = new Set(actuales.map((s) => s.sku));
  const skusAltas = new Set(PRODUCTOS_PROPUESTOS.map((p) => p.sku));
  const gtinsConocidos = new Set([
    ...RETAIL_UNIDADES.map((u) => u.gtin),
    ...PRODUCTOS_PROPUESTOS.map((p) => p.gtin),
  ]);

  const vistos = new Set();
  for (const f of filas) {
    const donde = `${f.sku}: `;
    if (vistos.has(f.sku)) problemas.push(`${donde}SKU repetido dentro de este lote de enriquecimiento`);
    vistos.add(f.sku);
    if (!skusActuales.has(f.sku)) problemas.push(`${donde}no está entre los 60 SKU actuales (¿es una de las 12 altas? esas no van acá)`);
    if (skusAltas.has(f.sku)) problemas.push(`${donde}es una de las 12 altas propuestas, no un SKU ya existente: no corresponde a este lote`);
    if (!/^[0-9]{13}$/.test(String(f.gtin || ''))) problemas.push(`${donde}GTIN «${f.gtin}» no tiene 13 dígitos`);
    else if (!gtinDigitoVerificadorValido(f.gtin)) problemas.push(`${donde}GTIN «${f.gtin}» tiene dígito verificador inválido`);
    if (f.gtinType !== 'EAN-13') problemas.push(`${donde}gtinType «${f.gtinType}» no corresponde a un GTIN de 13 dígitos`);
    if (gtinsConocidos.has(f.gtin)) problemas.push(`${donde}GTIN ${f.gtin} ya está en uso por otro SKU conocido localmente (unidad minorista o alta propuesta)`);
  }
  const gtins = filas.map((f) => f.gtin);
  if (new Set(gtins).size !== gtins.length) problemas.push('hay un GTIN repetido dentro de este lote de enriquecimiento');

  return problemas;
}

const lit = (v) => (v === null || v === undefined ? 'null' : `'${String(v).replaceAll("'", "''")}'`);

/**
 * El lote: sólo INSERT en product_barcodes, uno por SKU, resuelto contra el
 * product_id real vía join por sku+business_id. No toca products.
 *
 * is_primary = true asume que ninguno de los 11 tiene hoy un código de barras
 * activo — no hay forma de confirmarlo sin leer la base en vivo, así que el
 * chequeo de pre-vuelo aborta si ya existe un barcode activo (primario o no)
 * para ese product_id, en vez de arriesgar la violación silenciosa del índice
 * único `product_barcodes_one_primary_per_product`.
 */
export function construirLoteEnriquecimiento(filas, { verificadoPor = '' } = {}) {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(verificadoPor)) {
    throw new Error('verificadoPor tiene que ser el uuid de la persona que autoriza y verifica los datos maestros');
  }

  const valoresCodigos = filas.map((f) => `  (${lit(f.sku)}, ${lit(f.gtin)}, ${lit(f.gtinType)})`).join(',\n');
  const skus = filas.map((f) => f.sku);
  const gtins = filas.map((f) => f.gtin);

  return `-- Enriquecimiento de GTIN para SKU YA existentes · ${filas.length} códigos de barras
-- Generado por scripts/gondola-retail-final-barcode-enrichment-plan.mjs desde
-- catalog/gondola-retail-final-proposal.mjs (BARCODES_EXISTENTES_PROPUESTOS).
-- No editar a mano: se regenera.
--
-- OPERACIÓN APARTE de las 12 altas: sólo agrega product_barcodes, nunca toca
-- products (precio, stock, disponibilidad de estos 11 SKU no cambian).
-- Una sola transacción: o entran los 11 códigos o no entra ninguno.
--
-- verified_by / created_by = ${verificadoPor}

begin;

do $enriquecimiento$
declare
  v_faltantes text;
  v_ya_registrados text;
  v_con_barcode_activo text;
begin
  if not exists (select 1 from public.businesses where id = ${lit(BUSINESS_ID)}) then
    raise exception 'El negocio ${BUSINESS_ID} no existe en este proyecto.';
  end if;

  select string_agg(s, ', ') into v_faltantes
    from unnest(array[${skus.map(lit).join(',')}]) as s
   where not exists (
     select 1 from public.products p where p.business_id = ${lit(BUSINESS_ID)} and p.sku = s
   );
  if v_faltantes is not null then
    raise exception 'estos SKU no existen en products, no se puede enriquecer: %', v_faltantes;
  end if;

  select string_agg(g, ', ') into v_ya_registrados
    from unnest(array[${gtins.map(lit).join(',')}]) as g
   where exists (
     select 1 from public.product_barcodes b where b.business_id = ${lit(BUSINESS_ID)} and b.gtin = g
   );
  if v_ya_registrados is not null then
    raise exception 'estos GTIN ya están registrados para este negocio: %', v_ya_registrados;
  end if;

  select string_agg(p.sku, ', ') into v_con_barcode_activo
    from public.products p
    join public.product_barcodes b on b.product_id = p.id and b.is_active
   where p.business_id = ${lit(BUSINESS_ID)} and p.sku = any(array[${skus.map(lit).join(',')}]);
  if v_con_barcode_activo is not null then
    raise exception 'estos SKU ya tienen un código de barras activo; revisar a mano antes de agregar otro: %', v_con_barcode_activo;
  end if;
end
$enriquecimiento$;

with codigos (sku, gtin, gtin_type) as (
  values
${valoresCodigos}
)
insert into public.product_barcodes (
  business_id, product_id, gtin, barcode_type, package_type, unit_factor,
  is_primary, is_active, source, verified_at, created_by
)
select ${lit(BUSINESS_ID)}, p.id, c.gtin, c.gtin_type, 'unit', 1,
       true, true, 'manual', now(), ${lit(verificadoPor)}
  from public.products p
  join codigos c on c.sku = p.sku
 where p.business_id = ${lit(BUSINESS_ID)};

commit;

-- Relectura: lo que quedó escrito, no lo que se pidió escribir.
select p.sku, p.name, p.price, p.stock, p.available, b.gtin, b.is_primary
  from public.products p
  join public.product_barcodes b on b.product_id = p.id
 where p.business_id = ${lit(BUSINESS_ID)} and p.sku in (${skus.map(lit).join(',')})
 order by p.sku;
`;
}

// ── Informe por consola ──────────────────────────────────────────────────────
if (process.argv[1]?.endsWith('gondola-retail-final-barcode-enrichment-plan.mjs')) {
  const banderas = new Map();
  for (const a of process.argv.slice(2)) {
    if (!a.startsWith('--')) continue;
    const i = a.indexOf('=');
    if (i === -1) banderas.set(a.slice(2), true);
    else banderas.set(a.slice(2, i), a.slice(i + 1));
  }
  const verificadoPor = String(banderas.get('verificado-por') || '');

  console.log(`ENRIQUECIMIENTO GTIN · ${BARCODES_EXISTENTES_PROPUESTOS.length} SKU ya existentes, operación APARTE de las 12 altas`);
  for (const f of BARCODES_EXISTENTES_PROPUESTOS) {
    console.log(`  ${f.sku.padEnd(38)} gtin ${f.gtin} (${f.gtinType})  fuente=${f.source}`);
  }

  const problemas = await revisarEnriquecimiento(BARCODES_EXISTENTES_PROPUESTOS);
  console.log('');
  for (const p of problemas) console.error(`ERROR ${p}`);
  if (problemas.length) {
    console.error(`\n${problemas.length} problema(s). No se emite ningún lote.`);
    process.exit(1);
  }
  console.log(`contrato local: ${BARCODES_EXISTENTES_PROPUESTOS.length}/${BARCODES_EXISTENTES_PROPUESTOS.length} sin observaciones (la base es la autoridad final)`);
  console.log('');
  console.log('Esta corrida NO escribe en ninguna base. NO se ejecutó contra staging ni producción.');
  console.log('Gate APARTE del de las 12 altas: no aplicar en la misma sesión sin una decisión explícita del dueño.');

  if (banderas.has('sql')) {
    const sql = construirLoteEnriquecimiento(BARCODES_EXISTENTES_PROPUESTOS, { verificadoPor });
    const hash = crypto.createHash('sha256').update(sql, 'utf8').digest('hex');
    const destino = path.resolve(process.cwd(), 'artifacts/taba2-gondola-retail-final');
    fs.mkdirSync(destino, { recursive: true });
    const archivo = path.join(destino, 'gondola-retail-final-enriquecimiento-gtin.sql');
    fs.writeFileSync(archivo, sql, 'utf8');
    console.log('');
    console.log(`lote escrito: ${path.relative(process.cwd(), archivo)}`);
    console.log(`sha256: ${hash}`);
  }
}
