# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: customer-delivery.spec.mjs >> checkout bloquea por Perfil incompleto y permite volver desde completar Perfil
- Location: tests\e2e\customer-delivery.spec.mjs:462:1

# Error details

```
Error: expect(locator).toBeVisible() failed

Locator:  locator('[data-customer-profile]')
Expected: visible
Received: hidden
Timeout:  5000ms

Call log:
  - Expect "toBeVisible" with timeout 5000ms
  - waiting for locator('[data-customer-profile]')
    5 × locator resolved to <div data-customer-profile=""></div>
      - unexpected value "hidden"
    8 × locator resolved to <div data-customer-profile="" data-customer-profile-state="ready">…</div>
      - unexpected value "hidden"

```

```yaml
- banner:
  - button "Ir al inicio del comercio":
    - strong: TABA2
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
    - status:
      - strong: Completá tu perfil para continuar
      - text: Necesitamos tu nombre y teléfono para que el local pueda entregarte el pedido.
      - button "Completar Perfil"
    - status:
      - strong: Agregá una dirección para recibir el pedido
      - text: Guardás la dirección una vez en tu Perfil y después la elegís en cada compra.
      - button "Agregar dirección en Perfil"
  - text: Forma de pago
  - combobox "Forma de pago":
    - option "A coordinar con el local" [selected]
    - option "Efectivo al recibir"
    - option "Transferencia al confirmar"
  - text: El medio se confirma antes de preparar el pedido.
  - group: Agregar indicaciones
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
  427 |   await fillCheckout(page, {
  428 |     name: 'Cliente 10',
  429 |     phone: '2995551010',
  430 |     addresses,
  431 |     payment: 'transfer',
  432 |     deliveryMode: 'delivery',
  433 |   });
  434 | 
  435 |   const addressesRoot = page.locator('[data-customer-addresses]');
  436 |   const list = addressesRoot.locator('.profile-address-list');
  437 |   const toggle = page.locator('[data-profile-checkout-action="toggle-addresses"]');
  438 | 
  439 |   await expect(list).toHaveAttribute('data-address-total', '10');
  440 |   await expect(list.locator('.profile-address-card')).toHaveCount(3);
  441 |   await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  442 |   await expect(toggle).toContainText(/Ver las 10 direcciones/);
  443 |   await expect(toggle).toContainText(/7/);
  444 |   await expect(addressesRoot.locator('.profile-address-card')).toHaveCount(3);
  445 | 
  446 |   await toggle.click();
  447 |   await expect(list).toHaveClass(/is-expanded/);
  448 |   await expect(list.locator('.profile-address-card')).toHaveCount(10);
  449 |   await expect(list.locator(`[data-customer-address-id="${addresses[9].id}"]`)).toBeVisible();
  450 | 
  451 |   const selected = await selectCheckoutAddress(page, { id: addresses[9].id });
  452 |   await expect(page.locator('[data-checkout-form]')).toHaveAttribute('data-address-source', 'saved_address_selected');
  453 |   await expect(selected).toHaveClass(/is-selected/);
  454 |   await expect(selected).toHaveAttribute('data-customer-address-id', addresses[9].id);
  455 | 
  456 |   await toggle.click();
  457 |   await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  458 |   await expect(list.locator('.profile-address-card')).toHaveCount(3);
  459 |   await expect(page.locator('.profile-address-card[data-customer-address-id="' + addresses[9].id + '"]')).toBeVisible();
  460 | });
  461 | 
  462 | test('checkout bloquea por Perfil incompleto y permite volver desde completar Perfil', async ({ page }) => {
  463 |   const namespace = 'e2e-profile-incomplete';
  464 |   await page.goto('/?demo=1#catalog');
  465 |   await expect(page.locator('[data-view="catalog"] [data-add-product]:not([disabled])').first()).toBeVisible();
  466 |   await page.locator('[data-product-grid] [data-add-product]:not([disabled])').first().click();
  467 |   await page.evaluate(() => {
  468 |     window.location.hash = '#cart';
  469 |   });
  470 |   await expect(page.locator('[data-view="cart"]')).toBeVisible();
  471 | 
  472 |   await seedCheckoutProfile(page, {
  473 |     name: '',
  474 |     phone: '',
  475 |     addresses: [],
  476 |     namespace,
  477 |   });
  478 | 
  479 |   await expect(page.locator('[data-profile-block="incomplete"]')).toBeVisible();
  480 |   const completeAction = page.locator('[data-profile-block="incomplete"] [data-profile-checkout-action="edit-profile"]');
  481 |   await expect(completeAction).toBeVisible();
  482 |   await completeAction.click();
  483 | 
  484 |   const profile = page.locator('[data-customer-profile]');
> 485 |   await expect(profile).toBeVisible();
      |                         ^ Error: expect(locator).toBeVisible() failed
  486 |   await profile.locator('[data-profile-action="return-to-checkout"]').click();
  487 |   await expect(page.locator('body')).toHaveAttribute('data-active-view', 'cart');
  488 |   await expect(page.locator('[data-profile-block="incomplete"]')).toBeVisible();
  489 | });
  490 | 
  491 | test('checkout bloquea sin direcciones y permite volver desde agregar dirección en Perfil', async ({ page }) => {
  492 |   const namespace = 'e2e-no-address';
  493 |   await page.goto('/?demo=1#catalog');
  494 |   await expect(page.locator('[data-view="catalog"] [data-add-product]:not([disabled])').first()).toBeVisible();
  495 |   await page.locator('[data-product-grid] [data-add-product]:not([disabled])').first().click();
  496 |   await page.evaluate(() => {
  497 |     window.location.hash = '#cart';
  498 |   });
  499 |   await expect(page.locator('[data-view="cart"]')).toBeVisible();
  500 | 
  501 |   await seedCheckoutProfile(page, {
  502 |     name: 'Cliente demo',
  503 |     phone: '2991112233',
  504 |     addresses: [],
  505 |     namespace,
  506 |   });
  507 | 
  508 |   await expect(page.locator('[data-profile-block="no-address"]')).toBeVisible();
  509 |   const addAddressAction = page.locator('[data-profile-block="no-address"] [data-profile-checkout-action="add-address"]');
  510 |   await expect(addAddressAction).toBeVisible();
  511 |   await addAddressAction.click();
  512 | 
  513 |   const profile = page.locator('[data-customer-profile]');
  514 |   await expect(profile).toBeVisible();
  515 |   await profile.locator('[data-profile-action="return-to-checkout"]').click();
  516 |   await expect(page.locator('body')).toHaveAttribute('data-active-view', 'cart');
  517 |   await expect(page.locator('[data-profile-block="no-address"]')).toBeVisible();
  518 | });
  519 | 
  520 | test('checkout permite retiro en local sin direcciones', async ({ page }) => {
  521 |   const namespace = 'e2e-pickup-no-address';
  522 |   await page.goto('/?demo=1#catalog');
  523 |   await expect(page.locator('[data-view="catalog"] [data-add-product]:not([disabled])').first()).toBeVisible();
  524 |   await page.locator('[data-product-grid] [data-add-product]:not([disabled])').first().click();
  525 |   await page.evaluate(() => {
  526 |     window.location.hash = '#cart';
  527 |   });
  528 |   await expect(page.locator('[data-view="cart"]')).toBeVisible();
  529 | 
  530 |   await fillCheckout(page, {
  531 |     name: 'Cliente retiro sin direcciones',
  532 |     phone: '2992223333',
  533 |     addresses: [],
  534 |     payment: 'cash',
  535 |     deliveryMode: 'pickup',
  536 |     namespace,
  537 |   });
  538 | 
  539 |   await expect(page.locator('[data-profile-pickup]')).toBeVisible();
  540 |   await expect(page.locator('[data-profile-summary]')).toBeVisible();
  541 |   await expect(page.locator('[data-profile-block="no-address"]')).toHaveCount(0);
  542 |   await expect(page.locator('[data-order-summary]')).toContainText('Retiro en local');
  543 | 
  544 |   await page.getByRole('button', { name: /Confirmar pedido/i }).click();
  545 |   await waitForToast(page, 'Pedido confirmado. Seguilo en Seguimiento.');
  546 |   await expect(page.locator('[data-view="tracking"]')).toBeVisible();
  547 |   await expect(page.locator('[data-tracking-panel]')).toContainText('Retiro en local');
  548 | });
  549 | 
  550 | test('checkout conserva dirección seleccionada al volver desde retiro a delivery', async ({ page }) => {
  551 |   const namespace = 'e2e-pickup-return';
  552 |   const addresses = buildCheckoutAddresses(3, namespace);
  553 | 
  554 |   await page.goto('/?demo=1#catalog');
  555 |   await expect(page.locator('[data-view="catalog"] [data-add-product]:not([disabled])').first()).toBeVisible();
  556 |   await page.locator('[data-product-grid] [data-add-product]:not([disabled])').first().click();
  557 |   await page.evaluate(() => {
  558 |     window.location.hash = '#cart';
  559 |   });
  560 |   await expect(page.locator('[data-view="cart"]')).toBeVisible();
  561 | 
  562 |   await fillCheckout(page, {
  563 |     name: 'Cliente retorno',
  564 |     phone: '2994445555',
  565 |     addresses,
  566 |     payment: 'cash',
  567 |     deliveryMode: 'delivery',
  568 |     namespace,
  569 |   });
  570 | 
  571 |   const selectedId = addresses[1].id;
  572 |   const checkout = page.locator('[data-checkout-form]');
  573 |   const addressList = checkout.locator('.profile-address-list');
  574 |   await selectCheckoutAddress(page, { id: selectedId });
  575 |   await expect(addressList.locator('.profile-address-card')).toHaveCount(3);
  576 |   await expect(addressList).toHaveAttribute('data-address-total', '3');
  577 |   await expect(checkout).toHaveAttribute('data-address-source', 'saved_address_selected');
  578 | 
  579 |   await page.getByLabel('Retiro en local').check();
  580 |   await expect(page.locator('[data-profile-pickup]')).toBeVisible();
  581 |   await expect(addressList).toHaveCount(0);
  582 |   await expect(checkout).toHaveAttribute('data-address-source', 'saved_address_selected');
  583 | 
  584 |   await page.getByLabel('Delivery').check();
  585 |   await expect(page.locator('[data-profile-pickup]')).toBeHidden();
```