import { createServiceClient, sha256Hex } from '../payment-runtime.ts';
import { MobbexClient } from './client.ts';
import { resolveMobbexConfig, type MobbexConfig } from './config.ts';
import { supabaseLedger } from './ledger.ts';

/** Reads the Edge Function secrets of THIS deployment. Disabled unless MOBBEX_ENABLED is exactly "true". */
export function mobbexConfigFromEnv(): MobbexConfig {
  return resolveMobbexConfig((name) => Deno.env.get(name));
}

/** The concrete client: it satisfies `MobbexOperationsPort` and also exposes `refundOperation`, which only the refund function needs. */
export function mobbexOperations(config: MobbexConfig): MobbexClient {
  return new MobbexClient({ apiKey: config.apiKey, accessToken: config.accessToken, testOperations: config.environment === 'test' });
}

export function mobbexLedger() {
  return supabaseLedger(createServiceClient());
}

export { sha256Hex };
