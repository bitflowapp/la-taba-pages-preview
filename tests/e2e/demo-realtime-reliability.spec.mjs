import { expect, test } from '@playwright/test';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  fillCheckout,
  gotoDemoReset,
  installBrowserStubs,
  installPageGuards,
  waitForToast,
} from './helpers.mjs';

const RELAY_PORT = Number.parseInt(process.env.TABA_E2E_RELAY_PORT || '18787', 10);
const RELAY_BASE = `http://127.0.0.1:${RELAY_PORT}`;
const ROOM_KEY = '52a9801973e773503a785b428519136258570e0f2b193bd8e3775075ad9701a8';
const WRONG_KEY = 'a12159308dc599593ef1a600a54bd9f51cff2f1bf4b15abf21fdfcbcd6c283bb';
const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

test('cliente, negocio y rider convergen por UI con revisión y ACK', async ({ browser }) => {
  const clientContext = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const businessContext = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const riderContext = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const client = await clientContext.newPage();
  const business = await businessContext.newPage();
  const rider = await riderContext.newPage();
  const audits = [auditPage(client), auditPage(business), auditPage(rider)];
  const room = uniqueRoom('three-roles');
  const base = roomUrl(room);

  try {
    await Promise.all([
      installBrowserStubs(client),
      installBrowserStubs(business),
      installBrowserStubs(rider),
    ]);
    await gotoDemoReset(client, `${base}&reset=1#catalog`);
    await Promise.all([
      business.goto(`${base}#business`),
      rider.goto(`${base}#rider`),
    ]);
    await Promise.all([waitForRelay(client), waitForRelay(business), waitForRelay(rider)]);
    await unlockAdmin(business, 'business');
    await unlockAdmin(rider, 'rider');

    await client.locator('[data-product-grid] [data-add-product]:not([disabled])').first().click();
    await client.locator('[data-floating-cart]').click();
    await fillCheckout(client, {
      name: 'Cliente Sintetico Realtime',
      phone: '2990000101',
      street: 'Calle Sintetica 101',
      neighborhood: 'Barrio QA',
      reference: 'Puerta de prueba',
      notes: 'Pedido sintético para sincronización',
      payment: 'cash',
      deliveryMode: 'delivery',
    });
    await client.getByRole('button', { name: /Confirmar pedido/i }).click();
    await waitForToast(client, 'Pedido confirmado');
    const orderId = await expectOrderId(client);

    await expect(business.locator(`[data-inbox-order="${orderId}"]`)).toBeVisible();
    await business.locator(`[data-order-advance="${orderId}"]`).click();
    await waitForToast(business, 'Estado del pedido actualizado.');
    await business.locator(`[data-order-advance="${orderId}"]`).click();
    await waitForToast(business, 'Estado del pedido actualizado.');

    await expect(rider.locator(`[data-rider-accept="${orderId}"]`)).toBeVisible();
    await rider.locator(`[data-rider-accept="${orderId}"]`).click();
    await waitForToast(rider, 'Entrega aceptada');
    await rider.locator(`[data-delivery-leave="${orderId}"]`).click();
    await waitForToast(rider, 'Pedido marcado como en camino.');

    await expect.poll(() => orderStatus(client, orderId)).toBe('on_the_way');
    await expect(client.locator('[data-realtime-sync="global"]')).toContainText('Sincronizado');
    await expect(business.locator('[data-realtime-sync="business"]')).toContainText('Sincronizado');
    await expect(rider.locator('[data-realtime-sync="rider"]')).toContainText('Sincronizado');
    await assertRoomRevision(client, 2);
    audits.forEach(assertCleanAudit);
  } finally {
    await Promise.all([clientContext.close(), businessContext.close(), riderContext.close()]);
  }
});

test('un cliente tardío hidrata el snapshot autoritativo', async ({ page }) => {
  const audit = auditPage(page);
  const room = uniqueRoom('late-client');
  const order = syntheticOrder('LT-LATE', 'ready', Date.now());
  await resetRoom(room);
  await publishRoom(room, { orders: [order], lastOrderId: order.id, simulation: null }, 'business');
  await installBrowserStubs(page);
  await page.goto(`${roomUrl(room)}#tracking`);
  await waitForRelay(page);

  await expect.poll(() => orderStatus(page, order.id)).toBe('ready');
  await expect(page.locator('[data-tracking-panel]')).toContainText(order.id);
  assertCleanAudit(audit);
});

