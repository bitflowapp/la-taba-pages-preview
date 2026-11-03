// Unit tests of the Mobbex core: status table, configuration gate, webhook capability token, HTTP client, snapshot.
// Everything here is a SIMULATION of Mobbex (a fake `fetch`): it proves TABA's behaviour, not Mobbex's.
// What was checked against the real Mobbex sandbox is listed in docs/mobbex/EVIDENCE.md, separately.
import assert from 'node:assert/strict';
import test from 'node:test';
import { classifyMobbexStatus, documentedMobbexStatusCodes } from '../supabase/functions/_shared/mobbex/status.ts';
import { MOBBEX_REAL_PAYMENT_CONFIRMATION, describeMobbexConfig, resolveMobbexConfig, mobbexSwitchedOn } from '../supabase/functions/_shared/mobbex/config.ts';
import { MobbexApiError, MobbexClient, centsToDecimalString, decimalToCents } from '../supabase/functions/_shared/mobbex/client.ts';
import {
  buildMobbexWebhookUrl, mobbexReferenceForSession, mobbexWebhookToken, parseMobbexWebhook, verifyMobbexWebhookToken,
} from '../supabase/functions/_shared/mobbex/webhook.ts';
import { buildMobbexSnapshot } from '../supabase/functions/_shared/mobbex/snapshot.ts';

const SESSION = '3f2c1e0a-5b6d-4c8e-9a1f-0123456789ab';
const REFERENCE = `taba2-mbx-${SESSION}`;
const SECRET = 's'.repeat(40);
const HASH = 'a'.repeat(64);
const env = (values) => (name) => values[name];
const goodEnv = { MOBBEX_ENABLED: 'true', MOBBEX_ENVIRONMENT: 'test', MOBBEX_API_KEY: 'key-123', MOBBEX_ACCESS_TOKEN: 'token-456', MOBBEX_WEBHOOK_TOKEN_SECRET: SECRET };

// ── status table ────────────────────────────────────────────────────────────────────────────────────────────

test('status codes: only documented "paid" codes approve; undocumented ones never do', () => {
  for (const code of ['200', '300', '301', '302']) assert.equal(classifyMobbexStatus(code).statusClass, 'approved', code);
  for (const code of ['0', '4', '201', '603', '800', '999', '', 'abc', '2OO', null, undefined, {}, 3.5]) {
    assert.notEqual(classifyMobbexStatus(code).statusClass, 'approved', String(code));
    assert.equal(classifyMobbexStatus(code).moneyMoved, false, String(code));
  }
  assert.equal(classifyMobbexStatus(200).statusClass, 'approved', 'numeric codes are accepted');
  assert.equal(classifyMobbexStatus('3').statusClass, 'authorized', 'an authorization that was not captured is not money');
  assert.equal(classifyMobbexStatus('3').moneyMoved, false);
  assert.equal(classifyMobbexStatus('602').statusClass, 'refunded');
  assert.equal(classifyMobbexStatus('605').statusClass, 'partially_refunded');
  assert.equal(classifyMobbexStatus('601').statusClass, 'cancelled');
  assert.equal(classifyMobbexStatus('600').statusClass, 'reversing');
  assert.equal(classifyMobbexStatus('401').statusClass, 'expired');
  for (const code of ['400', '403', '410', '419', '604']) assert.equal(classifyMobbexStatus(code).statusClass, 'rejected', code);
});

test('status table is pinned to the 38 codes of https://mobbex.dev/codigos-de-estado', () => {
  const documented = ['0', '1', '2', '3', '4', '100', '200', '201', '210', '299', '300', '301', '302', '303', '400', '401', '402', '403',
    '410', '411', '412', '413', '414', '415', '416', '417', '418', '419', '500', '600', '601', '602', '603', '604', '605', '610', '800'];
  assert.deepEqual([...documentedMobbexStatusCodes()].sort(), documented.sort());
});

// ── configuration gate ──────────────────────────────────────────────────────────────────────────────────────

