// Sonda de salud de produccion. SOLO LECTURA.
//
// Responde las siete preguntas del dia 1 sin abrir un panel:
//
//   1. la base esta viva y es la que creemos
//   2. el ledger de migrations es el esperado
//   3. el scheduler late
//   4. los cuatro cron siguen activos y ninguno falla
//   5. hay alertas operativas abiertas
//   6. cuantos datos humanos hay (prelaunch: cero)
//   7. el negocio canonico existe y con que puertas
//
// Todas las consultas son SELECT. No hay una sola escritura, ni DDL, ni
// `create extension`. Se ejecutan por la Management API, que no necesita la
// password de la base ni Docker.
//
//   $env:SUPABASE_ACCESS_TOKEN = <token del CLI>
//   node scripts/production-health-check.mjs --ref wwcpogltfgzgkrlilbcd
//
// Salida 0 = sano. 1 = algo que hay que mirar. 2 = no se pudo preguntar.

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const PRODUCTION_REF = 'wwcpogltfgzgkrlilbcd';

/*
 * EL LEDGER ESPERADO SALE DE ESTA COPIA DEL REPOSITORIO, NO DE UN NUMERO A MANO.
 *
 * Estaban escritos como literales -103 y 20260816122000- y el 2026-08-25
 * produccion tenia 114 migraciones con la ultima en 20260825160000. O sea que
 * la sonda de salud reportaba "A MIRAR" y salia con codigo 1 sobre una base
 * PERFECTAMENTE sana, once migraciones despues del ultimo que se acordo de
 * subir el numero. Una alarma que suena siempre es una alarma que nadie mira,
 * y esta es la que hay que poder correr sin pensar el fin de semana que abre
 * la tienda.
 *
 * Lo que la comprobacion quiere decir es "produccion tiene aplicado lo que
 * este checkout declara". Derivarlo del directorio dice exactamente eso y no
 * se puede quedar atras: cada migracion nueva viaja con su propia expectativa.
 */
function ledgerDelRepositorio() {
  const dir = path.join(root, 'supabase', 'migrations');
  const versiones = fs.readdirSync(dir)
    .filter((archivo) => archivo.endsWith('.sql'))
    .map((archivo) => archivo.slice(0, 14))
    .filter((version) => /^\d{14}$/.test(version))
    .sort();
  if (!versiones.length) throw new Error('no se encontro ninguna migracion en supabase/migrations');
  return { total: versiones.length, last: versiones[versiones.length - 1] };
}

const REPO_LEDGER = ledgerDelRepositorio();
const EXPECTED_LEDGER = REPO_LEDGER.total;
const EXPECTED_LAST_MIGRATION = REPO_LEDGER.last;
const CANONICAL_BUSINESS = '00000000-0000-4000-8000-000000000001';
const EXPECTED_CRON = [
  'taba-payment-outbox-worker',
  'taba-checkout-expiry-sweep',
  'taba-checkout-provider-truth-sweep',
  'taba-operational-alerts-sweep',
];

// Tablas que en prelaunch tienen que estar en cero. No es una lista de todas:
// es la lista de las que, si tienen una fila, quiere decir que alguien uso el
// sistema y nadie lo escribio.
const MUST_BE_EMPTY = [
  'orders', 'order_items', 'order_events', 'customers', 'rider_profiles',
  'rider_locations', 'rider_order_offers', 'payment_attempts', 'payment_outbox',
  'checkout_sessions', 'fiscal_documents', 'products', 'catalog_assets',
];

function arg(name) {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? undefined : process.argv[i + 1];
}

const ref = (arg('ref') || '').trim();
if (ref !== PRODUCTION_REF) {
  console.error(`--ref debe ser ${PRODUCTION_REF}; no hay default implicito`);
  process.exit(2);
}
const token = process.env.SUPABASE_ACCESS_TOKEN;
if (!token) {
  console.error('falta SUPABASE_ACCESS_TOKEN en el entorno');
  process.exit(2);
}

// El unico verbo permitido. Una consulta que no empiece con select o with no
// sale de este archivo: la sonda no puede convertirse en una via de escritura
// por un descuido de edicion.
const READ_ONLY = /^\s*(select|with)\b/i;

async function ask(sql) {
  if (!READ_ONLY.test(sql)) throw new Error('la sonda solo ejecuta SELECT');
  const res = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: sql, read_only: true }),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${res.status} ${text.slice(0, 300)}`);
  return text ? JSON.parse(text) : [];
}

const findings = [];
function check(ok, detail) { if (!ok) findings.push(detail); return ok; }

const report = { schemaVersion: 1, ref, checkedAt: new Date().toISOString() };

// 1 + 2 - identidad y ledger
const [ledger] = await ask(`
  select count(*)::int as total,
         max(version) as last_version,
         current_database() as db,
         version() as server
    from supabase_migrations.schema_migrations;
`);
report.ledger = { total: ledger.total, last: ledger.last_version, server: ledger.server };
check(ledger.total === EXPECTED_LEDGER, `ledger ${ledger.total}, esperado ${EXPECTED_LEDGER}`);
check(ledger.last_version === EXPECTED_LAST_MIGRATION,
  `ultima migration ${ledger.last_version}, esperada ${EXPECTED_LAST_MIGRATION}`);

// 3 - latido del scheduler
//
// No se llama a scheduler_heartbeat(): la Management API en modo read_only
// corre como `supabase_read_only_user`, que no es anon ni authenticated y no
// tiene EXECUTE sobre una SECURITY DEFINER. Se hace lo mismo que hace la
// funcion -leer el ultimo barrido- y ademas se comprueba por catalogo que el
// grant a anon siga en pie, que es lo que el watchdog externo necesita. Es mas
// fuerte que invocarla: verifica el dato Y el privilegio, sin depender de
// tener el rol.
const [beat] = await ask(`
  select max(started_at) as last_run_at,
         extract(epoch from (clock_timestamp() - max(started_at)))::int as age_seconds
    from public.operational_sweep_runs where scope = 'operational_alerts';
