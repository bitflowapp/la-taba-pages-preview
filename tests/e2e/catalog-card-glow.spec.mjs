/*
 * El brillo de la góndola, medido en un navegador de verdad.
 *
 * El contrato es el mismo en los dos estantes y en los dos tamaños: al llegar,
 * las primeras tarjetas de producto tienen capas rojas con alfa > 0; bajando lo
 * suficiente el alfa llega a 0; volviendo arriba reaparece.
 *
 * Se mide el `box-shadow` COMPUTADO y no el valor del token: si
 * `calc(var(--card-glow) * N%)` no estuviera soportado, el token seguiría
 * teniendo el número correcto y la tarjeta no tendría brillo ninguno.
 */
import { expect, test } from '@playwright/test';
import { gotoDemoReset, installBrowserStubs, installPageGuards } from './helpers.mjs';

const DESTACADOS = '[data-glow-shelf] .home-best-card:not(.out-of-stock)';
const CATALOGO = '[data-glow-shelf] .product-card:not(.out-of-stock)';

function alfasRojos(page, selector) {
  return page.locator(selector).first().evaluate((nodo) => (
    (getComputedStyle(nodo).boxShadow.match(/rgba\(208,\s*0,\s*13,\s*([0-9.]+)\)/g) || [])
      .map((capa) => Number(/([0-9.]+)\)$/.exec(capa)[1]))
  ));
}

async function scrollear(page, y) {
  await page.evaluate((destino) => window.scrollTo(0, destino), y);
  // Dos cuadros: el módulo escribe el valor dentro de un `requestAnimationFrame`.
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
  await page.waitForTimeout(120);
}

async function irAlCatalogo(page) {
  await page.locator('[data-nav-view="catalog"] >> visible=true').first().click();
  await page.locator('body[data-active-view="catalog"]').waitFor({ state: 'attached' });
  await expect(page.locator(CATALOGO).first()).toBeVisible();
}

/*
 * MEDIR RECIÉN CUANDO EL ESTANTE DEJÓ DE MOVERSE.
 *
 * La góndola se sigue acomodando después de que la primera tarjeta ya es
 * visible: WebKit decodifica las fotos de a poco y cada una que entra corre el
 * estante unos píxeles. Y el brillo es una FUNCIÓN de la geometría del estante.
 *
 * Medir mientras esa geometría todavía se mueve compara dos situaciones
 * distintas y llama «el brillo no volvió igual» a lo que en realidad es «cuando
 * lo miré la primera vez, la página todavía no había terminado de armarse». En
 * CI, más lento, pasaba cada tanto.
 *
 * Acá no se afloja nada: los alfas siguen teniendo que ser EXACTAMENTE los
 * mismos. Lo único que se agrega es esperar a que haya algo estable que
 * comparar, y comprobar que se comparó sobre la misma geometría —si el estante
 * quedó en otro lado, eso es lo que se informa, en vez de acusar al brillo—.
 */
