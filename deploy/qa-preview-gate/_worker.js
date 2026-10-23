// Puerta de acceso de los previews QA y candidatos (Cloudflare Pages, modo avanzado).
//
// `noindex` sólo le pide a los buscadores que no indexen: cualquiera con la URL
// entraba igual. Esta puerta pide usuario y contraseña ANTES de servir un solo
// archivo. El artefacto productivo no la lleva nunca: la agrega
// `scripts/recovery/prepare-preview.mjs --access-gate` sólo a los previews.
//
// La contraseña no vive en Cloudflare: el proyecto guarda únicamente el SHA-256
// de `usuario:contraseña` como secreto (`PREVIEW_ACCESS_SHA256`). Sin ese
// secreto la puerta falla cerrada.
//
// Dos formas de entrar:
//   · una cookie de sesión firmada, que da el formulario `/__acceso`. Es la que
//     sirve con la PWA: un service worker no puede mostrar el diálogo de HTTP
//     Basic, y con un 401 volvía a la shell guardada, así que el revisor seguía
//     viendo una versión vieja sin enterarse. Una navegación sin acceso, en
//     cambio, se redirige al formulario, y la redirección el worker la deja
//     pasar. Los pedidos del propio service worker llevan la cookie: puede
//     actualizarse y precachear.
//   · HTTP Basic, para las herramientas de verificación. Una navegación
//     autorizada así también deja la cookie.
// La cookie dura 30 días y se firma con el secreto: rotar la contraseña
// invalida todas las sesiones.

const REALM = 'La Taba QA';
const LOGIN_PATH = '/__acceso';
export const SESSION_COOKIE = '__Host-taba_qa';
const SESSION_SECONDS = 30 * 24 * 60 * 60;
const encoder = new TextEncoder();

const SECURITY_HEADERS = Object.freeze({
  'X-Robots-Tag': 'noindex, nofollow, noarchive',
  'X-Frame-Options': 'DENY',
  'X-Content-Type-Options': 'nosniff',
});

const toHex = (buffer) => [...new Uint8Array(buffer)].map((byte) => byte.toString(16).padStart(2, '0')).join('');

export async function sha256Hex(text) {
  return toHex(await crypto.subtle.digest('SHA-256', encoder.encode(text)));
}

async function hmacHex(secret, message) {
  const key = await crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return toHex(await crypto.subtle.sign('HMAC', key, encoder.encode(message)));
}

function sameHex(left, right) {
  if (left.length !== right.length) return false;
  let different = 0;
  for (let index = 0; index < left.length; index += 1) different |= left.charCodeAt(index) ^ right.charCodeAt(index);
  return different === 0;
}

const validSecret = (value) => /^[0-9a-f]{64}$/.test(String(value || '').trim().toLowerCase());

async function credentialMatches(decoded, expectedHex) {
  const expected = String(expectedHex || '').trim().toLowerCase();
  if (!validSecret(expected) || !decoded.includes(':')) return false;
  return sameHex(await sha256Hex(decoded), expected);
}

export async function isAuthorized(request, expectedHex) {
  const match = /^Basic\s+([A-Za-z0-9+/=]{4,512})$/i.exec(String(request.headers.get('authorization') || '').trim());
  if (!match) return false;
  let decoded;
  try {
    decoded = new TextDecoder().decode(Uint8Array.from(atob(match[1]), (char) => char.charCodeAt(0)));
  } catch (_) {
    return false;
  }
  return credentialMatches(decoded, expectedHex);
}

/** `v1.<vence en ms>.<HMAC-SHA256 de "v1.<vence>" con el secreto>`. */
export async function sessionToken(secretHex, expiresAt) {
  const body = `v1.${Math.floor(expiresAt)}`;
  return `${body}.${await hmacHex(String(secretHex).trim().toLowerCase(), body)}`;
}

export async function hasValidSession(request, secretHex) {
  if (!validSecret(secretHex)) return false;
  const cookies = String(request.headers.get('cookie') || '').split(';').map((part) => part.trim());
  const value = cookies.find((part) => part.startsWith(`${SESSION_COOKIE}=`))?.slice(SESSION_COOKIE.length + 1) || '';
  const match = /^v1\.(\d{10,16})\.([0-9a-f]{64})$/.exec(value);
  if (!match || Number(match[1]) <= Date.now()) return false;
  return sameHex(await hmacHex(String(secretHex).trim().toLowerCase(), `v1.${match[1]}`), match[2]);
}

async function sessionCookie(secretHex) {
  const token = await sessionToken(secretHex, Date.now() + SESSION_SECONDS * 1000);
  return `${SESSION_COOKIE}=${token}; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=${SESSION_SECONDS}`;
}

/** Sólo una ruta de este mismo sitio; cualquier otra cosa vuelve al inicio. */
function safeReturn(value) {
  const text = String(value || '');
  if (!text.startsWith('/') || text.startsWith('//') || text.startsWith('/\\') || text.startsWith(LOGIN_PATH)) return '/';
  return text.slice(0, 2048);
}

const isNavigation = (request) => request.headers.get('sec-fetch-mode') === 'navigate';

