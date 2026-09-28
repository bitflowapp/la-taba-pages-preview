// Opening readiness of the REAL La Taba business on CONTROLLED_PRODUCTION:
// what is still missing before a human-controlled canary, and where each item
// is fixed. Read-only by default (secret key, no writes, prints no secrets).
//
//   node scripts/controlled-production/opening-readiness.mjs [--min-products 5] [--out report.json]
//
// The platform verification (ordering_verified + ordering_enabled) is the last
// gate and a human decision: after a person confirmed identity, currency,
// fulfilment, fees, conditions and contact (docs/implementation/
// taba-production-operations.md), it is recorded with
//
//   ... --verify-ordering --verifier-email <platform operator> --confirm la-taba-cp
//
// which refuses while any blocking item is pending and never opens the store:
// opening stays the owner's button in the Panel.
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createClient } from '@supabase/supabase-js';
import { loadTargetKeys } from './target-keys.mjs';
import { REAL_BUSINESS } from './qa-window.mjs';

const OPTIONS = { auth: { persistSession: false, autoRefreshToken: false } };
const WHERE = {
  hours: 'Panel → Horarios y cobertura → Horarios',
  zones: 'Panel → Horarios y cobertura → Zona de entrega / Envío y mínimo',
  fulfilment: 'Panel → Horarios y cobertura (delivery y/o retiro)',
  photos: 'Panel → Catálogo → Imagen del producto (derecho PROPIO)',
  sheet: 'catalog/opening/planilla-apertura-cp.csv → scripts/import-commercial-catalog.mjs --catalogo cp',
  riders: 'La persona se registra en la app Rider y pide acceso; Panel → Equipo → Solicitudes de acceso',
  alcohol: 'Decisión comercial y legal: edad mínima, franja y habilitación',
  platform: 'Operador de plataforma: opening-readiness.mjs --verify-ordering',
  open: 'Panel → abrir el local (botón del dueño)',
};