test('Mobbex is disabled unless MOBBEX_ENABLED is exactly "true"', () => {
  for (const value of [undefined, '', 'TRUE', '1', 'yes', 'false', ' true-ish']) {
    assert.equal(mobbexSwitchedOn(env({ ...goodEnv, MOBBEX_ENABLED: value })), false, String(value));
    assert.throws(() => resolveMobbexConfig(env({ ...goodEnv, MOBBEX_ENABLED: value })), { code: 'MOBBEX_DISABLED' });
  }
  assert.equal(mobbexSwitchedOn(env({})), false, 'default is disabled');
});

test('configuration fails closed on missing or weak secrets and on an unapproved production', () => {
  assert.throws(() => resolveMobbexConfig(env({ ...goodEnv, MOBBEX_API_KEY: '' })), { code: 'MOBBEX_CREDENTIALS_MISSING' });
  assert.throws(() => resolveMobbexConfig(env({ ...goodEnv, MOBBEX_ACCESS_TOKEN: undefined })), { code: 'MOBBEX_CREDENTIALS_MISSING' });
  assert.throws(() => resolveMobbexConfig(env({ ...goodEnv, MOBBEX_WEBHOOK_TOKEN_SECRET: 'short' })), { code: 'MOBBEX_WEBHOOK_SECRET_WEAK' });
  assert.throws(() => resolveMobbexConfig(env({ ...goodEnv, MOBBEX_ENVIRONMENT: 'live' })), { code: 'MOBBEX_ENVIRONMENT_INVALID' });
  const production = { ...goodEnv, MOBBEX_ENVIRONMENT: 'production' };
  assert.throws(() => resolveMobbexConfig(env(production)), { code: 'MOBBEX_PRODUCTION_NOT_APPROVED' });
  assert.throws(() => resolveMobbexConfig(env({ ...production, MOBBEX_PRODUCTION_REVIEW_STATUS: 'approved' })), { code: 'MOBBEX_REAL_PAYMENT_NOT_AUTHORIZED' });
  assert.throws(() => resolveMobbexConfig(env({ ...production, MOBBEX_PRODUCTION_REVIEW_STATUS: 'approved', MOBBEX_REAL_PAYMENT_CONFIRMATION: 'yes' })), { code: 'MOBBEX_REAL_PAYMENT_NOT_AUTHORIZED' });
  assert.equal(resolveMobbexConfig(env({ ...production, MOBBEX_PRODUCTION_REVIEW_STATUS: 'approved', MOBBEX_REAL_PAYMENT_CONFIRMATION: MOBBEX_REAL_PAYMENT_CONFIRMATION })).environment, 'production');
  assert.equal(resolveMobbexConfig(env(goodEnv)).environment, 'test');
});

test('the description of the configuration never contains a credential', () => {
  const described = JSON.stringify(describeMobbexConfig(env(goodEnv)));
  for (const secret of ['key-123', 'token-456', SECRET]) assert.equal(described.includes(secret), false);
  assert.equal(describeMobbexConfig(env({})).usable, false);
  assert.equal(describeMobbexConfig(env(goodEnv)).usable, true);
});

// ── webhook capability token (TABA's own mechanism: Mobbex documents no signature) ────────────────────────────

test('webhook token binds environment and reference and is verified in constant time', async () => {
  const token = await mobbexWebhookToken(SECRET, 'test', REFERENCE);
  assert.match(token, /^[A-Za-z0-9_-]{43}$/);
  assert.equal(await mobbexWebhookToken(SECRET, 'test', REFERENCE), token, 'deterministic');
  assert.equal(await verifyMobbexWebhookToken(SECRET, 'test', REFERENCE, token), true);
  assert.equal(await verifyMobbexWebhookToken(SECRET, 'production', REFERENCE, token), false, 'a test token is useless in production');
  assert.equal(await verifyMobbexWebhookToken(SECRET, 'test', `taba2-mbx-${'0'.repeat(8)}-0000-4000-8000-${'0'.repeat(12)}`, token), false, 'bound to the reference');
  assert.equal(await verifyMobbexWebhookToken('x'.repeat(40), 'test', REFERENCE, token), false, 'bound to the secret');
  for (const bad of ['', 'abc', token.slice(1), `${token}A`, token.replace(/.$/, '!')]) assert.equal(await verifyMobbexWebhookToken(SECRET, 'test', REFERENCE, bad), false, bad);
  await assert.rejects(() => mobbexWebhookToken('short', 'test', REFERENCE));
});

