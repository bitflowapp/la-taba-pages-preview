// Piloto cerrado de cobro real: el documento de autorización, el preflight y la verificación de la compra y de la devolución.
// Todo puro: sin red, sin base, sin dinero. La puerta de la base la prueba tests/db/live-pilot-gate.test.mjs.
import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { plantilla, validar, huella, resumen, parametrosRpc, PENDIENTE } from '../scripts/mercadopago/piloto/documento.mjs';
import { verificarCompra, verificarDevolucion } from '../scripts/mercadopago/piloto/verificacion.mjs';
import { evaluarPreflight } from '../scripts/mercadopago/piloto/preflight.mjs';
import { rechazo, leerArgumentos, carpetaFueraDelRepo } from '../scripts/mercadopago/piloto-pago-real.mjs';

const HOY = '2026-10-27';
const PRODUCTO = '30000000-0000-4000-8000-000000000001';
const ids = { comercio: '20000000-0000-4000-8000-000000000001', cliente: '10000000-0000-4000-8000-000000000001' };
const documento = (cambios = {}) => structuredClone({
  esquema: 'taba-autorizacion-cobro-real/1', destino: 'production',
  comercio: { id: ids.comercio, slug: 'la-taba-neuquen' },
  vendedor: { collector_id: '555000111', titular: 'Walter Prueba SRL', cuenta_mercado_pago: 'walter@example.invalid' },
  comprador: { cliente_taba_id: ids.cliente, cuenta_mercado_pago: 'marco@example.invalid', distinta_del_vendedor: true },
  compra: { concepto: 'Cobro de control de un producto con retiro', items: [{ producto_id: PRODUCTO, sku: 'CTRL-001', cantidad: 1 }], importe_ars: 1234.5, entrega: 'retiro' },
  comisiones: { las_asume: 'vendedor', detalle: 'La comisión de Mercado Pago se descuenta del vendedor.' },
  devolucion: { via: 'panel_del_vendedor', quien: 'Walter, titular de la cuenta', importe_ars: 1234.5 },
  abortar_si: 'El importe que muestra Mercado Pago no es exactamente el autorizado o el cobrador no es el titular.',
  vigencia_minutos: 120,
  autoriza: { nombre: 'Walter Prueba', cargo: 'Titular del comercio', fecha: HOY },
  declaraciones: { dinero_real: true, una_sola_compra: true, devolucion_incluida: true, importe_elegido_por_el_titular: true },
  ...cambios,
});

// ---------------------------------------------------------------------------------------------- documento

test('la plantilla nunca es válida: todo lo que decide el titular queda pendiente', () => {
  const errores = validar(plantilla(), { hoy: HOY });
  assert.ok(errores.length > 10);
  assert.ok(JSON.stringify(plantilla()).includes(PENDIENTE));
  assert.equal(plantilla().compra.importe_ars, PENDIENTE, 'ingeniería no elige el importe');
});

test('un documento completo y coherente es válido y tiene huella estable', () => {
  assert.deepEqual(validar(documento(), { hoy: HOY }), []);
  assert.equal(huella(documento()), huella(documento()));
  const reordenado = documento();
  const { compra, ...resto } = reordenado;
  assert.equal(huella({ compra, ...resto }), huella(documento()), 'el orden de las claves no cambia la huella');
  assert.notEqual(huella(documento({ compra: { ...documento().compra, importe_ars: 1234.51 } })), huella(documento()), 'un centavo cambia la huella');
});

