// Alta de producto desde el mostrador: escaneás, completás y recién ahí se publica.
// Dos reglas que no se negocian: no se inventa ningún dato y un código desconocido nunca publica solo.

export const ONBOARDING_STEPS = Object.freeze(['scan', 'match', 'complete', 'review', 'publish']);

const STEP_COPY = Object.freeze({
  scan: { title: 'Escanear el código', detail: 'Pasá el producto por el lector.' },
  match: { title: 'Buscar si ya existe', detail: 'Si ya está cargado, te llevamos a ese producto.' },
  complete: { title: 'Completar los datos', detail: 'Nombre, marca, categoría, presentación, precio y stock.' },
  review: { title: 'Revisar cómo se va a ver', detail: 'Mirá la ficha antes de que la vea un cliente.' },
  publish: { title: 'Publicar', detail: 'Lo confirma el dueño o el encargado.' },
});

export const PACKAGE_TYPES = Object.freeze([
  Object.freeze({ value: 'unit', label: 'Unidad suelta', factorFixed: 1 }),
  Object.freeze({ value: 'pack', label: 'Pack', factorFixed: null }),
  Object.freeze({ value: 'case', label: 'Caja', factorFixed: null }),
]);

export const CAPACITY_UNITS = Object.freeze(['ml', 'l', 'g', 'kg', 'unidad']);

// Un código que no conocemos abre un borrador. Nunca un producto publicado.
export function planScanOutcome({ scan, lookup } = {}) {
  if (!scan || !scan.isValid) {
    return Object.freeze({
      step: 'scan',
      outcome: 'invalid',
      headline: 'Ese código no se pudo leer',
      detail: scanRejectionDetail(scan),
      canCreateDraft: false,
    });
  }
  const binding = lookup && typeof lookup === 'object' ? lookup : null;
  if (binding?.product_id) {
    const product = normalizeBoundProduct(binding);
    return Object.freeze({
      step: 'match',
      outcome: 'existing',
      headline: `Ya está cargado: ${product.name}`,
      detail: 'Podés ajustar stock o precio desde su ficha en vez de crearlo de nuevo.',
      canCreateDraft: false,
      product,
    });
  }
  return Object.freeze({
    step: 'complete',
    outcome: 'unknown',
    headline: 'Código nuevo',
    detail: 'Se abre un borrador con el código. Falta completar para poder publicarlo.',
    canCreateDraft: true,
    gtin: String(scan.normalizedValue || ''),
    format: String(scan.format || ''),
  });
}

export function describeDraft(draft = {}, { operatorName = '' } = {}) {
  return Object.freeze({
    id: String(draft.id || ''),
    gtin: String(draft.scanned_gtin || ''),
    format: gtinFormat(String(draft.scanned_gtin || '')),
    createdAt: String(draft.created_at || ''),
    createdBy: String(operatorName || ''),
    status: 'Falta completar',
    // Lo detectado se ofrece como sugerencia editable; nunca se da por cierto.
    suggestions: Object.freeze({
      name: String(draft.suggested_name || ''),
      brand: String(draft.suggested_brand || ''),
      category: String(draft.suggested_category || ''),
      presentation: String(draft.suggested_presentation || ''),
    }),
    hasSuggestions: Boolean(draft.suggested_name || draft.suggested_brand || draft.suggested_category),
  });
}

