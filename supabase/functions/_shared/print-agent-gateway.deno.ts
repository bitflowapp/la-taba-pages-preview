import {
  handleGatewayRequest,
  mapDatabaseError,
  parseDeviceToken,
  planRpc,
  sha256Hex,
  type RpcResult,
} from './print-agent-gateway.ts';

const DEVICE = '0b2f5a4e-5c1d-4e1b-9f3a-7a1c2d3e4f50';
const SECRET = 'q3T9w_VxY-2bC4dE6fG8hJ0kL1mN3pQ5rS7tU9vW1xZ';
const TOKEN = `Bearer tla1.${DEVICE}.${SECRET}`;
const URL = 'https://example.invalid/functions/v1/print-agent-gateway';

function fail(message: string): never {
  throw new Error(message);
}

function post(body: unknown, headers: Record<string, string> = {}): Request {
  return new Request(URL, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: TOKEN, ...headers },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}

function recorder(result: RpcResult = { data: { ok: true }, error: null }) {
  const calls: Array<{ name: string; params: Record<string, unknown> }> = [];
  const logs: Array<Record<string, unknown>> = [];
  return {
    calls,
    logs,
    deps: {
      rpc: (name: string, params: Record<string, unknown>) => {
        calls.push({ name, params });
        return Promise.resolve(result);
      },
      log: (event: Record<string, unknown>) => logs.push(event),
      now: () => 1000,
    },
  };
}

Deno.test('la credencial se parsea sólo con el formato exacto', () => {
  const parsed = parseDeviceToken(TOKEN);
  if (parsed?.deviceId !== DEVICE || parsed.secret !== SECRET) fail('no se leyó una credencial válida');
  for (const header of [
    null, '', 'Bearer', `Basic tla1.${DEVICE}.${SECRET}`, `Bearer tla2.${DEVICE}.${SECRET}`,
    `Bearer tla1.no-es-uuid.${SECRET}`, `Bearer tla1.${DEVICE}.corto`, `Bearer tla1.${DEVICE}.${SECRET}.extra`,
    `Bearer tla1.${DEVICE.toUpperCase()}.${SECRET}`,
  ]) {
    if (parseDeviceToken(header)) fail(`se aceptó una credencial inválida: ${header}`);
  }
});

Deno.test('el hash es SHA-256 hex del secreto, el mismo que calcula el agente', async () => {
  const hash = await sha256Hex('abc');
  if (hash !== 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad') fail(`SHA-256 incorrecto: ${hash}`);
});

Deno.test('la RPC recibe device_id y hash; el secreto nunca sale de la función', async () => {
  const { calls, logs, deps } = recorder({ data: { jobs: [], poll_seconds: 10 }, error: null });
  const response = await handleGatewayRequest(post({ action: 'claim', document_types: ['kitchen_ticket'], limit: 3 }), deps);
  if (response.status !== 200) fail(`estado ${response.status}`);
  const call = calls[0];
  if (call.name !== 'agent_claim_print_jobs') fail(`RPC inesperada ${call.name}`);
  if (call.params.p_device_id !== DEVICE || call.params.p_secret_hash !== await sha256Hex(SECRET)) fail('credencial mal traducida');
  const everything = JSON.stringify({ calls, logs, body: await response.text() });
  if (everything.includes(SECRET)) fail('el secreto aparece en la RPC, el log o la respuesta');
  if (logs[0]?.action !== 'claim' || logs[0]?.device_id !== DEVICE || logs[0]?.status !== 200) fail('log estructurado incompleto');
});

Deno.test('un navegador no puede usar la gateway (cualquier Origin se rechaza)', async () => {
  const { calls, deps } = recorder();
  const response = await handleGatewayRequest(post({ action: 'claim', document_types: ['kitchen_ticket'] }, { origin: 'https://evil.example' }), deps);
  if (response.status !== 403 || calls.length) fail('se aceptó un pedido de navegador');
  const preflight = await handleGatewayRequest(new Request(URL, { method: 'OPTIONS', headers: { origin: 'https://la-taba-commercial-pilot.pages.dev' } }), deps);
  if (preflight.status !== 403) fail('el preflight CORS no se rechazó');
});

Deno.test('sin credencial sólo existe el registro', async () => {
  const { calls, deps } = recorder();
  const response = await handleGatewayRequest(new Request(URL, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action: 'claim', document_types: ['kitchen_ticket'] }),
  }), deps);
  if (response.status !== 401 || calls.length) fail('se reclamó sin credencial');
  if ((await response.json()).code !== 'DEVICE_UNAUTHORIZED') fail('código de error inesperado');
});

