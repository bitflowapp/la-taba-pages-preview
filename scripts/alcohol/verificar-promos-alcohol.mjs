/*
 * ¿EL AHORRO QUE ANUNCIA CADA COMBO ES REAL, Y SE PUEDE PAGAR?
 *
 * Dos preguntas distintas, y las dos hay que contestarlas antes de publicar un
 * descuento:
 *
 *   1. ¿El ahorro EXISTE? Se calcula con los mismos precios que la góndola, y
 *      con el mismo redondeo que usa `js/core/combos.js`, no con una fórmula
 *      parecida. Si el número de acá y el de la tarjeta no coinciden, uno de
 *      los dos miente.
 *   2. ¿El comercio lo puede SOSTENER? Se calcula contra el costo mayorista
 *      MEDIDO de cada componente y se exige el mismo piso que la góndola le
 *      exige a un pack: ×1,35. Un descuento que no pasa ese piso no es una
 *      promoción, es vender peor.
 *
 * POR QUÉ EL COSTO ES EL QUE MANDA
 * --------------------------------
 * `products.unit_cost` está en NULL en los 72 productos de producción, así que
 * la base no puede aprobar ningún descuento por margen. El costo real vive en
 * el repositorio —`catalog/gondola-neuquen.mjs`, medido el 2026-08-18 en el
 * mayorista— y es la única fuente que permite decir «esto se puede vender a
 * este precio» sin inventar nada. Por eso un componente sin costo medido
 * RECHAZA el combo entero en vez de pasar sin control.
 *
 *   npm run alcohol:promos
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { GONDOLA } from '../../catalog/gondola-neuquen.mjs';
import { PRODUCTOS_PROPUESTOS } from '../../catalog/gondola-retail-final-proposal.mjs';
import { PROMOS_ALCOHOL, DESCUENTOS_DECLARADOS, PISO_MARGEN_COMBO } from '../../catalog/promos-alcohol.mjs';
import { roundPromotionalPrice } from '../../js/core/combos.js';

const ROOT = path.resolve(import.meta.dirname, '../..');
const SALIDA = path.join(ROOT, 'artifacts/taba2-alcohol-commercial/PROMOS-MARGEN.json');

const pesos = (n) => `$${Math.round(n).toLocaleString('es-AR')}`;
const pct = (n) => `${(Math.round(n * 10) / 10).toString().replace('.', ',')} %`;

/* Catálogo indexado. La góndola trae costo medido; la propuesta retail no. */
const porSku = new Map();
for (const p of GONDOLA) porSku.set(p.sku, { ...p, costoMedido: true });
for (const p of PRODUCTOS_PROPUESTOS) {
  if (!porSku.has(p.sku)) porSku.set(p.sku, { ...p, costoMayorista: null, costoMedido: false });
}

let fallas = 0;
const informe = [];

console.log('\nPROMOCIONES DE ALCOHOL · ahorro real y margen sostenible');
console.log(`piso de margen exigido: ×${PISO_MARGEN_COMBO} sobre el costo (el mismo que la góndola le exige a un pack)\n`);

