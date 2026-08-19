/*
 * Arma y revisa el plan de las 4 unidades minoristas Coca-Cola-system.
 *
 * HOJA PURA: no abre la red, no lee credenciales, no escribe en ninguna base.
 * Mismo patrón que `gondola-neuquen-plan.mjs`, pero a propósito NO reusa
 * `construirLote` de ese archivo: esa función hace `insert ... on conflict
 * (business_id, external_id) do update`, pensada para poder re-aplicar el
 * lote completo de 52 sin romper nada. Corrida sobre estas 4 filas nuevas eso
 * mismo sería la trampa: si algún día alguien la reusa por error con datos
 * viejos, un conflicto se resolvería pisando en vez de fallando. Acá un
 * conflicto tiene que ABORTAR el lote entero, nunca escribir sobre una fila
 * que ya existe — por diseño, un INSERT liso, sin `on conflict`.
 *
 *   node scripts/retail-unidades-plan.mjs               # plan y revisión
 *   node scripts/retail-unidades-plan.mjs --sql \
 *        --verificado-por=<uuid>                        # además emite el lote
 *
 * (los flags van con `=`, no separados por espacio).
 */
import fs from 'node:fs';
import path from 'node:path';
import { RETAIL_UNIDADES, BUSINESS_ID } from '../catalog/retail-unidades.mjs';

export { BUSINESS_ID };

const CATEGORIA_FIJA = 'Gaseosas';
const CAPACITY_UNIT_FIJA = 'ml';

/** Mismo algoritmo que `public.gtin_check_digit_valid` (GS1 mod10). Sólo para
 *  detectar un error de tipeo ANTES de gastar una llamada de red: la
 *  autoridad real es la función de la base, que el script de aplicar vuelve
 *  a consultar antes de escribir. */
export function gtinDigitoVerificadorValido(gtin) {
  if (!/^[0-9]+$/.test(gtin) || ![8, 12, 13, 14].includes(gtin.length)) return false;
  let suma = 0;
  let peso = 3;
  for (let i = gtin.length - 1; i >= 1; i -= 1) {
    suma += Number(gtin[i - 1]) * peso;
    peso = peso === 3 ? 1 : 3;
  }
  const esperado = (10 - (suma % 10)) % 10;
  return Number(gtin[gtin.length - 1]) === esperado;
}

const ENVASE_LEGIBLE = { 'Botella PET': 'botella PET' };

function capacidadLegible(u) {
  return u.capacityValue >= 1000
    ? `${String(Number((u.capacityValue / 1000).toFixed(2))).replace('.', ',')} L`
    : `${u.capacityValue} ml`;
}

/** Descripción factual, mismo criterio que `descripcionDe` de gondola-neuquen.mjs. */
export function descripcionDe(u) {
  const envase = ENVASE_LEGIBLE[u.packagingType] || u.packagingType.toLowerCase();
  return `${u.name} en ${envase} de ${capacidadLegible(u)}.`;
}

/**
 * El contrato exacto que exige la base para estas filas — leído de los
 * CHECK reales de `public.products` y `public.product_barcodes`
 * (`products_verified_master_data`, `products_verified_publication_authority`,
 * `products_verified_numeric_ranges`, `products_verified_alcohol_coherence`,
 * `product_barcodes_gtin_format`), no una copia aproximada.
 */
export function revisarUnidadesRetail(unidades) {
  const problemas = [];
  const vistos = new Set();
  for (const u of unidades) {
    const donde = `${u.sku}: `;
    if (vistos.has(u.sku)) problemas.push(`${donde}SKU repetido dentro del lote`);
    vistos.add(u.sku);
    if (u.externalId !== u.sku) problemas.push(`${donde}externalId tiene que ser igual a sku en este lote`);
    if (u.category !== CATEGORIA_FIJA) problemas.push(`${donde}categoría tiene que ser «${CATEGORIA_FIJA}» (las 4 son gaseosas)`);
    for (const campo of ['brand', 'name', 'subcategory', 'variant', 'packagingType']) {
      if (!String(u[campo] || '').trim()) problemas.push(`${donde}${campo} vacío`);
    }
    if (!(u.capacityValue > 0)) problemas.push(`${donde}capacity_value tiene que ser mayor a cero`);
    if (!(u.price > 0)) problemas.push(`${donde}precio tiene que ser mayor a cero`);
    if (!/^[0-9]+([.][0-9]{1,2})?$/.test(String(u.price))) problemas.push(`${donde}precio con formato inválido para products_verified_numeric_ranges`);
    const desc = descripcionDe(u);
    if (desc.length > 180) problemas.push(`${donde}descripción de más de 180 caracteres`);
    if (/\b(test|prueba|qa|dummy|fixture|placeholder|lorem|staging)\b/i.test(`${u.sku} ${u.name} ${desc}`)) {
      problemas.push(`${donde}parece un producto de prueba y no puede entrar a producción`);
    }
    if (!/^[0-9]{8}$|^[0-9]{12}$|^[0-9]{13}$|^[0-9]{14}$/.test(u.gtin)) {
      problemas.push(`${donde}GTIN «${u.gtin}» no tiene una longitud válida (8/12/13/14)`);
    } else if (!gtinDigitoVerificadorValido(u.gtin)) {
      problemas.push(`${donde}GTIN «${u.gtin}» tiene dígito verificador inválido`);
    }
    const tipoEsperado = { 8: 'EAN-8', 12: 'UPC-A', 13: 'EAN-13', 14: 'GTIN-14' }[u.gtin.length];
    if (u.gtinType !== tipoEsperado) problemas.push(`${donde}gtinType «${u.gtinType}» no corresponde a un GTIN de ${u.gtin.length} dígitos (esperado ${tipoEsperado})`);
  }
  const gtins = unidades.map((u) => u.gtin);
  if (new Set(gtins).size !== gtins.length) problemas.push('hay un GTIN repetido dentro del lote');
  return problemas;
}

