import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { conToken } from '../lib/supabase-cli-token.mjs';

const ref = 'ukxqbgswjlibmnjemrzd';
const secretName = 'MERCADOPAGO_OAUTH_WEBHOOK_SECRET';
const digest = value => createHash('sha256').update(value).digest('hex');

export async function configureWebhookSecret(secret, { request = fetch, withToken = conToken } = {}) {
  if (typeof secret !== 'string' || !/^[A-Za-z0-9_+/=-]{16,}$/.test(secret)) {
    throw new Error('Firma incompleta o invalida. No se modifico staging.');
  }
  await withToken(async token => {
    const endpoint = `https://api.supabase.com/v1/projects/${ref}/secrets`;
    const headers = { Authorization: `Bearer ${token}`, 'content-type': 'application/json' };
    const before = await request(endpoint, { headers });
    if (!before.ok) throw new Error('No se pudo verificar staging.');
    const existing = await before.json();
    const required = ['MERCADOPAGO_CLIENT_ID', 'MERCADOPAGO_CLIENT_SECRET', 'MERCADOPAGO_TOKEN_ENCRYPTION_KEY'];
    const matches = (name, value) => existing.some(item => item.name === name && item.value === digest(value));
    if (required.some(name => !existing.some(item => item.name === name)) ||
        !matches('TABA_DEPLOYMENT_ENV', 'staging') ||
        !matches('MERCADOPAGO_ENVIRONMENT', 'test') ||
        !matches('MERCADOPAGO_OAUTH_PROJECT_REF', ref)) {
      throw new Error('La configuracion previa no corresponde al staging esperado. No se modifico nada.');
    }
    const saved = await request(endpoint, {
      method: 'POST', headers, body: JSON.stringify([{ name: secretName, value: secret }]),
    });
    if (!saved.ok) throw new Error('No se pudo guardar la firma en staging.');
    const after = await request(endpoint, { headers });
    if (!after.ok || !(await after.json()).some(item => item.name === secretName && item.value === digest(secret))) {
      throw new Error('La firma se envio, pero no se pudo verificar.');
    }
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    await configureWebhookSecret(readFileSync(0, 'utf8').trim());
    console.log('Webhook Secret: CONFIGURED y verificado en staging.');
  } catch {
    console.error('No se completo la configuracion del webhook. El secreto no se muestra.');
    process.exitCode = 1;
  }
}
