/*
 * PRECIOS, COSTOS Y MÁRGENES DEL CATÁLOGO.
 *
 * Funciones puras, en pesos con dos decimales. Todo se cuenta en CENTAVOS
 * enteros: `0.1 + 0.2` no es `0.3` en JavaScript, y una ganancia de
 * $ 499,99999 que se muestra como $ 500 es una mentira chiquita que se repite
 * en cada fila.
 *
 * Nada de esto se guarda. Margen, recargo y ganancia se calculan en el
 * navegador a partir de lo que SÍ se guarda —precio de venta, costo y precio
 * regular—, así no puede haber un margen guardado que contradiga al precio.
 *
 * Las dos cuentas que el mostrador confunde:
 *
 *   margen sobre venta   = (precio − costo) / precio   ¿cuánto de cada venta es ganancia?
 *   recargo sobre costo  = (precio − costo) / costo    ¿cuánto le sumé al costo?
 *
 * Costo 1000 y precio 1500: el margen es 33,33 % y el recargo es 50 %. Las
 * dos son verdad; dicen cosas distintas.
 *
 * Lo que no se puede calcular devuelve `null`, nunca cero: «sin costo» no es
 * «costo cero», y un recargo sobre un costo de $ 0 no existe.
 */

/** 9.999.999.999,99: el tope de `numeric(12, 2)`, igual que el servidor. */
export const MONEY_MAX_CENTS = 999999999999;

export const PRICING_EXPLANATION = 'Margen: cuánto de cada venta es ganancia. Recargo: cuánto le sumás al costo.';

const DECIMAL_TEXT = /^-?\d+(?:\.\d+)?$/;

/**
 * Redondeo al entero, mitad hacia arriba (lejos del cero). `toPrecision(15)`
 * borra el ruido de punto flotante antes de redondear: `1.005 * 100` da
 * `100.49999999999999`, que sin esto se redondeaba para abajo.
 */
function roundHalfUp(value) {
  if (!Number.isFinite(value)) return NaN;
  const magnitude = Math.round(Number(Math.abs(value).toPrecision(15)));
  return value < 0 ? -magnitude : magnitude;
}

/** Importe → centavos enteros. Acepta número o texto decimal con punto («1500.50», como lo manda la base). */
export function toCents(value) {
  let number;
  if (typeof value === 'number') number = value;
  else if (typeof value === 'string' && DECIMAL_TEXT.test(value.trim())) number = Number(value.trim());
  else return null;
  if (!Number.isFinite(number)) return null;
  const cents = roundHalfUp(number * 100);
  return Number.isSafeInteger(cents) ? cents : null;
}

export function fromCents(cents) {
  return Number.isSafeInteger(cents) ? cents / 100 : null;
}

/** Importe redondeado a centavos, o `null` si no es un importe. */
export function roundMoney(value) {
  return fromCents(toCents(value));
}

/** Centavos → el texto que acepta el servidor: «1500» o «1500.50». Sin separador de miles. */
export function centsToApiString(cents) {
  if (!Number.isSafeInteger(cents) || cents < 0) return null;
  const whole = Math.floor(cents / 100);
  const rest = cents % 100;
  return rest ? `${whole}.${String(rest).padStart(2, '0')}` : String(whole);
}

/**
 * Importe escrito por una persona, con punto o coma decimal.
 *
 * Devuelve `{ empty: true }`, `{ cents }` o `{ error }`, donde `error` es uno de
 * 'format', 'negative', 'ambiguous', 'decimals', 'grouping' o 'range'.
 *
 * LA REGLA, porque «1.234» es mil doscientos treinta y cuatro en Neuquén y uno
 * con doscientos treinta y cuatro milésimos en una planilla en inglés:
 *
 *   · sin separador ............ «1500»          → 1500
 *   · un solo separador seguido
 *     de 1 o 2 dígitos ......... «1500,5» «1500.50» → decimal
 *   · un solo separador seguido
 *     de exactamente 3 dígitos . «1.234» «1,234»  → AMBIGUO, se rechaza: puede
 *                                                   ser mil doscientos treinta y
 *                                                   cuatro o un importe con tres
 *                                                   decimales. Un precio mil
 *                                                   veces más chico se vende.
 *   · el mismo separador varias
 *     veces, en grupos de tres .. «1.234.567»      → miles: 1234567
 *   · punto Y coma ............. «1.234,50» «1,234.50» → el ÚLTIMO es el
 *                                                   decimal (1 o 2 dígitos) y
 *                                                   el otro, miles en grupos de
 *                                                   tres. Si los grupos no
 *                                                   cierran, se rechaza.
 *
 * Se acepta un «$» adelante. No se aceptan signo, espacios en el medio ni
 * notación científica.
 */
