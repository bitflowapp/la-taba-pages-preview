import { expect } from '@playwright/test';
import { brandSurfaceRgb } from '../../scripts/brand-surface.mjs';

/*
 * LA INVITACIÓN A INSTALAR, CALLADA.
 *
 * En un teléfono sin decidir, la tienda ofrece instalarse a los pocos segundos
 * de arrancar: es el comportamiento pedido y `pwa-install.spec.mjs` lo prueba
 * entero. Para cualquier OTRA prueba es una variable ajena —y en `mobile-webkit`
 * era una hoja modal que aparecía a mitad de un checkout—, así que el arnés
 * corre como quien YA respondió.
 *
 * No es un interruptor de prueba: `TABA_INSTALL_PROMPT_V1` es exactamente el
 * estado que deja alguien que tocó "Ahora no". La entrada del Perfil sigue
 * visible, igual que para esa persona.
 */
export async function skipInstallInvitation(page) {
  await page.addInitScript(() => {
    try {
      localStorage.setItem('TABA_INSTALL_PROMPT_V1', JSON.stringify({
        v: 1,
        decision: 'declined',
        at: '2026-01-01T00:00:00.000Z',
        platform: 'e2e',
      }));
    } catch (_) {
      // Sin almacenamiento no hay nada que sembrar y tampoco nada que romper.
    }
  });
}

export async function installBrowserStubs(page) {
  await page.addInitScript(() => {
    window.__openedUrls = [];
    window.__clipboardText = '';
    window.open = (...args) => {
      window.__openedUrls.push(String(args[0] || ''));
      return null;
    };
    const clipboardStub = {
      writeText: async (text) => {
        window.__clipboardText = String(text);
      },
      readText: async () => window.__clipboardText,
    };
    try {
      Object.defineProperty(navigator, 'clipboard', {
        configurable: true,
        value: navigator.clipboard ? {
          ...navigator.clipboard,
          writeText: async (text) => {
            window.__clipboardText = String(text);
          },
          readText: async () => window.__clipboardText,
        } : clipboardStub,
      });
    } catch (_) {
      navigator.clipboard = clipboardStub;
    }
    localStorage.clear();
    sessionStorage.clear();
  });
  // DESPUÉS del bloque de arriba, no antes: `addInitScript` corre en orden de
  // registro y ese bloque termina vaciando el almacenamiento. Sembrar primero
  // sería sembrar en algo que se borra un renglón más abajo.
  await skipInstallInvitation(page);
}

// El panel del negocio usa cuatro destinos fijos en móvil (Pedidos · Métricas
// · Caja · Local). Catálogo, Promociones, Reportes, Configuración y Guía viven
// dentro de "Local". En escritorio siguen en la fila superior, así que este
// helper abre el destino sólo cuando hace falta.
export async function openBusinessSection(page, selector) {
  const target = page.locator(selector);
  if (!(await target.isVisible().catch(() => false))) {
    await page.locator('[data-business-view="local"]').click();
    await target.waitFor({ state: 'visible' });
  }
  await target.click();
}

export async function gotoDemoReset(page, target) {
  const requestedUrl = new URL(target, 'http://taba.invalid');
  const resetRequested = requestedUrl.searchParams.has('reset')
    || requestedUrl.searchParams.has('demo-reset');
  try {
    await page.goto(target, { waitUntil: 'domcontentloaded' });
  } catch (error) {
    const interrupted = /ERR_ABORTED|frame was detached|navigation.*interrupted/i.test(String(error?.message || error));
    if (!resetRequested || !interrupted) throw error;
  }
  if (resetRequested) {
    await page.waitForURL((url) => (
      !url.searchParams.has('reset') && !url.searchParams.has('demo-reset')
    ), { waitUntil: 'domcontentloaded' });
  }
  await page.waitForLoadState('load');
  await page.locator('html[data-taba-startup="ready"]').waitFor({ state: 'attached' });
}

