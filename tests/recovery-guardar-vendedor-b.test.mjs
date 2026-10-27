// Entrada oculta de las credenciales del vendedor B de prueba (R-MKT-1): reglas de teclado, validación y flujo de guardado.
// Todo con terminales y almacenes falsos: sin Windows, sin red, sin credenciales reales. Los valores son inventados.
import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { describirTexto, nuevoEstado, pedir, procesar, validarClave, validarId, validarUsuario } from '../scripts/recovery/entrada-oculta.mjs';
import { ejecutar, NOMBRE_PRINCIPAL, NOMBRE_RESERVA, OWNER_INTEGRADORA } from '../scripts/recovery/guardar-vendedor-b.mjs';

const CLAVE = 'clave-falsa-Xk93!';
const APODO = 'TESTUSER0000000000001';
const ID_B = '3796774164';
const ID_RESERVA = '3796774158';

class TerminalFalsa extends EventEmitter {
  isTTY = true;
  raw = false;
  constructor(entregas) { super(); this.entregas = [...entregas]; }
  setRawMode(valor) {
    this.raw = valor;
    if (valor && this.entregas.length) {
      const chunks = this.entregas.shift();
      setImmediate(() => { for (const chunk of [].concat(chunks)) this.emit('data', chunk); });
    }
  }
  resume() {}
  pause() {}
  setEncoding() {}
}
const salidaFalsa = () => { const partes = []; return { write: (t) => { partes.push(String(t)); return true; }, texto: () => partes.join('') }; };

test('el fallo original: un id pegado con CR+LF no responde en blanco la pregunta siguiente', async () => {
  // Un único chunk "id\r\n" y después el usuario. Antes, el \n llegaba al segundo prompt como un Enter y dejaba el usuario vacío.
  const entrada = new TerminalFalsa([[`${ID_B}\r`], ['\n', APODO + '\r']]);
  const salida = salidaFalsa();
  const a = await pedir('id: ', { entrada, salida });
  assert.equal(a.valor, ID_B);
  assert.equal(a.saltarLF, true);
  const b = await pedir('usuario: ', { oculto: true, entrada, salida, saltarLF: a.saltarLF });
  assert.equal(b.valor, APODO);
});

test('un Enter suelto sobre una respuesta vacía se ignora: no devuelve vacío ni falla', async () => {
  const entrada = new TerminalFalsa([['\r', '\r', `${APODO}\r`]]);
  const r = await pedir('usuario: ', { oculto: true, entrada, salida: salidaFalsa() });
  assert.equal(r.valor, APODO);
});

test('lo oculto no se muestra nunca; lo visible se muestra', async () => {
  const oculto = salidaFalsa();
  await pedir('pregunta: ', { oculto: true, entrada: new TerminalFalsa([[`${CLAVE}\r`]]), salida: oculto });
  assert.equal(oculto.texto(), 'pregunta: \n');
  assert.ok(!oculto.texto().includes(CLAVE.slice(0, 4)));
  const visible = salidaFalsa();
  await pedir('id: ', { entrada: new TerminalFalsa([[`${ID_B}\r`]]), salida: visible });
  assert.ok(visible.texto().includes(ID_B));
});

test('el teclado: flechas, marcas de pegado, Ctrl+U, borrar, caracteres invisibles y espacio duro', () => {
  const e = procesar(nuevoEstado(), '\u001b[200~TESTUSER\u001b[201~\u001b[A\u001b[D\u001bOA​12x\u007f3 ');
  assert.equal(e.texto, 'TESTUSER123 ');
  assert.equal(e.terminado, false);
  procesar(e, '\u0015abc\r');
  assert.equal(e.texto, 'abc');
  assert.equal(e.terminado, true);
});

