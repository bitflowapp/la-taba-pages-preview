// /cuenta/#invitacion=: la persona invitada crea su cuenta (o entra) y acepta.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import {
  createInvitationController, createInvitationService, INVITE_STEP, invitationTokenFromHash, inviteFailureMessage,
  renderInvitation,
} from '../js/team-invitation-accept.js';
import { mountAccountAction } from '../js/account-action-page.js';
import { containsForbiddenVocabulary } from '../js/business/business-operation-language.js';

const TOKEN = 'cd'.repeat(32);

function fakeService(overrides = {}) {
  const calls = [];
  const service = {
    inspect: async (token) => { calls.push(['inspect', token]); return { ok: true, account: 'new', role: 'rider', business_name: 'La Taba', email_hint: 'ri••@example.com' }; },
    activate: async (token, email) => { calls.push(['activate', email]); return { ok: true }; },
    setPassword: async (password) => { calls.push(['password', password.length]); return { ok: true }; },
    signIn: async (email) => { calls.push(['signIn', email]); return { ok: true }; },
    accept: async (token) => { calls.push(['accept', token === TOKEN]); return { ok: true, role: 'rider' }; },
    close: async () => { calls.push(['close']); },
    ...overrides,
  };
  return { service, calls };
}

test('el token se lee sólo del fragmento y con forma de token', () => {
  assert.equal(invitationTokenFromHash(`#invitacion=${TOKEN}`), TOKEN);
  assert.equal(invitationTokenFromHash(`#invitacion=${TOKEN.toUpperCase()}`), TOKEN);
  assert.equal(invitationTokenFromHash('#invitacion=corto'), '');
  assert.equal(invitationTokenFromHash(''), '');
});

test('cuenta nueva: correo → contraseña → aceptar con la sesión propia → cerrar', async () => {
  const { service, calls } = fakeService();
  const controller = createInvitationController({ service, token: TOKEN });
  await controller.start();
  assert.equal(controller.getState().step, INVITE_STEP.NEW_ACCOUNT);
  await controller.submitEmail('rider@example.com');
  assert.equal(controller.getState().step, INVITE_STEP.SET_PASSWORD);
  await controller.submitPassword('una-contraseña-larga');
  assert.equal(controller.getState().step, INVITE_STEP.ACCEPTED);
  assert.deepEqual(calls.map((call) => call[0]), ['inspect', 'activate', 'password', 'accept', 'close'],
    'la contraseña va ANTES de aceptar: si falla, la persona no queda con un rol y sin clave');
});

test('cuenta existente: entra con su contraseña y acepta', async () => {
  const seen = [];
  const { service, calls } = fakeService({ inspect: async () => { seen.push('inspect'); return { ok: true, account: 'existing', role: 'owner', business_name: 'La Taba' }; } });
  const controller = createInvitationController({ service, token: TOKEN });
  await controller.start();
  assert.equal(controller.getState().step, INVITE_STEP.EXISTING_ACCOUNT);
  await controller.submitSignIn('walter@example.com', 'secreto-largo-123');
  assert.equal(controller.getState().step, INVITE_STEP.ACCEPTED);
  assert.deepEqual([...seen, ...calls.map((call) => call[0])], ['inspect', 'signIn', 'accept', 'close']);
});

test('si el correo ya tiene cuenta, se pasa a entrar con contraseña', async () => {
  const { service } = fakeService({ activate: async () => ({ ok: false, code: 'account_exists' }) });
  const controller = createInvitationController({ service, token: TOKEN });
  await controller.start();
  await controller.submitEmail('rider@example.com');
  assert.equal(controller.getState().step, INVITE_STEP.EXISTING_ACCOUNT);
  assert.match(controller.getState().message, /Ya tenés una cuenta/);
});

test('un correo distinto no avanza y lo explica; un token inválido termina', async () => {
  const mismatch = createInvitationController({ service: fakeService({ activate: async () => ({ ok: false, code: 'email_mismatch' }) }).service, token: TOKEN });
  await mismatch.start();
  await mismatch.submitEmail('otro@example.com');
  assert.equal(mismatch.getState().step, INVITE_STEP.NEW_ACCOUNT);
  assert.match(mismatch.getState().message, /no es el correo/);

  const invalid = createInvitationController({ service: fakeService({ inspect: async () => ({ ok: false, code: 'invalid_token' }) }).service, token: TOKEN });
  await invalid.start();
  assert.equal(invalid.getState().step, INVITE_STEP.INVALID);

  const none = createInvitationController({ service: fakeService().service, token: '' });
  await none.start();
  assert.equal(none.getState().step, INVITE_STEP.INVALID);

  const unavailable = createInvitationController({ service: null, token: TOKEN });
  await unavailable.start();
  assert.equal(unavailable.getState().step, INVITE_STEP.UNAVAILABLE);
});

