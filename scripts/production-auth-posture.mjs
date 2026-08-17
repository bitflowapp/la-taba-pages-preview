// Postura del Auth hosted de produccion. SOLO LECTURA.
//
// El manifiesto de release declaraba `authDomain` como gate externo con dos
// valores escritos a mano —`siteUrl: 'http://localhost:3000'` y
// `uriAllowList: ''`—. Eran ciertos, pero nadie los estaba MIDIENDO: si alguien
// tocaba el panel de Supabase, el manifiesto seguia diciendo lo mismo.
//
// Esta sonda responde, contra el proyecto vivo, las preguntas que decide el
// gate de Auth:
//
//   1. cual es el site_url y cual la allow-list de redirects
//   2. la allow-list falla cerrada de verdad (se comprueba por el camino real)
//   3. el signup esta abierto o cerrado, y por que tiene que estar asi
//   4. hay captcha, y si no, que lo sustituye
//   5. los limites de tasa que hoy sostienen el signup abierto
//   6. la politica de contrasenas y de sesiones
//
// Dos fuentes, a proposito:
//
//   · Management API (`/config/auth`) — lo que el proyecto tiene configurado.
//     Necesita el PAT del CLI.
//   · GoTrue publico (`/auth/v1/settings` y un `/auth/v1/verify` con un token
//     invalido) — lo que el servidor HACE. No necesita PAT y no muta nada: un
//     token invalido no consume ni crea nada, pero la validacion del
//     `redirect_to` ocurre ANTES, asi que el `Location` de la respuesta dice
//     cual es la allow-list efectiva sin tener que creerle a la configuracion.
//
// Si las dos fuentes discrepan, se reporta como hallazgo: querria decir que lo
// declarado y lo servido no son la misma cosa.
//
//   $env:SUPABASE_ACCESS_TOKEN = <token del CLI>
//   node scripts/production-auth-posture.mjs --ref wwcpogltfgzgkrlilbcd --key <publishable>
//
// Ningun valor de credencial se imprime ni se escribe: la clave publicable sale
// por huella y el PAT no sale nunca.
//
// Salida 0 = la postura es la esperada. 1 = hay algo que mirar. 2 = no se pudo
// preguntar.

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const PRODUCTION_REF = 'wwcpogltfgzgkrlilbcd';
const STAGING_REF = 'ukxqbgswjlibmnjemrzd';

function arg(name) {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? undefined : process.argv[i + 1];
}

const ref = (arg('ref') || '').trim();
if (ref !== PRODUCTION_REF) {
  console.error(`--ref debe ser ${PRODUCTION_REF}; no hay default implicito`);
  process.exit(2);
}

const keyArg = arg('key');
const keyFile = arg('key-file');
const KEY = (keyArg || (keyFile ? fs.readFileSync(keyFile, 'utf8') : '')).trim();
if (!KEY) {
  console.error('falta --key o --key-file (la clave publicable, no una secreta)');
  process.exit(2);
}
if (!KEY.startsWith('sb_publishable_')) {
  console.error('la clave tiene que ser publicable: esta sonda no acepta otra clase');
  process.exit(2);
}

const PAT = process.env.SUPABASE_ACCESS_TOKEN;
if (!PAT) {
  console.error('falta SUPABASE_ACCESS_TOKEN en el entorno');
  process.exit(2);
}

const BASE = `https://${ref}.supabase.co`;

/** Huella de una credencial: suficiente para comparar, inutil para usar. */
function huella(value) {
  const text = String(value || '');
  if (text.length < 10) return '[redactado]';
  return `${text.slice(0, 20)}…${text.slice(-4)} (len=${text.length})`;
}

async function managementAuthConfig() {
  const r = await fetch(`https://api.supabase.com/v1/projects/${ref}/config/auth`, {
    headers: { Authorization: `Bearer ${PAT}` },
  });
  const text = await r.text();
  if (!r.ok) throw new Error(`${r.status} ${text.slice(0, 300)}`);
  return JSON.parse(text);
}

async function gotruePublicSettings() {
  const r = await fetch(`${BASE}/auth/v1/settings`, { headers: { apikey: KEY } });
  const text = await r.text();
  if (!r.ok) throw new Error(`${r.status} ${text.slice(0, 300)}`);
  return JSON.parse(text);
}

/**
 * A donde manda GoTrue cuando se le pide un `redirect_to`.
 *
 * Se usa `/auth/v1/verify` con un token que no existe. La verificacion falla
 * —eso es lo que se quiere: no se consume ni se crea nada— pero el destino ya
 * quedo resuelto, asi que el `Location` dice si el candidato estaba permitido
 * (vuelve a el) o no (cae al site_url).
 */
