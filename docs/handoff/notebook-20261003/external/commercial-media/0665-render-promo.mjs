import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';

const ROOT = path.resolve('artifacts/taba2-commercial');
const RENDER = path.join(ROOT, 'renders');
const CAPTIONS = path.join(ROOT, 'captions');
mkdirSync(RENDER, { recursive: true });
mkdirSync(CAPTIONS, { recursive: true });

const manifest = JSON.parse(readFileSync(path.join(ROOT, 'capture-manifest.json'), 'utf8'));
const clipByName = new Map(manifest.clips.map((clip) => [clip.name, clip]));

const longScenes = [
  ['01-hook-home', 3.2, '¿Y si tu comercio tuviera su propia\\Nplataforma de pedidos?'],
  ['02-catalog-search', 3.7, 'Catálogo claro. Pedido en segundos.'],
  ['03-product-detail', 3.7, 'Productos, precios y disponibilidad.'],
  ['04-cart-checkout', 4.4, 'Delivery o retiro. Sin fricción.'],
  ['05-order-confirmed', 3.7, 'Cada pedido tiene su propio seguimiento.'],
  ['06-business-inbox', 4.5, 'Y el comercio sabe qué hacer primero.'],
  ['07-business-states', 4.6, 'Estados claros para operar mejor.'],
  ['08-rider-dispatch', 4.2, 'Cliente, comercio y reparto conectados.'],
  ['09-tracking-wow', 4.7, 'Un sistema de verdad detrás de cada pedido.'],
];

const endCardDuration = 3.5;
const shortScenes = [
  ['01-hook-home', 2.4],
  ['04-cart-checkout', 3.4],
  ['07-business-states', 3.2],
  ['09-tracking-wow', 3.6],
];
const shortEndCardDuration = 2.4;

function run(command, args, label) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd: ROOT, windowsHide: true });
    let stderr = '';
    child.stderr.on('data', (chunk) => { stderr += chunk.toString(); });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) return resolve();
      reject(new Error(label + ' falló (' + code + '): ' + stderr.slice(-4000)));
    });
  });
}

function assHeader() {
  return [
    '[Script Info]',
    'ScriptType: v4.00+',
    'PlayResX: 1080',
    'PlayResY: 1920',
    'ScaledBorderAndShadow: yes',
    '',
    '[V4+ Styles]',
    'Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding',
    'Style: Caption,Arial,50,&H00FFFFFF,&H00FFFFFF,&H00000000,&HAA090B10,-1,0,0,0,100,100,0,0,3,18,0,2,70,70,215,1',
    'Style: CaptionSmall,Arial,42,&H00FFFFFF,&H00FFFFFF,&H00000000,&HAA090B10,-1,0,0,0,100,100,0,0,3,16,0,2,70,70,215,1',
    '',
    '[Events]',
    'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text',
  ].join('\n') + '\n';
}

function assTime(seconds) {
  const centiseconds = Math.round(seconds * 100);
  const hours = Math.floor(centiseconds / 360000);
  const minutes = Math.floor((centiseconds % 360000) / 6000);
  const rest = centiseconds % 6000;
  const secs = Math.floor(rest / 100);
  const cs = rest % 100;
  return hours + ':' + String(minutes).padStart(2, '0') + ':' + String(secs).padStart(2, '0') + '.' + String(cs).padStart(2, '0');
}

function writeCaption(name, duration, text) {
  const file = path.join(CAPTIONS, name + '.ass');
  const content = assHeader() + 'Dialogue: 0,0:00:00.00,' + assTime(duration) + ',Caption,,0,0,0,,' + text + '\n';
  writeFileSync(file, content);
  return path.relative(ROOT, file).replaceAll('\\', '/');
}

function writeEndCard() {
  const file = path.join(CAPTIONS, 'endcard.ass');
  const content = [
    '[Script Info]',
    'ScriptType: v4.00+',
    'PlayResX: 1080',
    'PlayResY: 1920',
    'ScaledBorderAndShadow: yes',
    '',
    '[V4+ Styles]',
    'Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding',
    'Style: Title,Arial,112,&H00FFFFFF,&H00FFFFFF,&H00000000,&H00000000,-1,0,0,0,100,100,0,0,1,0,0,5,60,60,0,1',
    'Style: Accent,Arial,60,&H000000E8,&H000000E8,&H00000000,&H00000000,-1,0,0,0,100,100,0,0,1,0,0,5,60,60,0,1',
    'Style: Sub,Arial,50,&H00D6D9E1,&H00D6D9E1,&H00000000,&H00000000,0,0,0,0,100,100,0,0,1,0,0,5,60,60,0,1',
    'Style: Cta,Arial,48,&H00FFFFFF,&H00FFFFFF,&H00000000,&H00000000,-1,0,0,0,100,100,0,0,1,0,0,5,60,60,0,1',
    '',
    '[Events]',
    'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text',
    'Dialogue: 0,0:00:00.00,0:00:03.50,Title,,0,0,0,,TABA',
    'Dialogue: 0,0:00:00.00,0:00:03.50,Accent,,0,0,0,,PRODUCTO + OPERACIÓN',
    'Dialogue: 0,0:00:00.00,0:00:03.50,Sub,,0,0,0,,Software hecho a medida\\NUn caso real de delivery',
    'Dialogue: 0,0:00:00.00,0:00:03.50,Cta,,0,0,0,,LUNA · Contanos qué necesita tu negocio.',
  ].join('\n') + '\n';
  writeFileSync(file, content);
  return path.relative(ROOT, file).replaceAll('\\', '/');
}

