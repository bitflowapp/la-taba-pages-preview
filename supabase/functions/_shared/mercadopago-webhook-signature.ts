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

export function signatureTimestampIsFresh(signature: string, nowMs = Date.now()): boolean {
  const values = new Map(
    signature.split(',').map((entry) => {
      const [key, value = ''] = entry.trim().split('=', 2);
      return [key?.trim().toLowerCase(), value.trim()];
    }),
  );
  const timestamp = Number(values.get('ts') || '');
  if (!Number.isInteger(timestamp) || timestamp < 1_500_000_000) return false;
  const now = Math.floor(nowMs / 1000);
  return timestamp >= now - SIGNATURE_MAX_AGE_SECONDS
    && timestamp <= now + SIGNATURE_FUTURE_TOLERANCE_SECONDS;
}
