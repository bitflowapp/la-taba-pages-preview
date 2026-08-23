/*
 * Leer una presentación desde el título de una fuente, y decidir si describe el
 * MISMO producto que un SKU nuestro.
 *
 * POR QUÉ ESTO EXISTE
 * -------------------
 * El error caro de un catálogo con fotos no es la foto fea: es la foto de otro
 * producto. Un pack de doce ilustrando una unidad suelta le promete al cliente
 * doce botellas por el precio de una. Por eso acá nada se decide «por parecido»:
 * se comparan cinco ejes —marca, variante, capacidad, envase y cantidad del
 * pack— y cualquiera que no cierre baja la confianza o rechaza.
 *
 * LO QUE NO HACE
 * --------------
 * No mira la imagen. Decide con el texto que la fuente publica al lado de la
 * imagen. Ver la foto es el paso siguiente —la hoja de contactos— y es humano.
 */

/** Cantidad de unidades que el título declara, o null si no lo dice. */
const PACK_PATTERNS = [
  /\bx\s*(\d{1,2})\b/i, //            "500ml x12"
  /\b(\d{1,2})\s*x\s*\d/i, //         "1X750ml", "6X1000"
];

const CAPACITY_PATTERN = /(\d{1,4}(?:[.,]\d{1,3})?)\s*(ml|lts|lt|l|cc)\b/gi;

/** Tokens de envase que una fuente puede nombrar explícitamente. */
const PACKAGING_TOKENS = [
  { token: 'lata', envase: 'lata' },
  { token: 'vidrio', envase: 'botella-vidrio' },
  { token: 'sifon', envase: 'sifon' },
  { token: 'pet', envase: 'botella-pet' },
  { token: 'botella', envase: 'botella' },
  { token: 'tetra', envase: 'tetra' },
];

/** Cómo escribe cada catálogo su envase, reducido a un vocabulario común. */
const ENVASE_CANONICO = new Map([
  ['lata', 'lata'],
  ['botella-pet', 'botella-pet'],
  ['botella-vidrio', 'botella-vidrio'],
  ['botella', 'botella'],
  ['sifon', 'sifon'],
  ['tetra', 'tetra'],
]);

/**
 * Marcadores que, si aparecen de un lado solo, cambian el producto de verdad.
 * «zero» contra «original» no es un matiz: es otra bebida y otro precio.
 */
const EXCLUYENTES = new Set([
  // «sin azúcar» no está: se canoniza a «zero» antes de comparar.
  'zero', 'light', 'diet',
  'naranja', 'pomelo', 'limon', 'lima', 'manzana', 'pera', 'uva', 'anana',
  'tonica', 'citrus', 'ginger',
  'malbec', 'cabernet', 'torrontes', 'chardonnay', 'syrah', 'merlot', 'tannat',
  'stout', 'ipa', 'roja', 'negra', 'amber',
]);

/*
 * Palabras que no distinguen un producto de otro: unidades, envases, cantidades,
 * conectores. Todo lo que sobrevive a este filtro SÍ distingue, y por eso tiene
 * que aparecer de los dos lados.
 *
 * Esta lista es la que hace que el matcher sirva para marcas que nadie enumeró:
 * no hace falta saber que existe «Mountain Blast» ni «Increlibblend N2» para
 * darse cuenta de que la fuente está hablando de otra cosa.
 */
const PALABRAS_SIN_VALOR = new Set([
  'de', 'del', 'la', 'el', 'los', 'las', 'y', 'e', 'con', 'sin', 'por', 'para',
  'a', 'al', 'en', 'un', 'una', 'the', 'by', 'of',
  'ml', 'l', 'lt', 'lts', 'cc', 'cm3',
  'botella', 'botellas', 'lata', 'latas', 'vidrio', 'pet', 'sifon', 'tetra',
  'pack', 'packs', 'unidad', 'unidades', 'un', 'x',
  'bebida', 'bebidas', 'gaseosa', 'gaseosas', 'agua', 'aguas',
  'new', 'nueva', 'nuevo', 'edicion',
]);

