// TABA · CORE FISCAL · PostgREST y Storage emulados sobre PostgreSQL real
//
// El worker canonico habla con La Taba por HTTP: SupabaseFiscalStore llama
// /rest/v1/rpc/<funcion> con argumentos POR NOMBRE y lee /rest/v1/fiscal_documents;
// SupabasePrivateArtifactStorage sube el PDF a /storage/v1/object/fiscal-documents.
// Este fetch reproduce eso contra una base real, sin Docker ni red:
//
//   · cada pedido corre en su conexion y su transaccion con `set local role <rol>`
//     y los claims del JWT, como PostgREST;
//   · la llamada usa notacion por NOMBRE (p_x => $1): si el cliente manda un
//     argumento que la funcion no tiene, falla como PostgREST (PGRST202); si hay
//     sobrecargas ambiguas, PGRST203. Es el tipo de error que rompio #106;
//   · los argumentos se convierten segun el tipo declarado (json/jsonb, arrays,
//     escalares) y el JSON de respuesta lo arma PostgreSQL (to_jsonb / jsonb_agg);
//   · cualquier ruta que no deberia usarse responde 404 y queda registrada.
//
// `rpcClient()` expone la misma superficie que supabase-js (`rpc` -> {data, error,
// status}) para pasar por aca al codigo REAL de La Taba (repositorios del Panel y
// gateway del agente local). Solo para pruebas contra bases descartables.

const IDENT = /^[a-z_][a-z0-9_]*$/;

function json(status, body) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

function postgrestError(error) {
  if (error.code === '42883') return json(404, { code: 'PGRST202', message: `Could not find the function in the schema cache: ${error.message}`, details: null, hint: null });
  if (error.code === '42725') return json(300, { code: 'PGRST203', message: `Could not choose the best candidate function: ${error.message}`, details: null, hint: null });
  // 40001 es falla de serializacion para PostgREST: reintenta la transaccion y una negativa de
  // negocio gira hasta el 504 del gateway (~125 s, medido en Staging; 20260924200000). Aca se
  // devuelve el 504 sin esperar y la llamada queda registrada con su codigo.
  if (error.code === '40001') return new Response('upstream request timeout', { status: 504 });
  // PTnnn responde HTTP nnn, como PostgREST.
  const custom = /^PT([1-5][0-9]{2})$/.exec(error.code ?? '');
  const status = custom ? Number(custom[1]) : error.code === '42501' ? 403 : error.code === '23505' ? 409 : 400;
  return json(status, { code: error.code, message: error.message, details: error.detail ?? null, hint: error.hint ?? null });
}

// Argumentos de entrada de todas las sobrecargas publicas con ese nombre: tipo por nombre.
const SIGNATURE_SQL = `
  select coalesce(bool_or(p.proretset), false) as set,
         coalesce(bool_or(p.prorettype = 'pg_catalog.void'::regtype), false) as void,
         coalesce(jsonb_object_agg(a.name, format_type(a.type, null)) filter (where a.name is not null and a.name <> ''), '{}'::jsonb) as types
    from pg_proc p
    left join lateral unnest(
      p.proargnames,
      coalesce(p.proallargtypes, p.proargtypes::oid[]),
      coalesce(p.proargmodes, array_fill('i'::"char", array[coalesce(cardinality(p.proargnames), 0)]))
    ) as a(name, type, mode) on a.mode in ('i', 'b', 'v')
   where p.pronamespace = 'public'::regnamespace and p.proname = $1`;

function toParam(value, type) {
  if (value === null || value === undefined) return null;
  if (type === 'json' || type === 'jsonb') return JSON.stringify(value);
  if (type?.endsWith('[]') && Array.isArray(value)) return value;
  return typeof value === 'object' ? JSON.stringify(value) : String(value);
}

