import { createServiceClient, getRequiredEnv, requireRealPaymentSmokeAuthorization } from './payment-runtime.ts';
import { connection, oauthConfig, sellerAccessToken, sellerIdentity, invalidateRejectedToken, OAuthProviderError } from './seller-oauth.ts';

// Verification is read-only except for an already-due OAuth refresh. Never
// enable payments, replace the seller or create a preference from this action.
export async function verifySellerConnection(businessId: string) {
  const config = oauthConfig();
  const token = await sellerAccessToken(businessId);
  const row = await connection(businessId);
  if (!row || row.application_id !== config.clientId) throw Error('Seller application mismatch');
  try {
    await sellerIdentity(token, String(row.seller_id));
  } catch (error) {
    if (error instanceof OAuthProviderError && error.status === 401) {
      await invalidateRejectedToken(businessId, token);
    }
    throw Error('Unable to verify seller');
  }
  const scopes = String(row.scopes || '').split(' ');
  if (!['read', 'write', 'offline_access'].every(scope => scopes.includes(scope))) {
    throw Error('Seller permissions unavailable');
  }
  getRequiredEnv('MERCADOPAGO_OAUTH_WEBHOOK_SECRET');
  getRequiredEnv('PAYMENT_WORKER_SECRET');
  const service = createServiceClient();
  const settings = await service.from('business_payment_settings')
    .select('enabled,environment,collector_id,application_id,production_review_status')
    .eq('business_id', businessId).eq('provider', 'mercadopago').maybeSingle();
  const availability = await service.rpc('get_mercadopago_checkout_availability', { p_business_id: businessId });
  if (settings.error || availability.error) throw Error('Payment backend unavailable');
  const bindingMatches = settings.data?.environment === config.environment
    && settings.data?.collector_id === row.seller_id
    && settings.data?.application_id === config.clientId;
  let executionEnabled = true;
  try { requireRealPaymentSmokeAuthorization(config.environment); }
  catch { executionEnabled = false; }
  const enabled = bindingMatches && executionEnabled && availability.data?.available === true;
  return {
    checked_at: new Date().toISOString(),
    credentials_usable: true,
    seller_identity_verified: true,
    permissions_verified: true,
    backend_operational: true,
    binding_matches: bindingMatches,
    online_payments_enabled: enabled,
    blocking_reason: enabled ? null : !bindingMatches ? 'seller_binding_mismatch'
      : !executionEnabled ? 'production_execution_not_enabled' : 'payments_not_enabled',
  };
}
