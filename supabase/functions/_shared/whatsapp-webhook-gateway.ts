/**
 * Gateway del webhook de WhatsApp Cloud API (Meta) para el canal fiscal de La Taba.
 *
 * AUTENTICIDAD. Meta firma cada POST con HMAC-SHA256 del cuerpo CRUDO usando el App Secret,
 * en `X-Hub-Signature-256: sha256=<hex>`. Sin una firma válida no se lee ni se parsea nada, y
 * la comparación es en tiempo constante. La verificación del webhook (GET con hub.challenge)
 * compara el verify token del entorno, también en tiempo constante. El teléfono de cada
 * mensaje (wa_id) lo da Meta dentro del cuerpo firmado: nunca lo escribe el usuario.
 *
 * DECISIONES. Este módulo no decide nada. Por cada mensaje llama `whatsapp_handle_inbound`
 * (service_role), que en UNA transacción deduplica por wa_message_id, ejecuta el comando y
 * deja las respuestas en la base. Después las envía y marca cada una.
 *
 * REINTENTOS.
 *   · Se procesan TODAS las entradas, cambios y mensajes del lote, en orden.
 *   · Si algún mensaje no quedó registrado en la base, responde 500: Meta reintenta el lote
 *     y el dedup hace que lo ya procesado no se repita.
 *   · Un envío fallido no provoca un reintento de Meta (el mensaje ya quedó procesado): queda
 *     pendiente en la base y se reintenta en la próxima llamada.
 *
 * Nunca se loguea el texto de un mensaje, un número completo, un token ni el App Secret.
 * Todo lo que depende del entorno entra por `WhatsAppDeps`, para probarlo sin red.
 */

export interface RpcResult {
  data: unknown;
  error: { code?: string; message?: string } | null;
}

export interface OutboundReply {
  id: string;
  kind: 'text' | 'document';
  body: string;
  artifact_id?: string | null;
  to: string;
}

export interface SendResult {
  ok: boolean;
  providerMessageId?: string;
  error?: string;
}

export interface WhatsAppDeps {
  appSecret: string;
  verifyToken: string;
  /** El número de WhatsApp Business por el que contesta esta función. */
  phoneNumberId: string;
  rpc(name: string, params: Record<string, unknown>): Promise<RpcResult>;
  send(reply: OutboundReply): Promise<SendResult>;
  log?(event: Record<string, unknown>): void;
}

export interface InboundMessage {
  id: string;
  from: string;
  type: string;
  text: string | null;
  timestamp: string | null;
  phoneNumberId: string | null;
}

const MAX_BODY_BYTES = 256 * 1024;
const SIGNATURE = /^sha256=([0-9a-fA-F]{64})$/;
const CHALLENGE = /^[A-Za-z0-9_-]{1,128}$/;
const PHONE = /^[1-9][0-9]{7,14}$/;
const MESSAGE_ID = /^[A-Za-z0-9._:=+/-]{1,256}$/;
const MESSAGE_TYPE = /^[a-z_]{1,32}$/;
const PENDING_RETRY_LIMIT = 10;

const encoder = new TextEncoder();

