/*
 * Configuración segura de credenciales de la aplicación integradora Marco/LUNA en PRODUCCIÓN.
 *
 *   node scripts/mercadopago/configurar-oauth-produccion.mjs
 *   echo '{"clientId":"...","clientSecret":"...","webhookSecret":"..."}' | node scripts/mercadopago/configurar-oauth-produccion.mjs --stdin
 *
 * El proyecto y el sitio salen de deploy/environments.json (producción). Mientras
 * producción no tenga proyecto, sale 2 sin leer ninguna credencial. La producción
 * controlada es un proyecto retirado: `--target=controlled-production` se
 * rechaza. Nada de esto habilita cobros: la revisión productiva y la
 * autorización del primer pago real siguen siendo pasos explícitos y separados.
 */
import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { productionTargetOrExit } from '../lib/environments.mjs';
import { conToken } from '../lib/supabase-cli-token.mjs';

const targetName = String(process.argv.find((value) => value.startsWith('--target='))?.split('=')[1] || 'production');
if (targetName !== 'production') {
  console.error(`Destino inválido o retirado (${targetName}). No se modificó nada.`);
  process.exit(2);
}
const production = productionTargetOrExit({ allowProvisioned: true });
const target = { ref: production.ref, site: production.origin };
const { ref } = target;
const expectedClientId = '7677852968049976';
if (production.mercadoPagoApplicationId !== expectedClientId) {
  throw Error('El registro de entornos no declara La Taba Delivery como aplicación de producción. No se modificó nada.');
}
let input = {};
const stdinMode = process.argv.includes('--stdin');
if (stdinMode) {
  try {
    input = JSON.parse(readFileSync(0, 'utf8'));
  } catch {
    throw Error('Entrada de configuración inválida. No se modificó producción.');
  }
}

const clientId = stdinMode ? input?.clientId : process.env.TABA_SETUP_CLIENT_ID;
const clientSecret = stdinMode ? input?.clientSecret : process.env.TABA_SETUP_CLIENT_SECRET;
const webhookSecret = stdinMode ? input?.webhookSecret : process.env.TABA_SETUP_WEBHOOK_SECRET;

const completeSecret = (value) =>
  typeof value === 'string' && /^[A-Za-z0-9_+/=-]{16,}$/.test(value) && !/^(?:undefined|null|not_available)/i.test(value);

if (clientId !== expectedClientId || !completeSecret(clientSecret) || !completeSecret(webhookSecret)) {
  throw Error('Faltan credenciales completas de la aplicación productiva. No se modificó producción.');
}

await conToken(async (token) => {
  const headers = { Authorization: `Bearer ${token}`, 'content-type': 'application/json' };
  const endpoint = `https://api.supabase.com/v1/projects/${ref}/secrets`;
  const existingResponse = await fetch(endpoint, { headers });
  if (!existingResponse.ok) throw Error('No pudimos verificar producción.');
  const existing = await existingResponse.json();

  const values = {
    MERCADOPAGO_CLIENT_ID: clientId,
    MERCADOPAGO_CLIENT_SECRET: clientSecret,
    MERCADOPAGO_OAUTH_WEBHOOK_SECRET: webhookSecret,
    MERCADOPAGO_CREDENTIAL_MODE: 'oauth',
    MERCADOPAGO_ENVIRONMENT: 'production',
    MERCADOPAGO_OAUTH_ENVIRONMENT: 'production',
    TABA_DEPLOYMENT_ENV: 'production',
    MERCADOPAGO_OAUTH_PROJECT_REF: ref,
    MERCADOPAGO_OAUTH_PANEL_URL: `${target.site}/`,
    TABA_CHECKOUT_BASE_URL: target.site,
    TABA_ALLOWED_ORIGINS: target.site,
  };

  if (!existing.some((entry) => entry.name === 'MERCADOPAGO_TOKEN_ENCRYPTION_KEY')) {
    values.MERCADOPAGO_TOKEN_ENCRYPTION_KEY = randomBytes(32).toString('base64url');
  }
  // La sal de los hashes de logs no se rota nunca desde acá: cambiarla rompe
  // la correlación de los registros que ya existen.
  if (!existing.some((entry) => entry.name === 'PAYMENT_LOG_HASH_SALT')) {
    values.PAYMENT_LOG_HASH_SALT = randomBytes(32).toString('base64url');
  }

  const response = await fetch(endpoint, {
    method: 'POST',
    headers,
    body: JSON.stringify(Object.entries(values).map(([name, value]) => ({ name, value }))),
  });

  if (!response.ok) throw Error(`La configuración de producción falló (HTTP ${response.status}).`);
  console.log(`Configuración OAuth de Marco guardada en ${targetName} (${ref}).`);
  console.log('Compuerta fail-closed activa: cobros reales deshabilitados hasta que Walter complete la autorización OAuth.');
});
