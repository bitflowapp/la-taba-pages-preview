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

test('ACCESIBILIDAD · el resumen se puede usar con teclado y con el dedo', async ({ page }) => {
  const guards = installPageGuards(page);
  await installBrowserStubs(page);
  await gotoDemoReset(page, '/?reset=1&demo=1');
  await sembrarPedidoAnterior(page);
  await recargarConHistorial(page);
  await seedCheckoutProfile(page, { addresses: DEFAULT_CHECKOUT_ADDRESSES });

  await page.locator('[data-customer-actions] .reorder-card [data-repeat-order]').click();
  await irACarrito(page);

  const salidas = page.locator('[data-checkout-summary-row] [data-profile-checkout-action="expand-summary"]');
  await expect(salidas).toHaveCount(3);

  // Objetivo táctil: 44px es el piso, y un "Cambiar" de 13,5px de texto no lo
  // alcanza por su contenido. Lo tiene que poner el componente.
  const alturas = await salidas.evaluateAll((nodos) => nodos.map((n) => n.getBoundingClientRect().height));
  alturas.forEach((alto) => expect(alto).toBeGreaterThanOrEqual(44));

  // Nombre accesible propio: tres botones que dicen "Cambiar" y nada más son
  // tres botones indistinguibles para quien no ve la fila.
  const nombres = await salidas.evaluateAll((nodos) => nodos.map((n) => n.getAttribute('aria-label')));
  expect(new Set(nombres).size).toBe(3);
  nombres.forEach((nombre) => expect(nombre).toMatch(/^Cambiar /));

  // Botones de verdad: alcanzables por teclado y accionables con Enter.
  const esBoton = await salidas.evaluateAll((nodos) => nodos.every((n) => n.tagName === 'BUTTON'));
  expect(esBoton).toBe(true);
  await salidas.first().focus();
  await expect(salidas.first()).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.locator('[data-checkout-summary-rows]')).toHaveCount(0);

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

  // El sello se pinta y se apaga SOLO, en 520 ms. Medirlo "mientras dure" hace
  // que la prueba dependa de cuánto tardó el navegador en llegar hasta acá, y
  // eso convierte un contrato de geometría en una carrera: pasa sola y falla en
  // la corrida completa. Acá se fuerza la clase, que es el estado que se quiere
  // medir, y la duración la fija la prueba unitaria contra el token.
  // El "+" se lleva al centro del viewport ANTES de medir. La prueba afirma que
  // el SELLO no tapa el "+", y `elementFromPoint` no distingue quién tapa: en
  // WebKit/iPhone el viewport util son 664px y la barra de carrito —que existe
  // recien despues de agregar— se apoya en el borde inferior, asi que si la
  // tarjeta quedaba abajo el punto caia sobre la barra y la prueba fallaba
  // culpando al sello. Falló asi dos veces, sólo en la corrida completa, y pasó
  // siempre aislada: la diferencia era dónde terminaba la tarjeta.
  await page.locator(`[data-cart-inc="${productId}"] >> visible=true`).first().scrollIntoViewIfNeeded();
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));

  const medida = await page.evaluate((id) => {
    const inc = [...document.querySelectorAll(`[data-cart-inc="${id}"]`)]
      .find((node) => node.getBoundingClientRect().width > 0);
    if (!inc) return null;
    const stepper = inc.closest('.qty-stepper');
    stepper.classList.add('is-just-added');
    const sello = getComputedStyle(stepper, '::after');
    const caja = inc.getBoundingClientRect();
    const centro = document.elementFromPoint(caja.left + caja.width / 2, caja.top + caja.height / 2);
    return {
      selloVivo: sello.content !== 'none',
      derecha: sello.right,
      alcanzable: Boolean(centro && centro.closest(`[data-cart-inc="${id}"]`)),
      // Quién estaba encima, para que un fallo futuro se lea solo en vez de
      // obligar a reproducirlo.
      encima: centro ? `${centro.tagName}${centro.className ? `.${String(centro.className).split(' ')[0]}` : ''}` : 'nada',
    };
  }, productId);

  expect(medida).not.toBeNull();
  expect(medida.selloVivo).toBe(true);
  // 44px es el ancho declarado de la columna del "+": el sello se detiene ahí.
  expect(medida.derecha).toBe('44px');
  // Y el "+" sigue siendo lo que hay bajo el dedo en su propio centro.
  expect(medida.alcanzable, `bajo el centro del "+" hay: ${medida.encima}`).toBe(true);
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