test('una publicación stale no borra ni regresa el pedido vigente', async ({ request }) => {
  const room = uniqueRoom('stale-write');
  const newer = syntheticOrder('LT-STALE', 'ready', Date.now());
  await resetRoom(room);
  const accepted = await publishRoom(room, {
    orders: [newer],
    lastOrderId: newer.id,
    simulation: null,
  }, 'business');
  const stale = await request.post(apiUrl('/publish', room), {
    data: {
      kind: 'state',
      sender: 'stale-client',
      snapshot: {
        orders: [{ ...newer, status: 'received', updatedAt: new Date(Date.now() - 60_000).toISOString() }],
        lastOrderId: newer.id,
        simulation: null,
      },
    },
  });
  const staleAck = await stale.json();
  const snapshot = await getRoom(room);

  expect(stale.ok()).toBeTruthy();
  expect(staleAck.accepted).toBe(false);
  expect(staleAck.revision).toBe(accepted.revision);
  expect(snapshot.snapshot.orders).toHaveLength(1);
  expect(snapshot.snapshot.orders[0].status).toBe('ready');
});

test('una caída temporal conserva sólo el último snapshot pendiente y permite reintento visible', async ({ page }) => {
  const audit = auditPage(page);
  const room = uniqueRoom('retry-latest');
  await installBrowserStubs(page);
  await gotoDemoReset(page, `${roomUrl(room)}&reset=1#tracking`);
  await waitForRelay(page);

  await page.route(`${RELAY_BASE}/publish?**`, (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ ok: false, error: 'synthetic_outage' }),
  }));
  const first = syntheticOrder('LT-RETRY', 'received', Date.now());
  const latest = withStatus(first, 'preparing', Date.now() + 1000);
  await page.evaluate(async ({ firstOrder, latestOrder }) => {
    const { setState } = await import(new URL('js/state.js', location.href).href);
    setState({ orders: [firstOrder], lastOrderId: firstOrder.id });
    setState({ orders: [latestOrder], lastOrderId: latestOrder.id });
  }, { firstOrder: first, latestOrder: latest });
  await expect.poll(() => realtimeStatus(page, 'pendingSnapshot')).toBe(true);
  await expect(page.locator('[data-realtime-sync="global"]')).toContainText('Reconectando');

  await page.unroute(`${RELAY_BASE}/publish?**`);
  await page.locator('[data-realtime-sync="global"]').click();
  await expect.poll(async () => (await getRoom(room)).snapshot.orders[0]?.status).toBe('preparing');
  await expect.poll(() => realtimeStatus(page, 'pendingSnapshot')).toBe(false);
  await expect(page.locator('[data-realtime-sync="global"]')).toContainText('Sincronizado');
  assertCleanAudit(audit);
});

test('pageshow, foco y cambio de vista recuperan una revisión perdida', async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await context.newPage();
  const foreground = await context.newPage();
  const audit = auditPage(page);
  const room = uniqueRoom('lifecycle');
  const received = syntheticOrder('LT-LIFECYCLE', 'received', Date.now());
  await resetRoom(room);
  await publishRoom(room, { orders: [received], lastOrderId: received.id }, 'client');
  await installBrowserStubs(page);
  await page.goto(`${roomUrl(room)}#tracking`);
  await waitForRelay(page);
  await foreground.goto('about:blank');

  const ready = withStatus(received, 'ready', Date.now() + 2000);
  await publishRoom(room, { orders: [ready], lastOrderId: ready.id }, 'business');
  await page.bringToFront();
  await page.evaluate(() => {
    window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true }));
    window.location.hash = '#business';
  });
  await expect.poll(() => orderStatus(page, ready.id)).toBe('ready');
  await expect.poll(() => realtimeStatus(page, 'relayState')).toBe('connected');
  assertCleanAudit(audit);
  await context.close();
});

