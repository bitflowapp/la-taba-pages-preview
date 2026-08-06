import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

import {
  buildSheets,
  collectPendingUnits,
  verifySheet,
} from '../scripts/build-pending-unit-prices.mjs';
import { validateCatalog } from '../scripts/validate-product-catalog.mjs';

const read = (name) => fs.readFileSync(new URL(`../${name}`, import.meta.url), 'utf8');

const LAS_NUEVE = [
  'coca-cola-original-pet-1500ml',
  'coca-cola-original-pet-500ml',
  'coca-cola-zero-pet-1500ml',
  'coca-cola-zero-pet-500ml',
  'fanta-naranja-pet-1500ml',
  'schweppes-citrus-pet-1500ml',
  'schweppes-tonica-pet-1500ml',
  'sprite-original-pet-1500ml',
  'sprite-original-pet-500ml',
];

test('la planilla cubre exactamente las nueve unidades bloqueadas por precio unitario', () => {
  const skus = collectPendingUnits().map(({ unit }) => unit.id).sort();
  assert.deepEqual(skus, [...LAS_NUEVE].sort());
});

test('la planilla committeada no se desvió del catálogo', () => {
  // Una planilla escrita a mano envejece: el día que un precio se confirma la
  // fila sigue pidiendo un dato que ya existe.
  const { sheet, reference } = buildSheets();
  assert.equal(read('catalog/pending-unit-prices.csv'), sheet);
  assert.equal(read('catalog/pending-unit-prices.reference.csv'), reference);
});

test('la planilla es un import válido en formato, con precio y stock vacíos', () => {
  const sheet = read('catalog/pending-unit-prices.csv');
  const header = sheet.split('\n')[0];
  assert.equal(header, read('data/catalog-template.csv').split('\n')[0]);

  for (const line of sheet.trim().split('\n').slice(1)) {
    const cells = line.split(',');
    assert.equal(cells[11], '', 'price vacío');
    assert.equal(cells[12], '', 'stock vacío');
  }
});

test('el importador real se niega a publicar una unidad sin precio', () => {
  // Fail-closed medido contra el validador del producto, no contra una copia:
  // si el importador dejara pasar un precio vacío, esta planilla publicaría
  // nueve productos a $0.
  const { errors } = validateCatalog(read('catalog/pending-unit-prices.csv'));
  assert.ok(errors.some((error) => /price está vacío/.test(error)));
  assert.ok(errors.some((error) => /stock está vacío/.test(error)));
});

test('la evidencia registra el precio del pack y la división que NO se usa', () => {
  const reference = read('catalog/pending-unit-prices.reference.csv');
  assert.match(reference, /division_del_pack_NO_USAR/);
  // Coca 1,5 L: pack de 6 a $19.999. La división da $3.333 y no es el precio.
  assert.match(reference, /coca-cola-original-pet-1500ml,[^\n]*,19999,6,3333,/);
  assert.match(reference, /no es el pack dividido/);
});

const PRICE = 11;
const STOCK = 12;
const IMAGE = 19;

/** Completa una fila de la planilla como lo haría el local. */
function completar(sku, { price, stock, image = 'assets/catalog/products/gaseosas/unidad.webp' }) {
  return read('catalog/pending-unit-prices.csv')
    .trim()
    .split('\n')
    .map((line) => {
      if (!line.startsWith(`${sku},`)) return line;
      const cells = line.split(',');
      cells[PRICE] = String(price);
      cells[STOCK] = String(stock);
      cells[IMAGE] = image;
      return cells.join(',');
    })
    .join('\n')
    .concat('\n');
}

test('cargar el pack dividido se rechaza aunque el número sea válido', () => {
  // Es el único error que se ve razonable y publica un precio que el local
  // nunca fijó.
  const { reference } = buildSheets();
  const dividido = verifySheet(
    completar('coca-cola-original-pet-1500ml', { price: 3333, stock: 10 }),
    reference,
  );
  assert.equal(dividido.ok, false);
  assert.ok(
    dividido.problems.some((problem) => /exactamente el pack dividido por 6/.test(problem)),
    dividido.problems.join(' | '),
  );
});

test('un precio confirmado por el local se acepta y queda listo para importar', () => {
  const { reference } = buildSheets();
  const result = verifySheet(
    completar('coca-cola-original-pet-1500ml', { price: 4200, stock: 24 }),
    reference,
  );
  const cargada = result.ready.find((row) => row.sku === 'coca-cola-original-pet-1500ml');
  assert.ok(cargada, result.problems.join(' | '));
  assert.equal(cargada.price, 4200);
  assert.equal(cargada.stock, 24);
  // Las otras ocho siguen bloqueadas: nada se publica a medias.
  assert.equal(result.ok, false);
  assert.equal(result.problems.length, 8);
});

test('una unidad sin foto propia no se publica: la del pack muestra el pack', () => {
  const { reference } = buildSheets();
  const result = verifySheet(
    completar('coca-cola-original-pet-1500ml', { price: 4200, stock: 24, image: '' }),
    reference,
  );
  assert.ok(result.problems.some((problem) => /falta la foto de la UNIDAD/.test(problem)));
});

test('la planilla no acepta un SKU que no sea uno de los nueve', () => {
  const { reference } = buildSheets();
  const sheet = `${read('catalog/pending-unit-prices.csv').trim()}\n`
    + 'colado,colado,X,Colado,Y,Gaseosas,cola,500,ml,botella-pet,1,1000,5,true,false,,false,false,0,foto.webp,\n';
  const result = verifySheet(sheet, reference);
  assert.ok(result.problems.some((problem) => /colado: no está en la lista de unidades bloqueadas/.test(problem)));
});
