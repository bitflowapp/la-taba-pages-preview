/*
 * CAMPAÑAS ANIMADAS — el motor.
 *
 * Tres trabajos, los tres puros (datos adentro, datos o texto afuera):
 *
 *   1 · decidir si una campaña PUEDE mostrarse           → campaignProblems
 *   2 · elegir una por superficie entre las que pueden   → selectCampaigns
 *   3 · escribir su HTML                                 → campaignMarkup
 *
 * La animación no vive acá: es CSS (`styles/campaigns.css`), y cuándo corre lo
 * decide `campaign-motion.js`. Sin ninguno de los dos, lo que este módulo
 * escribe ya es una pieza estática completa: escena en su cuadro final, texto
 * y acción. Ese es el respaldo, y no hay que hacer nada para llegar a él.
 *
 * FALLA CERRADO EN CADENA. Una campaña se descarta si está apagada, si no está
 * aprobada, si está fuera de vigencia, si su texto afirma dinero, o si su
 * producto no existe o no se puede comprar AHORA. El motor elige entre piezas
 * válidas; no inventa una para llenar un hueco.
 */
import { campaignIdentityMatches, resolveCampaignProductAsset } from './campaign-product.js';
import { beerPour } from './presets/beer-pour.js';
import { coldCan } from './presets/cold-can.js';
import { productDrop } from './presets/product-drop.js';
import { iceReveal } from './presets/ice-reveal.js';
import { spotlightProduct } from './presets/spotlight-product.js';
import { glassFill } from './presets/glass-fill.js';
import { CAMPAIGN_VESSELS, safeColor, sceneId, shade } from './presets/shared.js';

export const CAMPAIGN_PRESETS = Object.freeze({
  [beerPour.id]: beerPour,
  [coldCan.id]: coldCan,
  [productDrop.id]: productDrop,
  [iceReveal.id]: iceReveal,
  [spotlightProduct.id]: spotlightProduct,
  [glassFill.id]: glassFill,
});

export const CAMPAIGN_PLACEMENTS = Object.freeze(['home-hero', 'home-inline', 'catalog-inline']);

/*
 * La leyenda que la ley argentina (24.788, art. 6) exige en toda publicidad de
 * bebidas alcohólicas. No es un campo de la campaña: el motor la agrega sola
 * cuando el producto es alcohólico, así no se puede olvidar ni reescribir.
 */
export const ALCOHOL_LEGAL_NOTICE = 'Beber con moderación. Prohibida su venta a menores de 18 años.';

/*
 * Lo que el texto de una pieza editorial no puede decir. Precio, porcentaje,
 * oferta y descuento tienen dueño y contrato propio; la urgencia y la
 * popularidad sin dato son invención. Es la misma regla que ya protege al hero
 * de la home, escrita una sola vez.
 */
/*
 * La lista creció porque la primera versión dejaba pasar lo que más importa.
 * «Precio especial», «50 OFF», «Mitad de precio», «Llevá 3, pagá 2», «Regalo
 * con tu compra», «Hasta agotar stock», «Sólo por hoy», «Cuotas sin interés»,
 * «La más elegida»: ninguna tenía problema, y el esquema de las campañas es el
 * contrato que va a escribir el panel del comercio. Un texto editorial no habla
 * de plata, de cantidades, de plazos ni de quién más lo compra.
 *
 * Cada raíz apunta al reclamo y no a la palabra vecina: «precio» no puede
 * tumbar «preciosa», ni «queda poco» a «queda bien con todo», ni «de regalo» a
 * «para regalar». Y una cifra con multiplicador —«2 mil», «2 lucas», «2k»,
 * «40 menos»— es un precio aunque tenga un solo dígito.
 */