export function createSupabaseShim(connect, { claims = { role: 'service_role' }, url = 'http://supabase-shim.invalid', calls = [], label = claims.role } = {}) {
  const objects = new Map();

  async function withRole(work) {
    const client = await connect();
    try {
      await client.query('begin');
      await client.query(`set local role ${claims.role}`);
      await client.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify(claims)]);
      const value = await work(client);
      await client.query('commit');
      return value;
    } catch (error) {
      await client.query('rollback').catch(() => {});
      throw error;
    } finally {
      await client.end().catch(() => {});
    }
  }

  async function rpc(name, body) {
    const keys = Object.keys(body ?? {});
    if (!IDENT.test(name) || !keys.every((key) => IDENT.test(key))) {
      calls.push({ as: label, route: `rpc/${name}`, args: keys, ok: false, code: 'PGRST100' });
      return json(400, { code: 'PGRST100', message: 'nombre invalido' });
    }
    try {
      const value = await withRole(async (client) => {
        const { rows: [meta] } = await client.query(SIGNATURE_SQL, [name]);
        const args = keys.map((key, index) => `${key} => $${index + 1}`).join(', ');
        const params = keys.map((key) => toParam(body[key], meta.types[key]));
        if (meta.void) {
          await client.query(`select public.${name}(${args})`, params);
          return null;
        }
        const sql = meta.set
          ? `select coalesce(jsonb_agg(to_jsonb(r)), '[]'::jsonb) as v from public.${name}(${args}) r`
          : `select to_jsonb(public.${name}(${args})) as v`;
        return (await client.query(sql, params)).rows[0]?.v ?? null;
      });
      calls.push({ as: label, route: `rpc/${name}`, args: keys, ok: true });
      return json(200, value);
    } catch (error) {
      calls.push({ as: label, route: `rpc/${name}`, args: keys, ok: false, code: error.code });
      return postgrestError(error);
    }
  }

  async function readDocuments(search) {
    const select = search.get('select') ?? '*';
    const id = /^eq\.([0-9a-f-]{36})$/.exec(search.get('id') ?? '')?.[1];
    if (!id || [...search.keys()].some((key) => !['select', 'id'].includes(key))) return json(400, { code: 'PGRST100', message: `filtro no emulado: ${search}` });
    let projection;
    if (select === '*,fiscal_document_items(*)') {
      projection = `to_jsonb(d) || jsonb_build_object('fiscal_document_items', coalesce((select jsonb_agg(to_jsonb(i) order by i.id) from public.fiscal_document_items i where i.fiscal_document_id = d.id), '[]'::jsonb))`;
    } else {
      const columns = select.split(',');
      if (!columns.every((column) => IDENT.test(column))) return json(400, { code: 'PGRST100', message: `select no emulado: ${select}` });
      projection = `jsonb_build_object(${columns.map((column) => `'${column}', d.${column}`).join(', ')})`;
    }
    try {
      const value = await withRole(async (client) => (await client.query(
        `select coalesce(jsonb_agg(${projection}), '[]'::jsonb) as v from public.fiscal_documents d where d.id = $1`, [id])).rows[0].v);
      calls.push({ as: label, route: 'rest/fiscal_documents', ok: true });
      return json(200, value);
    } catch (error) {
      calls.push({ as: label, route: 'rest/fiscal_documents', ok: false, code: error.code });
      return postgrestError(error);
    }
  }

  async function fetchImpl(input, init = {}) {
    const target = new URL(String(input));
    const method = String(init.method || 'GET').toUpperCase();
    const headers = new Headers(init.headers);
    if (!headers.get('authorization')?.startsWith('Bearer ') || !headers.get('apikey')) return json(401, { message: 'sin credencial' });
    if (method === 'POST' && target.pathname.startsWith('/rest/v1/rpc/')) {
      return rpc(target.pathname.slice('/rest/v1/rpc/'.length), init.body ? JSON.parse(String(init.body)) : {});
    }
    if (method === 'GET' && target.pathname === '/rest/v1/fiscal_documents') return readDocuments(target.searchParams);
    const objectPrefix = '/storage/v1/object/fiscal-documents/';
    if (target.pathname.startsWith(objectPrefix)) {
      const key = decodeURIComponent(target.pathname.slice(objectPrefix.length));
      if (method === 'POST') {
        if (objects.has(key)) return json(409, { message: 'The resource already exists' });
        objects.set(key, new Uint8Array(await new Response(init.body).arrayBuffer()));
        calls.push({ as: label, route: 'storage/put', ok: true });
        return json(200, { Key: `fiscal-documents/${key}` });
      }
      if (method === 'GET') return objects.has(key) ? new Response(objects.get(key), { status: 200 }) : json(404, { message: 'Object not found' });
    }
    calls.push({ as: label, route: `${method} ${target.pathname}`, ok: false, code: 'NOT_EMULATED' });
    return json(404, { message: `ruta no emulada: ${method} ${target.pathname}` });
  }

  // Misma forma que supabase-js: { data, error, status }.
  function rpcClient() {
    return {
      async rpc(name, args = {}) {
        const response = await rpc(name, args);
        const body = await response.json();
        return response.ok ? { data: body, error: null, status: response.status } : { data: null, error: body, status: response.status };
      },
      from() { throw new Error('el shim solo emula RPC para clientes de La Taba'); },
    };
  }

  return { url, serviceRole: 'service-role-de-prueba', fetch: fetchImpl, objects, calls, rpcClient };
}
