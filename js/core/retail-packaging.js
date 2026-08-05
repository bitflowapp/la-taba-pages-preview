// ─────────────────────────────────────────────────────────────────────────────
// Empaque minorista · separación entre COMPRA al proveedor y VENTA al cliente.
// -----------------------------------------------------------------------------
// La Taba 2 es un autoservicio de barrio: el cliente compra unidades. El
// catálogo, en cambio, se armó en parte desde referencias mayoristas, donde la
// fila es el pack que el local le compra al proveedor. Este módulo fija UNA
// fuente de verdad para distinguir las tres cosas que estaban mezcladas:
//
//   COMPRA   cómo entra la mercadería   (pack x6, caja x12, bulto)
//   STOCK    cómo se cuenta             (unidades, en la unidad que se vende)
//   VENTA    cómo la compra el cliente  (una lata, una botella, o un pack
//                                        que el local decidió vender como tal)
//
// Reglas que el módulo NO negocia:
//
//   · No inventa multiplicadores. Si la evidencia se contradice, el producto
//     queda AMBIGUO y nadie lo convierte.
//   · No deriva precios. Un costo de pack jamás se divide para publicar un
//     precio unitario: eso lo aprueba una persona.
//   · No inventa códigos de barras. Valida los que existen y distingue el de
//     la unidad del de la caja; nunca reutiliza uno por el otro.
//   · No decide si un pack se vende. Un pack con precio y stock propios sigue
//     siendo un producto público hasta que el negocio diga lo contrario.
//
// Es una HOJA pura: sin DOM, sin estado, sin red. Todo entra por parámetro.
import { isPurchasableBeverageProduct } from './beverage-home-sections.js';

// Unidades de compra admitidas. `unidad` significa que el proveedor entrega de
// a uno y no hay multiplicador.
export const PURCHASE_UNITS = Object.freeze(['unidad', 'pack', 'caja', 'bandeja', 'bulto']);

// Tokens logísticos que jamás deben viajar en el nombre público. Se detectan
// para clasificar y se recortan al normalizar; no alcanzan por sí solos para
// afirmar un multiplicador (ver `detectPurchasePackaging`).
const LOGISTICS_TOKEN = /(\bpack\b|\bcaja\b|\bbulto\b|\bbandeja\b|\bsix\s?pack\b|\bx\s?\d{1,3}\b|\b\d{1,3}\s*(?:x|unidades?|latas?|botellas?)\b)/gi;

const MULTIPLIER_HINT = /(?:\bx\s?(\d{1,3})\b|\bpack\s+(?:de\s+)?(\d{1,3})\b|\bcaja\s+(?:de\s+)?(\d{1,3})\b|\bbandeja\s+(?:de\s+)?(\d{1,3})\b|\b(\d{1,3})\s*(?:latas|botellas|unidades)\b)/i;

function textOf(source = {}) {
  return [source.name, source.presentation, source.description, source.unitLabel, source.id, source.sku]
    .filter(Boolean)
    .join(' ');
}