const lit = (v) => (v === null || v === undefined ? 'null' : `'${String(v).replaceAll("'", "''")}'`);
const bool = (v) => (v ? 'true' : 'false');

/**
 * El lote: una sola transacción, INSERT liso (nunca upsert) de las 4 filas de
 * `products` y sus 4 filas hermanas de `product_barcodes`, encadenadas por
 * los `id` que la propia inserción devuelve — sin una segunda ida y vuelta a
 * la red.
 *
 * Contrato de cada fila, y por qué:
 *   catalog_origin = 'commercial'   igual que el resto del catálogo real.
 *   sold_as_pack   = false          es la unidad, no el pack.
 *   units_per_pack = 1              una botella es una botella.
 *   stock          = 0              no hay conteo unitario real y demostrable
 *                                    (ver catalog/retail-unidades.mjs); es el
 *                                    único valor que dice la verdad y permite
 *                                    is_verified = true a la vez.
 *   available      = false          consecuencia del stock, no una decisión
 *                                    aparte: con stock 0 el CHECK
 *                                    products_available_requires_verification
 *                                    lo exige. No se calcula acá: se ESCRIBE
 *                                    false y ese mismo CHECK certifica que es
 *                                    la única opción legal.
 *   is_verified    = true           los datos maestros los dio y autorizó el
 *                                    dueño en esta misión.
 *   sort_order     = 0              los 4 packs hermanos ya ocupan 1..4 sin
 *                                    ningún hueco (no se les toca el orden:
 *                                    "packs modified = 0"); 0 es el propio
 *                                    valor por omisión de la columna y dispara
 *                                    products_verified_numeric_ranges (exige
 *                                    sort_order >= 0, nunca negativo). Con 0
 *                                    < 1..4 la unidad SIEMPRE ordena antes que
 *                                    su pack, para las 4 parejas a la vez.
 *   imagen         = las seis null  recurso propio de TABA (fallback), igual
 *                                    que 52 de los 56 productos ya vivos. Los
 *                                    4 packshots oficiales siguen siendo
 *                                    exclusivos de sus 4 SKU pack.
 */
