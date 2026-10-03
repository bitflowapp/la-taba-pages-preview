#!/usr/bin/env node
// La frontera de la API: una negativa de negocio (55000) y un «no existe» (P0002) no contestan HTTP 500.
//
// QUÉ HACE
//   Lee las definiciones VIVAS de una base LOCAL con todas las migraciones aplicadas, elige las funciones de
//   entrada que pueden terminar en un RAISE de 55000 o de P0002 (regla de selección de abajo) y escribe la
//   migración que envuelve el cuerpo de cada una, letra por letra, en un bloque con UN manejador, más la
//   reversión que devuelve los cuerpos anteriores exactos.
//
//   El manejador convierte el error SÓLO si la llamada entra por la API (`request.method` puesto por PostgREST)
//   y esta función es el marco PL/pgSQL más externo (el contexto tiene una sola línea). Convertir = `raise
//   sqlstate 'PGRST'` con el mismo cuerpo (code, message, details, hint) y el estado de la política: 409 para
//   55000, 404 para P0002. En cualquier otro caso re-lanza el error original sin tocarlo: pgTAP, cron, los
//   arneses y las funciones PL/pgSQL que atrapan 55000 ven exactamente lo mismo que antes.
//
// REGLA DE SELECCIÓN
//   ENTRADA = función de `public`, no de trigger, que anon, authenticated o service_role pueden ejecutar.
//   Se envuelve toda entrada PL/pgSQL que puede llegar a un RAISE de 55000 o de P0002: en su propio cuerpo, en
//   una función que llama (transitivamente, por nombre) o en un trigger de una tabla que escribe; más
//   `public.guard_business_currency_code` (trigger de una tabla que los clientes escriben por PATCH directo).
//   Quedan afuera, por dueño, las líneas de docs/ecommerce-hardening/http-contract.json (`excluded`).
//   «Llega a un RAISE» incluye `select ... into strict` (P0002 implícito) y los nombres de condición
//   `no_data_found` y `object_not_in_prerequisite_state`.
//
// USO (sólo contra una base local)
//   node scripts/db/wrap-api-boundary.mjs --database postgres://postgres@127.0.0.1:55521/<base> \
//     --version 20261002090000 --name api_boundary_answers_refusals_as_4xx \
//     [--migration <archivo>] [--rollback <archivo>] [--report <archivo.json>]
//   Sin --migration/--rollback imprime el informe de selección y no escribe nada.
//
// IDEMPOTENTE: una función que ya tiene el marcador (MARKER) no se envuelve de nuevo. Se NIEGA (y dice por qué)
// a envolver un cuerpo que no sabe tratar en vez de adivinar; en ese caso no escribe ningún archivo.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
export const CONTRACT_FILE = path.join(ROOT, 'docs', 'ecommerce-hardening', 'http-contract.json');
export const MARKER = 'la-taba:api-boundary v1';
export const BOUNDARY_STATUS = Object.freeze({ 55000: 409, P0002: 404 });
export const EXTRA_TRIGGER_FUNCTIONS = Object.freeze(['public.guard_business_currency_code']);

export class WrapRefusal extends Error {
  constructor(code, reason) {
    super(`${code}: ${reason}`);
    this.code = code;
    this.reason = reason;
  }
}

// ── Partes puras ────────────────────────────────────────────────────────────────────────────────────────────
export const stripLineComments = (src) => String(src).replace(/--[^\n]*/g, '');

// La parte DIRECTA de la regla: el propio cuerpo levanta (o puede levantar) 55000 o P0002. La misma expresión
// está en supabase/tests/http_error_contract_test.sql (prueba estructural).
export const DIRECT_RAISE = /'(55000|P0002)'|\b(object_not_in_prerequisite_state|no_data_found)\b|\binto\s+strict\b/i;
export const raisesDirectly = (src) => DIRECT_RAISE.test(stripLineComments(src));

const IDENT = '[A-Za-z_][A-Za-z0-9_$]*';
const LEADING_GAP = /^(?:\s+|--[^\n]*(?:\n|$)|\/\*[\s\S]*?\*\/)/;

