// Sonda de salud de produccion. SOLO LECTURA.
//
// Responde las siete preguntas del dia 1 sin abrir un panel:
//
//   1. la base esta viva y es la que creemos
//   2. el ledger de migrations es el que declara este checkout
//   3. el scheduler late
//   4. las tareas taba-* que tienen que existir estan activas y ninguna falla
//   5. hay alertas operativas CRITICAL abiertas
//   6. cuantos datos humanos hay (prelaunch: cero)
//   7. el negocio canonico existe y con que puertas
//
// Todas las consultas son SELECT. No hay una sola escritura, ni DDL, ni
// `create extension`. Se ejecutan por el endpoint de solo lectura de la
// Management API (rol `supabase_read_only_user`, transaccion de solo lectura),
// que no necesita la password de la base ni Docker.
//
//   $env:SUPABASE_ACCESS_TOKEN = <token del CLI>
//   node scripts/production-health-check.mjs --target production|controlled-production|staging
//   node scripts/production-health-check.mjs --ref wwcpogltfgzgkrlilbcd      (igual que antes)
//
// El destino se nombra siempre: no hay default implicito, y un ref que no es
// uno de los tres de abajo se rechaza.
//
// Salida 0 = sano. 1 = algo que hay que mirar. 2 = no se pudo preguntar.

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function negocioDeProduccionControlada() {
  try {
    const deploy = JSON.parse(fs.readFileSync(path.join(root, 'deploy', 'controlled-production.json'), 'utf8'));
    return deploy.supabaseProjectRef === 'tkanbadcglszlcyfjvpv' ? deploy.businessId || null : null;
  } catch {
    return null;
  }
}

/*
 * LOS TRES DESTINOS QUE ESTA SONDA SABE MIRAR.
 *
 * Estaba fijada a la produccion vieja (`--ref` tenia que ser ese y ningun
 * otro): la tienda que opera es CONTROLLED_PRODUCTION y la sonda se negaba a
 * mirarla (DIAG-03 / DIAG-10). Cada destino trae su negocio canonico: el de CP
 * sale de deploy/controlled-production.json, que es donde vive ese dato.
 */
export const TARGETS = Object.freeze({
  production: Object.freeze({
    ref: 'wwcpogltfgzgkrlilbcd',
    canonicalBusiness: '00000000-0000-4000-8000-000000000001',
    prelaunch: true,
  }),
  'controlled-production': Object.freeze({
    ref: 'tkanbadcglszlcyfjvpv',
    canonicalBusiness: negocioDeProduccionControlada(),
    prelaunch: false,
  }),
  staging: Object.freeze({
    ref: 'ucbtjcurawxjwjdvvcvj',
    canonicalBusiness: null,
    prelaunch: false,
  }),
});

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export function parseArgs(argv) {
  const value = (name) => {
    const i = argv.indexOf(`--${name}`);
    if (i === -1) return undefined;
    const next = argv[i + 1];
    if (!next || next.startsWith('--')) throw new Error(`--${name} requiere un valor`);
    return next.trim();
  };
  const targetName = value('target');
  const ref = value('ref');
  let target;
  if (targetName) {
    if (!Object.hasOwn(TARGETS, targetName)) {
      throw new Error(`--target tiene que ser ${Object.keys(TARGETS).join(', ')}; llego «${targetName}»`);
    }
    target = targetName;
    if (ref && ref !== TARGETS[target].ref) throw new Error(`--ref ${ref} no es el proyecto de ${target}`);
  } else if (ref) {
    target = Object.keys(TARGETS).find((name) => TARGETS[name].ref === ref);
    if (!target) throw new Error(`--ref ${ref} no es ninguno de los proyectos que esta sonda mira`);
  } else {
    throw new Error(`hay que nombrar el destino: --target ${Object.keys(TARGETS).join('|')}; no hay default implicito`);
  }
  const businessId = value('business-id');
  if (businessId && !UUID.test(businessId)) throw new Error('--business-id tiene que ser un uuid');
  return {
    target,
    ref: TARGETS[target].ref,
    canonicalBusiness: businessId || TARGETS[target].canonicalBusiness,
    prelaunch: TARGETS[target].prelaunch,
    report: value('report'),
  };
}

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
 * Se comparan los CONJUNTOS, no la cuenta y la ultima: el mismo numero con
 * otra migracion adentro tambien es una diferencia, y una migracion que el
 * destino tiene y este checkout no conoce es deriva, se diga lo que se diga
 * de la cuenta.
 */
