// Laboratorio de campañas (QA). Ver el comentario de index.html.
import { campaignMarkup, normalizeCampaign } from '../../js/campaigns/campaign-engine.js';
import { initCampaignMotion } from '../../js/campaigns/campaign-motion.js';

const params = new URLSearchParams(location.search);

// Datos de DEMOSTRACIÓN. Los nombres y presentaciones son los del catálogo
// real; no hay precio, stock ni promoción en ninguna parte.
const DEMOS = [
  { preset: 'beer_pour', vessel: 'can', tint: '#0c7a35', accent: '#e2231a', eyebrow: 'Heineken', headline: 'Bien fría, recién servida', cta: 'Ver Heineken', title: 'Heineken Lager', line: '710 ml · Lata', alcoholic: true },
  { preset: 'cold_can', vessel: 'can', tint: '#1d3f97', accent: '#c8ccd4', eyebrow: 'Red Bull', headline: 'Fría y lista para llevar', cta: 'Ver Red Bull', title: 'Red Bull Energy Drink', line: '355 ml · Lata', alcoholic: false },
  { preset: 'product_drop', vessel: 'bottle', tint: '#3a140c', accent: '#e30613', eyebrow: 'Coca-Cola', headline: 'La de siempre, para la mesa', cta: 'Ver Coca-Cola', title: 'Coca-Cola', line: '2,25 L', alcoholic: false },
  { preset: 'ice_reveal', vessel: 'bottle', tint: '#f0641e', accent: '#1f5fbf', eyebrow: 'Aperol', headline: 'Con mucho hielo', cta: 'Ver Aperol', title: 'Aperol', line: '750 ml', alcoholic: true },
];

const FRAMES = [
  { placement: 'home-hero', width: 358, label: 'home-hero · teléfono' },
  { placement: 'home-inline', width: 358, label: 'home-inline · teléfono' },
  { placement: 'home-hero', width: 1020, label: 'home-hero · escritorio' },
];

function piece(demo, placement, vessel) {
  const campaign = normalizeCampaign({
    id: `lab-${demo.preset.replace(/_/g, '-')}-${vessel}`,
    enabled: true,
    approval: { status: 'APROBADA', reference: 'laboratorio QA' },
    placements: [placement],
    contexts: [],
    target: { skus: ['lab'] },
    creative: { preset: demo.preset, vessel, tint: demo.tint, accent: demo.accent },
    copy: { eyebrow: demo.eyebrow, headline: demo.headline, cta: demo.cta },
  });
  return campaignMarkup({ campaign }, placement, { productId: 'lab', title: demo.title, line: demo.line, alcoholic: demo.alcoholic });
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
  const vessels = single ? [params.get('vessel') || demo.vessel] : [demo.vessel, demo.vessel === 'can' ? 'bottle' : 'can'];
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
