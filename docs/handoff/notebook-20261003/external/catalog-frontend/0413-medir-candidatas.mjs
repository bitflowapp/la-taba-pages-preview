import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';

const dir = process.argv[2] || 'D:/1212/_premium-tmp/cand/';
const files = fs.readdirSync(dir).filter((f) => /\.(jpg|jpeg|png|webp)$/i.test(f)).sort();
for (const f of files) {
  const ruta = path.join(dir, f);
  const meta = await sharp(ruta).metadata();
  let info = null;
  try {
    const t = await sharp(ruta).flatten({ background: '#ffffff' }).trim({ threshold: 14 }).toBuffer({ resolveWithObject: true });
    info = t.info;
  } catch { /* imagen uniforme */ }
  const producto = info ? `${info.width}x${info.height}` : '(sin recorte)';
  const pct = info ? Math.round((100 * info.height) / meta.height) : 0;
  console.log(`${f.padEnd(30)} ${(meta.width + 'x' + meta.height).padEnd(11)} producto ${producto.padEnd(11)} ${pct}% del alto`);
}