export function repoLedger(dir = path.join(root, 'supabase', 'migrations')) {
  const versiones = fs.readdirSync(dir)
    .filter((archivo) => archivo.endsWith('.sql'))
    .map((archivo) => archivo.slice(0, 14))
    .filter((version) => /^\d{14}$/.test(version))
    .sort();
  if (!versiones.length) throw new Error('no se encontro ninguna migracion en supabase/migrations');
  return versiones;
}

export function evaluateLedger(remoteVersions, repoVersions) {
  const remote = [...new Set(remoteVersions.map(String))].sort();
  const repo = [...new Set(repoVersions.map(String))].sort();
  const remoteSet = new Set(remote);
  const repoSet = new Set(repo);
  const missing = repo.filter((version) => !remoteSet.has(version));
  const unknown = remote.filter((version) => !repoSet.has(version));
  const findings = [];
  if (unknown.length) {
    findings.push(`${unknown.length} migration(s) en el destino que este checkout no conoce (deriva): ${unknown.slice(0, 5).join(', ')}`);
  }
  if (missing.length) {
    findings.push(`faltan ${missing.length} migration(s) de este checkout en el destino (primera ${missing[0]}, ultima ${missing[missing.length - 1]})`);
  }
  return {
    total: remote.length,
    last: remote[remote.length - 1] ?? null,
    expectedTotal: repo.length,
    expectedLast: repo[repo.length - 1],
    missing,
    unknown,
    findings,
  };
}

/*
 * QUE TAREAS TIENEN QUE EXISTIR LO DICE LA BASE, NO UN NUMERO DE ACA.
 *
 * Se exigian exactamente estas cuatro y "exactamente cuatro taba-*": las
 * migraciones ya programan nueve, y CP tenia cinco. La sonda no podia dar
 * verde nunca, y una alarma que suena siempre es una alarma que nadie mira.
 *
 * Desde 20261001220000 la base guarda su propio inventario
 * (`private.scheduler_expected_jobs`; el rol de solo lectura lo puede leer:
 * `bypassrls` + `pg_read_all_data`). Si existe, manda el inventario. Si el
 * destino todavia no lo tiene, se exigen las cuatro de siempre, que todos los
 * entornos tienen desde agosto. Una tarea de mas no es un problema; una tarea
 * de mas que FALLA si lo es, este o no en el inventario. Un inventario que
 * existe y se lee vacio no se toma como «no hay nada que exigir»: se avisa.
 */
export const BASELINE_CRON = Object.freeze([
  'taba-payment-outbox-worker',
  'taba-checkout-expiry-sweep',
  'taba-checkout-provider-truth-sweep',
  'taba-operational-alerts-sweep',
]);

export function evaluateCron({ jobs = [], inventoryAvailable = false, inventory = [] } = {}) {
  const findings = [];
  let source = 'baseline';
  let required = [...BASELINE_CRON];
  if (inventoryAvailable) {
    const names = [...new Set(inventory.map(String))].sort();
    if (names.length) {
      source = 'inventory';
      required = names;
    } else {
      findings.push('el inventario de tareas (private.scheduler_expected_jobs) existe y se leyo vacio: se exigen las cuatro de siempre');
    }
  }
  for (const name of required) {
    const job = jobs.find((candidate) => candidate.jobname === name);
    if (!job) {
      findings.push(`falta el cron ${name}`);
      continue;
    }
    if (job.active !== true) findings.push(`cron ${name} inactivo`);
    if (job.last_status === 'failed') findings.push(`cron ${name} termino en failed`);
  }
  const extra = jobs.filter((job) => job.jobname.startsWith('taba-') && !required.includes(job.jobname));
  for (const job of extra) {
    if (job.last_status === 'failed') findings.push(`cron ${job.jobname} (fuera de lo exigido) termino en failed`);
  }
  return { source, required, extra: extra.map((job) => job.jobname), findings };
}

