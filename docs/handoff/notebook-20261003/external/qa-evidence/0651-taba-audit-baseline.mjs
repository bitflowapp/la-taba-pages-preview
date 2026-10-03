import { createRequire } from 'node:module';
import { mkdir, open } from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';

const repo = 'C:\\1212\\la-taba-ux-ultra-showcase';
const output = 'C:\\1212\\artifacts\\taba-ux-ultra-showcase\\baseline';
const port = 18100;
const baseURL = `http://127.0.0.1:${port}`;
const require = createRequire(path.join(repo, 'package.json'));
const { chromium } = require('@playwright/test');

await mkdir(output, { recursive: true });
const stdout = await open(path.join(output, 'server.stdout.log'), 'w');
const stderr = await open(path.join(output, 'server.stderr.log'), 'w');
const server = spawn(process.execPath, ['scripts/realtime-relay.mjs', String(port)], {
  cwd: repo,
  windowsHide: true,
  stdio: ['ignore', stdout.fd, stderr.fd],
});

try {
  await waitUntilReady(`${baseURL}/`);
  const results = await auditLiveApp();
  console.log(JSON.stringify(results, null, 2));
} finally {
  server.kill();
  await stdout.close();
  await stderr.close();
}

async function auditLiveApp() {
  const browser = await chromium.launch();
  const results = [];
  try {
    for (const viewport of [
      { width: 320, height: 568 },
      { width: 390, height: 844 },
      { width: 412, height: 915 },
      { width: 430, height: 932 },
      { width: 768, height: 1024 },
      { width: 1280, height: 900 },
    ]) {
      const context = await browser.newContext({ viewport, serviceWorkers: 'block' });
      const page = await context.newPage();
      const consoleErrors = [];
      const failedRequests = [];
      page.on('console', (message) => {
        if (message.type() === 'error') consoleErrors.push(message.text());
      });
      page.on('requestfailed', (request) => {
        failedRequests.push({
          method: request.method(),
          url: request.url(),
          error: request.failure()?.errorText || '',
        });
      });

      await page.goto(`${baseURL}/?reset=1&demo=1#home`);
      await page.waitForSelector('body[data-app-mode="demo"]');
      await page.waitForSelector('[data-view="home"].is-active');
      const size = `${viewport.width}x${viewport.height}`;

      await capture(page, results, '01-home', size);

      await page.goto(`${baseURL}/?demo=1#catalog`);
      await page.waitForSelector('[data-view="catalog"].is-active');
      await capture(page, results, '02-catalog', size);

      await page.locator('[data-product-grid] [data-product-detail]').first().click();
      await page.waitForSelector('[data-product-modal]:not([hidden])');
      await capture(page, results, '03-product', size);
      await page.keyboard.press('Escape');

      await page.locator('[data-product-grid] [data-add-product]:not([disabled])').first().click();
      await page.locator('[data-open-cart]').first().click();
      await page.waitForSelector('[data-view="cart"].is-active');
      await capture(page, results, '04-cart-checkout', size);

      await page.goto(`${baseURL}/?demo=1#profile`);
      await page.waitForSelector('[data-view="profile"].is-active');
      await capture(page, results, '05-profile-addresses', size);

      await page.goto(`${baseURL}/?demo=1#business`);
      await page.waitForSelector('[data-view="business"].is-active');
      await unlockOperationalView(page, 'business');
      await page.waitForSelector('[data-business-dashboard]');
      await capture(page, results, '06-business', size);

      await page.goto(`${baseURL}/?demo=1#rider`);
      await page.waitForSelector('[data-view="rider"].is-active');
      await unlockOperationalView(page, 'rider');
      await capture(page, results, '07-rider', size);

      await page.goto(`${baseURL}/?demo=1#tracking`);
      await page.waitForSelector('[data-view="tracking"].is-active');
      await capture(page, results, '08-tracking', size);

      results.push({ size, consoleErrors, failedRequests });
      await context.close();
    }
  } finally {
    await browser.close();
  }
  return results;
}

async function unlockOperationalView(page, view) {
  const trigger = page.locator(`[data-open-pin][data-admin-target="${view}"]`);
  if (!(await trigger.isVisible())) return;
  await trigger.click();
  await page.locator('[data-pin-form] input[name="pin"]').fill('1234');
  await page.locator('[data-pin-form]').press('Enter');
}

async function capture(page, results, name, size) {
  await page.waitForTimeout(100);
  const geometry = await page.evaluate(() => ({
    activeView: document.body.dataset.activeView,
    clientWidth: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth,
    scrollHeight: document.documentElement.scrollHeight,
    undersizedVisibleControls: [...document.querySelectorAll('button, a, input, select, textarea')]
      .filter((node) => {
        const style = getComputedStyle(node);
        const rect = node.getBoundingClientRect();
        return style.visibility !== 'hidden'
          && style.display !== 'none'
          && rect.width > 0
          && rect.height > 0
          && (rect.width < 40 || rect.height < 40);
      })
      .slice(0, 20)
      .map((node) => {
        const rect = node.getBoundingClientRect();
        return {
          tag: node.tagName,
          text: (node.textContent || node.getAttribute('aria-label') || '').trim().slice(0, 60),
          width: Math.round(rect.width),
          height: Math.round(rect.height),
          className: String(node.className || ''),
        };
      }),
  }));
  await page.screenshot({
    path: path.join(output, `${name}-${size}.png`),
    fullPage: true,
  });
  results.push({ name, size, ...geometry });
}

async function waitUntilReady(url) {
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {
      // The local server is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`Local TABA server did not become ready at ${url}`);
}
