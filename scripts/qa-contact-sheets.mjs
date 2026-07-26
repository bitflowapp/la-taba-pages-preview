import { existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';

const releaseDir = path.resolve('docs/final-commercial-release');
const round = process.argv[2] || 'round-2';
const sourceDir = path.join(releaseDir, `visual-review-${round.replace(/^round-/, 'round-')}`);
const requestedTags = process.argv.slice(3);
const tags = requestedTags.length
  ? requestedTags
  : ['m320', 'm360', 'm390', 'm412', 't768', 'd1280'];

const scenes = [
  'home-new',
  'catalog',
  'no-results',
  'product',
  'cart',
  'checkout-no-alcohol',
  'checkout-alcohol',
  'business',
  'rider-before-accept',
  'tracking-no-gps',
  'tracking-with-gps',
  'rider-delivering',
  'tracking-delivered',
  'home-recurrent',
];

if (!existsSync(sourceDir)) {
  throw new Error(`No existe la evidencia ${sourceDir}.`);
}

mkdirSync(sourceDir, { recursive: true });

for (const tag of tags) {
  const firstPath = path.join(sourceDir, `${tag}-01-${scenes[0]}.png`);
  if (!existsSync(firstPath)) {
    throw new Error(`Falta ${firstPath}.`);
  }

  const metadata = await sharp(firstPath).metadata();
  const sourceWidth = Number(metadata.width);
  const sourceHeight = Number(metadata.height);
  const cellWidth = Math.min(sourceWidth, 640);
  const imageHeight = Math.round(sourceHeight * (cellWidth / sourceWidth));
  const labelHeight = 34;
  const cellHeight = labelHeight + imageHeight;
  const columns = 2;
  const rows = Math.ceil(scenes.length / columns);
  const composites = [];

  for (const [index, scene] of scenes.entries()) {
    const number = String(index + 1).padStart(2, '0');
    const sourcePath = path.join(sourceDir, `${tag}-${number}-${scene}.png`);
    if (!existsSync(sourcePath)) {
      throw new Error(`Falta ${sourcePath}.`);
    }
    const x = (index % columns) * cellWidth;
    const y = Math.floor(index / columns) * cellHeight;
    const image = await sharp(sourcePath)
      .resize({ width: cellWidth, height: imageHeight, fit: 'fill' })
      .png()
      .toBuffer();
    const safeLabel = `${number}-${scene}`.replaceAll('&', '&amp;').replaceAll('<', '&lt;');
    const label = Buffer.from(
      `<svg width="${cellWidth}" height="${labelHeight}" xmlns="http://www.w3.org/2000/svg">
        <rect width="100%" height="100%" fill="#151517"/>
        <text x="10" y="23" fill="#ffffff" font-family="Arial, sans-serif" font-size="15" font-weight="700">${safeLabel}</text>
      </svg>`,
    );
    composites.push({ input: label, left: x, top: y });
    composites.push({ input: image, left: x, top: y + labelHeight });
  }

  const output = path.join(sourceDir, `contact-${tag}.png`);
  await sharp({
    create: {
      width: columns * cellWidth,
      height: rows * cellHeight,
      channels: 3,
      background: '#d7d7da',
    },
  })
    .composite(composites)
    .png({ compressionLevel: 9 })
    .toFile(output);
  console.log(`✓ ${path.relative(process.cwd(), output)}`);
}
