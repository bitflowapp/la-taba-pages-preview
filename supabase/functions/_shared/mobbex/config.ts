/**
 * Mobbex runtime configuration (Edge Function secrets). Pure: it receives an
 * environment reader so it can be unit tested and never touches `Deno` itself.
 *
 * Default is DISABLED. Every layer fails closed:
 *
 *   MOBBEX_ENABLED                         must be exactly "true"
 *   MOBBEX_ENVIRONMENT                     "test" | "production"
 *   MOBBEX_API_KEY / MOBBEX_ACCESS_TOKEN   credentials of the merchant's own Mobbex account (never LUNA's)
 *   MOBBEX_WEBHOOK_TOKEN_SECRET            >= 32 chars, signs the per-checkout webhook capability token
 *   MOBBEX_PRODUCTION_REVIEW_STATUS        must be "approved" for production
 *   MOBBEX_REAL_PAYMENT_CONFIRMATION       must be the literal below for production (the "final key")
 *
 * Nothing here is ever logged or returned to a browser: `describeMobbexConfig`
 * yields booleans only.
 */

export type MobbexEnvironment = 'test' | 'production';

export const MOBBEX_REAL_PAYMENT_CONFIRMATION = 'I_AUTHORIZE_REAL_MOBBEX_PAYMENT';

export type EnvReader = (name: string) => string | undefined;

export interface MobbexConfig {
  environment: MobbexEnvironment;
  apiKey: string;
  accessToken: string;
  webhookTokenSecret: string;
}

export class MobbexConfigError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
  }
}

function read(env: EnvReader, name: string): string {
  return (env(name) ?? '').trim();
}

export function mobbexSwitchedOn(env: EnvReader): boolean {
  return read(env, 'MOBBEX_ENABLED') === 'true';
}

export function resolveMobbexConfig(env: EnvReader): MobbexConfig {
  if (!mobbexSwitchedOn(env)) throw new MobbexConfigError('MOBBEX_DISABLED', 'Mobbex is not enabled for this deployment.');
  const environment = read(env, 'MOBBEX_ENVIRONMENT').toLowerCase();
  if (environment !== 'test' && environment !== 'production') {
    throw new MobbexConfigError('MOBBEX_ENVIRONMENT_INVALID', 'MOBBEX_ENVIRONMENT must be test or production.');
  }
  const apiKey = read(env, 'MOBBEX_API_KEY');
  const accessToken = read(env, 'MOBBEX_ACCESS_TOKEN');
  if (!apiKey || !accessToken) throw new MobbexConfigError('MOBBEX_CREDENTIALS_MISSING', 'Mobbex credentials are not loaded.');
  const webhookTokenSecret = read(env, 'MOBBEX_WEBHOOK_TOKEN_SECRET');
  if (webhookTokenSecret.length < 32) {
    throw new MobbexConfigError('MOBBEX_WEBHOOK_SECRET_WEAK', 'MOBBEX_WEBHOOK_TOKEN_SECRET must have at least 32 characters.');
  }
  if (environment === 'production') {
    if (read(env, 'MOBBEX_PRODUCTION_REVIEW_STATUS') !== 'approved') {
      throw new MobbexConfigError('MOBBEX_PRODUCTION_NOT_APPROVED', 'Production Mobbex review is not approved.');
    }
    if (read(env, 'MOBBEX_REAL_PAYMENT_CONFIRMATION') !== MOBBEX_REAL_PAYMENT_CONFIRMATION) {
      throw new MobbexConfigError('MOBBEX_REAL_PAYMENT_NOT_AUTHORIZED', 'A real Mobbex payment has not been explicitly authorized.');
    }
  }
  return { environment, apiKey, accessToken, webhookTokenSecret };
}

/** Booleans only: safe for logs, health endpoints and the operator panel. */
export function describeMobbexConfig(env: EnvReader): Record<string, boolean | string> {
  const switchedOn = mobbexSwitchedOn(env);
  let usable = false;
  let reason = 'disabled';
  if (switchedOn) {
    try {
      resolveMobbexConfig(env);
      usable = true;
      reason = 'ok';
    } catch (error) {
      reason = error instanceof MobbexConfigError ? error.code : 'invalid';
    }
  }
  return {
    switched_on: switchedOn,
    usable,
    reason,
    has_api_key: read(env, 'MOBBEX_API_KEY') !== '',
    has_access_token: read(env, 'MOBBEX_ACCESS_TOKEN') !== '',
    has_webhook_token_secret: read(env, 'MOBBEX_WEBHOOK_TOKEN_SECRET').length >= 32,
  };
}