/**
 * Mide un conjunto de controles recién cuando el layout dejó de moverse.
 *
 * Por qué existe: la home pinta un esqueleto y ~350 ms después reemplaza el
 * subárbol entero con los carruseles definitivos. Un `locator.count()` seguido
 * de un `locator.evaluateAll()` son dos viajes distintos al navegador; si el
 * reemplazo cae entre medio, el segundo mide element handles que ya quedaron
 * fuera del documento, y `getBoundingClientRect()` de un nodo desconectado
 * devuelve 0×0. Eso producía "todos los controles miden 0" sin que hubiera
 * nada roto en la página — en WebKit fallaba 6 de cada 20 corridas.
 *
 * Acá la consulta y la medición ocurren en el mismo turno de JS, así que no hay
 * ventana donde un handle pueda quedar viejo, y antes de medir se espera a que
 * lo que mueve la geometría haya terminado: fuentes, imágenes visibles y dos
 * frames; después se sondea hasta repetir la misma medición en tres frames
 * seguidos. Si no se estabiliza dentro del presupuesto, lanza: una home que no
 * asienta es un fallo real, no algo para tragarse en silencio.
 */
export async function measureStableControls(page, selector, { maxFrames = 180 } = {}) {
  const measurement = await page.evaluate(async ({ sel, budget }) => {
    const nextFrame = () => new Promise((resolve) => requestAnimationFrame(resolve));

    await document.fonts.ready;

    // Visible es visible en LOS DOS EJES. El filtro sólo miraba el vertical, y
    // en un carrusel horizontal eso incluye las tarjetas que están a la derecha
    // del pantallazo: su imagen es `loading="lazy"`, el navegador nunca la pide,
    // y `decode()` sobre una imagen que jamás se carga no resuelve ni rechaza.
    // Con el rail de tres tarjetas nunca se notó porque todas entraban a lo
    // ancho; con ocho, WebKit se quedaba colgado hasta agotar el test.
    const visibleImages = [...document.images].filter((image) => {
      const rect = image.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0
        && rect.bottom > 0 && rect.top < window.innerHeight
        && rect.right > 0 && rect.left < window.innerWidth;
    });
    await Promise.all(visibleImages.map((image) => image.decode().catch(() => undefined)));

    await nextFrame();
    await nextFrame();

    const sample = () => {
      const nodes = [...document.querySelectorAll(sel)];
      return nodes.map((node) => {
        const rect = node.getBoundingClientRect();
        return {
          selector: node.outerHTML.slice(0, 120),
          width: rect.width,
          height: rect.height,
          connected: node.isConnected,
        };
      });
    };
    const signature = (rows) => JSON.stringify(rows.map((r) => [
      Math.round(r.width * 100), Math.round(r.height * 100), r.connected,
    ]));

    let current = sample();
    let stableFor = 0;
    for (let frame = 0; frame < budget; frame += 1) {
      await nextFrame();
      const next = sample();
      if (signature(next) === signature(current)) {
        stableFor += 1;
        if (stableFor >= 3) {
          return {
            controls: next,
            scrollWidth: document.documentElement.scrollWidth,
            innerWidth: window.innerWidth,
            stabilizedAfter: frame + 1,
          };
        }
      } else {
        stableFor = 0;
      }
      current = next;
    }
    return { unstable: true, frames: budget, controls: current };
  }, { sel: selector, budget: maxFrames });

  if (measurement.unstable) {
    throw new Error(
      `El layout no se estabilizó en ${measurement.frames} frames: `
      + `${measurement.controls.length} controles seguían cambiando de geometría.`,
    );
  }
  return measurement;
}

export async function clickAfterScrollSettles(page, locator, options) {
  await locator.scrollIntoViewIfNeeded();
  await page.evaluate(() => new Promise((resolve) => {
    let previousX = window.scrollX;
    let previousY = window.scrollY;
    let stableFrames = 0;

    const inspect = () => {
      const nextX = window.scrollX;
      const nextY = window.scrollY;
      stableFrames = nextX === previousX && nextY === previousY ? stableFrames + 1 : 0;
      previousX = nextX;
      previousY = nextY;
      if (stableFrames >= 3) resolve();
      else requestAnimationFrame(inspect);
    };

    requestAnimationFrame(inspect);
  }));
  await locator.click(options);
}

export function installPageGuards(page) {
  const errors = [];
  const badResponses = [];

  page.on('pageerror', (error) => {
    errors.push(error);
  });

  page.on('console', (message) => {
    if (message.type() === 'error') {
      const text = message.text();
      if (!text.includes('Failed to load resource') && !text.includes('Service Worker')) {
        errors.push(new Error(text));
      }
    }
  });

  page.on('response', (response) => {
    const status = response.status();
    if (status >= 400) {
      const request = response.request();
      const url = response.url();
      const resourceType = request.resourceType();
      if (resourceType !== 'xhr' && resourceType !== 'fetch') {
        badResponses.push(`${status} ${resourceType} ${url}`);
      }
    }
  });

  return {
    errors,
    badResponses,
    async assertClean() {
      expect(errors, errors.map((error) => error.message)).toEqual([]);
      expect(badResponses, badResponses.join('\n')).toEqual([]);
    },
  };
}

