// Only a newly provisioned recovery project may opt into this binding. The
// historical production/staging bindings are never replaced by environment data.
export const RECOVERY_FORBIDDEN_REFS = new Set([
  'wwcpogltfgzgkrlilbcd', 'tkanbadcglszlcyfjvpv', 'ucbtjcurawxjwjdvvcvj',
  'ukxqbgswjlibmnjemrzd', 'yakhtrkukqlgzvxuvhzs',
  'enznqfzhikpasjzpvjfd', 'udftddjacdsinscehlke', 'zvmfdlynnutxquktrgyl',
]);

export function recoveryDeploymentBinding(read: (name: string) => string | undefined) {
  const ref = read('TABA_RECOVERY_PROJECT_REF')?.trim();
  if (!ref) return null;
  const origin = read('TABA_RECOVERY_CHECKOUT_ORIGIN')?.trim() || '';
  const validOrigin = /^https:\/\/(?:[a-z0-9-]+\.taba2-staging|la-taba-recovery-test)\.pages\.dev$/.test(origin);
  if (!/^[a-z]{20}$/.test(ref) || RECOVERY_FORBIDDEN_REFS.has(ref) || !validOrigin ||
    read('SUPABASE_URL') !== `https://${ref}.supabase.co` ||
    read('MERCADOPAGO_OAUTH_PROJECT_REF') !== ref ||
    read('MERCADOPAGO_CLIENT_ID') !== '2691240967769590' ||
    read('MERCADOPAGO_CREDENTIAL_MODE') !== 'oauth' ||
    read('TABA_DEPLOYMENT_ENV') !== 'staging' ||
    read('MERCADOPAGO_ENVIRONMENT') !== 'test' ||
    read('MERCADOPAGO_OAUTH_ENVIRONMENT') !== 'test' ||
    read('MERCADOPAGO_REAL_PAYMENT_SMOKE_CONFIRMATION') ||
    read('MERCADOPAGO_PRODUCTION_REVIEW_STATUS') === 'approved') {
    throw new Error('Recovery deployment must remain isolated and test-only');
  }
  return {
    ref,
    binding: {
      deployment: 'staging' as const,
      paymentEnvironment: 'test' as const,
      oauthEnvironment: 'test' as const,
      clientId: '2691240967769590',
      supabaseUrl: `https://${ref}.supabase.co`,
      panelUrl: `${origin}/`, checkoutBaseUrl: origin, allowedOrigins: origin,
    },
  };
}

export function paymentWorkerLimits(read: (name: string) => string | undefined) {
  // Free Edge workers live for 150 seconds. One job per recovery invocation
  // leaves room for provider timeouts, reconciliation and durable persistence.
  return recoveryDeploymentBinding(read)
    ? { refreshLimit: 1, claimLimit: 1 }
    : { refreshLimit: 10, claimLimit: 20 };
}
