/*
 * EL MOTOR DEL MAPA NO PUEDE DECIDIR CUÁNDO ARRANCA LA TIENDA.
 *
 * `hoja-del-mapa.spec.mjs` sacó del camino crítico la HOJA de unpkg. El SCRIPT
 * seguía con `defer`, y un script `defer` y el módulo `app.js` comparten una
 * sola cola de ejecución en orden: la tienda no ejecutaba una línea hasta que
 * unpkg entregaba ~800 KB de un mapa que la home no usa. Medido el 2026-09-26
 * con el paquete v119, a 390 px, en Chromium y en WebKit:
 *
 *   unpkg normal (una PC real) ... tienda lista   5.004 ms (1.010 ms sin el mapa)
 *   unpkg caído (falla rápido) ... cartel «Puede ser tu conexión» a los 200 ms
 *                                  sobre una tienda que arrancaba bien
 *   unpkg COLGADO 15 s ........... tienda lista  16.079 ms, con «La tienda está
 *                                  tardando» a los 8 s
 *
 * Estas tres pruebas fijan el arreglo: el motor baja con `async` (fuera de la
 * cola), su falla no es una falla del arranque (`data-boot-optional`) y un
 * mapa que se pintó antes que el motor se rearma cuando el motor llega
 * (`taba:maplibre-ready` → `remountMapsWaitingForEngine`).
 */
import { expect, test } from '@playwright/test';

const MOTOR = 'https://unpkg.com/maplibre-gl@5.24.0/dist/maplibre-gl.js';

/*
 * `startup-recovery.js` escribe `[TABA] arranque no completado (...)` en el
 * mismo instante en que muestra el cartel. Escucharlo desde ANTES de navegar
 * atrapa también el parpadeo que ocurre en medio de la navegación, que un
 * sondeo posterior se pierde.
 */
function escucharCartelDeRecuperacion(page) {
  const avisos = [];
  page.on('console', (mensaje) => {
    if (/arranque no completado/.test(mensaje.text())) avisos.push(mensaje.text());
  });
  return avisos;
}

test('un unpkg colgado no retiene la tienda ni dispara «está tardando»', async ({ page }) => {
  const avisos = escucharCartelDeRecuperacion(page);
  let soltar = () => undefined;
  const colgado = new Promise((resolve) => { soltar = resolve; });
  await page.route(MOTOR, async (route) => {
    await colgado;
    await route.abort().catch(() => undefined);
  });
  try {
    const inicio = Date.now();
    // `load` del documento espera a TODOS los scripts, también a los `async`
    // (con `defer` era igual): se navega hasta el DOM, que es lo que la tienda
    // necesita. Nada en la app escucha `load`.
    await page.goto('/?demo=1#home', { waitUntil: 'domcontentloaded' });
    // El motor sigue colgado durante TODA la prueba: si la tienda llega a
    // `ready`, es porque ya no lo espera.
    await expect(page.locator('html[data-taba-startup="ready"]')).toBeAttached({ timeout: 60_000 });
    const listaEn = Date.now() - inicio;
    await expect(page.locator('[data-add-product] >> visible=true').first()).toBeVisible();

    // Se espera más allá de los 8 s del temporizador de startup-recovery.js.
    await page.waitForTimeout(Math.max(0, 9_500 - (Date.now() - inicio)));
    // Un runner que tarda más de 8 s en pintar la demo mostraría el cartel con
    // razón; ahí la propiedad que importa ya quedó probada arriba.
    if (listaEn < 7_500) {
      expect(avisos, `el cartel de recuperación apareció sobre una tienda lista en ${listaEn} ms`).toEqual([]);
    }
  } finally {
    soltar();
  }
});

test('si unpkg falla rápido, no aparece el falso aviso de conexión', async ({ page }) => {
  const avisos = escucharCartelDeRecuperacion(page);
  await page.route(MOTOR, (route) => route.abort());
  await page.goto('/?demo=1#home', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('html[data-taba-startup="ready"]')).toBeAttached({ timeout: 60_000 });
  await page.waitForTimeout(500);
  expect(avisos, 'unpkg caído mostró «Puede ser tu conexión» sobre una tienda sana').toEqual([]);
});

test('Seguimiento pintado antes que el motor monta el mapa cuando el motor llega', async ({ page }) => {
  let soltar = () => undefined;
  const demorado = new Promise((resolve) => { soltar = resolve; });
  await page.route(MOTOR, async (route) => {
    await demorado;
    await route.continue();
  });
  // El cliente vuelve a la app con un pedido en camino: arranca DIRECTO en
  // Seguimiento, antes de que el motor haya llegado.
  await page.goto('/?demo=1#tracking', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('html[data-taba-startup="ready"]')).toBeAttached({ timeout: 60_000 });
  await expect(page.locator('[data-real-map][data-map-status="unavailable"]').first())
    .toBeAttached({ timeout: 15_000 });

  soltar();
  // Antes del arreglo esta entrada se reutilizaba para siempre en su respaldo.
  await expect(page.locator('.maplibregl-map').first()).toBeVisible({ timeout: 30_000 });
  await expect(page.locator('[data-real-map][data-map-status="unavailable"]')).toHaveCount(0, { timeout: 30_000 });
});