async function destinoEfectivo(candidato) {
  const u = new URL(`${BASE}/auth/v1/verify`);
  u.searchParams.set('token', '000000');
  u.searchParams.set('type', 'recovery');
  u.searchParams.set('redirect_to', candidato);
  const r = await fetch(u, { headers: { apikey: KEY }, redirect: 'manual' });
  const location = r.headers.get('location') || '';
  const destino = location ? location.split('#')[0] : '';
  return { status: r.status, destino, permitido: normalizar(destino) === normalizar(candidato) };
}

function normalizar(url) {
  return String(url || '').replace(/\/+$/, '').toLowerCase();
}

const hallazgos = [];
const notas = [];
function exigir(ok, detalle) { if (!ok) hallazgos.push(detalle); return ok; }

console.log(`--- POSTURA DE AUTH (${ref}) ---`);
console.log(`  clave usada       : ${huella(KEY)}`);

let config;
let publico;
try {
  [config, publico] = await Promise.all([managementAuthConfig(), gotruePublicSettings()]);
} catch (error) {
  console.error(`no se pudo leer la configuracion de Auth: ${error.message}`);
  process.exit(2);
}

// ---------- 1 · site_url y allow-list ----------

const siteUrl = String(config.site_url || '');
const allowList = String(config.uri_allow_list || '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

console.log(`  site_url          : ${siteUrl || '(vacio)'}`);
console.log(`  redirect allow-list: ${allowList.length ? allowList.join(' · ') : '(vacia)'}`);

const siteEsLocal = /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?/i.test(siteUrl);
if (siteEsLocal) {
  notas.push(
    'site_url sigue siendo un host local: cualquier enlace de correo de Auth apunta a la '
    + 'maquina de quien lo abre y por lo tanto no funciona. Es el gate de dominio, no un bug.',
  );
}

// La allow-list vacia NO es un descuido: con la lista vacia GoTrue solo admite
// el site_url, que es el minimo privilegio posible mientras no haya host.
if (allowList.length) {
  const sospechosos = allowList.filter((u) => /localhost|127\.0\.0\.1|\*|\.trycloudflare\.com/i.test(u));
  exigir(sospechosos.length === 0, `la allow-list admite destinos que no deberia: ${sospechosos.join(', ')}`);
  const staging = allowList.filter((u) => u.includes(STAGING_REF) || /taba2-staging/i.test(u));
  exigir(staging.length === 0, `la allow-list de PRODUCCION admite destinos de staging: ${staging.join(', ')}`);
}

// ---------- 2 · la allow-list falla cerrada por el camino real ----------

const candidatos = [
  siteUrl || `${BASE}/`,
  'https://taba2-staging.pages.dev/',
  'https://bitflowapp.github.io/la-taba-pages-preview/',
  'http://localhost:9999/otro-puerto',
  'http://127.0.0.1:9999/',
  'http://[::1]:9999/',
  'http://localhost.example-que-nadie-autorizo/',
  'http://sub.localhost:9999/',
  'https://redirect-que-nadie-autorizo.example/',
];

/**
 * GoTrue admite SIEMPRE los destinos de loopback POR IP.
 *
 * La exencion es mas chica de lo que se creia, y se vio al mover el site_url a
 * un host productivo:
 *
 *   site_url = http://localhost:3000   localhost:9999 PERMITIDO · 127.0.0.1 PERMITIDO
 *   site_url = https://la-taba…dev     localhost:9999 RECHAZADO · 127.0.0.1 PERMITIDO
 *
 * O sea que `localhost` entraba por parecerse al host del site_url, no por ser
 * loopback. Lo que GoTrue exime siempre son las IP de loopback literales
 * (`127.0.0.1`, `[::1]`) sobre http, en cualquier puerto y cualquier ruta. Un
 * host con nombre —`localhost`, `sub.localhost`, `localhost.evil.example`— no
 * entra, y https tampoco. No se apaga desde la allow-list.
 *
 * Se distingue de un permitido inesperado a proposito: es comportamiento del
 * servidor, no configuracion de este proyecto, y contarlo como falla haria que
 * el gate diera rojo para siempre sin que nadie pueda arreglarlo. Se mide, se
 * nombra y viaja en el reporte.
 */
function esLoopback(url) {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'http:') return false;
    const host = parsed.hostname.toLowerCase();
    return host === 'localhost' || host === '127.0.0.1' || host === '[::1]' || host === '::1';
  } catch (_) {
    return false;
  }
}
const medidos = [];
for (const candidato of candidatos) {
  try {
    medidos.push({ candidato, ...(await destinoEfectivo(candidato)) });
  } catch (error) {
    medidos.push({ candidato, status: 0, destino: '', permitido: false, error: error.message });
  }
}