export function validateProductDraft(fields = {}, { existingGtinOwner = null } = {}) {
  const errors = [];
  const name = trim(fields.name, 160);
  const brand = trim(fields.brand, 80);
  const category = trim(fields.category, 80);
  const variant = trim(fields.variant, 80);
  const packageType = PACKAGE_TYPES.some((entry) => entry.value === fields.packageType) ? String(fields.packageType) : '';
  const capacityUnit = CAPACITY_UNITS.includes(String(fields.capacityUnit)) ? String(fields.capacityUnit) : '';
  const capacityValue = Number(fields.capacityValue);
  const unitsPerPack = Number(fields.unitsPerPack);
  const stock = Number(fields.stock);
  const pricePending = fields.pricePending === true;
  const price = Number(fields.price);
  const cost = fields.cost === '' || fields.cost === null || fields.cost === undefined ? null : Number(fields.cost);

  if (name.length < 2) errors.push({ field: 'name', message: 'Escribí el nombre tal como figura en el envase.' });
  if (brand.length < 2) errors.push({ field: 'brand', message: 'Escribí la marca. No la adivinamos por vos.' });
  if (category.length < 2) errors.push({ field: 'category', message: 'Elegí una categoría para que aparezca donde corresponde.' });
  if (!packageType) errors.push({ field: 'packageType', message: 'Indicá si es unidad, pack o caja.' });
  if (!variant) errors.push({ field: 'variant', message: 'Escribí la presentación, por ejemplo "Botella 1 L".' });
  if (!capacityUnit) errors.push({ field: 'capacityUnit', message: 'Elegí la unidad de medida del contenido.' });
  if (!Number.isFinite(capacityValue) || capacityValue <= 0) {
    errors.push({ field: 'capacityValue', message: 'Cargá cuánto contiene, por ejemplo 1 para "1 L".' });
  }
  if (!Number.isSafeInteger(unitsPerPack) || unitsPerPack < 1) {
    errors.push({ field: 'unitsPerPack', message: 'Las unidades por pack tienen que ser 1 o más.' });
  } else if (packageType === 'unit' && unitsPerPack !== 1) {
    errors.push({ field: 'unitsPerPack', message: 'Una unidad suelta contiene exactamente 1 unidad.' });
  } else if (packageType !== 'unit' && unitsPerPack === 1) {
    errors.push({ field: 'unitsPerPack', message: 'Un pack o caja tiene más de 1 unidad. Revisá el número.' });
  }
  if (!Number.isSafeInteger(stock) || stock < 0) {
    errors.push({ field: 'stock', message: 'Cargá cuántas unidades tenés hoy. Puede ser 0.' });
  }
  if (pricePending) {
    if (Number.isFinite(price) && price > 0) {
      errors.push({ field: 'price', message: 'Elegí una cosa: o dejás el precio pendiente, o cargás el precio.' });
    }
  } else if (!Number.isFinite(price) || price <= 0) {
    errors.push({ field: 'price', message: 'Cargá el precio de venta, o marcá "precio pendiente".' });
  }
  if (cost !== null && (!Number.isFinite(cost) || cost < 0)) {
    errors.push({ field: 'cost', message: 'El costo tiene que ser un número. Podés dejarlo vacío.' });
  }
  if (cost !== null && Number.isFinite(price) && price > 0 && cost > price) {
    errors.push({ field: 'cost', message: 'El costo es mayor que el precio: estarías vendiendo a pérdida. Revisalo.' });
  }
  if (existingGtinOwner) {
    errors.push({
      field: 'gtin',
      message: `Ese código ya está asignado a "${String(existingGtinOwner)}". Un código no puede apuntar a dos productos.`,
    });
  }

  if (errors.length) return Object.freeze({ ok: false, errors: Object.freeze(errors.map((error) => Object.freeze(error))) });

  return Object.freeze({
    ok: true,
    errors: Object.freeze([]),
    value: Object.freeze({
      name,
      brand,
      category,
      variant,
      capacityValue: round3(capacityValue),
      capacityUnit,
      packageType,
      unitsPerPack,
      stock,
      pricePending,
      price: pricePending ? null : round2(price),
      cost: cost === null ? null : round2(cost),
      presentation: variant,
      capacity: `${round3(capacityValue)} ${capacityUnit}`,
    }),
  });
}

