import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect } from '@playwright/test';
import { skipInstallInvitation } from './helpers.mjs';

export const snapshot = JSON.parse(fs.readFileSync(new URL('../fixtures/catalog-cp-46.json', import.meta.url)));
export const GRID = '[data-view="catalog"] [data-product-grid]';
const BACKEND = 'https://taba-runtime-e2e.supabase.co';
const BUSINESS_ID = '00000000-0000-4000-8000-000000000001';
const USER = { id: '10000000-0000-4000-8000-000000000001', is_anonymous: true, aud: 'authenticated' };
const TOKEN = ['eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9',
  Buffer.from(JSON.stringify({ sub: USER.id, role: 'authenticated', exp: Math.floor(Date.now()/1000)+3600 })).toString('base64url'),
  'test-signature'].join('.');

// Only this in-memory backend is sellable. CP rows and commercial values stay untouched.
//
// Optional, all additive (the defaults are the fixture every existing spec uses):
//   mapRow        (row, index) => row    reshape a product before it is served
//   availability  object | () => object  answer for the `commerce_availability` RPC
//   beforeGoto    (page) => Promise      register extra routes; they win over this fixture's
//   view          'catalog' | 'home'     where the store opens
//   waitForCatalog false                 do not wait for the 46 cards (boot-failure cases)
export async function openRuntimeCatalog(page, {
  realtime = true, mapRow = null, availability = null, beforeGoto = null, view = 'catalog', waitForCatalog = true,
} = {}) {
  if (process.env.TABA_RUNTIME_BEFORE_UI) await page.route('**/js/ui.js', (route) => route.fulfill({
    contentType: 'application/javascript', path: process.env.TABA_RUNTIME_BEFORE_UI,
  }));
  const rows = structuredClone(snapshot.products).map((p) => ({ ...p,
    business_id: BUSINESS_ID, price: 2500, price_status: 'confirmed', stock: 10,
    available: true, is_active: true, is_verified: true,
  })).map((row, index) => (mapRow ? mapRow(row, index) : row));
  const counters = { products: 0, images: 0, joined: 0, reads: [] };
  const sockets = [];
  await skipInstallInvitation(page);
  if (!realtime) {
    // Fail the SDK channel contract while keeping the real PostgREST client.
    // Closing every reconnecting browser WebSocket also tests the transport's
    // reconnect backoff; this case isolates the five-second UI fallback.
    await page.route('**/__catalog-original-supabase.js', (route) => route.fulfill({
      path: fileURLToPath(new URL('../../js/vendor/supabase.js', import.meta.url)),
      contentType: 'application/javascript',
    }));
    await page.route('**/js/vendor/supabase.js', (route) => route.fulfill({ contentType: 'application/javascript', body: `
      import { createClient as actualCreateClient } from '/__catalog-original-supabase.js';
      export * from '/__catalog-original-supabase.js';
      export function createClient(...args) {
        const client = actualCreateClient(...args);
        client.channel = () => {
          const channel = { on() { return channel; }, subscribe(callback) {
            queueMicrotask(() => callback('CHANNEL_ERROR')); return channel;
          }, unsubscribe() { return Promise.resolve('ok'); } };
          return channel;
        };
        client.removeChannel = () => Promise.resolve('ok');
        return client;
      }
    ` }));
  }
  await page.routeWebSocket('wss://taba-runtime-e2e.supabase.co/**', (socket) => {
    if (!realtime) { socket.close({ code: 1011, reason: 'Controlled Realtime outage' }); return; }
    socket.onMessage((message) => {
      const parsed = JSON.parse(String(message));
      const arrayProtocol = Array.isArray(parsed);
      const m = arrayProtocol ? { join_ref: parsed[0], ref: parsed[1], topic: parsed[2], event: parsed[3], payload: parsed[4] } : parsed;
      const send = (event, payload) => socket.send(JSON.stringify(arrayProtocol
        ? [m.join_ref, m.ref, m.topic, event, payload]
        : { topic: m.topic, event, ref: m.ref, payload }));
      if (m.event === 'phx_join') {
        const changes = m.payload?.config?.postgres_changes || [];
        const bindings = changes.map((c, i) => ({ ...c, id: i + 1 }));
        sockets.push({ socket, topic: m.topic, bindings, arrayProtocol, joinRef: m.join_ref });
        counters.joined++;
        send('phx_reply', { status: 'ok', response: { postgres_changes: bindings } });
      } else if (m.event === 'heartbeat') {
        send('phx_reply', { status: 'ok', response: {} });
      }
    });
  });
  await page.route(`${BACKEND}/**`, async (route) => {
    const url = new URL(route.request().url());
    const json = (body) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
    if (url.pathname.includes('/storage/')) {
      counters.images++;
      const realRoot = process.env.TABA_CATALOG_REAL_IMAGES;
      if (realRoot) return route.fulfill({ path: path.join(realRoot, path.basename(url.pathname)), contentType: 'image/webp' });
      return route.fulfill({ contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="400" height="400"><rect width="400" height="400" fill="white"/><circle cx="200" cy="200" r="70" fill="#942025"/></svg>' });
    }
    if (url.pathname.endsWith('/products')) { counters.products++; counters.reads.push(Date.now()); return json(rows); }
    if (url.pathname.endsWith('/businesses')) return json({ id: BUSINESS_ID, name: 'La Taba',
      address: 'Mendoza 827, Neuquén', currency_code: 'ARS', ordering_enabled: true,
      ordering_verified: true, delivery_enabled: true, pickup_enabled: true,
      delivery_fee: 0, minimum_delivery_subtotal: 0, is_active: true, status: 'open' });
    if (url.pathname.endsWith('/get_public_business_contact')) return json([{ whatsapp_number: '', whatsapp_verified: false }]);
    if (url.pathname.endsWith('/get_mercadopago_checkout_availability')) return json({ available: false });
    if (availability && url.pathname.endsWith('/commerce_availability')) {
      counters.availability = (counters.availability || 0) + 1;
      return json(typeof availability === 'function' ? availability() : availability);
    }
    if (url.pathname.endsWith('/auth/v1/user')) return json(USER);
    if (url.pathname.includes('/auth/')) return json({ access_token: TOKEN, refresh_token: 'test-refresh', token_type: 'bearer', expires_in: 3600,
      expires_at: Math.floor(Date.now()/1000)+3600, user: USER });
    return json([]);
  });
  await page.addInitScript(({ backend, businessId }) => {
    globalThis.__LA_TABA_RUNTIME_CONFIG__ = { mode: 'production', repository: {
      provider: 'supabase', supabaseUrl: backend, publishableKey: 'sb_publishable_test_key', businessId, pollMs: 5000,
    } };
  }, { backend: BACKEND, businessId: BUSINESS_ID });
  if (beforeGoto) await beforeGoto(page);
  await page.goto(view === 'home' ? '/' : `/#${view}`);
  if (waitForCatalog && view === 'catalog') {
    await expect(page.locator(`${GRID} .product-card`)).toHaveCount(rows.length, { timeout: 20000 });
  }
  await expect(page.locator('html')).toHaveAttribute('data-taba-startup', 'ready', { timeout: 20000 });
  await page.evaluate(() => document.fonts.ready);
  await page.bringToFront();
  await page.waitForTimeout(600);
  return { rows, counters, emit() {
    for (const { socket, topic, bindings, arrayProtocol, joinRef } of sockets) {
      const binding = bindings.find((b) => b.table === 'products');
      if (!binding) continue;
      const payload = {
        ids: [binding.id], data: { schema: 'public', table: 'products', type: 'UPDATE',
          commit_timestamp: new Date().toISOString(), errors: null, columns: [], record: rows[0], old_record: {} },
      };
      if (binding) socket.send(JSON.stringify(arrayProtocol ? [joinRef, null, topic, 'postgres_changes', payload]
        : { topic, event: 'postgres_changes', payload }));
    }
  } };
}

export async function instrumentCatalog(page) {
  await page.evaluate((selector) => {
    const root = document.querySelector(selector);
    const cards = [...root.querySelectorAll('.product-card')];
    const refs = new Map(cards.map((node) => [node.querySelector('[data-product-detail]').dataset.productDetail,
      { node, img: node.querySelector('img'), src: node.querySelector('img').currentSrc }]));
    const categoryRefs = new Map([...document.querySelectorAll('[data-view="catalog"] [data-category-strip] [data-category-id]')]
      .map(node => [node.dataset.categoryId,node]));
    const optionRefs = new Map([...document.querySelectorAll('[data-catalog-filter] option')]
      .map(node => [node.parentElement.dataset.catalogFilter + ':' + node.value,node]));
    const metrics = { removedCards: 0, removedImages: 0, skeletons: 0, opacityResets: 0, cls: 0, frames: [] };
    const observer = new MutationObserver((records) => {
      for (const r of records) {
        for (const node of r.removedNodes) {
          if (node.nodeType !== 1) continue;
          metrics.removedCards += Number(node.matches('.product-card')) + node.querySelectorAll('.product-card').length;
          metrics.removedImages += Number(node.matches('img')) + node.querySelectorAll('img').length;
        }
        for (const node of r.addedNodes) if (node.nodeType === 1) {
          metrics.skeletons += Number(node.matches('.catalog-skeleton-card')) + node.querySelectorAll('.catalog-skeleton-card').length;
        }
        if (r.type === 'attributes' && r.attributeName === 'class' && r.oldValue?.includes('is-motion-visible')
          && !r.target.classList.contains('is-motion-visible')) metrics.opacityResets++;
      }
    });
    observer.observe(root, { childList: true, subtree: true, attributes: true, attributeOldValue: true, attributeFilter: ['class', 'style', 'src', 'srcset'] });
    try { new PerformanceObserver((list) => list.getEntries().forEach((e) => { if (!e.hadRecentInput) metrics.cls += e.value; }))
      .observe({ type: 'layout-shift', buffered: true }); } catch {}
    let last;
    function frame(now) { if (last && metrics.frames.length < 20000) metrics.frames.push(now - last); last = now; requestAnimationFrame(frame); }
    requestAnimationFrame(frame);
    window.__catalogRuntimeProbe = { refs, metrics, read() {
      const current = [...root.querySelectorAll('.product-card')];
      let cardReplacements = 0, imageReplacements = 0;
      for (const card of current) {
        const id = card.querySelector('[data-product-detail]').dataset.productDetail;
        const old = refs.get(id);
        if (old && old.node !== card) cardReplacements++;
        if (old && old.img !== card.querySelector('img')) imageReplacements++;
      }
      const categoryReplacements = [...document.querySelectorAll('[data-view="catalog"] [data-category-strip] [data-category-id]')]
        .filter(node => categoryRefs.has(node.dataset.categoryId) && categoryRefs.get(node.dataset.categoryId) !== node).length;
      const filterOptionReplacements = [...document.querySelectorAll('[data-catalog-filter] option')]
        .filter(node => {const key=node.parentElement.dataset.catalogFilter+':'+node.value;return optionRefs.has(key)&&optionRefs.get(key)!==node;}).length;
      const imagesWithChildText = [...document.querySelectorAll('img.thumb-img')].filter(node=>node.childNodes.length>0).length;
      return { ...metrics, cardReplacements, imageReplacements, categoryReplacements, filterOptionReplacements, imagesWithChildText, cards: current.length };
    } };
  }, GRID);
}

export async function scrollCatalog(page, cycles = 1) {
  await page.bringToFront();
  for (let i = 0; i < cycles; i++) {
    for (let step = 0; step <= 12; step++) {
      await page.evaluate((position) => scrollTo({ top: (document.documentElement.scrollHeight - innerHeight) * position, behavior: 'instant' }),
        step <= 6 ? step / 6 : (12 - step) / 6);
      // Driver-side wait: Windows can throttle timers/rAF in occluded tabs.
      // Each position still gets a paint opportunity and crosses the whole grid.
      await page.waitForTimeout(60);
    }
  }
}

export const readProbe = (page) => page.evaluate(() => window.__catalogRuntimeProbe.read());

export async function clickCatalogCategory(page, id) {
  const chip=page.locator(`[data-view="catalog"] [data-category-id="${id}"]`).first();
  // A mobile customer pans the horizontal strip before tapping a hidden chip.
  // Explicitly position it before the normal actionability-checked click.
  await chip.evaluate(node=>{
    const strip=node.closest('[data-category-strip]');
    strip.scrollTo({left:Math.max(0,node.offsetLeft-strip.offsetLeft-(strip.clientWidth-node.offsetWidth)/2),behavior:'instant'});
  });
  await expect(chip).toBeInViewport();
  await chip.click();
}
