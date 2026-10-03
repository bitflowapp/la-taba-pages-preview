// Tira de cuadros crudos entre dos marcas, apilada en una imagen.
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';

const TAKES = 'D:/1212/taba-promo-v2/takes';
const data = JSON.parse(fs.readFileSync(`${TAKES}/marks.json`, 'utf8'));
const [session, fromMark, toMark, stepArg] = process.argv.slice(2);
const step = Number(stepArg || 0.5) * 1000;

const frames = fs.readdirSync(data.caps[session]).filter((f) => f.endsWith('.jpg'))
  .map((f) => ({ ts: Number(f.slice(0, -4)), file: `${data.caps[session]}/${f}` }))
  .sort((a, b) => a.ts - b.ts);
const wallOf = (name) => data.marks[session].find((m) => m.name === name)?.wall;
const frameAt = (wall) => {
  let best = frames[0];
  for (const fr of frames) { if (fr.ts <= wall) best = fr; else break; }
  return best.file;
};

const from = wallOf(fromMark); const to = wallOf(toMark);
const picks = [];
for (let w = from; w <= to; w += step) picks.push(frameAt(w));
const dir = 'D:/1212/taba-promo-v2/frames/strip';
fs.rmSync(dir, { recursive: true, force: true });
fs.mkdirSync(dir, { recursive: true });
picks.forEach((f, i) => fs.copyFileSync(f, `${dir}/${String(i).padStart(3, '0')}.jpg`));
const cols = Math.min(6, picks.length);
const rows = Math.ceil(picks.length / cols);
const r = spawnSync('ffmpeg', ['-y', '-framerate', '1', '-i', `${dir}/%03d.jpg`,
  '-vf', `scale=180:320,tile=${cols}x${rows}:padding=4:color=0x303030`, '-frames:v', '1',
  'D:/1212/taba-promo-v2/frames/strip.png'], { encoding: 'utf8' });
if (r.status !== 0) { console.error(r.stderr.slice(-800)); process.exit(1); }
console.log(`strip de ${picks.length} cuadros (${fromMark} → ${toMark}, paso ${step / 1000}s)`);
