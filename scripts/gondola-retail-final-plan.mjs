/*
 * Arma y revisa el plan de aplicación de las 12 altas de la góndola comercial
 * final (`catalog/gondola-retail-final-proposal.mjs`), aprobadas por el dueño
 * el 2026-08-21 como PASO 1: generar el payload/SQL, todavía NO aplicarlo.
 *
 * HOJA PURA: no abre la red, no lee credenciales y no escribe en ninguna base.
 * Mismo patrón que `gondola-neuquen-plan.mjs` y `retail-unidades-plan.mjs`.
 *
 * INSERT liso, nunca upsert — igual razón que en `retail-unidades-plan.mjs`:
 * estas 12 filas son altas nuevas, no una reaplicación de un lote existente.
 * Si alguna ya existe (SKU o GTIN), la transacción entera aborta ANTES de
 * escribir una sola fila. Nunca hay `on conflict do update`.
 *
 * is_verified = true / available = false — misma separación que ya rige en
 * `retail-unidades-plan.mjs` y en la góndola con licencia cerrada: el dueño
 * autorizó los datos maestros (nombre, marca, precio, GTIN) al aprobar esta
 * propuesta, así que quedan VERIFICADOS. Pero no hay una unidad física
 * contada todavía — `stock = 0` dice la verdad, y
 * `products_available_requires_verification` fuerza `available = false` como
 * consecuencia de ese stock, no como una decisión aparte. Se habilitan con un
 * `update products set stock = N` el día de la Recepción real; ver
 * `catalog/gondola-retail-final-proposal.mjs`.
 *
 * QUÉ NO HACE ESTE SCRIPT
 * -----------------------
 * No toca las 8 barras de alcohol previas de la góndola, no toca los 60 SKU
 * actuales (INSERT liso, no hay UPDATE ni DELETE en todo el archivo: por
 * construcción no puede tocar una fila existente), no toca `orders` ni
 * `order_items` (LT-0001 y cualquier otro pedido quedan fuera del alcance de
 * este SQL), y no enriquece los 11 GTIN de SKU YA existentes —
 * `BARCODES_EXISTENTES_PROPUESTOS` es un lote aparte, con su propio gate: ver
 * `scripts/gondola-retail-final-barcode-enrichment-plan.mjs`, preparado pero
 * sin ejecutar.
 *
 *   node scripts/gondola-retail-final-plan.mjs                  # plan y revisión (dry-run)
 *   node scripts/gondola-retail-final-plan.mjs --sql \
 *        --verificado-por=<uuid-del-dueño>                      # además emite el lote
 *
 * (los flags van con `=`, no separados por espacio).
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { BUSINESS_ID, CATALOGO_ACTUAL, PRODUCTOS_PROPUESTOS, TOTAL_ESTIMADO } from '../catalog/gondola-retail-final-proposal.mjs';
import { RETAIL_UNIDADES } from '../catalog/retail-unidades.mjs';
import { loadCatalogSkus } from './catalog-images/catalog-skus.mjs';
import { gtinDigitoVerificadorValido } from './retail-unidades-plan.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** Vocabulario y partición de alcohol de `products_verified_alcohol_coherence`
 *  y `products_verified_canonical_beverage_category`
 *  (migración 20260818040000_gondola_beverage_taxonomy.sql), copiados —no
 *  aproximados— para poder detectar un error local antes de gastar una
 *  transacción real. */
const CATEGORIAS_SIN_ALCOHOL = new Set(['Gaseosas', 'Mixers', 'Energizantes', 'Aguas', 'Aguas saborizadas', 'Isotónicas', 'Hielo', 'Jugos', 'Energéticas', 'Picadas y deli', 'Hielo y extras']);
const CATEGORIAS_CON_ALCOHOL = new Set(['Cervezas', 'Fernet', 'Aperitivos', 'Vinos', 'Espumantes', 'Destilados', 'Vinos y espumantes', 'Gins y vodkas', 'Whisky y destilados']);
const CAPACITY_UNITS_VALIDAS = new Set(['ml', 'l', 'g', 'kg', 'unidad']);