// Lo que el cliente va a ver. Si algo falta, se dice acá y no después de publicar.
export function buildStorefrontPreview(value = {}, { imageReady = false } = {}) {
  const blockers = [];
  if (!imageReady) blockers.push('Falta la foto aprobada del producto.');
  if (value.pricePending) blockers.push('El precio está pendiente: se va a ver, pero nadie va a poder comprarlo.');
  if (Number(value.stock || 0) <= 0) blockers.push('Sin stock cargado no se puede comprar.');
  return Object.freeze({
    title: String(value.name || 'Producto sin nombre'),
    subtitle: [value.brand, value.presentation].filter(Boolean).join(' · '),
    priceLabel: value.pricePending ? 'Precio pendiente' : formatMoney(value.price),
    availabilityLabel: value.pricePending
      ? 'Visible, no se puede comprar'
      : Number(value.stock || 0) > 0 && imageReady
        ? 'A la venta'
        : 'Visible cuando se complete',
    purchasable: !value.pricePending && Number(value.stock || 0) > 0 && imageReady,
    blockers: Object.freeze(blockers),
  });
}

export function describePublishReadiness(readiness = {}) {
  const missing = [];
  if (!readiness.details_complete) missing.push('Completar los datos del producto.');
  if (!readiness.image_bound) missing.push('Cargar la foto del producto con sus derechos aprobados.');
  if (!readiness.barcode_bound) missing.push('Vincular el código de barras.');
  if (readiness.price_status === 'pending') missing.push('Confirmar el precio para que se pueda comprar.');
  if (!readiness.stock_positive) missing.push('Cargar stock.');
  return Object.freeze({
    published: Boolean(readiness.published),
    visible: Boolean(readiness.visible),
    purchasable: Boolean(readiness.purchasable),
    missing: Object.freeze(missing),
    headline: readiness.purchasable
      ? 'Está a la venta en la web'
      : readiness.visible
        ? 'Se ve en la web, pero todavía no se puede comprar'
        : 'Todavía no aparece en la web',
  });
}

export function stepsForDraft(currentStep) {
  const index = Math.max(0, ONBOARDING_STEPS.indexOf(String(currentStep)));
  return Object.freeze(ONBOARDING_STEPS.map((id, position) => Object.freeze({
    id,
    index: position + 1,
    title: STEP_COPY[id].title,
    detail: STEP_COPY[id].detail,
    state: position < index ? 'done' : position === index ? 'current' : 'waiting',
  })));
}

function scanRejectionDetail(scan) {
  return ({
    INVALID_CHECK_DIGIT: 'El código está incompleto o la etiqueta está dañada. Probá de nuevo.',
    NON_NUMERIC_GTIN: 'Llegaron letras donde van números. Revisá la configuración del lector.',
    UNSUPPORTED_FORMAT: 'El largo del código no corresponde a un código de producto estándar.',
    FORMAT_NOT_ALLOWED: 'Ese tipo de código no está habilitado acá.',
    DUPLICATE_SCAN: 'Es la misma lectura de recién. Escaneá otra vez si querés repetirla.',
  })[String(scan?.reason || '')] || 'No llegó una lectura completa.';
}

function normalizeBoundProduct(binding) {
  const product = Array.isArray(binding.products) ? binding.products[0] : binding.products || {};
  return Object.freeze({
    id: String(binding.product_id || product.id || ''),
    name: String(product.name || 'Producto'),
    brand: String(product.brand || ''),
    presentation: String(product.presentation || binding.package_type || ''),
    stock: Number.isFinite(Number(product.stock)) ? Number(product.stock) : 0,
    unitFactor: Number(binding.unit_factor || 1),
  });
}

function gtinFormat(value) {
  return ({ 8: 'EAN-8', 12: 'UPC-A', 13: 'EAN-13', 14: 'GTIN-14' })[value.length] || '';
}

function trim(value, max) {
  return String(value ?? '').trim().slice(0, max);
}

function round2(value) {
  return Math.round(Number(value) * 100) / 100;
}

function round3(value) {
  return Math.round(Number(value) * 1000) / 1000;
}

function formatMoney(value) {
  const amount = Number(value);
  return new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS' })
    .format(Number.isFinite(amount) ? amount : 0);
}
