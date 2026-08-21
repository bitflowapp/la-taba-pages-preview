/*
 * Certificación READ-ONLY de que el lote de 12 altas es ejecutable tal cual
 * contra el esquema REAL de producción, sin ejecutarlo.
 *
 * Qué demuestra (todo por information_schema / catálogos, sólo SELECT):
 *   1. cada columna que el lote escribe existe en products / product_barcodes;
 *   2. ninguna columna NOT NULL sin default queda fuera del lote;
 *   3. las claves únicas que sostienen el «aborta por colisión» existen de
 *      verdad (external_id y gtin por negocio);
 *   4. el uuid de verified_by/created_by existe y es quien decimos que es
 *      (si esas columnas tienen FK, a qué apuntan);
 *   5. contraste: staging NO tiene las columnas nuevas (p. ej. sold_as_pack),
 *      así que el lote no es ejecutable ahí sin migrar primero.
 *
 * La evidencia queda en
 * artifacts/taba2-gondola-retail-final/certificacion-esquema-lote.json
 */
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { conToken } from './lib/supabase-cli-token.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const REF_PROD = 'wwcpogltfgzgkrlilbcd';
const REF_STAGING = 'ukxqbgswjlibmnjemrzd';
const VERIFICADOR = '61f238ad-fc2b-446a-9f17-257f4622cd86';

// Columnas EXACTAS que escribe gondola-retail-final-altas.sql (del artefacto
// con SHA 56a7127e...47d1a6, verificado hoy contra el archivo).
const COLS_PRODUCTS = ['business_id', 'external_id', 'sku', 'brand', 'name',
  'description', 'category', 'subcategory', 'variant', 'presentation',
  'capacity_value', 'capacity_unit', 'capacity', 'packaging_type', 'units_per_pack', 'sold_as_pack',
  'price', 'price_status', 'stock', 'chilled', 'is_alcoholic', 'minimum_age',
  'sort_order', 'tags', 'catalog_origin', 'is_active',
  'is_verified', 'verified_at', 'verified_by', 'available', 'updated_at'];
const COLS_BARCODES = ['business_id', 'product_id', 'gtin', 'barcode_type', 'package_type', 'unit_factor',
  'is_primary', 'is_active', 'source', 'verified_at', 'created_by'];

let rojo = 0;
const medir = (nombre, ok, detalle = '') => {
  console.log(`  ${ok ? 'OK  ' : 'MAL '} ${nombre}${detalle ? ` · ${detalle}` : ''}`);
  if (!ok) rojo += 1;
};
const evidencia = { generado_utc: new Date().toISOString(), checks: [] };