/*
 * LAS ALERTAS CRITICAS SE CUENTAN COMO LAS ESCRIBE LA BASE.
 *
 * Se contaba `severity = 'critical'` y la tabla solo admite 'CRITICAL'
 * (check de 20260802180000): la sonda no podia ver ninguna. Se compara sin
 * importar mayusculas, y "abierta" es lo que la base llama abierta
 * (`status <> 'resolved'`, abierta o reconocida), lo mismo que cuentan la
 * salud del Panel y la conciliacion diaria.
 */
export function evaluateAlerts(rows = []) {
  const bySeverity = {};
  const criticalCodes = {};
  let open = 0;
  for (const row of rows) {
    const severity = String(row.severity || '').toUpperCase();
    const count = Number(row.abiertas) || 0;
    open += count;
    bySeverity[severity] = (bySeverity[severity] || 0) + count;
    if (severity === 'CRITICAL') criticalCodes[row.alert_code] = (criticalCodes[row.alert_code] || 0) + count;
  }
  const critical = bySeverity.CRITICAL || 0;
  const findings = critical
    ? [`${critical} alerta(s) CRITICAL abiertas: ${Object.entries(criticalCodes).map(([code, n]) => `${code}=${n}`).join(' ')}`]
    : [];
  return { open, critical, bySeverity, criticalCodes, findings };
}

// Tablas que en prelaunch tienen que estar en cero. No es una lista de todas:
// es la lista de las que, si tienen una fila, quiere decir que alguien uso el
// sistema y nadie lo escribio.
const MUST_BE_EMPTY = [
  'orders', 'order_items', 'order_events', 'customers', 'rider_profiles',
  'rider_locations', 'rider_order_offers', 'payment_attempts', 'payment_outbox',
  'checkout_sessions', 'fiscal_documents', 'products', 'catalog_assets',
];

// El unico verbo permitido. Una consulta que no empiece con select o with no
// sale de este archivo: la sonda no puede convertirse en una via de escritura
// por un descuido de edicion.
const READ_ONLY = /^\s*(select|with)\b/i;

export function readOnlyAsk({ ref, token, fetchImpl = fetch }) {
  return async function ask(sql) {
    if (!READ_ONLY.test(sql)) throw new Error('la sonda solo ejecuta SELECT');
    const res = await fetchImpl(`https://api.supabase.com/v1/projects/${ref}/database/query/read-only`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: sql }),
      signal: AbortSignal.timeout(60_000),
    });
    const text = await res.text();
    if (!res.ok) throw new Error(`${res.status} ${text.slice(0, 300)}`);
    const body = text ? JSON.parse(text) : [];
    if (!Array.isArray(body)) throw new Error('respuesta inesperada de la Management API');
    return body;
  };
}

