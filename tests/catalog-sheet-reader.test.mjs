/*
 * LECTOR DE PLANILLAS SIN DEPENDENCIAS (js/business/catalog-sheet-reader.js).
 *
 * Dos fixtures reales en tests/fixtures (generados con openpyxl y llevados a
 * la forma de Excel: textos compartidos, uno con formato enriquecido y texto
 * fonético, una celda en línea, un booleano, una fórmula sin valor guardado,
 * una fila vacía, una hoja «Instrucciones» antes de «Productos»; y un CSV con
 * BOM, punto y coma, CRLF, comillas y un salto de línea dentro de una celda).
 * El resto se arma acá con un ZIP mínimo para los bordes.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  columnIndexFromReference, decodeXmlText, detectCsvDelimiter, MAX_SHEET_FILE_BYTES, MAX_SHEET_ROWS,
  parseCsvText, parseSharedStrings, parseWorksheet, readCatalogSheetBytes, readCatalogSheetFile, unescapeOoxmlText,
} from '../js/business/catalog-sheet-reader.js';

const fixture = (name) => readFileSync(new URL(`./fixtures/${name}`, import.meta.url));
const encoder = new TextEncoder();

async function deflateRaw(bytes) {
  const stream = new Blob([bytes]).stream().pipeThrough(new CompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/** ZIP mínimo: entradas guardadas (0) o con deflate (8). El lector no mira el CRC. */
async function zip(entries) {
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const entry of entries) {
    const raw = typeof entry.data === 'string' ? encoder.encode(entry.data) : entry.data;
    const method = entry.method ?? 8;
    const body = method === 8 ? await deflateRaw(raw) : raw;
    const name = encoder.encode(entry.name);
    const declared = entry.declaredSize ?? raw.length;
    const local = new Uint8Array(30 + name.length);
    const lv = new DataView(local.buffer);
    lv.setUint32(0, 0x04034b50, true); lv.setUint16(4, 20, true); lv.setUint16(6, entry.flags ?? 0x0800, true);
    lv.setUint16(8, method, true); lv.setUint32(18, body.length, true); lv.setUint32(22, declared, true);
    lv.setUint16(26, name.length, true);
    local.set(name, 30);
    const central = new Uint8Array(46 + name.length);
    const cv = new DataView(central.buffer);
    cv.setUint32(0, 0x02014b50, true); cv.setUint16(4, 20, true); cv.setUint16(6, 20, true);
    cv.setUint16(8, entry.flags ?? 0x0800, true); cv.setUint16(10, method, true);
    cv.setUint32(20, body.length, true); cv.setUint32(24, declared, true); cv.setUint16(28, name.length, true);
    cv.setUint32(42, offset, true);
    central.set(name, 46);
    locals.push(local, body);
    centrals.push(central);
    offset += local.length + body.length;
  }
  const centralSize = centrals.reduce((sum, part) => sum + part.length, 0);
  const end = new Uint8Array(22);
  const ev = new DataView(end.buffer);
  ev.setUint32(0, 0x06054b50, true); ev.setUint16(8, entries.length, true); ev.setUint16(10, entries.length, true);
  ev.setUint32(12, centralSize, true); ev.setUint32(16, offset, true);
  return new Uint8Array(await new Blob([...locals, ...centrals, end]).arrayBuffer());
}

const MAIN = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
const REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';

function workbookParts({ sheets, shared = null, prefix = '' }) {
  const p = prefix ? `${prefix}:` : '';
  const ns = prefix ? `xmlns:${prefix}="${MAIN}"` : `xmlns="${MAIN}"`;
  const parts = [
    { name: '_rels/.rels', data: `<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${REL}/officeDocument" Target="xl/workbook.xml"/></Relationships>` },
    { name: 'xl/workbook.xml', data: `<?xml version="1.0"?><${p}workbook ${ns} xmlns:r="${REL}"><${p}sheets>${sheets.map((sheet, index) => `<${p}sheet name="${sheet.name}" sheetId="${index + 1}" r:id="rId${index + 1}"${sheet.hidden ? ' state="hidden"' : ''}/>`).join('')}</${p}sheets></${p}workbook>` },
    { name: 'xl/_rels/workbook.xml.rels', data: `<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${sheets.map((sheet, index) => `<Relationship Id="rId${index + 1}" Type="${REL}/worksheet" Target="worksheets/sheet${index + 1}.xml"/>`).join('')}${shared === null ? '' : `<Relationship Id="rIdS" Type="${REL}/sharedStrings" Target="sharedStrings.xml"/>`}</Relationships>` },
    ...sheets.map((sheet, index) => ({ name: `xl/worksheets/sheet${index + 1}.xml`, data: `<?xml version="1.0"?><${p}worksheet ${ns}><${p}sheetData>${sheet.data}</${p}sheetData></${p}worksheet>` })),
  ];
  if (shared !== null) parts.push({ name: 'xl/sharedStrings.xml', data: `<?xml version="1.0"?><sst xmlns="${MAIN}">${shared}</sst>` });
  return parts;
}

