// FASE abuse — el guardián de admisión frena lo que tiene que frenar, y nada más.
//
// La fase `tenant` ya prueba una vez por corrida los topes de pedidos SIN ATENDER (por
// cliente y por origen), que un reintento idempotente no se frena y el tope de
// unidades. Acá va el resto del guardián (20261001180000), siempre por HTTP y con las
// sesiones reales:
//
//   · las VENTANAS de diez minutos: por cliente, por origen de red y por comercio, cada
//     una con su `Retry-After` de 600 s;
//   · el modo `monitor`: anota lo que habría frenado y deja pasar;
//   · los encabezados de reenvío FALSIFICADOS: el guardián sólo cree en
//     `cf-connecting-ip`, que pone el borde; todo lo demás lo escribe el cliente;
//   · el canal de CHECKOUT, que entra por `service_role` (lo llama la Edge Function): no
//     mira el origen —sus encabezados no son del cliente— y comparte el cupo del cliente
//     con el pedido manual;
//   · el ENFRIAMIENTO: veinte frenos de un mismo sujeto en dos ventanas lo dejan afuera
//     por diez minutos, en los dos canales, sin arrastrar a los demás.
//
// NINGÚN ESCENARIO NECESITA ELEGIR EL ORIGEN. En Staging el origen es uno solo (el de la
// máquina que corre, lo pone Cloudflare) y en el stack también (lo declara el
// transporte, uno por corrida). Por eso los frenos manuales de esta fase son pocos y
// contados: cada uno suma también al origen, y veinte en dos ventanas dejarían a ESE
// origen —es decir, al resto de la corrida— en enfriamiento. El enfriamiento se
// provoca por el canal de checkout, que anota sólo al cliente.
import { nowIso, sqlUuid } from '../env.mjs';
import { CODES, brief, refusal, refused } from '../http.mjs';
import { ROOMY_INTAKE_LIMITS, intakeTrail, setIntakeLimits } from '../tenant.mjs';

const P = 'abuse';
// Tope propio de frenos por el canal manual en esta fase. Con los tres de la prueba de límites de la fase
// `tenant`, el origen de la corrida queda lejos de los veinte del enfriamiento.
const MANUAL_REFUSAL_BUDGET = 8;
const COOLDOWN_AFTER = 20;
const CHECKOUT_CHECKS = Object.freeze(['CHECKOUT_CHANNEL_DOES_NOT_COUNT_THE_CLIENT_ORIGIN', 'CHECKOUT_CHANNEL_SHARES_THE_CUSTOMER_PENDING_QUOTA',
  'TWENTY_REFUSALS_PUT_THE_CUSTOMER_IN_COOLDOWN', 'COOLDOWN_REACHES_THE_MANUAL_CHANNEL_TOO', 'COOLDOWN_IS_PER_SUBJECT_AND_LEAVES_THE_ORIGIN_OUT']);

