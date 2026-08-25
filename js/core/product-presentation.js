/*
 * La línea de presentación de una tarjeta de góndola, dicha como la lee una
 * persona: capacidad primero, variante sólo si agrega información.
 *
 * POR QUÉ EXISTE (auditoría de UX del 2026-08-21, hallazgo A2): 29 de las 33
 * tarjetas visibles no decían el litraje. La base exige `presentation =
 * variant`, así que la tarjeta imprimía «Original» o «Sin azúcar» —la
 * variedad— y la Coca-Cola de 2,25 L y la lata de 354 ml quedaban idénticas
 * salvo el precio. Con la góndola final el problema se multiplica: dos
 * «Coca-Cola Original» (2,25 L y 1,5 L) conviven a propósito.
 *
 * También es el lugar donde el slug de envase deja de filtrarse a la pantalla:
 * «botella-pet» es vocabulario de base de datos; la góndola dice «Botella PET».
 *
 * Este módulo es puro: recibe datos, devuelve texto. Sin DOM, sin estado.
 */

const PACKAGING_LABELS = Object.freeze({
  'botella-pet': 'Botella PET',
  'botella-vidrio': 'Botella de vidrio',
  botella: 'Botella',
  lata: 'Lata',
  sifon: 'Sifón',
  'sifon-pet': 'Sifón',
  tetra: 'Tetra',
  'tetra-pak': 'Tetra',
  pouch: 'Pouch',
});

/**
 * «1500 ml» → «1,5 L» · «473 ml» → «473 ml» · «2250 ml» → «2,25 L» ·
 * «2000 ml» → «2 L». Los litros usan coma decimal (es-AR) y sin ceros colgando.
 */
export function formatCapacity(value, unit = 'ml') {
  const cantidad = Number(value);
  if (!Number.isFinite(cantidad) || cantidad <= 0) return '';
  const unidad = String(unit || 'ml').trim().toLowerCase();
  if (unidad === 'l') return `${formatLiters(cantidad)} L`;
  if (unidad !== 'ml') return `${trimNumber(cantidad)} ${unidad}`;
  if (cantidad >= 1000) return `${formatLiters(cantidad / 1000)} L`;
  return `${trimNumber(cantidad)} ml`;
}

function formatLiters(litros) {
  const texto = litros.toFixed(2).replace(/\.?0+$/, '');
  return texto.replace('.', ',');
}

function trimNumber(valor) {
  return String(Number(valor.toFixed(2)));
}

/** «botella-pet» → «Botella PET»; un slug desconocido se capitaliza sin guiones. */
export function packagingLabel(slug) {
  const clave = String(slug || '').trim().toLowerCase();
  if (!clave) return '';
  if (PACKAGING_LABELS[clave]) return PACKAGING_LABELS[clave];
  const palabras = clave.split('-').filter(Boolean).join(' ');
  return palabras ? palabras.charAt(0).toUpperCase() + palabras.slice(1) : '';
}

