// Depuración: filas que resuelven dudas de matching (Quilmes, Villavicencio, vinos, Manaos, lata 354, Pepsi).
import { readFileSync } from 'node:fs';

const t = readFileSync('artifacts/catalog-pricing-images-20261024/fuentes/laanonima/nombres-unicos-utf8.txt', 'utf8');
const secciones = [
  ['Quilmes todas', /cervezas/.test('x') ? null : null, (l) => /quilmes/i.test(l) && l.startsWith('cervezas')],
  ['Villavicencio AGUA CON GAS', null, (l) => l.startsWith('aguas-con-gas') && /villav/i.test(l)],
  ['Villavicencio AGUA SIN GAS', null, (l) => l.startsWith('aguas-sin-gas') && /villav/i.test(l)],
  ['Vinos Trapiche/Dada/Cafayate/Toro', null, (l) => l.startsWith('vinos-') && /trapiche|dada|cafayate|toro/i.test(l)],
  ['Manaos', null, (l) => /manaos/i.test(l)],
  ['Coca lata 354', null, (l) => /coca/i.test(l) && /354/.test(l)],
  ['Pepsi', null, (l) => /pepsi/i.test(l)],
];
for (const [titulo, _a, filtro] of secciones) {
  console.log(`--- ${titulo}:`);
  for (const l of t.split('\n')) {
    if (l && filtro(l)) console.log(' ', l.trim());
  }
}
