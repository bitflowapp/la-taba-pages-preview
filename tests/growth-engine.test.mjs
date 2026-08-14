import assert from 'node:assert/strict';
import { beforeEach, test } from 'node:test';
import {
  bumpGrowthRenderEpoch,
  configureGrowthEngine,
  getGrowthAffinity,
  isGrowthColdStart,
  recordCampaignClick,
  recordCampaignImpression,
  recordGrowthSignal,
  resetGrowthEngineForTests,
  selectGrowthCampaigns,
} from '../js/growth/engine.js';
import { GROWTH_CAMPAIGNS } from '../js/growth/campaigns-data.js';
import { GROWTH_STORAGE_KEYS } from '../js/growth/growth-config.js';
import { resetGrowthAnalyticsForTests, getGrowthEvents } from '../js/growth/analytics.js';

// Storage en memoria con la interfaz Web Storage. El engine lo consume vía
// getStorageArea('localStorage'), que lee globalThis. Se instala con
// defineProperty porque en algunos Node localStorage es un getter global.
function makeStorage() {
  const map = new Map();
  return {
    getItem: (key) => (map.has(key) ? map.get(key) : null),
    setItem: (key, value) => { map.set(key, String(value)); },
    removeItem: (key) => { map.delete(key); },
    _dump: () => Object.fromEntries(map),
  };
}

function installStorage(name, value) {
  Object.defineProperty(globalThis, name, { value, configurable: true, writable: true });
}

// 2027-01-19T13:00:00Z: martes, media mañana o madrugada en CUALQUIER huso.
// Elegido para que ninguna campaña con contexto (noche/viernes/finde) pueda
// robarle el cold start a la pieza por defecto por puntos de contexto,
// corra donde corra la suite.
const T0 = 1_800_363_600_000;
let clock = T0;

function makeCatalogView() {
  return {
    purchasableCategoryIds: new Set(['cervezas', 'gaseosas', 'energizantes', 'hielo', 'aguas', 'mixers']),
    purchasableBrandKeys: new Set(['heineken']),
    purchasableProductIds: new Set(['heineken-original-lata-473ml']),
    chargeableComboIds: new Set(['combo-heineken-x6', 'combo-noche-larga', 'combo-cuatro-para-arrancar']),
  };
}

beforeEach(() => {
  installStorage('localStorage', makeStorage());
  installStorage('sessionStorage', makeStorage());
  resetGrowthEngineForTests({ clearStorage: false });
  resetGrowthAnalyticsForTests();
  clock = T0;
  configureGrowthEngine({ now: () => clock });
});

test('cold start: el hero elegido es la pieza editorial por defecto (la tienda de hoy)', () => {
  const ranked = selectGrowthCampaigns({
    placement: 'hero',
    campaigns: GROWTH_CAMPAIGNS,
    catalogView: makeCatalogView(),
    slots: 1,
  });
  assert.ok(ranked.length >= 1);
  assert.equal(isGrowthColdStart(), true);
  // Sin señales ni contexto que empuje otra cosa, gana la prioridad
  // comercial: hero-cervezas (75), la vidriera primaria actual.
  // (El contexto puede sumar hasta 6 puntos a otra pieza; la prioridad de la
  // categoría primaria mantiene el primer viewport coherente.)
  assert.equal(ranked[0].campaign.id, 'hero-cervezas');
});

test('BEER TEST §20: navegar cervezas + buscar + agregar → el hero sigue siendo de cerveza y con score explicable', () => {
  // Persona B: entra a Cervezas, mira dos fichas, busca heineken, agrega una.
  recordGrowthSignal({ type: 'category_view', categoryId: 'cervezas' });
  clock += 30_000;
  recordGrowthSignal({ type: 'product_view', categoryId: 'cervezas', brand: 'Heineken', productId: 'heineken-original-lata-473ml' });
  clock += 30_000;
  recordGrowthSignal({ type: 'product_view', categoryId: 'cervezas', brand: 'Imperial', productId: 'imperial-golden-lata-473ml' });
  clock += 30_000;
  recordGrowthSignal({ type: 'search_match', categoryId: 'cervezas', brand: 'Heineken' });
  clock += 30_000;
  recordGrowthSignal({ type: 'add_to_cart', categoryId: 'cervezas', brand: 'Heineken', productId: 'heineken-original-lata-473ml' });

  const affinity = getGrowthAffinity();
  assert.ok(affinity.categories.cervezas > 10, `afinidad cerveza ${affinity.categories.cervezas}`);

  const ranked = selectGrowthCampaigns({
    placement: 'hero',
    campaigns: GROWTH_CAMPAIGNS,
    catalogView: makeCatalogView(),
    cartCategoryIds: ['cervezas'],
    slots: 1,
  });
  assert.ok(['hero-cervezas', 'hero-combo-noche-larga'].includes(ranked[0].campaign.id));
  assert.ok(ranked[0].campaign.categoryIds.includes('cervezas'));
  const intentFactor = ranked[0].explain.find((f) => f.factor === 'intent');
  assert.ok(intentFactor.value > 20, `la intención tiene que dominar el score: ${JSON.stringify(ranked[0].explain)}`);
});

test('beer intent dominante: el contexto nocturno no reemplaza el hero primario por un combo mixto', () => {
  const evening = new Date(T0);
  evening.setHours(20, 0, 0, 0);
  clock = evening.getTime();
  recordGrowthSignal({ type: 'category_view', categoryId: 'cervezas' });
  recordGrowthSignal({ type: 'product_view', categoryId: 'cervezas', brand: 'heineken' });
  recordGrowthSignal({ type: 'search_match', categoryId: 'cervezas', brand: 'heineken' });

  const ranked = selectGrowthCampaigns({
    placement: 'hero',
    campaigns: GROWTH_CAMPAIGNS,
    catalogView: makeCatalogView(),
    cartCategoryIds: ['cervezas'],
  });
  assert.equal(ranked[0].campaign.id, 'hero-cervezas');
  assert.equal(ranked[0].campaign.creative.ctaLabel, 'Ver cervezas');
});

