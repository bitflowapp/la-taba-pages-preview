import { createClient, type SupabaseClient, type User } from 'npm:@supabase/supabase-js@2.110.8';
import { validatePaymentWorkerSignature } from './payment-worker-signature.ts';

const JSON_HEADERS = {
  'content-type': 'application/json; charset=utf-8',
  'cache-control': 'no-store',
  'x-content-type-options': 'nosniff',
};

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);

export type PaymentEnvironment = 'test' | 'production';

export class PublicPaymentError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

export function getRequiredEnv(name: string): string {
  const value = Deno.env.get(name)?.trim();
  if (!value) throw new Error(`Missing required server configuration: ${name}`);
  return value;
}

export function optionalEnv(name: string): string {
  return Deno.env.get(name)?.trim() || '';
}

export function jsonResponse(
  request: Request,
  body: Record<string, unknown>,
  status = 200,
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...JSON_HEADERS,
      ...corsHeaders(request),
    },
  });
}

export function emptyResponse(request: Request, status = 204): Response {
  return new Response(null, {
    status,
    headers: {
      ...corsHeaders(request),
      'cache-control': 'no-store',
    },
  });
}

export function publicErrorResponse(request: Request, error: unknown): Response {
  if (error instanceof PublicPaymentError) {
    return jsonResponse(request, {
      ok: false,
      code: error.code,
      message: error.message,
    }, error.status);
  }
  return jsonResponse(request, {
    ok: false,
    code: 'PAYMENT_UNAVAILABLE',
    message: 'No pudimos procesar el pago en este momento. Intentá nuevamente.',
  }, 503);
}

export function corsHeaders(request: Request): HeadersInit {
  const origin = request.headers.get('origin')?.trim() || '';
  if (!origin || !allowedOrigins().has(origin)) return {};
  return {
    'access-control-allow-origin': origin,
    'access-control-allow-headers': 'authorization, content-type, x-client-info, apikey',
    'access-control-allow-methods': 'POST, OPTIONS',
    'access-control-max-age': '600',
    vary: 'Origin',
  };
}

export function assertAllowedOrigin(request: Request): void {
  const origin = request.headers.get('origin')?.trim() || '';
  if (origin && !allowedOrigins().has(origin)) {
    throw new PublicPaymentError(403, 'ORIGIN_NOT_ALLOWED', 'El origen de esta solicitud no está autorizado.');
  }
}

export function handleOptions(request: Request): Response | null {
  if (request.method !== 'OPTIONS') return null;
  try {
    assertAllowedOrigin(request);
  } catch (error) {
    return publicErrorResponse(request, error);
  }
  return emptyResponse(request);
}

export function requirePost(request: Request): void {
  if (request.method !== 'POST') {
    throw new PublicPaymentError(405, 'METHOD_NOT_ALLOWED', 'Método no permitido.');
  }
}

export async function readJsonObject(request: Request, maxBytes = 24_000): Promise<Record<string, unknown>> {
  const contentLength = Number(request.headers.get('content-length') || 0);
  if (Number.isFinite(contentLength) && contentLength > maxBytes) {
    throw new PublicPaymentError(413, 'PAYLOAD_TOO_LARGE', 'La solicitud es demasiado grande.');
  }
  const text = await request.text();
  if (new TextEncoder().encode(text).byteLength > maxBytes) {
    throw new PublicPaymentError(413, 'PAYLOAD_TOO_LARGE', 'La solicitud es demasiado grande.');
  }
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch (_) {
    throw new PublicPaymentError(400, 'INVALID_JSON', 'La solicitud no tiene JSON válido.');
  }
  if (!value || Array.isArray(value) || typeof value !== 'object') {
    throw new PublicPaymentError(400, 'INVALID_PAYLOAD', 'La solicitud no tiene el formato esperado.');
  }
  return value as Record<string, unknown>;
}

export function createServiceClient(): SupabaseClient {
  return createClient(
    getRequiredEnv('SUPABASE_URL'),
    getRequiredEnv('SUPABASE_SERVICE_ROLE_KEY'),
    {
      auth: { autoRefreshToken: false, persistSession: false },
    },
  );
}

export function createUserClient(request: Request): SupabaseClient {
  const authorization = request.headers.get('authorization')?.trim() || '';
  return createClient(
    getRequiredEnv('SUPABASE_URL'),
    getRequiredEnv('SUPABASE_ANON_KEY'),
    {
      auth: { autoRefreshToken: false, persistSession: false },
      global: { headers: authorization ? { Authorization: authorization } : {} },
    },
  );
}

export async function requireAuthenticatedUser(request: Request): Promise<{ user: User; client: SupabaseClient }> {
  const authorization = request.headers.get('authorization')?.trim() || '';
  if (!/^Bearer\s+\S+$/i.test(authorization)) {
    throw new PublicPaymentError(401, 'AUTH_REQUIRED', 'Necesitás una sesión segura para continuar.');
  }
  const client = createUserClient(request);
  const token = authorization.replace(/^Bearer\s+/i, '');
  const { data, error } = await client.auth.getUser(token);
  if (error || !data.user) {
    throw new PublicPaymentError(401, 'AUTH_REQUIRED', 'Necesitás una sesión segura para continuar.');
  }
  return { user: data.user, client };
}

export function requireUuid(value: unknown, field = 'id'): string {
  const normalized = String(value || '').trim();
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(normalized)) {
    throw new PublicPaymentError(400, 'INVALID_REQUEST', `${field} no es válido.`);
  }
  return normalized;
}

