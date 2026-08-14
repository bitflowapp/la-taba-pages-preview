import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  eligibleCampaigns,
  normalizeCampaign,
} from '../js/growth/campaign-eligibility.js';
import { explainRanking, rankCampaigns } from '../js/growth/ranking.js';
import {
  emptyExposureState,
  recordDismissal,
  recordImpression,
} from '../js/growth/exposure-store.js';
import { FREQUENCY, RANKING_WEIGHTS } from '../js/growth/growth-config.js';

// Martes 2027-01-19 18:39 hora local aprox (contexto 'evening' estable para
// los tests de contexto; ninguno depende del día de semana).
const NOW = 1_800_000_000_000;

function makeCatalogView({
  categories = ['cervezas', 'gaseosas', 'hielo'],
  brands = ['heineken'],
  products = [],
  combos = [],
} = {}) {
  return {
    purchasableCategoryIds: new Set(categories),
    purchasableBrandKeys: new Set(brands),
    purchasableProductIds: new Set(products),
    chargeableComboIds: new Set(combos),
  };
}

function campaign(overrides = {}) {
  return {
    id: 'test-campaign',
    enabled: true,
    kind: 'editorial',
    placements: ['hero'],
    categoryIds: ['cervezas'],
    priority: 50,
    creative: { title: 'Pieza de prueba' },
    ...overrides,
  };
}

// ── Elegibilidad ─────────────────────────────────────────────────────────────

test('campaña deshabilitada, sin placement o malformada: afuera', () => {
  const view = makeCatalogView();
  assert.equal(eligibleCampaigns({
    campaigns: [campaign({ enabled: false })], placement: 'hero', catalogView: view, now: NOW,
  }).length, 0);
  assert.equal(eligibleCampaigns({
    campaigns: [campaign()], placement: 'door', catalogView: view, now: NOW,
  }).length, 0);
  assert.equal(normalizeCampaign({ id: '', kind: 'editorial' }), null);
  assert.equal(normalizeCampaign(campaign({ creative: { title: '' } })), null);
});

test('campaña vencida o futura jamás aparece, sin importar su prioridad', () => {
  const view = makeCatalogView();
  const expired = campaign({ id: 'vieja', priority: 100, endsAt: '2026-01-01T00:00:00Z' });
  const future = campaign({ id: 'futura', priority: 100, startsAt: '2100-01-01T00:00:00Z' });
  const current = campaign({ id: 'vigente', priority: 1 });
  const result = eligibleCampaigns({
    campaigns: [expired, future, current], placement: 'hero', catalogView: view, now: NOW,
  });
  assert.deepEqual(result.map((c) => c.id), ['vigente']);
});

test('destino sin producto comprable: afuera (stock/eligibilidad antes que ranking)', () => {
  const view = makeCatalogView({ categories: ['gaseosas'] });
  const beer = campaign({ id: 'beer' });
  assert.equal(eligibleCampaigns({
    campaigns: [beer], placement: 'hero', catalogView: view, now: NOW,
  }).length, 0);
  // La misma campaña con el destino comprable, adentro.
  assert.equal(eligibleCampaigns({
    campaigns: [beer], placement: 'hero', catalogView: makeCatalogView(), now: NOW,
  }).length, 1);
});

test('marca y combo también exigen destino vivo', () => {
  const view = makeCatalogView({ brands: [], combos: [] });
  const brandDoor = campaign({ id: 'brand', brand: 'Heineken', categoryIds: [] });
  const comboHero = campaign({ id: 'combo', kind: 'combo', comboId: 'combo-heineken-x6', categoryIds: ['cervezas'] });
  assert.equal(eligibleCampaigns({
    campaigns: [brandDoor, comboHero], placement: 'hero', catalogView: view, now: NOW,
  }).length, 0);
  const alive = makeCatalogView({ brands: ['heineken'], combos: ['combo-heineken-x6'] });
  assert.equal(eligibleCampaigns({
    campaigns: [brandDoor, comboHero], placement: 'hero', catalogView: alive, now: NOW,
  }).length, 2);
});

