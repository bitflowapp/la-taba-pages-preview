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
  const normalizado = normalizar(nombre);
  for (const atributo of ATRIBUTOS_QUE_NO_SON_NOMBRE) {
    if (normalizado === atributo || !normalizado.endsWith(` ${atributo}`)) continue;
    const recortado = nombre.slice(0, nombre.length - atributo.length).trim();
    if (recortado) return recortado;
  }
  return nombre;
}

/*
 * Colas del nombre que NO son parte del nombre: son atributos del envase, y la
 * línea de presentación ya los dice.
 *
 * Es una lista cerrada y corta a propósito. «Sin gas» describe el agua;
 * «Manzana» ES el producto —Aquarius Manzana no es un Aquarius con un atributo—
 * y por eso los sabores no están acá. Recortar un sabor del título arruinaría el
 * reconocimiento, que es justo lo que la tarjeta tiene que dar en un segundo.
 *
 * Lo destapó Villavicencio: el catálogo entrega su nombre como «Villavicencio
 * Sin gas» y el de Benedictino como «Benedictino», los dos con `variant = 'Sin
 * gas'`. Dos aguas del mismo estante, con el mismo dato, escritas distinto: una
 * decía el atributo dos veces y la otra una.
 */
const ATRIBUTOS_QUE_NO_SON_NOMBRE = Object.freeze(['sin gas', 'con gas', 'original']);

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
 * ¿La «variante» es en realidad la ficha técnica pegada?
 *
 * Los catálogos importados traen variantes como «Botella PET · 1,5 L · Unidad»:
 * no es una variante, es la presentación entera escrita de nuevo. Imprimirla al
 * lado de la capacidad daba «1,5 L · Botella PET · 1,5 L · Unidad», que dice el
 * litraje dos veces, filtra el envase que la góndola no nombra y termina con la
 * palabra «Unidad», que no informa nada.
 *
 * Había una regla para el caso del PACK y ninguna para el de la unidad, así que
 * el defecto vivía en el catálogo de demostración —y en cualquier alta futura
 * que se cargue con la misma forma— sin que ninguna prueba lo viera: las
 * afirmaciones eran «contiene 1,5 L» y «contiene Botella PET», y las dos son
 * ciertas sobre la línea rota.
 *
 * El separador es la señal: una variante de verdad es una palabra —«Zero»,
 * «Pomelo», «Sin gas»—, nunca una lista.
 */
function varianteEsFichaTecnica(variante) {
  return /·|\|/.test(String(variante || ''));
}

/*
 * QUÉ SALE CADA ENVASE DE UN PACK.
 *
 * Un pack x12 a $ 17.100 es el único precio del catálogo que el cliente no
 * puede evaluar de un vistazo: al lado hay una botella de 2,25 L a $ 5.900 y no
 * hay forma de compararlos sin dividir. Medido en la góndola de producción del
 * 2026-08-25, los tres packs comprables cuestan $ 1.425 por botella y ninguna
 * pantalla lo dice.
 *
 * NO ES UNA PROMOCIÓN Y NO PUEDE SERLO. Es una división: precio ÷ unidades. No
 * afirma ahorro, no compara contra nada y no depende de ningún costo —que en
 * producción, además, no existe: `unit_cost` está en NULL en los 72 productos,
 * y por eso ninguna oferta con descuento real se puede aprobar todavía—.
 *
 * Y ES LO CONTRARIO DE UN RECLAMO INFLADO. El documento comercial del proyecto
 * afirmaba que el pack x12 «YA es el mejor precio por litro del catálogo»:
 * $ 17.100 ÷ 6 L = $ 2.850/L contra $ 5.900 ÷ 2,25 L = $ 2.622/L de la
 * familiar. El pack es 8,7 % MÁS caro por litro. Publicar aquella frase habría
 * sido una falsedad comercial en el fin de semana de apertura. El número real,
 * dicho sin adjetivos, deja que el cliente decida y que el pack se venda por lo
 * que sí ofrece: doce envases individuales.
 *
 * Devuelve datos, no texto: el formato de moneda depende del comercio y vive en
 * `state.js`. Este módulo sigue siendo puro.
 */
const SUSTANTIVOS_DE_ENVASE = Object.freeze({
  'botella-pet': 'botella',
  'botella-vidrio': 'botella',
  botella: 'botella',
  lata: 'lata',
  sifon: 'sifón',
  'sifon-pet': 'sifón',
  tetra: 'envase',
  'tetra-pak': 'envase',
  pouch: 'envase',
});

export function packUnitNoun(product = {}) {
  const crudo = String(
    product.packageType || product.packagingType || product.packaging_type || '',
  ).trim().toLowerCase().replace(/\s+/g, '-');
  // `hasOwn` y no un acceso a secas: un envase que se llamara «constructor»
  // devolvería una función, y esa función terminaría convertida en texto dentro
  // de la tarjeta. El valor viene de una columna de la base; que hoy no pueda
  // decir eso no es una garantía que valga la pena apoyar.
  return Object.hasOwn(SUSTANTIVOS_DE_ENVASE, crudo) ? SUSTANTIVOS_DE_ENVASE[crudo] : 'unidad';
}

export function packUnitPrice(product = {}) {
  const porPack = Number(product.unitsPerPack ?? product.units_per_pack);
  if (!Number.isFinite(porPack) || porPack <= 1) return null;
  const precio = Number(product.price);
  if (!Number.isFinite(precio) || precio <= 0) return null;
  const unidades = Math.floor(porPack);
  const unitario = precio / unidades;
  if (!Number.isFinite(unitario) || unitario <= 0) return null;
  return Object.freeze({ unitsPerPack: unidades, unitPrice: unitario, noun: packUnitNoun(product) });
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
  // Contra el TÍTULO que se muestra, no contra el nombre crudo: si el título ya
  // recortó «Sin gas», la presentación tiene que volver a decirlo o el dato
  // desaparece de la tarjeta.
  const nombre = normalizar(cardTitle(product));
  const varianteAporta = variante
    && !nombre.includes(normalizar(variante))
    && normalizar(variante) !== 'unidad'
    && !varianteEsLaCapacidad(variante, capacidad, product)
    // «Original» no distingue: lo que distingue es que NO diga Zero.
    && normalizar(variante) !== 'original'
    && !(VARIANTES_SIN_AZUCAR.includes(normalizar(variante)) && tituloDiceSinAzucar(product))
    && !varianteEsFichaTecnica(variante);

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
