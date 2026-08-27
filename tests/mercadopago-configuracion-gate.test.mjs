/*
 * La compuerta de configuración no puede quedarse atrás de lo que las funciones
 * exigen, y no puede convertirse en una herramienta para adivinar secretos.
 *
 * POR QUÉ EXISTE ESTE ARCHIVO
 * ---------------------------
 * `scripts/mercadopago/verificar-configuracion.mjs` contesta una pregunta
 * operativa —«¿este proyecto puede cobrar, y en qué modo?»— leyendo los
 * SHA-256 que devuelve `supabase secrets list`. De ahí salen dos deudas que un
 * archivo así acumula solo:
 *
 *   1. La lista de secretos requeridos está escrita a mano. El día que una
 *      función agregue un `getRequiredEnv('X')` nuevo, la compuerta va a seguir
 *      diciendo que todo está en orden y la función va a lanzar en el primer
 *      pedido real. La lista tiene que compararse contra el código, no
 *      mantenerse en paralelo.
 *
 *   2. Identificar un valor por su huella es adivinar. Está bien para `test` o
 *      `approved` —enumerables, y que no protegen nada—; sería un ataque de
 *      diccionario contra el propio proyecto si alguien agregara candidatos
 *      para el access token o el webhook secret. La frontera se fija acá.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const GATE = 'scripts/mercadopago/verificar-configuracion.mjs';

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8');
}

/** La lista declarada en la compuerta, leída del guion real. */
function listaDeclarada(nombre) {
  const fuente = read(GATE);
  const match = fuente.match(new RegExp(`const ${nombre} = \\[([^\\]]*)\\]`));
  assert.ok(match, `no se encontró ${nombre} en ${GATE}`);
  return new Set(
    match[1]
      .split(',')
      .map((valor) => valor.trim().replace(/^'|'$/g, ''))
      .filter(Boolean),
  );
}

function archivosDeFunciones() {
  const base = path.join(root, 'supabase/functions');
  const encontrados = [];
  for (const entrada of fs.readdirSync(base, { withFileTypes: true })) {
    const destino = path.join(base, entrada.name);
    if (!entrada.isDirectory()) continue;
    for (const archivo of fs.readdirSync(destino)) {
      if (archivo.endsWith('.ts')) encontrados.push(path.join(destino, archivo));
    }
  }
  return encontrados;
}

/*
 * Supabase inyecta estas tres en TODA función desplegada, sin que nadie las
 * cargue. Aparecen en `secrets list` de staging porque alguien las puso a mano
 * alguna vez, no porque hagan falta: exigirlas haría fallar a un proyecto
 * correctamente configurado.
 */
const INYECTADAS_POR_LA_PLATAFORMA = new Set([
  'SUPABASE_URL',
  'SUPABASE_SERVICE_ROLE_KEY',
  'SUPABASE_ANON_KEY',
]);

/** No es de Mercado Pago: la sirve `fiscal-artifact-access`, con su propia compuerta. */
const AJENAS_AL_PAGO = new Set(['FISCAL_PANEL_ORIGINS']);

test('la compuerta exige todos los secretos que las funciones declaran obligatorios', () => {
  const requeridas = new Set();
  for (const archivo of archivosDeFunciones()) {
    const fuente = fs.readFileSync(archivo, 'utf8');
    for (const match of fuente.matchAll(/getRequiredEnv\('([A-Z0-9_]+)'\)/g)) {
      const nombre = match[1];
      if (INYECTADAS_POR_LA_PLATAFORMA.has(nombre) || AJENAS_AL_PAGO.has(nombre)) continue;
      requeridas.add(nombre);
    }
  }
  assert.ok(requeridas.size > 0, 'no se encontró ningún getRequiredEnv: el lector se rompió');

  const declarados = listaDeclarada('SECRETOS_REQUERIDOS');
  for (const nombre of requeridas) {
    assert.ok(
      declarados.has(nombre),
      `las funciones exigen ${nombre} y la compuerta no lo comprueba: `
      + 'un proyecto sin ese secreto pasaría el gate y lanzaría en el primer pedido real',
    );
  }
});