test('kind promotion exige promoción ACTIVA del contrato validado', () => {
  const view = makeCatalogView();
  const promoCampaign = campaign({ id: 'promo', kind: 'promotion', promoId: 'promo-x' });
  // Sin promoción de respaldo: afuera.
  assert.equal(eligibleCampaigns({
    campaigns: [promoCampaign], placement: 'hero', catalogView: view, promotions: [], now: NOW,
  }).length, 0);
  // Con una promoción PENDIENTE (sin aprobación humana): sigue afuera.
  const pending = {
    promoId: 'promo-x',
    title: 'Promo X',
    includedSkus: ['sku-1'],
    promotionType: 'precio_promocional',
    regularPrice: 1000,
    promotionalPrice: 800,
    validFrom: '2027-01-01',
    validUntil: '2027-12-31',
    active: true,
    previewOnly: true,
    approvalStatus: 'PENDIENTE',
  };
  assert.equal(eligibleCampaigns({
    campaigns: [promoCampaign], placement: 'hero', catalogView: view, promotions: [pending], now: NOW,
  }).length, 0);
  // Aprobada, vigente y activa: adentro.
  const approved = { ...pending, approvalStatus: 'APROBADA', approvalReference: 'ACTA-1' };
  assert.equal(eligibleCampaigns({
    campaigns: [promoCampaign], placement: 'hero', catalogView: view, promotions: [approved], now: NOW,
  }).length, 1);
});

// ── Ranking ──────────────────────────────────────────────────────────────────

test('cold start: sin señales gana la prioridad comercial', () => {
  const ranked = rankCampaigns({
    campaigns: [
      normalizeCampaign(campaign({ id: 'a', priority: 30 })),
      normalizeCampaign(campaign({ id: 'b', priority: 70, categoryIds: ['gaseosas'] })),
    ],
    affinity: { categories: {}, brands: {}, products: {} },
    now: NOW,
    slots: 1,
  });
  assert.equal(ranked[0].campaign.id, 'b');
});

test('category intent §20: afinidad cerveza da vuelta la prioridad', () => {
  const campaigns = [
    normalizeCampaign(campaign({ id: 'gaseosas-fuerte', priority: 70, categoryIds: ['gaseosas'] })),
    normalizeCampaign(campaign({ id: 'cerveza-suave', priority: 30, categoryIds: ['cervezas'] })),
  ];
  const cold = rankCampaigns({ campaigns, now: NOW, slots: 1 });
  assert.equal(cold[0].campaign.id, 'gaseosas-fuerte');
  const beerLover = rankCampaigns({
    campaigns,
    affinity: { categories: { cervezas: 12 }, brands: {}, products: {} },
    now: NOW,
    slots: 1,
  });
  assert.equal(beerLover[0].campaign.id, 'cerveza-suave');
  const explain = explainRanking(beerLover);
  assert.ok(explain[0].factors.some((f) => f.startsWith('intent +')));
});

test('si la persona cambia a vinos, el sistema la sigue', () => {
  const campaigns = [
    normalizeCampaign(campaign({ id: 'beer', categoryIds: ['cervezas'], priority: 40 })),
    normalizeCampaign(campaign({ id: 'wine', categoryIds: ['vinos'], priority: 40 })),
  ];
  const beerFirst = rankCampaigns({
    campaigns,
    affinity: { categories: { cervezas: 10, vinos: 2 }, brands: {}, products: {} },
    now: NOW,
  });
  assert.equal(beerFirst[0].campaign.id, 'beer');
  const wineNow = rankCampaigns({
    campaigns,
    affinity: { categories: { cervezas: 3, vinos: 14 }, brands: {}, products: {} },
    now: NOW,
  });
  assert.equal(wineNow[0].campaign.id, 'wine');
});

test('afinidad de marca y de producto también rankean', () => {
  const campaigns = [
    normalizeCampaign(campaign({ id: 'generic', categoryIds: ['gaseosas'], priority: 50 })),
    normalizeCampaign(campaign({ id: 'brand-door', categoryIds: [], brand: 'Heineken', priority: 20 })),
  ];
  const ranked = rankCampaigns({
    campaigns,
    affinity: { categories: {}, brands: { heineken: 15 }, products: {} },
    now: NOW,
  });
  assert.equal(ranked[0].campaign.id, 'brand-door');
});

test('cart intent: el complemento del carrito gana relevancia (fernet → gaseosas/hielo)', () => {
  const campaigns = [
    normalizeCampaign(campaign({ id: 'more-fernet', categoryIds: ['fernet'], priority: 50 })),
    normalizeCampaign(campaign({ id: 'cola', categoryIds: ['gaseosas'], priority: 30 })),
  ];
  const ranked = rankCampaigns({
    campaigns,
    cartCategoryIds: ['fernet'],
    now: NOW,
  });
  // La puerta de gaseosas complementa el fernet del carrito y supera a
  // "más fernet" pese a la prioridad menor.
  assert.equal(ranked[0].campaign.id, 'cola');
  assert.ok(ranked[0].explain.some((f) => f.factor === 'complement'));
});

