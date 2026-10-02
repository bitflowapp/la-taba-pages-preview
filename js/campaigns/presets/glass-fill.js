/*
 * glass_fill — un vaso grande, en primer plano, que se llena con la bebida del
 * producto; dos cubos de hielo se acomodan adentro y el envase queda atrás, de
 * pie, diciendo de qué se trata.
 *
 * Es lo que `beer_pour` no puede hacer: servir algo que NO es cerveza. Allá el
 * líquido es dorado y lleva corona de espuma; acá el color lo declara la
 * campaña (`creative.liquid`) porque el color del envase no es el de la bebida
 * —una lata azul no trae líquido azul—, y la espuma es apenas una línea de
 * gas.
 *
 * Y es un solo sujeto grande en vez de dos chicos, que es lo que sobrevive en
 * la banda de 80–112 px del teléfono. El chorro entra desde arriba, fuera de
 * cuadro: no hace falta inclinar nada.
 *
 * Todo el mecanismo es el de `beer_pour` —la ventana que sube, el contenido que
 * baja lo mismo, las burbujas de cupo fijo— con otra geometría.
 */
import { actorMarkup, glassMarkup, repeat } from './shared.js';

export const glassFill = Object.freeze({
  id: 'glass_fill',
  duration: 4.4,
  stage(creative, uid) {
    return `
      <span class="cmp-glow"></span>
      <span class="cmp-table"></span>
      <span class="cmp-shadow"></span>
      ${actorMarkup(creative.vessel, '', uid)}
      <span class="cmp-stream"><i></i></span>
      ${glassMarkup(
        `<span class="cmp-fill"><span class="cmp-fill-in">${repeat('cmp-b', 6)}</span></span>
          <span class="cmp-foam"></span>
          ${repeat('cmp-ice', 2, 'in')}`,
      )}`;
  },
});
