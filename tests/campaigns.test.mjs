/*
 * Campañas animadas de la vidriera.
 *
 * Lo que este archivo protege no es la animación —esa se mide en un navegador,
 * en tests/e2e/campaigns.spec.mjs— sino las tres promesas del motor:
 *
 *   1 · nada se muestra sin las DOS llaves comerciales y sin un producto real
 *       que se pueda comprar ahora;
 *   2 · ninguna pieza afirma dinero, urgencia ni popularidad;
 *   3 · lo que escribe es estático, determinista y no puede inyectar marcado.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { CAMPAIGNS } from '../js/campaigns/campaign-config.js';
import {
  ALCOHOL_LEGAL_NOTICE,
  CAMPAIGN_GRID_POSITION,
  CAMPAIGN_PLACEMENTS,
  CAMPAIGN_PRESETS,
  campaignMarkup,
  campaignProblems,
  normalizeCampaign,
  selectCampaigns,
} from '../js/campaigns/campaign-engine.js';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const read = (relative) => fs.readFileSync(path.join(root, relative), 'utf8');
const snapshot = JSON.parse(read('tests/fixtures/catalog-cp-46.json'));

/** Las 46 fichas reales, con la forma que tienen en la tienda. */
const catalog = snapshot.products.map((row) => ({
  id: row.id,
  sku: row.sku,
  name: row.name,
  brand: row.brand, variant: row.variant, capacityValue: row.capacity_value, capacityUnit: row.capacity_unit, packageType: row.packaging_type,
  alcoholic: row.is_alcoholic === true,
  categoryId: String(row.category).toLowerCase(),
}));
const everythingSells = () => true;
const nothingSells = () => false;

const approved = (campaign, changes = {}) => ({
  ...campaign,
  enabled: true,
  approval: { status: 'APROBADA', reference: 'prueba unitaria' },
  ...changes,
});
const allApproved = () => CAMPAIGNS.map((campaign) => approved(campaign));
const byId = (id) => CAMPAIGNS.find((campaign) => campaign.id === id);
const wideCatalog = { categoryId: 'all', searching: false, filtered: false, listSize: 46 };

// ─── 1 · Las llaves ───────────────────────────────────────────────────────────

test('todas las campañas del repositorio nacen apagadas y sin aprobar', () => {
  assert.ok(CAMPAIGNS.length >= 4, 'faltan campañas candidatas');
  for (const campaign of CAMPAIGNS) {
    assert.equal(campaign.enabled, false, `${campaign.id} está encendida en el repositorio`);
    assert.equal(campaign.approval.status, 'PENDIENTE', `${campaign.id} figura aprobada en el repositorio`);
    assert.deepEqual(
      campaignProblems(normalizeCampaign(campaign)).filter((problem) => !['disabled', 'not-approved'].includes(problem)),
      [],
      `${campaign.id} tiene un defecto además de estar apagada`,
    );
  }
});

test('con la configuración del repositorio no se muestra ninguna pieza, aunque todo se pueda vender', () => {
  const selected = selectCampaigns({ campaigns: CAMPAIGNS, products: catalog, isOrderable: everythingSells, catalog: wideCatalog });
  assert.deepEqual(selected, { 'home-hero': null, 'home-inline': null, 'catalog-inline': null });
});

test('una sola llave no alcanza: encendida sin aprobar, o aprobada sin encender', () => {
  const beer = byId('heineken-beer-pour');
  const soloEncendida = { ...beer, enabled: true };
  const soloAprobada = { ...beer, approval: { status: 'APROBADA', reference: 'x' } };
  const sinReferencia = approved(beer, { approval: { status: 'APROBADA', reference: '' } });
  for (const campaign of [soloEncendida, soloAprobada, sinReferencia]) {
    const selected = selectCampaigns({ campaigns: [campaign], products: catalog, isOrderable: everythingSells });
    assert.equal(selected['home-hero'], null);
  }
  assert.ok(campaignProblems(normalizeCampaign(sinReferencia)).includes('not-approved'), 'aprobar exige decir quién y cuándo');
});

test('las seis escenas existen, y las candidatas usan las cuatro primeras', () => {
  assert.deepEqual(
    Object.keys(CAMPAIGN_PRESETS).sort(),
    ['beer_pour', 'cold_can', 'glass_fill', 'ice_reveal', 'product_drop', 'spotlight_product'],
  );
  // `spotlight_product` y `glass_fill` están listas para una campaña futura:
  // ninguna candidata las usa, así que agregarlas no encendió nada.
  const used = new Set(CAMPAIGNS.map((campaign) => campaign.creative.preset));
  assert.deepEqual([...used].sort(), ['beer_pour', 'cold_can', 'ice_reveal', 'product_drop']);
  for (const preset of Object.values(CAMPAIGN_PRESETS)) {
    assert.ok(preset.duration > 0 && preset.duration <= 6, `${preset.id}: la entrada no puede durar más de 6 s`);
  }
});

// ─── El producto tiene que existir y poder comprarse ──────────────────────────

test('cada candidata apunta a un producto que EXISTE en el catálogo real', () => {
  const skus = new Set(catalog.map((product) => product.sku));
  for (const campaign of CAMPAIGNS) {
    assert.ok(
      campaign.target.skus.some((sku) => skus.has(sku)),
      `${campaign.id} apunta a un SKU que no está entre las 46 fichas`,
    );
  }
});

