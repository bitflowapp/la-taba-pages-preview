// La hora que el Panel muestra no puede ser ambigua (F33).
//
// POR QUÉ EXISTE ESTE ARCHIVO
// ---------------------------
// El único formateador de fecha del Panel era:
//
//     date.toLocaleString('es-AR')
//
// sin opciones. El patrón por defecto de ese locale es de 12 horas y NO agrega
// marca de a.m./p.m., así que las 21:30 se imprimían «09:30:00»: exactamente
// igual que las 09:30 de la mañana. No era «ambiguo» en abstracto: era el
// mismo texto para dos horas distintas.
//
// Dónde se lee: la tarjeta de pago de Mercado Pago del Panel («Cuándo»), que es
// contra lo que el operador concilia la plata del turno.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import test from 'node:test';

/*
 * La zona del comercio, escrita una vez. El Panel lo lee un operador en
 * Neuquén: la hora que muestra es la de Argentina, la corra quien la corra y
 * desde donde la corra.
 */
const PANEL_TIMEZONE = 'America/Argentina/Buenos_Aires';

const FORMATO = {
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
  timeZone: PANEL_TIMEZONE,
};

const LA_NOCHE = '2026-08-12T21:30:00-03:00';
const LA_MAÑANA = '2026-08-12T09:30:00-03:00';

test('el defecto de es-AR realmente confundía las dos horas', () => {
  /*
   * El control del hallazgo: si esto dejara de ser cierto en una versión futura
   * de Node/ICU, el arreglo seguiría siendo correcto pero la justificación
   * cambiaría, y conviene enterarse.
   *
   * La zona va DECLARADA aunque el defecto que demuestra no sea de zona. Sin
   * declararla, esta prueba leía la del aparato que la corre: en Argentina las
   * dos horas caían el mismo día y el defecto se veía; en un runner UTC caen en
   * días distintos —00:30 del 13 contra 12:30 del 12—, así que los textos
   * diferían por el calendario y no por la ambigüedad de las 12 horas, y la
   * prueba fallaba anunciando que el defecto histórico no existía. Lo único que
   * este control tiene que variar es el formato; la zona es del producto.
   */
  const noche = new Date(LA_NOCHE).toLocaleString('es-AR', { timeZone: PANEL_TIMEZONE });
  const mañana = new Date(LA_MAÑANA).toLocaleString('es-AR', { timeZone: PANEL_TIMEZONE });
  assert.equal(noche, mañana, 'el patrón por defecto imprime 21:30 igual que 09:30');
  assert.match(noche, /9:30/, 'y lo imprime como una hora de la mañana');
});

test('la hora del Panel no depende del huso del aparato que la formatea', () => {
  /*
   * La regresión de esta reparación. Se formatea el mismo instante bajo cuatro
   * husos —el del runner, el del comercio, uno al oeste y uno al este del
   * cambio de día— y las cuatro salidas tienen que ser el mismo texto.
   *
   * Se corre en procesos aparte porque `TZ` se lee una sola vez, al arrancar:
   * cambiar `process.env.TZ` a mitad de un proceso no mueve el formateador.
   */
  const guion = `
    const FORMATO = ${JSON.stringify(FORMATO)};
    process.stdout.write(new Date(${JSON.stringify(LA_NOCHE)}).toLocaleString('es-AR', FORMATO));
  `;
  const husos = ['UTC', PANEL_TIMEZONE, 'Pacific/Auckland', 'America/Los_Angeles'];
  const salidas = husos.map((TZ) => execFileSync(process.execPath, ['-e', guion], {
    encoding: 'utf8',
    env: { ...process.env, TZ },
  }));

  assert.equal(
    new Set(salidas).size,
    1,
    `el huso del aparato cambió la hora del Panel: ${husos.map((tz, i) => `${tz}→${salidas[i]}`).join(' · ')}`,
  );
  assert.match(salidas[0], /12\/08\/2026/);
  assert.match(salidas[0], /21:30/, 'las 21:30 de Argentina se muestran como 21:30');
});

test('con el formato del Panel, la noche y la mañana se distinguen', () => {
  const noche = new Date('2026-08-12T21:30:00-03:00').toLocaleString('es-AR', FORMATO);
  const mañana = new Date('2026-08-12T09:30:00-03:00').toLocaleString('es-AR', FORMATO);
  assert.notEqual(noche, mañana);
  assert.match(noche, /21:30/);
  assert.match(mañana, /09:30/);
});

test('la medianoche cae en el día correcto de Argentina', () => {
  // Un pedido de las 00:15 pertenece al día siguiente, y con la zona explícita
  // lo dice aunque el aparato del operador esté en otro huso.
  const salida = new Date('2026-08-13T00:15:00-03:00').toLocaleString('es-AR', FORMATO);
  assert.match(salida, /13\/08\/2026/);
  assert.match(salida, /00:15/);
});

test('el Panel usa ese formato y no el patrón por defecto', async () => {
  const fs = await import('node:fs');
  const url = new URL('../js/business/business-panel-render.js', import.meta.url);
  const fuente = fs.readFileSync(url, 'utf8');
  const bloque = fuente.match(/function formatTimestamp\(value\) \{[\s\S]*?\n\}/);
  assert.ok(bloque, 'no se encontró formatTimestamp');
  assert.match(bloque[0], /PANEL_TIMESTAMP_FORMAT/);
  // Y el formato tiene las dos piezas que importan.
  assert.match(fuente, /hourCycle: 'h23'/);
  assert.match(fuente, /timeZone: PANEL_TIMEZONE/);
  assert.match(fuente, /PANEL_TIMEZONE = 'America\/Argentina\/Buenos_Aires'/);
  assert.ok(fuente.includes(`'${PANEL_TIMEZONE}'`), 'la zona del Panel y la de esta prueba tienen que ser la misma');
  // Sin zona declarada, el Panel mostraría la hora del aparato del operador y
  // no la del comercio: es el mismo defecto que esta reparación saca del test.
  assert.doesNotMatch(bloque[0], /toLocaleString\('es-AR'\)/);
});