/** Palabras de variante que se comparan entre SKU y fuente. */
export const VARIANT_MARKERS = Object.freeze([
  // «sin azúcar» no está: se canoniza a «zero» antes de comparar.
  'zero', 'light', 'diet',
  'naranja', 'pomelo', 'limon', 'lima', 'manzana', 'pera', 'uva', 'anana',
  'tonica', 'citrus', 'ginger', 'cola', 'soda',
  'malbec', 'cabernet', 'torrontes', 'chardonnay', 'syrah', 'merlot', 'tannat', 'blend',
  'stout', 'lager', 'ipa', 'roja', 'rubia', 'negra', 'amber',
  'original', 'clasica',
]);

export function normalizeText(value) {
  return String(value || '')
    // Los apóstrofos se unifican ANTES de NFKD a propósito: el acento agudo
    // suelto (U+00B4, el que la tienda usa en «GORDON´S») se descompone en
    // espacio + tilde combinante, y al sacar la tilde quedaba «gordon s».
    // La marca dejaba de coincidir consigo misma.
    .replace(/[´‘’ʼ`]/g, "'")
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    // La tienda escribe «Coca–Cola» con guion largo. Sin esto, la marca no cierra.
    .replace(/[‐-―−]/g, '-')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

/** Un título que combina productos («A + B») nunca describe un SKU solo. */
export function isBundleTitle(title) {
  return /\s\+\s/.test(String(title || ''));
}

export function parseCapacity(title) {
  const text = normalizeText(title);
  const found = [];
  for (const match of text.matchAll(CAPACITY_PATTERN)) {
    const raw = match[1].replace(',', '.');
    const unit = match[2].toLowerCase();
    const value = Number(raw);
    if (!Number.isFinite(value) || value <= 0) continue;
    const ml = unit === 'ml' || unit === 'cc' ? value : Math.round(value * 1000);
    found.push({ ml, stated: `${match[1]}${match[2]}` });
  }
  return found;
}

export function parsePackCount(title) {
  const text = normalizeText(title);
  for (const pattern of PACK_PATTERNS) {
    const match = text.match(pattern);
    if (!match) continue;
    const count = Number(match[1]);
    if (Number.isFinite(count) && count >= 1 && count <= 48) return count;
  }
  return null;
}

/**
 * Envase declarado por el título, o el que la fuente declara por convención.
 * La convención viene de la allowlist y es un hecho REVISADO sobre esa fuente
 * —queda escrito, versionado y auditable—, no una adivinanza del matcher.
 */
export function parsePackaging(title, convention = null) {
  const text = normalizeText(title);
  for (const { token, envase } of PACKAGING_TOKENS) {
    if (text.includes(normalizeText(token))) return { envase, stated: true };
  }
  if (convention?.default) return { envase: convention.default, stated: false };
  return { envase: null, stated: false };
}

export function canonicalEnvase(value) {
  const key = normalizeText(value).replace(/\s+/g, '-');
  if (ENVASE_CANONICO.has(key)) return ENVASE_CANONICO.get(key);
  return key || null;
}

/**
 * Lee un título de fuente. Un título con dos capacidades distintas describe un
 * combo, no un producto, y por eso deja de ser candidato.
 */
export function parseSourceTitle(title, { packagingConvention = null } = {}) {
  const capacities = parseCapacity(title);
  const distintas = new Set(capacities.map((c) => c.ml));
  return {
    raw: String(title || ''),
    normalized: normalizeText(title),
    bundle: isBundleTitle(title),
    packCount: parsePackCount(title),
    capacityMl: distintas.size === 1 ? capacities[0].ml : null,
    capacityAmbigua: distintas.size > 1,
    packaging: parsePackaging(title, packagingConvention),
  };
}

/** El SKU nuestro, reducido a los mismos cinco ejes. */
export function skuPresentation(sku) {
  const unidad = String(sku.capacityUnit || 'ml').toLowerCase();
  return {
    sku: sku.sku,
    brand: normalizeText(sku.brand),
    capacityMl: unidad === 'ml' ? sku.capacityValue : Math.round(sku.capacityValue * 1000),
    envase: canonicalEnvase(sku.packagingType),
    packCount: sku.unitsPerPack || 1,
    variant: normalizeText(sku.variant),
    name: normalizeText(sku.name),
  };
}

/*
 * Dos maneras de escribir el MISMO eje. No es una lista de «parecidos»: es una
 * lista de sinónimos exactos, y por eso es cortísima y se amplía de a uno.
 *
 * «Zero» y «sin azúcar» son la misma bebida escrita distinto —la etiqueta
 * argentina de Coca-Cola Zero dice literalmente «sin azúcares»—, y nuestro
 * catálogo usa una forma mientras la tienda del embotellador usa la otra. Sin
 * esto, el matcher rechazaba la foto oficial de Coca-Cola Zero por contradecir
 * a Coca-Cola Zero.
 *
 * «Light» y «diet» quedan AFUERA a propósito: Coca-Cola Light y Coca-Cola Zero
 * son dos productos distintos, con dos fórmulas y dos precios. Meterlas acá
 * sería exactamente el error que este archivo existe para no cometer.
 */
const SINONIMOS_DE_VARIANTE = [
  { canonico: 'zero', patron: /(?<![a-z0-9])sin\s+azucar(es)?(?![a-z0-9])/g },
];

/**
 * Reescribe las formas sinónimas a una sola antes de comparar. Se aplica a los
 * DOS lados —al SKU y a la fuente—, así que no afloja nada: sólo hace que la
 * misma cosa se escriba igual de los dos lados.
 */
export function canonicalizeVariant(text) {
  let salida = normalizeText(text);
  for (const { canonico, patron } of SINONIMOS_DE_VARIANTE) salida = salida.replace(patron, canonico);
  return salida;
}

/*
 * Los marcadores se buscan como PALABRA, no como pedazo de palabra. Con
 * `includes` a secas, «chocolate» contiene «cola» y el matcher declaraba una
 * contradicción de sabor que no existía.
 */
function markersIn(text) {
  const normal = canonicalizeVariant(text);
  return new Set(VARIANT_MARKERS.filter((marker) => (
    new RegExp(`(?<![a-z0-9])${marker.replace(/\s+/g, '\\s+')}(?![a-z0-9])`).test(normal)
  )));
}

/**
 * Las palabras que de verdad identifican al producto: se le sacan la marca, las
 * medidas, los envases y los conectores, y queda la línea y el sabor.
 *
 *   «ORIGEN BY TRAPICHE MALBEC 1X750ml»  ->  {origen, malbec}
 *   «TRAPICHE RESERVA MALBEC 1X750ml»    ->  {reserva, malbec}
 *   «POWERADE SOUR 500x6»                ->  {sour}
 *
 * Comparar estos conjuntos es lo que separa «Mountain Blast» de «Sour» sin que
 * nadie haya tenido que escribir esos dos nombres en ninguna lista.
 */
export function distinctiveTokens(text, { brand = '' } = {}) {
  const marca = new Set(normalizeText(brand).split(/[^a-z0-9']+/).filter(Boolean));
  return new Set(
    // Canonizado igual que los marcadores: si «sin azúcar» y «zero» son la
    // misma variante, tampoco pueden diferir como línea de producto.
    canonicalizeVariant(text)
      .split(/[^a-z0-9']+/)
      .filter(Boolean)
      // Un token que es puro número, o número pegado a una unidad, es una medida.
      .filter((token) => !/^\d+$/.test(token))
      .filter((token) => !/^\d+(ml|l|lt|lts|cc)$/.test(token))
      .filter((token) => !/^x\d+$/.test(token))
      // «1x750ml», «6x1000», «500x6»: la tienda pega cantidad y medida.
      .filter((token) => !/^\d+x\d*(ml|l|lt|lts|cc)?$/.test(token))
      .filter((token) => !PALABRAS_SIN_VALOR.has(token))
      .filter((token) => !marca.has(token))
      .filter((token) => token.length > 1),
  );
}

/**
 * «botella» a secas es compatible con PET o vidrio: la fuente dijo menos, no
 * dijo otra cosa. Lo que no se acepta es lata contra botella.
 */
function envasesCompatibles(fuente, sku) {
  if (fuente === sku) return true;
  const familiaBotella = new Set(['botella', 'botella-pet', 'botella-vidrio']);
  if (!familiaBotella.has(fuente) || !familiaBotella.has(sku)) return false;
  return fuente === 'botella' || sku === 'botella';
}

/**
 * Compara un SKU contra un candidato y devuelve confianza y motivos.
 *
 * HIGH    los cinco ejes cierran y ninguno quedó sin dato.
 * MEDIUM  cierra lo esencial pero algún eje quedó sin declarar: va a revisión.
 * REJECT  algún eje se contradice. La cantidad del pack rechaza siempre: es el
 *         eje que le miente al cliente sobre lo que va a recibir.
 */
export function scoreCandidate(skuPres, parsed, { brandDeclared = null } = {}) {
  const reasons = [];
  const rechazo = (motivo) => {
    reasons.push(`RECHAZO ${motivo}`);
    return { confidence: 'REJECT', reasons };
  };
  const duda = (motivo) => reasons.push(`REVISAR ${motivo}`);

  if (parsed.bundle) return rechazo('el título combina varios productos, no describe un SKU solo');
  if (parsed.capacityAmbigua) return rechazo('el título declara más de una capacidad');

  const marcaEnTitulo = normalizeText(brandDeclared || '');
  const marcaOk = parsed.normalized.includes(skuPres.brand)
    || (marcaEnTitulo && marcaEnTitulo.includes(skuPres.brand))
    || (skuPres.brand && marcaEnTitulo && skuPres.brand.includes(marcaEnTitulo));
  if (!marcaOk) return rechazo(`la marca no coincide (el SKU es «${skuPres.brand}»)`);

  if (parsed.packCount === null) {
    duda('la fuente no declara cuántas unidades trae');
  } else if (parsed.packCount !== skuPres.packCount) {
    return rechazo(`cantidad distinta: el SKU es x${skuPres.packCount} y la fuente publica x${parsed.packCount}`);
  }

  if (parsed.capacityMl === null) {
    duda('la fuente no declara capacidad');
  } else if (parsed.capacityMl !== skuPres.capacityMl) {
    return rechazo(`capacidad distinta: el SKU es ${skuPres.capacityMl} ml y la fuente ${parsed.capacityMl} ml`);
  }

  const envaseFuente = parsed.packaging.envase;
  if (!envaseFuente) {
    duda('la fuente no declara envase y no hay convención revisada para ella');
  } else if (!envasesCompatibles(envaseFuente, skuPres.envase)) {
    return rechazo(`envase distinto: el SKU es ${skuPres.envase} y la fuente ${envaseFuente}`);
  }

  const marcadoresSku = markersIn(`${skuPres.variant} ${skuPres.name}`);
  const marcadoresFuente = markersIn(parsed.normalized);
  const faltan = [...marcadoresSku].filter((m) => !marcadoresFuente.has(m));
  const sobran = [...marcadoresFuente].filter((m) => !marcadoresSku.has(m));
  if (faltan.some((m) => EXCLUYENTES.has(m)) || sobran.some((m) => EXCLUYENTES.has(m))) {
    return rechazo(`la variante no coincide (SKU: ${[...marcadoresSku].join('/') || '—'} · fuente: ${[...marcadoresFuente].join('/') || '—'})`);
  }
  if (faltan.length || sobran.length) {
    duda(`variante no idéntica (falta: ${faltan.join('/') || '—'} · sobra: ${sobran.join('/') || '—'})`);
  }

  // La línea del producto. Sin esto, «Trapiche Origen Malbec» acepta también
  // «Trapiche Reserva Malbec», y «Powerade Mountain Blast» acepta «Powerade
  // Sour»: mismo tamaño, mismo envase, misma marca, otro producto.
  const tokensSku = distinctiveTokens(`${skuPres.name} ${skuPres.variant}`, { brand: skuPres.brand });
  const tokensFuente = distinctiveTokens(parsed.normalized, { brand: brandDeclared || skuPres.brand });
  const sinRespuesta = [...tokensSku].filter((token) => !tokensFuente.has(token));
  const deMas = [...tokensFuente].filter((token) => !tokensSku.has(token));
  if (sinRespuesta.length || deMas.length) {
    duda(
      `la línea no es idéntica (el SKU dice «${[...tokensSku].join(' ') || '—'}» y la fuente `
      + `«${[...tokensFuente].join(' ') || '—'}»)`,
    );
  }

  return {
    confidence: reasons.length ? 'MEDIUM' : 'HIGH',
    reasons,
  };
}
