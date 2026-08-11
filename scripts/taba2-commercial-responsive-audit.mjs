/*
 * Auditoría responsive del storefront comercial: 320, 360, 390 y 432.
 *
 * El auditor de superficie (`taba2-commercial-audit.mjs`) mira color y
 * contraste. Éste mira GEOMETRÍA, que es lo que se rompe al angostar:
 *
 *   · desborde horizontal del documento y de cada elemento;
 *   · objetivo táctil por debajo de 44px —contando el label que envuelve al
 *     control, que es lo que el dedo toca de verdad, no el input de 20px;
 *   · campos con tipografía menor a 16px, que en iOS hacen zoom solos al
 *     enfocarlos y dejan el formulario corrido;
 *   · acción principal tapada por la barra inferior fija CON EL SCROLL AL
 *     FONDO, que es la única forma de que algo quede realmente inalcanzable.
 *
 * Uso:
 *   node scripts/realtime-relay.mjs 8231 &
 *   OUT=artifacts/taba2-commercial-audit/before node scripts/taba2-commercial-responsive-audit.mjs
 *
 * Variables: BASE, OUT, WIDTHS, ENGINE (chromium|webkit).
 */
import { chromium, webkit } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const BASE = process.env.BASE || 'http://127.0.0.1:8231';
const OUT = path.resolve(process.env.OUT || 'artifacts/taba2-commercial-audit/responsive');
const WIDTHS = (process.env.WIDTHS || '320,360,390,432').split(',').map(Number);
const ENGINE = process.env.ENGINE === 'webkit' ? webkit : chromium;
const ENGINE_NAME = process.env.ENGINE === 'webkit' ? 'webkit' : 'chromium';
const HEIGHTS = { 320: 720, 360: 800, 390: 844, 414: 896, 432: 960 };
const TAP_MIN = 44;

const PROBE = (tapMin) => {
  const doc = document.documentElement;
  const ancho = doc.clientWidth;
  const visible = (el) => {
    const style = getComputedStyle(el);
    if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) < 0.05) return false;
    const box = el.getBoundingClientRect();
    return box.width > 1 && box.height > 1;
  };
  const etiqueta = (el) => {
    const clase = typeof el.className === 'string' ? el.className.trim().split(/\s+/).slice(0, 2).join('.') : '';
    return el.tagName.toLowerCase() + (clase ? `.${clase}` : '');
  };
  const texto = (el) => (el.textContent || el.getAttribute?.('aria-label') || el.placeholder || el.name || '').trim().slice(0, 30);
  // Lo que el dedo toca: un checkbox de 20px dentro de un label de 48px es un
  // objetivo de 48px. Medir el input suelto reporta un problema que no existe.
  const objetivo = (el) => {
    const envoltorio = el.closest('label, .profile-address-card, .radio-card, .option-card');
    return (envoltorio && envoltorio !== el ? envoltorio : el).getBoundingClientRect();
  };
  /*
   * Un rail horizontal (vidriera, combos, chips de categoría) tiene contenido
   * más ancho que la pantalla A PROPÓSITO: se arrastra con el dedo. Medirlo
   * contra el viewport reporta cientos de "desbordes" que son el diseño
   * funcionando. Lo que sí es un defecto es que ese contenido empuje el ancho
   * del DOCUMENTO, y eso lo mide `doc.scrollWidth` aparte.
   */
  /*
   * Un elemento que no pinta nada no puede verse desbordar. El aro de historias
   * de Perfil, por ejemplo, es un span transparente de 90px que sin historias
   * publicadas no dibuja nada y asoma tres pixeles fuera del viewport: no es un
   * defecto visible ni genera scroll, y reportarlo tapa lo que sí importa.
   */
  const pintaAlgo = (el) => {
    const style = getComputedStyle(el);
    const fondo = style.backgroundColor;
    const opaco = fondo && !/rgba\(0, 0, 0, 0\)|transparent/.test(fondo);
    const conBorde = ['Top', 'Right', 'Bottom', 'Left']
      .some((lado) => parseFloat(style[`border${lado}Width`]) > 0 && style[`border${lado}Style`] !== 'none');
    const conTexto = [...el.childNodes].some((nodo) => nodo.nodeType === 3 && nodo.textContent.trim());
    const conImagen = style.backgroundImage !== 'none' || ['IMG', 'SVG', 'CANVAS', 'VIDEO'].includes(el.tagName);
    return opaco || conBorde || conTexto || conImagen || style.boxShadow !== 'none';
  };

  const enRailHorizontal = (el) => {
    for (let cursor = el.parentElement; cursor && cursor !== document.body; cursor = cursor.parentElement) {
      const style = getComputedStyle(cursor);
      if (['auto', 'scroll'].includes(style.overflowX) && cursor.scrollWidth > cursor.clientWidth + 1) return true;
    }
    return false;
  };

  /*
   * `getBoundingClientRect` de un elemento ROTADO devuelve la caja alineada a
   * los ejes que lo contiene, no lo que se ve. El aro de historias es un
   * cuadrado de 64px enmascarado en círculo y girando sin parar: a 45° su caja
   * mide 90px y "asoma" trece pixeles que nadie puede ver, porque la máscara
   * recorta el círculo mucho antes. Un elemento transformado se salta acá; si
   * de verdad empujara la página, `doc.scrollWidth` lo delataría igual.
   */
  const transformado = (el) => {
    for (let cursor = el; cursor && cursor !== document.body; cursor = cursor.parentElement) {
      const style = getComputedStyle(cursor);
      if (style.transform !== 'none' || style.rotate !== 'none' || style.scale !== 'none') return true;
    }
    return false;
  };

  // La capa de arriba: con una ficha o una hoja abierta, lo de atrás no se
  // toca. Además el shell de atrás se dibuja con una escala de profundidad, y
  // medir objetivos táctiles ahí devuelve 43px donde el CSS dice 44.
  const capa = document.querySelector('.modal-card:not([hidden])')
    || document.querySelector('[data-catalog-filters][open]')
    || null;

  const hallazgos = [];
  const vistos = new Set();
  const agregar = (tipo, detalle) => {
    const clave = `${tipo}|${detalle}`;
    if (vistos.has(clave)) return;
    vistos.add(clave);
    hallazgos.push(`[${tipo}] ${detalle}`);
  };

  const raiz = capa
    ? [capa]
    : [...document.querySelectorAll('.app-view:not([hidden]), .mobile-nav, .app-topbar, [data-app-recovery]:not([hidden]), .floating-cart-cta')];

  raiz.forEach((contenedor) => {
    if (contenedor.closest('[data-view="business"], [data-view="rider"], .sandbox-tools-panel')) return;
    [contenedor, ...contenedor.querySelectorAll('*')].forEach((el) => {
      if (!visible(el)) return;
      if (el.closest('details:not([open])')) return;
      const box = el.getBoundingClientRect();

      if ((box.right > ancho + 1 || box.left < -1) && !enRailHorizontal(el) && pintaAlgo(el) && !transformado(el)) {
        agregar('DESBORDE', `${etiqueta(el)} x=[${Math.round(box.left)},${Math.round(box.right)}] ancho=${ancho} "${texto(el)}"`);
      }

      if (el.matches('button, a[href], [role="button"], select, summary, input, textarea')) {
        if (el.matches('input[type="hidden"]')) return;
        const tap = objetivo(el);
        if (tap.height < tapMin - 0.5) {
          agregar('TAP', `${Math.round(tap.width)}x${Math.round(tap.height)} ${etiqueta(el)} "${texto(el)}"`);
        }
      }

      if (el.matches('input:not([type="checkbox"]):not([type="radio"]):not([type="hidden"]), select, textarea')) {
        const size = parseFloat(getComputedStyle(el).fontSize);
        if (size < 16) agregar('ZOOM-IOS', `${size}px ${etiqueta(el)} "${texto(el)}"`);
      }
    });
  });

  return { overflow: doc.scrollWidth - doc.clientWidth, hallazgos };
};

