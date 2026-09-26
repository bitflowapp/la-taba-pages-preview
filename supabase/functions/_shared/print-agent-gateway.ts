/**
 * Gateway del agente local de impresión (Taba.LocalAgent).
 *
 * El agente no tiene service_role ni sesión de usuario: presenta su credencial
 * de dispositivo («tla1.<device_id>.<secreto>») y esta función la convierte en
 * (device_id, SHA-256 del secreto) para las RPC agent_*, que son sólo
 * service_role y verifican el hash en la base. El secreto no se guarda ni se
 * loguea; la base sólo conoce su hash.
 *
 * El agente no es un navegador: cualquier pedido con Origin se rechaza, así una
 * web ajena no puede usar una credencial robada desde el navegador de nadie.
 *
 * Todo lo que depende del entorno (cliente de Supabase, reloj, log) entra por
 * `GatewayDeps`, para probarlo sin red.
 */

export const TOKEN_PREFIX = 'tla1';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const SECRET = /^[A-Za-z0-9_-]{43}$/;
const HASH = /^[0-9a-f]{64}$/;
const SEMVER = /^[0-9]{1,4}\.[0-9]{1,4}\.[0-9]{1,6}([-+][0-9A-Za-z.-]{1,40})?$/;
const IDEMPOTENCY = /^[A-Za-z0-9:_-]{8,150}$/;
const ERROR_CODE = /^[A-Z0-9_]{3,80}$/;
const DOCUMENT_TYPES = new Set(['order_ticket', 'kitchen_ticket', 'fiscal_receipt']);
const TRANSITIONS = new Set(['printing', 'printed', 'not_printed', 'unknown']);
const MAX_BODY_BYTES = 16 * 1024;

export interface DeviceCredential {
  deviceId: string;
  secret: string;
}

export interface RpcResult {
  data: unknown;
  error: { code?: string; message?: string } | null;
}

export interface GatewayDeps {
  rpc(name: string, params: Record<string, unknown>): Promise<RpcResult>;
  log?(event: Record<string, unknown>): void;
  now?(): number;
}

export class GatewayError extends Error {
  constructor(readonly status: number, readonly code: string) {
    super(code);
  }
}

export function parseDeviceToken(header: string | null): DeviceCredential | null {
  const match = /^Bearer\s+(\S+)$/i.exec(header?.trim() ?? '');
  if (!match) return null;
  const parts = match[1].split('.');
  if (parts.length !== 3 || parts[0] !== TOKEN_PREFIX) return null;
  const [, deviceId, secret] = parts;
  if (!UUID.test(deviceId) || !SECRET.test(secret)) return null;
  return { deviceId, secret };
}

export async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

/** Traduce un error de PostgreSQL a una respuesta que no filtra nada interno. */
export function mapDatabaseError(error: { code?: string } | null): GatewayError {
  switch (error?.code) {
    case '42501': return new GatewayError(401, 'DEVICE_UNAUTHORIZED');
    case 'PT409':
    case '40001': return new GatewayError(409, 'CLAIM_CONFLICT');
    case '22023': return new GatewayError(400, 'INVALID_REQUEST');
    case 'P0002': return new GatewayError(404, 'NOT_FOUND');
    case 'P0001': return new GatewayError(422, 'NOT_ALLOWED');
    case '23505': return new GatewayError(409, 'IDEMPOTENCY_CONFLICT');
    default: return new GatewayError(503, 'UNAVAILABLE');
  }
}

type Body = Record<string, unknown>;

function text(body: Body, key: string, pattern: RegExp, required = true): string | null {
  const value = body[key];
  if (value === undefined || value === null) {
    if (required) throw new GatewayError(400, 'INVALID_REQUEST');
    return null;
  }
  if (typeof value !== 'string' || !pattern.test(value)) throw new GatewayError(400, 'INVALID_REQUEST');
  return value;
}

function freeText(body: Body, key: string, min: number, max: number): string {
  const value = body[key];
  if (typeof value !== 'string') throw new GatewayError(400, 'INVALID_REQUEST');
  const trimmed = value.trim();
  if (trimmed.length < min || trimmed.length > max) throw new GatewayError(400, 'INVALID_REQUEST');
  return trimmed;
}

function optionalFreeText(body: Body, key: string, max: number): string | null {
  const value = body[key];
  if (value === undefined || value === null || value === '') return null;
  return freeText(body, key, 1, max);
}

/**
 * Qué RPC corresponde a cada acción y con qué parámetros. Lo que no está acá
 * no existe: el agente no puede llamar ninguna otra función.
 */