test('una contraseña rechazada no acepta la invitación', async () => {
  const { service, calls } = fakeService({ setPassword: async () => ({ ok: false, message: 'Esa contraseña apareció en una filtración.' }) });
  const controller = createInvitationController({ service, token: TOKEN });
  await controller.start();
  await controller.submitEmail('rider@example.com');
  await controller.submitPassword('corta');
  assert.equal(controller.getState().step, INVITE_STEP.SET_PASSWORD);
  assert.equal(calls.some((call) => call[0] === 'accept'), false);
});

test('las pantallas hablan en castellano de comercio y la del repartidor dice qué instalar', () => {
  for (const step of Object.values(INVITE_STEP)) {
    const html = renderInvitation({ step, info: { role: 'rider', business_name: 'La Taba', email_hint: 'ri••@example.com' }, role: 'rider' });
    assert.deepEqual(containsForbiddenVocabulary(html.replace(/<[^>]+>/g, ' ')), [], step);
  }
  const done = renderInvitation({ step: INVITE_STEP.ACCEPTED, info: { role: 'rider' }, role: 'rider' });
  assert.match(done, /app de repartidor/);
  const owner = renderInvitation({ step: INVITE_STEP.ACCEPTED, info: { role: 'owner' }, role: 'owner' });
  assert.match(owner, /Entrar al Panel/);
  assert.match(inviteFailureMessage('whatever'), /Probá de nuevo/);
});

test('el servicio llama a la función de invitación y acepta con la RPC de identidad', async () => {
  const invoked = [];
  const client = {
    auth: {
      verifyOtp: async (input) => { invoked.push(['verifyOtp', input.type]); return { data: { session: {} }, error: null }; },
      updateUser: async () => ({ error: null }),
      signInWithPassword: async () => ({ data: { session: {} }, error: null }),
      signOut: async () => ({}),
    },
    functions: { invoke: async (name, { body }) => { invoked.push([name, body.action]); return { data: body.action === 'activate' ? { ok: true, token_hash: 'h' } : { ok: true, account: 'new' }, error: null }; } },
    rpc: async (name, args) => { invoked.push([name, args.p_token === TOKEN]); return { data: { ok: true, role: 'rider' }, error: null }; },
  };
  const service = createInvitationService({ client });
  assert.equal((await service.activate(TOKEN, 'rider@example.com')).ok, true);
  assert.equal((await service.accept(TOKEN)).role, 'rider');
  assert.deepEqual(invoked, [['team-invitation', 'activate'], ['verifyOtp', 'recovery'], ['identity_accept_invitation', true]]);
  assert.equal((await service.setPassword('corta')).ok, false, 'la longitud mínima se controla antes de mandar');
});

test('la página saca el token de la barra de direcciones y usa el flujo de invitación', async () => {
  const replaced = [];
  const host = { innerHTML: '' };
  const foot = { textContent: '' };
  const doc = {
    querySelector: (selector) => (selector === '[data-account-action]' ? host : selector === '.payment-return-foot' ? foot : null),
    addEventListener: () => {},
  };
  const client = {
    auth: { signOut: async () => ({}) },
    functions: { invoke: async () => ({ data: { ok: false, code: 'invalid_token' }, error: null }) },
    rpc: async () => ({ data: null, error: null }),
  };
  const controller = mountAccountAction({
    doc, runtimeConfig: {}, createClient: () => client, search: '', hash: `#invitacion=${TOKEN}`,
    history: { replaceState: (...args) => replaced.push(args) }, pathname: '/cuenta/',
  });
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.deepEqual(replaced, [[null, '', '/cuenta/']]);
  assert.equal(controller.getState().step, INVITE_STEP.INVALID);
  assert.match(host.innerHTML, /No pudimos usar esta invitación/);
  assert.match(foot.textContent, /sólo para el correo/);
});

test('la función de borde no guarda ni loguea el token y se publica sin JWT', () => {
  const edge = fs.readFileSync(new URL('../supabase/functions/team-invitation/index.ts', import.meta.url), 'utf8');
  const config = fs.readFileSync(new URL('../supabase/config.toml', import.meta.url), 'utf8');
  assert.match(config, /\[functions\.team-invitation\]\s*\nverify_jwt = false/);
  assert.match(edge, /team_invitation_lookup/);
  assert.match(edge, /team_invitation_record_activation/);
  assert.match(edge, /generateLink\(\{ type: 'recovery'/);
  assert.doesNotMatch(edge, /console\.log\([^)]*token/i);
  assert.match(edge, /https:\/\/la-taba-commercial-pilot\.pages\.dev/);
});