const casos = [
  ['comprador con la misma cuenta que el vendedor', { comprador: { ...documento().comprador, cuenta_mercado_pago: 'WALTER@example.invalid' } }, 'comprador.cuenta_mercado_pago'],
  ['comprador que es el número de usuario del vendedor', { comprador: { ...documento().comprador, cuenta_mercado_pago: '555000111' } }, 'comprador.cuenta_mercado_pago'],
  ['sin declarar que el comprador es distinto', { comprador: { ...documento().comprador, distinta_del_vendedor: false } }, 'comprador.distinta_del_vendedor'],
  ['importe con tres decimales', { compra: { ...documento().compra, importe_ars: 10.005 } }, 'compra.importe_ars'],
  ['importe que supera el tope del piloto', { compra: { ...documento().compra, importe_ars: 50000.01 } }, 'compra.importe_ars'],
  ['importe como texto', { compra: { ...documento().compra, importe_ars: '1234.5' } }, 'compra.importe_ars'],
  ['entrega a domicilio', { compra: { ...documento().compra, entrega: 'delivery' } }, 'compra.entrega'],
  ['producto repetido', { compra: { ...documento().compra, items: [documento().compra.items[0], documento().compra.items[0]] } }, 'compra.items[1].producto_id'],
  ['cantidad fraccionaria', { compra: { ...documento().compra, items: [{ ...documento().compra.items[0], cantidad: 1.5 }] } }, 'compra.items[0].cantidad'],
  ['devolución mayor que la compra', { devolucion: { ...documento().devolucion, importe_ars: 2000 } }, 'devolucion.importe_ars'],
  ['vía de devolución desconocida', { devolucion: { ...documento().devolucion, via: 'efectivo' } }, 'devolucion.via'],
  ['condiciones de aborto vacías', { abortar_si: 'si algo sale mal' }, 'abortar_si'],
  ['autorización de otro día', { autoriza: { ...documento().autoriza, fecha: '2026-10-20' } }, 'autoriza.fecha'],
  ['declaración sin marcar', { declaraciones: { ...documento().declaraciones, importe_elegido_por_el_titular: false } }, 'declaraciones.importe_elegido_por_el_titular'],
  ['vendedor con número inválido', { vendedor: { ...documento().vendedor, collector_id: '0123' } }, 'vendedor.collector_id'],
  ['comisiones sin detalle', { comisiones: { las_asume: 'vendedor', detalle: 'ok' } }, 'comisiones.detalle'],
  ['destino desconocido', { destino: 'staging' }, 'destino'],
  ['vigencia de una semana', { vigencia_minutos: 10080 }, 'vigencia_minutos'],
];
for (const [nombre, cambios, ruta] of casos) {
  test(`documento inválido: ${nombre}`, () => {
    const errores = validar(documento(cambios), { hoy: HOY });
    assert.ok(errores.some((e) => e.ruta === ruta), `se esperaba un error en ${ruta}: ${JSON.stringify(errores)}`);
  });
}

test('el resumen dice cuánto, quién recibe, quién paga y cómo se aborta; los parámetros de la base salen del mismo documento', () => {
  const texto = resumen(documento());
  assert.match(texto, /PRODUCCIÓN — DINERO REAL/);
  assert.match(texto, /EXACTAMENTE/);
  assert.match(texto, /555000111/);
  assert.match(texto, /marco@example\.invalid/);
  assert.match(texto, /Se aborta si/);
  const p = parametrosRpc(documento());
  assert.equal(p.p_environment, 'production');
  assert.equal(p.p_amount, 1234.5);
  assert.equal(p.p_fee_bearer, 'seller');
  assert.equal(p.p_refund_plan, 'seller_panel');
  assert.deepEqual(p.p_items, [{ product_id: PRODUCTO, quantity: 1 }]);
  assert.equal(p.p_authorization_sha256, huella(documento()));
  assert.equal(parametrosRpc(documento({ destino: 'qa' })).p_environment, 'test');
});

// ---------------------------------------------------------------------------------------------- CLI

