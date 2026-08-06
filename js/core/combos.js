/*
 * Combos comerciales de TABA2.
 *
 * Un combo NO guarda su precio. Guarda sus componentes, sus cantidades y el
 * descuento que el comercio decidió aplicar; todo lo demás —precio individual,
 * precio promocional, ahorro, stock y validación +18— se DERIVA del catálogo
 * vivo cada vez que se arma la góndola.
 *
 * La razón es que un precio guardado en el manifiesto envejece en silencio: el
 * día que el local sube el precio de la lata, la tarjeta sigue prometiendo un
 * ahorro que ya no existe y nadie se entera hasta que alguien compara. Con la
 * derivación, un componente que cambia de precio mueve el combo entero, y un
 * componente sin precio confirmado BLOQUEA el combo en vez de completarlo con
 * un número inventado.
 */

// El ahorro se redondea a la centena inferior. Es la convención de precio de
// góndola en Argentina y además garantiza que el ahorro anunciado nunca sea
// menor que el real: redondear el precio promocional HACIA ABAJO sólo puede
// agrandar el ahorro, nunca achicarlo.
const PRICE_ROUNDING = 100;

export function roundPromotionalPrice(amount) {
  return Math.floor(amount / PRICE_ROUNDING) * PRICE_ROUNDING;
}

/**
 * Resuelve un combo contra el catálogo vivo.
 *
 * Devuelve siempre un objeto: un combo bloqueado se sigue pudiendo mostrar y
 * tiene que poder explicar POR QUÉ está bloqueado. Nunca devuelve un precio
 * parcial: si falta un solo componente, no hay precio individual que anunciar.
 */
export function resolveCombo(combo, products) {
  const byId = new Map((Array.isArray(products) ? products : []).map((product) => [String(product.id), product]));
  const blockers = [];
  const components = [];

  for (const component of combo.components || []) {
    const product = byId.get(String(component.sku));
    const quantity = Math.max(1, Math.floor(Number(component.quantity) || 0));
    if (!product) {
      blockers.push(`${component.sku}: el componente no está en el catálogo publicado.`);
      continue;
    }
    const price = Number(product.price);
    if (product.pricePending || !Number.isFinite(price) || price <= 0) {
      blockers.push(`${component.sku}: precio pendiente de confirmación del negocio.`);
    }
    const stock = Math.max(0, Math.floor(Number(product.stock) || 0));
    if (!product.available || stock <= 0) {
      blockers.push(`${component.sku}: sin stock disponible.`);
    }
    components.push({
      sku: String(product.id),
      quantity,
      product,
      unitPrice: Number.isFinite(price) && price > 0 ? price : null,
      linePrice: Number.isFinite(price) && price > 0 ? price * quantity : null,
      // Las sustituciones se declaran por SKU en el manifiesto y se resuelven
      // acá: una sustitución que ya no existe o que cambió de precio deja de
      // ofrecerse en vez de prometer un cambio que el mostrador no puede hacer.
      substitutions: (component.substitutions || [])
        .map((sku) => byId.get(String(sku)))
        .filter((candidate) => (
          candidate
          && !candidate.pricePending
          && candidate.available
          && Number(candidate.price) === price
        ))
        .map((candidate) => ({ sku: String(candidate.id), name: candidate.name, unitLabel: candidate.unitLabel })),
      // Stock que este componente puede sostener por sí solo.
      maxCombos: quantity > 0 ? Math.floor(stock / quantity) : 0,
    });
  }

  if (!components.length) blockers.push('El combo no declara componentes.');

  const priced = blockers.length === 0;
  const individualPrice = priced
    ? components.reduce((total, component) => total + component.linePrice, 0)
    : null;
  const discount = Math.max(0, Math.min(90, Number(combo.discountPercentage) || 0));
  const promotionalPrice = priced ? roundPromotionalPrice(individualPrice * (1 - discount / 100)) : null;
  const savings = priced ? individualPrice - promotionalPrice : null;

  // El stock del combo es el del componente LIMITANTE: prometer más unidades
  // que las que sostiene el componente más escaso es prometer un combo que el
  // mostrador no puede armar.
  const limiting = components.reduce(
    (worst, component) => (worst === null || component.maxCombos < worst.maxCombos ? component : worst),
    null,
  );
  const stock = components.length ? Math.max(0, Math.min(...components.map((c) => c.maxCombos))) : 0;

  // +18 si CUALQUIER componente lo exige. La restricción de un componente se
  // propaga al combo entero: no existe un combo "medio alcohólico".
  const ageRestricted = components.some((component) => Boolean(component.product?.alcoholic));

  return {
    ...combo,
    components,
    individualPrice,
    promotionalPrice,
    savings,
    savingsPercentage: priced && individualPrice > 0
      ? Math.round((savings / individualPrice) * 1000) / 10
      : null,
    stock,
    limitingSku: limiting?.sku || null,
    ageRestricted,
    minimumAge: ageRestricted ? 18 : null,
    available: priced && stock > 0,
    blockers,
  };
}

export function resolveCombos(manifest, products) {
  return (Array.isArray(manifest) ? manifest : []).map((combo) => resolveCombo(combo, products));
}

/** Combos que hoy se pueden mostrar con precio y ahorro reales. */
export function purchasableCombos(manifest, products) {
  return resolveCombos(manifest, products).filter((combo) => combo.available);
}