const permitidos = medidos.filter((m) => m.permitido).map((m) => m.candidato);
const rechazados = medidos.filter((m) => !m.permitido);
console.log(`  destinos probados : ${medidos.length} · permitidos ${permitidos.length}`);
for (const m of medidos) {
  console.log(`    ${m.permitido ? 'PERMITE' : 'rechaza'}  ${m.candidato}`);
}

// Lo unico que puede estar permitido es el site_url declarado, lo que la
// allow-list liste, y el loopback que GoTrue exime por su cuenta. Cualquier
// otra cosa quiere decir que lo configurado y lo servido no coinciden.
const declarados = new Set([normalizar(siteUrl), ...allowList.map(normalizar)]);
const loopbackPermitido = permitidos.filter((u) => esLoopback(u) && !declarados.has(normalizar(u)));
const permitidosInesperados = permitidos
  .filter((u) => !declarados.has(normalizar(u)) && !esLoopback(u));

exigir(
  permitidosInesperados.length === 0,
  `GoTrue acepta redirects remotos que la configuracion no declara: ${permitidosInesperados.join(', ')}`,
);
exigir(
  rechazados.every((m) => !m.destino || normalizar(m.destino) === normalizar(siteUrl)),
  'un redirect rechazado no cayo al site_url: la allow-list no esta fallando cerrada',
);

if (loopbackPermitido.length) {
  console.log(`  loopback          : GoTrue lo exime siempre (${loopbackPermitido.length} destino(s) medidos)`);
  notas.push(
    `GoTrue exime siempre las IP de loopback literales sobre http (medido: ${loopbackPermitido.join(', ')}), `
    + 'en cualquier puerto y cualquier ruta, sin importar el site_url ni la allow-list, y no se puede '
    + 'apagar desde ahi. Un host con nombre como localhost NO entra desde que el site_url dejo de ser '
    + 'local. Entra en el modelo de amenaza, no en el gate: para aprovecharlo hace falta una cuenta, '
    + 'que esa persona abra un enlace preparado, y un proceso escuchando en su propia maquina que '
    + 'ademas sirva HTML. Ademas ningun correo de TABA manda redirect_to.',
  );
}

// ---------- 3 · signup ----------

const signupAbierto = config.disable_signup === false;
const anonimo = config.external_anonymous_users_enabled === true;
const emailHabilitado = config.external_email_enabled === true;
const autoconfirm = config.mailer_autoconfirm === true;

console.log(`  signup            : ${signupAbierto ? 'ABIERTO' : 'cerrado'} · anonimo=${anonimo} · email=${emailHabilitado}`);
console.log(`  confirmacion email: ${autoconfirm ? 'NO exigida (autoconfirm)' : 'exigida'}`);

// El Customer entra con signInAnonymously, y en GoTrue el ingreso anonimo pasa
// por el mismo /signup. Cerrarlo apaga el cliente. Que el signup este abierto
// no es una postura floja: es la unica compatible con el producto, y lo que lo
// hace inerte es que crear una identidad no reparte ningun rol.
exigir(
  !(signupAbierto && !anonimo),
  'el signup esta abierto pero el ingreso anonimo esta apagado: se paga el riesgo sin usar la funcion',
);
exigir(
  !(anonimo && !signupAbierto),
  'el ingreso anonimo esta encendido con el signup cerrado: el Customer no puede entrar',
);
exigir(!autoconfirm, 'mailer_autoconfirm esta encendido: un email sin confirmar valdria como identidad verificada');
exigir(
  publico.disable_signup === !signupAbierto,
  `la configuracion dice disable_signup=${config.disable_signup} y GoTrue publica ${publico.disable_signup}`,
);

// ---------- 4 · captcha y lo que lo sustituye ----------

const captcha = config.security_captcha_enabled === true;
console.log(`  captcha           : ${captcha ? `si (${config.security_captcha_provider})` : 'no'}`);
if (!captcha) {
  notas.push(
    'sin captcha. Requiere una cuenta de proveedor (hCaptcha o Turnstile) que hoy no existe, '
    + 'asi que es un gate externo, no una decision pendiente de codigo.',
  );
}

// ---------- 5 · limites de tasa ----------

const limites = {
  anonimos_por_hora_ip: config.rate_limit_anonymous_users,
  signin_signup_por_5min_ip: config.rate_limit_verify,
  verificaciones_otp_por_5min_ip: config.rate_limit_otp,
  refresh_por_5min_ip: config.rate_limit_token_refresh,
  emails_por_hora: config.rate_limit_email_sent,
};
console.log('  limites de tasa   : ' + Object.entries(limites).map(([k, v]) => `${k}=${v}`).join(' · '));

// Con el signup abierto, los limites son la primera contencion. No sustituyen a
// RLS —eso lo demuestra production-security-smoke— pero si el limite fuera 0 no
// habria ninguna.
for (const [nombre, valor] of Object.entries(limites)) {
  exigir(Number.isFinite(valor) && valor > 0, `el limite ${nombre} es ${valor}: sin tope no hay contencion`);
}