const FORBIDDEN_COPY = /\$|%|\b(?:descuent|ofert|promo|rebaj|liquidaci|gratis|ahorr|barat|imperdible|ultim[ao]s?\b|por tiempo limitado|limitad|mas vendid|precios?\b|sorte|premio|cupon|codigo\b|hot sale|black friday|cyber|antes\s+(?:\d|costaba|salia|valia|era\b)|\d+\s*x\s*\d+|off\b|mitad\b(?! de (?:semana|mes|camino))|regalos?\b|regalamos|regalan\b|sin cargo|sin costo|bonific|cuotas?\b|interes\b|stock\b|agot|poc[ao]s\b|quedan? (?:poc|\d|solo|l[ao]s? ultim)|(?:solo|no) quedan?\b|solo por (?:hoy|est[aeo]|tiempo|un)|solo hoy|solamente hoy|hoy nomas|hasta (?:el|la|este|esta|manana)\b|vence|termina|pesos\b|\d+\s*peso\b|ars\b|\d+\s*por\s*\d+|(?:un[ao]?|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez|cien|quinientos)\s+(?:mil|lucas?|por\s+(?:un[ao]?|dos|tres)|x\s+(?:un[ao]?|dos|tres))\b|llev(?:a|as|ate|e|en)\s+(?:\d|un[ao]?\b|dos\b|tres\b)|pag(?:a|as|ue)\s*(?:\d|un[ao]?\b|dos\b)|segunda (?:unidad|al)\b|\d+\s*(?:da|ra|ta)\.? unidad|\d+\s*(?:mil|lucas?|k)\b|lucas?\b|\d+\s*menos\b|(?:mas|muy) (?:elegid|pedid|popular|querid)|favorit|numero uno|nro\.? ?1\b)/i;
/*
 * Y un número suelto en el título o en la acción es un precio hasta que se
 * demuestre lo contrario: «Heineken a 2500», «Desde 1.999». La presentación
 * —710 ml, 2,25 L— no se escribe acá: sale del producto real. El rótulo queda
 * afuera de esta regla porque es la marca, y hay marcas con número.
 */
const NUMERIC_CLAIM = /\d{3,}|\d[.,]\d/;
// El rótulo admite la marca con número («Fernet 1882», «7UP»), no un número con
// forma de precio: «Ahora 2500», «Lata 1.999», «2500 la lata».
const EYEBROW_PRICE = /(?:^|\s)(?:a|desde|por|solo|ahora|hoy|hasta)\s+\d|^\s*\d{3,}\b|\d[.,]\d/i;

const GRID_PIECE_AFTER = 4;
const GRID_PIECE_MIN_PRODUCTS = 8;

function plain(value) {
  return String(value ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '');
}

function text(value, max) {
  return String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (char) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]
  ));
}

/*
 * Una vigencia es un INSTANTE, escrito de la única forma que todos los motores
 * leen igual: fecha, hora y huso («2026-10-31T23:59:59-03:00»).
 *
 * `Date.parse` a secas aceptaba más de lo que entendía. Una fecha sola
 * —«2026-10-31»— se lee como medianoche UTC: en Neuquén la campaña terminaba a
 * las 21:00 del día anterior y empezaba tres horas antes de lo aprobado. Y lo
 * que no es ISO —«2026-10-31 23:59», «31/10/2026»— queda a criterio de cada
 * navegador: la misma campaña podía verse en Android y no en iPhone. Lo que no
 * tiene esta forma es una fecha ilegible, y una fecha ilegible apaga la pieza.
 */
const ISO_INSTANT = /^(\d{4})-(\d{2})-(\d{2})T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:\d{2})$/;

function timestamp(value) {
  const candidate = String(value || '').trim();
  if (!candidate) return null;
  const shape = ISO_INSTANT.exec(candidate);
  if (!shape) return Number.NaN;
  // Un día que no existe —31 de noviembre— tampoco es una fecha: hay motores
  // que lo corren al mes siguiente y motores que lo rechazan.
  const [year, month, day] = shape.slice(1, 4).map(Number);
  const calendar = new Date(Date.UTC(year, month - 1, day));
  if (calendar.getUTCFullYear() !== year || calendar.getUTCMonth() !== month - 1 || calendar.getUTCDate() !== day) {
    return Number.NaN;
  }
  // Una base de datos escribe microsegundos; los motores sólo coinciden hasta
  // el milisegundo, así que se lee hasta ahí.
  const parsed = Date.parse(candidate.replace(/(\.\d{3})\d+/, '$1'));
  return Number.isFinite(parsed) ? parsed : Number.NaN;
}

