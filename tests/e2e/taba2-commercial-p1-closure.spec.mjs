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

// ── P1-2 ─────────────────────────────────────────────────────────────────────

test('P1-2: los banners sólo pintan destinos con producto comprable', async ({ page }) => {
  const guards = installPageGuards(page);
  await openHome(page);

  // Con el catálogo demo actual whisky y fernet no publican precio: sus
  // banners no se pintan (fail-closed, misma mecánica que Andes Origen).
  await expect(page.locator('.home-brand-banner[data-category-id="whisky"]')).toHaveCount(0);
  await expect(page.locator('.home-brand-banner[data-category-id="fernet"]')).toHaveCount(0);

  // La puerta de marca Heineken sigue: su búsqueda trae una lata comprable.
  const heineken = page.locator('.home-brand-banner[data-brand-query="Heineken"]');
  await expect(heineken).toBeVisible();
  await heineken.click();
  await expect(page.locator('[data-view="catalog"]')).toBeVisible();
  await expect(page.locator('[data-product-grid] [data-add-product]:not([disabled])').first()).toBeVisible();
  await page.goBack();
  await expect(page.locator('[data-view="home"]')).toBeVisible();
  await guards.assertClean();
});

test('P1-2: en demo la historia de whisky (sin comprables) se apaga y ninguna promete lo invendible', async ({ page }) => {
  const guards = installPageGuards(page);
  await openHome(page);

  // De las 4 historias sembradas, la de Jack Daniel's apuntaba a `whisky`
  // (1 producto, sin precio, y de otra marca). Quedan las 3 con destino
  // comprable, cada una con su CTA real.
  await page.locator('.brand-hero .brand-logo-action').click();
  const modal = page.locator('[data-stories-modal]');
  await expect(modal).toBeVisible();
  await expect(modal.locator('.stories-progress span')).toHaveCount(3);
  for (let index = 0; index < 3; index += 1) {
    await expect(modal.locator('h2')).not.toContainText('Jack');
    await expect(modal.locator('[data-story-cta]')).toBeVisible();
    if (index < 2) await modal.locator('[data-story-next]').click();
  }
  await page.keyboard.press('Escape');
  await guards.assertClean();
});

test('P1-2: el contrato aplica a cualquier origen — historia con destino no comprable se apaga, la editorial sin CTA sigue', async ({ page }) => {
  const guards = installPageGuards(page);
  const media = 'assets/products/beverage-placeholder.svg';
  const base = {
    business_id: 'la-taba-2',
    media_type: 'image',
    media_url: media,
    thumbnail_url: media,
    starts_at: null,
    expires_at: null,
    priority: 1,
    is_highlight: false,
    published: true,
  };
  await openHome(page, {
    stories: [
      { ...base, id: 's-whisky', title: 'Whisky del bueno', cta_type: 'category', cta_target: 'whisky' },
      { ...base, id: 's-editorial', title: 'Postal del local' },
    ],
  });

  // Sólo sobrevive la editorial sin CTA: promete mirar, no comprar.
  const entrada = page.locator('.brand-hero [data-stories-slot]');
  await expect(entrada).toHaveAttribute('data-stories-state', 'unseen');
  await expect(page.locator('.brand-hero [data-stories-cta-detail]')).toHaveText('1 historia nueva');

  await page.locator('.brand-hero .brand-logo-action').click();
  const modal = page.locator('[data-stories-modal]');
  await expect(modal).toBeVisible();
  await expect(modal.locator('.stories-progress span')).toHaveCount(1);
  await expect(modal.locator('h2')).toHaveText('Postal del local');
  // El visor no fabrica una CTA para la pieza editorial.
  await expect(modal.locator('[data-story-cta]')).toHaveCount(0);
  await page.keyboard.press('Escape');
  await guards.assertClean();
});
