/*
 * Diagnóstico READ-ONLY de staging y producción para la góndola retail final.
 *
 * Responde, con datos y no con supuestos, las preguntas que dejó abierto el
 * dry-run bloqueado del 2026-08-21:
 *   · ¿staging está contaminado por pruebas? (pedidos QA, catálogo divergente)
 *   · ¿alcohol_sales_enabled=true en staging es fixture intencional o accidente?
 *   · ¿staging sirve como gate real para ESTE lote, o conviene otro mecanismo?
 *   · ¿hay otra divergencia relevante (ledger, esquema, negocio)?
 *
 * SÓLO SELECT. Ninguna sentencia de este archivo escribe: no hay INSERT,
 * UPDATE, DELETE, DDL ni llamadas a funciones que muten. La evidencia queda en
 * artifacts/taba2-gondola-retail-final/diagnostico-staging-vs-produccion.json.
 *
 * Mismo canal que el resto del tooling: Management API con el token del CLI
 * (scripts/lib/supabase-cli-token.mjs), nunca service_role en cliente.
 */
import { writeFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PRODUCTOS_PROPUESTOS, BUSINESS_ID } from '../catalog/gondola-retail-final-proposal.mjs';
import { conToken } from './lib/supabase-cli-token.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PROYECTOS = {
  staging: 'ukxqbgswjlibmnjemrzd',
  produccion: 'wwcpogltfgzgkrlilbcd',
};

const lit = (v) => `'${String(v).replaceAll("'", "''")}'`;
const externalIds = PRODUCTOS_PROPUESTOS.map((p) => p.externalId);
const gtins = PRODUCTOS_PROPUESTOS.map((p) => p.gtin);

const migracionesRepo = readdirSync(path.join(ROOT, 'supabase', 'migrations'))
  .filter((f) => f.endsWith('.sql'))
  .map((f) => f.slice(0, 14))
  .sort();

const resultado = { generado_utc: new Date().toISOString(), migraciones_repo: { total: migracionesRepo.length, ultima: migracionesRepo.at(-1) }, proyectos: {} };

