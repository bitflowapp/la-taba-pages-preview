/*
 * EL PULSO DE LA MOTO NO SE REINICIA CON CADA LECTURA DEL SEGUIMIENTO.
 *
 * Visto en la calle con LT-0004 (2026-10-06): el marcador «parpadeaba». Cada
 * lectura del seguimiento (cada 5 s) vuelve a escribir la pantalla y
 * `renderWithStableRealMap` saca el lienzo del mapa del DOM y lo vuelve a poner.
 * Para el navegador eso cancela las animaciones CSS del lienzo y las arranca
 * desde el 0 %: el pulso volvía a opacidad 0,75 en medio de un ciclo.
 *
 * Se usa la hoja real y el redibujo estable real de la app; sólo el lienzo es
 * un marcado mínimo con las mismas clases que pinta el mapa.
 */
import { expect, test } from '@playwright/test';

test.use({ reducedMotion: 'no-preference' });

const PERIODO_MS = 2_400;

test('el redibujo estable conserva la fase del pulso; sin anclar, arranca de cero', async ({ page }) => {
  await page.route('**/__pulso-fixture.html', (route) => route.fulfill({
    contentType: 'text/html; charset=utf-8',
    body: `<!doctype html><html lang="es"><head><meta charset="utf-8">
      <link rel="stylesheet" href="/styles.css?v=76"></head>
      <body><div class="tracking-premium status-on_the_way"><div id="host"></div></div></body></html>`,
  }));
  await page.goto('/__pulso-fixture.html');

  const resultado = await page.evaluate(async (periodo) => {
    const { renderWithStableRealMap } = await import('/js/ui.js');
    const host = document.getElementById('host');
    const lienzo = `<div class="real-map-shell is-location-fresh" data-real-map data-map-role="tracking"
        data-order-id="LT-1" data-map-freshness="fresh">
        <div class="real-map-canvas"><div class="lt-rider-marker on-the-way"><span class="lt-rider-helmet-core"></span></div></div>
      </div>`;
    const pulso = () => host.querySelector('[data-real-map]').getAnimations({ subtree: true })
      .find((a) => a.animationName === 'taba-rider-pulse');
    const desfase = (a) => {
      const propia = ((a.currentTime % periodo) + periodo) % periodo;
      const global = document.timeline.currentTime % periodo;
      const d = Math.abs(propia - global);
      return Math.min(d, periodo - d);
    };
    const esperar = (ms) => new Promise((r) => setTimeout(r, ms));

    renderWithStableRealMap(host, lienzo, { rolePrefix: 'tracking', orderId: 'LT-1' });
    const lienzoOriginal = host.querySelector('[data-real-map]');
    await esperar(1_300);

    // Control: sacar y poner el lienzo a mano, sin anclar, reinicia el pulso.
    host.replaceChildren();
    host.append(lienzoOriginal);
    const reiniciado = pulso();
    const sinAncla = reiniciado ? reiniciado.currentTime : null;

    await esperar(700);
    // Lo que hace la app en cada lectura: el mismo lienzo vuelve, anclado.
    renderWithStableRealMap(host, lienzo, { rolePrefix: 'tracking', orderId: 'LT-1' });
    const mismoLienzo = host.querySelector('[data-real-map]') === lienzoOriginal;
    const tras = pulso();
    const desfaseTrasRedibujo = tras ? desfase(tras) : null;
    await esperar(900);
    const sigue = pulso();
    return {
      existe: Boolean(reiniciado),
      sinAncla,
      mismoLienzo,
      desfaseTrasRedibujo,
      desfaseDespues: sigue ? desfase(sigue) : null,
    };
  }, PERIODO_MS);

  expect(resultado.existe).toBe(true);
  expect(resultado.sinAncla).toBeLessThan(200);
  expect(resultado.mismoLienzo).toBe(true);
  expect(resultado.desfaseTrasRedibujo).toBeLessThan(60);
  expect(resultado.desfaseDespues).toBeLessThan(60);
});