/**
 * El contrato exacto que exigen los CHECK reales de `public.products` y
 * `public.product_barcodes` para una fila `catalog_origin = 'commercial'`
 * verificada, leído de las migraciones vigentes:
 *   - products_verified_master_data          (20260818020000)
 *   - products_verified_publication_authority(20260818020000)
 *   - products_verified_numeric_ranges       (20260725110000)
 *   - products_verified_alcohol_coherence    (20260818040000)
 *   - products_verified_canonical_beverage_category (20260818040000)
 *   - product_barcodes_gtin_format           (20260802160000)
 * No es una copia aproximada: cada rama de acá corresponde a una cláusula del
 * CHECK real. La base sigue siendo la autoridad final — este chequeo sólo
 * evita gastar una transacción en un error de tipeo.
 */
export function revisarAltas(altas) {
  const problemas = [];
  const vistos = new Set();
  for (const p of altas) {
    const donde = `${p.sku}: `;
    if (vistos.has(p.sku)) problemas.push(`${donde}SKU repetido dentro del lote`);
    vistos.add(p.sku);
    if (p.externalId !== p.sku) problemas.push(`${donde}externalId tiene que ser igual a sku`);

    for (const campo of ['brand', 'name', 'category', 'subcategory', 'variant', 'packagingType']) {
      if (!String(p[campo] || '').trim()) problemas.push(`${donde}${campo} vacío (products_verified_master_data)`);
    }
    if (!(p.price > 0)) problemas.push(`${donde}precio no positivo (products_verified_master_data)`);
    if (!/^[0-9]+([.][0-9]{1,2})?$/.test(String(p.price))) problemas.push(`${donde}precio con formato inválido para products_verified_numeric_ranges`);
    if (p.stock !== 0) problemas.push(`${donde}esta tanda tiene que nacer con stock = 0 hasta la Recepción real`);
    if (p.available !== false) problemas.push(`${donde}esta tanda tiene que nacer con available = false hasta la Recepción real`);
    if (!(p.capacityValue > 0)) problemas.push(`${donde}capacity_value tiene que ser mayor a cero (products_verified_publication_authority)`);
    if (!CAPACITY_UNITS_VALIDAS.has(p.capacityUnit)) problemas.push(`${donde}capacity_unit «${p.capacityUnit}» fuera de la lista que acepta la base`);
    if (!Number.isInteger(p.unitsPerPack) || p.unitsPerPack < 1) problemas.push(`${donde}units_per_pack tiene que ser un entero >= 1 (products_verified_numeric_ranges)`);
    if (p.soldAsPack && !(p.unitsPerPack > 1)) problemas.push(`${donde}declarado como pack con un solo envase`);
    if (!p.soldAsPack && p.unitsPerPack !== 1) problemas.push(`${donde}trae más de una unidad y no está declarado como pack`);

    // Imagen: CASO A del contrato — los seis campos coherentemente en null.
    // Ninguna de las 12 tiene todavía un packshot oficial aprobado.
    if (p.catalogAssetId !== null || p.imageUrl !== null) {
      problemas.push(`${donde}esta tanda no tiene packshot aprobado: catalogAssetId e imageUrl tienen que ser null (fallback propio de TABA)`);
    }

    // Vocabulario y coherencia de alcohol (products_verified_canonical_beverage_category
    // y products_verified_alcohol_coherence).
    const conAlcohol = CATEGORIAS_CON_ALCOHOL.has(p.category);
    const sinAlcohol = CATEGORIAS_SIN_ALCOHOL.has(p.category);
    if (!conAlcohol && !sinAlcohol) problemas.push(`${donde}categoría «${p.category}» fuera del vocabulario canónico`);
    if (conAlcohol && p.alcoholic !== true) problemas.push(`${donde}categoría con alcohol pero alcoholic !== true`);
    if (sinAlcohol && p.alcoholic !== false) problemas.push(`${donde}categoría sin alcohol pero alcoholic !== false`);
    if (p.alcoholic) {
      if (!(Number.isInteger(p.minimumAge) && p.minimumAge >= 18 && p.minimumAge <= 99)) {
        problemas.push(`${donde}con alcohol, minimum_age tiene que ser un entero entre 18 y 99`);
      }
    } else if (p.minimumAge !== undefined && p.minimumAge !== null) {
      problemas.push(`${donde}sin alcohol, minimum_age tiene que ser null`);
    }

    // GTIN → product_barcodes_gtin_format (EAN-13 + dígito verificador GS1 mod10).
    if (!/^[0-9]{13}$/.test(String(p.gtin || ''))) problemas.push(`${donde}GTIN «${p.gtin}» no tiene 13 dígitos`);
    else if (!gtinDigitoVerificadorValido(p.gtin)) problemas.push(`${donde}GTIN «${p.gtin}» tiene dígito verificador inválido`);
    if (p.gtinType !== 'EAN-13') problemas.push(`${donde}gtinType «${p.gtinType}» no corresponde a un GTIN de 13 dígitos (esperado EAN-13)`);

    const desc = descripcionDe(p);
    if (desc.length > 180) problemas.push(`${donde}descripción de más de 180 caracteres`);
    if (/\b(test|prueba|qa|dummy|fixture|placeholder|lorem|staging)\b/i.test(`${p.sku} ${p.name} ${desc}`)) {
      problemas.push(`${donde}parece un producto de prueba y no puede entrar a producción`);
    }
  }
  return problemas;
}

