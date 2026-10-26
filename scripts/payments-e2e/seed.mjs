// Datos del banco: comercios, dueños, compradores y productos FICTICIOS. Todo vive en la base descartable del banco.
import { randomUUID } from 'node:crypto';

const quote = (value) => (value === null || value === undefined ? 'null' : `'${String(value).replaceAll("'", "''")}'`);

export function fixtureIds() {
  const id = () => randomUUID();
  return {
    businesses: { A: id(), B: id(), C: id() },
    owners: { A: id(), B: id(), C: id() },
    customers: { one: id(), two: id(), three: id() },
    products: { agua: id(), gaseosa: id(), papas: id(), ultima: id(), alfajor: id() },
  };
}

/** Productos ficticios con precios con centavos, para que cualquier redondeo se note. */
export const CATALOG = Object.freeze({
  A: [
    { key: 'agua', name: 'Agua mineral sin gas', presentation: 'Botella 1,5 l', category: 'Aguas', subcategory: 'Sin gas', price: '1250.00', stock: 40 },
    { key: 'gaseosa', name: 'Gaseosa cola', presentation: 'Botella 2,25 l', category: 'Gaseosas', subcategory: 'Cola', price: '2890.50', stock: 25 },
    { key: 'papas', name: 'Papas fritas clásicas', presentation: 'Paquete 150 g', category: 'Snacks', subcategory: 'Papas', price: '1990.40', stock: 30 },
    { key: 'ultima', name: 'Edición limitada', presentation: 'Lata 473 ml', category: 'Gaseosas', subcategory: 'Lima limón', price: '1500.00', stock: 1 },
  ],
  B: [
    { key: 'alfajor', name: 'Alfajor de chocolate', presentation: 'Unidad 70 g', category: 'Golosinas', subcategory: 'Alfajores', price: '980.00', stock: 12 },
  ],
});

export const DELIVERY_FEE = '1100.00';

export function seedSql(ids) {
  const statements = [];
  const users = [
    ...Object.entries(ids.owners).map(([key, id]) => [id, `owner-${key.toLowerCase()}@bench.invalid`]),
    ...Object.entries(ids.customers).map(([key, id]) => [id, `cliente-${key}@bench.invalid`]),
  ];
  for (const [id, email] of users) {
    statements.push(`insert into auth.users (id, aud, role, email, encrypted_password, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
      values (${quote(id)}, 'authenticated', 'authenticated', ${quote(email)}, '', '{"provider":"email"}'::jsonb, '{}'::jsonb, clock_timestamp(), clock_timestamp());`);
  }
  const names = { A: 'Almacén Banco A', B: 'Kiosco Banco B', C: 'Comercio Banco C' };
  for (const key of ['A', 'B', 'C']) {
    const business = ids.businesses[key];
    statements.push(`insert into public.businesses (id, name, slug, status, is_active, ordering_enabled, ordering_verified,
        ordering_verified_at, ordering_verified_by, currency_code, pickup_enabled, delivery_enabled, delivery_fee, minimum_delivery_subtotal)
      values (${quote(business)}, ${quote(names[key])}, ${quote(`banco-${key.toLowerCase()}-${business.slice(0, 8)}`)}, 'open', true, true, true,
        clock_timestamp(), ${quote(ids.owners[key])}, 'ARS', true, true, ${DELIVERY_FEE}, 0);`);
    statements.push(`insert into public.business_members (business_id, user_id, role, is_active) values (${quote(business)}, ${quote(ids.owners[key])}, 'owner', true);`);
  }
  for (const key of ['A', 'B']) {
    const business = ids.businesses[key];
    for (const product of CATALOG[key]) {
      const sku = `bench-${key.toLowerCase()}-${product.key}`;
      statements.push(`do $$
        declare
          v_identity text := public.catalog_image_identity_sha256(${quote(sku)}, ${quote(sku)}, repeat('d', 64));
          v_master text := public.catalog_asset_path(${quote(sku)}, public.catalog_image_identity_sha256(${quote(sku)}, ${quote(sku)}, repeat('d', 64)), 'master', repeat('b', 64));
          v_thumb text := public.catalog_asset_path(${quote(sku)}, public.catalog_image_identity_sha256(${quote(sku)}, ${quote(sku)}, repeat('d', 64)), 'thumbnail', repeat('c', 64));
          v_asset uuid := gen_random_uuid();
        begin
          insert into public.catalog_assets (id, business_id, external_id, sku, safe_sku, identity_sha256, master_path, master_sha256,
            master_binding_sha256, thumbnail_path, thumbnail_sha256, thumbnail_binding_sha256, source_sha256, source_url,
            rights_status, rights_reference, approved_at, approved_by, catalog_origin)
          values (v_asset, ${quote(business)}, ${quote(sku)}, ${quote(sku)}, ${quote(sku)}, v_identity, v_master, repeat('b', 64),
            public.catalog_asset_binding_sha256(v_identity, 'master', repeat('d', 64), repeat('b', 64), 1000, 1000, v_master),
            v_thumb, repeat('c', 64),
            public.catalog_asset_binding_sha256(v_identity, 'thumbnail', repeat('d', 64), repeat('c', 64), 400, 400, v_thumb),
            repeat('d', 64), 'https://example.invalid/bench.webp', 'UNAPPROVED_QA', 'banco de cobros local', null, null, 'test_only');
          insert into public.products (id, business_id, name, description, category, price, image_url, is_active, brand, subcategory,
            presentation, capacity, packaging_type, stock, available, is_alcoholic, is_verified, chilled, units_per_pack, external_id, sku,
            catalog_asset_id, image_sha256, image_thumbnail_url, image_thumbnail_sha256, source_image_sha256, variant, capacity_value,
            capacity_unit, catalog_origin, price_status)
          values (${quote(ids.products[product.key])}, ${quote(business)}, ${quote(product.name)}, 'Producto ficticio del banco de cobros',
            ${quote(product.category)}, ${product.price}, v_master, true, 'Banco', ${quote(product.subcategory)}, ${quote(product.presentation)},
            '1 unidad', 'unidad', ${product.stock}, true, false, true, false, 1, ${quote(sku)}, ${quote(sku)}, v_asset, repeat('b', 64), v_thumb,
            repeat('c', 64), repeat('d', 64), ${quote(product.presentation)}, 1, 'unidad', 'test_only', 'confirmed');
        end $$;`);
    }
  }
  return statements.join('\n');
}

export function checkoutPayload(businessId, items, { requestId = `bench${randomUUID().replaceAll('-', '')}`, delivery = false, extra = {} } = {}) {
  return {
    business_id: businessId,
    client_request_id: requestId,
    items,
    fulfillment_type: delivery ? 'delivery' : 'pickup',
    contact: { name: 'Cliente Banco', phone: '5492994000000' },
    address: delivery ? {
      street: 'Avenida Argentina', street_number: '1234', city: 'Neuquén', province: 'Neuquén', postal_code: '8300',
      neighborhood: 'Centro', latitude: -38.95161, longitude: -68.0591, geolocation_accuracy: 12,
      location_source: 'map_pin', location_confirmed_at: new Date().toISOString(), source: 'manual',
    } : {},
    age_confirmed: false,
    payment_method: 'mercadopago',
    ...extra,
  };
}
