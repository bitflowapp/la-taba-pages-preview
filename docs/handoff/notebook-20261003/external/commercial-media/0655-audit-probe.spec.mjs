import { test } from 'E:/DevCache/Npm/_npx/77dbaf41d727fd82/node_modules/@playwright/test/index.mjs';

async function visibleState(page, label) {
  const state = await page.evaluate((label) => {
    const visible = (node) => node && node.getClientRects().length && getComputedStyle(node).visibility !== 'hidden';
    return {
      label,
      url: location.href,
      activeView: document.body.dataset.activeView,
      body: document.body.innerText.slice(0, 12000),
      dialogs: [...document.querySelectorAll('dialog,[role="dialog"]')].filter(visible).map((node) => ({
        tag: node.tagName,
        className: node.className,
        text: node.innerText.slice(0, 6000),
        buttons: [...node.querySelectorAll('button')].filter(visible).map((button) => ({ text: button.innerText, aria: button.getAttribute('aria-label'), data: { ...button.dataset } })),
        inputs: [...node.querySelectorAll('input,textarea,select')].filter(visible).map((input) => ({ tag: input.tagName, type: input.type, name: input.name, value: input.value, placeholder: input.placeholder, aria: input.getAttribute('aria-label') })),
      })),
      visibleButtons: [...document.querySelectorAll('button')].filter(visible).map((button) => ({ text: button.innerText.trim().slice(0,120), aria: button.getAttribute('aria-label'), data: { ...button.dataset } })).slice(0,100),
      visibleInputs: [...document.querySelectorAll('input,textarea,select')].filter(visible).map((input) => ({ tag: input.tagName, type: input.type, name: input.name, id: input.id, value: input.value, placeholder: input.placeholder, aria: input.getAttribute('aria-label'), outer: input.outerHTML.slice(0,500) })),
    };
  }, label);
  console.log(JSON.stringify(state, null, 2));
}

test('probe customer flows', async ({ page }) => {
  test.setTimeout(90_000);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('https://taba2-staging.pages.dev/?qa=' + Date.now(), { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('[data-view="home"].is-active');
  await page.waitForTimeout(1500);

  await page.locator('[data-nav-view="profile"]:visible').first().click();
  await page.waitForSelector('[data-view="profile"].is-active');
  await visibleState(page, 'profile');
  await page.locator('[data-profile-action="edit-personal"]:visible').click();
  await page.waitForTimeout(300);
  await visibleState(page, 'personal editor');
  const profile = page.locator('[data-view="profile"]');
  await profile.getByLabel('Nombre y apellido').fill('Cliente Auditor');
  await profile.getByLabel('Teléfono').fill('2615550101');
  await profile.locator('[data-profile-action="save-personal"]:visible').click();
  await page.waitForTimeout(500);

  await page.locator('[data-profile-action="add-address"]:visible').click();
  await page.waitForTimeout(300);
  await visibleState(page, 'address editor');
});
