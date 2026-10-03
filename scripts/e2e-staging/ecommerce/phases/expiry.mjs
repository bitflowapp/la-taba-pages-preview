// FASE expiry — los plazos los vence el planificador REAL, no esta herramienta.
//
// Dos trabajos de pg_cron devuelven stock sin que nadie toque nada:
//
//   taba-checkout-expiry-sweep      una sesión de checkout vencida libera su reserva
//   taba-unattended-order-expiry    un pedido en efectivo que el comercio no atendió en
//                                   `abandoned_order_minutes` se cancela solo
//
// Esta fase NO llama a esas funciones: crea la sesión y el pedido, los ENVEJECE por la
// conexión directa a la base (la sesión venció hace un minuto; el pedido nació hace seis,
// con el plazo del comercio en cinco) y espera a que el trabajo programado los venza.
// Envejecer una fila reemplaza esperar el plazo real (diez minutos de una sesión, cinco
// como mínimo de un pedido); queda anotado en el ledger y dicho en el check.
//
// Sólo corre donde pg_cron ejecuta los trabajos de verdad Y la base es de quien corre:
// el stack efímero. En local nada ejecuta `cron.job`; en Staging la base no es de esta
// herramienta.
import { nowIso, sleep, sqlText } from '../env.mjs';
import { brief } from '../http.mjs';

const P = 'expiry';
// Los dos trabajos corren cada minuto: a lo sumo uno entero de espera, más el tiempo de la corrida.
const WAIT_MS = 80_000;
const POLL_MS = 3000;
const CHECKS = Object.freeze(['AN_EXPIRED_CHECKOUT_IS_RELEASED_BY_THE_REAL_SWEEP', 'THE_EXPIRED_CHECKOUT_RETURNS_ITS_STOCK_ONCE',
  'AN_UNATTENDED_CASH_ORDER_IS_CANCELLED_BY_THE_REAL_JOB', 'THE_UNATTENDED_ORDER_RETURNS_ITS_STOCK_ONCE']);

// Espera a que `probe` devuelva algo (no nulo), preguntando cada POLL_MS, a lo sumo `limitMs`.
async function waitFor(probe, limitMs = WAIT_MS) {
  const started = Date.now();
  for (;;) {
    const value = await probe();
    if (value) return { value, waitedMs: Date.now() - started };
    if (Date.now() - started > limitMs) return { value: null, waitedMs: Date.now() - started };
    await sleep(POLL_MS);
  }
}

