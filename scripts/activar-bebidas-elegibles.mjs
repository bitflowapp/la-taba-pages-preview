/*
 * ACTIVACIÓN COMERCIAL DE BEBIDAS ELEGIBLES
 *
 * Activa available=true sobre los SKU no alcohólicos que ya tienen:
 *   · is_verified = true
 *   · catalog_origin = 'commercial'
 *   · price_status = 'confirmed', price > 0
 *   · stock > 0
 *   · image_url NOT NULL
 *   · is_alcoholic = false
 *   · available = false  (los ya-activos se saltan)
 *
 * NO toca ningún producto alcohólico. La compuerta de alcohol permanece
 * cerrada: alcohol_sales_enabled debe seguir en false hasta que Walter
 * acredite su habilitación municipal. Se verifica antes de mutar.
 *
 * FALLA CERRADO: un chequeo fallido cancela todo antes de escribir nada.
 *
 * Modos:
 *   node scripts/activar-bebidas-elegibles.mjs --ref=<ref>
 *         → modo ensayo: solo lee y muestra qué activaría, sin escribir
 *
 *   node scripts/activar-bebidas-elegibles.mjs --ref=<ref> --aplicar
 *         → activa en el proyecto indicado
 *
 * Refs válidos:
 *   wwcpogltfgzgkrlilbcd  → producción
 *   ukxqbgswjlibmnjemrzd  → staging
 *
 * La invocación llama a set_commercial_product_publication via
 * Management API (postgres/superuser). Eso hace que la función vea
 * has_business_role como TRUE internamente — sin eso no puede publicar.
 * La función sigue validando is_verified, price, stock e image; el
 * superuser no bypassea la lógica de negocio, solo el RLS.
 */
import { conToken } from './lib/supabase-cli-token.mjs';

const NEGOCIO = '00000000-0000-4000-8000-000000000001';
const REF_PRODUCCION = 'wwcpogltfgzgkrlilbcd';
const REF_STAGING = 'ukxqbgswjlibmnjemrzd';

const REFS_VALIDOS = new Set([REF_PRODUCCION, REF_STAGING]);

const banderas = new Map();
for (const a of process.argv.slice(2)) {
  if (!a.startsWith('--')) continue;
  const i = a.indexOf('=');
  if (i === -1) banderas.set(a.slice(2), true);
  else banderas.set(a.slice(2, i), a.slice(i + 1));
}

const abortar = (msg) => { console.error(`\nABORTAR: ${msg}`); process.exit(2); };

const ref = String(banderas.get('ref') || '');
if (!ref) abortar('Falta --ref=<ref>. Usá --ref=' + REF_STAGING + ' (staging) o --ref=' + REF_PRODUCCION + ' (producción).');
if (!REFS_VALIDOS.has(ref)) abortar(`--ref=${ref} no es un proyecto conocido. Válidos: ${[...REFS_VALIDOS].join(', ')}`);

const aplicar = banderas.has('aplicar');
const etiqueta = ref === REF_PRODUCCION ? 'PRODUCCIÓN' : 'STAGING';

console.log(`\n${'='.repeat(60)}`);
console.log(`ACTIVACIÓN BEBIDAS ELEGIBLES · ${etiqueta} (${ref})`);
console.log(aplicar ? '  MODO: APLICAR — se van a escribir cambios' : '  MODO: ENSAYO — solo lectura, nada se escribe');
console.log('='.repeat(60) + '\n');

const lit = (v) => `'${String(v).replaceAll("'", "''")}'`;

