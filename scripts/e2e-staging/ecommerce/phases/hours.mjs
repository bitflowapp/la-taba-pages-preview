// FASE hours — el horario lo aplica el alta del pedido, con el reloj real.
//
// Las grillas se arman a partir de la hora de pared del comercio (su huso), de modo
// que «ahora» quede adentro o afuera a propósito, incluida una franja que cruza la
// medianoche. Cerrado significa: el pedido no nace y no se toca el stock.
import { GRID_24X7, TENANT, hhmm, localClock, nowIso, sleep, sqlUuid, weeklyGrid, windowContains } from '../env.mjs';
import { brief, refusal, refused } from '../http.mjs';
import { storefrontCatalogQuery } from '../orders.mjs';

const P = 'hours';

export default {
  id: P,
  title: 'horarios: grilla 24x7, fuera de hora, cruce de medianoche, excepción de fecha y pausa manual',
  requires: [],
  async run(ctx) {
    const C = ctx.rec.check;
    const id = ctx.tenant.id;
    const { owner, staff } = ctx.actors;
    const customer = await ctx.identities.customer('hours');
    const states = [];

    // Cerca de la medianoche local una excepción «de hoy» cambiaría de día en medio de la prueba.
    let clock = localClock(TENANT.timezone);
    if (clock.minutes >= 1436) { await sleep((1441 - clock.minutes) * 60_000); clock = localClock(TENANT.timezone); }

    const setGrid = async (grid) => {
      const out = [];
      for (const channel of ['delivery', 'pickup']) {
        out.push(await ctx.http.call(owner, 'set_business_service_hours', { p_business_id: id, p_channel: channel, p_hours: grid }));
      }
      ctx.ledger.tenantChanges.push({ kind: 'hours_replaced', at: nowIso() }); ctx.persist();
      return out.every((r) => r.ok && r.data?.ok === true);
    };
    const availability = async (channel) => (await ctx.http.call(null, 'commerce_availability', { p_business_id: id, p_channel: channel, p_context: {} })).data || {};
    const serviceStatus = async () => (ctx.caps.service_status ? (await ctx.http.call(null, 'get_business_service_status', { p_business_id: id })).data : null);

    // Un estado = una configuración + lo que se espera de un pedido de retiro y uno con envío.
    const probe = async (name, { accepts, reason = null, expectCode = '55000', expectMessage = 'BUSINESS_CLOSED', channels = ['pickup', 'delivery'], statusReason = null }) => {
      const before = await ctx.orders.footprint();
      const attempts = {};
      for (const channel of channels) {
        attempts[channel] = await ctx.orders.create(customer, { mode: channel, role: 'MAIN', quantity: channel === 'delivery' ? 2 : 1, label: `hours:${name}:${channel}` });
      }
      const after = await ctx.orders.footprint();
      const avail = Object.fromEntries(await Promise.all(channels.map(async (channel) => [channel, await availability(channel)])));
      const status = await serviceStatus();
      const created = Object.values(attempts).filter((a) => a.order).length;
      const entry = { name, at: nowIso(), localTime: localClock(TENANT.timezone).time, accepts, reason,
        attempts: Object.fromEntries(Object.entries(attempts).map(([channel, a]) => [channel, { ...brief(a.r), publicCode: a.order?.public_code || null }])),
        availability: Object.fromEntries(Object.entries(avail).map(([channel, a]) => [channel, { ordering_ready: a.ordering_ready, is_open: a.is_open, next_open_at: a.next_open_at }])),
        serviceStatus: status?.channels || null, ordersCreated: created };
      states.push(entry);
      if (accepts) {
        C(P, `${name}_ORDERS_ACCEPTED`, created === channels.length, entry.attempts);
        C(P, `${name}_AVAILABILITY_SAYS_OPEN`, channels.every((c) => avail[c].ordering_ready === true && avail[c].is_open === true), entry.availability);
      } else {
        C(P, `${name}_ORDERS_REFUSED`, Object.values(attempts).every((a) => refused(a.r, expectCode, { message: expectMessage })),
          entry.attempts, refusal(expectCode, { message: expectMessage }));
        C(P, `${name}_NOTHING_CREATED_AND_STOCK_UNTOUCHED`, ctx.orders.sameFootprint(before, after), { orders: [before.orders, after.orders], changed: ctx.orders.footprintDiff(before, after) });
        C(P, `${name}_AVAILABILITY_SAYS_NOT_ACCEPTING`, channels.every((c) => !(avail[c].ordering_ready === true && avail[c].is_open === true)), entry.availability);
      }
      if (status) {
        C(P, `${name}_SERVICE_STATUS_AGREES`, channels.every((c) => status.channels?.[c]?.state === (accepts ? 'OPEN' : 'CLOSED')
          && (accepts || !statusReason || status.channels[c].reason === statusReason)
          && (accepts ? status.channels[c].opens_at === null : status.channels[c].closes_at === null)), status.channels);
      } else {
        ctx.rec.skipCheck(P, `${name}_SERVICE_STATUS_AGREES`, 'service_status');
      }
      return entry;
    };

    // 1. Grilla 24x7.
    await probe('GRID_24X7', { accepts: true });

    // 2. Franja que excluye «ahora» (abre en 2 h, cierra en 4 h).
    const now = localClock(TENANT.timezone).minutes;
    const later = { opens: (now + 120) % 1440, closes: (now + 240) % 1440 };
    C(P, 'OUTSIDE_WINDOW_GRID_SET', await setGrid(weeklyGrid(hhmm(later.opens), hhmm(later.closes))) && !windowContains(later.opens, later.closes, now),
      { now: hhmm(now), window: `${hhmm(later.opens)}-${hhmm(later.closes)}` });
    const closed = await probe('OUTSIDE_WINDOW', { accepts: false, statusReason: 'outside_hours' });
    const nextOpen = Date.parse(closed.availability.pickup.next_open_at || '');
    C(P, 'OUTSIDE_WINDOW_NEXT_OPENING_IS_THE_WINDOW_START', Number.isFinite(nextOpen) && Math.abs(nextOpen - (Date.now() + 120 * 60_000)) < 3 * 60_000,
      { next_open_at: closed.availability.pickup.next_open_at, expectedAround: new Date(Date.now() + 120 * 60_000).toISOString() });
    if (closed.serviceStatus) {
      C(P, 'OUTSIDE_WINDOW_SERVICE_STATUS_OPENS_AT_MATCHES', Math.abs(Date.parse(closed.serviceStatus.pickup?.opens_at || '') - nextOpen) < 60_000,
        { opens_at: closed.serviceStatus.pickup?.opens_at, next_open_at: closed.availability.pickup.next_open_at });
    } else { ctx.rec.skipCheck(P, 'OUTSIDE_WINDOW_SERVICE_STATUS_OPENS_AT_MATCHES', 'service_status'); }

    // 3. Franja que cruza la medianoche y EXCLUYE «ahora» (abre en 1 h, cierra hace 1 h: 22 horas).
    const now2 = localClock(TENANT.timezone).minutes;
    const wrapOut = { opens: (now2 + 60) % 1440, closes: (now2 - 60 + 1440) % 1440 };
    C(P, 'CROSS_MIDNIGHT_EXCLUDING_GRID_SET', await setGrid(weeklyGrid(hhmm(wrapOut.opens), hhmm(wrapOut.closes))) && !windowContains(wrapOut.opens, wrapOut.closes, now2),
      { now: hhmm(now2), window: `${hhmm(wrapOut.opens)}-${hhmm(wrapOut.closes)}`, crossesMidnight: wrapOut.opens > wrapOut.closes });
    await probe('CROSS_MIDNIGHT_EXCLUDING_NOW', { accepts: false, statusReason: 'outside_hours' });

    // 4. Franja que cruza la medianoche e INCLUYE «ahora» (abrió hace 2 h, cierra dentro de 20 h).
    const now3 = localClock(TENANT.timezone).minutes;
    const wrapIn = { opens: (now3 - 120 + 1440) % 1440, closes: (now3 - 240 + 1440) % 1440 };
    C(P, 'CROSS_MIDNIGHT_INCLUDING_GRID_SET', await setGrid(weeklyGrid(hhmm(wrapIn.opens), hhmm(wrapIn.closes))) && windowContains(wrapIn.opens, wrapIn.closes, now3),
      { now: hhmm(now3), window: `${hhmm(wrapIn.opens)}-${hhmm(wrapIn.closes)}`, crossesMidnight: wrapIn.opens > wrapIn.closes,
        openBy: now3 >= wrapIn.opens ? 'cola de la franja de hoy' : 'arrastre de la franja de ayer' });
    const wrapOpen = await probe('CROSS_MIDNIGHT_INCLUDING_NOW', { accepts: true });
    if (wrapOpen.serviceStatus) {
      const closesAt = Date.parse(wrapOpen.serviceStatus.pickup?.closes_at || '');
      C(P, 'CROSS_MIDNIGHT_SERVICE_STATUS_CLOSES_AT_IS_THE_WINDOW_END', Math.abs(closesAt - (Date.now() + 20 * 3_600_000)) < 3 * 60_000, { closes_at: wrapOpen.serviceStatus.pickup?.closes_at });
    } else { ctx.rec.skipCheck(P, 'CROSS_MIDNIGHT_SERVICE_STATUS_CLOSES_AT_IS_THE_WINDOW_END', 'service_status'); }

    // 5. De vuelta a 24x7; excepción de fecha cerrada para HOY (todos los canales).
    C(P, 'GRID_24X7_RESTORED', await setGrid(GRID_24X7), null);
    const today = localClock(TENANT.timezone).date;
    const exception = await ctx.http.call(owner, 'set_business_service_exception', { p_business_id: id, p_channel: 'all', p_on_date: today, p_is_closed: true,
      p_opens_at: null, p_closes_at: null, p_note: `${ctx.runId} QA cierre de fecha` });
    ctx.ledger.tenantChanges.push({ kind: 'service_exception', date: today, channel: 'all', id: exception.data?.exception_id || null, at: nowIso() }); ctx.persist();
    C(P, 'CLOSED_DATE_EXCEPTION_SET', exception.ok && Boolean(exception.data?.exception_id), brief(exception));
    await probe('CLOSED_DATE_EXCEPTION', { accepts: false, statusReason: 'exception_closed' });
    const removed = await ctx.http.call(owner, 'delete_business_service_exception', { p_business_id: id, p_exception_id: exception.data?.exception_id });
    // Excepción sólo para retiro: el envío sigue abierto.
    const pickupOnly = await ctx.http.call(owner, 'set_business_service_exception', { p_business_id: id, p_channel: 'pickup', p_on_date: today, p_is_closed: true,
      p_opens_at: null, p_closes_at: null, p_note: `${ctx.runId} QA cierre de retiro` });
    ctx.ledger.tenantChanges.push({ kind: 'service_exception', date: today, channel: 'pickup', id: pickupOnly.data?.exception_id || null, at: nowIso() }); ctx.persist();
    await probe('PICKUP_ONLY_EXCEPTION', { accepts: false, channels: ['pickup'], statusReason: 'exception_closed' });
    const deliveryStillOpen = await availability('delivery');
    C(P, 'PICKUP_ONLY_EXCEPTION_LEAVES_DELIVERY_OPEN', deliveryStillOpen.ordering_ready === true && deliveryStillOpen.is_open === true,
      { ordering_ready: deliveryStillOpen.ordering_ready, is_open: deliveryStillOpen.is_open });
    const removed2 = await ctx.http.call(owner, 'delete_business_service_exception', { p_business_id: id, p_exception_id: pickupOnly.data?.exception_id });
    C(P, 'EXCEPTIONS_REMOVED', removed.ok && removed2.ok, { all: brief(removed), pickup: brief(removed2) });

    // 6. Pausa manual (la puede hacer el equipo). La tienda deja de vender y deja de mostrarse.
    const paused = await ctx.http.call(staff, 'set_business_open_state', { p_business_id: id, p_status: 'paused' });
    ctx.ledger.tenantChanges.push({ kind: 'paused', at: nowIso() }); ctx.persist();
    C(P, 'MANUAL_PAUSE_SET_BY_STAFF', paused.ok && paused.data?.status === 'paused', brief(paused));
    await probe('MANUAL_PAUSE', { accepts: false, expectMessage: 'no esta habilitado', statusReason: 'business_paused' });
    const shelfPaused = await ctx.http.restGet(null, storefrontCatalogQuery(id));
    C(P, 'MANUAL_PAUSE_HIDES_THE_PUBLIC_CATALOG', shelfPaused.status === 200 && shelfPaused.rows?.length === 0, { ...brief(shelfPaused), rows: shelfPaused.rows?.length });
    const resumed = await ctx.http.call(staff, 'set_business_open_state', { p_business_id: id, p_status: 'open' });
    C(P, 'STORE_REOPENED_BY_STAFF', resumed.ok && resumed.data?.status === 'open', brief(resumed));

    // 7. Estado final: abierto, 24x7, sin excepciones.
    await probe('BACK_TO_24X7', { accepts: true, channels: ['pickup'] });
    const final = (await ctx.env.observe(`select b.status, b.hours_enforced,
      (select count(*) from public.business_service_exceptions e where e.business_id = b.id)::int as exceptions,
      (select count(*) from public.business_service_hours h where h.business_id = b.id and h.opens_at = time '00:00' and h.closes_at = time '24:00')::int as full_day_rows,
      (select count(*) from public.business_service_hours h where h.business_id = b.id)::int as rows
      from public.businesses b where b.id = ${sqlUuid(id)}`))[0];
    C(P, 'HOURS_CONFIGURATION_RESTORED', final.status === 'open' && final.hours_enforced && final.exceptions === 0 && final.full_day_rows === 14 && final.rows === 14, final);
    ctx.evidence.write('phase-hours.json', { timezone: TENANT.timezone, startedAtLocal: clock, states });
  },
};
