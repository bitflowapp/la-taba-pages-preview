/*
 * beer_pour — el envase entra, se inclina, sirve, el vaso se llena y hace
 * espuma; el envase vuelve a su lugar y quedan subiendo unas pocas burbujas.
 *
 * No es una simulación: son capas que se trasladan. El "llenado" es una ventana
 * que sube mientras su contenido baja lo mismo, así el líquido parece quieto y
 * lo único que se mueve es la superficie. La espuma viaja pegada a ese borde.
 * Todo es `transform` y `opacity`: nada vuelve a maquetar ni a pintar.
 */
import { actorMarkup, repeat } from './shared.js';

const GLASS_ART = `<svg class="cmp-glass-art" viewBox="0 0 64 112" preserveAspectRatio="none" focusable="false">
    <path class="cmp-g-base" d="M9.6 99H54.4L55 104Q54.5 110 48 110H16Q9.5 110 9 104Z"/>
    <path class="cmp-g-wall" d="M2 1L9 104Q9.5 110 16 110H48Q54.5 110 55 104L62 1"/>
    <path class="cmp-g-shine" d="M8.5 9L13.3 89"/>
    <path class="cmp-g-shine cmp-g-shine--soft" d="M54.5 14L50.8 70"/>
  </svg>`;

export const beerPour = Object.freeze({
  id: 'beer_pour',
  // Segundos de la entrada completa. El CSS la reparte en porcentajes.
  duration: 5.6,
  stage(creative) {
    return `
      <span class="cmp-glow"></span>
      <span class="cmp-table"></span>
      <span class="cmp-stream"><i></i></span>
      <span class="cmp-glass">
        <span class="cmp-glass-in">
          <span class="cmp-fill"><span class="cmp-fill-in">${repeat('cmp-b', 7)}</span></span>
          <span class="cmp-foam"></span>
        </span>
        ${GLASS_ART}
        <span class="cmp-foam-cap"></span>
      </span>
      <span class="cmp-shadow"></span>
      ${actorMarkup(creative.vessel)}`;
  },
});
