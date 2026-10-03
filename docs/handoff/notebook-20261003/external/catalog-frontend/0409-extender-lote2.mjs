import fs from 'node:fs';

const snap = JSON.parse(fs.readFileSync('catalog/production-catalog-snapshot.json', 'utf8'));
const nuevos = [
  'aquarius-manzana-1500ml',
  'aquarius-pera-1500ml',
  'aquarius-pomelo-2250ml',
  'gatorade-manzana-1250ml',
  'gatorade-cool-blue-500ml',
];
const q = (s) => `'${String(s).replace(/'/g, "\'")}'`;
const bloques = nuevos.map((sku) => {
  const p = snap.productos.find((x) => x.sku === sku);
  if (!p) throw new Error(`falta ${sku}`);
  const cap = p.capacityValue >= 1000 ? `${String(p.capacityValue / 1000).replace('.', ',')} L` : `${p.capacityValue} ml`;
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
  '   * ALTA DEL 2026-08-25 (segunda tanda) · cinco más, todas con RECORTE',
  '   * DECLARADO en catalog/recortes-declarados.json.',
  '   *',
  '   * Los tres Aquarius vienen del embotellador FEMSA con una banda de marketing',
  '   * lateral; los dos Gatorade, de un distribuidor oficial que fotografía la',
  '   * botella chica dentro del mismo lienzo que la familiar y la deja diminuta y',
  '   * descentrada. En los cinco el corte pasa por un canal de blanco puro y no',
  '   * toca un píxel del envase: normalize.mjs lo verifica antes de escribir.',
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