test('key incorrecta queda aislada y un duplicado no incrementa revisión', async ({ request }) => {
  const room = uniqueRoom('auth-duplicate');
  const order = syntheticOrder('LT-DUPLICATE', 'received', Date.now());
  await resetRoom(room);
  const first = await publishRoom(room, { orders: [order], lastOrderId: order.id }, 'client');
  const duplicate = await publishRoom(room, { orders: [order], lastOrderId: order.id }, 'client');
  const missing = await request.get(`${RELAY_BASE}/snapshot?room=${encodeURIComponent(room)}`);
  const wrong = await request.get(`${RELAY_BASE}/snapshot?room=${encodeURIComponent(room)}&key=${WRONG_KEY}`);

  expect(first.accepted).toBe(true);
  expect(duplicate.accepted).toBe(false);
  expect(duplicate.revision).toBe(first.revision);
  expect(missing.status()).toBe(401);
  expect(wrong.status()).toBe(403);
  expect(await wrong.json()).toEqual({ ok: false, error: 'invalid_key' });
});

test('reinicio real con TABA_RELAY_STATE_DIR recupera la sala', async ({ browser }) => {
  const artifactRoot = path.join(os.tmpdir(), 'taba-relay-reliable-sync');
  await mkdir(artifactRoot, { recursive: true });
  const stateDir = await mkdtemp(path.join(artifactRoot, 'e2e-state-'));
  const port = 23_000 + (process.pid % 10_000);
  const relayBase = `http://127.0.0.1:${port}`;
  const room = uniqueRoom('restart');
  const order = syntheticOrder('LT-RESTART', 'preparing', Date.now());
  let relay = null;

  try {
    relay = await startRelay({ port, stateDir, artifactRoot });
    await resetRoom(room, relayBase);
    const published = await publishRoom(room, { orders: [order], lastOrderId: order.id }, 'client', relayBase);
    await stopRelay(relay);
    relay = await startRelay({ port, stateDir, artifactRoot });

    const recovered = await getRoom(room, relayBase);
    expect(recovered.revision).toBe(published.revision);
    expect(recovered.snapshot.orders[0].id).toBe(order.id);

    const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const page = await context.newPage();
    const audit = auditPage(page);
    await installBrowserStubs(page);
    await page.goto(`${roomUrl(room, relayBase)}#tracking`);
    await waitForRelay(page);
    await expect.poll(() => orderStatus(page, order.id)).toBe('preparing');
    assertCleanAudit(audit);
    await context.close();
  } finally {
    if (relay) await stopRelay(relay);
  }
});

function roomUrl(room, relayBase = RELAY_BASE) {
  return `/?demo=1&relay=${encodeURIComponent(relayBase)}&room=${encodeURIComponent(room)}&key=${ROOM_KEY}`;
}

function apiUrl(pathname, room, relayBase = RELAY_BASE, key = ROOM_KEY) {
  return `${relayBase}${pathname}?room=${encodeURIComponent(room)}&key=${encodeURIComponent(key)}`;
}

async function resetRoom(room, relayBase = RELAY_BASE) {
  const response = await fetch(apiUrl('/reset', room, relayBase), { method: 'POST' });
  expect(response.ok).toBeTruthy();
  return response.json();
}

async function publishRoom(room, snapshot, sender, relayBase = RELAY_BASE) {
  const response = await fetch(apiUrl('/publish', room, relayBase), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ kind: 'state', sender, snapshot }),
  });
  expect(response.ok).toBeTruthy();
  return response.json();
}

async function getRoom(room, relayBase = RELAY_BASE) {
  const response = await fetch(apiUrl('/snapshot', room, relayBase));
  expect(response.ok).toBeTruthy();
  return response.json();
}

async function waitForRelay(page) {
  await expect.poll(() => realtimeStatus(page, 'relayState')).toBe('connected');
}

async function realtimeStatus(page, property) {
  return page.evaluate(async (name) => {
    const { getRealtimeStatus } = await import(new URL('js/realtime.js', location.href).href);
    return getRealtimeStatus()[name];
  }, property);
}

async function orderStatus(page, orderId) {
  return page.evaluate(async (id) => {
    const { getState } = await import(new URL('js/state.js', location.href).href);
    return getState().orders.find((order) => order.id === id)?.status || '';
  }, orderId);
}

async function expectOrderId(page) {
  let result = '';
  await expect.poll(async () => {
    result = await page.evaluate(async () => {
      const { getState } = await import(new URL('js/state.js', location.href).href);
      return getState().lastOrderId || '';
    });
    return result;
  }).not.toBe('');
  return result;
}

