// Publicar/ocultar un producto YA verificado desde Recepción de mercadería
// (set_commercial_product_publication, 20260819060000). Esto es la mitad
// cliente: qué botón se ofrece, a quién, y qué hace el clic. La autoridad de
// verdad vive en el servidor — probada aparte, contra Postgres real, en
// scripts/run-commercial-import-drill.mjs (sección 17-20).
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  configureBusinessOperations,
  handleBusinessOperationsAction,
  renderBusinessOperations,
  resetBusinessOperationsForTests,
} from '../js/business/business-operations-center.js';

async function settle() {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

function target(selector, dataset = {}, root = null) {
  const node = {
    dataset,
    closest(candidate) {
      if (candidate === selector) return node;
      if (candidate === '[data-business-ops-center]') return root || node;
      return null;
    },
  };
  return node;
}

const GTIN = '7790895000782';

function binding({
  stock = 24, available = false, isVerified = true, priceStatus = 'confirmed',
  price = 2290, isAlcoholic = false, imageUrl = null, sku = 'coca-cola-original-pet-500ml',
  catalogOrigin = 'commercial', imageMetadata = {}, isActive = true,
} = {}) {
  return {
    id: 'barcode-1', product_id: 'prod-1', gtin: GTIN, unit_factor: 1, is_active: true,
    products: {
      id: 'prod-1', sku, name: 'Coca-Cola Original', brand: 'Coca-Cola', presentation: '500 ml',
      stock, available, is_active: isActive, is_verified: isVerified, price, price_status: priceStatus,
      is_alcoholic: isAlcoholic, catalog_origin: catalogOrigin, image_url: imageUrl,
      image_sha256: imageMetadata.imageSha256 || null,
      image_thumbnail_url: imageMetadata.thumbnailUrl || null,
      image_thumbnail_sha256: imageMetadata.thumbnailSha256 || null,
      source_image_sha256: imageMetadata.sourceSha256 || null,
      catalog_asset_id: imageMetadata.assetId || null,
    },
  };
}

async function scan(scanRoot = { querySelector: () => ({ value: GTIN }) }) {
  await handleBusinessOperationsAction(target('[data-business-scan-test]', {}, scanRoot));
  await settle();
}

test('sin stock: no ofrece publicar', async () => {
  configureBusinessOperations({ role: 'owner', lookupBarcode: async () => ({ ok: true, data: binding({ stock: 0 }) }), onChange() {} });
  renderBusinessOperations('inventory-receive');
  await scan();
  const markup = renderBusinessOperations('inventory-receive');
  assert.match(markup, /Sin stock/);
  assert.doesNotMatch(markup, /Publicar en tienda/);
  resetBusinessOperationsForTests();
});

test('listo para publicar: owner ve el botón, staff no', async () => {
  configureBusinessOperations({ role: 'owner', lookupBarcode: async () => ({ ok: true, data: binding() }), onChange() {} });
  renderBusinessOperations('inventory-receive');
  await scan();
  const ownerMarkup = renderBusinessOperations('inventory-receive');
  assert.match(ownerMarkup, /Listo para publicar/);
  assert.match(ownerMarkup, /data-commercial-publish="true"/);
  assert.match(ownerMarkup, /imagen genérica de TABA/, 'sin foto: nota de fallback');
  resetBusinessOperationsForTests();

  configureBusinessOperations({ role: 'staff', lookupBarcode: async () => ({ ok: true, data: binding() }), onChange() {} });
  renderBusinessOperations('inventory-receive');
  await scan();
  const staffMarkup = renderBusinessOperations('inventory-receive');
  assert.match(staffMarkup, /Listo para publicar/, 'staff igual ve el estado');
  assert.doesNotMatch(staffMarkup, /data-commercial-publish/, 'pero nunca el botón: no tiene products.publish');
  resetBusinessOperationsForTests();
});

test('con foto propia no ofrece la nota de fallback', async () => {
  configureBusinessOperations({
    role: 'owner',
    lookupBarcode: async () => ({ ok: true, data: binding({
      imageUrl: 'assets/products/coca-cola-original-x.webp',
      imageMetadata: {
        imageSha256: 'master-sha', thumbnailUrl: 'assets/products/coca-cola-original-x-thumb.webp',
        thumbnailSha256: 'thumb-sha', sourceSha256: 'source-sha', assetId: 'asset-1',
      },
    }) }),
    onChange() {},
  });
  renderBusinessOperations('inventory-receive');
  await scan();
  const markup = renderBusinessOperations('inventory-receive');
  assert.match(markup, /Con foto propia/);
  assert.doesNotMatch(markup, /imagen genérica de TABA/);
  resetBusinessOperationsForTests();
});

test('publicado: ofrece ocultar, no publicar de nuevo', async () => {
  configureBusinessOperations({ role: 'owner', lookupBarcode: async () => ({ ok: true, data: binding({ available: true }) }), onChange() {} });
  renderBusinessOperations('inventory-receive');
  await scan();
  const markup = renderBusinessOperations('inventory-receive');
  assert.match(markup, /Publicado/);
  assert.match(markup, /data-commercial-publish="false"/);
  assert.doesNotMatch(markup, /data-commercial-publish="true"/);
  resetBusinessOperationsForTests();
});

test('no verificado o sin precio confirmado: no ofrece publicar, explica por qué', async () => {
  configureBusinessOperations({ role: 'owner', lookupBarcode: async () => ({ ok: true, data: binding({ isVerified: false }) }), onChange() {} });
  renderBusinessOperations('inventory-receive');
  await scan();
  const markup = renderBusinessOperations('inventory-receive');
  assert.match(markup, /Todavía no está listo/);
  assert.doesNotMatch(markup, /data-commercial-publish/);
  resetBusinessOperationsForTests();
});

test('publicar: llama al RPC con sku y publish=true, y refresca el estado', async () => {
  const calls = [];
  let refetch = 0;
  configureBusinessOperations({
    role: 'owner',
    lookupBarcode: async () => { refetch += 1; return { ok: true, data: refetch > 1 ? binding({ available: true }) : binding() }; },
    setCommercialPublication: async (input) => { calls.push(input); return { ok: true, data: [{ applied_sku: input.sku, applied_available: input.publish }] }; },
    onChange() {},
  });
  renderBusinessOperations('inventory-receive');
  await scan();
  const outcome = await handleBusinessOperationsAction(target('[data-commercial-publish]', { commercialPublish: 'true' }));
  assert.equal(outcome.ok, true);
  assert.deepEqual(calls, [{ sku: 'coca-cola-original-pet-500ml', publish: true }]);
  assert.match(renderBusinessOperations('inventory-receive'), /Publicado/, 're-consulta el producto tras publicar y refleja el nuevo estado sin re-escanear');
  resetBusinessOperationsForTests();
});

test('ocultar: llama al RPC con publish=false', async () => {
  const calls = [];
  configureBusinessOperations({
    role: 'owner',
    lookupBarcode: async () => ({ ok: true, data: binding({ available: true }) }),
    setCommercialPublication: async (input) => { calls.push(input); return { ok: true, data: [{ applied_sku: input.sku, applied_available: input.publish }] }; },
    onChange() {},
  });
  renderBusinessOperations('inventory-receive');
  await scan();
  const request = await handleBusinessOperationsAction(target('[data-commercial-publish]', { commercialPublish: 'false' }));
  assert.equal(request.ok, true);
  assert.match(renderBusinessOperations('inventory-receive'), /¿Ocultar Coca-Cola Original de la tienda\?/);
  await handleBusinessOperationsAction(target('[data-commercial-publish-confirm]', {}));
  assert.deepEqual(calls, [{ sku: 'coca-cola-original-pet-500ml', publish: false }]);
  resetBusinessOperationsForTests();
});

test('alcohol bloqueado: el Panel no ofrece publicar y traduce el rechazo a copy humano', async () => {
  configureBusinessOperations({
    role: 'owner',
    lookupBarcode: async () => ({ ok: true, data: binding({ isAlcoholic: true }) }),
    setCommercialPublication: async () => ({ ok: false, message: 'Refusing to publish sku x: alcohol sales are not enabled for this business (license gate).' }),
    onChange() {},
  });
  renderBusinessOperations('inventory-receive');
  await scan();
  assert.match(renderBusinessOperations('inventory-receive'), /No se puede publicar hasta habilitar la venta de alcohol/);
  assert.doesNotMatch(renderBusinessOperations('inventory-receive'), /data-commercial-publish="true"/);
  resetBusinessOperationsForTests();

  configureBusinessOperations({
    role: 'owner',
    lookupBarcode: async () => ({ ok: true, data: binding() }),
    setCommercialPublication: async () => ({ ok: false, message: 'Refusing to publish sku x: alcohol sales are not enabled for this business (license gate).' }),
    onChange() {},
  });
  renderBusinessOperations('inventory-receive');
  await scan();
  const outcome = await handleBusinessOperationsAction(target('[data-commercial-publish]', { commercialPublish: 'true' }));
  assert.equal(outcome.ok, false);
  assert.match(outcome.message, /No se puede publicar hasta habilitar la venta de alcohol/);
  resetBusinessOperationsForTests();
});

test('imagen parcial, origen no comercial y stock cero bloquean publicación localmente', async () => {
  for (const options of [
    { imageMetadata: { imageSha256: 'only-one-field' } },
    { catalogOrigin: 'legacy' },
    { stock: 0 },
  ]) {
    configureBusinessOperations({ role: 'owner', lookupBarcode: async () => ({ ok: true, data: binding(options) }), onChange() {} });
    renderBusinessOperations('inventory-receive');
    await scan();
    const markup = renderBusinessOperations('inventory-receive');
    assert.doesNotMatch(markup, /data-commercial-publish="true"/);
    resetBusinessOperationsForTests();
  }
});

test('recepción exitosa relee stock y deja disponible la decisión humana de publicar', async () => {
  let stock = 0;
  let movements = 0;
  configureBusinessOperations({
    role: 'owner',
    lookupBarcode: async () => ({ ok: true, data: binding({ stock, available: false }) }),
    applyInventoryMovement: async () => { movements += 1; stock = 10; return { ok: true, data: { resulting_stock: 10 } }; },
    onChange() {},
  });
  renderBusinessOperations('inventory-receive');
  await scan();
  const root = { querySelector(name) {
    if (name === '[name="packageQuantity"]') return { value: '10' };
    if (name === '[name="reason"]') return { value: 'Recepción física' };
    if (name === '[name="direction"]') return { value: '1' };
    return null;
  } };
  const outcome = await handleBusinessOperationsAction(target('[data-inventory-confirm]', { inventoryConfirm: 'purchase_receipt' }, root));
  assert.equal(outcome.ok, true);
  assert.equal(movements, 1);
  assert.match(renderBusinessOperations('inventory-receive'), /Listo para publicar/);
  assert.match(renderBusinessOperations('inventory-receive'), /Publicar en tienda/);
  resetBusinessOperationsForTests();
});

test('staff: el click también rechaza aunque alguien fuerce el data-attribute a mano', async () => {
  const calls = [];
  configureBusinessOperations({
    role: 'staff',
    lookupBarcode: async () => ({ ok: true, data: binding() }),
    setCommercialPublication: async (input) => { calls.push(input); return { ok: true, data: [] }; },
    onChange() {},
  });
  renderBusinessOperations('inventory-receive');
  await scan();
  const outcome = await handleBusinessOperationsAction(target('[data-commercial-publish]', { commercialPublish: 'true' }));
  assert.equal(outcome.ok, false);
  assert.equal(calls.length, 0, 'el guard de capacidad corta ANTES de llamar al repositorio — el servidor ni se entera');
  resetBusinessOperationsForTests();
});
