// Versión corta (~15 s) desde las mismas secuencias JPEG + placas.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';

const ROOT = 'D:/1212/taba-promo-v2';
const TAKES = `${ROOT}/takes`;
const OV = `${ROOT}/overlays`;
const TMP = `${ROOT}/out/tmp-short`;
const OUTDIR = `${ROOT}/out`;
fs.rmSync(TMP, { recursive: true, force: true });
fs.mkdirSync(TMP, { recursive: true });

const FF = 'ffmpeg';
function run(args, tag) {
  const r = spawnSync(FF, args, { encoding: 'utf8', maxBuffer: 1024 * 1024 * 256 });
  if (r.status !== 0) {
    console.error(`--- ffmpeg FAIL [${tag}] ---\n${(r.stderr || '').slice(-3000)}`);
    process.exit(1);
  }
}

const marksData = JSON.parse(fs.readFileSync(`${TAKES}/marks.json`, 'utf8'));
const T = {}; const FRAMES = {};
for (const s of ['s1', 's2', 's3']) {
  T[s] = {};
  for (const m of marksData.marks[s]) T[s][m.name] = m.wall / 1000;
  FRAMES[s] = fs.readdirSync(marksData.caps[s]).filter((f) => f.endsWith('.jpg'))
    .map((f) => ({ ts: Number(f.slice(0, -4)) / 1000, file: `${marksData.caps[s]}/${f}` }))
    .sort((a, b) => a.ts - b.ts);
}
function frameAt(session, wallSec) {
  const arr = FRAMES[session];
  let lo = 0; let hi = arr.length - 1; let best = 0;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (arr[mid].ts <= wallSec) { best = mid; lo = mid + 1; } else hi = mid - 1;
  }
  return arr[best].file;
}
const T1 = T.s1; const T2 = T.s2; const T3 = T.s3;