`);
const [grant] = await ask(`
  select has_function_privilege('anon', 'public.scheduler_heartbeat()', 'execute') as anon_heartbeat,
         has_function_privilege('anon', 'public.check_scheduler_watchdog(text)', 'execute') as anon_watchdog;
`);
report.heartbeat = {
  last_run_at: beat.last_run_at,
  age_seconds: beat.age_seconds,
  stale_after_seconds: 600,
  healthy: beat.age_seconds !== null && beat.age_seconds < 600,
  anonProbeGranted: grant.anon_heartbeat,
  anonWatchdogGranted: grant.anon_watchdog,
};
check(report.heartbeat.healthy,
  `scheduler no sano: age=${beat.age_seconds}s last=${beat.last_run_at}`);
check(grant.anon_heartbeat === true,
  'anon perdio EXECUTE sobre scheduler_heartbeat: el reloj externo queda ciego');
check(grant.anon_watchdog === true,
  'anon perdio EXECUTE sobre check_scheduler_watchdog: nadie abre la alerta');

// 4 - cron activos y su ultimo resultado
const cron = await ask(`
  select j.jobname, j.schedule, j.active,
         (select r.status from cron.job_run_details r
           where r.jobid = j.jobid order by r.start_time desc limit 1) as last_status,
         (select r.start_time from cron.job_run_details r
           where r.jobid = j.jobid order by r.start_time desc limit 1) as last_start
    from cron.job j where j.jobname like 'taba-%' order by j.jobname;
`);
report.cron = cron;
for (const name of EXPECTED_CRON) {
  const job = cron.find((c) => c.jobname === name);
  if (!check(Boolean(job), `falta el cron ${name}`)) continue;
  check(job.active === true, `cron ${name} inactivo`);
  check(job.last_status !== 'failed', `cron ${name} termino en ${job.last_status}`);
}
check(cron.length === EXPECTED_CRON.length,
  `hay ${cron.length} cron taba-*, esperados ${EXPECTED_CRON.length}`);

// 5 - alertas operativas abiertas
const [alerts] = await ask(`
  select count(*) filter (where resolved_at is null)::int as abiertas,
         count(*) filter (where resolved_at is null and severity = 'critical')::int as criticas
    from public.operational_alerts;
`);
report.alerts = alerts;
check(alerts.criticas === 0, `${alerts.criticas} alerta(s) CRITICAL abiertas`);

// 6 - datos humanos
const counts = await ask(`
  select 'auth_users' as tabla, count(*)::int as filas from auth.users
  union all ${MUST_BE_EMPTY.map((t) => `select '${t}', count(*)::int from public.${t}`).join(' union all ')}
  order by 1;
`);
report.dataCounts = Object.fromEntries(counts.map((c) => [c.tabla, c.filas]));
const noVacias = counts.filter((c) => c.filas > 0);
report.nonEmpty = noVacias.map((c) => `${c.tabla}=${c.filas}`);

// 7 - el negocio canonico y sus puertas
const [negocio] = await ask(`
  select id::text, name, ordering_enabled, ordering_verified,
         delivery_enabled, pickup_enabled, status
    from public.businesses where id = '${CANONICAL_BUSINESS}';
`);
report.business = negocio ?? null;
check(Boolean(negocio), `el negocio canonico ${CANONICAL_BUSINESS} no existe en produccion`);

const salida = {
  ...report,
  prelaunchOrderingClosed: negocio
    ? negocio.ordering_enabled === false && negocio.ordering_verified === false
    : null,
  findings,
  healthy: findings.length === 0,
};

// El informe se escribe SOLO si se pide.
//
// Escribirlo siempre dejaba el arbol sucio en cada corrida -el JSON lleva la
// hora- y `npm run production:verify`, que empieza exigiendo un arbol limpio y
// despues corre esta sonda, se envenenaba a si mismo: la corrida N ensuciaba lo
// que la corrida N+1 exigia limpio. Una verificacion que muta no es una
// verificacion.
const out = arg('report');
if (out) {
  fs.mkdirSync(path.dirname(path.resolve(out)), { recursive: true });
  fs.writeFileSync(out, `${JSON.stringify(salida, null, 2)}\n`);
}

console.log(`--- SALUD DE PRODUCCION (${ref}) ---`);
console.log(`  ledger            : ${report.ledger.total} - ultima ${report.ledger.last}`);
console.log(`  scheduler         : healthy=${report.heartbeat?.healthy} age=${report.heartbeat?.age_seconds}s`);
console.log(`  cron taba-*       : ${cron.map((c) => `${c.jobname}[${c.active ? 'on' : 'OFF'}/${c.last_status ?? 'sin corridas'}]`).join(' ')}`);
console.log(`  alertas abiertas  : ${alerts.abiertas} (criticas ${alerts.criticas})`);
console.log(`  tablas con filas  : ${salida.nonEmpty.length ? salida.nonEmpty.join(' ') : 'ninguna'}`);
console.log(`  negocio canonico  : ${negocio ? `${negocio.name} status=${negocio.status}` : 'AUSENTE'}`);
console.log(`  ordering          : enabled=${negocio?.ordering_enabled} verified=${negocio?.ordering_verified}`);
console.log(`  reporte           : ${out ?? '(no se pidio; --report <archivo> para escribirlo)'}`);

if (findings.length) {
  console.error('\n  A MIRAR:');
  for (const f of findings) console.error(`    ${f}`);
  process.exit(1);
}
console.log('\n  RESULTADO         : SANO');
