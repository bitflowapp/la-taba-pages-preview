import { createServiceClient } from './payment-runtime.ts';
import {
  audit,
  connection,
  invalidateRejectedToken,
  OAuthProviderError,
  oauthConfig,
  sellerAccessToken,
  sellerIdentity,
} from './seller-oauth.ts';

export type SellerAuthorizationOutcome = 'valid' | 'revoked' | 'unknown' | 'not_connected';

/**
 * El aviso «Vinculación de aplicaciones» es sólo una pista: la firma de Mercado
 * Pago cubre `data.id`, el request-id y el `ts`, NO el cuerpo, así que su
 * `action` o su `user_id` no prueban nada. Lo decide el proveedor: si el token
 * del vendedor sigue sirviendo (o se renueva), la vinculación está viva; si la
 * renovación responde invalid_grant, la revocación está confirmada y recién
 * ahí se apaga el cobro online y se descarta la autorización.
 */
export async function confirmSellerAuthorization(sellerHint: string): Promise<SellerAuthorizationOutcome> {
  if (!/^\d{3,32}$/.test(sellerHint)) return 'unknown';
  const service = createServiceClient();
  const config = oauthConfig();
  const { data: row, error } = await service.from('mp_seller_connections')
    .select('business_id,seller_id,status')
    .eq('seller_id', sellerHint).eq('environment', config.environment)
    .eq('application_id', config.clientId).maybeSingle();
  if (error) throw new Error('Seller routing lookup unavailable');
  if (!row || !['connected', 'requires_reauthorization'].includes(String(row.status))) return 'not_connected';
  const businessId = String(row.business_id);
  try {
    let token = await sellerAccessToken(businessId);
    try {
      await sellerIdentity(token, String(row.seller_id));
      return 'valid';
    } catch (rejected) {
      if (!(rejected instanceof OAuthProviderError && rejected.status === 401)) return 'unknown';
      await invalidateRejectedToken(businessId, token);
    }
    // The access token was refused: renewing it is what tells revocation apart.
    token = await sellerAccessToken(businessId);
    await sellerIdentity(token, String(row.seller_id));
    return 'valid';
  } catch (_) {
    const current = await connection(businessId);
    if (current?.status !== 'requires_reauthorization') return 'unknown';
    const marked = await service.rpc('mp_mark_seller_deauthorized', {
      p_business_id: businessId,
      p_environment: config.environment,
    });
    if (marked.error) throw new Error('Unable to record seller deauthorization');
    audit('seller_deauthorized', businessId, crypto.randomUUID());
    return 'revoked';
  }
}

/** La pista de vendedor de un aviso de vinculación: `user_id` del cuerpo o `data.id`. */
export function deauthorizationSellerHint(body: Record<string, unknown>, dataId: string): string {
  const fromBody = typeof body.user_id === 'number' && Number.isSafeInteger(body.user_id)
    ? String(body.user_id) : typeof body.user_id === 'string' ? body.user_id.trim() : '';
  if (/^\d{3,32}$/.test(fromBody)) return fromBody;
  return /^\d{3,32}$/.test(dataId) ? dataId : '';
}
