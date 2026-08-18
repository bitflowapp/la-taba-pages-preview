/*
 * Mide producción y, con autorización explícita, aplica la góndola de Neuquén.
 *
 * El lote SQL lo arma `gondola-neuquen-plan.mjs`, que es una hoja pura. Acá está
 * lo que toca la red: leer el estado antes, aplicar, y RELEER desde la base para
 * comparar contra el plan fila por fila. La respuesta de la escritura no cuenta
 * como prueba de nada.
 *
 * Habla por la Management API, que es el canal por el que se operó todo lo demás
 * en producción. El token sale de `lib/supabase-cli-token.mjs`, que lo presta
 * por el entorno y lo borra al terminar: no se imprime, no se pasa por línea de
 * comandos, no se escribe a disco.
 *
 * GUARDAS, todas antes de mutar:
 *   1. el ref del proyecto es explícito y tiene que ser el productivo;
 *   2. el negocio canónico tiene que existir;
 *   3. la migración de taxonomía tiene que estar aplicada;
 *   4. ensayo por omisión: sin `--aplicar` no escribe nada;
 *   5. `--aplicar` exige además la variable de autorización;
 *   6. publicar exige `--verificado-por=<uuid>`: la verificación de datos
 *      maestros la firma una persona, no una herramienta;
 *   7. una sola transacción: o entran los 52 o no entra ninguno.
 *
 *   node scripts/aplicar-gondola-neuquen.mjs --ref <ref> --verificar
 *   node scripts/aplicar-gondola-neuquen.mjs --ref <ref> --aplicar \
 *        --verificado-por=<uuid> --confirmado-por-humano
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { GONDOLA } from '../catalog/gondola-neuquen.mjs';
import { construirLote, revisarContratoDeVitrina, revisarCoherenciaDePrecios, BUSINESS_ID, LEDGER_TAXONOMIA } from './gondola-neuquen-plan.mjs';
import { conToken } from './lib/supabase-cli-token.mjs';

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MIGRACION = path.join(RAIZ, 'supabase/migrations/20260818040000_gondola_beverage_taxonomy.sql');
const ENSAYO = path.join(RAIZ, 'artifacts/taba2-gondola-neuquen/ensayo-migracion.sql');

const REF_PRODUCCION = 'wwcpogltfgzgkrlilbcd';
const AUTORIZACION = 'I_AUTHORIZE_TABA2_GONDOLA_LOAD';

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
const publicar = !banderas.has('sin-publicar');
const alcoholComprable = banderas.has('alcohol-comprable');
const verificadoPor = banderas.get('verificado-por') ? String(banderas.get('verificado-por')) : '';

if (aplicar && process.env.TABA2_GONDOLA_APPLY !== AUTORIZACION) {
  abortar(`--aplicar exige TABA2_GONDOLA_APPLY="${AUTORIZACION}" en el entorno.`);
}
if (aplicar && publicar && !banderas.has('confirmado-por-humano')) {
  abortar('publicar exige --confirmado-por-humano además de --verificado-por.');
}
// Falla cerrada: hacer comprable el alcohol es una afirmación sobre un permiso
// municipal, no una opción de despliegue.
if (alcoholComprable && !banderas.has('habilitacion-comercial-acreditada')) {
  abortar('--alcohol-comprable exige --habilitacion-comercial-acreditada.\n'
    + '  Esa bandera AFIRMA que la habilitación comercial del local incluye\n'
    + '  expendio de bebidas alcohólicas, y que alguien la vio. Sin eso, los\n'
    + '  productos con alcohol se cargan catalogados y NO comprables.');
}

const problemas = [...revisarContratoDeVitrina(GONDOLA), ...revisarCoherenciaDePrecios(GONDOLA)];
if (problemas.length) {
  for (const p of problemas) console.error(`ERROR ${p}`);
  abortar(`${problemas.length} fila(s) no cumplen el contrato. No se tocó la red.`);
}

const lit = (v) => (v === null || v === undefined ? 'null' : `'${String(v).replaceAll("'", "''")}'`);

await conToken(async (token) => {
  const sql = async (query) => {
    const r = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        'User-Agent': 'taba2-gondola-neuquen/1.0',
      },
      body: JSON.stringify({ query }),
    });
    const t = await r.text();
    if (!r.ok) throw new Error(`HTTP ${r.status} · ${t.slice(0, 1200)}`);
    return t ? JSON.parse(t) : null;
  };

  // ── Ensayo de la migración: aplica el DDL, prueba los casos y aborta ──────
  // La excepción del propio ensayo garantiza el rollback. No escribe nada.
  if (banderas.has('ensayar-migracion')) {
    try {
      await sql(fs.readFileSync(ENSAYO, 'utf8'));
      console.error('ERROR el ensayo terminó SIN excepción; tenía que abortar por diseño.');
      process.exitCode = 1;
    } catch (error) {
      console.log(String(error.message).replace(/\\n/g, '\n'));
    }
    return;
  }

  // ── Aplicar la migración por el mismo canal, con su fila en el ledger ─────
  if (banderas.has('aplicar-migracion')) {
    if (process.env.TABA2_GONDOLA_APPLY !== AUTORIZACION) {
      abortar(`--aplicar-migracion exige TABA2_GONDOLA_APPLY="${AUTORIZACION}" en el entorno.`);
    }
    const [ledger] = await sql('select max(version) as version from supabase_migrations.schema_migrations;');
    if (String(ledger.version) >= LEDGER_TAXONOMIA) {
      console.log(`la migración ya está aplicada — ledger ${ledger.version}. Nada que hacer.`);
      return;
    }
    const ddl = fs.readFileSync(MIGRACION, 'utf8');
    // La fila del ledger va en la MISMA transacción que el DDL: un esquema
    // migrado sin su registro hace que el próximo `db push` intente repetirlo.
    await sql(`begin;\n${ddl}\ninsert into supabase_migrations.schema_migrations(version, name)\n`
      + `values ('${LEDGER_TAXONOMIA}', 'gondola_beverage_taxonomy');\ncommit;`);
    const [despuesLedger] = await sql('select max(version) as version from supabase_migrations.schema_migrations;');
    console.log(`migración aplicada · ledger ${ledger.version} → ${despuesLedger.version}`);
    if (String(despuesLedger.version) !== LEDGER_TAXONOMIA) {
      console.error('ERROR el ledger no avanzó a la versión esperada.');
      process.exitCode = 1;
    }
    return;
  }

  const [negocio] = await sql(`
    select id, name, status, is_active, ordering_enabled, ordering_verified,
           alcohol_sales_enabled, alcohol_minimum_age, alcohol_sales_start,
           alcohol_sales_end, alcohol_timezone, currency_code
      from public.businesses where id = ${lit(BUSINESS_ID)};`);
  if (!negocio) abortar(`el negocio ${BUSINESS_ID} no existe en ${ref}`);

  const [antes] = await sql(`
    select (select count(*) from public.products where business_id = ${lit(BUSINESS_ID)})::int as productos,
           (select count(*) from public.products where business_id = ${lit(BUSINESS_ID)} and available)::int as disponibles,
           (select count(*) from public.products where business_id = ${lit(BUSINESS_ID)} and is_alcoholic)::int as con_alcohol,
           (select count(*) from public.orders)::int as pedidos,
           (select count(*) from public.catalog_assets)::int as assets,
           (select max(version) from supabase_migrations.schema_migrations) as ledger;`);

  console.log(`negocio        ${negocio.name} · ${negocio.status} · activo=${negocio.is_active} · ${negocio.currency_code}`);
  console.log(`pedidos        habilitados=${negocio.ordering_enabled} verificado=${negocio.ordering_verified}`);
  console.log(`alcohol        habilitado=${negocio.alcohol_sales_enabled}`
    + (negocio.alcohol_sales_enabled
      ? ` · ${negocio.alcohol_sales_start}–${negocio.alcohol_sales_end} ${negocio.alcohol_timezone} · +${negocio.alcohol_minimum_age}`
      : ' · sin política configurada'));
  console.log(`ANTES          ${antes.productos} productos · ${antes.disponibles} disponibles · `
    + `${antes.con_alcohol} con alcohol · ${antes.assets} assets · ${antes.pedidos} pedidos · ledger ${antes.ledger}`);

  const previos = await sql(`
    select external_id, name, category, price, stock, available, units_per_pack, sold_as_pack
      from public.products where business_id = ${lit(BUSINESS_ID)} order by sort_order, external_id;`);
  for (const p of previos) {
    console.log(`  previo · ${p.external_id} · ${p.category} · $${p.price} · stock ${p.stock} · `
      + `${p.available ? 'publicado' : 'no publicado'}${p.sold_as_pack ? ` · pack x${p.units_per_pack}` : ''}`);
  }

  if (String(antes.ledger) < LEDGER_TAXONOMIA) {
    abortar(`falta la migración ${LEDGER_TAXONOMIA} (taxonomía de la góndola) — ledger ${antes.ledger}.\n`
      + '  Sin ella la base rechaza Mixers, Energizantes, Fernet, Aperitivos, Vinos,\n'
      + '  Destilados y Aguas saborizadas. Aplicarla primero.');
  }

  if (!aplicar) {
    console.log('');
    console.log(`ENSAYO: no se escribió nada. ${GONDOLA.length} filas listas.`);
    return;
  }

  if (alcoholComprable && !negocio.alcohol_sales_enabled) {
    abortar('se pidió alcohol comprable y el comercio tiene alcohol_sales_enabled = false.\n'
      + '  Publicarlos así deja productos que se agregan al carrito y el checkout\n'
      + '  rechaza con «política de alcohol no configurada». Configurar la política\n'
      + '  primero, o cargar sin --alcohol-comprable.');
  }

  await sql(construirLote(GONDOLA, { verificadoPor, publicar, alcoholComprable }));

  // ── Relectura desde la base, comparada contra el plan ─────────────────────
  const cargados = await sql(`
    select external_id, sku, name, brand, category, subcategory, variant, presentation,
           capacity_value::text as capacity_value, capacity_unit, capacity, packaging_type,
           units_per_pack, sold_as_pack, price::text as price, price_status, stock,
           available, is_verified, is_active, is_alcoholic, minimum_age, catalog_origin,
           image_url, catalog_asset_id
      from public.products
     where business_id = ${lit(BUSINESS_ID)}
       and external_id in (${GONDOLA.map((p) => lit(p.externalId)).join(',')})
     order by sort_order;`);

  const esperado = new Map(GONDOLA.map((p) => [p.externalId, p]));
  const fallas = [];
  for (const fila of cargados) {
    const p = esperado.get(fila.external_id);
    if (!p) { fallas.push(`${fila.external_id}: fila que no está en el plan`); continue; }
    const numero = (campo, leido, escrito) => {
      if (Number(leido) !== Number(escrito)) fallas.push(`${fila.external_id}: ${campo} ${leido} ≠ ${escrito}`);
    };
    const texto = (campo, leido, escrito) => {
      if (String(leido) !== String(escrito)) fallas.push(`${fila.external_id}: ${campo} «${leido}» ≠ «${escrito}»`);
    };
    numero('price', fila.price, p.price);
    numero('stock', fila.stock, p.stock);
    numero('units_per_pack', fila.units_per_pack, p.unitsPerPack);
    numero('capacity_value', fila.capacity_value, p.capacityValue);
    texto('category', fila.category, p.category);
    texto('capacity', fila.capacity, p.capacity);
    texto('brand', fila.brand, p.brand);
    texto('name', fila.name, p.name);
    if (fila.sold_as_pack !== p.soldAsPack) fallas.push(`${fila.external_id}: sold_as_pack ${fila.sold_as_pack} ≠ ${p.soldAsPack}`);
    if (fila.is_alcoholic !== p.alcoholic) fallas.push(`${fila.external_id}: is_alcoholic ${fila.is_alcoholic} ≠ ${p.alcoholic}`);
    if (Number(fila.minimum_age ?? 0) !== Number(p.minimumAge ?? 0)) fallas.push(`${fila.external_id}: minimum_age ${fila.minimum_age} ≠ ${p.minimumAge}`);
    if (fila.presentation !== fila.variant) fallas.push(`${fila.external_id}: presentation ≠ variant en la base`);
    if (fila.capacity !== `${Number(fila.capacity_value)} ${fila.capacity_unit}`) fallas.push(`${fila.external_id}: capacity no deriva de capacity_value + capacity_unit`);
    if (fila.price_status !== 'confirmed') fallas.push(`${fila.external_id}: price_status ${fila.price_status}`);
    if (fila.catalog_origin !== 'commercial') fallas.push(`${fila.external_id}: catalog_origin ${fila.catalog_origin}`);
    if (fila.catalog_asset_id || fila.image_url) fallas.push(`${fila.external_id}: quedó con imagen y no se cargó ninguna`);
    // Comprable = publicado Y —si lleva alcohol— con la habilitación acreditada.
    const debeSerComprable = publicar && (!p.alcoholic || alcoholComprable);
    if (publicar && !fila.is_verified) fallas.push(`${fila.external_id}: quedó sin verificar`);
    if (!publicar && fila.is_verified) fallas.push(`${fila.external_id}: quedó verificado y se pidió sin publicar`);
    if (fila.available !== debeSerComprable) {
      fallas.push(`${fila.external_id}: available=${fila.available} y debía ser ${debeSerComprable}`
        + (p.alcoholic ? ' (lleva alcohol · LICENSE GATE)' : ''));
    }
  }
  for (const p of GONDOLA) {
    if (!cargados.some((f) => f.external_id === p.externalId)) fallas.push(`${p.externalId}: no llegó a la base`);
  }

  const [despues] = await sql(`
    select (select count(*) from public.products where business_id = ${lit(BUSINESS_ID)})::int as productos,
           (select count(*) from public.products where business_id = ${lit(BUSINESS_ID)} and available)::int as disponibles,
           (select count(*) from public.products where business_id = ${lit(BUSINESS_ID)} and is_alcoholic and available)::int as alcohol_publicado,
           (select count(*) from public.orders)::int as pedidos;`);
  const porCategoria = await sql(`
    select category, count(*)::int as filas, count(*) filter (where available)::int as publicados,
           min(price)::text as minimo, max(price)::text as maximo
      from public.products where business_id = ${lit(BUSINESS_ID)}
     group by category order by category;`);

  console.log('');
  console.log(`DESPUÉS        ${despues.productos} productos · ${despues.disponibles} disponibles · `
    + `${despues.alcohol_publicado} con alcohol publicados · ${despues.pedidos} pedidos`);
  for (const c of porCategoria) {
    console.log(`  ${String(c.filas).padStart(3)} (${c.publicados} publicados)  ${c.category.padEnd(20)} $${c.minimo} – $${c.maximo}`);
  }
  console.log(`releídos y comparados contra el plan: ${cargados.length}/${GONDOLA.length}`);

  if (despues.pedidos !== antes.pedidos) fallas.push(`la cantidad de pedidos cambió: ${antes.pedidos} → ${despues.pedidos}`);

  if (fallas.length) {
    for (const f of fallas) console.error(`ERROR ${f}`);
    console.error(`\n${fallas.length} discrepancia(s) entre el plan y lo que quedó escrito.`);
    process.exitCode = 1;
    return;
  }
  console.log('OK · la góndola quedó cargada y coincide fila por fila con el plan.');
});
