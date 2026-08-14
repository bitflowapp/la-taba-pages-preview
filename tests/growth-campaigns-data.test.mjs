import assert from 'node:assert/strict';
import { test } from 'node:test';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { GROWTH_CAMPAIGNS } from '../js/growth/campaigns-data.js';
import { normalizeCampaignCollection } from '../js/growth/campaign-eligibility.js';
import { COMPLEMENT_RULES, ALCOHOL_CATEGORY_IDS, complementCategories } from '../js/growth/complements.js';
import { CONTEXT_BUCKETS } from '../js/growth/context.js';
import { COMBO_MANIFEST } from '../js/combos-data.js';
import { authorityCategories } from '../js/taba2-commercial-pending-data.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const REAL_CATEGORY_IDS = new Set(authorityCategories.map((category) => category.id));
const COMBO_IDS = new Set(COMBO_MANIFEST.map((combo) => combo.comboId));

// Palabras que una pieza editorial NO puede afirmar: eso es territorio del
// contrato validado de promociones, no de una creatividad.
const FORBIDDEN_OFFER_WORDS = /(\d+\s*%|%\s*off|\boff\b|descuento|oferta|liquidaci[oó]n|gratis|\d+\s*x\s*\d+|precio|rebaja|promoci[oó]n)/i;

// El CTA describe la acción real. "Reservar" no existe en este storefront.
const VALID_CTA = /^(Ver|Pedir|Agregar|Sumar)\b/;

test('todas las campañas del catálogo pasan la normalización', () => {
  const normalized = normalizeCampaignCollection(GROWTH_CAMPAIGNS);
  assert.equal(normalized.length, GROWTH_CAMPAIGNS.length);
});

test('ids únicos', () => {
  const ids = GROWTH_CAMPAIGNS.map((campaign) => campaign.id);
  assert.equal(new Set(ids).size, ids.length);
});

test('los destinos usan la taxonomía REAL del catálogo de autoridad', () => {
  for (const campaign of GROWTH_CAMPAIGNS) {
    for (const categoryId of campaign.categoryIds || []) {
      assert.ok(REAL_CATEGORY_IDS.has(categoryId), `${campaign.id}: categoría inexistente "${categoryId}"`);
    }
  }
});

test('toda campaña combo referencia un combo real del manifiesto', () => {
  for (const campaign of GROWTH_CAMPAIGNS) {
    if (campaign.kind !== 'combo') continue;
    assert.ok(COMBO_IDS.has(campaign.comboId), `${campaign.id}: combo inexistente "${campaign.comboId}"`);
  }
});

test('ninguna editorial o combo afirma precio, descuento ni oferta en su copy', () => {
  for (const campaign of GROWTH_CAMPAIGNS) {
    const copy = [
      campaign.creative?.eyebrow,
      campaign.creative?.title,
      campaign.creative?.subtitle,
      campaign.creative?.ctaLabel,
    ].filter(Boolean).join(' · ');
    assert.ok(
      !FORBIDDEN_OFFER_WORDS.test(copy),
      `${campaign.id} afirma condición comercial en la creatividad: "${copy}"`,
    );
  }
});

test('los CTA usan verbos de acción real, jamás "Reservar"', () => {
  for (const campaign of GROWTH_CAMPAIGNS) {
    const label = campaign.creative?.ctaLabel || '';
    assert.ok(VALID_CTA.test(label), `${campaign.id}: CTA "${label}" fuera de la voz TABA2`);
    assert.ok(!/reservar/i.test(label), `${campaign.id}: CTA prohibido`);
  }
});

test('toda imagen declarada existe en el repo (material curado, no placeholders)', () => {
  for (const campaign of GROWTH_CAMPAIGNS) {
    for (const key of ['image', 'bandImage']) {
      const path = campaign.creative?.[key];
      if (!path) continue;
      assert.ok(existsSync(join(ROOT, path)), `${campaign.id}: no existe ${path}`);
      assert.ok(path.startsWith('assets/promos/'), `${campaign.id}: ${path} fuera del lote curado`);
    }
  }
});

test('los contextos declarados existen', () => {
  const valid = new Set(CONTEXT_BUCKETS);
  for (const campaign of GROWTH_CAMPAIGNS) {
    for (const bucket of campaign.contexts || []) {
      assert.ok(valid.has(bucket), `${campaign.id}: contexto inválido "${bucket}"`);
    }
  }
});

test('hay al menos una campaña evergreen de hero sin requisito de intención (cold start cubierto)', () => {
  const fallback = GROWTH_CAMPAIGNS.filter((campaign) => (
    campaign.placements.includes('hero')
    && campaign.enabled
    && !campaign.requiresIntent
    && !campaign.startsAt
    && !campaign.endsAt
    && campaign.kind === 'editorial'
  ));
  assert.ok(fallback.length >= 1);
});

// ── Grafo de complementos ────────────────────────────────────────────────────

test('guardia de taxonomía: toda categoría de autoridad está clasificada en el grafo', () => {
  for (const category of authorityCategories) {
    if (category.id === 'all') continue;
    assert.ok(
      Object.hasOwn(COMPLEMENT_RULES, category.id),
      `Categoría "${category.id}" sin regla de complemento declarada (aunque sea vacía)`,
    );
  }
});

test('los complementos jamás apuntan a alcohol', () => {
  const alcohol = new Set(ALCOHOL_CATEGORY_IDS);
  for (const [source, targets] of Object.entries(COMPLEMENT_RULES)) {
    for (const target of targets) {
      assert.ok(!alcohol.has(target), `${source} → ${target} sugiere alcohol como complemento`);
      assert.ok(REAL_CATEGORY_IDS.has(target), `${source} → ${target}: destino inexistente`);
    }
  }
});

test('fernet pide gaseosas y hielo; lo que ya está en el carrito no se repite', () => {
  assert.deepEqual(complementCategories(['fernet']), ['gaseosas', 'hielo']);
  assert.deepEqual(complementCategories(['fernet', 'hielo']), ['gaseosas']);
  assert.deepEqual(complementCategories([]), []);
});

test('cerveza sólo abre cross-sell de complemento real, no energizantes por defecto', () => {
  assert.deepEqual(complementCategories(['cervezas']), ['hielo']);
});
