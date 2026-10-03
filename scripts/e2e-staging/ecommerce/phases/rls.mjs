// FASE rls — una muestra de la matriz de acceso, fila por fila.
//
// Diez actores con su sesión real (o sin sesión) contra nueve tablas, leyendo por la API
// de tablas, que es donde decide la política de filas:
//
//   actores   sin sesión · cliente · otro cliente · operador · encargado · dueño ·
//             repartidor asignado · otro repartidor · dueño de OTRO negocio ·
//             miembro dado de baja (con un token que todavía no venció)
//   tablas    products · orders · order_items · payment_intents · payment_refunds ·
//             inventory_movements · customer_addresses · order_public_tokens · pos_sales
//
// Cada celda tiene una de tres respuestas esperadas: VE exactamente ciertas filas, NO VE
// nada (200 con cero filas, o 403/401 · 42501 si ni siquiera tiene el privilegio), o —en
// las tablas de dinero, que el Panel lee por RPC— ve sólo lo de su negocio o no tiene el
// privilegio. Nunca filas de otro. Después, las escrituras directas: nadie de afuera
// escribe, y nadie de adentro reescribe plata ni el libro de stock.
//
// NUNCA se usa `service_role` para probar una negativa: cada celda es lo que recibe la
// sesión de ese actor. `pos_sales` se muestrea sólo en lectura: no se escribe una venta.
import { nowIso, shortId, sqlUuid } from '../env.mjs';
import { CODES, brief, hidden, refused } from '../http.mjs';
import { ensureSecondBusiness, joinTeam } from '../tenant.mjs';

const P = 'rls';
const TABLES = Object.freeze(['products', 'orders', 'order_items', 'payment_intents', 'payment_refunds', 'inventory_movements', 'customer_addresses', 'order_public_tokens', 'pos_sales']);
const checkName = (table) => `RLS_${table.toUpperCase()}_MATCHES_THE_ACCESS_MATRIX`;
const PAYMENT_TABLES = Object.freeze(['payment_intents', 'payment_refunds']);
const ACTOR_NAMES = Object.freeze(['anon', 'customer', 'other_customer', 'staff', 'admin', 'owner', 'rider', 'other_rider', 'foreign_owner', 'revoked_member']);
const sameSet = (a, b) => JSON.stringify([...new Set(a)].sort()) === JSON.stringify([...new Set(b)].sort());

