// Preparar apertura, Equipo e Impresora en el Panel real (modo producción) y la
// invitación en /cuenta/. Sin backend: las RPC y la función de invitación se
// contestan desde el navegador con las mismas formas que devuelve la base.
import { expect, test } from '@playwright/test';

import { SUPABASE_URL, instalarDatosDePrueba } from '../../scripts/lib/business-panel-fixtures.mjs';

const TELEFONO = { width: 390, height: 844 };
const ESCRITORIO = { width: 1366, height: 768 };
const TOKEN = 'ab'.repeat(32);

async function abrirPanel(browser, viewport) {
  const context = await browser.newContext({
    viewport, hasTouch: viewport.width <= 500, isMobile: viewport.width <= 500,
  });
  const page = await context.newPage();
  await instalarDatosDePrueba(page);
  await page.goto('/#business');
  await page.locator('[data-production-workspace="business"]').waitFor({ state: 'visible', timeout: 30_000 });
  return { context, page };
}

/** Llega a un destino como lo haría una persona: la fila en escritorio, «Más» en el teléfono. */
async function irA(page, view, viewport) {
  if (viewport.width <= 500) {
    await page.locator('[data-panel-more-toggle]').click();
    await page.locator(`[data-panel-more-sheet] [data-business-ops-view="${view}"]`).click();
  } else {
    await page.locator(`nav.production-operations-shortcuts [data-business-ops-view="${view}"]`).click();
  }
}

async function sinDesborde(page) {
  const { scroll, ancho } = await page.evaluate(() => ({
    scroll: Math.max(document.documentElement.scrollWidth, document.body.scrollWidth),
    ancho: window.innerWidth,
  }));
  expect(scroll, 'la página no se desplaza a lo ancho').toBeLessThanOrEqual(ancho + 1);
}

for (const [nombre, viewport] of [['teléfono', TELEFONO], ['escritorio', ESCRITORIO]]) {
  test(`Preparar apertura en ${nombre}: dice qué falta y lleva adonde se completa`, async ({ browser }) => {
    const { context, page } = await abrirPanel(browser, viewport);
    try {
      await irA(page, 'store-opening', viewport);
      await expect(page.getByRole('heading', { name: 'Preparar apertura' })).toBeVisible();
      await expect(page.getByText('Faltan 5 pasos para abrir.')).toBeVisible();
      await expect(page.locator('[data-opening-code="SERVICE_HOURS"]')).toContainText('Falta el horario de retiro');
      await expect(page.locator('[data-opening-code="PLATFORM_VERIFICATION"]')).toContainText('Plataforma');
      await sinDesborde(page);
      await page.locator('[data-opening-code="SERVICE_HOURS"] [data-business-ops-view="operations-config"]').click();
      await expect(page.getByRole('heading', { name: 'Horarios y cobertura' })).toBeVisible();
      await expect(page.locator('[name="fulfillmentPickup"]')).toBeChecked();
      await expect(page.locator('[name="storeAddress"]')).toHaveValue('Mendoza 827, Neuquén Capital');
      await sinDesborde(page);
    } finally {
      await context.close();
    }
  });
}

test('Equipo: invitar a un repartidor muestra el link una sola vez', async ({ browser }) => {
  const { context, page } = await abrirPanel(browser, TELEFONO);
  try {
    await irA(page, 'team', TELEFONO);
    await expect(page.getByRole('heading', { name: 'Equipo' })).toBeVisible();
    await expect(page.locator('[data-team-member]')).toHaveCount(2);
    await expect(page.locator('[data-team-invitation]')).toContainText('Pendiente');
    await page.locator('[name="teamInviteName"]').fill('Rider Nuevo');
    await page.locator('[name="teamInviteEmail"]').fill('rider.nuevo@la-taba.test');
    await page.locator('[data-team-invite-send]').click();
    const link = page.locator('[data-team-invite-link-value]');
    await expect(link).toHaveValue(new RegExp(`/cuenta/#invitacion=${'ef'.repeat(32)}$`));
    await sinDesborde(page);
    await page.locator('[data-team-invite-dismiss]').click();
    await expect(page.locator('[data-team-invite-link]')).toHaveCount(0);
  } finally {
    await context.close();
  }
});

