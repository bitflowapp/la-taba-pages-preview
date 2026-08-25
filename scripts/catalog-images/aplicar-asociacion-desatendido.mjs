/*
 * La misma puerta que `aplicar-asociacion.ps1`, con la llave que NO la tiene una
 * persona.
 *
 * POR QUÉ EXISTE, SI YA HABÍA UN ENVOLTORIO
 * -----------------------------------------
 * El envoltorio de PowerShell pide correo y contraseña por teclado. Eso está
 * bien cuando quien asocia es el dueño: su contraseña es suya y no vive en
 * ningún lado. Pero el lote de fotografías también se aplica desde corridas sin
 * nadie mirando, y para eso este repositorio ya tiene una identidad dedicada
 * —`business-operator`, rol `admin`, contraseña generada por la máquina y
 * guardada en el Credential Manager de Windows— creada exactamente para que la
 * automatización no use la cuenta personal de nadie.
 *
 * Lo que cambia acá es UNA sola cosa: de dónde sale la contraseña. Todo lo
 * demás es idéntico, y a propósito:
 *
 *   · el mismo preflight sin credenciales, y el mismo ensayo en seco antes de
 *     pedir nada;
 *   · el mismo endpoint público de Auth, con la clave publicable que el sitio
 *     ya le entrega a cualquier navegador;
 *   · el mismo `apply-association.mjs`, que recibe un JWT por STDIN y hace por
 *     su cuenta la comprobación de rol, el eco campo por campo y la relectura;
 *   · la misma revocación del token al terminar, pase lo que pase.
 *
 * NO es una ruta alternativa: es la misma ruta con otro portador de la llave.
 * La autoridad la sigue dando la base —`identity_member_role` sobre
 * `['owner','admin']`—, no este archivo.
 *
 * POR QUÉ `admin` Y NO `owner`
 * ----------------------------
 * Porque las cinco RPC de catálogo aceptan las dos por contrato, está escrito y
 * probado en `owner-authority.mjs`, y `admin` es el rol más acotado que alcanza:
 * lo único que no puede es promover a otro owner, que es justamente la
 * diferencia que conviene conservar en una corrida automática.
 *
 * QUÉ NO HACE ESTE ARCHIVO, NUNCA
 * -------------------------------
 * No imprime la contraseña, ni el token, ni un pedazo de ninguno de los dos. No
 * los escribe en disco, no los pasa por argumento —la línea de comandos de un
 * proceso la lee cualquiera en la misma máquina— y no los deja en una variable
 * de entorno. La contraseña va del Credential Manager al cuerpo del pedido; el
 * token va por un tubo al proceso hijo.
 *
 *   node scripts/catalog-images/aplicar-asociacion-desatendido.mjs [--solo-ensayo]
 */
import { spawn, spawnSync } from 'node:child_process';
import path from 'node:path';
import process from 'node:process';
import { correoDelPanel, IDENTIDAD_PANEL } from '../e2e-production-sale/identidades.mjs';
import { leerSecreto, objetivoCompleto } from '../e2e-production-sale/secretos-windows.mjs';

const ROOT = path.resolve(import.meta.dirname, '../..');
const REF = 'wwcpogltfgzgkrlilbcd';
const BASE = `https://${REF}.supabase.co`;
const ORIGEN_PUBLICO = process.env.TABA_PUBLIC_ORIGIN || 'https://la-taba.pages.dev';
const soloEnsayo = process.argv.includes('--solo-ensayo');

const paso = (t) => console.log(`\n── ${t}`);
const ok = (t) => console.log(`  OK    ${t}`);
const info = (t) => console.log(`        ${t}`);

function abortar(mensaje) {
  console.error(`\nABORTA: ${mensaje}`);
  process.exit(1);
}

/** Corre un guion del repositorio heredando la salida. Devuelve su código. */
function correr(guion, argumentos = []) {
  const r = spawnSync(process.execPath, [guion, ...argumentos], { cwd: ROOT, stdio: 'inherit' });
  return r.status ?? 1;
}

// ── 1. Todo lo que se puede comprobar sin credencial ─────────────────────────
paso('PREFLIGHT SIN CREDENCIALES');
if (correr('scripts/catalog-images/preflight-association.mjs') !== 0) {
  abortar('el preflight falló. No se lee ninguna contraseña.');
}
if (correr('scripts/catalog-images/apply-association.mjs', ['--dry-run']) !== 0) {
  abortar('el ensayo en seco falló. No se lee ninguna contraseña.');
}
ok('preflight y ensayo en seco, los dos verdes');

