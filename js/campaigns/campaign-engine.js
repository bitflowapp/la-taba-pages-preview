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
import { beerPour } from './presets/beer-pour.js';
import { coldCan } from './presets/cold-can.js';
import { productDrop } from './presets/product-drop.js';
import { iceReveal } from './presets/ice-reveal.js';
import { CAMPAIGN_VESSELS, safeColor, shade } from './presets/shared.js';

export const CAMPAIGN_PRESETS = Object.freeze({
  [beerPour.id]: beerPour,
  [coldCan.id]: coldCan,
  [productDrop.id]: productDrop,
  [iceReveal.id]: iceReveal,
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
const FORBIDDEN_COPY = /\$|%|\b(?:descuent|ofert|promo|rebaj|liquidaci|gratis|ahorr|imperdible|ultimas? unidades|por tiempo limitado|mas vendid|mejor precio|antes\b|\d+\s*x\s*\d+)/i;

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

function timestamp(value) {
  const candidate = String(value || '').trim();
  if (!candidate) return null;
  const parsed = Date.parse(candidate);
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
    skus: Object.freeze(skus.map((sku) => text(sku, 120)).filter(Boolean).slice(0, 8)),
    creative: Object.freeze({
      preset: text(creative.preset, 30),
      vessel: CAMPAIGN_VESSELS.includes(creative.vessel) ? creative.vessel : 'can',
      tint,
      tintDeep: shade(tint, -0.45),
      tintLite: shade(tint, 0.32),
      accent: safeColor(creative.accent, '#e4b45f'),
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
  if (!campaign.skus.length) problems.push('no-target');
  if (!campaign.copy.headline || !campaign.copy.cta) problems.push('copy-missing');
  const copy = plain(`${campaign.copy.eyebrow} ${campaign.copy.headline} ${campaign.copy.cta}`);
  if (FORBIDDEN_COPY.test(copy)) problems.push('copy-claims');
  const from = timestamp(campaign.validFrom);
  const until = timestamp(campaign.validUntil);
  if (Number.isNaN(from) || Number.isNaN(until)) problems.push('invalid-dates');
  if (Number.isFinite(from) && now < from) problems.push('not-started');
  if (Number.isFinite(until) && now > until) problems.push('expired');
  return problems;
}

/** El producto de la campaña en el catálogo vivo, o `null`. */
function campaignProduct(campaign, products, isOrderable) {
  for (const sku of campaign.skus) {
    const product = products.find((entry) => entry?.sku === sku || entry?.externalId === sku);
    if (product && isOrderable(product)) return product;
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
  if (campaign.contexts.includes(category)) return true;
  return category === 'all' && product.alcoholic !== true;
}

/**
 * Una campaña por superficie, la de mayor prioridad entre las que pueden.
 *
 * `home` y `catalog` son las dos vistas: en la home la misma campaña no ocupa
 * dos lugares. `dismissed` son las que la persona ocultó en esta visita.
 */
export function selectCampaigns({
  campaigns = [],
  products = [],
  isOrderable = () => false,
  now = Date.now(),
  dismissed = new Set(),
  catalog = null,
} = {}) {
  const usable = campaigns
    .map(normalizeCampaign)
    .filter((campaign) => campaign && !dismissed.has(campaign.id) && campaignProblems(campaign, { now }).length === 0)
    .map((campaign) => ({ campaign, product: campaignProduct(campaign, products, isOrderable) }))
    .filter((entry) => entry.product)
    .sort((a, b) => b.campaign.priority - a.campaign.priority || a.campaign.id.localeCompare(b.campaign.id));

  const pick = (placement, accept = () => true) => (
    usable.find((entry) => entry.campaign.placements.includes(placement) && accept(entry)) || null
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

/**
 * El HTML de la pieza. `view` son los textos que salen del PRODUCTO real y que
 * la campaña no puede escribir por su cuenta: nombre, presentación y si lleva
 * la leyenda de alcohol.
 */
export function campaignMarkup({ campaign }, placement, view = {}) {
  const preset = CAMPAIGN_PRESETS[campaign.creative.preset];
  const { creative, copy } = campaign;
  const productName = text(view.title, 100);
  const productLine = text(view.line, 80);
  const subtitle = [productName, productLine].filter(Boolean).join(' · ');
  const legal = view.alcoholic === true;
  const label = [copy.headline, subtitle, copy.cta].filter(Boolean).join('. ');
  const style = [
    `--cmp-tint:${creative.tint}`,
    `--cmp-tint-deep:${creative.tintDeep}`,
    `--cmp-tint-lite:${creative.tintLite}`,
    `--cmp-accent:${creative.accent}`,
    `--cmp-dur:${preset.duration}s`,
  ].join(';');
  return `
    <aside class="cmp cmp--${escapeHtml(creative.preset.replace(/_/g, '-'))} cmp--${escapeHtml(placement)}${legal ? ' cmp--legal' : ''}" data-campaign="${escapeHtml(campaign.id)}" data-campaign-preset="${escapeHtml(creative.preset)}" data-campaign-placement="${escapeHtml(placement)}" data-catalog-key="campaign:${escapeHtml(placement)}:${escapeHtml(campaign.id)}" aria-label="Anuncio del local" style="${style}">
      <button class="cmp-hit" type="button" data-product-detail="${escapeHtml(view.productId)}" data-campaign-cta aria-label="${escapeHtml(label)}">
        <span class="cmp-stage" aria-hidden="true">${preset.stage(creative)}</span>
        <span class="cmp-copy">
          ${copy.eyebrow ? `<small class="cmp-eyebrow">${escapeHtml(copy.eyebrow)}</small>` : ''}
          <strong class="cmp-headline">${escapeHtml(copy.headline)}</strong>
          ${subtitle ? `<span class="cmp-sub">${escapeHtml(subtitle)}</span>` : ''}
          <span class="cmp-cta">${escapeHtml(copy.cta)} <span aria-hidden="true">→</span></span>
        </span>
      </button>
      <button class="cmp-close" type="button" data-campaign-dismiss="${escapeHtml(campaign.id)}" aria-label="Ocultar este anuncio"><span aria-hidden="true">×</span></button>
      ${legal ? `<p class="cmp-legal">${escapeHtml(ALCOHOL_LEGAL_NOTICE)}</p>` : ''}
    </aside>`;
}