export default {
  id: P,
  title: 'vencimientos por el planificador real: checkout vencido y pedido en efectivo sin atender',
  requires: [],
  async run(ctx) {
    const C = ctx.rec.check;
    const id = ctx.tenant.id;
    const target = ctx.env.target;
    const cannot = target.lacks('scheduler') || target.lacks('database_ownership');
    if (cannot) {
      for (const name of CHECKS) ctx.rec.skipOnTarget(P, name, cannot);
      return;
    }
    const checkoutReady = ctx.caps.checkout_payments;
    const orderReady = ctx.caps.order_expiry;
    if (!checkoutReady) for (const name of CHECKS.slice(0, 2)) ctx.rec.skipCheck(P, name, 'checkout_payments');
    if (!orderReady) for (const name of CHECKS.slice(2)) ctx.rec.skipCheck(P, name, 'order_expiry');
    if (!checkoutReady && !orderReady) return;

    const { owner } = ctx.actors;
    const main = ctx.orders.product('MAIN');
    const units = () => ctx.orders.unitsOf(main.id);
    const dbNow = async () => (await ctx.env.observe('select to_json(clock_timestamp()) #>> \'{}\' as now'))[0].now;
    // Las corridas de un trabajo programado que terminaron bien después de un instante.
    const runsAfter = async (job, since) => (await ctx.env.observe(`select count(*)::int as n, max(d.end_time)::text as last
      from cron.job_run_details d join cron.job j on j.jobid = d.jobid
      where j.jobname = ${sqlText(job)} and d.status = 'succeeded' and d.start_time > ${sqlText(since)}::timestamptz`))[0];
    const intervene = async (what, why, sql, params) => {
      const entry = { at: nowIso(), what, why, rows: null };
      ctx.ledger.databaseInterventions.push(entry);
      ctx.persist();
      try {
        const out = await target.database.write(sql, params);
        entry.rows = out.rowCount;
        return out.rowCount;
      } catch (error) {
        entry.rows = { error: String(error.message).slice(0, 160) };
        return 0;
      } finally { ctx.persist(); }
    };
    const evidence = {};
    const before = await units();
    let session = null;
    let order = null;
    let customer = null;

    try {
      // ── Preparación de los dos casos, juntos: los dos trabajos corren cada minuto y se esperan a la vez ──
      if (checkoutReady) {
        await ctx.payments.ensureFixture();
        const [payer] = await ctx.identities.payers(1, { signIn: false });
        // Sin preferencia: una sesión que nunca llegó a Mercado Pago no la consulta la sonda del proveedor.
        const created = await ctx.payments.createSession(payer, { role: 'MAIN', quantity: 2, label: 'expiry-checkout' });
        session = created.session;
        evidence.session = { created: brief(created.r) };
      }
      if (orderReady) {
        // El plazo del comercio, como lo escribe el dueño (columna que puede escribir y no leer: `select=id`).
        const set = await ctx.http.restWrite(owner, 'PATCH', `businesses?id=eq.${id}&select=id`, { abandoned_order_minutes: 5 }, { businessId: id });
        ctx.ledger.tenantChanges.push({ kind: 'abandoned_order_minutes', value: 5, at: nowIso() });
        ctx.persist();
        customer = await ctx.identities.customer('expiry-unattended', { address: false });
        const created = set.ok ? await ctx.orders.create(customer, { mode: 'pickup', role: 'MAIN', quantity: 1, payment: 'cash', label: 'expiry-unattended' }) : null;
        order = created?.order || null;
        evidence.order = { policy: brief(set), created: created ? brief(created.r) : null };
      }
      // Un caso que ni siquiera se pudo armar no desaparece del resultado: sus dos checks fallan con el motivo.
      if (checkoutReady && !session) {
        for (const name of CHECKS.slice(0, 2)) C(P, name, false, { setup: 'la sesión de checkout no se creó', answer: evidence.session?.created ?? null });
      }
      if (orderReady && !order) {
        for (const name of CHECKS.slice(2)) C(P, name, false, { setup: 'el pedido en efectivo no se creó (o el plazo del comercio no se pudo fijar)', answer: evidence.order ?? null });
      }
      if (!session && !order) return;
      const held = await units();
      const agedAt = await dbNow();
      let sessionAged = 0;
      let orderAged = 0;
      if (session) {
        sessionAged = await intervene(`age checkout session ${session.id.slice(0, 8)} and its reservations: expired one minute ago`,
          'the real taba-checkout-expiry-sweep has to release it',
          `update public.checkout_sessions set created_at = clock_timestamp() - interval '2 hours', expires_at = clock_timestamp() - interval '1 minute'
            where id = $1 and business_id = $2`, [session.id, id]);
        await intervene(`age the reservations of checkout session ${session.id.slice(0, 8)}`, 'they expire with their session',
          `update public.inventory_reservations set created_at = clock_timestamp() - interval '2 hours', expires_at = clock_timestamp() - interval '1 minute'
            where checkout_session_id = $1 and status = 'active'`, [session.id]);
      }
      if (order) {
        orderAged = await intervene(`age order ${order.public_code}: created six minutes ago`, 'the real taba-unattended-order-expiry has to cancel it (abandoned_order_minutes = 5)',
          `update public.orders set created_at = clock_timestamp() - interval '6 minutes' where id = $1 and business_id = $2 and status = 'received'`, [order.id, id]);
      }
      ctx.log(`expiry: filas envejecidas (sesión ${sessionAged}, pedido ${orderAged}); se espera al planificador real (hasta ${WAIT_MS / 1000} s)`);

      // ── La espera: el planificador, y nadie más, tiene que vencerlos ──
      const [released, cancelled] = await Promise.all([
        session ? waitFor(async () => { const s = await ctx.payments.state(session.id); return s.session === 'expired' ? s : null; }) : null,
        order ? waitFor(async () => { const s = await ctx.orders.state(order.id); return s.status === 'cancelled' ? s : null; }) : null,
      ]);
      const afterRelease = await units();

      if (session) {
        const runs = await runsAfter('taba-checkout-expiry-sweep', agedAt);
        evidence.session = { ...evidence.session, aged: sessionAged, waitedMs: released.waitedMs, state: released.value ? { session: released.value.session, reservations: released.value.reservations } : null, sweeps: runs };
        C(P, CHECKS[0], sessionAged === 1 && Boolean(released.value) && JSON.stringify(released.value.reservations) === JSON.stringify(['released:2:checkout_expired']) && runs.n > 0,
          { aged: sessionAged, waitedMs: released.waitedMs, state: evidence.session.state, sweepRunsAfterAging: runs, runnerCalledTheSweep: false,
            intervention: 'checkout_sessions.expires_at and its reservations aged through the direct database connection (the runner owns this database)' },
          'la sesión envejecida queda «expired» y su reserva liberada por taba-checkout-expiry-sweep, sin que esta herramienta llame al barrido');
      }
      if (order) {
        const truth = await ctx.orders.truth(order.id);
        const expiredEvent = (truth?.events || []).find((e) => e.event_type === 'order.expired_unattended');
        const runs = await runsAfter('taba-unattended-order-expiry', agedAt);
        evidence.order = { ...evidence.order, aged: orderAged, waitedMs: cancelled.waitedMs, status: truth?.order_row?.status ?? null, event: expiredEvent ? { actor: expiredEvent.actor_role, metadata: expiredEvent.metadata } : null, runs };
        C(P, CHECKS[2], orderAged === 1 && Boolean(cancelled.value) && Boolean(cancelled.value.inventory_released_at) && expiredEvent?.actor_role === 'system'
          && expiredEvent?.metadata?.reason === 'unattended_timeout' && Number(expiredEvent?.metadata?.abandoned_order_minutes) === 5 && runs.n > 0,
        { aged: orderAged, waitedMs: cancelled.waitedMs, status: truth?.order_row?.status ?? null, event: evidence.order.event, jobRunsAfterAging: runs,
          intervention: 'orders.created_at aged six minutes through the direct database connection (the runner owns this database)' },
        'cancelado por el sistema con motivo unattended_timeout y el plazo del comercio (5), por taba-unattended-order-expiry');
      }

      // ── «Una vez»: otra corrida de cada trabajo después de la liberación no devuelve nada más ──
      const releasedAt = await dbNow();
      const [nextSweep, nextExpiry] = await Promise.all([
        session ? waitFor(async () => ((await runsAfter('taba-checkout-expiry-sweep', releasedAt)).n > 0 ? true : null)) : null,
        order ? waitFor(async () => ((await runsAfter('taba-unattended-order-expiry', releasedAt)).n > 0 ? true : null)) : null,
      ]);
      const settledUnits = await units();
      evidence.units = { before, held, afterRelease, afterAnotherRun: settledUnits };
      // Lo que cada caso sigue reteniendo si su trabajo NO lo venció: así un caso que falla no ensucia la cuenta del otro.
      const sessionStillHolds = session && !released?.value ? 2 : 0;
      const orderStillHolds = order && !cancelled?.value ? 1 : 0;
      const expectedHeld = before.stock - (session ? 2 : 0) - (order ? 1 : 0);
      if (session) {
        const finalState = await ctx.payments.state(session.id);
        C(P, CHECKS[1], held.stock === expectedHeld && Boolean(released?.value) && Boolean(nextSweep?.value) && settledUnits.reserved === before.reserved
          && settledUnits.stock === before.stock - orderStillHolds && JSON.stringify(finalState.reservations) === JSON.stringify(['released:2:checkout_expired']),
        { stock: { before: before.stock, held: held.stock, afterRelease: afterRelease.stock, afterAnotherSweep: settledUnits.stock }, reserved: [before.reserved, settledUnits.reserved],
          anotherSweepRan: Boolean(nextSweep?.value), reservations: finalState.reservations }, 'las dos unidades vuelven una vez: otra corrida del barrido no devuelve nada más');
      }
      if (order) {
        C(P, CHECKS[3], held.stock === expectedHeld && Boolean(cancelled?.value) && Boolean(nextExpiry?.value) && settledUnits.in_orders === before.in_orders
          && settledUnits.stock === before.stock - sessionStillHolds,
        { stock: { before: before.stock, held: held.stock, afterAnotherRun: settledUnits.stock }, inOrders: [before.in_orders, settledUnits.in_orders], anotherRunRan: Boolean(nextExpiry?.value) },
        'la unidad del pedido vuelve una vez: otra corrida del trabajo no devuelve nada más');
      }
    } finally {
      if (orderReady) {
        const reset = await ctx.http.restWrite(owner, 'PATCH', `businesses?id=eq.${id}&select=id`, { abandoned_order_minutes: null }, { businessId: id });
        if (!reset.ok) ctx.log(`expiry: no se pudo volver abandoned_order_minutes a null (${reset.status} ${reset.code}); lo hace el cierre de fase`);
      }
      ctx.evidence.write('phase-expiry.json', { at: nowIso(), ...evidence });
    }
  },
};
