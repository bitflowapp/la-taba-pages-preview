import { expect, test } from '@playwright/test';
import { randomBytes } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { createClient } from '@supabase/supabase-js';
import {
  EXPECTED_STAGING_REF,
  validateBusinessIntakeStagingSmokeEnvironment,
} from '../../scripts/run-business-intake-staging-smoke.mjs';

const url = String(process.env.SUPABASE_URL || '').trim().replace(/\/+$/, '');
const publishableKey = String(
  process.env.SUPABASE_PUBLISHABLE_KEY
  || process.env.SUPABASE_ANON_KEY
  || '',
).trim();
const businessId = String(process.env.SUPABASE_BUSINESS_ID || '').trim();
const staffEmail = String(process.env.SUPABASE_STAFF_EMAIL || '').trim();
const staffPassword = String(process.env.SUPABASE_STAFF_PASSWORD || '');
const evidenceDirectory = String(process.env.TABA_INTAKE_EVIDENCE_DIR || '').trim();
const runId = `intake-${Date.now()}-${randomBytes(4).toString('hex')}`;
const customerPhone = '2990000000';

test('PostgreSQL recupera pedidos sintéticos en panel real antes/después, sin Realtime, offline y multitab', async ({ browser }) => {
  const validation = validateBusinessIntakeStagingSmokeEnvironment(process.env);
  expect(validation.ok, validation.errors.join(' ')).toBe(true);
  expect(validation.projectRef).toBe(EXPECTED_STAGING_REF);

  const customer = stagingClient();
  const staff = stagingClient();
  const createdOrders = [];
  const pages = [];
  let testFailure = null;
  let cleanupFailure = null;
  const evidence = {
    projectRef: EXPECTED_STAGING_REF,
    businessId,
    runId,
    startedAt: new Date().toISOString(),
    realtimeFaultInjected: true,
    orders: [],
    checks: [],
    cleanup: [],
  };

  try {
    await authenticateActors({ customer, staff });
    const business = await loadBusiness(customer);
    const product = await loadProductWithStock(staff, 3);
    const initialStock = Number(product.stock);

    const context = await browser.newContext();
    await installBusinessRuntime(context);
    pages.push(await context.newPage());
    await signInBusinessPanel(pages[0]);
    evidence.checks.push('panel-open-before-order');
    await assertOutOfOrderRevisionGuard(pages[0]);
    evidence.checks.push('out-of-order-revision-discarded');

    const first = await createSyntheticOrder(customer, product, 1);
    createdOrders.push(first);
    evidence.orders.push(publicEvidenceOrder(first));
    await assertCompleteCard(pages[0], first, product);
    await expectSyntheticCardCount(pages[0], first, 1);
    evidence.checks.push('created-while-panel-open');

    const second = await createSyntheticOrder(customer, product, 2);
    createdOrders.push(second);
    evidence.orders.push(publicEvidenceOrder(second));
    pages.push(await context.newPage());
    await openAuthenticatedBusinessPanel(pages[1]);
    await assertCompleteCard(pages[1], second, product);
    await expectSyntheticCardCount(pages[1], first, 1);
    evidence.checks.push('created-before-panel-open');

    pages.push(await context.newPage());
    await openAuthenticatedBusinessPanel(pages[2]);
    for (const page of pages) {
      await expectSyntheticCardCount(page, first, 1);
      await expectSyntheticCardCount(page, second, 1);
    }
    evidence.checks.push('three-tabs-converged');
    await Promise.all(pages.map((page) => page.evaluate(() => {
      window.dispatchEvent(new Event('pageshow'));
      window.dispatchEvent(new Event('pageshow'));
    })));
    for (const page of pages) {
      await expectSyntheticCardCount(page, first, 1);
      await expectSyntheticCardCount(page, second, 1);
    }
    evidence.checks.push('repeated-snapshots-deduplicated');

    await context.setOffline(true);
    await Promise.all(pages.map((page) => page.evaluate(() => window.dispatchEvent(new Event('offline')))));
    await Promise.all(pages.map((page) => (
      expect(page.locator('[data-business-intake-status] strong')).toHaveText('Sin conexión')
    )));

    const third = await createSyntheticOrder(customer, product, 3);
    createdOrders.push(third);
    evidence.orders.push(publicEvidenceOrder(third));
    for (const page of pages) {
      await expectSyntheticCardCount(page, first, 1);
      await expectSyntheticCardCount(page, second, 1);
      await expectSyntheticCardCount(page, third, 0);
    }

    await context.setOffline(false);
    await Promise.all(pages.map((page) => page.evaluate(() => window.dispatchEvent(new Event('online')))));
    for (const page of pages) {
      await assertConnectedAfterSnapshot(page);
      await expectSyntheticCardCount(page, third, 1);
    }
    await expect.poll(() => countRecordedAlerts(pages, third.publicCode)).toBe(1);
    evidence.checks.push('offline-retained-online-recovered');
    evidence.checks.push('one-alert-across-three-tabs');

    await assertDeterministicOrder(pages[0], [first, second, third]);
    evidence.checks.push('deterministic-order');

    await transitionThroughPanel(pages[0], first, ['accepted', 'preparing']);
    const authoritativePreparing = await fetchOrder(staff, first.id);
    expect(normalizeStatus(authoritativePreparing?.status)).toBe('preparing');
    expect(Number(authoritativePreparing?.revision)).toBeGreaterThan(first.revision);
    for (const page of pages.slice(1)) {
      await expectOrderNextStatus(page, first, 'ready');
      await expectOrderStatus(page, first, 'Preparando');
    }
    evidence.checks.push('submitted-accepted-preparing-no-regression');

    await pages[1].reload();
    await assertConnectedAfterSnapshot(pages[1]);
    for (const order of createdOrders) await expectSyntheticCardCount(pages[1], order, 1);
    evidence.checks.push('full-reload-recovers');

    await captureSanitizedEvidence(pages[1], first);

    const reservedProduct = await fetchProduct(staff, product.id);
    expect(Number(reservedProduct.stock)).toBe(initialStock - createdOrders.length);
    evidence.checks.push('single-stock-reservation-per-order');

    await cleanupSyntheticOrders(staff, createdOrders, evidence.cleanup);
    await assertSyntheticOrdersGone(staff, createdOrders);
    const restoredProduct = await fetchProduct(staff, product.id);
    expect(Number(restoredProduct.stock)).toBe(initialStock);
    evidence.checks.push('postgres-cleanup-and-stock-restored');

    for (const page of pages) {
      if (page.isClosed()) continue;
      await page.evaluate(() => window.dispatchEvent(new Event('pageshow')));
      for (const order of createdOrders) await expectSyntheticCardCount(page, order, 0);
    }
    evidence.checks.push('terminal-orders-removed-from-active-inbox');

    await context.close();
  } catch (error) {
    testFailure = error;
  } finally {
    try {
      await cleanupSyntheticOrders(staff, createdOrders, evidence.cleanup);
    } catch (error) {
      cleanupFailure = error;
    }
    evidence.outcome = testFailure || cleanupFailure ? 'failed' : 'passed';
    evidence.finishedAt = new Date().toISOString();
    writeSanitizedEvidence(evidence);
    await Promise.allSettled([
      customer.auth.signOut({ scope: 'local' }),
      staff.auth.signOut({ scope: 'local' }),
    ]);
  }

  if (testFailure && cleanupFailure) {
    throw new AggregateError([testFailure, cleanupFailure], 'Falló el smoke y también su limpieza acotada.');
  }
  if (cleanupFailure) throw cleanupFailure;
  if (testFailure) throw testFailure;
});

