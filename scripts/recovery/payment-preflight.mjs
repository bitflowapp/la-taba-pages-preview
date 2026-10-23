// Read-only readiness check. Does not create a checkout, payment or OAuth grant.
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { recoveryEnvironment } from './plan.mjs';
import { withRecoveryProject } from './hosted-client.mjs';

export const PAYMENT_SERVER_SECRETS = [
  'SUPABASE_URL', 'SUPABASE_ANON_KEY', 'SUPABASE_SERVICE_ROLE_KEY',
  'MERCADOPAGO_CLIENT_SECRET', 'MERCADOPAGO_TOKEN_ENCRYPTION_KEY',
  'MERCADOPAGO_OAUTH_WEBHOOK_SECRET', 'PAYMENT_LOG_HASH_SALT', 'PAYMENT_WORKER_SECRET',
];

export function evaluatePaymentConfiguration(target, inventory) {
  const hash = value => createHash('sha256').update(value).digest('hex');
  const missingSecrets = PAYMENT_SERVER_SECRETS.filter(name => !inventory.some(item => item.name === name));
  const mismatchedConfiguration = Object.entries(recoveryEnvironment(target))
    .filter(([name, value]) => !inventory.some(item => item.name === name && item.value === hash(value))).map(([name]) => name);
  const forbiddenNames = ['MERCADOPAGO_REAL_PAYMENT_SMOKE_CONFIRMATION', 'MERCADOPAGO_PRODUCTION_REVIEW_STATUS'];
  const forbiddenConfiguration = forbiddenNames.filter(name => inventory.some(item => item.name === name));
  return { missingSecrets, mismatchedConfiguration, forbiddenConfiguration,
    serverConfigurationReady: missingSecrets.length === 0 && mismatchedConfiguration.length === 0 && forbiddenConfiguration.length === 0,
    oauthRedirectRegistrationVerified: false, providerPaymentVerified: false, commercialGo: false };
}

export async function inspectPaymentReadiness(target) {
  return withRecoveryProject(target, async ({ request, query }) => {
    const configuration = evaluatePaymentConfiguration(target, await request('/secrets'));
    // Checkout Pro payments between test users report live_mode=true (payment 179851082485): the environment, bound
    // to a `test_user` seller, is what proves no real money moved, not that flag.
    const [database] = await query(`select
      (select count(*) from public.payment_intents where environment <> 'test')::int non_test_intents,
      (select count(*) from public.payment_intents where environment = 'test' and live_mode is true)::int test_intents_with_live_mode,
      (select count(*) from public.business_payment_settings where enabled and environment <> 'test')::int non_test_settings,
      (select count(*) from public.mp_seller_connections where environment <> 'test')::int non_test_connections,
      (select count(*) from private.la_taba_recovery_source_rows where source_table='products')::int preserved_products,
      (select count(*) from public.orders)::int orders`);
    return { at: new Date().toISOString(), projectRef: target.projectRef, ...configuration, database,
      commercialGuardsIntact: database.non_test_intents === 0 && database.non_test_settings === 0 && database.non_test_connections === 0,
      pendingHumanSteps: ['Register exact OAuth redirect and enable PKCE in TABA2 Staging',
        'Copy full webhook signature directly into Supabase Secrets'],
      financialOperationsExecuted: false };
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(import.meta.filename)) {
  const value = name => process.argv[process.argv.indexOf(name) + 1];
  if (!['--check','--target','--evidence'].every(name => process.argv.includes(name))) throw new Error('Requires --check --target --evidence');
  const result = await inspectPaymentReadiness(JSON.parse(fs.readFileSync(value('--target'), 'utf8')));
  fs.writeFileSync(value('--evidence'), JSON.stringify(result, null, 2) + '\n');
  console.log(JSON.stringify(result));
}
