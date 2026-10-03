# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: gate1-order-revision.spec.mjs >> un pedido versionado por el servidor gana sobre una copia local sin versión
- Location: tests\e2e\gate1-order-revision.spec.mjs:103:1

# Error details

```
Error: page.goto: Could not connect to server
Call log:
  - navigating to "http://127.0.0.1:38202/?demo=1", waiting until "load"

```

# Test source

```ts
  1   | import { expect, test } from '@playwright/test';
  2   | import { installBrowserStubs, installPageGuards } from './helpers.mjs';
  3   | 
  4   | // Focales E2E del Gate 1.
  5   | //
  6   | // Verifican el reconciliador REAL que se sirve al navegador
  7   | // (js/core/realtime-sync.js), importado como módulo ES dentro de la página, no
  8   | // una copia ni un mock en Node. Lo que se prueba acá es exactamente el código
  9   | // que corre en el celular del cliente, del negocio y del rider.
  10  | //
  11  | // El caso central es el fallo medido en staging: dos escrituras de la misma
  12  | // transacción de PostgreSQL comparten created_at al microsegundo (3 de 19
  13  | // eventos reales), y el reconciliador comparaba con `>` estricto, así que ante
  14  | // un empate descartaba el cambio en silencio.
  15  | 
  16  | const SAME_INSTANT = '2026-08-01T01:25:51.070Z';
  17  | 
  18  | async function loadReconciler(page) {
  19  |   await installBrowserStubs(page);
  20  |   installPageGuards(page);
> 21  |   await page.goto('/?demo=1', { waitUntil: 'load' });
      |              ^ Error: page.goto: Could not connect to server
  22  |   return page.evaluate(async () => {
  23  |     const module = await import('/js/core/realtime-sync.js');
  24  |     return typeof module.shouldReplaceOrder === 'function'
  25  |       && typeof module.mergeOrders === 'function'
  26  |       && typeof module.orderRevision === 'function';
  27  |   });
  28  | }
  29  | 
  30  | test('el reconciliador servido al navegador expone la versión por revisión', async ({ page }) => {
  31  |   const ready = await loadReconciler(page);
  32  |   expect(ready).toBe(true);
  33  | });
  34  | 
  35  | test('con created_at idéntico, la revisión mayor gana en el navegador', async ({ page }) => {
  36  |   await loadReconciler(page);
  37  | 
  38  |   const result = await page.evaluate(async (sameInstant) => {
  39  |     const { shouldReplaceOrder } = await import('/js/core/realtime-sync.js');
  40  |     const local = { id: 'LT-0001', createdAt: sameInstant, revision: 4 };
  41  |     const incoming = { id: 'LT-0001', createdAt: sameInstant, revision: 5 };
  42  |     return {
  43  |       forward: shouldReplaceOrder(local, incoming),
  44  |       backward: shouldReplaceOrder(incoming, local),
  45  |     };
  46  |   }, SAME_INSTANT);
  47  | 
  48  |   // Antes de este gate ambas daban false: el empate de timestamp bloqueaba el
  49  |   // avance legítimo.
  50  |   expect(result.forward).toBe(true);
  51  |   expect(result.backward).toBe(false);
  52  | });
  53  | 
  54  | test('un evento atrasado no pisa el estado vigente aunque llegue con timestamp posterior', async ({ page }) => {
  55  |   await loadReconciler(page);
  56  | 
  57  |   const applied = await page.evaluate(async () => {
  58  |     const { mergeOrders } = await import('/js/core/realtime-sync.js');
  59  |     const local = [{ id: 'LT-0001', status: 'on_the_way', revision: 9 }];
  60  |     const stale = [{
  61  |       id: 'LT-0001',
  62  |       status: 'preparing',
  63  |       revision: 8,
  64  |       createdAt: '2026-08-01T23:59:59.000Z',
  65  |     }];
  66  |     const merged = mergeOrders(local, stale);
  67  |     return { status: merged.orders[0].status, revision: merged.orders[0].revision, changed: merged.changed };
  68  |   });
  69  | 
  70  |   expect(applied.status).toBe('on_the_way');
  71  |   expect(applied.revision).toBe(9);
  72  |   expect(applied.changed).toBe(false);
  73  | });
  74  | 
  75  | test('una entrega duplicada del mismo mensaje no altera el pedido', async ({ page }) => {
  76  |   await loadReconciler(page);
  77  | 
  78  |   const changed = await page.evaluate(async () => {
  79  |     const { mergeOrders } = await import('/js/core/realtime-sync.js');
  80  |     const local = [{ id: 'LT-0001', status: 'ready', revision: 5 }];
  81  |     const duplicate = [{ id: 'LT-0001', status: 'ready', revision: 5 }];
  82  |     return mergeOrders(local, duplicate).changed;
  83  |   });
  84  | 
  85  |   expect(changed).toBe(false);
  86  | });
  87  | 
  88  | test('una cancelación legítima se aplica aunque el estado visible retroceda', async ({ page }) => {
  89  |   await loadReconciler(page);
  90  | 
  91  |   const merged = await page.evaluate(async () => {
  92  |     const { mergeOrders } = await import('/js/core/realtime-sync.js');
  93  |     const local = [{ id: 'LT-0001', status: 'on_the_way', revision: 6 }];
  94  |     const cancelled = [{ id: 'LT-0001', status: 'cancelled', revision: 7 }];
  95  |     const result = mergeOrders(local, cancelled);
  96  |     return { status: result.orders[0].status, changed: result.changed };
  97  |   });
  98  | 
  99  |   expect(merged.status).toBe('cancelled');
  100 |   expect(merged.changed).toBe(true);
  101 | });
  102 | 
  103 | test('un pedido versionado por el servidor gana sobre una copia local sin versión', async ({ page }) => {
  104 |   await loadReconciler(page);
  105 | 
  106 |   // Escenario de recuperación tras reconexión: la copia local quedó sin
  107 |   // versión (demo/relay) y el servidor responde con la fila versionada.
  108 |   const result = await page.evaluate(async () => {
  109 |     const { shouldReplaceOrder } = await import('/js/core/realtime-sync.js');
  110 |     const localUnversioned = { id: 'LT-0001', createdAt: '2026-08-01T05:00:00.000Z' };
  111 |     const serverVersioned = { id: 'LT-0001', createdAt: '2026-08-01T01:00:00.000Z', revision: 1 };
  112 |     return {
  113 |       adoptsServer: shouldReplaceOrder(localUnversioned, serverVersioned),
  114 |       keepsServer: shouldReplaceOrder(serverVersioned, localUnversioned),
  115 |     };
  116 |   });
  117 | 
  118 |   expect(result.adoptsServer).toBe(true);
  119 |   expect(result.keepsServer).toBe(false);
  120 | });
  121 | 
```