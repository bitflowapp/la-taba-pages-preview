// ─────────────────────────────────────────────────────────────────────────────
// Growth engine · EXPOSICIÓN Y FREQUENCY CAP.
// -----------------------------------------------------------------------------
// Contadores por campaña para no acosar: cuántas veces se mostró, cuántas se
// tocó, cuándo se descartó. El ranking convierte esto en penalización blanda
// primero y en exclusión con cooldown después.
//
// Módulo puro sobre una estructura serializable; la persistencia la maneja el
// engine con las mismas primitivas fail-safe del resto de la app. Todas las
// funciones reciben `now`.
import { FREQUENCY } from './growth-config.js';

export const EXPOSURE_SCHEMA_VERSION = 1;

export function emptyExposureState() {
  return { v: EXPOSURE_SCHEMA_VERSION, campaigns: {} };
}

function isPlainObject(value) {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function cleanCount(value, max = 9999) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) return 0;
  return Math.min(max, Math.floor(numeric));
}

function cleanTimestamp(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric > 0 ? numeric : 0;
}

function normalizeCampaignExposure(raw) {
  if (!isPlainObject(raw)) return null;
  const entry = {
    imp: cleanCount(raw.imp),
    clk: cleanCount(raw.clk),
    dis: cleanCount(raw.dis),
    lastImpAt: cleanTimestamp(raw.lastImpAt),
    lastClkAt: cleanTimestamp(raw.lastClkAt),
    lastDisAt: cleanTimestamp(raw.lastDisAt),
  };
  const hasActivity = entry.imp || entry.clk || entry.dis;
  return hasActivity ? entry : null;
}

export function normalizeExposureState(raw) {
  if (!isPlainObject(raw) || raw.v !== EXPOSURE_SCHEMA_VERSION) return emptyExposureState();
  const campaigns = {};
  if (isPlainObject(raw.campaigns)) {
    for (const [id, value] of Object.entries(raw.campaigns)) {
      const key = String(id || '').trim();
      const entry = normalizeCampaignExposure(value);
      if (!key || key.length > 80 || !entry) continue;
      campaigns[key] = entry;
    }
  }
  return { v: EXPOSURE_SCHEMA_VERSION, campaigns: pruneCampaigns(campaigns) };
}

// Cota dura de campañas trackeadas: se conservan las de actividad más
// reciente. El registro de exposición no puede crecer sin límite en un
// almacenamiento que el navegador puede desalojar.
function pruneCampaigns(campaigns) {
  const entries = Object.entries(campaigns);
  if (entries.length <= FREQUENCY.maxTrackedCampaigns) return campaigns;
  const lastActivity = ([, entry]) => Math.max(entry.lastImpAt, entry.lastClkAt, entry.lastDisAt);
  return Object.fromEntries(
    entries
      .sort((a, b) => lastActivity(b) - lastActivity(a) || String(a[0]).localeCompare(String(b[0])))
      .slice(0, FREQUENCY.maxTrackedCampaigns),
  );
}

function withCampaign(state, campaignId, mutate) {
  const base = normalizeExposureState(state);
  const key = String(campaignId || '').trim();
  if (!key) return base;
  const current = base.campaigns[key] || {
    imp: 0, clk: 0, dis: 0, lastImpAt: 0, lastClkAt: 0, lastDisAt: 0,
  };
  const next = { ...base.campaigns, [key]: mutate({ ...current }) };
  return { v: EXPOSURE_SCHEMA_VERSION, campaigns: pruneCampaigns(next) };
}

export function recordImpression(state, campaignId, now) {
  return withCampaign(state, campaignId, (entry) => ({
    ...entry, imp: entry.imp + 1, lastImpAt: Number(now) || entry.lastImpAt,
  }));
}

export function recordClick(state, campaignId, now) {
  return withCampaign(state, campaignId, (entry) => ({
    ...entry, clk: entry.clk + 1, lastClkAt: Number(now) || entry.lastClkAt,
  }));
}

export function recordDismissal(state, campaignId, now) {
  return withCampaign(state, campaignId, (entry) => ({
    ...entry, dis: entry.dis + 1, lastDisAt: Number(now) || entry.lastDisAt,
  }));
}

// Impresiones "no correspondidas": cada click perdona un múltiplo de las
// impresiones acumuladas. Quien interactúa demuestra que la pieza no molesta.
function unrewardedImpressions(entry) {
  return Math.max(0, entry.imp - entry.clk * FREQUENCY.impressionsForgivenPerClick);
}

/**
 * ¿La campaña está silenciada AHORA? (exclusión dura)
 *  · descartada hace poco → cooldown de descarte;
 *  · demasiadas impresiones sin click → cooldown de sobreexposición.
 */
export function isCampaignMuted(state, campaignId, now) {
  const base = normalizeExposureState(state);
  const entry = base.campaigns[String(campaignId || '').trim()];
  if (!entry) return false;
  const timestamp = Number(now) || 0;
  if (entry.lastDisAt && timestamp - entry.lastDisAt < FREQUENCY.dismissCooldownMs) return true;
  if (
    unrewardedImpressions(entry) >= FREQUENCY.hardCapImpressions
    && entry.lastImpAt
    && timestamp - entry.lastImpAt < FREQUENCY.hardCapCooldownMs
  ) return true;
  return false;
}

/**
 * Penalización blanda 0..maxPenalty para el ranking. Crece con cada impresión
 * no correspondida por encima de las gratuitas.
 */
export function frequencyPenalty(state, campaignId, now) {
  const base = normalizeExposureState(state);
  const entry = base.campaigns[String(campaignId || '').trim()];
  if (!entry) return 0;
  if (isCampaignMuted(base, campaignId, now)) return FREQUENCY.maxPenalty;
  const excess = Math.max(0, unrewardedImpressions(entry) - FREQUENCY.freeImpressions);
  return Math.min(FREQUENCY.maxPenalty, excess * FREQUENCY.penaltyPerImpression);
}
