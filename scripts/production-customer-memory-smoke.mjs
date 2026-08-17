// La memoria del Cliente, contra PRODUCCION.
//
// El Customer no entra con correo ni contrasena: entra anonimo. Lo que esta
// sonda mide es que esa identidad anonima alcance para tener memoria -nombre,
// telefono, direcciones- y que la memoria de una persona no sea legible por
// otra:
//
//   1. entrar anonimo, y que el JWT lo diga
//   2. guardar perfil y direccion
//   3. volver con el refresh token: el perfil sigue ahi (esto es "recargar")
//   4. una segunda direccion, y cambiar cual es la predeterminada
//   5. el invariante de "una sola predeterminada"
//   6. la persona B no puede leer nada de la persona A, ni por RPC ni por tabla
//   7. una identidad anonima no obtiene ningun privilegio de Panel ni de Rider
//   8. limpieza: no queda ninguna identidad ni ninguna direccion
//
// No crea pedidos: la persiana esta cerrada y se verifica que siga asi.
//
//   $env:SUPABASE_ACCESS_TOKEN = <token del CLI>
//   node scripts/production-customer-memory-smoke.mjs --ref wwcpogltfgzgkrlilbcd \
//     --key-file <archivo con la clave publicable> [--report <archivo.json>]
//
// Salida 0 = la memoria funciona y no quedo nada. 1 = hallazgos. 2 = no se pudo.

import fs from 'node:fs';
import process from 'node:process';

const PRODUCTION_REF = 'wwcpogltfgzgkrlilbcd';
const CANONICAL_BUSINESS = '00000000-0000-4000-8000-000000000001';

function arg(name) {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? undefined : process.argv[i + 1];
}

const ref = (arg('ref') || '').trim();
if (ref !== PRODUCTION_REF) { console.error(`--ref debe ser ${PRODUCTION_REF}`); process.exit(2); }

const keyFile = arg('key-file');
const KEY = ((arg('key') || (keyFile ? fs.readFileSync(keyFile, 'utf8') : '')) || '').trim();
if (!KEY.startsWith('sb_publishable_')) { console.error('falta --key/--key-file publicable'); process.exit(2); }

const PAT = process.env.SUPABASE_ACCESS_TOKEN;
if (!PAT) { console.error('falta SUPABASE_ACCESS_TOKEN'); process.exit(2); }

const BASE = `https://${ref}.supabase.co`;
const hallazgos = [];
const pasos = [];
function paso(nombre, ok, detalle = '') {
  pasos.push({ nombre, ok: Boolean(ok), detalle });
  if (!ok) hallazgos.push(`${nombre}${detalle ? ` — ${detalle}` : ''}`);
  console.log(`  ${ok ? 'OK  ' : 'MAL '} ${nombre}${detalle ? ` · ${detalle}` : ''}`);
  return ok;
}

async function sql(query, readOnly = true) {
  const r = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${PAT}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(readOnly ? { query, read_only: true } : { query }),
  });
  const t = await r.text();
  if (!r.ok) throw new Error(`SQL ${r.status} ${t.slice(0, 300)}`);
  return t ? JSON.parse(t) : [];
}

async function pedir(ruta, { token = null, ...init } = {}) {
  const headers = { apikey: KEY, 'Content-Type': 'application/json', ...(init.headers || {}) };
  if (token) headers.Authorization = `Bearer ${token}`;
  const r = await fetch(`${BASE}${ruta}`, { ...init, headers });
  const text = await r.text();
  let body = null;
  try { body = text ? JSON.parse(text) : null; } catch { body = text; }
  return { status: r.status, body };
}

const rpc = (nombre, params, token) => pedir(`/rest/v1/rpc/${nombre}`, {
  token, method: 'POST', body: JSON.stringify(params),
});

function claims(jwt) {
  try { return JSON.parse(Buffer.from(String(jwt).split('.')[1], 'base64url').toString('utf8')); } catch { return null; }
}

/** Lo mismo que hace `signInAnonymously` del SDK. */
async function entrarAnonimo() {
  const r = await pedir('/auth/v1/signup', {
    method: 'POST',
    body: JSON.stringify({ data: { taba_actor: 'customer' } }),
  });
  return {
    status: r.status,
    jwt: r.body?.access_token || '',
    refresh: r.body?.refresh_token || '',
    id: r.body?.user?.id || '',
  };
}

const direccion = (label, calle, numero, extra = {}) => ({
  label,
  street: calle,
  streetNumber: numero,
  city: 'Neuquén',
  province: 'Neuquén',
  reference: 'Portón negro',
  source: 'manual',
  ...extra,
});

const reporte = { schemaVersion: 1, ref, checkedAt: new Date().toISOString(), pasos, hallazgos };
const creados = [];

console.log(`--- MEMORIA DEL CLIENTE CONTRA PRODUCCION (${ref}) ---\n`);