function stagingClient() {
  return createClient(url, publishableKey, {
    auth: {
      autoRefreshToken: false,
      detectSessionInUrl: false,
      persistSession: false,
    },
  });
}

async function authenticateActors({ customer, staff }) {
  const customerResult = await customer.auth.signInAnonymously({
    options: { data: { taba_actor: 'business_intake_staging_smoke' } },
  });
  expect(customerResult.error?.message || '').toBe('');
  expect(customerResult.data?.session?.user?.is_anonymous).toBe(true);

  const staffResult = await staff.auth.signInWithPassword({
    email: staffEmail,
    password: staffPassword,
  });
  expect(staffResult.error?.message || '').toBe('');
  const staffId = staffResult.data?.user?.id;
  expect(staffId).toBeTruthy();

  const membership = await staff
    .from('business_members')
    .select('business_id,user_id,role,is_active')
    .eq('business_id', businessId)
    .eq('user_id', staffId)
    .eq('is_active', true)
    .maybeSingle();
  expect(membership.error?.message || '').toBe('');
  expect(['owner', 'admin', 'staff']).toContain(membership.data?.role);
}

async function loadBusiness(customer) {
  const result = await customer
    .from('businesses')
    .select('id,is_active,status,ordering_enabled,ordering_verified,pickup_enabled')
    .eq('id', businessId)
    .maybeSingle();
  expect(result.error?.message || '').toBe('');
  expect(result.data).toMatchObject({
    id: businessId,
    is_active: true,
    ordering_enabled: true,
    ordering_verified: true,
    pickup_enabled: true,
  });
  return result.data;
}

