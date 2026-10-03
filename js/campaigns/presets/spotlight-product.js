/*
 * spotlight_product — la escena está a oscuras; un haz de luz gira hasta caer
 * sobre el producto, que sale de la penumbra, y un brillo lo recorre una vez.
 *
 * Es la escena para lo que no tiene que rebotar ni chorrear: un vino, un
 * destilado, un espumante. No hay caída, ni líquido, ni hielo, y cuando el haz
 * se detiene no queda NADA animándose.
 *
 * Reusa lo que ya existía: el haz de `product_drop`, el resplandor, la mesa, la
 * sombra y el brillo que viaja recortado por la silueta del envase.
 */
import { actorMarkup } from './shared.js';

export const spotlightProduct = Object.freeze({
  id: 'spotlight_product',
  duration: 3.6,
  stage(creative, uid) {
    return `
      <span class="cmp-beam"></span>
      <span class="cmp-glow"></span>
      <span class="cmp-table"></span>
      <span class="cmp-shadow"></span>
      ${actorMarkup(creative.vessel, '<i class="cmp-shine"></i>', uid, creative.packshot)}`;
  },
});