/*
 * ¿Hay alguna acción que el dedo no pueda alcanzar?
 *
 * Se prueba TOCÁNDOLA, no midiéndola. La geometría sola miente en las dos
 * direcciones: una hoja inferior puede cruzarse con la barra de navegación y
 * estar por encima —el toque llega igual—, y un elemento bien ubicado puede
 * estar debajo de un overlay invisible.
 *
 * "Alcanzable" quiere decir que EXISTE una posición de scroll donde el toque
 * llega, no que llegue desde donde está la página ahora. Por eso cada acción se
 * lleva al centro de la pantalla antes de tocarla: es lo que hace cualquier
 * persona antes de apretar un botón.
 *
 * Se miran las acciones de la capa de ARRIBA. Con una hoja abierta, el catálogo
 * de atrás está tapado a propósito y no es un hallazgo.
 */
const PROBE_ALCANCE = () => {
  const capa = document.querySelector('.modal-card:not([hidden])')
    || document.querySelector('[data-catalog-filters][open]')
    || document.querySelector('.app-view:not([hidden])');
  if (!capa) return [];

  const ACCIONES = [
    '.primary-button', '.secondary-button', '.danger-button', '.add-button', '.home-add-button',
    '[type="submit"]', '[data-add-product]', '[data-profile-action]', '[data-checkout-action]',
    'input:not([type="hidden"])', 'select', 'textarea',
  ].join(',');

  const nombre = (nodo) => {
    const clase = typeof nodo?.className === 'string' ? nodo.className.trim().split(/\s+/)[0] : '';
    return nodo ? `${nodo.tagName.toLowerCase()}${clase ? `.${clase}` : ''}` : 'nada';
  };

  const inalcanzables = [];
  capa.querySelectorAll(ACCIONES).forEach((el) => {
    const style = getComputedStyle(el);
    if (style.display === 'none' || style.visibility === 'hidden' || style.pointerEvents === 'none') return;
    if (el.disabled || el.closest('[hidden]') || el.closest('details:not([open])')) return;
    const inicial = el.getBoundingClientRect();
    if (inicial.height < 1 || inicial.width < 1) return;

    el.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'instant' });
    const box = el.getBoundingClientRect();
    const x = Math.min(Math.max(box.left + box.width / 2, 1), window.innerWidth - 1);
    const y = Math.min(Math.max(box.top + box.height / 2, 1), window.innerHeight - 1);
    const encima = document.elementFromPoint(x, y);
    if (encima && (encima === el || el.contains(encima) || encima.contains(el))) return;
    inalcanzables.push(`${nombre(el)} "${(el.textContent || el.name || '').trim().slice(0, 30)}" — el toque cae en ${nombre(encima)}`);
  });
  return [...new Set(inalcanzables)];
};