export async function waitForToast(page, text) {
  await expect(page.locator('[data-toast]')).toContainText(text);
}

// ===== Arnés del checkout basado en Perfil =====
// El checkout dejó de tener inputs de cliente y dirección: esos datos son
// autoridad exclusiva del Perfil. El arnés siembra un Perfil sandbox sintético
// y después usa la interfaz real para elegir dirección. Nunca escribe campos
// ocultos del pedido ni recrea los inputs retirados.

export const SANDBOX_PROFILE_STORAGE_PREFIX = 'la-taba-sandbox-profile';

export const DEFAULT_CHECKOUT_ADDRESSES = Object.freeze([
  { label: 'Casa', street: 'Avenida Argentina', streetNumber: '450', city: 'Neuquén Capital', reference: 'Portón negro, timbre 2' },
  { label: 'Trabajo', street: 'Julio Argentino Roca', streetNumber: '1220', city: 'Neuquén Capital', reference: 'Oficina 4B' },
  { label: 'Casa de mamá', street: 'Diagonal 9 de Julio', streetNumber: '87', city: 'Neuquén Capital', reference: '' },
  { label: 'Depto centro', street: 'General Manuel Belgrano', streetNumber: '333', city: 'Neuquén Capital', reference: '' },
]);

const EXTRA_CHECKOUT_ADDRESSES = Object.freeze([
  { label: 'Quinta', street: 'Antártida Argentina', streetNumber: '2140', city: 'Neuquén Capital' },
  { label: 'Estudio', street: 'Avenida Olascoaga', streetNumber: '755', city: 'Neuquén Capital' },
  { label: 'Cabaña', street: 'Río Limay', streetNumber: '64', city: 'Neuquén Capital' },
  { label: 'Depósito', street: 'Doctor Ramón', streetNumber: '1890', city: 'Neuquén Capital' },
  { label: 'Casa de Ana', street: 'Independencia', streetNumber: '512', city: 'Neuquén Capital' },
  { label: 'Consultorio', street: 'Santa Fe', streetNumber: '145', city: 'Neuquén Capital' },
]);

// Una dirección de entrega usable tiene punto confirmado: sin él el checkout la
// bloquea, que es el contrato. El arnés siembra ese punto por defecto y deja
// pedir lo contrario cuando la prueba quiere justamente ver el bloqueo.
export const SEEDED_CONFIRMED_AT = '2026-08-08T18:00:00.000Z';
const SEEDED_POINT = Object.freeze({ latitude: -38.945584, longitude: -68.040579 });
const SEEDED_POINT_STEP = 0.001;

export function seededConfirmedPoint(index = 0) {
  return {
    latitude: Number((SEEDED_POINT.latitude + index * SEEDED_POINT_STEP).toFixed(6)),
    longitude: Number((SEEDED_POINT.longitude - index * SEEDED_POINT_STEP).toFixed(6)),
    geolocationAccuracy: 18,
    locationSource: 'map_pin',
    locationConfirmedAt: SEEDED_CONFIRMED_AT,
  };
}

/**
 * Completa el paso obligatorio «Confirmá dónde te entregamos» en el editor de
 * direcciones del Perfil, por el camino que NO pide permiso de ubicación: se
 * abre el mapa, se acepta el pin y se confirma. Es lo que hace una persona que
 * no quiere compartir su GPS, y sirve para cualquier prueba que sólo necesite
 * una dirección guardable.
 */
export async function confirmDeliveryLocationInProfile(page) {
  const step = page.locator('[data-location-step]');
  await expect(step).toBeVisible();
  if ((await step.getAttribute('data-location-status')) !== 'confirmed') {
    if ((await step.getAttribute('data-location-status')) === 'empty') {
      await step.locator('[data-profile-action="open-location-map"]').click();
    }
    await step.locator('[data-profile-action="confirm-location"]').click();
  }
  await expect(step).toHaveAttribute('data-location-status', 'confirmed');
}

