// Lo unico del Auth productivo que se puede cerrar sin dominio y sin proveedor.
//
// `production-auth-posture.mjs` MIDE. Esto ESCRIBE, y por eso pide autorizacion
// explicita en vez de correr solo:
//
//   $env:TABA2_PRODUCTION_AUTH_HARDENING = "I_AUTHORIZE_TABA2_PRODUCTION_AUTH_HARDENING"
//   $env:SUPABASE_ACCESS_TOKEN = <token del CLI>
//   node scripts/harden-production-auth.mjs --ref wwcpogltfgzgkrlilbcd
//
// Sin `--apply` no escribe: imprime lo que cambiaria y sale 0.
//
// ## Que cambia, y por que solo esto
//
//   password_hibp_enabled: false -> true
//
// Rechaza contrasenas que aparecen en brechas publicas conocidas. Es un toggle
// nativo de Supabase —no hay proveedor que contratar ni credencial que
// inventar— y afecta a las cuentas del Panel y del Rider, que son las unicas
// que usan contrasena. Con `auth.users` en cero no puede dejar afuera a nadie:
// solo se aplica al crear o cambiar una contrasena.
//
// ## Lo que se agrega con banderas, porque ya hay donde apuntar
//
//   --site-url <url>    el host canonico de produccion. Es lo que renderiza
//                       `{{ .SiteURL }}` en los correos, asi que sin esto los
//                       enlaces apuntan a la maquina de quien los abre.
//   --templates         los seis correos de supabase/templates/, en castellano
//                       y apuntando a /cuenta/?token_hash=... Ver el README de
//                       esa carpeta: no llevan `redirect_to`, y por eso ningun
//                       correo depende de la allow-list.
//
// ## Que sigue SIN cambiar, y por que
//
//   uri_allow_list      vacia. Ningun flujo manda `redirect_to`: el Panel no lo
//                       usa al pedir recuperacion y las plantillas apuntan al
//                       site_url. Agregarle algo hoy seria abrir sin motivo.
//   captcha             exige un widget de un proveedor y, sobre todo, que los
//                       tres clientes manden el token. Prenderlo sin eso apaga
//                       el ingreso anonimo del Customer.
//   disable_signup      cerrarlo apaga el Customer: el ingreso anonimo pasa por
//                       el mismo /signup. Lo que lo hace inerte es que crear
//                       identidad no reparte rol.
//   sessions_timebox    caducar sesiones es una decision de producto: le pega
//   sessions_inactivity al Customer anonimo igual que al Panel, y hoy nadie
//                       decidio cuanto dura un turno en el local.
//   smtp                mandar correo de verdad necesita un proveedor. Este
//                       guion no inventa uno; ver SMTP-PRODUCTION-STATUS.md.
//
// Salida 0 = aplicado o nada que hacer. 1 = no se pudo. 2 = falta autorizacion.

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const PRODUCTION_REF = 'wwcpogltfgzgkrlilbcd';
const STAGING_REF = 'ukxqbgswjlibmnjemrzd';
const APPROVAL = 'I_AUTHORIZE_TABA2_PRODUCTION_AUTH_HARDENING';
const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TEMPLATES_DIR = path.join(RAIZ, 'supabase', 'templates');

/**
 * Los seis correos, con su asunto. El cuerpo vive en un archivo para que se
 * pueda leer, revisar y diffear como lo que es: texto que le llega a una
 * persona.
 */
