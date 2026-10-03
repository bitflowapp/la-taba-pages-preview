# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: la-taba.spec.mjs >> bottom nav respeta safe-area y no cubre contenido
- Location: tests\e2e\la-taba.spec.mjs:535:1

# Error details

```
Error: expect(received).toBeFalsy()

Received: true
```

# Test source

```ts
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
  566 |     await expect(page.locator('.mobile-nav button')).toHaveCount(4);
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
  636 |     expect(catalogGeometry.lastRowGap).toBeGreaterThanOrEqual(18);
  637 |     expect(catalogGeometry.lastRowHeightDelta).toBeLessThanOrEqual(1);
  638 |     expect(Math.abs(catalogGeometry.topbarTop)).toBeLessThanOrEqual(1);
  639 |     expect(catalogGeometry.horizontalFilterScrollable).toBeTruthy();
> 640 |     expect(catalogGeometry.horizontalOverflow).toBeFalsy();
      |                                                ^ Error: expect(received).toBeFalsy()
  641 | 
  642 |     await page.locator('.mobile-nav [data-nav-view="tracking"]').click();
  643 |     await expect(page.locator('.tracking-premium')).toBeVisible();
  644 |     await expect(page.locator('.mobile-nav')).toBeHidden();
  645 |     const measureMain = () => page.evaluate(() => {
  646 |       const main = document.querySelector('main[data-app-main]');
  647 |       const style = getComputedStyle(main);
  648 |       return {
  649 |         root: document.scrollingElement?.tagName,
  650 |         height: typeof main.computedStyleMap === 'function'
  651 |           ? main.computedStyleMap().get('height').toString()
  652 |           : (main.style.height || 'auto'),
  653 |         overflowY: style.overflowY,
  654 |         paddingBottom: style.paddingBottom,
  655 |         scrollable: main.scrollHeight > main.clientHeight + 1,
  656 |         horizontalOverflow: document.documentElement.scrollWidth > window.innerWidth + 1,
  657 |       };
  658 |     });
  659 |     const trackingState = await measureMain();
  660 |     expect(trackingState).toMatchObject({
  661 |       root: 'HTML',
  662 |       height: 'auto',
  663 |       overflowY: 'visible',
  664 |       paddingBottom: '0px',
  665 |       scrollable: false,
  666 |       horizontalOverflow: false,
  667 |     });
  668 | 
  669 |     for (const view of ['business', 'rider']) {
  670 |       await page.goto(`/?demo=1#${view}`);
  671 |       await expect(page.locator(`[data-view="${view}"]`)).toBeVisible();
  672 |       await expect(page.locator('.mobile-nav')).toBeHidden();
  673 |       expect(await measureMain()).toMatchObject({
  674 |         root: 'HTML',
  675 |         height: 'auto',
  676 |         overflowY: 'visible',
  677 |         paddingBottom: '0px',
  678 |         scrollable: false,
  679 |         horizontalOverflow: false,
  680 |       });
  681 |     }
  682 | 
  683 |     await page.setViewportSize({ width: 844, height: 390 });
  684 |     await page.goto('/?demo=1');
  685 |     await expect(page.locator('.mobile-nav')).toBeHidden();
  686 |     const landscapeState = await measureMain();
  687 |     expect(landscapeState.root).toBe('HTML');
  688 |     expect(landscapeState.overflowY).not.toMatch(/auto|scroll|overlay/);
  689 |     expect(landscapeState.scrollable).toBeFalsy();
  690 |     expect(landscapeState.horizontalOverflow).toBeFalsy();
  691 |     await guards.assertClean();
  692 |   } finally {
  693 |     await context.close();
  694 |   }
  695 | });
  696 | 
  697 |   for (const [name, viewport] of [
  698 |     ['narrow 320x700', { width: 320, height: 700 }],
  699 |     ['Android-small 360x800', { width: 360, height: 800 }],
  700 |     ['iPhone-like 390x844', { width: 390, height: 844 }],
  701 |     ['Android-like 412x915', { width: 412, height: 915 }],
  702 |     ['tablet 768x1024', { width: 768, height: 1024 }],
  703 |     ['desktop 1280x900', { width: 1280, height: 900 }],
  704 |   ]) {
  705 |   test(`responsive smoke ${name}`, async ({ browser }) => {
  706 |     const context = await browser.newContext({ viewport });
  707 |     const page = await context.newPage();
  708 |     const guards = installPageGuards(page);
  709 | 
  710 |     await installBrowserStubs(page);
  711 |     await page.goto('/?demo=1');
  712 | 
  713 |     if (viewport.width <= 820) {
  714 |       await expect(page.locator('.mobile-nav')).toBeVisible();
  715 |       await expect(page.locator('.desktop-nav')).toBeHidden();
  716 |     } else {
  717 |       await expect(page.locator('.desktop-nav')).toBeVisible();
  718 |       await expect(page.locator('.mobile-nav')).toBeHidden();
  719 |     }
  720 |     const catalogNav = viewport.width <= 820 ? '.mobile-nav [data-nav-view="catalog"]' : '.desktop-nav [data-nav-view="catalog"]';
  721 |     if (viewport.width <= 820) {
  722 |       await page.goto('/?demo=1#catalog');
  723 |     } else {
  724 |       await page.locator(catalogNav).click();
  725 |     }
  726 |     await expect(page.locator('[data-view="catalog"]')).toBeVisible();
  727 |     await expect(page.locator('[data-product-grid] .product-card').first()).toBeVisible();
  728 |     await expect.poll(() => page.locator('[data-product-grid] .product-card').count()).toBeGreaterThan(0);
  729 | 
  730 |     await page.locator('[data-product-grid] [data-add-product]:not([disabled])').first().click();
  731 |     if (viewport.width <= 820) {
  732 |       await page.locator('[data-floating-cart]').click();
  733 |     } else {
  734 |       await page.locator('.desktop-nav [data-nav-view="cart"]').click();
  735 |     }
  736 |     await expect(page.locator('[data-checkout-form]')).toBeVisible();
  737 |     await expect.poll(() => page.evaluate(() => (
  738 |       document.documentElement.scrollWidth <= document.documentElement.clientWidth
  739 |     ))).toBe(true);
  740 | 
```