test('el CLI rechaza sin tocar la red: autorizar exige archivo, evidencia, importe y huella escritos a mano, y en producción la frase de dinero real', () => {
  const base = { comando: 'autorizar', target: 'production', archivo: 'a.json', evidencia: 'e', confirmoImporte: '10', confirmoSha: 'abcdef012345', confirmoDineroReal: true };
  assert.equal(rechazo(base), null);
  assert.equal(rechazo({ ...base, confirmoDineroReal: false }), 'FALTA_CONFIRMO_DINERO_REAL');
  assert.equal(rechazo({ ...base, target: 'qa', confirmoDineroReal: false }), null, 'en QA no hay dinero real que confirmar');
  assert.equal(rechazo({ ...base, confirmoSha: 'abc' }), 'FALTA_CONFIRMO_SHA');
  assert.equal(rechazo({ ...base, confirmoImporte: null }), 'FALTA_CONFIRMO_IMPORTE');
  assert.equal(rechazo({ ...base, evidencia: null }), 'FALTA_CARPETA_DE_EVIDENCIA');
  assert.equal(rechazo({ ...base, target: 'staging' }), 'TARGET_INVALIDO');
  assert.equal(rechazo({ comando: 'abrir-al-publico', target: 'production' }), 'COMANDO_INVALIDO', 'abrir al público no es un comando de esta herramienta');
  assert.equal(rechazo({ comando: 'abortar', target: 'qa', autorizacion: ids.comercio, motivo: 'no' }), 'FALTA_MOTIVO');
  assert.equal(rechazo({ comando: 'verificar-devolucion', target: 'qa', autorizacion: ids.comercio, importe: '0', operacion: '900123' }), 'FALTA_IMPORTE_DEVUELTO');
  assert.equal(rechazo({ comando: 'verificar-devolucion', target: 'qa', autorizacion: ids.comercio, importe: '10' }), 'FALTA_OPERACION_AUTORIZADA');
  assert.equal(rechazo({ comando: 'verificar-devolucion', target: 'qa', autorizacion: ids.comercio, importe: '10', operacion: '900123' }), null);
  assert.deepEqual(leerArgumentos(['autorizar', '--target', 'qa', '--confirmo-dinero-real', '--archivo', 'x']).confirmoDineroReal, true);
});

test('la evidencia y el documento firmado no pueden vivir dentro del repositorio público', () => {
  assert.equal(carpetaFueraDelRepo(process.cwd()), false);
  assert.equal(carpetaFueraDelRepo(path.join(os.tmpdir(), 'evidencia-piloto')), true);
});

// ---------------------------------------------------------------------------------------------- verificación de la compra

const auth = () => ({
  id: 'a0000000-0000-4000-8000-000000000001', status: 'consumed', environment: 'production', customer_id: ids.cliente, amount: 1234.5,
  items: [{ product_id: PRODUCTO, quantity: 1 }], seller_collector_id: '555000111', consumed_by_intent_id: 'i0000000-0000-4000-8000-000000000001',
});
const compraOk = () => ({
  authorization: auth(), settings: { collector_id: '555000111' },
  session: { id: 's1', customer_id: ids.cliente, total: 1234.5, completed_order_id: 'o1' },
  intents: [{ id: 'i0000000-0000-4000-8000-000000000001', expected_amount: 1234.5, currency: 'ARS', live_mode: true, order_id: 'o1', raw_response_hash: 'a'.repeat(64), approved_at: '2026-10-27T15:00:00Z', refunded_amount: 0, internal_status: 'completed' }],
  payments: [{ provider_payment_id: '900', environment: 'production', seller_id: '555000111', status: 'approved', amount: 1234.5, currency: 'ARS', is_financing: true, validation_error: null, provider_event_at: '2026-10-27T15:00:00Z', first_seen_at: '2026-10-27T15:00:01Z', last_seen_at: '2026-10-27T15:00:02Z', refunded_amount: 0 }],
  attempts: [{ attempt_type: 'preference', preference_id: 'PREF-1', status: 'created' }],
  receipts: [{ resource_id: '900', signature_valid: true, processing_status: 'completed' }, { resource_id: '900', signature_valid: true, processing_status: 'duplicate' }],
  outbox: [{ status: 'completed' }],
  orders: [{ id: 'o1', public_code: 'LT-0001', total: 1234.5, status: 'received', cancelled_at: null }],
  reservations: [{ product_id: PRODUCTO, quantity: 1, status: 'converted' }],
  refunds: [], discrepancies: [], stockNow: [{ id: PRODUCTO, sku: 'CTRL-001', stock: 4 }],
});
const estados = (r) => Object.fromEntries(r.checks.map((c) => [c.id, c.estado]));

test('la compra de control correcta pasa todas las comprobaciones automáticas y deja dos manuales', () => {
  const r = verificarCompra(compraOk(), { baselineStock: { [PRODUCTO]: 5 }, integratorOwnerId: '721168650' });
  assert.equal(r.ok, true, JSON.stringify(r.checks.filter((c) => c.estado === 'FAIL')));
  assert.equal(r.manual, 2);
  assert.equal(estados(r).stock_una_sola_vez, 'PASS');
  assert.equal(estados(r).cuenta_que_recibio_el_dinero, 'MANUAL');
});