test('Ctrl+C y Ctrl+D cancelan; Ctrl+V pide el portapapeles sin guardarse como texto', async () => {
  assert.equal(procesar(nuevoEstado(), 'ab\u0003').cancelado, true);
  assert.equal(procesar(nuevoEstado(), '\u0004').cancelado, true);
  assert.equal(procesar(nuevoEstado(), 'ab\u0016').pegar, true);
  const r = await pedir('usuario: ', { oculto: true, entrada: new TerminalFalsa([['\u0016', '\r']]), salida: salidaFalsa(), portapapeles: () => APODO });
  assert.equal(r.valor, APODO);
});

test('LF solo también termina la respuesta (terminales que no mandan CR)', () => {
  assert.equal(procesar(nuevoEstado(), 'abc\n').terminado, true);
});

test('validadores: aceptan lo esperado y explican el rechazo sin repetir el valor', () => {
  assert.equal(validarId(` ${ID_B}\r\n`).ok, true);
  assert.equal(validarId('37967741').ok, true);
  assert.equal(validarId('abc').ok, false);
  assert.equal(validarUsuario(APODO).ok, true);
  assert.equal(validarUsuario('testuser_ab-1.x@y').ok, true);
  for (const mala of ['ab', 'con espacio', 'tab\tinterno', 'ñandú', 'x'.repeat(81)]) {
    const v = validarUsuario(mala);
    assert.equal(v.ok, false, mala);
    assert.ok(!v.motivo.includes(mala), 'el motivo no debe repetir el valor');
  }
  assert.equal(validarClave('abc').ok, false);
  assert.equal(validarClave(CLAVE).ok, true);
  assert.ok(!validarClave('abc').motivo.includes('abc'));
  const d = describirTexto('ab 1\u0001é');
  assert.deepEqual({ l: d.letras, d: d.digitos, e: d.espacios, c: d.controles, o: d.otros }, { l: 2, d: 1, e: 1, c: 1, o: 1 });
});

// ---- el flujo completo, con un almacén y una consulta falsos ----
const almacenFalso = (inicial = {}) => {
  const datos = new Map(Object.entries(inicial));
  const llamadas = [];
  return {
    datos, llamadas,
    leer: (n) => (datos.has(n) ? { usuario: 'u', secreto: datos.get(n) } : null),
    guardar: (n, u, s) => { llamadas.push(['guardar', n]); datos.set(n, s); },
    borrar: (n) => { llamadas.push(['borrar', n]); return datos.delete(n); },
  };
};
const cuentaMLA = async (id) => ({ http: 200, id, site_id: 'MLA', country_id: 'AR' });
const correr = async ({ entregas, argv = [], almacen = almacenFalso(), consultarCuenta = cuentaMLA }) => {
  const salida = salidaFalsa();
  const codigo = await ejecutar({ argv, io: { entrada: new TerminalFalsa(entregas), salida }, almacen, consultarCuenta });
  return { codigo, salida: salida.texto(), almacen };
};
const sinSecretos = (texto) => { assert.ok(!texto.includes(CLAVE), 'la salida no debe contener la contraseña'); assert.ok(!texto.includes(APODO), 'la salida no debe contener el usuario'); };

test('guarda, relee y verifica; la salida no contiene ni el usuario ni la contraseña', async () => {
  const { codigo, salida, almacen } = await correr({ entregas: [[`${ID_B}\r\n`], [`${APODO}\r`], [`${CLAVE}\r`]] });
  assert.equal(codigo, 0, salida);
  assert.match(salida, /Guardada y verificada/);
  sinSecretos(salida);
  assert.deepEqual(JSON.parse(almacen.datos.get(NOMBRE_PRINCIPAL)), { id: ID_B, nickname: APODO, password: CLAVE, siteId: 'MLA', profile: 'seller' });
});

test('--reserva guarda con el otro nombre y --id evita preguntar el id', async () => {
  const { codigo, almacen } = await correr({ argv: ['--reserva', '--id', ID_RESERVA], entregas: [[`${APODO}\r`], [`${CLAVE}\r`]] });
  assert.equal(codigo, 0);
  assert.ok(almacen.datos.has(NOMBRE_RESERVA));
  assert.ok(!almacen.datos.has(NOMBRE_PRINCIPAL));
});

