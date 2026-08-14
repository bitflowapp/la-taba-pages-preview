/*
 * El pulido de lanzamiento, medido sobre la aplicación real.
 *
 * Cuatro personas y un puñado de contratos que no se pueden afirmar mirando una
 * captura:
 *   A · alguien que compra por primera vez ve el formulario COMPLETO;
 *   B · alguien que ya compró ve un resumen y llega a confirmar en menos pasos;
 *   C · si un precio cambió desde el pedido anterior, se dice ANTES de repetir;
 *   D · si un producto ya no está, se nombra: nunca desaparece en silencio.
 *
 * Más el acuse del toque: un toque suma uno, y una tanda rápida suma exactamente
 * la cantidad de veces que se tocó.
 */
import { expect, test } from '@playwright/test';
import {
  DEFAULT_CHECKOUT_ADDRESSES,
  gotoDemoReset,
  installBrowserStubs,
  installPageGuards,
  seedCheckoutProfile,
} from './helpers.mjs';

const HISTORY_KEY = 'la_taba_customer_history_v1';

/*
 * Siembra un pedido anterior REAL: los SKU salen del catálogo vivo y pasan por
 * la misma compuerta que usa la revalidación de la recompra. Sembrar productos
 * que la góndola no vende produciría un pedido "todo no disponible" y el test
 * mediría otra cosa que la que dice medir.
 */
async function sembrarPedidoAnterior(page, { factorDePrecio = 1, cantidad = 2 } = {}) {
  const pedido = await page.evaluate(async ({ factor, unidades }) => {
    const { getState } = await import(new URL('js/state.js', location.href).href);
    const { isProductOrderable } = await import(new URL('js/core/catalog-store.js', location.href).href);
    const comprables = getState().products
      .filter((product) => isProductOrderable(product) && Number(product.stock) >= unidades)
      .slice(0, 2);
    if (comprables.length < 2) throw new Error('El catálogo demo no tiene dos productos comprables.');
    const items = comprables.map((product, index) => ({
      productId: product.id,
      name: product.name,
      quantity: index === 0 ? unidades : 1,
      unitPrice: Math.round(Number(product.price) * (index === 0 ? factor : 1)),
      unit: product.unit || 'unidad',
    }));
    return {
      pedido: {
        id: 'LT-9001',
        createdAt: '2026-08-07T21:12:00.000Z',
        status: 'delivered',
        deliveryMode: 'delivery',
        paymentMethod: 'Efectivo al recibir',
        paymentMethodCode: 'cash',
        address: 'Avenida Argentina 450, Neuquén Capital',
        items,
        subtotal: 0,
        deliveryFee: 0,
        discountTotal: 0,
        total: items.reduce((acc, item) => acc + item.quantity * item.unitPrice, 0),
      },
      productos: comprables.map((product) => ({ id: product.id, name: product.name, price: product.price })),
    };
  }, { factor: factorDePrecio, unidades: cantidad });

  // Como guion de INICIALIZACIÓN y no con `evaluate`: `installBrowserStubs`
  // deja instalado un guion que vacía el almacenamiento en cada navegación, así
  // que un valor escrito ahora se perdería en la recarga. Los guiones corren en
  // orden de registro: primero el que limpia, después éste.
  await page.addInitScript(({ key, entrada }) => {
    localStorage.setItem(key, JSON.stringify([entrada]));
  }, { key: HISTORY_KEY, entrada: pedido.pedido });
  return pedido;
}

async function recargarConHistorial(page) {
  await page.reload({ waitUntil: 'load' });
  await page.locator('html[data-taba-startup="ready"]').waitFor({ state: 'attached' });
}

async function irACarrito(page) {
  await page.locator('[data-nav-view="cart"] >> visible=true').first().click();
  await page.locator('body[data-active-view="cart"]').waitFor({ state: 'attached' });
}

// ============================================================================
// Persona A — primera compra
// ============================================================================

