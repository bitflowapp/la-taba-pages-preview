import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'file:///E:/DevCache/Npm/_npx/77dbaf41d727fd82/node_modules/playwright-core/index.mjs';

const outputDirectory = path.resolve('artifacts/taba2-commercial/before/performance');
const url = 'https://taba2-staging.pages.dev/';
const chromePath = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const profiles = [
  { width: 390, height: 844, runs: 5 },
  { width: 320, height: 568, runs: 3 },
];
const throttling = {
  latencyMs: 562.5,
  downloadKbps: 1474.56,
  uploadKbps: 675,
  cpuSlowdownMultiplier: 4,
};

const browser = await chromium.launch({
  executablePath: chromePath,
  headless: true,
  args: ['--disable-gpu'],
});

try {
  for (const profile of profiles) {
    for (let run = 1; run <= profile.runs; run += 1) {
      const context = await browser.newContext({
        viewport: { width: profile.width, height: profile.height },
        deviceScaleFactor: 3,
        isMobile: true,
        hasTouch: true,
        serviceWorkers: 'block',
      });
      const page = await context.newPage();
      const cdp = await context.newCDPSession(page);
      const requests = new Map();

      await cdp.send('Network.enable');
      await cdp.send('Network.setCacheDisabled', { cacheDisabled: true });
      await cdp.send('Network.emulateNetworkConditions', {
        offline: false,
        latency: throttling.latencyMs,
        downloadThroughput: throttling.downloadKbps * 1024 / 8,
        uploadThroughput: throttling.uploadKbps * 1024 / 8,
        connectionType: 'cellular4g',
      });
      await cdp.send('Emulation.setCPUThrottlingRate', {
        rate: throttling.cpuSlowdownMultiplier,
      });

      cdp.on('Network.requestWillBeSent', (event) => {
        requests.set(event.requestId, {
          requestId: event.requestId,
          url: event.request.url,
          method: event.request.method,
          resourceType: event.type,
          initiatorType: event.initiator?.type,
          requestTimestamp: event.timestamp,
        });
      });
      cdp.on('Network.responseReceived', (event) => {
        const entry = requests.get(event.requestId) || { requestId: event.requestId };
        Object.assign(entry, {
          url: event.response.url,
          resourceType: event.type,
          status: event.response.status,
          mimeType: event.response.mimeType,
          protocol: event.response.protocol,
          fromDiskCache: event.response.fromDiskCache,
          fromServiceWorker: event.response.fromServiceWorker,
          responseTimestamp: event.timestamp,
        });
        requests.set(event.requestId, entry);
      });
      cdp.on('Network.loadingFinished', (event) => {
        const entry = requests.get(event.requestId) || { requestId: event.requestId };
        Object.assign(entry, {
          encodedDataLength: event.encodedDataLength,
          finishTimestamp: event.timestamp,
          failed: false,
        });
        requests.set(event.requestId, entry);
      });
      cdp.on('Network.loadingFailed', (event) => {
        const entry = requests.get(event.requestId) || { requestId: event.requestId };
        Object.assign(entry, {
          failed: true,
          errorText: event.errorText,
          canceled: event.canceled,
          finishTimestamp: event.timestamp,
        });
        requests.set(event.requestId, entry);
      });

      await page.addInitScript(() => {
        window.__tabaFirstPurchasable = null;
        const recordFirstPurchasable = () => {
          if (window.__tabaFirstPurchasable) return;
          const candidates = [...document.querySelectorAll('button:not([disabled])')];
          const button = candidates.find((node) => {
            const label = node.getAttribute('aria-label') || '';
            const matchesProduct = /^Agregar .+ al pedido$/i.test(label)
              || node.classList.contains('home-add-button')
              || node.classList.contains('add-button');
            const style = getComputedStyle(node);
            const rect = node.getBoundingClientRect();
            return matchesProduct
              && style.display !== 'none'
              && style.visibility !== 'hidden'
              && rect.width > 0
              && rect.height > 0;
          });
          if (!button) return;
          const rect = button.getBoundingClientRect();
          window.__tabaFirstPurchasable = {
            timeMs: performance.now(),
            text: button.textContent.trim(),
            ariaLabel: button.getAttribute('aria-label'),
            className: button.className,
            rect: {
              top: rect.top,
              right: rect.right,
              bottom: rect.bottom,
              left: rect.left,
              width: rect.width,
              height: rect.height,
            },
          };
        };
        const observer = new MutationObserver(recordFirstPurchasable);
        observer.observe(document, { subtree: true, childList: true, attributes: true });
        document.addEventListener('DOMContentLoaded', recordFirstPurchasable, { once: true });
      });

      const wallStart = Date.now();
      const response = await page.goto(url, {
        waitUntil: 'domcontentloaded',
        timeout: 45_000,
      });
      await page.waitForFunction(() => Boolean(window.__tabaFirstPurchasable), null, {
        timeout: 45_000,
      });

      const firstRendered = await page.evaluate(() => window.__tabaFirstPurchasable);
      let scrollSteps = 0;
      let firstFullyInViewport = await page.evaluate(() => {
        const button = [...document.querySelectorAll('button:not([disabled])')].find((node) => {
          const label = node.getAttribute('aria-label') || '';
          return /^Agregar .+ al pedido$/i.test(label) && node.offsetWidth > 0 && node.offsetHeight > 0;
        });
        if (!button) return null;
        const rect = button.getBoundingClientRect();
        return rect.top >= 0 && rect.bottom <= innerHeight ? performance.now() : null;
      });

      while (firstFullyInViewport === null && scrollSteps < 6) {
        scrollSteps += 1;
        await page.evaluate(() => scrollBy({ top: Math.round(innerHeight * 0.72), behavior: 'instant' }));
        await page.waitForTimeout(100);
        firstFullyInViewport = await page.evaluate(() => {
          const button = [...document.querySelectorAll('button:not([disabled])')].find((node) => {
            const label = node.getAttribute('aria-label') || '';
            return /^Agregar .+ al pedido$/i.test(label) && node.offsetWidth > 0 && node.offsetHeight > 0;
          });
          if (!button) return null;
          const rect = button.getBoundingClientRect();
          return rect.top >= 0 && rect.bottom <= innerHeight ? performance.now() : null;
        });
      }

      await page.waitForLoadState('networkidle', { timeout: 45_000 }).catch(() => {});
      await page.waitForTimeout(1_000);
      const navigation = await page.evaluate(() => {
        const entry = performance.getEntriesByType('navigation')[0];
        return entry ? entry.toJSON() : null;
      });
      const requestItems = [...requests.values()]
        .filter((item) => item.url)
        .sort((a, b) => (a.requestTimestamp || 0) - (b.requestTimestamp || 0));
      const transferBytes = requestItems.reduce((sum, item) => sum + (item.encodedDataLength || 0), 0);

      const result = {
        schemaVersion: 1,
        measuredAt: new Date().toISOString(),
        url,
        finalUrl: page.url(),
        responseStatus: response?.status(),
        viewport: { width: profile.width, height: profile.height, deviceScaleFactor: 3 },
        run,
        browserVersion: await browser.version(),
        coldContext: true,
        serviceWorkersBlocked: true,
        cacheDisabled: true,
        throttling,
        definition: {
          rendered: 'First enabled, laid-out product Add button on customer home.',
          reachable: 'First enabled product Add button fully inside the viewport after 72%-viewport instant scroll gestures.',
          interactionStepsExcludeInitialNavigation: true,
        },
        firstPurchasableRenderedMs: firstRendered.timeMs,
        firstPurchasableFullyInViewportMs: firstFullyInViewport,
        interactionSteps: {
          initialNavigations: 1,
          taps: 0,
          scrollGestures: scrollSteps,
        },
        firstProduct: firstRendered,
        wallDurationMs: Date.now() - wallStart,
        navigation,
        networkSummary: {
          requestCount: requestItems.length,
          failedRequestCount: requestItems.filter((item) => item.failed).length,
          transferBytes,
        },
        requests: requestItems,
      };

      const reportPath = path.join(outputDirectory, `first-product-${profile.width}-run${run}.json`);
      await writeFile(reportPath, `${JSON.stringify(result, null, 2)}\n`, 'utf8');
      console.log(JSON.stringify({
        viewport: profile.width,
        run,
        renderedMs: result.firstPurchasableRenderedMs,
        inViewportMs: result.firstPurchasableFullyInViewportMs,
        scrollSteps,
        requestCount: result.networkSummary.requestCount,
        transferBytes,
      }));
      await context.close();
    }
  }
} finally {
  await browser.close();
}
