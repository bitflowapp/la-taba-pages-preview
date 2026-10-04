// FASE edge-functions — las Edge Functions del repo, servidas por el runtime de Edge del stack.
//
// Tres cosas, y ninguna llama al proveedor de pagos:
//
//   · CADA directorio de `supabase/functions` contesta en `/functions/v1/<nombre>` con
//     una respuesta SUYA (su propio rechazo) y no con un error del runtime: arrancó. Se le
//     manda lo mismo a todas —un POST vacío con la clave publicable, que es un token
//     válido para el runtime— y todas lo rechazan antes de hacer nada: sin sesión de
//     usuario, sin identificadores, sin la confirmación explícita que exigen las que
//     mueven dinero;
//   · `mercadopago-webhook` sin una firma válida no deja entrar nada: ni un recibo válido,
//     ni un trabajo en la cola, ni un evento de pago; a lo sumo un recibo
//     `rejected_signature`, con su cupo. El 401 de la firma sólo se alcanza en un
//     despliegue alojado: en el stack la función se niega ANTES, porque no reconoce al
//     proyecto (`oauthMode()` exige una referencia de Supabase conocida);
//   · `mercadopago-create-checkout-session` sin configuración de pagos contesta su
//     negativa (PAYMENTS_NOT_ENABLED) y no reserva una unidad.
//
// La URL del proveedor está escrita en las funciones: por eso sólo se ejercitan caminos
// que se niegan antes de cualquier pedido al proveedor (leído en su código), y lo que se
// afirma es justamente esa negativa.
//
// Sólo en el stack. En local no hay runtime de Edge; en Staging las funciones tienen la
// configuración real del proveedor y esta herramienta no las llama.
import { existsSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { nowIso, shortId, sqlText, sqlUuid } from '../env.mjs';
import { brief } from '../http.mjs';

const P = 'edge-functions';
const FUNCTIONS_DIR = path.resolve(import.meta.dirname, '../../../../supabase/functions');
const CHECKS = Object.freeze(['EVERY_EDGE_FUNCTION_BOOTS_AND_ANSWERS_WITH_ITS_OWN_REFUSAL', 'WEBHOOK_WITHOUT_A_VALID_SIGNATURE_LETS_NOTHING_IN',
  'WEBHOOK_WITHOUT_A_VALID_SIGNATURE_IS_ANSWERED_401', 'CHECKOUT_FUNCTION_WITHOUT_PAYMENT_CONFIGURATION_REFUSES_AND_RESERVES_NOTHING',
  'CHECKOUT_FUNCTION_TELLS_THE_STOREFRONT_MERCADO_PAGO_IS_NOT_AVAILABLE']);
// Las negativas del webhook que llegan ANTES de mirar la firma en un despliegue que no es alojado.
const PRE_SIGNATURE_REFUSALS = Object.freeze(['400 HTTPS_REQUIRED', '503 PAYMENT_UNAVAILABLE']);

// Los directorios que el runtime sirve como funciones: los que tienen `index.ts` y no empiezan con «_».
export function edgeFunctionNames(directory = FUNCTIONS_DIR) {
  return readdirSync(directory, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && !entry.name.startsWith('_') && existsSync(path.join(directory, entry.name, 'index.ts')))
    .map((entry) => entry.name).sort();
}

// ¿La respuesta es del runtime y no de la función? Un error de arranque, un trabajador que murió, una función
// que el runtime no encontró, o nada. Cualquier otra respuesta —también un 5xx con el cuerpo de la función— es
// de la función: arrancó y contestó.
export function runtimeFailure(r) {
  if (!r || r.status === 0) return 'no answer';
  const body = r.body && typeof r.body === 'object' ? r.body : {};
  const code = String(body.code ?? '');
  const text = `${String(body.msg ?? body.message ?? body.error ?? '')} ${String(r.text ?? '')}`;
  if (['BOOT_ERROR', 'WORKER_ERROR', 'WORKER_LIMIT', 'WORKER_REQUEST_CANCELLED'].includes(code)) return code;
  if (/InvalidWorkerCreation|worker boot error|failed to boot|event loop error|Uncaught (Syntax|Reference|Type)Error/i.test(text)) return 'boot error';
  if (r.status === 404 && /function not found|requested function was not found/i.test(text)) return 'function not found';
  return null;
}
const answerOf = (r) => `${r?.status ?? 0} ${r?.body?.code ?? (typeof r?.body === 'object' ? '' : String(r?.text ?? '').slice(0, 40))}`.trim();

export default {
  id: P,
  title: 'Edge Functions en el stack: cada una arranca y se niega sola; el webhook sin firma y el checkout sin configuración no dejan nada',
  requires: [],
  async run(ctx) {
    const C = ctx.rec.check;
    const id = ctx.tenant.id;
    const target = ctx.env.target;
    const cannot = target.lacks('edge_function_probes');
    if (cannot) {
      for (const name of CHECKS) ctx.rec.skipOnTarget(P, name, cannot);
      return;
    }
    const evidence = { functions: {} };

    // ── 1. Cada función arranca ───────────────────────────────────────────────
    // El primer pedido de cada una puede tardar: el runtime baja sus dependencias al arrancarla.
    const names = edgeFunctionNames();
    const failures = {};
    for (const name of names) {
      let r = await ctx.http.edge(name, { body: {}, timeoutMs: 90_000 });
      if (runtimeFailure(r) && r.status !== 404) r = await ctx.http.edge(name, { body: {}, timeoutMs: 90_000 });   // un arranque en frío, una vez
      const failure = runtimeFailure(r);
      evidence.functions[name] = { answer: answerOf(r), ms: r.ms, runtimeFailure: failure };
      if (failure) failures[name] = { failure, answer: answerOf(r), body: String(r.text ?? '').slice(0, 200) };
      ctx.log(`edge · ${name}: ${answerOf(r)}${failure ? ` (runtime: ${failure})` : ''}`);
    }
    C(P, CHECKS[0], names.length > 0 && Object.keys(failures).length === 0, Object.keys(failures).length ? failures : evidence.functions,
      `las ${names.length} funciones contestan con una respuesta propia, sin error de arranque del runtime`);

    // ── 2. El webhook sin firma ───────────────────────────────────────────────
    const resource = `ECOMCERT-HOOK-${ctx.runTag}-${shortId(3)}`;
    const trail = async () => (await ctx.env.observe(`select
      (select count(*) from public.payment_webhook_receipts where resource_id = ${sqlText(resource)})::int as receipts,
      (select count(*) from public.payment_webhook_receipts where resource_id = ${sqlText(resource)} and (signature_valid or processing_status <> 'rejected_signature'))::int as valid_receipts,
      (select count(*) from public.payment_outbox where resource_id = ${sqlText(resource)})::int as jobs,
      (select count(*) from public.payment_events e where e.provider_event_id = ${sqlText(resource)})::int as payment_events`))[0];
    const before = await trail();
    // Lo que manda Mercado Pago, sin `x-signature`. `x-forwarded-proto` dice https: si la puerta de entrada lo deja
    // pasar, la función llega más lejos; si lo pisa con http, se niega por eso. Las dos negativas se aceptan acá.
    const hook = await ctx.http.edge(`mercadopago-webhook`, { body: { type: 'payment', action: 'payment.updated', data: { id: resource } },
      headers: { 'x-forwarded-proto': 'https', 'x-request-id': `ecomcert-${shortId(6)}` }, timeoutMs: 60_000, query: `?data.id=${encodeURIComponent(resource)}&type=payment` });
    const after = await trail();
    evidence.webhook = { answer: answerOf(hook), before, after };
    C(P, CHECKS[1], !runtimeFailure(hook) && hook.status >= 400 && hook.status < 600 && after.valid_receipts === 0 && after.jobs === 0 && after.payment_events === 0
      && after.receipts - before.receipts <= 1, { answer: answerOf(hook), trail: [before, after] },
    'ni recibo válido, ni trabajo en la cola, ni evento de pago; a lo sumo un recibo rejected_signature');
    if (hook.status === 401 && hook.body?.code === 'INVALID_WEBHOOK') {
      C(P, CHECKS[2], true, { answer: answerOf(hook) });
    } else if (PRE_SIGNATURE_REFUSALS.includes(answerOf(hook)) && target.lacks('hosted_deployment')) {
      ctx.rec.skipOnTarget(P, CHECKS[2], `${target.lacks('hosted_deployment')} (contestó ${answerOf(hook)})`);
    } else {
      C(P, CHECKS[2], false, { answer: answerOf(hook), body: String(hook.text ?? '').slice(0, 200) }, 'HTTP 401 · INVALID_WEBHOOK');
    }

    // ── 3. El checkout sin configuración de pagos ─────────────────────────────
    // El tenant sin vendedor ni cobro habilitado (si una fase anterior los dejó prendidos, se apagan acá) y el
    // proyecto sin la configuración de Mercado Pago de un despliegue alojado: la función tiene que negarse.
    if (!ctx.caps.checkout_payments) {
      for (const name of CHECKS.slice(3)) ctx.rec.skipCheck(P, name, 'checkout_payments');
    } else {
      await ctx.payments.disableFixture();
      const customer = await ctx.identities.customer('edge-checkout', { address: false });
      const main = ctx.orders.product('MAIN');
      const sessions = async () => (await ctx.env.observe(`select count(*)::int as n from public.checkout_sessions
        where business_id = ${sqlUuid(id)} and customer_id = ${sqlUuid(customer.userId)}`))[0].n;
      const payload = { business_id: id, client_request_id: `ecomcert-edge-${ctx.runTag}-${shortId(4)}`, items: [{ product_id: main.id, quantity: 1 }],
        fulfillment_type: 'pickup', contact: { name: customer.name, phone: customer.phone }, address: {}, age_confirmed: false, payment_method: 'mercadopago' };
      const beforeCheckout = { sessions: await sessions(), footprint: await ctx.orders.footprint() };
      const refusedCheckout = await ctx.http.edge('mercadopago-create-checkout-session', { actor: customer, body: payload, timeoutMs: 60_000 });
      const availability = await ctx.http.edge('mercadopago-create-checkout-session', { actor: customer, body: { business_id: id, availability_only: true }, timeoutMs: 60_000 });
      const afterCheckout = { sessions: await sessions(), footprint: await ctx.orders.footprint() };
      evidence.checkout = { refusal: answerOf(refusedCheckout), availability: availability.body?.availability ?? answerOf(availability), sessions: [beforeCheckout.sessions, afterCheckout.sessions] };
      const reason = refusedCheckout.status === 503 && refusedCheckout.body?.code === 'PAYMENT_UNAVAILABLE'
        ? 'la función se cortó antes de la compuerta de pagos (falta un valor del servidor: el job tiene que darle PAYMENT_LOG_HASH_SALT descartable al runtime)' : null;
      C(P, CHECKS[3], refusedCheckout.status === 409 && refusedCheckout.body?.code === 'PAYMENTS_NOT_ENABLED' && afterCheckout.sessions === beforeCheckout.sessions
        && ctx.orders.sameFootprint(beforeCheckout.footprint, afterCheckout.footprint),
      { answer: answerOf(refusedCheckout), sessions: [beforeCheckout.sessions, afterCheckout.sessions], changed: ctx.orders.footprintDiff(beforeCheckout.footprint, afterCheckout.footprint),
        ...(reason ? { why: reason } : {}) }, 'HTTP 409 · PAYMENTS_NOT_ENABLED, ninguna sesión y ni una unidad reservada (se niega antes de cualquier pedido al proveedor)');
      C(P, CHECKS[4], availability.status === 200 && availability.body?.ok === true && availability.body?.availability?.available === false,
        { answer: answerOf(availability), availability: availability.body?.availability ?? null }, 'HTTP 200 · available false: la tienda no ofrece Mercado Pago');
    }
    ctx.evidence.write('phase-edge-functions.json', { at: nowIso(), ...evidence });
  },
};
