import assert from 'node:assert/strict';
import test from 'node:test';

import {
  presentFiscalReasons,
  presentOrderFiscalActionResult,
  presentOrderFiscalState,
  sanitizeFiscalMessage,
} from '../js/business/order-fiscal-presenter.js';
import { createSupabaseFiscalRepository, parseReadinessReasons } from '../js/repositories/supabase-fiscal-repository.js';

// El presentador solo traduce lo que devuelve get_order_fiscal_states: la evaluación única del
// servidor o el comprobante REAL. Estas pruebas fijan los textos del mostrador, qué botones
// aparecen habilitados y que nunca se filtre jerga ni secretos.

const ready = { order_id: 'o', readiness: { status: 'READY', reasons: [] }, document: null, print: null };
const doc = (state, extra = {}) => ({
  order_id: 'o', readiness: { status: 'ALREADY_REQUESTED', reasons: [] },
  document: { id: 'd', state, environment: 'homologation', document_type: 6, point_of_sale: 6, document_number: null, cae: null, artifact_id: null, ...extra },
  print: { requested: false, request_error: false, latest_job: null, jobs: 0 },
});
const authorized = (extra = {}, print = { requested: true, request_error: false, latest_job: null, jobs: 0 }) => ({
  ...doc('authorized', { document_number: 1, cae: '74000000000001', artifact_id: '11111111-1111-4111-8111-111111111111', ...extra }),
  print,
});

test('cada estado real del core, en palabras del mostrador', () => {
  const labels = Object.fromEntries(['queued', 'retry_wait', 'authorizing', 'ambiguous', 'manual_review', 'failed', 'rejected']
    .map((state) => [state, presentOrderFiscalState(doc(state)).label]));
  assert.deepEqual(labels, {
    queued: 'Pendiente', retry_wait: 'Pendiente', authorizing: 'Emitiendo…', ambiguous: 'Verificando con ARCA…',
    manual_review: 'Requiere revisión', failed: 'Requiere revisión', rejected: 'Rechazada',
  });
  assert.equal(presentOrderFiscalState(authorized()).label, 'Factura emitida');
  assert.equal(presentOrderFiscalState(doc('estado_nuevo')).label, 'Requiere revisión', 'un estado desconocido nunca parece emitido');
  // Autorizado sin CAE de 14 dígitos no es una autorización real.
  assert.equal(presentOrderFiscalState(doc('authorized', { cae: '123' })).label, 'Requiere revisión');
});

test('la homologación se marca siempre; el CAE de prueba no parece real', () => {
  const view = presentOrderFiscalState(authorized());
  assert.equal(view.homologation, true);
  assert.equal(view.simulationLabel, 'HOMOLOGACIÓN · sin validez fiscal');
  assert.equal(view.caeLabel, 'CAE de homologación');
  assert.equal(view.number, 'Factura B 00006-00000001');
  const production = presentOrderFiscalState(authorized({ environment: 'production' }));
  assert.deepEqual([production.homologation, production.simulationLabel, production.caeLabel], [false, null, 'CAE']);
});

test('los botones solo aparecen habilitados cuando el servidor dice que se puede', () => {
  assert.deepEqual({ ...presentOrderFiscalState(ready).actions }, { invoice: true, invoiceAndPrint: true });
  assert.deepEqual({ ...presentOrderFiscalState(ready, { inFlight: true }).actions }, { invoice: false, invoiceAndPrint: false });
  const blocked = presentOrderFiscalState({ ...ready, readiness: { status: 'BLOCKED', reasons: [{ code: 'ACCOUNTING_POLICY_REQUIRED', scope: 'commercial' }] } });
  assert.deepEqual([blocked.label, { ...blocked.actions }], ['Configuración fiscal pendiente', { invoice: false, invoiceAndPrint: false }]);
  assert.deepEqual({ ...presentOrderFiscalState(doc('queued')).actions }, { viewPdf: false, print: false, reprint: false }, 'pedida: no se vuelve a facturar');
  // Autorizada, con impresión pedida y todavía sin trabajo: ni "Imprimir" (ya se pidió) ni "Reimprimir".
  assert.deepEqual({ ...presentOrderFiscalState(authorized()).actions }, { viewPdf: true, print: false, reprint: false });
  // Autorizada sin impresión pedida: se puede imprimir.
  assert.equal(presentOrderFiscalState(authorized({}, { requested: false, request_error: false, latest_job: null, jobs: 0 })).actions.print, true);
  // Impresa: reimprimir (con el trabajo real), no imprimir de nuevo.
  const printed = presentOrderFiscalState(authorized({}, { requested: true, latest_job: { id: 'j', status: 'printed' }, jobs: 1 }));
  assert.deepEqual({ ...printed.actions }, { viewPdf: true, print: false, reprint: true });
  // Sin PDF generado todavía: no hay "Ver PDF".
  assert.equal(presentOrderFiscalState(authorized({ artifact_id: null })).actions.viewPdf, false);
});

