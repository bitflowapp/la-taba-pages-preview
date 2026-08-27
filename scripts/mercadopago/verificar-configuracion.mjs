/*
 * ¿PUEDE ESTE PROYECTO COBRAR CON MERCADO PAGO, Y EN QUÉ MODO?
 *
 *   node scripts/mercadopago/verificar-configuracion.mjs --ref=produccion
 *   node scripts/mercadopago/verificar-configuracion.mjs --ref=staging --esperado=test
 *
 * POR QUÉ EXISTE
 * --------------
 * La respuesta vivía repartida en tres lugares que nadie mira junta: los
 * secretos del proyecto, las funciones desplegadas y la fila de
 * `business_payment_settings`. Cada uno puede estar bien por su cuenta y el
 * conjunto seguir sin poder cobrar —o, peor, ofrecer Mercado Pago en el
 * selector y romperse recién cuando alguien toca «Pagar»—.
 *
 * Esto lo contesta de una sola vez, y lo contesta SIN VER NINGÚN SECRETO.
 *
 * CÓMO SE MIRA UNA CONFIGURACIÓN SIN LEERLA
 * -----------------------------------------
 * `supabase secrets list` no devuelve valores: devuelve el SHA-256 de cada uno.
 * Eso alcanza para dos cosas distintas, y la diferencia importa:
 *
 *   · Un secreto de ALTA entropía —el access token, el webhook secret— queda
 *     opaco. Su huella no se puede revertir. Lo único que se aprende es que
 *     está puesto, que es exactamente lo que hace falta saber.
 *
 *   · Un valor ENUMERABLE —`test` / `production`, `approved`, una URL pública—
 *     tiene un puñado de candidatos posibles. Se digiere cada candidato y se
 *     compara. Si coincide, quedó IDENTIFICADO sin que el valor viaje nunca.
 *
 * Esa asimetría es la característica: se puede afirmar «este proyecto está en
 * modo test» con evidencia, sin poder afirmar nada sobre el token. Un valor
 * enumerable no era un secreto para empezar —`test` no protege nada—; el
 * secreto real sigue sin salir del proyecto.
 *
 * QUÉ NO HACE
 * -----------
 * No toca la base, no despliega, no escribe. Es sólo de lectura y, si algo no
 * se puede establecer, FALLA CERRADO: «no sé» se informa como no habilitado,
 * nunca como habilitado.
 *
 * CÓDIGOS DE SALIDA
 *   0  el veredicto se pudo establecer (y coincide con --esperado, si se pasó)
 *   1  configuración incoherente, o el veredicto no coincide con --esperado
 *   2  error de uso o el CLI de Supabase no pudo responder
 */
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import process from 'node:process';

const REFS = {
  staging: { ref: 'ukxqbgswjlibmnjemrzd', nombre: 'la-taba-staging' },
  produccion: { ref: 'wwcpogltfgzgkrlilbcd', nombre: 'la-taba-production' },
};

/** Las funciones sin las cuales Checkout Pro no es un circuito completo. */
const FUNCIONES_REQUERIDAS = [
  'mercadopago-create-checkout-session',
  'mercadopago-create-preference',
  'mercadopago-checkout-status',
  'mercadopago-webhook',
  'mercadopago-payment-worker',
];

/*
 * Estas dos existen en el repositorio y sostienen el circuito de plata que
 * vuelve: reembolso y cancelación. Un piloto puede arrancar sin ellas —el
 * Panel las necesita recién cuando hay que devolver un pago—, así que no
 * bloquean el veredicto, pero se informan: desplegar cinco de siete y creer
 * que está completo es como quedó staging.
 */
const FUNCIONES_OPCIONALES = ['mercadopago-refund', 'mercadopago-cancel-payment'];

/** Secretos sin los cuales las funciones lanzan al primer pedido. */
const SECRETOS_REQUERIDOS = [
  'MERCADOPAGO_ACCESS_TOKEN',
  'MERCADOPAGO_ENVIRONMENT',
  'MERCADOPAGO_WEBHOOK_SECRET',
  'PAYMENT_LOG_HASH_SALT',
  'PAYMENT_WORKER_SECRET',
  'TABA_CHECKOUT_BASE_URL',
];

/** Presentes o no, nunca bloquean: cambian el modo, no la posibilidad. */
const SECRETOS_DE_MODO = [
  'MERCADOPAGO_PRODUCTION_REVIEW_STATUS',
  'MERCADOPAGO_REAL_PAYMENT_SMOKE_CONFIRMATION',
  'TABA_ALLOWED_ORIGINS',
];

/*
 * Candidatos para identificar valores enumerables por su huella. Sólo van acá
 * cosas que NO son secretas: constantes del contrato y hosts públicos. Nunca
 * un token, nunca una contraseña; adivinar un secreto real por fuerza bruta no
 * es lo que esta herramienta hace ni tiene que poder hacer.
 */