export default {
  id: P,
  title: 'matriz de acceso por filas: diez actores contra nueve tablas, lectura y escritura directa',
  requires: [],
  async run(ctx) {
    const C = ctx.rec.check;
    const A = ctx.tenant.id;
    const { owner, admin, staff, rider1, rider2 } = ctx.actors;
    const published = ctx.tenant.products.MAIN.id;
    const hiddenProduct = ctx.tenant.products.HIDDEN.id;

    // ── Preparación: las filas sobre las que se pregunta ──────────────────────
    const customer = await ctx.identities.customer('rls-a');
    const otherCustomer = await ctx.identities.customer('rls-b', { address: false });
    const second = await ensureSecondBusiness(ctx, { withOrder: false });
    const first = await ctx.orders.create(customer, { mode: 'delivery', role: 'MAIN', quantity: 2, label: 'rls-assigned' });
    const pickup = await ctx.orders.create(otherCustomer, { mode: 'pickup', role: 'MAIN', quantity: 1, label: 'rls-pickup' });
    if (!first.order || !pickup.order) { C(P, 'SAMPLE_ROWS_READY', false, { delivery: brief(first.r), pickup: brief(pickup.r) }); return; }
    const O1 = first.order.id;
    const O2 = pickup.order.id;
    // El pedido con envío queda asignado al repartidor 1: es la única situación en la que un repartidor ve un pedido.
    const ready = await ctx.orders.advance(staff, O1, 'ready');
    await ctx.orders.riderAvailability(rider1, true);
    const offered = await ctx.orders.offer(staff, O1, rider1.userId);
    const accepted = await ctx.http.call(rider1, 'accept_rider_order_offer', { p_offer_id: offered.data?.offer_id, p_expected_version: Number(offered.data?.version),
      p_idempotency_key: `android-${shortId(32)}` });
    const assigned = (await ctx.orders.state(O1)).status === 'assigned';

    // Un miembro del equipo que tuvo acceso de verdad y al que el dueño dio de baja. Su token sigue sin vencer.
    const revoked = await ctx.identities.createRunUser('rls-revoked', 'team', { taba_actor: 'team', display_name: 'QA Cert Baja' });
    const joined = await joinTeam(ctx, revoked, owner, { access: 'panel', role: 'staff', fullName: 'QA Cert Miembro Dado De Baja' });
    await ctx.identities.registerSession(revoked, 'panel_web', 'rls-revoked');
    const beforeRevocation = await ctx.http.restGet(revoked, `orders?select=id&id=in.(${O1},${O2})`);
    const disabled = await ctx.http.call(owner, 'identity_set_member_active', { p_business_id: A, p_user_id: revoked.userId, p_is_active: false, p_reason: `${ctx.runId} QA baja` });
    ctx.ledger.tenantChanges.push({ kind: 'member_disabled', label: 'rls-revoked', at: nowIso() }); ctx.persist();
    revoked.expectRevoked = true;
    C(P, 'SAMPLE_ROWS_READY', ready.ok && assigned && accepted.data?.ok === true && Boolean(second.owner?.sessionId),
      { order: ready.steps, offer: offered.data?.code ?? offered.code, accept: accepted.data?.code ?? accepted.code, assigned, secondOwner: second.owner?.sessionRole ?? null });
    C(P, 'REVOKED_MEMBER_HAD_ACCESS_UNTIL_THE_OWNER_DISABLED_IT', joined === 'approved' && beforeRevocation.status === 200 && beforeRevocation.rows?.length === 2
      && disabled.status === 200 && disabled.data?.ok === true, { joined, rowsBefore: beforeRevocation.rows?.length ?? null, disable: disabled.data ?? brief(disabled) },
    'vio los dos pedidos como operador y el dueño lo dio de baja');

    // Una fila de dinero del tenant, si el camino de pagos está desplegado: un cobro y su pedido de reembolso.
    let payment = null;
    if (ctx.caps.checkout_payments) {
      try {
        await ctx.payments.ensureFixture();
        const [payer] = await ctx.identities.payers(1);
        const paid = await ctx.payments.paidOrder(payer, { role: 'MAIN', quantity: 1, label: 'rls-paid' });
        if (paid.ok) {
          payment = { intentId: paid.session.intentId, orderId: paid.session.orderId, refund: null };
          if (ctx.caps.payment_refunds) {
            const asked = await ctx.payments.requestRefund(owner, paid.session.intentId, { reason: `${ctx.runId} QA muestra de filas` });
            payment.refund = asked.r.data?.refund_id || null;
          }
        } else { payment = { error: `${paid.step}:${paid.r?.code ?? paid.r?.status}` }; }
      } catch (error) { payment = { error: String(error.message).slice(0, 160) }; }
    }

    const ACTORS = { anon: null, customer, other_customer: otherCustomer, staff, admin, owner, rider: rider1, other_rider: rider2, foreign_owner: second.owner, revoked_member: revoked };
    const everyone = (expectation, overrides = {}) => Object.fromEntries(ACTOR_NAMES.map((name) => [name, overrides[name] ?? expectation]));
    const team = (expectation) => ({ staff: expectation, admin: expectation, owner: expectation });
    // Qué se espera de cada celda: { sees: [...] } por la columna `by`; 'hidden'; { own: columna } = sólo filas del
    // propio negocio (al menos `min`), o sin privilegio; { nothingForeign: columna } = puede leer, y nada ajeno.
    const matrix = {
      products: { query: `products?select=id,sku&id=in.(${published},${hiddenProduct})`, by: 'id',
        cells: everyone({ sees: [published] }, team({ sees: [published, hiddenProduct] })) },
      orders: { query: `orders?select=id&id=in.(${O1},${O2})`, by: 'id',
        cells: everyone('hidden', { customer: { sees: [O1] }, other_customer: { sees: [O2] }, ...team({ sees: [O1, O2] }), rider: { sees: [O1] } }) },
      order_items: { query: `order_items?select=order_id&order_id=in.(${O1},${O2})`, by: 'order_id',
        cells: everyone('hidden', { customer: { sees: [O1] }, other_customer: { sees: [O2] }, ...team({ sees: [O1, O2] }), rider: { sees: [O1] } }) },
      payment_intents: { query: `payment_intents?select=id,business_id&business_id=eq.${A}`, by: 'id',
        cells: everyone('hidden', { admin: { own: 'business_id', min: 1 }, owner: { own: 'business_id', min: 1 } }) },
      payment_refunds: { query: `payment_refunds?select=id,payment_intent_id&payment_intent_id=eq.${payment?.intentId}`, by: 'id',
        cells: everyone('hidden', { admin: { ownIntent: true, min: 1 }, owner: { ownIntent: true, min: 1 } }) },
      inventory_movements: { query: `inventory_movements?select=id,business_id&business_id=eq.${A}&limit=3`, by: 'id',
        cells: everyone('hidden', team({ own: 'business_id', min: 1, granted: true })) },
      customer_addresses: { query: `customer_addresses?select=id,customer_id&customer_id=eq.${customer.userId}`, by: 'id',
        cells: everyone('hidden', { customer: { ownCustomer: true, min: 1 } }) },
      order_public_tokens: { query: `order_public_tokens?select=id,order_id&order_id=eq.${O1}`, by: 'id', cells: everyone('hidden') },
      pos_sales: { query: 'pos_sales?select=id,business_id&limit=5', by: 'id', cells: everyone('hidden', team({ nothingForeign: 'business_id' })) },
    };
    const judge = (r, actor, want, by) => {
      if (want === 'hidden') return hidden(r, actor);
      const rows = r.rows || [];
      if (want.sees) return r.status === 200 && sameSet(rows.map((row) => row[by]), want.sees);
      if (want.own) return (r.status === 200 && rows.length >= want.min && rows.every((row) => row[want.own] === A)) || (!want.granted && refused(r, CODES.FORBIDDEN, { actor }));
      if (want.ownIntent) return (r.status === 200 && rows.length >= want.min && rows.every((row) => row.payment_intent_id === payment?.intentId)) || refused(r, CODES.FORBIDDEN, { actor });
      if (want.ownCustomer) return r.status === 200 && rows.length >= want.min && rows.every((row) => row.customer_id === customer.userId);
      if (want.nothingForeign) return r.status === 200 && rows.every((row) => row[want.nothingForeign] === A);
      return false;
    };
    const cells = [];
    for (const table of TABLES) {
      if (PAYMENT_TABLES.includes(table) && !ctx.caps.checkout_payments) { ctx.rec.skipCheck(P, checkName(table), 'checkout_payments'); continue; }
      if (table === 'payment_refunds' && !ctx.caps.payment_refunds) { ctx.rec.skipCheck(P, checkName(table), 'payment_refunds'); continue; }
      if (PAYMENT_TABLES.includes(table) && (!payment?.intentId || (table === 'payment_refunds' && !payment.refund))) {
        // Sin una fila de dinero en el tenant la celda «no ve nada» no probaría nada: falla la preparación, no se saltea.
        C(P, checkName(table), false, { setup: payment?.error || 'no quedó un cobro (o su reembolso) sobre el que preguntar' });
        continue;
      }
      const spec = matrix[table];
      const wrong = [];
      for (const name of ACTOR_NAMES) {
        const r = await ctx.http.restGet(ACTORS[name], spec.query);
        const ok = judge(r, ACTORS[name], spec.cells[name], spec.by);
        const cell = { table, actor: name, expected: spec.cells[name], http: r.status, code: r.code ?? null, rows: r.rows?.length ?? null, ok };
        cells.push(cell);
        if (!ok) wrong.push({ actor: name, expected: spec.cells[name], http: r.status, code: r.code ?? null, rows: r.rows?.length ?? null });
      }
      C(P, checkName(table), wrong.length === 0, wrong.length ? wrong : { cells: ACTOR_NAMES.length }, `${ACTOR_NAMES.length} actores: cada uno ve lo que le toca y nada más`);
    }

    // ── Escrituras directas: nunca con service_role ───────────────────────────
    const fingerprint = async () => (await ctx.env.observe(`select
      (select md5(string_agg(o.id::text || o.status || o.revision::text || o.total::text || coalesce(o.assigned_rider_user_id::text, ''), ',' order by o.id)) from public.orders o where o.business_id = ${sqlUuid(A)}) as orders,
      (select count(*) from public.order_items i join public.orders o on o.id = i.order_id where o.business_id = ${sqlUuid(A)})::int as items,
      (select md5(string_agg(p.id::text || p.price::text || coalesce(p.stock::text, '') || p.sort_order::text, ',' order by p.id)) from public.products p where p.business_id = ${sqlUuid(A)}) as products,
      (select count(*) from public.inventory_movements where business_id = ${sqlUuid(A)})::int as movements,
      (select count(*) from public.payment_refunds f join public.payment_intents i on i.id = f.payment_intent_id where i.business_id = ${sqlUuid(A)})::int as refunds,
      (select count(*) from public.customer_addresses where customer_id = ${sqlUuid(customer.userId)})::int as addresses`))[0];
    const before = await fingerprint();
    const write = (actor, method, query, body) => ctx.http.restWrite(actor, method, query, body, { businessId: A });
    const denied = (r, actor) => hidden(r, actor);   // 200 con cero filas tocadas, o 42501
    const attempts = {
      anon: {
        insert_order: await write(null, 'POST', 'orders?select=id', { business_id: A, status: 'received', total: 1 }),
        patch_product: await write(null, 'PATCH', `products?id=eq.${published}&select=id`, { sort_order: 999 }),
        delete_items: await write(null, 'DELETE', `order_items?order_id=eq.${O1}&select=id`),
      },
      customer: {
        patch_own_order_status: await write(customer, 'PATCH', `orders?id=eq.${O1}&select=id`, { status: 'delivered' }),
        patch_own_order_total: await write(customer, 'PATCH', `orders?id=eq.${O1}&select=id`, { total: 1 }),
        delete_own_order: await write(customer, 'DELETE', `orders?id=eq.${O1}&select=id`),
        insert_item: await write(customer, 'POST', 'order_items?select=id', { order_id: O1, name: 'intruso', quantity: 1, unit_price: 0, subtotal: 0 }),
        patch_address_of_another: await write(otherCustomer, 'PATCH', `customer_addresses?customer_id=eq.${customer.userId}&select=id`, { street: 'Tomada' }),
      },
      staff: {
        patch_order_total: await write(staff, 'PATCH', `orders?id=eq.${O1}&select=id`, { total: 1 }),
        patch_order_status: await write(staff, 'PATCH', `orders?id=eq.${O1}&select=id`, { status: 'delivered' }),
        delete_ledger: await write(staff, 'DELETE', `inventory_movements?business_id=eq.${A}&select=id`),
        insert_ledger: await write(staff, 'POST', 'inventory_movements?select=id', { business_id: A, product_id: published, movement_type: 'manual_adjustment', quantity_delta: 50 }),
        // Ni el dueño reescribe un cobro o inventa un reembolso por la tabla: el dinero sólo se mueve por sus RPC.
        ...(payment?.intentId ? { patch_payment_as_owner: await write(owner, 'PATCH', `payment_intents?id=eq.${payment.intentId}&select=id`, { paid_amount: 1 }),
          insert_refund_as_owner: await write(owner, 'POST', 'payment_refunds?select=id', { payment_intent_id: payment.intentId, amount: 1 }) } : {}),
      },
      rider: {
        patch_assigned_order: await write(rider1, 'PATCH', `orders?id=eq.${O1}&select=id`, { status: 'delivered' }),
        patch_other_order: await write(rider2, 'PATCH', `orders?id=eq.${O2}&select=id`, { assigned_rider_user_id: rider2.userId }),
      },
      foreign_owner: {
        patch_product: await write(second.owner, 'PATCH', `products?id=eq.${published}&select=id`, { sort_order: 999 }),
        patch_order: await write(second.owner, 'PATCH', `orders?id=eq.${O2}&select=id`, { status: 'delivered' }),
        insert_product: await write(second.owner, 'POST', 'products?select=id', { business_id: A, name: 'intruso', price: 1, sku: 'intruso-ajeno' }),
      },
      revoked_member: {
        patch_product: await write(revoked, 'PATCH', `products?id=eq.${published}&select=id`, { sort_order: 999 }),
        insert_product: await write(revoked, 'POST', 'products?select=id', { business_id: A, name: 'intruso', price: 1, sku: 'intruso-baja' }),
      },
    };
    const who = { anon: null, customer, staff, rider: rider1, foreign_owner: second.owner, revoked_member: revoked };
    for (const [name, tries] of Object.entries(attempts)) {
      const leaked = Object.entries(tries).filter(([, r]) => !denied(r, who[name]));
      C(P, `RLS_${name.toUpperCase()}_DIRECT_WRITES_TOUCH_NO_ROW`, leaked.length === 0,
        leaked.length ? Object.fromEntries(leaked.map(([k, r]) => [k, { ...brief(r), rows: r.rows?.length ?? null }])) : { attempts: Object.keys(tries).length },
        'cada intento: 42501, o 200 sin ninguna fila tocada');
    }
    const revokedRpc = await ctx.orders.transition(revoked, O2, 'accepted', Number((await ctx.orders.state(O2)).revision));
    C(P, 'RLS_REVOKED_MEMBER_CANNOT_RUN_A_BUSINESS_COMMAND', refused(revokedRpc, CODES.FORBIDDEN), brief(revokedRpc), 'HTTP 403 · 42501 con un token que todavía no venció');
    const after = await fingerprint();
    C(P, 'RLS_WRITE_ATTEMPTS_CHANGED_NOTHING', JSON.stringify(before) === JSON.stringify(after), { before, after });

    ctx.evidence.write('phase-rls.json', { actors: ACTOR_NAMES, tables: TABLES, cells: cells.map(({ table, actor, expected, http, code, rows, ok }) => ({ table, actor, expected, http, code, rows, ok })),
      writes: Object.fromEntries(Object.entries(attempts).map(([name, tries]) => [name, Object.fromEntries(Object.entries(tries).map(([k, r]) => [k, `${r.status} ${r.code ?? ''} rows=${r.rows?.length ?? '-'}`])) ])),
      note: 'service_role no participa de ninguna celda; pos_sales sólo se lee' });
  },
};
