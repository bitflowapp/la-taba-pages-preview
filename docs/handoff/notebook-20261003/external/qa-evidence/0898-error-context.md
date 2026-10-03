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
  636 |     console.log('[MEASURE][la-taba]', JSON.stringify({
  637 |       viewport: await page.evaluate(() => ({ width: window.innerWidth, height: window.innerHeight })),
  638 |       scrollWidth: await page.evaluate(() => document.documentElement.scrollWidth),
  639 |       catalogGeometry,
  640 |     }));
  641 |     expect(catalogGeometry.lastRowGap).toBeGreaterThanOrEqual(18);
  642 |     expect(catalogGeometry.lastRowHeightDelta).toBeLessThanOrEqual(1);
  643 |     expect(Math.abs(catalogGeometry.topbarTop)).toBeLessThanOrEqual(1);
  644 |     expect(catalogGeometry.horizontalFilterScrollable).toBeTruthy();
> 645 |     expect(catalogGeometry.horizontalOverflow).toBeFalsy();
      |                                                ^ Error: expect(received).toBeFalsy()
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
  667 |       height: 'auto',
  668 |       overflowY: 'visible',
  669 |       paddingBottom: '0px',
  670 |       scrollable: false,
  671 |       horizontalOverflow: false,
  672 |     });
  673 | 
  674 |     for (const view of ['business', 'rider']) {
  675 |       await page.goto(`/?demo=1#${view}`);
  676 |       await expect(page.locator(`[data-view="${view}"]`)).toBeVisible();
  677 |       await expect(page.locator('.mobile-nav')).toBeHidden();
  678 |       expect(await measureMain()).toMatchObject({
  679 |         root: 'HTML',
  680 |         height: 'auto',
  681 |         overflowY: 'visible',
  682 |         paddingBottom: '0px',
  683 |         scrollable: false,
  684 |         horizontalOverflow: false,
  685 |       });
  686 |     }
  687 | 
  688 |     await page.setViewportSize({ width: 844, height: 390 });
  689 |     await page.goto('/?demo=1');
  690 |     await expect(page.locator('.mobile-nav')).toBeHidden();
  691 |     const landscapeState = await measureMain();
  692 |     expect(landscapeState.root).toBe('HTML');
  693 |     expect(landscapeState.overflowY).not.toMatch(/auto|scroll|overlay/);
  694 |     expect(landscapeState.scrollable).toBeFalsy();
  695 |     expect(landscapeState.horizontalOverflow).toBeFalsy();
  696 |     await guards.assertClean();
  697 |   } finally {
  698 |     await context.close();
  699 |   }
  700 | });
  701 | 
  702 |   for (const [name, viewport] of [
  703 |     ['narrow 320x700', { width: 320, height: 700 }],
  704 |     ['Android-small 360x800', { width: 360, height: 800 }],
  705 |     ['iPhone-like 390x844', { width: 390, height: 844 }],
  706 |     ['Android-like 412x915', { width: 412, height: 915 }],
  707 |     ['tablet 768x1024', { width: 768, height: 1024 }],
  708 |     ['desktop 1280x900', { width: 1280, height: 900 }],
  709 |   ]) {
  710 |   test(`responsive smoke ${name}`, async ({ browser }) => {
  711 |     const context = await browser.newContext({ viewport });
  712 |     const page = await context.newPage();
  713 |     const guards = installPageGuards(page);
  714 | 
  715 |     await installBrowserStubs(page);
  716 |     await page.goto('/?demo=1');
  717 | 
  718 |     if (viewport.width <= 820) {
  719 |       await expect(page.locator('.mobile-nav')).toBeVisible();
  720 |       await expect(page.locator('.desktop-nav')).toBeHidden();
  721 |     } else {
  722 |       await expect(page.locator('.desktop-nav')).toBeVisible();
  723 |       await expect(page.locator('.mobile-nav')).toBeHidden();
  724 |     }
  725 |     const catalogNav = viewport.width <= 820 ? '.mobile-nav [data-nav-view="catalog"]' : '.desktop-nav [data-nav-view="catalog"]';
  726 |     if (viewport.width <= 820) {
  727 |       await page.goto('/?demo=1#catalog');
  728 |     } else {
  729 |       await page.locator(catalogNav).click();
  730 |     }
  731 |     await expect(page.locator('[data-view="catalog"]')).toBeVisible();
  732 |     await expect(page.locator('[data-product-grid] .product-card').first()).toBeVisible();
  733 |     await expect.poll(() => page.locator('[data-product-grid] .product-card').count()).toBeGreaterThan(0);
  734 | 
  735 |     await page.locator('[data-product-grid] [data-add-product]:not([disabled])').first().click();
  736 |     if (viewport.width <= 820) {
  737 |       await page.locator('[data-floating-cart]').click();
  738 |     } else {
  739 |       await page.locator('.desktop-nav [data-nav-view="cart"]').click();
  740 |     }
  741 |     await expect(page.locator('[data-checkout-form]')).toBeVisible();
  742 |     await expect.poll(() => page.evaluate(() => (
  743 |       document.documentElement.scrollWidth <= document.documentElement.clientWidth
  744 |     ))).toBe(true);
  745 | 
```