export async function hmacSha256Hex(secret: string, body: Uint8Array<ArrayBuffer>): Promise<string> {
  const key = await crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const mac = new Uint8Array(await crypto.subtle.sign('HMAC', key, body));
  return [...mac].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

/** Igualdad en tiempo constante (hex, tokens): recorre siempre el largo mayor. */
export function timingSafeEqual(left: string, right: string): boolean {
  const a = encoder.encode(left);
  const b = encoder.encode(right);
  let difference = a.length ^ b.length;
  for (let index = 0; index < Math.max(a.length, b.length); index += 1) {
    difference |= (a[index] ?? 0) ^ (b[index] ?? 0);
  }
  return difference === 0;
}

export async function verifyMetaSignature(rawBody: Uint8Array<ArrayBuffer>, header: string | null, appSecret: string): Promise<boolean> {
  if (!appSecret || !header) return false;
  const match = SIGNATURE.exec(header.trim());
  if (!match) return false;
  const expected = await hmacSha256Hex(appSecret, rawBody);
  return timingSafeEqual(expected, match[1].toLowerCase());
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function text(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

/** Todos los mensajes de todas las entradas y cambios, en el orden del lote. Los estados se ignoran. */
export function extractMessages(payload: unknown): InboundMessage[] {
  const root = record(payload);
  if (root.object !== 'whatsapp_business_account') return [];
  const messages: InboundMessage[] = [];
  for (const entry of asArray(root.entry)) {
    for (const change of asArray(record(entry).changes)) {
      const changeRecord = record(change);
      if (changeRecord.field !== 'messages') continue;
      const value = record(changeRecord.value);
      const phoneNumberId = text(record(value.metadata).phone_number_id);
      for (const message of asArray(value.messages)) {
        const item = record(message);
        const type = text(item.type) ?? 'unknown';
        // Botones y listas llegan con su título: se tratan como texto (es lo que el usuario "dijo").
        const interactive = record(item.interactive);
        const said = type === 'text' ? text(record(item.text).body)
          : type === 'button' ? text(record(item.button).text)
          : type === 'interactive' ? (text(record(interactive.button_reply).title) ?? text(record(interactive.list_reply).title))
          : null;
        messages.push({
          id: text(item.id) ?? '',
          from: text(item.from) ?? '',
          type: said !== null ? 'text' : type,
          text: said,
          timestamp: text(item.timestamp),
          phoneNumberId,
        });
      }
    }
  }
  return messages;
}

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

function maskPhone(phone: string): string {
  return phone.length > 4 ? `•••${phone.slice(-4)}` : '•••';
}

function timestampIso(value: string | null): string | null {
  if (!value || !/^[0-9]{9,11}$/.test(value)) return null;
  return new Date(Number(value) * 1000).toISOString();
}

function repliesOf(data: unknown): OutboundReply[] {
  return asArray(record(data).replies).map((reply) => {
    const item = record(reply);
    const outbound: OutboundReply = {
      id: String(item.id ?? ''),
      kind: item.kind === 'document' ? 'document' : 'text',
      body: String(item.body ?? ''),
      artifact_id: typeof item.artifact_id === 'string' ? item.artifact_id : null,
      to: String(item.to ?? ''),
    };
    return outbound;
  }).filter((reply) => reply.id && PHONE.test(reply.to) && reply.body);
}

async function deliver(replies: OutboundReply[], deps: WhatsAppDeps): Promise<{ sent: number; failed: number }> {
  let sent = 0;
  let failed = 0;
  for (const reply of replies) {
    let result: SendResult;
    try {
      result = await deps.send(reply);
    } catch (_) {
      result = { ok: false, error: 'send_exception' };
    }
    const marked = await deps.rpc('whatsapp_mark_outbound', {
      p_outbound_id: reply.id,
      p_status: result.ok ? 'sent' : 'failed',
      p_provider_message_id: result.ok ? result.providerMessageId ?? null : null,
      p_error: result.ok ? null : String(result.error ?? 'send_failed').slice(0, 200),
    });
    if (result.ok) sent += 1; else failed += 1;
    deps.log?.({ event: 'whatsapp_reply', kind: reply.kind, to: maskPhone(reply.to), ok: result.ok, marked: !marked.error });
  }
  return { sent, failed };
}

export async function handleWhatsAppWebhook(request: Request, deps: WhatsAppDeps): Promise<Response> {
  const url = new URL(request.url);
  if (request.method === 'GET') {
    // Verificación del webhook desde el panel de Meta.
    const mode = url.searchParams.get('hub.mode');
    const token = url.searchParams.get('hub.verify_token') ?? '';
    const challenge = url.searchParams.get('hub.challenge') ?? '';
    if (mode !== 'subscribe' || !deps.verifyToken || !timingSafeEqual(token, deps.verifyToken) || !CHALLENGE.test(challenge)) {
      return new Response('forbidden', { status: 403 });
    }
    return new Response(challenge, { status: 200, headers: { 'content-type': 'text/plain' } });
  }
  if (request.method !== 'POST') return new Response('method not allowed', { status: 405 });

  const declared = Number(request.headers.get('content-length') ?? '0');
  if (declared > MAX_BODY_BYTES) return json(413, { error: 'payload_too_large' });
  const raw = new Uint8Array(await request.arrayBuffer());
  if (raw.byteLength > MAX_BODY_BYTES) return json(413, { error: 'payload_too_large' });
  if (!(await verifyMetaSignature(raw, request.headers.get('x-hub-signature-256'), deps.appSecret))) {
    deps.log?.({ event: 'whatsapp_signature_rejected' });
    return json(401, { error: 'invalid_signature' });
  }
  let payload: unknown;
  try {
    payload = JSON.parse(new TextDecoder().decode(raw));
  } catch (_) {
    return json(400, { error: 'invalid_json' });
  }

  const replies: OutboundReply[] = [];
  let processed = 0;
  let duplicates = 0;
  let failures = 0;
  for (const message of extractMessages(payload)) {
    if (message.phoneNumberId !== deps.phoneNumberId) {
      deps.log?.({ event: 'whatsapp_foreign_number' });
      continue;
    }
    if (!MESSAGE_ID.test(message.id) || !PHONE.test(message.from) || !MESSAGE_TYPE.test(message.type)) {
      deps.log?.({ event: 'whatsapp_message_invalid' });
      continue;
    }
    // En orden y de a uno: "facturar" y "SI" del mismo lote tienen que llegar en ese orden.
    const result = await deps.rpc('whatsapp_handle_inbound', {
      p_message_id: message.id,
      p_phone: message.from,
      p_phone_number_id: message.phoneNumberId,
      p_message_type: message.type,
      p_text: message.text === null ? null : message.text.slice(0, 4096),
      p_message_timestamp: timestampIso(message.timestamp),
    });
    if (result.error) {
      failures += 1;
      deps.log?.({ event: 'whatsapp_inbound_failed', code: result.error.code ?? 'unknown', from: maskPhone(message.from) });
      continue;
    }
    const data = record(result.data);
    if (data.duplicate === true) {
      duplicates += 1;
      continue;
    }
    processed += 1;
    deps.log?.({ event: 'whatsapp_inbound', outcome: text(data.outcome) ?? 'processed', from: maskPhone(message.from) });
    replies.push(...repliesOf(data));
  }

  const delivered = await deliver(replies, deps);
  // Lo que quedó sin salir en llamadas anteriores (Graph API caída), acotado.
  const pending = await deps.rpc('whatsapp_pending_outbound', { p_limit: PENDING_RETRY_LIMIT });
  const retried = pending.error ? { sent: 0, failed: 0 } : await deliver(repliesOf({ replies: pending.data }), deps);

  const body = { ok: failures === 0, processed, duplicates, failures, sent: delivered.sent + retried.sent, send_failures: delivered.failed + retried.failed };
  // Si algo no quedó en la base, Meta tiene que reintentar el lote.
  return json(failures === 0 ? 200 : 500, body);
}

export interface GraphSenderOptions {
  graphApiVersion: string;
  phoneNumberId: string;
  accessToken: string;
  fetch(input: string, init: RequestInit): Promise<Response>;
  rpc(name: string, params: Record<string, unknown>): Promise<RpcResult>;
  /** URL firmada y corta de un objeto privado; null si no se pudo firmar. */
  signArtifactUrl(bucket: string, storagePath: string): Promise<string | null>;
}

/** El envío por la Graph API de Meta. El PDF sale por el id del ARTEFACTO: URL firmada de su ruta privada. */
export function createGraphSender(options: GraphSenderOptions): (reply: OutboundReply) => Promise<SendResult> {
  return async (reply) => {
    let message: Record<string, unknown>;
    if (reply.kind === 'document') {
      const artifact = await options.rpc('whatsapp_outbound_artifact', { p_outbound_id: reply.id });
      const location = record(artifact.data);
      const bucket = text(location.bucket);
      const storagePath = text(location.storage_path);
      if (artifact.error || !bucket || !storagePath) return { ok: false, error: 'artifact_unavailable' };
      const link = await options.signArtifactUrl(bucket, storagePath);
      if (!link) return { ok: false, error: 'artifact_url_unavailable' };
      message = { type: 'document', document: { link, filename: text(location.filename) ?? 'comprobante.pdf', caption: reply.body } };
    } else {
      message = { type: 'text', text: { body: reply.body, preview_url: false } };
    }
    const response = await options.fetch(`https://graph.facebook.com/${options.graphApiVersion}/${options.phoneNumberId}/messages`, {
      method: 'POST',
      headers: { authorization: `Bearer ${options.accessToken}`, 'content-type': 'application/json' },
      body: JSON.stringify({ messaging_product: 'whatsapp', recipient_type: 'individual', to: reply.to, ...message }),
    });
    const body = record(await response.json().catch(() => ({})));
    const providerMessageId = text(record(asArray(body.messages)[0]).id) ?? undefined;
    return response.ok ? { ok: true, providerMessageId } : { ok: false, error: `graph_${response.status}` };
  };
}