test('cambio de intención: si después navega gaseosas con fuerza, la vidriera la sigue', () => {
  recordGrowthSignal({ type: 'category_view', categoryId: 'cervezas' });
  for (let i = 0; i < 4; i += 1) {
    clock += 20_000;
    recordGrowthSignal({ type: 'product_view', categoryId: 'energizantes' });
  }
  clock += 20_000;
  recordGrowthSignal({ type: 'add_to_cart', categoryId: 'energizantes' });
  const ranked = selectGrowthCampaigns({
    placement: 'hero',
    campaigns: GROWTH_CAMPAIGNS,
    catalogView: makeCatalogView(),
    slots: 1,
  });
  assert.equal(ranked[0].campaign.id, 'hero-energizantes');
});

test('estabilidad por época: una señal en vivo NO mueve la vidriera; la época nueva sí', () => {
  const input = {
    placement: 'hero',
    campaigns: GROWTH_CAMPAIGNS,
    catalogView: makeCatalogView(),
    slots: 1,
  };
  const first = selectGrowthCampaigns(input);
  const second = selectGrowthCampaigns(input);
  assert.equal(first, second, 'debe devolver el MISMO array memoizado');
  // Agregar al carrito estando en la home emite señal, pero la pieza en
  // pantalla no puede cambiar bajo el dedo: mismo memo dentro de la época.
  recordGrowthSignal({ type: 'add_to_cart', categoryId: 'energizantes' });
  recordGrowthSignal({ type: 'product_view', categoryId: 'energizantes' });
  recordGrowthSignal({ type: 'product_view', categoryId: 'energizantes' });
  const third = selectGrowthCampaigns(input);
  assert.equal(first, third, 'la señal en vivo no reordena la época actual');
  // Al reentrar a la vista (época nueva) la intención acumulada SÍ manda.
  bumpGrowthRenderEpoch();
  const fourth = selectGrowthCampaigns(input);
  assert.notEqual(first, fourth);
  assert.equal(fourth[0].campaign.id, 'hero-energizantes');
});

test('anonymous restart: la sesión no sobrevive, el largo plazo decae pero persiste', () => {
  recordGrowthSignal({ type: 'add_to_cart', categoryId: 'cervezas' });
  const before = getGrowthAffinity().categories.cervezas;
  // "Cerrar el navegador": muere sessionStorage, sobrevive localStorage.
  installStorage('sessionStorage', makeStorage());
  resetGrowthEngineForTests({ clearStorage: false });
  configureGrowthEngine({ now: () => clock });
  const after = getGrowthAffinity().categories.cervezas;
  assert.ok(after > 0, 'el largo plazo sobrevive el reinicio');
  assert.ok(after < before, 'sin la sesión, la afinidad combinada baja');
});

test('storage corrupto: arranque frío sin excepción y el registro roto se limpia', () => {
  globalThis.localStorage.setItem(GROWTH_STORAGE_KEYS.longTermIntent, '{{{ basura');
  globalThis.localStorage.setItem(GROWTH_STORAGE_KEYS.exposure, JSON.stringify({ v: 99, campaigns: 'x' }));
  resetGrowthEngineForTests({ clearStorage: false });
  configureGrowthEngine({ now: () => clock });
  assert.equal(isGrowthColdStart(), true);
  const ranked = selectGrowthCampaigns({
    placement: 'hero',
    campaigns: GROWTH_CAMPAIGNS,
    catalogView: makeCatalogView(),
  });
  assert.ok(ranked.length >= 1, 'la tienda sigue mostrando vidriera');
});

test('sin storage disponible el motor funciona en memoria (fail-safe)', () => {
  installStorage('localStorage', undefined);
  installStorage('sessionStorage', undefined);
  resetGrowthEngineForTests({ clearStorage: false });
  configureGrowthEngine({ now: () => clock });
  recordGrowthSignal({ type: 'category_view', categoryId: 'cervezas' });
  assert.ok(getGrowthAffinity().categories.cervezas > 0);
});

test('impresiones: una por pieza por época, y el click alimenta intención + funnel', () => {
  const [hero] = selectGrowthCampaigns({
    placement: 'hero',
    campaigns: GROWTH_CAMPAIGNS,
    catalogView: makeCatalogView(),
  });
  recordCampaignImpression(hero.campaign, 'hero');
  recordCampaignImpression(hero.campaign, 'hero');
  recordCampaignImpression(hero.campaign, 'hero');
  const impressions = getGrowthEvents().filter((event) => event.type === 'promo_impression');
  assert.equal(impressions.length, 1, 're-renders no inflan impresiones');
  recordCampaignClick(hero.campaign, 'hero');
  const clicks = getGrowthEvents().filter((event) => event.type === 'promo_click');
  assert.equal(clicks.length, 1);
  assert.equal(clicks[0].campaignId, hero.campaign.id);
  assert.ok(getGrowthAffinity().categories[hero.campaign.categoryIds[0]] > 0);
});

test('catálogo sin destinos comprables: selección vacía, jamás una pieza rota', () => {
  const ranked = selectGrowthCampaigns({
    placement: 'hero',
    campaigns: GROWTH_CAMPAIGNS,
    catalogView: {
      purchasableCategoryIds: new Set(),
      purchasableBrandKeys: new Set(),
      purchasableProductIds: new Set(),
      chargeableComboIds: new Set(),
    },
  });
  assert.deepEqual(ranked, []);
});
