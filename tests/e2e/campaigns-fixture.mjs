/*
 * CAMPAÑAS DE QA PARA EL NAVEGADOR DE PRUEBA.
 *
 * Las campañas publicadas están aprobadas. Este fixture permite a Playwright
 * limitar el conjunto —o dejarlo vacío— sin agregar una bandera de producción
 * ni cambiar el paquete real. Es una ruta exclusivamente de prueba.
 */
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const SHIPPED = fileURLToPath(new URL('../../js/campaigns/campaign-config.js', import.meta.url));

/** `only`: ids de campaña a encender; sin lista, todas. */
export async function useQaCampaigns(page, { only = null } = {}) {
  await page.route('**/__shipped-campaign-config.js', (route) => route.fulfill({
    contentType: 'application/javascript', body: fs.readFileSync(SHIPPED, 'utf8'),
  }));
  await page.route('**/js/campaigns/campaign-config.js', (route) => route.fulfill({
    contentType: 'application/javascript',
    body: `
      import { CAMPAIGNS as shipped } from '/__shipped-campaign-config.js';
      const only = ${JSON.stringify(only)};
      export const CAMPAIGNS = Object.freeze(shipped
        .filter((campaign) => !only || only.includes(campaign.id))
        .map((campaign) => ({
          ...campaign,
          enabled: true,
          approval: { status: 'APROBADA', reference: 'prueba E2E — no es una aprobación comercial' },
        })));
    `,
  }));
}

export const HERO = '[data-home-hero-promo]';
export const INLINE = '[data-home-campaign]';

/** Lleva todas las animaciones de la pieza a su final: el cuadro de reposo. */
export function finishScene(page, selector) {
  return page.locator(selector).first().evaluate((root) => {
    for (const animation of root.getAnimations({ subtree: true })) {
      try { animation.finish(); } catch (_) { /* una animación infinita no termina; acá no hay */ }
    }
  });
}

/** Cuántas animaciones hay adentro de la pieza y en qué estado. */
export function sceneState(page, selector) {
  return page.locator(selector).first().evaluate((root) => {
    const animations = root.getAnimations({ subtree: true });
    return {
      state: root.dataset.motionCampaign || 'still',
      live: root.dataset.motionCampaignLive || '',
      total: animations.length,
      running: animations.filter((animation) => animation.playState === 'running').length,
      paused: animations.filter((animation) => animation.playState === 'paused').length,
    };
  });
}