export async function runHealthCheck({ ask, options, repoVersions = repoLedger(), now = () => new Date() }) {
  const findings = [];
  const report = { schemaVersion: 2, target: options.target, ref: options.ref, checkedAt: now().toISOString() };

  // 1 + 2 - identidad y ledger
  const [identity] = await ask(`select current_database() as db, version() as server;`);
  const ledgerRows = await ask(`select version from supabase_migrations.schema_migrations order by version;`);
  const ledger = evaluateLedger(ledgerRows.map((row) => row.version), repoVersions);
  report.ledger = { ...ledger, server: identity?.server ?? null };
  findings.push(...ledger.findings);

  // 3 - latido del scheduler
  //
  // No se llama a scheduler_heartbeat(): el rol de solo lectura no es anon ni
  // authenticated y no tiene EXECUTE sobre una SECURITY DEFINER. Se hace lo
  // mismo que hace la funcion -leer el ultimo barrido- y ademas se comprueba
  // por catalogo que el grant a anon siga en pie, que es lo que el watchdog
  // externo necesita. Es mas fuerte que invocarla: verifica el dato Y el
  // privilegio, sin depender de tener el rol.
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
    last_run_at: beat?.last_run_at ?? null,
    age_seconds: beat?.age_seconds ?? null,
    stale_after_seconds: 600,
    healthy: beat?.age_seconds !== null && beat?.age_seconds !== undefined && beat.age_seconds < 600,
    anonProbeGranted: grant?.anon_heartbeat === true,
    anonWatchdogGranted: grant?.anon_watchdog === true,
  };
  if (!report.heartbeat.healthy) {
    findings.push(report.heartbeat.last_run_at
      ? `scheduler no sano: el ultimo barrido fue hace ${report.heartbeat.age_seconds}s (${report.heartbeat.last_run_at})`
      : 'scheduler no sano: el barrido de alertas no corrio nunca');
  }
  if (!report.heartbeat.anonProbeGranted) findings.push('anon perdio EXECUTE sobre scheduler_heartbeat: el reloj externo queda ciego');
  if (!report.heartbeat.anonWatchdogGranted) findings.push('anon perdio EXECUTE sobre check_scheduler_watchdog: nadie abre la alerta');

  // 4 - tareas activas y su ultimo resultado, contra lo que la base dice que tiene que haber
  const jobs = await ask(`
    select j.jobname, j.schedule, j.active,
           (select r.status from cron.job_run_details r
             where r.jobid = j.jobid order by r.start_time desc limit 1) as last_status,
           (select r.start_time from cron.job_run_details r
             where r.jobid = j.jobid order by r.start_time desc limit 1) as last_start
      from cron.job j where j.jobname like 'taba-%' order by j.jobname;
  `);
  const [inventoryProbe] = await ask(`select to_regclass('private.scheduler_expected_jobs') is not null as available;`);
  const inventory = inventoryProbe?.available
    ? (await ask(`select job_name from private.scheduler_expected_jobs order by job_name;`)).map((row) => row.job_name)
    : [];
  const cron = evaluateCron({ jobs, inventoryAvailable: inventoryProbe?.available === true, inventory });
  report.cron = { ...cron, jobs };
  findings.push(...cron.findings);

  // 5 - alertas operativas abiertas, por severidad
  const alertRows = await ask(`
    select severity, alert_code, count(*)::int as abiertas
      from public.operational_alerts
     where status <> 'resolved'
     group by severity, alert_code
     order by severity, alert_code;
  `);
  const alerts = evaluateAlerts(alertRows);
  report.alerts = alerts;
  findings.push(...alerts.findings);

  // 6 - datos humanos
  const counts = await ask(`
    select 'auth_users' as tabla, count(*)::int as filas from auth.users
    union all ${MUST_BE_EMPTY.map((t) => `select '${t}', count(*)::int from public.${t}`).join(' union all ')}
    order by 1;
  `);
  report.dataCounts = Object.fromEntries(counts.map((c) => [c.tabla, c.filas]));
  report.nonEmpty = counts.filter((c) => c.filas > 0).map((c) => `${c.tabla}=${c.filas}`);

  // 7 - el negocio canonico y sus puertas
  let negocio = null;
  if (options.canonicalBusiness) {
    if (!UUID.test(options.canonicalBusiness)) throw new Error('negocio canonico invalido');
    [negocio] = await ask(`
      select id::text, name, ordering_enabled, ordering_verified,
             delivery_enabled, pickup_enabled, status
        from public.businesses where id = '${options.canonicalBusiness}';
    `);
    if (!negocio) findings.push(`el negocio canonico ${options.canonicalBusiness} no existe en ${options.target}`);
  }
  report.business = negocio ?? (options.canonicalBusiness ? null : 'not_checked');

  return {
    ...report,
    prelaunchOrderingClosed: options.prelaunch && negocio
      ? negocio.ordering_enabled === false && negocio.ordering_verified === false
      : null,
    findings,
    healthy: findings.length === 0,
  };
}

