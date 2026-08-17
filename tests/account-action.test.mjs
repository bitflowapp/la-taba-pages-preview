import test from 'node:test';
import assert from 'node:assert/strict';

import {
  ACCOUNT_STEP,
  createAccountActionController,
  createAccountActionService,
  planFromSearch,
  renderAccountAction,
} from '../js/account-action.js';
import { TEAM_PASSWORD_MIN_LENGTH } from '../js/services/supabase-auth.js';

/*
 * La pantalla que cierra los enlaces del correo.
 *
 * Lo que se fija acá es lo que no se puede ver mirando la página: que el enlace
 * se canjea por POST y no por fragmento, que confirmar el correo NO deja una
 * sesión puesta, que cambiar la contraseña la cierra, y que un enlace vencido y
 * uno inventado se contestan con la misma frase.
 */

test('un enlace de recuperación se reconoce y pide contraseña nueva', () => {
  const plan = planFromSearch('?token_hash=abc123&type=recovery');

  assert.equal(plan.action, 'verify');
  assert.equal(plan.verifyType, 'recovery');
  assert.equal(plan.needsPassword, true);
  assert.equal(plan.tokenHash, 'abc123');
});

test('un enlace de confirmación no pide contraseña', () => {
  const plan = planFromSearch('?token_hash=abc123&type=signup');

  assert.equal(plan.action, 'verify');
  assert.equal(plan.needsPassword, false);
});

test('sin token la pantalla ofrece pedir uno nuevo', () => {
  assert.equal(planFromSearch('').action, 'request');
  assert.equal(planFromSearch('?type=recovery').action, 'request');
});

test('un tipo que no se entiende no se procesa', () => {
  assert.equal(planFromSearch('?token_hash=abc&type=cualquiera').action, 'expired');
  assert.equal(planFromSearch('?error=access_denied&error_description=expired').action, 'expired');
});

test('el enlace se canjea por POST, y nunca se lee del fragmento', async () => {
  const client = mockClient();
  const service = createAccountActionService({ client });

  await service.verifyLink({ tokenHash: 'hash-1', verifyType: 'recovery' });

  assert.deepEqual(client.calls.verifyOtp, [{ token_hash: 'hash-1', type: 'recovery' }]);
});

test('vencido, usado e inventado se contestan igual', async () => {
  const vencido = createAccountActionService({ client: mockClient({ verifyError: { message: 'Token has expired', status: 401 } }) });
  const inventado = createAccountActionService({ client: mockClient({ verifyError: { message: 'Invalid token', status: 403 } }) });

  const a = await vencido.verifyLink({ tokenHash: 'x', verifyType: 'recovery' });
  const b = await inventado.verifyLink({ tokenHash: 'y', verifyType: 'recovery' });

  assert.deepEqual(a, b);
  assert.equal(a.ok, false);
  assert.equal(a.expired, true);
});

test('la contraseña corta se rechaza acá, sin gastar una llamada', async () => {
  const client = mockClient();
  const service = createAccountActionService({ client });

  const result = await service.setPassword({ password: 'corta1' });

  assert.equal(result.ok, false);
  assert.match(result.message, new RegExp(`${TEAM_PASSWORD_MIN_LENGTH} caracteres`));
  assert.equal(client.calls.updateUser.length, 0);
});

test('una contraseña filtrada se explica, no se manda a adivinar', async () => {
  const client = mockClient({
    updateError: { code: 'weak_password', status: 422, message: 'pwned', weak_password: { reasons: ['pwned'] } },
  });
  const service = createAccountActionService({ client });

  const result = await service.setPassword({ password: 'contrasena-larga-filtrada' });

  assert.equal(result.ok, false);
  assert.match(result.message, /filtraciones/i);
});

test('cambiar la contraseña cierra la sesión que abrió el enlace', async () => {
  const client = mockClient();
  const service = createAccountActionService({ client });

  const result = await service.setPassword({ password: 'contrasena-nueva-larga' });

  assert.equal(result.ok, true);
  assert.equal(client.calls.signOut, 1);
});

test('confirmar el correo no deja sesión abierta', async () => {
  const client = mockClient();
  const controller = createAccountActionController({
    service: createAccountActionService({ client }),
  });

  const state = await controller.start('?token_hash=abc&type=signup');

  assert.equal(state.step, ACCOUNT_STEP.CONFIRMED);
  assert.equal(client.calls.signOut, 1);
});

test('el camino completo de recuperación: enlace, contraseña, listo', async () => {
  const client = mockClient();
  const controller = createAccountActionController({
    service: createAccountActionService({ client }),
  });

  const abierto = await controller.start('?token_hash=abc&type=recovery');
  assert.equal(abierto.step, ACCOUNT_STEP.SET_PASSWORD);

  const guardado = await controller.submitPassword('contrasena-nueva-larga');
  assert.equal(guardado.ok, true);
  assert.equal(controller.getState().step, ACCOUNT_STEP.DONE);
});

test('pedir un enlace nuevo no dice si el correo existe', async () => {
  const conCuenta = createAccountActionService({ client: mockClient() });
  const sinCuenta = createAccountActionService({ client: mockClient({ resetError: { message: 'not found', status: 400 } }) });

  const a = await conCuenta.requestLink({ email: 'alguien@lataba.test' });
  const b = await sinCuenta.requestLink({ email: 'nadie@lataba.test' });

  assert.equal(a.message, b.message);
  assert.equal(a.ok, true);
  assert.equal(b.ok, true);
});

test('la pantalla del enlace vencido ofrece pedir otro', () => {
  const markup = renderAccountAction({ step: ACCOUNT_STEP.EXPIRED });

  assert.match(markup, /data-account-request-form/);
  assert.match(markup, /ya no sirve/i);
});

test('el formulario de contraseña nueva pide el mínimo real del proyecto', () => {
  const markup = renderAccountAction({ step: ACCOUNT_STEP.SET_PASSWORD });

  assert.match(markup, new RegExp(`minlength="${TEAM_PASSWORD_MIN_LENGTH}"`));
});

function mockClient({ verifyError = null, updateError = null, resetError = null } = {}) {
  const calls = { verifyOtp: [], updateUser: [], reset: [], signOut: 0 };
  return {
    calls,
    auth: {
      async verifyOtp(payload) {
        calls.verifyOtp.push(payload);
        if (verifyError) return { data: null, error: verifyError };
        return { data: { session: { access_token: 'token' }, user: { id: 'u1' } }, error: null };
      },
      async updateUser(payload) {
        calls.updateUser.push(payload);
        return updateError ? { data: null, error: updateError } : { data: { user: { id: 'u1' } }, error: null };
      },
      async resetPasswordForEmail(...args) {
        calls.reset.push(args);
        return resetError ? { data: null, error: resetError } : { data: {}, error: null };
      },
      async signOut() { calls.signOut += 1; return { error: null }; },
    },
  };
}