/**
 * Colisiones contra la autoridad LOCAL conocida: los 60 SKU actuales
 * (`loadCatalogSkus`, que ya reconcilia snapshot + góndola + unidades
 * minoristas) y los GTIN ya registrados o propuestos localmente. Esto es un
 * chequeo de PRE-VUELO, no la autoridad final: el propio SQL vuelve a
 * consultar `products`/`product_barcodes` en vivo y aborta ahí si algo
 * cambió entre este chequeo y el momento de aplicar.
 */
export async function revisarColisiones(altas) {
  const problemas = [];
  const { skus: actuales } = await loadCatalogSkus(ROOT);
  const skusActuales = new Set(actuales.map((s) => s.sku));
  const gtinsConocidos = new Set(RETAIL_UNIDADES.map((u) => u.gtin));

  const skusAltas = altas.map((p) => p.sku);
  if (new Set(skusAltas).size !== skusAltas.length) problemas.push('hay un SKU repetido dentro de las 12 altas');
  for (const p of altas) {
    if (skusActuales.has(p.sku)) problemas.push(`${p.sku}: colisiona con un SKU ya actual (60 actuales)`);
  }

  const gtinsAltas = altas.map((p) => p.gtin);
  if (new Set(gtinsAltas).size !== gtinsAltas.length) problemas.push('hay un GTIN repetido dentro de las 12 altas');
  for (const p of altas) {
    if (gtinsConocidos.has(p.gtin)) problemas.push(`${p.sku}: GTIN ${p.gtin} colisiona con una unidad minorista ya actual`);
  }

  return { problemas, skusActuales, totalActuales: actuales.length };
}

function capacidadLegible(p) {
  return p.capacityValue >= 1000
    ? `${String(Number((p.capacityValue / 1000).toFixed(2))).replace('.', ',')} L`
    : `${p.capacityValue} ${p.capacityUnit}`;
}

/** Descripción factual, mismo criterio que `descripcionDe` en
 *  `retail-unidades-plan.mjs` y `gondola-neuquen-plan.mjs`. */
export function descripcionDe(p) {
  const envase = String(p.packagingType).replaceAll('-', ' ');
  const pack = p.soldAsPack ? `, pack x${p.unitsPerPack}` : '';
  return `${p.name} en ${envase} de ${capacidadLegible(p)}${pack}.`;
}

const lit = (v) => (v === null || v === undefined ? 'null' : `'${String(v).replaceAll("'", "''")}'`);
const bool = (v) => (v ? 'true' : 'false');

/**
 * El lote: una sola transacción, INSERT liso de las 12 filas de `products` y
 * sus 12 filas hermanas de `product_barcodes`, encadenadas por el `id` que la
 * propia inserción devuelve. `sort_order = 0` para las 12 — igual criterio
 * que las 4 unidades minoristas ya aplicadas: no hay un esquema de orden
 * numérico vivo en el catálogo hoy (ninguno de los 60 SKU actuales lo trae en
 * `production-catalog-snapshot.json`), y 0 es el valor por omisión seguro que
 * exige `sort_order >= 0`.
 */