async function main(argv) {
  let options;
  try {
    options = parseArgs(argv);
  } catch (error) {
    console.error(error.message);
    process.exit(2);
  }
  const token = process.env.SUPABASE_ACCESS_TOKEN;
  if (!token) {
    console.error('falta SUPABASE_ACCESS_TOKEN en el entorno');
    process.exit(2);
  }
  let salida;
  try {
    salida = await runHealthCheck({ ask: readOnlyAsk({ ref: options.ref, token }), options });
  } catch (error) {
    console.error(`no se pudo preguntar: ${String(error?.message || error).slice(0, 300)}`);
    process.exit(2);
  }

  // El informe se escribe SOLO si se pide.
  //
  // Escribirlo siempre dejaba el arbol sucio en cada corrida -el JSON lleva la
  // hora- y `npm run production:verify`, que empieza exigiendo un arbol limpio y
  // despues corre esta sonda, se envenenaba a si mismo: la corrida N ensuciaba lo
  // que la corrida N+1 exigia limpio. Una verificacion que muta no es una
  // verificacion.
  if (options.report) {
    fs.mkdirSync(path.dirname(path.resolve(options.report)), { recursive: true });
    fs.writeFileSync(options.report, `${JSON.stringify(salida, null, 2)}\n`);
  }

  const { ledger, heartbeat, cron, alerts, business } = salida;
  console.log(`--- SALUD DE ${options.target.toUpperCase()} (${options.ref}) ---`);
  console.log(`  ledger            : ${ledger.total} - ultima ${ledger.last} (checkout: ${ledger.expectedTotal} - ultima ${ledger.expectedLast}; faltan ${ledger.missing.length}, desconocidas ${ledger.unknown.length})`);
  console.log(`  scheduler         : healthy=${heartbeat.healthy} age=${heartbeat.age_seconds}s`);
  console.log(`  cron taba-*       : exigidas por ${cron.source === 'inventory' ? 'el inventario de la base' : 'la lista de siempre'} (${cron.required.length}); ${cron.jobs.map((c) => `${c.jobname}[${c.active ? 'on' : 'OFF'}/${c.last_status ?? 'sin corridas'}]`).join(' ')}`);
  console.log(`  alertas abiertas  : ${alerts.open} (criticas ${alerts.critical}${alerts.critical ? `: ${Object.keys(alerts.criticalCodes).join(', ')}` : ''})`);
  console.log(`  tablas con filas  : ${salida.nonEmpty.length ? salida.nonEmpty.join(' ') : 'ninguna'}`);
  if (business === 'not_checked') {
    console.log('  negocio canonico  : (sin negocio canonico para este destino; --business-id <uuid> para mirarlo)');
  } else {
    console.log(`  negocio canonico  : ${business ? `${business.name} status=${business.status}` : 'AUSENTE'}`);
    console.log(`  ordering          : enabled=${business?.ordering_enabled} verified=${business?.ordering_verified}`);
  }
  console.log(`  reporte           : ${options.report ?? '(no se pidio; --report <archivo> para escribirlo)'}`);

  if (salida.findings.length) {
    console.error('\n  A MIRAR:');
    for (const f of salida.findings) console.error(`    ${f}`);
    process.exit(1);
  }
  console.log('\n  RESULTADO         : SANO');
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  await main(process.argv.slice(2));
}
