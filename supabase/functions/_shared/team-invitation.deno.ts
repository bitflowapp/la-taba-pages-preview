import {
  accountIsFresh,
  emailHint,
  handleTeamInvitation,
  type InvitationLookup,
  type TeamInvitationDeps,
} from './team-invitation.ts';

const ORIGIN = 'https://la-taba-commercial-pilot.pages.dev';
const URL = 'https://example.invalid/functions/v1/team-invitation';
const TOKEN = 'ab'.repeat(32);

function fail(message: string): never {
  throw new Error(message);
}

function post(body: unknown, origin = ORIGIN): Request {
  return new Request(URL, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}

const PENDING: InvitationLookup = {
  found: true,
  status: 'pending',
  invitation_id: '11111111-1111-4111-8111-111111111111',
  business_name: 'La Taba',
  invited_email: 'walter@example.com',
  invited_role: 'owner',
  full_name: 'Walter',
  expires_at: '2026-10-01T12:00:00Z',
  account: { exists: false, user_id: null, created_by_invitation: false, ever_signed_in: false, banned: false },
};

function harness(lookups: InvitationLookup[], { createExists = false } = {}) {
  const calls: string[] = [];
  const logs: Array<Record<string, unknown>> = [];
  const queue = [...lookups];
  const deps: TeamInvitationDeps = {
    lookup: (token) => {
      calls.push(`lookup:${token === TOKEN}`);
      return Promise.resolve(queue.length > 1 ? queue.shift()! : queue[0]);
    },
    createUser: (input) => {
      calls.push(`create:${input.email}:${input.invitationId}`);
      return Promise.resolve(createExists ? { exists: true as const } : { userId: 'u-new' });
    },
    recoveryTokenHash: (email) => {
      calls.push(`recovery:${email}`);
      return Promise.resolve('hash-123');
    },
    recordActivation: (_token, userId, created) => {
      calls.push(`record:${userId}:${created}`);
      return Promise.resolve();
    },
    allowedOrigins: [ORIGIN],
    log: (event) => logs.push(event),
  };
  return { deps, calls, logs };
}

async function body(response: Response) {
  return await response.json() as Record<string, unknown>;
}

Deno.test('una invitación vigente se describe sin mostrar el correo entero', async () => {
  const { deps } = harness([PENDING]);
  const response = await handleTeamInvitation(post({ action: 'inspect', token: TOKEN }), deps);
  const data = await body(response);
  if (response.status !== 200 || data.ok !== true) fail('inspect vigente debería contestar ok');
  if (data.account !== 'new' || data.role !== 'owner' || data.business_name !== 'La Taba') fail('faltan datos de la invitación');
  if (JSON.stringify(data).includes('walter@example.com')) fail('el correo completo no viaja');
  if (data.email_hint !== 'wa••••@example.com') fail(`pista inesperada: ${data.email_hint}`);
});

Deno.test('token con otra forma, vencido, revocado o inexistente: el mismo código', async () => {
  for (const [token, lookup] of [
    ['corto', PENDING],
    [TOKEN, { found: false }],
    [TOKEN, { ...PENDING, status: 'expired' }],
    [TOKEN, { ...PENDING, status: 'revoked' }],
  ] as Array<[string, InvitationLookup]>) {
    const { deps } = harness([lookup]);
    const data = await body(await handleTeamInvitation(post({ action: 'inspect', token }), deps));
    if (data.code !== 'invalid_token') fail(`esperaba invalid_token y llegó ${data.code}`);
  }
  const accepted = await body(await handleTeamInvitation(post({ action: 'inspect', token: TOKEN }), harness([{ ...PENDING, status: 'accepted' }]).deps));
  if (accepted.code !== 'already_accepted') fail('una invitación usada lo dice');
});

Deno.test('activar exige el correo exacto de la invitación', async () => {
  const { deps, calls } = harness([PENDING]);
  const data = await body(await handleTeamInvitation(post({ action: 'activate', token: TOKEN, email: 'otro@example.com' }), deps));
  if (data.code !== 'email_mismatch') fail('otro correo no activa');
  if (calls.some((call) => call.startsWith('create'))) fail('no se crea nada con otro correo');
});

Deno.test('activar crea la cuenta confirmada y devuelve el enlace de contraseña', async () => {
  const { deps, calls } = harness([PENDING]);
  const data = await body(await handleTeamInvitation(post({ action: 'activate', token: TOKEN, email: '  Walter@Example.com ' }), deps));
  if (data.ok !== true || data.token_hash !== 'hash-123' || data.type !== 'recovery') fail('activación inesperada');
  const expected = ['lookup:true', 'create:walter@example.com:11111111-1111-4111-8111-111111111111', 'recovery:walter@example.com', 'record:u-new:true'];
  if (JSON.stringify(calls) !== JSON.stringify(expected)) fail(`orden inesperado: ${calls.join(' | ')}`);
});

Deno.test('una cuenta existente de otra persona no se toca: entra con su contraseña', async () => {
  const existing = { ...PENDING, account: { exists: true, user_id: 'u-old', created_by_invitation: false, ever_signed_in: true, banned: false } };
  const { deps, calls } = harness([existing]);
  const inspect = await body(await handleTeamInvitation(post({ action: 'inspect', token: TOKEN }), deps));
  if (inspect.account !== 'existing') fail('una cuenta existente se informa como tal');
  const data = await body(await handleTeamInvitation(post({ action: 'activate', token: TOKEN, email: 'walter@example.com' }), deps));
  if (data.code !== 'account_exists') fail('no se le entrega un enlace de contraseña de una cuenta ajena');
  if (calls.some((call) => call.startsWith('recovery') || call.startsWith('create'))) fail('no se generó nada');
});

Deno.test('la cuenta que creó esta invitación y nunca se usó se puede retomar', async () => {
  const resumed = { ...PENDING, account: { exists: true, user_id: 'u-mine', created_by_invitation: true, ever_signed_in: false, banned: false } };
  const { deps, calls } = harness([resumed]);
  const data = await body(await handleTeamInvitation(post({ action: 'activate', token: TOKEN, email: 'walter@example.com' }), deps));
  if (data.ok !== true) fail('retomar la propia activación debería funcionar');
  if (calls.some((call) => call.startsWith('create'))) fail('no se crea otra cuenta');
  if (!calls.includes('record:u-mine:false')) fail('queda auditado como retomada');
});

Deno.test('una cuenta suspendida no se activa', async () => {
  const banned = { ...PENDING, account: { exists: true, user_id: 'u-x', created_by_invitation: false, ever_signed_in: true, banned: true } };
  const data = await body(await handleTeamInvitation(post({ action: 'inspect', token: TOKEN }), harness([banned]).deps));
  if (data.code !== 'account_disabled') fail('una cuenta suspendida lo dice');
});

Deno.test('si la cuenta aparece a mitad de camino se vuelve a mirar en vez de adivinar', async () => {
  const appeared = { ...PENDING, account: { exists: true, user_id: 'u-other', created_by_invitation: false, ever_signed_in: false, banned: false } };
  const { deps, calls } = harness([PENDING, appeared], { createExists: true });
  const data = await body(await handleTeamInvitation(post({ action: 'activate', token: TOKEN, email: 'walter@example.com' }), deps));
  if (data.code !== 'account_exists') fail('una cuenta ajena que apareció no se toma');
  if (calls.some((call) => call.startsWith('recovery'))) fail('no se generó enlace');
});

Deno.test('origen ajeno, método y cuerpo inválidos se rechazan antes de mirar la base', async () => {
  const { deps, calls } = harness([PENDING]);
  const foreign = await handleTeamInvitation(post({ action: 'inspect', token: TOKEN }, 'https://evil.example'), deps);
  if (foreign.status !== 403) fail('origen ajeno');
  const preflight = await handleTeamInvitation(new Request(URL, { method: 'OPTIONS', headers: { origin: ORIGIN } }), deps);
  if (preflight.status !== 204) fail('preflight');
  const get = await handleTeamInvitation(new Request(URL, { method: 'GET', headers: { origin: ORIGIN } }), deps);
  if (get.status !== 405) fail('GET');
  const bad = await handleTeamInvitation(post('{no json'), deps);
  if (bad.status !== 400) fail('cuerpo inválido');
  const big = await handleTeamInvitation(post({ action: 'inspect', token: TOKEN, pad: 'x'.repeat(5000) }), deps);
  if (big.status !== 400) fail('cuerpo grande');
  const unknown = await handleTeamInvitation(post({ action: 'accept', token: TOKEN }), deps);
  if (unknown.status !== 400) fail('acción desconocida');
  if (calls.length) fail('nada de lo anterior llegó a la base');
});

Deno.test('un error de la base contesta 503 sin detalles', async () => {
  const deps: TeamInvitationDeps = {
    ...harness([PENDING]).deps,
    lookup: () => Promise.reject(new Error('connection refused to 10.0.0.1')),
  };
  const response = await handleTeamInvitation(post({ action: 'inspect', token: TOKEN }), deps);
  const text = await response.text();
  if (response.status !== 503 || text.includes('10.0.0.1')) fail('el error no se filtra');
});

Deno.test('los registros no llevan token ni correo', async () => {
  const { deps, logs } = harness([PENDING]);
  await handleTeamInvitation(post({ action: 'activate', token: TOKEN, email: 'walter@example.com' }), deps);
  const text = JSON.stringify(logs);
  if (text.includes(TOKEN) || text.includes('walter')) fail('el log filtra datos');
});

Deno.test('pistas y frescura de cuenta', () => {
  if (emailHint('ab@x.com') !== 'a•@x.com') fail('pista corta');
  if (emailHint('') !== '') fail('pista vacía');
  if (!accountIsFresh(undefined)) fail('sin cuenta es nueva');
  if (accountIsFresh({ exists: true, user_id: 'u', created_by_invitation: true, ever_signed_in: true, banned: false })) {
    fail('una cuenta ya usada no es nueva');
  }
});