/** Pure evaluation, so the rules are testable without a database. */
export function evaluateOpeningReadiness({ business, hours = [], zones = [], products = [], members = [], mercadopago = {} }, { minProducts = 5 } = {}) {
  const items = [];
  const add = (id, status, detail, where, blocking = true) => items.push({ id, status, detail, where: where || null, blocking });

  add('BUSINESS_ACTIVE', business.is_active ? 'PASS' : 'PENDING', business.is_active ? 'activo' : 'el negocio está inactivo', null);
  add('OPERATING_TIMEZONE', business.operating_timezone ? 'PASS' : 'PENDING', business.operating_timezone || 'sin huso horario', WHERE.hours);

  const channels = [business.delivery_enabled && 'delivery', business.pickup_enabled && 'pickup'].filter(Boolean);
  add('FULFILMENT_MODE', channels.length ? 'PASS' : 'PENDING', channels.length ? channels.join(' + ') : 'delivery y retiro apagados', WHERE.fulfilment);

  if (!business.hours_enforced) {
    add('SERVICE_HOURS', 'WARN', 'el horario no se exige: la tienda aceptaría pedidos a cualquier hora', WHERE.hours, false);
  } else {
    const missing = (channels.length ? channels : ['delivery', 'pickup']).filter((channel) => !hours.some((h) => h.channel === channel));
    add('SERVICE_HOURS', missing.length ? 'PENDING' : 'PASS',
      missing.length ? `sin franjas para ${missing.join(' y ')} (el servidor rechaza todo pedido fuera de franja)` : `${hours.length} franjas`, WHERE.hours);
  }

  if (business.delivery_enabled) {
    const usable = zones.filter((z) => z.is_active && z.delivery_fee !== null && z.delivery_fee !== undefined);
    add('DELIVERY_ZONES', usable.length ? 'PASS' : 'PENDING',
      usable.length ? `${usable.length} zona(s) activa(s) con costo` : 'sin zona activa con costo de envío', WHERE.zones);
    const minimumSet = usable.some((z) => z.minimum_subtotal !== null && z.minimum_subtotal !== undefined)
      || (business.minimum_delivery_subtotal !== null && business.minimum_delivery_subtotal !== undefined);
    add('DELIVERY_MINIMUM', minimumSet ? 'PASS' : 'PENDING', minimumSet ? 'mínimo definido' : 'sin mínimo de delivery', WHERE.zones);
    const riders = members.filter((m) => m.role === 'rider' && m.is_active);
    add('RIDERS', riders.length ? 'PASS' : 'PENDING', `${riders.length} rider(s) miembro(s)`, WHERE.riders);
  }

  const owners = members.filter((m) => m.role === 'owner' && m.is_active);
  add('OWNER', owners.length ? 'PASS' : 'PENDING', `${owners.length} dueño(s) activo(s)`, null);

  const alcoholOpen = Boolean(business.alcohol_sales_enabled && business.alcohol_minimum_age
    && business.alcohol_sales_start && business.alcohol_sales_end && business.alcohol_timezone);
  const sellable = (p) => !p.is_alcoholic || alcoholOpen;
  const photo = (p) => Boolean(p.catalog_asset_id && p.image_url);
  const price = (p) => p.price_status === 'confirmed' && Number(p.price) > 0;
  const stock = (p) => p.stock !== null && p.stock !== undefined && Number(p.stock) > 0;
  const candidates = products.filter((p) => p.is_active !== false && sellable(p));
  const ready = candidates.filter((p) => photo(p) && price(p) && stock(p));
  const published = products.filter((p) => p.available);
  const counts = {
    products: products.length, sellableWithoutAlcohol: products.filter((p) => !p.is_alcoholic).length,
    withPhoto: candidates.filter(photo).length, withPrice: candidates.filter(price).length,
    withStock: candidates.filter(stock).length, readyToPublish: ready.length, published: published.length,
  };
  add('PRODUCT_PHOTOS', counts.withPhoto >= minProducts ? 'PASS' : 'PENDING',
    `${counts.withPhoto}/${candidates.length} vendibles con foto aprobada (mínimo ${minProducts})`, WHERE.photos);
  add('PRODUCT_PRICES', counts.withPrice >= minProducts ? 'PASS' : 'PENDING',
    `${counts.withPrice}/${candidates.length} con precio confirmado`, WHERE.sheet);
  add('PRODUCT_STOCK', counts.withStock >= minProducts ? 'PASS' : 'PENDING',
    `${counts.withStock}/${candidates.length} con stock contado > 0`, WHERE.sheet);
  add('PRODUCTS_PUBLISHED', published.length >= minProducts ? 'PASS' : 'PENDING',
    `${published.length} publicados; ${ready.length} listos para publicar (publicar = «si» en la planilla)`, WHERE.sheet);

  const alcoholProducts = products.filter((p) => p.is_alcoholic).length;
  add('ALCOHOL_POLICY', alcoholOpen ? 'PASS' : 'INFO',
    alcoholOpen ? `habilitado desde ${business.alcohol_minimum_age} años` : `cerrado: ${alcoholProducts} SKU con alcohol no se venden`, WHERE.alcohol, false);
  add('MERCADOPAGO', mercadopago.connection === 'connected' ? 'PASS' : 'INFO',
    mercadopago.connection === 'connected' ? 'vendedor conectado' : 'sin vendedor conectado: sólo pago manual', 'Walter conecta su cuenta desde el Panel', false);

  const blockingPending = items.filter((i) => i.blocking && i.status !== 'PASS').map((i) => i.id);
  add('PLATFORM_VERIFICATION', business.ordering_verified && business.ordering_enabled ? 'PASS' : 'PENDING',
    business.ordering_verified && business.ordering_enabled ? 'verificado y habilitado' : 'pedidos online sin verificar/habilitar', WHERE.platform);
  add('STORE_OPEN', business.status === 'open' ? 'PASS' : 'INFO', `estado ${business.status}`, WHERE.open, false);

  const pending = items.filter((i) => i.blocking && i.status !== 'PASS').map((i) => i.id);
  return { items, counts, blockingPendingBeforeVerification: blockingPending, pending, readyForCanary: pending.length === 0 };
}

