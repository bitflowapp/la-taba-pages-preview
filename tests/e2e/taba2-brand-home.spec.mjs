// Regresión visual de la home de marca de La Taba 2.
//
// Por qué NO son capturas de píxeles: el gate de CI corre en `ubuntu-latest` y
// el desarrollo ocurre en Windows. Una baseline de píxeles generada en una de
// las dos plataformas pone la otra en rojo por rasterizado de fuentes, no por
// una regresión real. Esta suite fija el CONTRATO VISUAL —superficie, color
// resuelto, contraste, geometría, objetivos táctiles y estado— que es idéntico
// en Chromium, WebKit y Firefox y en los dos sistemas operativos.
//
// Las capturas reales se generan como artefacto fuera de Git para la revisión
// humana; acá vive lo que puede fallar automáticamente.
import { expect, test } from '@playwright/test';
import { brandSurfaceRgb, shelfSurfaceRgb } from '../../scripts/brand-surface.mjs';
import { gotoDemoReset, installBrowserStubs, installPageGuards, seedCartAboveMinimum } from './helpers.mjs';

const PHONE = { width: 390, height: 844 };

// Superficie de contenido del cliente (`--shelf` en tokens.css) ya resuelta.
// Se escribe el color pintado y no el token porque lo que este contrato protege
// es lo que el ojo ve, no cómo se llama la variable.
//
// El valor cambió de crema a grafito: la identidad comercial de TABA2 es
// negro/grafito, blanco, rojo intenso y dorado, y el beige no está en esa
// paleta. Lo que el contrato protege NO cambió: sigue habiendo UNA superficie
// para todas las vistas del cliente, y el test la fija en su valor pintado.
// El valor se deriva de `--shelf` en styles/tokens.css: el contrato es "una
// sola superficie de góndola, y es la que el sistema de diseño declara", no
// "la góndola es este gris en particular". Ver scripts/brand-surface.mjs.
const GONDOLA = shelfSurfaceRgb();

const STORY_FIXTURES = [
  {
    id: 'story-combo',
    business_id: 'la-taba-2',
    title: 'Combo de la semana',
    media_type: 'image',
    media_url: 'assets/products/beverage-placeholder.svg',
    thumbnail_url: 'assets/products/beverage-placeholder.svg',
    starts_at: null,
    expires_at: null,
    priority: 10,
    cta_type: 'category',
    cta_target: 'cervezas',
    is_highlight: true,
    published: true,
  },
  {
    id: 'story-frio',
    business_id: 'la-taba-2',
    title: 'Siempre frío',
    media_type: 'image',
    media_url: 'assets/products/beverage-placeholder.svg',
    thumbnail_url: 'assets/products/beverage-placeholder.svg',
    starts_at: null,
    expires_at: null,
    priority: 1,
    cta_type: 'category',
    cta_target: 'energizantes',
    is_highlight: false,
    published: true,
  },
];

// ── Contraste WCAG sobre el color REALMENTE pintado ──────────────────────────
// Resuelve el fondo subiendo por los ancestros hasta encontrar uno opaco, que
// es lo que el ojo ve. Sin esto un `transparent` daría un falso verde.
const CONTRAST_PROBE = `(selector) => {
  const node = document.querySelector(selector);
  if (!node) return null;
  const parse = (value) => {
    const parts = String(value).match(/[\\d.]+/g);
    if (!parts) return null;
    const [r, g, b, a = '1'] = parts.map(Number);
    return { r, g, b, a };
  };
  const luminance = ({ r, g, b }) => {
    const channel = (value) => {
      const v = value / 255;
      return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
    };
    return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
  };
  const foreground = parse(getComputedStyle(node).color);
  let background = null;
  for (let cursor = node; cursor; cursor = cursor.parentElement) {
    const candidate = parse(getComputedStyle(cursor).backgroundColor);
    if (candidate && candidate.a >= 0.92) { background = candidate; break; }
  }
  if (!foreground || !background) return null;
  const light = Math.max(luminance(foreground), luminance(background));
  const dark = Math.min(luminance(foreground), luminance(background));
  return {
    ratio: Number(((light + 0.05) / (dark + 0.05)).toFixed(2)),
    fontSize: parseFloat(getComputedStyle(node).fontSize),
    fontWeight: Number(getComputedStyle(node).fontWeight) || 400,
  };
}`;

async function contrast(page, selector) {
  return page.evaluate(new Function(`return ${CONTRAST_PROBE}`)(), selector);
}

// La entrada a historias existe en DOS lugares —el encabezado de la home y el
// de Perfil— y comparte marcado, así que cada aserción tiene que decir de cuál
// habla. Estos helpers evitan que un selector suelto vuelva a apuntar a las dos.
const HERO = '.brand-hero';
const PERFIL_HEAD = '.profile-page-head';
const entradaHome = (page) => page.locator(`${HERO} [data-stories-slot]`);
const logoHome = (page) => page.locator(`${HERO} .brand-logo-action`);
const logoEstaticoHome = (page) => page.locator(`${HERO} [data-stories-static]`);

async function openHome(page, { stories = null, viewport = PHONE } = {}) {
  await page.setViewportSize(viewport);
  await installBrowserStubs(page);
  // `null` = sin origen declarado: manda lo que traiga el modo (la demo siembra
  // sus fixtures). Un array —incluido `[]`— declara el origen real y gana
  // siempre, que es el contrato que consumirá el backend.
  if (Array.isArray(stories)) {
    await page.addInitScript((fixtures) => { window.TABA2_STORIES = fixtures; }, stories);
  }
  await gotoDemoReset(page, '/?reset=1&demo=1');
  await page.waitForSelector('[data-view="home"] .home-best-card');
}