const CORREOS = [
  { archivo: 'confirmation.html', contenido: 'mailer_templates_confirmation_content', asuntoClave: 'mailer_subjects_confirmation', asunto: 'Confirmá tu cuenta de La Taba' },
  { archivo: 'recovery.html', contenido: 'mailer_templates_recovery_content', asuntoClave: 'mailer_subjects_recovery', asunto: 'Cambiá tu contraseña de La Taba' },
  { archivo: 'email_change.html', contenido: 'mailer_templates_email_change_content', asuntoClave: 'mailer_subjects_email_change', asunto: 'Confirmá tu correo nuevo en La Taba' },
  { archivo: 'magic_link.html', contenido: 'mailer_templates_magic_link_content', asuntoClave: 'mailer_subjects_magic_link', asunto: 'Tu enlace para entrar a La Taba' },
  { archivo: 'invite.html', contenido: 'mailer_templates_invite_content', asuntoClave: 'mailer_subjects_invite', asunto: 'Te invitaron a trabajar en La Taba' },
  { archivo: 'reauthentication.html', contenido: 'mailer_templates_reauthentication_content', asuntoClave: 'mailer_subjects_reauthentication', asunto: 'Tu código de verificación de La Taba' },
];

// Lo que este guion sabe cambiar. Una sola clave: si manana hay otra, se agrega
// aca con su razon, y no por una bandera generica que acepte cualquier campo.
const CAMBIOS = {
  password_hibp_enabled: {
    deseado: true,
    porque: 'rechaza contrasenas filtradas en brechas conocidas; sin proveedor externo',
  },
};

// Campos que NO se tocan y que ademas se comparan antes y despues: si el PATCH
// mueve alguno, se reporta. Un cambio parcial que arrastra otra cosa es
// exactamente el accidente que hay que poder ver.
const VIGILADOS = [
  'site_url', 'uri_allow_list', 'disable_signup', 'external_anonymous_users_enabled',
  'external_email_enabled', 'mailer_autoconfirm', 'password_min_length', 'jwt_exp',
  'refresh_token_rotation_enabled', 'security_refresh_token_reuse_interval',
  'security_captcha_enabled', 'rate_limit_anonymous_users', 'rate_limit_verify',
  'rate_limit_otp', 'rate_limit_token_refresh', 'rate_limit_email_sent',
  'sessions_timebox', 'sessions_inactivity_timeout', 'mfa_totp_enroll_enabled',
  'security_update_password_require_reauthentication',
];

function arg(name) {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? undefined : process.argv[i + 1];
}

const ref = (arg('ref') || '').trim();
if (ref !== PRODUCTION_REF) {
  console.error(`--ref debe ser ${PRODUCTION_REF}; no hay default implicito`);
  process.exit(2);
}

const token = process.env.SUPABASE_ACCESS_TOKEN;
if (!token) {
  console.error('falta SUPABASE_ACCESS_TOKEN en el entorno');
  process.exit(2);
}

const aplicar = process.argv.includes('--apply');
if (aplicar && process.env.TABA2_PRODUCTION_AUTH_HARDENING !== APPROVAL) {
  console.error(`--apply exige TABA2_PRODUCTION_AUTH_HARDENING = ${APPROVAL}`);
  process.exit(2);
}

// --- lo que se pide por bandera ---------------------------------------------

const siteUrlPedido = (arg('site-url') || '').trim().replace(/\/+$/, '');
if (siteUrlPedido) {
  let u;
  try { u = new URL(siteUrlPedido); } catch (_) { u = null; }
  const malo = !u ? 'no es una URL'
    : u.protocol !== 'https:' ? 'tiene que ser https'
      : /localhost|127\.0\.0\.1|\[::1\]/i.test(u.hostname) ? 'es un host local: los enlaces del correo no llegarian a ningun lado'
        : u.hostname.includes(STAGING_REF) || /staging/i.test(u.hostname) ? 'parece staging, y produccion no puede apuntar ahi'
          : u.search || u.hash ? 'no puede llevar query ni fragmento'
            : '';
  if (malo) { console.error(`--site-url ${malo}`); process.exit(2); }
  CAMBIOS.site_url = {
    deseado: siteUrlPedido,
    porque: 'host canonico de produccion; es lo que renderiza {{ .SiteURL }} en los correos',
  };
}