test('webhook URL: public HTTPS only, carries reference and token, nothing else', async () => {
  const url = new URL(await buildMobbexWebhookUrl('https://abc.supabase.co', SECRET, 'test', REFERENCE));
  assert.equal(url.origin, 'https://abc.supabase.co');
  assert.equal(url.pathname, '/functions/v1/mobbex-webhook');
  assert.deepEqual([...url.searchParams.keys()].sort(), ['ref', 't']);
  await assert.rejects(() => buildMobbexWebhookUrl('http://abc.supabase.co', SECRET, 'test', REFERENCE));
  await assert.rejects(() => buildMobbexWebhookUrl('https://localhost', SECRET, 'test', REFERENCE));
  assert.equal(mobbexReferenceForSession(SESSION.toUpperCase()), REFERENCE);
  assert.throws(() => mobbexReferenceForSession('../../etc/passwd'));
});

test('webhook parsing: the body is a hint; a body naming another reference is not ours', () => {
  const url = (ref, t = 'x') => new URL(`https://h/functions/v1/mobbex-webhook?ref=${encodeURIComponent(ref)}&t=${t}`);
  const body = (payment) => JSON.stringify({ type: 'checkout', data: { payment } });
  const ok = parseMobbexWebhook(url(REFERENCE), body({ id: 'OP-1', reference: REFERENCE, status: { code: '200' } }));
  assert.equal(ok.ok, true);
  assert.equal(ok.webhook.hintStatusCode, '200');
  assert.equal(parseMobbexWebhook(url(REFERENCE), body({ reference: 'taba2-mbx-other', status: { code: '200' } })).code, 'REFERENCE_MISMATCH');
  assert.equal(parseMobbexWebhook(url('not-a-reference'), '{}').code, 'INVALID_QUERY');
  assert.equal(parseMobbexWebhook(new URL('https://h/x?ref=' + REFERENCE), '{}').code, 'INVALID_QUERY', 'no token');
  assert.equal(parseMobbexWebhook(url(REFERENCE), 'not json').code, 'INVALID_BODY');
  assert.equal(parseMobbexWebhook(url(REFERENCE), '[1,2]').code, 'INVALID_BODY');
  assert.equal(parseMobbexWebhook(url(REFERENCE), '{}').ok, true, 'an empty object is accepted as a hint: the read decides');
});

// ── amounts ─────────────────────────────────────────────────────────────────────────────────────────────────

test('amounts are exact: no float arithmetic reaches a financial comparison', () => {
  assert.equal(centsToDecimalString(250000), '2500.00');
  assert.equal(centsToDecimalString(5), '0.05');
  assert.throws(() => centsToDecimalString(1.5));
  assert.throws(() => centsToDecimalString(-1));
  assert.equal(decimalToCents('2500'), 250000);
  assert.equal(decimalToCents(2500.5), 250050);
  assert.equal(decimalToCents('0.1'), 10);
  assert.equal(decimalToCents(1250.0), 125000);
  for (const bad of ['1.234', '-5', '1e3', 'NaN', '', null, undefined, '1,50', '12345678901', {}]) assert.equal(decimalToCents(bad), null, String(bad));
  assert.equal(decimalToCents(0.1 + 0.2), null, '0.30000000000000004 is not a two-decimal amount');
});

// ── HTTP client ─────────────────────────────────────────────────────────────────────────────────────────────