// Separa las líneas `#option` del principio (con los blancos y comentarios que las preceden) del resto.
function splitCompilerOptions(src) {
  let index = 0;
  let headEnd = 0;
  for (;;) {
    const rest = src.slice(index);
    const gap = LEADING_GAP.exec(rest);
    if (gap && gap[0].length) { index += gap[0].length; continue; }
    if (rest.startsWith('#')) {
      const newline = rest.indexOf('\n');
      index += newline === -1 ? rest.length : newline + 1;
      headEnd = index;
      continue;
    }
    break;
  }
  return { head: src.slice(0, headEnd), rest: src.slice(headEnd), firstToken: src.slice(index) };
}

// Envuelve un cuerpo PL/pgSQL. Devuelve { body, alreadyWrapped }. El cuerpo original queda letra por letra
// (retornos de carro incluidos) como bloque anidado; sólo se le agrega el `;` final si no lo tenía.
export function wrapBody(src) {
  if (typeof src !== 'string' || !src.trim()) throw new WrapRefusal('EMPTY_BODY', 'the body is empty');
  if (src.includes(MARKER)) return { body: src, alreadyWrapped: true };
  if (/(^|[^A-Za-z0-9_$])_api_/i.test(src)) {
    throw new WrapRefusal('IDENTIFIER_COLLISION', 'the body already uses an identifier that starts with _api_');
  }
  const { head, rest, firstToken } = splitCompilerOptions(src);
  if (!new RegExp(`^(<<\\s*${IDENT}\\s*>>|declare\\b|begin\\b)`, 'i').test(firstToken)) {
    throw new WrapRefusal('UNEXPECTED_START', `the body does not start with a block (<<label>>, DECLARE or BEGIN): «${firstToken.slice(0, 40)}»`);
  }
  const trimmed = rest.replace(/\s+$/, '');
  if (/(--[^\n]*|\*\/)$/.test(trimmed)) {
    throw new WrapRefusal('TRAILING_COMMENT', `a comment follows the final END: «${trimmed.slice(-40)}»`);
  }
  let block;
  if (new RegExp(`\\bend(\\s+${IDENT})?\\s*;$`, 'i').test(trimmed)) block = trimmed;
  else if (new RegExp(`\\bend(\\s+${IDENT})?$`, 'i').test(trimmed)) block = `${trimmed};`;
  else throw new WrapRefusal('UNEXPECTED_END', `the body does not end with END [label] [;] (a trailing comment?): «${trimmed.slice(-40)}»`);
  const body = [
    head.replace(/\s+$/, ''),
    'declare',
    `  -- ${MARKER}: 55000 -> 409 y P0002 -> 404 sólo por la API (request.method) y sólo en el marco más externo.`,
    '  -- El cuerpo de la función es el bloque anidado, letra por letra. Generado por scripts/db/wrap-api-boundary.mjs.',
    '  _api_state text;',
    '  _api_message text;',
    '  _api_detail text;',
    '  _api_hint text;',
    '  _api_context text;',
    'begin',
    block,
    'exception',
    "  when sqlstate '55000' or sqlstate 'P0002' then",
    '    get stacked diagnostics _api_state = returned_sqlstate, _api_message = message_text,',
    '                            _api_detail = pg_exception_detail, _api_hint = pg_exception_hint;',
    '    get diagnostics _api_context = pg_context;',
    "    if nullif(pg_catalog.current_setting('request.method', true), '') is not null",
    "       and pg_catalog.array_length(pg_catalog.string_to_array(_api_context, E'\\n'), 1) = 1 then",
    "      raise sqlstate 'PGRST' using",
    "        message = pg_catalog.json_build_object('code', _api_state, 'message', _api_message,",
    "                                               'details', nullif(_api_detail, ''), 'hint', nullif(_api_hint, ''))::text,",
    "        detail = pg_catalog.json_build_object('status', case _api_state when 'P0002' then 404 else 409 end,",
    "                                              'headers', pg_catalog.json_build_object())::text;",
    '    end if;',
    '    raise;',
    'end;',
    '',
  ].filter((line, index) => index !== 0 || line !== '').join('\n');
  return { body: head.trim() ? body : `\n${body}`, alreadyWrapped: false };
}