export function construirLoteAltas(altas, { verificadoPor = '' } = {}) {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(verificadoPor)) {
    throw new Error('verificadoPor tiene que ser el uuid de la persona que autoriza y verifica los datos maestros');
  }

  const valoresProductos = altas.map((p) => `  (${lit(BUSINESS_ID)}, ${lit(p.externalId)}, ${lit(p.sku)}, ${lit(p.brand)}, ${lit(p.name)},`
    + `\n   ${lit(descripcionDe(p))}, ${lit(p.category)}, ${lit(p.subcategory)}, ${lit(p.variant)}, ${lit(p.variant)},`
    + `\n   ${p.capacityValue}, ${lit(p.capacityUnit)}, ${lit(`${p.capacityValue} ${p.capacityUnit}`)}, ${lit(p.packagingType)}, ${p.unitsPerPack}, ${bool(p.soldAsPack)},`
    + `\n   ${p.price}, 'confirmed', 0, ${bool(p.chilled)}, ${bool(p.alcoholic)}, ${p.minimumAge == null ? 'null' : p.minimumAge},`
    + `\n   0, array[]::text[], 'commercial', true,`
    + `\n   true, now(), ${lit(verificadoPor)}, false, now())`).join(',\n');

  const valoresBarcodes = altas.map((p) => `  (${lit(p.externalId)}, ${lit(p.gtin)}, ${lit(p.gtinType)})`).join(',\n');

  const externalIds = altas.map((p) => p.externalId);
  const gtins = altas.map((p) => p.gtin);

  return `-- Góndola comercial final · 12 altas nuevas + 12 códigos de barras
-- Generado por scripts/gondola-retail-final-plan.mjs desde
-- catalog/gondola-retail-final-proposal.mjs. No editar a mano: se regenera.
--
-- Una sola transacción: o entran las 12 o no entra ninguna.
-- INSERT liso (NUNCA on conflict do update): si algún SKU o GTIN ya existe,
-- la transacción entera aborta y no escribe nada. No toca ninguna fila
-- existente de products ni de product_barcodes, no toca orders/order_items.
--
-- Las 12 nacen: stock = 0, available = false, sin packshot (fallback propio
-- de TABA). Se habilitan con un UPDATE aparte el día de la Recepción real.
--
-- verified_by / created_by = ${verificadoPor}

begin;

do $altas$
begin
  if not exists (select 1 from public.businesses where id = ${lit(BUSINESS_ID)}) then
    raise exception 'El negocio ${BUSINESS_ID} no existe en este proyecto.';
  end if;
  if exists (
    select 1 from public.businesses
     where id = ${lit(BUSINESS_ID)} and alcohol_sales_enabled is true
  ) then
    raise exception 'alcohol_sales_enabled cambió a true: este lote asume que sigue en false y no vuelve a decidirlo acá. Revisar antes de aplicar.';
  end if;
  if exists (
    select 1 from public.products
     where business_id = ${lit(BUSINESS_ID)} and external_id in (${externalIds.map(lit).join(',')})
  ) then
    raise exception 'al menos uno de los % SKU de la góndola final ya existe. Abortado antes de escribir.', ${altas.length};
  end if;
  if exists (
    select 1 from public.product_barcodes
     where business_id = ${lit(BUSINESS_ID)} and gtin in (${gtins.map(lit).join(',')})
  ) then
    raise exception 'al menos uno de los % GTIN ya está registrado para este negocio. Abortado antes de escribir.', ${altas.length};
  end if;
end
$altas$;

with nuevos as (
  insert into public.products (
    business_id, external_id, sku, brand, name,
    description, category, subcategory, variant, presentation,
    capacity_value, capacity_unit, capacity, packaging_type, units_per_pack, sold_as_pack,
    price, price_status, stock, chilled, is_alcoholic, minimum_age,
    sort_order, tags, catalog_origin, is_active,
    is_verified, verified_at, verified_by, available, updated_at
  )
  values
${valoresProductos}
  returning id, external_id
),
codigos (external_id, gtin, gtin_type) as (
  values
${valoresBarcodes}
)
-- package_type='unit', unit_factor=1 para las 12, incluidas las 4 cervezas
-- pack x6: el stock del producto ya cuenta packs, no latas sueltas, así que
-- un escaneo de este GTIN equivale a 1 unidad del STOCK DE ESTA FILA (el pack
-- completo) — no hay una unidad de conteo más chica en este catálogo. Mismo
-- criterio que ya usan las 4 unidades minoristas aplicadas en
-- retail-unidades-plan.mjs; no hay ningún GTIN con package_type='pack' ya
-- aplicado en este negocio del que copiar otro criterio.
insert into public.product_barcodes (
  business_id, product_id, gtin, barcode_type, package_type, unit_factor,
  is_primary, is_active, source, verified_at, created_by
)
select ${lit(BUSINESS_ID)}, n.id, c.gtin, c.gtin_type, 'unit', 1,
       true, true, 'manual', now(), ${lit(verificadoPor)}
  from nuevos n join codigos c on c.external_id = n.external_id;

commit;

-- Relectura: lo que quedó escrito, no lo que se pidió escribir.
select p.external_id, p.name, p.category, p.price, p.stock, p.available, p.is_verified,
       p.sold_as_pack, p.is_alcoholic, b.gtin
  from public.products p
  join public.product_barcodes b on b.product_id = p.id
 where p.business_id = ${lit(BUSINESS_ID)} and p.external_id in (${externalIds.map(lit).join(',')})
 order by p.external_id;

-- Control: el catálogo total del negocio antes de este lote tenía ${CATALOGO_ACTUAL}
-- filas; después de este lote, sin tocar ninguna, tiene que tener ${TOTAL_ESTIMADO}.
select count(*)::int as total_business from public.products where business_id = ${lit(BUSINESS_ID)};
`;
}