test('el encabezado presenta la identidad real del comercio, no una escrita a mano', async ({ page }) => {
  const guards = installPageGuards(page);
  await openHome(page);

  // El "¡Bienvenido a" se retiró: era decoración de tres renglones encima del
  // primer producto. Lo que se fija sigue siendo lo mismo que fijaba antes —que
  // la identidad SALE de `businessConfig` y no está escrita a mano—, ahora
  // sobre el encabezado compacto.
  await expect(page.getByRole('heading', { name: 'La Taba 2', level: 1 })).toBeVisible();
  // Rubro y dirección salen de `businessConfig`: la vista sólo los concatena.
  await expect(page.locator('[data-home-business-place]')).toHaveText('Tienda de bebidas · Mendoza 827, Neuquén');
  await expect(page.locator('[data-open-status]')).toBeVisible();
  await expect(page.locator('[data-open-status]')).toHaveText('Pedidos disponibles');
  // Sin horario publicado no se inventa ninguno.
  await expect(page.locator('[data-home-business-hours]')).toBeHidden();
  await guards.assertClean();
});

// El origen productivo es el global que publica el backend. La demo siembra
// fixtures propias (`preview-stories-data.js`), así que para ejercitar el
// fail-closed hay que declarar explícitamente que el origen real está vacío:
// es exactamente lo que ocurre en producción antes del primer publicado.
test('sin historias publicadas el logo no se anuncia como botón', async ({ page }) => {
  await openHome(page, { stories: [] });

  // El fail-closed rige en TODAS las entradas, no sólo en la de la home.
  await expect(page.locator('[data-stories-slot]')).toHaveCount(2);
  for (const estado of await page.locator('[data-stories-slot]').evaluateAll(
    (nodos) => nodos.map((n) => n.dataset.storiesState),
  )) {
    expect(estado).toBe('empty');
  }
  await expect(logoHome(page)).toBeHidden();
  await expect(page.locator(`${PERFIL_HEAD} .brand-logo-action`)).toBeHidden();
  // La fila de círculos es la entrada nueva: sin historias queda vacía y no
  // sobrevive ni un círculo prometiendo contenido. El emblema NO se va con
  // ella: sigue siendo la identidad del comercio, sólo que sin aro ni botón.
  await expect(page.locator('.brand-story-circle')).toHaveCount(0);
  await expect(logoEstaticoHome(page)).toBeVisible();
  // El aro no se pinta: nada promete contenido inexistente.
  const ringPainted = await page.locator(`${HERO} [data-stories-static] .brand-logo-ring`)
    .evaluate((node) => getComputedStyle(node).backgroundImage !== 'none');
  expect(ringPainted).toBe(false);
});

// El emblema de marca es el elemento de identidad de la home. Lo que se fija no
// es su dibujo sino que se PINTE: el aro de historias es `position: absolute` y
// basta que la cara pierda su `z-index` para que le tape "LA TABA".
test('el emblema de marca se ve entero, con y sin el aro de historias encendido', async ({ page }) => {
  await openHome(page, { stories: STORY_FIXTURES });

  const logo = logoHome(page);
  await expect(logo.locator('img')).toHaveAttribute('src', /taba2-emblem\.svg$/);

  const capas = await logo.evaluate((nodo) => {
    const cara = nodo.querySelector('.brand-logo-face');
    const aro = nodo.querySelector('.brand-logo-ring');
    const caja = cara.getBoundingClientRect();
    const imagen = cara.querySelector('img').getBoundingClientRect();
    // Punto justo dentro del borde superior del emblema, donde vive "LA TABA".
    const x = Math.round(caja.left + caja.width / 2);
    const y = Math.round(caja.top + 6);
    return {
      encima: document.elementFromPoint(x, y)?.className || '',
      caraZ: getComputedStyle(cara).zIndex,
      caraPos: getComputedStyle(cara).position,
      aroPos: getComputedStyle(aro).position,
      emblemaLleno: Math.round(imagen.width) === Math.round(caja.width),
      caraDentroDelSlot: Math.round(caja.width) < Math.round(nodo.getBoundingClientRect().width),
    };
  });

  // Quien recibe el toque sobre el emblema no puede ser el aro.
  expect(capas.encima, 'algo tapa el emblema').not.toContain('brand-logo-ring');
  expect(capas.aroPos).toBe('absolute');
  expect(capas.caraPos).toBe('relative');
  expect(capas.caraZ).not.toBe('auto');
  expect(capas.emblemaLleno, 'el emblema no llena su caja').toBe(true);
  // El aro corre por fuera: si la cara midiera lo mismo que el slot, no habría
  // lugar donde pintarlo.
  expect(capas.caraDentroDelSlot).toBe(true);

  // Sin historias el emblema sigue siendo visible sobre el shell oscuro, que es
  // justo cuando el aro no está para separarlo del fondo.
  const limpio = await page.context().browser().newContext({ viewport: PHONE });
  const sinHistorias = await limpio.newPage();
  await installBrowserStubs(sinHistorias);
  await sinHistorias.addInitScript(() => { window.TABA2_STORIES = []; });
  await gotoDemoReset(sinHistorias, '/?reset=1&demo=1');
  await sinHistorias.waitForSelector('[data-stories-slot][data-stories-state="empty"]');
  const cara = sinHistorias.locator(`${HERO} [data-stories-static] .brand-logo-face`);
  await expect(cara.locator('img')).toBeVisible();
  expect(await cara.evaluate((n) => getComputedStyle(n).boxShadow)).not.toBe('none');
  await limpio.close();
});