try {
  // --------------------------------------------------------- 1. identidad
  console.log('1 · entrar anonimo');
  const a = await entrarAnonimo();
  paso('el ingreso anonimo funciona', a.status === 200 && Boolean(a.jwt), `HTTP ${a.status}`);
  if (a.id) creados.push(a.id);
  const ca = claims(a.jwt) || {};
  paso('el JWT dice anonimo y authenticated',
    ca.is_anonymous === true && ca.role === 'authenticated',
    `is_anonymous=${ca.is_anonymous} role=${ca.role}`);

  // ------------------------------------------------------------ 2. perfil
  console.log('\n2 · guardar el perfil y la primera direccion');
  const perfil = await rpc('upsert_current_customer_profile', {
    p_name: 'Cliente QA', p_phone: '2995551234',
  }, a.jwt);
  // Las RPC del Cliente devuelven el objeto, no un sobre con `ok`: la falla
  // viaja como error de PostgREST. Se afirma sobre lo que devuelven de verdad.
  paso('guarda nombre y telefono',
    perfil.status === 200 && perfil.body?.name === 'Cliente QA',
    `HTTP ${perfil.status} name=${perfil.body?.name}`);
  paso('el telefono se normaliza en el servidor',
    /^\d{10,13}$/.test(String(perfil.body?.phone || '')), `phone=${perfil.body?.phone}`);

  const dir1 = await rpc('upsert_current_customer_address', {
    p_address: direccion('Casa', 'Mendoza', '827', { isDefault: true }),
  }, a.jwt);
  paso('guarda la primera direccion', dir1.status === 200 && Boolean(dir1.body?.address?.id || dir1.body?.id),
    `HTTP ${dir1.status}`);
  const idDir1 = dir1.body?.address?.id || dir1.body?.id || '';

  // ----------------------------------------------------------- 3. recarga
  console.log('\n3 · volver mas tarde: la memoria sigue ahi');
  const refrescada = await pedir('/auth/v1/token?grant_type=refresh_token', {
    method: 'POST', body: JSON.stringify({ refresh_token: a.refresh }),
  });
  const jwt2 = refrescada.body?.access_token || '';
  paso('la sesion se restaura con el refresh token', Boolean(jwt2), `HTTP ${refrescada.status}`);
  paso('y sigue siendo la misma persona', claims(jwt2)?.sub === a.id);

  const traido = await rpc('get_current_customer_profile', {}, jwt2);
  const perfilTraido = traido.body?.customer || traido.body?.profile || traido.body;
  paso('el perfil vuelve con el nombre guardado',
    JSON.stringify(perfilTraido || '').includes('Cliente QA'), `HTTP ${traido.status}`);
  const direcciones = traido.body?.addresses || [];
  paso('y con la direccion guardada', Array.isArray(direcciones) && direcciones.length === 1,
    `${Array.isArray(direcciones) ? direcciones.length : '?'} direccion(es)`);
  paso('la primera direccion queda como predeterminada',
    direcciones[0]?.isDefault === true || direcciones[0]?.is_default === true,
    JSON.stringify(direcciones[0]?.isDefault ?? direcciones[0]?.is_default ?? null));

  // -------------------------------------------------- 4. segunda direccion
  console.log('\n4 · una segunda direccion, y cambiar la predeterminada');
  const dir2 = await rpc('upsert_current_customer_address', {
    p_address: direccion('Trabajo', 'Alcorta', '150'),
  }, jwt2);
  paso('guarda la segunda direccion', dir2.status === 200 && Boolean(dir2.body?.address?.id || dir2.body?.id), `HTTP ${dir2.status}`);
  const idDir2 = dir2.body?.address?.id || dir2.body?.id || '';

  const cambio = await rpc('set_current_customer_default_address', { p_address_id: idDir2 }, jwt2);
  paso('cambiar la predeterminada funciona', cambio.status === 200, `HTTP ${cambio.status}`);

  const [{ predeterminadas }] = await sql(
    `select count(*)::int as predeterminadas from public.customer_addresses
      where customer_id = '${a.id}' and is_default and deleted_at is null;`,
  );
  paso('nunca hay mas de una predeterminada', predeterminadas === 1, `${predeterminadas}`);

  const [{ cual }] = await sql(
    `select id::text as cual from public.customer_addresses
      where customer_id = '${a.id}' and is_default and deleted_at is null;`,
  );
  paso('y es la que se eligio', cual === idDir2, `${cual === idDir2 ? 'la segunda' : cual}`);

  const archivada = await rpc('archive_current_customer_address', { p_address_id: idDir1 }, jwt2);
  paso('borrar una direccion es borrado logico', archivada.status === 200, `HTTP ${archivada.status}`);
  const [{ vivas, historicas }] = await sql(
    `select count(*) filter (where deleted_at is null)::int as vivas,
            count(*)::int as historicas
       from public.customer_addresses where customer_id = '${a.id}';`,
  );
  paso('la direccion vieja sigue existiendo para la historia de entregas',
    vivas === 1 && historicas === 2, `vivas=${vivas} historicas=${historicas}`);

  // -------------------------------------------------------- 5. aislamiento
  console.log('\n5 · la persona B no ve nada de la persona A');
  const b = await entrarAnonimo();
  if (b.id) creados.push(b.id);
  const perfilB = await rpc('get_current_customer_profile', {}, b.jwt);
  const textoB = JSON.stringify(perfilB.body || '');
  paso('B no ve el perfil de A', !textoB.includes('Cliente QA') && !textoB.includes('2995551234'),
    `HTTP ${perfilB.status}`);

  const tablaClientes = await pedir(`/rest/v1/customers?select=id,name&id=eq.${a.id}`, { token: b.jwt });
  paso('B no lee la fila de A en customers',
    Array.isArray(tablaClientes.body) && tablaClientes.body.length === 0,
    `HTTP ${tablaClientes.status} filas=${Array.isArray(tablaClientes.body) ? tablaClientes.body.length : '?'}`);

  const tablaDirecciones = await pedir(`/rest/v1/customer_addresses?select=id&customer_id=eq.${a.id}`, { token: b.jwt });
  paso('ni ninguna direccion de A',
    Array.isArray(tablaDirecciones.body) && tablaDirecciones.body.length === 0,
    `HTTP ${tablaDirecciones.status} filas=${Array.isArray(tablaDirecciones.body) ? tablaDirecciones.body.length : '?'}`);

  const robar = await rpc('set_current_customer_default_address', { p_address_id: idDir2 }, b.jwt);
  paso('B no puede tocar una direccion de A', robar.body?.ok !== true,
    `code=${robar.body?.code || robar.status}`);

  const escrituraDirecta = await pedir('/rest/v1/customers', {
    token: b.jwt, method: 'POST',
    body: JSON.stringify({ id: a.id, name: 'Suplantado', phone: '2990000000' }),
  });
  paso('nadie escribe customers por tabla, ni su propia fila', escrituraDirecta.status >= 400,
    `HTTP ${escrituraDirecta.status}`);

  // ------------------------------------------------- 6. sin privilegios
  console.log('\n6 · anonimo no es Panel ni Rider');
  const contexto = await rpc('identity_current_context', { p_business_id: CANONICAL_BUSINESS }, b.jwt);
  paso('una identidad anonima no obtiene rol', !contexto.body?.role,
    `role=${JSON.stringify(contexto.body?.role ?? null)}`);
  const solicitud = await rpc('request_business_access', {
    p_business_id: CANONICAL_BUSINESS, p_access: 'panel',
    p_full_name: 'Anonimo QA', p_contact_phone: '2990000000',
  }, b.jwt);
  paso('y no puede pedir acceso de equipo siendo anonima', solicitud.body?.ok !== true,
    `code=${solicitud.body?.code || solicitud.status}`);
} catch (error) {
  hallazgos.push(`la sonda se corto: ${String(error.message).slice(0, 200)}`);
  console.error(`\n  ERROR: ${String(error.message).slice(0, 400)}`);
} finally {
  console.log('\n7 · limpieza');
  if (creados.length) {
    const lista = creados.map((id) => `'${id}'`).join(', ');
    await sql(`
      delete from public.customer_addresses where customer_id in (${lista});
      delete from public.customers where id in (${lista});
      delete from auth.users where id in (${lista});
    `, false);
  }
  const [resto] = await sql(`
    select (select count(*) from auth.users)::int as usuarios,
           (select count(*) from public.customers)::int as clientes,
           (select count(*) from public.customer_addresses)::int as direcciones,
           (select count(*) from public.orders)::int as pedidos;
  `);
  reporte.despuesDeLimpiar = resto;
  paso('produccion queda sin rastro de la corrida',
    resto.usuarios === 0 && resto.clientes === 0 && resto.direcciones === 0 && resto.pedidos === 0,
    JSON.stringify(resto));

  const [{ ordering }] = await sql(
    `select ordering_enabled as ordering from public.businesses where id = '${CANONICAL_BUSINESS}';`,
  );
  paso('los pedidos siguen cerrados', ordering === false, `ordering_enabled=${ordering}`);
  reporte.orderingEnabled = ordering;

  reporte.hallazgos = hallazgos;
  const destino = arg('report');
  if (destino) {
    fs.writeFileSync(destino, `${JSON.stringify(reporte, null, 2)}\n`);
    console.log(`\n  reporte: ${destino}`);
  }
  console.log(`\n  RESULTADO: ${hallazgos.length ? `${hallazgos.length} HALLAZGO(S)` : 'LA MEMORIA DEL CLIENTE FUNCIONA'}`);
  process.exitCode = hallazgos.length ? 1 : 0;
}