test('la impresión cuenta lo que pasa de verdad, incluida la PC sin conexión', () => {
  const pending = (agent) => presentOrderFiscalState(authorized({}, { requested: true, latest_job: { id: 'j', status: 'queued' }, jobs: 1 }), { agent }).print;
  assert.equal(pending('ONLINE').label, 'Impresión pendiente');
  assert.equal(pending('OFFLINE').label, 'Impresión pendiente · la PC de impresión está sin conexión');
  assert.equal(pending('NOT_REGISTERED').label, 'Impresión pendiente · no hay una PC de impresión vinculada');
  assert.equal(presentOrderFiscalState({ ...doc('queued'), print: { requested: true, request_error: false, latest_job: null, jobs: 0 } }).print.label,
    'Se imprime al emitirse', 'pedida antes de autorizar: se imprime al emitirse, no se finge impresa');
  assert.equal(presentOrderFiscalState(authorized({}, { requested: true, latest_job: { id: 'j', status: 'printed' }, jobs: 1 })).print.label, 'Impreso');
  assert.equal(presentOrderFiscalState(authorized({}, { requested: true, request_error: true, latest_job: null, jobs: 0 })).print.label, 'No se pudo mandar a imprimir');
});

test('las razones del servidor se traducen sin inventar ni repetir', () => {
  assert.deepEqual(presentFiscalReasons([
    { code: 'PAYMENT_REQUIRED', payment_state: 'refunded' },
    { code: 'ORDER_NOT_BILLABLE_YET', billing_moment: 'after_delivered' },
    { code: 'MISSING_TAX_CLASSIFICATION', item: 'Queso por kg' },
    { code: 'MISSING_TAX_CLASSIFICATION', item: 'Queso por kg' },
    { code: 'ALGO_NUEVO' },
  ]), ['El pago fue devuelto', 'Se factura cuando el pedido se entregue', 'Falta la clasificación impositiva de un producto: Queso por kg', 'Revisión fiscal necesaria']);
  assert.equal(presentOrderFiscalActionResult({ ok: false, code: 'ORDER_NOT_FISCALLY_READY', reasons: [{ code: 'ACCOUNTING_POLICY_REQUIRED' }] }),
    'No se puede facturar todavía: Configuración fiscal pendiente');
  assert.equal(presentOrderFiscalActionResult({ ok: true }, { print: true }), 'Factura pedida. Se imprime cuando ARCA la autorice.');
});

test('nunca se muestra SQL, SOAP, PGRST, stacks ni credenciales', () => {
  for (const raw of [
    'PGRST202: Could not find the function public.request_order_invoice',
    'new row for relation "fiscal_documents" violates check constraint',
    '<soap:Fault><faultstring>x</faultstring></soap:Fault>',
    'Error: boom\n    at request (file:///app/js/x.js:10:3)',
    'token=abc sign=def',
    'P0001 pedido no facturable',
  ]) {
    assert.equal(sanitizeFiscalMessage(raw), 'No se pudo completar la operación. Probá de nuevo.', raw);
  }
  assert.equal(sanitizeFiscalMessage('Could not find the function public.request_order_invoice(p_business_id) in the schema cache'),
    'No se pudo completar la operación. Probá de nuevo.', 'PGRST202 sin el código también es jerga');
  assert.equal(sanitizeFiscalMessage('El pedido no existe.'), 'El pedido no existe.');
});