async function medirEstanteQuieto(page, selector, etiqueta) {
  // Las tipografías corren la caja de cada tarjeta cuando terminan de
  // resolverse. Es una condición observable que resuelve sola: se la espera, no
  // se la cronometra.
  await page.evaluate(() => document.fonts?.ready ?? null);

  /*
   * Cada lectura se toma después de dos cuadros de animación, y el muestreo es
   * POR CUADRO, no por reloj: bajo carga los cuadros se espacian solos, así que
   * la espera se adapta a lo lenta que vaya la máquina en vez de apostar a un
   * número de milisegundos que en CI sería otro. Dos cuadros porque el módulo
   * escribe `--card-glow` dentro de un `requestAnimationFrame`.
   */
  const leer = () => page.locator(selector).first().evaluate(async (tarjeta) => {
    await new Promise((listo) => { requestAnimationFrame(() => requestAnimationFrame(listo)); });
    const estante = tarjeta.closest('[data-glow-shelf]');
    const rect = estante.getBoundingClientRect();
    const alfas = (getComputedStyle(tarjeta).boxShadow.match(/rgba\(208,\s*0,\s*13,\s*([0-9.]+)\)/g) || [])
      .map((capa) => Number(/([0-9.]+)\)$/.exec(capa)[1]));
    return { arriba: Math.round(rect.top), alto: Math.round(rect.height), alfas };
  });

  /*
   * Se espera a que quede quieto TODO lo que después se compara: la geometría
   * del estante y los alfas que salen de ella. Cubrir sólo la geometría dejaba
   * afuera la otra mitad —el token `--card-glow` lo escribe el módulo en un
   * cuadro posterior al scroll—, y la comparación final mira las dos.
   *
   * Esto NO congela ningún valor ni vuelve circular la comprobación: que cada
   * lado se haya quedado quieto no obliga a que los dos coincidan. Si el brillo
   * volviera con otro valor, sigue fallando.
   */
  const misma = (a, b) => (
    a.arriba === b.arriba
    && a.alto === b.alto
    && a.alfas.length === b.alfas.length
    && a.alfas.every((alfa, i) => alfa === b.alfas[i])
  );

  /*
   * TRES lecturas seguidas iguales, no dos: entre dos corrimientos sucesivos dos
   * lecturas pueden coincidir por casualidad, y esa casualidad es justo el flake
   * que se está sacando.
   */
  let anterior = await leer();
  let seguidas = 1;
  for (let intento = 0; intento < 200 && seguidas < 3; intento += 1) {
    const actual = await leer();
    seguidas = misma(anterior, actual) ? seguidas + 1 : 1;
    anterior = actual;
  }
  if (seguidas < 3) {
    throw new Error(`${etiqueta}: el estante nunca dejó de moverse (última lectura: ${JSON.stringify(anterior)})`);
  }
  return anterior;
}

/*
 * BAJAR HASTA QUE EL ESTANTE QUEDE UNA PANTALLA ENTERA POR ENCIMA — Y COMPROBARLO.
 *
 * `readShelfGlow` lleva el brillo a 0 cuando el borde superior del ESTANTE está
 * una pantalla completa por encima del viewport. Antes se bajaba a «tope de la
 * primera TARJETA + una pantalla + 24 px», que son dos discrepancias juntas: se
 * medía desde la tarjeta y no desde el estante que decide, y el colchón contra
 * el umbral era de 24 px exactos. Cualquier imagen que terminara de decodificar
 * después de calcular el destino —en WebKit bajo carga de CI, cada tanto— corría
 * el estante más que eso, y entonces el brillo TODAVÍA NO ERA 0 porque no tenía
 * que serlo. La prueba acusaba al brillo de una medición hecha en el filo.
 *
 * Se sigue bajando lo mínimo necesario: media pantalla de más, no hasta el final.
 * Scrollear de más en la home obliga a WebKit a decodificar las imágenes de todos
 * los rails intermedios, y esta prueba llegó a tardar 42 s contra un timeout de 45.
 *
 * Y la geometría se verifica ANTES de mirar el color: si la página no pudo bajar
 * lo suficiente, lo que falla es eso y lo dice, en vez de culpar al brillo.
 */
async function bajarHastaApagar(page, selector, etiqueta) {
  const geometria = () => page.locator(selector).first().evaluate((tarjeta) => {
    const estante = tarjeta.closest('[data-glow-shelf]');
    const rect = estante.getBoundingClientRect();
    return {
      arriba: Math.round(rect.top),
      vh: window.innerHeight,
      destino: Math.round(rect.top + window.scrollY + window.innerHeight * 1.5),
      tope: Math.round(document.documentElement.scrollHeight - window.innerHeight),
    };
  });

  let donde = await geometria();
  // Cuatro vueltas: si el layout se corre por una imagen tardía, se recalcula
  // desde donde quedó en vez de dar por buena la primera cuenta.
  for (let intento = 0; intento < 4 && donde.arriba > -donde.vh; intento += 1) {
    await scrollear(page, Math.min(donde.destino, donde.tope));
    donde = await geometria();
  }

  expect(
    donde.arriba,
    `${etiqueta}: la página no pudo bajar lo suficiente para que el brillo se apague `
    + `(estante en ${donde.arriba}, hace falta ${-donde.vh} o menos; tope de scroll ${donde.tope})`,
  ).toBeLessThanOrEqual(-donde.vh);
}

