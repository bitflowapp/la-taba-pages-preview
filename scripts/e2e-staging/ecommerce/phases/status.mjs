// FASE status — el estado del servicio, en los BORDES de cada franja.
//
// `get_business_service_status(negocio, instante)` es lo que la tienda muestra («abierto
// hasta las 18», «abre a las 10»). La fase `hours` ya la compara con lo que hace el alta
// del pedido en el instante real; acá se le pregunta por instantes ELEGIDOS —el segundo
// anterior y el segundo exacto de cada apertura y de cada cierre, el cruce de medianoche,
// un cierre por fecha, la ventana de alcohol— para probar los bordes sin esperar al reloj.
// La consulta es pública y de sólo lectura: se llama sin sesión.
import { GRID_24X7, TENANT, dateAfter, instantAt, localClock, nowIso, sqlUuid, weeklyGrid } from '../env.mjs';
import { CODES, brief, refusal, refused } from '../http.mjs';
import { ensureThrowawayBusiness } from '../tenant.mjs';

const P = 'status';
const sameInstant = (a, b) => Boolean(a) && Boolean(b) && Date.parse(a) === Date.parse(b);

export default {
  id: P,
  title: 'estado del servicio: bordes de franja, cruce de medianoche, cierre por fecha, alcohol, pausa y canal apagado',
  requires: ['service_status'],
  async run(ctx) {
    const C = ctx.rec.check;
    const id = ctx.tenant.id;
    const { owner, staff } = ctx.actors;
    const tz = TENANT.timezone;
    const statusAt = (iso, businessId = id, options = {}) => ctx.http.call(null, 'get_business_service_status', { p_business_id: businessId, ...(iso ? { p_at: iso } : {}) }, options);
    const setHours = (channel, grid) => ctx.http.call(owner, 'set_business_service_hours', { p_business_id: id, p_channel: channel, p_hours: grid });
    // Un día entero por delante y sin nada configurado encima: los bordes no dependen de la hora en que corre esto.
    const today = localClock(tz).date;
    const day = dateAfter(today, 3);
    const next = dateAfter(day, 1);
    const at = (date, time) => instantAt(tz, date, time);
    const samples = [];
    // Un borde: a `instant`, el canal está en `state` (y, si se piden, con ese motivo, esa apertura y ese cierre).
    const edge = async (label, date, time, channel, want) => {
      const instant = at(date, time);
      const r = await statusAt(instant);
      const seen = r.data?.channels?.[channel] || null;
      const ok = r.status === 200 && seen?.state === want.state
        && (want.reason === undefined || seen.reason === want.reason)
        && (want.opens === undefined || (want.opens === null ? seen.opens_at === null : sameInstant(seen.opens_at, want.opens)))
        && (want.closes === undefined || (want.closes === null ? seen.closes_at === null : sameInstant(seen.closes_at, want.closes)));
      samples.push({ label, local: `${date} ${time}`, instant, channel, want, seen, ok });
      return ok;
    };
    const failed = (prefix) => samples.filter((s) => s.label.startsWith(prefix) && !s.ok).map((s) => ({ at: s.local, channel: s.channel, want: s.want, seen: s.seen }));
    const config = async () => (await ctx.env.observe(`select md5(row_to_json(b)::text) as business,
      (select md5(coalesce(string_agg(h.channel || h.weekday || h.opens_at || h.closes_at, ',' order by h.channel, h.weekday, h.opens_at), '')) from public.business_service_hours h where h.business_id = b.id) as hours,
      (select count(*) from public.business_service_exceptions e where e.business_id = b.id)::int as exceptions
      from public.businesses b where b.id = ${sqlUuid(id)}`))[0];

    // ── 1. La forma de la respuesta, con la grilla 24x7 del tenant ────────────
    const before = { footprint: await ctx.orders.footprint(), config: await config() };
    const now = await statusAt(null);
    const channels = now.data?.channels || {};
    C(P, 'STATUS_ANSWERS_WITH_ITS_THREE_CHANNELS', now.status === 200 && now.data?.business_id === id && now.data?.timezone === tz && now.data?.hours_enforced === true
      && JSON.stringify(Object.keys(channels).sort()) === JSON.stringify(['alcohol', 'delivery', 'pickup'])
      && Object.values(channels).every((c) => ['OPEN', 'CLOSED'].includes(c.state) && 'reason' in c && 'opens_at' in c && 'closes_at' in c),
    { ...brief(now), keys: Object.keys(now.data || {}), channels });
    C(P, 'STATUS_24X7_IS_OPEN_WITH_NO_KNOWN_CLOSING', channels.delivery?.state === 'OPEN' && channels.pickup?.state === 'OPEN' && channels.pickup.closes_at === null
      && channels.pickup.reason === null, { delivery: channels.delivery, pickup: channels.pickup });
    C(P, 'STATUS_ALCOHOL_IS_CLOSED_WHILE_THE_BUSINESS_HAS_NO_ALCOHOL_POLICY', channels.alcohol?.state === 'CLOSED' && channels.alcohol.reason === 'alcohol_disabled', channels.alcohol);
    const repeated = await statusAt(null);
    const after = { footprint: await ctx.orders.footprint(), config: await config() };
    C(P, 'STATUS_QUERY_CHANGES_NOTHING', repeated.status === 200 && ctx.orders.sameFootprint(before.footprint, after.footprint) && JSON.stringify(before.config) === JSON.stringify(after.config),
      { changed: ctx.orders.footprintDiff(before.footprint, after.footprint), config: [before.config, after.config] });

    // ── 2. Franja de 10 a 18 en retiro; el envío sigue 24x7 ───────────────────
    const office = await setHours('pickup', weeklyGrid('10:00', '18:00'));
    ctx.ledger.tenantChanges.push({ kind: 'hours_replaced', channel: 'pickup', at: nowIso() }); ctx.persist();
    C(P, 'PICKUP_GRID_10_TO_18_SET', office.ok && office.data?.ok === true, brief(office));
    await edge('office', day, '09:59:59', 'pickup', { state: 'CLOSED', reason: 'outside_hours', opens: at(day, '10:00:00'), closes: null });
    await edge('office', day, '10:00:00', 'pickup', { state: 'OPEN', reason: null, opens: null, closes: at(day, '18:00:00') });
    await edge('office', day, '17:59:59', 'pickup', { state: 'OPEN', closes: at(day, '18:00:00') });
    await edge('office', day, '18:00:00', 'pickup', { state: 'CLOSED', reason: 'outside_hours', opens: at(next, '10:00:00') });
    await edge('office', day, '03:00:00', 'pickup', { state: 'CLOSED', reason: 'outside_hours', opens: at(day, '10:00:00') });
    C(P, 'OPENING_AND_CLOSING_EDGES_ARE_EXACT_TO_THE_SECOND', failed('office').length === 0, failed('office'),
      'cerrado hasta las 09:59:59, abierto desde las 10:00:00, abierto hasta las 17:59:59, cerrado desde las 18:00:00; cada respuesta con su próxima apertura o su cierre');
    await edge('independent', day, '03:00:00', 'delivery', { state: 'OPEN' });
    await edge('independent', day, '20:00:00', 'delivery', { state: 'OPEN' });
    C(P, 'CHANNELS_KEEP_THEIR_OWN_HOURS', failed('independent').length === 0, failed('independent'), 'el envío sigue abierto cuando el retiro está cerrado');

    // ── 3. Franja que cruza la medianoche: de 22 a 02 ─────────────────────────
    const night = await setHours('pickup', weeklyGrid('22:00', '02:00'));
    C(P, 'PICKUP_GRID_22_TO_02_SET', night.ok && night.data?.ok === true, brief(night));
    await edge('night', day, '21:59:59', 'pickup', { state: 'CLOSED', opens: at(day, '22:00:00') });
    await edge('night', day, '22:00:00', 'pickup', { state: 'OPEN', closes: at(next, '02:00:00') });
    await edge('night', day, '23:59:59', 'pickup', { state: 'OPEN', closes: at(next, '02:00:00') });
    await edge('night', next, '00:00:00', 'pickup', { state: 'OPEN', closes: at(next, '02:00:00') });
    await edge('night', next, '01:59:59', 'pickup', { state: 'OPEN', closes: at(next, '02:00:00') });
    await edge('night', next, '02:00:00', 'pickup', { state: 'CLOSED', reason: 'outside_hours', opens: at(next, '22:00:00') });
    C(P, 'CROSS_MIDNIGHT_WINDOW_STAYS_OPEN_ACROSS_THE_DAY_CHANGE', failed('night').length === 0, failed('night'),
      'abierto de las 22:00:00 de un día a las 01:59:59 del siguiente, con un solo cierre: las 02:00:00');

    // ── 4. Cierre por fecha: cierra TODA la fecha local, también el arrastre de la noche anterior ──
    const exception = await ctx.http.call(owner, 'set_business_service_exception', { p_business_id: id, p_channel: 'all', p_on_date: next, p_is_closed: true,
      p_opens_at: null, p_closes_at: null, p_note: `${ctx.runId} QA cierre de fecha` });
    ctx.ledger.tenantChanges.push({ kind: 'service_exception', date: next, channel: 'all', id: exception.data?.exception_id || null, at: nowIso() }); ctx.persist();
    C(P, 'CLOSED_DATE_SET_FOR_A_FUTURE_DAY', exception.ok && Boolean(exception.data?.exception_id), brief(exception));
    await edge('holiday', day, '23:59:59', 'pickup', { state: 'OPEN', closes: at(next, '00:00:00') });
    await edge('holiday', next, '00:00:00', 'pickup', { state: 'CLOSED', reason: 'exception_closed' });
    await edge('holiday', next, '01:00:00', 'pickup', { state: 'CLOSED', reason: 'exception_closed' });
    await edge('holiday', next, '12:00:00', 'delivery', { state: 'CLOSED', reason: 'exception_closed', opens: at(dateAfter(next, 1), '00:00:00') });
    await edge('holiday', dateAfter(next, 1), '00:00:00', 'delivery', { state: 'OPEN' });
    C(P, 'CLOSED_DATE_CLOSES_THE_WHOLE_LOCAL_DAY_INCLUDING_THE_CARRY_OVER', failed('holiday').length === 0, failed('holiday'),
      'la franja que venía de la noche anterior cierra a las 00:00:00; toda la fecha queda cerrada por excepción; al día siguiente vuelve a abrir');
    const removed = await ctx.http.call(owner, 'delete_business_service_exception', { p_business_id: id, p_exception_id: exception.data?.exception_id });
    const restored = await setHours('pickup', GRID_24X7);
    C(P, 'HOURS_AND_EXCEPTION_RESTORED', removed.ok && restored.ok && restored.data?.ok === true, { exception: brief(removed), hours: brief(restored) });

    // ── 5. Alcohol: la ventana de la política del comercio ────────────────────
    // La política la escribe el dueño con un PATCH sobre su negocio (columnas que puede escribir y no leer:
    // la respuesta se pide con `select=id`). Sin exigencia de horario de alcohol, la ventana ES la política.
    const policy = await ctx.http.restWrite(owner, 'PATCH', `businesses?id=eq.${id}&select=id`, { alcohol_sales_enabled: true, alcohol_minimum_age: 18,
      alcohol_sales_start: '10:00', alcohol_sales_end: '22:00', alcohol_timezone: tz }, { businessId: id });
    ctx.ledger.tenantChanges.push({ kind: 'alcohol_policy_enabled', at: nowIso() }); ctx.persist();
    C(P, 'OWNER_SETS_THE_ALCOHOL_POLICY', policy.status === 200 && policy.rows?.length === 1, { ...brief(policy), rows: policy.rows?.length ?? null });
    try {
      await edge('alcohol', day, '09:59:59', 'alcohol', { state: 'CLOSED', reason: 'outside_hours', opens: at(day, '10:00:00') });
      await edge('alcohol', day, '10:00:00', 'alcohol', { state: 'OPEN', reason: null });
      await edge('alcohol', day, '21:59:59', 'alcohol', { state: 'OPEN' });
      await edge('alcohol', day, '22:00:30', 'alcohol', { state: 'CLOSED', reason: 'outside_hours', opens: at(next, '10:00:00') });
      await edge('alcohol', day, '03:00:00', 'pickup', { state: 'OPEN' });
      C(P, 'ALCOHOL_WINDOW_FOLLOWS_THE_BUSINESS_POLICY', failed('alcohol').length === 0, failed('alcohol'),
        'alcohol cerrado fuera de la ventana de la política y abierto adentro, sin tocar los otros canales');
    } finally {
      const off = await ctx.http.restWrite(owner, 'PATCH', `businesses?id=eq.${id}&select=id`, { alcohol_sales_enabled: false }, { businessId: id });
      const again = await statusAt(at(day, '12:00:00'));
      C(P, 'ALCOHOL_POLICY_SWITCHED_OFF_AGAIN', off.status === 200 && again.data?.channels?.alcohol?.reason === 'alcohol_disabled', { patch: brief(off), alcohol: again.data?.channels?.alcohol });
    }

    // ── 6. La pausa manual y la falta de habilitación mandan sobre cualquier horario ──
    const paused = await ctx.http.call(staff, 'set_business_open_state', { p_business_id: id, p_status: 'paused' });
    ctx.ledger.tenantChanges.push({ kind: 'paused', at: nowIso() }); ctx.persist();
    await edge('paused', day, '12:00:00', 'pickup', { state: 'CLOSED', reason: 'business_paused', opens: null, closes: null });
    await edge('paused', day, '12:00:00', 'delivery', { state: 'CLOSED', reason: 'business_paused' });
    await edge('paused', day, '12:00:00', 'alcohol', { state: 'CLOSED', reason: 'business_paused' });
    const resumed = await ctx.http.call(staff, 'set_business_open_state', { p_business_id: id, p_status: 'open' });
    C(P, 'MANUAL_PAUSE_CLOSES_EVERY_CHANNEL_AT_ANY_INSTANT', paused.ok && resumed.ok && failed('paused').length === 0, { pause: brief(paused), resume: brief(resumed), failed: failed('paused') });

    // ── 7. Un canal apagado no figura como abierto ────────────────────────────
    const off = await ctx.http.call(owner, 'set_business_fulfillment', { p_business_id: id, p_delivery_enabled: false, p_pickup_enabled: true });
    ctx.ledger.tenantChanges.push({ kind: 'fulfillment_toggled', delivery: false, pickup: true, at: nowIso() }); ctx.persist();
    await edge('channel-off', day, '12:00:00', 'delivery', { state: 'CLOSED', reason: 'channel_disabled' });
    await edge('channel-off', day, '12:00:00', 'pickup', { state: 'OPEN' });
    const on = await ctx.http.call(owner, 'set_business_fulfillment', { p_business_id: id, p_delivery_enabled: true, p_pickup_enabled: true });
    C(P, 'DISABLED_CHANNEL_IS_REPORTED_CLOSED_AND_THE_OTHER_STAYS_OPEN', off.ok && on.ok && failed('channel-off').length === 0, { off: brief(off), on: brief(on), failed: failed('channel-off') });

    // ── 8. Un negocio que no existe contesta igual que uno inactivo: no hay oráculo de existencia ──
    const inactive = await ensureThrowawayBusiness(ctx);
    ctx.guard.registerDecoy(inactive.id);
    const missingId = ctx.guard.decoy();
    const instant = at(day, '12:00:00');
    const [unknown, closed] = [await statusAt(instant, missingId, { allowDecoy: true }), await statusAt(instant, inactive.id, { allowDecoy: true })];
    const shapeOf = (r) => JSON.stringify({ ...r.data, business_id: null });
    C(P, 'UNKNOWN_BUSINESS_ANSWERS_EXACTLY_LIKE_AN_INACTIVE_ONE', unknown.status === 200 && closed.status === 200 && shapeOf(unknown) === shapeOf(closed)
      && Object.values(unknown.data?.channels || {}).every((c) => c.state === 'CLOSED' && c.reason === 'business_inactive') && unknown.data?.timezone === null,
    { unknown: unknown.data?.channels, inactive: closed.data?.channels }, 'la misma respuesta para un identificador que no existe y para un negocio inactivo');

    // ── 9. Un instante imposible se rechaza como entrada inválida ─────────────
    const invalid = { message: 'instante invalido' };
    const impossible = {};
    for (const value of ['infinity', '-infinity', '1800-06-01T12:00:00Z', '9000-01-01T00:00:00Z']) impossible[value] = await statusAt(value);
    C(P, 'IMPOSSIBLE_INSTANTS_ARE_REFUSED_AS_INVALID_INPUT', Object.values(impossible).every((r) => refused(r, CODES.VALIDATION, invalid)),
      Object.fromEntries(Object.entries(impossible).map(([value, r]) => [value, brief(r)])), refusal(CODES.VALIDATION, invalid));
    const garbage = await statusAt('no-es-una-fecha');
    C(P, 'A_VALUE_THAT_IS_NOT_AN_INSTANT_IS_A_CLIENT_ERROR', refused(garbage, CODES.BAD_INSTANT), brief(garbage), refusal(CODES.BAD_INSTANT));

    const final = await config();
    C(P, 'TENANT_CONFIGURATION_BACK_TO_WHERE_IT_STARTED', final.hours === before.config.hours && final.exceptions === 0, { hours: [before.config.hours, final.hours], exceptions: final.exceptions });
    ctx.evidence.write('phase-status.json', { timezone: tz, day, next, samples: samples.map(({ label, local, instant, channel, want, seen, ok }) => ({ label, local, instant, channel, want, seen, ok })) });
  },
};