test('Persona A · sin pedidos anteriores el checkout se muestra completo', async ({ page }) => {
  const guards = installPageGuards(page);
  await installBrowserStubs(page);
  await gotoDemoReset(page, '/?reset=1&demo=1');
  await seedCheckoutProfile(page, { addresses: DEFAULT_CHECKOUT_ADDRESSES });

  await page.locator('[data-nav-view="catalog"] >> visible=true').first().click();
  const agregar = page.locator('[data-product-grid] [data-add-product]:not([disabled]) >> visible=true').first();
  const productId = await agregar.getAttribute('data-add-product');
  await agregar.click();
  await page.locator(`[data-cart-inc="${productId}"] >> visible=true`).first().click();
  await irACarrito(page);

  // Sin historial no hay nada que recordar: se piden todos los datos.
  await expect(page.locator('[data-checkout-summary-rows]')).toHaveCount(0);
  await expect(page.locator('[data-profile-checkout] .profile-address-list')).toBeVisible();
  await expect(page.getByLabel('Forma de pago')).toBeVisible();
  await expect(page.getByLabel('Delivery')).toBeVisible();
  // Y el encabezado no promete una brevedad que este formulario no tiene.
  await expect(page.locator('.checkout-heading > span')).toHaveText('Para entregarte el pedido');
  await expect(page.locator('.checkout-heading')).not.toContainText('pocos pasos');

  await guards.assertClean();
});

// ============================================================================
// Persona B — cliente recurrente
// ============================================================================

test('Persona B · con un pedido anterior el checkout resume lo conocido y deja cambiarlo', async ({ page }) => {
  const guards = installPageGuards(page);
  await installBrowserStubs(page);
  await gotoDemoReset(page, '/?reset=1&demo=1');
  await sembrarPedidoAnterior(page);
  await recargarConHistorial(page);
  await seedCheckoutProfile(page, { name: 'Marco', phone: '2990000123', addresses: DEFAULT_CHECKOUT_ADDRESSES });

  // El atajo vive en la home y se alcanza sin recorrerla entera: va justo
  // después del primer carrusel comprable, no al final de la página.
  const tarjeta = page.locator('[data-customer-actions] .reorder-card');
  await expect(tarjeta).toBeVisible();
  const posicion = await tarjeta.evaluate((node) => ({
    top: node.getBoundingClientRect().top + window.scrollY,
    pagina: document.documentElement.scrollHeight,
  }));
  expect(posicion.top).toBeLessThan(posicion.pagina * 0.6);

  await tarjeta.locator('[data-repeat-order]').click();
  await irACarrito(page);

  // Los tres renglones del resumen, con su salida a "Cambiar" cada uno.
  const filas = page.locator('[data-checkout-summary-row]');
  await expect(filas).toHaveCount(3);
  await expect(page.locator('[data-checkout-summary-row="delivery"]')).toContainText('Casa');
  await expect(page.locator('[data-checkout-summary-row="contact"]')).toContainText('Marco');
  // El teléfono se resume; el número entero no viaja a una captura de pantalla.
  await expect(page.locator('[data-checkout-summary-row="contact"]')).toContainText('•••123');
  await expect(page.locator('[data-checkout-summary-row="contact"]')).not.toContainText('2990000123');
  // La preferencia de pago del pedido anterior queda propuesta y A LA VISTA.
  await expect(page.locator('[data-checkout-summary-row="payment"]')).toContainText('Efectivo al recibir');
  await expect(page.getByLabel('Forma de pago')).toHaveValue('cash');

  // Menos formulario, mismo destino: el botón de confirmar sigue estando.
  await expect(page.locator('[data-checkout-form] .profile-address-list')).toHaveCount(0);
  await expect(page.locator('[data-checkout-submit]')).toBeVisible();

  await guards.assertClean();
});

