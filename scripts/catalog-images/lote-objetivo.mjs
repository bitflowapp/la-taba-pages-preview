/*
 * Qué productos puede tocar este lote, y ninguno más.
 *
 * POR QUÉ EXISTE, Y QUÉ ERROR REPARA
 * ----------------------------------
 * La comprobación anterior seleccionaba los productos con
 * `sold_as_pack=eq.true` y exigía que fueran exactamente 4. Eso era cierto
 * mirando el catálogo con la clave publicable —que no ve los alcohólicos, porque
 * están cerrados por la compuerta de licencia— y dejó de serlo con una sesión de
 * owner, que ve los 56. El quinto pack es legítimo: `quilmes-clasica-lata-473ml-pack-6`,
 * un pack de seis latas cargado con la góndola de Neuquén.
 *
 * El error de fondo no fue contar mal: fue elegir el conjunto por una PROPIEDAD
 * («los que son pack») en vez de por una LISTA («estos cuatro»). Con una
 * propiedad, cualquier producto que mañana cumpla esa propiedad entra al lote sin
 * que nadie lo haya decidido. Un catálogo puede tener 5, 20 o 200 packs
 * legítimos, y ninguno de ellos tiene nada que ver con estas cuatro fotografías.
 *
 * Acá el conjunto es una lista escrita, y todo lo que no está en ella es
 * invisible para este lote.
 */

/**
 * Los únicos SKU que este lote puede tocar, con la presentación que se espera de
 * cada uno. `unitsPerPack` no es decorativo: es la cantidad que el packshot
 * anuncia con su sello, y si el producto dejara de traer esa cantidad la foto
 * pasaría a mentir.
 */
export const OBJETIVOS = new Map([
  ['coca-cola-original-botella-pet-500-ml-pack-x12', { nombre: 'Coca-Cola Original Pack x12', unitsPerPack: 12 }],
  ['coca-cola-zero-botella-pet-500-ml-pack-x12', { nombre: 'Coca-Cola Zero Pack x12', unitsPerPack: 12 }],
  ['fanta-naranja-botella-pet-1500-ml-pack-x6', { nombre: 'Fanta Naranja Pack x6', unitsPerPack: 6 }],
  ['sprite-botella-pet-500-ml-pack-x12', { nombre: 'Sprite Pack x12', unitsPerPack: 12 }],
]);

export const SKUS_OBJETIVO = Object.freeze([...OBJETIVOS.keys()]);

/**
 * Comprueba que el lote sea exactamente el declarado.
 *
 * `productos` puede traer de más —el catálogo entero, si hiciera falta—: lo que
 * sobra se ignora, y ésa es justamente la propiedad que se quiere. Lo que no se
 * tolera es que falte un objetivo, que uno haya dejado de ser pack, que cambie
 * la cantidad, o que el lote de assets nombre un SKU que no está en la lista.
 */
export function validarLoteObjetivo({ productos = [], assets = [] } = {}) {
  const errores = [];
  const porSku = new Map(productos.map((producto) => [producto.sku, producto]));
  const seleccionados = [];

  for (const [sku, esperado] of OBJETIVOS) {
    const producto = porSku.get(sku);
    if (!producto) {
      errores.push(`falta el producto objetivo ${sku}.`);
      continue;
    }
    if (producto.sold_as_pack !== true) {
      errores.push(`${sku} dejó de venderse como pack (sold_as_pack = ${producto.sold_as_pack}).`);
    }
    if (producto.units_per_pack !== esperado.unitsPerPack) {
      errores.push(
        `${sku} trae ${producto.units_per_pack} unidades y el packshot anuncia `
        + `${esperado.unitsPerPack}: la foto pasaría a mentir.`,
      );
    }
    seleccionados.push(producto);
  }

  // El lote de assets tiene que nombrar la MISMA lista. Un asset de más es un
  // producto de más que se va a escribir sin haberlo decidido.
  const skusDeAssets = assets.map((asset) => asset.sku ?? asset);
  for (const sku of skusDeAssets) {
    if (!OBJETIVOS.has(sku)) errores.push(`el lote incluye un SKU que no es objetivo: ${sku}.`);
  }
  for (const sku of OBJETIVOS.keys()) {
    if (skusDeAssets.length && !skusDeAssets.includes(sku)) {
      errores.push(`el lote no incluye el objetivo ${sku}.`);
    }
  }
  const repetidos = skusDeAssets.filter((sku, indice) => skusDeAssets.indexOf(sku) !== indice);
  for (const sku of new Set(repetidos)) errores.push(`el lote nombra ${sku} más de una vez.`);

  return { errores, ok: errores.length === 0, seleccionados };
}

/**
 * Los productos que este lote NO va a tocar. Se listan para poder demostrar
 * después que quedaron igual, no para decidir nada con ellos.
 */
export function fueraDelLote(productos = []) {
  return productos.filter((producto) => !OBJETIVOS.has(producto.sku));
}