async function loadProductWithStock(staff, minimumStock) {
  const result = await staff
    .from('products')
    .select('id,name,price,stock,available,is_active,is_verified')
    .eq('business_id', businessId)
    .eq('is_active', true)
    .eq('is_verified', true)
    .eq('available', true)
    .gte('stock', minimumStock)
    .order('id', { ascending: true })
    .limit(1)
    .maybeSingle();
  expect(result.error?.message || '').toBe('');
  expect(result.data?.id, `No hay producto verificado con stock >= ${minimumStock}.`).toBeTruthy();
  return result.data;
}

async function createSyntheticOrder(customer, product, index) {
  const trackingToken = randomBytes(32).toString('base64url');
  const customerName = `TABA intake smoke ${runId.slice(-8)}-${index}`;
  const result = await customer.rpc('create_order_with_items', {
    payload: {
      business_id: businessId,
      client_request_id: `${runId}-${index}`,
      tracking_token: trackingToken,
      items: [{ product_id: product.id, quantity: 1 }],
      customer_name: customerName,
      customer_phone: customerPhone,
      delivery_mode: 'pickup',
      payment_method: 'cash',
    },
  });
  expect(result.error?.message || '').toBe('');
  const row = orderFrom(result.data);
  expect(row?.id).toBeTruthy();
  expect(row?.public_code || row?.code).toBeTruthy();
  expect(Number(row?.revision)).toBeGreaterThan(0);
  return {
    id: row.id,
    publicCode: row.public_code || row.code,
    customerName,
    revision: Number(row.revision),
  };
}

async function installBusinessRuntime(context) {
  await context.routeWebSocket(`wss://${EXPECTED_STAGING_REF}.supabase.co/**`, (socket) => {
    socket.close({ code: 1011, reason: 'Realtime fault injected by authorized staging smoke' });
  });
  await context.addInitScript(({ projectUrl, key, selectedBusinessId }) => {
    globalThis.__LA_TABA_RUNTIME_CONFIG__ = {
      mode: 'production',
      repository: {
        provider: 'supabase',
        deploymentEnvironment: 'staging',
        supabaseUrl: projectUrl,
        publishableKey: key,
        businessId: selectedBusinessId,
        pollMs: 1000,
      },
    };

    globalThis.__tabaIntakeSmokeAlerts = [];
    addEventListener('DOMContentLoaded', () => {
      const toast = document.querySelector('[data-toast]');
      if (!toast) return;
      let visibleText = '';
      const record = () => {
        const text = String(toast.textContent || '').trim();
        const visible = !toast.classList.contains('hidden');
        if (visible && text.startsWith('Nuevo pedido ') && text !== visibleText) {
          globalThis.__tabaIntakeSmokeAlerts.push(text);
          visibleText = text;
        }
        if (!visible) visibleText = '';
      };
      new MutationObserver(record).observe(toast, {
        attributes: true,
        childList: true,
        characterData: true,
        subtree: true,
      });
    }, { once: true });
  }, { projectUrl: url, key: publishableKey, selectedBusinessId: businessId });
}

