import fs from 'node:fs';
import path from 'node:path';

import { expect, test } from '@playwright/test';
import { gotoDemoReset, installPageGuards } from './helpers.mjs';

/*
 * Alta autogestionada del Panel: que se pueda usar con el dedo.
 *
 * ALCANCE, DICHO DE FRENTE. No hay base viva detrás: lo simulado es la
 * respuesta del servidor, que es justo lo que ya quedó certificado con 521
 * pruebas de base y un smoke sintético contra producción. Lo que SÍ es real acá
 * es el navegador, los dos módulos tal cual se despachan, su markup, y
 * styles/business.css que los pinta.
 *
 * Lo que se demuestra: que las cinco pantallas del alta y la bandeja de
 * decisión entren en 390, 430 y 1440 sin desbordar, y que todo lo que hay que
 * apretar mida al menos 44px de alto. La bandeja es la que importa más: el dueño
 * aprueba desde el teléfono, y un control de 30px es un control que se falla.
 *
 * UNA PÁGINA, TRES ANCHOS. La primera versión abría un contexto de navegador por
 * ancho: seis contextos y seis cargas para dos pruebas. La suite completa pasó de
 * 358/358 a fallar tres specs distintos en cada corrida —todos verdes en
 * aislamiento— porque ese churn de recursos corría el reloj de los demás. Acá se
 * carga una vez y se cambia el viewport, que es lo que de verdad hace falta para
 * que las media queries reevalúen.
 */

const ANCHOS = [
  { width: 390, height: 844, nombre: 'm390' },
  { width: 430, height: 932, nombre: 'm430' },
  { width: 1440, height: 900, nombre: 'd1440' },
];

const MINIMO_TACTIL = 44;

const SOLICITUDES = [
  {
    request_id: '11111111-1111-4111-8111-111111111111',
    user_id: '22222222-2222-4222-8222-222222222222',
    email: 'pide-panel@example.com',
    full_name: 'Pedro Panel',
    contact_phone: '2996000010',
    requested_access: 'panel',
    status: 'pending',
    attempt_count: 1,
    requested_at: '2026-08-17T10:00:00Z',
    is_member: false,
    roles_grantable: ['staff', 'admin'],
  },
  {
    request_id: '33333333-3333-4333-8333-333333333333',
    user_id: '44444444-4444-4444-8444-444444444444',
    email: 'pide-rider@example.com',
    full_name: 'Ramiro Rider',
    contact_phone: '2996000020',
    requested_access: 'rider',
    status: 'pending',
    attempt_count: 3,
    requested_at: '2026-08-17T11:00:00Z',
    is_member: false,
    roles_grantable: ['rider'],
  },
];

const PASOS = [
  ['sign_in', {}],
  ['sign_up', {}],
  ['request', { request: { fullName: 'Pedro Panel', contactPhone: '2996000010' } }],
  ['pending', { request: { status: 'pending', requestedAccess: 'panel', requestedAt: '2026-08-17T10:00:00Z' } }],
  ['rejected', { request: { status: 'rejected', decidedAt: '2026-08-17T12:00:00Z', retryAt: '2999-01-01T00:00:00Z' } }],
];

const SALIDA = path.join('artifacts', 'taba2-registration-identity', 'screenshots');

async function montar(page) {
  await page.evaluate(async ({ SOLICITUDES }) => {
    const alta = await import('/js/business/business-access-registration.js');
    const bandeja = await import('/js/business/business-access-inbox.js');

    // El Panel siempre corre con esta vista activa, y varias reglas de la hoja
    // están escritas como `body:not([data-active-view="business"])`. Montar
    // sobre la vista de inicio dejaba entrar colores pensados para el
    // storefront: el texto de las etiquetas y de los botones secundarios salía
    // lavado en las capturas. Medir en la vista equivocada es medir otra cosa.
    document.body.dataset.activeView = 'business';

    // Sin shell propio a propósito: las tarjetas se estilan por su clase, así
    // que la hoja real las pinta igual y no se agrega un segundo contenedor de
    // 100vh que ensucie la medición de desborde.
    const host = document.createElement('div');
    host.setAttribute('data-focal-alta', '');
    host.className = 'card admin-lock-card production-auth-card';
    document.body.appendChild(host);

    const inbox = document.createElement('div');
    inbox.setAttribute('data-focal-bandeja', '');
    document.body.appendChild(inbox);

    window.__pintarAlta = (step, extra = {}) => {
      host.innerHTML = `<div class="panel-access-region">${
        alta.renderAccessRegistration({ step, ...extra })
      }</div>`;
    };
    window.__pintarBandeja = (role) => {
      inbox.innerHTML = bandeja.renderAccessInboxSurface({
        requests: SOLICITUDES, role, filter: 'pending',
      });
    };
    // Cada prueba mide una sola región: la otra se vacía para que su alto no
    // participe del desborde de la página.
    window.__soloAlta = () => { inbox.innerHTML = ''; };
    window.__soloBandeja = () => { host.innerHTML = ''; };
  }, { SOLICITUDES });
}

