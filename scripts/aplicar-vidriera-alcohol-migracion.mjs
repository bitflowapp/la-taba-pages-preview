/*
 * Aplica a producción la política que deja MIRAR el alcohol con fotografía.
 *
 * QUÉ ESCRIBE, EXACTAMENTE
 * ------------------------
 * Una política de SELECT y su comentario. Nada más. No escribe una sola fila de
 * `products`, no toca ningún grant y no toca `alcohol_sales_enabled`.
 *
 * POR QUÉ ESTO NO PUEDE HABILITAR UNA VENTA
 * -----------------------------------------
 * La política exige `available is false`. Un producto que se pueda comprar no
 * entra por acá por construcción, y el día que el comercio habilite la venta
 * estas filas dejan de cumplir la condición y pasan a entrar por la política de
 * siempre. Se apaga sola.
 *
 * Y aunque alguien fabricara el pedido contra la API, `create_order` valida la
 * política de alcohol completa al cobrar y hoy la rechaza: `alcohol_sales_enabled`
 * está en false y la edad mínima, la ventana horaria y el huso están en null.
 *
 * CÓMO SE CORRE
 * -------------
 *   node scripts/aplicar-vidriera-alcohol-migracion.mjs              (ensayo)
 *   node scripts/aplicar-vidriera-alcohol-migracion.mjs --aplicar    (escribe)
 *
 * El ensayo no escribe y dice qué encontraría. La escritura va en UNA
 * transacción junto con el asiento del ledger: o entran las dos cosas o no entra
 * ninguna.
 */
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { conToken } from './lib/supabase-cli-token.mjs';

const ROOT = path.resolve(import.meta.dirname, '..');
const REF = 'wwcpogltfgzgkrlilbcd';
const BUSINESS_ID = '00000000-0000-4000-8000-000000000001';
const NOMBRE = '20260826140000_alcohol_con_foto_visible_sin_venta';
const VERSION = NOMBRE.slice(0, 14);
const POLITICA = 'alcohol verificado con foto se puede mirar';
const RUTA = path.join(ROOT, 'supabase/migrations', `${NOMBRE}.sql`);

const aplicar = process.argv.includes('--aplicar');
const lit = (v) => `'${String(v).replaceAll("'", "''")}'`;

await conToken(async (token) => {
  const sql = async (query) => {
    const r = await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        'User-Agent': 'taba2-vidriera-alcohol/1.0',
      },
      body: JSON.stringify({ query }),
    });
    const t = await r.text();
    if (!r.ok) throw new Error(`HTTP ${r.status} · ${t.slice(0, 1200)}`);
    return t ? JSON.parse(t) : null;
  };

  const contar = async () => {
    const [x] = await sql(`select
        count(*) filter (where is_alcoholic)::int as alcoholicos,
        count(*) filter (where is_alcoholic and image_url is not null)::int as con_foto,
        count(*) filter (where is_alcoholic and available)::int as disponibles,
        count(*) filter (where available)::int as comprables
      from public.products where business_id = ${lit(BUSINESS_ID)};`);
    const [b] = await sql(`select alcohol_sales_enabled from public.businesses where id = ${lit(BUSINESS_ID)};`);
    return { ...x, alcohol_sales_enabled: b.alcohol_sales_enabled };
  };

  const [antes] = await sql('select max(version) as version from supabase_migrations.schema_migrations;');
  console.log(`ledger ANTES        ${antes.version}`);

  const politicasAntes = await sql(`select policyname from pg_policies
    where schemaname='public' and tablename='products' order by policyname;`);
  console.log(`políticas ANTES     ${politicasAntes.length} · ${politicasAntes.map((p) => p.policyname).join(' | ')}`);

  const estadoAntes = await contar();
  console.log(`catálogo ANTES      alcohólicos ${estadoAntes.alcoholicos} · con foto ${estadoAntes.con_foto}`
    + ` · alcohol disponible ${estadoAntes.disponibles} · comprables ${estadoAntes.comprables}`
    + ` · alcohol_sales_enabled ${estadoAntes.alcohol_sales_enabled}`);

  if (politicasAntes.some((p) => p.policyname === POLITICA)) {
    console.log('\nLa política ya existe. Nada que hacer.');
    return;
  }

  const ddl = fs.readFileSync(RUTA, 'utf8');

  if (!aplicar) {
    console.log(`\nENSAYO: no se escribió nada. Migración lista: ${NOMBRE}.sql (${ddl.length} bytes).`);
    console.log('Para aplicar: --aplicar');
    return;
  }

  await sql(`begin;\n${ddl}\ninsert into supabase_migrations.schema_migrations(version, name)\n`
    + `values ('${VERSION}', '${NOMBRE.slice(15)}');\ncommit;`);

  const [despues] = await sql('select max(version) as version from supabase_migrations.schema_migrations;');
  const politicasDespues = await sql(`select policyname from pg_policies
    where schemaname='public' and tablename='products' order by policyname;`);
  const estadoDespues = await contar();

  console.log(`\nledger DESPUÉS      ${despues.version}`);
  console.log(`políticas DESPUÉS   ${politicasDespues.length} · ${politicasDespues.map((p) => p.policyname).join(' | ')}`);
  console.log(`catálogo DESPUÉS    alcohólicos ${estadoDespues.alcoholicos} · con foto ${estadoDespues.con_foto}`
    + ` · alcohol disponible ${estadoDespues.disponibles} · comprables ${estadoDespues.comprables}`
    + ` · alcohol_sales_enabled ${estadoDespues.alcohol_sales_enabled}`);

  /*
   * Lo que hay que comprobar no es que la política exista: es que NADA
   * comercial se haya movido. Una política de lectura que cambió un stock sería
   * un desastre silencioso.
   */
  const iguales = ['alcoholicos', 'con_foto', 'disponibles', 'comprables', 'alcohol_sales_enabled']
    .filter((k) => String(estadoAntes[k]) !== String(estadoDespues[k]));
  if (iguales.length) {
    console.error(`\nABORTA LA VERIFICACIÓN: cambió ${iguales.join(', ')}. Revisar a mano.`);
    process.exit(1);
  }
  if (!politicasDespues.some((p) => p.policyname === POLITICA)) {
    console.error('\nABORTA LA VERIFICACIÓN: la política no quedó creada.');
    process.exit(1);
  }
  console.log('\nAPLICADA Y VERIFICADA · 0 cambios comerciales · el alcohol sigue sin poder venderse.');
});