export function construirLoteRetail(unidades, { verificadoPor = '' } = {}) {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(verificadoPor)) {
    throw new Error('verificadoPor tiene que ser el uuid de la persona que autoriza y verifica los datos maestros');
  }

  const valoresProductos = unidades.map((u) => `  (${lit(BUSINESS_ID)}, ${lit(u.externalId)}, ${lit(u.sku)}, ${lit(u.brand)}, ${lit(u.name)},`
    + `\n   ${lit(descripcionDe(u))}, ${lit(u.category)}, ${lit(u.subcategory)}, ${lit(u.variant)}, ${lit(u.variant)},`
    + `\n   ${u.capacityValue}, ${lit(CAPACITY_UNIT_FIJA)}, ${lit(`${u.capacityValue} ${CAPACITY_UNIT_FIJA}`)}, ${lit(u.packagingType)}, 1, false,`
    + `\n   ${u.price}, 'confirmed', 0, false, false, null, 0, array[]::text[], 'commercial', true,`
    + `\n   true, now(), ${lit(verificadoPor)}, false, now())`).join(',\n');

  const valoresBarcodes = unidades.map((u) => `  (${lit(u.externalId)}, ${lit(u.gtin)}, ${lit(u.gtinType)})`).join(',\n');

  const externalIds = unidades.map((u) => u.externalId);
  const gtins = unidades.map((u) => u.gtin);

  return `-- Unidades minoristas Coca-Cola-system · ${unidades.length} SKU nuevos + ${unidades.length} codigos de barras
-- Generado por scripts/retail-unidades-plan.mjs desde catalog/retail-unidades.mjs.
-- No editar a mano: se regenera.
--
-- Una sola transaccion. INSERT liso (NUNCA on conflict do update): si alguna
-- de las 4 filas ya existe, la transaccion entera aborta y no escribe nada.
-- No toca ninguna fila existente de products ni de product_barcodes.
-- verified_by / created_by = ${verificadoPor}

begin;

do $retail$
begin
  if not exists (select 1 from public.businesses where id = ${lit(BUSINESS_ID)}) then
    raise exception 'El negocio ${BUSINESS_ID} no existe en este proyecto.';
  end if;
  if exists (
    select 1 from public.products
     where business_id = ${lit(BUSINESS_ID)} and external_id in (${externalIds.map(lit).join(',')})
  ) then
    raise exception 'al menos uno de los % SKU minoristas ya existe. Abortado antes de escribir.', ${unidades.length};
  end if;
  if exists (
    select 1 from public.product_barcodes
     where business_id = ${lit(BUSINESS_ID)} and gtin in (${gtins.map(lit).join(',')})
  ) then
    raise exception 'al menos uno de los % GTIN ya esta registrado para este negocio. Abortado antes de escribir.', ${unidades.length};
  end if;
end
$retail$;

with nuevos as (
  insert into public.products (
    business_id, external_id, sku, brand, name,
    description, category, subcategory, variant, presentation,
    capacity_value, capacity_unit, capacity, packaging_type, units_per_pack, sold_as_pack,
    price, price_status, stock, chilled, is_alcoholic, minimum_age, sort_order, tags, catalog_origin, is_active,
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
insert into public.product_barcodes (
  business_id, product_id, gtin, barcode_type, package_type, unit_factor,
  is_primary, is_active, source, verified_at, created_by
)
select ${lit(BUSINESS_ID)}, n.id, c.gtin, c.gtin_type, 'unit', 1,
       true, true, 'manual', now(), ${lit(verificadoPor)}
  from nuevos n join codigos c on c.external_id = n.external_id;

commit;

-- Relectura: lo que quedo escrito, no lo que se pidio escribir.
select p.external_id, p.name, p.presentation, p.price, p.stock, p.available, p.is_verified,
       p.sold_as_pack, p.sort_order, b.gtin, b.barcode_type
  from public.products p
  join public.product_barcodes b on b.product_id = p.id
 where p.business_id = ${lit(BUSINESS_ID)} and p.external_id in (${externalIds.map(lit).join(',')})
 order by p.external_id;
`;
}

// ── Informe por consola ──────────────────────────────────────────────────────
if (process.argv[1]?.endsWith('retail-unidades-plan.mjs')) {
  const banderas = new Map();
  for (const a of process.argv.slice(2)) {
    if (!a.startsWith('--')) continue;
    const i = a.indexOf('=');
    if (i === -1) banderas.set(a.slice(2), true);
    else banderas.set(a.slice(2, i), a.slice(i + 1));
  }
  const verificadoPor = String(banderas.get('verificado-por') || '');

  console.log(`UNIDADES MINORISTAS · ${RETAIL_UNIDADES.length} SKU nuevos, hermanos de 4 packs que YA existen y no se tocan`);
  for (const u of RETAIL_UNIDADES) {
    console.log(`  ${u.sku.padEnd(30)} $${u.price.toLocaleString('es-AR')}  ${u.variant.padEnd(8)}  gtin ${u.gtin} (${u.gtinType})  hermano: ${u.siblingPackExternalId}`);
  }

  const problemas = revisarUnidadesRetail(RETAIL_UNIDADES);
  console.log('');
  for (const p of problemas) console.error(`ERROR ${p}`);
  if (problemas.length) {
    console.error(`\n${problemas.length} problema(s). No se emite ningún lote.`);
    process.exit(1);
  }
  console.log(`contrato local: ${RETAIL_UNIDADES.length}/${RETAIL_UNIDADES.length} sin observaciones (la base es la autoridad final)`);

  if (banderas.has('sql')) {
    const destino = path.resolve(process.cwd(), 'artifacts/taba2-retail-normalization');
    fs.mkdirSync(destino, { recursive: true });
    const archivo = path.join(destino, 'retail-unidades.sql');
    fs.writeFileSync(archivo, construirLoteRetail(RETAIL_UNIDADES, { verificadoPor }), 'utf8');
    console.log('');
    console.log(`lote escrito: ${path.relative(process.cwd(), archivo)}`);
  }
}