test('una campaña aprobada no se muestra si su producto no está o no se puede comprar', () => {
  const sinProducto = selectCampaigns({ campaigns: allApproved(), products: [], isOrderable: everythingSells });
  assert.equal(sinProducto['home-hero'], null);
  const sinVenta = selectCampaigns({ campaigns: allApproved(), products: catalog, isOrderable: nothingSells });
  assert.deepEqual(sinVenta, { 'home-hero': null, 'home-inline': null, 'catalog-inline': null });
  const soloHeineken = (product) => product.sku === 'heineken-710ml';
  const parcial = selectCampaigns({ campaigns: allApproved(), products: catalog, isOrderable: soloHeineken, catalog: wideCatalog });
  assert.equal(parcial['home-hero']?.campaign.id, 'heineken-beer-pour');
  assert.equal(parcial['home-inline'], null);
});

test('la vigencia se respeta y una fecha ilegible apaga la campaña', () => {
  const beer = byId('heineken-beer-pour');
  const now = Date.parse('2026-10-01T12:00:00Z');
  const pick = (changes) => selectCampaigns({ campaigns: [approved(beer, changes)], products: catalog, isOrderable: everythingSells, now })['home-hero'];
  assert.ok(pick({}));
  assert.ok(pick({ validFrom: '2026-09-01T00:00:00Z', validUntil: '2026-12-01T00:00:00Z' }));
  assert.equal(pick({ validFrom: '2026-11-01T00:00:00Z' }), null, 'se mostró antes de empezar');
  assert.equal(pick({ validUntil: '2026-09-30T00:00:00Z' }), null, 'se mostró después de vencer');
  assert.equal(pick({ validUntil: 'mañana' }), null, 'una fecha que no se puede leer no es «sin vencimiento»');
});

test('una vigencia es un instante con huso: una fecha suelta o un formato local apagan la campaña', () => {
  const beer = byId('heineken-beer-pour');
  // Mediodía del 31 de octubre en Neuquén.
  const now = Date.parse('2026-10-31T12:00:00-03:00');
  const problems = (changes) => campaignProblems(normalizeCampaign(approved(beer, changes)), { now });
  // «Hasta el 31» escrito como fecha sola se lee como medianoche UTC: a esta
  // hora la campaña ya estaba vencida desde las 21:00 del día 30.
  assert.ok(problems({ validUntil: '2026-10-31' }).includes('invalid-dates'), 'una fecha sin hora pasó como vigencia');
  assert.ok(problems({ validFrom: '2026-10-01' }).includes('invalid-dates'));
  // Lo que cada navegador lee a su manera.
  for (const ambiguous of ['2026-10-31 23:59', '31/10/2026', 'Oct 31 2026', '2026-10-31T23:59']) {
    assert.ok(problems({ validUntil: ambiguous }).includes('invalid-dates'), `«${ambiguous}» pasó como vigencia`);
  }
  // Con hora y huso se respeta el día que la persona quiso decir.
  assert.deepEqual(problems({ validFrom: '2026-10-01T00:00:00-03:00', validUntil: '2026-10-31T23:59:59-03:00' }), []);
  assert.ok(problems({ validUntil: '2026-10-31T11:59:59-03:00' }).includes('expired'));
  assert.deepEqual(problems({ validUntil: '2026-10-31T15:00:01Z' }), []);
  // Una base de datos escribe microsegundos: es el mismo instante.
  assert.deepEqual(problems({ validUntil: '2026-10-31T23:59:59.123456-03:00' }), []);
  assert.ok(problems({ validUntil: '2026-10-31T11:59:59.999999-03:00' }).includes('expired'));
  // Un día que no existe: hay motores que lo corren al mes siguiente.
  for (const imposible of ['2026-11-31T23:59:59-03:00', '2026-02-30T00:00:00-03:00', '2026-13-01T00:00:00-03:00']) {
    assert.ok(problems({ validUntil: imposible }).includes('invalid-dates'), `«${imposible}» pasó como vigencia`);
  }
});

// ─── 2 · Lo que una pieza editorial no puede decir ────────────────────────────

test('ninguna candidata declara precio, descuento ni oferta, ni en el texto ni en los datos', () => {
  for (const campaign of CAMPAIGNS) {
    const serialized = JSON.stringify(campaign).toLowerCase();
    for (const key of ['price', 'precio', 'discount', 'descuento', 'stock', 'saving']) {
      assert.ok(!serialized.includes(`"${key}`), `${campaign.id} trae un campo «${key}»`);
    }
    assert.ok(!campaignProblems(normalizeCampaign(campaign)).includes('copy-claims'));
  }
});

test('un texto que afirma dinero, urgencia o popularidad apaga la campaña', () => {
  const beer = byId('heineken-beer-pour');
  const frases = [
    'Heineken a $ 2.500',
    '20% menos esta semana',
    'Oferta de la semana',
    'Promo cerveza',
    'Llevá 2x1',
    'Envío gratis',
    'Ahorrá con el pack',
    'Últimas unidades',
    'La más vendida',
    'Por tiempo limitado',
    'Antes costaba más',
    'Ganá un premio',
  ];
  for (const headline of frases) {
    const campaign = normalizeCampaign(approved(beer, { copy: { ...beer.copy, headline } }));
    assert.ok(campaignProblems(campaign).includes('copy-claims'), `«${headline}» pasó como texto editorial`);
  }
  const limpio = normalizeCampaign(approved(beer));
  assert.deepEqual(campaignProblems(limpio), []);
});