test('la caja del logo no se mueve entre estados: sin historias y con historias mide igual', async ({ page }) => {
  await openHome(page);
  const empty = await entradaHome(page).boundingBox();

  const context = await page.context().browser().newContext({ viewport: PHONE });
  const withStories = await context.newPage();
  await installBrowserStubs(withStories);
  await withStories.addInitScript((fixtures) => { window.TABA2_STORIES = fixtures; }, STORY_FIXTURES);
  await gotoDemoReset(withStories, '/?reset=1&demo=1');
  await withStories.waitForSelector(`${HERO} .brand-logo-action:not([hidden])`);
  const filled = await entradaHome(withStories).boundingBox();

  expect(Math.round(filled.width)).toBe(Math.round(empty.width));
  expect(Math.round(filled.height)).toBe(Math.round(empty.height));
  await context.close();
});

test('con historias vigentes el logo es botón, el aro se enciende y el acceso dice cuántas hay', async ({ page }) => {
  await openHome(page, { stories: STORY_FIXTURES });

  await expect(entradaHome(page)).toHaveAttribute('data-stories-state', 'unseen');
  const logo = logoHome(page);
  await expect(logo).toBeVisible();
  await expect(logo).toHaveAttribute('aria-label', /2 historias nuevas de La Taba 2/);
  // El estado no viaja sólo en el color del aro: hay un círculo por historia y
  // cada uno declara si ya se vio. Antes esto lo decía un rótulo suelto de una
  // tarjeta ancha que no mostraba ninguna historia.
  await expect(page.locator('.brand-story-circle')).toHaveCount(2);
  await expect(page.locator('.brand-story-circle[data-story-seen="false"]')).toHaveCount(2);

  await logo.click();
  const modal = page.locator('[data-stories-modal]');
  await expect(modal).toBeVisible();
  await expect(modal.getByRole('heading', { name: 'Combo de la semana' })).toBeVisible();
  await expect(modal.locator('[data-story-cta]')).toHaveText('Ver categoría');

  // La CTA usa una acción que ya existe: filtra el catálogo real.
  await modal.locator('[data-story-cta]').click();
  await expect(modal).toBeHidden();
  await expect(page.locator('[data-view="catalog"]')).toBeVisible();
  await expect(page.locator('[data-catalog-title]')).toHaveText('Cervezas');
  await expect(page.locator('[data-product-grid] .product-card').first()).toBeVisible();
});

test('las historias vistas atenúan el aro en vez de desaparecer', async ({ page }) => {
  await openHome(page, { stories: STORY_FIXTURES });
  await logoHome(page).click();
  await page.locator('[data-story-next]').click();
  await page.locator('[data-close-stories]').click();

  await expect(entradaHome(page)).toHaveAttribute('data-stories-state', 'seen');
  // Vistas las dos, los dos círculos quedan apagados —no desaparecen— igual
  // que el aro del emblema.
  await expect(page.locator('.brand-story-circle[data-story-seen="true"]')).toHaveCount(2);
  await expect(logoHome(page)).toBeVisible();
});

test('el foco vuelve al logo al cerrar el visor', async ({ page }) => {
  await openHome(page, { stories: STORY_FIXTURES });
  const logo = logoHome(page);
  await logo.click();
  await page.locator('[data-close-stories]').click();
  await expect(logo).toBeFocused();
});

// Perfil es la segunda entrada. Lo que se fija es que NO sea una copia con vida
// propia: mismo estado, misma cuenta de nuevas y el visor devuelve el foco al
// logo que se tocó, no al de la home.
test('Perfil ofrece la misma entrada a historias que la home, sincronizada', async ({ page }) => {
  await openHome(page, { stories: STORY_FIXTURES });
  await page.locator('.mobile-nav [data-nav-view="profile"]').click();
  await expect(page.locator('[data-view="profile"]')).toBeVisible();

  const enPerfil = page.locator(`${PERFIL_HEAD} .brand-logo-action`);
  await expect(enPerfil).toBeVisible();
  await expect(page.locator(`${PERFIL_HEAD} [data-stories-slot]`))
    .toHaveAttribute('data-stories-state', 'unseen');
  // La etiqueta sale del MISMO estado que la de la home: si divergen, una de las
  // dos le está mintiendo al cliente sobre cuántas historias le faltan.
  await expect(enPerfil).toHaveAttribute('aria-label', /2 historias nuevas de La Taba 2/);

  await enPerfil.click();
  const modal = page.locator('[data-stories-modal]');
  await expect(modal).toBeVisible();
  await page.locator('[data-close-stories]').click();
  // El foco vuelve al control que se tocó, no al de la otra vista.
  await expect(enPerfil).toBeFocused();

  // Ver una historia en Perfil tiene que apagarla también en la home.
  await expect(page.locator(`${PERFIL_HEAD} [data-stories-slot]`))
    .toHaveAttribute('data-stories-state', 'unseen');
  await expect(entradaHome(page)).toHaveAttribute('data-stories-state', 'unseen');
  await expect(enPerfil).toHaveAttribute('aria-label', /la historia nueva de La Taba 2/);
  await expect(logoHome(page)).toHaveAttribute('aria-label', /la historia nueva de La Taba 2/);
});

test('el buscador ocupa el ancho útil, es táctil y no dispara el zoom de iOS', async ({ page }) => {
  await openHome(page);
  const search = page.locator('[data-view="home"] .taba-home-search');
  const input = search.locator('input');

  const [box, home] = await Promise.all([search.boundingBox(), page.locator('[data-view="home"]').boundingBox()]);
  expect(box.width).toBeGreaterThan(home.width * 0.88);
  expect(box.height).toBeGreaterThanOrEqual(48);
  expect(await input.evaluate((node) => parseFloat(getComputedStyle(node).fontSize))).toBeGreaterThanOrEqual(16);
  await expect(input).toHaveAttribute('placeholder', 'Buscar bebidas, marcas y ofertas…');

  await input.fill('coca');
  await expect(page.locator('[data-view="catalog"]')).toBeVisible();
  await expect(page.locator('[data-product-grid] .product-card').first()).toBeVisible();
});