export function requireString(value: unknown, field: string, pattern: RegExp, maxLength = 200): string {
  const normalized = String(value || '').trim();
  if (!normalized || normalized.length > maxLength || !pattern.test(normalized)) {
    throw new PublicPaymentError(400, 'INVALID_REQUEST', `${field} no es válido.`);
  }
  return normalized;
}

export async function sha256Hex(value: string | Uint8Array): Promise<string> {
  const input = typeof value === 'string' ? new TextEncoder().encode(value) : value;
  const hash = await crypto.subtle.digest('SHA-256', input as unknown as BufferSource);
  return Array.from(new Uint8Array(hash), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

export async function hashSensitive(value: string, namespace: string): Promise<string> {
  const salt = getRequiredEnv('PAYMENT_LOG_HASH_SALT');
  return sha256Hex(`${namespace}\u0000${salt}\u0000${value}`);
}

export function providerEnvironment(): PaymentEnvironment {
  const value = getRequiredEnv('MERCADOPAGO_ENVIRONMENT').toLowerCase();
  if (value !== 'test' && value !== 'production') {
    throw new Error('MERCADOPAGO_ENVIRONMENT must be test or production');
  }
  if (value === 'production' && optionalEnv('MERCADOPAGO_PRODUCTION_REVIEW_STATUS') !== 'approved') {
    throw new Error('Production Mercado Pago review is not approved');
  }
  return value;
}

export function requireRealPaymentSmokeAuthorization(environment: PaymentEnvironment): void {
  if (
    environment === 'production'
    && optionalEnv('MERCADOPAGO_REAL_PAYMENT_SMOKE_CONFIRMATION')
      !== 'I_AUTHORIZE_REAL_MERCADOPAGO_PAYMENT_SMOKE'
  ) {
    throw new Error('A real Mercado Pago payment smoke has not been explicitly authorized');
  }
}

export function checkoutBaseUrl(): URL {
  const value = getRequiredEnv('TABA_CHECKOUT_BASE_URL');
  let url: URL;
  try {
    url = new URL(value);
  } catch (_) {
    throw new Error('TABA_CHECKOUT_BASE_URL is invalid');
  }
  if (url.protocol !== 'https:' || LOCAL_HOSTS.has(url.hostname.toLowerCase())) {
    throw new Error('TABA_CHECKOUT_BASE_URL must be a controlled HTTPS URL');
  }
  url.pathname = url.pathname.replace(/\/$/, '');
  url.search = '';
  url.hash = '';
  return url;
}

export function webhookUrl(): string {
  const url = new URL(getRequiredEnv('SUPABASE_URL'));
  if (url.protocol !== 'https:' || LOCAL_HOSTS.has(url.hostname.toLowerCase())) {
    throw new Error('Supabase webhook endpoint must use HTTPS');
  }
  return `${url.toString().replace(/\/$/, '')}/functions/v1/mercadopago-webhook`;
}

export function checkoutReturnUrl(path: '/pago/resultado' | '/pago/pendiente' | '/pago/error'): string {
  const base = checkoutBaseUrl();
  return new URL(path, `${base.toString()}/`).toString();
}

export async function enforceRateLimit(
  service: SupabaseClient,
  request: Request,
  scope: 'checkout_session' | 'preference' | 'checkout_status' | 'webhook' | 'refund' | 'cancellation' | 'worker',
  limit: number,
  windowSeconds: number,
  subject = '',
): Promise<void> {
  const fingerprint = requestFingerprint(request, subject);
  const subjectHash = await hashSensitive(fingerprint, `rate-limit:${scope}`);
  const { data, error } = await service.rpc('consume_payment_rate_limit', {
    p_scope: scope,
    p_subject_hash: subjectHash,
    p_limit: limit,
    p_window_seconds: windowSeconds,
  });
  if (error || !data?.allowed) {
    throw new PublicPaymentError(429, 'RATE_LIMITED', 'Demasiados intentos. Esperá un momento y volvé a intentar.');
  }
}

export function requestFingerprint(request: Request, subject = ''): string {
  const forwarded = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
    || request.headers.get('cf-connecting-ip')?.trim()
    || request.headers.get('x-real-ip')?.trim()
    || 'unknown';
  return `${forwarded}\u0000${subject}`;
}

export async function timingSafeEqual(left: string, right: string): Promise<boolean> {
  const leftBytes = new TextEncoder().encode(left);
  const rightBytes = new TextEncoder().encode(right);
  if (leftBytes.length !== rightBytes.length) return false;
  let different = 0;
  for (let index = 0; index < leftBytes.length; index += 1) {
    different |= leftBytes[index] ^ rightBytes[index];
  }
  return different === 0;
}

export async function requireWorkerAuthorization(request: Request): Promise<void> {
  const valid = await validatePaymentWorkerSignature({
    secret: getRequiredEnv('PAYMENT_WORKER_SECRET'),
    timestamp: request.headers.get('x-taba-worker-timestamp') || '',
    nonce: request.headers.get('x-taba-worker-nonce') || '',
    signature: request.headers.get('x-taba-worker-signature') || '',
  });
  if (!valid) {
    throw new PublicPaymentError(401, 'WORKER_AUTH_REQUIRED', 'No autorizado.');
  }
}

function allowedOrigins(): Set<string> {
  return new Set(optionalEnv('TABA_ALLOWED_ORIGINS')
    .split(',')
    .map((value) => value.trim())
    .filter((value) => value.startsWith('https://')));
}
