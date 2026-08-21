/*
 * Mide STAGING y, con autorización explícita, aplica las 12 altas de la
 * góndola comercial final (ver catalog/gondola-retail-final-proposal.mjs y
 * scripts/gondola-retail-final-plan.mjs).
 *
 * SÓLO STAGING. Nunca produccion — el ref está hardcodeado y comparado byte a
 * byte, sin default implícito: escribir en el proyecto equivocado no se
 * deshace. Aplicar a producción es un script APARTE, con su propia
 * autorización, que todavía no existe: se escribe cuando el dueño abra ese
 * gate, no antes.
 *
 * Mismo canal que aplicar-retail-unidades.mjs / aplicar-gondola-neuquen.mjs:
 * Management API de Supabase con el token del CLI
 * (scripts/lib/supabase-cli-token.mjs), NUNCA un cliente con service_role.
 *
 * INSERT liso, nunca upsert: si cualquiera de los 12 SKU o los 12 GTIN ya
 * existe en staging, la transacción entera aborta —nunca pisa una fila
 * existente— y el guard lo repite ACÁ, en JS, antes de gastar la llamada de
 * red, además de adentro de la propia transacción SQL.
 *
 * GUARDAS, todas antes de mutar:
 *   1. el ref del proyecto es explícito y tiene que ser EXACTAMENTE staging;
 *   2. el negocio canónico tiene que existir en ese proyecto;
 *   3. alcohol_sales_enabled tiene que seguir en false (se relee en vivo, no
 *      se asume desde el gate anterior);
 *   4. ninguno de los 12 SKU ni de los 12 GTIN puede existir ya (releído en
 *      vivo, no asumido desde la auditoría local);
 *   5. ensayo por omisión: sin --aplicar no escribe nada, sólo mide;
 *   6. --aplicar exige además la variable de autorización, DISTINTA de la de
 *      retail-unidades y de gondola-neuquen a propósito — que quede una
 *      autorización vieja en el entorno no puede habilitar esta escritura;
 *   7. --aplicar exige --verificado-por=<uuid> y --confirmado-por-humano;
 *   8. una sola transacción: o entran los 12 productos + sus 12 códigos de
 *      barras, o no entra nada;
 *   9. después de escribir: releer y comparar CONTRA EL PLAN fila por fila, Y
 *      releer los 60 SKU actuales completos y compararlos byte a byte contra
 *      el ANTES, Y releer LT-0001 si existe en este proyecto, Y el conteo
 *      total de productos/códigos/pedidos — para demostrar que además de lo
 *      nuevo, nada viejo se movió.
 *
 *   node scripts/aplicar-gondola-retail-final-staging.mjs --ref=<ref>
 *   node scripts/aplicar-gondola-retail-final-staging.mjs --ref=<ref> --aplicar \
 *        --verificado-por=<uuid> --confirmado-por-humano
 *
 * (los flags van con `=`: `--ref <ref>` separado por espacio NO se reconoce —
 * queda como bandera booleana suelta y el chequeo de --ref aborta).
 *
 * ESTADO: preparado 2026-08-21. NO ejecutado. El dueño todavía no dio el
 * siguiente gate humano para correrlo, ni siquiera en modo ensayo.
 */
import { BUSINESS_ID, PRODUCTOS_PROPUESTOS } from '../catalog/gondola-retail-final-proposal.mjs';
import { construirLoteAltas, revisarAltas } from './gondola-retail-final-plan.mjs';
import { loadCatalogSkus } from './catalog-images/catalog-skus.mjs';
import { conToken } from './lib/supabase-cli-token.mjs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const REF_STAGING = 'ukxqbgswjlibmnjemrzd';
const AUTORIZACION = 'I_AUTHORIZE_TABA2_GONDOLA_RETAIL_FINAL_STAGING_INSERT';

const banderas = new Map();
for (const a of process.argv.slice(2)) {
  if (!a.startsWith('--')) continue;
  const i = a.indexOf('=');
  if (i === -1) banderas.set(a.slice(2), true);
  else banderas.set(a.slice(2, i), a.slice(i + 1));
}
const abortar = (m) => { console.error(`ABORTAR: ${m}`); process.exit(2); };

