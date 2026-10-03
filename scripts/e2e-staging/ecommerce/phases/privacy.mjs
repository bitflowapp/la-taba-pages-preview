// FASE privacy — nadie lee ni cambia lo que no es suyo.
//
// Dos negocios COMPLETOS de esta corrida, cada uno con su dueño, su cliente y su pedido:
// el tenant y el segundo negocio (`ensureSecondBusiness`). Con las sesiones reales de cada
// uno se intenta lo que un atacante intentaría con un identificador ajeno (IDOR): leerlo
// por la tabla, operarlo por la RPC, pedir su traza, cancelarlo, sacarle el código de
// entrega. Y lo mismo dentro de un negocio: un cliente contra el pedido de otro cliente.
//
// Ninguna negativa se prueba con `service_role`: cada una es la respuesta que recibe la
// sesión del que pregunta. Y al final los dos pedidos están exactamente como estaban.
//
// El seguimiento público (`get_public_order_tracking`) se abre con un token que sólo
// tiene quien hizo el pedido: con el token correcto, con uno equivocado, con el de otro
// pedido, sin token y con el token revocado. Lo que devuelve no trae un dato personal.
import { randomToken, shortId, sqlUuid } from '../env.mjs';
import { CODES, brief, hidden, refusal, refused } from '../http.mjs';
import { piiLeaks } from '../orders.mjs';
import { ensureSecondBusiness } from '../tenant.mjs';

const P = 'privacy';
const seen = (r) => ({ http: r.status, code: r.code ?? null, rows: r.rows?.length ?? null });