test('lo que la primera lista dejaba pasar: precio, cantidad, plazo y popularidad dichos de otra forma', () => {
  const beer = byId('heineken-beer-pour');
  const frases = [
    'Precio especial',
    'Mitad de precio',
    '50 OFF',
    'Heineken a 2500',
    'Desde 1.999',
    'Llevá 3, pagá 2',
    'Segunda unidad al 50',
    'Regalo con tu compra',
    'Hasta agotar stock',
    'Solo por hoy',
    'Sólo por hoy',
    'Cuotas sin interés',
    'Envío sin cargo',
    'La más elegida',
    'La favorita del barrio',
    'Quedan pocas',
    'Dos por 4000 pesos',
    // Una cifra con multiplicador es un precio aunque tenga un solo dígito.
    'Heineken a 2 mil',
    'Lata a 2 lucas',
    'Heineken a 2k',
    'Hasta 40 menos',
    '2da unidad al 50',
    'De regalo',
    'A mitad',
    // Las formas cortas y las escritas con letras, como se dicen en la calle.
    'Sólo hoy',
    'Solo hoy',
    'Últimas',
    'Últimas latas',
    'Dos mil la lata',
    'Dos por uno',
    'Llevá dos, pagá una',
    'Llevá 2',
    'Más barata',
    'Envío sin costo',
    'Hot Sale',
    'Hasta el domingo',
    'Edición limitada',
    'Pocas unidades',
    'Solo quedan dos',
    'Segunda al 50',
    'Cupón TABA',
  ];
  for (const headline of frases) {
    const campaign = normalizeCampaign(approved(beer, { copy: { ...beer.copy, headline } }));
    assert.ok(campaignProblems(campaign).includes('copy-claims'), `«${headline}» pasó como texto editorial`);
  }
  // Y también en la acción, que es texto de la campaña igual que el título.
  const enLaAccion = normalizeCampaign(approved(beer, { copy: { ...beer.copy, cta: 'Ver a 2500' } }));
  assert.ok(campaignProblems(enLaAccion).includes('copy-claims'));
  assert.ok(campaignProblems(normalizeCampaign(approved(beer, { copy: { ...beer.copy, cta: 'Llevala a 2 mil' } }))).includes('copy-claims'));
  // El rótulo admite una marca con número, no un precio.
  for (const eyebrow of ['Ahora 2500', 'Lata 1.999', '2500 la lata', 'Desde 900']) {
    const enElRotulo = normalizeCampaign(approved(beer, { copy: { ...beer.copy, eyebrow } }));
    assert.ok(campaignProblems(enElRotulo).includes('copy-claims'), `el rótulo «${eyebrow}» pasó como marca`);
  }
});

test('el filtro no se come texto editorial legítimo, ni una marca con número', () => {
  const beer = byId('heineken-beer-pour');
  const frases = [
    'Bien fría, recién servida',
    'Fría y lista para llevar',
    'La de siempre, para la mesa',
    'Con mucho hielo',
    'Para la mesa de hoy',
    'Interesante para el asado',
    'Pesada de sabor',
    // Vecinas de una palabra prohibida que no dicen nada de plata ni de stock.
    'Para regalar',
    'Regalate un rato',
    'A mitad de semana',
    'Queda bien con todo',
    'Una botella preciosa',
    'Solo por gusto',
    'De peso',
    'Para antes de cenar',
    'Antes del asado',
    'Para llevar a la mesa',
  ];
  for (const headline of frases) {
    const campaign = normalizeCampaign(approved(beer, { copy: { ...beer.copy, headline } }));
    assert.deepEqual(campaignProblems(campaign), [], `«${headline}» se rechazó sin motivo`);
  }
  // El rótulo es la marca: «7UP» o «Cerveza 1890» no son un precio.
  for (const eyebrow of ['Imperial 1890', 'Fernet 1882', '7UP']) {
    const marcaConNumero = normalizeCampaign(approved(beer, { copy: { ...beer.copy, eyebrow } }));
    assert.deepEqual(campaignProblems(marcaConNumero), [], `la marca «${eyebrow}» se rechazó`);
  }
  // Cada texto se mira por separado: el número de la marca no se pega a la
  // primera palabra del título («1882 menos», «12 mil»).
  for (const copy of [
    { eyebrow: 'Fernet 1882', headline: 'Menos hielo, más sabor' },
    { eyebrow: 'Chivas 12', headline: 'Mil razones para brindar' },
  ]) {
    const pegados = normalizeCampaign(approved(beer, { copy: { ...beer.copy, ...copy } }));
    assert.deepEqual(campaignProblems(pegados), [], `«${copy.eyebrow}» + «${copy.headline}» se rechazó por la costura`);
  }
});

test('una cifra en la pieza sólo puede venir del producto: ni precio ni cantidad escritos a mano', () => {
  const beer = byId('heineken-beer-pour');
  const pick = (copy, products = catalog) => selectCampaigns({
    campaigns: [approved(beer, { target: { ...beer.target, identity: undefined }, copy: { ...beer.copy, ...copy } })], products, isOrderable: everythingSells,
  })['home-hero'];
  assert.ok(pick({}), 'la pieza sin cifras dejó de mostrarse');
  // Por la forma, «Lata 2500» y «Fernet 1882» son lo mismo. Con el producto a
  // la vista no: Heineken no tiene ningún 2500 en el nombre.
  for (const copy of [
    { eyebrow: 'Lata 2500' },
    { eyebrow: 'Hoy: 2500' },
    { eyebrow: 'c/u 2500' },
    { eyebrow: 'Imperial 1890' },
    { headline: 'A 99' },
    { cta: 'Pedila a 99' },
  ]) {
    assert.equal(pick(copy), null, `${JSON.stringify(copy)} mostró una cifra que el producto no tiene`);
  }
  // Y la cifra que SÍ es del producto se puede escribir en el rótulo.
  const conNumero = catalog.map((product) => (product.sku === 'heineken-710ml' ? { ...product, name: 'Fernet 1882', brand: '1882' } : product));
  assert.ok(pick({ eyebrow: 'Fernet 1882' }, conNumero), 'la marca con número de su propio producto se rechazó');
});