test('la fila de categorías sólo ofrece rubros que hoy se pueden comprar', async ({ page }) => {
  await openHome(page);
  const chips = page.locator('[data-home-category-strip] [data-category-id]');
  const ids = await chips.evaluateAll((nodes) => nodes.map((node) => node.dataset.categoryId));

  expect(ids[0]).toBe('all');
  // Desde la publicación minorista los rubros con comprables son cervezas y
  // energizantes: las botellas sueltas de gaseosas y mixers esperan precio.
  expect(ids).toContain('cervezas');
  expect(ids).toContain('energizantes');
  expect(ids).not.toContain('gaseosas');
  // Sin precio publicado un rubro no puede ser protagonista de la home.
  expect(ids).not.toContain('whisky');
  expect(ids).not.toContain('fernet');

  // Ninguna categoría de la fila lleva a un catálogo vacío.
  for (const id of ids.filter((candidate) => candidate !== 'all')) {
    await page.locator(`[data-home-category-strip] [data-category-id="${id}"]`).click();
    await expect(page.locator('[data-product-grid] .product-card').first()).toBeVisible();
    await page.goBack();
    await expect(page.locator('[data-view="home"]')).toBeVisible();
  }
});

test('el banner editorial lleva a un destino con producto comprable y no afirma un descuento', async ({ page }) => {
  await openHome(page);
  const banner = page.locator('.home-brand-banner').first();
  await expect(banner).toBeVisible();
  await expect(banner).not.toContainText('%');
  await expect(banner).not.toContainText('$');

  // El destino puede ser de rubro (`data-category-id`) o de marca
  // (`data-brand-query`); lo que NO puede es prometer una compra que el
  // catálogo no respalda (P1-2): al tocarlo tiene que aparecer al menos un
  // producto con "Agregar" habilitado, no una góndola de precios pendientes.
  const destino = await banner.evaluate((node) => node.dataset.categoryId || node.dataset.brandQuery);
  expect(destino).toBeTruthy();
  await banner.click();
  await expect(page.locator('[data-view="catalog"]')).toBeVisible();
  await expect(page.locator('[data-product-grid] [data-add-product]:not([disabled])').first()).toBeVisible();
});

test('el shell de marca es continuo entre las vistas del cliente', async ({ page }) => {
  await openHome(page);
  const leer = () => page.evaluate(() => ({
    vista: document.body.dataset.activeView,
    body: getComputedStyle(document.body).backgroundColor,
    topbar: getComputedStyle(document.querySelector('.topbar')).backgroundColor,
    nav: getComputedStyle(document.querySelector('.mobile-nav')).backgroundColor,
  }));

  const home = await leer();
  // Fondo de marca oscuro, producto sobre GONDOLA. El blanco puro se retiró: sobre
  // grafito recortaba la pantalla como un papel pegado y, sobre todo, era el
  // origen del salto "home premium → formulario blanco genérico", porque cada
  // hoja elegía su propio blanco. Ahora hay una sola superficie de contenido y
  // este test la fija en su valor resuelto, no en un token.
  expect(home.body).toBe(brandSurfaceRgb());
  expect(await page.locator('.home-best-card').first().evaluate((n) => getComputedStyle(n).backgroundColor))
    .toBe(GONDOLA);

  // Navegar NO puede producir un salto negro → blanco: el shell se conserva.
  for (const vista of ['catalog', 'cart', 'profile', 'tracking']) {
    await page.locator(`.mobile-nav [data-nav-view="${vista}"]`).click();
    await expect(page.locator(`[data-view="${vista}"]`)).toBeVisible();
    const actual = await leer();
    expect(actual.vista, `vista ${vista}`).toBe(vista);
    expect(actual.body, `fondo en ${vista}`).toBe(home.body);
    expect(actual.topbar, `barra en ${vista}`).toBe(home.topbar);
    expect(actual.nav, `navegación en ${vista}`).toBe(home.nav);
  }
});

// Lo que hacía sentir "otra aplicación" al tocar Carrito no era el fondo —el
// shell ya era continuo— sino la SUPERFICIE del contenido: la home mostraba una
// vidriera y el carrito un formulario blanco puro, con otra sombra y otro radio.
// Esto fija que la tarjeta de producto, la del carrito y la del perfil sean
// exactamente la misma superficie.
test('la superficie de contenido es la misma en toda la app del cliente', async ({ page }) => {
  await openHome(page);
  const superficie = async (selector) => page.locator(selector).first()
    .evaluate((node) => getComputedStyle(node).backgroundColor);

  expect(await superficie('.home-best-card'), 'tarjeta de la home').toBe(GONDOLA);

  await page.locator('.mobile-nav [data-nav-view="catalog"]').click();
  await expect(page.locator('[data-product-grid] .product-card').first()).toBeVisible();
  expect(await superficie('[data-product-grid] .product-card'), 'tarjeta del catálogo').toBe(GONDOLA);

  await page.locator('[data-product-grid] [data-add-product]:not([disabled])').first().click();
  await page.locator('.mobile-nav [data-nav-view="cart"]').click();
  await expect(page.locator('[data-view="cart"] .cart-card')).toBeVisible();
  expect(await superficie('[data-view="cart"] .cart-card'), 'tarjeta del carrito').toBe(GONDOLA);
  expect(await superficie('[data-view="cart"] .checkout-form'), 'formulario del checkout').toBe(GONDOLA);

  await page.locator('.mobile-nav [data-nav-view="profile"]').click();
  await expect(page.locator('[data-view="profile"] .profile-card').first()).toBeVisible();
  expect(await superficie('[data-view="profile"] .profile-card'), 'tarjeta del perfil').toBe(GONDOLA);
});

