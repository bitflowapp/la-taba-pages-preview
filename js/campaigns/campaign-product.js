import { productPhoto } from '../core/product-photo.js';
import { PRODUCT_ART_LAYOUT } from './product-art-layout.js';

const normalized = value => String(value || '').normalize('NFD').replace(/[̀-ͯ]/g, '').trim().toLowerCase();

export function campaignContainer(product) {
  const value = normalized(product?.packageType || product?.packagingType || product?.packaging_type);
  if (/^(lata|can)$/.test(value)) return 'can';
  if (/^(botella|bottle)(\b|$)/.test(value)) return 'bottle';
  return null;
}

export function campaignIdentityMatches(campaign, product) {
  if (!product) return false;
  const kind = campaignContainer(product);
  if (kind && kind !== campaign.creative.vessel) return false;
  if (campaign.creative.preset === 'cold_can' && kind !== 'can') return false;
  const identity = campaign.identity;
  if (!identity) return true;
  const capacity = Number(product.capacityValue ?? product.capacity_value);
  const unit = normalized(product.capacityUnit ?? product.capacity_unit ?? 'ml');
  const ml = unit === 'l' ? capacity * 1000 : unit === 'ml' ? capacity : NaN;
  return normalized(product.brand) === normalized(identity.brand)
    && normalized(product.variant) === normalized(identity.variant)
    && ml === identity.volumeMl && kind === identity.container;
}

// No text-based SKU lookup and no substitution with a different presentation.
export function resolveCampaignProductAsset(campaign, product, supabaseUrl = '') {
  if (!campaignIdentityMatches(campaign, product)) return null;
  const photo = productPhoto(product, supabaseUrl);
  return { ...photo, layout: photo.official ? PRODUCT_ART_LAYOUT[product.imageSha256] || null : null };
}
