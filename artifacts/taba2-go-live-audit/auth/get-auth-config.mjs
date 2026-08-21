// Auditoría READ-ONLY del Auth productivo · 2026-08-21
//
// SÓLO GET contra la Management API: /v1/projects/{ref}/config/auth.
// No hay ningún PATCH/POST/PUT/DELETE en este archivo. No imprime secretos:
// todo campo que lleve credencial se reduce a presencia (true/false).
//
//   node artifacts/taba2-go-live-audit/auth/get-auth-config.mjs
//
// Escribe auth-config-sanitized.json al lado de este archivo.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { conToken } from '../../../scripts/lib/supabase-cli-token.mjs';

const REF = 'wwcpogltfgzgkrlilbcd'; // producción
const AQUI = path.dirname(fileURLToPath(import.meta.url));

// Campos cuyo VALOR jamás se imprime ni se escribe: sólo presencia.
const SECRETOS = [
  'smtp_pass',
  'security_captcha_secret',
  'hook_send_email_secrets',
  'hook_send_sms_secrets',
  'hook_custom_access_token_secrets',
  'hook_mfa_verification_attempt_secrets',
  'hook_password_verification_attempt_secrets',
];
// Además, cualquier clave que huela a credencial y no esté listada arriba.
const PATRON_SECRETO = /(secret|password|_pass$|private_key|client_secret|api_key)/i;

const config = await conToken(async (token) => {
  const r = await fetch(`https://api.supabase.com/v1/projects/${REF}/config/auth`, {
    method: 'GET',
    headers: { Authorization: `Bearer ${token}` },
  });
  const text = await r.text();
  if (!r.ok) throw new Error(`GET config/auth -> ${r.status} ${text.slice(0, 200)}`);
  return JSON.parse(text);
});

const sanitizado = {};
for (const [clave, valor] of Object.entries(config)) {
  if (SECRETOS.includes(clave) || PATRON_SECRETO.test(clave)) {
    sanitizado[clave] = valor === null || valor === undefined || valor === ''
      ? '(ausente)'
      : '(PRESENTE, valor redactado)';
  } else {
    sanitizado[clave] = valor;
  }
}

const salida = {
  schemaVersion: 1,
  ref: REF,
  checkedAt: new Date().toISOString(),
  metodo: 'GET https://api.supabase.com/v1/projects/{ref}/config/auth (único request)',
  config: sanitizado,
};

fs.writeFileSync(
  path.join(AQUI, 'auth-config-sanitized.json'),
  `${JSON.stringify(salida, null, 2)}\n`,
  'utf8',
);

// Resumen dirigido a las preguntas de la auditoría.
const c = config;
console.log(`--- CONFIG AUTH PRODUCCIÓN (${REF}) · ${salida.checkedAt} ---`);
console.log('[SMTP]');
console.log(`  smtp_host            : ${c.smtp_host ? `configurado (${c.smtp_host})` : 'AUSENTE (remitente integrado de Supabase)'}`);
console.log(`  smtp_admin_email     : ${c.smtp_admin_email ? 'presente' : 'AUSENTE'}`);
console.log(`  smtp_user            : ${c.smtp_user ? 'presente' : 'AUSENTE'}`);
console.log(`  smtp_pass            : ${c.smtp_pass ? 'presente (redactado)' : 'AUSENTE'}`);
console.log(`  smtp_sender_name     : ${c.smtp_sender_name ? 'presente' : 'AUSENTE'}`);
console.log(`  rate_limit_email_sent: ${c.rate_limit_email_sent}/hora`);
console.log(`  smtp_max_frequency   : ${c.smtp_max_frequency}`);
console.log('[SIGNUP]');
console.log(`  disable_signup                  : ${c.disable_signup}`);
console.log(`  external_email_enabled          : ${c.external_email_enabled}`);
console.log(`  external_anonymous_users_enabled: ${c.external_anonymous_users_enabled}`);
console.log(`  mailer_autoconfirm              : ${c.mailer_autoconfirm} (${c.mailer_autoconfirm ? 'NO exige confirmación' : 'confirmación EXIGIDA'})`);
console.log(`  mailer_otp_exp                  : ${c.mailer_otp_exp}s`);
console.log('[CAPTCHA]');
console.log(`  security_captcha_enabled : ${c.security_captcha_enabled}`);
console.log(`  security_captcha_provider: ${c.security_captcha_provider ?? '(ninguno)'}`);
console.log(`  security_captcha_secret  : ${c.security_captcha_secret ? 'presente (redactado)' : 'ausente'}`);
console.log('[RATE LIMITS]');
for (const k of Object.keys(c).filter((k) => k.startsWith('rate_limit_'))) {
  console.log(`  ${k}: ${c[k]}`);
}
console.log('[SESIONES / PASSWORD]');
console.log(`  jwt_exp                          : ${c.jwt_exp}s`);
console.log(`  refresh_token_rotation_enabled   : ${c.refresh_token_rotation_enabled}`);
console.log(`  security_refresh_token_reuse_interval: ${c.security_refresh_token_reuse_interval}s`);
console.log(`  sessions_timebox                 : ${c.sessions_timebox ?? 0} (0 = sin tope)`);
console.log(`  sessions_inactivity_timeout      : ${c.sessions_inactivity_timeout ?? 0} (0 = sin tope)`);
console.log(`  password_min_length              : ${c.password_min_length}`);
console.log(`  password_hibp_enabled            : ${c.password_hibp_enabled}`);
console.log(`  password_required_characters     : ${JSON.stringify(c.password_required_characters ?? '')}`);
console.log(`  security_update_password_require_reauthentication: ${c.security_update_password_require_reauthentication}`);
console.log('[SITE / REDIRECTS]');
console.log(`  site_url      : ${c.site_url}`);
console.log(`  uri_allow_list: ${c.uri_allow_list ? c.uri_allow_list : '(vacía)'}`);
console.log('[MFA]');
console.log(`  mfa_totp_enroll_enabled: ${c.mfa_totp_enroll_enabled}`);
console.log('\n  evidencia: auth-config-sanitized.json (secretos redactados a presencia)');