test('frequency cap: sobreexposición sin clicks baja la campaña', () => {
  const campaigns = [
    normalizeCampaign(campaign({ id: 'quemada', priority: 60 })),
    normalizeCampaign(campaign({ id: 'fresca', priority: 55, categoryIds: ['gaseosas'] })),
  ];
  let exposure = emptyExposureState();
  for (let i = 0; i < FREQUENCY.freeImpressions + 3; i += 1) {
    exposure = recordImpression(exposure, 'quemada', NOW - 1000 + i);
  }
  const ranked = rankCampaigns({ campaigns, exposure, now: NOW });
  assert.equal(ranked[0].campaign.id, 'fresca');
});

test('hard cap: demasiadas impresiones sin click la EXCLUYEN hasta el cooldown', () => {
  const only = [normalizeCampaign(campaign({ id: 'sola', priority: 90 }))];
  let exposure = emptyExposureState();
  for (let i = 0; i < FREQUENCY.hardCapImpressions; i += 1) {
    exposure = recordImpression(exposure, 'sola', NOW - 1000 + i);
  }
  assert.equal(rankCampaigns({ campaigns: only, exposure, now: NOW }).length, 0);
  // Pasado el cooldown vuelve a competir.
  const later = NOW + FREQUENCY.hardCapCooldownMs + 1000;
  assert.equal(rankCampaigns({ campaigns: only, exposure, now: later }).length, 1);
});

test('descartar una pieza la silencia por el cooldown de descarte', () => {
  const only = [normalizeCampaign(campaign({ id: 'cerrada', priority: 90 }))];
  const exposure = recordDismissal(emptyExposureState(), 'cerrada', NOW - 1000);
  assert.equal(rankCampaigns({ campaigns: only, exposure, now: NOW }).length, 0);
  const later = NOW + FREQUENCY.dismissCooldownMs;
  assert.equal(rankCampaigns({ campaigns: only, exposure, now: later }).length, 1);
});

test('diversidad: dos slots no se van al mismo rubro por afinidad alta', () => {
  const campaigns = [
    normalizeCampaign(campaign({ id: 'beer-1', categoryIds: ['cervezas'], priority: 60 })),
    normalizeCampaign(campaign({ id: 'beer-2', categoryIds: ['cervezas'], priority: 55 })),
    normalizeCampaign(campaign({ id: 'agua', categoryIds: ['aguas'], priority: 40 })),
  ];
  const ranked = rankCampaigns({
    campaigns,
    affinity: { categories: { cervezas: 10 }, brands: {}, products: {} },
    now: NOW,
    slots: 2,
  });
  assert.equal(ranked[0].campaign.id, 'beer-1');
  // El segundo slot NO es beer-2: la repetición de categoría pesa más que la
  // diferencia de score.
  assert.equal(ranked[1].campaign.id, 'agua');
  assert.equal(RANKING_WEIGHTS.diversityRepeatPenalty > 0, true);
});

test('determinismo: mismas entradas, mismo resultado, cien veces', () => {
  const campaigns = [
    normalizeCampaign(campaign({ id: 'a', priority: 50 })),
    normalizeCampaign(campaign({ id: 'b', priority: 50, categoryIds: ['gaseosas'] })),
    normalizeCampaign(campaign({ id: 'c', priority: 40, categoryIds: ['aguas'] })),
  ];
  const input = {
    campaigns,
    affinity: { categories: { gaseosas: 4 }, brands: {}, products: {} },
    cartCategoryIds: ['fernet'],
    now: NOW,
    slots: 3,
  };
  const first = JSON.stringify(rankCampaigns(input).map((r) => r.campaign.id));
  for (let i = 0; i < 100; i += 1) {
    assert.equal(JSON.stringify(rankCampaigns(input).map((r) => r.campaign.id)), first);
  }
});

test('rotación de cold start: empatados exactos rotan por día, sin azar', () => {
  const twins = [
    normalizeCampaign(campaign({ id: 'twin-a', priority: 50 })),
    normalizeCampaign(campaign({ id: 'twin-b', priority: 50, categoryIds: ['cervezas'] })),
  ];
  const day1 = rankCampaigns({ campaigns: twins, now: NOW, slots: 1 })[0].campaign.id;
  const sameDay = rankCampaigns({ campaigns: twins, now: NOW + 60_000, slots: 1 })[0].campaign.id;
  const nextDay = rankCampaigns({ campaigns: twins, now: NOW + 24 * 60 * 60 * 1000, slots: 1 })[0].campaign.id;
  assert.equal(day1, sameDay);
  assert.notEqual(day1, nextDay);
});

test('sin campañas: lista vacía, nunca una excepción', () => {
  assert.deepEqual(rankCampaigns({ campaigns: [], now: NOW }), []);
  assert.deepEqual(rankCampaigns({ now: NOW }), []);
  assert.deepEqual(rankCampaigns({ campaigns: [], now: Number.NaN }), []);
});