export function planRpc(action: string, body: Body, credential: { deviceId: string; secretHash: string } | null):
  { name: string; params: Record<string, unknown> } {
  if (action === 'register') {
    const pairingCode = text(body, 'pairing_code', /^[0-9A-Za-z -]{10,16}$/);
    return {
      name: 'agent_register_device',
      params: {
        p_pairing_code: pairingCode,
        p_secret_hash: text(body, 'secret_hash', HASH),
        p_device_name: freeText(body, 'device_name', 1, 80),
        p_platform: text(body, 'platform', /^windows$/),
        p_agent_version: text(body, 'agent_version', SEMVER),
      },
    };
  }
  if (!credential) throw new GatewayError(401, 'DEVICE_UNAUTHORIZED');
  const auth = { p_device_id: credential.deviceId, p_secret_hash: credential.secretHash };
  switch (action) {
    case 'heartbeat': {
      const report = body.report;
      if (!report || typeof report !== 'object' || Array.isArray(report)) throw new GatewayError(400, 'INVALID_REQUEST');
      return { name: 'agent_heartbeat', params: { ...auth, p_report: report } };
    }
    case 'claim': {
      const types = body.document_types;
      const limit = body.limit ?? 5;
      if (!Array.isArray(types) || types.length === 0 || types.length > 3
        || !types.every((value) => typeof value === 'string' && DOCUMENT_TYPES.has(value))
        || !Number.isInteger(limit) || (limit as number) < 1 || (limit as number) > 10) {
        throw new GatewayError(400, 'INVALID_REQUEST');
      }
      return { name: 'agent_claim_print_jobs', params: { ...auth, p_document_types: types, p_limit: limit } };
    }
    case 'update': {
      const transition = text(body, 'transition', /^[a-z_]{3,20}$/);
      if (!TRANSITIONS.has(transition as string)) throw new GatewayError(400, 'INVALID_REQUEST');
      const duration = body.duration_ms ?? null;
      if (duration !== null && (!Number.isInteger(duration) || (duration as number) < 0 || (duration as number) > 3_600_000)) {
        throw new GatewayError(400, 'INVALID_REQUEST');
      }
      return {
        name: 'agent_update_print_job',
        params: {
          ...auth,
          p_job_id: text(body, 'job_id', UUID),
          p_claim_token: text(body, 'claim_token', UUID),
          p_transition: transition,
          p_error_code: text(body, 'error_code', ERROR_CODE, false),
          p_duration_ms: duration,
        },
      };
    }
    case 'reprint':
      return {
        name: 'agent_request_reprint',
        params: {
          ...auth,
          p_job_id: text(body, 'job_id', UUID),
          p_reason: freeText(body, 'reason', 3, 300),
          p_operator_label: optionalFreeText(body, 'operator_label', 60),
          p_idempotency_key: text(body, 'idempotency_key', IDEMPOTENCY),
        },
      };
    case 'rotate':
      return {
        name: 'agent_rotate_device_secret',
        params: { ...auth, p_new_secret_hash: text(body, 'new_secret_hash', HASH) },
      };
    default:
      throw new GatewayError(400, 'UNKNOWN_ACTION');
  }
}

export async function handleGatewayRequest(request: Request, deps: GatewayDeps): Promise<Response> {
  const started = deps.now?.() ?? Date.now();
  let action = 'unknown';
  let deviceId: string | null = null;
  try {
    if (request.headers.has('origin')) throw new GatewayError(403, 'BROWSER_NOT_ALLOWED');
    if (request.method !== 'POST') throw new GatewayError(405, 'METHOD_NOT_ALLOWED');
    if (!/^application\/json\b/i.test(request.headers.get('content-type') ?? '')) throw new GatewayError(415, 'JSON_REQUIRED');
    const raw = await request.text();
    if (new TextEncoder().encode(raw).length > MAX_BODY_BYTES) throw new GatewayError(413, 'BODY_TOO_LARGE');
    let body: Body;
    try {
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('not an object');
      body = parsed as Body;
    } catch {
      throw new GatewayError(400, 'INVALID_JSON');
    }
    action = typeof body.action === 'string' ? body.action.slice(0, 20) : 'unknown';
    let credential: { deviceId: string; secretHash: string } | null = null;
    if (action !== 'register') {
      const parsedToken = parseDeviceToken(request.headers.get('authorization'));
      if (!parsedToken) throw new GatewayError(401, 'DEVICE_UNAUTHORIZED');
      deviceId = parsedToken.deviceId;
      credential = { deviceId: parsedToken.deviceId, secretHash: await sha256Hex(parsedToken.secret) };
    }
    const plan = planRpc(action, body, credential);
    const { data, error } = await deps.rpc(plan.name, plan.params);
    if (error) throw mapDatabaseError(error);
    if (action === 'register' && data && typeof data === 'object') {
      deviceId = String((data as Record<string, unknown>).device_id ?? '') || null;
    }
    deps.log?.({ event: 'print_agent_gateway', action, device_id: deviceId, status: 200, duration_ms: (deps.now?.() ?? Date.now()) - started });
    return json(200, (data ?? {}) as Record<string, unknown>);
  } catch (error) {
    const failure = error instanceof GatewayError ? error : new GatewayError(503, 'UNAVAILABLE');
    deps.log?.({
      event: 'print_agent_gateway', action, device_id: deviceId, status: failure.status, code: failure.code,
      duration_ms: (deps.now?.() ?? Date.now()) - started,
    });
    return json(failure.status, { code: failure.code });
  }
}

function json(status: number, value: Record<string, unknown>): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  });
}
