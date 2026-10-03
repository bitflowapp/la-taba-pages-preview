// FASE health — la salud del e-commerce, como la lee la plataforma.
//
// `get_ecommerce_health()` es la lectura que mira quien opera: siete componentes
// (base, Auth, checkout, pedidos, integración de pagos, avisos del proveedor y
// planificador), cada uno con su estado y su detalle, y el peor de todos como estado
// general. Es SÓLO de la plataforma: la llama `service_role` (acá, anotado como
// lectura de plataforma) y nadie más, ni el dueño de un comercio.
//
// Lo que se afirma en todos los destinos: la forma del documento, quién no lo puede
// leer, que leerlo no cambia nada y que no trae ni un secreto ni un dato de una
// persona. Lo que depende del destino:
//   · el componente del planificador tiene que estar SANO donde pg_cron corre de
//     verdad y el entorno es de esta corrida (el stack). En local nada ejecuta los
//     trabajos; Staging es compartido y su estado no depende sólo de esta corrida;
//   · que la lectura VE un trabajo apagado sólo se puede mostrar donde la base es de
//     quien corre: se apaga el trabajo diario de poda por la conexión directa, se lee,
//     y se vuelve a encender (dicho en el check y anotado en el ledger).
import { nowIso, sqlUuid } from '../env.mjs';
import { CODES, brief, refusal, refused } from '../http.mjs';
import { piiLeaks } from '../orders.mjs';