export function parseMoneyText(raw) {
  let text = String(raw ?? '').trim();
  if (!text) return { empty: true };
  text = text.replace(/^\$\s*/, '');
  if (/^[-−]/.test(text)) return { error: 'negative' };
  if (!/^[0-9.,]+$/.test(text)) return { error: 'format' };
  const dots = (text.match(/\./g) || []).length;
  const commas = (text.match(/,/g) || []).length;
  let integer = text;
  let decimals = '';
  if (dots && commas) {
    const decimalSeparator = text.lastIndexOf('.') > text.lastIndexOf(',') ? '.' : ',';
    const thousands = decimalSeparator === '.' ? ',' : '.';
    const parts = text.split(decimalSeparator);
    if (parts.length !== 2) return { error: 'grouping' };
    const grouping = new RegExp(`^[1-9]\\d{0,2}(?:\\${thousands}\\d{3})+$`);
    if (!grouping.test(parts[0])) return { error: 'grouping' };
    if (!/^\d{1,2}$/.test(parts[1])) return { error: 'decimals' };
    integer = parts[0].split(thousands).join('');
    decimals = parts[1];
  } else if (dots + commas > 1) {
    const separator = dots ? '.' : ',';
    const parts = text.split(separator);
    if (!/^[1-9]\d{0,2}$/.test(parts[0]) || parts.slice(1).some((part) => !/^\d{3}$/.test(part))) {
      return { error: 'grouping' };
    }
    integer = parts.join('');
  } else if (dots + commas === 1) {
    const [whole, fraction] = text.split(dots ? '.' : ',');
    if (!/^\d+$/.test(whole) || !/^\d+$/.test(fraction)) return { error: 'format' };
    if (fraction.length === 3 && /^[1-9]\d{0,2}$/.test(whole)) return { error: 'ambiguous' };
    if (fraction.length > 2) return { error: 'decimals' };
    integer = whole;
    decimals = fraction;
  }
  const cents = Number(integer) * 100 + Number(decimals.padEnd(2, '0') || '0');
  if (!Number.isSafeInteger(cents) || cents > MONEY_MAX_CENTS) return { error: 'range' };
  return { cents };
}

function nonNegativeCents(value) {
  const cents = toCents(value);
  return cents === null || cents < 0 ? null : cents;
}

/** Ganancia por unidad: precio − costo. Puede ser negativa (se vende por debajo del costo). */
export function unitProfit(price, cost) {
  const priceCents = nonNegativeCents(price);
  const costCents = nonNegativeCents(cost);
  if (priceCents === null || costCents === null) return null;
  return fromCents(priceCents - costCents);
}

/** Margen sobre venta, como proporción (0.3333…). `null` sin precio mayor que cero o sin costo. */
export function grossMarginOnSale(price, cost) {
  const priceCents = nonNegativeCents(price);
  const costCents = nonNegativeCents(cost);
  if (priceCents === null || costCents === null || priceCents === 0) return null;
  return (priceCents - costCents) / priceCents;
}

/** Recargo sobre costo, como proporción (0.5). `null` si el costo falta o es cero: no hay sobre qué recargar. */
export function markupOnCost(price, cost) {
  const priceCents = nonNegativeCents(price);
  const costCents = nonNegativeCents(cost);
  if (priceCents === null || costCents === null || costCents === 0) return null;
  return (priceCents - costCents) / costCents;
}

/** Precio que deja ese margen sobre venta: costo / (1 − margen). El margen tiene que ser menor que 1 (100 %). */
export function priceForMargin(cost, margin) {
  const costCents = nonNegativeCents(cost);
  const ratio = Number(margin);
  if (costCents === null || margin === null || margin === '' || !Number.isFinite(ratio) || ratio >= 1) return null;
  const cents = roundHalfUp(costCents / (1 - ratio));
  return Number.isSafeInteger(cents) && cents <= MONEY_MAX_CENTS ? fromCents(cents) : null;
}

/** Precio que deja ese recargo sobre costo: costo × (1 + recargo). El recargo no puede bajar de −100 %. */
export function priceForMarkup(cost, markup) {
  const costCents = nonNegativeCents(cost);
  const ratio = Number(markup);
  if (costCents === null || markup === null || markup === '' || !Number.isFinite(ratio) || ratio < -1) return null;
  const cents = roundHalfUp(costCents * (1 + ratio));
  return Number.isSafeInteger(cents) && cents <= MONEY_MAX_CENTS ? fromCents(cents) : null;
}

/** Descuento de la promo: (antes − ahora) / antes. `null` si no hay precio regular mayor que el de venta. */
export function promoDiscount(price, compareAtPrice) {
  const priceCents = nonNegativeCents(price);
  const regularCents = nonNegativeCents(compareAtPrice);
  if (priceCents === null || regularCents === null || priceCents === 0 || regularCents <= priceCents) return null;
  return (regularCents - priceCents) / regularCents;
}

