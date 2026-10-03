// Extrae el catálogo real (nombres, precios, presentaciones, imágenes) desde la
// app en ejecución, para que los prototipos no inventen ni un producto.
import { writeFile } from 'node:fs/promises';
const { chromium } = await import(
  'file:///C:/Users/marco/dev/la-taba-pages-preview/node_modules/playwright/index.mjs'
);

const browser = await chromium.launch();
const page = await browser.newPage();
await page.goto('http://127.0.0.1:8791/?reset=1&demo=1#catalog');
await page.waitForLoadState('load');
await page.waitForTimeout(2000);

const data = await page.evaluate(() => {
  const cards = [...document.querySelectorAll('.product-card')];
  const products = cards.map((c) => {
    const img = c.querySelector('.thumb-img');
    return {
      id: c.querySelector('[data-product-detail]')?.dataset.productDetail || '',
      name: c.querySelector('.product-body h3')?.textContent.trim() || '',
      presentation: c.querySelector('.product-body p')?.textContent.trim() || '',
      availability: c.querySelector('.product-availability')?.textContent.trim() || '',
      price: c.querySelector('.price strong')?.textContent.trim() || '',
      image: img?.getAttribute('src') || '',
      stockTag: c.querySelector('.product-stock-tag')?.textContent.trim() || '',
    };
  });
  const catalogCategories = [...document.querySelectorAll('[data-view="catalog"] .category-button')]
    .map((b) => ({
      id: b.dataset.categoryId || '',
      label: b.querySelector('.category-label')?.textContent.trim() || b.textContent.trim(),
      active: b.classList.contains('active'),
    }));
  return { products, catalogCategories };
});

const home = await page.goto('http://127.0.0.1:8791/?demo=1#home')
  .then(() => page.waitForTimeout(1800))
  .then(() => page.evaluate(() => ({
    homeCategories: [...document.querySelectorAll('.home-category-card')].map((b) => ({
      id: b.dataset.categoryId || '',
      label: b.textContent.trim(),
      active: b.classList.contains('active'),
    })),
    bestSellers: [...document.querySelectorAll('[data-home-best-sellers] .home-best-card')].map((c) => ({
      name: c.querySelector('strong')?.textContent.trim() || '',
      price: c.querySelector('.home-product-price')?.textContent.trim()
        || (c.textContent.match(/\$[\s\d.]+/) || [''])[0].trim(),
      image: c.querySelector('img')?.getAttribute('src') || '',
    })),
  })));

const out = { ...data, ...home };
await writeFile(
  'C:/1212/artifacts/taba-opus-design-review/tools/catalog-data.json',
  JSON.stringify(out, null, 2),
);
console.log(`productos: ${out.products.length}`);
console.log(`categorías catálogo: ${out.catalogCategories.map((c) => c.label).join(', ')}`);
console.log(`categorías inicio: ${out.homeCategories.map((c) => c.label).join(', ')}`);
console.log(JSON.stringify(out.products.slice(0, 6), null, 2));
await browser.close();
