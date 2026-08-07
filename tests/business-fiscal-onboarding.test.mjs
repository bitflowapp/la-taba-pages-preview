// El onboarding fiscal visto desde el lado de Walter: seis pasos, una bandeja
// con lo que necesita atención y un interruptor que no se puede tocar hasta que
// todo esté verificado.
//
// Los códigos los produce el backend (fiscal_automation_blockers). Acá se
// verifica que se traduzcan a algo que una persona pueda accionar, y que nada
// técnico se filtre a la pantalla.
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildFiscalDashboard,
  buildFiscalOnboarding,
  describeFiscalBlocker,
  describeFiscalException,
  FISCAL_ONBOARDING_STEPS,
} from '../js/business/business-fiscal-assistant.js';
import {
  configureBusinessOperations,
  handleBusinessOperationsAction,
  handleBusinessOperationsInput,
  renderBusinessOperations,
  resetBusinessOperationsForTests,
} from '../js/business/business-operations-center.js';

const READY_OVERVIEW = Object.freeze({
  environment: 'homologation', automation_mode: 'manual', automation_active: false,
  ready: true, blockers: [],
  today: { date: '2026-08-07', eligible: 12, automatic: 10, pending: 1, rejected: 0, attention: 1 },
  totals_by_environment: { homologation: { authorized: 3 }, production: { authorized: 0 } },
});

function inputTarget(selector, properties) {
  return { matches: (candidate) => candidate === selector, ...properties };
}

function actionTarget(selector) {
  const node = { dataset: {}, closest: (candidate) => (candidate === selector ? node : null) };
  return node;
}