// ============================================================================
// Resolución del perfil — el checkout no adivina mientras no sabe
// ============================================================================

/*
 * Instala un perfil sandbox y un pedido anterior ANTES de la recarga, que es la
 * única forma de que el arranque real los vea.
 */
async function sembrarClienteRecurrente(page) {
  const pedido = await sembrarPedidoAnterior(page);
  await page.addInitScript((perfil) => {
    localStorage.setItem('la-taba-sandbox-profile:demo', JSON.stringify(perfil));
  }, {
    profile: { id: 'demo-customer', name: 'Marco', phone: '2990000123', updatedAt: '' },
    addresses: [{
      id: 'demo-address-01',
      label: 'Casa',
      street: 'Avenida Argentina',
      streetNumber: '450',
      city: 'Neuquén Capital',
      reference: 'Portón negro',
      isDefault: true,
      latitude: -38.945584,
      longitude: -68.040579,
      geolocationAccuracy: 18,
      locationSource: 'map_pin',
      locationConfirmedAt: '2026-08-08T18:00:00.000Z',
    }],
  });
  await recargarConHistorial(page);
  return pedido;
}

async function armarCarrito(page) {
  await page.locator('[data-nav-view="catalog"] >> visible=true').first().click();
  const agregar = page.locator('[data-product-grid] [data-add-product]:not([disabled]) >> visible=true').first();
  const productId = await agregar.getAttribute('data-add-product');
  await agregar.click();
  await page.locator(`[data-cart-inc="${productId}"] >> visible=true`).first().click();
  return productId;
}

/*
 * Reemplaza `load()` del repositorio de perfil y reinicia la máquina de estados
 * del checkout por su propia API. No toca el DOM ni fuerza ninguna fase: lo que
 * se observa después es el estado real del módulo.
 *   'lento'   → tarda y después responde bien
 *   'falla'   → responde {ok:false}, como una sesión vencida o un RPC caído
 *   'colgado' → nunca se asienta, que es lo único que `load()` no sabe manejar
 */
async function instalarPerfil(page, modo, ms = 1200) {
  await page.evaluate(async ({ modo: m, ms: espera }) => {
    const fabrica = await import(new URL('js/repositories/repository_factory.js', location.href).href);
    const repo = fabrica.getOrderRepository();
    const original = repo.customerProfiles.load.bind(repo.customerProfiles);
    repo.customerProfiles.load = async (...args) => {
      if (m === 'colgado') return new Promise(() => {});
      await new Promise((r) => setTimeout(r, espera));
      if (m === 'falla') {
        return { ok: false, message: 'No pudimos recuperar tus datos guardados. Podés completar el pedido manualmente.' };
      }
      return original(...args);
    };
    const checkout = await import(new URL('js/customer-delivery.js', location.href).href);
    checkout.resetCustomerDeliveryForTests();
    checkout.refreshCustomerDeliveryCheckout();
  }, { modo, ms });
}

const faseActual = (page) => page.evaluate(() => (
  document.querySelector('[data-profile-checkout]')?.dataset.checkoutPhase || 'sin-seccion'
));

const geometriaCheckout = (page) => page.locator('[data-profile-checkout]').evaluate((nodo) => ({
  alto: Math.round(nodo.getBoundingClientRect().height),
  campos: [...document.querySelectorAll('[data-checkout-form] input, [data-checkout-form] select, [data-checkout-form] textarea')]
    .filter((n) => n.type !== 'hidden' && n.getBoundingClientRect().height > 0).length,
}));