await conToken(async (token) => {
  const consultar = (ref) => async (query) => {
    const r = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        'User-Agent': 'taba2-gondola-diagnostico-readonly/1.0',
      },
      body: JSON.stringify({ query }),
    });
    const t = await r.text();
    if (!r.ok) throw new Error(`[${ref}] HTTP ${r.status} · ${t.slice(0, 800)}`);
    return t ? JSON.parse(t) : null;
  };

  for (const [nombre, ref] of Object.entries(PROYECTOS)) {
    const sql = consultar(ref);
    const p = { ref };
    resultado.proyectos[nombre] = p;
    console.log(`\n════ ${nombre.toUpperCase()} · ${ref} ════`);

    // Columnas reales de businesses (los dos proyectos pueden diferir).
    const columnas = (await sql(`select column_name from information_schema.columns
        where table_schema='public' and table_name='businesses' order by column_name;`)).map((r) => r.column_name);
    const deseadas = ['id', 'name', 'status', 'is_active', 'alcohol_sales_enabled', 'hours_enforced',
      'delivery_zone_enforced', 'alcohol_hours_enforced', 'operating_timezone', 'delivery_fee',
      'minimum_order', 'minimum_order_amount', 'currency_code', 'created_at', 'updated_at'];
    const seleccion = deseadas.filter((c) => columnas.includes(c));
    const [negocio] = await sql(`select ${seleccion.join(', ')} from public.businesses where id = ${lit(BUSINESS_ID)};`);
    p.negocio = negocio || null;
    p.negocios_total = (await sql('select count(*)::int as n from public.businesses;'))[0].n;
    console.log(`negocio canónico: ${negocio ? `${negocio.name} · activo=${negocio.is_active} · alcohol=${negocio.alcohol_sales_enabled} · hours_enforced=${negocio.hours_enforced}` : 'NO EXISTE'}`);

    // Ledger de migraciones contra el repo en 95ac129.
    const ledger = (await sql('select version from supabase_migrations.schema_migrations order by version;')).map((r) => r.version);
    const repoSet = new Set(migracionesRepo);
    const ledgerSet = new Set(ledger);
    p.ledger = {
      total: ledger.length,
      ultima: ledger.at(-1) ?? null,
      solo_en_remoto: ledger.filter((v) => !repoSet.has(v)),
      solo_en_repo: migracionesRepo.filter((v) => !ledgerSet.has(v)),
    };
    console.log(`ledger: ${p.ledger.total} aplicadas · última ${p.ledger.ultima} · sólo-remoto ${p.ledger.solo_en_remoto.length} · sólo-repo ${p.ledger.solo_en_repo.length}`);

    // Catálogo del negocio canónico.
    const [cat] = await sql(`select
        count(*)::int as productos,
        count(*) filter (where available)::int as disponibles,
        count(*) filter (where is_alcoholic)::int as alcoholicos,
        count(*) filter (where stock > 0)::int as con_stock,
        count(*) filter (where image_url is not null)::int as con_imagen
      from public.products where business_id = ${lit(BUSINESS_ID)};`);
    p.catalogo = cat;
    p.codigos_barras = (await sql(`select count(*)::int as n from public.product_barcodes where business_id = ${lit(BUSINESS_ID)};`))[0].n;
    console.log(`catálogo: ${cat.productos} productos · ${cat.disponibles} disponibles · ${cat.alcoholicos} alcohólicos · ${cat.con_stock} con stock · ${p.codigos_barras} códigos`);

    // Pedidos: volumen, último, LT-0001.
    const [ped] = await sql(`select count(*)::int as total, max(created_at) as ultimo from public.orders;`);
    p.pedidos = ped;
    const lt1 = await sql(`select public_code, status, total, created_at from public.orders where public_code = 'LT-0001';`);
    p.lt0001 = lt1[0] || null;
    p.pedidos_por_estado = await sql(`select status, count(*)::int as n from public.orders group by status order by n desc;`);
    console.log(`pedidos: ${ped.total} · último ${ped.ultimo} · LT-0001 ${p.lt0001 ? `${p.lt0001.status} · total ${p.lt0001.total}` : 'no existe'}`);

    // Colisiones del lote de 12.
    p.colision_sku = (await sql(`select external_id from public.products
        where business_id = ${lit(BUSINESS_ID)} and external_id in (${externalIds.map(lit).join(',')});`)).map((r) => r.external_id);
    p.colision_gtin = (await sql(`select gtin from public.product_barcodes
        where business_id = ${lit(BUSINESS_ID)} and gtin in (${gtins.map(lit).join(',')});`)).map((r) => r.gtin);
    console.log(`colisiones del lote: SKU ${p.colision_sku.length} · GTIN ${p.colision_gtin.length}`);

    // Rastro del flag de alcohol: tablas de auditoría que existan.
    const tablasAudit = (await sql(`select table_name from information_schema.tables
        where table_schema='public' and (table_name like '%audit%' or table_name like '%commercial_settings%')
        order by table_name;`)).map((r) => r.table_name);
    p.tablas_auditoria = tablasAudit;
    p.rastro_alcohol = [];
    for (const t of tablasAudit) {
      const cols = (await sql(`select column_name from information_schema.columns
          where table_schema='public' and table_name=${lit(t)};`)).map((r) => r.column_name);
      const colTexto = ['setting', 'setting_key', 'field', 'action', 'change', 'detail', 'details', 'payload', 'metadata', 'note', 'reason', 'event_type', 'type']
        .filter((c) => cols.includes(c));
      if (!colTexto.length) continue;
      const cond = colTexto.map((c) => `${c}::text ilike '%alcohol%'`).join(' or ');
      try {
        const filas = await sql(`select * from public.${t} where ${cond} order by 1 desc limit 5;`);
        if (filas.length) p.rastro_alcohol.push({ tabla: t, filas });
      } catch { /* tabla sin esa forma: se ignora */ }
    }
    console.log(`auditoría: ${tablasAudit.length} tablas candidatas · rastro de alcohol en ${p.rastro_alcohol.length}`);

    // Miembros del negocio (volumen de cuentas de prueba).
    try {
      const [mi] = await sql(`select count(*)::int as total, count(*) filter (where is_active)::int as activos from public.business_members;`);
      p.miembros = mi;
      console.log(`miembros: ${mi.total} · activos ${mi.activos}`);
    } catch { p.miembros = null; }
  }
});

const destino = path.join(ROOT, 'artifacts', 'taba2-gondola-retail-final', 'diagnostico-staging-vs-produccion.json');
writeFileSync(destino, `${JSON.stringify(resultado, null, 2)}\n`);
console.log(`\nEvidencia: ${destino}`);
