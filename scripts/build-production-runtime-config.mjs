// Emite el `runtime-config.js` PRODUCTIVO. Nunca escribe sobre el del repo.
//
// El repositorio guarda una plantilla vacia a proposito: si el config productivo
// viviera versionado, cualquier artefacto de previsualizacion —GitHub Pages, un
// preview de rama, un `dist_release` copiado a mano— hablaria con la base real
// sin que nadie lo decidiera. La plantilla falla cerrada y esa propiedad no se
// negocia.
//
// Lo que faltaba era el otro lado: hasta ahora el config productivo se escribia
// a mano al desplegar. `STAGING-V61-CERTIFICACION.md` cuenta como eso ya se
// cobro una: `create-release-folder.mjs` copio la plantilla del repo sobre el
// paquete y el preflight tuvo que frenar la publicacion. Un archivo escrito a
// mano en el momento de publicar es exactamente donde entra un ref de staging.
//
// Este guion lo DERIVA:
//
//   · la URL no se pide, se deriva del ref  (https://<ref>.supabase.co)
//   · el ref tiene que ser el de produccion, y no el de staging
//   · el negocio tiene que ser el canonico
//   · la clave tiene que ser publicable; una secreta o un service_role cierran
//   · el resultado se vuelve a leer con el mismo resolutor que usa el navegador
//     y con los centinelas del gate de despliegue, y si no queda `production
//     ready` no se escribe nada
//
//   node scripts/build-production-runtime-config.mjs \
//     --key-file <archivo con la clave publicable> \
//     --out dist_release/runtime-config.js
//
// Sin `--out` imprime el archivo por salida estandar y no toca el disco.
//
// Salida 0 = config valido. 1 = la configuracion no pasa. 2 = falta un dato.

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const PRODUCTION_REF = 'wwcpogltfgzgkrlilbcd';
const STAGING_REF = 'ukxqbgswjlibmnjemrzd';
const CANONICAL_BUSINESS = '00000000-0000-4000-8000-000000000001';
const PUBLISHABLE_PREFIX = 'sb_publishable_';

function arg(name) {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? undefined : process.argv[i + 1];
}

const ref = (arg('ref') || PRODUCTION_REF).trim();
const businessId = (arg('business') || CANONICAL_BUSINESS).trim();
const pollMs = Number(arg('poll-ms') || 5000);
const out = arg('out');

const keyArg = arg('key');
const keyFile = arg('key-file');
const key = (keyArg || (keyFile ? fs.readFileSync(keyFile, 'utf8') : process.env.TABA_PRODUCTION_PUBLISHABLE_KEY || '')).trim();

const errores = [];

// --- 1 · el proyecto ---
if (ref !== PRODUCTION_REF) {
  errores.push(`el ref productivo es ${PRODUCTION_REF}; se pidio ${ref || '(vacio)'}`);
}
if (ref === STAGING_REF) {
  errores.push('ese es el proyecto de staging: no puede ser el backend de un paquete productivo');
}

// --- 2 · el negocio ---
if (businessId !== CANONICAL_BUSINESS) {
  errores.push(`el negocio canonico es ${CANONICAL_BUSINESS}; se pidio ${businessId || '(vacio)'}`);
}

// --- 3 · la clave ---
// El orden importa: primero se niegan las clases prohibidas y despues se exige
// la permitida, para que el mensaje diga QUE clase se recibio en vez de un
// generico "no empieza con el prefijo".
if (!key) {
  errores.push('falta la clave publicable (--key, --key-file o TABA_PRODUCTION_PUBLISHABLE_KEY)');
} else if (key.startsWith('sb_secret_')) {
  errores.push('la clave es SECRETA de proyecto: jamas puede viajar en un paquete de navegador');
} else if (key.startsWith('sbp_')) {
  errores.push('eso es un token de management/acceso personal, no una clave de cliente');
} else if (/service_role/i.test(key) || declaraServiceRole(key)) {
  errores.push('la clave se declara del rol de servicio: jamas puede viajar en un paquete de navegador');
} else if (!key.startsWith(PUBLISHABLE_PREFIX)) {
  errores.push(`la clave no es de la clase publicable (${PUBLISHABLE_PREFIX}…)`);
}

