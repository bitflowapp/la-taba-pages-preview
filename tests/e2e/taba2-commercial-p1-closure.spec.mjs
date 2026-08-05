// Cierre comercial P1 — contratos de los tres hallazgos de la auditoría
// (C:\1212\artifacts\taba2-commercial-audit-fable5\auditoria-comercial.md).
//
//   P1-1  "Ver todos" de Destacados nunca abre una tienda vacía.
//   P1-2  Ninguna pieza editorial (banner/historia) promete una acción de
//         compra hacia un destino sin producto comprable.
//   P1-3  Confirmar valida ANTES de cualquier upsell: el error real llega
//         primero y el modal de sugerencias salió del flujo principal.
//
// Cada test de este archivo FALLA sobre el comportamiento anterior al cierre.
import { expect, test } from '@playwright/test';
import { gotoDemoReset, installBrowserStubs, installPageGuards } from './helpers.mjs';

const PHONE = { width: 390, height: 844 };
const STATE_KEY = 'la_taba_mvp_v4_state';

async function openHome(page, { stories = null } = {}) {
  await page.setViewportSize(PHONE);
  await installBrowserStubs(page);
  if (Array.isArray(stories)) {
    await page.addInitScript((fixtures) => { window.TABA2_STORIES = fixtures; }, stories);
  }
  await gotoDemoReset(page, '/?reset=1&demo=1');
  await page.waitForSelector('[data-view="home"] .home-best-card');
}

async function ordersInState(page) {
  return page.evaluate((key) => {
    try {
      return JSON.parse(localStorage.getItem(key) || '{}').orders?.length ?? 0;
    } catch (_) {
      return -1;
    }
  }, STATE_KEY);
}

// ── P1-1 ─────────────────────────────────────────────────────────────────────

test('P1-1: "Ver todos" de Destacados abre el catálogo poblado, nunca "0 productos"', async ({ page }) => {
  const guards = installPageGuards(page);
  await openHome(page);

  const verTodos = page.locator('.home-best-section .home-section-head button[data-category-id]');
  await expect(verTodos).toHaveText('Ver todos');
  await verTodos.click();

  await expect(page.locator('[data-view="catalog"]')).toBeVisible();
  // Catálogo real: productos visibles y al menos uno COMPRABLE. Con el destino
  // anterior (`popular`, sin datos) esta pantalla decía "0 productos en Todos".
  await expect(page.locator('[data-product-grid] .product-card').first()).toBeVisible();
  await expect(page.locator('[data-product-grid] [data-add-product]:not([disabled])').first()).toBeVisible();
  await expect(page.locator('[data-view="catalog"]').getByText('No hay productos disponibles')).toHaveCount(0);

  // Atrás conserva el contexto: vuelve a la home.
  await page.goBack();
  await expect(page.locator('[data-view="home"]')).toBeVisible();
  await guards.assertClean();
});