const CANDIDATOS = {
  MERCADOPAGO_ENVIRONMENT: ['test', 'production'],
  MERCADOPAGO_PRODUCTION_REVIEW_STATUS: ['not_requested', 'pending', 'approved', 'rejected'],
  MERCADOPAGO_REAL_PAYMENT_SMOKE_CONFIRMATION: ['I_AUTHORIZE_REAL_MERCADOPAGO_PAYMENT_SMOKE'],
  TABA_CHECKOUT_BASE_URL: [
    'https://la-taba.pages.dev',
    'https://la-taba.pages.dev/',
    'https://bitflowapp.github.io/la-taba-pages-preview',
  ],
};

const banderas = new Map();
for (const argumento of process.argv.slice(2)) {
  if (!argumento.startsWith('--')) continue;
  const corte = argumento.indexOf('=');
  if (corte === -1) banderas.set(argumento.slice(2), true);
  else banderas.set(argumento.slice(2, corte), argumento.slice(corte + 1));
}

const nombreRef = String(banderas.get('ref') || '');
const objetivo = REFS[nombreRef];
if (!objetivo) {
  console.error(`ABORTAR: --ref debe ser uno de: ${Object.keys(REFS).join(', ')}`);
  process.exit(2);
}
const esperado = String(banderas.get('esperado') || '').toLowerCase();
if (esperado && !['disabled', 'test', 'production'].includes(esperado)) {
  console.error('ABORTAR: --esperado debe ser disabled, test o production');
  process.exit(2);
}

function huella(valor) {
  return createHash('sha256').update(valor, 'utf8').digest('hex');
}

function cli(argumentos) {
  try {
    return JSON.parse(execFileSync('supabase', [...argumentos, '-o', 'json'], {
      encoding: 'utf8',
      maxBuffer: 8 << 20,
      stdio: ['ignore', 'pipe', 'pipe'],
    }));
  } catch (error) {
    console.error(`ABORTAR: el CLI de Supabase no pudo responder a «${argumentos.join(' ')}».`);
    console.error(String(error?.stderr || error?.message || '').split('\n')[0]);
    process.exit(2);
  }
}

/** Identifica un valor enumerable por su huella, o devuelve null. */
function identificar(nombre, digest) {
  for (const candidato of CANDIDATOS[nombre] || []) {
    if (huella(candidato) === digest) return candidato;
  }
  return null;
}

const secretosCrudos = cli(['secrets', 'list', '--project-ref', objetivo.ref]);
const listaSecretos = Array.isArray(secretosCrudos) ? secretosCrudos : secretosCrudos.secrets || [];
const secretos = new Map(listaSecretos.map((s) => [String(s.name), String(s.value || '')]));

const funcionesCrudas = cli(['functions', 'list', '--project-ref', objetivo.ref]);
const listaFunciones = Array.isArray(funcionesCrudas) ? funcionesCrudas : funcionesCrudas.functions || [];
const funciones = new Map(listaFunciones.map((f) => [String(f.slug), f]));

const problemas = [];
const advertencias = [];

console.log('MERCADO PAGO — VERIFICACIÓN DE CONFIGURACIÓN');
console.log(`proyecto: ${objetivo.nombre} (${objetivo.ref})`);
console.log('');

console.log('SECRETOS  (se listan nombre y huella; ningún valor sale de acá)');
for (const nombre of SECRETOS_REQUERIDOS) {
  const digest = secretos.get(nombre);
  if (!digest) {
    problemas.push(`falta el secreto ${nombre}`);
    console.log(`  ✗ ${nombre.padEnd(44)} AUSENTE`);
    continue;
  }
  const identificado = identificar(nombre, digest);
  const detalle = identificado ? `= «${identificado}»` : `huella ${digest.slice(0, 12)}…`;
  console.log(`  ✓ ${nombre.padEnd(44)} presente   ${detalle}`);
}
for (const nombre of SECRETOS_DE_MODO) {
  const digest = secretos.get(nombre);
  if (!digest) {
    console.log(`  · ${nombre.padEnd(44)} sin definir`);
    continue;
  }
  const identificado = identificar(nombre, digest);
  const detalle = identificado ? `= «${identificado}»` : `huella ${digest.slice(0, 12)}…`;
  console.log(`  · ${nombre.padEnd(44)} presente   ${detalle}`);
}
console.log('');

/*
 * El modo. Se decide por la huella de MERCADOPAGO_ENVIRONMENT, que es lo mismo
 * que lee `providerEnvironment()` dentro de las funciones. Si la huella no
 * coincide con ninguno de los dos valores que el contrato admite, el modo es
 * DESCONOCIDO y eso ya es un problema: las funciones van a lanzar al arrancar.
 */
const digestEntorno = secretos.get('MERCADOPAGO_ENVIRONMENT') || '';
let entorno = digestEntorno ? identificar('MERCADOPAGO_ENVIRONMENT', digestEntorno) : null;
if (digestEntorno && !entorno) {
  problemas.push('MERCADOPAGO_ENVIRONMENT no es «test» ni «production»: las funciones fallan al arrancar');
}