// --- 4 · el intervalo ---
if (!Number.isInteger(pollMs) || pollMs < 1000 || pollMs > 60000) {
  errores.push(`pollMs debe ser un entero entre 1000 y 60000; se pidio ${arg('poll-ms')}`);
}

/** Las claves heredadas llevan el rol en el cuerpo del JWT, no en el texto. */
function declaraServiceRole(value) {
  const partes = String(value).split('.');
  if (partes.length !== 3) return false;
  try {
    const payload = JSON.parse(Buffer.from(partes[1], 'base64url').toString('utf8'));
    return String(payload?.role || '').toLowerCase() === 'service_role';
  } catch (_) {
    return false;
  }
}

if (errores.length) {
  console.error('No se puede emitir el runtime-config productivo:');
  for (const e of errores) console.error(`- ${e}`);
  process.exit(errores.some((e) => e.startsWith('falta')) ? 2 : 1);
}

// La URL se DERIVA del ref. No es un campo que alguien pueda equivocar: si el
// ref es el de produccion, la URL es la de produccion, y no hay forma de que
// las dos digan cosas distintas.
const supabaseUrl = `https://${ref}.supabase.co`;

const contenido = `/*
 * TABA — configuración de despliegue PRODUCTIVA.
 *
 * Generado por scripts/build-production-runtime-config.mjs. No editar a mano:
 * el ref, la URL y el negocio se derivan y se verifican, y el archivo escrito a
 * mano es exactamente donde entra un ref de staging.
 *
 * No contiene ningún secreto: la clave es publicable y está pensada para viajar
 * en el navegador. La autoridad sigue siendo RLS, no esta clave.
 */
globalThis.__LA_TABA_RUNTIME_CONFIG__ = {
  mode: 'production',
  repository: {
    provider: 'supabase',
    deploymentEnvironment: 'production',
    supabaseUrl: '${supabaseUrl}',
    publishableKey: '${key}',
    businessId: '${businessId}',
    pollMs: ${pollMs},
  },
};
`;

// --- 5 · releerlo con el mismo resolutor que usa el navegador ---
//
// No alcanza con haber escrito los campos correctos: lo que decide si el
// paquete arranca en modo produccion es `resolveRuntimeConfig`, y los
// centinelas de `check-runtime-config.mjs` son los que ya frenaron una
// plantilla sin editar que pasaba la validacion de FORMA. Se corren los dos
// sobre lo que se acaba de generar, antes de dejarlo tocar el disco.
const temporal = path.join(root, `.runtime-config.candidato.${process.pid}.js`);
fs.writeFileSync(temporal, contenido, 'utf8');

let veredicto;
try {
  const { checkRuntimeConfig } = await import(
    pathToFileURL(path.join(root, 'scripts/check-runtime-config.mjs')).href
  );
  veredicto = await checkRuntimeConfig(temporal);
} finally {
  fs.rmSync(temporal, { force: true });
}

if (!veredicto.ok) {
  console.error('El config generado no pasa el gate de despliegue:');
  for (const e of veredicto.errors) console.error(`- ${e}`);
  process.exit(1);
}
if (veredicto.environment !== 'production') {
  console.error(`El config generado resolvio como entorno ${veredicto.environment}, no production.`);
  process.exit(1);
}
if (veredicto.supabaseHost !== `${ref}.supabase.co`) {
  console.error(`El config generado apunta a ${veredicto.supabaseHost}, no al proyecto productivo.`);
  process.exit(1);
}

const digest = crypto.createHash('sha256').update(contenido, 'utf8').digest('hex');

if (out) {
  const destino = path.resolve(out);
  fs.mkdirSync(path.dirname(destino), { recursive: true });
  fs.writeFileSync(destino, contenido, 'utf8');
  console.log(`runtime-config productivo escrito en ${out}`);
} else {
  process.stdout.write(contenido);
}

console.error(`  entorno   : ${veredicto.environment}`);
console.error(`  host      : ${veredicto.supabaseHost}`);
console.error(`  negocio   : ${veredicto.businessId}`);
console.error(`  clave     : ${veredicto.keyFingerprint}`);
console.error(`  sha256    : ${digest}`);
console.error(`  bytes     : ${Buffer.byteLength(contenido, 'utf8')}`);