async function signInBusinessPanel(page) {
  await page.goto('/#business');
  const form = page.locator('[data-production-auth-form="business"]');
  await expect(form).toBeVisible();
  await form.locator('[name="email"]').fill(staffEmail);
  await form.locator('[name="password"]').fill(staffPassword);
  await form.locator('[type="submit"]').click();
  await assertConnectedAfterSnapshot(page);
}

async function openAuthenticatedBusinessPanel(page) {
  await page.goto('/#business');
  await assertConnectedAfterSnapshot(page);
}

async function assertConnectedAfterSnapshot(page) {
  const status = page.locator('[data-business-intake-status]');
  await expect(status).toBeVisible();
  await expect(status.locator('strong')).toHaveText('Conectado');
  await expect(status).toContainText('Última sincronización:');
}

async function assertCompleteCard(page, order, product) {
  const card = syntheticCard(page, order);
  await expect(card).toHaveCount(1);
  await expect(card).toContainText(order.customerName);
  await expect(card).toContainText(customerPhone);
  await expect(card).toContainText(product.name);
  await expect(card).toContainText('Retiro');
  await expect(card.locator('.production-order-items li')).toHaveCount(1);
}

async function assertOutOfOrderRevisionGuard(page) {
  const result = await page.evaluate(async () => {
    const { reconcileBusinessOrderSnapshot } = await import('/js/core/business-order-intake.js');
    const revisionWatermarks = new Map();
    const inactiveOrderIds = new Set();
    const makeOrder = (revision, workflowStatus) => ({
      id: 'staging-revision-guard',
      backendId: '77777777-7777-4777-8777-777777777777',
      revision,
      workflowStatus,
      createdAt: '2026-08-02T12:00:00.000Z',
    });
    let current = reconcileBusinessOrderSnapshot([], [makeOrder(5, 'preparing')], {
      revisionWatermarks,
      inactiveOrderIds,
    }).orders;
    current = reconcileBusinessOrderSnapshot(current, [makeOrder(4, 'accepted')], {
      revisionWatermarks,
      inactiveOrderIds,
    }).orders;
    return {
      count: current.length,
      revision: current[0]?.revision,
      workflowStatus: current[0]?.workflowStatus,
    };
  });
  expect(result).toEqual({ count: 1, revision: 5, workflowStatus: 'preparing' });
}

async function expectSyntheticCardCount(page, order, count) {
  await expect(syntheticCard(page, order)).toHaveCount(count);
}

function syntheticCard(page, order) {
  return page.locator('.production-order-card').filter({ hasText: order.publicCode });
}

async function countRecordedAlerts(pages, publicCode) {
  const counts = await Promise.all(pages.filter((page) => !page.isClosed()).map((page) => (
    page.evaluate((code) => globalThis.__tabaIntakeSmokeAlerts
      .filter((message) => message.includes(code)).length, publicCode)
  )));
  return counts.reduce((sum, count) => sum + count, 0);
}

async function assertDeterministicOrder(page, orders) {
  const visibleCodes = await page.locator('.production-order-card .production-order-code').allTextContents();
  const indices = orders.map((order) => visibleCodes.indexOf(order.publicCode));
  expect(indices.every((index) => index >= 0)).toBe(true);
  expect(indices).toEqual([...indices].sort((left, right) => left - right));
}

async function transitionThroughPanel(page, order, statuses) {
  const nextAfterTransition = {
    accepted: 'preparing',
    preparing: 'ready',
  };
  for (const status of statuses) {
    const card = syntheticCard(page, order);
    const action = card.locator('[data-production-business-next]');
    await expect(action).toHaveAttribute('data-next-status', status);
    await action.click();
    await expectOrderNextStatus(page, order, nextAfterTransition[status]);
    await expectOrderStatus(page, order, 'Preparando');
  }
}

async function expectOrderStatus(page, order, label) {
  await expect(syntheticCard(page, order).locator('.status-pill')).toHaveText(label);
}

async function expectOrderNextStatus(page, order, status) {
  await expect(syntheticCard(page, order).locator('[data-production-business-next]'))
    .toHaveAttribute('data-next-status', status);
}