test('un usuario inválido se vuelve a pedir y luego se guarda', async () => {
  const { codigo, salida } = await correr({ entregas: [[`${ID_B}\r`], ['con espacio\r'], [`${APODO}\r`], [`${CLAVE}\r`]] });
  assert.equal(codigo, 0, salida);
  assert.match(salida, /No sirve: el usuario admite/);
  sinSecretos(salida);
});

test('rechaza a la dueña de la integradora, un id que no es argentino y un id repetido entre B y su reserva', async () => {
  let r = await correr({ entregas: [[`${OWNER_INTEGRADORA}\r`]] });
  assert.equal(r.codigo, 1);
  assert.match(r.salida, /NO puede ser la dueña/);
  assert.equal(r.almacen.llamadas.length, 0);

  r = await correr({ entregas: [[`${ID_B}\r`]], consultarCuenta: async (id) => ({ http: 200, id, site_id: 'MLB' }) });
  assert.equal(r.codigo, 1);
  assert.match(r.salida, /no figura como cuenta argentina/);

  r = await correr({ argv: ['--reserva'], entregas: [[`${ID_B}\r`]],
    almacen: almacenFalso({ [NOMBRE_PRINCIPAL]: JSON.stringify({ id: ID_B }) }) });
  assert.equal(r.codigo, 1);
  assert.match(r.salida, /deben ser cuentas distintas/);
  assert.equal(r.almacen.llamadas.length, 0);
});

test('no pisa una credencial existente', async () => {
  const r = await correr({ entregas: [], almacen: almacenFalso({ [NOMBRE_PRINCIPAL]: JSON.stringify({ id: ID_B }) }) });
  assert.equal(r.codigo, 1);
  assert.match(r.salida, /Ya existe/);
  assert.equal(r.almacen.llamadas.length, 0);
});

test('si la lectura de verificación no coincide, borra lo escrito y avisa que NO se guardó', async () => {
  const almacen = almacenFalso();
  const guardarOriginal = almacen.guardar;
  almacen.guardar = (n, u, s) => { guardarOriginal(n, u, s.replace(CLAVE, 'otra-cosa')); };
  const r = await correr({ entregas: [[`${ID_B}\r`], [`${APODO}\r`], [`${CLAVE}\r`]], almacen });
  assert.equal(r.codigo, 1);
  assert.match(r.salida, /NO SE GUARDÓ/);
  assert.ok(!almacen.datos.has(NOMBRE_PRINCIPAL));
  assert.ok(almacen.llamadas.some(([accion]) => accion === 'borrar'));
  sinSecretos(r.salida);
});

test('--ensayo valida todo y no guarda nada', async () => {
  const r = await correr({ argv: ['--ensayo'], entregas: [[`${ID_B}\r`], [`${APODO}\r`], [`${CLAVE}\r`]] });
  assert.equal(r.codigo, 0);
  assert.match(r.salida, /No se guardó nada/);
  assert.equal(r.almacen.llamadas.length, 0);
  sinSecretos(r.salida);
});

test('tres respuestas inválidas seguidas terminan sin guardar', async () => {
  const r = await correr({ entregas: [[`${ID_B}\r`], ['a b\r'], ['c d\r'], ['e f\r']] });
  assert.equal(r.codigo, 1);
  assert.match(r.salida, /Demasiados intentos/);
  assert.equal(r.almacen.llamadas.length, 0);
});

test('sin terminal interactiva falla con un mensaje claro y sin guardar', async () => {
  const entrada = new TerminalFalsa([]);
  entrada.isTTY = false;
  const salida = salidaFalsa();
  const almacen = almacenFalso();
  const codigo = await ejecutar({ argv: [], io: { entrada, salida }, almacen, consultarCuenta: cuentaMLA });
  assert.equal(codigo, 1);
  assert.match(salida.texto(), /terminal interactiva/);
  assert.equal(almacen.llamadas.length, 0);
});