async function assertRoomRevision(page, minimum) {
  await expect.poll(() => realtimeStatus(page, 'revision')).toBeGreaterThanOrEqual(minimum);
  await expect.poll(() => realtimeStatus(page, 'ackRevision')).toBeGreaterThanOrEqual(minimum);
}

async function unlockAdmin(page, view) {
  const opener = page.locator(`[data-view="${view}"] [data-open-pin]`).first();
  if (await opener.isVisible()) {
    await opener.click();
    await page.getByLabel('Código del modo negocio').fill('1234');
    await page.locator('[data-pin-form]').press('Enter');
  }
  await expect(page.locator('body')).toHaveAttribute('data-active-view', view);
}

function syntheticOrder(id, status, timestamp) {
  const iso = new Date(timestamp).toISOString();
  return {
    id,
    status,
    createdAt: iso,
    updatedAt: iso,
    statusHistory: [{ status, at: iso }],
    customerName: 'Cliente Sintetico QA',
    customerPhone: '2990000000',
    address: 'Calle Sintetica 100, Barrio QA',
    addressDetails: {
      streetLine: 'Calle Sintetica 100',
      neighborhood: 'Barrio QA',
      reference: 'Puerta de prueba',
    },
    deliveryMode: 'delivery',
    paymentMethod: 'Efectivo',
    notes: 'Dato sintetico de prueba',
    items: [{ productId: 'synthetic-product', name: 'Producto QA', quantity: 1, unitPrice: 1000 }],
    subtotal: 1000,
    deliveryFee: 0,
    total: 1000,
  };
}

function withStatus(order, status, timestamp) {
  const iso = new Date(timestamp).toISOString();
  return {
    ...order,
    status,
    updatedAt: iso,
    statusHistory: [...(order.statusHistory || []), { status, at: iso }],
  };
}

function uniqueRoom(prefix) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function auditPage(page) {
  const guards = installPageGuards(page);
  const pageErrors = [];
  const consoleErrors = [];
  const supabaseRequests = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });
  page.on('request', (request) => {
    if (/^https?:\/\/[^/]*\.supabase\.(?:co|in)\//i.test(request.url())) {
      supabaseRequests.push(request.url());
    }
  });
  return { guards, pageErrors, consoleErrors, supabaseRequests };
}

function assertCleanAudit(audit) {
  audit.guards.assertClean();
  expect(audit.pageErrors).toEqual([]);
  expect(audit.consoleErrors).toEqual([]);
  expect(audit.supabaseRequests).toEqual([]);
}

async function startRelay({ port, stateDir, artifactRoot }) {
  const child = spawn(process.execPath, ['scripts/realtime-relay.mjs', String(port)], {
    cwd: REPO_ROOT,
    env: { ...process.env, TABA_RELAY_STATE_DIR: stateDir },
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });
  const output = [];
  const errors = [];
  child.stdout.on('data', (chunk) => output.push(String(chunk)));
  child.stderr.on('data', (chunk) => errors.push(String(chunk)));
  child.once('exit', () => {
    const suffix = `${port}-${child.pid}`;
    void writeFile(path.join(artifactRoot, `e2e-relay-${suffix}.stdout.log`), output.join(''), 'utf8');
    void writeFile(path.join(artifactRoot, `e2e-relay-${suffix}.stderr.log`), errors.join(''), 'utf8');
  });
  await waitForHealth(`http://127.0.0.1:${port}/health`, child);
  return child;
}

async function waitForHealth(url, child) {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`Relay de prueba terminó con código ${child.exitCode}.`);
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch (_) {
      // El proceso todavía está abriendo el puerto.
    }
    await delay(100);
  }
  throw new Error('El relay de prueba no abrió el puerto dentro de 10 segundos.');
}

async function stopRelay(child) {
  if (!child || processHasExited(child)) return;
  const gracefulExit = once(child, 'exit');
  child.kill('SIGTERM');
  await Promise.race([gracefulExit, delay(2000)]);
  if (!processHasExited(child)) {
    const forcedExit = once(child, 'exit');
    child.kill('SIGKILL');
    await Promise.race([forcedExit, delay(2000)]);
  }
  if (!processHasExited(child)) {
    throw new Error(`El relay de prueba PID ${child.pid} no se detuvo.`);
  }
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function processHasExited(child) {
  return child.exitCode !== null || child.signalCode !== null;
}
