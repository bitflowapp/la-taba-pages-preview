import { expect, test } from '@playwright/test';
import { gotoDemoReset, installPageGuards } from './helpers.mjs';

/*
 * Panel focal: rearmar el pedido de un cobro que entró y se quedó sin reserva.
 *
 * ALCANCE, DICHO DE FRENTE. Esta candidata NO toca staging y no hay base viva
 * detrás, así que el servidor se reemplaza por un contexto de prueba. Lo que
 * SÍ es real: el navegador (Chromium y WebKit móvil), el módulo de la central
 * de operación tal cual se despacha, su markup, la hoja styles/business.css
 * que lo pinta, y el despacho del click. Lo único simulado es la respuesta del
 * servidor —justo lo que ya quedó certificado en la base con las 68
 * migraciones y no se vuelve a probar acá—.
 *
 * Lo que se demuestra: que el Panel vea los cobros, que la salida de rearmado
 * aparezca sólo cuando el servidor la habilita y el rol alcanza, que rearmar
 * dos veces no anuncie un pedido nuevo, que sin stock el mensaje diga qué falta
 * y cuánto, y que nada de eso desborde en 320, 360, 390 y 432.
 */

const ANCHOS = [320, 360, 390, 432];

const READY_PAYMENTS = {
  settings_present: true, collector_configured: true, application_configured: true,
  collector_id_short: '8877', application_id_short: '2233', credentials_loaded: true,
  environment: 'test', signed_notice_at: '2026-08-04T10:00:00.000Z',
  test_payment_at: '2026-08-04T10:05:00.000Z', test_payment_order_created: true,
  test_payment_stock_applied: true, enabled: true, reserve_stock: true, storefront_ready: true,
};

// Tres cobros: uno normal ya entregado, uno recuperable, y uno en revisión que
// el servidor NO habilita a rearmar. El tercero es el control: prueba que la
// salida no aparece por el estado, sino porque el servidor la habilitó.
const PAGOS = [
  {
    payment_intent_id: 'p-1', checkout_session_id: 'cs-1', internal_status: 'completed',
    order_public_code: 'LT-0001', amount: 12400, currency: 'ARS', can_refund: true,
  },
  {
    payment_intent_id: 'p-2', checkout_session_id: 'cs-2',
    internal_status: 'security_review_required',
    security_review_reason: 'approved_after_reservation_expired',
    provider_status: 'approved', amount: 8600, currency: 'ARS',
    can_recover_order: true, can_refund: true,
  },
  {
    payment_intent_id: 'p-3', checkout_session_id: 'cs-3',
    internal_status: 'security_review_required',
    security_review_reason: 'amount_mismatch',
    provider_status: 'approved', amount: 5000, currency: 'ARS',
    can_recover_order: false, can_refund: true,
  },
];

/**
 * Monta la central de operación real dentro de la página ya cargada y devuelve
 * un mando para renderizar y despachar clicks contra ella.
 */
async function montarPanel(page, { role = 'owner', escenario = 'ok' } = {}) {
  await page.evaluate(async ({ role, escenario, PAGOS, READY_PAYMENTS }) => {
    const mod = await import('/js/business/business-operations-center.js');
    window.__panel = mod;
    window.__llamadas = [];
    let veces = 0;

    mod.configureBusinessOperations({
      role,
      listPayments: async () => ({ ok: true, data: PAGOS }),
      getPaymentsActivation: async () => ({ ok: true, data: READY_PAYMENTS }),
      reconcilePayment: async (id) => {
        window.__llamadas.push(['reconcilePayment', id]);
        return { ok: true };
      },
      recoverOrder: async (id) => {
        window.__llamadas.push(['recoverOrder', id]);
        veces += 1;
        if (escenario === 'sin-stock') {
          return {
            ok: false,
            reason: 'stock_insuficiente',
            message: 'No hay stock para armarlo: Fernet Branca 750 ml (hay 1, hacen falta 4). Devolvé el dinero desde el Panel.',
          };
        }
        return veces === 1
          ? { ok: true, order_code: 'LT-0003', message: 'Pedido LT-0003 armado.' }
          : { ok: true, idempotent: true, order_code: 'LT-0003', message: 'El pedido de este cobro ya estaba armado.' };
      },
      onChange() {},
    });

    // Sin clase de shell a propósito: las tarjetas del panel se estilan por su
    // propia clase (styles/business.css), así que la hoja real las pinta igual,
    // y no se agrega un segundo shell de 100vh que ensucie la medición de
    // desborde de la página.
    const host = document.createElement('div');
    host.setAttribute('data-focal-panel', '');
    document.body.appendChild(host);
    window.__pintar = () => { host.innerHTML = window.__panel.renderBusinessOperations('payments'); };
    window.__pintar();
  }, { role, escenario, PAGOS, READY_PAYMENTS });

  // El listado llega por promesa: se pinta una vez resuelta.
  await page.waitForTimeout(50);
  await page.evaluate(() => window.__pintar());
}