const revision = secretos.has('MERCADOPAGO_PRODUCTION_REVIEW_STATUS')
  ? identificar('MERCADOPAGO_PRODUCTION_REVIEW_STATUS', secretos.get('MERCADOPAGO_PRODUCTION_REVIEW_STATUS'))
  : null;

console.log('MODO DECLARADO POR EL PROYECTO');
console.log(`  entorno del proveedor .......... ${entorno || 'DESCONOCIDO'}`);
console.log(`  revisión de producción ......... ${revision || 'sin declarar'}`);
if (entorno === 'production' && revision !== 'approved') {
  // Es exactamente la guarda de `providerEnvironment()`. Un proyecto que se
  // declara productivo sin la revisión aprobada no cobra: lanza.
  problemas.push('el entorno es «production» pero MERCADOPAGO_PRODUCTION_REVIEW_STATUS no es «approved»');
}
console.log('');

console.log('FUNCIONES DESPLEGADAS');
for (const slug of FUNCIONES_REQUERIDAS) {
  const funcion = funciones.get(slug);
  if (!funcion) {
    problemas.push(`la función ${slug} no está desplegada`);
    console.log(`  ✗ ${slug.padEnd(44)} NO DESPLEGADA`);
    continue;
  }
  const estado = String(funcion.status || '').toUpperCase();
  if (estado !== 'ACTIVE') problemas.push(`la función ${slug} está en estado ${estado}`);
  console.log(`  ✓ ${slug.padEnd(44)} v${String(funcion.version || '?').padEnd(4)} ${estado} verify_jwt=${funcion.verify_jwt}`);
}
for (const slug of FUNCIONES_OPCIONALES) {
  const funcion = funciones.get(slug);
  if (!funcion) {
    advertencias.push(`la función ${slug} no está desplegada: el circuito de devoluciones queda incompleto`);
    console.log(`  · ${slug.padEnd(44)} no desplegada (devoluciones)`);
    continue;
  }
  console.log(`  · ${slug.padEnd(44)} v${String(funcion.version || '?').padEnd(4)} ${String(funcion.status || '').toUpperCase()} verify_jwt=${funcion.verify_jwt}`);
}

/*
 * El webhook lo llama Mercado Pago, que no manda un JWT de Supabase. Con
 * `verify_jwt=true` la plataforma rechaza la notificación ANTES de que nuestro
 * código la vea: la firma nunca se valida, el pago nunca se finaliza y no queda
 * ni un receipt para darse cuenta. La autenticidad la decide el HMAC, no el JWT.
 */
const webhook = funciones.get('mercadopago-webhook');
if (webhook && webhook.verify_jwt === true) {
  problemas.push('mercadopago-webhook tiene verify_jwt=true: Mercado Pago no manda JWT y toda notificación sería rechazada');
}
console.log('');

let veredicto;
if (problemas.length) veredicto = 'DISABLED';
else if (entorno === 'production') veredicto = 'PRODUCTION';
else if (entorno === 'test') veredicto = 'TEST';
else veredicto = 'DISABLED';

console.log(`VEREDICTO: ${veredicto}`);
if (veredicto === 'DISABLED') {
  console.log('  Este proyecto NO puede cobrar con Mercado Pago. Motivos:');
  for (const problema of problemas) console.log(`    - ${problema}`);
  if (!problemas.length) console.log('    - no hay un entorno de proveedor declarado');
}
if (veredicto === 'TEST') {
  console.log('  Cobra únicamente con credenciales de prueba. Ningún pago es real.');
}
if (veredicto === 'PRODUCTION') {
  const smoke = secretos.has('MERCADOPAGO_REAL_PAYMENT_SMOKE_CONFIRMATION')
    ? identificar('MERCADOPAGO_REAL_PAYMENT_SMOKE_CONFIRMATION', secretos.get('MERCADOPAGO_REAL_PAYMENT_SMOKE_CONFIRMATION'))
    : null;
  console.log('  ATENCIÓN: los pagos de este proyecto son REALES.');
  console.log(`  prueba de humo con plata real autorizada: ${smoke ? 'SÍ' : 'no'}`);
}
for (const advertencia of advertencias) console.log(`  aviso: ${advertencia}`);

/*
 * Recordatorio deliberado. Este guion mira el PROYECTO; la última compuerta la
 * pone la base, en `business_payment_settings`, y puede tener apagado lo que
 * acá está listo. Las dos tienen que decir que sí.
 */
console.log('');
console.log('Falta comprobar aparte: la fila de business_payment_settings del comercio');
console.log('(enabled, collector_id, application_id, production_review_status). Un proyecto');
console.log('configurado con esa fila apagada sigue sin ofrecer Mercado Pago, y está bien.');

if (esperado && veredicto.toLowerCase() !== esperado) {
  console.error('');
  console.error(`FALLA: se esperaba ${esperado.toUpperCase()} y el veredicto es ${veredicto}.`);
  process.exit(1);
}
process.exit(problemas.length && !esperado ? 1 : 0);