/**
 * La campaña con sus campos saneados, o `null` si no tiene forma de campaña.
 * No decide si se puede mostrar: sólo deja datos en los que se puede confiar.
 */
export function normalizeCampaign(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const id = text(raw.id, 60).toLowerCase();
  if (!/^[a-z0-9][a-z0-9-]*$/.test(id)) return null;
  const creative = raw.creative && typeof raw.creative === 'object' ? raw.creative : {};
  const copy = raw.copy && typeof raw.copy === 'object' ? raw.copy : {};
  const approval = raw.approval && typeof raw.approval === 'object' ? raw.approval : {};
  const skus = Array.isArray(raw.target?.skus) ? raw.target.skus : [];
  const tint = safeColor(creative.tint, '#3d4450');
  // El color de la BEBIDA, para las escenas que la sirven. No es el del envase:
  // una lata azul no trae líquido azul. Sin dato vale un dorado de cerveza.
  const liquid = safeColor(creative.liquid, '#f0a81d');
  return Object.freeze({
    id,
    type: text(raw.type, 20) || 'editorial',
    enabled: raw.enabled === true,
    approval: Object.freeze({
      status: text(approval.status, 20).toUpperCase() || 'PENDIENTE',
      reference: text(approval.reference, 120),
    }),
    validFrom: text(raw.validFrom, 40),
    validUntil: text(raw.validUntil, 40),
    priority: Number.isFinite(Number(raw.priority)) ? Number(raw.priority) : 0,
    placements: Object.freeze((Array.isArray(raw.placements) ? raw.placements : [])
      .map((placement) => text(placement, 30))
      .filter((placement) => CAMPAIGN_PLACEMENTS.includes(placement))),
    contexts: Object.freeze((Array.isArray(raw.contexts) ? raw.contexts : [])
      .map((context) => text(context, 40).toLowerCase())
      .filter((context) => /^[a-z0-9][a-z0-9-]*$/.test(context))),
    productId: text(raw.target?.productId, 120),
    identity: raw.target?.identity ? Object.freeze({
      brand: text(raw.target.identity.brand, 80), variant: text(raw.target.identity.variant, 80),
      volumeMl: Number(raw.target.identity.volumeMl), container: text(raw.target.identity.container, 20),
    }) : null,
    skus: Object.freeze(skus.map((sku) => text(sku, 120)).filter(Boolean).slice(0, 8)),
    creative: Object.freeze({
      preset: text(creative.preset, 30),
      vessel: CAMPAIGN_VESSELS.includes(creative.vessel) ? creative.vessel : 'can',
      tint,
      tintDeep: shade(tint, -0.45),
      tintLite: shade(tint, 0.32),
      accent: safeColor(creative.accent, '#e4b45f'),
      liquid,
      liquidDeep: shade(liquid, -0.34),
      liquidLite: shade(liquid, 0.3),
    }),
    copy: Object.freeze({
      eyebrow: text(copy.eyebrow, 28),
      headline: text(copy.headline, 48),
      cta: text(copy.cta, 24),
    }),
  });
}

/**
 * Por qué esta campaña NO puede mostrarse. Una lista vacía es «puede».
 * Devuelve códigos, no texto: son para pruebas y para el panel, no para el
 * cliente.
 */