test('sin título o sin acción no hay pieza; un preset desconocido tampoco', () => {
  const beer = byId('heineken-beer-pour');
  assert.ok(campaignProblems(normalizeCampaign(approved(beer, { copy: { ...beer.copy, headline: '' } }))).includes('copy-missing'));
  assert.ok(campaignProblems(normalizeCampaign(approved(beer, { copy: { ...beer.copy, cta: '' } }))).includes('copy-missing'));
  assert.ok(campaignProblems(normalizeCampaign(approved(beer, { creative: { ...beer.creative, preset: 'fireworks' } }))).includes('unknown-preset'));
  assert.ok(campaignProblems(normalizeCampaign(approved(beer, { placements: ['popup'] }))).includes('no-placement'));
  assert.ok(campaignProblems(normalizeCampaign(approved(beer, { type: 'promotion' }))).includes('unsupported-type'));
  assert.equal(normalizeCampaign(null), null);
  assert.equal(normalizeCampaign({ id: 'con espacios y <tags>' }), null);
});

// ─── Dónde puede aparecer ─────────────────────────────────────────────────────

test('una por superficie, por prioridad, y la misma no ocupa dos lugares de la home', () => {
  const selected = selectCampaigns({ campaigns: allApproved(), products: catalog, isOrderable: everythingSells, catalog: wideCatalog });
  assert.equal(selected['home-hero'].campaign.id, 'heineken-beer-pour');
  assert.equal(selected['home-inline'].campaign.id, 'red-bull-cold-can');
  assert.notEqual(selected['home-hero'].campaign.id, selected['home-inline'].campaign.id);
  for (const placement of Object.keys(selected)) assert.ok(CAMPAIGN_PLACEMENTS.includes(placement));
});

test('el alcohol no sale de su rubro: ni en la franja de la home ni en «Todas»', () => {
  const soloAlcohol = allApproved().filter((campaign) => ['heineken-beer-pour', 'aperol-ice-reveal'].includes(campaign.id))
    .map((campaign) => ({ ...campaign, placements: ['home-hero', 'home-inline', 'catalog-inline'] }));
  const args = { campaigns: soloAlcohol, products: catalog, isOrderable: everythingSells };
  const enTodas = selectCampaigns({ ...args, catalog: wideCatalog });
  assert.equal(enTodas['home-inline'], null, 'una bebida alcohólica subió a la franja transversal de la home');
  assert.equal(enTodas['catalog-inline'], null, 'una bebida alcohólica apareció en la grilla de «Todas»');
  const enCervezas = selectCampaigns({ ...args, catalog: { ...wideCatalog, categoryId: 'cervezas' } });
  assert.equal(enCervezas['catalog-inline'].campaign.id, 'heineken-beer-pour');
  const enGaseosas = selectCampaigns({ ...args, catalog: { ...wideCatalog, categoryId: 'gaseosas' } });
  assert.equal(enGaseosas['catalog-inline'], null, 'una cerveza apareció en la góndola de gaseosas');
});

test('el rubro del alcohol lo dice el producto: la configuración no puede sacarlo de su góndola', () => {
  // Una campaña mal escrita —o escrita desde el panel— que nombra rubros que no
  // son el del producto. Antes alcanzaba con nombrarlos.
  const aperol = approved(byId('aperol-ice-reveal'), {
    placements: ['catalog-inline'],
    contexts: ['gaseosas', 'popular', 'favorites', 'all', 'aperitivos'],
  });
  const args = { campaigns: [aperol], products: catalog, isOrderable: everythingSells };
  for (const categoryId of ['gaseosas', 'popular', 'favorites', 'all', 'cervezas']) {
    const selected = selectCampaigns({ ...args, catalog: { ...wideCatalog, categoryId } });
    assert.equal(selected['catalog-inline'], null, `un aperitivo apareció en «${categoryId}»`);
  }
  const enSuRubro = selectCampaigns({ ...args, catalog: { ...wideCatalog, categoryId: 'aperitivos' } });
  assert.equal(enSuRubro['catalog-inline']?.campaign.id, 'aperol-ice-reveal');
  // Y si la campaña NO nombra el rubro del producto, tampoco va: `contexts`
  // sigue pudiendo acotar.
  const sinContexto = approved(byId('aperol-ice-reveal'), { placements: ['catalog-inline'], contexts: [] });
  assert.equal(
    selectCampaigns({ ...args, campaigns: [sinContexto], catalog: { ...wideCatalog, categoryId: 'aperitivos' } })['catalog-inline'],
    null,
  );
  // Un producto sin alcohol conserva la regla de siempre.
  const redBull = approved(byId('red-bull-cold-can'));
  const sinAlcohol = { campaigns: [redBull], products: catalog, isOrderable: everythingSells };
  assert.ok(selectCampaigns({ ...sinAlcohol, catalog: wideCatalog })['catalog-inline']);
  assert.ok(selectCampaigns({ ...sinAlcohol, catalog: { ...wideCatalog, categoryId: 'energizantes' } })['catalog-inline']);
});