const clickRecover = (page, paymentIntent = 'p-2') => page.evaluate(async (paymentIntent) => {
  const node = { dataset: { paymentAction: 'recover-order', paymentIntent } };
  node.closest = (sel) => (sel === '[data-payment-action]' ? node : null);
  const res = await window.__panel.handleBusinessOperationsAction(node);
  window.__pintar();
  return res;
}, paymentIntent);

async function medirDesborde(page) {
  return page.evaluate(() => {
    const host = document.querySelector('[data-focal-panel]');
    return {
      panel: Math.max(0, host.scrollWidth - host.clientWidth),
      pagina: Math.max(0, document.documentElement.scrollWidth - window.innerWidth),
    };
  });
}

test('el Panel ve los cobros y ofrece rearmar sólo donde corresponde, sin desbordar', async ({ browser }) => {
  for (const ancho of ANCHOS) {
    const context = await browser.newContext({ viewport: { width: ancho, height: 844 } });
    const page = await context.newPage();
    const guards = installPageGuards(page);
    await gotoDemoReset(page, '/?reset=1&demo=1');
    await montarPanel(page);

    const panel = page.locator('[data-focal-panel]');
    // Ve los pedidos: los tres cobros, con su importe.
    await expect(panel).toContainText('LT-0001');
    await expect(panel).toContainText('3 pago(s) listados');

    // La salida de rearmado aparece UNA sola vez: sólo en el cobro que el
    // servidor habilitó. El de revisión sin bandera no la ofrece.
    const botones = panel.locator('[data-payment-action="recover-order"]');
    await expect(botones).toHaveCount(1);
    await expect(botones).toHaveAttribute('data-payment-intent', 'p-2');
    await expect(panel).toContainText('Armar el pedido de este cobro');

    const desborde = await medirDesborde(page);
    expect(desborde.panel, `el panel desborda ${desborde.panel} px en ${ancho}`).toBe(0);
    expect(desborde.pagina, `la página desborda ${desborde.pagina} px en ${ancho}`).toBe(0);

    await guards.assertClean();
    await context.close();
  }
});

test('rearmar va al rearmado, y la segunda vez no anuncia un pedido nuevo', async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await context.newPage();
  const guards = installPageGuards(page);
  await gotoDemoReset(page, '/?reset=1&demo=1');
  await montarPanel(page);

  const primera = await clickRecover(page);
  expect(primera.ok).toBe(true);
  expect(primera.message).toContain('LT-0003');

  // Va al rearmado con el id de la compra, no a la reconciliación con el del pago.
  expect(await page.evaluate(() => window.__llamadas)).toEqual([['recoverOrder', 'cs-2']]);

  const segunda = await clickRecover(page);
  expect(segunda.ok).toBe(true);
  expect(segunda.message).toContain('ya estaba armado');
  expect(segunda.message).not.toContain('LT-0003 armado.');

  await guards.assertClean();
  await context.close();
});

test('sin stock el operador se entera de qué falta y cuánto, y no desborda', async ({ browser }) => {
  for (const ancho of ANCHOS) {
    const context = await browser.newContext({ viewport: { width: ancho, height: 844 } });
    const page = await context.newPage();
    const guards = installPageGuards(page);
    await gotoDemoReset(page, '/?reset=1&demo=1');
    await montarPanel(page, { escenario: 'sin-stock' });

    const res = await clickRecover(page);
    expect(res.ok).toBe(false);
    expect(res.message).toContain('Fernet Branca 750 ml');
    expect(res.message).toContain('hay 1, hacen falta 4');
    expect(res.message).toContain('Devolvé el dinero');

    // El mensaje se muestra, no se traga.
    await expect(page.locator('[data-focal-panel]')).toContainText('hacen falta 4');
    // Y la devolución sigue disponible: es la salida que queda.
    await expect(page.locator('[data-focal-panel] [data-payment-action="refund"]').first()).toBeVisible();

    const desborde = await medirDesborde(page);
    expect(desborde.panel, `el mensaje de faltantes desborda ${desborde.panel} px en ${ancho}`).toBe(0);

    await guards.assertClean();
    await context.close();
  }
});

test('el equipo no ve ni ejecuta el rearmado', async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await context.newPage();
  const guards = installPageGuards(page);
  await gotoDemoReset(page, '/?reset=1&demo=1');
  await montarPanel(page, { role: 'staff' });

  await expect(page.locator('[data-focal-panel]')).not.toContainText('Armar el pedido de este cobro');

  // Aunque dispare la acción a mano, el permiso se vuelve a exigir.
  const denied = await clickRecover(page);
  expect(denied.ok).toBe(false);
  expect(denied.message).toMatch(/dueño o el encargado/);
  expect(await page.evaluate(() => window.__llamadas)).toEqual([]);

  await guards.assertClean();
  await context.close();
});