test('xlsx real: elige la hoja «Productos» aunque no sea la primera y conserva los tipos', async () => {
  const read = await readCatalogSheetBytes(fixture('catalog-planilla-productos.xlsx'), { fileName: 'precios.xlsx' });
  assert.equal(read.ok, true, read.message);
  assert.equal(read.format, 'xlsx');
  assert.equal(read.sheetName, 'Productos');
  assert.deepEqual(read.rows.map((row) => row.number), [1, 2, 3, 4, 5, 6, 8, 9, 10], 'la fila 7 está vacía y no se devuelve');
  const byNumber = new Map(read.rows.map((row) => [row.number, row.cells]));
  assert.equal(byNumber.get(1)[0], 'Planilla de precios · La Taba', 'entidad numérica (&#183;) decodificada');
  assert.deepEqual(byNumber.get(3).slice(0, 8), [
    'SKU', 'Producto', 'Costo (ARS)', 'Precio de venta (ARS)', 'Precio regular antes de la promo (ARS)',
    'Stock actual', '¿Disponible para vender?', 'Observaciones',
  ]);
  // Texto compartido con formato enriquecido: el fonético (KOKAKOLA) no es parte del valor.
  assert.deepEqual(byNumber.get(4), ['coca-cola-2250ml', 'Coca-Cola 2,25 L', 1000, 1500, null, 12, 'Sí'],
    'números como números; la fórmula sin valor guardado de la columna I no aparece');
  assert.deepEqual(byNumber.get(5), ['agua-glaciar-1500ml', 'Agua Glaciar 1,5 L', '800', '1.234,50', null, 'abc', 'No', 'precio con coma'],
    'lo escrito como texto llega como texto');
  assert.deepEqual(byNumber.get(6), ['fernet-branca-750ml', 'Fernet Branca 750 ml', null, 9800.5, 11000], 'texto en línea (inlineStr)');
  assert.equal(byNumber.get(10)[6], true, 'el booleano de Excel llega como booleano');
  assert.equal(byNumber.get(9)[5], 0, 'el cero es un valor, no una celda vacía');
});

test('csv real: BOM, punto y coma, comillas y salto de línea dentro de una celda', async () => {
  const read = await readCatalogSheetBytes(fixture('catalog-planilla-productos.csv'), { fileName: 'precios.csv' });
  assert.equal(read.ok, true, read.message);
  assert.equal(read.format, 'csv');
  assert.deepEqual(read.rows.map((row) => row.number), [1, 2, 3, 4, 5, 7, 8]);
  assert.equal(read.rows[1].cells[0], 'SKU', 'el BOM no se pega al primer encabezado');
  assert.deepEqual(read.rows[3].cells, ['agua-glaciar-1500ml', 'Agua "Glaciar" 1,5 L', '800', '1.234,50', null, 'abc', 'No', 'con ; punto y coma']);
  assert.equal(read.rows[4].cells[7], 'línea uno\r\nlínea dos');
  assert.equal(read.rows[4].cells[3], '9800,50', 'en CSV todo llega como texto');
});

test('csv con comas: el separador sale de la fila del encabezado', () => {
  assert.equal(detectCsvDelimiter('Título, con coma\nSKU;Precio de venta (ARS)\n'), ';');
  assert.equal(detectCsvDelimiter('sku,precio,stock\n'), ',');
  assert.equal(detectCsvDelimiter('a;b;c\n1;2;3'), ';');
  const rows = parseCsvText('SKU,Producto,Precio de venta (ARS)\r\ncola-1l,"Cola, 1 L","1.500,50"\r\n\r\n,,\r\nagua-1l,Agua,900');
  assert.deepEqual(rows.map((row) => [row.number, row.cells]), [
    [1, ['SKU', 'Producto', 'Precio de venta (ARS)']],
    [2, ['cola-1l', 'Cola, 1 L', '1.500,50']],
    [5, ['agua-1l', 'Agua', '900']],
  ]);
});

test('csv: una comilla sin cerrar se informa con su fila', async () => {
  const read = await readCatalogSheetBytes(encoder.encode('SKU;Producto\ncola;"sin cerrar\n'), { fileName: 'x.csv' });
  assert.equal(read.ok, false);
  assert.match(read.message, /comilla sin cerrar en la fila 2/);
});

