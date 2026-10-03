import { test } from 'E:/DevCache/Npm/_npx/77dbaf41d727fd82/node_modules/@playwright/test/index.mjs';

test('inspect staging storefront', async ({ page }) => {
  const logs = [];
  page.on('console', (message) => logs.push({ type: message.type(), text: message.text() }));
  page.on('pageerror', (error) => logs.push({ type: 'pageerror', text: error.message }));
  const response = await page.goto('https://taba2-staging.pages.dev', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(3000);
  console.log(JSON.stringify({
    status: response?.status(),
    url: page.url(),
    title: await page.title(),
    bodyText: (await page.locator('body').innerText()).slice(0, 6000),
    links: await page.locator('a').evaluateAll((nodes) => nodes.slice(0, 100).map((node) => ({ text: node.innerText, href: node.getAttribute('href'), aria: node.getAttribute('aria-label') }))),
    buttons: await page.locator('button').evaluateAll((nodes) => nodes.slice(0, 100).map((node) => ({ text: node.innerText, aria: node.getAttribute('aria-label'), data: Object.fromEntries(Object.entries(node.dataset)) }))),
    inputs: await page.locator('input').evaluateAll((nodes) => nodes.slice(0, 100).map((node) => ({ type: node.type, name: node.name, placeholder: node.placeholder, aria: node.getAttribute('aria-label') }))),
    views: await page.locator('[data-view]').evaluateAll((nodes) => nodes.map((node) => ({ view: node.dataset.view, className: node.className, hidden: node.hidden }))),
    logs,
  }, null, 2));
});
