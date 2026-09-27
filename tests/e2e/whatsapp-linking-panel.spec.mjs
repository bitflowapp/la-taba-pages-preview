// WHATSAPP DE FACTURACIÓN EN EL PANEL (CI, con los datos de prueba del Panel)
//
// Comprobantes ofrece vincular el WhatsApp de cada persona del equipo. Esta prueba fija el
// cableado con la red: la tarjeta lee los vínculos, pide el código de un solo uso y desvincula
// con las RPC reales y sus argumentos. La lógica (hash, vencimiento, intentos, revalidación)
// la prueban el pgTAP y scripts/whatsapp/*: acá el servidor es un modelo mínimo con estado.
import { expect, test } from '@playwright/test';

import { BUSINESS_ID, SUPABASE_URL, instalarDatosDePrueba } from '../../scripts/lib/business-panel-fixtures.mjs';

const LINK = '4c8a1f7e-2b3d-4e5f-8a9b-0c1d2e3f4a5b';

test('Comprobantes: generar el código de WhatsApp, ver los vínculos enmascarados y desvincular', async ({ page }) => {
  await instalarDatosDePrueba(page, { comoEmpleado: true });
  const estado = { links: [{ id: LINK, user_id: 'u', is_own: true, phone_hint: '+54 ••• 0101', active: true }], llamadas: [] };
  await page.route(`${SUPABASE_URL}/rest/v1/rpc/**`, async (route) => {
    const nombre = new URL(route.request().url()).pathname.split('/').pop();
    const cuerpo = JSON.parse(route.request().postData() || '{}');
    const json = (body) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
    if (nombre === 'list_whatsapp_links') { estado.llamadas.push([nombre, cuerpo]); return json(estado.links); }
    if (nombre === 'create_whatsapp_pairing') {
      estado.llamadas.push([nombre, cuerpo]);
      return json({ pairing_id: 'p', code: 'ABCD-EFGH-JKLM', message: 'vincular ABCD-EFGH-JKLM', expires_at: new Date(Date.now() + 600_000).toISOString() });
    }
    if (nombre === 'revoke_whatsapp_link') {
      estado.llamadas.push([nombre, cuerpo]);
      estado.links = [];
      return json({ link_id: cuerpo.p_link_id, revoked_at: new Date().toISOString(), idempotent_replay: false });
    }
    return route.fallback();
  });
  await page.goto('/#business', { waitUntil: 'domcontentloaded' });
  const workspace = page.locator('[data-production-workspace="business"]');
  await workspace.waitFor({ state: 'visible', timeout: 30_000 });
  await workspace.locator('[data-business-ops-view="fiscal-status"]').first().click();

  const tarjeta = workspace.locator('[data-whatsapp-linking]');
  await expect(tarjeta).toContainText('WhatsApp de facturación');
  await expect(tarjeta.locator('[data-whatsapp-link]')).toContainText('+54 ••• 0101 · tu WhatsApp');
  await expect(tarjeta.locator('[data-whatsapp-code]')).toHaveCount(0);

  await tarjeta.getByRole('button', { name: 'Generar código para mi WhatsApp' }).click();
  await expect(tarjeta.locator('[data-whatsapp-code]')).toContainText('ABCD-EFGH-JKLM');
  await expect(tarjeta.locator('[data-whatsapp-code]')).toContainText('vincular ABCD-EFGH-JKLM');

  await tarjeta.getByRole('button', { name: 'Desvincular' }).click();
  await expect(tarjeta.locator('[data-whatsapp-links-empty]')).toHaveText('Ningún WhatsApp vinculado.');
  expect(estado.llamadas.filter(([nombre]) => nombre !== 'list_whatsapp_links')).toEqual([
    ['create_whatsapp_pairing', { p_business_id: BUSINESS_ID }],
    ['revoke_whatsapp_link', { p_link_id: LINK, p_reason: 'desvinculado desde el Panel' }],
  ]);
  expect(estado.llamadas.some(([nombre, cuerpo]) => nombre === 'list_whatsapp_links' && cuerpo.p_business_id === BUSINESS_ID)).toBe(true);
});