await conToken(async (token) => {
  const consultar = (ref) => async (query) => {
    const r = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', 'User-Agent': 'taba2-gondola-cert-esquema/1.0' },
      body: JSON.stringify({ query }),
    });
    const t = await r.text();
    if (!r.ok) throw new Error(`[${ref}] HTTP ${r.status} · ${t.slice(0, 800)}`);
    return t ? JSON.parse(t) : null;
  };
  const prod = consultar(REF_PROD);
  const stg = consultar(REF_STAGING);

  console.log('\n── 1 · columnas del lote existen en producción ──');
  for (const [tabla, cols] of [['products', COLS_PRODUCTS], ['product_barcodes', COLS_BARCODES]]) {
    const reales = (await prod(`select column_name, data_type, is_nullable, column_default
        from information_schema.columns where table_schema='public' and table_name='${tabla}';`));
    const nombres = new Set(reales.map((r) => r.column_name));
    const faltantes = cols.filter((c) => !nombres.has(c));
    medir(`${tabla}: las ${cols.length} columnas del lote existen`, faltantes.length === 0, faltantes.join(', ') || 'todas');
    evidencia.checks.push({ check: `columnas_${tabla}`, faltantes, columnas_reales: reales });

    console.log(`\n── 2 · ${tabla}: NOT NULL sin default fuera del lote ──`);
    const enLote = new Set(cols);
    const sinCubrir = reales.filter((r) => r.is_nullable === 'NO' && r.column_default === null && !enLote.has(r.column_name));
    medir(`${tabla}: ninguna NOT NULL sin default queda fuera`, sinCubrir.length === 0,
      sinCubrir.map((r) => r.column_name).join(', ') || 'ninguna');
    evidencia.checks.push({ check: `notnull_${tabla}`, sin_cubrir: sinCubrir });
  }

  console.log('\n── 3 · claves únicas que sostienen el aborta-por-colisión ──');
  const unicas = await prod(`select t.relname as tabla, c.conname, pg_get_constraintdef(c.oid) as def
      from pg_constraint c join pg_class t on t.oid = c.conrelid
      join pg_namespace n on n.oid = t.relnamespace
      where n.nspname='public' and t.relname in ('products','product_barcodes') and c.contype in ('u','p')
      order by t.relname, c.conname;`);
  const indices = await prod(`select tablename, indexname, indexdef from pg_indexes
      where schemaname='public' and tablename in ('products','product_barcodes') and indexdef ilike '%unique%';`);
  const unicoSku = [...unicas.map((u) => u.def), ...indices.map((i) => i.indexdef)]
    .some((d) => /external_id/.test(d) && /business_id/.test(d));
  const unicoGtin = [...unicas.map((u) => u.def), ...indices.map((i) => i.indexdef)]
    .some((d) => /gtin/.test(d) && /business_id/.test(d));
  medir('unicidad (business_id, external_id) en products', unicoSku);
  medir('unicidad (business_id, gtin) en product_barcodes', unicoGtin);
  evidencia.checks.push({ check: 'unicidad', constraints: unicas, indices_unicos: indices });

  console.log('\n── 4 · verified_by / created_by ──');
  const fks = await prod(`select t.relname as tabla, c.conname, pg_get_constraintdef(c.oid) as def
      from pg_constraint c join pg_class t on t.oid = c.conrelid
      join pg_namespace n on n.oid = t.relnamespace
      where n.nspname='public' and t.relname in ('products','product_barcodes') and c.contype='f'
        and (pg_get_constraintdef(c.oid) ilike '%verified_by%' or pg_get_constraintdef(c.oid) ilike '%created_by%');`);
  console.log(`  FKs sobre verified_by/created_by: ${fks.length ? fks.map((f) => `${f.tabla}.${f.conname}`).join(', ') : 'ninguna (uuid suelto)'}`);
  const [verif] = await prod(`select
      (select count(*)::int from auth.users where id = '${VERIFICADOR}') as en_auth,
      (select count(*)::int from public.products where verified_by = '${VERIFICADOR}') as productos_ya_verificados;`);
  medir('el uuid verificador existe en auth.users de producción', verif.en_auth === 1, `auth=${verif.en_auth}`);
  medir('el mismo uuid ya verificó productos existentes', verif.productos_ya_verificados > 0, `${verif.productos_ya_verificados} filas`);
  evidencia.checks.push({ check: 'verificador', fks, ...verif });

  console.log('\n── 5 · contraste con staging: columnas nuevas ausentes ──');
  const stgCols = (await stg(`select column_name from information_schema.columns
      where table_schema='public' and table_name='products';`)).map((r) => r.column_name);
  const faltanEnStaging = COLS_PRODUCTS.filter((c) => !stgCols.includes(c));
  medir('staging NO puede ejecutar el lote tal cual (columnas ausentes)', faltanEnStaging.length > 0,
    faltanEnStaging.join(', ') || 'staging tiene todas (revisar)');
  evidencia.checks.push({ check: 'staging_columnas_faltantes', faltantes: faltanEnStaging });
});

const destino = path.join(ROOT, 'artifacts', 'taba2-gondola-retail-final', 'certificacion-esquema-lote.json');
writeFileSync(destino, `${JSON.stringify(evidencia, null, 2)}\n`);
console.log(`\nEvidencia: ${destino}`);
console.log(rojo === 0 ? '\nCERTIFICACIÓN DE ESQUEMA: PASS (read-only)' : `\nCERTIFICACIÓN DE ESQUEMA: ${rojo} fallas`);
process.exit(rojo === 0 ? 0 : 1);