function positiveInteger(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function normalizeText(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/**
 * Multiplicador declarado por el texto del producto, si es inequívoco.
 * Devuelve `null` cuando no hay pista o cuando hay más de una distinta: dos
 * números que se contradicen no son evidencia, son una alerta.
 */
export function readMultiplierHint(source = {}) {
  const haystack = textOf(source);
  const found = new Set();
  const pattern = new RegExp(MULTIPLIER_HINT.source, 'gi');
  let match = pattern.exec(haystack);
  while (match) {
    const value = positiveInteger(match[1] || match[2] || match[3] || match[4] || match[5]);
    if (value && value > 1) found.add(value);
    match = pattern.exec(haystack);
  }
  return found.size === 1 ? [...found][0] : null;
}

/**
 * Separa la evidencia de empaque de un producto.
 *
 * `unitsPerPack` es el dato estructurado del catálogo; el texto y el catálogo
 * de release aportan contraste. Cuando no coinciden, el producto queda
 * `ambiguous` y ningún consumidor puede convertirlo: es exactamente el caso de
 * una fila que dice "Pack x6" con multiplicador 1.
 */
export function detectPurchasePackaging(source = {}) {
  const declared = positiveInteger(source.unitsPerPack ?? source.units_per_pack) || 1;
  const releasePack = positiveInteger(source.packCount ?? source.pack_count);
  const hint = readMultiplierHint(source);
  const evidence = [];
  const conflicts = [];

  if (declared > 1) evidence.push(`unitsPerPack=${declared}`);
  if (hint) evidence.push(`texto declara x${hint}`);
  if (releasePack && releasePack > 1) evidence.push(`pack_count=${releasePack}`);

  if (hint && hint !== declared) {
    conflicts.push(`el texto declara x${hint} y el catálogo unitsPerPack=${declared}`);
  }
  if (releasePack && releasePack !== declared) {
    conflicts.push(`el catálogo de release declara pack_count=${releasePack} y la app unitsPerPack=${declared}`);
  }

  const ambiguous = conflicts.length > 0;
  const unitsPerPack = ambiguous ? null : declared;
  const purchaseUnit = ambiguous ? null : (declared > 1 ? 'pack' : 'unidad');

  return {
    isPack: ambiguous ? null : declared > 1,
    unitsPerPack,
    purchaseUnit,
    ambiguous,
    evidence,
    conflicts,
  };
}

/** Quita del nombre público la información logística del proveedor. */
export function stripLogisticsFromName(value) {
  return String(value || '')
    .replace(LOGISTICS_TOKEN, ' ')
    .replace(/\s*[·|-]\s*$/g, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

/**
 * Nombre público con la variedad SÓLO cuando aporta información nueva. No
 * inventa: la variedad ya está en el registro; acá se decide si viaja al
 * nombre. "Coca-Cola Original" + variante "Original" no se duplica.
 */
export function composeRetailName({ name = '', variant = '' } = {}) {
  const base = stripLogisticsFromName(name);
  const extra = String(variant || '').trim();
  if (!base || !extra) return base;
  const haystack = ` ${normalizeText(base)} `;
  const words = normalizeText(extra).split(' ').filter(Boolean);
  if (!words.length) return base;
  if (words.every((word) => haystack.includes(` ${word} `))) return base;
  return `${base} ${extra}`;
}

/**
 * Nombres públicos de todo el catálogo.
 *
 * Recorta la información logística siempre, y desambigua con la variedad SÓLO
 * ante una colisión real: dos productos de la misma marca y categoría con el
 * mismo nombre público, variedades distintas y subcategorías distintas. Ese
 * recorte es deliberado: dos filas del MISMO producto duplicado (misma
 * variedad, o misma subcategoría con variedades sinónimas) no se disfrazan de
 * productos distintos con un nombre inventado — se resuelven consolidando, que
 * es una decisión humana.
 */
export function applyRetailNaming(products = []) {
  const list = Array.isArray(products) ? products : [];
  const groups = new Map();
  for (const product of list) {
    if (!product) continue;
    const key = `${normalizeText(product.brand)}|${normalizeText(product.categoryId)}|${normalizeText(stripLogisticsFromName(product.name))}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(product);
  }

  const disambiguate = new Set();
  for (const group of groups.values()) {
    if (group.length < 2) continue;
    for (const product of group) {
      const rivals = group.filter((other) => other !== product);
      const genuinelyDifferent = rivals.some((other) => (
        normalizeText(other.variant) !== normalizeText(product.variant)
        && normalizeText(other.subcategory) !== normalizeText(product.subcategory)
      ));
      if (genuinelyDifferent) disambiguate.add(product.id);
    }
  }

  return list.map((product) => {
    if (!product) return product;
    const name = disambiguate.has(product.id)
      ? composeRetailName(product)
      : stripLogisticsFromName(product.name);
    return name && name !== product.name ? { ...product, name } : product;
  });
}

/**
 * Vincula cada pack de compra con la unidad minorista que representa.
 *
 * El vínculo se deriva de datos, no de nombres cargados a mano: misma marca,
 * misma categoría, misma capacidad, y EXACTAMENTE una unidad candidata. Con
 * cero o más de una, no hay vínculo: preferimos un pack sin vincular a un
 * vínculo inventado.
 *
 * El pack conserva su identidad y su ficha; lo que gana es el dato de compra
 * (`procurement`), que es interno y no se muestra al cliente. La unidad gana la
 * referencia inversa (`purchasePack`) para que la recepción de mercadería sepa
 * cuántas unidades suma un pack.
 */
export function linkProcurementPacks(products = []) {
  const list = Array.isArray(products) ? products : [];
  const packaging = new Map(list.map((product) => [product?.id, detectPurchasePackaging(product || {})]));

  const unitCandidates = (pack) => list.filter((candidate) => (
    candidate
      && candidate.id !== pack.id
      && normalizeText(candidate.brand) === normalizeText(pack.brand)
      && normalizeText(candidate.categoryId) === normalizeText(pack.categoryId)
      && Number(candidate.capacityValue) === Number(pack.capacityValue)
      && normalizeText(candidate.capacityUnit) === normalizeText(pack.capacityUnit)
      && packaging.get(candidate.id)?.isPack === false
  ));

  const links = new Map();
  for (const product of list) {
    if (!product) continue;
    const info = packaging.get(product.id);
    if (!info || info.isPack !== true) continue;
    const candidates = unitCandidates(product);
    if (candidates.length !== 1) continue;
    links.set(product.id, candidates[0].id);
  }

  const inverse = new Map();
  for (const [packId, unitId] of links) inverse.set(unitId, packId);

  return list.map((product) => {
    if (!product) return product;
    const info = packaging.get(product.id);
    const patch = {};

    if (info) {
      patch.packaging = {
        purchaseUnit: info.purchaseUnit,
        unitsPerPurchasePack: info.isPack ? info.unitsPerPack : 1,
        ambiguous: info.ambiguous,
        conflicts: info.conflicts,
      };
    }

    const retailUnitId = links.get(product.id);
    if (retailUnitId) {
      // Dato de COMPRA: interno. `supplierProductName` sale de la propia ficha
      // del pack, no de un proveedor inventado; costo y código de pack quedan
      // en null hasta que exista un dato real.
      patch.procurement = {
        supplierProductName: [product.brand, product.name, product.presentation].filter(Boolean).join(' · '),
        purchaseUnit: info.purchaseUnit,
        unitsPerPurchasePack: info.unitsPerPack,
        retailUnitId,
        supplierPackBarcode: null,
        supplierPackCost: null,
        supplierReference: product.id,
      };
    }

    const packId = inverse.get(product.id);
    if (packId) {
      const packInfo = packaging.get(packId);
      patch.purchasePack = {
        productId: packId,
        purchaseUnit: packInfo?.purchaseUnit || 'pack',
        unitsPerPurchasePack: packInfo?.unitsPerPack || null,
      };
    }

    return Object.keys(patch).length ? { ...product, ...patch } : product;
  });
}

// ─── Publicación minorista ───────────────────────────────────────────────────
// Decisión comercial humana (2026-08-05): el pack, la caja y el bulto son
// abastecimiento del negocio. El cliente ve y compra la unidad. Ningún pack se
// mantiene como producto público sin autorización individual, y hoy no hay
// ninguna otorgada.
//
// Lo que sigue implementa esa decisión sin inventar nada: el pack no se borra
// —conserva su id, su ficha y su historial— pero deja la góndola, y en su lugar
// se publica la unidad que representa. La unidad hereda sólo lo que ya estaba
// escrito en el registro del pack (marca, variedad, capacidad por unidad,
// categoría, envase). Precio, stock, código de barras e imagen nacen
// pendientes: son datos que sólo puede aportar el local.

export const RETAIL_UNIT_PLACEHOLDER_IMAGE = 'assets/products/beverage-placeholder.svg';

const PACKAGE_LABELS = Object.freeze({
  'botella-pet': 'Botella PET',
  'botella-retornable': 'Botella retornable',
  botella: 'Botella',
  lata: 'Lata',
  sifon: 'Sifón',
  bolsa: 'Bolsa',
});

/** "1500 ml" se lee "1,5 L" en góndola; por debajo del litro manda el ml. */
export function retailCapacityLabel(value, unit) {
  const amount = Number(value);
  const symbol = String(unit || '').toLowerCase();
  if (!Number.isFinite(amount) || amount <= 0) return '';
  if (symbol === 'ml' && amount >= 1000) {
    return `${String(Number((amount / 1000).toFixed(2))).replace('.', ',')} L`;
  }
  if (symbol === 'g' && amount >= 1000) {
    return `${String(Number((amount / 1000).toFixed(2))).replace('.', ',')} kg`;
  }
  return `${amount} ${symbol}`;
}

function packageLabel(packageType) {
  return PACKAGE_LABELS[String(packageType || '').toLowerCase()] || 'Unidad';
}

/**
 * Id estable de la unidad que representa un pack: el mismo id sin el sufijo
 * logístico. Determinista y legible, para que el vínculo se entienda de sólo
 * leerlo. Si el id no declara el sufijo, se agrega `-unidad` en vez de
 * arriesgar una colisión.
 */
export function deriveRetailUnitId(packId) {
  const id = String(packId || '').trim();
  if (!id) return '';
  const stripped = id.replace(/-(?:pack|caja|bulto|bandeja)-\d{1,3}$/i, '');
  return stripped !== id ? stripped : `${id}-unidad`;
}

/**
 * Unidad minorista derivada de un pack de abastecimiento.
 *
 * Hereda identidad comercial —marca, nombre, variedad, categoría, envase y la
 * capacidad DE CADA UNIDAD, que es la que el pack ya declaraba— y nada más.
 * Precio, stock, código e imagen nacen pendientes: el precio del pack no se
 * divide, no se estima y no se trata como costo.
 */
export function deriveRetailUnitFromPack(pack, { unitId = '' } = {}) {
  if (!pack) return null;
  const id = unitId || deriveRetailUnitId(pack.id);
  if (!id) return null;
  const capacity = retailCapacityLabel(pack.capacityValue, pack.capacityUnit);
  const container = packageLabel(pack.packageType);
  const name = stripLogisticsFromName(pack.name);

  return {
    id,
    sku: id,
    externalId: id,
    brand: pack.brand,
    name,
    variant: pack.variant,
    categoryId: pack.categoryId,
    subcategory: pack.subcategory,
    // Copy factual, con el mismo patrón que ya usa el catálogo de autoridad.
    description: capacity ? `${name} en ${container.toLowerCase()} de ${capacity}.` : '',
    presentation: [container, capacity, 'Unidad'].filter(Boolean).join(' · '),
    capacity,
    capacityValue: pack.capacityValue,
    capacityUnit: pack.capacityUnit,
    packageType: pack.packageType,
    unit: 'unidad',
    unitLabel: 'Unidad',
    unitsPerPack: 1,
    // Datos que sólo puede aportar el local. Nada se deriva del pack.
    price: null,
    pricePending: true,
    stock: 0,
    available: false,
    gtin: '',
    // La foto del pack muestra seis botellas: no puede hacer de unidad.
    image: RETAIL_UNIT_PLACEHOLDER_IMAGE,
    imageThumbnail: RETAIL_UNIT_PLACEHOLDER_IMAGE,
    imagePending: true,
    alcoholic: pack.alcoholic === true,
    requiresAgeConfirmation: pack.requiresAgeConfirmation === true,
    minimumAge: pack.minimumAge ?? null,
    tags: (Array.isArray(pack.tags) ? pack.tags : [])
      .filter((tag) => !/^(?:pack|para-compartir|caja|bulto)$/i.test(String(tag))),
    marketNote: pack.marketNote,
    prepMinutes: pack.prepMinutes,
    // Trazabilidad del origen y del abastecimiento.
    retailUnitDerivedFrom: pack.id,
    purchasePack: {
      productId: pack.id,
      purchaseUnit: 'pack',
      unitsPerPurchasePack: positiveInteger(pack.unitsPerPack ?? pack.units_per_pack),
    },
  };
}

/**
 * Aplica la decisión comercial al catálogo.
 *
 * Cada pack no ambiguo sale de la superficie pública (`procurementOnly`) y
 * queda como referencia de abastecimiento. Si su unidad ya existe, sólo se
 * vincula; si no existe, se publica la unidad derivada. Un pack con empaque
 * ambiguo NO se toca: sin multiplicador confiable no hay unidad que derivar.
 */
export function publishRetailUnits(products = []) {
  const list = Array.isArray(products) ? products : [];
  const byId = new Map(list.map((product) => [product?.id, product]));
  const derived = [];

  const result = list.map((product) => {
    if (!product) return product;
    const packaging = detectPurchasePackaging(product);
    if (packaging.ambiguous || packaging.isPack !== true) return product;

    const existingUnitId = product.procurement?.retailUnitId;
    if (existingUnitId) {
      // CASO A: la unidad ya se vende. El pack sólo abastece.
      return { ...product, procurementOnly: true, retailUnitId: existingUnitId };
    }

    // CASO B: no hay unidad publicada. Se crea, con id libre y estable.
    const unitId = deriveRetailUnitId(product.id);
    if (!unitId || byId.has(unitId)) return { ...product, procurementOnly: true };
    const unit = deriveRetailUnitFromPack(product, { unitId });
    if (!unit) return { ...product, procurementOnly: true };
    derived.push(unit);
    byId.set(unitId, unit);
    return {
      ...product,
      procurementOnly: true,
      retailUnitId: unitId,
      procurement: {
        ...(product.procurement || {}),
        supplierProductName: [product.brand, product.name, product.presentation].filter(Boolean).join(' · '),
        purchaseUnit: packaging.purchaseUnit,
        unitsPerPurchasePack: packaging.unitsPerPack,
        retailUnitId: unitId,
        supplierPackBarcode: product.procurement?.supplierPackBarcode ?? null,
        supplierPackCost: product.procurement?.supplierPackCost ?? null,
        supplierReference: product.id,
      },
    };
  });

  return [...result, ...derived];
}

/**
 * Alias seguro para enlaces viejos: un favorito o un enlace directo que apunta
 * a un pack retirado resuelve a la unidad que lo reemplazó. Devuelve el mismo
 * id cuando no hay nada que redirigir.
 */
export function resolveRetailProductId(products = [], productId = '') {
  const id = String(productId || '');
  if (!id) return id;
  const list = Array.isArray(products) ? products : [];
  const product = list.find((candidate) => candidate?.id === id);
  if (!product?.procurementOnly) return id;
  const target = product.retailUnitId || product.procurement?.retailUnitId;
  return target && list.some((candidate) => candidate?.id === target) ? target : id;
}

/**
 * Unidades que ingresan al stock por una compra. Un pack x6 recibido suma 6
 * unidades; una unidad suma 1. Multiplicador inválido o ambiguo devuelve
 * `null`: no se adivina cuánto entró.
 */
export function unitsReceivedFromPurchase({ purchaseUnit = 'unidad', unitsPerPurchasePack = 1, quantity = 1 } = {}) {
  const packs = positiveInteger(quantity);
  if (!packs) return null;
  if (!PURCHASE_UNITS.includes(String(purchaseUnit))) return null;
  if (purchaseUnit === 'unidad') return packs;
  const multiplier = positiveInteger(unitsPerPurchasePack);
  if (!multiplier || multiplier < 2) return null;
  return packs * multiplier;
}

/**
 * Stock tras vender. La unidad de stock es la MISMA que se vende, así que una
 * venta descuenta exactamente lo vendido: no hay conversión y por lo tanto no
 * hay forma de multiplicar ni de dividir dos veces.
 */
export function applyUnitSale({ stockUnits = 0, quantity = 1 } = {}) {
  const stock = Number(stockUnits);
  const sold = positiveInteger(quantity);
  if (!Number.isInteger(stock) || stock < 0 || !sold) return null;
  if (sold > stock) return null;
  return stock - sold;
}

// ─── Códigos de barras ───────────────────────────────────────────────────────
// El catálogo hoy no tiene ninguno cargado. Estas funciones existen para que el
// día que lleguen no se mezcle el de la unidad con el de la caja: son
// simbologías distintas y significan cosas distintas.

const SYMBOLOGY_BY_LENGTH = Object.freeze({ 8: 'EAN-8', 12: 'UPC-A', 13: 'EAN-13', 14: 'GTIN-14' });

function checksumIsValid(digits) {
  const values = digits.split('').map(Number);
  const check = values.pop();
  let sum = 0;
  // Ponderación 3/1 desde la derecha: idéntica en EAN-8, UPC-A, EAN-13 y GTIN-14.
  for (let index = values.length - 1, weight = 3; index >= 0; index -= 1, weight = weight === 3 ? 1 : 3) {
    sum += values[index] * weight;
  }
  return (10 - (sum % 10)) % 10 === check;
}

/**
 * Valida un código conservando los ceros a la izquierda: el código es una
 * cadena, nunca un número. No genera, no completa y no trunca.
 */
export function validateRetailBarcode(value) {
  const raw = String(value ?? '').trim();
  if (!raw) return { valid: false, symbology: null, normalized: '', reason: 'vacío' };
  if (!/^\d+$/.test(raw)) return { valid: false, symbology: null, normalized: raw, reason: 'contiene caracteres no numéricos' };
  const symbology = SYMBOLOGY_BY_LENGTH[raw.length];
  if (!symbology) return { valid: false, symbology: null, normalized: raw, reason: `longitud ${raw.length} no corresponde a EAN-8, UPC-A, EAN-13 ni GTIN-14` };
  if (!checksumIsValid(raw)) return { valid: false, symbology, normalized: raw, reason: 'dígito verificador inválido' };
  return { valid: true, symbology, normalized: raw, reason: '' };
}

/** Un GTIN-14 identifica una agrupación logística: es de caja, no de unidad. */
export function isPurchasePackBarcode(value) {
  const result = validateRetailBarcode(value);
  return result.valid && result.symbology === 'GTIN-14';
}

/**
 * ¿El código puede usarse como código de la unidad de venta? Un GTIN-14 no
 * puede: copiar el código de la caja a la unidad es el error que hace que el
 * escáner cobre una lata como si fuera un pack.
 */
export function canUseAsUnitBarcode(value) {
  const result = validateRetailBarcode(value);
  return result.valid && result.symbology !== 'GTIN-14';
}

/**
 * Qué le falta a un producto para publicarse como unidad minorista.
 *
 * NO redefine la comprabilidad: esa sigue siendo `isPurchasableBeverageProduct`
 * y se reporta tal cual. Este informe es para la revisión humana —qué dato hay
 * que conseguir— y para las superficies que muestran estado pendiente.
 */
export function retailPublicationReadiness(product = {}) {
  const packaging = detectPurchasePackaging(product);
  const missing = [];

  if (packaging.ambiguous) missing.push('empaque ambiguo: revisar multiplicador');
  if (!String(product.name || '').trim()) missing.push('nombre público');
  if (!(Number(product.capacityValue) > 0)) missing.push('contenido');
  if (!String(product.capacityUnit || '').trim()) missing.push('unidad de contenido');
  if (product.pricePending === true || !(Number(product.price) > 0)) missing.push('precio de venta unitario aprobado');
  if (!String(product.image || product.imageThumbnail || '').trim()) missing.push('imagen de la unidad');
  if (!String(product.gtin || product.unitBarcode || '').trim()) missing.push('código de barras de la unidad');
  if (!Number.isInteger(Number(product.stock)) || Number(product.stock) < 0) missing.push('stock unitario entero');

  return {
    ready: missing.length === 0,
    missing,
    purchasable: isPurchasableBeverageProduct(product),
    ambiguous: packaging.ambiguous,
    isPack: packaging.isPack,
    unitsPerPurchasePack: packaging.isPack ? packaging.unitsPerPack : 1,
  };
}
