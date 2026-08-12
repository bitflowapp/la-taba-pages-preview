/*
 * Lo que la auditoría responsive no puede ver: el contenido extremo.
 *
 * `taba2-commercial-responsive-audit.mjs` recorre seis anchos y da cero
 * hallazgos, pero lo hace sobre el catálogo demo, donde ningún nombre es largo
 * y ningún precio tiene siete cifras. Un comercio real carga «Cerveza Artesanal
 * Patagonia Amber Lager Edición Limitada Barril Roble 1 Litro» y vende una caja
 * de $ 9.999.999, y ahí es donde una grilla se desborda.
 *
 * Tres cosas más que sólo se ven con el contenido puesto:
 *   · el teclado abierto, que en un teléfono se come la mitad de la pantalla y
 *     es el momento en que el botón de confirmar tiene que seguir alcanzable;
 *   · la vuelta de Mercado Pago con sus parámetros colgados de la URL;
 *   · el producto agotado y el de precio pendiente, que dibujan avisos que no
 *     existen en el camino feliz.
 *
 * Backend de mentira: no se toca Mercado Pago ni se crea ningún pedido.
 */
import { expect, test } from '@playwright/test';

const SUPABASE_URL = 'https://taba-stress-responsive.supabase.co';
const BUSINESS_ID = '00000000-0000-4000-8000-000000000001';

function producto({ id, name, price, stock = 40, priceStatus = 'confirmed', variant = 'Lata 473 ml', sortOrder = 1 }) {
  return {
    id,
    external_id: id.slice(-8),
    sku: id.slice(-8),
    name,
    brand: 'Patagonia',
    description: 'Producto verificado por el comercio.',
    category: 'Bebidas',
    subcategory: '',
    variant,
    presentation: variant,
    capacity_value: 473,
    capacity_unit: 'ml',
    capacity: '473 ml',
    packaging_type: 'lata',
    units_per_pack: 1,
    price,
    price_status: priceStatus,
    stock,
    available: stock > 0,
    chilled: true,
    is_alcoholic: true,
    minimum_age: 18,
    image_url: '/assets/products/beverage-placeholder.svg',
    image_sha256: '',
    image_thumbnail_url: '/assets/products/beverage-placeholder.svg',
    image_thumbnail_sha256: '',
    source_image_sha256: '',
    tags: [],
    sort_order: sortOrder,
    is_active: true,
    is_verified: true,
  };
}

const NOMBRE_INTERMINABLE = 'Cerveza Artesanal Patagonia Amber Lager Edición Limitada Barril de Roble Añejada Doce Meses 1 Litro';
const CATALOGO = [
  producto({
    id: '30000000-0000-4000-8000-000000000001',
    name: NOMBRE_INTERMINABLE,
    price: 9_999_999,
    variant: 'Barril de roble 1 L · presentación con nombre larguísimo',
    sortOrder: 1,
  }),
  producto({
    id: '30000000-0000-4000-8000-000000000002',
    name: 'Agotada Total Sin Stock Ninguno Disponible Hoy',
    price: 123_456,
    stock: 0,
    sortOrder: 2,
  }),
  producto({
    id: '30000000-0000-4000-8000-000000000003',
    name: 'Sin Precio Publicado Todavía Por El Comercio',
    price: null,
    priceStatus: 'pending',
    sortOrder: 3,
  }),
];

const COMERCIO = {
  id: BUSINESS_ID,
  name: 'La Taba 2',
  address: 'Mendoza 827, Neuquén',
  currency_code: 'ARS',
  ordering_enabled: true,
  ordering_verified: true,
  delivery_enabled: true,
  pickup_enabled: true,
  delivery_fee: 900,
  minimum_delivery_subtotal: 0,
  is_active: true,
  status: 'open',
};

async function instalarBackend(page) {
  await page.route(`${SUPABASE_URL}/**`, async (route) => {
    const url = new URL(route.request().url());
    const json = (body, headers = {}) => route.fulfill({
      status: 200, contentType: 'application/json', headers, body: JSON.stringify(body),
    });
    if (url.pathname.includes('/rest/v1/products')) return json(CATALOGO);
    if (url.pathname.includes('/rest/v1/businesses')) return json(COMERCIO);
    if (url.pathname.includes('/rest/v1/rpc/get_public_business_contact')) {
      return json([{ whatsapp_number: '', whatsapp_verified: false }]);
    }
    if (url.pathname.includes('/rest/v1/rpc/get_mercadopago_checkout_availability')) return json({ available: false });
    if (url.pathname.includes('/auth/v1/')) {
      return json({
        access_token: 'test-access-token',
        refresh_token: 'test-refresh-token',
        token_type: 'bearer',
        expires_in: 3600,
        expires_at: Math.floor(Date.now() / 1000) + 3600,
        user: { id: '10000000-0000-4000-8000-000000000001', is_anonymous: true, aud: 'authenticated' },
      });
    }
    return json([], { 'content-range': '0-0/0' });
  });
  await page.addInitScript(({ supabaseUrl, businessId }) => {
    globalThis.__LA_TABA_RUNTIME_CONFIG__ = {
      mode: 'production',
      repository: { provider: 'supabase', supabaseUrl, publishableKey: 'sb_publishable_test_key', businessId },
    };
  }, { supabaseUrl: SUPABASE_URL, businessId: BUSINESS_ID });
}