Deno.test('el registro manda sólo el hash del secreto que generó el agente', async () => {
  const { calls, deps } = recorder({ data: { device_id: DEVICE, business_id: 'x' }, error: null });
  const secretHash = await sha256Hex(SECRET);
  const response = await handleGatewayRequest(new Request(URL, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ action: 'register', pairing_code: 'ABCDE-12345', secret_hash: secretHash, device_name: 'Mostrador', platform: 'windows', agent_version: '0.1.0' }),
  }), deps);
  if (response.status !== 200) fail(`estado ${response.status}`);
  if (calls[0].name !== 'agent_register_device' || calls[0].params.p_secret_hash !== secretHash) fail('registro mal armado');
});

Deno.test('entradas fuera de contrato se rechazan antes de tocar la base', async () => {
  const bad = [
    { action: 'claim', document_types: ['factura_inventada'] },
    { action: 'claim', document_types: ['kitchen_ticket'], limit: 50 },
    { action: 'claim', document_types: [] },
    { action: 'update', job_id: DEVICE, claim_token: DEVICE, transition: 'borrar' },
    { action: 'update', job_id: 'x', claim_token: DEVICE, transition: 'printed' },
    { action: 'update', job_id: DEVICE, claim_token: DEVICE, transition: 'printed', error_code: 'minusculas' },
    { action: 'reprint', job_id: DEVICE, reason: 'x', idempotency_key: 'reprint-0001' },
    { action: 'rotate', new_secret_hash: 'no-hex' },
    { action: 'heartbeat', report: [] },
    { action: 'sql', query: 'select 1' },
  ];
  for (const body of bad) {
    const { calls, deps } = recorder();
    const response = await handleGatewayRequest(post(body), deps);
    if (response.status !== 400 || calls.length) fail(`se aceptó ${JSON.stringify(body)}`);
  }
  const { calls, deps } = recorder();
  if ((await handleGatewayRequest(post('{no es json'), deps)).status !== 400 || calls.length) fail('JSON inválido aceptado');
  if ((await handleGatewayRequest(post('x'.repeat(20_000)), deps)).status !== 413) fail('cuerpo gigante aceptado');
  const text = new Request(URL, { method: 'POST', headers: { 'content-type': 'text/plain', authorization: TOKEN }, body: '{}' });
  if ((await handleGatewayRequest(text, deps)).status !== 415) fail('content-type ajeno aceptado');
});

Deno.test('los errores de la base se traducen sin detalle interno', async () => {
  const table: Array<[string, number, string]> = [
    ['42501', 401, 'DEVICE_UNAUTHORIZED'], ['PT409', 409, 'CLAIM_CONFLICT'], ['40001', 409, 'CLAIM_CONFLICT'], ['22023', 400, 'INVALID_REQUEST'],
    ['P0002', 404, 'NOT_FOUND'], ['P0001', 422, 'NOT_ALLOWED'], ['23505', 409, 'IDEMPOTENCY_CONFLICT'], ['XX000', 503, 'UNAVAILABLE'],
  ];
  for (const [code, status, name] of table) {
    const mapped = mapDatabaseError({ code });
    if (mapped.status !== status || mapped.code !== name) fail(`${code} mal traducido`);
  }
  const { deps } = recorder({ data: null, error: { code: 'PT409', message: 'reclamo vencido: no imprimir (detalle interno)' } });
  const response = await handleGatewayRequest(post({ action: 'update', job_id: DEVICE, claim_token: DEVICE, transition: 'printing' }), deps);
  const body = await response.text();
  if (response.status !== 409 || body.includes('detalle interno')) fail('se filtró el mensaje de la base');
});

Deno.test('cada acción llega sólo a su RPC', () => {
  const credential = { deviceId: DEVICE, secretHash: 'a'.repeat(64) };
  const expected: Record<string, [Record<string, unknown>, string]> = {
    heartbeat: [{ report: { agent_version: '0.1.0' } }, 'agent_heartbeat'],
    claim: [{ document_types: ['order_ticket'] }, 'agent_claim_print_jobs'],
    update: [{ job_id: DEVICE, claim_token: DEVICE, transition: 'not_printed', error_code: 'PRINTER_OFFLINE' }, 'agent_update_print_job'],
    reprint: [{ job_id: DEVICE, reason: 'papel trabado', idempotency_key: 'agent-reprint-01' }, 'agent_request_reprint'],
    rotate: [{ new_secret_hash: 'b'.repeat(64) }, 'agent_rotate_device_secret'],
  };
  for (const [action, [body, name]] of Object.entries(expected)) {
    if (planRpc(action, body, credential).name !== name) fail(`${action} no llega a ${name}`);
  }
});
