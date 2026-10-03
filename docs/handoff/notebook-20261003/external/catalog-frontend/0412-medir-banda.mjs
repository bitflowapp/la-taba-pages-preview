import sharp from 'sharp';

/*
 * Dónde empieza la banda de marketing, y si hay blanco puro entre el envase y
 * ella. Recortar una banda NO es fabricar una imagen: los píxeles del producto
 * quedan intactos. Pero sólo vale si el corte cae en blanco.
 */
for (const archivo of process.argv.slice(2)) {
  const { data, info } = await sharp(archivo).flatten({ background: '#ffffff' }).raw().toBuffer({ resolveWithObject: true });
  const { width, height, channels } = info;
  const columnaBlanca = new Array(width).fill(true);
  for (let x = 0; x < width; x += 1) {
    for (let y = 0; y < height; y += 1) {
      const i = (y * width + x) * channels;
      if (data[i] < 245 || data[i + 1] < 245 || data[i + 2] < 245) { columnaBlanca[x] = false; break; }
    }
  }
  // Bloques de columnas NO blancas, de izquierda a derecha.
  const bloques = [];
  let inicio = null;
  for (let x = 0; x < width; x += 1) {
    if (!columnaBlanca[x] && inicio === null) inicio = x;
    if (columnaBlanca[x] && inicio !== null) { bloques.push([inicio, x - 1]); inicio = null; }
  }
  if (inicio !== null) bloques.push([inicio, width - 1]);
  console.log(`${archivo.split(/[\\/]/).pop()}  ${width}x${height}  bloques: ${bloques.map(([a, b]) => `${a}-${b}`).join('  |  ')}`);
}