function normalizar(texto) {
  return String(texto || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * ¿La «variante» es en realidad la capacidad otra vez?
 *
 * Las cuatro unidades minoristas cargadas el 2026-08-19 llevan
 * `variant='500 ml'` y `variant='1,5 L'`: son datos maestros válidos —la
 * variante de ese SKU ES su tamaño— pero imprimirla al lado de la capacidad
 * daba «500 ml · 500 ml». Se dice una sola vez, y se dice en presentación:
 * la identidad del SKU no se toca para arreglar algo que se ve.
 *
 * Se compara contra las dos formas: la que se muestra («1,5 L») y la cruda de
 * la base («1500 ml»), porque un dato viejo puede traer cualquiera de las dos.
 */
function varianteEsLaCapacidad(variante, capacidadFormateada, product) {
  const v = normalizar(variante);
  if (!v) return false;
  if (v === normalizar(capacidadFormateada)) return true;
  const valor = product.capacityValue ?? product.capacity_value;
  const unidad = product.capacityUnit ?? product.capacity_unit ?? 'ml';
  if (valor == null) return false;
  return v === normalizar(`${valor} ${unidad}`);
}

/*
 * Las palabras con las que una LÍNEA de producto dice «sin azúcar» en su propio
 * nombre. Si el título ya trae una, repetir la variante debajo es ruido:
 * «Coca-Cola Zero · Sin azúcar» dice dos veces lo mismo y le roba el renglón a
 * la capacidad, que es lo que el cliente sí necesita para elegir.
 */
const SUBMARCAS_SIN_AZUCAR = ['zero', 'black', 'light', 'sugarfree', 'sin azucar', 'diet'];
const VARIANTES_SIN_AZUCAR = ['sin azucar', 'zero', 'sugarfree', 'light', 'diet'];

/*
 * Envases que MERECEN nombrarse en la tarjeta. La botella PET es la convención
 * de la góndola —lo normal, lo que no hace falta decir—; una lata o un sifón
 * cambian el producto que llega a la puerta y por eso se dicen. Nombrar «Botella
 * PET» en veinte tarjetas de veintitrés sería gastar el renglón en la constante.
 */
const ENVASES_QUE_SE_DICEN = new Set(['lata', 'sifon', 'sifon-pet', 'botella-vidrio', 'tetra', 'tetra-pak', 'pouch']);

/**
 * El título del producto tal como lo lee el cliente.
 *
 * POR QUÉ NO ES `product.name` A SECAS: en el catálogo productivo la misma
 * bebida se llama de dos maneras según el formato —«Coca-Cola» la de 2,25 L y
 * «Coca-Cola Original» la de 1,5 L— porque el nombre es dato maestro y lo
 * cargaron dos altas distintas. Cambiarlo en la base es una modificación de
 * dato maestro: el trigger `products_fail_close_master_change` despublicaría el
 * producto. Así que la coherencia se resuelve donde corresponde, al mostrar.
 *
 * «Original» se cae del título porque no distingue nada: la ausencia de una
 * submarca —Zero, Black, Sugarfree— ya significa original, y así los dos
 * formatos de Coca-Cola pasan a llamarse igual en toda la tienda.
 */
export function cardTitle(product = {}) {
  const nombre = String(product?.name || '').trim();
  if (!nombre) return '';
  const palabras = nombre.split(/\s+/);
  if (palabras.length > 1 && normalizar(palabras.at(-1)) === 'original') {
    return palabras.slice(0, -1).join(' ');
  }
  return nombre;
}

/** ¿El título ya dice que es la versión sin azúcar? */
function tituloDiceSinAzucar(product) {
  const titulo = normalizar(cardTitle(product));
  return SUBMARCAS_SIN_AZUCAR.some((marca) => titulo.includes(marca));
}

/**
 * El nombre completo para quien no ve la pantalla, y para los `aria-label`.
 *
 * Sin esto la góndola ofrecía dos botones «Agregar Coca-Cola al pedido» para
 * dos productos distintos —la de 2,25 L y la de 1,5 L—, que en un lector de
 * pantalla es una tienda sin variantes.
 */
export function productAccessibleName(product = {}) {
  return [cardTitle(product), cardPresentationLine(product)].filter(Boolean).join(' ');
}

/**
 * La línea de la tarjeta.
 *
 *   unidad:  «1,5 L» · «354 ml · Lata» · «2,25 L · Sin gas»
 *   pack:    «Pack x6 · 473 ml» (la capacidad es LA DE CADA ENVASE, que es la
 *            convención vigente del catálogo)
 *
 * Sin capacidad conocida cae a la variante sola, que era el comportamiento
 * anterior: nunca peor que antes.
 */
export function cardPresentationLine(product = {}) {
  const capacidad = formatCapacity(
    product.capacityValue ?? product.capacity_value,
    product.capacityUnit ?? product.capacity_unit ?? 'ml',
  );
  const porPack = Number(product.unitsPerPack ?? product.units_per_pack);
  const esPack = Number.isFinite(porPack) && porPack > 1;

  const variante = String(product.presentation || product.variant || '').trim();
  const nombre = normalizar(product.name);
  const varianteAporta = variante
    && !nombre.includes(normalizar(variante))
    && normalizar(variante) !== 'unidad'
    && !varianteEsLaCapacidad(variante, capacidad, product)
    // «Original» no distingue: lo que distingue es que NO diga Zero.
    && normalizar(variante) !== 'original'
    && !(VARIANTES_SIN_AZUCAR.includes(normalizar(variante)) && tituloDiceSinAzucar(product));

  const envase = String(product.packageType || product.packagingType || product.packaging_type || '').trim().toLowerCase();
  const envaseAporta = ENVASES_QUE_SE_DICEN.has(envase);

  const partes = [];
  if (esPack) partes.push(`Pack x${porPack}`);
  if (capacidad) partes.push(capacidad);
  if (envaseAporta) partes.push(packagingLabel(envase));
  if (varianteAporta && !esPack) partes.push(variante);
  if (partes.length) return partes.join(' · ');
  if (varianteAporta) return variante;
  // Último recurso, para catálogos sin campos estructurados (la demo): la
  // etiqueta de unidad que la tarjeta mostraba antes de este helper. «Unidad»
  // sola no informa nada y se calla, igual que siempre.
  const etiqueta = String(product.unitLabel || '').trim();
  if (etiqueta && normalizar(etiqueta) !== 'unidad') return etiqueta;
  return '';
}
