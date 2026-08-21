/*
 * Mide PRODUCCIÓN y, con autorización humana explícita, aplica las 12 altas de
 * la góndola comercial final (60 → 72 SKU).
 *
 * Es el script APARTE que el de staging anunciaba: existe recién ahora porque
 * el dueño abrió la misión de go-live. SÓLO PRODUCCIÓN, ref hardcodeado y
 * comparado byte a byte. Mismo canal que todo el tooling: Management API con el
 * token del CLI (scripts/lib/supabase-cli-token.mjs), nunca service_role.
 *
 * EL LOTE NO SE REGENERA ACÁ: se lee el artefacto congelado
 * artifacts/taba2-gondola-retail-final/gondola-retail-final-altas.sql y se
 * verifica su SHA-256 contra el valor certificado antes de mandar un byte.
 *
 * TRES MODOS, del más inocuo al definitivo:
 *   (sin flags)             ensayo read-only: guardas y colisiones, cero
 *                           escrituras, ni siquiera transitorias.
 *   --ensayo-transaccional  ejecuta el lote REAL dentro de una transacción que
 *                           termina en ROLLBACK: demuestra que las 12+12 filas
 *                           entran limpias en el esquema vivo y no deja NADA.
 *                           Exige el mismo gate humano que aplicar: es una
 *                           escritura, aunque se deshaga sola.
 *   --aplicar               la escritura real, con verificación completa
 *                           después: 12 filas contra el plan campo por campo,
 *                           los 60 SKU previos byte a byte contra el ANTES,
 *                           LT-0001 intacto, conteos exactos (60→72).
 *
 * GATE HUMANO para --ensayo-transaccional y --aplicar:
 *   TABA2_GONDOLA_RETAIL_FINAL_PRODUCTION_APPLY=
 *     I_AUTHORIZE_TABA2_GONDOLA_RETAIL_FINAL_PRODUCTION_INSERT
 *   más --confirmado-por-humano, y para --aplicar además
 *   --verificado-por=<uuid> (quien firma los datos maestros).
 *
 * Los flags van con `=`: `--ref <ref>` separado por espacio NO se reconoce.
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { BUSINESS_ID, PRODUCTOS_PROPUESTOS } from '../catalog/gondola-retail-final-proposal.mjs';
import { revisarAltas } from './gondola-retail-final-plan.mjs';
import { loadCatalogSkus } from './catalog-images/catalog-skus.mjs';
import { conToken } from './lib/supabase-cli-token.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const REF_PRODUCCION = 'wwcpogltfgzgkrlilbcd';
const AUTORIZACION = 'I_AUTHORIZE_TABA2_GONDOLA_RETAIL_FINAL_PRODUCTION_INSERT';
const LOTE_PATH = path.join(ROOT, 'artifacts', 'taba2-gondola-retail-final', 'gondola-retail-final-altas.sql');
const LOTE_SHA256 = '56a7127e4f5884527de0188737c1ac186f783809c3cbe7e6eed37ebc7147d1a6';

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
  abortar(`--ref debe ser ${REF_PRODUCCION} (producción). No hay default implícito: escribir en el proyecto equivocado no se deshace.`);
}
const aplicar = banderas.has('aplicar');
const ensayoTransaccional = banderas.has('ensayo-transaccional');
if (aplicar && ensayoTransaccional) abortar('--aplicar y --ensayo-transaccional son excluyentes: uno escribe, el otro demuestra que podría.');
const escribe = aplicar || ensayoTransaccional;
const verificadoPor = banderas.get('verificado-por') ? String(banderas.get('verificado-por')) : '';

if (escribe && process.env.TABA2_GONDOLA_RETAIL_FINAL_PRODUCTION_APPLY !== AUTORIZACION) {
  abortar(`este modo exige TABA2_GONDOLA_RETAIL_FINAL_PRODUCTION_APPLY="${AUTORIZACION}" en el entorno.`);
}
if (escribe && !banderas.has('confirmado-por-humano')) {
  abortar('este modo exige --confirmado-por-humano: lo corre una persona, no un pipeline.');
}
if (aplicar && !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(verificadoPor)) {
  abortar('--aplicar exige --verificado-por=<uuid> de la persona que autoriza los datos maestros.');
}

// ── El lote congelado, con su integridad demostrada ──────────────────────────
const loteTexto = readFileSync(LOTE_PATH, 'utf8');
const shaReal = createHash('sha256').update(loteTexto).digest('hex');
if (shaReal !== LOTE_SHA256) {
  abortar(`el lote en disco no es el certificado: sha256 ${shaReal} ≠ ${LOTE_SHA256}. No se manda nada.`);
}
// El verificador del lote congelado tiene que ser el mismo que firma la corrida.
if (aplicar && !loteTexto.includes(verificadoPor)) {
  abortar(`--verificado-por=${verificadoPor} no aparece en el lote congelado: el lote fue generado para otro verificador.`);
}

const problemasLocal = revisarAltas(PRODUCTOS_PROPUESTOS);
if (problemasLocal.length) {
  for (const p of problemasLocal) console.error(`ERROR ${p}`);
  abortar(`${problemasLocal.length} fila(s) no cumplen el contrato local. No se tocó la red.`);
}

// Variante de ensayo: el MISMO texto hasta el commit, que se vuelve rollback.
// Todo lo que sigue al commit (las relecturas) queda afuera: después de un
// rollback no habría nada que releer.
const idxCommit = loteTexto.indexOf('\ncommit;');
if (idxCommit === -1) abortar('el lote congelado no tiene su commit donde se esperaba.');
const loteEnsayo = `${loteTexto.slice(0, idxCommit)}\nrollback; -- ENSAYO TRANSACCIONAL: nada queda escrito\n`;

// Los 60 ANTERIORES al lote: la autoridad por defecto ya incluye las 12 altas.
const { skus: actuales } = await loadCatalogSkus(ROOT, { gondolaFinal: false });
const externalIdsActuales = actuales.map((s) => s.sku);
const lit = (v) => `'${String(v).replaceAll("'", "''")}'`;
const externalIds = PRODUCTOS_PROPUESTOS.map((p) => p.externalId);
const gtins = PRODUCTOS_PROPUESTOS.map((p) => p.gtin);

await conToken(async (token) => {
  const sql = async (query) => {
    const r = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        'User-Agent': 'taba2-gondola-retail-final-produccion/1.0',
      },
      body: JSON.stringify({ query }),
    });
    const t = await r.text();
    if (!r.ok) throw new Error(`HTTP ${r.status} · ${t.slice(0, 1200)}`);
    return t ? JSON.parse(t) : null;
  };

  // ── Guardas, todas antes de mandar el lote ─────────────────────────────────
  const [negocio] = await sql(`select id, name, status, is_active, alcohol_sales_enabled, currency_code
      from public.businesses where id = ${lit(BUSINESS_ID)};`);
  if (!negocio) abortar(`el negocio ${BUSINESS_ID} no existe en ${ref}`);
  if (negocio.alcohol_sales_enabled === true) {
    abortar('alcohol_sales_enabled está en true en PRODUCCIÓN: este lote asume que sigue en false y no vuelve a decidirlo acá.');
  }

  const columnasProducts = (await sql(`select column_name from information_schema.columns
      where table_schema='public' and table_name='products';`)).map((r) => r.column_name);
  for (const col of ['sold_as_pack', 'external_id', 'price_status', 'catalog_origin']) {
    if (!columnasProducts.includes(col)) abortar(`products en ${ref} no tiene la columna ${col}: esquema inesperado.`);
  }

  const [antes] = await sql(`select
      (select count(*) from public.products where business_id = ${lit(BUSINESS_ID)})::int as productos,
      (select count(*) from public.orders)::int as pedidos,
      (select count(*) from public.product_barcodes where business_id = ${lit(BUSINESS_ID)})::int as codigos;`);

  console.log(`ref            ${ref} (PRODUCCIÓN)`);
  console.log(`negocio        ${negocio.name} · ${negocio.status} · activo=${negocio.is_active} · alcohol=${negocio.alcohol_sales_enabled} · ${negocio.currency_code}`);
  console.log(`lote           ${LOTE_PATH}`);
  console.log(`               sha256 ${shaReal} (verificado)`);
  console.log(`ANTES          ${antes.productos} productos · ${antes.codigos} códigos de barras · ${antes.pedidos} pedidos`);
  if (antes.productos !== 60) {
    abortar(`producción tiene ${antes.productos} productos y el contrato de este lote es 60 → 72. Alguien movió el catálogo: re-auditar antes de aplicar.`);
  }

  const actualesAntes = await sql(`select external_id, price, stock, available, is_verified, sold_as_pack,
      units_per_pack, category, is_alcoholic
    from public.products where business_id = ${lit(BUSINESS_ID)} and external_id in (${externalIdsActuales.map(lit).join(',')})
    order by external_id;`);
  if (actualesAntes.length !== 60) {
    abortar(`la autoridad local esperaba 60 SKU actuales y producción devolvió ${actualesAntes.length}. Re-auditar.`);
  }
  console.log(`60 actuales    ${actualesAntes.length}/60 encontrados (se comparan byte a byte después)`);

  const colisionSku = await sql(`select external_id from public.products
      where business_id = ${lit(BUSINESS_ID)} and external_id in (${externalIds.map(lit).join(',')});`);
  const colisionGtin = await sql(`select gtin from public.product_barcodes
      where business_id = ${lit(BUSINESS_ID)} and gtin in (${gtins.map(lit).join(',')});`);
  console.log('');
  console.log(`colisión de SKU (12 altas): ${colisionSku.length === 0 ? 'ninguna (OK)' : colisionSku.map((r) => r.external_id).join(', ')}`);
  console.log(`colisión de GTIN (12 altas): ${colisionGtin.length === 0 ? 'ninguna (OK)' : colisionGtin.map((r) => r.gtin).join(', ')}`);
  if (colisionSku.length || colisionGtin.length) {
    abortar('hay colisión contra producción viva. No se escribe nada.');
  }

  const [lt0001Antes] = await sql("select public_code, status, total from public.orders where public_code = 'LT-0001';");
  console.log(`LT-0001        ${lt0001Antes ? `${lt0001Antes.status} · total ${lt0001Antes.total}` : 'no existe (inesperado en producción)'}`);

  if (!escribe) {
    console.log('');
    console.log(`ENSAYO READ-ONLY: no se escribió nada. ${PRODUCTOS_PROPUESTOS.length} SKU + ${PRODUCTOS_PROPUESTOS.length} códigos listos.`);
    console.log('Siguiente paso seguro: --ensayo-transaccional --confirmado-por-humano (con la variable de autorización).');
    console.log('Definitivo: --aplicar --verificado-por=<uuid> --confirmado-por-humano.');
    return;
  }

  if (ensayoTransaccional) {
    console.log('');
    console.log('ENSAYO TRANSACCIONAL: se ejecuta el lote real y se hace ROLLBACK…');
    await sql(loteEnsayo);
    const [despues] = await sql(`select
        (select count(*) from public.products where business_id = ${lit(BUSINESS_ID)})::int as productos,
        (select count(*) from public.orders)::int as pedidos,
        (select count(*) from public.product_barcodes where business_id = ${lit(BUSINESS_ID)})::int as codigos;`);
    const limpio = despues.productos === antes.productos && despues.codigos === antes.codigos && despues.pedidos === antes.pedidos;
    console.log(`DESPUÉS        ${despues.productos} productos · ${despues.codigos} códigos · ${despues.pedidos} pedidos`);
    if (!limpio) {
      console.error('ERROR el rollback no dejó los conteos como estaban. REVISAR A MANO YA.');
      process.exitCode = 1;
      return;
    }
    console.log('');
    console.log('OK · el lote entero ejecutó sin un solo error contra el esquema vivo de producción');
    console.log('     (las 12 filas de products y las 12 de product_barcodes entraron en la transacción)');
    console.log('     y el ROLLBACK no dejó nada: mismos conteos que antes, byte a byte.');
    return;
  }

  // ── LA ESCRITURA REAL ──────────────────────────────────────────────────────
  console.log('');
  console.log('APLICANDO el lote congelado…');
  await sql(loteTexto);

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

  const esperado = new Map(PRODUCTOS_PROPUESTOS.map((p) => [p.externalId, p]));
  const fallas = [];
  for (const fila of cargados) {
    const p = esperado.get(fila.external_id);
    if (!p) { fallas.push(`${fila.external_id}: fila que no está en el plan`); continue; }
    const igual = (campo, leido, esperadoValor) => {
      if (String(leido) !== String(esperadoValor)) fallas.push(`${fila.external_id}: ${campo} «${leido}» ≠ «${esperadoValor}»`);
    };
    igual('name', fila.name, p.name);
    igual('brand', fila.brand, p.brand);
    igual('category', fila.category, p.category);
    igual('subcategory', fila.subcategory, p.subcategory);
    igual('variant', fila.variant, p.variant);
    igual('presentation', fila.presentation, p.variant);
    igual('capacity_value', fila.capacity_value, p.capacityValue);
    igual('capacity', fila.capacity, `${p.capacityValue} ${p.capacityUnit}`);
    igual('packaging_type', fila.packaging_type, p.packagingType);
    igual('price', Number(fila.price), p.price);
    igual('gtin', fila.gtin, p.gtin);
    igual('barcode_type', fila.barcode_type, p.gtinType);
    igual('verified_by', fila.verified_by, verificadoPor);
    igual('created_by', fila.created_by, verificadoPor);
    if (fila.units_per_pack !== p.unitsPerPack) fallas.push(`${fila.external_id}: units_per_pack ${fila.units_per_pack} ≠ ${p.unitsPerPack}`);
    if (fila.sold_as_pack !== p.soldAsPack) fallas.push(`${fila.external_id}: sold_as_pack ${fila.sold_as_pack} ≠ ${p.soldAsPack}`);
    if (fila.stock !== 0) fallas.push(`${fila.external_id}: stock ${fila.stock} ≠ 0`);
    if (fila.available !== false) fallas.push(`${fila.external_id}: available ${fila.available} ≠ false`);
    if (fila.is_verified !== true) fallas.push(`${fila.external_id}: is_verified ${fila.is_verified} ≠ true`);
    if (fila.is_active !== true) fallas.push(`${fila.external_id}: is_active ${fila.is_active} ≠ true`);
    if (fila.is_alcoholic !== p.alcoholic) fallas.push(`${fila.external_id}: is_alcoholic ${fila.is_alcoholic} ≠ ${p.alcoholic}`);
    const edadEsperada = p.alcoholic ? p.minimumAge : null;
    if (fila.minimum_age !== edadEsperada) fallas.push(`${fila.external_id}: minimum_age ${fila.minimum_age} ≠ ${edadEsperada}`);
    if (fila.price_status !== 'confirmed') fallas.push(`${fila.external_id}: price_status ${fila.price_status}`);
    if (fila.catalog_origin !== 'commercial') fallas.push(`${fila.external_id}: catalog_origin ${fila.catalog_origin}`);
    if (fila.sort_order !== 0) fallas.push(`${fila.external_id}: sort_order ${fila.sort_order} ≠ 0`);
    if (fila.image_url || fila.catalog_asset_id) fallas.push(`${fila.external_id}: quedó con imagen y no se cargó ninguna (tiene que usar el fallback)`);
    if (fila.package_type !== 'unit') fallas.push(`${fila.external_id}: package_type ${fila.package_type} ≠ unit`);
    if (fila.unit_factor !== 1) fallas.push(`${fila.external_id}: unit_factor ${fila.unit_factor} ≠ 1`);
    if (fila.is_primary !== true) fallas.push(`${fila.external_id}: is_primary ${fila.is_primary} ≠ true`);
    if (fila.source !== 'manual') fallas.push(`${fila.external_id}: source ${fila.source} ≠ manual`);
  }
  for (const p of PRODUCTOS_PROPUESTOS) {
    if (!cargados.some((f) => f.external_id === p.externalId)) fallas.push(`${p.externalId}: no llegó a la base`);
  }

  const actualesDespues = await sql(`select external_id, price, stock, available, is_verified, sold_as_pack,
      units_per_pack, category, is_alcoholic
    from public.products where business_id = ${lit(BUSINESS_ID)} and external_id in (${externalIdsActuales.map(lit).join(',')})
    order by external_id;`);
  if (actualesAntes.length !== actualesDespues.length) {
    fallas.push(`el conteo de los 60 actuales cambió: ${actualesAntes.length} → ${actualesDespues.length}`);
  }
  for (let i = 0; i < actualesAntes.length; i += 1) {
    const a = JSON.stringify(actualesAntes[i]);
    const d = JSON.stringify(actualesDespues[i]);
    if (a !== d) fallas.push(`SKU actual ${actualesAntes[i].external_id} CAMBIÓ: ${a} → ${d}`);
  }

  const [despues] = await sql(`select
      (select count(*) from public.products where business_id = ${lit(BUSINESS_ID)})::int as productos,
      (select count(*) from public.orders)::int as pedidos,
      (select count(*) from public.product_barcodes where business_id = ${lit(BUSINESS_ID)})::int as codigos;`);
  console.log('');
  console.log(`DESPUÉS        ${despues.productos} productos · ${despues.codigos} códigos de barras · ${despues.pedidos} pedidos`);
  if (despues.productos !== 72) fallas.push(`el catálogo no quedó en 72: ${despues.productos}`);
  if (despues.codigos !== antes.codigos + PRODUCTOS_PROPUESTOS.length) fallas.push(`los códigos no subieron en ${PRODUCTOS_PROPUESTOS.length}: ${antes.codigos} → ${despues.codigos}`);
  if (despues.pedidos !== antes.pedidos) fallas.push(`la cantidad de pedidos cambió: ${antes.pedidos} → ${despues.pedidos}`);

  if (lt0001Antes) {
    const [lt0001Despues] = await sql("select public_code, status, total from public.orders where public_code = 'LT-0001';");
    if (!lt0001Despues || Number(lt0001Despues.total) !== Number(lt0001Antes.total) || lt0001Despues.status !== lt0001Antes.status) {
      fallas.push(`LT-0001 cambió o desapareció: antes ${JSON.stringify(lt0001Antes)} → después ${JSON.stringify(lt0001Despues)}`);
    }
  }

  if (fallas.length) {
    for (const f of fallas) console.error(`ERROR ${f}`);
    console.error(`\n${fallas.length} discrepancia(s) entre el plan y lo que quedó escrito.`);
    process.exitCode = 1;
    return;
  }
  console.log('');
  console.log('OK · PRODUCCIÓN 60 → 72: las 12 altas y sus 12 códigos coinciden fila por fila con el plan,');
  console.log('     los 60 SKU previos no cambiaron un solo campo, LT-0001 intacto, pedidos idénticos.');
  console.log('     Los 12 nuevos quedaron stock=0 y available=false: se publican desde el Panel, no desde acá.');
});
