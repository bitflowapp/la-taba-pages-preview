/*
 * beer_pour — el envase entra, se inclina, sirve, el vaso se llena y hace
 * espuma; el envase vuelve a su lugar y quedan subiendo unas pocas burbujas.
 *
 * No es una simulación: son capas que se trasladan. El "llenado" es una ventana
 * que sube mientras su contenido baja lo mismo, así el líquido parece quieto y
 * lo único que se mueve es la superficie. La espuma viaja pegada a ese borde.
 * Todo es `transform` y `opacity`: nada vuelve a maquetar ni a pintar.
 *
 * Lo que la hace leer como una cerveza FRÍA y no como un diagrama está en la
 * hoja de estilos y es todo estático: el envase transpira (`cmp-frost`), el
 * líquido tiene la luz adentro, el chorro corre y el vaso empaña al llenarse.
 */
import { actorMarkup, glassMarkup, repeat } from './shared.js';

export const beerPour = Object.freeze({
  id: 'beer_pour',
  // Segundos de la entrada completa. El CSS la reparte en porcentajes.
  duration: 5.6,
  stage(creative, uid) {
    return `
      <span class="cmp-glow"></span>
      <span class="cmp-table"></span>
      <span class="cmp-stream"><i></i></span>
      ${glassMarkup(
        `<span class="cmp-fill"><span class="cmp-fill-in">${repeat('cmp-b', 7)}</span></span>
          <span class="cmp-foam"></span>`,
        '<span class="cmp-foam-cap"></span>',
      )}
      <span class="cmp-shadow"></span>
      ${actorMarkup(creative.vessel, '<i class="cmp-frost"></i>', uid, creative.packshot)}`;
  },
});
