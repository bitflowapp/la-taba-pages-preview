// FASE inventory — el stock es exacto bajo concurrencia.
//
//   · última unidad: dos clientes distintos la piden en el mismo instante, cinco veces;
//   · movimiento de stock del dueño mientras entran pedidos;
//   · el mismo pedido enviado tres veces descuenta una sola vez.
import { nowIso, shortId, sqlUuid } from '../env.mjs';
import { brief, refusal, refused } from '../http.mjs';
import { FIXTURES } from '../tenant.mjs';

const P = 'inventory';
const ROUNDS = 5;

export default {
  id: P,
  title: 'inventario: carrera por la última unidad, movimiento concurrente y reintentos',
  requires: [],
  async run(ctx) {
    const C = ctx.rec.check;
    const id = ctx.tenant.id;
    const { owner, admin, staff } = ctx.actors;
    const a = await ctx.identities.customer('inventory-a', { address: false });
    const b = await ctx.identities.customer('inventory-b', { address: false });
    const last = ctx.orders.product('LAST_UNIT');
    const main = ctx.orders.product('MAIN');
    const movement = (productId, quantity, direction, reference) => ctx.http.call(owner, 'apply_inventory_movement', { p_business_id: id, p_product_id: productId,
      p_barcode_id: null, p_movement_type: 'manual_adjustment', p_package_quantity: quantity, p_direction: direction, p_reference_type: reference,
      p_reference_id: null, p_reason: `${ctx.runId} QA ${reference}`, p_idempotency_key: `ecomcert-mov-${shortId(8)}` });

    // ── 1. Última unidad, cinco rondas ───────────────────────────────────────
    const rounds = [];
    for (let round = 1; round <= ROUNDS; round += 1) {
      const pre = (await ctx.orders.fixtures()).LAST_UNIT;
      const bodyA = ctx.orders.payload({ customer: a, role: 'LAST_UNIT', quantity: 1, mode: 'pickup', label: `last-unit-r${round}-a` });
      const bodyB = ctx.orders.payload({ customer: b, role: 'LAST_UNIT', quantity: 1, mode: 'pickup', label: `last-unit-r${round}-b` });
      const [ra, rb] = await Promise.all([ctx.orders.create(a, { payload: bodyA, label: 'last-unit', quiet: true }), ctx.orders.create(b, { payload: bodyB, label: 'last-unit', quiet: true })]);
      const dbOrders = await ctx.orders.byRequestIds([bodyA.client_request_id, bodyB.client_request_id]);
      const post = (await ctx.orders.fixtures()).LAST_UNIT;
      const winners = [ra, rb].filter((x) => x.order);
      const losers = [ra, rb].filter((x) => !x.order);
      const entry = { round, pre: { stock: pre.stock, available: pre.available }, winner: ra.order ? 'A' : rb.order ? 'B' : 'none', winners: winners.length,
        loser: losers[0] ? brief(losers[0].r) : null, latenciesMs: [ra.r.ms, rb.r.ms], ordersInDatabase: dbOrders.length, post: { stock: post.stock, available: post.available },
        cleanRefusal: losers.length === 1 && losers[0].r.status >= 400 && losers[0].r.status < 500 && ['23514', '55000'].includes(losers[0].r.code), restock: null };
      if (round < ROUNDS) {
        // Reposición por el camino real del dueño: movimiento de stock y republicación.
        const moved = await movement(last.id, 1, 1, 'reposicion ultima unidad');
        const republished = await ctx.http.call(owner, 'set_commercial_product_publication', { p_business_id: id, p_sku: FIXTURES.LAST_UNIT.sku, p_publish: true });
        entry.restock = { movement: brief(moved), previous: moved.data?.previous_stock, resulting: moved.data?.resulting_stock, republished: brief(republished) };
      }
      rounds.push(entry);
    }
    ctx.persist();
    C(P, 'LAST_UNIT_AVAILABLE_BEFORE_EVERY_ROUND', rounds.every((r) => r.pre.stock === 1 && r.pre.available === true), rounds.map((r) => r.pre));
    C(P, 'LAST_UNIT_RACE_EXACTLY_ONE_ORDER_EVERY_ROUND', rounds.every((r) => r.winners === 1 && r.ordersInDatabase === 1),
      rounds.map((r) => ({ round: r.round, winner: r.winner, winners: r.winners, db: r.ordersInDatabase })));
    C(P, 'LAST_UNIT_STOCK_NEVER_NEGATIVE', rounds.every((r) => r.post.stock === 0 && r.post.available === false), rounds.map((r) => r.post));
    // Este check es el que encontró API-01: quien pierde la carrera recibía «producto no disponible» (55000) con
    // HTTP 500. Desde 20261002090000 la frontera de la API contesta 409 con el mismo cuerpo (también fijado en la
    // fase pricing: API_01_BUSINESS_REFUSAL_55000_ANSWERS_HTTP_409).
    C(P, 'LAST_UNIT_LOSER_GETS_A_CLEAN_REFUSAL', rounds.every((r) => r.cleanRefusal), rounds.map((r) => r.loser), 'HTTP 4xx con 23514 (stock insuficiente) o 55000 (producto no disponible)');
    C(P, 'LAST_UNIT_RESTOCKED_THROUGH_OWNER_INVENTORY_MOVEMENT', rounds.slice(0, -1).every((r) => r.restock?.movement.ok && r.restock.previous === 0 && r.restock.resulting === 1 && r.restock.republished.ok),
      rounds.slice(0, -1).map((r) => r.restock));
    const negative = (await ctx.env.observe(`select count(*)::int as n from public.products where business_id = ${sqlUuid(id)} and stock < 0`))[0].n;
    C(P, 'NO_PRODUCT_WITH_NEGATIVE_STOCK', negative === 0, { negative });

    // ── 2. Lo que depende de migraciones todavía no desplegadas ───────────────
    if (ctx.caps.cancel_republish) {
      const lastOrder = (await ctx.orders.byRequestIds(ctx.ledger.orders.filter((o) => o.label === 'last-unit' && o.id).slice(-2).map((o) => o.clientRequestId)))[0];
      const cancelled = lastOrder ? await ctx.orders.cancel(admin, lastOrder.id, Number(lastOrder.revision), `${ctx.runId} QA devolver ultima unidad`) : { ok: false, code: 'no_order' };
      const afterCancel = (await ctx.orders.fixtures()).LAST_UNIT;
      C(P, 'CANCEL_RETURNS_AND_REPUBLISHES_THE_LAST_UNIT', cancelled.ok && afterCancel.stock === 1 && afterCancel.available === true, { cancel: brief(cancelled), product: afterCancel });
      const hideOrder = await ctx.orders.create(a, { mode: 'pickup', role: 'HIDE', quantity: 1, label: 'inventory-hide' });
      const hidden = await ctx.http.call(owner, 'set_commercial_product_publication', { p_business_id: id, p_sku: FIXTURES.HIDE.sku, p_publish: false });
      const cancelHidden = hideOrder.order ? await ctx.orders.cancel(admin, hideOrder.order.id, Number(hideOrder.order.revision), `${ctx.runId} QA cancelar con producto oculto`) : { ok: false };
      const hideRow = (await ctx.orders.fixtures()).HIDE;
      C(P, 'CANCEL_KEEPS_A_MERCHANT_HIDDEN_PRODUCT_HIDDEN', hidden.ok && cancelHidden.ok && hideRow.stock === FIXTURES.HIDE.stock && hideRow.available === false && hideRow.merchant_available === false,
        { hide: brief(hidden), cancel: brief(cancelHidden), product: hideRow });
      // El producto vuelve a la venta por el camino del dueño: el punto 5 lo necesita publicado. Este bloque no
      // corría antes de 20261001190000 (sin devolución con republicación no había qué probar), y al empezar a
      // correr dejaba el producto oculto y el punto 5 se salteaba sin decir nada.
      await ctx.http.call(owner, 'set_commercial_product_publication', { p_business_id: id, p_sku: FIXTURES.HIDE.sku, p_publish: true });
    } else {
      ctx.rec.skipCheck(P, 'CANCEL_RETURNS_AND_REPUBLISHES_THE_LAST_UNIT', 'cancel_republish');
      ctx.rec.skipCheck(P, 'CANCEL_KEEPS_A_MERCHANT_HIDDEN_PRODUCT_HIDDEN', 'cancel_republish');
    }
    if (!ctx.caps.order_expiry) ctx.rec.skipCheck(P, 'ABANDONED_ORDER_RELEASES_ITS_STOCK', 'order_expiry');

    // ── 3. Diez pedidos concurrentes + un movimiento de +7 del dueño ─────────
    const s0 = (await ctx.orders.fixtures()).MAIN.stock;
    const bodies = Array.from({ length: 10 }, (_, i) => ({ customer: i % 2 ? b : a, body: ctx.orders.payload({ customer: i % 2 ? b : a, role: 'MAIN', quantity: 1, mode: 'pickup', label: `concurrent-${i}` }) }));
    const [moved, ...created] = await Promise.all([movement(main.id, 7, 1, 'ingreso concurrente'),
      ...bodies.map(({ customer, body }) => ctx.orders.create(customer, { payload: body, label: 'concurrent', quiet: true }))]);
    ctx.persist();
    const accepted = created.filter((x) => x.order).length;
    const inDatabase = (await ctx.orders.byRequestIds(bodies.map((x) => x.body.client_request_id))).length;
    const s1 = (await ctx.orders.fixtures()).MAIN.stock;
    C(P, 'CONCURRENT_ORDERS_ALL_ACCEPTED', accepted === 10 && inDatabase === 10, { accepted, inDatabase, refused: created.filter((x) => !x.order).map((x) => brief(x.r)) });
    C(P, 'STOCK_EXACT_AFTER_CONCURRENT_ORDERS_AND_MOVEMENT', moved.ok && s1 === s0 - accepted + 7 && Number(moved.data?.resulting_stock) - Number(moved.data?.previous_stock) === 7,
      { initial: s0, accepted, movement: 7, final: s1, movementRow: { previous: moved.data?.previous_stock, resulting: moved.data?.resulting_stock } }, { final: s0 - accepted + 7 });

    // ── 4. El mismo pedido, tres veces ───────────────────────────────────────
    const s2 = s1;
    const body = ctx.orders.payload({ customer: a, role: 'MAIN', quantity: 1, mode: 'pickup', label: 'retry-x3' });
    const tries = [];
    for (let i = 0; i < 3; i += 1) tries.push(await ctx.orders.create(a, { payload: body, label: 'retry-x3', quiet: i > 0 }));
    const sameKey = await ctx.orders.byRequestIds([body.client_request_id]);
    const s3 = (await ctx.orders.fixtures()).MAIN.stock;
    C(P, 'SAME_REQUEST_SENT_THREE_TIMES_DECREMENTS_ONCE', tries.every((t) => t.order && t.order.id === tries[0].order?.id) && sameKey.length === 1 && s3 === s2 - 1,
      { responses: tries.map((t) => t.r.status), sameId: tries.every((t) => t.order?.id === tries[0].order?.id), ordersInDatabase: sameKey.length, stock: [s2, s3] });

    // ── 5. Pedir más que el stock ────────────────────────────────────────────
    const hideBefore = (await ctx.orders.fixtures()).HIDE;
    if (hideBefore.available) {
      const over = await ctx.orders.create(a, { mode: 'pickup', role: 'HIDE', quantity: hideBefore.stock + 1, label: 'over-stock', quiet: true });
      const hideAfter = (await ctx.orders.fixtures()).HIDE;
      C(P, 'ORDER_ABOVE_STOCK_REFUSED_AND_STOCK_UNCHANGED', refused(over.r, '23514') && hideAfter.stock === hideBefore.stock && hideAfter.available === true,
        { ...brief(over.r), stock: [hideBefore.stock, hideAfter.stock] }, refusal('23514'));
    } else {
      // Sin el producto a la venta el pedido se rechazaría por «no disponible», no por stock: el check no se saltea, falla.
      C(P, 'ORDER_ABOVE_STOCK_REFUSED_AND_STOCK_UNCHANGED', false, { setup: 'el producto HIDE no está a la venta', product: hideBefore }, refusal('23514'));
    }
    ctx.evidence.write('phase-inventory.json', { at: nowIso(), lastUnitRounds: rounds, concurrent: { initial: s0, accepted, final: s1, movement: { previous: moved.data?.previous_stock, resulting: moved.data?.resulting_stock },
      latenciesMs: created.map((x) => x.r.ms) }, retry: { statuses: tries.map((t) => t.r.status), stock: [s2, s3] } });
  },
};
