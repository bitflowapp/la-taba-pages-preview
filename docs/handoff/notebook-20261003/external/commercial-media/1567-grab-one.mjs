import fs from 'node:fs';
const TAKES = 'D:/1212/taba-promo-v2/takes';
const data = JSON.parse(fs.readFileSync(`${TAKES}/marks.json`, 'utf8'));
const [session, name, offArg, out] = process.argv.slice(2);
const frames = fs.readdirSync(data.caps[session]).filter((f) => f.endsWith('.jpg'))
  .map((f) => ({ ts: Number(f.slice(0, -4)), file: `${data.caps[session]}/${f}` }))
  .sort((a, b) => a.ts - b.ts);
const wall = data.marks[session].find((m) => m.name === name).wall + Number(offArg) * 1000;
let best = frames[0];
for (const fr of frames) { if (fr.ts <= wall) best = fr; else break; }
fs.copyFileSync(best.file, `D:/1212/taba-promo-v2/frames/${out}.jpg`);
console.log(out, '←', best.file.split('/').pop(), 'delta', ((best.ts - wall) / 1000).toFixed(2));
