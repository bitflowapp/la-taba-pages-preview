// EL BLOQUE FISCAL DE LA BANDEJA, CONTRA EL CONTRATO DE RED (CI)
//
// La prueba con la base real (order-fiscal-real-db.spec.mjs) necesita PostgreSQL y el core
// fiscal, y corre local. Esta corre en CI con los datos de prueba del Panel y fija el CABLEADO:
// que la bandeja lea get_order_fiscal_states y get_local_print_status, que muestre lo que
// devuelven, y que "Facturar e imprimir" y "Reimprimir" manden las RPC con sus argumentos.
// Un error de cableado —como pedirle las RPC fiscales al repositorio de pedidos, que no las
// tiene— deja cada pedido en "Estado fiscal no disponible", y acá se ve sin base.
//
// El servidor es un modelo mínimo con estado: NO prueba reglas fiscales (eso lo hacen el pgTAP y
// la E2E con la base real). Todo comprobante de este modelo es de homologación.
import { expect, test } from '@playwright/test';

import { SUPABASE_URL, instalarDatosDePrueba, pedidos } from '../../scripts/lib/business-panel-fixtures.mjs';

const [listo, sinPolitica, emitido] = pedidos();
const TRABAJO_IMPRESO = '99999999-0000-4000-8000-00000000000a';
const ARTEFACTO = '99999999-0000-4000-8000-00000000000b';

function documento(id, state, extra = {}) {
  return {
    id, state, environment: 'homologation', document_type: 6, point_of_sale: 6, document_number: null, cae: null,
    cae_expiration: null, authorized_at: null, total_amount: 0, artifact_state: null, artifact_id: null, ...extra,
  };
}

async function servidorFiscal(page) {
  const estado = { facturas: [], reimpresiones: [], lecturas: 0 };
  const fila = (order) => {
    if (order.id === listo.id) {
      const pedida = estado.facturas.at(-1);
      return pedida
        ? { order_id: order.id, readiness: { status: 'ALREADY_REQUESTED', reasons: [] }, document: documento('99999999-0000-4000-8000-000000000001', 'queued'),
          print: { requested: pedida.p_print, request_error: false, latest_job: null, jobs: 0 } }
        : { order_id: order.id, readiness: { status: 'READY', reasons: [] }, document: null, print: null };
    }
    if (order.id === sinPolitica.id) {
      return { order_id: order.id, readiness: { status: 'BLOCKED', reasons: [{ code: 'ACCOUNTING_POLICY_REQUIRED', scope: 'commercial' }] }, document: null, print: null };
    }
    if (order.id === emitido.id) {
      const reimpreso = estado.reimpresiones.length > 0;
      return {
        order_id: order.id, readiness: { status: 'ALREADY_REQUESTED', reasons: [] },
        document: documento('99999999-0000-4000-8000-000000000002', 'authorized', { document_number: 7, cae: '74000000000007', artifact_state: 'ready', artifact_id: ARTEFACTO }),
        print: {
          requested: true, request_error: false, jobs: reimpreso ? 2 : 1,
          latest_job: reimpreso
            ? { id: '99999999-0000-4000-8000-00000000000c', status: 'queued', reprint_of: TRABAJO_IMPRESO }
            : { id: TRABAJO_IMPRESO, status: 'printed', reprint_of: null },
        },
      };
    }
    return null;
  };
  await page.route(`${SUPABASE_URL}/rest/v1/rpc/**`, async (route) => {
    const nombre = new URL(route.request().url()).pathname.split('/').pop();
    const cuerpo = JSON.parse(route.request().postData() || '{}');
    const json = (body) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
    if (nombre === 'get_order_fiscal_states') {
      estado.lecturas += 1;
      return json(pedidos().filter((order) => cuerpo.p_order_ids.includes(order.id)).map(fila).filter(Boolean));
    }
    if (nombre === 'get_local_print_status') return json({ agent: 'OFFLINE', devices: [], queue: {}, settings: {} });
    if (nombre === 'request_order_invoice') {
      estado.facturas.push(cuerpo);
      return json({ fiscal_document_id: '99999999-0000-4000-8000-000000000001', state: 'queued', print: { status: 'waiting_authorization' } });
    }
    if (nombre === 'request_print_job_reprint') {
      estado.reimpresiones.push(cuerpo);
      return json({ print_job_id: '99999999-0000-4000-8000-00000000000c', status: 'queued', reprint_of: TRABAJO_IMPRESO });
    }
    return route.fallback();
  });
  return estado;
}

test('la bandeja lee el estado fiscal, factura e imprime y reimprime con las RPC y sus argumentos', async ({ page }) => {
  await instalarDatosDePrueba(page, { comoEmpleado: true });
  const estado = await servidorFiscal(page);
  await page.goto('/#business', { waitUntil: 'domcontentloaded' });
  await page.locator('[data-production-workspace="business"]').waitFor({ state: 'visible', timeout: 30_000 });
  await page.locator('[data-production-orders-view]:visible').first().click();
  await page.locator('[data-order-tray]').waitFor({ state: 'visible', timeout: 15_000 });

  const bloque = (order) => page.locator(`[data-order-fiscal="${order.id}"]`);
  await expect(bloque(listo)).toHaveAttribute('data-order-fiscal-status', 'READY');
  await expect(bloque(sinPolitica)).toHaveAttribute('data-order-fiscal-status', 'POLICY_REQUIRED');
  await expect(bloque(sinPolitica)).toContainText('Configuración fiscal pendiente');
  await expect(bloque(sinPolitica).getByRole('button', { name: 'Facturar e imprimir' })).toBeDisabled();
  await expect(bloque(emitido)).toHaveAttribute('data-order-fiscal-status', 'ISSUED');
  await expect(bloque(emitido).locator('[data-fiscal-simulation]')).toHaveText('HOMOLOGACIÓN · sin validez fiscal');
  await expect(bloque(emitido).locator('.production-order-fiscal-number')).toHaveText('Factura B 00006-00000007 · CAE de homologación 74000000000007');
  expect(estado.lecturas).toBeGreaterThan(0);

  await bloque(listo).getByRole('button', { name: 'Facturar e imprimir' }).click();
  await expect(bloque(listo)).toHaveAttribute('data-order-fiscal-status', 'PENDING');
  await expect(bloque(listo).locator('[data-fiscal-print]')).toHaveText('Se imprime al emitirse');
  expect(estado.facturas).toEqual([{
    p_business_id: listo.business_id, p_order_id: listo.id, p_idempotency_key: expect.stringMatching(/^order-invoice-[A-Za-z0-9_-]{8,}$/),
    p_command_source: 'PANEL', p_print: true,
  }]);

  await bloque(emitido).getByRole('button', { name: 'Reimprimir' }).click();
  await expect(page.locator('[data-toast]')).toContainText('Reimpresión enviada a la PC de impresión.');
  await expect(bloque(emitido).locator('[data-fiscal-print]')).toHaveText('Impresión pendiente · la PC de impresión está sin conexión');
  expect(estado.reimpresiones).toEqual([{
    p_job_id: TRABAJO_IMPRESO, p_reason: 'Reimpresión pedida desde el Panel', p_idempotency_key: expect.stringMatching(/^order-reprint-[A-Za-z0-9_-]{8,}$/),
  }]);
});