// ---------- 6 · contrasenas y sesiones ----------

const password = {
  minimo: config.password_min_length,
  filtradas_rechazadas: config.password_hibp_enabled === true,
  requiere_reautenticacion: config.security_update_password_require_reauthentication === true,
};
const sesiones = {
  rotacion_refresh: config.refresh_token_rotation_enabled === true,
  reuso_segundos: config.security_refresh_token_reuse_interval,
  jwt_segundos: config.jwt_exp,
  timebox_segundos: config.sessions_timebox,
  inactividad_segundos: config.sessions_inactivity_timeout,
};
console.log(`  contrasenas       : min=${password.minimo} · filtradas_rechazadas=${password.filtradas_rechazadas} · reauth=${password.requiere_reautenticacion}`);
console.log(`  sesiones          : rotacion=${sesiones.rotacion_refresh} · jwt=${sesiones.jwt_segundos}s · timebox=${sesiones.timebox_segundos || 'sin tope'} · inactividad=${sesiones.inactividad_segundos || 'sin tope'}`);

exigir(password.minimo >= 12, `el minimo de contrasena es ${password.minimo}; el panel y el rider usan contrasena`);
exigir(password.filtradas_rechazadas, 'las contrasenas filtradas en brechas conocidas se aceptan (password_hibp_enabled=false)');
exigir(password.requiere_reautenticacion, 'cambiar contrasena no exige reautenticar');
exigir(sesiones.rotacion_refresh, 'los refresh tokens no rotan');

if (!sesiones.timebox_segundos && !sesiones.inactividad_segundos) {
  notas.push(
    'las sesiones no caducan por tiempo ni por inactividad. Para el Panel en un aparato '
    + 'compartido del local es una decision de producto, no un default que convenga heredar.',
  );
}

// ---------- SMTP ----------

const smtpPropio = Boolean(config.smtp_host);
console.log(`  SMTP              : ${smtpPropio ? config.smtp_host : 'el integrado de Supabase (2 correos/hora, no para produccion)'}`);
if (!smtpPropio) {
  notas.push(
    'sin SMTP propio: recuperar la contrasena de una cuenta del Panel depende del servicio '
    + 'integrado, que esta limitado a 2 correos por hora y no tiene garantia de entrega.',
  );
}

// ---------- reporte ----------

const reporte = {
  schemaVersion: 1,
  ref,
  checkedAt: new Date().toISOString(),
  keyFingerprint: huella(KEY),
  siteUrl,
  siteUrlIsLocalhost: siteEsLocal,
  redirectAllowList: allowList,
  redirectProbe: medidos.map(({ candidato, status, destino, permitido }) => ({
    candidate: candidato, status, resolvedTo: destino, allowed: permitido,
  })),
  failsClosedForRemoteHosts: permitidosInesperados.length === 0,
  loopbackAlwaysAllowed: loopbackPermitido.length > 0,
  loopbackAllowed: loopbackPermitido,
  signup: {
    open: signupAbierto,
    anonymousEnabled: anonimo,
    emailEnabled: emailHabilitado,
    autoconfirm,
    why: 'el ingreso anonimo del Customer pasa por el mismo /signup; cerrarlo apaga el cliente',
    inertBecause: 'crear identidad no reparte rol: sin fila en business_members las policies devuelven vacio',
  },
  captcha: { enabled: captcha, provider: config.security_captcha_provider ?? null, secretConfigured: Boolean(config.security_captcha_secret) },
  rateLimits: limites,
  password,
  sessions: sesiones,
  smtp: { custom: smtpPropio, host: config.smtp_host ?? null },
  findings: hallazgos,
  notes: notas,
  healthy: hallazgos.length === 0,
};

const destinoReporte = arg('report');
if (destinoReporte) {
  fs.mkdirSync(path.dirname(path.resolve(destinoReporte)), { recursive: true });
  fs.writeFileSync(path.resolve(destinoReporte), `${JSON.stringify(reporte, null, 2)}\n`, 'utf8');
  console.log(`  reporte           : ${destinoReporte}`);
}

if (notas.length) {
  console.log('\n  NOTAS (no son fallas; son lo que falta afuera):');
  for (const n of notas) console.log(`    · ${n}`);
}

// `process.exitCode` en vez de `process.exit()`: en Windows, salir con una
// conexion keep-alive todavia abierta dispara una asercion de libuv y devuelve 9
// en vez del codigo pedido, que es justo lo que un gate no puede permitirse.
if (hallazgos.length) {
  console.error('\n  HALLAZGOS:');
  for (const h of hallazgos) console.error(`    ${h}`);
  process.exitCode = 1;
} else {
  console.log('\n  RESULTADO         : LA POSTURA ES LA ESPERADA');
}