async function cleanupSyntheticOrders(staff, createdOrders, cleanupEvidence) {
  const failures = [];
  for (const order of createdOrders) {
    try {
      if (cleanupEvidence.some((entry) => entry.id === order.id && entry.status === 'cancelled')) continue;
      const current = await fetchOrder(staff, order.id);
      if (!current) continue;
      const status = normalizeStatus(current.status);
      if (['cancelled', 'rejected', 'delivered'].includes(status)) {
        cleanupEvidence.push({ id: order.id, status });
        continue;
      }
      const result = await staff.rpc('transition_order', {
        p_order_id: order.id,
        p_expected_revision: Number(current.revision),
        p_new_status: 'cancelled',
      });
      if (result.error) {
        const retryCurrent = await fetchOrder(staff, order.id);
        if (!retryCurrent || ['cancelled', 'rejected', 'delivered'].includes(normalizeStatus(retryCurrent.status))) {
          cleanupEvidence.push({ id: order.id, status: normalizeStatus(retryCurrent?.status) || 'not-visible' });
          continue;
        }
        const retry = await staff.rpc('transition_order', {
          p_order_id: order.id,
          p_expected_revision: Number(retryCurrent.revision),
          p_new_status: 'cancelled',
        });
        if (retry.error) throw retry.error;
      }
      const cancelled = await fetchOrder(staff, order.id);
      if (normalizeStatus(cancelled?.status) !== 'cancelled') {
        throw new Error('El pedido sintético no terminó cancelado.');
      }
      cleanupEvidence.push({ id: order.id, status: 'cancelled' });
    } catch (_) {
      cleanupEvidence.push({ id: order.id, status: 'cleanup-failed' });
      failures.push(order.id);
    }
  }
  if (failures.length) {
    throw new Error(`No se pudieron cancelar ${failures.length} pedido(s) sintético(s): ${failures.join(', ')}.`);
  }
}

async function assertSyntheticOrdersGone(staff, orders) {
  const result = await staff
    .from('orders')
    .select('id,status,revision')
    .in('id', orders.map((order) => order.id));
  expect(result.error?.message || '').toBe('');
  expect(result.data).toHaveLength(orders.length);
  expect(result.data.every((order) => normalizeStatus(order.status) === 'cancelled')).toBe(true);
}

async function fetchOrder(staff, orderId) {
  const result = await staff
    .from('orders')
    .select('id,status,revision')
    .eq('id', orderId)
    .maybeSingle();
  if (result.error) throw result.error;
  return result.data;
}

async function fetchProduct(staff, productId) {
  const result = await staff
    .from('products')
    .select('id,stock')
    .eq('id', productId)
    .maybeSingle();
  expect(result.error?.message || '').toBe('');
  return result.data;
}

async function captureSanitizedEvidence(page, order) {
  if (!evidenceDirectory) return;
  mkdirSync(evidenceDirectory, { recursive: true });
  await page.locator('[data-business-intake-status]').screenshot({
    path: path.join(evidenceDirectory, 'staging-business-intake-status.png'),
  });
  await syntheticCard(page, order).screenshot({
    path: path.join(evidenceDirectory, 'staging-business-intake-synthetic-card.png'),
  });
}

function writeSanitizedEvidence(evidence) {
  if (!evidenceDirectory) return;
  mkdirSync(evidenceDirectory, { recursive: true });
  writeFileSync(
    path.join(evidenceDirectory, 'staging-business-intake-result.json'),
    `${JSON.stringify(evidence, null, 2)}\n`,
    'utf8',
  );
}

function publicEvidenceOrder(order) {
  return {
    id: order.id,
    publicCode: order.publicCode,
    customerLabel: order.customerName,
  };
}

function orderFrom(value) {
  if (Array.isArray(value)) return value[0] || null;
  if (value?.order && typeof value.order === 'object') return value.order;
  return value && typeof value === 'object' ? value : null;
}

function normalizeStatus(value) {
  const status = String(value || '').toLowerCase();
  if (status === 'received') return 'submitted';
  if (status === 'canceled') return 'cancelled';
  return status;
}