test('la compuerta exige que estén desplegadas las funciones del circuito de cobro', () => {
  const enElRepositorio = fs.readdirSync(path.join(root, 'supabase/functions'), { withFileTypes: true })
    .filter((entrada) => entrada.isDirectory() && entrada.name.startsWith('mercadopago-'))
    .map((entrada) => entrada.name);

  const requeridas = listaDeclarada('FUNCIONES_REQUERIDAS');
  const opcionales = listaDeclarada('FUNCIONES_OPCIONALES');

  for (const slug of enElRepositorio) {
    assert.ok(
      requeridas.has(slug) || opcionales.has(slug),
      `${slug} existe en el repositorio y la compuerta no la menciona: `
      + 'se puede desplegar de menos sin que nadie lo note, que es como quedó staging',
    );
  }
  // Sin estas cinco no hay circuito: crear sesión, crear preferencia, mirar el
  // estado, recibir el webhook y procesarlo. Que sean requeridas no es una
  // preferencia, es la definición de «puede cobrar».
  for (const slug of [
    'mercadopago-create-checkout-session',
    'mercadopago-create-preference',
    'mercadopago-checkout-status',
    'mercadopago-webhook',
    'mercadopago-payment-worker',
  ]) {
    assert.ok(requeridas.has(slug), `${slug} tiene que ser requerida, no opcional`);
  }
});

test('la compuerta nunca intenta adivinar un secreto de verdad por su huella', () => {
  const fuente = read(GATE);
  const bloque = fuente.match(/const CANDIDATOS = \{([\s\S]*?)\n\};/);
  assert.ok(bloque, 'no se encontró el bloque CANDIDATOS');

  // Identificar por huella sólo es legítimo sobre valores enumerables que no
  // protegen nada. Sobre un token o un secreto de firma sería exactamente un
  // ataque de diccionario, ejecutado por nuestra propia herramienta.
  for (const prohibido of ['MERCADOPAGO_ACCESS_TOKEN', 'MERCADOPAGO_WEBHOOK_SECRET', 'PAYMENT_WORKER_SECRET', 'PAYMENT_LOG_HASH_SALT', 'SUPABASE_SERVICE_ROLE_KEY']) {
    assert.ok(
      !bloque[1].includes(prohibido),
      `CANDIDATOS incluye ${prohibido}: la compuerta se volvió una herramienta para adivinar secretos`,
    );
  }
});

test('la compuerta falla cerrado: sin entorno identificable el veredicto es DISABLED', () => {
  const fuente = read(GATE);
  // El veredicto se deriva de `entorno`, que sólo puede valer 'test',
  // 'production' o null. La rama final tiene que ser DISABLED, no un optimista
  // «asumamos test».
  assert.match(
    fuente,
    /else veredicto = 'DISABLED';/,
    'la última rama del veredicto tiene que ser DISABLED',
  );
  assert.match(
    fuente,
    /if \(problemas\.length\) veredicto = 'DISABLED';/,
    'cualquier problema tiene que forzar DISABLED antes de mirar el entorno',
  );
});

test('la compuerta comprueba que el webhook no exija JWT', () => {
  // Mercado Pago no manda un JWT de Supabase. Con `verify_jwt=true` la
  // plataforma rechaza la notificación antes de que nuestro código la vea: la
  // firma nunca se valida y no queda ni un receipt para darse cuenta.
  assert.match(read(GATE), /verify_jwt === true/);
  assert.match(read(GATE), /mercadopago-webhook tiene verify_jwt=true/);
});

test('la suite del importe corre en el gate de pagos, no sólo a mano', () => {
  // `preferenceRequest()` decide cuánto se le cobra a una persona. Una suite
  // que existe pero que ningún gate ejecuta no protege nada.
  const runner = read('scripts/run-mercadopago-webhook-tests.mjs');
  assert.match(runner, /mercadopago-preference\.deno\.ts/);
  assert.match(
    runner,
    /--allow-env/,
    'la suite del importe fija el entorno del proveedor: sin --allow-env no puede correr',
  );
  assert.ok(
    fs.existsSync(path.join(root, 'supabase/functions/_shared/mercadopago-preference.deno.ts')),
    'el runner nombra una suite que no existe',
  );
});

test('la validación de firma acepta el ts en segundos y en milisegundos', () => {
  // La documentación de Mercado Pago muestra el ejemplo en segundos y describe
  // el mismo campo como milisegundos. La ventana de frescura es NUESTRA: si
  // sólo entendiera una unidad y el proveedor usara la otra, rechazaríamos
  // todos los webhooks legítimos y ningún pago aprobado se finalizaría por esa
  // vía.
  const fuente = read('supabase/functions/_shared/mercadopago-webhook-signature.ts');
  assert.match(fuente, /MILLISECOND_THRESHOLD/);
  assert.match(fuente, /Math\.floor\(timestamp \/ 1000\)/);
  assert.match(fuente, /MIN_PLAUSIBLE_SECONDS/);

  const suite = read('supabase/functions/_shared/mercadopago-webhook-signature.deno.ts');
  assert.match(suite, /acepta ts en segundos y en milisegundos/);
  assert.match(suite, /un ts en milisegundos vencido sigue vencido/);
});