async function esperarCatalogo(page) {
  await expect(page.locator('body')).toHaveAttribute('data-app-mode', 'production');
  await expect
    .poll(() => page.evaluate(async () => {
      const { getState } = await import('/js/state.js');
      return getState().products.length;
    }), { timeout: 20_000 })
    .toBeGreaterThan(0);
}

/** Desborde del DOCUMENTO, que es el único que la persona sufre. */
async function desborde(page) {
  return page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
}

/** Qué elementos se salen de la pantalla por la derecha. */
async function culpables(page) {
  return page.evaluate(() => {
    const ancho = document.documentElement.clientWidth;
    const fuera = [];
    document.querySelectorAll('[data-view]:not([hidden]) *').forEach((el) => {
      const cs = getComputedStyle(el);
      if (cs.display === 'none' || cs.visibility === 'hidden') return;
      // Un riel horizontal desborda A PROPÓSITO: se arrastra con el dedo. Lo
      // que importa es que no empuje el ancho del documento, y eso ya lo mide
      // `desborde()`.
      if (el.closest('[data-rail], .home-rail, .category-rail, .story-rail')) return;
      const r = el.getBoundingClientRect();
      if (r.width > 0 && r.right > ancho + 1) {
        const clase = typeof el.className === 'string' ? el.className.trim().split(/\s+/)[0] : '';
        fuera.push(`${el.tagName.toLowerCase()}${clase ? `.${clase}` : ''} right=${Math.round(r.right)} > ${ancho}`);
      }
    });
    return [...new Set(fuera)].slice(0, 10);
  });
}