test('csv que no está en UTF-8: lo dice y explica cómo guardarlo', async () => {
  const latin1 = new Uint8Array([...encoder.encode('SKU;Producto\ncola;Az'), 0xfa, 0x63, 0x61, 0x72, 0x0a]);
  const read = await readCatalogSheetBytes(latin1, { fileName: 'precios.csv' });
  assert.equal(read.ok, false);
  assert.match(read.message, /UTF-8/);
});

test('más de 2 MB se rechaza antes de leer, por el tamaño del archivo', async () => {
  let opened = false;
  const big = { name: 'enorme.xlsx', size: MAX_SHEET_FILE_BYTES + 1, arrayBuffer: async () => { opened = true; return new ArrayBuffer(0); } };
  const read = await readCatalogSheetFile(big);
  assert.equal(read.ok, false);
  assert.match(read.message, /2 MB/);
  assert.equal(opened, false, 'ni siquiera se abre');
  const bytes = await readCatalogSheetBytes(new Uint8Array(MAX_SHEET_FILE_BYTES + 1), { fileName: 'x.csv' });
  assert.match(bytes.message, /2 MB/);
  assert.match((await readCatalogSheetFile(null)).message, /Elegí el archivo/);
  assert.match((await readCatalogSheetBytes(new Uint8Array(0))).message, /vacío/);
});

test('más de 2000 filas de productos se rechaza (con margen para títulos)', async () => {
  const lines = ['SKU;Precio de venta (ARS)'];
  for (let index = 0; index < MAX_SHEET_ROWS + 60; index += 1) lines.push(`sku-${index};100`);
  const read = await readCatalogSheetBytes(encoder.encode(lines.join('\n')), { fileName: 'larga.csv' });
  assert.equal(read.ok, false);
  assert.match(read.message, /más de 2000 filas/);
  const fits = await readCatalogSheetBytes(encoder.encode(lines.slice(0, MAX_SHEET_ROWS + 1).join('\n')), { fileName: 'justa.csv' });
  assert.equal(fits.ok, true);
  assert.equal(fits.rows.length, MAX_SHEET_ROWS + 1);
});

test('xlsx armado a mano: prefijos de espacio de nombres, entidades, _x000D_, AB12 y celdas sin referencia', async () => {
  const shared = '<si><t>SKU</t></si><si><t xml:space="preserve">línea&#10;con &amp; y _x000D_ retorno</t></si><si><t>_x005F_x0041_</t></si>';
  const data = '<x:row r="2"><x:c r="A2" t="s"><x:v>0</x:v></x:c><x:c r="AB2" t="s"><x:v>1</x:v></x:c></x:row>'
    + '<x:row><x:c t="str"><x:f>A1&amp;"b"</x:f><x:v>calculado</x:v></x:c><x:c t="e"><x:v>#N/A</x:v></x:c><x:c t="b"><x:v>0</x:v></x:c><x:c><x:v>  </x:v></x:c><x:c t="d"><x:v>2026-10-21</x:v></x:c><x:c t="s"><x:v>2</x:v></x:c></x:row>'
    + '<x:row r="7"><x:c r="C7" s="3"/><x:c r="D7" t="inlineStr"><x:is><x:r><x:t>en </x:t></x:r><x:r><x:t>partes</x:t></x:r></x:is></x:c></x:row>';
  const bytes = await zip(workbookParts({ sheets: [{ name: 'Productos', data }], shared, prefix: 'x' }));
  const read = await readCatalogSheetBytes(bytes, { fileName: 'a-mano.xlsx' });
  assert.equal(read.ok, true, read.message);
  assert.deepEqual(read.rows.map((row) => row.number), [2, 3, 7], 'una fila sin «r» es la siguiente');
  assert.equal(read.rows[0].cells.length, 28, 'AB es la columna 28');
  assert.equal(read.rows[0].cells[27], 'línea\ncon & y \r retorno');
  assert.deepEqual(read.rows[1].cells, ['calculado', { error: '#N/A' }, false, null, '2026-10-21', '_x0041_']);
  assert.deepEqual(read.rows[2].cells, [null, null, null, 'en partes']);
});