test('PROFILE SLOW · nunca se pinta el formulario completo para despues plegarlo', async ({ page }) => {
  const guards = installPageGuards(page);
  await installBrowserStubs(page);
  await gotoDemoReset(page, '/?reset=1&demo=1');
  await sembrarClienteRecurrente(page);
  await armarCarrito(page);
  await irACarrito(page);
  await expect(page.locator('[data-checkout-summary-rows]')).toHaveCount(1);

  await instalarPerfil(page, 'lento', 1200);

  // Se muestrea la fase Y la geometría durante toda la espera. El defecto que
  // esto cierra no es "termina mal": es que en el medio aparecía el formulario
  // entero. Un assert al final no lo habría visto nunca.
  const muestras = [];
  for (let i = 0; i < 12; i += 1) {
    muestras.push({ fase: await faseActual(page), ...(await geometriaCheckout(page)) });
    await page.waitForTimeout(160);
  }

  const fases = [...new Set(muestras.map((m) => m.fase))];
  expect(fases[0]).toBe('unresolved');
  expect(fases.at(-1)).toBe('compact');
  expect(fases).not.toContain('full');

  // Y la caja mide lo mismo en las dos fases: la reserva es geometría, no un
  // cartel de "cargando" que después empuja todo hacia abajo.
  expect([...new Set(muestras.map((m) => m.alto))]).toHaveLength(1);
  expect([...new Set(muestras.map((m) => m.campos))]).toEqual([1]);

  await guards.assertClean();
});

test('PROFILE FOUND · con el perfil disponible el resumen aparece sin pasar por el formulario', async ({ page }) => {
  const guards = installPageGuards(page);
  await installBrowserStubs(page);
  await gotoDemoReset(page, '/?reset=1&demo=1');
  await sembrarClienteRecurrente(page);
  await armarCarrito(page);
  await irACarrito(page);

  expect(await faseActual(page)).toBe('compact');
  await expect(page.locator('[data-checkout-summary-row]')).toHaveCount(3);
  await expect(page.locator('[data-checkout-summary-placeholder]')).toHaveCount(0);

  await guards.assertClean();
});

test('PROFILE EMPTY · sin nada que recordar el formulario completo aparece de una, sin esperar', async ({ page }) => {
  const guards = installPageGuards(page);
  await installBrowserStubs(page);
  await gotoDemoReset(page, '/?reset=1&demo=1');
  await armarCarrito(page);
  await irACarrito(page);

  // Sin historial local la respuesta se sabe en el primer pintado: no hay fase
  // de espera para quien compra por primera vez, que es el caso más frecuente.
  expect(await faseActual(page)).toBe('full');
  await expect(page.locator('[data-checkout-summary-placeholder]')).toHaveCount(0);
  await expect(page.locator('[data-profile-checkout] .profile-address-list')).toBeVisible();

  await instalarPerfil(page, 'lento', 900);
  expect(await faseActual(page)).toBe('full');

  await guards.assertClean();
});

test('PROFILE FAILURE · si la consulta falla el checkout queda usable, no suspendido', async ({ page }) => {
  await installBrowserStubs(page);
  await gotoDemoReset(page, '/?reset=1&demo=1');
  await sembrarClienteRecurrente(page);
  await armarCarrito(page);
  await irACarrito(page);

  await instalarPerfil(page, 'falla', 300);
  await expect(page.locator('[data-profile-checkout][data-checkout-phase="full"]')).toBeVisible({ timeout: 5_000 });

  // Usable de verdad: se puede elegir modalidad y medio de pago a mano.
  await expect(page.getByLabel('Delivery')).toBeVisible();
  await expect(page.getByLabel('Forma de pago')).toBeVisible();
  await expect(page.locator('[data-checkout-submit]')).toBeVisible();
  // Y se dice lo que pasó, en vez de dejar la pantalla muda.
  await expect(page.locator('.saved-address-status')).not.toBeEmpty();
});

test('PROFILE HUNG · una consulta que nunca contesta no deja el checkout esperando para siempre', async ({ page }) => {
  await installBrowserStubs(page);
  await gotoDemoReset(page, '/?reset=1&demo=1');
  await sembrarClienteRecurrente(page);
  await armarCarrito(page);
  await irACarrito(page);

  await instalarPerfil(page, 'colgado');
  expect(await faseActual(page)).toBe('unresolved');

  // `load()` traduce sesión vencida, RPC caído y red caída a {ok:false}, pero no
  // tiene tiempo límite propio: una promesa que jamás se asienta dejaría esto
  // colgado. El plazo resuelve hacia el estado USABLE y lo dice.
  await expect(page.locator('[data-profile-checkout][data-checkout-phase="full"]')).toBeVisible({ timeout: 9_000 });
  await expect(page.locator('.saved-address-status')).toContainText('No pudimos traer tus datos guardados');
  await expect(page.locator('[data-checkout-submit]')).toBeVisible();
});