async function desborde(page, selector) {
  return page.evaluate((sel) => {
    const host = document.querySelector(sel);
    return {
      propio: Math.max(0, host.scrollWidth - host.clientWidth),
      pagina: Math.max(0, document.documentElement.scrollWidth - window.innerWidth),
    };
  }, selector);
}

/** Alto real de cada control que hay que apretar, ya con el layout quieto. */
async function altosTactiles(page, selector) {
  return page.evaluate((sel) => {
    const host = document.querySelector(sel);
    const controles = host.querySelectorAll('button, select, input:not([type="hidden"])');
    return [...controles].map((node) => ({
      etiqueta: (node.textContent || node.name || node.tagName).trim().slice(0, 40),
      alto: Math.round(node.getBoundingClientRect().height),
    }));
  }, selector);
}

test('las cinco pantallas del alta entran y se pueden apretar', async ({ page }) => {
  fs.mkdirSync(SALIDA, { recursive: true });
  const guards = installPageGuards(page);
  await gotoDemoReset(page, '/?reset=1&demo=1');
  await montar(page);
  await page.evaluate(() => window.__soloBandeja());

  for (const ancho of ANCHOS) {
    await page.setViewportSize({ width: ancho.width, height: ancho.height });

    for (const [step, extra] of PASOS) {
      await page.evaluate(({ step, extra }) => window.__pintarAlta(step, extra), { step, extra });
      const host = page.locator('[data-focal-alta]');
      await expect(host).toBeVisible();

      const medida = await desborde(page, '[data-focal-alta]');
      expect(medida.propio, `${step} desborda su tarjeta en ${ancho.nombre}`).toBe(0);
      expect(medida.pagina, `${step} desborda la página en ${ancho.nombre}`).toBe(0);

      for (const control of await altosTactiles(page, '[data-focal-alta]')) {
        expect(
          control.alto,
          `"${control.etiqueta}" mide ${control.alto}px en ${step}/${ancho.nombre}`,
        ).toBeGreaterThanOrEqual(MINIMO_TACTIL);
      }

      await host.screenshot({ path: path.join(SALIDA, `${ancho.nombre}-alta-${step}.png`) });
    }
  }

  // La pantalla de espera no puede ofrecer nada operativo.
  await page.evaluate(() => window.__pintarAlta('pending', {
    request: { status: 'pending', requestedAccess: 'rider' },
  }));
  const espera = page.locator('[data-focal-alta]');
  await expect(espera).toContainText('Solicitud enviada');
  await expect(espera.locator('[data-panel-access-refresh]')).toHaveCount(1);
  await expect(espera.locator('[data-panel-signup-form]')).toHaveCount(0);
  await expect(espera.locator('[data-panel-request-form]')).toHaveCount(0);

  await guards.assertClean();
});

test('la bandeja de decisión se usa con el dedo y respeta el rol', async ({ page }) => {
  fs.mkdirSync(SALIDA, { recursive: true });
  const guards = installPageGuards(page);
  await gotoDemoReset(page, '/?reset=1&demo=1');
  await montar(page);
  await page.evaluate(() => window.__soloAlta());

  const bandeja = page.locator('[data-focal-bandeja]');

  for (const ancho of ANCHOS) {
    await page.setViewportSize({ width: ancho.width, height: ancho.height });
    await page.evaluate(() => window.__pintarBandeja('owner'));

    await expect(bandeja).toContainText('Solicitudes de acceso');
    await expect(bandeja).toContainText('Pedro Panel');
    await expect(bandeja).toContainText('Ramiro Rider');
    // El intento repetido se ve: es la señal de que alguien está insistiendo.
    await expect(bandeja).toContainText('Intentos');

    // Tarjetas, no una tabla de escritorio comprimida.
    await expect(bandeja.locator('table')).toHaveCount(0);
    await expect(bandeja.locator('.access-request-card')).toHaveCount(2);

    const medida = await desborde(page, '[data-focal-bandeja]');
    expect(medida.propio, `la bandeja desborda en ${ancho.nombre}`).toBe(0);
    expect(medida.pagina, `la bandeja desborda la página en ${ancho.nombre}`).toBe(0);

    for (const control of await altosTactiles(page, '[data-focal-bandeja]')) {
      expect(
        control.alto,
        `"${control.etiqueta}" mide ${control.alto}px en la bandeja/${ancho.nombre}`,
      ).toBeGreaterThanOrEqual(MINIMO_TACTIL);
    }

    await bandeja.screenshot({ path: path.join(SALIDA, `${ancho.nombre}-bandeja-owner.png`) });

    // El mismo estado, visto por un empleado: la decisión no se le ofrece.
    await page.evaluate(() => window.__pintarBandeja('staff'));
    await expect(bandeja.locator('[data-access-request-approve]')).toHaveCount(0);
    await expect(bandeja.locator('[data-access-request-reject]')).toHaveCount(0);
    await expect(bandeja).toContainText('dueño o el encargado');
    await bandeja.screenshot({ path: path.join(SALIDA, `${ancho.nombre}-bandeja-staff.png`) });
  }

  await guards.assertClean();
});
