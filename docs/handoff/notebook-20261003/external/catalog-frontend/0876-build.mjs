/*
 * Montaje del video final.
 *
 * Toma los .webm crudos de cada escena, les saca la puesta en escena (la parte
 * grabada a negro mientras se preparaba el pedido), los ajusta de ritmo, los
 * numera en `clips/` y los pega en un solo MP4. De paso arma el .srt con la
 * narración, usando los tiempos que cada escena anotó mientras se filmaba.
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = 'D:/1212/artifacts/taba2-walter-commercial-demo';
const RAW = path.join(ROOT, '_work', 'raw');
const CLIPS = path.join(ROOT, 'clips');
const TMP = path.join(ROOT, '_work', 'tmp');

// El ritmo se ajusta por escena: las que muestran una interfaz densa aguantan
// más marcha; el seguimiento y la apertura se dejan en tiempo real.
const SEGMENTOS = [
  { id: 's0',  archivo: '00-apertura',            titulo: 'Apertura',                              vel: 1.00 },
  { id: 's1',  archivo: '01-cliente',             titulo: 'Escena 1 · El cliente compra',          vel: 1.28 },
  { id: 's1b', archivo: '02-prueba-mercado-pago', titulo: 'La prueba · Mercado Pago en modo TEST', vel: 1.08 },
  { id: 's2',  archivo: '03-negocio',             titulo: 'Escena 2 · El negocio recibe',          vel: 1.10 },
  { id: 's3',  archivo: '04-reparto',             titulo: 'Escena 3 · El reparto',                 vel: 1.22 },
  { id: 's4',  archivo: '05-seguimiento',         titulo: 'Escena 4 · El cliente sigue su pedido', vel: 1.00 },
  { id: 's5a', archivo: '06-operacion',           titulo: 'Escena 5 · Qué pasa en el negocio',     vel: 1.26 },
  { id: 's5b', archivo: '07-ventas-y-stock',      titulo: 'Escena 5 · Ventas, ticket y stock',     vel: 1.18 },
  { id: 's6',  archivo: '08-facturacion',         titulo: 'Escena 6 · La facturación (sintético)', vel: 1.26 },
  { id: 's7',  archivo: '09-whatsapp',            titulo: 'Escena 7 · El mismo sistema por WhatsApp', vel: 1.18 },
  { id: 's9',  archivo: '10-cierre',              titulo: 'Cierre',                                vel: 1.14 },
];

const ff = (args, capture = false) => execFileSync('ffmpeg', args, {
  stdio: capture ? ['ignore', 'pipe', 'pipe'] : 'inherit', encoding: 'utf8', maxBuffer: 64 * 1024 * 1024,
});
const probe = (file) => Number(execFileSync('ffprobe',
  ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file], { encoding: 'utf8' }).trim());

/* El final de cada escena es un fundido a negro con una cola. Se busca el
   último tramo negro para cortar ahí y no arrastrar segundos muertos. */
