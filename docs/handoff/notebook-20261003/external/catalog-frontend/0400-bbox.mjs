import sharp from 'sharp';

/** Caja del contenido, con margen, y el canal de blanco que la rodea. */
for (const archivo of process.argv.slice(2)) {
  const { data, info } = await sharp(archivo).flatten({ background: '#ffffff' }).raw().toBuffer({ resolveWithObject: true });
  const { width, height, channels } = info;
  const blanco = (x, y) => {
    const i = (y * width + x) * channels;
    return data[i] >= 245 && data[i + 1] >= 245 && data[i + 2] >= 245;
  };
  let x0 = width; let y0 = height; let x1 = -1; let y1 = -1;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (blanco(x, y)) continue;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
    }
  }
  const margen = 30;
  const left = Math.max(0, x0 - margen);
  const top = Math.max(0, y0 - margen);
  const right = Math.min(width, x1 + 1 + margen);
  const bottom = Math.min(height, y1 + 1 + margen);
  console.log(`${archivo.split(/[\\/]/).pop()}  ${width}x${height}  contenido ${x0}-${x1} x ${y0}-${y1}  ->  recorte {left:${left}, top:${top}, width:${right - left}, height:${bottom - top}}`);
}