if (soloEnsayo) {
  paso('SÓLO ENSAYO · no se autentica ni se escribe nada');
  process.exit(0);
}

// ── 2. La clave publicable, del sitio publicado ──────────────────────────────
paso('DESTINO');
const respuestaConfig = await fetch(`${ORIGEN_PUBLICO}/runtime-config.js`, {
  signal: AbortSignal.timeout(30_000),
});
if (!respuestaConfig.ok) abortar(`runtime-config.js respondió ${respuestaConfig.status}.`);
const textoConfig = await respuestaConfig.text();
const urlPublicada = textoConfig.match(/supabaseUrl:\s*'([^']+)'/)?.[1];
const apikey = textoConfig.match(/publishableKey:\s*'([^']+)'/)?.[1];
if (!urlPublicada?.includes(REF)) abortar(`el sitio publicado no apunta a ${REF}.`);
if (!apikey || /^(eyJ|sb_secret_|service_role)/.test(apikey)) {
  abortar('la clave publicada por el sitio parece privilegiada. No se usa.');
}
ok(`${BASE} · ref ${REF}`);

// ── 3. La credencial de la máquina ───────────────────────────────────────────
paso('IDENTIDAD');
const correo = correoDelPanel();
const credencial = leerSecreto(IDENTIDAD_PANEL.credencial);
if (!credencial?.secreto) {
  abortar(
    `no hay contraseña guardada en ${objetivoCompleto(IDENTIDAD_PANEL.credencial)}.\n`
    + '        Se aprovisiona con: node scripts/e2e-production-sale/provisionar-identidad-panel.mjs',
  );
}
/*
 * Que la credencial guardada sea de OTRA cuenta no es un detalle: significaría
 * abrir una sesión que nadie previó con una contraseña que nadie revisó. Es la
 * misma comprobación que hace sesiones.mjs antes de entrar al Panel.
 */
if (credencial.usuario && credencial.usuario.toLowerCase() !== correo.toLowerCase()) {
  abortar(`la credencial guardada es de ${credencial.usuario} y el contrato dice ${correo}.`);
}
ok(`${correo} · credencial leída del Credential Manager (rol esperado: ${IDENTIDAD_PANEL.rol})`);

// ── 4. Sesión, aplicación y cierre ───────────────────────────────────────────
paso('SESIÓN');
let token = null;
let salida = 1;
try {
  const login = await fetch(`${BASE}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey, 'content-type': 'application/json' },
    body: JSON.stringify({ email: correo, password: credencial.secreto }),
    signal: AbortSignal.timeout(30_000),
  });
  if (!login.ok) {
    // El cuerpo de error de GoTrue no contiene la contraseña.
    abortar(`Auth respondió ${login.status}: ${await login.text()}`);
  }
  token = (await login.json()).access_token;
  if (!token) abortar('Auth no devolvió access_token.');
  ok('sesión abierta');

  salida = await new Promise((resolver) => {
    const hijo = spawn(process.execPath, ['scripts/catalog-images/apply-association.mjs'], {
      cwd: ROOT,
      // El email viaja como confirmación de que se opera con la cuenta prevista.
      // NO es la autorización: esa la da el rol que devuelve la base.
      env: { ...process.env, TABA_EXPECTED_OWNER_EMAIL: correo },
      stdio: ['pipe', 'inherit', 'inherit'],
    });
    hijo.stdin.end(token);
    hijo.on('close', (codigo) => resolver(codigo ?? 1));
  });
} finally {
  if (token) {
    try {
      await fetch(`${BASE}/auth/v1/logout`, {
        method: 'POST',
        headers: { apikey, authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(30_000),
      });
      info('sesión cerrada (token revocado)');
    } catch (error) {
      info(`no pude revocar el token: ${error.message}. Caduca solo en una hora.`);
    }
    token = null;
  }
}

console.log('');
if (salida === 0) ok('las asociaciones quedaron aplicadas y releídas.');
else console.error(`TERMINÓ CON ERRORES (código ${salida}). Leé la salida de arriba.`);
process.exit(salida);
