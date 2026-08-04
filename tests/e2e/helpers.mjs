import { expect } from '@playwright/test';

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
    source: 'manual',
    isDefault: defaultAddressId
      ? (address.id || `${namespace}-address-${String(index + 1).padStart(2, '0')}`) === defaultAddressId
      : hasExplicitDefault ? address.isDefault === true : index === 0,
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
    await paymentField.selectOption(requestedPaymentExists ? payment : 'coordinate');
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
