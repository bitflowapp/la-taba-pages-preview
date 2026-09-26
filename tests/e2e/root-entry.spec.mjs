/*
 * LA RAÍZ DE LA TIENDA NUNCA ES UNA PANTALLA NEGRA.
 *
 * Medido en CONTROLLED_PRODUCTION el 2026-09-25: con el negocio real cerrado y
 * sin catálogo publicado, `/` mostraba una tarjeta suelta —«Pedidos online no
 * disponibles · El catálogo verificado todavía no está disponible. Los pedidos
 * permanecen bloqueados.»— sobre un fondo negro. Describía una bandera del
 * sistema y se leía como un sitio caído.
 *
 * Estas pruebas fijan la entrada con los MISMOS datos que contesta hoy el
 * backend real (negocio cerrado, sin horario publicado, sin WhatsApp, cero
 * productos) y con el backend caído. Backend de mentira: no se toca Supabase.
 */
import { expect, test } from '@playwright/test';

const SUPABASE_URL = 'https://tabarootentryfixture.supabase.co';
const BUSINESS_ID = '00000000-0000-4000-8000-0000000000e1';
const JERGA = /verificad|bloquead|despliegue|configuración productiva|Pedidos online no disponibles|La Taba 2/i;

const NEGOCIO_CERRADO = {
  id: BUSINESS_ID,
  name: 'La Taba',
  address: 'Mendoza 827, Neuquén Capital',
  currency_code: 'ARS',
  ordering_enabled: false,
  ordering_verified: false,
  delivery_enabled: false,
  pickup_enabled: false,
  delivery_fee: 0,
  minimum_delivery_subtotal: 0,
  is_active: true,
  status: 'closed',
};

async function instalarBackend(page, { caido = false, proximaApertura = null } = {}) {
  await page.route(`${SUPABASE_URL}/**`, async (route) => {
    const url = new URL(route.request().url());
    const json = (body, status = 200) => route.fulfill({
      status,
      contentType: 'application/json',
      body: JSON.stringify(body),
    });
    if (caido) return json({ message: 'unavailable' }, 503);
    if (url.pathname.includes('/rest/v1/businesses')) return json(NEGOCIO_CERRADO);
    if (url.pathname.includes('/rest/v1/products')) return json([]);
    if (url.pathname.includes('/rpc/get_public_business_contact')) return json([]);
    if (url.pathname.includes('/rpc/commerce_availability')) {
      return json({
        business_id: BUSINESS_ID,
        channel: 'delivery',
        ordering_ready: false,
        is_open: false,
        hours_enforced: true,
        coverage_enforced: true,
        next_open_at: proximaApertura,
        hours: [],
        areas: [],
        delivery: { eligible: false, reason: 'unavailable', message: 'Por ahora no estamos haciendo envíos.' },
      });
    }
    return json([]);
  });
  await page.addInitScript(({ supabaseUrl, businessId }) => {
    globalThis.__LA_TABA_RUNTIME_CONFIG__ = {
      mode: 'production',
      repository: {
        provider: 'supabase',
        deploymentEnvironment: 'pilot',
        supabaseUrl,
        publishableKey: 'sb_publishable_root_entry_fixture',
        businessId,
        pollMs: 60_000,
      },
    };
  }, { supabaseUrl: SUPABASE_URL, businessId: BUSINESS_ID });
}

test.describe('la entrada de la tienda', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('con el negocio cerrado y sin catálogo, la raíz presenta el local y no una pantalla vacía', async ({ page }) => {
    await instalarBackend(page);
    await page.goto('/');

    const entrada = page.locator('[data-view="home"] [data-production-catalog-gate]');
    await expect(entrada).toBeVisible();
    await expect(entrada.locator('[data-production-catalog-title]'))
      .toHaveText('Por ahora no estamos tomando pedidos online');
    await expect(entrada.locator('[data-store-entry-name]')).toHaveText('La Taba');
    await expect(entrada.locator('[data-store-entry-address]')).toHaveText('Mendoza 827, Neuquén Capital');
    await expect(entrada.locator('[data-store-entry-tracking]')).toBeVisible();
    // Sin WhatsApp publicado no se ofrece un contacto que no existe.
    await expect(entrada.locator('[data-store-entry-whatsapp]')).toBeHidden();
    await expect(entrada.locator('[data-store-entry-retry]')).toBeHidden();
    await expect(page.locator('[data-view="home"] [data-catalog-dependent]')).toBeHidden();
    await expect(page.locator('body')).not.toContainText(JERGA);

    // La tarjeta ocupa la primera pantalla: no queda escondida ni desborda.
    const caja = await entrada.boundingBox();
    expect(caja.y).toBeLessThan(300);
    expect(caja.x).toBeGreaterThanOrEqual(0);
    expect(caja.x + caja.width).toBeLessThanOrEqual(390 + 1);
    const ancho = await page.evaluate(() => document.documentElement.scrollWidth);
    expect(ancho).toBeLessThanOrEqual(390);

    // «Seguir un pedido» lleva al seguimiento, que es lo único útil con la
    // tienda cerrada para quien ya compró.
    await entrada.locator('[data-store-entry-tracking]').click();
    await expect(page.locator('[data-view="tracking"]')).toBeVisible();
  });

  test('con una próxima apertura publicada, la dice', async ({ page }) => {
    const apertura = new Date(Date.now() + 2 * 60 * 60 * 1000);
    await instalarBackend(page, { proximaApertura: apertura.toISOString() });
    await page.goto('/');
    const entrada = page.locator('[data-view="home"] [data-production-catalog-gate]');
    await expect(entrada.locator('[data-production-catalog-title]')).toHaveText('Ahora estamos cerrados');
    await expect(entrada.locator('[data-production-catalog-message]')).toContainText(/^Abrimos (hoy|mañana) a las \d{2}:\d{2}\.$/);
  });

  test('con el backend caído, la entrada lo dice y ofrece reintentar en vez de quedarse cargando', async ({ page }) => {
    test.setTimeout(90_000);
    await instalarBackend(page, { caido: true });
    await page.goto('/');
    const entrada = page.locator('[data-view="home"] [data-production-catalog-gate]');
    await expect(entrada).toBeVisible();
    await expect(entrada.locator('[data-production-catalog-title]'))
      .toHaveText('No pudimos abrir la tienda', { timeout: 60_000 });
    await expect(entrada.locator('[data-store-entry-retry]')).toBeVisible();
    await expect(page.locator('body')).not.toContainText(JERGA);
  });
});