function plain(status, message, extra = {}) {
  const headers = new Headers({ ...SECURITY_HEADERS, 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store', ...extra });
  return new Response(message, { status, headers });
}

const escapeHtml = (text) => String(text).replace(/[&<>"']/g, (char) => `&#${char.charCodeAt(0)};`);

function loginPage(status, volver, error = '') {
  const html = `<!doctype html>
<html lang="es-AR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>La Taba · entorno de prueba</title>
<style>
body{margin:0;min-height:100vh;display:grid;place-items:center;font:16px/1.4 system-ui,sans-serif;background:#f6f4ef;color:#1d1b16}
main{width:min(360px,calc(100vw - 32px));background:#fff;border-radius:14px;padding:24px;box-shadow:0 2px 12px rgb(0 0 0/.08)}
h1{font-size:20px;margin:0 0 6px}p{margin:0 0 16px;color:#5a554b}label{display:block;margin:12px 0 4px;font-weight:600}
input{width:100%;box-sizing:border-box;padding:12px;border:1px solid #c9c3b6;border-radius:10px;font:inherit}
button{margin-top:18px;width:100%;min-height:44px;border:0;border-radius:10px;background:#1d1b16;color:#fff;font:inherit;font-weight:600}
.error{color:#a3261b;font-weight:600}
@media (prefers-color-scheme:dark){body{background:#151412;color:#f2efe8}main{background:#22201c}p{color:#bdb6a8}input{background:#151412;color:#f2efe8;border-color:#4a463e}button{background:#f2efe8;color:#151412}.error{color:#ff8a7a}}
</style></head><body><main>
<h1>Entorno de prueba de La Taba</h1>
<p>El acceso es sólo para el equipo. Ingresá con el usuario y la clave que te pasaron.</p>
${error ? `<p class="error" role="alert">${escapeHtml(error)}</p>` : ''}
<form method="post" action="${LOGIN_PATH}">
<input type="hidden" name="volver" value="${escapeHtml(volver)}">
<label for="usuario">Usuario</label><input id="usuario" name="usuario" autocomplete="username" required>
<label for="clave">Clave</label><input id="clave" name="clave" type="password" autocomplete="current-password" required>
<button type="submit">Entrar</button>
</form></main></body></html>`;
  return new Response(html, { status, headers: new Headers({ ...SECURITY_HEADERS, 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' }) });
}

async function handleLogin(request, secretHex) {
  const url = new URL(request.url);
  if (request.method === 'GET' || request.method === 'HEAD') return loginPage(200, safeReturn(url.searchParams.get('volver')));
  if (request.method !== 'POST') return plain(405, 'Método no permitido.', { Allow: 'GET, POST' });
  let form;
  try {
    form = await request.formData();
  } catch (_) {
    return loginPage(400, '/', 'No se pudo leer el formulario.');
  }
  const volver = safeReturn(form.get('volver'));
  const user = String(form.get('usuario') || '');
  const password = String(form.get('clave') || '');
  if (!user || !password || !(await credentialMatches(`${user}:${password}`, secretHex))) {
    return loginPage(401, volver, 'Usuario o clave incorrectos.');
  }
  return new Response(null, { status: 303, headers: new Headers({ ...SECURITY_HEADERS, Location: volver,
    'Set-Cookie': await sessionCookie(secretHex), 'Cache-Control': 'no-store' }) });
}

export default {
  async fetch(request, env) {
    const secret = String(env?.PREVIEW_ACCESS_SHA256 || '').trim();
    if (!validSecret(secret)) {
      return plain(503, 'Este entorno de prueba está cerrado: falta configurar el acceso.');
    }
    const url = new URL(request.url);
    if (url.pathname === LOGIN_PATH) return handleLogin(request, secret);

    const session = await hasValidSession(request, secret);
    const basic = !session && (await isAuthorized(request, secret));
    if (!session && !basic) {
      if (isNavigation(request)) {
        const volver = safeReturn(url.pathname + url.search);
        return plain(302, 'Hace falta ingresar.', { Location: `${LOGIN_PATH}?volver=${encodeURIComponent(volver)}` });
      }
      return plain(401, 'Entorno de prueba de La Taba. El acceso es sólo para el equipo.',
        { 'WWW-Authenticate': `Basic realm="${REALM}", charset="UTF-8"` });
    }
    const response = await env.ASSETS.fetch(request);
    const headers = new Headers(response.headers);
    for (const [name, value] of Object.entries(SECURITY_HEADERS)) headers.set(name, value);
    // Sin worker, Pages sirve los estáticos con `max-age=0, must-revalidate`; detrás de la puerta llegan sin
    // Cache-Control. Sin revalidación explícita un navegador podía quedarse con un shell o un version.json viejos.
    // `private`: lo que se sirvió con credencial no se guarda en cachés compartidas. Lo que `_headers` fija se respeta.
    if (!headers.has('Cache-Control')) headers.set('Cache-Control', 'private, no-cache');
    // Lo autenticado no se comparte en cachés intermedias.
    headers.append('Vary', 'Authorization, Cookie');
    // Quien entró con HTTP Basic navegando se lleva también la sesión: los pedidos del service worker no
    // pueden repetir el diálogo, pero sí llevan la cookie.
    if (basic && isNavigation(request)) headers.append('Set-Cookie', await sessionCookie(secret));
    return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
  },
};
