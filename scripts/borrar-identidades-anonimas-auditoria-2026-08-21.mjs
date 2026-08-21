/*
 * Borra de PRODUCCIÓN las DOS identidades anónimas que la auditoría de UX del
 * 2026-08-21 dejó en auth.users al medir el defecto del carrito (A1, corregido
 * en v81). Autorizado por el dueño en el gate del mismo día.
 *
 * Los ids van HARDCODEADOS: este guion no busca «anónimos de hoy», borra dos
 * filas concretas y nada más. Guardas antes de escribir: cada id tiene que
 * seguir siendo anónimo, creado el 2026-08-21, sin pedidos, sin membresías de
 * negocio y sin sesiones de identidad; el DELETE va en una transacción y si
 * cualquier FK RESTRICT lo frena, no se borra nada. Después se relee el conteo.
 *
 * Misma autorización por entorno que el lote de altas + --confirmado-por-humano.
 */
import { conToken } from './lib/supabase-cli-token.mjs';

const REF_PRODUCCION = 'wwcpogltfgzgkrlilbcd';
const AUTORIZACION = 'I_AUTHORIZE_TABA2_GONDOLA_RETAIL_FINAL_PRODUCTION_INSERT';
const IDS = ['809cc65f-3d6c-4445-9084-5b51be7c5510', 'b75628f6-bf9e-4692-9d1b-ab07c9c9e999'];

const banderas = new Set(process.argv.slice(2));
const abortar = (m) => { console.error(`ABORTAR: ${m}`); process.exit(2); };
if (!banderas.has(`--ref=${REF_PRODUCCION}`)) abortar(`exige --ref=${REF_PRODUCCION}`);
const aplicar = banderas.has('--aplicar');
if (aplicar && process.env.TABA2_GONDOLA_RETAIL_FINAL_PRODUCTION_APPLY !== AUTORIZACION) abortar('falta la autorización por entorno.');
if (aplicar && !banderas.has('--confirmado-por-humano')) abortar('--aplicar exige --confirmado-por-humano.');

const lista = IDS.map((id) => `'${id}'`).join(',');

await conToken(async (token) => {
  const sql = async (query) => {
    const r = await fetch(`https://api.supabase.com/v1/projects/${REF_PRODUCCION}/database/query`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', 'User-Agent': 'taba2-borrar-anonimos-auditoria/1.0' },
      body: JSON.stringify({ query }),
    });
    const t = await r.text();
    if (!r.ok) throw new Error(`HTTP ${r.status} · ${t.slice(0, 1200)}`);
    return t ? JSON.parse(t) : null;
  };

  const filas = await sql(`select u.id, u.is_anonymous, u.created_at::date::text as dia,
      (select count(*) from public.orders o where o.customer_user_id = u.id)::int as pedidos,
      (select count(*) from public.business_members bm where bm.user_id = u.id)::int as membresias,
      (select count(*) from public.identity_sessions s where s.user_id = u.id)::int as sesiones_identidad,
      (select count(*) from public.checkout_sessions cs where cs.customer_id = u.id)::int as checkouts
    from auth.users u where u.id in (${lista}) order by u.created_at;`);
  for (const f of filas) console.log(`  ${f.id} · anon=${f.is_anonymous} · ${f.dia} · pedidos=${f.pedidos} · membresías=${f.membresias} · sesiones=${f.sesiones_identidad} · checkouts=${f.checkouts}`);
  if (filas.length !== 2) abortar(`se esperaban 2 filas y hay ${filas.length}: alguien ya las tocó.`);
  for (const f of filas) {
    if (f.is_anonymous !== true || f.dia !== '2026-08-21' || f.pedidos || f.membresias || f.sesiones_identidad || f.checkouts) {
      abortar(`${f.id} no cumple el perfil de «anónima vacía de hoy». No se borra nada.`);
    }
  }
  if (!aplicar) { console.log('ENSAYO: las 2 cumplen el perfil. No se borró nada.'); return; }

  await sql(`begin;
    delete from auth.users where id in (${lista}) and is_anonymous = true;
    commit;`);
  const [{ quedan }] = await sql(`select count(*)::int as quedan from auth.users where id in (${lista});`);
  const [{ anonimas_hoy }] = await sql(`select count(*)::int as anonimas_hoy from auth.users where is_anonymous and created_at >= '2026-08-21';`);
  console.log(`DESPUÉS quedan=${quedan} (esperado 0) · anónimas de hoy que siguen: ${anonimas_hoy}`);
  if (quedan !== 0) { console.error('ERROR no se borraron las dos.'); process.exitCode = 1; return; }
  console.log('OK · las 2 identidades de la auditoría quedaron borradas; nada más se tocó.');
});
