/* Regenera sólo la cama sonora y vuelve a mezclar, sin recodificar el video. */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
const ROOT = 'D:/1212/artifacts/taba2-walter-commercial-demo';
const TMP = path.join(ROOT, '_work', 'tmp');
const plan = JSON.parse(fs.readFileSync(path.join(ROOT, '_work', 'plan.json'), 'utf8'));
const acumulado = plan.total;
const D = Math.ceil(acumulado) + 1;
const musica = path.join(TMP, 'cama.wav');
const GAIN = process.argv[2] || '5dB';
execFileSync('ffmpeg', ['-y', '-v', 'error',
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
  `volume=${GAIN},afade=t=in:st=0:d=4,afade=t=out:st=${(acumulado - 5).toFixed(2)}:d=5,alimiter=limit=0.13:level=disabled[out]`,
  '-map', '[out]', '-ac', '2', '-ar', '48000', musica], { stdio: 'inherit' });
execFileSync('ffmpeg', ['-y', '-v', 'error', '-i', path.join(TMP, 'master-mudo.mp4'), '-i', musica,
  '-c:v', 'copy', '-c:a', 'aac', '-b:a', '160k', '-shortest',
  '-metadata', 'title=TABA2 — demostración comercial',
  '-metadata', 'comment=Interfaces reales de TABA2. Datos de demostración, pruebas y homologación, rotulados en pantalla.',
  '-movflags', '+faststart', path.join(ROOT, 'TABA2-WALTER-DEMO.mp4')], { stdio: 'inherit' });
console.log('mezcla lista con ganancia', GAIN);
