// FASE pricing — el precio lo pone el servidor.
//
// El cliente manda `product_id` + `quantity` y nada más. Cualquier clave de plata
// (en el ítem o en el pedido) se RECHAZA; no se ignora. Y lo que se acepta vale lo
// que dicen `products.price` y la zona en ese instante.
import { randomUUID } from 'node:crypto';
import { sqlUuid } from '../env.mjs';
import { brief, refusal, refused } from '../http.mjs';
import { ensureThrowawayBusiness } from '../tenant.mjs';

const P = 'pricing';

export default {
  id: P,
  title: 'precios del lado del servidor: claves de plata rechazadas, cantidades inválidas, productos no vendibles',
  requires: [],
  async run(ctx) {
    const C = ctx.rec.check;
    const id = ctx.tenant.id;
    const customer = await ctx.identities.customer('pricing');
    const main = ctx.orders.product('MAIN');
    const hide = ctx.orders.product('HIDE');
    const foreign = await ensureThrowawayBusiness(ctx);
    const before = await ctx.orders.footprint();
    const results = [];

    const refuse = async (name, mutate, code, mode = 'pickup') => {
      const body = mutate(ctx.orders.payload({ customer, role: 'MAIN', quantity: mode === 'delivery' ? 2 : 1, mode, label: 'pricing-neg' }));
      const { r } = await ctx.orders.create(customer, { payload: body, label: `pricing-neg:${name}`, quiet: true });
      results.push({ name, ...brief(r) });
      return C(P, name, refused(r, code), brief(r), refusal(code));
    };
    const answerOf = (name) => results.find((entry) => entry.name === name);
    const item = (extra) => (p) => ({ ...p, items: [{ product_id: main.id, quantity: 1, ...extra }] });
    const quantity = (value) => (p) => ({ ...p, items: [{ product_id: main.id, quantity: value }] });

    // Claves de plata en el ÍTEM.
    await refuse('ITEM_PRICE_1_REJECTED', item({ price: 1 }), '22023');
    await refuse('ITEM_PRICE_NEGATIVE_REJECTED', item({ price: -100 }), '22023');
    await refuse('ITEM_PRICE_NULL_REJECTED', item({ price: null }), '22023');
    await refuse('ITEM_UNIT_PRICE_REJECTED', item({ unit_price: 1 }), '22023');
    await refuse('ITEM_SUBTOTAL_REJECTED', item({ subtotal: 1 }), '22023');
    // Claves de plata en el PEDIDO.
    await refuse('PAYLOAD_DELIVERY_FEE_REJECTED', (p) => ({ ...p, delivery_fee: 0 }), '22023', 'delivery');
    await refuse('PAYLOAD_TOTAL_REJECTED', (p) => ({ ...p, total: 1 }), '22023', 'delivery');
    await refuse('PAYLOAD_SUBTOTAL_REJECTED', (p) => ({ ...p, subtotal: 1 }), '22023');
    await refuse('PAYLOAD_DISCOUNT_REJECTED', (p) => ({ ...p, discount: 100 }), '22023');
    await refuse('PAYLOAD_DISCOUNT_TOTAL_REJECTED', (p) => ({ ...p, discount_total: 100 }), '22023');
    // Cantidades.
    await refuse('QUANTITY_ZERO_REJECTED', quantity(0), '22023');
    await refuse('QUANTITY_NEGATIVE_REJECTED', quantity(-1), '22023');
    await refuse('QUANTITY_FRACTIONAL_REJECTED', quantity(1.5), '22023');
    await refuse('QUANTITY_NON_NUMERIC_REJECTED', quantity('abc'), '22023');
    await refuse('QUANTITY_1001_REJECTED', quantity(1001), '22023');
    await refuse('QUANTITY_JSON_NULL_REJECTED', quantity(null), '22023');
    // Productos que no se pueden pedir.
    await refuse('UNKNOWN_PRODUCT_REJECTED', (p) => ({ ...p, items: [{ product_id: randomUUID(), quantity: 1 }] }), '23503');
    await refuse('PRODUCT_OF_ANOTHER_BUSINESS_REJECTED', (p) => ({ ...p, items: [{ product_id: foreign.productId, quantity: 1 }] }), '23503');
    await refuse('PENDING_PRICE_PRODUCT_REJECTED', (p) => ({ ...p, items: [{ product_id: ctx.orders.product('PENDING_PRICE').id, quantity: 1 }] }), '55000');
    await refuse('HIDDEN_PRODUCT_REJECTED', (p) => ({ ...p, items: [{ product_id: ctx.orders.product('HIDDEN').id, quantity: 1 }] }), '55000');
    await refuse('VALID_ITEM_PLUS_UNSELLABLE_ITEM_REJECTED_AS_A_WHOLE', (p) => ({ ...p, items: [{ product_id: main.id, quantity: 1 },
      { product_id: ctx.orders.product('HIDDEN').id, quantity: 1 }] }), '55000');

    // ── Hallazgos ya registrados, clavados con lo que el backend contesta ────
    // No tapan nada: los checks de arriba siguen diciendo lo que debería pasar. Éstos dejan escrito, exacto, qué
    // pasa mientras el hallazgo está abierto, para que cualquier OTRA respuesta se note.
    //
    // PRICE-05 (corrida base de Staging): una cantidad JSON null no se rechazaba como validación (22023). Llegaba
    // al INSERT del pedido y volvía el 23502 crudo de `orders.subtotal`, con la fila que falló en `details`. Lo
    // corrige 20261002030000: donde esa migración está, el check de arriba pasa y no queda nada que clavar; donde
    // todavía no está, la respuesta tiene que ser exactamente la registrada.
    const nullQuantity = answerOf('QUANTITY_JSON_NULL_REJECTED');
    if (!(nullQuantity.http === 400 && nullQuantity.code === '22023')) {
      C(P, 'KNOWN_PRICE_05_JSON_NULL_QUANTITY_ANSWERS_A_RAW_23502', nullQuantity.http === 400 && nullQuantity.code === '23502'
        && /"subtotal" of relation "orders"/.test(String(nullQuantity.message)) && /^Failing row contains/.test(String(nullQuantity.details)),
      { http: nullQuantity.http, code: nullQuantity.code, message: nullQuantity.message, detailsStartWith: String(nullQuantity.details).slice(0, 20) },
      'HTTP 400 · 23502 con texto de la base en message y details (hallazgo PRICE-05; lo correcto es 22023)');
    }
    // API-01 (cerrado por 20261002090000): un rechazo de negocio levantado con SQLSTATE 55000 sale por la frontera de
    // la API como HTTP 409, con el mismo cuerpo (código y mensaje). Antes PostgREST contestaba 500 a toda la clase 55.
    const unsellable = answerOf('HIDDEN_PRODUCT_REJECTED');
    C(P, 'API_01_BUSINESS_REFUSAL_55000_ANSWERS_HTTP_409', unsellable.http === 409 && unsellable.code === '55000',
      { http: unsellable.http, code: unsellable.code, message: unsellable.message }, 'HTTP 409 · 55000 (API-01 cerrado por 20261002090000)');

    const after = await ctx.orders.footprint();
    const foreignStock = (await ctx.env.observe(`select stock from public.products where id = ${sqlUuid(foreign.productId)}`))[0]?.stock;
    C(P, 'REJECTED_ORDERS_CREATED_NOTHING', ctx.orders.sameFootprint(before, after) && foreignStock === foreign.stock,
      { before: { orders: before.orders, items: before.items, events: before.events }, after: { orders: after.orders, items: after.items, events: after.events },
        changed: ctx.orders.footprintDiff(before, after), otherBusinessStock: foreignStock });

    // Lo que SÍ se acepta vale lo que calcula el servidor.
    const server = (await ctx.env.observe(`select
      (select json_object_agg(p.id, p.price) from public.products p where p.business_id = ${sqlUuid(id)}) as prices,
      (select json_build_object('business_fee', b.delivery_fee, 'business_minimum', b.minimum_delivery_subtotal, 'currency', b.currency_code,
         'zone_fee', z.delivery_fee, 'zone_minimum', z.minimum_subtotal, 'zone_id', z.id)
         from public.businesses b left join public.delivery_zones z on z.business_id = b.id and z.name = 'Centro' and z.is_active where b.id = ${sqlUuid(id)}) as rules`))[0];
    const price = (productId) => Number(server.prices[productId]);
    const zoneFee = Number(server.rules.zone_fee ?? server.rules.business_fee);

    const delivery = await ctx.orders.create(customer, { mode: 'delivery', label: 'pricing-delivery',
      items: [{ product_id: main.id, quantity: 2 }, { product_id: hide.id, quantity: 1 }] });
    const expectedSubtotal = price(main.id) * 2 + price(hide.id);
    C(P, 'DELIVERY_ORDER_ACCEPTED', Boolean(delivery.order), brief(delivery.r));
    if (delivery.order) {
      const truth = await ctx.orders.truth(delivery.order.id);
      const o = truth.order_row;
      C(P, 'DELIVERY_TOTALS_EQUAL_SERVER_COMPUTATION', Number(o.subtotal) === expectedSubtotal && Number(o.delivery_fee) === zoneFee
        && Number(o.total) === expectedSubtotal + zoneFee && Number(o.discount_total) === 0 && o.currency_code === server.rules.currency && o.delivery_zone_id === server.rules.zone_id,
      { subtotal: o.subtotal, delivery_fee: o.delivery_fee, total: o.total, discount_total: o.discount_total, zone: o.delivery_zone_name },
      { subtotal: expectedSubtotal, delivery_fee: zoneFee, total: expectedSubtotal + zoneFee });
      C(P, 'DELIVERY_ITEMS_PRICED_FROM_PRODUCTS', (truth.items || []).length === 2 && truth.items.every((i) => Number(i.unit_price) === price(i.product_uuid)
        && Number(i.subtotal) === price(i.product_uuid) * Number(i.quantity)), (truth.items || []).map((i) => ({ name: i.name, quantity: i.quantity, unit_price: i.unit_price, subtotal: i.subtotal })));
      C(P, 'RESPONSE_TOTALS_EQUAL_DATABASE', Number(delivery.order.total) === Number(o.total) && Number(delivery.order.subtotal) === Number(o.subtotal)
        && Number(delivery.order.delivery_fee) === Number(o.delivery_fee), { response: { subtotal: delivery.order.subtotal, fee: delivery.order.delivery_fee, total: delivery.order.total } });
    }
    const pickup = await ctx.orders.create(customer, { mode: 'pickup', role: 'MAIN', quantity: 1, label: 'pricing-pickup' });
    C(P, 'PICKUP_ORDER_ACCEPTED', Boolean(pickup.order), brief(pickup.r));
    if (pickup.order) {
      const o = (await ctx.orders.truth(pickup.order.id)).order_row;
      C(P, 'PICKUP_TOTAL_HAS_NO_DELIVERY_FEE', Number(o.subtotal) === price(main.id) && Number(o.delivery_fee) === 0 && Number(o.total) === price(main.id),
        { subtotal: o.subtotal, delivery_fee: o.delivery_fee, total: o.total }, { subtotal: price(main.id), delivery_fee: 0, total: price(main.id) });
    }
    const repeated = await ctx.orders.create(customer, { mode: 'pickup', label: 'pricing-repeated-lines',
      items: [{ product_id: main.id, quantity: 1 }, { product_id: main.id, quantity: 2 }] });
    C(P, 'REPEATED_PRODUCT_LINES_ACCEPTED', Boolean(repeated.order), brief(repeated.r));
    if (repeated.order) {
      const truth = await ctx.orders.truth(repeated.order.id);
      C(P, 'REPEATED_PRODUCT_LINES_ARE_SUMMED_ONCE', (truth.items || []).length === 1 && Number(truth.items[0].quantity) === 3
        && Number(truth.order_row.subtotal) === price(main.id) * 3, { items: (truth.items || []).map((i) => `${i.quantity} x ${i.unit_price}`), subtotal: truth.order_row.subtotal });
    }
    const final = await ctx.orders.footprint();
    const accepted = [delivery, pickup, repeated].filter((x) => x.order).length;
    const mainSku = ctx.tenant.products.MAIN.sku;
    const hideSku = ctx.tenant.products.HIDE.sku;
    C(P, 'STOCK_MOVED_ONLY_BY_ACCEPTED_ORDERS', final.orders === before.orders + accepted
      && final.stock[mainSku] === before.stock[mainSku] - (delivery.order ? 2 : 0) - (pickup.order ? 1 : 0) - (repeated.order ? 3 : 0)
      && final.stock[hideSku] === before.stock[hideSku] - (delivery.order ? 1 : 0),
    { orders: [before.orders, final.orders], main: [before.stock[mainSku], final.stock[mainSku]], hide: [before.stock[hideSku], final.stock[hideSku]] });

    // La otra cara de PRICE-05 (20261002030000): un renglón con la cantidad en null, al lado de uno válido del
    // MISMO producto, se descartaba en la suma y el pedido entraba por la cantidad del otro. Un renglón mal armado
    // no se ignora en silencio: se rechaza el pedido entero. Va al final, fuera de las cuentas de arriba: donde la
    // migración todavía no está, este intento crea un pedido (lo cierra la limpieza de la fase).
    const mixed = await ctx.orders.create(customer, { label: 'pricing-neg:null-next-to-valid', quiet: true, payload: { ...ctx.orders.payload({ customer, role: 'MAIN',
      quantity: 1, mode: 'pickup', label: 'pricing-neg' }), items: [{ product_id: main.id, quantity: 1 }, { product_id: main.id, quantity: null }] } });
    results.push({ name: 'NULL_QUANTITY_LINE_NEXT_TO_A_VALID_LINE_REJECTED_AS_A_WHOLE', ...brief(mixed.r) });
    C(P, 'NULL_QUANTITY_LINE_NEXT_TO_A_VALID_LINE_REJECTED_AS_A_WHOLE', refused(mixed.r, '22023') && !mixed.order,
      { ...brief(mixed.r), publicCode: mixed.order?.public_code || null }, refusal('22023'));
    ctx.evidence.write('phase-pricing.json', { rejected: results, serverRules: server.rules, otherBusinessProduct: 'producto de un negocio descartable creado por esta corrida (cerrado e inactivo)',
      accepted: [delivery, pickup, repeated].filter((x) => x.order).map((x) => ({ publicCode: x.order.public_code, subtotal: x.order.subtotal, delivery_fee: x.order.delivery_fee, total: x.order.total })) });
  },
};