const lineas = [];
const browser = await ENGINE.launch();

for (const width of WIDTHS) {
  const context = await browser.newContext({
    viewport: { width, height: HEIGHTS[width] || 844 },
    locale: 'es-AR',
    serviceWorkers: 'block',
  });
  const page = await context.newPage();
  page.on('pageerror', (error) => lineas.push(`  !! pageerror: ${error.message}`));
  await page.goto(`${BASE}/?reset=1&demo=1`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('[data-view="home"] .home-best-card', { timeout: 25_000 });
  await page.waitForTimeout(900);

  const pasos = [
    ['home', async () => {}],
    ['catalogo', async () => { await hash(page, 'catalog'); }],
    ['filtros', async () => {
      await page.locator('[data-catalog-filters] summary').first().click().catch(() => {});
      await page.waitForTimeout(600);
    }],
    ['filtros-cerrar', async () => {
      await page.locator('[data-close-catalog-filters]').first().click().catch(() => {});
      await page.waitForTimeout(400);
    }],
    ['producto', async () => {
      await page.locator('[data-product-grid] [data-product-detail]').first().click().catch(() => {});
      await page.waitForTimeout(800);
    }],
    ['producto-cerrar', async () => { await page.keyboard.press('Escape'); await page.waitForTimeout(400); }],
    ['carrito-vacio', async () => { await hash(page, 'cart'); }],
    ['carrito', async () => {
      await hash(page, 'catalog');
      const adds = page.locator('[data-product-grid] [data-add-product]:not([disabled])');
      const total = Math.min(await adds.count(), 3);
      for (let i = 0; i < total; i += 1) { await adds.nth(i).click().catch(() => {}); await page.waitForTimeout(260); }
      await hash(page, 'cart');
    }],
    ['checkout', async () => {
      await page.locator('[data-checkout-form]').first().scrollIntoViewIfNeeded().catch(() => {});
      await page.waitForTimeout(600);
    }],
    ['perfil', async () => { await hash(page, 'profile'); }],
    ['perfil-datos', async () => {
      await page.locator('[data-profile-action="edit-personal"]').first().click().catch(() => {});
      await page.waitForTimeout(700);
    }],
    ['perfil-direccion', async () => {
      await page.keyboard.press('Escape').catch(() => {});
      await hash(page, 'profile');
      await page.locator('[data-profile-action="add-address"]').first().click().catch(() => {});
      await page.waitForTimeout(900);
    }],
    ['seguimiento', async () => {
      await page.keyboard.press('Escape').catch(() => {});
      await hash(page, 'tracking');
      await page.waitForTimeout(700);
    }],
  ];

  for (const [nombre, correr] of pasos) {
    await correr().catch(() => {});
    if (nombre.endsWith('-cerrar')) continue;
    // Medir con una transición corriendo devuelve la caja INTERMEDIA: así un
    // botón de 44px se reportaba como 43 y mandaba a buscar un defecto de CSS
    // que no existía. Se espera a que no quede ninguna animación viva.
    await page.waitForFunction(
      () => !document.getAnimations().some((animation) => animation.playState === 'running' && animation.effect?.getTiming?.().iterations !== Infinity),
      null,
      { timeout: 4000 },
    ).catch(() => {});
    const { overflow, hallazgos } = await page.evaluate(PROBE, TAP_MIN);
    const inalcanzables = await page.evaluate(PROBE_ALCANCE);
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.waitForTimeout(200);

    const total = hallazgos.length + inalcanzables.length + (overflow > 0 ? 1 : 0);
    lineas.push(`\n### ${width}px · ${nombre} — ${total} hallazgos${overflow > 0 ? ` · OVERFLOW ${overflow}px` : ''}`);
    hallazgos.forEach((linea) => lineas.push(`  ${linea}`));
    inalcanzables.forEach((linea) => lineas.push(`  [INALCANZABLE] ${linea}`));
  }

  await context.close();
}

await browser.close();
mkdirSync(OUT, { recursive: true });
const informe = lineas.join('\n');
writeFileSync(path.join(OUT, `responsive-${ENGINE_NAME}.md`), `${informe}\n`, 'utf8');
console.log(informe);

async function hash(page, view) {
  await page.evaluate((value) => { window.location.hash = `#${value}`; }, view);
  await page.waitForTimeout(800);
}
