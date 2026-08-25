/*
 * Genera las láminas de góndola de TABA desde su especificación.
 *
 *   node scripts/catalog-images/generar-laminas-taba.mjs            (escribe)
 *   node scripts/catalog-images/generar-laminas-taba.mjs --verificar (falla si algo cambió)
 *
 * El modo `--verificar` es la prueba de procedencia: si un archivo de
 * `assets/products/taba/` no es exactamente lo que produce el generador, es
 * porque vino de otro lado, y entonces no es obra propia y no se puede publicar
 * con esa etiqueta. Corre en `npm run check`.
 */
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { dibujarLamina, huellaContenido } from './lamina-taba.mjs';

const ROOT = path.resolve(import.meta.dirname, '../..');
const SPEC = path.join(ROOT, 'catalog/lamina-taba/especificacion.json');
const DESTINO = path.join(ROOT, 'assets/products/taba');
const MANIFIESTO = path.join(ROOT, 'js/core/taba-packshot-manifest.js');
const verificar = process.argv.includes('--verificar');

const spec = JSON.parse(fs.readFileSync(SPEC, 'utf8'));
const problemas = [];

const piezas = spec.productos.map((producto) => {
  const paleta = spec.paletas[producto.paleta];
  if (!paleta) throw new Error(`${producto.sku}: paleta desconocida «${producto.paleta}»`);
  const svg = dibujarLamina({ ...producto, paleta });
  const archivo = `${producto.sku}-${huellaContenido(svg)}.svg`;
  return { archivo, producto, svg };
});

// La lámina genérica: el respaldo del respaldo, para un producto que todavía no
// tiene su pieza en la especificación. Es la misma familia visual, en gris.
const generica = dibujarLamina({
  sku: 'taba-generica',
  envase: 'pet-familiar',
  paleta: spec.paletas.generica,
  escala: 1,
});
piezas.push({
  archivo: `generica-${huellaContenido(generica)}.svg`,
  producto: { sku: '__generica__', envase: 'pet-familiar', paleta: 'generica' },
  svg: generica,
});

const esperados = new Map(piezas.map((p) => [p.archivo, p.svg]));

const lineas = piezas
  .filter((p) => p.producto.sku !== '__generica__')
  .map((p) => `  '${p.producto.sku}': '${RUTA_PUBLICA(p.archivo)}',`)
  .join('\n');

function RUTA_PUBLICA(archivo) {
  return `assets/products/taba/${archivo}`;
}

const manifiesto = `/*
 * GENERADO por scripts/catalog-images/generar-laminas-taba.mjs — no editar a mano.
 *
 * Qué lámina propia de TABA le corresponde a cada producto. El nombre del
 * archivo lleva la huella de su contenido: cambiar el dibujo cambia la ruta, así
 * que una caché vieja nunca sirve una lámina vieja.
 *
 * Fuente: catalog/lamina-taba/especificacion.json (schemaVersion ${spec.schemaVersion}).
 */
export const LAMINA_GENERICA = '${RUTA_PUBLICA(piezas.at(-1).archivo)}';

export const LAMINAS_TABA = Object.freeze({
${lineas}
});
`;

if (verificar) {
  const enDisco = fs.existsSync(DESTINO) ? fs.readdirSync(DESTINO).filter((f) => f.endsWith('.svg')) : [];
  for (const [archivo, svg] of esperados) {
    const ruta = path.join(DESTINO, archivo);
    if (!fs.existsSync(ruta)) {
      problemas.push(`falta ${RUTA_PUBLICA(archivo)}`);
      continue;
    }
    if (fs.readFileSync(ruta, 'utf8') !== svg) problemas.push(`${RUTA_PUBLICA(archivo)} no es lo que produce el generador`);
  }
  for (const archivo of enDisco) {
    if (!esperados.has(archivo)) problemas.push(`sobra ${RUTA_PUBLICA(archivo)}: no sale de la especificación`);
  }
  const actual = fs.existsSync(MANIFIESTO) ? fs.readFileSync(MANIFIESTO, 'utf8') : '';
  if (actual !== manifiesto) problemas.push('js/core/taba-packshot-manifest.js está desactualizado');

  if (problemas.length) {
    console.error('LAMINAS DE TABA: la obra propia no coincide con su generador');
    for (const p of problemas) console.error(`  · ${p}`);
    console.error('  Correr: node scripts/catalog-images/generar-laminas-taba.mjs');
    process.exit(1);
  }
  console.log(`Láminas de TABA: ${esperados.size} archivos verificados byte a byte contra el generador.`);
  process.exit(0);
}

fs.mkdirSync(DESTINO, { recursive: true });
for (const archivo of fs.existsSync(DESTINO) ? fs.readdirSync(DESTINO) : []) {
  if (archivo.endsWith('.svg') && !esperados.has(archivo)) fs.unlinkSync(path.join(DESTINO, archivo));
}
for (const [archivo, svg] of esperados) fs.writeFileSync(path.join(DESTINO, archivo), svg, 'utf8');
fs.writeFileSync(MANIFIESTO, manifiesto, 'utf8');

const bytes = [...esperados.values()].reduce((total, svg) => total + Buffer.byteLength(svg, 'utf8'), 0);
console.log(`Láminas de TABA: ${esperados.size} archivos · ${(bytes / 1024).toFixed(1)} KB en total`);
console.log(`  assets/products/taba/ · js/core/taba-packshot-manifest.js`);