// pg_get_functiondef = encabezado + 'AS ' + tag + prosrc + tag + '\n'. Devuelve el encabezado tal cual.
export function splitFunctionDef(def, prosrc) {
  const match = /\nAS (\$[A-Za-z0-9_]*\$)/.exec(def);
  if (!match) throw new WrapRefusal('UNPARSEABLE_FUNCTIONDEF', 'no AS $tag$ in pg_get_functiondef');
  const header = def.slice(0, match.index + 1);
  const tag = match[1];
  if (def !== `${header}AS ${tag}${prosrc}${tag}\n`) throw new WrapRefusal('UNPARSEABLE_FUNCTIONDEF', 'pg_get_functiondef does not end with the body');
  return { header, tag };
}

export const dollarTagFor = (body) => {
  for (const tag of ['$function$', '$api_function$', '$api_boundary_function$']) if (!body.includes(tag)) return tag;
  throw new WrapRefusal('NO_DOLLAR_TAG', 'every candidate dollar tag appears in the body');
};
export const bodyMd5 = (body) => crypto.createHash('md5').update(String(body).replace(/\r/g, ''), 'utf8').digest('hex');

// Exclusiones: grupos con patrones `nombre` o `prefijo_*` (`*` = cualquier texto).
export function exclusionMatcher(groups) {
  const compiled = groups.flatMap((group) => group.patterns.map((pattern) => ({
    group: group.group,
    pattern,
    regex: new RegExp(`^${pattern.split('*').map((part) => part.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('.*')}$`),
  })));
  return (name) => compiled.find((entry) => entry.regex.test(name)) || null;
}
export const excludedPatterns = (contract) => contract.excluded.flatMap((group) => group.patterns).sort();

// La regla de selección sobre las filas leídas de la base (ver readCatalog).
export function selectFunctions({ fns, triggers, contract }) {
  const excluded = exclusionMatcher(contract.excluded);
  const byName = new Map();
  for (const f of fns) {
    f.code = stripLineComments(f.src);
    if (!byName.has(f.name)) byName.set(f.name, []);
    byName.get(f.name).push(f);
  }
  const byOid = new Map(fns.map((f) => [f.oid, f]));
  const tableTriggers = new Map();
  for (const t of triggers) {
    if (!tableTriggers.has(t.tbl)) tableTriggers.set(t.tbl, new Set());
    tableTriggers.get(t.tbl).add(t.fn);
  }
  const names = [...byName.keys()];
  for (const f of fns) {
    f.calls = new Set();
    for (const name of names) {
      if (name === f.name) continue;
      if (!f.code.includes(name)) continue;
      if (new RegExp(`(^|[^A-Za-z0-9_$])${name}\\s*\\(`, 'i').test(f.code)) for (const g of byName.get(name)) f.calls.add(g.oid);
    }
    for (const [tbl, set] of tableTriggers) {
      if (!f.code.includes(tbl)) continue;
      if (new RegExp(`(insert\\s+into|update|delete\\s+from|merge\\s+into)\\s+(only\\s+)?(public\\.)?"?${tbl}"?(?![A-Za-z0-9_$])`, 'i').test(f.code)) {
        for (const oid of set) f.calls.add(oid);
      }
    }
  }
  const reach = new Map();
  const visit = (f, stack) => {
    if (reach.has(f.oid)) return reach.get(f.oid);
    if (raisesDirectly(f.src)) { reach.set(f.oid, true); return true; }
    if (stack.has(f.oid)) return false;
    stack.add(f.oid);
    let result = false;
    for (const oid of f.calls) { const g = byOid.get(oid); if (g && visit(g, stack)) { result = true; break; } }
    stack.delete(f.oid);
    if (result || stack.size === 0) reach.set(f.oid, result);
    return result;
  };
  for (const f of fns) visit(f, new Set());
  const isEntry = (f) => f.schema === 'public' && !f.is_trigger && (f.anon_x || f.auth_x || f.svc_x);
  const label = (f) => `${f.schema}.${f.name}(${f.args})`;
  const reaching = fns.filter((f) => isEntry(f) && reach.get(f.oid));
  const selected = [];
  const excludedReaching = {};
  const sqlReaching = [];
  for (const f of reaching) {
    const exclusion = excluded(f.name);
    if (exclusion) { (excludedReaching[exclusion.group] ||= []).push(label(f)); continue; }
    if (f.lang !== 'plpgsql') { sqlReaching.push({ fn: label(f), lang: f.lang, security_definer: f.secdef, set_clauses: Boolean(f.has_config), client: f.anon_x || f.auth_x }); continue; }
    selected.push(f);
  }
  for (const signature of EXTRA_TRIGGER_FUNCTIONS) {
    const [schema, name] = signature.split('.');
    const f = fns.find((g) => g.schema === schema && g.name === name && g.is_trigger);
    if (!f) throw new WrapRefusal('MISSING_TRIGGER_FUNCTION', `${signature} does not exist`);
    if (f.lang !== 'plpgsql') throw new WrapRefusal('NOT_PLPGSQL', `${signature} is not PL/pgSQL`);
    if (!selected.includes(f)) selected.push(f);
  }
  selected.sort((a, b) => label(a).localeCompare(label(b)));
  return { selected, excludedReaching, sqlReaching, reaching, isEntry, label };
}

