# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: customer-delivery.spec.mjs >> borrar la dirección seleccionada no rompe el checkout
- Location: tests\e2e\customer-delivery.spec.mjs:631:1

# Error details

```
Error: expect(locator).toHaveAttribute(expected) failed

Locator:  locator('[data-checkout-form]')
Expected: "saved_address_selected"
Received: "profile_default"
Timeout:  5000ms

Call log:
  - Expect "toHaveAttribute" with timeout 5000ms
  - waiting for locator('[data-checkout-form]')
    2 × locator resolved to <form novalidate="" data-checkout-form="" data-motion-reveal="section" data-address-form-dirty="false" data-profile-hydration-version="1" data-address-source="profile_default" class="card checkout-form is-motion-visible">…</form>
      - unexpected value "profile_default"
    11 × locator resolved to <form novalidate="" data-checkout-form="" data-motion-reveal="section" data-address-form-dirty="false" data-profile-hydration-version="2" data-address-source="profile_default" class="card checkout-form is-motion-visible">…</form>
       - unexpected value "profile_default"

```

```yaml
- text: Finalizá en pocos pasos
- heading "Datos de entrega" [level=3]
- radio "Delivery" [checked]
- text: Delivery
- radio "Retiro en local"
- text: Retiro en local
- region "Tus datos":
  - heading "Tus datos" [level=4]
  - strong: Cliente demo
  - text: 299 111 2233
  - button "Editar en Perfil"
  - text: ¿Dónde lo llevamos?
  - button "Administrar en Perfil"
  - radiogroup "¿Dónde lo llevamos?"
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
  586 |   await expect(addressList.locator('.profile-address-card[data-customer-address-id="' + selectedId + '"]')).toBeVisible();
  587 |   await expect(addressList.locator('.profile-address-card')).toHaveCount(3);
  588 |   await expect(addressList.locator('.profile-address-card[data-customer-address-id="' + selectedId + '"]')).toHaveClass(/is-selected/);
  589 |   await expect(checkout).toHaveAttribute('data-address-source', 'saved_address_selected');
  590 | });
  591 | 
  592 | test('confirmar en checkout no muta la entidad de Perfil sandbox', async ({ page }) => {
  593 |   const namespace = 'e2e-no-mutation';
  594 |   const profileKey = `${SANDBOX_PROFILE_STORAGE_PREFIX}:demo`;
  595 |   await page.goto('/?demo=1#catalog');
  596 |   await expect(page.locator('[data-view="catalog"] [data-add-product]:not([disabled])').first()).toBeVisible();
  597 |   await page.locator('[data-product-grid] [data-add-product]:not([disabled])').first().click();
  598 |   await page.evaluate(() => {
  599 |     window.location.hash = '#cart';
  600 |   });
  601 |   await expect(page.locator('[data-view="cart"]')).toBeVisible();
  602 | 
  603 |   await fillCheckout(page, {
  604 |     name: 'Cliente persistencia',
  605 |     phone: '2995550101',
  606 |     street: 'Roca 123',
  607 |     neighborhood: 'Neuquén centro',
  608 |     reference: 'Portón negro',
  609 |     notes: 'No guardar cambios',
  610 |     payment: 'cash',
  611 |     deliveryMode: 'delivery',
  612 |     namespace,
  613 |   });
  614 | 
  615 |   const before = await page.evaluate((key) => {
  616 |     const snapshot = localStorage.getItem(key);
  617 |     return snapshot ? JSON.parse(snapshot) : null;
  618 |   }, profileKey);
  619 | 
  620 |   await page.getByRole('button', { name: /Confirmar pedido/i }).click();
  621 |   await waitForToast(page, 'Pedido confirmado. Seguilo en Seguimiento.');
  622 | 
  623 |   const after = await page.evaluate((key) => {
  624 |     const snapshot = localStorage.getItem(key);
  625 |     return snapshot ? JSON.parse(snapshot) : null;
  626 |   }, profileKey);
  627 | 
  628 |   expect(after).toEqual(before);
  629 | });
  630 | 
  631 | test('borrar la dirección seleccionada no rompe el checkout', async ({ page }) => {
  632 |   const namespace = 'e2e-delete-selected';
  633 |   const addresses = buildCheckoutAddresses(2, namespace);
  634 | 
  635 |   await page.goto('/?demo=1#catalog');
  636 |   await expect(page.locator('[data-view="catalog"] [data-add-product]:not([disabled])').first()).toBeVisible();
  637 |   await page.locator('[data-product-grid] [data-add-product]:not([disabled])').first().click();
  638 |   await page.evaluate(() => {
  639 |     window.location.hash = '#cart';
  640 |   });
  641 |   await expect(page.locator('[data-view="cart"]')).toBeVisible();
  642 | 
  643 |   await fillCheckout(page, {
  644 |     name: 'Cliente demo',
  645 |     phone: '2991112233',
  646 |     addresses,
  647 |     payment: 'cash',
  648 |     deliveryMode: 'delivery',
  649 |     namespace,
  650 |   });
  651 | 
  652 |   const secondAddressId = addresses[1].id;
  653 |   await selectCheckoutAddress(page, { id: secondAddressId });
> 654 |   await expect(page.locator('[data-checkout-form]')).toHaveAttribute('data-address-source', 'saved_address_selected');
      |                                                      ^ Error: expect(locator).toHaveAttribute(expected) failed
  655 |   const checkout = page.locator('[data-checkout-form]');
  656 |   const selectedCard = checkout.locator(`.profile-address-list .profile-address-card[data-customer-address-id="${secondAddressId}"]`);
  657 |   await expect(selectedCard).toHaveClass(/is-selected/);
  658 | 
  659 |   await checkout.locator('[data-profile-checkout-action="manage-addresses"]').click();
  660 |   const profile = page.locator('[data-customer-profile]');
  661 |   const profileSelectedCard = profile.locator(`[data-profile-address-id="${secondAddressId}"]`);
  662 |   await expect(profileSelectedCard).toBeVisible();
  663 |   page.on('dialog', (dialog) => dialog.accept());
  664 |   await profileSelectedCard.locator('[data-profile-action="delete-address"]').click();
  665 |   await expect(profileSelectedCard).toHaveCount(0);
  666 |   await profile.locator('[data-profile-action="return-to-checkout"]').click();
  667 |   await expect(page.locator('body')).toHaveAttribute('data-active-view', 'cart');
  668 |   await expect(selectedCard).toHaveCount(0);
  669 | 
  670 |   const remainingCard = checkout.locator(`.profile-address-list .profile-address-card[data-customer-address-id="${addresses[0].id}"]`);
  671 |   await expect(remainingCard).toBeVisible();
  672 |   await expect(remainingCard).toHaveClass(/is-selected/);
  673 |   await expect(checkout).toHaveAttribute('data-address-source', 'profile_default');
  674 | });
  675 | 
  676 | function profileRegressionBusiness() {
  677 |   return {
  678 |     id: BUSINESS_ID,
  679 |     name: 'TABA Perfil QA',
  680 |     address: 'Neuquén',
  681 |     currency_code: 'ARS',
  682 |     ordering_enabled: true,
  683 |     ordering_verified: true,
  684 |     delivery_enabled: true,
  685 |     pickup_enabled: true,
  686 |     delivery_fee: 0,
  687 |     minimum_delivery_subtotal: 0,
  688 |     is_active: true,
  689 |     status: 'open',
  690 |   };
  691 | }
  692 | 
  693 | function profileRegressionProduct() {
  694 |   return {
  695 |     id: PROFILE_REGRESSION_PRODUCT_ID,
  696 |     business_id: BUSINESS_ID,
  697 |     external_id: 'perfil-regression-soda',
  698 |     sku: 'PERFIL-REGRESSION-SODA',
  699 |     name: 'Soda Perfil QA',
  700 |     brand: 'TABA',
  701 |     description: 'Producto exclusivo del fixture de Perfil.',
  702 |     category: 'Gaseosas',
  703 |     subcategory: 'Soda',
  704 |     variant: 'Botella 500 ml',
  705 |     presentation: 'Botella 500 ml',
  706 |     capacity_value: 500,
  707 |     capacity_unit: 'ml',
  708 |     capacity: '500 ml',
  709 |     packaging_type: 'botella',
  710 |     units_per_pack: 1,
  711 |     price: 1200,
  712 |     stock: 10,
  713 |     available: true,
  714 |     chilled: false,
  715 |     is_alcoholic: false,
  716 |     minimum_age: null,
  717 |     image_url: '/assets/catalog/beverages/coca-cola-original-pet-500ml-pack-12/product.webp',
  718 |     image_thumbnail_url: '/assets/catalog/beverages/coca-cola-original-pet-500ml-pack-12/thumbnail.webp',
  719 |     image_sha256: '',
  720 |     image_thumbnail_sha256: '',
  721 |     source_image_sha256: '',
  722 |     tags: [],
  723 |     sort_order: 1,
  724 |     is_active: true,
  725 |     is_verified: true,
  726 |   };
  727 | }
  728 | 
  729 | function authSession() {
  730 |   const token = fakeJwt({ sub: CUSTOMER_ID, exp: Math.floor(Date.now() / 1000) + 3600, role: 'authenticated' });
  731 |   return {
  732 |     access_token: token,
  733 |     token_type: 'bearer',
  734 |     expires_in: 3600,
  735 |     expires_at: Math.floor(Date.now() / 1000) + 3600,
  736 |     refresh_token: 'refresh-token-for-e2e-only',
  737 |     user: { id: CUSTOMER_ID, aud: 'authenticated', role: 'authenticated', is_anonymous: true, user_metadata: { taba_actor: 'customer' } },
  738 |   };
  739 | }
  740 | 
  741 | function fakeJwt(payload) {
  742 |   const encode = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');
  743 |   return `${encode({ alg: 'none', typ: 'JWT' })}.${encode(payload)}.signature`;
  744 | }
  745 | 
```