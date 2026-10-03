import fs from 'node:fs';

const snap = JSON.parse(fs.readFileSync('catalog/production-catalog-snapshot.json', 'utf8'));
const nuevos = [
  'coca-cola-original-2250ml',
  'coca-cola-zero-2250ml',
  'sprite-original-2250ml',
  'sprite-zero-2250ml',
  'sprite-original-lata-354ml',
  'benedictino-sin-gas-2250ml',
  'monster-green-zero-473ml',
  'soda-manaos-sifon-2000ml',
  'paso-de-los-toros-tonica-1500ml',
  'paso-de-los-toros-pomelo-1500ml',
];
const q = (s) => `'${String(s).replace(/'/g, "\\'")}'`;

const bloques = nuevos.map((sku) => {
  const p = snap.productos.find((x) => x.sku === sku);
  if (!p) throw new Error(`falta ${sku}`);
  const cap = p.capacityValue >= 1000
    ? `${String(p.capacityValue / 1000).replace('.', ',')} L`
    : `${p.capacityValue} ml`;
  return [
    `  [${q(sku)}, {`,
    `    nombre: ${q(`${p.name} · ${cap}`)},`,
    `    unitsPerPack: ${p.unitsPerPack},`,
    '    presentacion: {',
    `      brand: ${q(p.brand)},`,
    `      capacityUnit: ${q(p.capacityUnit)},`,
    `      capacityValue: ${p.capacityValue},`,
    `      category: ${q(p.category)},`,
    `      name: ${q(p.name)},`,
    `      packagingType: ${q(p.packagingType)},`,
    `      variant: ${q(p.variant)},`,
    '    },',
    '  }],',
  ].join('\n');
}).join('\n');

const comentario = [
  '',
  '  /*',
  '   * ALTA DEL 2026-08-25 · diez UNIDADES SUELTAS.',
  '   *',
  '   * Hasta acá el lote eran cuatro packs, porque la única fuente conocida era la',
  '   * tienda MAYORISTA del embotellador Andina, que no publica unidades sueltas.',
  '   * La tienda directa al consumidor de Coca-Cola FEMSA sí las publica, y con',
  '   * render limpio; el resto lo aportaron el CDN del fabricante de Monster, el',
  '   * sitio de Refres Now y un distribuidor oficial de Cervecería y Maltería',
  '   * Quilmes.',
  '   *',
  '   * Los diez llevan una unidad por envase, y si alguno pasara a venderse de a',
  '   * varios su fotografía dejaría de decir la verdad y este lote lo rechazaría.',
  '   */',
  '',
].join('\n');

const archivo = 'scripts/catalog-images/lote-objetivo.mjs';
const marca = ']);\n\nexport const SKUS_OBJETIVO';
let t = fs.readFileSync(archivo, 'utf8');
if (!t.includes(marca)) throw new Error('no encuentro el cierre del Map');
t = t.replace(marca, `${comentario}${bloques}\n${marca}`);
fs.writeFileSync(archivo, t, 'utf8');
console.log(`agregados ${nuevos.length}`);