/*
 * El contrato completo sobre un estante: encendido al llegar, apagado abajo,
 * encendido de nuevo al volver. `hastaApagar` depende de qué tan abajo empieza
 * el estante; se calcula desde su propia posición en vez de fijar un número.
 */
async function contratoDelEstante(page, selector, etiqueta) {
  const llegada = await medirEstanteQuieto(page, selector, etiqueta);
  const alLlegar = llegada.alfas;
  expect(alLlegar, `${etiqueta}: faltan las dos capas rojas`).toHaveLength(2);
  alLlegar.forEach((alfa) => expect(alfa, `${etiqueta}: el brillo no está encendido al llegar`).toBeGreaterThan(0));
  // Muy suave: es un acento, no un neón.
  expect(Math.max(...alLlegar), `${etiqueta}: el brillo se fue de escala`).toBeLessThanOrEqual(0.3);

  await bajarHastaApagar(page, selector, etiqueta);
  const abajo = await alfasRojos(page, selector);
  expect(Math.max(...abajo), `${etiqueta}: el brillo no se apagó al bajar`).toBe(0);

  await scrollear(page, 0);
  const vuelta = await medirEstanteQuieto(page, selector, etiqueta);
  vuelta.alfas.forEach((alfa) => expect(alfa, `${etiqueta}: el brillo no volvió al subir`).toBeGreaterThan(0));
  // La igualdad sólo significa algo si los dos lados se midieron sobre la misma
  // geometría: si el estante quedó en otro lado, lo que cambió es la página.
  expect(
    { arriba: vuelta.arriba, alto: vuelta.alto },
    `${etiqueta}: el estante no volvió a la misma posición, así que el brillo no es comparable`,
  ).toEqual({ arriba: llegada.arriba, alto: llegada.alto });
  expect(vuelta.alfas, `${etiqueta}: el brillo volvió con otro valor`).toEqual(alLlegar);
}

test('HOME · el rail Destacados llega con brillo, se apaga al bajar y vuelve', async ({ page }) => {
  const guards = installPageGuards(page);
  await installBrowserStubs(page);
  await gotoDemoReset(page, '/?reset=1&demo=1');

  // Es la primera góndola que ve un cliente: si acá no hay brillo, el efecto no
  // existe donde importa, por más que exista en el catálogo.
  await expect(page.locator(DESTACADOS).first()).toBeVisible();
  await contratoDelEstante(page, DESTACADOS, 'Destacados');

  await guards.assertClean();
});

test('CATÁLOGO · la grilla llega con brillo, se apaga al bajar y vuelve', async ({ page }) => {
  const guards = installPageGuards(page);
  await installBrowserStubs(page);
  await gotoDemoReset(page, '/?reset=1&demo=1');
  await irAlCatalogo(page);

  await contratoDelEstante(page, CATALOGO, 'catálogo');

  await guards.assertClean();
});

test('el brillo no toca ni el fondo ni la tinta de la tarjeta', async ({ page }) => {
  await installBrowserStubs(page);
  await gotoDemoReset(page, '/?reset=1&demo=1');
  await irAlCatalogo(page);

  const superficie = () => page.locator(CATALOGO).first().evaluate((nodo) => {
    const cs = getComputedStyle(nodo);
    const titulo = nodo.querySelector('h3, .product-title, strong');
    return {
      fondo: cs.backgroundColor,
      borde: cs.borderTopColor,
      tinta: titulo ? getComputedStyle(titulo).color : null,
    };
  });

  const conBrillo = await superficie();
  await scrollear(page, 3000);
  const sinBrillo = await superficie();

  // Una sombra no puede cambiar el contraste del texto. Si estos tres valores
  // son iguales con brillo y sin brillo, la legibilidad es literalmente la
  // misma y no hay nada que remedir.
  expect(conBrillo).toEqual(sinBrillo);
});