async function settle() {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

test('el onboarding son seis pasos y cada uno dice COMPLETO, PENDIENTE o ERROR', () => {
  const onboarding = buildFiscalOnboarding({
    ready: false,
    blockers: ['CERTIFICATE_MISSING', 'ACCOUNTANT_REVIEW_PENDING'],
  });
  assert.deepEqual(onboarding.steps.map((step) => step.id), [...FISCAL_ONBOARDING_STEPS]);
  assert.equal(onboarding.steps.length, 6);
  const byId = Object.fromEntries(onboarding.steps.map((step) => [step.id, step]));
  assert.equal(byId['business-data'].statusLabel, 'COMPLETO');
  assert.equal(byId['tax-situation'].statusLabel, 'PENDIENTE');
  assert.equal(byId.certificate.statusLabel, 'PENDIENTE');
  assert.equal(byId.automation.statusLabel, 'PENDIENTE');
  assert.equal(onboarding.currentStep, 'tax-situation', 'el paso actual es el primero que falta');
  assert.equal(onboarding.canActivate, false);
});

test('lo que falta y lo que está mal no se muestran igual', () => {
  // Un certificado vencido no es un dato que falte: es un problema.
  const broken = buildFiscalOnboarding({ ready: false, blockers: ['CERTIFICATE_EXPIRED'] });
  assert.equal(broken.steps.find((step) => step.id === 'certificate').statusLabel, 'ERROR');
  const missing = buildFiscalOnboarding({ ready: false, blockers: ['CERTIFICATE_MISSING'] });
  assert.equal(missing.steps.find((step) => step.id === 'certificate').statusLabel, 'PENDIENTE');
});

test('cada código trae un motivo y una acción concreta, no un código', () => {
  for (const code of [
    'CERTIFICATE_EXPIRED', 'CUIT_INVALID', 'ACCOUNTING_POLICY_NOT_APPROVED',
    'POINT_OF_SALE_MISSING', 'OFFICIAL_TABLES_STALE', 'DELEGATION_PENDING',
  ]) {
    const described = describeFiscalBlocker(code);
    assert.ok(described.reason.length > 10, `${code} necesita un motivo entendible`);
    assert.ok(described.action.length > 10, `${code} necesita decir qué hacer`);
    assert.doesNotMatch(`${described.reason} ${described.action}`, /[A-Z]{3,}_[A-Z]/, 'sin códigos crudos');
  }
  // Un código que no conocemos no rompe la pantalla ni la llena de jerga.
  const unknown = describeFiscalBlocker('ALGO_NUEVO');
  assert.match(unknown.reason, /Falta un dato fiscal/);
});

test('con todo listo el paso seis habilita y la automatización queda encendida', () => {
  const ready = buildFiscalOnboarding(READY_OVERVIEW);
  assert.equal(ready.canActivate, true);
  assert.equal(ready.currentStep, 'automation');
  assert.match(ready.headline, /falta encender/i);

  const on = buildFiscalOnboarding({ ...READY_OVERVIEW, automation_active: true, automation_mode: 'on_payment_confirmed' });
  assert.equal(on.steps.every((step) => step.statusLabel === 'COMPLETO'), true);
  assert.equal(on.canActivate, false, 'no se ofrece encender lo que ya está encendido');
  assert.match(on.headline, /encendida/i);
});

test('si la automatización se apagó sola, la pantalla dice por qué', () => {
  const suspended = buildFiscalOnboarding({
    ...READY_OVERVIEW, ready: false, blockers: ['ACCOUNTING_POLICY_NOT_APPROVED'],
    automation_suspended_at: '2026-08-07T12:00:00Z', automation_suspended_reason: 'ACCOUNTING_POLICY_CHANGED',
  });
  assert.equal(suspended.suspended, true);
  assert.match(suspended.suspendedReason, /política contable/i);
  assert.match(suspended.suspendedReason, /volvé a encenderla/i);
});

test('la bandeja traduce la excepción y nunca muestra nada técnico', () => {
  const rows = [
    { exception_id: 'config:CERTIFICATE_EXPIRED', kind: 'certificate', severity: 'blocking', code: 'CERTIFICATE_EXPIRED' },
    { exception_id: 'document:1', kind: 'rejected', severity: 'action_required', code: 'ARCA_REJECTED', document_label: '00003-00000012', total_amount: 3500 },
    { exception_id: 'document:2', kind: 'ambiguous', severity: 'blocking', code: 'AMBIGUOUS' },
    { exception_id: 'intent:3', kind: 'missing_fiscal_data', severity: 'blocking', code: 'FISCAL_DATA_MISSING' },
  ].map((row) => describeFiscalException(row));

  assert.match(rows[0].reason, /venció/i);
  assert.match(rows[0].action, /nuevo en ARCA/i);
  assert.equal(rows[1].severity, 'warning', 'un rechazo pide acción, no bloquea todo');
  assert.equal(rows[1].reference, '00003-00000012');
  assert.equal(rows[1].amount, 3500);
  assert.match(rows[2].action, /No lo emitas de nuevo/i, 'lo ambiguo se consulta solo');
  assert.match(rows[3].action, /sigue solo/i);
  for (const row of rows) {
    assert.doesNotMatch(`${row.title} ${row.reason} ${row.action}`, /soap|envelope|<[a-z]|ARCA_REJECTED|FISCAL_DATA_MISSING/i);
  }
});

test('el tablero separa las pruebas de homologación de las ventas del negocio', () => {
  const dashboard = buildFiscalDashboard(READY_OVERVIEW);
  assert.deepEqual(dashboard.tiles.map((tile) => tile.key), ['eligible', 'automatic', 'pending', 'rejected', 'attention']);
  assert.equal(dashboard.tiles.find((tile) => tile.key === 'automatic').value, 10);
  assert.equal(dashboard.tiles.find((tile) => tile.key === 'attention').tone, 'danger');
  assert.equal(dashboard.tiles.find((tile) => tile.key === 'rejected').tone, 'success', 'cero rechazos no es una alarma');
  assert.equal(dashboard.homologation.authorized, 3);
  assert.equal(dashboard.tiles.find((tile) => tile.key === 'automatic').value, 10, 'las de homologación no se suman a las del día');
});

// ===== La pantalla =====

function configureFiscalPanel({ overview, exceptions = [], onAutomation = async () => ({ ok: true }) } = {}) {
  configureBusinessOperations({
    role: 'owner',
    getArcaActivation: async () => ({
      ok: true,
      data: {
        legal_name: 'Negocio de ejemplo', cuit: '20123456786', cuit_valid: true,
        tax_condition: 'Responsable Inscripto', business_address: 'Calle 1',
        accountant_review_status: 'approved', certificate_loaded: true,
        certificate_expires_at: new Date(Date.now() + 86_400_000 * 200).toISOString(),
        delegation_status: 'verified', point_of_sale: 3, environment: 'homologation',
      },
    }),
    getFiscalAutomationOverview: async () => ({ ok: true, data: overview }),
    listFiscalExceptions: async () => ({ ok: true, data: exceptions }),
    setFiscalAutomation: onAutomation,
    onChange() {},
  });
}

test('la pantalla muestra los seis pasos, el tablero y la bandeja', async () => {
  configureFiscalPanel({
    overview: { ...READY_OVERVIEW, ready: false, blockers: ['POINT_OF_SALE_MISSING'] },
    exceptions: [{ exception_id: 'config:POINT_OF_SALE_MISSING', kind: 'configuration', severity: 'blocking', code: 'POINT_OF_SALE_MISSING' }],
  });
  renderBusinessOperations('fiscal-setup');
  await settle();
  const markup = renderBusinessOperations('fiscal-setup');

  assert.match(markup, /Configuración fiscal/);
  for (const title of ['Datos del negocio', 'Situación fiscal', 'Punto de venta', 'Certificado ARCA', 'Verificación', 'Facturación automática']) {
    assert.ok(markup.includes(title), `falta el paso "${title}"`);
  }
  assert.match(markup, /PENDIENTE/);
  assert.match(markup, /Ventas del día/);
  assert.match(markup, /Facturadas solas/);
  assert.match(markup, /Qué necesita tu atención/);
  assert.match(markup, /Dalo de alta en ARCA/, 'la bandeja dice qué hacer');
  assert.match(markup, /data-fiscal-automation="blocked"/, 'el interruptor no se puede tocar');
  assert.doesNotMatch(markup, /I_ACTIVATE_AUTOMATIC_FISCAL_INVOICING/, 'ni se pide la frase todavía');
  resetBusinessOperationsForTests();
});

test('con todo listo la pantalla ofrece encender, y sin la frase exacta no enciende', async () => {
  const calls = [];
  configureFiscalPanel({
    overview: READY_OVERVIEW,
    onAutomation: async (input) => { calls.push(input); return { ok: true, data: { ...READY_OVERVIEW, automation_active: true } }; },
  });
  renderBusinessOperations('fiscal-setup');
  await settle();
  assert.match(renderBusinessOperations('fiscal-setup'), /data-fiscal-automation="ready"/);

  const refused = await handleBusinessOperationsAction(actionTarget('[data-fiscal-automation-on]'));
  assert.equal(refused.ok, false);
  assert.match(refused.message, /I_ACTIVATE_AUTOMATIC_FISCAL_INVOICING/);
  assert.equal(calls.length, 0, 'no se llama al servidor sin la frase');

  handleBusinessOperationsInput(inputTarget('[name="fiscalAutomation"]', { value: 'I_ACTIVATE_AUTOMATIC_FISCAL_INVOICING' }));
  const accepted = await handleBusinessOperationsAction(actionTarget('[data-fiscal-automation-on]'));
  assert.equal(accepted.ok, true);
  assert.deepEqual(calls, [{ mode: 'on_payment_confirmed', confirmation: 'I_ACTIVATE_AUTOMATIC_FISCAL_INVOICING' }]);
  assert.match(accepted.message, /se factura sola/i);
  resetBusinessOperationsForTests();
});

test('la frase sobrevive a un refresco del panel', async () => {
  // La misma lección que el mostrador: lo que sólo vive en el DOM lo borra el
  // primer refresco de fondo, y acá eso sería no encender la facturación.
  configureFiscalPanel({ overview: READY_OVERVIEW });
  renderBusinessOperations('fiscal-setup');
  await settle();
  handleBusinessOperationsInput(inputTarget('[name="fiscalAutomation"]', { value: 'I_ACTIVATE_AUTOMATIC_FISCAL_INVOICING' }));
  const refreshed = renderBusinessOperations('fiscal-setup');
  assert.match(refreshed, /value="I_ACTIVATE_AUTOMATIC_FISCAL_INVOICING"/);
  resetBusinessOperationsForTests();
});

test('apagar la facturación automática no pide frase: frenar nunca es lo peligroso', async () => {
  const calls = [];
  configureFiscalPanel({
    overview: { ...READY_OVERVIEW, automation_active: true, automation_mode: 'on_payment_confirmed' },
    onAutomation: async (input) => { calls.push(input); return { ok: true, data: { ...READY_OVERVIEW } }; },
  });
  renderBusinessOperations('fiscal-setup');
  await settle();
  assert.match(renderBusinessOperations('fiscal-setup'), /data-fiscal-automation="on"/);

  const off = await handleBusinessOperationsAction(actionTarget('[data-fiscal-automation-off]'));
  assert.equal(off.ok, true);
  assert.deepEqual(calls, [{ mode: 'manual', confirmation: '' }]);
  assert.match(off.message, /se siguen cobrando igual/i);
  resetBusinessOperationsForTests();
});

test('el equipo del mostrador no ve ni toca la configuración fiscal', async () => {
  configureBusinessOperations({ role: 'staff', onChange() {} });
  const markup = renderBusinessOperations('fiscal-setup');
  assert.doesNotMatch(markup, /data-fiscal-automation-on/);
  const refused = await handleBusinessOperationsAction(actionTarget('[data-fiscal-automation-on]'));
  assert.equal(refused.ok, false);
  resetBusinessOperationsForTests();
});

test('sin nada que atender la bandeja lo dice en vez de quedar vacía', async () => {
  configureFiscalPanel({
    overview: { ...READY_OVERVIEW, automation_active: true },
    exceptions: [],
  });
  renderBusinessOperations('fiscal-setup');
  await settle();
  const markup = renderBusinessOperations('fiscal-setup');
  assert.match(markup, /Nada\. Si aparece algo acá/);
  assert.match(markup, /cada venta cobrada se factura sola/i);
  resetBusinessOperationsForTests();
});