// ── Base de datos (sólo local) ────────────────────────────────────────────────────────────────────────────
export function assertLocal(url) {
  const host = new URL(url).hostname;
  if (!['127.0.0.1', 'localhost', '::1', '[::1]'].includes(host)) throw new Error(`LOCAL_ONLY: refusing host ${host}`);
}

export async function readCatalog(client) {
  const fns = (await client.query(`
    select p.oid::int as oid, n.nspname as schema, p.proname as name, l.lanname as lang, p.prosrc as src,
           p.prorettype = 'pg_catalog.trigger'::pg_catalog.regtype as is_trigger, p.prosecdef as secdef,
           p.proconfig is not null as has_config,
           has_function_privilege('anon', p.oid, 'execute') as anon_x,
           has_function_privilege('authenticated', p.oid, 'execute') as auth_x,
           has_function_privilege('service_role', p.oid, 'execute') as svc_x,
           pg_get_function_identity_arguments(p.oid) as args, p.oid::regprocedure::text as signature,
           coalesce(p.proargnames, '{}') as argnames
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace join pg_language l on l.oid = p.prolang
     where n.nspname not in ('pg_catalog', 'information_schema', 'pg_toast', 'cron', 'extensions', 'vault', 'auth', 'storage', 'net')
       and n.nspname not like 'pg\\_%' and p.prokind = 'f' and l.lanname in ('plpgsql', 'sql')
       and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e')`)).rows;
  const triggers = (await client.query(`
    select c.relname as tbl, p.oid::int as fn
      from pg_trigger t join pg_class c on c.oid = t.tgrelid join pg_namespace n on n.oid = c.relnamespace
      join pg_proc p on p.oid = t.tgfoid
     where not t.tgisinternal and n.nspname = 'public'`)).rows;
  return { fns, triggers };
}

async function functionDef(client, oid) {
  return (await client.query('select pg_get_functiondef($1::oid) as def', [oid])).rows[0].def;
}

// Usos por fila: políticas y vistas que nombran una función elegida (cada llamada envuelta abre una subtransacción).
async function perRowUses(client, names) {
  if (!names.length) return [];
  const rows = (await client.query(`
    select 'policy ' || schemaname || '.' || tablename || '.' || policyname as object,
           coalesce(qual, '') || ' ' || coalesce(with_check, '') as text
      from pg_policies
    union all
    select 'view ' || schemaname || '.' || viewname, definition from pg_views
     where schemaname not in ('pg_catalog', 'information_schema')`)).rows;
  const hits = [];
  for (const row of rows) for (const name of names) if (new RegExp(`(^|[^A-Za-z0-9_$])${name}\\s*\\(`, 'i').test(row.text)) hits.push(`${row.object} -> ${name}`);
  return hits;
}