export default {
  id: P,
  title: 'abuso: ventanas por cliente, origen y comercio, modo monitor, encabezados falsificados, canal de checkout y enfriamiento',
  requires: ['order_intake_guard'],
  async run(ctx) {
    const C = ctx.rec.check;
    const id = ctx.tenant.id;
    const target = ctx.env.target;
    const { staff, admin } = ctx.actors;
    let manualRefusals = 0;
    const limited = (reason) => ({ message: 'ORDER_RATE_LIMITED', details: reason });
    const checkoutLimited = (reason) => ({ message: 'demasiados intentos de checkout', details: reason });
    const seen = (r) => ({ ...brief(r), retryAfter: r?.headers?.retryAfter ?? null });
    const order = (customer, label, call = {}) => ctx.orders.create(customer, { mode: 'pickup', role: 'MAIN', quantity: 1, label: `abuse:${label}`, call });
    // Un pedido que se espera frenado: se cuenta contra el presupuesto ANTES de mandarlo y se mira que no haya
    // dejado nada (ni pedido, ni renglón, ni token, ni stock).
    const refusedOrder = async (customer, label, call = {}) => {
      manualRefusals += 1;
      if (manualRefusals > MANUAL_REFUSAL_BUDGET) throw Error(`ABUSE_MANUAL_REFUSAL_BUDGET_EXCEEDED:${manualRefusals}`);
      const before = await ctx.orders.footprint();
      const out = await order(customer, label, call);
      const after = await ctx.orders.footprint();
      return { ...out, changed: ctx.orders.footprintDiff(before, after) };
    };
    const cancelAll = async (orders) => {
      for (const created of orders.filter((o) => o?.order)) {
        const st = await ctx.orders.state(created.order.id);
        if (!['cancelled', 'delivered'].includes(st.status)) await ctx.orders.cancel(admin, created.order.id, Number(st.revision), `${ctx.runId} QA abuso`);
      }
    };
    const limits = (changes, why) => setIntakeLimits(ctx, { ...ROOMY_INTAKE_LIMITS, ...changes }, why);
    const trailStart = await intakeTrail(ctx);

    try {
      // Lo que quedó sin atender de otras fases contaría contra los topes.
      await ctx.orders.settle('antes de la fase de abuso');

      // ── 1. Ventana por cliente ─────────────────────────────────────────────
      // Dos pedidos en la ventana (cancelados enseguida: no cuentan como «sin atender») y un tope de dos.
      const windowCustomer = await ctx.identities.customer('abuse-window', { address: false });
      const firstTwo = [await order(windowCustomer, 'window-1'), await order(windowCustomer, 'window-2')];
      await cancelAll(firstTwo);
      await limits({ order_rate_limit_per_10_minutes: 2 }, 'prove the 10-minute window per customer');
      const third = await refusedOrder(windowCustomer, 'window-3');
      C(P, 'CUSTOMER_WINDOW_REFUSES_THE_ORDER_PAST_ITS_LIMIT', firstTwo.every((o) => o.order) && refused(third.r, CODES.INTAKE_LIMIT, limited('customer_rate'))
        && third.r.headers.retryAfter === '600' && third.changed.length === 0,
      { admitted: firstTwo.map((o) => brief(o.r)), refused: seen(third.r), changed: third.changed }, `${refusal(CODES.INTAKE_LIMIT, limited('customer_rate'))} · Retry-After 600 · nada creado`);

      // ── 2. Ventana por origen de red ───────────────────────────────────────
      // El origen de la corrida ya tiene admisiones en la ventana (los dos de arriba, recién creados): con tope
      // uno, un cliente NUEVO —sin nada propio que lo frene— queda afuera por el origen.
      await limits({ order_ip_rate_limit_per_10_minutes: 1 }, 'prove the 10-minute window per network origin');
      const originCustomer = await ctx.identities.customer('abuse-origin', { address: false });
      const byOrigin = await refusedOrder(originCustomer, 'origin-window');
      C(P, 'ORIGIN_WINDOW_REFUSES_A_NEW_CUSTOMER_FROM_THE_SAME_ORIGIN', refused(byOrigin.r, CODES.INTAKE_LIMIT, limited('ip_rate')) && byOrigin.r.headers.retryAfter === '600'
        && byOrigin.changed.length === 0, { refused: seen(byOrigin.r), changed: byOrigin.changed }, `${refusal(CODES.INTAKE_LIMIT, limited('ip_rate'))} · Retry-After 600`);

      // ── 3. Ventana por comercio ────────────────────────────────────────────
      // El último freno contra la rotación de identidades y de orígenes: cuenta todos los pedidos del local.
      await limits({ order_business_rate_limit_per_10_minutes: 1 }, 'prove the 10-minute window per business');
      const businessCustomer = await ctx.identities.customer('abuse-business', { address: false });
      const byBusiness = await refusedOrder(businessCustomer, 'business-window');
      C(P, 'BUSINESS_WINDOW_REFUSES_ANY_CUSTOMER_PAST_ITS_LIMIT', refused(byBusiness.r, CODES.INTAKE_LIMIT, limited('business_rate')) && byBusiness.r.headers.retryAfter === '600'
        && byBusiness.changed.length === 0, { refused: seen(byBusiness.r), changed: byBusiness.changed }, `${refusal(CODES.INTAKE_LIMIT, limited('business_rate'))} · Retry-After 600`);

      // ── 4. Modo monitor: anota y deja pasar ────────────────────────────────
      await limits({ max_pending_orders_per_customer: 1, order_intake_guard_mode: 'monitor' }, 'prove monitor mode records without refusing');
      const monitored = await ctx.identities.customer('abuse-monitor', { address: false });
      const eventsBefore = (await intakeTrail(ctx)).events_by_type || {};
      const m1 = await order(monitored, 'monitor-1');
      const m2 = await order(monitored, 'monitor-2');
      const eventsAfter = (await intakeTrail(ctx)).events_by_type || {};
      const wouldBlock = 'order_intake_would_block:customer_pending';
      C(P, 'MONITOR_MODE_RECORDS_WHAT_IT_WOULD_REFUSE_AND_LETS_IT_THROUGH', Boolean(m1.order && m2.order) && m2.r.status === 200
        && Number(eventsAfter[wouldBlock] || 0) === Number(eventsBefore[wouldBlock] || 0) + 1,
      { first: brief(m1.r), second: brief(m2.r), wouldBlockEvents: [eventsBefore[wouldBlock] || 0, eventsAfter[wouldBlock] || 0] }, 'los dos pedidos entran y queda un evento «would_block»');
      await cancelAll([m1, m2]);

      // ── 5. Encabezados de reenvío falsificados ─────────────────────────────
      // El origen al tope de pedidos sin atender (uno), y un cliente nuevo que dice venir de otras redes por
      // todos los encabezados que un cliente puede escribir. El guardián no los mira: lo frena el origen.
      await limits({}, 'back to the roomy baseline before the forged-header proof');
      const holder = await ctx.identities.customer('abuse-holder', { address: false });
      const held = await order(holder, 'origin-holder');
      await limits({ max_pending_orders_per_ip: 1 }, 'prove forged forwarding headers do not change the network origin');
      const forger = await ctx.identities.customer('abuse-forger', { address: false });
      const forgedHeaders = { 'x-forwarded-for': '198.51.100.77', 'x-real-ip': '198.51.100.78', forwarded: 'for=198.51.100.79;proto=https',
        'x-client-ip': '198.51.100.80', 'sb-forwarded-for': '198.51.100.81' };
      const forged = await refusedOrder(forger, 'forged-forwarding-headers', { headers: forgedHeaders });
      C(P, 'FORGED_FORWARDING_HEADERS_DO_NOT_MOVE_THE_ORDER_TO_ANOTHER_ORIGIN', Boolean(held.order) && refused(forged.r, CODES.INTAKE_LIMIT, limited('ip_pending'))
        && forged.changed.length === 0, { holder: brief(held.r), forged: seen(forged.r), headers: Object.keys(forgedHeaders), changed: forged.changed },
      `${refusal(CODES.INTAKE_LIMIT, limited('ip_pending'))}: el origen es el del borde, no el que dice el cliente`);
      // `cf-connecting-ip` escrito por el cliente: en Staging Cloudflare lo rechaza con 403 antes del backend.
      const withoutEdge = target.lacks('cloudflare');
      if (withoutEdge) ctx.rec.skipOnTarget(P, 'A_CLIENT_SUPPLIED_CF_CONNECTING_IP_IS_REFUSED_AT_THE_EDGE', withoutEdge);
      else {
        const before = await ctx.orders.footprint();
        const spoofed = await order(forger, 'forged-cf-connecting-ip', { headers: { 'cf-connecting-ip': '198.51.100.90' } });
        const after = await ctx.orders.footprint();
        C(P, 'A_CLIENT_SUPPLIED_CF_CONNECTING_IP_IS_REFUSED_AT_THE_EDGE', spoofed.r.status === 403 && ctx.orders.sameFootprint(before, after),
          { http: spoofed.r.status, changed: ctx.orders.footprintDiff(before, after) }, 'HTTP 403 del borde y nada creado');
      }

      // ── 6. El canal de checkout ────────────────────────────────────────────
      if (!ctx.caps.checkout_payments) {
        for (const name of CHECKOUT_CHECKS) ctx.rec.skipCheck(P, name, 'checkout_payments');
      } else {
        await ctx.payments.ensureFixture();
        // Tres pagadores con sesión (también hacen pedidos manuales). El del enfriamiento (p3) llega sin un solo freno
        // anotado: los veinte que lo dejan afuera son exactamente los de este escenario.
        // Son de un grupo propio (`abuse`): quedan con frenos anotados y uno en enfriamiento, y ninguna otra fase los usa.
        const [p1, p2, p3] = await ctx.identities.payers(3, { pool: 'abuse' });
        const sessionsOf = async (payer) => (await ctx.env.observe(`select count(*)::int as n from public.checkout_sessions
          where business_id = ${sqlUuid(id)} and customer_id = ${sqlUuid(payer.userId)}`))[0].n;
        // a. El origen sigue al tope (el pedido del «holder»): por el canal de checkout un pagador entra igual.
        const open = await ctx.payments.createSession(p1, { role: 'MAIN', quantity: 1, label: 'abuse-checkout-origin' });
        C(P, CHECKOUT_CHECKS[0], Boolean(open.session) && open.r.status === 200, { session: brief(open.r) },
          'con el origen al tope de pedidos sin atender, la sesión de checkout entra: ese canal no mira el origen');
        // b. Mismo cupo de cliente: p2 con un pedido manual sin atender y tope uno; su checkout se frena.
        await limits({ max_pending_orders_per_customer: 1 }, 'prove both channels share the customer pending quota');
        const manual = await order(p2, 'abuse-shared-quota-manual');
        const before = { sessions: await sessionsOf(p2), footprint: await ctx.orders.footprint() };
        const shared = await ctx.payments.createSession(p2, { role: 'MAIN', quantity: 1, label: 'abuse-shared-quota', quiet: true });
        const after = { sessions: await sessionsOf(p2), footprint: await ctx.orders.footprint() };
        C(P, CHECKOUT_CHECKS[1], Boolean(manual.order) && refused(shared.r, CODES.CHECKOUT_LIMIT, checkoutLimited('customer_pending')) && shared.r.headers.retryAfter === '120'
          && after.sessions === before.sessions && ctx.orders.sameFootprint(before.footprint, after.footprint),
        { manual: brief(manual.r), checkout: seen(shared.r), sessions: [before.sessions, after.sessions] }, `${refusal(CODES.CHECKOUT_LIMIT, checkoutLimited('customer_pending'))} · Retry-After 120 · nada reservado`);
        await cancelAll([manual]);
        // c. Enfriamiento: p3 abre una sesión (su único lugar) y la intenta veinte veces más. Cada freno se anota
        //    sólo al cliente: el canal de checkout no tiene origen. El intento veintiuno ya es «enfriamiento».
        const lone = await ctx.payments.createSession(p3, { role: 'MAIN', quantity: 1, label: 'abuse-cooldown-open' });
        const answers = [];
        for (let i = 0; i < COOLDOWN_AFTER; i += 1) {
          answers.push((await ctx.payments.createSession(p3, { role: 'MAIN', quantity: 1, label: `abuse-cooldown-${i}`, quiet: true })).r);
        }
        const cooled = await ctx.payments.createSession(p3, { role: 'MAIN', quantity: 1, label: 'abuse-cooldown-after', quiet: true });
        const reasons = answers.reduce((acc, r) => { const key = `${r.status} ${r.code ?? ''} ${r.error?.details ?? ''}`.trim(); acc[key] = (acc[key] || 0) + 1; return acc; }, {});
        C(P, CHECKOUT_CHECKS[2], Boolean(lone.session) && answers.every((r) => refused(r, CODES.CHECKOUT_LIMIT, checkoutLimited('customer_pending')))
          && refused(cooled.r, CODES.CHECKOUT_LIMIT, checkoutLimited('cooldown')) && cooled.r.headers.retryAfter === '600',
        { open: brief(lone.r), refusals: reasons, afterTwenty: seen(cooled.r) }, `veinte veces ${refusal(CODES.CHECKOUT_LIMIT, checkoutLimited('customer_pending'))} y después ${refusal(CODES.CHECKOUT_LIMIT, checkoutLimited('cooldown'))} · Retry-After 600`);
        // d. El enfriamiento es del cliente: también lo frena en el pedido manual.
        manualRefusals += 1;
        const manualCooled = await order(p3, 'abuse-cooldown-manual');
        C(P, CHECKOUT_CHECKS[3], refused(manualCooled.r, CODES.INTAKE_LIMIT, limited('cooldown')) && manualCooled.r.headers.retryAfter === '600',
          seen(manualCooled.r), `${refusal(CODES.INTAKE_LIMIT, limited('cooldown'))} · Retry-After 600`);
        // e. …y de nadie más: un cliente nuevo, desde el MISMO origen, entra.
        await limits({}, 'back to the roomy baseline: the cooldown must not reach other subjects');
        const bystander = await ctx.identities.customer('abuse-bystander', { address: false });
        const passes = await order(bystander, 'abuse-cooldown-bystander');
        C(P, CHECKOUT_CHECKS[4], Boolean(passes.order) && passes.r.status === 200, brief(passes.r), 'HTTP 200: el origen de la corrida no quedó en enfriamiento');
        await cancelAll([passes]);
      }

      // ── 7. Lo que quedó escrito ────────────────────────────────────────────
      // Cada freno suma uno a la fila de su cliente (y a la de su origen, y a la del comercio si es de comercio):
      // el total de frenos crece por lo menos lo que se frenó. El motivo NO se puede leer de esas filas —guardan el
      // último de su ventana, y la del origen lo pisa con cada freno—: lo dice el evento de abuso, que se escribe
      // con el PRIMER freno de cada sujeto en su ventana. Por eso cada escenario usa un cliente nuevo.
      const trail = await intakeTrail(ctx);
      const startEvents = trailStart.events_by_type || {};
      const endEvents = trail.events_by_type || {};
      const expectedEvents = ['order_intake_blocked:customer_rate', 'order_intake_blocked:ip_rate', 'order_intake_blocked:business_rate', 'order_intake_blocked:ip_pending',
        'order_intake_would_block:customer_pending', ...(ctx.caps.checkout_payments ? ['order_intake_blocked:customer_pending'] : [])];
      const refusedRequests = manualRefusals + (ctx.caps.checkout_payments ? COOLDOWN_AFTER + 2 : 0);
      const missingEvents = expectedEvents.filter((type) => !(Number(endEvents[type] || 0) > Number(startEvents[type] || 0)));
      C(P, 'EVERY_REFUSAL_IS_RECORDED_WITH_ITS_REASON', missingEvents.length === 0 && trail.blocks - trailStart.blocks >= refusedRequests,
        { blocks: [trailStart.blocks, trail.blocks], refusedRequests, missingEvents, events: endEvents },
        'un evento de abuso por cada motivo probado y, en las filas de frenos, por lo menos un freno por pedido frenado');
      // El presupuesto de frenos del origen: la corrida sigue desde ese mismo origen y no puede quedar en enfriamiento.
      const originBlocks = (await ctx.env.observe(`select coalesce(max(n), 0)::int as n from (select subject_hash, sum(blocked_count)::int as n
        from private.order_intake_blocks where business_id = ${sqlUuid(id)} and scope = 'ip' and window_started_at > now() - interval '21 minutes' group by 1) s`))[0].n;
      C(P, 'THE_RUN_ORIGIN_STAYS_BELOW_THE_COOLDOWN', originBlocks < COOLDOWN_AFTER, { originBlocksInTwoWindows: originBlocks, manualRefusalsInThisPhase: manualRefusals, cooldownAt: COOLDOWN_AFTER },
        `menos de ${COOLDOWN_AFTER} frenos del origen en dos ventanas`);
      ctx.evidence.write('phase-abuse.json', { at: nowIso(), manualRefusals, originBlocks, trail: { start: trailStart, end: trail } });
    } finally {
      await setIntakeLimits(ctx, ROOMY_INTAKE_LIMITS, 'restore the roomy baseline after the abuse phase');
    }
  },
};

