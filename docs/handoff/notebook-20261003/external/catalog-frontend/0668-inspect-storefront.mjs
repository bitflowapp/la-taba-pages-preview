import { chromium } from 'file:///E:/DevCache/Npm/_npx/77dbaf41d727fd82/node_modules/playwright-core/index.mjs';

const browser = await chromium.launch({
  executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  headless: true,
});

try {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 3,
    isMobile: true,
    hasTouch: true,
    serviceWorkers: 'block',
  });
  const page = await context.newPage();
  const response = await page.goto('https://taba2-staging.pages.dev/', {
    waitUntil: 'domcontentloaded',
    timeout: 30_000,
  });
  await page.waitForTimeout(5_000);
  const result = await page.evaluate(() => ({
    title: document.title,
    url: location.href,
    bodyText: document.body.innerText.slice(0, 12_000),
    links: [...document.querySelectorAll('a')].slice(0, 100).map((node) => ({
      text: node.innerText.trim(),
      href: node.href,
      visible: Boolean(node.offsetWidth || node.offsetHeight || node.getClientRects().length),
    })),
    buttons: [...document.querySelectorAll('button')].slice(0, 150).map((node) => ({
      text: node.innerText.trim(),
      ariaLabel: node.getAttribute('aria-label'),
      disabled: node.disabled,
      visible: Boolean(node.offsetWidth || node.offsetHeight || node.getClientRects().length),
      className: node.className,
    })),
    inputs: [...document.querySelectorAll('input')].map((node) => ({
      type: node.type,
      placeholder: node.placeholder,
      ariaLabel: node.getAttribute('aria-label'),
      visible: Boolean(node.offsetWidth || node.offsetHeight || node.getClientRects().length),
    })),
  }));
  console.log(JSON.stringify({ status: response?.status(), ...result }, null, 2));
} finally {
  await browser.close();
}