test('la pieza de grilla no va en una búsqueda, con filtros ni en una lista corta', () => {
  const args = { campaigns: allApproved(), products: catalog, isOrderable: everythingSells };
  assert.ok(selectCampaigns({ ...args, catalog: wideCatalog })['catalog-inline']);
  assert.equal(selectCampaigns({ ...args, catalog: { ...wideCatalog, searching: true } })['catalog-inline'], null);
  assert.equal(selectCampaigns({ ...args, catalog: { ...wideCatalog, filtered: true } })['catalog-inline'], null);
  assert.equal(selectCampaigns({ ...args, catalog: { ...wideCatalog, listSize: 6 } })['catalog-inline'], null);
  assert.equal(selectCampaigns({ ...args, catalog: { ...wideCatalog, categoryId: 'favorites' } })['catalog-inline'], null);
  assert.equal(selectCampaigns({ ...args })['catalog-inline'], null, 'sin contexto de catálogo no hay pieza de grilla');
  assert.equal(CAMPAIGN_GRID_POSITION, 4, 'la pieza va tras la cuarta tarjeta');
});

test('lo que la persona ocultó no vuelve, y la superficie pasa a la siguiente campaña válida', () => {
  const args = { campaigns: allApproved(), products: catalog, isOrderable: everythingSells, catalog: wideCatalog };
  const sinHeineken = selectCampaigns({ ...args, dismissed: new Set(['heineken-beer-pour']) });
  assert.equal(sinHeineken['home-hero'].campaign.id, 'aperol-ice-reveal');
  const sinNinguna = selectCampaigns({ ...args, dismissed: new Set(CAMPAIGNS.map((campaign) => campaign.id)) });
  assert.deepEqual(sinNinguna, { 'home-hero': null, 'home-inline': null, 'catalog-inline': null });
});

test('ocultar un anuncio deja ese LUGAR sin anuncios: no entra el siguiente de la fila', () => {
  const args = { campaigns: allApproved(), products: catalog, isOrderable: everythingSells, catalog: wideCatalog };
  // Lo que hace la tienda al tocar «Ocultar este anuncio» en la banda de apertura.
  const oculto = selectCampaigns({
    ...args,
    dismissed: new Set(['heineken-beer-pour']),
    dismissedPlacements: new Set(['home-hero']),
  });
  assert.equal(oculto['home-hero'], null, 'en la banda apareció otra campaña en lugar de la que se ocultó');
  // Los otros lugares no se enteran: ahí nadie ocultó nada.
  assert.equal(oculto['home-inline']?.campaign.id, 'red-bull-cold-can');
  assert.ok(oculto['catalog-inline']);
  const todos = selectCampaigns({ ...args, dismissedPlacements: new Set(CAMPAIGN_PLACEMENTS) });
  assert.deepEqual(todos, { 'home-hero': null, 'home-inline': null, 'catalog-inline': null });
});

// ─── 3 · El marcado ───────────────────────────────────────────────────────────

const piece = (id, placement, view = {}) => {
  const campaign = normalizeCampaign(approved(byId(id)));
  return campaignMarkup({ campaign }, placement, { productId: 'p-1', title: 'Heineken Lager', line: '710 ml · Lata', ...view });
};

test('el marcado es función pura de sus datos: mismo dato, mismo HTML', () => {
  assert.equal(piece('heineken-beer-pour', 'home-hero'), piece('heineken-beer-pour', 'home-hero'));
  assert.notEqual(piece('heineken-beer-pour', 'home-hero'), piece('heineken-beer-pour', 'home-inline'));
});

test('la pieza es UN botón que lleva a la ficha, con la escena fuera del árbol accesible', () => {
  const html = piece('heineken-beer-pour', 'home-hero');
  assert.match(html, /<button class="cmp-hit" type="button" data-product-detail="p-1" data-campaign-cta aria-label="Bien fría, recién servida\. Heineken Lager · 710 ml · Lata\. Ver Heineken">/);
  assert.match(html, /<span class="cmp-stage" aria-hidden="true">/);
  assert.match(html, /data-catalog-key="campaign:home-hero:heineken-beer-pour"/, 'sin clave estable el catálogo reemplazaría el nodo en cada render');
  assert.match(html, /data-campaign-dismiss="heineken-beer-pour" aria-label="Ocultar este anuncio"/);
  assert.match(html, /aria-label="Anuncio: Heineken"/);
  assert.doesNotMatch(html, /<img/, 'la escena no pide ninguna imagen: no puede fallar por la red');
  assert.doesNotMatch(html, /<(script|iframe|video|audio|canvas)/i);
});

test('el subtítulo sale del producto real, no de la campaña', () => {
  const html = piece('red-bull-cold-can', 'home-inline', { title: 'Red Bull Energy Drink', line: '355 ml · Lata' });
  // Cada dato de la presentación viaja entero y el «·» va con el dato que
  // sigue: el renglón no puede partir «355» de «ml» ni terminar en «·».
  assert.match(html, /<span class="cmp-sub">Red Bull Energy Drink <span class="cmp-seg">· 355 ml<\/span> <span class="cmp-seg">· Lata<\/span><\/span>/);
  const sub = /<span class="cmp-sub">([\s\S]*?)<\/span>\s*<span class="cmp-buy">/.exec(html)[1];
  assert.equal(sub.replace(/<[^>]+>/g, ''), 'Red Bull Energy Drink · 355 ml · Lata', 'el texto que se lee es el de siempre');
  assert.equal(Object.hasOwn(byId('red-bull-cold-can').copy, 'subheadline'), false);
});

// ─── El precio y la marca: del producto, nunca de la campaña ──────────────────

