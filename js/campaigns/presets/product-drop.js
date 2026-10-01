/*
 * product_drop — el producto baja desde arriba, desacelera, rebota apenas y la
 * sombra reacciona; recién entonces aparece la información.
 *
 * Es la escena más barata de las cuatro: cuando el producto se asienta no queda
 * NADA animándose. Sirve para gaseosas, energizantes, cervezas y aguas.
 */
import { actorMarkup } from './shared.js';

export const productDrop = Object.freeze({
  id: 'product_drop',
  duration: 3.2,
  stage(creative) {
    return `
      <span class="cmp-beam"></span>
      <span class="cmp-glow"></span>
      <span class="cmp-table"></span>
      <span class="cmp-ring"></span>
      <span class="cmp-shadow"></span>
      ${actorMarkup(creative.vessel)}`;
  },
});
