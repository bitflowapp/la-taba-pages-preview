/*
 * ice_reveal — una niebla fría se abre y deja ver el producto entre cubos de
 * hielo; los cubos se acomodan, la superficie queda escarchada y sube un vapor
 * tenue.
 *
 * Los cubos son cajas con degradado: dos van DETRÁS del producto y tres
 * adelante, que es lo que le da profundidad sin una sola capa en 3D.
 */
import { actorMarkup, repeat } from './shared.js';

export const iceReveal = Object.freeze({
  id: 'ice_reveal',
  duration: 4.6,
  stage(creative) {
    const surface = `<i class="cmp-frost"></i>${repeat('cmp-drop', 2)}`;
    return `
      <span class="cmp-glow"></span>
      <span class="cmp-table"></span>
      ${repeat('cmp-ice', 2, 'back')}
      <span class="cmp-shadow"></span>
      ${actorMarkup(creative.vessel, surface)}
      ${repeat('cmp-ice', 3, 'front')}
      ${repeat('cmp-vapor', 3)}
      <span class="cmp-veil"></span>`;
  },
});