test('el resultado de una operación sale de un código conocido, nunca del texto del servidor', () => {
  const generic = 'No se pudo completar la operación. Probá de nuevo.';
  // Visto en la E2E contra la base: el mensaje de PostgREST no traía "PGRST" y pasaba el filtro.
  assert.equal(presentOrderFiscalActionResult({ ok: false, code: 'PGRST202', message: 'Could not find the function public.request_order_invoice(p_business_id, p_order_id) in the schema cache' }), generic);
  assert.equal(presentOrderFiscalActionResult({ ok: false, code: '22023', message: 'canal invalido' }), generic, 'ni siquiera un texto corto en castellano');
  assert.equal(presentOrderFiscalActionResult({ ok: false, code: 'P0001', message: 'fiscal_policy_review_required errcode' }), generic);
  assert.equal(presentOrderFiscalActionResult({ ok: false, code: 'SESSION_EXPIRED' }), 'La sesión venció. Volvé a iniciar sesión.');
  assert.equal(presentOrderFiscalActionResult({ ok: false, code: 'NOT_FOUND', message: 'pedido inexistente' }), 'El pedido ya no está disponible. Actualizá la bandeja.');
  assert.equal(presentOrderFiscalActionResult({ ok: false, code: 'SERVER_UNAVAILABLE', retryable: true, message: 'upstream request timeout' }),
    'No hubo respuesta del servidor. Probá de nuevo en unos segundos.');
  assert.equal(presentOrderFiscalActionResult({ ok: true }, { action: 'reprint' }), 'Reimpresión enviada a la PC de impresión.');
  assert.equal(presentOrderFiscalActionResult({ ok: false, code: 'P0001', message: 'el trabajo original todavia esta en curso' }, { action: 'reprint' }),
    'La impresión anterior todavía está en curso. Esperá a que termine para reimprimir.');
  assert.equal(presentOrderFiscalActionResult({ ok: false, code: 'FORBIDDEN' }, { action: 'pdf' }), 'Tu usuario no puede ver este comprobante.');
  assert.equal(presentOrderFiscalActionResult({ ok: false, code: 'ARTIFACT_ACCESS_UNAVAILABLE' }, { action: 'pdf' }), 'El PDF todavía no está disponible.');
});

test('el repositorio llama las RPC reales con sus nombres de argumento', async () => {
  const calls = [];
  const client = {
    from() { throw new Error('no se usa'); },
    async rpc(name, args) {
      calls.push([name, args]);
      if (name === 'request_order_invoice' && args.p_order_id === 'bloqueado') {
        return { data: null, status: 400, error: { code: 'P0001', message: 'pedido no facturable', hint: 'ORDER_NOT_FISCALLY_READY',
          details: JSON.stringify([{ code: 'PAYMENT_REQUIRED', payment_state: 'pending', sql: 'select 1' }, { code: 'INVENTADO' }]) } };
      }
      return { data: { ok: true }, error: null, status: 200 };
    },
  };
  const repository = createSupabaseFiscalRepository({ client, businessId: 'b' });
  assert.equal((await repository.requestOrderInvoice({ orderId: 'o', idempotencyKey: 'order-invoice-o', commandSource: 'PANEL', print: true })).ok, true);
  const blocked = await repository.requestOrderInvoice({ orderId: 'bloqueado', idempotencyKey: 'order-invoice-x' });
  assert.deepEqual(blocked.reasons, [{ code: 'PAYMENT_REQUIRED', payment_state: 'pending' }], 'solo códigos y campos conocidos');
  assert.equal(blocked.code, 'ORDER_NOT_FISCALLY_READY');
  await repository.getOrderFiscalStates(['o']);
  await repository.requestPrintJobReprint({ printJobId: 'j', reason: 'r', idempotencyKey: 'order-reprint-j' });
  await repository.getLocalPrintStatus();
  assert.deepEqual(calls.map(([name, args]) => [name, Object.keys(args).sort()]), [
    ['request_order_invoice', ['p_business_id', 'p_command_source', 'p_idempotency_key', 'p_order_id', 'p_print']],
    ['request_order_invoice', ['p_business_id', 'p_command_source', 'p_idempotency_key', 'p_order_id', 'p_print']],
    ['get_order_fiscal_states', ['p_business_id', 'p_order_ids']],
    ['request_print_job_reprint', ['p_idempotency_key', 'p_job_id', 'p_reason']],
    ['get_local_print_status', ['p_business_id']],
  ]);
  assert.deepEqual(parseReadinessReasons('no es json'), []);
});
