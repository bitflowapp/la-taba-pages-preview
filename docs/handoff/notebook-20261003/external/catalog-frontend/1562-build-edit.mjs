// Ensambla el video final desde las secuencias JPEG + marks.json.
// Corte por reloj de pared: cada cuadro fuente se llama <epoch_ms>.jpg.
// 1) Segmentos con velocidad → re-muestreo a 30 fps (hold del último cuadro).
// 2) Concat por capítulo + xfade entre capítulos + placas con push-in.
// 3) Sobreimpresos PNG con fade → TABA_PROMO_VERTICAL_1080x1920.mp4.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';

const ROOT = 'D:/1212/taba-promo-v2';
const TAKES = `${ROOT}/takes`;
const OV = `${ROOT}/overlays`;
const TMP = `${ROOT}/out/tmp`;
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
  return r;
}

const marksData = JSON.parse(fs.readFileSync(`${TAKES}/marks.json`, 'utf8'));
const T = {};
const FRAMES = {};
for (const s of ['s1', 's2', 's3']) {
  T[s] = {};
  for (const m of marksData.marks[s]) T[s][m.name] = m.wall / 1000;
  const dir = marksData.caps[s];
  FRAMES[s] = fs.readdirSync(dir)
    .filter((f) => f.endsWith('.jpg'))
    .map((f) => ({ ts: Number(f.slice(0, -4)) / 1000, file: `${dir}/${f}` }))
    .sort((a, b) => a.ts - b.ts);
  const span = FRAMES[s].length ? (FRAMES[s].at(-1).ts - FRAMES[s][0].ts) : 0;
  console.log(`[${s}] cuadros=${FRAMES[s].length} span=${span.toFixed(1)}s fps≈${(FRAMES[s].length / Math.max(1, span)).toFixed(1)}`);
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

// ── EDL (tiempos fuente en segundos de reloj de pared) ──
const SEGS = [
  // HOOK
  { id: 'h1', src: 's3', start: T3['mapa-visible'] + 11.5, srcDur: 2.6, speed: 2.0 },
  { id: 'h2', src: 's1', start: T1['scroll-down'] + 0.25, srcDur: 1.7, speed: 1.7 },
  { id: 'h3', src: 's2', start: T2['pedido-visible'] - 0.2, srcDur: 1.45, speed: 1.25 },
  // CAP 1 · CLIENTE
  { id: 'c1', src: 's1', start: T1['b1-home'] + 0.15, srcDur: (T1['tap-catalogo'] - T1['b1-home']) + 0.85, speed: 1.35 },
  { id: 'c2', src: 's1', start: T1['b2-gondola'] + 0.3, srcDur: 3.0, speed: 1.9 },
  { id: 'c3', src: 's1', start: T1['b3-ficha'] + 0.1, srcDur: (T1['tap-agregar'] - T1['b3-ficha']) + 0.65, speed: 1.2 },
  { id: 'c4', src: 's1', start: T1['b4-cantidad'] + 0.05, srcDur: (T1['tap-carrito'] - T1['b4-cantidad']) + 0.6, speed: 1.3 },
  { id: 'c5', src: 's1', start: T1['b5-carrito'] + 0.1, srcDur: (T1['scroll-checkout'] - T1['b5-carrito']) - 0.1 + 0.8, speed: 1.3 },
  { id: 'c6', src: 's1', start: T1['confirmado'] - 0.05, srcDur: 2.65, speed: 1.35 },
  // CAP 2 · NEGOCIO
  { id: 'n1', src: 's2', start: T2['b8-panel'] + 0.1, srcDur: 2.6, speed: 1.75 },
  { id: 'n2', src: 's2', start: T2['push-pedido'] + 0.05, srcDur: (T2['pedido-visible'] - T2['push-pedido']) + 1.9, speed: 1.25 },
  { id: 'n3', src: 's2', start: T2['b10-aceptar'] + 0.2, srcDur: (T2['scroll-preparando'] - T2['b10-aceptar']) - 0.2 + 2.0, speed: 1.5 },
  // CAP 3 · REPARTO
  { id: 'r1', src: 's3', start: T3['b11-rider'] + 0.15, srcDur: (T3['tap-aceptar-entrega'] - T3['b11-rider']) - 0.15 + 0.12, speed: 1.3 },
  { id: 'r2', src: 's3', start: T3['tap-aceptar-entrega'] + 0.85, srcDur: (T3['tap-en-camino'] - T3['tap-aceptar-entrega']) - 0.85 + 0.14, speed: 1.1 },
  // CAP 4 · EN VIVO
  { id: 'm1', src: 's3', start: T3['mapa-visible'] + 1.1, srcDur: 1.9, speed: 1.3 },
  { id: 'm2', src: 's3', start: T3['mapa-visible'] + 3.0, srcDur: 7.6, speed: 3.3 },
  { id: 'm3', src: 's3', start: T3['llego'] - 2.6, srcDur: 2.6, speed: 1.6 },
  { id: 'm4', src: 's3', start: T3['scroll-codigo'] - 0.25, srcDur: 3.3, speed: 1.3 },
];

for (const seg of SEGS) {
  seg.dur = seg.srcDur / seg.speed;
  const seqDir = `${TMP}/seq-${seg.id}`;
  fs.mkdirSync(seqDir, { recursive: true });
  const n = Math.max(2, Math.round(seg.dur * 30));
  for (let k = 0; k < n; k += 1) {
    const targetWall = seg.start + k * seg.speed / 30;
    fs.copyFileSync(frameAt(seg.src, targetWall), `${seqDir}/${String(k).padStart(5, '0')}.jpg`);
  }
  seg.dur = n / 30;
  const out = `${TMP}/${seg.id}.mp4`;
  run(['-y', '-framerate', '30', '-i', `${seqDir}/%05d.jpg`, '-vf', 'format=yuv420p',
    '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '16', out], `seg-${seg.id}`);
  seg.file = out;
  console.log(`seg ${seg.id}: ${seg.srcDur.toFixed(2)}s @${seg.speed}x → ${seg.dur.toFixed(2)}s (${n} cuadros)`);
}

// Placas con push-in sutil
const CARDS = [
  { id: 'card-taba', dur: 2.4 },
  { id: 'card-luna', dur: 3.6 },
];
for (const card of CARDS) {
  const frames = Math.round(card.dur * 30);
  const out = `${TMP}/${card.id}.mp4`;
  run(['-y', '-loop', '1', '-t', String(card.dur), '-i', `${OV}/${card.id}.png`,
    '-vf', `scale=1188:2112,zoompan=z='1+0.00045*on':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=${frames}:s=1080x1920:fps=30,format=yuv420p`,
    '-an', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '16', out], card.id);
  card.file = out;
}

// ── Capítulos + xfade ──
const seg = (id) => SEGS.find((s) => s.id === id);
const CHAPTERS = [
  { id: 'hook', parts: ['h1', 'h2', 'h3'] },
  { id: 'ch1', parts: ['c1', 'c2', 'c3', 'c4', 'c5', 'c6'] },
  { id: 'ch2', parts: ['n1', 'n2', 'n3'] },
  { id: 'ch3', parts: ['r1', 'r2'] },
  { id: 'ch4', parts: ['m1', 'm2', 'm3', 'm4'] },
  { id: 'cardA', parts: [], file: CARDS[0].file, dur: CARDS[0].dur },
  { id: 'cardB', parts: [], file: CARDS[1].file, dur: CARDS[1].dur },
];
for (const ch of CHAPTERS) {
  if (ch.file) continue;
  ch.dur = ch.parts.reduce((acc, p) => acc + seg(p).dur, 0);
  const inputs = ch.parts.flatMap((p) => ['-i', seg(p).file]);
  const graph = `${ch.parts.map((_, i) => `[${i}:v]`).join('')}concat=n=${ch.parts.length}:v=1:a=0[v]`;
  ch.file = `${TMP}/${ch.id}.mp4`;
  run(['-y', ...inputs, '-filter_complex', graph, '-map', '[v]', '-an', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '16', ch.file], `ch-${ch.id}`);
  console.log(`cap ${ch.id}: ${ch.dur.toFixed(2)}s`);
}

const XF = [
  { type: 'slideup', d: 0.24 },
  { type: 'slideup', d: 0.24 },
  { type: 'slideup', d: 0.24 },
  { type: 'slideup', d: 0.24 },
  { type: 'fade', d: 0.35 },
  { type: 'fade', d: 0.3 },
];
let inputs = [];
CHAPTERS.forEach((ch) => { inputs.push('-i', ch.file); });
const graphParts = [];
let prevLabel = '[0:v]';
let cum = CHAPTERS[0].dur;
const chapterStarts = { [CHAPTERS[0].id]: 0 };
for (let i = 1; i < CHAPTERS.length; i += 1) {
  const xf = XF[i - 1];
  const offset = cum - xf.d;
  chapterStarts[CHAPTERS[i].id] = offset;
  const outLabel = i === CHAPTERS.length - 1 ? '[vout]' : `[x${i}]`;
  graphParts.push(`${prevLabel}[${i}:v]xfade=transition=${xf.type}:duration=${xf.d}:offset=${offset.toFixed(3)}${outLabel}`);
  prevLabel = outLabel;
  cum = offset + CHAPTERS[i].dur;
}
const totalDur = cum;
run(['-y', ...inputs, '-filter_complex', graphParts.join(';'), '-map', '[vout]', '-an', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '16', `${TMP}/base.mp4`], 'base');
console.log(`base total: ${totalDur.toFixed(2)}s`);

// ── Sobreimpresos ──
const segStartIn = (chId, partId) => {
  const ch = CHAPTERS.find((c) => c.id === chId);
  let off = chapterStarts[chId];
  for (const p of ch.parts) { if (p === partId) return off; off += seg(p).dur; }
  return off;
};
const h1End = seg('h1').dur;
const hookEnd = chapterStarts.ch1 + 0.12;
const ch1S = chapterStarts.ch1; const ch2S = chapterStarts.ch2;
const ch3S = chapterStarts.ch3; const ch4S = chapterStarts.ch4;
const cardAS = chapterStarts.cardA;

const OVERLAYS = [
  { id: 'hook1', from: 0.10, to: h1End - 0.02 },
  { id: 'hook2', from: h1End + 0.06, to: hookEnd - 0.15 },
  { id: 'chip-cliente', from: ch1S + 0.12, to: ch1S + 2.5 },
  { id: 'cap-catalogo', from: segStartIn('ch1', 'c2') + 0.15, to: segStartIn('ch1', 'c4') - 0.10 },
  { id: 'cap-pedido', from: segStartIn('ch1', 'c5') + 0.2, to: segStartIn('ch1', 'c6') - 0.04 },
  { id: 'cap-confirmado', from: segStartIn('ch1', 'c6') + 0.19, to: ch2S - 0.06 },
  { id: 'chip-negocio', from: ch2S + 0.12, to: ch2S + 2.5 },
  { id: 'cap-negocio', from: ch2S + 0.20, to: segStartIn('ch2', 'n2') - 0.05 },
  { id: 'cap-panel', from: segStartIn('ch2', 'n2') + 0.35, to: segStartIn('ch2', 'n3') + 0.25 },
  { id: 'cap-estados', from: segStartIn('ch2', 'n3') + 0.45, to: ch3S - 0.30 },
  { id: 'chip-reparto', from: ch3S + 0.12, to: ch3S + 2.4 },
  { id: 'cap-reparto', from: ch3S + 0.35, to: ch4S - 0.30 },
  { id: 'cap-mapa', from: ch4S + 0.30, to: segStartIn('ch4', 'm3') - 0.05 },
  { id: 'cap-codigo', from: segStartIn('ch4', 'm3') + 0.25, to: segStartIn('ch4', 'm4') + 1.2 },
];

const ovInputs = ['-i', `${TMP}/base.mp4`];
OVERLAYS.forEach((o) => { ovInputs.push('-loop', '1', '-i', `${OV}/${o.id}.png`); });
const chain = [];
let cur = '[0:v]';
OVERLAYS.forEach((o, i) => {
  const idx = i + 1;
  chain.push(`[${idx}:v]format=rgba,fade=t=in:st=${o.from.toFixed(2)}:d=0.22:alpha=1,fade=t=out:st=${(o.to - 0.22).toFixed(2)}:d=0.22:alpha=1[f${idx}]`);
  const outLabel = idx === OVERLAYS.length ? '[vfin]' : `[o${idx}]`;
  chain.push(`${cur}[f${idx}]overlay=0:0:enable='between(t,${o.from.toFixed(2)},${o.to.toFixed(2)})'${outLabel}`);
  cur = outLabel;
});
run(['-y', ...ovInputs, '-filter_complex', chain.join(';'), '-map', '[vfin]', '-t', String(totalDur.toFixed(2)),
  '-an', '-c:v', 'libx264', '-preset', 'slow', '-crf', '18', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', '-r', '30',
  `${OUTDIR}/TABA_PROMO_VERTICAL_1080x1920.mp4`], 'final');
console.log(`FINAL: ${OUTDIR}/TABA_PROMO_VERTICAL_1080x1920.mp4 (${totalDur.toFixed(2)}s)`);
fs.writeFileSync(`${TMP}/timeline.json`, JSON.stringify({ totalDur, chapterStarts, segs: SEGS.map(({ id, dur }) => ({ id, dur: Number(dur.toFixed(2)) })), overlays: OVERLAYS }, null, 2));
