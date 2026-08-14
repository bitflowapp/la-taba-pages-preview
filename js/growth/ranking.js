// ─────────────────────────────────────────────────────────────────────────────
// Growth engine · RANKING.
// -----------------------------------------------------------------------------
// Entre campañas YA elegibles, decide cuál va en cada slot. Determinista: las
// mismas entradas producen el mismo orden, siempre. Cada resultado lleva su
// desglose (`explain`) para poder responder "¿por qué salió esta promoción?"
// sin adivinar.
//
//   score = intención·W + prioridad·W + complemento·W + promoción·W
//         + contexto·W − penalización de frecuencia − repetición de categoría
//
// La exploración de cold start no usa azar: entre piezas EXACTAMENTE
// igualadas rota por día (rotationIndex). Mismo día, misma vidriera.
import {
  RANKING_WEIGHTS,
  ROTATION_WINDOW_MS,
} from './growth-config.js';
import { normalizedAffinity } from './intent-model.js';
import { complementBoost } from './complements.js';
import { contextBucketsAt, contextMatch, rotationIndex } from './context.js';
import { frequencyPenalty, isCampaignMuted } from './exposure-store.js';

function affinityFor(campaign, affinity) {
  const categories = affinity?.categories || {};
  const brands = affinity?.brands || {};
  const products = affinity?.products || {};
  let best = 0;
  for (const categoryId of campaign.categoryIds) {
    best = Math.max(best, Number(categories[categoryId]) || 0);
  }
  if (campaign.brand) {
    best = Math.max(best, Number(brands[campaign.brand.toLowerCase()]) || 0);
  }
  for (const productId of campaign.productIds) {
    best = Math.max(best, Number(products[productId]) || 0);
  }
  return best;
}

function scoreCampaign(campaign, {
  affinity,
  cartCategoryIds,
  exposure,
  now,
  activeBuckets,
}) {
  const explain = [];
  const rawAffinity = affinityFor(campaign, affinity);
  const intent = normalizedAffinity(rawAffinity) * RANKING_WEIGHTS.intent;
  explain.push({ factor: 'intent', value: round2(intent), rawAffinity: round2(rawAffinity) });

  const priority = (campaign.priority / 100) * RANKING_WEIGHTS.priority;
  explain.push({ factor: 'priority', value: round2(priority) });

  // La elegibilidad ya comprobó que el destino tiene una compra real ahora.
  // Es un factor constante dentro del pool, pero dejarlo en explain evita que
  // disponibilidad quede escondida como una condición previa al ranking.
  const availability = RANKING_WEIGHTS.availability;
  explain.push({ factor: 'availability', value: round2(availability) });

  const complement = complementBoost(campaign.categoryIds, cartCategoryIds)
    * RANKING_WEIGHTS.complement;
  if (complement) explain.push({ factor: 'complement', value: round2(complement) });

  const promotion = campaign.kind === 'promotion' ? RANKING_WEIGHTS.promotion : 0;
  if (promotion) explain.push({ factor: 'promotion', value: round2(promotion) });

  const context = contextMatch(campaign.contexts, activeBuckets) * RANKING_WEIGHTS.context;
  if (context) explain.push({ factor: 'context', value: round2(context) });

  const frequency = frequencyPenalty(exposure, campaign.id, now);
  if (frequency) explain.push({ factor: 'frequency', value: round2(-frequency) });

  return {
    campaign,
    score: intent + priority + availability + complement + promotion + context - frequency,
    intentScore: intent,
    explain,
  };
}

function round2(value) {
  return Math.round(Number(value) * 100) / 100;
}

function sharesCategory(campaign, pickedCategoryIds) {
  return campaign.categoryIds.some((id) => pickedCategoryIds.has(id));
}

/**
 * Ranking multi-slot con diversidad. Devuelve hasta `slots` entradas
 * `{ campaign, score, explain }` ordenadas para render.
 *
 * Selección greedy determinista: se elige el mejor score; para los slots
 * siguientes, repetir categoría ya elegida cuesta `diversityRepeatPenalty`.
 * Así mirar una cerveza no convierte la home en veinte cervezas: la segunda
 * pieza del mismo rubro tiene que ganarle POR MUCHO a la mejor de otro.
 *
 * Empates exactos: rota por día entre los igualados del primer slot y cae a
 * orden estable (prioridad desc, id asc) para el resto.
 */