test.describe('contenido extremo y pantallas chicas', () => {
  test.describe.configure({ timeout: 120_000 });

  for (const ancho of [320, 432]) {
    test(`nombres larguísimos y precios de siete cifras no desbordan a ${ancho}px`, async ({ page }) => {
      await page.setViewportSize({ width: ancho, height: ancho === 320 ? 720 : 960 });
      await instalarBackend(page);
      await page.goto('/#catalog');
      await esperarCatalogo(page);
      await page.waitForTimeout(1_200);

      expect(await desborde(page), `catálogo · ${(await culpables(page)).join(' | ')}`).toBeLessThanOrEqual(0);
      /*
       * Y el nombre está PUESTO en una tarjeta que se ve. La otra forma de no
       * desbordar es esconder lo que el comercio publicó, y eso no cuenta como
       * arreglo. Se cuenta sobre las tarjetas con caja —las vistas inactivas
       * siguen en el documento con el mismo texto—, no con un `toBeVisible`
       * suelto, que resolvería contra la primera copia oculta.
       */
      const enPantalla = await page.evaluate((fragmento) => {
        const tarjetas = [...document.querySelectorAll('[data-product-grid] .product-card')];
        return {
          vistaActiva: document.body.dataset.activeView,
          tarjetas: tarjetas.length,
          conElNombre: tarjetas.filter((c) => c.offsetParent !== null && c.textContent.includes(fragmento)).length,
        };
      }, NOMBRE_INTERMINABLE.slice(0, 40));
      expect(enPantalla.conElNombre, `el nombre largo no llegó a ninguna tarjeta visible · ${JSON.stringify(enPantalla)}`).toBeGreaterThan(0);

      await page.evaluate(async (id) => {
        const { addToCart } = await import('/js/cart.js');
        addToCart(id, 3);
      }, CATALOGO[0].id);
      await page.goto('/#cart');
      await expect(page.locator('[data-checkout-form]')).toBeVisible();
      await page.waitForTimeout(800);

      expect(await desborde(page), `carrito · ${(await culpables(page)).join(' | ')}`).toBeLessThanOrEqual(0);

      // Tres unidades de $ 9.999.999 dan ocho cifras. El total tiene que estar
      // escrito entero y caber: un importe recortado en el carrito es la clase
      // de detalle que frena una compra.
      const total = await page.evaluate(() => {
        const nodo = document.querySelector('[data-cart-total-small]');
        if (!nodo) return null;
        const caja = nodo.getBoundingClientRect();
        return {
          texto: (nodo.textContent || '').trim(),
          cabe: nodo.scrollWidth <= nodo.clientWidth + 1 && caja.right <= document.documentElement.clientWidth + 1,
        };
      });
      expect(total, 'no se encontró el total del carrito').not.toBeNull();
      expect(total.texto.replace(/\D/g, ''), `el total no muestra el importe completo: "${total.texto}"`).toContain('29999997');
      expect(total.cabe, `el total se recorta o se sale: "${total.texto}"`).toBe(true);
    });
  }

  test('con el teclado abierto el botón de confirmar sigue alcanzable', async ({ page }) => {
    // Un teléfono con el teclado desplegado deja menos de la mitad del alto.
    // Es el momento exacto en que una barra inferior fija puede tapar la acción
    // principal y dejar la compra sin salida.
    await page.setViewportSize({ width: 320, height: 720 });
    await instalarBackend(page);
    await page.goto('/#catalog');
    await esperarCatalogo(page);
    await page.evaluate(async (id) => {
      const { addToCart } = await import('/js/cart.js');
      addToCart(id, 1);
    }, CATALOGO[0].id);
    await page.goto('/#cart');
    await expect(page.locator('[data-checkout-form]')).toBeVisible();

    await page.setViewportSize({ width: 320, height: 380 });
    await page.waitForTimeout(700);

    const alcance = await page.evaluate(() => {
      const boton = document.querySelector('[data-checkout-submit]');
      if (!boton) return { ok: false, motivo: 'no hay botón de confirmar' };
      boton.scrollIntoView({ block: 'center', behavior: 'instant' });
      const caja = boton.getBoundingClientRect();
      const x = Math.min(Math.max(caja.left + caja.width / 2, 1), window.innerWidth - 1);
      const y = Math.min(Math.max(caja.top + caja.height / 2, 1), window.innerHeight - 1);
      const encima = document.elementFromPoint(x, y);
      const nombre = (n) => (n ? `${n.tagName.toLowerCase()}.${String(n.className || '').split(' ')[0]}` : 'nada');
      return {
        ok: !!encima && (encima === boton || boton.contains(encima) || encima.contains(boton)),
        motivo: `el toque cae en ${nombre(encima)}`,
        alto: window.innerHeight,
      };
    });

    expect(alcance.ok, `con 380px de alto, ${alcance.motivo}`).toBe(true);
    expect(await desborde(page)).toBeLessThanOrEqual(0);
  });

  test('la vuelta de Mercado Pago con sus parámetros no desborda ni pierde el checkout', async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 720 });
    await instalarBackend(page);
    await page.goto('/#catalog');
    await esperarCatalogo(page);
    await page.evaluate(async (id) => {
      const { addToCart } = await import('/js/cart.js');
      addToCart(id, 2);
    }, CATALOGO[0].id);

    await page.goto('/?collection_status=rejected&status=rejected&payment_id=1234567890&preference_id=abc-123#cart');
    await page.locator('html[data-taba-startup="ready"]').waitFor({ state: 'attached' });
    await page.waitForTimeout(1_200);

    await expect(page.locator('[data-checkout-form]')).toBeVisible();
    expect(await desborde(page), `retorno de pago · ${(await culpables(page)).join(' | ')}`).toBeLessThanOrEqual(0);
    expect(await page.evaluate(async () => {
      const { getState } = await import('/js/state.js');
      return getState().cart.length;
    })).toBe(1);
  });

  test('agotado y precio pendiente avisan sin desbordar, y no se pueden comprar', async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 720 });
    await instalarBackend(page);
    await page.goto('/#catalog');
    await esperarCatalogo(page);
    await page.waitForTimeout(1_200);

    expect(await desborde(page), `avisos · ${(await culpables(page)).join(' | ')}`).toBeLessThanOrEqual(0);

    const agotado = page.locator(`[data-add-product="${CATALOGO[1].id}"]`);
    await expect(agotado).toBeDisabled();

    // Precio pendiente: se puede tener en el carrito, pero el pedido no sale.
    // Lo que NO puede pasar nunca es que se cobre cero.
    const conPrecio = await page.evaluate(async (ids) => {
      const { getState } = await import('/js/state.js');
      const productos = getState().products;
      return ids.map((id) => {
        const p = productos.find((x) => String(x.id) === id);
        return { id, precio: p?.price ?? null, pendiente: !!p?.pricePending };
      });
    }, [CATALOGO[2].id]);
    expect(conPrecio[0].pendiente, 'el producto sin precio publicado no quedó marcado como pendiente').toBe(true);
    expect(conPrecio[0].precio === 0, 'un producto sin precio publicado quedó valuado en cero').toBe(false);
  });
});
