/*
 * LATIDOS EN FASE CON LA PÁGINA, NO CON EL ÚLTIMO REDIBUJO.
 *
 * El pulso de la moto y el punto «en vivo» son animaciones CSS infinitas dentro
 * del lienzo del mapa. Cada lectura del seguimiento (una cada 5 s) vuelve a
 * escribir la pantalla y `renderWithStableRealMap` saca el lienzo del DOM y lo
 * vuelve a poner: para el navegador eso cancela las animaciones y las arranca
 * otra vez desde el 0 %. El pulso arrancaba en opacidad 0,75 a mitad de un
 * ciclo que estaba en 0: un destello cada 5 s alrededor de la moto, que en la
 * calle se veía como un marcador que parpadea (LT-0004, 2026-10-06).
 *
 * El arreglo no toca las animaciones: las ancla al reloj del documento. Con
 * `startTime = 0` la fase de cada una es «tiempo de la página módulo período»,
 * así que la animación nueva sigue exactamente donde iba la anterior y dos
 * latidos del mismo período laten juntos. Sólo se tocan las infinitas, que son
 * las ambientales; una transición o una animación de una vuelta tiene que
 * empezar cuando ocurre.
 */
export function lockAmbientAnimationPhase(scope) {
  let animations;
  try {
    animations = scope?.getAnimations?.({ subtree: true }) || [];
  } catch (_) {
    return 0;
  }
  let locked = 0;
  for (const animation of animations) {
    const timing = animation?.effect?.getTiming?.();
    if (!timing || timing.iterations !== Infinity) continue;
    if (animation.playState === 'paused' || animation.playState === 'idle') continue;
    if (animation.startTime === 0) continue;
    try {
      animation.startTime = 0;
      locked += 1;
    } catch (_) {
      // Una línea de tiempo inactiva no acepta `startTime`; el latido sigue igual.
    }
  }
  return locked;
}
