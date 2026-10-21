import { assertEquals, assertThrows } from 'jsr:@std/assert@1.0.19';
import { recoveryDeploymentBinding, RECOVERY_FORBIDDEN_REFS } from './recovery-deployment.ts';
import { oauthConfig } from './seller-oauth.ts';

const ref = 'abcdefghijklmnopqrst';
const origin = 'https://recovery-20261020.taba2-staging.pages.dev';
const valid: Record<string, string> = {
  TABA_RECOVERY_PROJECT_REF: ref, TABA_RECOVERY_CHECKOUT_ORIGIN: origin,
  SUPABASE_URL: `https://${ref}.supabase.co`, MERCADOPAGO_OAUTH_PROJECT_REF: ref,
  MERCADOPAGO_CLIENT_ID: '2691240967769590', MERCADOPAGO_CREDENTIAL_MODE: 'oauth',
  TABA_DEPLOYMENT_ENV: 'staging', MERCADOPAGO_ENVIRONMENT: 'test', MERCADOPAGO_OAUTH_ENVIRONMENT: 'test',
  MERCADOPAGO_OAUTH_PANEL_URL: origin + '/', TABA_CHECKOUT_BASE_URL: origin, TABA_ALLOWED_ORIGINS: origin,
};
const read = (values: Record<string, string>) => (key: string) => values[key];

Deno.test('recovery requires explicit opt-in; legacy deployments keep their current binding', () => {
  assertEquals(recoveryDeploymentBinding(read({})), null);
});
Deno.test('recovery binding accepts only staging, its own ref, test OAuth and controlled preview origin', () => {
  const result = recoveryDeploymentBinding(read(valid));
  assertEquals(result?.binding.paymentEnvironment, 'test');
  assertEquals(result?.binding.supabaseUrl, `https://${ref}.supabase.co`);
});
for (const forbidden of RECOVERY_FORBIDDEN_REFS) {
  Deno.test('recovery cannot adopt existing project ' + forbidden, () => {
    assertThrows(() => recoveryDeploymentBinding(read({ ...valid, TABA_RECOVERY_PROJECT_REF: forbidden,
      SUPABASE_URL: `https://${forbidden}.supabase.co`, MERCADOPAGO_OAUTH_PROJECT_REF: forbidden })));
  });
}
for (const [field, value] of Object.entries({
  MERCADOPAGO_CLIENT_ID: '7677852968049976', MERCADOPAGO_ENVIRONMENT: 'production',
  MERCADOPAGO_OAUTH_ENVIRONMENT: 'production', TABA_DEPLOYMENT_ENV: 'production',
  MERCADOPAGO_CREDENTIAL_MODE: 'legacy', MERCADOPAGO_REAL_PAYMENT_SMOKE_CONFIRMATION: 'fixture-authorization',
  MERCADOPAGO_PRODUCTION_REVIEW_STATUS: 'approved', SUPABASE_URL: 'https://attacker.invalid',
  TABA_RECOVERY_CHECKOUT_ORIGIN: 'https://la-taba.pages.dev', MERCADOPAGO_OAUTH_PROJECT_REF: 'wrong-project',
})) {
  Deno.test('recovery rejects cross-environment field ' + field, () => {
    assertThrows(() => recoveryDeploymentBinding(read({ ...valid, [field]: value })));
  });
}
Deno.test('real oauthConfig accepts the new test binding and derives callback and webhook on its own project', () => {
  const names = [...Object.keys(valid), 'MERCADOPAGO_REAL_PAYMENT_SMOKE_CONFIRMATION', 'MERCADOPAGO_PRODUCTION_REVIEW_STATUS'];
  const before = new Map(names.map(name => [name, Deno.env.get(name)]));
  try {
    for (const name of names) Deno.env.delete(name);
    for (const [name, value] of Object.entries(valid)) Deno.env.set(name, value);
    const result = oauthConfig();
    assertEquals(result.environment, 'test');
    assertEquals(result.callback, `https://${ref}.supabase.co/functions/v1/mercadopago-oauth-callback`);
    assertEquals(result.webhook, `https://${ref}.supabase.co/functions/v1/mercadopago-webhook`);
    Deno.env.set('TABA_ALLOWED_ORIGINS', 'https://la-taba.pages.dev');
    assertThrows(() => oauthConfig());
  } finally {
    for (const [name, value] of before) {
      if (value === undefined) Deno.env.delete(name); else Deno.env.set(name, value);
    }
  }
});