test('el panel operativo conserva su superficie clara', async ({ page }) => {
  await openHome(page);
  const home = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  await page.goto('/?demo=1#business');
  await expect(page.locator('[data-view="business"]')).toBeVisible();
  const negocio = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  expect(negocio).not.toBe(home);
});

test('ningún texto de las vistas del cliente queda por debajo de 3:1', async ({ page }) => {
  await openHome(page);
  await page.locator('[data-home-sections] [data-add-product]:not([disabled])').first().click();

  for (const vista of ['home', 'catalog', 'cart', 'profile', 'tracking']) {
    await page.locator(`.mobile-nav [data-nav-view="${vista}"]`).click();
    await expect(page.locator(`[data-view="${vista}"]`)).toBeVisible();
    await page.waitForTimeout(250);
    const malos = await page.evaluate(() => {
      const parse = (v) => {
        const p = String(v).match(/[\d.]+/g);
        if (!p) return null;
        const [r, g, b, a = '1'] = p.map(Number);
        return { r, g, b, a };
      };
      const lum = ({ r, g, b }) => {
        const c = (v) => { const s = v / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; };
        return 0.2126 * c(r) + 0.7152 * c(g) + 0.0722 * c(b);
      };
      const out = [];
      for (const node of document.querySelectorAll('.app-view:not([hidden]) *')) {
        if (![...node.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim().length > 1)) continue;
        const rect = node.getBoundingClientRect();
        if (rect.width < 2 || rect.height < 2) continue;
        const cs = getComputedStyle(node);
        if (cs.visibility === 'hidden' || cs.display === 'none' || Number(cs.opacity) < 0.15) continue;
        const fg = parse(cs.color);
        if (!fg || fg.a < 0.15) continue;
        let bg = null;
        for (let c = node; c; c = c.parentElement) {
          const cand = parse(getComputedStyle(c).backgroundColor);
          if (cand && cand.a >= 0.9) { bg = cand; break; }
        }
        if (!bg) continue;
        const ratio = (Math.max(lum(fg), lum(bg)) + 0.05) / (Math.min(lum(fg), lum(bg)) + 0.05);
        if (ratio < 3) out.push(`${ratio.toFixed(2)}:1 <${node.tagName.toLowerCase()}> "${node.textContent.trim().slice(0, 40)}"`);
      }
      return out;
    });
    expect(malos, `contraste en ${vista}`).toEqual([]);
  }
});

// Los estados VACÍOS son los que ningún recorrido feliz visita, y por eso
// acumulan deuda: el estado "todavía no guardaste favoritos" tenía su título en
// 1,09:1 —invisible— desde antes de esta tarea, porque el bloque no lleva
// `.card` y su tinta, calibrada para papel, caía directo sobre el grafito.
test('los estados vacíos del cliente se apoyan en la superficie de contenido', async ({ page }) => {
  await openHome(page);
  await page.locator('.mobile-nav [data-nav-view="catalog"]').click();
  await page.locator('[data-category-strip] [data-category-id="favorites"]').click();
  const vacio = page.locator('[data-product-grid] .empty-state');
  await expect(vacio).toBeVisible();
  expect(await vacio.evaluate((node) => getComputedStyle(node).backgroundColor)).toBe(GONDOLA);

  const flojos = await page.evaluate(() => {
    const parse = (v) => {
      const p = String(v).match(/[\d.]+/g);
      if (!p) return null;
      const [r, g, b, a = '1'] = p.map(Number);
      return { r, g, b, a };
    };
    const lum = ({ r, g, b }) => {
      const c = (v) => { const s = v / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; };
      return 0.2126 * c(r) + 0.7152 * c(g) + 0.0722 * c(b);
    };
    const out = [];
    for (const node of document.querySelectorAll('[data-product-grid] .empty-state *')) {
      if (![...node.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim().length > 1)) continue;
      const cs = getComputedStyle(node);
      const fg = parse(cs.color);
      if (!fg) continue;
      let bg = null;
      for (let c = node; c; c = c.parentElement) {
        const cand = parse(getComputedStyle(c).backgroundColor);
        if (cand && cand.a >= 0.9) { bg = cand; break; }
      }
      if (!bg) continue;
      const ratio = (Math.max(lum(fg), lum(bg)) + 0.05) / (Math.min(lum(fg), lum(bg)) + 0.05);
      if (ratio < 4.5) out.push(`${ratio.toFixed(2)}:1 "${node.textContent.trim().slice(0, 40)}"`);
    }
    return out;
  });
  expect(flojos, 'texto del estado vacío por debajo de 4,5:1').toEqual([]);
});