export function buildCheckoutAddresses(count, namespace = 'demo') {
  const base = [...DEFAULT_CHECKOUT_ADDRESSES, ...EXTRA_CHECKOUT_ADDRESSES];
  return base.slice(0, Math.max(0, count)).map((address, index) => ({
    ...address,
    id: `${namespace}-address-${String(index + 1).padStart(2, '0')}`,
    isDefault: index === 0,
  }));
}

/**
 * Prepara un Perfil sintético en el almacenamiento sandbox y refresca el
 * checkout mediante la API real del módulo. No accede a Supabase ni a la red,
 * y no manipula inputs retirados.
 */
export async function seedCheckoutProfile(page, {
  name = 'Cliente Demo',
  phone = '2990000001',
  addresses = DEFAULT_CHECKOUT_ADDRESSES,
  defaultAddressId = '',
  namespace = 'demo',
  confirmedLocation = true,
} = {}) {
  const list = addresses || [];
  // `namespace` mantiene IDs sintéticos únicos por escenario. La autoridad
  // persistida, en cambio, usa los namespaces reales de la aplicación.
  const storageNamespace = namespace === 'showcase' ? 'showcase' : 'demo';
  const hasExplicitDefault = list.some((address) => address.isDefault === true);
  const normalized = list.map((address, index) => ({
    id: address.id || `${namespace}-address-${String(index + 1).padStart(2, '0')}`,
    label: address.label || 'Otro',
    street: address.street || '',
    streetNumber: address.streetNumber || '',
    city: address.city || 'Neuquén Capital',
    floor: address.floor || '',
    apartment: address.apartment || '',
    reference: address.reference || '',
    province: address.province || '',
    postalCode: address.postalCode || '',
    isDefault: defaultAddressId
      ? (address.id || `${namespace}-address-${String(index + 1).padStart(2, '0')}`) === defaultAddressId
      : hasExplicitDefault ? address.isDefault === true : index === 0,
    ...(confirmedLocation ? seededConfirmedPoint(index) : { source: 'manual' }),
  }));

  await page.evaluate(async ({ key, snapshot }) => {
    localStorage.setItem(key, JSON.stringify(snapshot));
    try {
      const module = await import(new URL('js/customer-delivery.js', location.href).href);
      await module.refreshCustomerDeliveryCheckout?.();
    } catch (_) {
      // El módulo puede no estar montado aún; el checkout hidrata al abrirse.
    }
  }, {
    key: `${SANDBOX_PROFILE_STORAGE_PREFIX}:${storageNamespace}`,
    snapshot: {
      profile: { id: `${namespace}-customer`, name, phone, updatedAt: '' },
      addresses: normalized,
    },
  });

  return normalized;
}

/**
 * Selecciona una dirección usando la interfaz real. Expande el listado compacto
 * si hace falta y verifica que la selección haya quedado activa. Nunca cambia
 * cuál es la dirección predeterminada.
 */
export async function selectCheckoutAddress(page, { id = '', label = '' } = {}) {
  const list = page.locator('[data-profile-checkout] .profile-address-list');
  await expect(list).toBeVisible();
  const card = id
    ? list.locator(`.profile-address-card[data-customer-address-id="${id}"]`)
    : list.locator('.profile-address-card', { hasText: label });

  if ((await card.count()) === 0) {
    const toggle = page.locator('[data-profile-checkout-action="toggle-addresses"]');
    if (await toggle.count()) await toggle.click();
  }
  await expect(card).toHaveCount(1);
  const radio = card.locator('input[type="radio"]');
  await radio.check();
  await expect(radio).toBeChecked();
  return card;
}

/**
 * Compatibilidad deliberada: varios specs siguen pasando `name`, `phone`,
 * `street` y `neighborhood`. En vez de recrear los inputs retirados, esos
 * valores se traducen a un Perfil y una dirección sandbox antes de abrir el
 * checkout. Sólo se completan los campos que todavía pertenecen al checkout:
 * modalidad, pago e indicaciones.
 */
