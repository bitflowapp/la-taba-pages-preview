/*
 * Crédito de fotos con licencia abierta (CC BY-SA) en la ficha pública.
 *
 * La foto de Campari viene de Open Food Facts: su licencia exige nombrar la
 * fuente, enlazar la licencia y avisar el cambio (fondo blanco). El catálogo
 * entra por el camino productivo —`/rest/v1/products` respondido con filas
 * reales— así que el crédito sale de `rowToCatalogProduct` + la ficha, igual
 * que en producción. Una foto sin registro de crédito no muestra ninguno.
 *
 * Corre en Chromium y en WebKit (iPhone): la ficha es un `<dialog>` que cada
 * motor maqueta por su cuenta, y el crédito tiene que verse en los dos.
 */
import { expect, test } from '@playwright/test';
import { installPageGuards } from './helpers.mjs';

const SUPABASE_URL = 'https://taba-image-credit.supabase.co';
const BUSINESS_ID = '00000000-0000-4000-8000-000000000001';
const CAMPARI_SOURCE = 'ccc2d1bac09400804fb83c9f54b7f15a7a082e3aa2e6ddcfaebb540efe77fe92';
const IMAGEN = 'assets/catalog/beverages/corona-extra-botella-330ml/product.webp';
const MINIATURA = 'assets/catalog/beverages/corona-extra-botella-330ml/thumbnail.webp';

function fila({ indice, sku, name, sourceSha256 }) {
  return {
    id: `40000000-0000-4000-8000-${String(indice).padStart(12, '0')}`,
    external_id: sku,
    sku,
    name,
    brand: 'Marca',
    description: '',
    category: 'Aperitivos',
    subcategory: 'bitter',
    variant: 'Bitter',
    presentation: 'Bitter',
    capacity_value: 750,
    capacity_unit: 'ml',
    capacity: '750 ml',
    packaging_type: 'Botella',
    units_per_pack: 1,
    sold_as_pack: false,
    price: 9900,
    price_status: 'confirmed',
    stock: 5,
    available: true,
    is_active: true,
    is_verified: true,
    chilled: false,
    is_alcoholic: false,
    minimum_age: null,
    image_url: IMAGEN,
    image_sha256: 'a'.repeat(64),
    image_thumbnail_url: MINIATURA,
    image_thumbnail_sha256: 'b'.repeat(64),
    source_image_sha256: sourceSha256,
    tags: [],
    sort_order: indice,
  };
}

const FILAS = [
  fila({ indice: 1, sku: 'campari-bitter-750ml', name: 'Campari Bitter 750 ml', sourceSha256: CAMPARI_SOURCE }),
  fila({ indice: 2, sku: 'foto-sin-licencia-abierta', name: 'Aperitivo con foto propia', sourceSha256: 'c'.repeat(64) }),
];

const NEGOCIO = {
  id: BUSINESS_ID,
  name: 'La Taba',
  address: 'Mendoza 827, Neuquén',
  currency_code: 'ARS',
  ordering_enabled: true,
  ordering_verified: true,
  delivery_enabled: true,
  pickup_enabled: true,
  delivery_fee: 0,
  minimum_delivery_subtotal: 0,
  is_active: true,
  status: 'open',
};

