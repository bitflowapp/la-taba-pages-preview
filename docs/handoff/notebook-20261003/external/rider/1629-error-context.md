# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: customer-delivery.spec.mjs >> checkout permite editar Perfil y volver al pedido conservando selecciÃ³n
- Location: tests\e2e\customer-delivery.spec.mjs:296:1

# Error details

```
Error: expect(locator).toBeVisible() failed

Locator: locator('[data-customer-profile]').locator('[data-profile-action="return-to-checkout"]')
Expected: visible
Timeout: 5000ms
Error: element(s) not found

Call log:
  - Expect "toBeVisible" with timeout 5000ms
  - waiting for locator('[data-customer-profile]').locator('[data-profile-action="return-to-checkout"]')

```

```yaml
- banner:
  - button "Ir al inicio del comercio":
    - strong: La Taba 2
  - navigation "Navegación principal":
    - button "Inicio"
    - button "Categorías"
    - button "Pedidos 1"
    - button "Seguir"
    - button "Cuenta"
  - button "ENVIAR A Elegí tu dirección":
    - text: ENVIAR A
    - strong: Elegí tu dirección
  - searchbox "Buscar en TABA2"
  - button "Ver mi pedido"
- main:
  - heading "Tu pedido" [level=1]
  - button "Seguir comprando"
  - button "Vaciar carrito"
  - heading "Productos" [level=3]
  - img "Imagen oficial de Coca-Cola Original"
  - text: Coca-Cola Original Pack x12 · $ 17.100
  - button "Quitar Coca-Cola Original del pedido"
  - strong: "1"
  - button "Sumar uno de Coca-Cola Original"
  - text: $ 17.100
  - complementary:
    - strong: Ya alcanzaste el pedido mínimo
    - text: El mínimo de delivery es $ 5.000. El costo de envío se informa por separado.
  - text: Finalizá en pocos pasos
  - heading "Datos de entrega" [level=3]
  - radio "Delivery" [checked]
  - text: Delivery
  - radio "Retiro en local"
  - text: Retiro en local
  - region "Tus datos":
    - heading "Tus datos" [level=4]
    - strong: Cliente demo inicial
    - text: 299 555 0001
    - button "Editar en Perfil"
    - text: ¿Dónde lo llevamos?
    - button "Administrar en Perfil"
    - radiogroup "¿Dónde lo llevamos?":
      - radio "Casa Principal Avenida Argentina 450, Neuquén Capital Portón negro, timbre 2" [checked]
      - strong: Casa
      - text: Principal Avenida Argentina 450, Neuquén Capital Portón negro, timbre 2
  - text: Forma de pago
  - combobox "Forma de pago":
    - option "A coordinar con el local"
    - option "Efectivo al recibir" [selected]
    - option "Transferencia al confirmar"
  - text: El medio se confirma antes de preparar el pedido.
  - group:
    - text: Agregar indicaciones Observaciones del pedido
    - textbox "Observaciones del pedido":
      - /placeholder: "Ej: indicaciones para preparar o entregar el pedido"
  - text: Subtotal
  - strong: $ 17.100
  - text: Envío a domicilio
  - strong: $ 1.990
  - text: Pedido mínimo delivery
  - strong: $ 5.000
  - text: Total
  - strong: $ 19.090
  - strong: Tu pedido está protegido.
  - text: Revisá tus datos y el resumen antes de confirmar.
  - button "Confirmar pedido"
  - paragraph: El medio de pago se coordina con el local.
```

# Test source