export async function fillCheckout(page, {
  name,
  phone,
  address,
  street,
  neighborhood,
  reference,
  notes,
  payment = 'cash',
  deliveryMode = 'delivery',
  addresses,
  namespace = 'demo',
} = {}) {
  await expect(page.locator('[data-cart-list] .cart-item')).not.toHaveCount(0);
  const streetLine = street ?? address ?? '';
  const parsed = splitStreetLine(streetLine);
  const seededAddresses = addresses ?? (streetLine
    ? [{
      id: `${namespace}-address-01`,
      label: 'Casa',
      street: parsed.street,
      streetNumber: parsed.streetNumber,
      city: neighborhood ?? 'Neuquén Capital',
      reference: reference ?? '',
      isDefault: true,
    }]
    : DEFAULT_CHECKOUT_ADDRESSES);

  const seeded = await seedCheckoutProfile(page, {
    name: name ?? 'Cliente Demo',
    phone: phone ?? '2990000001',
    addresses: seededAddresses,
    namespace,
  });

  if (deliveryMode === 'delivery') {
    await page.getByLabel('Delivery').check();
    if (seeded.length) await selectCheckoutAddress(page, { id: seeded[0].id });
  } else {
    await page.getByLabel('Retiro en local').check();
  }

  const paymentField = page.getByLabel('Forma de pago');
  if (await paymentField.count()) {
    const requestedPaymentExists = await paymentField.locator(`option[value="${payment}"]`).count();
    // El repliegue a 'coordinate' era MUDO, y eso escondía una divergencia real:
    // cinco specs pedían 'transfer' —un valor que el CHECK de la base no acepta
    // y que el checkout ya no ofrece— y seguían en verde ejercitando otra forma
    // de pago, con el nombre equivocado escrito al lado. Un test que dice que
    // prueba una cosa y prueba otra es peor que uno que falla.
    if (!requestedPaymentExists) {
      throw new Error(
        `El checkout no ofrece la forma de pago "${payment}". Las válidas salen del CHECK `
        + 'orders_payment_method_valid (ver tests/payment-methods-contract.test.mjs): '
        + 'elegí una que exista en vez de dejar que el helper la reemplace en silencio.',
      );
    }
    await paymentField.selectOption(payment);
  }

  const instructions = page.locator('.checkout-instructions');
  if (await instructions.count() && !(await instructions.evaluate((node) => node.open))) {
    await instructions.locator('summary').click();
  }
  const notesField = page.getByLabel(/Observaciones del pedido|Notas/);
  if (await notesField.count()) await notesField.fill(notes ?? '');
}

function splitStreetLine(value) {
  const clean = String(value || '').trim();
  const match = clean.match(/^(.*\D)\s+(\d+[A-Za-z]?)$/);
  if (!match) return { street: clean || 'Avenida Argentina', streetNumber: '100' };
  return { street: match[1].trim(), streetNumber: match[2].trim() };
}

export async function openFirstProductModal(page) {
  await page.locator('[data-product-grid] [data-product-detail]').first().click();
  await expect(page.locator('[data-product-modal]')).toBeVisible();
}

/**
 * Arma un carrito que supera el mínimo de delivery.
 *
 * Desde la publicación minorista la góndola es toda de unidades y ninguna
 * llega sola al mínimo del comercio: el producto más caro son $ 3.900 contra
 * un mínimo de $ 5.000. Antes alcanzaba con un clic porque el primer producto
 * comprable era un pack de proveedor de $ 17.100. Dos unidades del más barato
 * ($ 2.925) ya lo superan, así que el helper agrega una y suma la segunda con
 * el mismo control de cantidad de la tarjeta.
 */
export async function seedCartAboveMinimum(page, selector = '[data-product-grid] [data-add-product]:not([disabled])') {
  // `visible=true` importa: las vistas ocultas siguen en el DOM con los mismos
  // data-*, así que un locator suelto puede quedarse esperando un control del
  // rail de la home mientras el catálogo está a la vista.
  const add = page.locator(`${selector} >> visible=true`).first();
  await add.waitFor({ state: 'visible' });
  const productId = await add.getAttribute('data-add-product');
  await add.click();
  await page.locator(`[data-cart-inc="${productId}"] >> visible=true`).first().click();
  return productId;
}

/*
 * El contrato visual de la tienda comercial, medido y no mirado.
 *
 * Nació con el P1 del retorno desde Mercado Pago y vive acá porque ahora lo
 * afirman dos suites —el retorno desde el pago y la recuperación del worker
 * ante un borde degradado— y tienen que exigir exactamente lo mismo. Si una
 * afloja, afloja la otra: el defecto que las dos cierran es el mismo.
 *
 * Se miden geometría y color COMPUTADOS, no presencia de nodos: el estado roto
 * conservaba el `<link>` y hasta `link.sheet`; lo que no había eran reglas, así
 * que cualquier `toBeVisible` pasaba sobre una tienda apagada.
 */
