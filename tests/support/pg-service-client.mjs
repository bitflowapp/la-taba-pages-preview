// A supabase-js-shaped service client over a disposable local PostgreSQL (rpc + a small query builder).
// It exists so the REAL Edge Function code can be exercised against the REAL SQL functions. It refuses any database
// that is not a taba_local_* cluster on loopback.
import { psqlRaw } from '../../scripts/local-db/lib.mjs';

const lit = value => `'${String(value).replaceAll("'", "''")}'`;
const ident = name => {
  if (!/^[a-z_][a-z0-9_]*$/.test(name)) throw new Error('bad identifier ' + name);
  return name;
};

function parseError(stderr) {
  const text = String(stderr || '');
  const verbose = /ERROR:\s+([0-9A-Z]{5}):\s+([^\r\n]*)/.exec(text);
  return { code: verbose?.[1] || 'XX000', message: verbose?.[2] || text.slice(0, 300) };
}

export function createPgServiceClient(db) {
  const signatures = new Map();
  const run = (sql) => {
    const r = psqlRaw(db, `\\set VERBOSITY verbose\n${sql}`, { tuples: true, check: false, timeout: 120000 });
    if (r.status !== 0) return { error: parseError(r.stderr), data: null };
    const line = r.stdout.split('\n').map(s => s.replace(/\r$/, '')).filter(Boolean).pop();
    return { data: line === undefined || line === '' ? null : JSON.parse(line), error: null };
  };
  const signatureOf = name => {
    if (signatures.has(name)) return signatures.get(name);
    const { data } = run(`select coalesce(jsonb_agg(jsonb_build_object('names',to_jsonb(p.proargnames),'types',(select jsonb_agg(format_type(t,null)) from unnest(string_to_array(p.proargtypes::text,' ')::oid[]) t),'set',p.proretset,'ret',format_type(p.prorettype,null))),'[]'::jsonb) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname=${lit(name)}`);
    if (!data?.length) throw new Error('unknown rpc ' + name);
    signatures.set(name, data);
    return data;
  };
  return {
    async rpc(name, args = {}) {
      const candidates = signatureOf(name).filter(sig => Object.keys(args).every(k => (sig.names || []).includes(k)));
      const sig = candidates.sort((a, b) => (a.names || []).length - (b.names || []).length)[0];
      if (!sig) return { data: null, error: { code: '42883', message: 'no matching function ' + name } };
      const names = sig.names || [];
      const parts = [];
      names.forEach((argName, i) => {
        if (!(argName in args)) return;
        const value = args[argName];
        const type = sig.types[i];
        if (value === null || value === undefined) parts.push(`${argName} => null::${type}`);
        else if (type === 'jsonb' || type === 'json') parts.push(`${argName} => ${lit(JSON.stringify(value))}::${type}`);
        else parts.push(`${argName} => ${lit(value)}::${type}`);
      });
      const call = `public.${ident(name)}(${parts.join(', ')})`;
      const sql = sig.set || sig.ret === 'record'
        ? `select coalesce(jsonb_agg(to_jsonb(t)),'[]'::jsonb) from ${call} t`
        : sig.ret === 'void' ? `select null from ${call}` : `select to_jsonb(${call})`;
      const { data, error } = run(sql);
      return { data: sig.ret === 'void' ? null : data, error };
    },
    from(table) {
      const filters = [];
      let columns = '*';
      let max = null;
      const builder = {
        select(cols = '*') { columns = cols; return builder; },
        eq(col, value) { filters.push(`${ident(col)} = ${lit(value)}`); return builder; },
        lt(col, value) { filters.push(`${ident(col)} < ${lit(value)}`); return builder; },
        not(col, op, value) {
          if (op !== 'is') throw new Error('unsupported not()');
          filters.push(`${ident(col)} is not ${value === null ? 'null' : lit(value)}`);
          return builder;
        },
        limit(n) { max = Number(n); return builder; },
        _exec() {
          const cols = columns === '*' ? '*' : columns.split(',').map(c => ident(c.trim())).join(', ');
          return run(`select coalesce(jsonb_agg(to_jsonb(t)),'[]'::jsonb) from (select ${cols} from public.${ident(table)}${filters.length ? ' where ' + filters.join(' and ') : ''}${max ? ' limit ' + max : ''}) t`);
        },
        async maybeSingle() { const r = builder._exec(); return r.error ? r : { data: r.data[0] ?? null, error: null }; },
        async single() { const r = builder._exec(); return r.error ? r : r.data[0] ? { data: r.data[0], error: null } : { data: null, error: { code: 'PGRST116', message: 'no rows' } }; },
        then(resolve, reject) { try { resolve(builder._exec()); } catch (error) { reject(error); } },
      };
      return builder;
    },
  };
}