for (const combo of PROMOS_ALCOHOL) {
  const declarado = DESCUENTOS_DECLARADOS[combo.comboId];
  const problemas = [];
  let precioLista = 0;
  let costoTotal = 0;
  const lineas = [];
  let alcoholico = false;

  for (const componente of combo.components) {
    const producto = porSku.get(componente.sku);
    if (!producto) {
      problemas.push(`${componente.sku}: no existe en ninguna autoridad del catálogo.`);
      continue;
    }
    if (!producto.costoMedido || !Number.isFinite(Number(producto.costoMayorista))) {
      problemas.push(
        `${componente.sku}: sin costo mayorista medido (su precio deriva de una referencia minorista). `
        + 'No se puede probar el margen, así que no puede ser componente de una promoción.',
      );
      continue;
    }
    if (producto.soldAsPack) {
      problemas.push(`${componente.sku}: ya es un pack. Meterlo en un combo duplica la misma decisión de compra.`);
      continue;
    }
    const unidades = componente.quantity;
    precioLista += Number(producto.price) * unidades;
    costoTotal += Number(producto.costoMayorista) * unidades;
    if (producto.alcoholic) alcoholico = true;
    lineas.push({
      sku: componente.sku,
      nombre: producto.name,
      cantidad: unidades,
      precioUnitario: Number(producto.price),
      precioLinea: Number(producto.price) * unidades,
      costoUnitario: Number(producto.costoMayorista),
      alcoholic: Boolean(producto.alcoholic),
      sustituciones: componente.substitutions.map((sku) => {
        const s = porSku.get(sku);
        if (!s) problemas.push(`${componente.sku}: la sustitución ${sku} no existe en el catálogo.`);
        else if (Number(s.price) !== Number(producto.price)) {
          problemas.push(
            `${componente.sku}: la sustitución ${sku} vale ${pesos(s.price)} y el componente ${pesos(producto.price)}. `
            + 'resolveCombo la va a descartar, así que no hay que ofrecerla.',
          );
        }
        return sku;
      }),
    });
  }

  /*
   * El techo: el entero más alto que deja el precio promocional en el piso.
   * Se busca probando, no despejando, porque el redondeo a la centena INFERIOR
   * de `roundPromotionalPrice` no es invertible: despejar daría un número que
   * después el redondeo empuja por debajo del piso, que es justo el error que
   * hace publicar un descuento que no se sostiene.
   */
  const piso = costoTotal * PISO_MARGEN_COMBO;
  let techo = 0;
  for (let d = 1; d <= 90; d += 1) {
    if (roundPromotionalPrice(precioLista * (1 - d / 100)) >= piso) techo = d;
    else break;
  }

  const precioPromo = roundPromotionalPrice(precioLista * (1 - declarado / 100));
  const ahorro = precioLista - precioPromo;
  const ahorroPct = precioLista > 0 ? (ahorro / precioLista) * 100 : 0;
  const multiplo = costoTotal > 0 ? precioPromo / costoTotal : 0;

  if (!Number.isFinite(declarado)) problemas.push('no declara descuento.');
  if (declarado > techo) {
    problemas.push(
      `descuento declarado ${declarado} % · el techo que sostiene el piso ×${PISO_MARGEN_COMBO} es ${techo} %. `
      + `A ${declarado} % el combo se vendería a ${pesos(precioPromo)} con costo ${pesos(costoTotal)} (×${multiplo.toFixed(3)}).`,
    );
  }
  if (ahorro <= 0) problemas.push('el ahorro da 0: no es una promoción, no se publica como tal.');
  if (!alcoholico) {
    problemas.push('ningún componente es alcohólico: este combo no pertenece al frente de alcohol.');
  }

  const ok = problemas.length === 0;
  if (!ok) fallas += 1;

  console.log(`${ok ? 'OK   ' : 'FALLA'} ${combo.name}  ·  ${combo.ocasion}`);
  for (const l of lineas) {
    console.log(`        ${l.cantidad} × ${l.nombre}  ${pesos(l.precioUnitario)}  = ${pesos(l.precioLinea)}`);
  }
  console.log(`        precio de lista   ${pesos(precioLista)}`);
  console.log(`        precio promoción  ${pesos(precioPromo)}   (descuento declarado ${declarado} %, techo ${techo} %)`);
  console.log(`        AHORRO            ${pesos(ahorro)}  ·  ${pct(ahorroPct)}`);
  console.log(`        costo medido      ${pesos(costoTotal)}  →  margen ×${multiplo.toFixed(3)} (piso ×${PISO_MARGEN_COMBO})`);
  for (const p of problemas) console.log(`        PROBLEMA: ${p}`);
  console.log('');

  informe.push({
    comboId: combo.comboId,
    nombre: combo.name,
    ocasion: combo.ocasion,
    categoryId: combo.categoryId,
    componentes: lineas,
    precioLista,
    descuentoDeclarado: declarado,
    descuentoTecho: techo,
    precioPromocional: precioPromo,
    ahorro,
    ahorroPorcentaje: Math.round(ahorroPct * 10) / 10,
    costoMedido: costoTotal,
    margenResultante: Math.round(multiplo * 1000) / 1000,
    pisoMargen: PISO_MARGEN_COMBO,
    alcoholico,
    estado: ok ? 'PREPARADA' : 'RECHAZADA',
    problemas,
  });
}

await fs.mkdir(path.dirname(SALIDA), { recursive: true });
await fs.writeFile(SALIDA, `${JSON.stringify({
  schemaVersion: 1,
  generadoEl: new Date().toISOString(),
  fuentePrecio: 'catalog/gondola-neuquen.mjs · precio derivado del costo mayorista medido el 2026-08-18',
  fuenteRedondeo: 'js/core/combos.js · roundPromotionalPrice, centena inferior',
  pisoMargen: PISO_MARGEN_COMBO,
  nota: 'Los seis nacen INACTIVOS (PENDIENTE_APROBACION_COMERCIAL). Ningún combo con alcohol se puede cobrar mientras alcohol_sales_enabled sea false y los componentes estén con available = false.',
  promos: informe,
}, null, 2)}\n`, 'utf8');

console.log(`informe: ${path.relative(ROOT, SALIDA).replaceAll('\\', '/')}`);
if (fallas) {
  console.error(`\n${fallas} promoción(es) no se pueden publicar como están.`);
  process.exit(1);
}
console.log(`\n${informe.length} promociones preparadas, con ahorro real y margen por encima del piso.`);