// Seguimiento CON pedido, que es el estado que el test de arriba no alcanza:
// sin pedido la vista es una tarjeta vacía y todo su texto vive adentro. Con
// pedido aparecen el titular, su bajada y las etiquetas de la línea de tiempo
// DIRECTAMENTE sobre el shell, y esos tres estaban calibrados para el fondo
// claro que la vista pintaba antes: al soltarlo, el titular quedó en 1,11:1.
// Un texto invisible no es un detalle de color, así que acá se mide.
test('el seguimiento con pedido activo se lee sobre el shell oscuro', async ({ page }) => {
  await openHome(page);
  await page.locator('.mobile-nav [data-nav-view="catalog"]').click();
  await seedCartAboveMinimum(page);
  await page.locator('.mobile-nav [data-nav-view="cart"]').click();

  const direccion = page.locator('[data-profile-checkout] input[type="radio"]').first();
  if (await direccion.count()) await direccion.check();
  await page.locator('[data-checkout-submit]').click();
  await expect(page.locator('[data-view="tracking"] [data-tracking-title]')).toBeVisible();

  const flojos = await page.evaluate(() => {
    const parse = (v) => {
      const p = String(v).match(/[\d.]+/g);
      if (!p) return null;
      const [r, g, b, a = '1'] = p.map(Number);
      return { r, g, b, a };
    };
    const lum = ({ r, g, b }) => {
      const c = (v) => { const s = v / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; };
      return 0.2126 * c(r) + 0.7152 * c(g) + 0.0722 * c(b);
    };
    const out = [];
    for (const node of document.querySelectorAll('[data-view="tracking"] *')) {
      if (![...node.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim().length > 1)) continue;
      const rect = node.getBoundingClientRect();
      if (rect.width < 2 || rect.height < 2) continue;
      const cs = getComputedStyle(node);
      if (cs.visibility === 'hidden' || cs.display === 'none' || Number(cs.opacity) < 0.15) continue;
      const fg = parse(cs.color);
      if (!fg || fg.a < 0.15) continue;
      let bg = null;
      for (let c = node; c; c = c.parentElement) {
        const cand = parse(getComputedStyle(c).backgroundColor);
        if (cand && cand.a >= 0.9) { bg = cand; break; }
      }
      if (!bg) continue;
      const ratio = (Math.max(lum(fg), lum(bg)) + 0.05) / (Math.min(lum(fg), lum(bg)) + 0.05);
      if (ratio < 4.5) out.push(`${ratio.toFixed(2)}:1 "${node.textContent.trim().slice(0, 40)}"`);
    }
    return out;
  });
  expect(flojos, 'texto del seguimiento por debajo de 4,5:1').toEqual([]);

  // Y sus tarjetas son la misma superficie que el resto del cliente.
  expect(await page.locator('.tracking-rider-card').first()
    .evaluate((node) => getComputedStyle(node).backgroundColor)).toBe(GONDOLA);
});

test('el texto de la home cumple el contraste mínimo sobre la superficie oscura', async ({ page }) => {
  await openHome(page, { stories: STORY_FIXTURES });

  const probes = [
    ['[data-home-business-place]', 4.5],
    ['[data-open-status]', 4.5],
    ['.brand-story-circle[data-story-seen="false"] .brand-story-label', 4.5],
    ['.home-hero-promo-copy strong', 4.5],
    ['.home-hero-promo-cta', 4.5],
    ['[data-view="home"] .taba-home-search input', 4.5],
    ['.home-section-head h2', 4.5],
    ['.home-section-head button', 4.5],
    ['.home-section-title small', 4.5],
    ['.home-brand-banner small', 4.5],
    ['.home-brand-banner span', 4.5],
    ['.mobile-nav button.active .mn-label', 4.5],
    ['.mobile-nav button:not(.active) .mn-label', 4.5],
  ];

  for (const [selector, minimum] of probes) {
    const measured = await contrast(page, selector);
    expect(measured, `sin medición para ${selector}`).not.toBeNull();
    expect(measured.ratio, `${selector} → ${measured.ratio}:1`).toBeGreaterThanOrEqual(minimum);
  }
});

test('todo control de la home alcanza 44x44 en los anchos compactos', async ({ page }) => {
  await openHome(page, { stories: STORY_FIXTURES });

  for (const viewport of [{ width: 320, height: 568 }, { width: 360, height: 800 }, PHONE, { width: 412, height: 915 }]) {
    await page.setViewportSize(viewport);
    const undersized = await page.locator('[data-view="home"] button:not([hidden])').evaluateAll((nodes) => nodes
      .filter((node) => node.offsetParent !== null)
      .map((node) => {
        const rect = node.getBoundingClientRect();
        return { html: node.outerHTML.slice(0, 90), width: rect.width, height: rect.height };
      })
      .filter(({ width, height }) => width < 44 || height < 44));
    expect(undersized, `${viewport.width}x${viewport.height}`).toEqual([]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBeTruthy();
  }
});

test('la barra de carrito aparece con productos, respeta la nav y no la tapa', async ({ page }) => {
  await openHome(page);
  const bar = page.locator('[data-floating-cart]');
  await expect(bar).toBeHidden();

  await page.locator('[data-home-sections] [data-add-product]:not([disabled])').first().click();
  await expect(bar).toBeVisible();
  await expect(bar.locator('[data-floating-cart-count]')).toHaveText('1 producto');
  await expect(bar.locator('[data-floating-cart-summary]')).toContainText(/^\$/);

  const [barBox, navBox] = await Promise.all([bar.boundingBox(), page.locator('.mobile-nav').boundingBox()]);
  expect(navBox.y - (barBox.y + barBox.height)).toBeGreaterThanOrEqual(10);
  expect(barBox.height).toBeGreaterThanOrEqual(44);

  await bar.click();
  await expect(page.locator('[data-view="cart"]')).toBeVisible();
});

test('la navegación inferior conserva rutas, contador y estado accesible', async ({ page }) => {
  await openHome(page);
  const nav = page.locator('.mobile-nav');
  await expect(nav.locator('button')).toHaveCount(5);
  // Cinco destinos distintos: ninguno repetido, así `aria-current` apunta a uno.
  for (const vista of ['home', 'catalog', 'cart', 'tracking', 'profile']) {
    await expect(nav.locator(`[data-nav-view="${vista}"]`)).toHaveCount(1);
  }
  await expect(nav.locator('[data-nav-view="home"]')).toHaveAttribute('aria-current', 'page');
  await expect(nav.locator('[data-nav-view="catalog"]')).not.toHaveAttribute('aria-current', 'page');

  await nav.locator('[data-nav-view="catalog"]').click();
  await expect(nav.locator('[data-nav-view="catalog"]')).toHaveAttribute('aria-current', 'page');
  await page.goBack();
  await expect(page.locator('[data-view="home"]')).toBeVisible();
  await expect(nav.locator('[data-nav-view="home"]')).toHaveAttribute('aria-current', 'page');
});

test('con movimiento reducido el aro deja de animarse y el estado sigue siendo legible', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await openHome(page, { stories: STORY_FIXTURES });

  const ring = page.locator(`${HERO} .brand-logo-action .brand-logo-ring`);
  const duration = await ring.evaluate((node) => getComputedStyle(node).animationDuration);
  expect(parseFloat(duration)).toBeLessThanOrEqual(0.01);
  // El aro sigue pintado y los círculos siguen declarando el estado.
  expect(await ring.evaluate((node) => getComputedStyle(node).backgroundImage)).not.toBe('none');
  await expect(page.locator('.brand-story-circle[data-story-seen="false"]')).toHaveCount(2);
});