// ── Informe por consola ──────────────────────────────────────────────────────
if (process.argv[1]?.endsWith('gondola-retail-final-plan.mjs')) {
  const banderas = new Map();
  for (const a of process.argv.slice(2)) {
    if (!a.startsWith('--')) continue;
    const i = a.indexOf('=');
    if (i === -1) banderas.set(a.slice(2), true);
    else banderas.set(a.slice(2, i), a.slice(i + 1));
  }
  const verificadoPor = String(banderas.get('verificado-por') || '');

  console.log(`GÓNDOLA COMERCIAL FINAL · ${PRODUCTOS_PROPUESTOS.length} altas propuestas · ${CATALOGO_ACTUAL} actuales → ${TOTAL_ESTIMADO} estimado`);
  console.log('');
  for (const p of PRODUCTOS_PROPUESTOS) {
    const pack = p.soldAsPack ? `pack x${p.unitsPerPack}` : 'unidad';
    console.log(`  ${p.sku.padEnd(38)} $${p.price.toLocaleString('es-AR').padStart(7)}  ${capacidadLegible(p).padEnd(7)} ${pack.padEnd(9)} `
      + `${p.category.padEnd(9)} ${p.alcoholic ? 'ALCOHOL' : '       '}  gtin ${p.gtin}  stock=${p.stock} available=${p.available}`);
  }

  const problemasContrato = revisarAltas(PRODUCTOS_PROPUESTOS);
  const { problemas: problemasColision, totalActuales } = await revisarColisiones(PRODUCTOS_PROPUESTOS);
  const problemas = [...problemasContrato, ...problemasColision];

  console.log('');
  for (const p of problemas) console.error(`ERROR ${p}`);
  if (problemas.length) {
    console.error(`\n${problemas.length} problema(s). No se emite ningún lote.`);
    process.exit(1);
  }
  console.log(`contrato local (products_verified_*, product_barcodes_gtin_format): ${PRODUCTOS_PROPUESTOS.length}/${PRODUCTOS_PROPUESTOS.length} sin observaciones`);
  console.log(`colisión SKU vs. ${totalActuales} actuales: 0 · colisión GTIN vs. conocidos localmente: 0 (la base es la autoridad final al aplicar)`);
  console.log(`is_alcoholic/minimum_age vs. categoría (products_verified_alcohol_coherence): sin observaciones`);
  console.log('');
  console.log('Esta corrida NO escribe en ninguna base. NO se ejecutó contra staging ni producción.');

  if (banderas.has('sql')) {
    const sql = construirLoteAltas(PRODUCTOS_PROPUESTOS, { verificadoPor });
    const hash = crypto.createHash('sha256').update(sql, 'utf8').digest('hex');
    const destino = path.resolve(process.cwd(), 'artifacts/taba2-gondola-retail-final');
    fs.mkdirSync(destino, { recursive: true });
    const archivo = path.join(destino, 'gondola-retail-final-altas.sql');
    fs.writeFileSync(archivo, sql, 'utf8');
    console.log('');
    console.log(`lote escrito: ${path.relative(process.cwd(), archivo)}`);
    console.log(`sha256: ${hash}`);
    console.log(`verified_by=${verificadoPor} · 12 altas, stock=0, available=false hasta Recepción`);
  }
}
