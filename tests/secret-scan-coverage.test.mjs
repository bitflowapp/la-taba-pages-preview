// El escáner de secretos tiene que ver las credenciales que este stack maneja
// (F13).
//
// POR QUÉ EXISTE ESTE ARCHIVO
// ---------------------------
// El gate «Secret scan» de CI (ci.yml) es un único paso: `npm run secrets:scan`.
// Y sus patrones eran cuatro: token de Mercado Pago, clave privada, clave de
// AWS y asignación de secreto de Mercado Pago.
//
// O sea: era CIEGO a la clave `service_role` de Supabase —la que puede leer y
// escribir cualquier tabla saltándose RLS—, al PAT de Supabase, y a los tokens
// de GitHub y Cloudflare, que son exactamente las credenciales con las que se
// despliega este proyecto. El único escáner del repo no miraba lo que más
// importa.
//
// EL CUIDADO QUE NO PUEDE PERDERSE: la clave PUBLICABLE (anon) de Supabase
// también es un JWT y es pública por diseño; vive legítimamente en
// `runtime-config.js`. Un patrón `eyJ…` a secas la marcaría, el gate empezaría a
// gritar en cada corrida y alguien lo terminaría desactivando. Por eso se
// decodifica el payload y sólo se denuncia el rol de servicio.
import assert from 'node:assert/strict';
import test from 'node:test';

import { isServiceRoleJwt, scanText } from '../scripts/scan-secrets.mjs';

/** Arma un JWT con el payload pedido. La firma no importa: nadie la valida. */
function jwt(payload) {
  const b64 = (obj) => Buffer.from(JSON.stringify(obj)).toString('base64url');
  return `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64(payload)}.${'x'.repeat(43)}`;
}

test('la clave publicable NO se marca: es pública por diseño', () => {
  const anon = jwt({ iss: 'supabase', ref: 'ukxqbgswjlibmnjemrzd', role: 'anon', iat: 1, exp: 2 });
  assert.equal(isServiceRoleJwt(anon), false);
  assert.deepEqual(scanText(`const key = '${anon}';`), []);
});

test('la clave service_role sí se marca', () => {
  const servicio = jwt({ iss: 'supabase', ref: 'ukxqbgswjlibmnjemrzd', role: 'service_role', iat: 1, exp: 2 });
  assert.equal(isServiceRoleJwt(servicio), true);
  assert.deepEqual(scanText(`SUPABASE_KEY=${servicio}`), ['Supabase service_role key']);
});

test('el PAT de Supabase y los tokens de GitHub se ven', () => {
  assert.deepEqual(scanText(`sbp_${'a1b2c3d4e5'.repeat(4)}`), ['Supabase personal access token']);
  assert.deepEqual(scanText(`ghp_${'A1b2C3d4E5'.repeat(4)}`), ['GitHub token']);
  assert.deepEqual(scanText(`github_pat_${'A1b2C3d4E5_'.repeat(6)}`), ['GitHub fine-grained token']);
});

// Las muestras se COMPONEN en tiempo de ejecución y nunca aparecen enteras como
// literal en este archivo. No es un capricho: la primera versión las escribía
// tal cual y el propio `npm run secrets:scan` marcaba este archivo. Un test de
// un detector de secretos no puede parecer un secreto.
//
// Y algo que conviene dejar dicho: `secrets:scan` NO forma parte de
// `npm run check`, sólo corre en CI, así que esa rotura no la veía ninguno de
// los dos gates locales.
const muestra = (nombre, valor) => `${nombre}=${valor}`;

test('los tokens de Cloudflare y service_role asignados a mano se ven', () => {
  assert.deepEqual(
    scanText(muestra('CLOUDFLARE_API_TOKEN', `Zx9${'kQm3PvT8sLdR2nB7hY4wE6uJ1aF0cG5iO'}`)),
    ['assigned Cloudflare API token'],
  );
  assert.deepEqual(
    scanText(muestra('SUPABASE_SERVICE_ROLE_KEY', `abcd${'1234efgh5678ijklmnop'}`)),
    ['assigned Supabase service role key'],
  );
});

test('el secreto de cliente y el de webhook también se ven', () => {
  // Los cubría un hook del plugin de Mercado Pago que en este host no corre
  // (invoca `python3` y acá sólo hay `python`). El gate del repo no puede
  // depender de un hook de terceros.
  const comilla = String.fromCharCode(39);
  const asignar = (clave, valor) => `${comilla}${clave}${comilla}: ${comilla}${valor}${comilla}`;
  assert.deepEqual(
    scanText(asignar('client_secret', 'c'.repeat(40))),
    ['assigned client secret'],
  );
  assert.deepEqual(
    scanText(asignar('webhook_secret', `AbCdEf${'0123456789'}xyzw`)),
    ['assigned webhook secret'],
  );
  assert.deepEqual(
    scanText(asignar('x-signature', `AbCdEf${'0123456789'}xyzw`)),
    ['assigned webhook secret'],
  );
});

test('las referencias a secretos de CI no son secretos', () => {
  // Los workflows CONSUMEN secretos por interpolación. Marcar eso sería el
  // falso positivo que apaga el gate.
  for (const linea of [
    'CLOUDFLARE_API_TOKEN: ${{ secrets.CLOUDFLARE_API_TOKEN }}',
    'SUPABASE_SERVICE_ROLE_KEY: ${{ secrets.SUPABASE_SERVICE_ROLE_KEY }}',
    'MERCADOPAGO_ACCESS_TOKEN=your_token_here',
    'SUPABASE_SERVICE_ROLE_KEY=<replace-me>',
    'client_secret: ${{ secrets.MP_CLIENT_SECRET }}',
  ]) {
    assert.deepEqual(scanText(linea), [], `falso positivo con: ${linea}`);
  }
});

test('lo que ya detectaba se sigue detectando', () => {
  // Compuestas, por lo mismo que arriba: escritas enteras, este archivo se
  // denunciaba a sí mismo.
  const guiones = '-'.repeat(5);
  assert.deepEqual(scanText(`APP_USR-${'1234567890'.repeat(3)}`), ['Mercado Pago access token']);
  assert.deepEqual(scanText(`${guiones}BEGIN PRIVATE KEY${guiones}`), ['private key']);
  assert.deepEqual(scanText(`AKIA${'IOSFODNN7EXAMPLE'}`), ['AWS access key']);
});
