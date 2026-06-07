import { sanitizeText } from './validators.js';

export const DEFAULT_LOYALTY_CONFIG = Object.freeze({
  enabled: true,
  milestoneOrders: 5,
  benefitLabel: 'Beneficio disponible',
});

export function normalizeLoyaltyConfig(config = {}) {
  const milestone = Math.floor(Number(config?.milestoneOrders));
  return {
    enabled: config?.enabled !== false,
    milestoneOrders: Number.isFinite(milestone) && milestone > 1 ? milestone : DEFAULT_LOYALTY_CONFIG.milestoneOrders,
    benefitLabel: sanitizeText(config?.benefitLabel, {
      fallback: DEFAULT_LOYALTY_CONFIG.benefitLabel,
      maxLength: 80,
    }),
  };
}

export function calculateLoyaltyProgress(orderCount = 0, config = DEFAULT_LOYALTY_CONFIG) {
  const normalizedConfig = normalizeLoyaltyConfig(config);
  const count = Math.max(0, Math.floor(Number(orderCount) || 0));
  const milestone = normalizedConfig.milestoneOrders;
  const benefitAvailable = normalizedConfig.enabled && count > 0 && count % milestone === 0;
  const completed = benefitAvailable ? milestone : count % milestone;
  const remaining = benefitAvailable ? 0 : milestone - completed;

  return {
    enabled: normalizedConfig.enabled,
    milestoneOrders: milestone,
    orderCount: count,
    completed,
    remaining,
    benefitAvailable,
    benefitLabel: normalizedConfig.benefitLabel,
    nextBenefitAt: benefitAvailable ? count : count + remaining,
  };
}

export function loyaltyProgressCopy(progress) {
  const normalized = progress || calculateLoyaltyProgress(0);
  if (!normalized.enabled) return '';
  if (normalized.benefitAvailable) {
    return `${normalized.benefitLabel}. El comercio lo confirma al tomar el pedido.`;
  }
  return `Llevas ${normalized.completed} de ${normalized.milestoneOrders} pedidos para tu proximo beneficio.`;
}