test('Impresora sin vincular: se dice que es opcional y cómo vincular', async ({ browser }) => {
  const { context, page } = await abrirPanel(browser, ESCRITORIO);
  try {
    await irA(page, 'print-agent', ESCRITORIO);
    await expect(page.getByRole('heading', { name: 'Impresora del local' })).toBeVisible();
    await expect(page.locator('[data-print-agent-state="NOT_REGISTERED"]')).toContainText('Sin vincular');
    await expect(page.locator('[data-print-agent-pair]')).toBeVisible();
  } finally {
    await context.close();
  }
});

test('/cuenta/#invitacion: cuenta nueva, contraseña y aceptar, sin dejar el token en la barra', async ({ page }) => {
  const llamadas = [];
  await page.route(`${SUPABASE_URL}/**`, async (route) => {
    const url = new URL(route.request().url());
    const body = (() => { try { return JSON.parse(route.request().postData() || '{}'); } catch { return {}; } })();
    const json = (value, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(value) });
    if (url.pathname.endsWith('/functions/v1/team-invitation')) {
      llamadas.push(`fn:${body.action}`);
      if (body.action === 'inspect') {
        return json({ ok: true, account: 'new', role: 'rider', business_name: 'La Taba', email_hint: 'ri••••@la-taba.test' });
      }
      return json(body.email === 'rider.nuevo@la-taba.test' ? { ok: true, token_hash: 'hash-de-prueba', type: 'recovery' } : { ok: false, code: 'email_mismatch' });
    }
    if (url.pathname.endsWith('/auth/v1/verify')) {
      llamadas.push('verify');
      const user = { id: '99999999-9999-4999-8999-999999999999', aud: 'authenticated', role: 'authenticated', email: 'rider.nuevo@la-taba.test' };
      return json({ access_token: 'a.b.c', token_type: 'bearer', expires_in: 3600, expires_at: 4102444800, refresh_token: 'r', user });
    }
    if (url.pathname.endsWith('/auth/v1/user')) {
      llamadas.push('password');
      return json({ id: '99999999-9999-4999-8999-999999999999', email: 'rider.nuevo@la-taba.test' });
    }
    if (url.pathname.endsWith('/rpc/identity_accept_invitation')) {
      llamadas.push(`accept:${body.p_token === TOKEN}`);
      return json({ ok: true, business_id: '11111111-1111-4111-8111-111111111111', role: 'rider' });
    }
    if (url.pathname.endsWith('/auth/v1/logout')) {
      llamadas.push('logout');
      return route.fulfill({ status: 204, body: '' });
    }
    return json({});
  });
  await page.addInitScript(({ supabaseUrl }) => {
    globalThis.__LA_TABA_RUNTIME_CONFIG__ = {
      mode: 'production',
      repository: {
        provider: 'supabase', deploymentEnvironment: 'staging', supabaseUrl,
        publishableKey: 'sb_publishable_panel_responsive', businessId: '11111111-1111-4111-8111-111111111111', pollMs: 60_000,
      },
    };
  }, { supabaseUrl: SUPABASE_URL });

  await page.goto(`/cuenta/#invitacion=${TOKEN}`);
  await expect(page.getByRole('heading', { name: 'Te invitaron a La Taba' })).toBeVisible();
  expect(page.url()).not.toContain('invitacion');
  await page.locator('[data-invite-email-form] [name="email"]').fill('otro@la-taba.test');
  await page.locator('[data-invite-email-form] button[type="submit"]').click();
  await expect(page.getByText('Ese no es el correo al que llegó la invitación')).toBeVisible();
  await page.locator('[data-invite-email-form] [name="email"]').fill('rider.nuevo@la-taba.test');
  await page.locator('[data-invite-email-form] button[type="submit"]').click();
  await expect(page.getByRole('heading', { name: 'Elegí tu contraseña' })).toBeVisible();
  await page.locator('[data-invite-password-form] [name="password"]').fill('una-contraseña-muy-larga');
  await page.locator('[data-invite-password-form] button[type="submit"]').click();
  await expect(page.getByRole('heading', { name: '¡Listo! Ya sos parte del equipo' })).toBeVisible();
  await expect(page.getByText('app de repartidor')).toBeVisible();
  expect(llamadas).toEqual(['fn:inspect', 'fn:activate', 'fn:activate', 'verify', 'password', 'accept:true', 'logout']);
});