async function abrirTienda(page) {
  const guardas = installPageGuards(page);
  // Realtime no es parte de lo que se mide: se atiende y se deja en silencio.
  await page.routeWebSocket(`${SUPABASE_URL.replace('https://', 'wss://')}/**`, () => {});
  await page.route(`${SUPABASE_URL}/**`, async (route) => {
    const url = new URL(route.request().url());
    const json = (body, headers = {}) => route.fulfill({
      status: 200, contentType: 'application/json', headers, body: JSON.stringify(body),
    });
    if (url.pathname.includes('/rest/v1/products')) return json(FILAS);
    if (url.pathname.includes('/rest/v1/businesses')) return json(NEGOCIO);
    if (url.pathname.includes('/rest/v1/rpc/get_public_business_contact')) {
      return json([{ whatsapp_number: '', whatsapp_verified: false }]);
    }
    if (url.pathname.includes('/rest/v1/rpc/get_mercadopago_checkout_availability')) {
      return json({ available: false });
    }
    if (url.pathname.includes('/auth/v1/')) {
      return json({
        access_token: 'credit-token',
        refresh_token: 'credit-refresh',
        token_type: 'bearer',
        expires_in: 3600,
        expires_at: Math.floor(Date.now() / 1000) + 3600,
        user: { id: '10000000-0000-4000-8000-000000000001', is_anonymous: true, aud: 'authenticated' },
      });
    }
    return json([], { 'content-range': '0-0/0' });
  });
  await page.addInitScript(({ supabaseUrl, businessId }) => {
    globalThis.__LA_TABA_RUNTIME_CONFIG__ = {
      mode: 'production',
      repository: {
        provider: 'supabase',
        supabaseUrl,
        publishableKey: 'sb_publishable_test_key',
        businessId,
      },
    };
  }, { supabaseUrl: SUPABASE_URL, businessId: BUSINESS_ID });
  await page.goto('/#catalog');
  await expect(page.locator('body')).toHaveAttribute('data-app-mode', 'production');
  await expect
    .poll(() => page.evaluate(async () => {
      const { getState } = await import('/js/state.js');
      return getState().products.length;
    }), { timeout: 20_000 })
    .toBe(FILAS.length);
  return guardas;
}

async function abrirFicha(page, sku) {
  const producto = await page.evaluate(async (buscado) => {
    const { getState } = await import('/js/state.js');
    return getState().products.find((item) => item.sku === buscado)?.id || '';
  }, sku);
  expect(producto, `${sku} no llegó al catálogo`).toBeTruthy();
  await page.locator(`[data-view="catalog"] [data-product-detail="${producto}"]`).first().click();
  const ficha = page.locator('[data-product-modal]');
  await expect(ficha).toBeVisible();
  return ficha;
}

test('la ficha de una foto CC BY-SA enlaza fuente y licencia y avisa el cambio', async ({ page }, testInfo) => {
  const guardas = await abrirTienda(page);
  const ficha = await abrirFicha(page, 'campari-bitter-750ml');
  const credito = ficha.locator('[data-image-credit]');
  await expect(credito).toBeVisible();
  await expect(credito).toContainText('Open Food Facts');
  await expect(credito).toContainText('CC BY-SA 3.0');
  await expect(credito).toContainText('fondo reemplazado por blanco');
  await expect(credito.locator('a', { hasText: 'Open Food Facts' }))
    .toHaveAttribute('href', 'https://world.openfoodfacts.org/product/7791200200781');
  const licencia = credito.locator('a', { hasText: 'CC BY-SA 3.0' });
  await expect(licencia).toHaveAttribute('href', /^https:\/\/creativecommons\.org\/licenses\/by-sa\/3\.0\//);
  await expect(licencia).toHaveAttribute('rel', /license/);
  // El crédito no desborda la ficha: entra en el ancho de la columna de texto.
  const caja = await credito.boundingBox();
  const viewport = page.viewportSize();
  expect(caja && caja.x >= 0 && caja.x + caja.width <= viewport.width + 1).toBe(true);
  await page.screenshot({ path: testInfo.outputPath(`ficha-credito-${testInfo.project.name}.png`) });
  await guardas.assertClean();
});

test('una foto sin registro de crédito no inventa uno', async ({ page }) => {
  const guardas = await abrirTienda(page);
  const ficha = await abrirFicha(page, 'foto-sin-licencia-abierta');
  await expect(ficha.locator('.thumb.has-photo')).toBeVisible();
  await expect(ficha.locator('[data-image-credit]')).toHaveCount(0);
  await guardas.assertClean();
});
