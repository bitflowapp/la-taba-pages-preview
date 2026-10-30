// Certification is evidence, not an absence of errors. Unknown observations fail closed.
import { isDeepStrictEqual } from 'node:util';

export function completeChecks(checks) {
  return Object.keys(checks).length > 0 && Object.values(checks).every((value) => value === true);
}

export function providerSearchEmpty(response) {
  const body = response?.body;
  return response?.http === 200 && Array.isArray(body?.results) && body.results.length === 0
    && body.paging?.total === 0;
}

export function proveReplay({ before, after, deliveries }) {
  const expected = before?.intents?.length === 1 ? before.intents[0].tenant : null;
  return {
    all_accepted: deliveries?.length === 3 && deliveries.every(d => [200, 201].includes(d.http)),
    same_delivery_is_a_duplicate: Boolean(deliveries?.[0]?.receipt_id && deliveries?.[1]?.duplicate === true
      && deliveries[0].receipt_id === deliveries[1].receipt_id),
    no_order_created_by_replays: Boolean(before && after && ['orders_a', 'orders_b'].every(k =>
      Number.isSafeInteger(before[k]) && before[k] === after[k])),
    routed_to_one_tenant_only: Boolean(['a', 'b'].includes(expected) && after?.routed_to?.length === 1 && after.routed_to[0] === expected),
    original_intent_unchanged: Boolean(expected && isDeepStrictEqual(before.intents, after?.intents)),
  };
}

export function proveIsolation({ baseline, after, items, reservations, session, tenantA, tenantB, order, intent }) {
  const before = baseline?.tenants;
  const validTenant = (t) => Number.isInteger(t?.orders) && Number.isInteger(t?.payment_intents)
    && t.orders >= 0 && t.payment_intents >= 0 && t.stock && typeof t.stock === 'object'
    && Object.values(t.stock).every(Number.isSafeInteger);
  const validBaseline = baseline?.schemaVersion === 2 && Number.isFinite(Date.parse(baseline?.at))
    && Date.parse(baseline.at) <= Date.parse(session?.created_at)
    && validTenant(before?.a) && validTenant(before?.b) && validTenant(after?.a) && validTenant(after?.b);
  const quantities = new Map();
  let itemsValid = Array.isArray(items) && items.length > 0;
  for (const item of items || []) {
    if (!item.product_id || !Number.isSafeInteger(item.quantity) || item.quantity <= 0) itemsValid = false;
    quantities.set(item.product_id, (quantities.get(item.product_id) || 0) + item.quantity);
  }
  const converted = new Map();
  for (const r of reservations || []) {
    if (r.status === 'converted' && r.checkout_session_id === session?.id
      && Number.isSafeInteger(r.quantity) && r.quantity > 0) converted.set(r.product_id, (converted.get(r.product_id) || 0) + r.quantity);
  }
  const expectedStock = validBaseline ? { ...before.b.stock } : {};
  for (const [id, qty] of quantities) expectedStock[id] -= qty;
  return {
    baseline_complete_and_before_checkout: Boolean(validBaseline),
    tenant_a_unchanged: Boolean(validBaseline && isDeepStrictEqual(before.a, after.a)),
    tenant_b_one_order: Boolean(validBaseline && after.b.orders === before.b.orders + 1),
    tenant_b_one_intent: Boolean(validBaseline && after.b.payment_intents === before.b.payment_intents + 1),
    tenant_b_stock_down_by_purchase: Boolean(validBaseline && itemsValid
      && [...quantities].every(([id, qty]) => Number.isSafeInteger(before.b.stock[id]) && before.b.stock[id] >= qty)
      && isDeepStrictEqual(expectedStock, after.b.stock)),
    reservations_converted_once: Boolean(itemsValid && Array.isArray(reservations)
      && reservations.length === converted.size && isDeepStrictEqual(quantities, converted)),
    order_in_b_only: Boolean(order?.id && order.id === intent?.order_id && order.business_id === tenantB
      && session?.business_id === tenantB && session.completed_order_id === order.id && tenantA !== tenantB),
  };
}