// ── Textos de la migración y de la reversión ─────────────────────────────────────────────────────────────
export function renderMigration({ version, name, items, stats }) {
  const lines = [
    `-- TABA · LA FRONTERA DE LA API CONTESTA UNA NEGATIVA DE NEGOCIO CON 409 Y UN «NO EXISTE» CON 404`,
    '--',
    '-- QUÉ ESTABA ROTO (certificador e-commerce contra un PostgREST 14.5 real; hallazgo API-01 y defecto C-2)',
    '--',
    '--   PostgREST traduce el SQLSTATE a un estado HTTP con una tabla fija. La base usa 55000 para «esto no se',
    '--   puede hacer en el estado en que están las cosas» (comercio cerrado, fuera de zona, producto no',
    '--   disponible, pedido ya cerrado, exigencia bloqueada...) y P0002 para «no existe». PostgREST contesta',
    '--   HTTP 500 a los dos (clase 55 y clase P0 salvo P0001): una negativa normal parecía una caída, los',
    '--   clientes que deciden por el estado la reintentaban y el monitoreo de 5xx era ruido.',
    '--',
    '-- QUÉ CAMBIA',
    '--',
    `--   ${items.length} funciones de entrada (las elige scripts/db/wrap-api-boundary.mjs con la regla escrita en`,
    '--   docs/ecommerce-hardening/http-contract.md) llevan su cuerpo, letra por letra, como bloque anidado dentro',
    `--   de un bloque con UN manejador para 55000 y P0002 (marcador «${MARKER}»). El manejador convierte`,
    "--   SÓLO si la llamada entra por la API (request.method) y la función es el marco PL/pgSQL más externo:",
    "--   raise sqlstate 'PGRST' con el MISMO cuerpo (code, message, details, hint) y el estado 409 (55000) o",
    '--   404 (P0002). En cualquier otro caso re-lanza el error original sin tocarlo.',
    '--',
    '-- QUÉ NO CAMBIA',
    '--',
    '--   · Lo que hace cada función: el cuerpo es el vigente, generado de la definición viva.',
    '--   · El cuerpo de la respuesta: el mismo code, message, details y hint. Sólo cambia el estado HTTP.',
    '--   · Llamadas sin request.method (pgTAP, cron, arneses, migraciones): el SQLSTATE original, como antes.',
    '--   · Una función PL/pgSQL que llama a otra y atrapa 55000 o P0002 los sigue atrapando (la de adentro no es',
    '--     el marco más externo y re-lanza el original).',
    '--   · Firma, tipo de retorno, lenguaje, SECURITY, volatilidad, STRICT, search_path y demás SET, dueño,',
    '--     permisos y comentario: CREATE OR REPLACE con el encabezado que imprime pg_get_functiondef; no se',
    '--     reescribe ningún permiso.',
    `--   · Quedan afuera, por dueño, ${stats.excluded_reaching} entradas de otras líneas (Caja/POS, fiscal, agente de impresión y los seis`,
    '--     cobros heredados que retira el contrato A1-A4): siguen contestando 500 para estos códigos. Ver',
    '--     docs/ecommerce-hardening/http-contract.json.',
    '--',
    '-- Se niega a correr si alguna función ya no tiene el cuerpo del que se generó (ni el envuelto): otra',
    '-- migración la redefinió y esta la pisaría; regenerar con el script.',
    '--',
    '-- Costo: una subtransacción por llamada a una función envuelta (ninguna se usa por fila en una política o',
    '-- una vista; ver el informe del generador).',
    '--',
    `-- Forward-only. No toca filas. Reversión: docs/migrations/rollback/${version}_${name}.rollback.sql`,
    '',
    'do $guard$',
    'declare',
    '  v_row record;',
    '  v_actual text;',
    'begin',
    '  for v_row in',
    '    select * from (values',
    items.map((item) => `      ('${item.signature}', '${item.previousMd5}', '${item.appliedMd5}')`).join(',\n'),
    '    ) as t(signature, previous, applied)',
    '  loop',
    "    select md5(replace(p.prosrc, E'\\r', '')) into v_actual",
    '      from pg_proc p where p.oid = to_regprocedure(v_row.signature);',
    '    if v_actual is null or v_actual not in (v_row.previous, v_row.applied) then',
    `      raise exception 'ROLLOUT_BLOCKED: % no tiene el cuerpo del que se genero ${version}; otra migracion la redefinio: regenerar con scripts/db/wrap-api-boundary.mjs', v_row.signature`,
    "        using errcode = 'P0001';",
    '    end if;',
    '  end loop;',
    'end',
    '$guard$;',
    '',
  ];
  for (const item of items) lines.push(`${item.newDef};`, '');
  return lines.join('\n');
}