if (process.argv.includes('--templates')) {
  for (const correo of CORREOS) {
    const cuerpo = fs.readFileSync(path.join(TEMPLATES_DIR, correo.archivo), 'utf8').trim();
    if (/\{\{\s*\.ConfirmationURL\s*\}\}/.test(cuerpo)) {
      // El contrato de estas plantillas es que NO usan ConfirmationURL: es lo
      // que las deja sin `redirect_to`. Si alguna vuelve a usarlo, se frena acá
      // y no en produccion.
      console.error(`${correo.archivo} usa ConfirmationURL; el contrato es token_hash + SiteURL`);
      process.exit(2);
    }
    CAMBIOS[correo.contenido] = { deseado: cuerpo, porque: `cuerpo de ${correo.archivo}` };
    CAMBIOS[correo.asuntoClave] = { deseado: correo.asunto, porque: `asunto de ${correo.archivo}` };
  }
}

/*
 * --smtp: el proveedor de correo, cuando exista.
 *
 * Es la unica compuerta externa que le falta al Auth productivo, y esta escrita
 * de forma que cerrarla sea UN comando. Los valores entran por entorno, no por
 * bandera, para que la contrasena no quede en el historial de la consola; y la
 * contrasena esta marcada como secreta, asi que no se imprime ni siquiera en el
 * ensayo.
 *
 *   $env:TABA_SMTP_HOST         = "smtp.proveedor.com"
 *   $env:TABA_SMTP_PORT         = "587"
 *   $env:TABA_SMTP_USER         = "<usuario>"
 *   $env:TABA_SMTP_PASS         = "<clave del proveedor>"
 *   $env:TABA_SMTP_SENDER_EMAIL = "no-responder@<dominio verificado>"
 *   $env:TABA_SMTP_SENDER_NAME  = "La Taba"
 *
 * Ver artifacts/taba2-production-auth-go-live/SMTP-PRODUCTION-STATUS.md.
 */
if (process.argv.includes('--smtp')) {
  const smtp = {
    smtp_host: process.env.TABA_SMTP_HOST,
    smtp_port: process.env.TABA_SMTP_PORT,
    smtp_user: process.env.TABA_SMTP_USER,
    smtp_pass: process.env.TABA_SMTP_PASS,
    smtp_admin_email: process.env.TABA_SMTP_SENDER_EMAIL,
    smtp_sender_name: process.env.TABA_SMTP_SENDER_NAME,
  };
  const faltan = Object.entries(smtp).filter(([, v]) => !String(v || '').trim()).map(([k]) => k);
  if (faltan.length) {
    console.error(`--smtp exige el proveedor completo; falta(n): ${faltan.join(', ')}`);
    console.error('Ver SMTP-PRODUCTION-STATUS.md: un remitente a medias no manda nada.');
    process.exit(2);
  }
  const puerto = Number(smtp.smtp_port);
  if (!Number.isInteger(puerto) || ![25, 465, 587, 2465, 2525, 2587].includes(puerto)) {
    console.error(`TABA_SMTP_PORT=${smtp.smtp_port} no es un puerto de SMTP conocido`);
    process.exit(2);
  }
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(String(smtp.smtp_admin_email))) {
    console.error('TABA_SMTP_SENDER_EMAIL no es un correo valido');
    process.exit(2);
  }
  CAMBIOS.smtp_host = { deseado: String(smtp.smtp_host).trim(), porque: 'servidor de correo del proveedor' };
  CAMBIOS.smtp_port = { deseado: String(puerto), porque: 'puerto del proveedor' };
  CAMBIOS.smtp_user = { deseado: String(smtp.smtp_user).trim(), porque: 'usuario del proveedor', secreto: true };
  CAMBIOS.smtp_pass = { deseado: String(smtp.smtp_pass), porque: 'credencial del proveedor', secreto: true };
  CAMBIOS.smtp_admin_email = { deseado: String(smtp.smtp_admin_email).trim().toLowerCase(), porque: 'direccion remitente verificada' };
  CAMBIOS.smtp_sender_name = { deseado: String(smtp.smtp_sender_name).trim(), porque: 'nombre que ve la persona' };

  // Con remitente propio, dos correos por hora deja de ser el techo: es el
  // limite del remitente integrado, y con el puesto una tarde de altas queda a
  // medias sin que nadie entienda por que.
  const porHora = Number(arg('emails-hora') || 30);
  if (!Number.isInteger(porHora) || porHora < 2 || porHora > 500) {
    console.error('--emails-hora tiene que estar entre 2 y 500');
    process.exit(2);
  }
  CAMBIOS.rate_limit_email_sent = {
    deseado: porHora,
    porque: 'techo de correos por hora con remitente propio; 2 es el del integrado',
  };
}

