/*
 * Mira lo que REALMENTE quedó adentro del paquete.
 *
 * POR QUÉ NO ALCANZA CON MIRAR products.image_url
 * ------------------------------------------------
 * Un archivo que se sube queda servido, con URL propia, alcanzable por
 * cualquiera, lo referencie o no algún producto. El control de derechos que sólo
 * mira qué imágenes están enlazadas deja pasar exactamente el caso que importa:
 * el archivo huérfano que igual está publicado. Este guion abre `dist_release/`
 * y compara archivo por archivo contra la lista de publicables.
 *
 *   node scripts/catalog-images/package-scan.mjs
 *
 * Salida 0 = el paquete sólo lleva lo que puede llevar.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { auditProductImageRights, PRODUCT_IMAGE_NAMESPACES } from '../lib/publishable-image-rights.mjs';
import { sha256, stableJson } from './lib.mjs';

const ROOT = path.resolve(import.meta.dirname, '../..');
const PAQUETE = path.join(ROOT, 'dist_release');
const SALIDA = path.join(ROOT, 'artifacts/taba2-catalog-images/PACKAGE-SCAN.json');
const IMAGEN = /\.(webp|jpe?g|png|avif|svg|gif|bmp|tiff?)$/i;

async function caminar(dir, base, salida = []) {
  const entradas = await fs.readdir(dir, { withFileTypes: true }).catch(() => []);
  for (const entrada of entradas) {
    const absoluta = path.join(dir, entrada.name);
    if (entrada.isDirectory()) await caminar(absoluta, base, salida);
    else salida.push(path.relative(base, absoluta).replaceAll('\\', '/'));
  }
  return salida;
}

if (!await fs.stat(PAQUETE).catch(() => null)) {
  console.error(`ERROR No existe ${path.relative(ROOT, PAQUETE)}. Correr antes el armado del paquete.`);
  process.exit(1);
}

const auditoria = auditProductImageRights(ROOT);
const publicables = new Map(auditoria.filter((i) => i.publishable).map((i) => [i.path, i.rights]));
const bloqueadas = new Map(auditoria.filter((i) => !i.publishable).map((i) => [i.path, i.rights]));

const enPaquete = await caminar(PAQUETE, PAQUETE);
const imagenesDeProducto = enPaquete.filter((ruta) => (
  IMAGEN.test(ruta) && PRODUCT_IMAGE_NAMESPACES.some((ns) => ruta.startsWith(ns))
));

const intrusas = [];
const legitimas = [];
for (const ruta of imagenesDeProducto) {
  if (publicables.has(ruta)) {
    legitimas.push({ derechos: publicables.get(ruta), ruta });
    continue;
  }
  intrusas.push({
    derechos: bloqueadas.get(ruta) || 'no está declarada en ningún manifiesto',
    motivo: bloqueadas.has(ruta) ? 'declarada sin derechos para publicar' : 'no figura entre las publicables',
    ruta,
  });
}

// Un activo que el manifiesto declara publicable pero no llegó al paquete es la
// otra cara del mismo error: la ficha va a pedir una URL que devuelve 404.
const faltantes = [...publicables.keys()].filter((ruta) => !imagenesDeProducto.includes(ruta));

// El contenido tiene que ser el mismo, no sólo el nombre. Un archivo cambiado
// después de auditarlo es un archivo sin auditar.
const alteradas = [];
for (const { ruta } of legitimas) {
  const [enRepo, enDist] = await Promise.all([
    fs.readFile(path.join(ROOT, ruta)).catch(() => null),
    fs.readFile(path.join(PAQUETE, ruta)).catch(() => null),
  ]);
  if (!enRepo || !enDist) continue;
  if (sha256(enRepo) !== sha256(enDist)) alteradas.push(ruta);
}

const informe = {
  alteradas,
  archivosEnPaquete: enPaquete.length,
  faltantes,
  fotosDeProductoEnPaquete: imagenesDeProducto.length,
  intrusas,
  legitimas,
  schemaVersion: 1,
  veredicto: intrusas.length === 0 && faltantes.length === 0 && alteradas.length === 0 ? 'LIMPIO' : 'SUCIO',
};
await fs.mkdir(path.dirname(SALIDA), { recursive: true });
await fs.writeFile(SALIDA, stableJson(informe), 'utf8');

console.log(`Archivos en el paquete: ${enPaquete.length}`);
console.log(`Fotos de producto: ${imagenesDeProducto.length} (${legitimas.length} con derechos)`);
for (const intrusa of intrusas) console.error(`INTRUSA ${intrusa.ruta} — ${intrusa.motivo} (${intrusa.derechos})`);
for (const faltante of faltantes) console.error(`FALTA ${faltante} — declarada publicable y no llegó al paquete`);
for (const alterada of alteradas) console.error(`ALTERADA ${alterada} — el archivo del paquete no coincide con el auditado`);
console.log(`Informe: ${path.relative(ROOT, SALIDA).replaceAll('\\', '/')}`);
console.log(informe.veredicto === 'LIMPIO' ? 'PAQUETE LIMPIO.' : 'PAQUETE SUCIO.');
process.exit(informe.veredicto === 'LIMPIO' ? 0 : 1);