export function campaignProblems(campaign, { now = Date.now() } = {}) {
  if (!campaign) return ['invalid'];
  const problems = [];
  if (!campaign.enabled) problems.push('disabled');
  if (campaign.approval.status !== 'APROBADA' || !campaign.approval.reference) problems.push('not-approved');
  if (campaign.type !== 'editorial') problems.push('unsupported-type');
  if (!Object.hasOwn(CAMPAIGN_PRESETS, campaign.creative.preset)) problems.push('unknown-preset');
  if (!campaign.placements.length) problems.push('no-placement');
  if (!campaign.skus.length && !campaign.productId) problems.push('no-target');
  if (!campaign.copy.headline || !campaign.copy.cta) problems.push('copy-missing');
  // Cada texto por separado: pegados, el número de una marca en el rótulo se
  // juntaba con la primera palabra del título («Fernet 1882» + «Menos hielo…»).
  const fields = [campaign.copy.eyebrow, campaign.copy.headline, campaign.copy.cta].map(plain);
  if (
    fields.some((field) => FORBIDDEN_COPY.test(field))
    || NUMERIC_CLAIM.test(plain(`${campaign.copy.headline} ${campaign.copy.cta}`))
    || EYEBROW_PRICE.test(plain(campaign.copy.eyebrow))
  ) {
    problems.push('copy-claims');
  }
  const from = timestamp(campaign.validFrom);
  const until = timestamp(campaign.validUntil);
  if (Number.isNaN(from) || Number.isNaN(until)) problems.push('invalid-dates');
  if (Number.isFinite(from) && now < from) problems.push('not-started');
  if (Number.isFinite(until) && now > until) problems.push('expired');
  return problems;
}

/*
 * Una cifra en el texto de la pieza sólo puede venir del PRODUCTO: su nombre o
 * su marca («7UP», «Fernet 1882»). Las reglas de arriba adivinan por la forma, y
 * por la forma «Lata 2500» y «Fernet 1882» son lo mismo. Con el producto a la
 * vista no hace falta adivinar: «A 99», «Lata 2500» o «Llevá 2» traen un número
 * que el producto no tiene, y eso es un precio o una cantidad escritos a mano.
 */
function numbersComeFromProduct(campaign, product) {
  const source = plain(`${product?.name ?? ''} ${product?.brand ?? ''}`);
  const runs = plain(`${campaign.copy.eyebrow} ${campaign.copy.headline} ${campaign.copy.cta}`).match(/\d+(?:[.,]\d+)*/g) || [];
  return runs.every((run) => new RegExp(`(?<!\\d)${run.replace(/[.,]/g, '\\$&')}(?!\\d)`).test(source));
}

/** El producto de la campaña en el catálogo vivo, o `null`. */
function campaignProduct(campaign, products, isOrderable) {
  if (campaign.productId) {
    const product = products.find(entry => entry?.id === campaign.productId);
    return product && isOrderable(product) && campaignIdentityMatches(campaign, product) ? product : null;
  }
  for (const sku of campaign.skus) {
    const product = products.find((entry) => entry?.sku === sku || entry?.externalId === sku);
    if (product && isOrderable(product) && campaignIdentityMatches(campaign, product)) return product;
  }
  return null;
}

/*
 * La pieza de grilla, y cuándo no va.
 *
 * Nunca en una búsqueda, con filtros puestos ni en una grilla corta: ahí la
 * persona está buscando algo puntual y una pieza en el medio es ruido. Y una
 * campaña de un producto con alcohol sólo aparece dentro de su propio rubro:
 * no se amplía la exposición de alcohol más allá de lo que la góndola ya
 * muestra.
 */
function fitsGrid(campaign, product, context) {
  if (!context || context.searching || context.filtered) return false;
  if (Number(context.listSize) < GRID_PIECE_MIN_PRODUCTS) return false;
  const category = String(context.categoryId || 'all');
  // «Su propio rubro» lo dice el PRODUCTO, no la campaña. Antes alcanzaba con
  // que la campaña nombrara el rubro en `contexts`: un aperitivo con
  // `contexts: ['gaseosas', 'popular']` salía en la góndola de gaseosas y en
  // Destacados. La configuración puede acotar dónde va una pieza con alcohol;
  // no puede sacarla de su góndola.
  if (product.alcoholic === true) {
    return category === String(product.categoryId || '') && campaign.contexts.includes(category);
  }
  if (campaign.contexts.includes(category)) return true;
  return category === 'all';
}

