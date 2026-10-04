// FASE delivery — cobertura, envío, mínimo y punto de entrega: los decide el backend.
//
// Zonas del tenant: «Centro» (envío propio 1200, mínimo del comercio) y «Oeste»
// (envío del comercio, mínimo propio 5000). La cobertura se exige, y el tenant está
// verificado: tampoco puede quedarse sin reglas ni encender el delivery sin cobertura.
import { nowIso, sqlUuid } from '../env.mjs';
import { brief, refusal, refused } from '../http.mjs';
import { DELIVERY } from '../tenant.mjs';

const P = 'delivery';

export default {
  id: P,
  title: 'entrega: zonas, envío, mínimo, canales apagados, punto confirmado y reglas de un comercio verificado',
  requires: [],
  async run(ctx) {
    const C = ctx.rec.check;
    const id = ctx.tenant.id;
    const { owner } = ctx.actors;
    const customer = await ctx.identities.customer('delivery');
    const zones = ctx.tenant.zones;
    const log = [];
    const order = async (name, options) => {
      const out = await ctx.orders.create(customer, { label: `delivery:${name}`, ...options });
      log.push({ name, ...brief(out.r), publicCode: out.order?.public_code || null });
      return out;
    };
    const dbOrder = async (orderId) => (await ctx.env.observe(`select status, subtotal, delivery_fee, total, delivery_zone_id, delivery_zone_name, delivery_area_declared,
      delivery_latitude, delivery_longitude, delivery_location_source, delivery_location_confirmed_at, delivery_mode from public.orders where id = ${sqlUuid(orderId)}`))[0];
    const availability = (channel, context = {}) => ctx.http.call(null, 'commerce_availability', { p_business_id: id, p_channel: channel, p_context: context });
    const stopped = (out, code, message) => refused(out.r, code, { message });

    // a. Dirección guardada dentro de la zona Centro.
    const inside = await order('inside-zone', { mode: 'delivery', role: 'MAIN', quantity: 2 });
    C(P, 'ADDRESS_INSIDE_ZONE_ACCEPTED', Boolean(inside.order), brief(inside.r));
    if (inside.order) {
      const o = await dbOrder(inside.order.id);
      C(P, 'ZONE_FEE_APPLIED_FROM_THE_ZONE', Number(o.delivery_fee) === zones.centro.fee && o.delivery_zone_id === zones.centro.id && o.delivery_zone_name === 'Centro'
        && Number(o.total) === Number(o.subtotal) + zones.centro.fee, { fee: o.delivery_fee, zone: o.delivery_zone_name, total: o.total }, { fee: zones.centro.fee, zone: 'Centro' });
      C(P, 'DELIVERY_POINT_SEALED_ON_THE_ORDER', Number(o.delivery_latitude) === DELIVERY.pin.lat && Number(o.delivery_longitude) === DELIVERY.pin.lng
        && o.delivery_location_source === 'map_pin' && Boolean(o.delivery_location_confirmed_at), { lat: o.delivery_latitude, lng: o.delivery_longitude, source: o.delivery_location_source });
    }
    // b. Zona sin envío propio: vale el envío del comercio, y su mínimo propio.
    const west = await order('zone-with-business-fee', { mode: 'delivery', role: 'MAIN', quantity: 4, inline: true, neighborhood: 'Oeste' });
    C(P, 'ZONE_WITHOUT_OWN_FEE_ACCEPTED', Boolean(west.order), brief(west.r));
    if (west.order) {
      const o = await dbOrder(west.order.id);
      C(P, 'BUSINESS_FEE_APPLIED_WHEN_ZONE_HAS_NONE', Number(o.delivery_fee) === DELIVERY.businessFee && o.delivery_zone_id === zones.oeste.id,
        { fee: o.delivery_fee, zone: o.delivery_zone_name }, { fee: DELIVERY.businessFee, zone: 'Oeste' });
    }
    const before = await ctx.orders.footprint();
    const westBelow = await order('zone-minimum', { mode: 'delivery', role: 'MAIN', quantity: 3, inline: true, neighborhood: 'Oeste' });
    C(P, 'ZONE_MINIMUM_OVERRIDES_BUSINESS_MINIMUM', stopped(westBelow, '23514'), brief(westBelow.r), `${refusal('23514')} (4500 < mínimo de zona 5000)`);
    // c. Barrio declarado fuera de toda zona.
    const outside = await order('outside-zone', { mode: 'delivery', role: 'MAIN', quantity: 2, inline: true, neighborhood: 'Barrio Lejano' });
    const outOfZone = refusal('55000', { message: 'OUT_OF_DELIVERY_ZONE' });
    C(P, 'NEIGHBOURHOOD_OUTSIDE_ANY_ZONE_REFUSED', stopped(outside, '55000', 'OUT_OF_DELIVERY_ZONE'), brief(outside.r), outOfZone);
    const almost = [];
    for (const name of ['Centro Oeste', 'Centr', 'Centros']) {
      const out = await order(`near-miss:${name}`, { mode: 'delivery', role: 'MAIN', quantity: 2, inline: true, neighborhood: name });
      almost.push({ name, ...brief(out.r), refused: stopped(out, '55000', 'OUT_OF_DELIVERY_ZONE') });
    }
    C(P, 'ZONE_NAME_NEAR_MISSES_REFUSED', almost.every((a) => a.refused), almost, outOfZone);
    // d. Por debajo del mínimo del comercio.
    const below = await order('below-minimum', { mode: 'delivery', role: 'MAIN', quantity: 1 });
    C(P, 'BELOW_DELIVERY_MINIMUM_REFUSED', stopped(below, '23514'), brief(below.r), refusal('23514'));
    // e. Entrega sin punto confirmado.
    const noPin = await order('no-pin', { mode: 'delivery', role: 'MAIN', quantity: 2, inline: true, pin: false });
    const pinRequired = refusal('22023', { message: 'DELIVERY_LOCATION_REQUIRED' });
    C(P, 'DELIVERY_WITHOUT_PIN_REFUSED', stopped(noPin, '22023', 'DELIVERY_LOCATION_REQUIRED'), brief(noPin.r), pinRequired);
    const unconfirmed = await order('pin-not-confirmed', { mode: 'delivery', role: 'MAIN', quantity: 2, inline: true, pin: false,
      extra: { delivery_latitude: DELIVERY.pin.lat, delivery_longitude: DELIVERY.pin.lng, delivery_location_source: 'map_pin' } });
    C(P, 'DELIVERY_WITH_UNCONFIRMED_PIN_REFUSED', stopped(unconfirmed, '22023', 'DELIVERY_LOCATION_REQUIRED'), brief(unconfirmed.r), pinRequired);
    const future = await order('pin-confirmed-in-the-future', { mode: 'delivery', role: 'MAIN', quantity: 2, inline: true, pin: false,
      extra: { delivery_latitude: DELIVERY.pin.lat, delivery_longitude: DELIVERY.pin.lng, delivery_location_source: 'map_pin',
        delivery_location_confirmed_at: new Date(Date.now() + 3_600_000).toISOString() } });
    C(P, 'DELIVERY_WITH_FUTURE_CONFIRMATION_REFUSED', stopped(future, '22023'), brief(future.r), refusal('22023'));
    const savedNoPin = await ctx.http.call(customer, 'upsert_current_customer_address', { p_address: { label: 'Sin punto', street: 'Calle Sin Punto',
      streetNumber: '55', city: DELIVERY.pin.city, neighborhood: 'Centro', source: 'manual', isDefault: false, allowDuplicate: true } });
    if (savedNoPin.ok && savedNoPin.data?.address?.id) {
      const out = await order('saved-address-without-pin', { mode: 'delivery', payload: { ...ctx.orders.payload({ customer, role: 'MAIN', quantity: 2, mode: 'delivery' }),
        customer_address_id: savedNoPin.data.address.id } });
      C(P, 'SAVED_ADDRESS_WITHOUT_PIN_REFUSED', stopped(out, '22023', 'DELIVERY_LOCATION_REQUIRED'), brief(out.r), pinRequired);
    } else {
      C(P, 'SAVED_ADDRESS_WITHOUT_PIN_REFUSED', false, { setup: brief(savedNoPin), code: savedNoPin.data?.code });
    }
    C(P, 'REFUSED_DELIVERY_ORDERS_CREATED_NOTHING', ctx.orders.sameFootprint(before, await ctx.orders.footprint()), { orders: before.orders });

    // f. Variantes de escritura del nombre de la zona: la normalización es del servidor.
    const variants = [];
    for (const name of ['CENTRO', '  centro  ', 'Céntro', 'Centro.']) {
      const out = await order(`variant:${name}`, { mode: 'delivery', role: 'MAIN', quantity: 2, inline: true, neighborhood: name });
      const o = out.order ? await dbOrder(out.order.id) : null;
      variants.push({ name, ...brief(out.r), zone: o?.delivery_zone_name || null, fee: o?.delivery_fee ?? null, declared: o?.delivery_area_declared ?? null });
    }
    C(P, 'ZONE_NAME_VARIANTS_RESOLVE_TO_THE_SAME_ZONE', variants.every((v) => v.ok && v.zone === 'Centro' && Number(v.fee) === zones.centro.fee), variants);

    // g. Zona desactivada por el dueño, y restaurada.
    const off = await ctx.http.call(owner, 'set_delivery_zone_active', { p_business_id: id, p_zone_id: zones.centro.id, p_active: false });
    ctx.ledger.tenantChanges.push({ kind: 'zone_deactivated', zone: 'Centro', at: nowIso() }); ctx.persist();
    const whileOff = await order('zone-deactivated', { mode: 'delivery', role: 'MAIN', quantity: 2 });
    const availOff = await availability('delivery', { neighborhood: 'Centro' });
    C(P, 'DEACTIVATED_ZONE_REFUSES_ORDERS', off.ok && stopped(whileOff, '55000', 'OUT_OF_DELIVERY_ZONE') && availOff.data?.delivery?.eligible === false
      && !(availOff.data?.areas || []).some((a) => a.name === 'Centro'), { set: brief(off), order: brief(whileOff.r), availability: availOff.data?.delivery });
    const on = await ctx.http.call(owner, 'set_delivery_zone_active', { p_business_id: id, p_zone_id: zones.centro.id, p_active: true });
    const availOn = await availability('delivery', { neighborhood: 'Centro' });
    C(P, 'REACTIVATED_ZONE_IS_ELIGIBLE_AGAIN', on.ok && availOn.data?.delivery?.eligible === true && Number(availOn.data?.delivery?.delivery_fee) === zones.centro.fee,
      { set: brief(on), availability: availOn.data?.delivery });

    // h. Retiro: sin envío y sin mínimo.
    const pickup = await order('pickup', { mode: 'pickup', role: 'MAIN', quantity: 1 });
    C(P, 'PICKUP_ACCEPTED', Boolean(pickup.order), brief(pickup.r));
    if (pickup.order) {
      const o = await dbOrder(pickup.order.id);
      C(P, 'PICKUP_HAS_NO_FEE_AND_NO_ZONE', Number(o.delivery_fee) === 0 && Number(o.total) === Number(o.subtotal) && o.delivery_zone_id === null && o.delivery_mode === 'pickup',
        { fee: o.delivery_fee, total: o.total, zone: o.delivery_zone_id });
    }

    // i. Canales apagados por el dueño, y restaurados.
    const footBefore = await ctx.orders.footprint();
    const noDelivery = await ctx.http.call(owner, 'set_business_fulfillment', { p_business_id: id, p_delivery_enabled: false, p_pickup_enabled: true });
    ctx.ledger.tenantChanges.push({ kind: 'fulfillment_toggled', delivery: false, pickup: true, at: nowIso() }); ctx.persist();
    const deliveryOff = await order('delivery-disabled', { mode: 'delivery', role: 'MAIN', quantity: 2 });
    const availDeliveryOff = await availability('delivery', { neighborhood: 'Centro' });
    C(P, 'DELIVERY_REFUSED_WHEN_DELIVERY_DISABLED', noDelivery.ok && stopped(deliveryOff, '55000') && availDeliveryOff.data?.ordering_ready === false
      && availDeliveryOff.data?.delivery?.reason === 'unavailable', { set: brief(noDelivery), order: brief(deliveryOff.r), availability: availDeliveryOff.data?.delivery });
    const noPickup = await ctx.http.call(owner, 'set_business_fulfillment', { p_business_id: id, p_delivery_enabled: true, p_pickup_enabled: false });
    ctx.ledger.tenantChanges.push({ kind: 'fulfillment_toggled', delivery: true, pickup: false, at: nowIso() }); ctx.persist();
    const pickupOff = await order('pickup-disabled', { mode: 'pickup', role: 'MAIN', quantity: 1 });
    const availPickupOff = await availability('pickup');
    C(P, 'PICKUP_REFUSED_WHEN_PICKUP_DISABLED', noPickup.ok && stopped(pickupOff, '55000') && availPickupOff.data?.ordering_ready === false,
      { set: brief(noPickup), order: brief(pickupOff.r), ordering_ready: availPickupOff.data?.ordering_ready });
    const restored = await ctx.http.call(owner, 'set_business_fulfillment', { p_business_id: id, p_delivery_enabled: true, p_pickup_enabled: true });
    const business = (await ctx.env.observe(`select delivery_enabled, pickup_enabled, (select count(*) from public.delivery_zones z where z.business_id = b.id and z.is_active)::int as active_zones
      from public.businesses b where b.id = ${sqlUuid(id)}`))[0];
    C(P, 'FULFILLMENT_AND_ZONES_RESTORED', restored.ok && business.delivery_enabled && business.pickup_enabled && business.active_zones === 2, business);
    C(P, 'DISABLED_CHANNEL_ATTEMPTS_CREATED_NOTHING', ctx.orders.sameFootprint(footBefore, await ctx.orders.footprint()), { orders: footBefore.orders });

    // j. Un comercio verificado no se queda sin reglas con un clic: apagar la exigencia de horarios o la de
    //    cobertura se rechaza con ENFORCEMENT_LOCKED y no cambia nada (20261001214000).
    const rules = async () => (await ctx.env.observe(`select ordering_verified, hours_enforced, delivery_zone_enforced, delivery_enabled,
      (select count(*) from public.delivery_zones z where z.business_id = b.id and z.is_active)::int as active_zones from public.businesses b where b.id = ${sqlUuid(id)}`))[0];
    if (ctx.caps.enforcement_lock) {
      const enforcement = (hours, coverage) => ctx.http.call(owner, 'set_service_enforcement', { p_business_id: id, p_hours_enforced: hours, p_delivery_zone_enforced: coverage });
      const locked = { message: 'ENFORCEMENT_LOCKED' };
      const hoursOff = await enforcement(false, null);
      const coverageOff = await enforcement(null, false);
      const rulesKept = await rules();
      C(P, 'VERIFIED_BUSINESS_CANNOT_SWITCH_OFF_HOURS_OR_COVERAGE_ENFORCEMENT', refused(hoursOff, '55000', locked) && refused(coverageOff, '55000', locked)
        && rulesKept.ordering_verified && rulesKept.hours_enforced && rulesKept.delivery_zone_enforced, { hours: brief(hoursOff), coverage: brief(coverageOff), business: rulesKept },
      refusal('55000', locked));
    } else {
      ctx.rec.skipCheck(P, 'VERIFIED_BUSINESS_CANNOT_SWITCH_OFF_HOURS_OR_COVERAGE_ENFORCEMENT', 'enforcement_lock');
    }

    // k. Un comercio verificado no enciende el delivery sin cobertura (20261001216000). La regla es un trigger
    //    para cubrir las DOS puertas del dueño: la RPC y el PATCH directo de la columna. Se apaga el delivery,
    //    se desactivan las zonas, y encenderlo se rechaza por las dos; con las zonas activas otra vez, se enciende.
    if (ctx.caps.delivery_coverage_gate) {
      const deliveryOffAgain = await ctx.http.call(owner, 'set_business_fulfillment', { p_business_id: id, p_delivery_enabled: false, p_pickup_enabled: true });
      const zoneSwitch = async (active) => {
        const out = [];
        for (const zone of Object.values(zones)) out.push(await ctx.http.call(owner, 'set_delivery_zone_active', { p_business_id: id, p_zone_id: zone.id, p_active: active }));
        return out.every((r) => r.ok);
      };
      const zonesOff = await zoneSwitch(false);
      ctx.ledger.tenantChanges.push({ kind: 'delivery_and_zones_off', at: nowIso() }); ctx.persist();
      const coverageNeeded = { message: 'Para encender el delivery', details: 'DELIVERY_COVERAGE' };
      const byRpc = await ctx.http.call(owner, 'set_business_fulfillment', { p_business_id: id, p_delivery_enabled: true, p_pickup_enabled: true });
      const byPatch = await ctx.http.restWrite(owner, 'PATCH', `businesses?id=eq.${id}&select=id`, { delivery_enabled: true }, { businessId: id });
      const stillOff = await rules();
      C(P, 'VERIFIED_BUSINESS_CANNOT_TURN_DELIVERY_ON_WITHOUT_AN_ACTIVE_ZONE', deliveryOffAgain.ok && zonesOff && refused(byRpc, '22023', coverageNeeded) && refused(byPatch, '22023', coverageNeeded)
        && stillOff.delivery_enabled === false && stillOff.active_zones === 0, { rpc: brief(byRpc), patch: brief(byPatch), business: stillOff },
      `${refusal('22023', coverageNeeded)}, por la RPC y por el PATCH`);
      const zonesOn = await zoneSwitch(true);
      const deliveryOn = await ctx.http.call(owner, 'set_business_fulfillment', { p_business_id: id, p_delivery_enabled: true, p_pickup_enabled: true });
      const rulesBack = await rules();
      C(P, 'VERIFIED_BUSINESS_TURNS_DELIVERY_ON_ONCE_COVERAGE_IS_BACK', zonesOn && deliveryOn.ok && rulesBack.delivery_enabled && rulesBack.active_zones === 2,
        { set: brief(deliveryOn), business: rulesBack });
    } else {
      for (const name of ['VERIFIED_BUSINESS_CANNOT_TURN_DELIVERY_ON_WITHOUT_AN_ACTIVE_ZONE', 'VERIFIED_BUSINESS_TURNS_DELIVERY_ON_ONCE_COVERAGE_IS_BACK']) ctx.rec.skipCheck(P, name, 'delivery_coverage_gate');
    }

    ctx.evidence.write('phase-delivery.json', { zones, businessFee: DELIVERY.businessFee, businessMinimum: DELIVERY.businessMinimum, attempts: log, variants, nearMisses: almost,
      distanceCap: ctx.tenant.locationVerified ? 'available' : 'NOT EXERCISED: no hay camino para verificar el punto del local en un tenant QA (ver tenant.json · notes)' });
  },
};
