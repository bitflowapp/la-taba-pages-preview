import assert from 'node:assert/strict';
import test from 'node:test';

import { auditEncoding, findEncodingProblems } from '../scripts/check-sql-encoding.mjs';

const problemsOf = (text) => findEncodingProblems('sample.sql', Buffer.from(text, 'utf8')).map(({ problem }) => problem);

test('las migraciones, las pruebas SQL y lo adoptado del core fiscal estan en UTF-8 limpio', () => {
  const { files, problems } = auditEncoding();
  assert.ok(files > 150, `alcance demasiado chico: ${files}`);
  assert.deepEqual(problems, []);
});

test('un BOM al principio se rechaza (rompe el parser via driver: syntax error at or near \\ufeff)', () => {
  const withBom = Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from('select 1;\n')]);
  assert.deepEqual(findEncodingProblems('m.sql', withBom).map(({ problem }) => problem), ['bom']);
  assert.deepEqual(problemsOf('select 1;\n-- pegado ﻿en el medio\n'), ['zero-width-no-break-space']);
});

test('el mojibake de las copias historicas del core (UTF-8 releido como CP437) se rechaza', () => {
  // Muestras textuales de bitflowapp/taba-fiscal database/migrations, escritas con escapes.
  for (const sample of [
    'Impresi├│n del mostrador',     // ó
    'el gate anterior hab├¡a fundido', // í
    'RG 5616 ┬╖ Condici├│n', // · y ó
    'notas de cr├⌐dito',             // é
    'NO ALCANZA CON ┬½RLS',          // «
    'factura ΓÇö recibo',       // — (CP437)
    'factura ÔÇö recibo',       // — (CP850)
    'pedido ΓåÆ cola',          // → (CP437)
  ]) assert.deepEqual(problemsOf(`-- ${sample}\n`), ['mojibake'], sample);
});

test('el mojibake de Windows-1252/Latin-1 tambien se rechaza', () => {
  for (const sample of ['FacturaciÃ³n', 'RG 5616 Â· IVA', 'factura â€” recibo', 'seÃ±a']) {
    assert.deepEqual(problemsOf(`-- ${sample}\n`), ['mojibake'], sample);
  }
});

test('bytes que no son UTF-8, controles y U+FFFD se rechazan', () => {
  assert.deepEqual(findEncodingProblems('latin1.sql', Buffer.from([0x2d, 0x2d, 0x20, 0x65, 0x6e, 0x76, 0xed, 0x6f, 0x0a])).map(({ problem }) => problem), ['invalid-utf8']);
  assert.deepEqual(problemsOf('select 1;\u0008\n'), ['control-character']);
  assert.deepEqual(problemsOf('-- decodificado con perdida: env�o\n'), ['replacement-character']);
});

test('el espanol, la tipografia y los dibujos de caja legitimos pasan', () => {
  const legit = [
    '-- ── Fixture ────────',
    '-- ══ 1 · SUPERFICIE: firmas ══',
    '-- Facturación electrónica: ñandú, «comillas», ¿qué? ¡sí!, pingüino → cola — fin',
    '-- ├── árbol',
    '-- │   └── hoja',
    '-- ┌─┬─┐ tabla',
    "select 'día', 'AÑO', 'café';\r",
  ].join('\n');
  assert.deepEqual(problemsOf(`${legit}\n`), []);
});
