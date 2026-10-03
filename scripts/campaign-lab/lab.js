// Laboratorio de campañas (QA). Ver el comentario de index.html.
import { campaignMarkup, normalizeCampaign } from '../../js/campaigns/campaign-engine.js';
import { initCampaignMotion } from '../../js/campaigns/campaign-motion.js';

import { cardTitle, cardPresentationLine } from '../../js/core/product-presentation.js';
const products = await fetch('./approved-products.json').then(response => response.json());
const params = new URLSearchParams(location.search);

// Escenas editoriales de QA. Identidad, nombre, volumen, marca y foto salen
// exclusivamente de approved-products.json. No contiene precios ni stock.
const DEMOS = [
  { preset: 'beer_pour', vessel: 'can', tint: '#0c7a35', accent: '#e2231a', headline: 'Bien fría, recién servida' },
  { preset: 'cold_can', vessel: 'can', tint: '#1d3f97', accent: '#c8ccd4', headline: 'Fría y lista para llevar' },
  { preset: 'product_drop', vessel: 'can', tint: '#3a140c', accent: '#e30613', headline: 'Mango Loco, bien frío' },
  { preset: 'ice_reveal', vessel: 'bottle', tint: '#f0641e', accent: '#1f5fbf', headline: 'Con mucho hielo' },
  { preset: 'spotlight_product', vessel: 'bottle', tint: '#3b0d16', accent: '#c9a25a', headline: 'Para la mesa de hoy' },
  { preset: 'glass_fill', vessel: 'bottle', tint: '#f47b20', accent: '#1f3f97', liquid: '#f08a1c', headline: 'Bien fría, con hielo' },
];

const FRAMES = [
  { placement: 'home-hero', width: 358, label: 'home-hero · teléfono' },
  { placement: 'home-inline', width: 358, label: 'home-inline · teléfono' },
  { placement: 'home-hero', width: 1020, label: 'home-hero · escritorio' },
];

function piece(demo, placement, vessel) {
  const skus = { beer_pour: 'heineken-710ml', cold_can: 'red-bull-energy-drink-355ml', product_drop: 'monster-mango-loco-473ml', ice_reveal: 'aperol-750ml', spotlight_product: 'coca-cola-original-2250ml-local', glass_fill: 'fanta-naranja-2250ml' };
  const product = products.find(entry => entry.sku === skus[demo.preset]);
  const campaign = normalizeCampaign({
    id: `lab-${demo.preset.replace(/_/g, '-')}-${vessel}`,
    enabled: true,
    approval: { status: 'APROBADA', reference: 'laboratorio QA' },
    placements: [placement],
    contexts: [],
    target: { productId: product.id, skus: [product.sku], identity: { brand: product.brand, variant: product.variant, volumeMl: product.capacityValue, container: demo.vessel } },
    creative: { preset: demo.preset, vessel, tint: demo.tint, accent: demo.accent, liquid: demo.liquid },
    copy: { eyebrow: product.brand, headline: demo.headline, cta: 'Ver ' + product.brand },
  });
  return campaignMarkup({ campaign, product }, placement, { productId: product.id, title: cardTitle(product), line: cardPresentationLine(product), alcoholic: product.alcoholic });
}

const grid = document.querySelector('[data-lab-grid]');
const only = params.get('only');
const single = Boolean(only);
if (single) document.body.classList.add('lab-single');
// `&zoom=2` agranda la pieza sin cambiar el ancho de la ventana: sirve para
// grabar la versión de teléfono a buen tamaño sin que entren las reglas de
// escritorio.
const zoom = Number(params.get('zoom'));
if (zoom > 0 && zoom <= 4) document.body.style.zoom = String(zoom);

const cells = [];
for (const demo of DEMOS) {
  if (only && demo.preset !== only) continue;
  const vessels = single ? [params.get('vessel') || demo.vessel] : [demo.vessel];
  const frames = single
    ? [{ placement: params.get('placement') || 'home-hero', width: Number(params.get('w')) || 358, label: '' }]
    : FRAMES;
  for (const vessel of vessels) {
    for (const frame of frames) {
      cells.push(`<div class="lab-cell"><small>${demo.preset} · ${vessel} · ${frame.label}</small>
        <div class="lab-frame" style="width:${frame.width}px">${piece(demo, frame.placement, vessel)}</div></div>`);
    }
  }
}
grid.innerHTML = cells.join('');

const status = document.querySelector('[data-lab-status]');
const roots = () => [...document.querySelectorAll('[data-campaign]')];
let motion = null;

function seek(seconds) {
  for (const animation of document.getAnimations()) {
    animation.pause();
    animation.currentTime = seconds * 1000;
  }
}

function play() {
  motion?.destroy();
  motion = initCampaignMotion(document, window);
  window.TABA2_CAMPAIGNS = motion;
}

function replay() {
  roots().forEach((root) => { delete root.dataset.motionCampaign; delete root.dataset.motionCampaignLive; });
  void document.body.offsetWidth;
  play();
}

window.LAB = {
  seek,
  replay,
  // Enciende todas las escenas sin esperar al observador: para congelar un cuadro.
  force() {
    roots().forEach((root) => { root.dataset.motionCampaign = 'on'; root.dataset.motionCampaignLive = 'true'; });
  },
};

document.querySelector('[data-lab-replay]').addEventListener('click', replay);
document.querySelector('[data-lab-pause]').addEventListener('click', () => {
  const running = document.getAnimations().some((animation) => animation.playState === 'running');
  document.getAnimations().forEach((animation) => (running ? animation.pause() : animation.play()));
});
document.querySelector('[data-lab-static]').addEventListener('click', () => {
  motion?.destroy();
  motion = null;
});

if (params.get('static') !== '1') {
  if (params.has('t')) {
    window.LAB.force();
    requestAnimationFrame(() => seek(Number(params.get('t')) || 0));
  } else {
    play();
  }
}

setInterval(() => {
  if (!status) return;
  const d = motion?.getDiagnostics?.();
  status.textContent = d ? `piezas ${d.campaigns} · a la vista ${d.visible} · corriendo ${d.live} · entradas ${d.plays}` : 'cuadro de respaldo (sin animación)';
}, 500);