async function readState(admin, businessId) {
  const one = async (query) => { const { data, error } = await query; if (error) throw Error(`READ:${error.code || error.message}`); return data; };
  const business = await one(admin.from('businesses').select('id,slug,status,is_active,operating_timezone,hours_enforced,delivery_enabled,'
    + 'pickup_enabled,minimum_delivery_subtotal,ordering_enabled,ordering_verified,ordering_verified_at,alcohol_sales_enabled,'
    + 'alcohol_minimum_age,alcohol_sales_start,alcohol_sales_end,alcohol_timezone').eq('id', businessId).single());
  const hours = await one(admin.from('business_service_hours').select('channel,weekday').eq('business_id', businessId));
  const zones = await one(admin.from('delivery_zones').select('is_active,delivery_fee,minimum_subtotal').eq('business_id', businessId));
  const products = await one(admin.from('products').select('sku,is_active,is_alcoholic,available,price,price_status,stock,catalog_asset_id,image_url')
    .eq('business_id', businessId));
  const members = await one(admin.from('business_members').select('role,is_active').eq('business_id', businessId));
  const connections = await one(admin.from('mp_seller_connections').select('status').eq('business_id', businessId));
  return { business, hours, zones, products, members, mercadopago: { connection: connections.find((c) => c.status === 'connected')?.status || connections[0]?.status || 'none' } };
}

async function main(args) {
  const opt = (name, fallback = '') => { const i = args.indexOf(name); return i < 0 ? fallback : args[i + 1]; };
  const keys = await loadTargetKeys('controlled-production');
  assert.equal(keys.ref, 'tkanbadcglszlcyfjvpv', 'WRONG_TARGET');
  const admin = createClient(keys.url, keys.secret, OPTIONS);
  const minProducts = Number(opt('--min-products', '5'));
  assert.ok(Number.isInteger(minProducts) && minProducts > 0, 'MIN_PRODUCTS_INVALID');
  const state = await readState(admin, REAL_BUSINESS);
  const result = evaluateOpeningReadiness(state, { minProducts });
  const report = { at: new Date().toISOString(), target: 'controlled-production', business: state.business.slug, minProducts, ...result };

  if (args.includes('--verify-ordering')) {
    assert.equal(opt('--confirm'), state.business.slug, 'CONFIRM_WITH_BUSINESS_SLUG');
    const email = opt('--verifier-email');
    assert.match(email, /^[^@\s]+@[^@\s]+$/, 'VERIFIER_EMAIL_REQUIRED');
    if (result.blockingPendingBeforeVerification.length) {
      console.log(JSON.stringify({ verifyOrdering: 'REFUSED', pending: result.blockingPendingBeforeVerification }));
      process.exitCode = 3;
      return;
    }
    const users = (await admin.auth.admin.listUsers({ page: 1, perPage: 1000 })).data?.users || [];
    const verifier = users.find((u) => u.email?.toLowerCase() === email.toLowerCase());
    assert.ok(verifier, 'VERIFIER_NOT_FOUND');
    const { data, error } = await admin.from('businesses').update({ ordering_verified: true, ordering_enabled: true,
      ordering_verified_at: new Date().toISOString(), ordering_verified_by: verifier.id })
      .eq('id', REAL_BUSINESS).eq('ordering_verified', false).select('ordering_verified,ordering_enabled,status').single();
    if (error) throw Error(`VERIFY_FAILED:${error.code || error.message}`);
    report.verifyOrdering = { applied: true, status: data.status, note: 'the store stays closed until the owner opens it' };
  }

  const out = opt('--out');
  if (out) { mkdirSync(path.dirname(out), { recursive: true }); writeFileSync(out, `${JSON.stringify(report, null, 2)}\n`); }
  for (const item of report.items) {
    console.log(`${item.status.padEnd(7)} ${item.id.padEnd(22)} ${item.detail}${item.status !== 'PASS' && item.where ? `  → ${item.where}` : ''}`);
  }
  console.log(`\nREADY_FOR_CANARY: ${report.readyForCanary ? 'YES' : 'NO'}${report.pending.length ? ` (pendiente: ${report.pending.join(', ')})` : ''}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  await main(process.argv.slice(2));
}
