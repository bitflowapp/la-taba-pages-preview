import test from 'node:test';
import assert from 'node:assert/strict';

import {
  ACCESS_STEP,
  accessRegistrationCopy,
  accessRegistrationView,
  canRequestAgain,
  normalizeAccessStep,
  renderAccessRegistration,
  stepForAccessState,
} from '../js/business/business-access-registration.js';

test('cada estado del backend tiene exactamente una pantalla', () => {
  assert.equal(stepForAccessState('pending'), ACCESS_STEP.PENDING);
  assert.equal(stepForAccessState('rejected'), ACCESS_STEP.REJECTED);
  assert.equal(stepForAccessState('none'), ACCESS_STEP.REQUEST);
});

test('un estado que no se pudo determinar vuelve al ingreso, no adivina', () => {
  // Fallar hacia "pedí acceso" mostraría un formulario a alguien que quizás ya
  // es del equipo. Fallar hacia "ingresá" no le promete nada a nadie.
  assert.equal(stepForAccessState('unknown'), ACCESS_STEP.SIGN_IN);
  assert.equal(stepForAccessState('member'), ACCESS_STEP.SIGN_IN);
  assert.equal(stepForAccessState(''), ACCESS_STEP.SIGN_IN);
  assert.equal(stepForAccessState(undefined), ACCESS_STEP.SIGN_IN);
  assert.equal(normalizeAccessStep('cualquier-cosa'), ACCESS_STEP.SIGN_IN);
});

test('el formulario de ingreso convive sólo con su propia pantalla', () => {
  assert.equal(accessRegistrationView({ step: ACCESS_STEP.SIGN_IN }).hidesSignIn, false);
  for (const step of [ACCESS_STEP.SIGN_UP, ACCESS_STEP.REQUEST, ACCESS_STEP.PENDING, ACCESS_STEP.REJECTED]) {
    assert.equal(accessRegistrationView({ step }).hidesSignIn, true, step);
  }
});

test('crear la cuenta dice, en la propia pantalla, que todavía no da acceso', () => {
  const markup = renderAccessRegistration({ step: ACCESS_STEP.SIGN_UP });
  assert.match(markup, /data-panel-signup-form/);
  assert.match(accessRegistrationCopy(ACCESS_STEP.SIGN_UP).lead, /todavía no te da acceso/i);
});

test('la pantalla de espera ofrece refrescar y cerrar sesión, y nada más', () => {
  const markup = renderAccessRegistration({
    step: ACCESS_STEP.PENDING,
    request: { status: 'pending', requestedAccess: 'panel', requestedAt: '2026-08-17T10:00:00Z' },
  });
  assert.match(markup, /data-panel-access-refresh/);
  assert.match(markup, /data-panel-access-signout/);
  assert.doesNotMatch(markup, /data-panel-signup-form/);
  assert.doesNotMatch(markup, /data-panel-request-form/);
});

test('ninguna pantalla filtra vocabulario del backend', () => {
  // FASE 22: la persona ve una frase comercial. Nunca 403, PGRST, JWT ni
  // "policy". Se revisa el texto de las cinco pantallas de una sola vez.
  for (const step of Object.values(ACCESS_STEP)) {
    const markup = renderAccessRegistration({
      step,
      message: 'No pudimos enviar la solicitud. Probá de nuevo.',
      request: { status: 'rejected', decidedAt: '2026-08-17T10:00:00Z', retryAt: '2026-08-18T10:00:00Z' },
    });
    assert.doesNotMatch(markup, /PGRST|policy|JWT|42501|403|row-level/i, step);
  }
});

test('el motivo interno del comercio no llega a la pantalla del rechazado', () => {
  const markup = renderAccessRegistration({
    step: ACCESS_STEP.REJECTED,
    request: {
      status: 'rejected',
      decidedAt: '2026-08-17T10:00:00Z',
      decisionReason: 'no lo conocemos',
    },
  });
  assert.doesNotMatch(markup, /no lo conocemos/);
});

test('volver a pedir aparece recién cuando la espera se cumplió', () => {
  const base = { status: 'rejected', decidedAt: '2026-08-16T10:00:00Z' };
  const ahora = new Date('2026-08-17T09:00:00Z');

  assert.equal(canRequestAgain({ ...base, retryAt: '2026-08-17T10:00:00Z' }, ahora), false);
  assert.equal(canRequestAgain({ ...base, retryAt: '2026-08-17T08:00:00Z' }, ahora), true);

  const esperando = renderAccessRegistration({
    step: ACCESS_STEP.REJECTED,
    request: { ...base, retryAt: '2999-01-01T00:00:00Z' },
  });
  assert.doesNotMatch(esperando, /data-panel-access-goto="request"/);
});

test('una solicitud pendiente nunca ofrece volver a pedir', () => {
  assert.equal(canRequestAgain({ status: 'pending', retryAt: null }), false);
  assert.equal(canRequestAgain(null), false);
});

test('los datos que la persona ya escribió vuelven al formulario', () => {
  const markup = renderAccessRegistration({
    step: ACCESS_STEP.REQUEST,
    request: { fullName: 'Marco Perez', contactPhone: '2996000001' },
  });
  assert.match(markup, /value="Marco Perez"/);
  assert.match(markup, /value="2996000001"/);
});

test('el HTML no se rompe con datos que traen comillas', () => {
  const markup = renderAccessRegistration({
    step: ACCESS_STEP.REQUEST,
    request: { fullName: '"><img src=x onerror=alert(1)>', contactPhone: '' },
  });
  assert.doesNotMatch(markup, /<img/);
  assert.match(markup, /&quot;&gt;&lt;img/);
});

test('mientras se envía, el botón no se puede volver a apretar', () => {
  const markup = renderAccessRegistration({ step: ACCESS_STEP.REQUEST, busy: true });
  assert.match(markup, /type="submit" disabled/);
});