/**
 * Una campaña por superficie, la de mayor prioridad entre las que pueden.
 *
 * `home` y `catalog` son las dos vistas: en la home la misma campaña no ocupa
 * dos lugares. `dismissed` son las que la persona ocultó en esta visita, y
 * `dismissedPlacements` los lugares donde ocultó una: ahí no va otra. Quien
 * cierra un anuncio pidió que ese lugar deje de tener anuncios, no el
 * siguiente de la fila arrancando desde cero.
 */
export function selectCampaigns({
  campaigns = [],
  products = [],
  isOrderable = () => false,
  now = Date.now(),
  dismissed = new Set(),
  dismissedPlacements = new Set(),
  catalog = null,
} = {}) {
  const usable = campaigns
    .map(normalizeCampaign)
    .filter((campaign) => campaign && !dismissed.has(campaign.id) && campaignProblems(campaign, { now }).length === 0)
    .map((campaign) => ({ campaign, product: campaignProduct(campaign, products, isOrderable) }))
    .filter((entry) => entry.product && numbersComeFromProduct(entry.campaign, entry.product))
    .sort((a, b) => b.campaign.priority - a.campaign.priority || a.campaign.id.localeCompare(b.campaign.id));

  const pick = (placement, accept = () => true) => (
    dismissedPlacements.has(placement)
      ? null
      : usable.find((entry) => entry.campaign.placements.includes(placement) && accept(entry)) || null
  );
  const hero = pick('home-hero');
  // Un producto con alcohol no sube a la franja intermedia de la home: ese lugar
  // es transversal y hoy no muestra alcohol. La banda de apertura sí puede,
  // porque reemplaza a una puerta que ya es de cervezas.
  const inline = pick('home-inline', (entry) => entry !== hero && entry.product.alcoholic !== true);
  const grid = pick('catalog-inline', (entry) => fitsGrid(entry.campaign, entry.product, catalog));
  return { 'home-hero': hero, 'home-inline': inline, 'catalog-inline': grid };
}

/** Tras cuántas tarjetas va la pieza de grilla. */
export const CAMPAIGN_GRID_POSITION = GRID_PIECE_AFTER;

/*
 * El precio de la pieza. NO lo escribe la campaña —su texto no puede nombrar
 * dinero y la configuración no tiene un solo campo de plata—: llega en `view`
 * ya escrito por la tienda con las MISMAS funciones que la tarjeta
 * (`productPricePresentation` + `pricingLabel`), así que la pieza no puede
 * decir otro precio que el de la góndola. Acá sólo se sanea y se ordena.
 *
 * Un precio pendiente no se dibuja: no hay «$ 0» ni «Precio próximamente» en un
 * anuncio. Igual no debería llegar, porque el motor sólo elige productos que se
 * pueden comprar ahora; esto es la segunda llave.
 */
function priceText(value) {
  // El espacio duro entre «$» y la cifra se conserva: un importe no se parte.
  return String(value ?? '').replace(/[\r\n\t]+/g, ' ').trim().slice(0, 24);
}

function campaignPrice(price) {
  if (!price || typeof price !== 'object' || price.pending === true) return null;
  const amount = priceText(price.amount);
  if (!amount) return null;
  const previous = priceText(price.previous);
  const off = priceText(price.off);
  const note = text(price.note, 48);
  return {
    amount,
    previous: previous && previous !== amount ? previous : '',
    off: previous && previous !== amount ? off : '',
    note,
  };
}

/*
 * LA COMPRA, EN LA PIEZA.
 *
 * Una pieza que muestra una foto y un precio promete una compra, y «Ver Red
 * Bull →» es una invitación a mirar: en el teléfono ni siquiera parecía un
 * botón —texto coral de 13 px— y abría una ficha donde recién estaba el
 * «Agregar». La pieza lleva el control de compra de la góndola: el mismo
 * `data-add-product`, que pasa por `addToCart` (stock, precio y disponibilidad
 * los decide el mismo camino que la tarjeta; el servidor vuelve a decidirlos al
 * confirmar el pedido).
 *
 * `view.buy` lo arma la tienda con el producto real y su cantidad en el
 * carrito. Sin él —un llamador que no sabe de carrito— la pieza queda como
 * antes: la acción es mirar la ficha.
 */
