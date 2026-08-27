import { WebhookSignatureValidator } from 'npm:mercadopago@3.2.1';

const SIGNATURE_MAX_AGE_SECONDS = 5 * 60;
const SIGNATURE_FUTURE_TOLERANCE_SECONDS = 60;

/**
 * The HMAC itself is delegated to Mercado Pago's official SDK. The extra
 * server-clock window protects against replayed but otherwise valid headers.
 * `dataId` must be the literal `data.id` query parameter documented by
 * Mercado Pago; it is deliberately not rebuilt from the JSON body.
 */
export function validateMercadoPagoWebhookSignature({
  signature,
  requestId,
  dataId,
  bodyDataId = '',
  secret,
  nowMs = Date.now(),
}: {
  signature: string;
  requestId: string;
  dataId: string;
  bodyDataId?: string;
  secret: string;
  nowMs?: number;
}): boolean {
  if (!signature || !requestId || !dataId || !secret) return false;
  if (bodyDataId && bodyDataId !== dataId) return false;
  if (!signatureTimestampIsFresh(signature, nowMs)) return false;
  try {
    WebhookSignatureValidator.validate({
      xSignature: signature,
      xRequestId: requestId,
      dataId,
      secret,
    });
    return true;
  } catch (_) {
    return false;
  }
}

/** 2017-07-14. Nada anterior a esto es un `ts` plausible de Mercado Pago. */
const MIN_PLAUSIBLE_SECONDS = 1_500_000_000;
/** En segundos esto sería 1973; cualquier valor así de grande son milisegundos. */
const MILLISECOND_THRESHOLD = 100_000_000_000;

/**
 * Normaliza el `ts` de la firma a segundos.
 *
 * La documentación de Mercado Pago muestra el ejemplo `ts=1704908010` —diez
 * dígitos, segundos— y en otra página describe ese mismo campo como «timestamp
 * (in milliseconds)». La ventana de frescura de abajo es NUESTRA, no del
 * proveedor: el HMAC se calcula sobre el `ts` literal y no le importa la
 * unidad. Si Mercado Pago pasara a milisegundos, un `ts` mil veces más grande
 * caería fuera de la tolerancia futura y rechazaríamos TODOS los webhooks
 * legítimos —fallando cerrado hacia el lado que deja pedidos pagos sin
 * finalizar—. Se aceptan las dos unidades y se normaliza a segundos; la
 * autenticidad la sigue decidiendo el validador oficial, no esto.
 */
export function signatureTimestampSeconds(signature: string): number | null {
  const values = new Map(
    signature.split(',').map((entry) => {
      const [key, value = ''] = entry.trim().split('=', 2);
      return [key?.trim().toLowerCase(), value.trim()];
    }),
  );
  const raw = values.get('ts') || '';
  const timestamp = Number(raw);
  if (!raw || !Number.isInteger(timestamp) || timestamp <= 0) return null;
  const seconds = timestamp >= MILLISECOND_THRESHOLD ? Math.floor(timestamp / 1000) : timestamp;
  return seconds >= MIN_PLAUSIBLE_SECONDS ? seconds : null;
}

export function signatureTimestampIsFresh(signature: string, nowMs = Date.now()): boolean {
  const timestamp = signatureTimestampSeconds(signature);
  if (timestamp === null) return false;
  const now = Math.floor(nowMs / 1000);
  return timestamp >= now - SIGNATURE_MAX_AGE_SECONDS
    && timestamp <= now + SIGNATURE_FUTURE_TOLERANCE_SECONDS;
}
