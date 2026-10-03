// FASE catalog — la góndola pública del tenant, leída como la lee la tienda.
import { sqlUuid } from '../env.mjs';
import { brief, refusal, refused } from '../http.mjs';
import { storefrontCatalogQuery } from '../orders.mjs';
import { FIXTURES } from '../tenant.mjs';

const P = 'catalog';
const denied = (r) => !r.ok || (Array.isArray(r.rows) && r.rows.length === 0);

export default {
  id: P,
  title: 'catálogo público: sólo lo comprable, sin columnas privadas, sin escritura',
  requires: [],
  async run(ctx) {
    const C = ctx.rec.check;
    const id = ctx.tenant.id;
    const published = Object.values(FIXTURES).filter((f) => f.state === 'published');
    const customer = await ctx.identities.customer('catalog', { address: false });

    // 1. La consulta de la tienda, sin sesión.
    const shelf = await ctx.http.restGet(null, storefrontCatalogQuery(id));
    const rows = shelf.rows || [];
    C(P, 'STOREFRONT_CATALOG_QUERY_ANSWERS', shelf.status === 200 && rows.length > 0, { ...brief(shelf), rows: rows.length });
    C(P, 'STOREFRONT_SHOWS_EXACTLY_THE_PUBLISHED_PRODUCTS', JSON.stringify(rows.map((r) => r.sku).sort()) === JSON.stringify(published.map((f) => f.sku).sort()),
      rows.map((r) => r.sku), published.map((f) => f.sku));
    C(P, 'EVERY_VISIBLE_PRODUCT_IS_PURCHASABLE', rows.every((r) => r.available === true && r.price_status === 'confirmed' && Number(r.price) > 0
      && Number(r.stock) > 0 && r.is_active && r.is_verified), rows.map((r) => ({ sku: r.sku, available: r.available, price: r.price, price_status: r.price_status, stock: r.stock })));
    const db = await ctx.env.observe(`select sku, price, stock, available, price_status, is_verified, is_active, merchant_available, name
      from public.products where business_id = ${sqlUuid(id)} order by sort_order`);
    const purchasable = db.filter((p) => p.is_active && p.is_verified && p.available && p.stock > 0);
    C(P, 'STOREFRONT_EQUALS_DATABASE_TRUTH', purchasable.length === rows.length && purchasable.every((p) => {
      const seen = rows.find((r) => r.sku === p.sku);
      return seen && Number(seen.price) === Number(p.price) && Number(seen.stock) === Number(p.stock) && seen.name === p.name;
    }), { database: purchasable.map((p) => `${p.sku}:${p.price}:${p.stock}`), storefront: rows.map((r) => `${r.sku}:${r.price}:${r.stock}`) });
    C(P, 'DATABASE_HAS_NO_PURCHASABLE_PRODUCT_WITHOUT_CONFIRMED_PRICE', db.every((p) => !p.available || (p.price_status === 'confirmed' && Number(p.price) > 0 && p.merchant_available)),
      db.filter((p) => p.available).map((p) => `${p.sku}:${p.price_status}:${p.price}`));

    // 2. Lo que no está a la venta no se ve, ni preguntando por su id.
    const pendingId = ctx.tenant.products.PENDING_PRICE.id;
    const hiddenId = ctx.tenant.products.HIDDEN.id;
    for (const [name, actor] of [['ANON', null], ['CUSTOMER', customer]]) {
      const direct = await ctx.http.restGet(actor, `products?select=id,sku,price,available&id=in.(${pendingId},${hiddenId})`);
      C(P, `PENDING_PRICE_AND_HIDDEN_NOT_VISIBLE_TO_${name}`, direct.status === 200 && direct.rows?.length === 0, { ...brief(direct), rows: direct.rows?.map((r) => r.sku) });
    }

    // 3. Columnas privadas: ni anon ni un cliente con sesión.
    for (const [name, actor] of [['ANON', null], ['CUSTOMER', customer]]) {
      for (const column of ['unit_cost', 'verified_by']) {
        const r = await ctx.http.restGet(actor, `products?select=id,${column}&business_id=eq.${id}`);
        C(P, `${name}_CANNOT_READ_${column.toUpperCase()}`, refused(r, '42501', { actor }), { ...brief(r), rows: r.rows?.length ?? null }, refusal('42501', { actor }));
      }
      const star = await ctx.http.restGet(actor, `products?select=*&business_id=eq.${id}&limit=1`);
      // O se rechaza como «sin permiso» o contesta sin las columnas privadas; cualquier otro error no es «no filtra».
      C(P, `${name}_SELECT_STAR_DOES_NOT_LEAK_PRIVATE_COLUMNS`, refused(star, '42501', { actor }) || (star.ok && (star.rows || []).every((r) => !('unit_cost' in r) && !('verified_by' in r))),
        { ...brief(star), keys: star.rows?.[0] ? Object.keys(star.rows[0]).filter((k) => ['unit_cost', 'verified_by'].includes(k)) : [] });
    }
    const business = await ctx.http.restGet(null, `businesses?select=id,max_pending_orders_per_customer,order_rate_limit_per_10_minutes&id=eq.${id}`);
    C(P, 'ANON_CANNOT_READ_BUSINESS_OPERATIONAL_COLUMNS', refused(business, '42501', { actor: null }), brief(business), refusal('42501', { actor: null }));

    // 4. Nadie de afuera escribe el catálogo.
    const main = ctx.tenant.products.MAIN;
    const before = await ctx.orders.footprint();
    const count = async () => (await ctx.env.observe(`select count(*)::int as n, md5(string_agg(id::text || ':' || price::text || ':' || coalesce(stock::text, '') || ':' || name || ':' || available::text, ',' order by id)) as fp
      from public.products where business_id = ${sqlUuid(id)}`))[0];
    const fingerprint = await count();
    for (const [name, actor] of [['ANON', null], ['CUSTOMER', customer]]) {
      const attempts = {
        patch_price: await ctx.http.restWrite(actor, 'PATCH', `products?id=eq.${main.id}&select=id`, { price: 1 }, { businessId: id }),
        patch_stock: await ctx.http.restWrite(actor, 'PATCH', `products?id=eq.${main.id}&select=id`, { stock: 999999 }, { businessId: id }),
        patch_available: await ctx.http.restWrite(actor, 'PATCH', `products?id=eq.${pendingId}&select=id`, { available: true }, { businessId: id }),
        insert: await ctx.http.restWrite(actor, 'POST', 'products?select=id', { business_id: id, name: 'intruso', price: 1, sku: 'intruso-anon' }, { businessId: id }),
        delete: await ctx.http.restWrite(actor, 'DELETE', `products?id=eq.${main.id}&select=id`, undefined, { businessId: id }),
        rpc_publish: await ctx.http.call(actor, 'set_commercial_product_publication', { p_business_id: id, p_sku: FIXTURES.PENDING_PRICE.sku, p_publish: true }),
        rpc_batch: await ctx.http.call(actor, 'apply_commercial_catalog_batch', { p_business_id: id, p_rows: [{ sku: FIXTURES.MAIN.sku, price: '1' }] }),
        rpc_stock: await ctx.http.call(actor, 'apply_inventory_movement', { p_business_id: id, p_product_id: main.id, p_barcode_id: null, p_movement_type: 'manual_adjustment',
          p_package_quantity: 5, p_direction: 1, p_reference_type: 'intruso', p_reference_id: null, p_reason: 'intento sin permiso', p_idempotency_key: `ecomcert-intruso-${name.toLowerCase()}-1` }),
      };
      const answers = Object.fromEntries(Object.entries(attempts).map(([k, r]) => [k, { http: r.status, code: r.code, rows: r.rows?.length ?? null }]));
      C(P, `${name}_CANNOT_WRITE_PRODUCTS`, Object.values(attempts).every(denied), answers);
      // Que no se escriba nada es una cosa; CÓMO se contesta es otra: quien no tiene permiso recibe «sin permiso»
      // (42501: 401 sin sesión, 403 con sesión), no un error de validación ni un error del servidor. Vale desde
      // 20261001210000: antes `authenticated` tenía UPDATE directo sobre stock y disponibilidad, y esos dos
      // intentos volvían con 200 y cero filas (los frenaba la política de filas, no el permiso).
      if (ctx.caps.catalog_stock_authority) {
        C(P, `${name}_WRITE_ATTEMPTS_ARE_ANSWERED_AS_NOT_ALLOWED`, Object.values(attempts).every((r) => refused(r, '42501', { actor })),
          Object.fromEntries(Object.entries(attempts).filter(([, r]) => !refused(r, '42501', { actor })).map(([k, r]) => [k, brief(r)])), `${refusal('42501', { actor })} en los ocho intentos`);
      } else {
        ctx.rec.skipCheck(P, `${name}_WRITE_ATTEMPTS_ARE_ANSWERED_AS_NOT_ALLOWED`, 'catalog_stock_authority');
      }
    }
    const after = await count();
    C(P, 'CATALOG_UNCHANGED_AFTER_WRITE_ATTEMPTS', after.n === fingerprint.n && after.fp === fingerprint.fp && ctx.orders.sameFootprint(before, await ctx.orders.footprint()),
      { before: fingerprint, after });
    ctx.evidence.write('phase-catalog.json', { query: storefrontCatalogQuery('<tenant>'), storefrontRows: rows.map((r) => ({ sku: r.sku, name: r.name, price: r.price, stock: r.stock, available: r.available })), database: db });
  },
};
