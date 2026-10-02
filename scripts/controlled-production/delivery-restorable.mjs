/*
 * Las certificaciones de apertura le apagan el delivery al comercio QA y después se lo
 * devuelven. Desde 20261001216000 un comercio verificado no vuelve a encender el delivery
 * sin la cobertura exigida y una zona activa: si el QA no la tiene cargada, apagárselo lo
 * dejaría sin poder volver a su estado. Se decide ANTES de tocar nada.
 *
 * `business` es la fila del comercio (delivery_enabled, ordering_verified) y `readiness`
 * la respuesta de get_store_opening_readiness.
 */
export function deliveryRestorable(business, readiness) {
  if (!business?.delivery_enabled) return { ok: true, reason: 'delivery_was_off' };
  if (business.ordering_verified === false) return { ok: true, reason: 'not_verified' };
  // Un backend anterior a la regla no devuelve `configuration`, y tampoco tiene la regla.
  const zones = readiness?.configuration?.find((row) => row.code === 'DELIVERY_ZONES');
  if (!zones) return { ok: true, reason: 'backend_without_rule' };
  return zones.status === 'CONFIGURED'
    ? { ok: true, reason: 'coverage_ready' }
    : { ok: false, reason: 'DELIVERY_COVERAGE' };
}

/*
 * Con qué códigos se va a negar la verificación de plataforma. Desde 20261001215000 la
 * respuesta los trae en `verification_blockers` (suma el dueño, y el horario y la cobertura
 * sin exigir); antes eran los pendientes menos la propia verificación.
 */
export function expectedVerificationRefusal(readiness, pendingCodes) {
  if (Array.isArray(readiness?.verification_blockers)) return readiness.verification_blockers;
  return pendingCodes.filter((code) => code !== 'PLATFORM_VERIFICATION');
}
