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

test('los cuatro presets existen y cada candidata usa uno', () => {
  assert.deepEqual(Object.keys(CAMPAIGN_PRESETS).sort(), ['beer_pour', 'cold_can', 'ice_reveal', 'product_drop']);
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
  assert.match(html, /<span class="cmp-sub">Red Bull Energy Drink · 355 ml · Lata<\/span>/);
  assert.equal(Object.hasOwn(byId('red-bull-cold-can').copy, 'subheadline'), false);
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
  assert.doesNotMatch(html, /evil|url\(/);
  assert.match(html, /cmp-actor--can/, 'un envase desconocido cae en el de respaldo');
});

test('las cuatro escenas tienen cupo fijo de nodos y ninguna trae texto', () => {
  for (const campaign of CAMPAIGNS) {
    const normalized = normalizeCampaign(approved(campaign));
    const html = campaignMarkup({ campaign: normalized }, 'home-inline', { productId: 'p', title: 'T', line: 'L' });
    const opening = '<span class="cmp-stage" aria-hidden="true">';
    const stage = html.slice(html.indexOf(opening) + opening.length, html.indexOf('<span class="cmp-copy">'));
    const nodes = (stage.match(/<(span|i|svg|path|rect|circle)\b/g) || []).length;
    assert.ok(nodes > 5 && nodes <= 40, `${campaign.id}: ${nodes} nodos en la escena`);
    assert.equal(stage.replace(/<[^>]+>/g, '').trim(), '', `${campaign.id}: la escena es decorativa y no puede llevar texto`);
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
  for (const module of ['campaign-config', 'campaign-engine', 'campaign-motion', 'presets/shared', 'presets/beer-pour', 'presets/cold-can', 'presets/product-drop', 'presets/ice-reveal']) {
    assert.ok(worker.includes(`'./js/campaigns/${module}.js'`), `${module} no está en el precache`);
  }
  assert.match(worker, /'\.\/styles\/campaigns\.css\?v=\d+'/);
  assert.match(read('styles.css'), /@import url\("\.\/styles\/campaigns\.css\?v=\d+"\);/);
  assert.match(read('index.html'), /<div class="home-campaign-slot" data-home-campaign hidden><\/div>/);
});
