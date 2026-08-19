/*
 * Mide producción y, con autorización explícita, aplica las 4 unidades
 * minoristas Coca-Cola-system (ver catalog/retail-unidades.mjs).
 *
 * Mismo canal que scripts/aplicar-gondola-neuquen.mjs: Management API de
 * Supabase con el token del CLI (scripts/lib/supabase-cli-token.mjs), NUNCA
 * un cliente con service_role. Es el único canal que puede crear un producto
 * comercial verificado sin foto — ver artifacts/taba2-retail-normalization/
 * RETAIL-DATA-REQUIRED.md para por qué `import_catalog_batch` no sirve acá.
 *
 * A DIFERENCIA de aplicar-gondola-neuquen.mjs, este script NUNCA hace upsert:
 * el lote de scripts/retail-unidades-plan.mjs es un INSERT liso. Si cualquiera
 * de los 4 SKU o los 4 GTIN ya existe, la transacción entera aborta —nunca
 * pisa una fila existente— y el guard lo repite ACÁ, en JS, antes de gastar
 * la llamada de red, además de adentro de la propia transacción SQL.
 *
 * GUARDAS, todas antes de mutar:
 *   1. el ref del proyecto es explícito y tiene que ser el productivo;
 *   2. el negocio canónico tiene que existir;
 *   3. ninguno de los 4 SKU ni de los 4 GTIN puede existir ya (releído en vivo,
 *      no asumido desde la auditoría de ayer);
 *   4. ensayo por omisión: sin --aplicar no escribe nada;
 *   5. --aplicar exige además la variable de autorización, DISTINTA de la de
 *      gondola-neuquen a propósito — que quede una autorización vieja en el
 *      entorno no puede habilitar esta escritura por accidente;
 *   6. --aplicar exige --verificado-por=<uuid> y --confirmado-por-humano: la
 *      verificación de datos maestros la firma una persona, no una herramienta;
 *   7. una sola transacción: o entran los 4 productos + sus 4 códigos de
 *      barras, o no entra nada;
 *   8. después de escribir, releer y comparar CONTRA EL PLAN fila por fila —Y
 *      releer los 4 packs hermanos y el conteo total de productos y pedidos
 *      para demostrar que además de lo nuevo, nada viejo se movió.
 *
 *   node scripts/aplicar-retail-unidades.mjs --ref=<ref>
 *   node scripts/aplicar-retail-unidades.mjs --ref=<ref> --aplicar \
 *        --verificado-por=<uuid> --confirmado-por-humano
 *
 * (los flags van con `=`: `--ref <ref>` separado por espacio NO se reconoce —
 * queda como bandera booleana suelta y el chequeo de --ref aborta).
 */
import { RETAIL_UNIDADES, BUSINESS_ID } from '../catalog/retail-unidades.mjs';
import { construirLoteRetail, revisarUnidadesRetail } from './retail-unidades-plan.mjs';
import { conToken } from './lib/supabase-cli-token.mjs';

const REF_PRODUCCION = 'wwcpogltfgzgkrlilbcd';
const AUTORIZACION = 'I_AUTHORIZE_TABA2_RETAIL_UNITS_INSERT';

const banderas = new Map();
for (const a of process.argv.slice(2)) {
  if (!a.startsWith('--')) continue;
  const i = a.indexOf('=');
  if (i === -1) banderas.set(a.slice(2), true);
  else banderas.set(a.slice(2, i), a.slice(i + 1));
}
const abortar = (m) => { console.error(`ABORTAR: ${m}`); process.exit(2); };

const ref = String(banderas.get('ref') || '');
if (ref !== REF_PRODUCCION) {
  abortar(`--ref debe ser ${REF_PRODUCCION}. No hay default implícito: escribir en el proyecto equivocado no se deshace.`);
}
const aplicar = banderas.has('aplicar');
const verificadoPor = banderas.get('verificado-por') ? String(banderas.get('verificado-por')) : '';