test('el precio de la pieza es el que le pasa la tienda; la campaña no tiene de dónde sacar uno', () => {
  const priced = piece('heineken-beer-pour', 'home-hero', { price: { amount: '$\u00a02.500', previous: '', off: '', note: '' } });
  assert.match(priced, /<span class="cmp-price" data-campaign-price><strong class="cmp-price-now">\$\u00a02\.500<\/strong><\/span><span class="cmp-cta">/);
  assert.match(priced, /aria-label="Bien fría, recién servida\. Heineken Lager · 710 ml · Lata\. \$\u00a02\.500\. Ver Heineken"/);
  assert.match(priced, /class="cmp [^"]*cmp--priced/);
  // Sin precio en la vista no hay precio: la pieza no lo inventa ni lo arrastra.
  const unpriced = piece('heineken-beer-pour', 'home-hero');
  assert.doesNotMatch(unpriced, /cmp-price|cmp--priced|\$/);
  // Un precio pendiente no se anuncia: ni «$ 0» ni «Precio próximamente».
  for (const price of [{ pending: true, amount: 'Precio próximamente' }, { amount: '' }, { amount: '   ' }, null, 'gratis', 2500]) {
    assert.doesNotMatch(piece('heineken-beer-pour', 'home-hero', { price }), /cmp-price|Precio próximamente|gratis|2500/);
  }
});

test('el tachado y el porcentaje sólo existen con un precio anterior real y distinto', () => {
  const lowered = piece('red-bull-cold-can', 'home-inline', {
    price: { amount: '$\u00a02.000', previous: '$\u00a02.500', off: '20% OFF', note: 'Precio promocional' },
  });
  assert.match(lowered, /<strong class="cmp-price-now">\$\u00a02\.000<\/strong><s class="cmp-price-was">\$\u00a02\.500<\/s><em class="cmp-price-off">20% OFF<\/em>/);
  assert.match(lowered, /<small class="cmp-price-note">Precio promocional<\/small>/);
  assert.match(lowered, /\$\u00a02\.000, antes \$\u00a02\.500, Precio promocional\./, 'el nombre de la acción dice las dos cifras y la condición');
  // Un «antes» igual al de ahora no es un descuento, y un porcentaje sin
  // «antes» no tiene contra qué compararse: ninguno de los dos se dibuja.
  const same = piece('red-bull-cold-can', 'home-inline', { price: { amount: '$\u00a02.500', previous: '$\u00a02.500', off: '0% OFF' } });
  assert.doesNotMatch(same, /cmp-price-was|cmp-price-off|antes/);
  const orphan = piece('red-bull-cold-can', 'home-inline', { price: { amount: '$\u00a02.500', off: '30% OFF' } });
  assert.doesNotMatch(orphan, /cmp-price-off|30%/);
});

test('el rótulo es la marca del producto, no la que se escribió en la campaña', () => {
  const html = piece('heineken-beer-pour', 'home-hero', { brand: 'Heineken' });
  assert.match(html, /<small class="cmp-eyebrow">Heineken<\/small>/);
  // Si la campaña dijera otra marca, gana la del producto.
  const drift = normalizeCampaign(approved(byId('heineken-beer-pour'), { copy: { ...byId('heineken-beer-pour').copy, eyebrow: 'Otra Marca' } }));
  const corrected = campaignMarkup({ campaign: drift }, 'home-hero', { productId: 'p-1', brand: 'Heineken', title: 'Heineken Lager' });
  assert.match(corrected, /<small class="cmp-eyebrow">Heineken<\/small>/);
  assert.match(corrected, /aria-label="Anuncio: Heineken"/);
  assert.doesNotMatch(corrected, /Otra Marca/);
  // Sólo un producto que no declara marca usa el rótulo de la campaña.
  assert.match(piece('heineken-beer-pour', 'home-hero', { brand: '' }), /<small class="cmp-eyebrow">Heineken<\/small>/);
});

test('cada candidata nombra en su acción la marca de SU producto', () => {
  for (const campaign of CAMPAIGNS) {
    const { brand } = campaign.target.identity;
    assert.ok(brand, `${campaign.id} no declara la marca de su producto`);
    assert.ok(campaign.copy.cta.includes(brand), `${campaign.id}: la acción «${campaign.copy.cta}» no nombra ${brand}`);
    assert.equal(campaign.copy.eyebrow, brand, `${campaign.id}: el rótulo de respaldo no es la marca del producto`);
  }
});

test('un precio o una marca hostiles llegan como texto', () => {
  const html = piece('heineken-beer-pour', 'home-hero', {
    brand: '<b>B</b>',
    price: { amount: '"><img src=x onerror=1>', previous: '<s>1</s>', off: '<script>', note: '<i>n</i>' },
  });
  assert.doesNotMatch(html, /<img|<script|<b>|<i>n/);
  assert.match(html, /&lt;b&gt;B&lt;\/b&gt;/);
  assert.match(html, /&quot;&gt;&lt;img src=x onerror=1&gt;/);
  assert.equal((html.match(/<button/g) || []).length, 2, 'el precio abrió o cerró un botón de más');
});

test('la foto del envase se pide en el acto en la banda de apertura, y perezosa en las franjas', () => {
  const lab = JSON.parse(read('scripts/campaign-lab/approved-products.json'));
  const product = lab.find((entry) => entry.sku === 'heineken-710ml');
  const campaign = normalizeCampaign(approved(byId('heineken-beer-pour')));
  const hero = campaignMarkup({ campaign, product }, 'home-hero', { productId: product.id, title: product.name });
  const grid = campaignMarkup({ campaign, product }, 'catalog-inline', { productId: product.id, title: product.name });
  assert.match(hero, /<img class="cmp-packshot"[^>]* loading="eager"/);
  assert.match(grid, /<img class="cmp-packshot"[^>]* loading="lazy"/);
});