export default {
  id: P,
  title: 'privacidad e IDOR: dos negocios completos, lecturas y escrituras cruzadas, seguimiento público con y sin token',
  requires: [],
  async run(ctx) {
    const C = ctx.rec.check;
    const A = ctx.tenant.id;
    const { owner, staff } = ctx.actors;

    // ── Los dos lados ─────────────────────────────────────────────────────────
    const second = await ensureSecondBusiness(ctx);
    const B = second.id;
    const customerA = await ctx.identities.customer('privacy-a');
    const customerA2 = await ctx.identities.customer('privacy-a2', { address: false });
    const mine = await ctx.orders.create(customerA, { mode: 'delivery', role: 'MAIN', quantity: 2, label: 'privacy-a' });
    const neighbour = await ctx.orders.create(customerA2, { mode: 'pickup', role: 'MAIN', quantity: 1, label: 'privacy-a2' });
    C(P, 'TWO_BUSINESSES_EACH_WITH_ITS_OWNER_CUSTOMER_AND_ORDER', Boolean(mine.order && neighbour.order && second.order?.id && second.owner?.sessionRole === 'owner'),
      { tenant: { order: mine.order?.public_code ?? null }, second: { slug: second.slug, order: second.order?.publicCode ?? null, ownerRole: second.owner?.sessionRole ?? null } });
    if (!mine.order || !neighbour.order) return;
    const OA = mine.order.id;
    const OA2 = neighbour.order.id;
    const OB = second.order.id;
    const snapshot = async () => (await ctx.env.observe(`select
      (select json_agg(json_build_object('id', o.id, 'status', o.status, 'revision', o.revision, 'origin', o.origin, 'payment', o.manual_payment_status, 'updated_at', o.updated_at) order by o.id)
         from public.orders o where o.id in (${sqlUuid(OA)}, ${sqlUuid(OA2)}, ${sqlUuid(OB)})) as orders,
      (select json_agg(json_build_object('id', p.id, 'price', p.price, 'stock', p.stock, 'available', p.available, 'sort_order', p.sort_order) order by p.id)
         from public.products p where p.id in (${sqlUuid(second.product.id)}, ${sqlUuid(ctx.tenant.products.MAIN.id)})) as products,
      (select json_agg(json_build_object('id', b.id, 'status', b.status) order by b.id) from public.businesses b where b.id in (${sqlUuid(A)}, ${sqlUuid(B)})) as businesses`))[0];
    const before = await snapshot();

    // ── 1. Lecturas cruzadas entre negocios ───────────────────────────────────
    const readsOf = async (actor, businessId, orderId, productId) => ({
      orders_of_the_business: await ctx.http.restGet(actor, `orders?select=id&business_id=eq.${businessId}`),
      order_by_id: await ctx.http.restGet(actor, `orders?select=id,customer_name,customer_phone&id=eq.${orderId}`),
      order_items: await ctx.http.restGet(actor, `order_items?select=id&order_id=eq.${orderId}`),
      order_events: await ctx.http.restGet(actor, `order_events?select=id&business_id=eq.${businessId}`),
      inventory_movements: await ctx.http.restGet(actor, `inventory_movements?select=id&business_id=eq.${businessId}`),
      business_members: await ctx.http.restGet(actor, `business_members?select=user_id,role&business_id=eq.${businessId}`),
      hidden_product_columns: await ctx.http.restGet(actor, `products?select=id,unit_cost&id=eq.${productId}`),
    });
    const tenantOwnerOnSecond = await readsOf(owner, B, OB, second.product.id);
    C(P, 'TENANT_OWNER_READS_NOTHING_OF_THE_SECOND_BUSINESS', Object.values(tenantOwnerOnSecond).every((r) => hidden(r, owner)),
      Object.fromEntries(Object.entries(tenantOwnerOnSecond).map(([k, r]) => [k, seen(r)])), 'cada lectura: 200 con cero filas o 403 · 42501');
    const secondOwnerOnTenant = await readsOf(second.owner, A, OA, ctx.tenant.products.MAIN.id);
    C(P, 'SECOND_OWNER_READS_NOTHING_OF_THE_TENANT', Object.values(secondOwnerOnTenant).every((r) => hidden(r, second.owner)),
      Object.fromEntries(Object.entries(secondOwnerOnTenant).map(([k, r]) => [k, seen(r)])), 'cada lectura: 200 con cero filas o 403 · 42501');
    // El dueño SÍ ve lo suyo por las mismas consultas: una negativa sólo prueba algo si la consulta puede devolver filas.
    const ownOrders = await ctx.http.restGet(owner, `orders?select=id&id=in.(${OA},${OA2})`);
    const secondOwn = await ctx.http.restGet(second.owner, `orders?select=id&id=eq.${OB}`);
    C(P, 'EACH_OWNER_SEES_ITS_OWN_ORDERS_THROUGH_THE_SAME_QUERIES', ownOrders.status === 200 && ownOrders.rows?.length === 2 && secondOwn.status === 200 && secondOwn.rows?.length === 1,
      { tenant: seen(ownOrders), second: seen(secondOwn) });

    // ── 2. Lecturas cruzadas entre clientes ───────────────────────────────────
    const customerReads = {
      another_customers_order: await ctx.http.restGet(customerA, `orders?select=id&id=eq.${OA2}`),
      order_of_the_second_business: await ctx.http.restGet(customerA, `orders?select=id&id=eq.${OB}`),
      another_customers_items: await ctx.http.restGet(customerA, `order_items?select=id&order_id=eq.${OA2}`),
      another_customers_addresses: await ctx.http.restGet(customerA2, `customer_addresses?select=id,street&customer_id=eq.${customerA.userId}`),
      another_customers_profile: await ctx.http.restGet(customerA2, `customers?select=id,name,phone&id=eq.${customerA.userId}`),
    };
    const everyOrder = await ctx.http.restGet(customerA, `orders?select=id,customer_user_id&business_id=eq.${A}`);
    C(P, 'A_CUSTOMER_READS_NOTHING_OF_ANOTHER_CUSTOMER', Object.values(customerReads).every((r) => hidden(r, customerA)) && everyOrder.status === 200
      && everyOrder.rows.length >= 1 && everyOrder.rows.every((row) => row.customer_user_id === customerA.userId),
    { ...Object.fromEntries(Object.entries(customerReads).map(([k, r]) => [k, seen(r)])), ownOrdersListed: everyOrder.rows?.length ?? null });
    const addresses = await ctx.http.restGet(staff, `customer_addresses?select=id,street&customer_id=eq.${customerA.userId}`);
    C(P, 'THE_BUSINESS_DOES_NOT_READ_A_CUSTOMERS_ADDRESS_BOOK', hidden(addresses, staff), seen(addresses));
    const anonOrder = await ctx.http.restGet(null, `orders?select=id&id=eq.${OA}`);
    C(P, 'WITHOUT_A_SESSION_AN_ORDER_ID_READS_NOTHING', hidden(anonOrder, null), seen(anonOrder));

    // ── 3. Escrituras cruzadas entre negocios: cada una se rechaza como «sin permiso» ──
    const rev = async (orderId) => Number((await ctx.orders.state(orderId)).revision);
    const cross = async (actor, businessId, orderId, productId, sku) => ({
      transition_order: await ctx.orders.transition(actor, orderId, 'accepted', await rev(orderId)),
      cancel_order: await ctx.orders.cancel(actor, orderId, await rev(orderId), `${ctx.runId} QA cruce de negocio`),
      acknowledge_order: await ctx.http.call(actor, 'acknowledge_order', { p_order_id: orderId, p_expected_revision: await rev(orderId), p_idempotency_key: `ecomcert-x-${shortId(8)}` }),
      confirm_manual_order_payment: await ctx.http.call(actor, 'confirm_manual_order_payment', { p_order_id: orderId, p_expected_revision: await rev(orderId), p_actual_method: 'cash',
        p_idempotency_key: `ecomcert-x-${shortId(8)}` }),
      classify_order_as_qa: await ctx.http.call(actor, 'classify_order_as_qa', { p_order_id: orderId, p_reason: 'cruce_de_negocio' }),
      set_business_open_state: await ctx.http.call(actor, 'set_business_open_state', { p_business_id: businessId, p_status: 'paused' }),
      apply_inventory_movement: await ctx.http.call(actor, 'apply_inventory_movement', { p_business_id: businessId, p_product_id: productId, p_barcode_id: null,
        p_movement_type: 'manual_adjustment', p_package_quantity: 5, p_direction: 1, p_reference_type: 'cruce', p_reference_id: null, p_reason: 'intento desde otro negocio',
        p_idempotency_key: `ecomcert-x-${shortId(8)}` }),
      set_commercial_product_publication: await ctx.http.call(actor, 'set_commercial_product_publication', { p_business_id: businessId, p_sku: sku, p_publish: false }),
      get_order_trace: await ctx.http.call(actor, 'get_order_trace', { p_business_id: businessId, p_reference: orderId }),
      revoke_public_tracking: await ctx.http.call(actor, 'revoke_public_tracking', { p_order_id: orderId }),
    });
    const writesOnSecond = await cross(owner, B, OB, second.product.id, second.product.sku);
    C(P, 'TENANT_OWNER_CANNOT_OPERATE_THE_SECOND_BUSINESS', Object.values(writesOnSecond).every((r) => refused(r, CODES.FORBIDDEN)),
      Object.fromEntries(Object.entries(writesOnSecond).filter(([, r]) => !refused(r, CODES.FORBIDDEN)).map(([k, r]) => [k, brief(r)])), `${refusal(CODES.FORBIDDEN)} en las diez operaciones`);
    const writesOnTenant = await cross(second.owner, A, OA, ctx.tenant.products.MAIN.id, ctx.tenant.products.MAIN.sku);
    C(P, 'SECOND_OWNER_CANNOT_OPERATE_THE_TENANT', Object.values(writesOnTenant).every((r) => refused(r, CODES.FORBIDDEN)),
      Object.fromEntries(Object.entries(writesOnTenant).filter(([, r]) => !refused(r, CODES.FORBIDDEN)).map(([k, r]) => [k, brief(r)])), `${refusal(CODES.FORBIDDEN)} en las diez operaciones`);
    const patches = {
      second_product_by_tenant_owner: await ctx.http.restWrite(owner, 'PATCH', `products?id=eq.${second.product.id}&select=id`, { sort_order: 999 }, { businessId: B }),
      tenant_product_by_second_owner: await ctx.http.restWrite(second.owner, 'PATCH', `products?id=eq.${ctx.tenant.products.MAIN.id}&select=id`, { sort_order: 999 }, { businessId: A }),
      second_business_by_tenant_owner: await ctx.http.restWrite(owner, 'PATCH', `businesses?id=eq.${B}&select=id`, { address: 'Calle Tomada 1' }, { businessId: B }),
    };
    C(P, 'DIRECT_TABLE_WRITES_ACROSS_BUSINESSES_TOUCH_NO_ROW', Object.values(patches).every((r) => hidden(r, owner)), Object.fromEntries(Object.entries(patches).map(([k, r]) => [k, seen(r)])));
    // Con la traza de SU negocio y una referencia del otro: no existe. La referencia ajena no revela nada.
    const foreignReference = await ctx.http.call(owner, 'get_order_trace', { p_business_id: A, p_reference: second.order.publicCode });
    C(P, 'A_FOREIGN_REFERENCE_IS_NOT_FOUND_IN_ONES_OWN_TRACE', foreignReference.status === 200 && foreignReference.data?.found === false && foreignReference.data?.reason === 'not_found',
      { ...brief(foreignReference), found: foreignReference.data?.found ?? null, reason: foreignReference.data?.reason ?? null });

    // ── 4. Un cliente contra un pedido que no es suyo ─────────────────────────
    const customerWrites = {
      cancel_own_order_of_a_neighbour: await ctx.http.call(customerA, 'cancel_own_order', { p_order_id: OA2, p_idempotency_key: `ecomcert-x-${shortId(8)}`, p_reason: null }),
      cancel_own_order_of_the_second_business: await ctx.http.call(customerA, 'cancel_own_order', { p_order_id: OB, p_idempotency_key: `ecomcert-x-${shortId(8)}`, p_reason: null }),
    };
    C(P, 'A_CUSTOMER_CANNOT_CANCEL_AN_ORDER_THAT_IS_NOT_THEIRS', Object.values(customerWrites).every((r) => refused(r, CODES.NOT_FOUND, { message: 'pedido inexistente' })),
      Object.fromEntries(Object.entries(customerWrites).map(([k, r]) => [k, brief(r)])), `${refusal(CODES.NOT_FOUND, { message: 'pedido inexistente' })}: igual que un pedido que no existe`);
    const stolenCode = await ctx.http.call(customerA2, 'issue_order_delivery_code', { p_order_id: OA, p_tracking_token: mine.token });
    const stolenRevoke = await ctx.http.call(customerA2, 'revoke_public_tracking', { p_order_id: OA });
    const stolenRecover = await ctx.http.call(customerA2, 'recover_order_tracking_access', { p_order_id: OA, p_new_tracking_token: randomToken() });
    const customerAsStaff = await ctx.orders.transition(customerA, OA, 'accepted', await rev(OA));
    C(P, 'A_CUSTOMER_CANNOT_TAKE_THE_DELIVERY_CODE_OR_THE_TRACKING_OF_ANOTHER_ORDER', [stolenCode, stolenRevoke, stolenRecover].every((r) => refused(r, CODES.FORBIDDEN)),
      { code: brief(stolenCode), revoke: brief(stolenRevoke), recover: brief(stolenRecover) }, `${refusal(CODES.FORBIDDEN)}, aun teniendo el token de seguimiento del pedido`);
    C(P, 'A_CUSTOMER_CANNOT_RUN_A_BUSINESS_COMMAND_ON_THEIR_OWN_ORDER', refused(customerAsStaff, CODES.FORBIDDEN), brief(customerAsStaff), refusal(CODES.FORBIDDEN));
    const afterAttempts = await snapshot();
    C(P, 'NOTHING_CHANGED_ON_EITHER_SIDE', JSON.stringify(before) === JSON.stringify(afterAttempts), { before, after: afterAttempts });

    // ── 5. El seguimiento público ─────────────────────────────────────────────
    const track = (publicId, token) => ctx.orders.tracking(publicId, token);
    const right = await track(mine.order.public_code, mine.token);
    const byUuid = await track(OA, mine.token);
    C(P, 'TRACKING_WITH_THE_RIGHT_TOKEN_SHOWS_THE_ORDER', right.status === 200 && right.data?.public_code === mine.order.public_code && right.data?.status === 'received'
      && byUuid.data?.public_code === mine.order.public_code, { ...brief(right), status: right.data?.status ?? null });
    const leaks = piiLeaks(right.data, [customerA]);
    C(P, 'TRACKING_ANSWER_CARRIES_NO_PERSONAL_DATA', right.data !== null && leaks.length === 0, { keys: Object.keys(right.data || {}), leaks }, 'ni teléfono, ni nombre, ni dirección, ni identificadores de la persona');
    const closedDoors = {
      wrong_token: await track(mine.order.public_code, randomToken()),
      token_of_another_order_same_business: await track(mine.order.public_code, neighbour.token),
      token_of_the_second_business_order: await track(mine.order.public_code, second.order.token),
      own_token_on_another_order: await track(neighbour.order.public_code, mine.token),
      no_token: await track(mine.order.public_code, null),
      empty_token: await ctx.http.call(null, 'get_public_order_tracking', { p_public_id: mine.order.public_code }, { headers: { 'x-order-token': '' } }),
      unknown_order: await track(`ZZ-${shortId(4).toUpperCase()}`, mine.token),
      second_business_order_with_tenant_token: await track(second.order.publicCode, mine.token),
    };
    // Sin el token correcto la respuesta es SIEMPRE la misma: 200 y nada. No distingue «no existe» de «no es tuyo».
    C(P, 'TRACKING_WITHOUT_THE_RIGHT_TOKEN_SHOWS_NOTHING', Object.values(closedDoors).every((r) => r.status === 200 && r.data === null),
      Object.fromEntries(Object.entries(closedDoors).map(([k, r]) => [k, { http: r.status, body: r.data === null ? null : 'ROWS' }])), 'HTTP 200 con cuerpo nulo en los ocho casos');
    const withSession = await ctx.orders.tracking(mine.order.public_code, null, customerA2);
    C(P, 'A_SESSION_DOES_NOT_REPLACE_THE_TOKEN', withSession.status === 200 && withSession.data === null, { http: withSession.status, body: withSession.data === null ? null : 'ROWS' });

    // ── 6. Revocar y recuperar el seguimiento ─────────────────────────────────
    if (ctx.caps.tracking_revocation) {
      const revoked = await ctx.http.call(customerA, 'revoke_public_tracking', { p_order_id: OA });
      const afterRevoke = await track(mine.order.public_code, mine.token);
      const codeAfterRevoke = await ctx.http.call(customerA, 'issue_order_delivery_code', { p_order_id: OA, p_tracking_token: mine.token });
      C(P, 'A_REVOKED_TOKEN_SHOWS_NOTHING', revoked.status === 200 && revoked.data === true && afterRevoke.status === 200 && afterRevoke.data === null,
        { revoke: { ...brief(revoked), answer: revoked.data }, tracking: { http: afterRevoke.status, body: afterRevoke.data === null ? null : 'ROWS' } });
      C(P, 'A_REVOKED_TOKEN_DOES_NOT_ISSUE_THE_DELIVERY_CODE', refused(codeAfterRevoke, CODES.FORBIDDEN, { message: 'token de seguimiento invalido' }), brief(codeAfterRevoke),
        refusal(CODES.FORBIDDEN, { message: 'token de seguimiento invalido' }));
      const fresh = ctx.redactor.secret(randomToken());
      const recovered = await ctx.http.call(customerA, 'recover_order_tracking_access', { p_order_id: OA, p_new_tracking_token: fresh });
      if (recovered.data?.delivery_code) ctx.redactor.secret(String(recovered.data.delivery_code));
      const withFresh = await track(mine.order.public_code, fresh);
      const withOld = await track(mine.order.public_code, mine.token);
      C(P, 'THE_OWNER_OF_THE_ORDER_RECOVERS_TRACKING_WITH_A_NEW_TOKEN', recovered.status === 200 && recovered.data?.ok === true && withFresh.data?.public_code === mine.order.public_code
        && withOld.data === null, { recover: brief(recovered), fresh: withFresh.data?.status ?? null, old: withOld.data === null ? null : 'ROWS' });
    } else {
      for (const name of ['A_REVOKED_TOKEN_SHOWS_NOTHING', 'A_REVOKED_TOKEN_DOES_NOT_ISSUE_THE_DELIVERY_CODE', 'THE_OWNER_OF_THE_ORDER_RECOVERS_TRACKING_WITH_A_NEW_TOKEN']) ctx.rec.skipCheck(P, name, 'tracking_revocation');
    }

    // ── 7. La puerta de entrada exige la clave del proyecto ───────────────────
    const withoutGateway = ctx.env.target.lacks('gateway');
    if (withoutGateway) ctx.rec.skipOnTarget(P, 'GATEWAY_REFUSES_A_REQUEST_WITHOUT_THE_PROJECT_KEY', withoutGateway);
    else {
      const noKey = await ctx.http.raw('GET', `/rest/v1/orders?select=id&id=eq.${OA}`, { key: false });
      const noKeyRpc = await ctx.http.raw('POST', '/rest/v1/rpc/get_public_order_tracking', { key: false, body: { p_public_id: mine.order.public_code } });
      // El gateway del stack local de la CLI no exige la clave del proyecto (contesta 200: run 37124096351); la
      // plataforma alojada sí. Si en el stack las dos respuestas sin clave vienen VACÍAS, lo que no se puede probar
      // acá es la puerta, no la privacidad: queda como no probado, con lo observado. Cualquier dato devuelto sigue
      // siendo FAIL.
      const stackGatewayWithoutKeyButNothingLeaked = ctx.env.target.kind === 'stack' && noKey.status === 200 && noKeyRpc.status === 200
        && noKey.text.trim() === '[]' && noKeyRpc.text.trim() === 'null';
      if (stackGatewayWithoutKeyButNothingLeaked) {
        ctx.rec.skipOnTarget(P, 'GATEWAY_REFUSES_A_REQUEST_WITHOUT_THE_PROJECT_KEY',
          'el gateway del stack local no exige la clave del proyecto (observado: HTTP 200 sin apikey, con [] en la tabla y null en la RPC: nada se filtró); en la plataforma alojada sí la exige');
      } else {
        C(P, 'GATEWAY_REFUSES_A_REQUEST_WITHOUT_THE_PROJECT_KEY', noKey.status === 401 && noKeyRpc.status === 401, { table: { http: noKey.status, body: noKey.text.slice(0, 120) },
          rpc: { http: noKeyRpc.status, body: noKeyRpc.text.slice(0, 120) } }, 'HTTP 401 antes de llegar a PostgREST');
      }
    }
    const unknownTrace = await ctx.http.call(null, 'get_order_trace', { p_business_id: A, p_reference: OA });
    C(P, 'WITHOUT_A_SESSION_THE_ORDER_TRACE_IS_REFUSED', refused(unknownTrace, CODES.FORBIDDEN, { actor: null }), brief(unknownTrace), refusal(CODES.FORBIDDEN, { actor: null }));

    const final = await snapshot();
    C(P, 'BOTH_ORDERS_AND_BOTH_BUSINESSES_END_AS_THEY_STARTED', JSON.stringify(before) === JSON.stringify(final), { changed: JSON.stringify(before) !== JSON.stringify(final) });
    ctx.evidence.write('phase-privacy.json', { tenant: { order: mine.order.public_code, neighbour: neighbour.order.public_code }, second: { slug: second.slug, order: second.order.publicCode },
      trackingKeys: Object.keys(right.data || {}),
      crossBusiness: { tenantOwnerOnSecond: Object.fromEntries(Object.entries(writesOnSecond).map(([k, r]) => [k, `${r.status} ${r.code ?? ''}`.trim()])),
        secondOwnerOnTenant: Object.fromEntries(Object.entries(writesOnTenant).map(([k, r]) => [k, `${r.status} ${r.code ?? ''}`.trim()])) } });
  },
};