test('Persona B · el resumen es corto de verdad: mide menos que el formulario completo', async ({ page }) => {
  await installBrowserStubs(page);
  await gotoDemoReset(page, '/?reset=1&demo=1');
  await sembrarPedidoAnterior(page);
  await recargarConHistorial(page);
  await seedCheckoutProfile(page, { addresses: DEFAULT_CHECKOUT_ADDRESSES });

  await page.locator('[data-customer-actions] .reorder-card [data-repeat-order]').click();
  await irACarrito(page);

  const medir = () => page.locator('[data-checkout-form]').evaluate((form) => ({
    alto: Math.round(form.getBoundingClientRect().height),
    campos: [...form.querySelectorAll('input, select, textarea')]
      .filter((node) => node.type !== 'hidden' && node.getBoundingClientRect().height > 0).length,
  }));

  const compacto = await medir();
  await page.locator('[data-checkout-summary-row="delivery"] [data-profile-checkout-action="expand-summary"]').click();
  await expect(page.locator('[data-checkout-summary-rows]')).toHaveCount(0);
  const completo = await medir();

  expect(compacto.alto).toBeLessThan(completo.alto);
  expect(compacto.campos).toBeLessThan(completo.campos);
});

test('CHANGE ADDRESS · "Cambiar" devuelve el checkout entero, no un renglon suelto', async ({ page }) => {
  const guards = installPageGuards(page);
  await installBrowserStubs(page);
  await gotoDemoReset(page, '/?reset=1&demo=1');
  await sembrarPedidoAnterior(page);
  await recargarConHistorial(page);
  await seedCheckoutProfile(page, { addresses: DEFAULT_CHECKOUT_ADDRESSES });

  await page.locator('[data-customer-actions] .reorder-card [data-repeat-order]').click();
  await irACarrito(page);
  await page.locator('[data-checkout-summary-row="delivery"] [data-profile-checkout-action="expand-summary"]').click();

  // Un resumen que se abre por partes deja a la persona sin saber qué quedó
  // plegado, y en una compra eso se paga confirmando algo que no se vio.
  await expect(page.locator('[data-profile-checkout] .profile-address-list')).toBeVisible();
  await expect(page.getByLabel('Forma de pago')).toBeVisible();
  await expect(page.getByLabel('Delivery')).toBeVisible();

  // Y se puede elegir otra dirección de verdad.
  const otra = page.locator('.profile-address-card', { hasText: 'Trabajo' });
  await otra.locator('input[type="radio"]').check();
  await expect(otra.locator('input[type="radio"]')).toBeChecked();

  await guards.assertClean();
});

// ============================================================================
// Persona C — cambió el precio
// ============================================================================

test('Persona C · si el precio cambio, la recompra lo dice y muestra los dos totales', async ({ page }) => {
  const guards = installPageGuards(page);
  await installBrowserStubs(page);
  await gotoDemoReset(page, '/?reset=1&demo=1');
  // El pedido anterior se pagó 14% más barato: hoy el total es otro.
  const { pedido } = await sembrarPedidoAnterior(page, { factorDePrecio: 0.86 });
  await recargarConHistorial(page);

  const tarjeta = page.locator('[data-customer-actions] .reorder-card');
  await expect(tarjeta).toBeVisible();
  await expect(tarjeta.locator('[data-reorder-notices]')).toContainText('Cambió algún precio');

  // Nunca sólo el total nuevo: el anterior está al lado, tachado.
  const anterior = tarjeta.locator('[data-reorder-previous-total]');
  await expect(anterior).toBeVisible();
  await expect(anterior).toContainText(String(Math.floor(pedido.total / 1000)));
  await expect(anterior).toHaveCSS('text-decoration-line', 'line-through');

  // Y el carrito se arma con el precio de HOY, no con el histórico.
  await tarjeta.locator('[data-repeat-order]').click();
  const totales = await page.evaluate(async () => {
    const { getState } = await import(new URL('js/state.js', location.href).href);
    const estado = getState();
    return estado.cart.map((linea) => {
      const producto = estado.products.find((p) => p.id === linea.productId);
      return { productId: linea.productId, cantidad: linea.quantity, precioVigente: producto.price };
    });
  });
  totales.forEach((linea) => {
    const historico = pedido.items.find((item) => item.productId === linea.productId);
    if (historico && historico.unitPrice !== linea.precioVigente) {
      expect(linea.precioVigente).not.toBe(historico.unitPrice);
    }
  });

  await guards.assertClean();
});