const mutaciones = [
  ['otro cobrador', (s) => { s.payments[0].seller_id = '999999'; }, 'cobrador_correcto'],
  ['el cobrador es la integradora', (s) => { s.payments[0].seller_id = '721168650'; s.settings.collector_id = '721168650'; s.authorization.seller_collector_id = '721168650'; }, 'cobrador_correcto'],
  ['importe distinto del autorizado', (s) => { s.payments[0].amount = 1234; }, 'pago_autentico_aprobado'],
  ['dos pedidos', (s) => { s.orders.push({ ...s.orders[0], id: 'o2' }); }, 'un_solo_pedido'],
  ['dos preferencias', (s) => { s.attempts.push({ attempt_type: 'preference', preference_id: 'PREF-2' }); }, 'una_unica_preferencia'],
  ['otro cliente creó la sesión', (s) => { s.session.customer_id = 'x'; }, 'comprador_correcto'],
  ['autorización sin consumir', (s) => { s.authorization.status = 'authorized'; }, 'autorizacion_consumida'],
  ['sin lectura directa al proveedor', (s) => { s.intents[0].raw_response_hash = null; }, 'verificado_directamente_con_el_proveedor'],
  ['aviso con firma inválida procesado como válido', (s) => { s.receipts[0].processing_status = 'failed'; }, 'aviso_de_pago'],
  ['el stock bajó dos veces', (s) => { s.stockNow[0].stock = 3; }, 'stock_una_sola_vez'],
  ['reserva todavía activa', (s) => { s.reservations.push({ product_id: PRODUCTO, quantity: 1, status: 'active' }); }, 'stock_una_sola_vez'],
  ['discrepancia abierta', (s) => { s.discrepancies.push({ kind: 'paid_without_order', status: 'open' }); }, 'conciliacion_limpia'],
  ['cola sin vaciar', (s) => { s.outbox.push({ status: 'retry_wait' }); }, 'conciliacion_limpia'],
  ['pago de prueba en un entorno productivo', (s) => { s.intents[0].live_mode = false; }, 'entorno_correcto'],
  ['ya hay una devolución', (s) => { s.refunds.push({ status: 'approved' }); }, 'sin_duplicados'],
];
for (const [nombre, mutar, esperado] of mutaciones) {
  test(`verificación de la compra: ${nombre} se detecta`, () => {
    const s = compraOk();
    mutar(s);
    const r = verificarCompra(s, { baselineStock: { [PRODUCTO]: 5 }, integratorOwnerId: '721168650' });
    assert.equal(r.ok, false);
    assert.equal(estados(r)[esperado], 'FAIL', JSON.stringify(r.checks.map((c) => [c.id, c.estado])));
  });
}

test('sin línea base el descuento de stock no se declara verificado', () => {
  const r = verificarCompra(compraOk());
  assert.equal(estados(r).stock_una_sola_vez, 'MANUAL');
  assert.equal(r.ok, true);
});

// ---------------------------------------------------------------------------------------------- verificación de la devolución

const devueltoOk = () => {
  const s = compraOk();
  s.payments[0].status = 'refunded'; s.payments[0].refunded_amount = 1234.5;
  s.intents[0].refunded_amount = 1234.5; s.intents[0].internal_status = 'refunded';
  s.refunds = [{ id: 'r1', status: 'approved', amount: 1234.5, provider_refund_id: '3000001', idempotency_key: 'k1', origin: 'external' }];
  s.orders[0].status = 'cancelled';
  s.stockNow[0].stock = 5;
  return s;
};

test('una devolución completa con evidencia del proveedor, pedido cancelado y stock repuesto pasa', () => {
  const r = verificarDevolucion(devueltoOk(), { importeDevuelto: 1234.5, operacion: '900', baselineStock: { [PRODUCTO]: 5 } });
  assert.equal(r.ok, true, JSON.stringify(r.checks.filter((c) => c.estado === 'FAIL')));
});