function campaignBuy(buy) {
  if (!buy || typeof buy !== 'object') return null;
  const productId = text(buy.productId, 120);
  if (!productId) return null;
  const name = text(buy.name, 120) || 'este producto';
  const quantity = Math.max(0, Math.floor(Number(buy.quantity) || 0));
  return { productId, name, quantity, canAddMore: buy.canAddMore !== false };
}

function buyControlMarkup(buy) {
  const id = escapeHtml(buy.productId);
  const name = escapeHtml(buy.name);
  if (buy.quantity < 1) {
    return `<button class="cmp-add" type="button" data-add-product="${id}" data-campaign-add aria-label="Agregar ${name} al pedido"><span class="cmp-add-plus" aria-hidden="true">+</span><span class="cmp-add-text">Agregar</span></button>`;
  }
  const leftLabel = buy.quantity === 1 ? `Quitar ${name} del pedido` : `Restar uno de ${name}`;
  return `<span class="cmp-qty" role="group" aria-label="Cantidad de ${name} en el pedido" data-campaign-qty>`
    + `<button class="cmp-qty-action" type="button" data-cart-dec="${id}" aria-label="${leftLabel}"><span aria-hidden="true">−</span></button>`
    + `<strong aria-live="polite">${buy.quantity}</strong>`
    + `<button class="cmp-qty-action" type="button" data-cart-inc="${id}" aria-label="Sumar uno de ${name}"${buy.canAddMore ? '' : ' disabled'}><span aria-hidden="true">+</span></button>`
    + '</span>';
}

/**
 * El HTML de la pieza. `view` son los datos que salen del PRODUCTO real y que
 * la campaña no puede escribir por su cuenta: marca, nombre, presentación,
 * precio vivo, si lleva la leyenda de alcohol y el control de compra.
 *
 * ESTRUCTURA. El botón que abre la ficha (`.cmp-hit`) cubre la pieza entera
 * pero NO envuelve el texto: el control de compra es otro botón y un botón no
 * puede vivir dentro de otro. El texto va en flujo, con `pointer-events: none`,
 * así que un toque sobre el título, la foto o el precio llega al botón de
 * debajo y abre la ficha; sólo «Agregar» y «Ocultar» reciben el toque.
 */
