import { createServiceClient, sha256Hex } from '../payment-runtime.ts';
import { MobbexClient } from './client.ts';
import { resolveMobbexConfig, type MobbexConfig } from './config.ts';
import { supabaseLedger } from './ledger.ts';
import type { MobbexOperationsPort } from './handlers.ts';

/** Reads the Edge Function secrets of THIS deployment. Disabled unless MOBBEX_ENABLED is exactly "true". */
export function mobbexConfigFromEnv(): MobbexConfig {
  return resolveMobbexConfig((name) => Deno.env.get(name));
}

export function mobbexOperations(config: MobbexConfig): MobbexOperationsPort {
  return new MobbexClient({ apiKey: config.apiKey, accessToken: config.accessToken });
}

export function mobbexLedger() {
  return supabaseLedger(createServiceClient());
}

export { sha256Hex };