export function renderRollback({ version, name, items }) {
  const lines = [
    `-- REVERSIÓN de ${version}_${name}.sql`,
    '--',
    `-- Devuelve las ${items.length} funciones envueltas a su cuerpo anterior (capturado con pg_get_functiondef`,
    '-- sobre la base sin esta migración por scripts/db/wrap-api-boundary.mjs; no se reescribió a mano).',
    '--',
    '-- Qué vuelve a quedar abierto: por la API, una negativa de negocio (55000) y un «no existe» (P0002)',
    '-- vuelven a contestar HTTP 500 (API-01, C-2). El cuerpo de la respuesta es el mismo.',
    '--',
    '-- No pierde datos: la migración no creó tablas, columnas ni filas, ni tocó permisos.',
    '--',
    '-- Se niega a correr si alguna función ya no tiene ni el cuerpo que dejó la migración ni el anterior: otra',
    '-- migración la redefinió después y revertir ésta la pisaría.',
    '--',
    `-- No toca supabase_migrations.schema_migrations. Después:`,
    `--   supabase migration repair --status reverted ${version}`,
    'begin;',
    '',
    'select pg_catalog.pg_advisory_xact_lock(',
    `  pg_catalog.hashtextextended('la-taba:rollback:${version}', 0)`,
    ');',
    '',
    'do $guard$',
    'declare',
    '  v_row record;',
    '  v_actual text;',
    'begin',
    '  for v_row in',
    '    select * from (values',
    items.map((item) => `      ('${item.signature}', '${item.appliedMd5}', '${item.previousMd5}')`).join(',\n'),
    '    ) as t(signature, applied, previous)',
    '  loop',
    "    select md5(replace(p.prosrc, E'\\r', '')) into v_actual",
    '      from pg_proc p where p.oid = to_regprocedure(v_row.signature);',
    '    if v_actual is null or v_actual not in (v_row.applied, v_row.previous) then',
    `      raise exception 'ROLLBACK_BLOCKED: % no tiene el cuerpo de ${version} ni el anterior; otra migracion la redefinio despues: revertir esa primero', v_row.signature`,
    "        using errcode = 'P0001';",
    '    end if;',
    '  end loop;',
    'end',
    '$guard$;',
    '',
  ];
  for (const item of items) lines.push(`${item.previousDef.replace(/\n$/, '')};`, '');
  lines.push('commit;', '');
  return lines.join('\n');
}

// ── CLI ──────────────────────────────────────────────────────────────────────────────────────────────────
function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 1) {
    if (!argv[i].startsWith('--')) throw new Error(`unexpected argument ${argv[i]}`);
    out[argv[i].slice(2)] = argv[i + 1];
    i += 1;
  }
  return out;
}

