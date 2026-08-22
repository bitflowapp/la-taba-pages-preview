/*
 * Repara la verificación que el fail-close bajó al escribir los tags de la
 * vidriera, y deja el catálogo exactamente en el estado aprobado.
 *
 * QUÉ PASÓ, dicho para que nadie lo repita: `products_fail_close_master_change`
 * considera `tags` un DATO MAESTRO. Cambiar una etiqueta de merchandising
 * dispara el mismo camino que cambiarle el precio a un producto: el trigger
 * pone available=false, is_verified=false, verified_at=null, verified_by=null.
 * Es fail-close a propósito —un producto verificado que cambia deja de estarlo
 * hasta que alguien lo vuelva a verificar— y no se puede evitar en la misma
 * sentencia: es BEFORE UPDATE y pisa lo que uno escriba.
 *
 * La operación correcta es de DOS pasos: primero los tags, después
 * re-verificar. Este guion es el segundo paso, y sólo escribe las cuatro
 * columnas de verificación:
 *
 *     is_verified = true · verified_at = now() · verified_by = <owner>
 *     available   = el valor que la fila tenía ANTES de la curación
 *
 * `verified_at` va a ahora y no al valor viejo porque el valor viejo se perdió
 * con el fail-close, y porque es la verdad: la re-verificación ocurre ahora, a
 * pedido del dueño que aprobó la curación. NO se toca ninguna otra columna:
 * ni stock, ni precio, ni tags, ni sort_order, ni imágenes.
 *
 * El `available` de cada fila sale de la fotografía que tomó el lote de
 * curación ANTES de escribir (artifacts/.../curacion-vidriera-antes-despues.json),
 * con una sola excepción declarada: el pack x6 de Fanta, que el dueño mandó
 * ocultar y por eso se queda en false.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { conToken } from './lib/supabase-cli-token.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const REF_PRODUCCION = 'wwcpogltfgzgkrlilbcd';
const BUSINESS_ID = '00000000-0000-4000-8000-000000000001';
const OWNER = '61f238ad-fc2b-446a-9f17-257f4622cd86';
const AUTORIZACION = 'I_AUTHORIZE_TABA2_LAUNCH_SHELF_CURATION';
const OCULTO_A_PROPOSITO = 'fanta-naranja-botella-pet-1500-ml-pack-x6';
const FOTOGRAFIA = path.join(ROOT, 'artifacts', 'taba2-go-live-audit', 'curacion-vidriera-antes-despues.json');

const banderas = new Set(process.argv.slice(2));
const abortar = (m) => { console.error(`ABORTAR: ${m}`); process.exit(2); };
if (!banderas.has(`--ref=${REF_PRODUCCION}`)) abortar(`exige --ref=${REF_PRODUCCION}`);
const aplicar = banderas.has('--aplicar');
if (aplicar && process.env.TABA2_LAUNCH_SHELF_CURATION_APPLY !== AUTORIZACION) abortar('falta la autorización por entorno.');

const { antes } = JSON.parse(readFileSync(FOTOGRAFIA, 'utf8'));
if (!Array.isArray(antes) || antes.length !== 72) abortar('la fotografía previa no tiene las 72 filas.');
const availableAntes = new Map(antes.map((p) => [p.external_id, p.available === true]));
const lit = (v) => `'${String(v).replaceAll("'", "''")}'`;

await conToken(async (token) => {
  const sql = async (query) => {
    const r = await fetch(`https://api.supabase.com/v1/projects/${REF_PRODUCCION}/database/query`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', 'User-Agent': 'taba2-reparar-verificacion/1.0' },
      body: JSON.stringify({ query }),
    });
    const t = await r.text();
    if (!r.ok) throw new Error(`HTTP ${r.status} · ${t.slice(0, 1200)}`);
    return t ? JSON.parse(t) : null;
  };

  const rotas = await sql(`select external_id, available, is_verified, verified_by::text as verified_by, stock, price::text as price
    from public.products where business_id = ${lit(BUSINESS_ID)} and is_verified = false order by external_id;`);
  console.log(`filas desverificadas por el fail-close: ${rotas.length}`);
  for (const fila of rotas) {
    if (!availableAntes.has(fila.external_id)) abortar(`${fila.external_id} no está en la fotografía previa.`);
  }
  const objetivo = rotas.map((fila) => ({
    external_id: fila.external_id,
    available: fila.external_id === OCULTO_A_PROPOSITO ? false : availableAntes.get(fila.external_id),
  }));
  for (const o of objetivo) console.log(`  ${o.external_id} -> is_verified=true · available=${o.available}`);

  if (!aplicar) {
    console.log('\nENSAYO: no se escribió nada.');
    return;
  }

  const visibles = objetivo.filter((o) => o.available).map((o) => o.external_id);
  const ocultos = objetivo.filter((o) => !o.available).map((o) => o.external_id);
  const sentencias = ['begin;'];
  // Se escriben SÓLO las cuatro columnas de verificación. El trigger no vuelve
  // a dispararse: su guarda es `old.is_verified`, y estas filas están en false.
  if (visibles.length) {
    sentencias.push(`update public.products set is_verified = true, verified_at = now(), verified_by = ${lit(OWNER)}, available = true, updated_at = now()
      where business_id = ${lit(BUSINESS_ID)} and external_id in (${visibles.map(lit).join(',')});`);
  }
  if (ocultos.length) {
    sentencias.push(`update public.products set is_verified = true, verified_at = now(), verified_by = ${lit(OWNER)}, available = false, updated_at = now()
      where business_id = ${lit(BUSINESS_ID)} and external_id in (${ocultos.map(lit).join(',')});`);
  }
  sentencias.push('commit;');
  await sql(sentencias.join('\n'));

  const [estado] = await sql(`select
      count(*)::int as total,
      count(*) filter (where available and is_active and is_verified)::int as comprables,
      count(*) filter (where not is_verified)::int as sin_verificar,
      count(*) filter (where verified_by is null)::int as sin_verificador,
      count(*) filter (where is_alcoholic and available)::int as alcohol_visible,
      sum(stock)::int as stock_total
    from public.products where business_id = ${lit(BUSINESS_ID)};`);
  console.log('');
  console.log(`DESPUÉS  ${estado.total} productos · ${estado.comprables} comprables · sin verificar ${estado.sin_verificar} · sin verificador ${estado.sin_verificador} · alcohol visible ${estado.alcohol_visible} · stock ${estado.stock_total}`);
  const fallas = [];
  if (estado.comprables !== 32) fallas.push(`los comprables no quedaron en 32: ${estado.comprables}`);
  if (estado.sin_verificar !== 0) fallas.push(`quedan ${estado.sin_verificar} sin verificar`);
  if (estado.sin_verificador !== 0) fallas.push(`quedan ${estado.sin_verificador} sin verificador`);
  if (estado.alcohol_visible !== 0) fallas.push('quedó alcohol visible');
  if (estado.stock_total !== 851) fallas.push(`el stock total cambió: ${estado.stock_total} ≠ 851`);
  if (fallas.length) {
    for (const f of fallas) console.error(`ERROR ${f}`);
    process.exitCode = 1;
    return;
  }
  console.log('OK · verificación restablecida; el catálogo quedó en el estado aprobado.');
});