// ============================================================================
// Persona D — un producto ya no está
// ============================================================================

test('Persona D · un producto que ya no se vende se nombra: no desaparece en silencio', async ({ page }) => {
  const guards = installPageGuards(page);
  await installBrowserStubs(page);
  await gotoDemoReset(page, '/?reset=1&demo=1');
  const { productos } = await sembrarPedidoAnterior(page);

  await recargarConHistorial(page);
  // Se apaga el primero de los dos productos del pedido anterior, por el mismo
  // camino que usaría el comercio: deja de ser ordenable.
  await page.evaluate(async (id) => {
    const { getState, setState } = await import(new URL('js/state.js', location.href).href);
    setState({
      products: getState().products.map((product) => (
        product.id === id ? { ...product, available: false, stock: 0 } : product
      )),
    });
  }, productos[0].id);

  const avisos = page.locator('[data-customer-actions] .reorder-card [data-reorder-notices]');
  await expect(avisos).toBeVisible();
  // El nombre del producto, no un conteo anónimo.
  await expect(avisos).toContainText(productos[0].name);
  await expect(avisos).not.toContainText('producto(s)');

  await guards.assertClean();
});

// ============================================================================
// Acuse del toque
// ============================================================================

test('ADD · un toque suma uno y una tanda rapida suma exactamente lo que se toco', async ({ page }) => {
  const guards = installPageGuards(page);
  await installBrowserStubs(page);
  await gotoDemoReset(page, '/?reset=1&demo=1');
  await page.locator('[data-nav-view="catalog"] >> visible=true').first().click();

  const agregar = page.locator('[data-product-grid] [data-add-product]:not([disabled]) >> visible=true').first();
  const productId = await agregar.getAttribute('data-add-product');
  await agregar.click();

  const cantidad = () => page.evaluate(async (id) => {
    const { getState } = await import(new URL('js/state.js', location.href).href);
    return getState().cart.find((linea) => linea.productId === id)?.quantity || 0;
  }, productId);

  expect(await cantidad()).toBe(1);

  // Seis toques deliberados y rápidos: seis unidades. La guarda contra el doble
  // despacho accidental no puede comerse toques que una persona sí dio.
  const mas = page.locator(`[data-cart-inc="${productId}"] >> visible=true`).first();
  for (let i = 0; i < 6; i += 1) {
    await mas.click();
    await page.waitForTimeout(60);
  }
  expect(await cantidad()).toBe(7);

  // Bajar hasta cero deja el control en su estado inicial, sin línea fantasma.
  const menos = page.locator(`[data-cart-dec="${productId}"] >> visible=true`).first();
  for (let i = 0; i < 7; i += 1) {
    await menos.click();
    await page.waitForTimeout(60);
  }
  expect(await cantidad()).toBe(0);
  await expect(page.locator(`[data-add-product="${productId}"] >> visible=true`).first()).toBeVisible();

  await guards.assertClean();
});

test('ADD · el sello de confirmacion nunca tapa el "+"', async ({ page }) => {
  await installBrowserStubs(page);
  await gotoDemoReset(page, '/?reset=1&demo=1');
  await page.locator('[data-nav-view="catalog"] >> visible=true').first().click();

  const agregar = page.locator('[data-product-grid] [data-add-product]:not([disabled]) >> visible=true').first();
  const productId = await agregar.getAttribute('data-add-product');
  await agregar.click();

  // Medido DURANTE el sello: es el único momento en que el defecto existía.
  const medida = await page.evaluate((id) => {
    const inc = [...document.querySelectorAll(`[data-cart-inc="${id}"]`)]
      .find((node) => node.getBoundingClientRect().width > 0);
    if (!inc) return null;
    const stepper = inc.closest('.qty-stepper');
    const sello = getComputedStyle(stepper, '::after');
    const caja = inc.getBoundingClientRect();
    const centro = document.elementFromPoint(caja.left + caja.width / 2, caja.top + caja.height / 2);
    return {
      selloVivo: sello.content !== 'none',
      derecha: sello.right,
      alcanzable: Boolean(centro && centro.closest(`[data-cart-inc="${id}"]`)),
    };
  }, productId);

  expect(medida).not.toBeNull();
  expect(medida.selloVivo).toBe(true);
  // 44px es el ancho declarado de la columna del "+": el sello se detiene ahí.
  expect(medida.derecha).toBe('44px');
  expect(medida.alcanzable).toBe(true);
});