test('sin hoja «Productos» usa la primera visible; sin textos compartidos también funciona', async () => {
  const bytes = await zip(workbookParts({
    sheets: [
      { name: 'Oculta', hidden: true, data: '<row r="1"><c r="A1" t="inlineStr"><is><t>no</t></is></c></row>' },
      { name: 'Precios', data: '<row r="1"><c r="A1" t="inlineStr"><is><t>SKU</t></is></c><c r="B1"><v>12.5</v></c></row>' },
    ],
  }));
  const read = await readCatalogSheetBytes(bytes, { fileName: 'otra.xlsx' });
  assert.equal(read.ok, true, read.message);
  assert.equal(read.sheetName, 'Precios');
  assert.deepEqual(read.rows[0].cells, ['SKU', 12.5]);
});

test('entradas guardadas sin comprimir también se leen', async () => {
  const parts = workbookParts({ sheets: [{ name: 'Productos', data: '<row r="1"><c r="A1" t="s"><v>0</v></c></row>' }], shared: '<si><t>SKU</t></si>' })
    .map((part) => ({ ...part, method: 0 }));
  const read = await readCatalogSheetBytes(await zip(parts), { fileName: 'stored.xlsx' });
  assert.equal(read.ok, true, read.message);
  assert.deepEqual(read.rows[0].cells, ['SKU']);
});

test('una parte que se infla más de la cuenta se corta (bomba ZIP)', async () => {
  const huge = new Uint8Array(17 * 1024 * 1024);
  const parts = workbookParts({ sheets: [{ name: 'Productos', data: '' }] });
  parts[3] = { name: 'xl/worksheets/sheet1.xml', data: huge, declaredSize: 1000 };
  const read = await readCatalogSheetBytes(await zip(parts), { fileName: 'bomba.xlsx' });
  assert.equal(read.ok, false);
  assert.match(read.message, /2 MB/);
  const declared = workbookParts({ sheets: [{ name: 'Productos', data: '' }] });
  declared[3] = { ...declared[3], declaredSize: 20 * 1024 * 1024 };
  assert.equal((await readCatalogSheetBytes(await zip(declared), { fileName: 'declarada.xlsx' })).ok, false);
});

test('formatos que no se pueden leer: Excel viejo o con contraseña, ZIP roto, .xlsx que no es ZIP', async () => {
  const ole = new Uint8Array([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1, 0, 0]);
  assert.match((await readCatalogSheetBytes(ole, { fileName: 'viejo.xls' })).message, /Excel antiguo \(\.xls\) o protegida con contraseña/);
  const good = await zip(workbookParts({ sheets: [{ name: 'Productos', data: '' }] }));
  const truncated = good.slice(0, good.length - 30);
  assert.match((await readCatalogSheetBytes(truncated, { fileName: 'roto.xlsx' })).message, /incompleto o dañado/);
  assert.match((await readCatalogSheetBytes(encoder.encode('hola'), { fileName: 'falso.xlsx' })).message, /incompleto o dañado/);
  assert.match((await readCatalogSheetBytes(encoder.encode('hola'), { fileName: 'planilla.ods' })).message, /\.xlsx o como \.csv/);
  const locked = workbookParts({ sheets: [{ name: 'Productos', data: '' }] }).map((part) => ({ ...part, flags: 0x0801 }));
  assert.match((await readCatalogSheetBytes(await zip(locked), { fileName: 'cifrada.xlsx' })).message, /contraseña/);
  const notWorkbook = await zip([{ name: 'hola.txt', data: 'hola' }]);
  assert.match((await readCatalogSheetBytes(notWorkbook, { fileName: 'x.xlsx' })).message, /no parece una planilla/);
});

test('piezas del escáner de XML', () => {
  assert.equal(columnIndexFromReference('A1'), 0);
  assert.equal(columnIndexFromReference('Z9'), 25);
  assert.equal(columnIndexFromReference('AA10'), 26);
  assert.equal(columnIndexFromReference('AB12'), 27);
  assert.equal(columnIndexFromReference('$C$3'), 2);
  assert.equal(columnIndexFromReference('12'), null);
  assert.equal(decodeXmlText('&lt;a&gt; &amp; &quot;b&quot; &apos;c&apos; &#225; &#xE9; &desconocida;'), '<a> & "b" \'c\' á é &desconocida;');
  assert.equal(unescapeOoxmlText('a_x000D_b_x005F_x0041_'), 'a\rb_x0041_');
  assert.deepEqual(parseSharedStrings('<sst><si/><si><t>a</t><rPh><t>fon</t></rPh></si><!-- <si><t>no</t></si> --><si><![CDATA[x]]><t><![CDATA[<b>]]></t></si></sst>'), ['', 'a', '<b>']);
  assert.deepEqual(parseWorksheet('<sheetData><row r="3"><c r="B3"><v>7</v></c></row></sheetData>').map((row) => row.cells), [[null, 7]]);
});