const json = (status, body) => new Response(typeof body === 'string' ? body : JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const recorder = (responder) => {
  const calls = [];
  const fetchImpl = async (url, init) => { calls.push({ url: String(url), init }); return responder(String(url), init, calls.length); };
  return { calls, fetchImpl };
};
const client = (responder) => { const r = recorder(responder); return { ...r, client: new MobbexClient({ apiKey: 'KEY-SECRET', accessToken: 'TOKEN-SECRET', fetchImpl: r.fetchImpl }) }; };
const checkoutInput = (overrides = {}) => ({
  totalCents: 250000, reference: REFERENCE, description: 'Pedido', returnUrl: 'https://taba.example/pago/resultado',
  webhookUrl: 'https://abc.supabase.co/functions/v1/mobbex-webhook?ref=x&t=y', timeoutMinutes: 15, test: true,
  customer: { email: 'a@b.c', name: 'Ana' }, items: [{ description: 'Cola', quantity: 2, totalCents: 250000 }], ...overrides,
});

test('createCheckout sends the server amount, our reference, the sandbox flag and the credentials as headers only', async () => {
  const { client: c, calls } = client(() => json(200, { result: true, data: { id: 'CHK:1', url: 'https://mobbex.com/p/checkout/v2/CHK:1' } }));
  const created = await c.createCheckout(checkoutInput());
  assert.deepEqual({ id: created.checkoutId, url: created.url }, { id: 'CHK:1', url: 'https://mobbex.com/p/checkout/v2/CHK:1' });
  assert.match(created.responseHash, /^[a-f0-9]{64}$/);
  const sent = JSON.parse(calls[0].init.body);
  assert.equal(calls[0].url, 'https://api.mobbex.com/p/checkout');
  assert.equal(calls[0].init.method, 'POST');
  assert.equal(sent.total, 2500);
  assert.equal(sent.currency, 'ARS');
  assert.equal(sent.reference, REFERENCE);
  assert.equal(sent.test, true);
  assert.equal(sent.timeout, 15);
  assert.equal(calls[0].init.headers['x-api-key'], 'KEY-SECRET');
  assert.equal(calls[0].init.redirect, 'error', 'a redirect would forward the credentials elsewhere');
  assert.equal(JSON.stringify(sent).includes('KEY-SECRET'), false, 'credentials are headers, never body');
});

test('createCheckout refuses a checkout URL that is not Mobbex and an invalid reference', async () => {
  for (const url of ['https://evil.example/p/checkout/1', 'http://mobbex.com/p/checkout/1', 'https://mobbex.com.evil.example/x', 'javascript:alert(1)', 'not a url']) {
    const { client: c } = client(() => json(200, { result: true, data: { id: 'CHK:1', url } }));
    await assert.rejects(() => c.createCheckout(checkoutInput()), (error) => error instanceof MobbexApiError && error.kind === 'malformed', url);
  }
  const { client: c } = client(() => json(200, { result: true, data: { id: 'CHK:1', url: 'https://mobbex.com/x' } }));
  await assert.rejects(() => c.createCheckout(checkoutInput({ reference: 'order 1; drop table' })), RangeError);
  await assert.rejects(() => c.createCheckout(checkoutInput({ timeoutMinutes: 500 })), RangeError);
  await assert.rejects(() => c.createCheckout(checkoutInput({ totalCents: 10.5 })), RangeError);
});

test('createCheckout errors: only a provable refusal is final; everything else is uncertain; no secret leaks', async () => {
  const cases = [[401, 'auth', true], [403, 'auth', true], [500, 'server', true], [429, 'server', true], [400, 'rejected', false], [422, 'rejected', false]];
  for (const [status, kind, retryable] of cases) {
    const { client: c } = client(() => json(status, { result: false }));
    await assert.rejects(() => c.createCheckout(checkoutInput()), (error) => {
      assert.equal(error.kind, kind);
      assert.equal(error.retryable, retryable);
      assert.equal(String(error.message).includes('SECRET'), false);
      return true;
    }, String(status));
  }
  const network = new MobbexClient({ apiKey: 'KEY-SECRET', accessToken: 'TOKEN-SECRET', fetchImpl: async () => { throw new Error('ECONNRESET KEY-SECRET'); } });
  await assert.rejects(() => network.createCheckout(checkoutInput()), (error) => error.kind === 'network' && !String(error.message).includes('SECRET'));
  const { client: incomplete } = client(() => json(200, { result: true, data: {} }));
  await assert.rejects(() => incomplete.createCheckout(checkoutInput()), (error) => error.kind === 'malformed');
});

test('operation lookup: "no operation" (HTTP 200 + result:false, as measured on the real sandbox) is NOT an error and NOT a payment', async () => {
  const generic = { result: false, code: 'GENERIC:EFCS', error: 'Execution failed. Please contact support with the case ID.  ID: 7ea3b770' };
  const { client: c, calls } = client(() => json(200, generic));
  const lookup = await c.getOperationByReference(REFERENCE);
  assert.equal(lookup.found, false);
  assert.equal(lookup.code, 'GENERIC:EFCS');
  assert.equal(calls[0].init.method, 'GET');
  assert.equal(calls[0].url, `https://api.mobbex.com/p/operations/${encodeURIComponent(REFERENCE)}`);
  const { client: c404 } = client(() => json(404, { result: false }));
  assert.equal((await c404.getOperationByReference(REFERENCE)).found, false);
  const { client: found } = client(() => json(200, { result: true, data: { transaction: { payment: { id: 'OP' } } } }));
  assert.equal((await found.getOperationByReference(REFERENCE)).found, true);
});

test('operation lookup: credentials failure, WAF 403 page, server errors and bad references', async () => {
  for (const [status, body, kind] of [[401, '{}', 'auth'], [403, '<html><title>403 Forbidden</title></html>', 'auth'], [502, 'Bad gateway', 'server']]) {
    const { client: c } = client(() => json(status, body));
    await assert.rejects(() => c.getOperationByReference(REFERENCE), (error) => error.kind === kind, String(status));
  }
  const { client: html } = client(() => json(200, '<html>maintenance</html>'));
  await assert.rejects(() => html.getOperationByReference(REFERENCE), (error) => error.kind === 'malformed');
  const { client: c, calls } = client(() => json(200, { result: false }));
  for (const bad of ['x y/../1', '../../p/entity', `${REFERENCE}/refund`, '', 'taba2-mbx-1']) {
    await assert.rejects(() => c.getOperationByReference(bad), RangeError, bad);
  }
  assert.equal(calls.length, 0, 'a malformed reference never reaches the network (path traversal / WAF)');
});

test('refund: full refund is a GET, partial is a POST with the amount; Mobbex refusing is not a transport error', async () => {
  const { client: c, calls } = client((url) => json(200, { result: !url.includes('/OP-BAD1/') }));
  assert.deepEqual({ approved: (await c.refundOperation('OP-1234', null)).approved }, { approved: true });
  assert.equal(calls[0].init.method, 'GET');
  assert.equal(calls[0].url, 'https://api.mobbex.com/p/operations/OP-1234/refund');
  assert.equal((await c.refundOperation('OP-1234', 50000)).approved, true);
  assert.equal(calls[1].init.method, 'POST');
  assert.deepEqual(JSON.parse(calls[1].init.body), { total: 500 });
  assert.equal((await c.refundOperation('OP-BAD1', null)).approved, false, 'result:false = refused by Mobbex rules');
  await assert.rejects(() => c.refundOperation('../x', null), RangeError);
});

test('the base URL can only be overridden with loopback http (tests), never to redirect credentials', () => {
  assert.throws(() => new MobbexClient({ apiKey: 'k', accessToken: 't', baseUrl: 'https://evil.example' }));
  assert.throws(() => new MobbexClient({ apiKey: 'k', accessToken: 't', baseUrl: 'http://api.mobbex.com' }));
  assert.doesNotThrow(() => new MobbexClient({ apiKey: 'k', accessToken: 't', baseUrl: 'http://127.0.0.1:9999' }));
  assert.throws(() => new MobbexClient({ apiKey: '', accessToken: 't' }));
});

// ── snapshot ────────────────────────────────────────────────────────────────────────────────────────────────

const operation = (payment, extra = {}) => ({ result: true, data: { transaction: { payment }, transactions: [{ uid: 'T1', status: payment?.status?.code ?? '200', total: payment?.total }], ...extra } });

test('snapshot of an approved operation (documented shape) carries only what the ledger validates', () => {
  const built = buildMobbexSnapshot(REFERENCE, operation({
    id: 'OP-1', reference: REFERENCE, total: 2500, currency: { code: 'ARS' }, status: { code: '200', text: 'Aprobado' }, created: '2026-11-03T12:00:00.000Z', updated: '2026-11-03T12:00:05.000Z',
  }, { entity: { uid: 'ENT-1' } }), HASH);
  assert.equal(built.ok, true);
  assert.deepEqual(built.snapshot, {
    reference: REFERENCE, status_code: '200', status_class: 'approved', provider_payment_id: 'OP-1', amount: '2500.00', currency: 'ARS',
    provider_occurred_at: '2026-11-03T12:00:05.000Z', entity_uid: 'ENT-1', approved_operation_count: 1, raw_response_hash: HASH,
  });
});

test('snapshot is fail-closed on anything unexpected', () => {
  const failure = (body, reference = REFERENCE) => buildMobbexSnapshot(reference, body, HASH);
  assert.deepEqual(failure({ result: true }), { ok: false, reason: 'shape_unrecognized' });
  assert.deepEqual(failure({ result: true, data: {} }), { ok: false, reason: 'shape_unrecognized' });
  assert.deepEqual(failure(operation({ id: 'OP', total: 10 })), { ok: false, reason: 'shape_unrecognized' }, 'no status');
  assert.deepEqual(failure(operation({ id: 'OP', reference: 'taba2-mbx-another', total: 10, status: { code: '200' } })), { ok: false, reason: 'reference_mismatch' });
  const odd = failure(operation({ id: 'OP', reference: REFERENCE, total: '12.345', status: { code: '9999' } }));
  assert.equal(odd.ok, true);
  assert.equal(odd.snapshot.status_class, 'unknown', 'an undocumented status is unknown, never approved');
  assert.equal(odd.snapshot.amount, null, 'a non-exact amount is null, never rounded');
});

test('snapshot: a missing currency is ARS (Mobbex only accepts ARS); another currency passes through for the ledger to refuse', () => {
  const noCurrency = buildMobbexSnapshot(REFERENCE, operation({ id: 'OP', reference: REFERENCE, total: 10, status: { code: '200' } }), HASH);
  assert.equal(noCurrency.snapshot.currency, 'ARS');
  const usd = buildMobbexSnapshot(REFERENCE, operation({ id: 'OP', reference: REFERENCE, total: 10, currency: { code: 'USD' }, status: { code: '200' } }), HASH);
  assert.equal(usd.snapshot.currency, 'USD');
});

test('snapshot refuses to decide when the list shows a paid operation but the headline says it is not paid', () => {
  const build = (code, codes) => {
    const body = operation({ id: 'OP-1', reference: REFERENCE, total: 10, status: { code } });
    body.data.transactions = codes.map((status, index) => ({ uid: `T${index}`, status }));
    return buildMobbexSnapshot(REFERENCE, body, HASH);
  };
  // Declined first attempt as headline, approved retry only in the list: never "rejected" (that releases the stock).
  for (const headline of ['400', '1', '3', '401', '9999']) {
    assert.deepEqual(build(headline, ['400', '200']), { ok: false, reason: 'conflicting_operations' }, `headline ${headline}`);
  }
  // The legitimate shapes are untouched: approved headline, and a paid operation that was later refunded or cancelled.
  assert.equal(build('200', ['400', '200']).ok, true);
  assert.equal(build('602', ['200']).ok, true, 'refunded after being paid');
  assert.equal(build('605', ['200']).ok, true, 'partially refunded after being paid');
  assert.equal(build('400', ['400', '400']).ok, true, 'only declined attempts');
});

test('snapshot counts approved operations of the reference (double payment signal)', () => {
  const body = operation({ id: 'OP-1', reference: REFERENCE, total: 10, status: { code: '200' } });
  body.data.transactions = [{ uid: 'T1', status: '200' }, { uid: 'T2', status: '200' }, { uid: 'T3', status: '400' }];
  assert.equal(buildMobbexSnapshot(REFERENCE, body, HASH).snapshot.approved_operation_count, 2);
  const rejected = operation({ id: 'OP-2', reference: REFERENCE, total: 10, status: { code: '400' } });
  assert.equal(buildMobbexSnapshot(REFERENCE, rejected, HASH).snapshot.approved_operation_count, 0);
});