export function rankCampaigns({
  campaigns = [],
  affinity = null,
  cartCategoryIds = [],
  exposure = null,
  now,
  slots = 1,
} = {}) {
  const timestamp = Number(now);
  if (!Number.isFinite(timestamp)) return [];
  const activeBuckets = contextBucketsAt(timestamp);

  const available = campaigns
    .filter((campaign) => !isCampaignMuted(exposure, campaign.id, timestamp))
    .map((campaign) => scoreCampaign(campaign, {
      affinity, cartCategoryIds, exposure, now: timestamp, activeBuckets,
    }));

  const stableOrder = (a, b) => (
    b.score - a.score
    || b.campaign.priority - a.campaign.priority
    || a.campaign.id.localeCompare(b.campaign.id)
  );

  const picked = [];
  const pickedCategories = new Set();
  const pool = [...available];
  const maxSlots = Math.max(1, Math.floor(Number(slots) || 1));

  while (picked.length < maxSlots && pool.length) {
    const adjusted = pool
      .map((entry) => {
        const repeats = picked.length > 0 && sharesCategory(entry.campaign, pickedCategories);
        const diversityPenalty = repeats ? RANKING_WEIGHTS.diversityRepeatPenalty : 0;
        return {
          ...entry,
          adjustedScore: entry.score - diversityPenalty,
          diversityPenalty,
        };
      })
      .sort((a, b) => (
        b.adjustedScore - a.adjustedScore
        || b.campaign.priority - a.campaign.priority
        || a.campaign.id.localeCompare(b.campaign.id)
      ));

    let winner = adjusted[0];
    // Rotación SÓLO entre empatados exactos del primer slot (cold start puro):
    // con señales o prioridades distintas nunca hay empate y esto no actúa.
    if (picked.length === 0) {
      const tied = adjusted.filter((entry) => entry.adjustedScore === winner.adjustedScore);
      if (tied.length > 1) {
        winner = tied[rotationIndex(timestamp, tied.length, ROTATION_WINDOW_MS)];
      }
    }

    picked.push({
      campaign: winner.campaign,
      score: round2(winner.adjustedScore),
      explain: winner.diversityPenalty
        ? [...winner.explain, { factor: 'diversity', value: round2(-winner.diversityPenalty) }]
        : winner.explain,
    });
    winner.campaign.categoryIds.forEach((id) => pickedCategories.add(id));
    pool.splice(pool.findIndex((entry) => entry.campaign.id === winner.campaign.id), 1);
  }

  // Orden estable de salida (los slots ya reflejan diversidad).
  return picked;
}

/**
 * Tabla legible para el harness de debug: "por qué salió esta campaña".
 * Nunca se muestra al cliente; sirve en desarrollo y para decisiones
 * comerciales futuras.
 */
export function explainRanking(ranked = []) {
  return (Array.isArray(ranked) ? ranked : []).map((entry) => ({
    campaignId: entry.campaign?.id || '',
    score: entry.score,
    final: entry.score,
    factors: (entry.explain || []).map(({ factor, value }) => `${factor} ${value >= 0 ? '+' : ''}${value}`),
  }));
}

export { stableRankInputsFingerprint as _internalFingerprint };

// Huella barata de las entradas que afectan una selección. El engine la usa
// para memoizar por época de vista: si nada relevante cambió, la selección no
// se recalcula (y mucho menos en cada render del carrito).
function stableRankInputsFingerprint({ campaignIds = [], affinity = {}, cartCategoryIds = [], epoch = 0 } = {}) {
  const cats = Object.entries(affinity?.categories || {})
    .map(([key, value]) => `${key}:${Math.round(Number(value) * 10)}`)
    .sort()
    .join(',');
  return [epoch, campaignIds.join('|'), cats, [...cartCategoryIds].sort().join(',')].join('#');
}