test('la home no crece sin control en los anchos objetivo', async ({ page }) => {
  for (const viewport of [
    { width: 320, height: 568 },
    { width: 360, height: 800 },
    { width: 390, height: 844 },
    { width: 393, height: 852 },
    { width: 412, height: 915 },
    { width: 768, height: 1024 },
    { width: 1440, height: 1000 },
  ]) {
    await page.setViewportSize(viewport);
    await installBrowserStubs(page);
    await gotoDemoReset(page, '/?reset=1&demo=1');
    await page.waitForSelector('[data-view="home"] .home-best-card');
    const geometry = await page.evaluate(() => ({
      documentWidth: document.documentElement.scrollWidth,
      viewportWidth: window.innerWidth,
      homeHeight: Math.ceil(document.querySelector('[data-view="home"]').getBoundingClientRect().height),
      homeSections: document.querySelectorAll('[data-home-sections] .home-category-section').length,
      homeBanners: [...document.querySelectorAll('[data-view="home"] .home-brand-banner')]
        .filter((node) => getComputedStyle(node).display !== 'none').length,
    }));
    expect(geometry.documentWidth, `${viewport.width}px`).toBeLessThanOrEqual(geometry.viewportWidth + 1);
    // La home pasó de una grilla de vista previa de 4 tarjetas a carruseles por
    // sección de bebidas, así que es deliberadamente más alta. Lo que se
    // controla ya no es un alto arbitrario sino la CANTIDAD de secciones: el
    // tope real vive en HOME_MAX_SECTIONS y este techo lo respalda. Sin ese
    // tope las 11 secciones definidas darían ~4000px y esto volvería a fallar.
    expect(geometry.homeSections, `${viewport.width}px`).toBeLessThanOrEqual(6);
    // Cada tramo puede cerrar con un banner editorial, así que el techo sube con
    // la vidriera: 6 secciones + 6 banners en escritorio. Sigue siendo
    // un techo real —una sección de más lo rompe— y se acompaña del invariante
    // de abajo, que impide que los banners crezcan por su cuenta.
    expect(geometry.homeBanners, `${viewport.width}px`).toBeLessThanOrEqual(geometry.homeSections);
    // El techo subió de 3200 a 3700 con la composición cerrada: la home suma el
    // HERO promocional (270px) y el tramo de "Selección del local" (≈370px), que
    // son piezas del pedido comercial, no crecimiento accidental. Medido da
    // 3539–3559 en los seis anchos de teléfono y 3396–3512 en tablet/escritorio,
    // así que 3700 deja ~140px de holgura para variaciones de copy y NO alcanza
    // para un tramo más: una sección nueva (≈330px) o un banner extra (≈200px)
    // lo rompen, que es exactamente lo que este techo tiene que detectar.
    expect(geometry.homeHeight, `${viewport.width}px`).toBeLessThan(3700);
  }
});