const P = 'health';
export const HEALTH_COMPONENTS = Object.freeze(['database', 'auth', 'checkout', 'orders', 'payment_integration', 'webhook_processing', 'schedulers']);
const STATUSES = Object.freeze(['ok', 'degraded', 'down', 'unknown']);
// El trabajo que se apaga para ver que la salud lo nota: el de poda del historial, que corre una vez por día.
const PROBE_JOB = 'taba-cron-history-purge';
// Formas de secreto que nunca pueden salir en este documento (las mismas que borra el redactor).
const SECRET_SHAPES = Object.freeze([/eyJ[A-Za-z0-9_-]{10,}\.eyJ/, /sb_(secret|publishable)_/, /sbp_[A-Za-z0-9]{20,}/, /APP_USR-/, /certification-fixture-without-credentials/, /postgres(ql)?:\/\//]);

export default {
  id: P,
  title: 'salud del e-commerce: sólo la plataforma la lee, no cambia nada, no trae secretos; en el stack el planificador está sano',
  requires: ['ecommerce_health'],
  async run(ctx) {
    const C = ctx.rec.check;
    const target = ctx.env.target;
    const { owner } = ctx.actors;
    // La lectura con la clave de servicio va por el transporte propio (mide y devuelve el estado HTTP); cada
    // lote queda anotado en el ledger como lectura de plataforma ANTES de salir.
    const read = async (why) => {
      const done = ctx.serviceRole.announce('platform-read', `rpc get_ecommerce_health (${why})`);
      const r = await ctx.http.service('get_ecommerce_health', {});
      done(r.ok, r.ok ? null : `HTTP ${r.status} ${r.code}`);
      return r;
    };
    const componentOf = (document, name) => (document?.components || []).find((c) => c.component === name) || null;
    const statusesOf = (document) => Object.fromEntries((document?.components || []).map((c) => [c.component, c.status]));
    const mark = async () => (await ctx.env.observe(`select
      (select count(*) from public.operational_alerts where business_id = ${sqlUuid(ctx.tenant.id)})::int as alerts,
      (select count(*) from public.payment_outbox)::int as outbox,
      (select count(*) from public.payment_webhook_receipts)::int as receipts`))[0];

    // ── 1. La lectura de la plataforma ────────────────────────────────────────
    const before = { footprint: await ctx.orders.footprint(), mark: await mark() };
    const first = await read('shape, secrets and side effects');
    const document = first.data;
    const after = { footprint: await ctx.orders.footprint(), mark: await mark() };
    const names = (document?.components || []).map((c) => c.component);
    C(P, 'HEALTH_IS_READ_BY_THE_PLATFORM_WITH_ITS_SEVEN_COMPONENTS', first.status === 200 && STATUSES.includes(document?.status)
      && names.length === HEALTH_COMPONENTS.length && HEALTH_COMPONENTS.every((name) => names.includes(name))
      && (document?.components || []).every((c) => STATUSES.includes(c.status) && Boolean(c.checked_at)) && Boolean(document?.generated_at)
      && Array.isArray(document?.not_observable_from_sql),
    { http: first.status, status: document?.status ?? null, components: statusesOf(document), summary: document?.summary ?? null }, 'HTTP 200 · un estado general y los siete componentes, cada uno con su estado');
    C(P, 'READING_THE_HEALTH_CHANGES_NOTHING', ctx.orders.sameFootprint(before.footprint, after.footprint) && JSON.stringify(before.mark) === JSON.stringify(after.mark),
      { changed: ctx.orders.footprintDiff(before.footprint, after.footprint), before: before.mark, after: after.mark }, 'ni pedidos, ni stock, ni alertas, ni la cola de pagos, ni recibos');
    const text = JSON.stringify(document || {});
    const customer = await ctx.identities.customer('health', { address: false });
    const leaks = piiLeaks(document, [customer, owner], { allowKeys: [] });
    const secrets = SECRET_SHAPES.filter((shape) => shape.test(text)).map(String);
    C(P, 'HEALTH_CARRIES_NO_SECRET_AND_NO_PERSONAL_DATA', leaks.length === 0 && secrets.length === 0 && !text.includes(ctx.env.keys.secret) && !text.includes(ctx.env.keys.publishable),
      { leaks, secretShapes: secrets, bytes: text.length }, 'ni una clave, ni el material de un vendedor, ni un correo, teléfono o domicilio');
    const database = componentOf(document, 'database');
    const auth = componentOf(document, 'auth');
    C(P, 'DATABASE_AND_AUTH_COMPONENTS_ARE_OK', database?.status === 'ok' && auth?.status === 'ok' && database?.detail?.in_recovery === false
      && Number(database?.detail?.public_tables) > 0 && auth?.detail?.schema_reachable === true,
    { database: database?.status ?? null, auth: auth?.status ?? null, migrationsHead: database?.detail?.migrations_head ?? null, connections: database?.detail?.connections ?? null });

    // ── 2. Nadie más la lee ───────────────────────────────────────────────────
    const asked = { anonymous: await ctx.http.call(null, 'get_ecommerce_health', {}), customer: await ctx.http.call(customer, 'get_ecommerce_health', {}),
      owner: await ctx.http.call(owner, 'get_ecommerce_health', {}) };
    C(P, 'HEALTH_IS_NOT_READABLE_BY_CLIENTS_OR_BUSINESS_OWNERS', refused(asked.anonymous, CODES.FORBIDDEN, { actor: null }) && refused(asked.customer, CODES.FORBIDDEN)
      && refused(asked.owner, CODES.FORBIDDEN), Object.fromEntries(Object.entries(asked).map(([k, r]) => [k, brief(r)])),
    `${refusal(CODES.FORBIDDEN, { actor: null })} sin sesión; ${refusal(CODES.FORBIDDEN)} para un cliente y para el dueño`);

    // ── 3. El planificador ────────────────────────────────────────────────────
    const schedulers = componentOf(document, 'schedulers');
    const noScheduler = target.lacks('scheduler') || target.lacks('environment_ownership');
    if (noScheduler) {
      ctx.rec.skipOnTarget(P, 'SCHEDULER_COMPONENT_IS_HEALTHY', noScheduler);
    } else {
      const jobs = schedulers?.detail?.jobs || [];
      C(P, 'SCHEDULER_COMPONENT_IS_HEALTHY', schedulers?.status === 'ok' && schedulers?.detail?.pg_cron_installed === true && schedulers?.detail?.heartbeat?.healthy === true
        && (schedulers?.detail?.missing || []).length === 0 && (schedulers?.detail?.inactive || []).length === 0,
      { status: schedulers?.status ?? null, heartbeat: schedulers?.detail?.heartbeat ?? null, missing: schedulers?.detail?.missing ?? null, inactive: schedulers?.detail?.inactive ?? null,
        jobs: jobs.map((job) => `${job.job}:${job.state}`) }, 'pg_cron instalado, latido sano, ningún trabajo faltante ni apagado, todos en un estado sano');
    }

    const noOwnership = target.lacks('database_ownership') || noScheduler;
    if (noOwnership) {
      ctx.rec.skipOnTarget(P, 'HEALTH_SEES_A_STOPPED_SCHEDULER_JOB_AND_ITS_RECOVERY', noOwnership);
    } else {
      // La base es de quien corre: el trabajo diario de poda se apaga por la conexión directa, se lee la salud y
      // se vuelve a encender. Anotado en el ledger antes de tocar nada.
      const job = (await ctx.env.observe(`select jobid::text as jobid, active from cron.job where jobname = '${PROBE_JOB}'`))[0];
      const entry = { at: nowIso(), what: `cron.alter_job(${PROBE_JOB}, active := false) and back`, why: 'health must notice a stopped scheduler job', rows: null };
      ctx.ledger.databaseInterventions.push(entry);
      ctx.persist();
      let stopped = null;
      let recovered = null;
      let error = null;
      try {
        if (!job) throw Error(`JOB_NOT_FOUND:${PROBE_JOB}`);
        await target.database.write('select cron.alter_job($1::bigint, active := false)', [job.jobid]);
        stopped = (await read('a stopped scheduler job')).data;
      } catch (failure) {
        error = String(failure.message).slice(0, 200);
      } finally {
        if (job) {
          try { await target.database.write('select cron.alter_job($1::bigint, active := true)', [job.jobid]); } catch (failure) { error ||= `RESTORE:${String(failure.message).slice(0, 160)}`; }
        }
      }
      recovered = (await read('the scheduler job back on')).data;
      const activeAgain = (await ctx.env.observe(`select active from cron.job where jobname = '${PROBE_JOB}'`))[0]?.active === true;
      entry.rows = { stoppedRead: Boolean(stopped), activeAgain };
      ctx.persist();
      const stoppedComponent = componentOf(stopped, 'schedulers');
      const recoveredComponent = componentOf(recovered, 'schedulers');
      const stateOf = (component) => (component?.detail?.jobs || []).find((j) => j.job === PROBE_JOB)?.state ?? null;
      C(P, 'HEALTH_SEES_A_STOPPED_SCHEDULER_JOB_AND_ITS_RECOVERY', !error && stoppedComponent?.status === 'degraded' && (stoppedComponent?.detail?.inactive || []).includes(PROBE_JOB)
        && stateOf(stoppedComponent) === 'apagado' && activeAgain && recoveredComponent?.status === 'ok' && !(recoveredComponent?.detail?.inactive || []).includes(PROBE_JOB),
      { error, stopped: { status: stoppedComponent?.status ?? null, inactive: stoppedComponent?.detail?.inactive ?? null, state: stateOf(stoppedComponent) },
        recovered: { status: recoveredComponent?.status ?? null, state: stateOf(recoveredComponent) }, activeAgain, intervention: 'cron.alter_job through the direct database connection (the runner owns this database)' },
      `con ${PROBE_JOB} apagado: schedulers «degraded» y el trabajo en «inactive»; encendido de nuevo: «ok»`);
    }

    ctx.evidence.write('phase-health.json', { status: document?.status ?? null, components: statusesOf(document), summary: document?.summary ?? null,
      schedulers: { status: schedulers?.status ?? null, heartbeat: schedulers?.detail?.heartbeat ?? null, jobs: (schedulers?.detail?.jobs || []).map((job) => ({ job: job.job, state: job.state })) },
      checkout: componentOf(document, 'checkout')?.detail ?? null, payments: componentOf(document, 'payment_integration')?.status ?? null });
  },
};