const MONEY_FORMAT = {
  whole: new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', minimumFractionDigits: 0, maximumFractionDigits: 0 }),
  cents: new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', minimumFractionDigits: 2, maximumFractionDigits: 2 }),
};
const PERCENT_FORMAT = new Intl.NumberFormat('es-AR', { minimumFractionDigits: 0, maximumFractionDigits: 2 });

/** «$ 1.500» o «$ 1.500,50». Sin decimales cuando son cero: así se escribe un precio en el mostrador. */
export function formatMoney(value) {
  const cents = toCents(value);
  if (cents === null) return '';
  return (cents % 100 === 0 ? MONEY_FORMAT.whole : MONEY_FORMAT.cents).format(cents / 100);
}

/** Proporción → «33,33 %». Dos decimales como mucho. */
export function formatPercent(ratio) {
  if (ratio === null || ratio === undefined || !Number.isFinite(Number(ratio))) return '';
  const hundredths = roundHalfUp(Number(ratio) * 10000) / 100;
  return `${PERCENT_FORMAT.format(Object.is(hundredths, -0) ? 0 : hundredths)} %`;
}

/** Proporción → porcentaje con dos decimales (33.33). Para comparar y probar sin depender del formato. */
export function toPercent(ratio) {
  if (ratio === null || ratio === undefined || !Number.isFinite(Number(ratio))) return null;
  const hundredths = roundHalfUp(Number(ratio) * 10000) / 100;
  return Object.is(hundredths, -0) ? 0 : hundredths;
}

/**
 * Todo lo que el Panel dice de un precio, en una sola cuenta.
 *
 * `labels` son textos listos para el mostrador; `warnings`, lo que conviene
 * mirar antes de guardar. No decide nada: vender por debajo del costo puede
 * ser una liquidación a propósito. Lo dice y deja que el dueño decida.
 */
export function describePricing({ price = null, cost = null, compareAtPrice = null } = {}) {
  const priceCents = nonNegativeCents(price);
  const costCents = nonNegativeCents(cost);
  const regularCents = nonNegativeCents(compareAtPrice);
  const hasPrice = priceCents !== null && priceCents > 0;
  const hasCost = costCents !== null;
  const priceValue = hasPrice ? fromCents(priceCents) : null;
  const costValue = hasCost ? fromCents(costCents) : null;
  const profit = hasPrice && hasCost ? fromCents(priceCents - costCents) : null;
  const margin = hasPrice && hasCost ? (priceCents - costCents) / priceCents : null;
  const markup = hasPrice && hasCost && costCents > 0 ? (priceCents - costCents) / costCents : null;
  const promo = regularCents !== null && regularCents > 0;
  const promoValid = !promo ? null : hasPrice ? regularCents > priceCents : null;
  const discount = promoValid ? (regularCents - priceCents) / regularCents : null;
  const belowCost = hasPrice && hasCost && priceCents < costCents;
  const atCost = hasPrice && hasCost && priceCents === costCents;

  const warnings = [];
  if (belowCost) warnings.push(`Precio menor al costo: perdés ${formatMoney(fromCents(costCents - priceCents))} por unidad.`);
  if (atCost) warnings.push('Precio igual al costo: no deja ganancia.');
  if (promoValid === false) warnings.push('El precio regular (antes) tiene que ser mayor que el precio de venta.');

  const missing = !hasPrice ? 'Sin precio' : 'Sin costo';
  const labels = {
    price: hasPrice ? formatMoney(priceValue) : 'Sin precio',
    cost: hasCost ? formatMoney(costValue) : 'Sin costo',
    profit: profit === null ? missing : formatMoney(profit),
    margin: margin === null ? missing : formatPercent(margin),
    markup: markup !== null ? formatPercent(markup)
      : hasPrice && hasCost ? 'No se calcula con costo $ 0' : missing,
    promo: discount !== null
      ? `Antes ${formatMoney(fromCents(regularCents))} · ${formatPercent(discount)} menos`
      : '',
  };
  let summary;
  if (!hasPrice) summary = hasCost ? 'Falta el precio de venta para calcular la ganancia.' : 'Sin precio ni costo cargados.';
  else if (!hasCost) summary = 'Sin costo: cargalo para ver ganancia, margen y recargo.';
  else summary = `Ganancia por unidad ${labels.profit} · Margen sobre venta ${labels.margin} · Recargo sobre costo ${labels.markup}`;
  labels.summary = summary;

  let tone = 'ok';
  if (!hasPrice || !hasCost) tone = 'muted';
  if (atCost || promoValid === false) tone = 'warning';
  if (belowCost) tone = 'danger';

  return {
    price: priceValue,
    cost: costValue,
    compareAtPrice: promo ? fromCents(regularCents) : null,
    profit, margin, markup, discount,
    hasPrice, hasCost, belowCost, atCost, promoValid,
    tone,
    labels,
    warnings,
  };
}