const mutacionesDevolucion = [
  ['aprobada sin identificador del proveedor', (s) => { s.refunds[0].provider_refund_id = null; }, 'evidencia_del_proveedor'],
  ['quedó ambigua', (s) => { s.refunds.push({ id: 'r2', status: 'ambiguous', amount: 1234.5, idempotency_key: 'k2' }); }, 'sin_resultado_ambiguo'],
  ['importe distinto del autorizado', (s) => { s.refunds[0].amount = 1000; s.intents[0].refunded_amount = 1000; s.payments[0].refunded_amount = 1000; }, 'importe_exacto'],
  ['La Taba dice devuelto pero el proveedor no', (s) => { s.payments[0].status = 'approved'; s.payments[0].refunded_amount = 0; }, 'estado_real_en_el_proveedor'],
  ['la intención no coincide con lo devuelto', (s) => { s.intents[0].refunded_amount = 0; }, 'intencion_consistente'],
  ['discrepancia sin resolver', (s) => { s.discrepancies.push({ kind: 'refund_identity_unknown', status: 'open' }); }, 'conciliacion_de_la_devolucion'],
  ['pedido sin cancelar', (s) => { s.orders[0].status = 'received'; }, 'pedido_cerrado'],
  ['sin clave de idempotencia', (s) => { s.refunds[0].idempotency_key = null; }, 'solicitud_con_clave_de_idempotencia'],
  ['se devolvió otra operación', (s) => { s.payments[0].provider_payment_id = '901'; }, 'operacion_autorizada'],
];
for (const [nombre, mutar, esperado] of mutacionesDevolucion) {
  test(`verificación de la devolución: ${nombre} no se da por devuelto`, () => {
    const s = devueltoOk();
    mutar(s);
    const r = verificarDevolucion(s, { importeDevuelto: 1234.5, operacion: '900', baselineStock: { [PRODUCTO]: 5 } });
    assert.equal(r.ok, false);
    assert.equal(estados(r)[esperado], 'FAIL', JSON.stringify(r.checks.map((c) => [c.id, c.estado])));
  });
}

test('una devolución parcial deja el pago aprobado en el proveedor y la suma exacta', () => {
  const s = compraOk();
  s.payments[0].refunded_amount = 200; s.intents[0].refunded_amount = 200;
  s.refunds = [{ id: 'r1', status: 'approved', amount: 200, provider_refund_id: '3000002', idempotency_key: 'k1', origin: 'api' }];
  s.orders[0].status = 'cancelled';
  const r = verificarDevolucion(s, { importeDevuelto: 200, operacion: '900', entregado: true });
  assert.equal(r.ok, true, JSON.stringify(r.checks.filter((c) => c.estado === 'FAIL')));
});

// ---------------------------------------------------------------------------------------------- preflight

const ahora = Date.parse('2026-10-27T12:00:00Z');
const preflightOk = (extra = {}) => ({
  target: 'production', registro: { status: 'provisioned' }, ahora,
  settings: { enabled: true, environment: 'production', production_review_status: 'approved', collector_id: '555000111', application_id: '7677852968049976' },
  conexion: { environment: 'production', status: 'connected', seller_id: '555000111', application_id: '7677852968049976', expires_at: '2027-04-01T00:00:00Z' },
  estadoPiloto: { pilot_lock_applies: true, scope: 'pilot (default)', authorizations: [] },
  sesionesAbiertas: 0, intencionesEntorno: 0, discrepanciasAbiertas: 0,
  mp: { outbox: [], intents: [], refunds: [], receipts: [] },
  documento: documento(),
  productos: [{ id: PRODUCTO, sku: 'CTRL-001', price: 1234.5, stock: 5, is_active: true, available: true, price_status: 'confirmed', is_alcoholic: false }],
  ...extra,
});

test('preflight: con todo en orden no hay bloqueos y deja la lista de comprobaciones manuales', () => {
  const r = evaluarPreflight(preflightOk());
  assert.equal(r.ok, true, JSON.stringify(r.checks.filter((c) => c.estado === 'FAIL')));
  assert.ok(r.manual >= 4);
});