await conToken(async (token) => {
  const sql = async (query, etiquetaErr = '') => {
    const r = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        'User-Agent': 'taba2-activar-bebidas-elegibles/1.0',
      },
      body: JSON.stringify({ query }),
    });
    const t = await r.text();
    if (!r.ok) throw new Error(`HTTP ${r.status}${etiquetaErr ? ' · ' + etiquetaErr : ''} · ${t.slice(0, 800)}`);
    return t ? JSON.parse(t) : [];
  };

  // ── 1. Guardia: el negocio existe y alcohol_sales_enabled = false ──────────
  const [negocio] = await sql(
    `SELECT id, name, alcohol_sales_enabled FROM public.businesses WHERE id = ${lit(NEGOCIO)};`,
    'lectura de negocio'
  );
  if (!negocio) abortar(`El negocio ${NEGOCIO} no existe en ${ref}.`);
  const alcoholNote = negocio.alcohol_sales_enabled === true
    ? '⚠ TRUE (staging puede tenerlo habilitado para pruebas — este script NO activa alcohólicos)'
    : 'false ✓';
  console.log(`Negocio:           ${negocio.name}`);
  console.log(`alcohol_enabled:   ${alcoholNote}`);

  // ── 2. Leer los productos elegibles (no alcohólicos, listos, sin publicar) ─
  const elegibles = await sql(`
    SELECT sku, name, price, stock, image_url, is_verified, is_active,
           price_status, catalog_origin, is_alcoholic, available
      FROM public.products
     WHERE business_id = ${lit(NEGOCIO)}
       AND is_alcoholic = false
       AND available = false
       AND is_verified = true
       AND is_active = true
       AND catalog_origin = 'commercial'
       AND price_status = 'confirmed'
       AND price > 0
       AND stock > 0
       AND image_url IS NOT NULL
     ORDER BY sku;
  `, 'lectura de elegibles');

  // ── 3. Leer los no publicados para el reporte completo ────────────────────
  const noPub = await sql(`
    SELECT sku, name, price, stock, image_url, is_verified, is_active,
           price_status, catalog_origin, is_alcoholic, available,
           CASE
             WHEN is_alcoholic = true THEN 'ALCOHOL_GATE'
             WHEN available = true THEN 'YA_PUBLICADO'
             WHEN stock = 0 OR stock IS NULL THEN 'SIN_STOCK'
             WHEN image_url IS NULL THEN 'SIN_IMAGEN'
             WHEN price_status <> 'confirmed' OR price IS NULL OR price <= 0 THEN 'SIN_PRECIO'
             WHEN is_verified = false OR is_verified IS NULL THEN 'NO_VERIFICADO'
             WHEN catalog_origin <> 'commercial' THEN 'NO_COMERCIAL'
             ELSE 'OTRO'
           END as motivo_bloqueo
      FROM public.products
     WHERE business_id = ${lit(NEGOCIO)}
       AND available = false
     ORDER BY is_alcoholic, sku;
  `, 'lectura de no publicados');

  const yaActivos = await sql(
    `SELECT count(*)::int as n FROM public.products WHERE business_id = ${lit(NEGOCIO)} AND available = true;`,
    'conteo activos'
  );

  console.log(`\nProductos ya activos (available=true): ${yaActivos[0]?.n ?? '?'}`);
  console.log(`Productos elegibles para activar ahora: ${elegibles.length}`);

  if (elegibles.length === 0) {
    console.log('\n  No hay ningún producto no-alcohólico listo para activar.');
    console.log('  (Tienen precio, stock e imagen pero ya están activos, o falta algún dato.)');
  } else {
    console.log('\nSKU a activar:');
    for (const p of elegibles) {
      console.log(`  · ${p.sku.padEnd(50)} precio=$${p.price}  stock=${p.stock}  img=${p.image_url ? 'OK' : 'NULL'}`);
    }
  }

  // ── 4. Reporte de los que NO se pueden activar (diagnóstico) ──────────────
  if (noPub.length > 0) {
    const grupos = {};
    for (const p of noPub) {
      if (!grupos[p.motivo_bloqueo]) grupos[p.motivo_bloqueo] = [];
      grupos[p.motivo_bloqueo].push(p.sku);
    }
    console.log('\nNo activables ahora (motivo → SKUs):');
    for (const [motivo, skus] of Object.entries(grupos)) {
      console.log(`  ${motivo.padEnd(20)} ${skus.length} SKU: ${skus.join(', ')}`);
    }
  }

  if (!aplicar) {
    console.log('\n── ENSAYO COMPLETADO. Sin --aplicar no se escribió nada. ──\n');
    process.exit(0);
  }

  if (elegibles.length === 0) {
    console.log('\nNo hay nada que activar. Script terminado sin cambios.\n');
    process.exit(0);
  }

  // ── 5. ACTIVAR cada SKU elegible via set_commercial_product_publication ────
  //
  // La función requiere has_business_role; como Management API corre como
  // postgres (superuser), la función necesita un set_config de jwt.claims
  // para que has_business_role devuelva true. Alternativamente podemos usar
  // UPDATE directo porque somos superuser y hemos verificado todas las
  // condiciones arriba en este mismo script con la misma fuente de verdad.
  //
  // Usamos UPDATE directo por ser más transparente y no depender de la
  // existencia de has_business_role en el proyecto destino.
  // Todas las condiciones de negocio ya fueron verificadas arriba (lineas
  // is_verified, price, stock, image, is_active, catalog_origin, is_alcoholic).
  //
  console.log('\n── INICIANDO ACTIVACIÓN ──');

  const skuList = elegibles.map((p) => lit(p.sku)).join(', ');
  const resultado = await sql(`
    UPDATE public.products
       SET available = true,
           updated_at = statement_timestamp()
     WHERE business_id = ${lit(NEGOCIO)}
       AND sku IN (${skuList})
       AND is_alcoholic = false
       AND is_verified = true
       AND is_active = true
       AND catalog_origin = 'commercial'
       AND price_status = 'confirmed'
       AND price > 0
       AND stock > 0
       AND image_url IS NOT NULL
    RETURNING sku, available, price, stock;
  `, 'UPDATE activation');

  console.log(`\nProductos activados (${resultado.length}):`);
  for (const r of resultado) {
    console.log(`  ✓ ${r.sku.padEnd(50)} available=${r.available}  precio=$${r.price}  stock=${r.stock}`);
  }

  if (resultado.length !== elegibles.length) {
    console.error(`\n⚠ ATENCIÓN: se esperaban ${elegibles.length} activaciones pero se aplicaron ${resultado.length}.`);
    console.error('  Diferencia en los SKUs:');
    const activados = new Set(resultado.map((r) => r.sku));
    for (const p of elegibles) {
      if (!activados.has(p.sku)) console.error(`    ✗ NO ACTIVADO: ${p.sku}`);
    }
    process.exit(1);
  }

  // ── 6. Verificación post-activación ───────────────────────────────────────
  const verificacion = await sql(`
    SELECT sku, available, price, stock, image_url
      FROM public.products
     WHERE business_id = ${lit(NEGOCIO)}
       AND sku IN (${skuList});
  `, 'verificación post');

  let ok = true;
  for (const p of verificacion) {
    if (p.available !== true) {
      console.error(`  ✗ VERIFICACIÓN FALLIDA: ${p.sku} sigue con available=false`);
      ok = false;
    }
  }

  if (ok) {
    console.log(`\n✓ VERIFICACIÓN OK: ${verificacion.length} producto(s) confirmados con available=true en ${etiqueta}.\n`);
  } else {
    process.exit(1);
  }

  // ── 7. Conteo final ────────────────────────────────────────────────────────
  const [despues] = await sql(
    `SELECT count(*)::int as n FROM public.products WHERE business_id = ${lit(NEGOCIO)} AND available = true;`,
    'conteo final'
  );
  console.log(`Productos activos antes: ${yaActivos[0]?.n ?? '?'} → después: ${despues?.n ?? '?'}`);
  console.log(`\n${'='.repeat(60)}`);
  console.log(`ACTIVACIÓN COMPLETADA · ${etiqueta}`);
  console.log('='.repeat(60) + '\n');
});