export async function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  if (!args.database) throw new Error('usage: --database <local postgres url> [--version V --name N --migration F --rollback F] [--report F]');
  assertLocal(args.database);
  const contract = JSON.parse(fs.readFileSync(CONTRACT_FILE, 'utf8'));
  const { default: pg } = await import('pg');
  const client = new pg.Client({ connectionString: args.database });
  await client.connect();
  try {
    // Con search_path = pg_catalog, regprocedure y pg_get_functiondef califican el esquema de todo lo que no es
    // del catálogo: la migración no depende del search_path con que se aplique.
    await client.query('set search_path to pg_catalog');
    const { fns, triggers } = await readCatalog(client);
    const selection = selectFunctions({ fns, triggers, contract });
    const items = [];
    const refusals = [];
    let alreadyWrapped = 0;
    for (const f of selection.selected) {
      try {
        if (f.argnames.some((argName) => /^_api_/i.test(argName))) throw new WrapRefusal('IDENTIFIER_COLLISION', 'a parameter starts with _api_');
        const wrapped = wrapBody(f.src);
        if (wrapped.alreadyWrapped) { alreadyWrapped += 1; continue; }
        const previousDef = await functionDef(client, f.oid);
        const { header } = splitFunctionDef(previousDef, f.src);
        const tag = dollarTagFor(wrapped.body);
        items.push({
          signature: f.signature,
          label: selection.label(f),
          client: f.anon_x || f.auth_x,
          previousDef,
          previousMd5: bodyMd5(f.src),
          appliedMd5: bodyMd5(wrapped.body),
          newDef: `${header}AS ${tag}${wrapped.body}${tag}`,
        });
      } catch (error) {
        if (!(error instanceof WrapRefusal)) throw error;
        refusals.push({ fn: selection.label(f), code: error.code, reason: error.reason });
      }
    }
    const report = {
      database: new URL(args.database).pathname.slice(1),
      functions_scanned: fns.length,
      entries: fns.filter(selection.isEntry).length,
      entries_reaching: selection.reaching.length,
      selected: selection.selected.length,
      selected_client: selection.selected.filter((f) => f.anon_x || f.auth_x).length,
      selected_service_only: selection.selected.filter((f) => !(f.anon_x || f.auth_x) && !f.is_trigger).length,
      selected_trigger: selection.selected.filter((f) => f.is_trigger).map(selection.label),
      already_wrapped: alreadyWrapped,
      to_wrap: items.length,
      refusals,
      excluded_reaching: selection.excludedReaching,
      excluded_reaching_count: Object.values(selection.excludedReaching).reduce((n, list) => n + list.length, 0),
      sql_language_reaching: selection.sqlReaching,
      per_row_uses: await perRowUses(client, [...new Set(selection.selected.map((f) => f.name))]),
      selected_functions: selection.selected.map((f) => `${f.is_trigger ? 'trigger' : f.anon_x || f.auth_x ? 'client ' : 'service'} ${selection.label(f)}`),
    };
    if (args.report) fs.writeFileSync(args.report, `${JSON.stringify(report, null, 2)}\n`);
    else console.log(JSON.stringify({ ...report, selected_functions: undefined }, null, 2));
    if (refusals.length) {
      console.error(`WRAP_REFUSED ${refusals.length}: nothing written`);
      for (const refusal of refusals) console.error(`  ${refusal.fn}: ${refusal.code} ${refusal.reason}`);
      process.exitCode = 1;
      return report;
    }
    if (args.migration || args.rollback) {
      if (!args.version || !args.name) throw new Error('--version and --name are required to write files');
      if (!items.length) { console.error('NOTHING_TO_WRAP: every selected function already carries the marker'); return report; }
      const stats = { excluded_reaching: report.excluded_reaching_count };
      if (args.migration) fs.writeFileSync(args.migration, renderMigration({ version: args.version, name: args.name, items, stats }));
      if (args.rollback) fs.writeFileSync(args.rollback, renderRollback({ version: args.version, name: args.name, items }));
      console.error(`WRAPPED ${items.length} (already wrapped: ${alreadyWrapped})`);
    }
    return report;
  } finally {
    await client.end();
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => { console.error(error.message); process.exit(1); });
}
