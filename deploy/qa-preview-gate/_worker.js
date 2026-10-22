// Puerta de acceso de los previews QA y candidatos (Cloudflare Pages, modo avanzado).
//
// `noindex` sólo le pide a los buscadores que no indexen: cualquiera con la URL
// entraba igual. Esta puerta pide usuario y contraseña (HTTP Basic) ANTES de
// servir un solo archivo. El artefacto productivo no la lleva nunca: la agrega
// `scripts/recovery/prepare-preview.mjs --access-gate` sólo a los previews.
//
// La contraseña no vive en Cloudflare: el proyecto guarda únicamente el SHA-256
// de `usuario:contraseña` como secreto (`PREVIEW_ACCESS_SHA256`). Sin ese
// secreto la puerta falla cerrada.

const REALM = 'La Taba QA';
const encoder = new TextEncoder();

const SECURITY_HEADERS = Object.freeze({
  'X-Robots-Tag': 'noindex, nofollow, noarchive',
  'X-Frame-Options': 'DENY',
  'X-Content-Type-Options': 'nosniff',
});

export async function sha256Hex(text) {
  const digest = await crypto.subtle.digest('SHA-256', encoder.encode(text));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

function sameHex(left, right) {
  if (left.length !== right.length) return false;
  let different = 0;
  for (let index = 0; index < left.length; index += 1) different |= left.charCodeAt(index) ^ right.charCodeAt(index);
  return different === 0;
}

export async function isAuthorized(request, expectedHex) {
  const expected = String(expectedHex || '').trim().toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(expected)) return false;
  const match = /^Basic\s+([A-Za-z0-9+/=]{4,512})$/i.exec(String(request.headers.get('authorization') || '').trim());
  if (!match) return false;
  let decoded;
  try {
    decoded = new TextDecoder().decode(Uint8Array.from(atob(match[1]), (char) => char.charCodeAt(0)));
  } catch (_) {
    return false;
  }
  if (!decoded.includes(':')) return false;
  return sameHex(await sha256Hex(decoded), expected);
}

function deny(status, message) {
  const headers = new Headers({
    ...SECURITY_HEADERS,
    'Content-Type': 'text/plain; charset=utf-8',
    'Cache-Control': 'no-store',
  });
  if (status === 401) headers.set('WWW-Authenticate', `Basic realm="${REALM}", charset="UTF-8"`);
  return new Response(message, { status, headers });
}

export default {
  async fetch(request, env) {
    if (!/^[0-9a-f]{64}$/i.test(String(env?.PREVIEW_ACCESS_SHA256 || '').trim())) {
      return deny(503, 'Este entorno de prueba está cerrado: falta configurar el acceso.');
    }
    if (!(await isAuthorized(request, env.PREVIEW_ACCESS_SHA256))) {
      return deny(401, 'Entorno de prueba de La Taba. El acceso es sólo para el equipo.');
    }
    const response = await env.ASSETS.fetch(request);
    const headers = new Headers(response.headers);
    for (const [name, value] of Object.entries(SECURITY_HEADERS)) headers.set(name, value);
    // Sin worker, Pages sirve los estáticos con `max-age=0, must-revalidate`; detrás de la puerta llegan sin
    // Cache-Control. Sin revalidación explícita un navegador podía quedarse con un shell o un version.json viejos.
    // `private`: lo que se sirvió con credencial no se guarda en cachés compartidas. Lo que `_headers` fija se respeta.
    if (!headers.has('Cache-Control')) headers.set('Cache-Control', 'private, no-cache');
    // Lo autenticado no se comparte en cachés intermedias.
    headers.append('Vary', 'Authorization');
    return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
  },
};