```ts
  226 |   await expect(addProduct).toBeVisible();
  227 |   await addProduct.click();
  228 |   await page.evaluate(() => { window.location.hash = '#cart'; });
  229 |   await expect(page.locator('body')).toHaveAttribute('data-active-view', 'cart');
  230 |   const checkout = page.locator('[data-checkout-form]');
  231 |   const savedAddresses = page.locator('[data-customer-addresses]');
  232 |   const savedAddressStatus = savedAddresses.locator('.saved-address-status');
  233 |   await expect(checkout).toBeVisible();
  234 |   await expect(checkout).toHaveAttribute('data-address-source', 'profile_default');
  235 |   await expect(checkout.locator('.profile-address-list .profile-address-card.is-selected')).toHaveAttribute(
  236 |     'data-customer-address-id',
  237 |     addresses[0].id,
  238 |   );
  239 |   await expect(checkout).toHaveAttribute('data-address-source', 'profile_default');
  240 | 
  241 |   addresses[0].isDefault = false;
  242 |   addresses[1].isDefault = true;
  243 |   await page.evaluate(() => {
  244 |     window.dispatchEvent(new CustomEvent('taba:customer-profile-updated', {
  245 |       detail: { source: 'profile' },
  246 |     }));
  247 |   });
  248 |   await expect(savedAddressStatus).toContainText('Cargando');
  249 |   await expect(savedAddressStatus).toHaveText('');
  250 |   await expect(checkout).toHaveAttribute('data-address-source', 'profile_default');
  251 |   await expect(checkout.locator('.profile-address-list .profile-address-card.is-selected')).toHaveAttribute(
  252 |     'data-customer-address-id',
  253 |     addresses[1].id,
  254 |   );
  255 | 
  256 |   await savedAddresses
  257 |     .locator(`[data-customer-address-id="${addresses[0].id}"] [data-customer-address-action="select"]`)
  258 |     .last()
  259 |     .click();
  260 |   await expect(checkout).toHaveAttribute('data-address-source', 'saved_address_selected');
  261 |   await page.evaluate(() => {
  262 |     window.dispatchEvent(new CustomEvent('taba:customer-profile-updated', {
  263 |       detail: { source: 'profile' },
  264 |     }));
  265 |   });
  266 |   await expect(savedAddressStatus).toContainText('Cargando');
  267 |   await expect(savedAddressStatus).toHaveText('');
  268 |   await expect(checkout).toHaveAttribute('data-address-source', /profile_default|saved_address_selected/);
  269 |   await expect(checkout.locator('.profile-address-list .profile-address-card.is-selected')).toHaveAttribute(
  270 |     'data-customer-address-id',
  271 |     addresses[0].id,
  272 |   );
  273 | 
  274 |   addresses[0].label = 'Casa actualizada';
  275 |   await page.evaluate(() => {
  276 |     window.dispatchEvent(new CustomEvent('taba:customer-profile-updated', {
  277 |       detail: { source: 'profile' },
  278 |     }));
  279 |   });
  280 |   await expect(savedAddressStatus).toContainText('Cargando');
  281 |   await expect(savedAddressStatus).toHaveText('');
  282 |   await expect(checkout).toHaveAttribute('data-address-source', /profile_default|saved_address_selected/);
  283 |   await expect(checkout).toHaveAttribute('data-address-form-dirty', 'false');
  284 | 
  285 |   await page.evaluate(() => { window.location.hash = '#home'; });
  286 |   await expect(page.locator('body')).toHaveAttribute('data-active-view', 'home');
  287 |   await page.evaluate(() => { window.location.hash = '#cart'; });
  288 |   await expect(page.locator('body')).toHaveAttribute('data-active-view', 'cart');
  289 |   await expect(checkout.locator('.profile-address-list .profile-address-card.is-selected')).toHaveAttribute(
  290 |     'data-customer-address-id',
  291 |     addresses[1].id,
  292 |   );
  293 |   await expect(checkout).toHaveAttribute('data-address-source', 'profile_default');
  294 | });
  295 | 
  296 | test('checkout permite editar Perfil y volver al pedido conservando selecciÃ³n', async ({ page }) => {
  297 |   await page.goto('/?demo=1#catalog');
  298 |   await expect(page.locator('[data-view="catalog"] [data-add-product]:not([disabled])').first()).toBeVisible();
  299 |   await page.locator('[data-product-grid] [data-add-product]:not([disabled])').first().click();
  300 |   await page.evaluate(() => {
  301 |     window.location.hash = '#cart';
  302 |   });
  303 |   await expect(page.locator('[data-view="cart"]')).toBeVisible();
  304 | 
  305 |   const addresses = buildCheckoutAddresses(1, 'return-checkout');
  306 |   await fillCheckout(page, {
  307 |     name: 'Cliente demo inicial',
  308 |     phone: '2995550001',
  309 |     addresses,
  310 |     payment: 'cash',
  311 |     deliveryMode: 'delivery',
  312 |   });
  313 | 
  314 |   const selectedAddressId = addresses[0].id;
  315 |   const checkout = page.locator('[data-checkout-form]');
  316 |   await expect(checkout.locator('[data-profile-name]')).toHaveText('Cliente demo inicial');
  317 |   await expect(checkout.locator('[data-profile-phone]')).toHaveText('299 555 0001');
  318 |   await expect(checkout.locator('.profile-address-list .profile-address-card.is-selected')).toHaveAttribute(
  319 |     'data-customer-address-id',
  320 |     selectedAddressId,
  321 |   );
  322 | 
  323 |   await checkout.locator('[data-profile-checkout-action="edit-profile"]').click();
  324 |   const profile = page.locator('[data-customer-profile]');
  325 |   await expect(profile).toHaveAttribute('data-customer-profile-state', 'ready');
> 326 |   await expect(profile.locator('[data-profile-action="return-to-checkout"]')).toBeVisible();
      |                                                                               ^ Error: expect(locator).toBeVisible() failed
  327 |   await profile.locator('[data-profile-action="edit-personal"]').click();
  328 |   await profile.locator('[name="profileFullName"]').fill('Cliente checkout editado');
  329 |   await profile.locator('[name="profilePhone"]').fill('2995551111');
  330 |   await profile.locator('[data-profile-action="save-personal"]').click();
  331 | 
  332 |   await expect(page.locator('[data-profile-name]')).toHaveText('Cliente checkout editado');
  333 |   await expect(page.locator('[data-profile-phone]')).toHaveText('299 555 1111');
  334 |   await profile.locator('[data-profile-action="return-to-checkout"]').click();
  335 | 
  336 |   await expect(page.locator('body')).toHaveAttribute('data-active-view', 'cart');
  337 |   await expect(page.locator('[data-checkout-form]')).toHaveAttribute('data-address-source', /profile_default|saved_address_selected/);
  338 |   await expect(checkout.locator('.profile-address-list .profile-address-card.is-selected')).toHaveAttribute(
  339 |     'data-customer-address-id',
  340 |     selectedAddressId,
  341 |   );
  342 |   await expect(checkout.locator('[data-profile-name]')).toHaveText('Cliente checkout editado');
  343 |   await expect(checkout.locator('[data-profile-phone]')).toHaveText('299 555 1111');
  344 |   await expect(page.locator('input[value="delivery"][name="deliveryMode"]')).toBeChecked();
  345 | });
  346 | 
  347 | test('checkout con 4 direcciones renderiza compactado y permite expandir para seleccionar la cuarta', async ({ page }) => {
  348 |   await page.goto('/?demo=1#catalog');
  349 |   await expect(page.locator('[data-view="catalog"] [data-add-product]:not([disabled])').first()).toBeVisible();
  350 |   await page.locator('[data-product-grid] [data-add-product]:not([disabled])').first().click();
  351 |   await page.evaluate(() => {
  352 |     window.location.hash = '#cart';
  353 |   });
  354 |   await expect(page.locator('[data-view="cart"]')).toBeVisible();
  355 | 
  356 |   const addresses = buildCheckoutAddresses(4, 'e2e-compact');
  357 |   await fillCheckout(page, {
  358 |     name: 'Cliente 4',
  359 |     phone: '2995554004',
  360 |     addresses,
  361 |     payment: 'cash',
  362 |     deliveryMode: 'delivery',
  363 |   });
  364 | 
  365 |   const addressesRoot = page.locator('[data-customer-addresses]');
  366 |   const list = addressesRoot.locator('.profile-address-list');
  367 |   const toggle = page.locator('[data-profile-checkout-action="toggle-addresses"]');
  368 | 
  369 |   await expect(list).toHaveAttribute('data-address-total', '4');
  370 |   await expect(list.locator('.profile-address-card')).toHaveCount(3);
  371 |   await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  372 |   await expect(toggle).toContainText(/Ver las 4 direcciones/);
  373 | 
  374 |   await toggle.click();
  375 |   await expect(toggle).toHaveAttribute('aria-expanded', 'true');
  376 |   await expect(list).toHaveClass(/is-expanded/);
  377 |   await expect(list.locator('.profile-address-card')).toHaveCount(4);
  378 |   await expect(list.locator(`[data-customer-address-id="${addresses[3].id}"]`)).toBeVisible();
  379 | 
  380 |   const selected = await selectCheckoutAddress(page, { id: addresses[3].id });
  381 |   await expect(page.locator('[data-checkout-form]')).toHaveAttribute('data-address-source', 'saved_address_selected');
  382 |   await expect(selected).toHaveClass(/is-selected/);
  383 |   await expect(selected).toHaveAttribute('data-customer-address-id', addresses[3].id);
  384 | });
  385 | 
  386 | test('checkout con 1 dirección conserva la selección predeterminada visible', async ({ page }) => {
  387 |   await page.goto('/?demo=1#catalog');
  388 |   await expect(page.locator('[data-view="catalog"] [data-add-product]:not([disabled])').first()).toBeVisible();
  389 |   await page.locator('[data-product-grid] [data-add-product]:not([disabled])').first().click();
  390 |   await page.evaluate(() => {
  391 |     window.location.hash = '#cart';
  392 |   });
  393 |   await expect(page.locator('[data-view="cart"]')).toBeVisible();
  394 | 
  395 |   const addresses = buildCheckoutAddresses(1, 'e2e-single');
  396 |   await fillCheckout(page, {
  397 |     name: 'Cliente 1',
  398 |     phone: '2995554001',
  399 |     addresses,
  400 |     payment: 'cash',
  401 |     deliveryMode: 'delivery',
  402 |   });
  403 | 
  404 |   const checkout = page.locator('[data-checkout-form]');
  405 |   const list = checkout.locator('.profile-address-list');
  406 |   await expect(list).toHaveAttribute('data-address-total', '1');
  407 |   await expect(list.locator('.profile-address-card')).toHaveCount(1);
  408 |   await expect(checkout.locator('.profile-address-list .profile-address-card.is-selected')).toHaveAttribute(
  409 |     'data-customer-address-id',
  410 |     addresses[0].id,
  411 |   );
  412 |   await expect(checkout).toHaveAttribute('data-address-source', 'profile_default');
  413 |   await expect(page.locator('[data-profile-checkout-action="toggle-addresses"]')).toHaveCount(0);
  414 |   await expect(checkout.locator('.profile-address-list')).toBeVisible();
  415 | });
  416 | 
  417 | test('checkout con 10 direcciones inicia compactado y puede seleccionar una dirección oculta', async ({ page }) => {
  418 |   await page.goto('/?demo=1#catalog');
  419 |   await expect(page.locator('[data-view="catalog"] [data-add-product]:not([disabled])').first()).toBeVisible();
  420 |   await page.locator('[data-product-grid] [data-add-product]:not([disabled])').first().click();
  421 |   await page.evaluate(() => {
  422 |     window.location.hash = '#cart';
  423 |   });
  424 |   await expect(page.locator('[data-view="cart"]')).toBeVisible();
  425 | 
  426 |   const addresses = buildCheckoutAddresses(10, 'e2e-expanded');
```