import { expect, test } from '@playwright/test';
import { installBrowserStubs, installPageGuards } from './helpers.mjs';

// Focales E2E del Gate 1.
//
// Verifican el reconciliador REAL que se sirve al navegador
// (js/core/realtime-sync.js), importado como módulo ES dentro de la página, no
// una copia ni un mock en Node. Lo que se prueba acá es exactamente el código
// que corre en el celular del cliente, del negocio y del rider.
//
// El caso central es el fallo medido en staging: dos escrituras de la misma
// transacción de PostgreSQL comparten created_at al microsegundo (3 de 19
// eventos reales), y el reconciliador comparaba con `>` estricto, así que ante
// un empate descartaba el cambio en silencio.

const SAME_INSTANT = '2026-08-01T01:25:51.070Z';

async function loadReconciler(page) {
  await installBrowserStubs(page);
  installPageGuards(page);
  await page.goto('/?demo=1', { waitUntil: 'load' });
  return page.evaluate(async () => {
    const module = await import('/js/core/realtime-sync.js');
    return typeof module.shouldReplaceOrder === 'function'
      && typeof module.mergeOrders === 'function'
      && typeof module.orderRevision === 'function';
  });
}

test('el reconciliador servido al navegador expone la versión por revisión', async ({ page }) => {
  const ready = await loadReconciler(page);
  expect(ready).toBe(true);
});

test('con created_at idéntico, la revisión mayor gana en el navegador', async ({ page }) => {
  await loadReconciler(page);

  const result = await page.evaluate(async (sameInstant) => {
    const { shouldReplaceOrder } = await import('/js/core/realtime-sync.js');
    const local = { id: 'LT-0001', createdAt: sameInstant, revision: 4 };
    const incoming = { id: 'LT-0001', createdAt: sameInstant, revision: 5 };
    return {
      forward: shouldReplaceOrder(local, incoming),
      backward: shouldReplaceOrder(incoming, local),
    };
  }, SAME_INSTANT);

  // Antes de este gate ambas daban false: el empate de timestamp bloqueaba el
  // avance legítimo.
  expect(result.forward).toBe(true);
  expect(result.backward).toBe(false);
});

test('un evento atrasado no pisa el estado vigente aunque llegue con timestamp posterior', async ({ page }) => {
  await loadReconciler(page);

  const applied = await page.evaluate(async () => {
    const { mergeOrders } = await import('/js/core/realtime-sync.js');
    const local = [{ id: 'LT-0001', status: 'on_the_way', revision: 9 }];
    const stale = [{
      id: 'LT-0001',
      status: 'preparing',
      revision: 8,
      createdAt: '2026-08-01T23:59:59.000Z',
    }];
    const merged = mergeOrders(local, stale);
    return { status: merged.orders[0].status, revision: merged.orders[0].revision, changed: merged.changed };
  });

  expect(applied.status).toBe('on_the_way');
  expect(applied.revision).toBe(9);
  expect(applied.changed).toBe(false);
});

test('una entrega duplicada del mismo mensaje no altera el pedido', async ({ page }) => {
  await loadReconciler(page);

  const changed = await page.evaluate(async () => {
    const { mergeOrders } = await import('/js/core/realtime-sync.js');
    const local = [{ id: 'LT-0001', status: 'ready', revision: 5 }];
    const duplicate = [{ id: 'LT-0001', status: 'ready', revision: 5 }];
    return mergeOrders(local, duplicate).changed;
  });

  expect(changed).toBe(false);
});

test('una cancelación legítima se aplica aunque el estado visible retroceda', async ({ page }) => {
  await loadReconciler(page);

  const merged = await page.evaluate(async () => {
    const { mergeOrders } = await import('/js/core/realtime-sync.js');
    const local = [{ id: 'LT-0001', status: 'on_the_way', revision: 6 }];
    const cancelled = [{ id: 'LT-0001', status: 'cancelled', revision: 7 }];
    const result = mergeOrders(local, cancelled);
    return { status: result.orders[0].status, changed: result.changed };
  });

  expect(merged.status).toBe('cancelled');
  expect(merged.changed).toBe(true);
});

test('un pedido versionado por el servidor gana sobre una copia local sin versión', async ({ page }) => {
  await loadReconciler(page);

  // Escenario de recuperación tras reconexión: la copia local quedó sin
  // versión (demo/relay) y el servidor responde con la fila versionada.
  const result = await page.evaluate(async () => {
    const { shouldReplaceOrder } = await import('/js/core/realtime-sync.js');
    const localUnversioned = { id: 'LT-0001', createdAt: '2026-08-01T05:00:00.000Z' };
    const serverVersioned = { id: 'LT-0001', createdAt: '2026-08-01T01:00:00.000Z', revision: 1 };
    return {
      adoptsServer: shouldReplaceOrder(localUnversioned, serverVersioned),
      keepsServer: shouldReplaceOrder(serverVersioned, localUnversioned),
    };
  });

  expect(result.adoptsServer).toBe(true);
  expect(result.keepsServer).toBe(false);
});

test('los pedidos sin respaldo Supabase siguen reconciliándose por marca de tiempo', async ({ page }) => {
  await loadReconciler(page);

  // Compatibilidad hacia atrás: demo, relay y sandbox no tienen versión de
  // servidor y no deben quedar congelados por el cambio.
  const result = await page.evaluate(async () => {
    const { shouldReplaceOrder } = await import('/js/core/realtime-sync.js');
    const local = { id: 'demo-1', createdAt: '2026-08-01T01:00:00.000Z' };
    return {
      newer: shouldReplaceOrder(local, { id: 'demo-1', createdAt: '2026-08-01T02:00:00.000Z' }),
      older: shouldReplaceOrder(local, { id: 'demo-1', createdAt: '2026-08-01T00:00:00.000Z' }),
    };
  });

  expect(result.newer).toBe(true);
  expect(result.older).toBe(false);
});

test('una revisión inválida no se toma por buena', async ({ page }) => {
  await loadReconciler(page);

  const revisions = await page.evaluate(async () => {
    const { orderRevision } = await import('/js/core/realtime-sync.js');
    return {
      valid: orderRevision({ revision: 3 }),
      numericString: orderRevision({ revision: '4' }),
      zero: orderRevision({ revision: 0 }),
      negative: orderRevision({ revision: -1 }),
      fractional: orderRevision({ revision: 1.5 }),
      missing: orderRevision({}),
    };
  });

  expect(revisions.valid).toBe(3);
  expect(revisions.numericString).toBe(4);
  expect(revisions.zero).toBeNull();
  expect(revisions.negative).toBeNull();
  expect(revisions.fractional).toBeNull();
  expect(revisions.missing).toBeNull();
});