function finalNegro(file, total) {
  let out = '';
  try {
    out = execFileSync('ffmpeg', ['-v', 'info', '-i', file, '-vf', 'blackdetect=d=0.25:pic_th=0.96:pix_th=0.06',
      '-an', '-f', 'null', '-'], { stdio: ['ignore', 'pipe', 'pipe'], encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
  } catch (error) { out = String(error.stdout || '') + String(error.stderr || ''); }
  const tramos = [...out.matchAll(/black_start:([\d.]+) black_end:([\d.]+)/g)]
    .map((m) => ({ ini: Number(m[1]), fin: Number(m[2]) }));
  const ultimo = tramos.filter((t) => t.fin >= total - 0.6).pop();
  return ultimo ? Math.min(total, ultimo.ini + 0.55) : total;
}

const hhmmss = (s) => {
  const ms = Math.round((s % 1) * 1000);
  const t = Math.floor(s);
  return `${String(Math.floor(t / 3600)).padStart(2, '0')}:${String(Math.floor(t / 60) % 60).padStart(2, '0')}:${String(t % 60).padStart(2, '0')},${String(ms).padStart(3, '0')}`;
};
const mmss = (s) => `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

fs.rmSync(CLIPS, { recursive: true, force: true });
fs.mkdirSync(CLIPS, { recursive: true });
fs.mkdirSync(TMP, { recursive: true });

const plan = [];
let acumulado = 0;
const cues = [];

for (const seg of SEGMENTOS) {
  const webm = path.join(RAW, `${seg.id}.webm`);
  const meta = JSON.parse(fs.readFileSync(path.join(RAW, `${seg.id}.json`), 'utf8'));
  const total = probe(webm);
  const corte = Number(meta.corte) || 0;
  const fin = finalNegro(webm, total);
  const duracion = (fin - corte) / seg.vel;
  const destino = path.join(CLIPS, `${seg.archivo}.mp4`);

  console.log(`${seg.archivo}: crudo ${total.toFixed(2)}s · corte ${corte.toFixed(2)}s · fin ${fin.toFixed(2)}s · x${seg.vel} → ${duracion.toFixed(2)}s`);

  ff(['-y', '-v', 'error', '-ss', String(corte), '-i', webm, '-t', String(duracion),
    '-vf', `setpts=PTS/${seg.vel},fps=30,format=yuv420p`, '-an',
    '-c:v', 'libx264', '-crf', '18', '-preset', 'medium', '-profile:v', 'high', '-level', '4.1',
    '-movflags', '+faststart', destino]);

  for (const cue of meta.cues) {
    if (cue.start < corte) continue;
    const ini = acumulado + (cue.start - corte) / seg.vel;
    const f = acumulado + Math.min((cue.end ?? cue.start + 2.5) - corte, fin - corte) / seg.vel;
    if (f <= ini + 0.2) continue;
    cues.push({ ini, fin: f, texto: String(cue.text).replace(/<br\s*\/?>/g, '\n').replace(/<[^>]+>/g, '') });
  }

  plan.push({ ...seg, inicio: acumulado, duracion, destino });
  acumulado += duracion;
}

console.log(`\nDURACIÓN TOTAL: ${acumulado.toFixed(1)}s (${mmss(acumulado)})`);

// ── un solo video ─────────────────────────────────────────────────────────
const lista = path.join(TMP, 'concat.txt');
fs.writeFileSync(lista, plan.map((p) => `file '${p.destino.replace(/\\/g, '/')}'`).join('\n'));
const mudo = path.join(TMP, 'master-mudo.mp4');
ff(['-y', '-v', 'error', '-f', 'concat', '-safe', '0', '-i', lista, '-c', 'copy', '-movflags', '+faststart', mudo]);

// ── cama sonora, discreta ─────────────────────────────────────────────────
/* Un acorde de la menor sostenido, filtrado y a -28 dB: no se escucha, se
   siente. Está para que el video no se sienta muerto, no para adornar. */
const D = Math.ceil(acumulado) + 1;
const musica = path.join(TMP, 'cama.wav');
ff(['-y', '-v', 'error',
  '-f', 'lavfi', '-i', `sine=frequency=110:sample_rate=48000:duration=${D}`,
  '-f', 'lavfi', '-i', `sine=frequency=164.81:sample_rate=48000:duration=${D}`,
  '-f', 'lavfi', '-i', `sine=frequency=220:sample_rate=48000:duration=${D}`,
  '-f', 'lavfi', '-i', `sine=frequency=261.63:sample_rate=48000:duration=${D}`,
  '-f', 'lavfi', '-i', `anoisesrc=color=brown:sample_rate=48000:duration=${D}:amplitude=0.5`,
  '-filter_complex',
  '[0]volume=0.30[a];[1]volume=0.17[b];[2]volume=0.13[c];[3]volume=0.09[d];' +
  '[a][b][c][d]amix=inputs=4:normalize=0[tono];' +
  '[4]volume=0.05,highpass=f=180,lowpass=f=800[aire];' +
  '[tono][aire]amix=inputs=2:normalize=0,' +
  'lowpass=f=1300,tremolo=f=0.12:d=0.26,' +
  'aecho=0.8:0.85:430|810:0.26|0.17,' +
  `volume=5dB,afade=t=in:st=0:d=4,afade=t=out:st=${(acumulado - 5).toFixed(2)}:d=5,alimiter=limit=0.13:level=disabled[out]`,
  '-map', '[out]', '-ac', '2', '-ar', '48000', musica]);

const master = path.join(ROOT, 'TABA2-WALTER-DEMO.mp4');
ff(['-y', '-v', 'error', '-i', mudo, '-i', musica,
  '-c:v', 'copy', '-c:a', 'aac', '-b:a', '160k', '-shortest',
  '-metadata', 'title=TABA2 — demostración comercial',
  '-metadata', 'comment=Interfaces reales de TABA2. Datos de demostración, pruebas y homologación, rotulados en pantalla.',
  '-movflags', '+faststart', master]);

const masterMudo = path.join(ROOT, 'TABA2-WALTER-DEMO-sin-musica.mp4');
fs.copyFileSync(mudo, masterMudo);

// ── subtítulos ────────────────────────────────────────────────────────────
const srt = cues.map((c, i) => `${i + 1}\n${hhmmss(c.ini)} --> ${hhmmss(c.fin)}\n${c.texto}\n`).join('\n');
fs.writeFileSync(path.join(ROOT, 'TABA2-WALTER-DEMO.srt'), srt, 'utf8');

// ── hoja de montaje ───────────────────────────────────────────────────────
const hoja = [
  '# clips/ — montaje del video',
  '',
  'Los clips están numerados en orden de aparición y ya vienen recortados, ajustados',
  'de ritmo y codificados igual (H.264, 1920×1080, 30 fps, sin audio). Para rearmar el',
  'video basta pegarlos en orden; para cambiar el montaje, reemplazá o sacá el clip que',
  'quieras y volvé a correr `node _work/build.mjs`.',
  '',
  '| # | Clip | Entra | Dura | Qué muestra |',
  '| --- | --- | --- | --- | --- |',
  ...plan.map((p, i) => `| ${i + 1} | \`${p.archivo}.mp4\` | ${mmss(p.inicio)} | ${p.duracion.toFixed(1)} s | ${p.titulo} |`),
  '',
  `**Duración total:** ${mmss(acumulado)} (${acumulado.toFixed(1)} s)`,
  '',
  '## Cómo se rearma',
  '',
  '```bash',
  '# la lista, en orden',
  'printf "file \'%s\'\\n" clips/*.mp4 > lista.txt',
  'ffmpeg -f concat -safe 0 -i lista.txt -c copy TABA2-WALTER-DEMO.mp4',
  '```',
  '',
  '## Cómo se le pone una voz encima',
  '',
  'La narración está en `VIDEO-SCRIPT.md` con sus tiempos, y en `TABA2-WALTER-DEMO.srt`.',
  'Si Marco graba su voz (`voz.wav`), se monta así:',
  '',
  '```bash',
  'ffmpeg -i TABA2-WALTER-DEMO-sin-musica.mp4 -i voz.wav \\',
  '  -c:v copy -c:a aac -b:a 192k -shortest TABA2-WALTER-DEMO-con-voz.mp4',
  '```',
  '',
  'Conviene grabar sobre `-sin-musica.mp4`: la cama sonora del master está a −28 dB y',
  'compite con una voz cercana.',
].join('\n');
fs.writeFileSync(path.join(CLIPS, 'CLIPS.md'), hoja, 'utf8');

fs.writeFileSync(path.join(ROOT, '_work', 'plan.json'), JSON.stringify({ total: acumulado, plan, cues }, null, 1));
console.log(`\nmaster    → ${master} (${(fs.statSync(master).size / 1e6).toFixed(1)} MB)`);
console.log(`sin música→ ${masterMudo}`);
console.log(`subtítulos→ ${cues.length} líneas`);
