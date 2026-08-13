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
import test from 'node:test';

const FORMATO = {
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
  timeZone: 'America/Argentina/Buenos_Aires',
};

test('el defecto de es-AR realmente confundía las dos horas', () => {
  // El control del hallazgo: si esto dejara de ser cierto en una versión futura
  // de Node/ICU, el arreglo seguiría siendo correcto pero la justificación
  // cambiaría, y conviene enterarse.
  const noche = new Date('2026-08-12T21:30:00-03:00').toLocaleString('es-AR');
  const mañana = new Date('2026-08-12T09:30:00-03:00').toLocaleString('es-AR');
  assert.equal(noche, mañana, 'el patrón por defecto imprime 21:30 igual que 09:30');
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
});
