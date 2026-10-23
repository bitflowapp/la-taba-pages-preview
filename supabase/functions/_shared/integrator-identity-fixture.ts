// Test support for fixtures that stub fetch: answers the two provider calls of assertIntegratorEnvironment() (the
// integrator application's client_credentials grant and its owner's /users/me), so each fixture only describes its
// own seller and preference calls. The owner is a test user in the test environment unless told otherwise.
export const INTEGRATOR_FIXTURE_TOKEN = 'APP_USR-integrator-fixture';
export const INTEGRATOR_FIXTURE_OWNER = 721168650;

export function integratorProviderResponse(
  input: unknown,
  init?: RequestInit,
  ownerTestUser = Deno.env.get('MERCADOPAGO_OAUTH_ENVIRONMENT') === 'test',
): Response | null {
  const url = new URL(input instanceof Request ? input.url : String(input));
  if (url.origin !== 'https://api.mercadopago.com') return null;
  if (url.pathname === '/oauth/token') {
    let grantType: unknown = null;
    try { grantType = JSON.parse(String(init?.body ?? '{}')).grant_type; } catch { /* not this call */ }
    if (grantType !== 'client_credentials') return null;
    return Response.json({ access_token: INTEGRATOR_FIXTURE_TOKEN, token_type: 'bearer', expires_in: 21600, user_id: INTEGRATOR_FIXTURE_OWNER, live_mode: true });
  }
  if (url.pathname === '/users/me' && new Headers(init?.headers).get('authorization') === `Bearer ${INTEGRATOR_FIXTURE_TOKEN}`) {
    return Response.json({ id: INTEGRATOR_FIXTURE_OWNER, site_id: 'MLA', tags: ownerTestUser ? ['test_user', 'normal'] : ['normal'] });
  }
  return null;
}
