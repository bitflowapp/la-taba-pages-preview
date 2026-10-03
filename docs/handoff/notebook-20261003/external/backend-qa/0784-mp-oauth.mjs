import { createRequire } from 'node:module';
import fs from 'node:fs';
const require = createRequire('file:///D:/1212/la-taba-e2e-test-staging-rc/');
const { chromium } = require('playwright');

// Completes the MCP OAuth consent using the sandbox seller session already
// stored in the profile, and records whatever callback URL the browser lands on.
const AUTH_URL = process.argv[2];
const PROFILE = process.env.MP_PROFILE || 'D:/1212/browser-temp/taba2-mp-seller';

const context = await chromium.launchPersistentContext(PROFILE, {
  headless: false,
  locale: 'es-AR',
  timezoneId: 'America/Argentina/Buenos_Aires',
  viewport: { width: 1360, height: 950 },
  args: ['--disable-blink-features=AutomationControlled'],
});
const page = context.pages()[0] || await context.newPage();

const seen = [];
page.on('framenavigated', (f) => { if (f === page.mainFrame()) seen.push(f.url()); });

await page.goto(AUTH_URL, { waitUntil: 'domcontentloaded', timeout: 60000 }).catch((e) => console.log('goto:', String(e).slice(0, 90)));

for (let step = 1; step <= 8; step += 1) {
  await page.waitForTimeout(3000);
  const url = page.url();
  const text = await page.evaluate('(document.body?.innerText||"").replace(/\\s+/g," ").slice(0,400)').catch(() => '');
  console.log(`\n--- paso ${step} ---`);
  console.log('URL:', url.slice(0, 160));
  console.log('TXT:', text.slice(0, 300));
  await page.screenshot({ path: `oauth-${step}.png` }).catch(() => {});

  if (/localhost:\d+\/callback/.test(url)) {
    fs.writeFileSync('oauth-callback.txt', url);
    console.log('\n>>> CALLBACK:', url);
    break;
  }

  // The consent screen gates its button behind a country selector.
  if (/Seleccione el pa[íi]s/i.test(text)) {
    const native = page.locator('select').first();
    if (await native.count()) {
      await native.selectOption({ label: 'Argentina' }).catch(async () => {
        await native.selectOption('AR').catch(() => {});
      });
      console.log('  -> país por <select>');
    } else {
      const trigger = page.locator('[role=combobox], .andes-dropdown__trigger').first();
      if (await trigger.count()) {
        await trigger.click({ timeout: 6000 }).catch(() => {});
        await page.waitForTimeout(1500);
        const option = page.locator(':is([role=option],li):has-text("Argentina")').first();
        if (await option.count()) await option.click({ timeout: 6000 }).catch(() => {});
        console.log('  -> país por dropdown');
      }
    }
    await page.waitForTimeout(1500);
  }

  let clicked = false;
  for (const label of ['Autorizar', 'Permitir', 'Continuar', 'Aceptar', 'Confirmar', 'Allow', 'Authorize']) {
    const b = page.locator(`:is(button,a,[role=button]):has-text("${label}")`).last();
    if (await b.count() && !(await b.isDisabled().catch(() => true))) {
      console.log(`  -> click "${label}"`);
      await b.click({ timeout: 8000 }).catch(() => {});
      clicked = true;
      break;
    }
  }
  if (!clicked) console.log('  (sin botón de consentimiento)');
}

console.log('\nnavegaciones:', JSON.stringify(seen.map((u) => u.slice(0, 110)), null, 1));
await context.close();
