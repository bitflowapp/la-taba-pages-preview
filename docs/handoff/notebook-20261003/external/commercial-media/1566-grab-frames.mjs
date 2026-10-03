// Extrae cuadros crudos de cap-sX en offsets relativos a una marca.
import fs from 'node:fs';

const TAKES = 'D:/1212/taba-promo-v2/takes';
const data = JSON.parse(fs.readFileSync(`${TAKES}/marks.json`, 'utf8'));
const FR = {};
for (const s of ['s1', 's2', 's3']) {
  FR[s] = fs.readdirSync(data.caps[s]).filter((f) => f.endsWith('.jpg'))
    .map((f) => ({ ts: Number(f.slice(0, -4)), file: `${data.caps[s]}/${f}` }))
    .sort((a, b) => a.ts - b.ts);
}
const wallOf = (s, name) => data.marks[s].find((m) => m.name === name)?.wall;
const frameAt = (s, wall) => {
  let best = FR[s][0];
  for (const fr of FR[s]) { if (fr.ts <= wall) best = fr; else break; }
  return best.file;
};

const wants = [
  ['s1', 'checkout-visto', -0.3], ['s1', 'checkout-visto', 0.2], ['s1', 'checkout-visto', 0.7],
  ['s1', 'b6-confirmar', 0.6], ['s1', 'tap-confirmar', -0.25],
  ['s3', 'tap-en-camino', 0.4], ['s3', 'tap-iniciar-recorrido', -0.4],
];
for (const [s, name, off] of wants) {
  const wall = wallOf(s, name) + off * 1000;
  const src = frameAt(s, wall);
  const dest = `D:/1212/taba-promo-v2/frames/raw-${s}-${name}${off >= 0 ? '+' : ''}${off}.jpg`;
  fs.copyFileSync(src, dest);
  console.log(dest.split('/').pop(), '←', src.split('/').pop());
}