async function renderClip(name, duration, caption) {
  const source = clipByName.get(name);
  if (!source) throw new Error('No existe la fuente ' + name);
  const captionFile = writeCaption(name, duration, caption);
  const output = path.join(RENDER, name + '.mp4');
  const filter = 'scale=1080:1920:flags=lanczos,fps=30,setpts=PTS-STARTPTS,subtitles=' + captionFile;
  await run('ffmpeg', [
    '-hide_banner', '-loglevel', 'error', '-y',
    '-ss', String(source.trimStart),
    '-i', source.raw,
    '-t', String(duration),
    '-vf', filter,
    '-an',
    '-c:v', 'libx264', '-preset', 'medium', '-crf', '18',
    '-pix_fmt', 'yuv420p', '-movflags', '+faststart',
    output,
  ], 'render ' + name);
  return output;
}

async function renderEndCard(duration) {
  const assFile = writeEndCard();
  const output = path.join(RENDER, 'endcard.mp4');
  const filter = 'drawbox=x=0:y=0:w=1080:h=18:color=0xE00018:t=fill,subtitles=' + assFile;
  await run('ffmpeg', [
    '-hide_banner', '-loglevel', 'error', '-y',
    '-f', 'lavfi', '-i', 'color=c=0B0D11:s=1080x1920:r=30:d=' + String(duration),
    '-vf', filter,
    '-an',
    '-c:v', 'libx264', '-preset', 'medium', '-crf', '18',
    '-pix_fmt', 'yuv420p', '-movflags', '+faststart',
    output,
  ], 'render end card');
  return output;
}

function writeConcatList(files, name) {
  const file = path.join(RENDER, name);
  writeFileSync(file, files.map((item) => "file '" + item.replaceAll('\\', '/') + "'").join('\n') + '\n');
  return file;
}

async function concatVideo(files, output, label) {
  const list = writeConcatList(files, label + '-concat.txt');
  const noAudio = output + '.noaudio.mp4';
  await run('ffmpeg', [
    '-hide_banner', '-loglevel', 'error', '-y',
    '-f', 'concat', '-safe', '0', '-i', list,
    '-an', '-c', 'copy', '-movflags', '+faststart', noAudio,
  ], label + ' concat');
  await run('ffmpeg', [
    '-hide_banner', '-loglevel', 'error', '-y',
    '-i', noAudio,
    '-f', 'lavfi', '-i', 'anullsrc=r=48000:cl=stereo',
    '-map', '0:v:0', '-map', '1:a:0',
    '-c:v', 'copy', '-c:a', 'aac', '-b:a', '128k',
    '-shortest', '-movflags', '+faststart', output,
  ], label + ' silent audio');
  return { output, noAudio, list };
}

async function trimPart(source, name, duration) {
  const output = path.join(RENDER, 'short-' + name + '.mp4');
  await run('ffmpeg', [
    '-hide_banner', '-loglevel', 'error', '-y',
    '-i', source,
    '-t', String(duration),
    '-an', '-c:v', 'libx264', '-preset', 'medium', '-crf', '18',
    '-pix_fmt', 'yuv420p', '-movflags', '+faststart', output,
  ], 'short trim ' + name);
  return output;
}

const rendered = [];
for (const [name, duration, caption] of longScenes) {
  rendered.push(await renderClip(name, duration, caption));
}
const endCard = await renderEndCard(endCardDuration);
const long = await concatVideo(
  [...rendered, endCard],
  path.join(RENDER, 'TABA_PROMO_VERTICAL_1080x1920.mp4'),
  'long',
);

const shortParts = [];
for (const [name, duration] of shortScenes) {
  shortParts.push(await trimPart(path.join(RENDER, name + '.mp4'), name, duration));
}
shortParts.push(await trimPart(endCard, 'endcard', shortEndCardDuration));
const short = await concatVideo(
  shortParts,
  path.join(RENDER, 'TABA_PROMO_SHORT_1080x1920.mp4'),
  'short',
);

writeFileSync(path.join(ROOT, 'render-manifest.json'), JSON.stringify({
  sourceManifest: 'capture-manifest.json',
  output: {
    width: 1080,
    height: 1920,
    fps: 30,
    audio: 'silent AAC stereo track; no commercial music embedded',
    long: {
      file: 'renders/TABA_PROMO_VERTICAL_1080x1920.mp4',
      durationTarget: 40.2,
      scenes: longScenes.map(([name, duration, caption]) => ({ name, duration, caption })),
      endCardDuration,
    },
    short: {
      file: 'renders/TABA_PROMO_SHORT_1080x1920.mp4',
      durationTarget: 15,
      scenes: shortScenes.map(([name, duration]) => ({ name, duration })),
      endCardDuration: shortEndCardDuration,
    },
  },
  artifacts: {
    longConcat: path.relative(ROOT, long.list),
    shortConcat: path.relative(ROOT, short.list),
  },
}, null, 2));

console.log(JSON.stringify({
  long: long.output,
  short: short.output,
  errors: [],
}, null, 2));