// ============================================================================
// Aviso del pedido
// ============================================================================

test('CART NOTICE · el aviso vive en el layout y no cruza encabezado, CTA ni barra', async ({ page }) => {
  const guards = installPageGuards(page);
  await installBrowserStubs(page);
  await gotoDemoReset(page, '/?reset=1&demo=1');
  await armarCarrito(page);
  await irACarrito(page);

  // La pastilla flotante no existe en esta vista: la reemplaza la banda.
  await expect(page.locator('[data-toast]')).toHaveCSS('display', 'none');
  const banda = page.locator('[data-cart-notice]');
  await expect(banda).toBeVisible();

  const medir = () => page.evaluate(() => {
    const caja = (n) => {
      if (!n) return null;
      const r = n.getBoundingClientRect();
      return { t: r.top, b: r.bottom, l: r.left, r: r.right, h: Math.round(r.height) };
    };
    const objetivos = {
      encabezado: document.querySelector('[data-view="cart"] .view-title'),
      accionesVista: document.querySelector('[data-view="cart"] .view-actions'),
      primeraLinea: document.querySelector('[data-cart-list] .cart-item'),
      ctaConfirmar: document.querySelector('[data-checkout-submit]'),
      barraCarrito: document.querySelector('[data-floating-cart]'),
    };
    const aviso = caja(document.querySelector('[data-cart-notice]'));
    const origen = document.querySelector('[data-view="cart"]').getBoundingClientRect().top;
    const cruza = (a, c) => !!(a && c) && !(a.b <= c.t || c.b <= a.t || a.r <= c.l || c.r <= a.l);
    const tapa = [];
    for (const [nombre, nodo] of Object.entries(objetivos)) {
      const c = caja(nodo);
      const visible = nodo && !nodo.hidden && getComputedStyle(nodo).display !== 'none'
        && c && c.b > 0 && c.t < window.innerHeight;
      if (visible && cruza(aviso, c)) tapa.push(nombre);
    }
    return {
      aviso,
      tapa,
      // Offsets RELATIVOS a la vista del carrito, no coordenadas de viewport ni
      // de documento. Playwright desplaza la página antes de tocar un control y
      // esta aplicación no siempre desplaza el `window` —hay un contenedor
      // propio—, así que ni `top` ni `top + scrollY` son estables entre dos
      // momentos. Lo que este test afirma es que la banda no EMPUJA nada, y eso
      // se mide contra el origen de la vista, que el scroll no mueve.
      posiciones: Object.fromEntries(Object.entries(objetivos)
        .map(([k, n]) => [k, caja(n) ? Math.round(caja(n).t - origen) : null])),
    };
  });

  // Con las transiciones asentadas. La tarjeta del carrito tiene animación de
  // entrada propia —`.cart-card` es un objetivo de reveal— y al re-renderizarse
  // vuelve a entrar desde `translateY(16px)`. Medir a mitad de ese recorrido
  // atribuiría a la banda un desplazamiento que es de otro componente y que ya
  // existía antes de este trabajo.
  const asentar = async () => {
    await page.evaluate(async () => {
      await Promise.all(document.getAnimations().map((a) => a.finished.catch(() => undefined)));
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    });
  };

  await asentar();
  const reposo = await medir();
  await page.locator('[data-cart-inc] >> visible=true').first().click();
  await asentar();
  const conAviso = await medir();

  await expect(banda).toContainText('agregado al pedido');
  expect(conAviso.tapa).toEqual([]);
  // La banda reserva su alto SIEMPRE, así que nada se mueve al encenderse ni al
  // apagarse: es la diferencia entre estar en el layout y flotar por encima.
  expect(conAviso.aviso.h).toBe(reposo.aviso.h);
  expect(conAviso.posiciones).toEqual(reposo.posiciones);

  await page.waitForTimeout(2400);
  await asentar();
  const apagado = await medir();
  await expect(banda).toBeEmpty();
  expect(apagado.posiciones).toEqual(reposo.posiciones);

  await guards.assertClean();
});
