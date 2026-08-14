// ─────────────────────────────────────────────────────────────────────────────
// Growth engine · HARNESS DE PERSONAS (sólo debug local).
// -----------------------------------------------------------------------------
// Permite demostrar el motor sin fabricar navegación a mano:
//
//   Persona A — sin historial (cold start): la tienda de siempre.
//   Persona B — fan de la cerveza: navegó Cervezas, miró fichas, buscó
//               Heineken y agregó una lata.
//   Persona C — carrito de fernet: la señal de complemento (cola + hielo).
//
// Se activa ÚNICAMENTE con ?growthDebug=1 en la URL. Sin esa bandera este
// módulo no expone nada, no imprime nada y no registra nada: el harness no
// existe en el uso normal, ni en demo ni en producción.
//
// Uso en la consola del navegador:
//   TABA2_GROWTH.persona('A' | 'B' | 'C')
//   TABA2_GROWTH.explain('hero' | 'door' | 'catalog-inline')
//   TABA2_GROWTH.affinity()
//   TABA2_GROWTH.funnel()
//   TABA2_GROWTH.reset()
import { updateState } from '../state.js';
import {
  getGrowthAffinity,
  resetGrowthEngineForTests,
  seedGrowthIntentForDemo,
} from './engine.js';
import {
  growthCatalogInlineSelection,
  growthDoorSelection,
  growthHeroSelection,
} from './placements.js';
import { explainRanking } from './ranking.js';
import { getGrowthEvents, getGrowthFunnel } from './analytics.js';

const PERSONAS = Object.freeze({
  A: Object.freeze([]),
  B: Object.freeze([
    { type: 'category_view', categoryId: 'cervezas' },
    { type: 'product_view', categoryId: 'cervezas', brand: 'heineken', productId: 'heineken-original-lata-473ml' },
    { type: 'product_view', categoryId: 'cervezas', brand: 'imperial', productId: 'imperial-golden-lata-473ml' },
    { type: 'search_match', categoryId: 'cervezas', brand: 'heineken' },
    { type: 'add_to_cart', categoryId: 'cervezas', brand: 'heineken', productId: 'heineken-original-lata-473ml' },
  ]),
  C: Object.freeze([
    { type: 'category_view', categoryId: 'fernet' },
    { type: 'product_view', categoryId: 'fernet', brand: 'branca' },
    { type: 'add_to_cart', categoryId: 'fernet', brand: 'branca' },
  ]),
});

function repaint() {
  // Un commit vacío notifica a los suscriptores y la vidriera se recalcula
  // con la intención recién sembrada (nueva época incluida vía señales).
  updateState(() => {});
}

function selectionTable(placement) {
  if (placement === 'hero') {
    const hero = growthHeroSelection();
    return explainRanking(hero ? [hero] : []);
  }
  if (placement === 'door') return explainRanking(growthDoorSelection([], undefined, 4));
  if (placement === 'catalog-inline') {
    const inline = growthCatalogInlineSelection();
    return explainRanking(inline ? [inline] : []);
  }
  return [];
}

export function isGrowthDebugEnabled(search = safeSearch()) {
  try {
    return new URLSearchParams(String(search || '')).get('growthDebug') === '1';
  } catch (_) {
    return false;
  }
}

function safeSearch() {
  try {
    return globalThis.location?.search ?? '';
  } catch (_) {
    return '';
  }
}

export function initGrowthDemoHarness({ windowRef = globalThis.window } = {}) {
  if (!windowRef || !isGrowthDebugEnabled()) return false;
  windowRef.TABA2_GROWTH = {
    persona(name) {
      const seeds = PERSONAS[String(name || '').toUpperCase()];
      if (!seeds) return `Persona desconocida. Opciones: ${Object.keys(PERSONAS).join(', ')}`;
      resetGrowthEngineForTests({ clearStorage: true });
      seedGrowthIntentForDemo(seeds);
      repaint();
      return `Persona ${String(name).toUpperCase()} aplicada (${seeds.length} señales).`;
    },
    explain: (placement = 'hero') => selectionTable(placement),
    affinity: () => getGrowthAffinity(),
    funnel: () => getGrowthFunnel(),
    events: () => getGrowthEvents(),
    reset() {
      resetGrowthEngineForTests({ clearStorage: true });
      repaint();
      return 'Motor reiniciado: cold start.';
    },
  };
  return true;
}