const bloqueos = [
  ['producción sin proyecto', { registro: { status: 'not_provisioned' } }, 'entorno_registrado'],
  ['comercio abierto al público', { estadoPiloto: { pilot_lock_applies: false, scope: 'public', authorizations: [] } }, 'candado_del_piloto'],
  ['autorización anterior abierta', { estadoPiloto: { pilot_lock_applies: true, scope: 'pilot', authorizations: [{ id: 'x', status: 'authorized', expires_at: 'mañana' }] } }, 'sin_autorizacion_abierta'],
  ['compra en curso', { sesionesAbiertas: 1 }, 'sin_compras_en_curso'],
  ['vendedor desconectado', { conexion: { environment: 'production', status: 'disconnected' } }, 'vendedor_conectado'],
  ['vendedor distinto del autorizado', { settings: { enabled: true, environment: 'production', production_review_status: 'approved', collector_id: '777', application_id: '7677852968049976' }, conexion: { environment: 'production', status: 'connected', seller_id: '777', application_id: '7677852968049976', expires_at: '2027-04-01T00:00:00Z' } }, 'vendedor_es_el_autorizado'],
  ['revisión productiva sin aprobar', { settings: { enabled: true, environment: 'production', production_review_status: 'not_requested', collector_id: '555000111', application_id: '7677852968049976' } }, 'revision_productiva'],
  ['credencial por vencer', { conexion: { environment: 'production', status: 'connected', seller_id: '555000111', application_id: '7677852968049976', expires_at: '2026-10-30T00:00:00Z' } }, 'credencial_vigente'],
  ['discrepancia abierta', { discrepanciasAbiertas: 1 }, 'cola_y_conciliacion'],
  ['producto sin stock', { productos: [{ id: PRODUCTO, sku: 'CTRL-001', price: 1234.5, stock: 0, is_active: true, available: true, price_status: 'confirmed', is_alcoholic: false }] }, 'producto_de_la_prueba'],
  ['importe que no suma el catálogo', { productos: [{ id: PRODUCTO, sku: 'CTRL-001', price: 1000, stock: 5, is_active: true, available: true, price_status: 'confirmed', is_alcoholic: false }] }, 'producto_de_la_prueba'],
  ['producto con alcohol', { productos: [{ id: PRODUCTO, sku: 'CTRL-001', price: 1234.5, stock: 5, is_active: true, available: true, price_status: 'confirmed', is_alcoholic: true }] }, 'producto_de_la_prueba'],
];
for (const [nombre, cambios, esperado] of bloqueos) {
  test(`preflight: ${nombre} bloquea`, () => {
    const r = evaluarPreflight(preflightOk(cambios));
    assert.equal(r.ok, false);
    assert.equal(r.checks.find((c) => c.id === esperado).estado, 'FAIL', JSON.stringify(r.checks.map((c) => [c.id, c.estado])));
  });
}

test('preflight: avisos con firma rechazada se informan pero no bloquean; una cola muerta sí', () => {
  const rechazados = Array.from({ length: 3 }, () => ({ processing_status: 'rejected_signature', signature_valid: false }));
  const valido = { processing_status: 'completed', signature_valid: true };
  const conValidos = evaluarPreflight(preflightOk({ mp: { outbox: [], intents: [], refunds: [], receipts: [...rechazados, valido] } }));
  assert.equal(conValidos.ok, true);
  assert.match(conValidos.checks.find((c) => c.id === 'avisos_con_firma_rechazada').detalle, /3/);
  const sinValidos = evaluarPreflight(preflightOk({ mp: { outbox: [], intents: [], refunds: [], receipts: rechazados } }));
  assert.equal(sinValidos.ok, true);
  assert.match(sinValidos.checks.find((c) => c.id === 'avisos_con_firma_rechazada').detalle, /NINGUNO válido/);
  const muerta = evaluarPreflight(preflightOk({ mp: { outbox: [{ status: 'dead_letter' }], intents: [], refunds: [], receipts: [] } }));
  assert.equal(muerta.ok, false);
  assert.equal(muerta.checks.find((c) => c.id === 'cola_y_conciliacion').estado, 'FAIL');
});

test('preflight de QA no exige proyecto de producción ni revisión productiva', () => {
  const r = evaluarPreflight(preflightOk({ target: 'qa', registro: undefined,
    settings: { enabled: true, environment: 'test', production_review_status: 'not_requested', collector_id: '555000111', application_id: '7677852968049976' },
    conexion: { environment: 'test', status: 'connected', seller_id: '555000111', application_id: '7677852968049976', expires_at: '2027-04-01T00:00:00Z' },
    documento: undefined, productos: undefined }));
  assert.equal(r.ok, true, JSON.stringify(r.checks.filter((c) => c.estado === 'FAIL')));
});