export const FONDO_COMERCIAL = brandSurfaceRgb();

export async function medirExperienciaComercial(page) {
  return page.evaluate(() => {
    const el = (s) => document.querySelector(s);
    const ancho = (s) => { const n = el(s); return n ? Math.round(n.getBoundingClientRect().width) : -1; };
    const link = el('link[href^="styles.css"]');

    let reglas = -1;
    let importsVivos = -1;
    let importsTotales = -1;
    const importsPerdidos = [];
    try {
      reglas = link.sheet.cssRules.length;
      const imports = [...link.sheet.cssRules].filter((r) => r.type === CSSRule.IMPORT_RULE);
      importsTotales = imports.length;
      importsVivos = 0;
      imports.forEach((r) => {
        let vivo = false;
        try { vivo = !!(r.styleSheet && r.styleSheet.cssRules.length > 0); } catch (_) { vivo = false; }
        if (vivo) importsVivos += 1;
        else importsPerdidos.push(String(r.href || '').split('/').pop().split('?')[0]);
      });
    } catch (_) { /* la hoja no está disponible: queda en -1 y la prueba lo dice */ }

    const icono = el('.mobile-nav svg');
    return {
      fondo: getComputedStyle(document.body).backgroundColor,
      navPosicion: el('.mobile-nav') ? getComputedStyle(el('.mobile-nav')).position : 'SIN-NODO',
      navAncho: ancho('.mobile-nav'),
      iconoAncho: icono ? Math.round(parseFloat(getComputedStyle(icono).width)) : -1,
      marcaAncho: ancho('.brand'),
      barraSuperiorPosicion: el('.topbar') ? getComputedStyle(el('.topbar')).position : 'SIN-NODO',
      reglas,
      importsVivos,
      importsTotales,
      importsPerdidos,
      scrollWidth: document.documentElement.scrollWidth,
      innerWidth: window.innerWidth,
      productos: document.querySelectorAll('[data-product-grid] [data-add-product]').length,
      arranque: document.documentElement.dataset.tabaStartup || null,
      vistaActiva: document.body.dataset.activeView || null,
      workerControlando: !!navigator.serviceWorker.controller,
    };
  });
}

export function esperarExperienciaComercial(medida, contexto) {
  const detalle = `${contexto}\n${JSON.stringify(medida, null, 2)}`;

  // La cadena de estilos entera, viva. Un `<link>` presente con la hoja en cero
  // reglas era exactamente el estado roto que nadie detectaba.
  expect(medida.reglas, `la hoja principal quedó sin reglas · ${detalle}`).toBeGreaterThan(0);
  expect(medida.importsPerdidos, `hojas perdidas de la cadena · ${detalle}`).toEqual([]);
  expect(medida.importsVivos, `cadena de @import incompleta · ${detalle}`).toBe(medida.importsTotales);
  expect(medida.importsTotales, `la cadena de @import desapareció · ${detalle}`).toBeGreaterThan(0);

  // La identidad comercial.
  expect(medida.fondo, `se perdió la superficie de marca · ${detalle}`).toBe(FONDO_COMERCIAL);

  // El layout comercial: la barra inferior fijada al borde y el chrome a escala.
  expect(medida.navPosicion, `la barra inferior se despegó del borde · ${detalle}`).toBe('fixed');
  expect(medida.barraSuperiorPosicion, `la barra superior perdió su anclaje · ${detalle}`).toBe('sticky');
  expect(medida.iconoAncho, `iconos sobredimensionados · ${detalle}`).toBeGreaterThan(0);
  expect(medida.iconoAncho, `iconos sobredimensionados · ${detalle}`).toBeLessThanOrEqual(28);
  expect(medida.marcaAncho, `la marca quedó sobredimensionada · ${detalle}`).toBeLessThanOrEqual(120);

  // Sin desborde horizontal: el estado roto medía 424 sobre 390.
  expect(medida.scrollWidth, `apareció desborde horizontal · ${detalle}`).toBeLessThanOrEqual(medida.innerWidth);

  expect(medida.arranque, `la aplicación no llegó a arrancar · ${detalle}`).toBe('ready');
}