// La vidriera intercalada tiene cuatro reglas que no pueden aflojarse sin que la
// home vuelva a ser un muestrario: un banner no repite un destino que ya tiene
// carrusel, no hay dos destinos iguales, nunca hay dos seguidos y ninguno afirma
// un precio.
//
// Un banner tiene DOS formas de destino y las dos son reales: `data-category-id`
// filtra el catálogo por rubro y `data-brand-query` lo busca por marca. La de
// marca existe porque hay marcas que son un motivo de compra en sí mismas
// (Heineken) y que, metidas dentro del banner de "Cervezas", desaparecían. El
// test las trata igual: lo que se verifica es que el destino traiga producto
// COMPRABLE (P1-2), no de qué clase es.
test('los banners editoriales cortan el ritmo sin repetir destino ni prometer precio', async ({ page }) => {
  await openHome(page);

  const composicion = await page.evaluate(() => {
    const visible = (node) => getComputedStyle(node).display !== 'none';
    const banners = [...document.querySelectorAll('[data-view="home"] .home-brand-banner')].filter(visible);
    const secciones = [...document.querySelectorAll('[data-home-sections] .home-category-section')];
    const destino = (node) => (node.dataset.categoryId
      ? { tipo: 'categoria', valor: node.dataset.categoryId }
      : { tipo: 'marca', valor: node.dataset.brandQuery });
    return {
      destinos: banners.map(destino),
      textos: banners.map((node) => node.textContent.replace(/\s+/g, ' ').trim()),
      seccionesConCarrusel: secciones
        .map((node) => node.querySelector('[data-category-id]')?.dataset.categoryId)
        .filter(Boolean),
      // Dos banners "seguidos" = sin un tramo de producto entre medio.
      adyacentes: banners.filter((node, index) => {
        if (index === 0) return false;
        const previo = banners[index - 1].getBoundingClientRect().bottom;
        return node.getBoundingClientRect().top - previo < 60;
      }).length,
    };
  });

  expect(composicion.destinos.length).toBeGreaterThan(0);
  expect(composicion.adyacentes, 'banners consecutivos').toBe(0);

  // Ningún destino puede quedar sin declarar: un banner sin categoría ni marca
  // sería un botón que no lleva a ninguna parte.
  for (const { tipo, valor } of composicion.destinos) {
    expect(valor, `banner de ${tipo} sin destino`).toBeTruthy();
  }

  const claves = composicion.destinos.map(({ tipo, valor }) => `${tipo}:${valor}`);
  expect(new Set(claves).size, 'destinos repetidos entre banners').toBe(claves.length);

  // Un banner sobre un rubro que ya tiene carrusel gasta un tramo en repetir.
  // Ya no hay excepción de encabezado: ese lugar lo ocupa el hero promocional,
  // así que TODOS los banners viven intercalados y ninguno puede duplicar.
  for (const { tipo, valor } of composicion.destinos.filter((d) => d.tipo === 'categoria')) {
    expect(composicion.seccionesConCarrusel, `banner de ${tipo} ${valor} duplica su carrusel`)
      .not.toContain(valor);
  }

  for (const texto of composicion.textos) {
    expect(texto, 'un banner editorial no puede afirmar importe ni descuento')
      .not.toMatch(/\$|%|\bdescuento\b|\boferta\b|\bpromo\b/i);
  }

  // Ningún banner puede ser un link muerto NI una góndola sin compra: cada
  // destino trae al menos un producto con "Agregar" habilitado (P1-2, el
  // mismo criterio comprable que ya exigía el hero).
  for (const { tipo, valor } of composicion.destinos) {
    const selector = tipo === 'categoria'
      ? `[data-view="home"] .home-brand-banner[data-category-id="${valor}"]`
      : `[data-view="home"] .home-brand-banner[data-brand-query="${valor}"]`;
    await page.locator(selector).click();
    await expect(page.locator('[data-view="catalog"]')).toBeVisible();
    await expect(page.locator('[data-product-grid] [data-add-product]:not([disabled])').first()).toBeVisible();
    await page.goBack();
    await expect(page.locator('[data-view="home"]')).toBeVisible();
  }
});

// El hero promocional es la pieza de apertura de la vidriera. Lo que este
// contrato protege es que sea EDITORIAL y no una promoción disfrazada: puede
// invitar, no puede afirmar un importe ni un descuento que el negocio no
// publicó, y su CTA tiene que caer en producto comprable de verdad.
test('el hero promocional invita sin afirmar precio y su CTA lleva a producto comprable', async ({ page }) => {
  await openHome(page);

  const hero = page.locator('.home-hero-promo');
  await expect(hero).toBeVisible();
  const texto = (await hero.textContent()).replace(/\s+/g, ' ').trim();
  expect(texto, 'el hero no puede afirmar importe ni descuento')
    .not.toMatch(/\$|%|\bdescuento\b|\boferta\b|\bpromo\b|\bantes\b/i);

  // El hero ABRE la vidriera: va antes de los chips y del primer carrusel.
  // Antes vivía después de Destacados y de Combos —a ~1.900px del inicio— o
  // sea que en la práctica no lo veía nadie.
  const [destacados, cajaHero] = await Promise.all([
    page.locator('.home-best-section').boundingBox(),
    hero.boundingBox(),
  ]);
  expect(cajaHero.y, 'el hero abre la vidriera, no la cierra').toBeLessThan(destacados.y);

  // Y el precio lo paga ÉL, no el producto: subirlo no puede empujar el primer
  // precio comprable fuera de la primera pantalla. Se mide contra el pliegue
  // ÚTIL —el alto de la ventana menos la navegación inferior, que es opaca— en
  // el teléfono de referencia. Es el contrato que reemplaza al anterior: no
  // "el hero va último" sino "el hero no se come el precio".
  await page.setViewportSize({ width: 360, height: 800 });
  await page.waitForTimeout(300);
  const pliegue = await page.evaluate(() => {
    const nav = document.querySelector('.mobile-nav');
    const alto = nav && getComputedStyle(nav).display !== 'none'
      ? nav.getBoundingClientRect().height
      : 0;
    const precio = [...document.querySelectorAll('.home-best-copy span')]
      .find((node) => /\$/.test(node.textContent || ''));
    const cta = document.querySelector('[data-add-product]');
    return {
      util: Math.round(window.innerHeight - alto),
      precio: precio ? Math.round(precio.getBoundingClientRect().bottom + window.scrollY) : null,
      cta: cta ? Math.round(cta.getBoundingClientRect().bottom + window.scrollY) : null,
    };
  });
  expect(pliegue.precio, 'no hay precio en la vidriera').not.toBeNull();
  expect(pliegue.precio, 'el primer precio quedó abajo del pliegue').toBeLessThanOrEqual(pliegue.util);
  expect(pliegue.cta, 'el primer "Agregar" quedó abajo del pliegue').toBeLessThanOrEqual(pliegue.util);

  await page.setViewportSize(PHONE);
  await page.waitForTimeout(200);
  await hero.click();
  await expect(page.locator('[data-view="catalog"]')).toBeVisible();
  await expect(page.locator('[data-product-grid] [data-add-product]:not([disabled])').first()).toBeVisible();
});