if (aplicar && process.env.TABA2_RETAIL_UNITS_APPLY !== AUTORIZACION) {
  abortar(`--aplicar exige TABA2_RETAIL_UNITS_APPLY="${AUTORIZACION}" en el entorno.`);
}
if (aplicar && !banderas.has('confirmado-por-humano')) {
  abortar('--aplicar exige --confirmado-por-humano además de --verificado-por.');
}
if (aplicar && !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(verificadoPor)) {
  abortar('--aplicar exige --verificado-por=<uuid> de la persona que autoriza los datos maestros.');
}

const problemas = revisarUnidadesRetail(RETAIL_UNIDADES);
if (problemas.length) {
  for (const p of problemas) console.error(`ERROR ${p}`);
  abortar(`${problemas.length} fila(s) no cumplen el contrato local. No se tocó la red.`);
}

const lit = (v) => `'${String(v).replaceAll("'", "''")}'`;
const externalIds = RETAIL_UNIDADES.map((u) => u.externalId);
const gtins = RETAIL_UNIDADES.map((u) => u.gtin);
const packsHermanos = RETAIL_UNIDADES.map((u) => u.siblingPackExternalId);

await conToken(async (token) => {
  const sql = async (query) => {
    const r = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        'User-Agent': 'taba2-retail-unidades/1.0',
      },
      body: JSON.stringify({ query }),
    });
    const t = await r.text();
    if (!r.ok) throw new Error(`HTTP ${r.status} · ${t.slice(0, 1200)}`);
    return t ? JSON.parse(t) : null;
  };

  const [negocio] = await sql(`select id, name, status, is_active, alcohol_sales_enabled, currency_code
      from public.businesses where id = ${lit(BUSINESS_ID)};`);
  if (!negocio) abortar(`el negocio ${BUSINESS_ID} no existe en ${ref}`);

  const [antes] = await sql(`select
      (select count(*) from public.products where business_id = ${lit(BUSINESS_ID)})::int as productos,
      (select count(*) from public.orders)::int as pedidos,
      (select count(*) from public.product_barcodes where business_id = ${lit(BUSINESS_ID)})::int as codigos;`);

  console.log(`negocio        ${negocio.name} · ${negocio.status} · activo=${negocio.is_active} · alcohol=${negocio.alcohol_sales_enabled} · ${negocio.currency_code}`);
  console.log(`ANTES          ${antes.productos} productos · ${antes.codigos} códigos de barras · ${antes.pedidos} pedidos`);

  const packsAntes = await sql(`select external_id, name, price, stock, available, is_verified, sold_as_pack,
      units_per_pack, image_url, catalog_asset_id, sort_order
    from public.products where business_id = ${lit(BUSINESS_ID)} and external_id in (${packsHermanos.map(lit).join(',')})
    order by sort_order;`);
  console.log('');
  console.log('4 packs hermanos (deben seguir intactos después de aplicar):');
  for (const p of packsAntes) console.log(`  ${p.external_id} · $${p.price} · stock ${p.stock} · ${p.available ? 'disponible' : 'no disponible'} · sort ${p.sort_order}`);
  if (packsAntes.length !== 4) abortar(`esperaba los 4 packs hermanos y encontré ${packsAntes.length}. Algo cambió desde la auditoría — no sigo.`);

  const colisionSku = await sql(`select external_id from public.products
      where business_id = ${lit(BUSINESS_ID)} and external_id in (${externalIds.map(lit).join(',')});`);
  const colisionGtin = await sql(`select gtin from public.product_barcodes
      where business_id = ${lit(BUSINESS_ID)} and gtin in (${gtins.map(lit).join(',')});`);
  console.log('');
  console.log(`colisión de SKU: ${colisionSku.length === 0 ? 'ninguna (OK)' : colisionSku.map((r) => r.external_id).join(', ')}`);
  console.log(`colisión de GTIN: ${colisionGtin.length === 0 ? 'ninguna (OK)' : colisionGtin.map((r) => r.gtin).join(', ')}`);
  if (colisionSku.length || colisionGtin.length) {
    abortar('hay colisión contra producción viva. No se escribe nada.');
  }

  if (!aplicar) {
    console.log('');
    console.log(`ENSAYO: no se escribió nada. ${RETAIL_UNIDADES.length} SKU + ${RETAIL_UNIDADES.length} códigos de barras listos para aplicar.`);
    console.log('Para aplicar: --aplicar --verificado-por=<uuid> --confirmado-por-humano, con TABA2_RETAIL_UNITS_APPLY en el entorno.');
    return;
  }

  await sql(construirLoteRetail(RETAIL_UNIDADES, { verificadoPor }));

  // ── Relectura desde la base, comparada contra el plan ─────────────────────
  const cargados = await sql(`select p.external_id, p.sku, p.name, p.brand, p.category, p.subcategory, p.variant,
        p.presentation, p.capacity_value::text as capacity_value, p.capacity_unit, p.capacity, p.packaging_type,
        p.units_per_pack, p.sold_as_pack, p.price::text as price, p.price_status, p.stock, p.available,
        p.is_verified, p.is_active, p.is_alcoholic, p.minimum_age, p.catalog_origin, p.image_url,
        p.catalog_asset_id, p.sort_order, p.verified_by::text as verified_by,
        b.gtin, b.barcode_type, b.package_type, b.unit_factor, b.is_primary, b.source, b.created_by::text as created_by
      from public.products p
      join public.product_barcodes b on b.product_id = p.id
     where p.business_id = ${lit(BUSINESS_ID)} and p.external_id in (${externalIds.map(lit).join(',')})
     order by p.external_id;`);

  const esperado = new Map(RETAIL_UNIDADES.map((u) => [u.externalId, u]));
  const fallas = [];
  for (const fila of cargados) {
    const u = esperado.get(fila.external_id);
    if (!u) { fallas.push(`${fila.external_id}: fila que no está en el plan`); continue; }
    const igual = (campo, leido, esperadoValor) => {
      if (String(leido) !== String(esperadoValor)) fallas.push(`${fila.external_id}: ${campo} «${leido}» ≠ «${esperadoValor}»`);
    };
    igual('name', fila.name, u.name);
    igual('brand', fila.brand, u.brand);
    igual('category', fila.category, u.category);
    igual('subcategory', fila.subcategory, u.subcategory);
    igual('variant', fila.variant, u.variant);
    igual('presentation', fila.presentation, u.variant);
    igual('capacity_value', fila.capacity_value, u.capacityValue);
    igual('capacity', fila.capacity, `${u.capacityValue} ml`);
    igual('packaging_type', fila.packaging_type, u.packagingType);
    igual('price', Number(fila.price), u.price);
    igual('gtin', fila.gtin, u.gtin);
    igual('barcode_type', fila.barcode_type, u.gtinType);
    igual('verified_by', fila.verified_by, verificadoPor);
    igual('created_by', fila.created_by, verificadoPor);
    if (fila.units_per_pack !== 1) fallas.push(`${fila.external_id}: units_per_pack ${fila.units_per_pack} ≠ 1`);
    if (fila.sold_as_pack !== false) fallas.push(`${fila.external_id}: sold_as_pack ${fila.sold_as_pack} ≠ false`);
    if (fila.stock !== 0) fallas.push(`${fila.external_id}: stock ${fila.stock} ≠ 0`);
    if (fila.available !== false) fallas.push(`${fila.external_id}: available ${fila.available} ≠ false`);
    if (fila.is_verified !== true) fallas.push(`${fila.external_id}: is_verified ${fila.is_verified} ≠ true`);
    if (fila.is_active !== true) fallas.push(`${fila.external_id}: is_active ${fila.is_active} ≠ true`);
    if (fila.is_alcoholic !== false) fallas.push(`${fila.external_id}: is_alcoholic ${fila.is_alcoholic} ≠ false`);
    if (fila.minimum_age !== null) fallas.push(`${fila.external_id}: minimum_age ${fila.minimum_age} ≠ null`);
    if (fila.price_status !== 'confirmed') fallas.push(`${fila.external_id}: price_status ${fila.price_status}`);
    if (fila.catalog_origin !== 'commercial') fallas.push(`${fila.external_id}: catalog_origin ${fila.catalog_origin}`);
    if (fila.sort_order !== 0) fallas.push(`${fila.external_id}: sort_order ${fila.sort_order} ≠ 0`);
    if (fila.image_url || fila.catalog_asset_id) fallas.push(`${fila.external_id}: quedó con imagen y no se cargó ninguna (tiene que usar el fallback)`);
    if (fila.package_type !== 'unit') fallas.push(`${fila.external_id}: package_type ${fila.package_type} ≠ unit`);
    if (fila.unit_factor !== 1) fallas.push(`${fila.external_id}: unit_factor ${fila.unit_factor} ≠ 1`);
    if (fila.is_primary !== true) fallas.push(`${fila.external_id}: is_primary ${fila.is_primary} ≠ true`);
    if (fila.source !== 'manual') fallas.push(`${fila.external_id}: source ${fila.source} ≠ manual`);
  }
  for (const u of RETAIL_UNIDADES) {
    if (!cargados.some((f) => f.external_id === u.externalId)) fallas.push(`${u.externalId}: no llegó a la base`);
  }

  // ── Los 4 packs hermanos y todo lo demás: byte a byte contra el ANTES ─────
  const packsDespues = await sql(`select external_id, name, price, stock, available, is_verified, sold_as_pack,
      units_per_pack, image_url, catalog_asset_id, sort_order
    from public.products where business_id = ${lit(BUSINESS_ID)} and external_id in (${packsHermanos.map(lit).join(',')})
    order by sort_order;`);
  for (let i = 0; i < packsAntes.length; i += 1) {
    const a = JSON.stringify(packsAntes[i]);
    const d = JSON.stringify(packsDespues[i]);
    if (a !== d) fallas.push(`pack ${packsAntes[i].external_id} CAMBIÓ: ${a} → ${d}`);
  }

  const [despues] = await sql(`select
      (select count(*) from public.products where business_id = ${lit(BUSINESS_ID)})::int as productos,
      (select count(*) from public.orders)::int as pedidos,
      (select count(*) from public.product_barcodes where business_id = ${lit(BUSINESS_ID)})::int as codigos;`);
  console.log('');
  console.log(`DESPUÉS        ${despues.productos} productos · ${despues.codigos} códigos de barras · ${despues.pedidos} pedidos`);
  if (despues.productos !== antes.productos + RETAIL_UNIDADES.length) fallas.push(`el conteo de productos no subió en ${RETAIL_UNIDADES.length}: ${antes.productos} → ${despues.productos}`);
  if (despues.codigos !== antes.codigos + RETAIL_UNIDADES.length) fallas.push(`el conteo de códigos de barras no subió en ${RETAIL_UNIDADES.length}: ${antes.codigos} → ${despues.codigos}`);
  if (despues.pedidos !== antes.pedidos) fallas.push(`la cantidad de pedidos cambió: ${antes.pedidos} → ${despues.pedidos}`);

  const [lt0001] = await sql(`select total from public.orders where public_code = 'LT-0001';`);
  if (!lt0001 || Number(lt0001.total) !== 17100) fallas.push(`LT-0001 cambió o desapareció: ${JSON.stringify(lt0001)}`);

  if (fallas.length) {
    for (const f of fallas) console.error(`ERROR ${f}`);
    console.error(`\n${fallas.length} discrepancia(s) entre el plan y lo que quedó escrito.`);
    process.exitCode = 1;
    return;
  }
  console.log('');
  console.log('OK · las 4 unidades y sus 4 códigos de barras quedaron cargados, coinciden fila por fila con el plan,');
  console.log('     los 4 packs hermanos y LT-0001 no cambiaron un solo campo, y el conteo de pedidos es idéntico.');
});
