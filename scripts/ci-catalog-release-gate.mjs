/*
 * La compuerta de catálogo de release, corrida donde corresponde.
 *
 * EL DEFECTO QUE REPARA
 * ---------------------
 * `ci.yml` corría `npm run catalog:release:validate` sin argumento y sin
 * `TABA_CATALOG_FILE`. Ese guion falla cerrado cuando no le indican un catálogo,
 * y eso NO es un descuido suyo: está documentado en tres lugares
 *
 *   docs/final-commercial-release/test-results.md   «Gates fail-closed esperados»
 *   docs/final-commercial-release/remaining-external-data.md
 *   docs/catalog/taba-product-import-guide.md       `-- data/catalog-real.csv`
 *
 * y hay una prueba que lo exige (`tests/catalog-release-gates.test.mjs`:
 * «release catalog gate fails closed without an explicitly supplied real
 * catalog»). O sea que el paso de CI, tal como estaba escrito, no podía pasar
 * NUNCA. Y como vive en `main`, tampoco podía pasar ninguna rama.
 *
 * POR QUÉ NO SE ARREGLA APUNTÁNDOLO A UN ARCHIVO DEL REPOSITORIO
 * --------------------------------------------------------------
 * Porque el archivo que ese validador quiere no está —ni tiene que estar— acá.
 * Es el catálogo comercial aprobado, con precios y stock vigentes, y se indica
 * en el momento del release. `data/catalog-template.csv` son las 21 columnas y
 * cero filas; `catalog/products.csv` tiene otra disposición y otro propósito, y
 * apuntarle da 2.067 errores sobre 92 filas —medido— porque además el validador
 * exige imagen aprobada para CADA producto, que es justo lo contrario de lo que
 * el runtime comercial permite hoy (la migración 108 dejó de exigir imagen para
 * publicar, y 30 de los 33 SKU comprables se venden con el respaldo propio).
 *
 * Forzar cualquiera de esas dos cosas sería cambiar la política comercial para
 * que un paso de CI se ponga verde. Al revés de como se hacen las cosas.
 *
 * QUÉ HACE ENTONCES
 * -----------------
 * Distingue tres estados, que hoy CI confundía en uno solo:
 *
 *   HAY CATÁLOGO      corre la compuerta estricta y deja pasar su código de
 *                     salida tal cual. Sigue siendo fail-closed.
 *   MAL INDICADO      la variable está puesta y el archivo no existe. Falla:
 *                     una variable mal escrita no puede parecerse a «no había».
 *   NO HAY CATÁLOGO   dice en voz alta que la compuerta NO corrió, qué habría
 *                     validado y dónde sí corre, y sale con 0.
 *
 * Ese último caso no es un `|| true`: no afirma que el catálogo comercial esté
 * validado. Afirma lo contrario, y lo deja escrito en el log para que un verde
 * de CI no se lea como algo que no pasó.
 *
 * La compuerta estricta NO se toca: `npm run verify` y `npm run release:folder`
 * la siguen corriendo con sus dientes puestos, que es donde el catálogo real
 * existe.
 *
 *   node scripts/ci-catalog-release-gate.mjs
 *   TABA_CATALOG_FILE=data/catalog-real.csv node scripts/ci-catalog-release-gate.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { spawnSync } from 'node:child_process';

const ROOT = path.resolve(import.meta.dirname, '..');
const ESTRICTA = path.join(ROOT, 'scripts/validate-release-catalog.mjs');

const indicado = (process.argv[2] || process.env.TABA_CATALOG_FILE || '').trim();

if (!indicado) {
  console.log('Compuerta de catálogo de release: NO CORRIÓ.');
  console.log('');
  console.log('  Por qué: no se indicó un catálogo comercial aprobado. Se indica con la');
  console.log('  variable TABA_CATALOG_FILE o pasando su ruta como argumento.');
  console.log('');
  console.log('  Qué NO quedó validado acá: identidad, precios, stock, disponibilidad y');
  console.log('  correspondencia con el manifiesto de imágenes de ese catálogo.');
  console.log('');
  console.log('  Dónde sí corre: `npm run verify` y `npm run release:folder`, en el momento');
  console.log('  del release, donde el archivo aprobado existe. Ahí sigue fallando cerrado.');
  console.log('');
  console.log('  Lo que CI sí validó del catálogo: la cadena de imágenes —archivos, hashes,');
  console.log('  binding y derechos— en el paso `catalog:images:verify`, que corre siempre.');
  process.exit(0);
}

const resuelto = path.resolve(ROOT, indicado);
if (!fs.existsSync(resuelto)) {
  console.error('Compuerta de catálogo de release: MAL INDICADA.');
  console.error(`  Se indicó «${indicado}» y ese archivo no existe (${resuelto}).`);
  console.error('  Una variable mal escrita no se parece a «no había catálogo»: si se pidió');
  console.error('  validar un catálogo, hay que validarlo o decir por qué no se pudo.');
  process.exit(1);
}

console.log(`Compuerta de catálogo de release: CORRIENDO sobre ${indicado}.`);
const resultado = spawnSync(process.execPath, [ESTRICTA, resuelto], {
  cwd: ROOT,
  encoding: 'utf8',
  shell: false,
  stdio: 'inherit',
});
process.exit(resultado.status ?? 1);
