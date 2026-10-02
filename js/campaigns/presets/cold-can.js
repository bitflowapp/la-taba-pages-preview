/*
 * cold_can — el envase llega, se acomoda con una rotación mínima y se cubre de
 * condensación; unas gotas bajan por la superficie, un brillo la recorre y
 * alrededor flotan partículas frías.
 *
 * La escarcha, las gotas y el brillo viajan ADENTRO del envase, recortados por
 * su silueta, así que se mueven con él sin que nadie los sincronice.
 */
import { actorMarkup, repeat } from './shared.js';

export const coldCan = Object.freeze({
  id: 'cold_can',
  duration: 4.2,
  stage(creative, uid) {
    const surface = `<i class="cmp-frost"></i>${repeat('cmp-drop', 3)}<i class="cmp-shine"></i>`;
    return `
      <span class="cmp-glow"></span>
      <span class="cmp-table"></span>
      ${repeat('cmp-snow', 6)}
      ${repeat('cmp-mist', 2)}
      <span class="cmp-shadow"></span>
      ${actorMarkup(creative.vessel, surface, uid)}`;
  },
});