test('lo agotado nunca brilla, en ninguno de los dos estantes', async ({ page }) => {
  await installBrowserStubs(page);
  await gotoDemoReset(page, '/?reset=1&demo=1');

  const sinBrilloEn = (selector) => page.evaluate((sel) => {
    const nodos = [...document.querySelectorAll(sel)];
    if (!nodos.length) return 'no hay tarjetas agotadas en esta vista';
    const alfas = nodos.flatMap((nodo) => (
      (getComputedStyle(nodo).boxShadow.match(/rgba\(208,\s*0,\s*13,\s*([0-9.]+)\)/g) || [])
        .map((capa) => Number(/([0-9.]+)\)$/.exec(capa)[1]))
    ));
    return alfas.every((a) => a === 0) ? 'todas en cero' : `hay alfa > 0: ${alfas.join(', ')}`;
  }, selector);

  const enHome = await sinBrilloEn('[data-glow-shelf] .home-best-card.out-of-stock');
  expect(enHome, `Destacados: ${enHome}`).not.toContain('alfa > 0');

  await irAlCatalogo(page);
  const enCatalogo = await sinBrilloEn('[data-glow-shelf] .product-card.out-of-stock');
  expect(enCatalogo, `catálogo: ${enCatalogo}`).not.toContain('alfa > 0');
});

test('con movimiento reducido el brillo queda quieto y nada desborda', async ({ page }) => {
  const guards = installPageGuards(page);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await installBrowserStubs(page);
  await gotoDemoReset(page, '/?reset=1&demo=1');

  const fijado = () => page.evaluate(() => (
    [...document.querySelectorAll('[data-glow-shelf]')]
      .map((n) => n.style.getPropertyValue('--card-glow')).join('|')
  ));

  // El módulo no escribe: el token conserva su valor por defecto, que es lo
  // mismo que se ve cuando JavaScript no corre.
  expect(await fijado()).toBe('|');
  const antes = await alfasRojos(page, DESTACADOS);
  antes.forEach((alfa) => expect(alfa).toBeGreaterThan(0));

  await scrollear(page, 1600);
  expect(await fijado()).toBe('|');

  await irAlCatalogo(page);
  const geo = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    innerWidth: window.innerWidth,
  }));
  expect(geo.scrollWidth).toBeLessThanOrEqual(geo.innerWidth);

  await guards.assertClean();
});

test('el brillo no se derrama fuera de los dos estantes', async ({ page }) => {
  await installBrowserStubs(page);
  await gotoDemoReset(page, '/?reset=1&demo=1');

  // El hero, el buscador y la fila de categorías no llevan brillo, y las
  // superficies del carrito y del checkout tampoco.
  const rojoEn = (sel) => page.evaluate((selector) => {
    const nodo = document.querySelector(selector);
    if (!nodo) return -1;
    return (getComputedStyle(nodo).boxShadow.match(/rgba\(208,\s*0,\s*13,/g) || []).length;
  }, sel);

  for (const sel of ['.taba-home-hero', '.taba-home-search', '[data-home-category-strip]']) {
    const capas = await rojoEn(sel);
    if (capas >= 0) expect(capas, `${sel} no debería llevar brillo`).toBe(0);
  }

  await page.locator('[data-nav-view="cart"] >> visible=true').first().click();
  await page.locator('body[data-active-view="cart"]').waitFor({ state: 'attached' });
  const enCarrito = await rojoEn('[data-view="cart"] .card');
  if (enCarrito >= 0) expect(enCarrito, 'el carrito no debería llevar brillo').toBe(0);
});