test('REDUCED MOTION · sin movimiento la compra funciona igual y el sello no queda congelado', async ({ page }) => {
  const guards = installPageGuards(page);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await installBrowserStubs(page);
  await gotoDemoReset(page, '/?reset=1&demo=1');
  await page.locator('[data-nav-view="catalog"] >> visible=true').first().click();

  const agregar = page.locator('[data-product-grid] [data-add-product]:not([disabled]) >> visible=true').first();
  const productId = await agregar.getAttribute('data-add-product');
  await agregar.click();

  // El control de cantidad aparece y funciona.
  const stepper = page.locator(`[data-cart-inc="${productId}"] >> visible=true`).first();
  await expect(stepper).toBeVisible();
  await stepper.click();
  const cantidad = await page.evaluate(async (id) => {
    const { getState } = await import(new URL('js/state.js', location.href).href);
    return getState().cart.find((linea) => linea.productId === id)?.quantity || 0;
  }, productId);
  expect(cantidad).toBe(2);

  // El sello no se pinta: sin animación que lo apague, quedaría tapando el
  // control para siempre. La confirmación la da el aviso, que es texto.
  const sello = await page.evaluate((id) => {
    const inc = [...document.querySelectorAll(`[data-cart-inc="${id}"]`)]
      .find((node) => node.getBoundingClientRect().width > 0);
    return getComputedStyle(inc.closest('.qty-stepper'), '::after').content;
  }, productId);
  expect(sello).toBe('none');
  await expect(page.locator('[data-toast]')).toContainText('agregado al pedido');

  // Y ninguna animación queda corriendo para siempre.
  const animacionesInfinitas = await page.evaluate(() => document.getAnimations()
    .filter((a) => a.effect?.getTiming?.().iterations === Infinity).length);
  expect(animacionesInfinitas).toBe(0);

  await guards.assertClean();
});

test('PACKS · la cantidad del carrito sigue contando packs, no unidades sueltas', async ({ page }) => {
  await installBrowserStubs(page);
  await gotoDemoReset(page, '/?reset=1&demo=1');
  await page.locator('[data-nav-view="catalog"] >> visible=true').first().click();

  const agregar = page.locator('[data-product-grid] [data-add-product]:not([disabled]) >> visible=true').first();
  const productId = await agregar.getAttribute('data-add-product');
  await agregar.click();
  await page.locator(`[data-cart-inc="${productId}"] >> visible=true`).first().click();

  // La línea del carrito cuenta 2 de lo que sea que se agregó —unidad o pack—,
  // y el subtotal es 2 × su precio publicado. La semántica del pack no puede
  // cambiar porque el botón haya cambiado de forma.
  const linea = await page.evaluate(async (id) => {
    const { getState } = await import(new URL('js/state.js', location.href).href);
    const estado = getState();
    const producto = estado.products.find((p) => p.id === id);
    const enCarrito = estado.cart.find((l) => l.productId === id);
    return {
      cantidad: enCarrito.quantity,
      precio: producto.price,
      unidadesPorPack: producto.unitsPerPack ?? null,
      nombre: producto.name,
    };
  }, productId);

  expect(linea.cantidad).toBe(2);
  await expect(page.locator('[data-floating-cart]')).toContainText('2 productos');
});