// Un campo que se va a cambiar a proposito no puede estar ademas vigilado: si
// no, el control de deriva reportaria como accidente lo que se pidio.
const vigilados = VIGILADOS.filter((clave) => !(clave in CAMBIOS));

async function leer() {
  const r = await fetch(`https://api.supabase.com/v1/projects/${ref}/config/auth`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const text = await r.text();
  if (!r.ok) throw new Error(`${r.status} ${text.slice(0, 300)}`);
  return JSON.parse(text);
}

const antes = await leer();

const pendientes = Object.entries(CAMBIOS)
  .filter(([clave, { deseado }]) => antes[clave] !== deseado);

/** Un valor largo -una plantilla de correo- se resume: importa si cambia, no cuanto mide. */
function resumir(valor) {
  const texto = typeof valor === 'string' ? valor : JSON.stringify(valor);
  if (texto == null) return 'null';
  return texto.length > 40 ? `«${texto.length} car.»` : texto;
}

console.log(`--- ENDURECIMIENTO DE AUTH (${ref}) ---`);
for (const [clave, { deseado, porque, secreto }] of Object.entries(CAMBIOS)) {
  const actual = antes[clave];
  // Una credencial no se imprime ni siquiera para decir que cambia: el ensayo
  // corre en la misma consola que despues queda en el historial.
  const estado = actual === deseado ? 'ya esta'
    : secreto ? '«se escribe, no se muestra»'
      : `${resumir(actual)} -> ${resumir(deseado)}`;
  console.log(`  ${clave.padEnd(38)} ${estado.padEnd(30)} ${porque}`);
}

// `process.exitCode` en vez de `process.exit()`: en Windows, salir con una
// conexion keep-alive todavia abierta dispara una asercion de libuv y devuelve 9
// en vez del codigo pedido, que es justo lo que un gate no puede permitirse.
if (!pendientes.length) {
  console.log('\n  nada que cambiar');
} else if (!aplicar) {
  console.log(`\n  ${pendientes.length} cambio(s) pendiente(s). Correr con --apply y la autorizacion para escribir.`);
} else {
  const cuerpo = Object.fromEntries(pendientes.map(([clave, { deseado }]) => [clave, deseado]));
  const r = await fetch(`https://api.supabase.com/v1/projects/${ref}/config/auth`, {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(cuerpo),
  });
  if (!r.ok) {
    console.error(`  PATCH fallo: ${r.status} ${(await r.text()).slice(0, 300)}`);
    process.exitCode = 1;
  } else {
    const despues = await leer();
    const sinAplicar = pendientes.filter(([clave, { deseado }]) => despues[clave] !== deseado);
    const deriva = vigilados.filter((k) => JSON.stringify(antes[k]) !== JSON.stringify(despues[k]));

    console.log(`\n  aplicados         : ${pendientes.length - sinAplicar.length}/${pendientes.length}`);
    if (sinAplicar.length) console.log(`  NO aplicados      : ${sinAplicar.map(([clave]) => clave).join(', ')}`);
    console.log(`  deriva no pedida  : ${deriva.length ? deriva.join(', ') : 'ninguna'}`);

    if (sinAplicar.length || deriva.length) process.exitCode = 1;
    else console.log('\n  RESULTADO         : APLICADO');
  }
}