const SEGS = [
  { id: 'k1', src: 's3', start: T3['mapa-visible'] + 11.5, srcDur: 2.2, speed: 1.9 },
  { id: 'k2', src: 's1', start: T1['scroll-down'] + 0.25, srcDur: 1.6, speed: 1.6 },
  { id: 'k3', src: 's1', start: T1['b3-ficha'] + 0.55, srcDur: (T1['tap-agregar'] - T1['b3-ficha']) - 0.55 + 0.6, speed: 1.25 },
  { id: 'k4', src: 's1', start: T1['confirmado'] - 0.05, srcDur: 1.9, speed: 1.3 },
  { id: 'k5', src: 's2', start: T2['push-pedido'] + 0.05, srcDur: (T2['pedido-visible'] - T2['push-pedido']) + 1.7, speed: 1.25 },
  { id: 'k6', src: 's2', start: T2['b10-aceptar'] + 0.2, srcDur: (T2['en-preparando'] - T2['b10-aceptar']) - 0.2 + 0.7, speed: 1.4 },
  { id: 'k7', src: 's3', start: T3['mapa-visible'] + 3.0, srcDur: 6.0, speed: 3.0 },
  { id: 'k8', src: 's3', start: T3['scroll-codigo'] - 0.25, srcDur: 2.7, speed: 1.35 },
];
for (const seg of SEGS) {
  seg.dur = seg.srcDur / seg.speed;
  const seqDir = `${TMP}/seq-${seg.id}`;
  fs.mkdirSync(seqDir, { recursive: true });
  const n = Math.max(2, Math.round(seg.dur * 30));
  for (let k = 0; k < n; k += 1) {
    fs.copyFileSync(frameAt(seg.src, seg.start + k * seg.speed / 30), `${seqDir}/${String(k).padStart(5, '0')}.jpg`);
  }
  seg.dur = n / 30;
  seg.file = `${TMP}/${seg.id}.mp4`;
  run(['-y', '-framerate', '30', '-i', `${seqDir}/%05d.jpg`, '-vf', 'format=yuv420p',
    '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '16', seg.file], `seg-${seg.id}`);
}

// Placa final (reutiliza la de la edición principal)
const cardLuna = `${ROOT}/out/tmp/card-luna.mp4`;
const CH = [
  { id: 'hook', parts: ['k1'] },
  { id: 'cli', parts: ['k2', 'k3', 'k4'] },
  { id: 'neg', parts: ['k5', 'k6'] },
  { id: 'mapa', parts: ['k7', 'k8'] },
  { id: 'card', file: cardLuna, dur: 3.6 },
];
const seg = (id) => SEGS.find((s) => s.id === id);
for (const ch of CH) {
  if (ch.file) continue;
  ch.dur = ch.parts.reduce((a, p) => a + seg(p).dur, 0);
  const inputs = ch.parts.flatMap((p) => ['-i', seg(p).file]);
  ch.file = `${TMP}/${ch.id}.mp4`;
  run(['-y', ...inputs, '-filter_complex', `${ch.parts.map((_, i) => `[${i}:v]`).join('')}concat=n=${ch.parts.length}:v=1:a=0[v]`, '-map', '[v]', '-an', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '16', ch.file], `ch-${ch.id}`);
}
const XF = [
  { type: 'slideup', d: 0.22 }, { type: 'slideup', d: 0.22 }, { type: 'slideup', d: 0.22 }, { type: 'fade', d: 0.3 },
];
const inputs = [];
CH.forEach((c) => inputs.push('-i', c.file));
const parts = [];
let prev = '[0:v]';
let cum = CH[0].dur;
const starts = { [CH[0].id]: 0 };
for (let i = 1; i < CH.length; i += 1) {
  const xf = XF[i - 1];
  const off = cum - xf.d;
  starts[CH[i].id] = off;
  const out = i === CH.length - 1 ? '[vout]' : `[x${i}]`;
  parts.push(`${prev}[${i}:v]xfade=transition=${xf.type}:duration=${xf.d}:offset=${off.toFixed(3)}${out}`);
  prev = out;
  cum = off + CH[i].dur;
}
run(['-y', ...inputs, '-filter_complex', parts.join(';'), '-map', '[vout]', '-an', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '16', `${TMP}/base.mp4`], 'base');

const segStartIn = (chId, partId) => {
  const ch = CH.find((c) => c.id === chId);
  let off = starts[chId];
  for (const p of ch.parts) { if (p === partId) return off; off += seg(p).dur; }
  return off;
};
const OVER = [
  { id: 'hook1', from: 0.08, to: starts.cli - 0.05 },
  { id: 'cap-catalogo', from: starts.cli + 0.10, to: segStartIn('cli', 'k4') - 0.08 },
  { id: 'cap-confirmado', from: segStartIn('cli', 'k4') + 0.10, to: starts.neg - 0.25 },
  { id: 'cap-panel', from: starts.neg + 0.15, to: segStartIn('neg', 'k6') + 0.5 },
  { id: 'cap-mapa', from: starts.mapa + 0.15, to: segStartIn('mapa', 'k8') - 0.05 },
  { id: 'cap-codigo', from: segStartIn('mapa', 'k8') + 0.10, to: starts.card - 0.30 },
];
const ovIn = ['-i', `${TMP}/base.mp4`];
OVER.forEach((o) => ovIn.push('-loop', '1', '-i', `${OV}/${o.id}.png`));
const chain = [];
let cur = '[0:v]';
OVER.forEach((o, i) => {
  const idx = i + 1;
  chain.push(`[${idx}:v]format=rgba,fade=t=in:st=${o.from.toFixed(2)}:d=0.2:alpha=1,fade=t=out:st=${(o.to - 0.2).toFixed(2)}:d=0.2:alpha=1[f${idx}]`);
  const out = idx === OVER.length ? '[vfin]' : `[o${idx}]`;
  chain.push(`${cur}[f${idx}]overlay=0:0:enable='between(t,${o.from.toFixed(2)},${o.to.toFixed(2)})'${out}`);
  cur = out;
});
run(['-y', ...ovIn, '-filter_complex', chain.join(';'), '-map', '[vfin]', '-t', String(cum.toFixed(2)),
  '-an', '-c:v', 'libx264', '-preset', 'slow', '-crf', '18', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', '-r', '30',
  `${OUTDIR}/TABA_PROMO_SHORT_1080x1920.mp4`], 'final-short');
console.log(`SHORT: ${OUTDIR}/TABA_PROMO_SHORT_1080x1920.mp4 (${cum.toFixed(2)}s)`);
