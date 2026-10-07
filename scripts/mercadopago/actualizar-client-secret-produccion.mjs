// Receives the replacement integrator secret through stdin. Does not change
// encryption keys, seller credentials, application identity or payment flags.
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { conToken } from '../lib/supabase-cli-token.mjs';
const ref = 'wwcpogltfgzgkrlilbcd';
const digest = value => createHash('sha256').update(value).digest('hex');
const replacement = readFileSync(0, 'utf8').trim();
if (process.argv[2] !== ref || !/^[A-Za-z0-9_+/=-]{16,}$/.test(replacement)) {
  throw Error('INVALID_TARGET_OR_REPLACEMENT');
}
await conToken(async token => {
  const url = `https://api.supabase.com/v1/projects/${ref}/secrets`;
  const headers = { Authorization: `Bearer ${token}`, 'content-type': 'application/json' };
  const before = await fetch(url, { headers });
  if (!before.ok) throw Error('SECRET_INVENTORY_UNAVAILABLE');
  const inventory = await before.json();
  const prior = new Map(inventory.map(row => [row.name, row.value]));
  for (const [name, expected] of Object.entries({
    MERCADOPAGO_CLIENT_ID: '7677852968049976', MERCADOPAGO_OAUTH_PROJECT_REF: ref,
    MERCADOPAGO_CREDENTIAL_MODE: 'oauth', MERCADOPAGO_ENVIRONMENT: 'production',
  })) if (prior.get(name) !== digest(expected)) throw Error('PRODUCTION_BINDING_MISMATCH');
  if (prior.get('MERCADOPAGO_CLIENT_SECRET') === digest(replacement)) throw Error('REPLACEMENT_IS_UNCHANGED');
  const saved = await fetch(url, { method: 'POST', headers, body: JSON.stringify([{name:'MERCADOPAGO_CLIENT_SECRET',value:replacement}]) });
  if (!saved.ok) throw Error('SECRET_UPDATE_FAILED');
  const after = await fetch(url, { headers });
  if (!after.ok) throw Error('SECRET_VERIFICATION_FAILED');
  const current = new Map((await after.json()).map(row => [row.name,row.value]));
  if (current.get('MERCADOPAGO_CLIENT_SECRET') !== digest(replacement)) throw Error('SECRET_VERIFICATION_FAILED');
  for (const name of ['MERCADOPAGO_CLIENT_ID','MERCADOPAGO_TOKEN_ENCRYPTION_KEY','MERCADOPAGO_OAUTH_WEBHOOK_SECRET']) {
    if (current.get(name) !== prior.get(name)) throw Error('UNRELATED_CREDENTIAL_CHANGED');
  }
  console.log('CLIENT_SECRET_REPLACED; SELLER_BINDING_AND_ENCRYPTION_KEY_PRESERVED');
});
