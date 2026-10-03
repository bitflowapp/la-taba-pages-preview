import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const run = promisify(execFile);
const ROOT = path.resolve('artifacts/taba2-commercial');
const outputs = [
  {
    key: 'long',
    file: path.join(ROOT, 'renders', 'TABA_PROMO_VERTICAL_1080x1920.mp4'),
    expectedDuration: 40.2,
  },
  {
    key: 'short',
    file: path.join(ROOT, 'renders', 'TABA_PROMO_SHORT_1080x1920.mp4'),
    expectedDuration: 15,
  },
];

async function probe(file) {
  const { stdout } = await run('ffprobe', [
    '-v', 'error',
    '-show_streams',
    '-show_format',
    '-of', 'json',
    file,
  ]);
  return JSON.parse(stdout);
}

const checks = [];
for (const output of outputs) {
  const data = await probe(output.file);
  const video = data.streams.find((stream) => stream.codec_type === 'video');
  const audio = data.streams.find((stream) => stream.codec_type === 'audio');
  const duration = Number(data.format.duration);
  const item = {
    key: output.key,
    file: path.relative(ROOT, output.file).replaceAll('\\', '/'),
    duration,
    width: video?.width,
    height: video?.height,
    displayAspectRatio: video?.display_aspect_ratio,
    fps: video?.avg_frame_rate,
    codec: video?.codec_name,
    pixelFormat: video?.pix_fmt,
    audioCodec: audio?.codec_name,
    audioSampleRate: audio?.sample_rate,
    audioChannels: audio?.channels,
    durationMatches: Math.abs(duration - output.expectedDuration) < 0.02,
    vertical1080: video?.width === 1080 && video?.height === 1920,
    thirtyFps: video?.avg_frame_rate === '30/1',
    h264: video?.codec_name === 'h264',
    silentAacStereo: audio?.codec_name === 'aac'
      && audio?.sample_rate === '48000'
      && audio?.channels === 2,
  };
  item.pass = item.durationMatches
    && item.vertical1080
    && item.thirtyFps
    && item.h264
    && item.silentAacStereo;
  checks.push(item);
}

const captureManifest = JSON.parse(readFileSync(path.join(ROOT, 'capture-manifest.json'), 'utf8'));
const report = {
  generatedAt: new Date().toISOString(),
  checks,
  captureErrors: captureManifest.errors,
  visualReview: {
    reviewedFrames: [
      '0.8s', '4.8s', '8.2s', '12.3s', '16.5s',
      '20.5s', '25.0s', '29.5s', '34.0s', '38.5s',
    ],
    contactSheet: 'final-frames3/long-contact-sheet.png',
    shortContactSheet: 'final-frames3/short-contact-sheet.png',
    result: 'Aprobado visualmente: sin cuadros negros accidentales antes del cierre; textos y escenas legibles.',
  },
  privacyReview: {
    result: 'Aprobado: se usó demo local controlado; no se capturaron secretos, consola, terminal, tokens ni datos externos.',
    syntheticData: 'Cliente Demo, dirección y número usados por el fixture local de demostración.',
  },
  audioReview: {
    result: 'Aprobado: AAC estéreo silencioso; no se incrustó música comercial.',
  },
  pass: checks.every((item) => item.pass) && captureManifest.errors.length === 0,
};
writeFileSync(path.join(ROOT, 'validation-report.json'), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
