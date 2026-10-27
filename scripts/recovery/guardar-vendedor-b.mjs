// Stores the login of a QA test seller (R-MKT-1 seller B) in Windows Credential Manager with hidden input.
// A person runs it in their own PowerShell window; nothing typed is echoed, logged or written to a file.
//
//   node scripts/recovery/guardar-vendedor-b.mjs [--id <id>] [--reserva] [--ensayo]
//
//   --id       the numeric id shown by the Mercado Pago panel (not a secret); skips that question
//   --reserva  stores the standby seller under «RECOVERY MP TEST SELLER B RESERVA» instead of the main one
//   --ensayo   asks and validates everything, checks the id with Mercado Pago, stores NOTHING
//
// It only accepts an Argentine account other than the owner of the integrator application TestApp (3594962708) and
// other than the seller already stored under the sibling name. After storing it reads the credential back and compares;
// if that fails it deletes the entry and exits non-zero, so a credential that did not get stored is never reported as stored.
import { pathToFileURL } from 'node:url';
import { borrarSecreto, guardarSecreto, leerSecreto } from '../e2e-production-sale/secretos-windows.mjs';
import { pedir, validarClave, validarId, validarUsuario } from './entrada-oculta.mjs';
import { RECOVERY_TEST_APPLICATION_ID } from './plan.mjs';

export const OWNER_INTEGRADORA = '3594962708';
export const NOMBRE_PRINCIPAL = 'RECOVERY MP TEST SELLER B';
export const NOMBRE_RESERVA = 'RECOVERY MP TEST SELLER B RESERVA';
const INTENTOS = 3;

/** Public read of an account id with the integrator application's own token: it only proves the id exists and is Argentine. */
export async function consultarCuentaMercadoPago(id, { leer = leerSecreto, http = fetch } = {}) {
  const clientSecret = leer('RECOVERY MP TESTAPP CLIENT SECRET')?.secreto;
  if (!clientSecret) throw new Error('No encuentro el secreto de TestApp en el Credential Manager.');
  const grant = await (await http('https://api.mercadopago.com/oauth/token', { method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ grant_type: 'client_credentials', client_id: RECOVERY_TEST_APPLICATION_ID, client_secret: clientSecret }),
    signal: AbortSignal.timeout(15000) })).json();
  if (!grant.access_token) throw new Error('Mercado Pago no entregó el token de la aplicación de pruebas.');
  const r = await http(`https://api.mercadopago.com/users/${id}`, { headers: { Authorization: `Bearer ${grant.access_token}` }, signal: AbortSignal.timeout(15000) });
  const u = await r.json().catch(() => ({}));
  return { http: r.status, id: String(u.id ?? ''), site_id: u.site_id ?? null, country_id: u.country_id ?? null };
}

const almacenReal = { leer: leerSecreto, guardar: guardarSecreto, borrar: borrarSecreto };

async function preguntar(texto, opciones, validar, estado, io) {
  for (let intento = 1; intento <= INTENTOS; intento += 1) {
    const r = await (io.pedir ?? pedir)(texto, { ...opciones, entrada: io.entrada, salida: io.salida, saltarLF: estado.saltarLF,
      ...(io.portapapeles ? { portapapeles: io.portapapeles } : {}) });
    estado.saltarLF = r.saltarLF;
    if (r.cancelado) throw new Error('Cancelado.');
    const v = validar(r.valor);
    if (v.ok) return v.valor;
    io.salida.write(`  No sirve: ${v.motivo}. (${intento}/${INTENTOS})\n`);
  }
  throw new Error('Demasiados intentos inválidos; no se guardó nada.');
}

/** Returns the process exit code. All side effects are injected so the flow can be tested without Windows or the network. */
export async function ejecutar({ argv = [], io, almacen = almacenReal, consultarCuenta = consultarCuentaMercadoPago } = {}) {
  const salida = io.salida;
  const reserva = argv.includes('--reserva');
  const ensayo = argv.includes('--ensayo');
  const nombre = reserva ? NOMBRE_RESERVA : NOMBRE_PRINCIPAL;
  const hermano = reserva ? NOMBRE_PRINCIPAL : NOMBRE_RESERVA;
  try {
    if (!ensayo && almacen.leer(nombre)?.secreto) {
      salida.write(`Ya existe «${nombre}». No la piso. Si querés reemplazarla, borrala primero del Credential Manager.\n`);
      return 1;
    }
    const estado = { saltarLF: false };
    const idArg = argv.includes('--id') ? argv[argv.indexOf('--id') + 1] : null;
    let id;
    if (idArg) {
      const v = validarId(idArg);
      if (!v.ok) throw new Error(`--id: ${v.motivo}`);
      id = v.valor;
    } else {
      id = await preguntar('ID numérico del vendedor (visible en el panel): ', { oculto: false }, validarId, estado, io);
    }
    if (id === OWNER_INTEGRADORA) throw new Error('El vendedor B NO puede ser la dueña de la integradora (3594962708).');
    const otro = almacen.leer(hermano)?.secreto;
    if (otro) {
      let otroId = null;
      try { otroId = String(JSON.parse(otro).id); } catch { /* unreadable sibling: nothing to compare */ }
      if (otroId === id) throw new Error(`Ese id ya está guardado como «${hermano}»: B y su reserva deben ser cuentas distintas.`);
    }
    const cuenta = await consultarCuenta(id);
    if (cuenta.http !== 200 || cuenta.id !== id || cuenta.site_id !== 'MLA') {
      throw new Error(`El id ${id} no figura como cuenta argentina en Mercado Pago (http ${cuenta.http}, sitio ${cuenta.site_id ?? 'desconocido'}).`);
    }
    salida.write(`Mercado Pago reconoce la cuenta ${id} (sitio MLA).\n`);
    const apodo = await preguntar('Usuario / nickname de esa cuenta (oculto): ', { oculto: true }, validarUsuario, estado, io);
    const clave = await preguntar('Contraseña de esa cuenta (oculta): ', { oculto: true }, validarClave, estado, io);
    salida.write(`Recibí usuario de ${apodo.length} caracteres y contraseña de ${clave.length} caracteres.\n`);
    if (ensayo) {
      salida.write('ENSAYO: los datos son válidos. No se guardó nada.\n');
      return 0;
    }
    const secreto = JSON.stringify({ id, nickname: apodo, password: clave, siteId: 'MLA', profile: 'seller' });
    almacen.guardar(nombre, apodo, secreto);
    // Read it back: a credential that did not get stored is never reported as stored.
    let leido = null;
    try { leido = JSON.parse(almacen.leer(nombre)?.secreto ?? 'null'); } catch { leido = null; }
    if (!leido || leido.id !== id || leido.nickname !== apodo || leido.password !== clave || leido.profile !== 'seller') {
      almacen.borrar(nombre);
      salida.write(`NO SE GUARDÓ «${nombre}»: la lectura de verificación no coincide (se borró lo escrito).\n`);
      return 1;
    }
    salida.write(`Guardada y verificada «${nombre}» para el id ${id} (MLA). Nada se escribió en archivos.\n`);
    return 0;
  } catch (error) {
    salida.write(`NO SE GUARDÓ NADA: ${String(error?.message || error)}\n`);
    return 1;
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  process.exitCode = await ejecutar({ argv: process.argv.slice(2), io: { entrada: process.stdin, salida: process.stdout } });
}