test('un producto con alcohol lleva la leyenda legal; uno sin alcohol, no', () => {
  assert.equal(ALCOHOL_LEGAL_NOTICE, 'Beber con moderación. Prohibida su venta a menores de 18 años.');
  const conAlcohol = piece('heineken-beer-pour', 'home-hero', { alcoholic: true });
  assert.match(conAlcohol, /<p class="cmp-legal">Beber con moderación\. Prohibida su venta a menores de 18 años\.<\/p>/);
  assert.match(conAlcohol, /cmp--legal/);
  const sinAlcohol = piece('red-bull-cold-can', 'home-inline', { alcoholic: false });
  assert.doesNotMatch(sinAlcohol, /cmp-legal/);
  // La leyenda va FUERA del botón: es texto que se lee, no parte del nombre de la acción.
  assert.ok(conAlcohol.indexOf('cmp-legal') > conAlcohol.indexOf('</button>'));
});

test('ningún texto de la campaña ni del producto puede inyectar marcado o estilos', () => {
  const hostile = normalizeCampaign(approved(byId('heineken-beer-pour'), {
    copy: { eyebrow: '<b>x</b>', headline: '"><img src=x onerror=alert(1)>', cta: "Ver '</button>" },
    creative: { preset: 'beer_pour', vessel: 'rocket', tint: 'red;background:url(//evil)', accent: '#12345' },
  }));
  const html = campaignMarkup({ campaign: hostile }, 'home-hero', { productId: '"><script>', title: '<i>T</i>', line: '"x"' });
  assert.doesNotMatch(html, /<img|<script|<b>/);
  // Dentro de un atributo, la comilla hostil llega escapada: no puede cerrarlo.
  assert.match(html, /aria-label="&quot;&gt;&lt;img src=x onerror=alert\(1\)&gt;\./);
  // Lo hostil llega como TEXTO: se lee, no se ejecuta.
  assert.match(html, /&lt;b&gt;x&lt;\/b&gt;/);
  assert.match(html, /&lt;i&gt;T&lt;\/i&gt;/);
  assert.match(html, /data-product-detail="&quot;&gt;&lt;script&gt;"/);
  assert.equal((html.match(/<button/g) || []).length, 2, 'el texto abrió o cerró un botón de más');
  assert.match(html, /--cmp-tint:#3d4450;/, 'un color inválido tiene que caer en el de respaldo');
  assert.match(html, /--cmp-accent:#e4b45f;/);
  // Ninguna URL: lo único que la pieza referencia son los degradados de su
  // propio dibujo, por fragmento local y con un id que arma el motor.
  assert.doesNotMatch(html, /evil|url\((?!#cmp-[a-z0-9-]+\))/);
  assert.match(html, /cmp-actor--can/, 'un envase desconocido cae en el de respaldo');
});

test('el color del líquido se valida como los demás, y sin dato vale el de respaldo', () => {
  const beer = byId('heineken-beer-pour');
  const hostile = normalizeCampaign(approved(beer, { creative: { ...beer.creative, preset: 'glass_fill', liquid: 'orange;background:url(//evil)' } }));
  assert.equal(hostile.creative.liquid, '#f0a81d');
  const naranja = normalizeCampaign(approved(beer, { creative: { ...beer.creative, preset: 'glass_fill', liquid: '#F08A1C' } }));
  assert.equal(naranja.creative.liquid, '#f08a1c');
  const html = campaignMarkup({ campaign: naranja }, 'home-inline', { productId: 'p', title: 'T', line: 'L' });
  assert.match(html, /--cmp-liquid:#f08a1c;--cmp-liquid-deep:#[0-9a-f]{6};--cmp-liquid-lite:#[0-9a-f]{6};/);
});

const stageOf = (html) => {
  const opening = '<span class="cmp-stage" aria-hidden="true">';
  return html.slice(html.indexOf(opening) + opening.length, html.indexOf('<span class="cmp-copy">'));
};

test('las seis escenas tienen cupo fijo de nodos y ninguna trae texto', () => {
  const beer = byId('heineken-beer-pour');
  for (const preset of Object.keys(CAMPAIGN_PRESETS)) {
    for (const vessel of ['can', 'bottle']) {
      const normalized = normalizeCampaign(approved(beer, { creative: { ...beer.creative, preset, vessel } }));
      const html = campaignMarkup({ campaign: normalized }, 'home-inline', { productId: 'p', title: 'T', line: 'L' });
      const stage = stageOf(html);
      // Todo lo que dibuja o agrupa, incluidos los degradados del envase.
      const nodes = (stage.match(/<(span|i|svg|path|rect|circle|defs|linearGradient|stop)\b/g) || []).length;
      assert.ok(nodes > 5 && nodes <= 56, `${preset}/${vessel}: ${nodes} nodos en la escena`);
      // Lo que el navegador tiene que componer: sin los degradados, que son datos del dibujo.
      const painted = (stage.match(/<(span|i|svg|path|rect|circle)\b/g) || []).length;
      assert.ok(painted <= 40, `${preset}/${vessel}: ${painted} nodos pintados`);
      assert.equal(stage.replace(/<[^>]+>/g, '').trim(), '', `${preset}/${vessel}: la escena es decorativa y no puede llevar texto`);
    }
  }
});

test('la escena vive dentro de su caja contenedora y cada pieza trae sus propios degradados', () => {
  const html = piece('heineken-beer-pour', 'home-hero');
  assert.match(html, /<span class="cmp-scene"><span class="cmp-stage" aria-hidden="true">/);
  // La misma campaña en dos lugares: una de las dos vistas siempre está oculta,
  // y un degradado referenciado dentro de un subárbol oculto no pinta.
  const ids = (markup) => [...markup.matchAll(/\bid="([^"]+)"/g)].map((match) => match[1]);
  const hero = ids(html);
  const grid = ids(piece('heineken-beer-pour', 'catalog-inline'));
  assert.ok(hero.length >= 2, 'el envase no declaró sus degradados');
  assert.equal(new Set(hero).size, hero.length, 'hay un id repetido dentro de la pieza');
  assert.equal(hero.filter((id) => grid.includes(id)).length, 0, 'dos piezas comparten un id de degradado');
  for (const id of hero) {
    assert.match(id, /^cmp-[a-z0-9-]+$/);
    assert.ok(html.includes(`url(#${id})`), `el degradado ${id} no se usa`);
  }
  for (const reference of html.matchAll(/url\(#([^)]+)\)/g)) {
    assert.ok(hero.includes(reference[1]), `se referencia un degradado que la pieza no declara: ${reference[1]}`);
  }
});

// ─── La hoja y el módulo de movimiento, leídos como contrato ──────────────────

// Sin comentarios: la hoja EXPLICA lo que evita, y esas palabras no son reglas.
const CSS = read('styles/campaigns.css').replace(/\/\*[\s\S]*?\*\//g, '');
const MOTION = read('js/campaigns/campaign-motion.js');

test('las animaciones sólo tocan transform y opacity', () => {
  const frames = [...CSS.matchAll(/@keyframes\s+([\w-]+)\s*\{([\s\S]*?)\n\}/g)];
  assert.ok(frames.length >= 20, 'faltan animaciones');
  for (const [, name, body] of frames) {
    const properties = new Set([...body.matchAll(/(?:^|[;{]\s*)([a-z-]+)\s*:/g)].map((match) => match[1]));
    for (const property of properties) {
      assert.ok(
        ['transform', 'opacity', 'animation-timing-function'].includes(property),
        `@keyframes ${name} anima «${property}»: eso vuelve a maquetar o a pintar`,
      );
    }
  }
  assert.doesNotMatch(CSS, /filter\s*:\s*blur|backdrop-filter/, 'un desenfoque animado es de lo más caro que hay');
});

test('ninguna animación corre sin que el módulo la encienda', () => {
  const declarations = [...CSS.matchAll(/([^{}]+)\{[^{}]*\banimation\s*:[^;]+;/g)].map((match) => match[1].trim());
  assert.ok(declarations.length > 10);
  for (const selector of declarations) {
    const allowed = selector.includes('[data-motion-campaign="on"]') || /^\.cmp \*/.test(selector);
    assert.ok(allowed, `«${selector.split('\n').pop()}» anima sin estar encendida`);
  }
});

test('movimiento reducido apaga todo y fuera de pantalla todo se pausa', () => {
  assert.match(CSS, /@media \(prefers-reduced-motion: reduce\) \{\s*\.cmp \*,\s*\.cmp \*::before,\s*\.cmp \*::after \{\s*animation: none !important;/);
  assert.match(CSS, /\[data-motion-campaign-live="false"\] \*[\s\S]*?animation-play-state: paused !important;/);
});

test('el módulo de movimiento no usa temporizadores ni crea nodos', () => {
  const code = MOTION.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '');
  assert.doesNotMatch(code, /setTimeout|setInterval|requestAnimationFrame/, 'la escena avanza sola en el compositor');
  assert.doesNotMatch(code, /createElement|innerHTML|insertAdjacent|appendChild|\.style\./, 'no escribe nodos ni estilos en línea');
  assert.match(code, /IntersectionObserver/);
  const added = [...code.matchAll(/addEventListener\??\.?\('([a-z]+)'/g)].map((match) => match[1]).sort();
  const removed = [...code.matchAll(/removeEventListener\??\.?\('([a-z]+)'/g)].map((match) => match[1]).sort();
  assert.deepEqual(added, removed, 'todo oyente que se agrega se tiene que quitar al destruir');
  assert.deepEqual(added, ['change', 'error', 'visibilitychange']);
});

test('los atributos que escribe usan el prefijo que el parcheo estable conserva', () => {
  const stable = read('js/core/stable-catalog-dom.js');
  assert.match(stable, /attribute\.name\.startsWith\('data-motion-'\)/);
  // Sólo lo que ESCRIBE en la pieza; leer `body.dataset.motionLite` no cuenta.
  const written = [
    ...[...MOTION.matchAll(/root\.dataset\.(\w+)\s*=[^=]/g)].map((match) => match[1]),
    ...[...MOTION.matchAll(/delete root\.dataset\.(\w+)/g)].map((match) => match[1]),
    ...[...MOTION.matchAll(/write\(root, '(\w+)'/g)].map((match) => match[1]),
  ];
  assert.ok(written.length >= 3);
  for (const name of written) assert.match(name, /^motionCampaign/, `dataset.${name} no sobreviviría a un render`);
});

test('la tienda importa las campañas y el worker las precachea', () => {
  const worker = read('sw.js');
  for (const module of ['campaign-config', 'campaign-engine', 'campaign-motion', 'presets/shared', 'presets/beer-pour', 'presets/cold-can', 'presets/product-drop', 'presets/ice-reveal', 'presets/spotlight-product', 'presets/glass-fill']) {
    assert.ok(worker.includes(`'./js/campaigns/${module}.js'`), `${module} no está en el precache`);
  }
  assert.match(worker, /'\.\/styles\/campaigns\.css\?v=\d+'/);
  assert.match(read('styles.css'), /@import url\("\.\/styles\/campaigns\.css\?v=\d+"\);/);
  assert.match(read('index.html'), /<div class="home-campaign-slot" data-home-campaign hidden><\/div>/);
});