export function campaignMarkup({ campaign, product }, placement, view = {}) {
  const preset = CAMPAIGN_PRESETS[campaign.creative.preset];
  const { creative, copy } = campaign;
  const asset = product ? resolveCampaignProductAsset(campaign, product, view.supabaseUrl || '') : null;
  if (product && !asset) return '';
  // En la banda de apertura el envase está a la vista desde el primer
  // pantallazo: se pide en el acto, no cuando el navegador decide que es visible.
  const packshot = asset ? { ...asset, eager: placement === 'home-hero' } : null;
  // El rótulo es la MARCA, y la marca la dice el producto: la que se escribió
  // en la campaña queda sólo para un producto que no declara la suya.
  const brand = text(view.brand, 28) || copy.eyebrow;
  const productName = text(view.title, 100);
  const productLine = text(view.line, 80);
  const subtitle = [productName, productLine].filter(Boolean).join(' · ');
  // Cada dato de la presentación viaja entero —«355 ml» no se parte— y el
  // separador va con el dato que sigue: un renglón no termina en «·».
  const [firstPart, ...restParts] = subtitle.split(' · ');
  const subtitleMarkup = subtitle
    ? [escapeHtml(firstPart), ...restParts.map((part) => `<span class="cmp-seg">· ${escapeHtml(part)}</span>`)].join(' ')
    : '';
  const price = campaignPrice(view.price);
  const priceLabel = price
    ? [price.amount, price.previous ? `antes ${price.previous}` : '', price.note].filter(Boolean).join(', ')
    : '';
  const legal = view.alcoholic === true;
  const buy = campaignBuy(view.buy);
  const label = [copy.headline, subtitle, priceLabel, copy.cta].filter(Boolean).join('. ');
  const style = [
    `--cmp-tint:${creative.tint}`,
    `--cmp-tint-deep:${creative.tintDeep}`,
    `--cmp-tint-lite:${creative.tintLite}`,
    `--cmp-accent:${creative.accent}`,
    `--cmp-liquid:${creative.liquid}`,
    `--cmp-liquid-deep:${creative.liquidDeep}`,
    `--cmp-liquid-lite:${creative.liquidLite}`,
    `--cmp-dur:${preset.duration}s`,
  ].join(';');
  // Los degradados del envase se referencian por id, y los id son del documento.
  const uid = sceneId(`cmp-${campaign.id}-${placement}`);
  // El precio y la acción comparten renglón: en la banda del teléfono no hay
  // lugar para uno más sin mover el primer precio de la vidriera.
  const priceMarkup = price
    ? `<span class="cmp-price" data-campaign-price aria-hidden="true"><strong class="cmp-price-now">${escapeHtml(price.amount)}</strong>${price.previous ? `<s class="cmp-price-was">${escapeHtml(price.previous)}</s>` : ''}${price.off ? `<em class="cmp-price-off">${escapeHtml(price.off)}</em>` : ''}</span>`
    : '';
  // Con control de compra, la acción es el botón; sin él, el rótulo que ya
  // existía —no interactivo: el toque cae en el botón de la ficha—.
  const actionMarkup = buy
    ? buyControlMarkup(buy)
    : `<span class="cmp-cta" aria-hidden="true">${escapeHtml(copy.cta)} <span aria-hidden="true">→</span></span>`;
  return `
    <aside class="cmp cmp--${escapeHtml(creative.preset.replace(/_/g, '-'))} cmp--${escapeHtml(placement)}${legal ? ' cmp--legal' : ''}${price ? ' cmp--priced' : ''}${buy ? ' cmp--buyable' : ''}" data-campaign="${escapeHtml(campaign.id)}" data-campaign-preset="${escapeHtml(creative.preset)}" data-campaign-placement="${escapeHtml(placement)}" data-catalog-key="campaign:${escapeHtml(placement)}:${escapeHtml(campaign.id)}" aria-label="${escapeHtml(`Anuncio: ${brand || copy.headline}`)}" style="${style}">
      <div class="cmp-body">
        <button class="cmp-hit" type="button" data-product-detail="${escapeHtml(view.productId)}" data-campaign-cta aria-label="${escapeHtml(label)}"></button>
        <span class="cmp-scene"><span class="cmp-stage" aria-hidden="true">${preset.stage({ ...creative, packshot }, uid)}</span></span>
        <span class="cmp-copy">
          ${brand ? `<small class="cmp-eyebrow" aria-hidden="true">${escapeHtml(brand)}</small>` : ''}
          <strong class="cmp-headline" aria-hidden="true">${escapeHtml(copy.headline)}</strong>
          ${subtitle ? `<span class="cmp-sub" aria-hidden="true">${subtitleMarkup}</span>` : ''}
          ${price?.note ? `<small class="cmp-price-note" aria-hidden="true">${escapeHtml(price.note)}</small>` : ''}
          <span class="cmp-buy">${priceMarkup}${actionMarkup}</span>
        </span>
      </div>
      <button class="cmp-close" type="button" data-campaign-dismiss="${escapeHtml(campaign.id)}" aria-label="Ocultar este anuncio"><span aria-hidden="true">×</span></button>
      ${legal ? `<p class="cmp-legal">${escapeHtml(ALCOHOL_LEGAL_NOTICE)}</p>` : ''}
    </aside>`;
}
