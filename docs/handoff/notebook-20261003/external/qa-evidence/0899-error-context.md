# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: la-taba.spec.mjs >> bottom nav respeta safe-area y no cubre contenido
- Location: D:\1212\focused-webkit-compare\measure-branch\tests\e2e\la-taba.spec.mjs:535:1

# Error details

```
Error: expect(locator).toHaveCount(expected) failed

Locator:  locator('.mobile-nav button')
Expected: 4
Received: 5
Timeout:  5000ms

Call log:
  - Expect "toHaveCount" with timeout 5000ms
  - waiting for locator('.mobile-nav button')
    14 × locator resolved to 5 elements
       - unexpected value "5"

```

# Test source

```ts
  466 |     await waitForToast(page, 'Código de entrega confirmado.');
  467 |     await page.locator('[data-delivery-done]').first().click();
  468 |     await waitForToast(page, 'Pedido marcado como entregado.');
  469 |     await expect(page.locator('[data-delivery-panel]')).toContainText('Sin entregas disponibles');
  470 |   }
  471 | 
  472 |   await guards.assertClean();
  473 | });
  474 | 
  475 | test('bottom nav cambia pantallas sin navegar por scroll', async ({ browser }) => {
  476 |   const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  477 |   const page = await context.newPage();
  478 |   const guards = installPageGuards(page);
  479 | 
  480 |   await installBrowserStubs(page);
  481 |   await page.goto('/?demo=1');
  482 |   await expect(page.locator('[data-view="home"]')).toBeVisible();
  483 |   expect(await page.evaluate(() => history.scrollRestoration)).toBe('manual');
  484 | 
  485 |   const mainScrollState = await page.evaluate(() => {
  486 |     const main = document.querySelector('main[data-app-main]');
  487 |     const mainStyle = getComputedStyle(main);
  488 |     return {
  489 |       root: document.scrollingElement?.tagName,
  490 |       overflowY: mainStyle.overflowY,
  491 |       mainScrollable: main.scrollHeight > main.clientHeight + 1,
  492 |     };
  493 |   });
  494 |   expect(mainScrollState.root).toBe('HTML');
  495 |   expect(mainScrollState.overflowY).not.toMatch(/auto|scroll|overlay/);
  496 |   expect(mainScrollState.mainScrollable).toBeFalsy();
  497 | 
  498 |   await page.locator('.mobile-nav [data-nav-view="catalog"]').click();
  499 |   await page.locator('[data-product-grid] [data-add-product]:not([disabled])').first().click();
  500 |   await page.locator('.mobile-nav [data-nav-view="home"]').click();
  501 |   await page.evaluate(() => window.scrollTo(0, 520));
  502 |   await page.locator('[data-floating-cart]').click();
  503 |   await expect(page.locator('[data-view="cart"]')).toBeVisible();
  504 |   await expect(page.locator('[data-view="home"]')).toBeHidden();
  505 |   await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(0);
  506 |   expect(new URL(page.url()).hash).toBe('#cart');
  507 | 
  508 |   await page.goBack();
  509 |   await expect(page.locator('[data-view="home"]')).toBeVisible();
  510 |   await expect(page.locator('[data-view="cart"]')).toBeHidden();
  511 |   await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(0);
  512 |   expect(new URL(page.url()).hash).toBe('#home');
  513 | 
  514 |   await page.locator('[data-floating-cart]').click();
  515 |   await expect(page.locator('[data-view="cart"]')).toBeVisible();
  516 |   await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(0);
  517 | 
  518 |   await page.locator('.mobile-nav [data-nav-view="tracking"]').click();
  519 |   await expect(page.locator('[data-view="tracking"]')).toBeVisible();
  520 |   await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(0);
  521 |   await expect(page.locator('.mobile-nav')).toBeHidden();
  522 | 
  523 |   await page.goto('/?demo=1#profile');
  524 |   await expect(page.locator('[data-view="profile"]')).toBeVisible();
  525 |   await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(0);
  526 | 
  527 |   await page.locator('.mobile-nav [data-nav-view="home"]').click();
  528 |   await expect(page.locator('[data-view="home"]')).toBeVisible();
  529 |   await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(0);
  530 | 
  531 |   await guards.assertClean();
  532 |   await context.close();
  533 | });
  534 | 
  535 | test('bottom nav respeta safe-area y no cubre contenido', async ({ browser }) => {
  536 |   const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  537 |   const page = await context.newPage();
  538 |   const guards = installPageGuards(page);
  539 |   const measureNav = () => page.locator('.mobile-nav').evaluate((nav) => {
  540 |     const rect = nav.getBoundingClientRect();
  541 |     const rootStyle = getComputedStyle(document.documentElement);
  542 |     return {
  543 |       height: rect.height,
  544 |       navHeightToken: rootStyle.getPropertyValue('--taba-bottom-nav-height').trim(),
  545 |       navGapToken: rootStyle.getPropertyValue('--taba-bottom-nav-gap').trim(),
  546 |       mainPaddingBottom: Number.parseFloat(
  547 |         getComputedStyle(document.querySelector('main[data-app-main]')).paddingBottom,
  548 |       ),
  549 |       buttonBottomDistances: [...nav.querySelectorAll('button')]
  550 |         .map((button) => window.innerHeight - button.getBoundingClientRect().bottom),
  551 |       scrollWidth: document.documentElement.scrollWidth,
  552 |       viewportWidth: window.innerWidth,
  553 |     };
  554 |   });
  555 | 
  556 |   try {
  557 |     await installBrowserStubs(page);
  558 |     await page.goto('/?demo=1');
  559 |     await expect(page.locator('[data-view="home"]')).toBeVisible();
  560 | 
  561 |     const safe0 = await measureNav();
  562 |     await page.addStyleTag({ content: ':root { --safe-area-bottom: 34px; }' });
  563 |     const safe34 = await measureNav();
  564 | 
  565 |     await expect(page.locator('.mobile-nav')).toBeVisible();
> 566 |     await expect(page.locator('.mobile-nav button')).toHaveCount(4);
      |                                                      ^ Error: expect(locator).toHaveCount(expected) failed
  567 |     const navHeight = Number.parseFloat(safe0.navHeightToken);
  568 |     const navGap = Number.parseFloat(safe0.navGapToken);
  569 |     expect(navHeight).toBeGreaterThan(0);
  570 |     expect(navGap).toBeGreaterThanOrEqual(0);
  571 |     expect(safe0.mainPaddingBottom).toBe(navHeight + navGap);
  572 |     expect(safe34.height - safe0.height).toBeGreaterThanOrEqual(32);
  573 |     expect(safe34.height - safe0.height).toBeLessThanOrEqual(36);
  574 |     const paddingDelta = safe34.mainPaddingBottom - safe0.mainPaddingBottom;
  575 |     expect(paddingDelta).toBeGreaterThanOrEqual(33);
  576 |     expect(paddingDelta).toBeLessThanOrEqual(35);
  577 |     expect(safe34.mainPaddingBottom).toBe(safe0.mainPaddingBottom + 34);
  578 |     expect(safe34.buttonBottomDistances.every((distance) => distance >= 42)).toBeTruthy();
  579 |     expect(safe34.scrollWidth).toBeLessThanOrEqual(safe34.viewportWidth + 1);
  580 | 
  581 |     const initialCta = await page.evaluate(() => {
  582 |       const root = document.scrollingElement ?? document.documentElement;
  583 |       const navRect = document.querySelector('.mobile-nav').getBoundingClientRect();
  584 |       const ctaRect = document.querySelector('button.order-now-cta').getBoundingClientRect();
  585 |       return {
  586 |         overlap: ctaRect.bottom > navRect.top && ctaRect.top < navRect.bottom,
  587 |         maxScroll: root.scrollHeight - root.clientHeight,
  588 |       };
  589 |     });
  590 |     if (initialCta.overlap) {
  591 |       expect(initialCta.maxScroll).toBeGreaterThan(0);
  592 |     }
  593 | 
  594 |     await page.evaluate(() => {
  595 |       const root = document.scrollingElement ?? document.documentElement;
  596 |       window.scrollTo({
  597 |         top: root.scrollHeight - root.clientHeight,
  598 |         behavior: 'instant',
  599 |       });
  600 |     });
  601 |     await expect.poll(() => page.evaluate(() => {
  602 |       const root = document.scrollingElement ?? document.documentElement;
  603 |       return Math.abs(window.scrollY - (root.scrollHeight - root.clientHeight));
  604 |     })).toBeLessThanOrEqual(1);
  605 |     const ctaGap = await page.evaluate(() => {
  606 |       const navRect = document.querySelector('.mobile-nav').getBoundingClientRect();
  607 |       const ctaRect = document.querySelector('button.order-now-cta').getBoundingClientRect();
  608 |       return navRect.top - ctaRect.bottom;
  609 |     });
  610 |     expect(ctaGap).toBeGreaterThanOrEqual(12);
  611 | 
  612 |     await page.goto('/?demo=1#catalog');
  613 |     await expect(page.locator('[data-product-grid] .product-card')).not.toHaveCount(0);
  614 |     await page.evaluate(() => window.scrollTo({
  615 |       top: document.documentElement.scrollHeight,
  616 |       behavior: 'instant',
  617 |     }));
  618 |     const catalogGeometry = await page.evaluate(() => {
  619 |       const navRect = document.querySelector('.mobile-nav').getBoundingClientRect();
  620 |       const cards = [...document.querySelectorAll('[data-product-grid] .product-card')];
  621 |       const lastRowTop = Math.max(...cards.map((card) => card.getBoundingClientRect().top));
  622 |       const lastRow = cards
  623 |         .map((card) => card.getBoundingClientRect())
  624 |         .filter((rect) => Math.abs(rect.top - lastRowTop) <= 1);
  625 |       const topbarRect = document.querySelector('.topbar').getBoundingClientRect();
  626 |       const categoryStrip = document.querySelector('[data-view="catalog"] .category-strip');
  627 |       return {
  628 |         lastRowGap: navRect.top - Math.max(...lastRow.map((rect) => rect.bottom)),
  629 |         lastRowHeightDelta: Math.max(...lastRow.map((rect) => rect.height))
  630 |           - Math.min(...lastRow.map((rect) => rect.height)),
  631 |         topbarTop: topbarRect.top,
  632 |         horizontalFilterScrollable: categoryStrip.scrollWidth > categoryStrip.clientWidth,
  633 |         horizontalOverflow: document.documentElement.scrollWidth > window.innerWidth + 1,
  634 |       };
  635 |     });
  636 |     console.log('[MEASURE][la-taba]', JSON.stringify({
  637 |       viewport: await page.evaluate(() => ({ width: window.innerWidth, height: window.innerHeight })),
  638 |       scrollWidth: await page.evaluate(() => document.documentElement.scrollWidth),
  639 |       catalogGeometry,
  640 |     }));
  641 |     expect(catalogGeometry.lastRowGap).toBeGreaterThanOrEqual(18);
  642 |     expect(catalogGeometry.lastRowHeightDelta).toBeLessThanOrEqual(1);
  643 |     expect(Math.abs(catalogGeometry.topbarTop)).toBeLessThanOrEqual(1);
  644 |     expect(catalogGeometry.horizontalFilterScrollable).toBeTruthy();
  645 |     expect(catalogGeometry.horizontalOverflow).toBeFalsy();
  646 | 
  647 |     await page.locator('.mobile-nav [data-nav-view="tracking"]').click();
  648 |     await expect(page.locator('.tracking-premium')).toBeVisible();
  649 |     await expect(page.locator('.mobile-nav')).toBeHidden();
  650 |     const measureMain = () => page.evaluate(() => {
  651 |       const main = document.querySelector('main[data-app-main]');
  652 |       const style = getComputedStyle(main);
  653 |       return {
  654 |         root: document.scrollingElement?.tagName,
  655 |         height: typeof main.computedStyleMap === 'function'
  656 |           ? main.computedStyleMap().get('height').toString()
  657 |           : (main.style.height || 'auto'),
  658 |         overflowY: style.overflowY,
  659 |         paddingBottom: style.paddingBottom,
  660 |         scrollable: main.scrollHeight > main.clientHeight + 1,
  661 |         horizontalOverflow: document.documentElement.scrollWidth > window.innerWidth + 1,
  662 |       };
  663 |     });
  664 |     const trackingState = await measureMain();
  665 |     expect(trackingState).toMatchObject({
  666 |       root: 'HTML',
```