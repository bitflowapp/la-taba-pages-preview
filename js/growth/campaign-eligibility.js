// ─────────────────────────────────────────────────────────────────────────────
// Growth engine · ELEGIBILIDAD DE CAMPAÑAS.
// -----------------------------------------------------------------------------
// El filtro que corre ANTES de cualquier ranking. Acá se decide si una pieza
// PUEDE mostrarse; cuánto conviene mostrarla es problema de ranking.js.
//
// Fail-closed en cadena, mismo criterio que el hero y los banners de la home:
//   · deshabilitada → afuera;
//   · fuera de vigencia → afuera (aunque su score histórico fuera enorme);
//   · destino sin producto COMPRABLE ahora → afuera;
//   · tipo `promotion` sin promoción activa VALIDADA → afuera;
//   · tipo `combo` sin combo cobrable → afuera.
//
// La elegibilidad consume una vista neutra del catálogo (`catalogView`) que
// arma el engine desde el estado vivo. Este módulo no importa state ni ui:
// se testea con fixtures.
import { isPromotionActive } from '../core/promotions.js';

export const CAMPAIGN_KINDS = Object.freeze(['editorial', 'promotion', 'combo']);
export const CAMPAIGN_PLACEMENTS = Object.freeze(['hero', 'door', 'catalog-inline']);

function text(value, maxLength = 160) {
  const clean = String(value ?? '').replace(/\s+/g, ' ').trim();
  return clean.length > maxLength ? clean.slice(0, maxLength) : clean;
}

function idList(value, maxItems = 12) {
  return [...new Set((Array.isArray(value) ? value : [])
    .map((item) => text(item, 80).toLowerCase())
    .filter(Boolean))].slice(0, maxItems);
}

function timestampOrNull(value) {
  if (value === null || value === undefined || value === '') return null;
  const parsed = new Date(value).getTime();
  return Number.isFinite(parsed) ? parsed : NaN; // NaN = fecha declarada pero rota
}

function clampPriority(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return 0;
  return Math.max(0, Math.min(100, Math.floor(numeric)));
}

/**
 * Normaliza una definición de campaña. Devuelve `null` si el registro no
 * puede presentarse con honestidad (sin id, sin tipo válido, sin creatividad
 * mínima o con fechas rotas): una campaña malformada no existe.
 */
export function normalizeCampaign(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const id = text(raw.id, 80).toLowerCase();
  const kind = text(raw.kind, 20);
  if (!id || !CAMPAIGN_KINDS.includes(kind)) return null;

  const startsAt = timestampOrNull(raw.startsAt);
  const endsAt = timestampOrNull(raw.endsAt);
  if (Number.isNaN(startsAt) || Number.isNaN(endsAt)) return null;

  const placements = idList(raw.placements, 4).filter((p) => CAMPAIGN_PLACEMENTS.includes(p));
  if (!placements.length) return null;

  const creative = raw.creative && typeof raw.creative === 'object' ? raw.creative : {};
  const title = text(creative.title, 80);
  if (!title) return null;

  return {
    id,
    enabled: raw.enabled === true,
    kind,
    startsAt,
    endsAt,
    placements,
    categoryIds: idList(raw.categoryIds, 6),
    brand: text(raw.brand, 60),
    productIds: idList(raw.productIds, 12),
    comboId: text(raw.comboId, 80).toLowerCase(),
    promoId: text(raw.promoId, 80).toLowerCase(),
    priority: clampPriority(raw.priority),
    contexts: idList(raw.contexts, 6),
    requiresIntent: raw.requiresIntent === 'category' ? 'category' : false,
    creative: {
      eyebrow: text(creative.eyebrow, 40),
      title,
      subtitle: text(creative.subtitle, 140),
      image: text(creative.image, 220),
      bandImage: text(creative.bandImage, 220),
      focus: /^[\d.]+% [\d.]+%$/.test(creative.focus || '') ? creative.focus : '',
      ctaLabel: text(creative.ctaLabel, 40),
    },
  };
}

export function normalizeCampaignCollection(rawCampaigns = []) {
  if (!Array.isArray(rawCampaigns)) return [];
  const seen = new Set();
  const result = [];
  for (const raw of rawCampaigns) {
    const campaign = normalizeCampaign(raw);
    if (!campaign || seen.has(campaign.id)) continue;
    seen.add(campaign.id);
    result.push(campaign);
  }
  return result.slice(0, 100);
}

function withinDates(campaign, now) {
  if (campaign.startsAt !== null && now < campaign.startsAt) return false;
  if (campaign.endsAt !== null && now > campaign.endsAt) return false;
  return true;
}

/**
 * ¿El destino de la campaña tiene compra REAL ahora mismo?
 * `catalogView` es la vista que arma el engine:
 *   { purchasableCategoryIds:Set, purchasableBrandKeys:Set,
 *     purchasableProductIds:Set, chargeableComboIds:Set }
 * Un destino declarado que el catálogo no puede honrar apaga la pieza; una
 * campaña sin ningún destino declarado no puede prometer acción → afuera.
 */
function destinationIsPurchasable(campaign, catalogView) {
  if (campaign.kind === 'combo') {
    return Boolean(campaign.comboId) && catalogView.chargeableComboIds.has(campaign.comboId);
  }
  if (campaign.productIds.length) {
    return campaign.productIds.some((id) => catalogView.purchasableProductIds.has(id));
  }
  if (campaign.brand) {
    return catalogView.purchasableBrandKeys.has(campaign.brand.toLowerCase());
  }
  if (campaign.categoryIds.length) {
    return campaign.categoryIds.some((id) => catalogView.purchasableCategoryIds.has(id));
  }
  return false;
}

/**
 * Para campañas `promotion`: la promoción referida tiene que estar ACTIVA
 * según el contrato validado (aprobación humana, precios verificables,
 * vigencia). La creatividad no puede afirmar una oferta que promotions.js no
 * respalda — acá es donde "promo vencida jamás aparece" se vuelve código.
 */
function promotionBacksCampaign(campaign, promotions, now) {
  if (campaign.kind !== 'promotion') return true;
  if (!campaign.promoId) return false;
  const promotion = (Array.isArray(promotions) ? promotions : [])
    .find((entry) => String(entry?.promoId || '').toLowerCase() === campaign.promoId);
  return Boolean(promotion) && isPromotionActive(promotion, new Date(now));
}

export function eligibleCampaigns({
  campaigns = [],
  placement,
  catalogView,
  promotions = [],
  now,
} = {}) {
  if (!catalogView || !Number.isFinite(Number(now))) return [];
  const timestamp = Number(now);
  const slot = text(placement, 20);
  return normalizeCampaignCollection(campaigns).filter((campaign) => (
    campaign.enabled
    && campaign.placements.includes(slot)
    && withinDates(campaign, timestamp)
    && destinationIsPurchasable(campaign, catalogView)
    && promotionBacksCampaign(campaign, promotions, timestamp)
  ));
}
