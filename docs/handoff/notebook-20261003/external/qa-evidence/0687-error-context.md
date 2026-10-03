# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: la-taba.spec.mjs >> bottom nav respeta safe-area y no cubre contenido
- Location: tests\e2e\la-taba.spec.mjs:564:1

# Error details

```
Error: expect(received).toBeTruthy()

Received: false
```

# Test source

```ts
  512 |       mainScrollable: main.scrollHeight > main.clientHeight + 1,
  513 |     };
  514 |   });
  515 |   expect(mainScrollState.root).toBe('HTML');
  516 |   expect(mainScrollState.overflowY).not.toMatch(/auto|scroll|overlay/);
  517 |   expect(mainScrollState.mainScrollable).toBeFalsy();
  518 | 
  519 |   await page.locator('.mobile-nav [data-nav-view="catalog"]').click();
  520 |   await seedCartAboveMinimum(page);
  521 |   await page.locator('.mobile-nav [data-nav-view="home"]').click();
  522 |   await page.evaluate(() => window.scrollTo(0, 520));
  523 |   await page.locator('[data-floating-cart]').click();
  524 |   await expect(page.locator('[data-view="cart"]')).toBeVisible();
  525 |   await expect(page.locator('[data-view="home"]')).toBeHidden();
  526 |   await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(0);
  527 |   expect(new URL(page.url()).hash).toBe('#cart');
  528 | 
  529 |   await page.goBack();
  530 |   await expect(page.locator('[data-view="home"]')).toBeVisible();
  531 |   await expect(page.locator('[data-view="cart"]')).toBeHidden();
  532 |   await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(0);
  533 |   expect(new URL(page.url()).hash).toBe('#home');
  534 | 
  535 |   await page.locator('[data-floating-cart]').click();
  536 |   await expect(page.locator('[data-view="cart"]')).toBeVisible();
  537 |   await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(0);
  538 | 
  539 |   await page.locator('.mobile-nav [data-nav-view="orders"]').click();
  540 |   await page.locator('[data-view="orders"] [data-nav-view="tracking"]').click();
  541 |   await expect(page.locator('[data-view="tracking"]')).toBeVisible();
  542 |   await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(0);
  543 |   /*
  544 |    * «Seguir» conserva la barra. Antes se ocultaba, y como el hamburguesa de la
  545 |    * cabecera está colapsado a 0x0 en este layout, la única salida en el
  546 |    * teléfono era el wordmark del comercio en el topbar: cualquier otro destino
  547 |    * obligaba a pasar por el inicio. Ahora es una sección más y se sale de ella
  548 |    * como de cualquier otra — que es justo lo que prueba el paso siguiente.
  549 |    */
  550 |   await expect(page.locator('.mobile-nav')).toBeVisible();
  551 | 
  552 |   await page.locator('.mobile-nav [data-nav-view="profile"]').click();
  553 |   await expect(page.locator('[data-view="profile"]')).toBeVisible();
  554 |   await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(0);
  555 | 
  556 |   await page.locator('.mobile-nav [data-nav-view="home"]').click();
  557 |   await expect(page.locator('[data-view="home"]')).toBeVisible();
  558 |   await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(0);
  559 | 
  560 |   await guards.assertClean();
  561 |   await context.close();
  562 | });
  563 | 
  564 | test('bottom nav respeta safe-area y no cubre contenido', async ({ browser }) => {
  565 |   const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  566 |   const page = await context.newPage();
  567 |   const guards = installPageGuards(page);
  568 |   const measureNav = () => page.locator('.mobile-nav').evaluate((nav) => {
  569 |     const rect = nav.getBoundingClientRect();
  570 |     const rootStyle = getComputedStyle(document.documentElement);
  571 |     return {
  572 |       height: rect.height,
  573 |       navHeightToken: rootStyle.getPropertyValue('--taba-bottom-nav-height').trim(),
  574 |       navGapToken: rootStyle.getPropertyValue('--taba-bottom-nav-gap').trim(),
  575 |       mainPaddingBottom: Number.parseFloat(
  576 |         getComputedStyle(document.querySelector('main[data-app-main]')).paddingBottom,
  577 |       ),
  578 |       buttonBottomDistances: [...nav.querySelectorAll('button')]
  579 |         .map((button) => window.innerHeight - button.getBoundingClientRect().bottom),
  580 |       scrollWidth: document.documentElement.scrollWidth,
  581 |       viewportWidth: window.innerWidth,
  582 |     };
  583 |   });
  584 | 
  585 |   try {
  586 |     await installBrowserStubs(page);
  587 |     await page.goto('/?demo=1');
  588 |     await expect(page.locator('[data-view="home"]')).toBeVisible();
  589 | 
  590 |     const safe0 = await measureNav();
  591 |     await page.addStyleTag({ content: ':root { --safe-area-bottom: 34px; }' });
  592 |     const safe34 = await measureNav();
  593 | 
  594 |     await expect(page.locator('.mobile-nav')).toBeVisible();
  595 |     // Cinco rutas reales, una por control y sin destino repetido: el ancla de
  596 |     // marca del centro ES el inicio.
  597 |     await expect(page.locator('.mobile-nav button')).toHaveCount(4);
  598 |     for (const view of ['home', 'catalog', 'orders', 'profile']) {
  599 |       await expect(page.locator(`.mobile-nav [data-nav-view="${view}"]`)).toHaveCount(1);
  600 |     }
  601 |     const navHeight = Number.parseFloat(safe0.navHeightToken);
  602 |     const navGap = Number.parseFloat(safe0.navGapToken);
  603 |     expect(navHeight).toBeGreaterThan(0);
  604 |     expect(navGap).toBeGreaterThanOrEqual(0);
  605 |     expect(safe0.mainPaddingBottom).toBe(navHeight + navGap);
  606 |     expect(safe34.height - safe0.height).toBeGreaterThanOrEqual(32);
  607 |     expect(safe34.height - safe0.height).toBeLessThanOrEqual(36);
  608 |     const paddingDelta = safe34.mainPaddingBottom - safe0.mainPaddingBottom;
  609 |     expect(paddingDelta).toBeGreaterThanOrEqual(33);
  610 |     expect(paddingDelta).toBeLessThanOrEqual(35);
  611 |     expect(safe34.mainPaddingBottom).toBe(safe0.mainPaddingBottom + 34);
> 612 |     expect(safe34.buttonBottomDistances.every((distance) => distance >= 42)).toBeTruthy();
      |                                                                              ^ Error: expect(received).toBeTruthy()
  613 |     expect(safe34.scrollWidth).toBeLessThanOrEqual(safe34.viewportWidth + 1);
  614 | 
  615 |     const initialCta = await page.evaluate(() => {
  616 |       const root = document.scrollingElement ?? document.documentElement;
  617 |       const navRect = document.querySelector('.mobile-nav').getBoundingClientRect();
  618 |       const ctaRect = document.querySelector('button.order-now-cta').getBoundingClientRect();
  619 |       return {
  620 |         overlap: ctaRect.bottom > navRect.top && ctaRect.top < navRect.bottom,
  621 |         maxScroll: root.scrollHeight - root.clientHeight,
  622 |       };
  623 |     });
  624 |     if (initialCta.overlap) {
  625 |       expect(initialCta.maxScroll).toBeGreaterThan(0);
  626 |     }
  627 | 
  628 |     await page.evaluate(() => {
  629 |       const root = document.scrollingElement ?? document.documentElement;
  630 |       window.scrollTo({
  631 |         top: root.scrollHeight - root.clientHeight,
  632 |         behavior: 'instant',
  633 |       });
  634 |     });
  635 |     await expect.poll(() => page.evaluate(() => {
  636 |       const root = document.scrollingElement ?? document.documentElement;
  637 |       window.scrollTo({
  638 |         top: root.scrollHeight - root.clientHeight,
  639 |         behavior: 'instant',
  640 |       });
  641 |       return Math.abs(window.scrollY - (root.scrollHeight - root.clientHeight));
  642 |     })).toBeLessThanOrEqual(1);
  643 |     const ctaGap = await page.evaluate(() => {
  644 |       const navRect = document.querySelector('.mobile-nav').getBoundingClientRect();
  645 |       const ctaRect = document.querySelector('button.order-now-cta').getBoundingClientRect();
  646 |       return navRect.top - ctaRect.bottom;
  647 |     });
  648 |     expect(ctaGap).toBeGreaterThanOrEqual(12);
  649 | 
  650 |     await page.goto('/?demo=1#catalog');
  651 |     await expect(page.locator('[data-product-grid] .product-card')).not.toHaveCount(0);
  652 |     await page.evaluate(() => {
  653 |       const root = document.scrollingElement ?? document.documentElement;
  654 |       window.scrollTo({
  655 |         top: root.scrollHeight - root.clientHeight,
  656 |         behavior: 'instant',
  657 |       });
  658 |     });
  659 |     await expect.poll(() => page.evaluate(() => {
  660 |       const root = document.scrollingElement ?? document.documentElement;
  661 |       return Math.abs(window.scrollY - (root.scrollHeight - root.clientHeight));
  662 |     })).toBeLessThanOrEqual(1);
  663 |     const catalogGeometry = await page.evaluate(() => {
  664 |       const navRect = document.querySelector('.mobile-nav').getBoundingClientRect();
  665 |       const cards = [...document.querySelectorAll('[data-product-grid] .product-card')];
  666 |       const lastRowTop = Math.max(...cards.map((card) => card.getBoundingClientRect().top));
  667 |       const lastRow = cards
  668 |         .map((card) => card.getBoundingClientRect())
  669 |         .filter((rect) => Math.abs(rect.top - lastRowTop) <= 1);
  670 |       const topbarRect = document.querySelector('.topbar').getBoundingClientRect();
  671 |       const categoryStrip = document.querySelector('[data-view="catalog"] .category-strip');
  672 |       return {
  673 |         lastRowGap: navRect.top - Math.max(...lastRow.map((rect) => rect.bottom)),
  674 |         lastRowHeightDelta: Math.max(...lastRow.map((rect) => rect.height))
  675 |           - Math.min(...lastRow.map((rect) => rect.height)),
  676 |         topbarTop: topbarRect.top,
  677 |         horizontalFilterScrollable: categoryStrip.scrollWidth > categoryStrip.clientWidth,
  678 |         horizontalOverflow: document.documentElement.scrollWidth > window.innerWidth + 1,
  679 |       };
  680 |     });
  681 |     expect(catalogGeometry.lastRowGap).toBeGreaterThanOrEqual(18);
  682 |     expect(catalogGeometry.lastRowHeightDelta).toBeLessThanOrEqual(1);
  683 |     expect(Math.abs(catalogGeometry.topbarTop)).toBeLessThanOrEqual(1);
  684 |     expect(catalogGeometry.horizontalFilterScrollable).toBeTruthy();
  685 |     expect(catalogGeometry.horizontalOverflow).toBeFalsy();
  686 | 
  687 |     await page.locator('.mobile-nav [data-nav-view="orders"]').click();
  688 |   await page.locator('[data-view="orders"] [data-nav-view="tracking"]').click();
  689 |     await expect(page.locator('.tracking-premium')).toBeVisible();
  690 |     /*
  691 |      * La barra se queda también acá. La reserva no la pone `main` —que sigue
  692 |      * en 0 para esta vista— sino la propia sección, con el mismo token que usan
  693 |      * las demás. Lo que importa es el efecto: que la barra no tape el final del
  694 |      * contenido, y eso es lo que se mide abajo en píxeles reales.
  695 |      */
  696 |     await expect(page.locator('.mobile-nav')).toBeVisible();
  697 |     const trackingClearance = await page.evaluate(() => {
  698 |       const nav = document.querySelector('.mobile-nav').getBoundingClientRect();
  699 |       const view = document.querySelector('[data-view="tracking"]');
  700 |       const last = view.querySelector('.tracking-sheet > *:last-child');
  701 |       return {
  702 |         gap: nav.top - last.getBoundingClientRect().bottom,
  703 |         viewPaddingBottom: Number.parseFloat(getComputedStyle(view).paddingBottom),
  704 |         navHeight: nav.height,
  705 |       };
  706 |     });
  707 |     expect(trackingClearance.viewPaddingBottom).toBeGreaterThanOrEqual(trackingClearance.navHeight);
  708 |     expect(trackingClearance.gap).toBeGreaterThanOrEqual(0);
  709 |     const measureMain = () => page.evaluate(() => {
  710 |       const main = document.querySelector('main[data-app-main]');
  711 |       const style = getComputedStyle(main);
  712 |       return {
```