const ref = String(banderas.get('ref') || '');
if (ref !== REF_STAGING) {
  abortar(`--ref debe ser ${REF_STAGING} (staging). No hay default implícito: escribir en el proyecto equivocado no se deshace.`);
}
const aplicar = banderas.has('aplicar');
const verificadoPor = banderas.get('verificado-por') ? String(banderas.get('verificado-por')) : '';

if (aplicar && process.env.TABA2_GONDOLA_RETAIL_FINAL_STAGING_APPLY !== AUTORIZACION) {
  abortar(`--aplicar exige TABA2_GONDOLA_RETAIL_FINAL_STAGING_APPLY="${AUTORIZACION}" en el entorno.`);
}
if (aplicar && !banderas.has('confirmado-por-humano')) {
  abortar('--aplicar exige --confirmado-por-humano además de --verificado-por.');
}
if (aplicar && !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(verificadoPor)) {
  abortar('--aplicar exige --verificado-por=<uuid> de la persona que autoriza los datos maestros.');
}

const problemasLocal = revisarAltas(PRODUCTOS_PROPUESTOS);
if (problemasLocal.length) {
  for (const p of problemasLocal) console.error(`ERROR ${p}`);
  abortar(`${problemasLocal.length} fila(s) no cumplen el contrato local. No se tocó la red.`);
}

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
        'User-Agent': 'taba2-gondola-retail-final-staging/1.0',
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
  // Un bloqueo en modo ensayo NO corta la lectura: el diagnóstico tiene que
  // salir completo igual, y el ensayo termina BLOQUEADO al final. En modo
  // --aplicar el mismo bloqueo aborta acá, antes de cualquier escritura.
  const bloqueos = [];
  if (negocio.alcohol_sales_enabled === true) {
    const motivo = 'alcohol_sales_enabled está en true en staging: este lote asume que sigue en false. Revisar antes de aplicar.';
    if (aplicar) abortar(motivo);
    bloqueos.push(motivo);
    console.error(`BLOQUEO: ${motivo}`);
  }

  const [antes] = await sql(`select
      (select count(*) from public.products where business_id = ${lit(BUSINESS_ID)})::int as productos,
      (select count(*) from public.orders)::int as pedidos,
      (select count(*) from public.product_barcodes where business_id = ${lit(BUSINESS_ID)})::int as codigos;`);

  console.log(`ref            ${ref} (staging)`);
  console.log(`negocio        ${negocio.name} · ${negocio.status} · activo=${negocio.is_active} · alcohol=${negocio.alcohol_sales_enabled} · ${negocio.currency_code}`);
  console.log(`ANTES          ${antes.productos} productos · ${antes.codigos} códigos de barras · ${antes.pedidos} pedidos`);

  // Snapshot completo de los 60 SKU actuales: tiene que volver IDÉNTICO después.
  // El snapshot exige columnas que las migraciones recientes agregaron
  // (p. ej. sold_as_pack, 20260818030000). Si el proyecto destino no las tiene,
  // el lote entero es inaplicable ahí: en --aplicar se aborta; en ensayo se
  // registra el bloqueo y se sigue leyendo con las columnas que existan.
  const COLS_SNAPSHOT = ['external_id', 'price', 'stock', 'available', 'is_verified', 'sold_as_pack',
    'units_per_pack', 'category', 'is_alcoholic'];
  const columnasProducts = (await sql(`select column_name from information_schema.columns
      where table_schema='public' and table_name='products';`)).map((r) => r.column_name);
  const colsFaltantes = COLS_SNAPSHOT.filter((c) => !columnasProducts.includes(c));
  if (colsFaltantes.length) {
    const motivo = `products en ${ref} no tiene columnas que el lote escribe/verifica: ${colsFaltantes.join(', ')}. El lote NO es ejecutable en este proyecto sin migrar primero.`;
    if (aplicar) abortar(motivo);
    bloqueos.push(motivo);
    console.error(`BLOQUEO: ${motivo}`);
  }
  const colsSnapshot = COLS_SNAPSHOT.filter((c) => columnasProducts.includes(c));
  const actualesAntes = await sql(`select ${colsSnapshot.join(', ')}
    from public.products where business_id = ${lit(BUSINESS_ID)} and external_id in (${externalIdsActuales.map(lit).join(',')})
    order by external_id;`);
  console.log(`60 actuales    ${actualesAntes.length} de ${externalIdsActuales.length} encontrados en staging (se comparan byte a byte después)`);

  const colisionSku = await sql(`select external_id from public.products
      where business_id = ${lit(BUSINESS_ID)} and external_id in (${externalIds.map(lit).join(',')});`);
  const colisionGtin = await sql(`select gtin from public.product_barcodes
      where business_id = ${lit(BUSINESS_ID)} and gtin in (${gtins.map(lit).join(',')});`);
  console.log('');
  console.log(`colisión de SKU (12 altas): ${colisionSku.length === 0 ? 'ninguna (OK)' : colisionSku.map((r) => r.external_id).join(', ')}`);
  console.log(`colisión de GTIN (12 altas): ${colisionGtin.length === 0 ? 'ninguna (OK)' : colisionGtin.map((r) => r.gtin).join(', ')}`);
  if (colisionSku.length || colisionGtin.length) {
    const motivo = 'hay colisión contra staging vivo. No se escribe nada.';
    if (aplicar) abortar(motivo);
    bloqueos.push(motivo);
    console.error(`BLOQUEO: ${motivo}`);
  }

  const [lt0001Antes] = await sql("select public_code, total from public.orders where public_code = 'LT-0001';");
  console.log(`LT-0001        ${lt0001Antes ? `existe en staging · total ${lt0001Antes.total}` : 'no existe en este proyecto (no aplica)'}`);

  if (!aplicar) {
    console.log('');
    if (bloqueos.length) {
      console.error(`ENSAYO BLOQUEADO: ${bloqueos.length} bloqueo(s) impiden aplicar este lote tal cual está. No se escribió nada.`);
      for (const b of bloqueos) console.error(`  · ${b}`);
      process.exit(2);
    }
    console.log(`ENSAYO: no se escribió nada. ${PRODUCTOS_PROPUESTOS.length} SKU + ${PRODUCTOS_PROPUESTOS.length} códigos de barras listos para aplicar.`);
    console.log('Para aplicar: --aplicar --verificado-por=<uuid> --confirmado-por-humano, con TABA2_GONDOLA_RETAIL_FINAL_STAGING_APPLY en el entorno.');
    return;
  }

  await sql(construirLoteAltas(PRODUCTOS_PROPUESTOS, { verificadoPor }));

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

  // ── Los 60 actuales, byte a byte contra el ANTES ───────────────────────────
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
  if (despues.productos !== antes.productos + PRODUCTOS_PROPUESTOS.length) fallas.push(`el conteo de productos no subió en ${PRODUCTOS_PROPUESTOS.length}: ${antes.productos} → ${despues.productos}`);
  if (despues.codigos !== antes.codigos + PRODUCTOS_PROPUESTOS.length) fallas.push(`el conteo de códigos de barras no subió en ${PRODUCTOS_PROPUESTOS.length}: ${antes.codigos} → ${despues.codigos}`);
  if (despues.pedidos !== antes.pedidos) fallas.push(`la cantidad de pedidos cambió: ${antes.pedidos} → ${despues.pedidos}`);

  if (lt0001Antes) {
    const [lt0001Despues] = await sql("select public_code, total from public.orders where public_code = 'LT-0001';");
    if (!lt0001Despues || Number(lt0001Despues.total) !== Number(lt0001Antes.total)) {
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
  console.log('OK · las 12 altas y sus 12 códigos de barras quedaron cargados, coinciden fila por fila con el plan,');
  console.log('     los 60 SKU actuales no cambiaron un solo campo, LT-0001 (si existe) no cambió, y el conteo de pedidos es idéntico.');
});
