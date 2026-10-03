// TABA · Stock · CARRERAS REALES: ni sobreventa ni stock negativo
//
// pgTAP corre en una sola transacción: no puede probar qué pasa cuando cincuenta
// compradores quieren las mismas unidades AL MISMO TIEMPO. Acá cada pedido, cada
// sesión de pago, cada aviso de Mercado Pago, cada cancelación y cada barrido abre
// SU conexión, hace begin, fija `request.jwt.claims` y el rol, llama a la función
// pública, confirma y cierra, que es lo que hace PostgREST. Todas las conexiones
// de una carrera quedan abiertas y con la transacción iniciada ANTES de disparar:
// las llamadas salen en el mismo instante, no escalonadas por el tiempo de conexión.
//
//    1. ÚLTIMA UNIDAD      stock 1, dos clientes a la vez, 10 rondas -> un pedido, stock 0.
//    2. DIEZ A LA VEZ      stock 3, diez clientes -> 3 pedidos, 7 rechazos por stock.
//    3. CINCUENTA          stock 20, cincuenta clientes pidiendo 1, 2 o 3 -> nunca más de 20.
//    4. MERCADO PAGO       stock 5, cincuenta sesiones de pago -> 5 reservas, stock 0.
//    5. LAS DOS PUERTAS    stock 6, 25 pedidos y 25 sesiones juntos -> pedidos + reservas = 6.
//    6. CHECKOUT ABANDONADO  las sesiones vencen y el barrido corre desde 5 conexiones
//                          -> cada unidad vuelve UNA vez y se puede volver a vender.
//    7. PAGO RECHAZADO     el rechazo no libera la reserva; vuelve una vez al vencer.
//    8. CANCELACIÓN        6 conexiones cancelan el mismo pedido (comercio, cliente y
//                          vencimiento por desatención) -> el stock vuelve +2, no +4.
//    9. WEBHOOK DUPLICADO  el mismo pago aprobado 10 veces a la vez, y después 10
//                          finalizaciones mezcladas con otros 10 avisos iguales
//                          -> un pedido, la reserva convertida una vez, un pago.
//   10. REINTENTOS         el MISMO pedido 25 veces más otro cliente por la misma unidad
//                          -> una sola unidad vendida.
//
// Un comprador que no entra tiene que quedar afuera POR STOCK y por nada más:
//   23514 «stock insuficiente para producto: <id>»       quedan unidades, no alcanzan
//   55000 «producto no disponible: <id>»                 pedido manual, producto agotado
//   55000 «producto no disponible para pago: <id>»       sesión de pago, producto agotado
// (al vender la última unidad el producto se despublica: por eso el agotado contesta
// «no disponible»; la carrera comprueba que el producto sigue activo y verificado, o
// sea que el único motivo posible es el stock).
//
// Al final, para cada producto usado: stock >= 0 y conservación
//   stock inicial = stock actual + reservas activas + pedidos que retienen stock
//                   + unidades entregadas
// con la misma definición que `private.pos_reserved_quantity`.
//
// Un deadlock (40P01) no se esconde: se cuenta, se reintenta una vez como haría quien
// llama y la línea DEADLOCKS dice cuántos hubo.
//
// La usan scripts/run-release-v5-db.mjs (CI, contenedor sin red) y la corrida local
// contra una base descartable:
//   TABA_LOCAL_INTAKE_DB=1 node scripts/order-intake/stock-race.mjs postgres://postgres@127.0.0.1:55432/taba
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import path from 'node:path';
import process from 'node:process';

const BUSINESS = 'b7400000-0000-4000-8000-0000000000a1';
const OWNER = 'a7400000-0000-4000-8000-0000000000ff';
const STAFF = 'a7400000-0000-4000-8000-0000000000fe';
// El encargado. Cancelar un pedido pide el permiso `orders.cancel` del catálogo, que el
// empleado no tiene (20261002050000): las cancelaciones del comercio las hacen él y el dueño.
const MANAGER = 'a7400000-0000-4000-8000-0000000000fd';
const SESSION = {
  [OWNER]: 'e7400000-0000-4000-8000-0000000000ff',
  [STAFF]: 'e7400000-0000-4000-8000-0000000000fe',
  [MANAGER]: 'e7400000-0000-4000-8000-0000000000fd',
};
const COLLECTOR = 'stock-race-collector';
const APPLICATION = 'stock-race-app';
const CUSTOMERS = 240;
// Tope de conexiones abiertas a la vez (más la administrativa) y de aperturas en paralelo.
const MAX_AT_ONCE = 50;
const OPEN_BATCH = 10;
// Estados en los que un pedido retiene stock: los de `private.pos_reserved_quantity`.
const HOLDING = ['received', 'submitted', 'accepted', 'preparing', 'ready', 'assigned'];

const customer = (index) => `a7400000-0000-4000-8000-${String(index).padStart(12, '0')}`;
const product = (index) => `c7400000-0000-4000-8000-${String(index).padStart(12, '0')}`;
const pad = (value) => String(value).padStart(2, '0');
const sha256 = (value) => createHash('sha256').update(value, 'utf8').digest('hex');
const sum = (values) => values.reduce((total, value) => total + value, 0);

const buyer = (id) => ({ role: 'authenticated', claims: { sub: id, role: 'authenticated', is_anonymous: true } });
const operator = (id) => ({ role: 'authenticated', claims: { sub: id, role: 'authenticated', session_id: SESSION[id] } });
const service = { role: 'service_role', claims: { role: 'service_role' } };
// Las dos funciones SECURITY INVOKER de la preferencia (`get_mercadopago_payment_authority_v2`
// y `record_mercadopago_preference_created_v2`) llegan a `business_is_open`, que en la
// plataforma `service_role` ejecuta por los privilegios por defecto y en la base de CI no
// (no hay privilegios por defecto sobre funciones). Se llaman con el rol de la conexión,
// igual que en mercadopago_snapshot_finalization_hardening_test.sql.
const platform = { role: null, claims: { role: 'service_role' } };

export async function runStockRace(connect, { log = console.log } = {}) {
  const admin = await connect();
  const startedAt = Date.now();
  const ledger = new Map();
  const refusals = new Map();
  const tally = { calls: 0, deadlocks: 0, deadlockRetriesOk: 0, slowestMs: 0 };
  let customersUsed = 0;
  let productsUsed = 0;

  const rows = async (sql, params = []) => (await admin.query(sql, params)).rows;
  const one = async (sql, params = []) => (await rows(sql, params))[0];

  // ── Una conexión por llamada, todas disparadas en el mismo instante ──────────
  const open = async (task) => {
    const client = await connect();
    try {
      await client.query('begin');
      if (task.identity.role) await client.query(`set local role ${task.identity.role}`);
      await client.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify(task.identity.claims)]);
      return client;
    } catch (error) {
      await client.end().catch(() => {});
      throw error;
    }
  };
  const fire = async (client, task) => {
    const began = Date.now();
    try {
      const { rows: [row] } = await client.query(task.sql, task.params);
      await client.query('commit');
      return { ok: true, value: row.result, task, ms: Date.now() - began };
    } catch (error) {
      await client.query('rollback').catch(() => {});
      return { ok: false, code: error.code, message: error.message, detail: error.detail || null, task, ms: Date.now() - began };
    } finally {
      await client.end().catch(() => {});
    }
  };
  const race = async (tasks) => {
    assert.ok(tasks.length <= MAX_AT_ONCE, `a lo sumo ${MAX_AT_ONCE} conexiones a la vez`);
    const clients = [];
    try {
      for (let index = 0; index < tasks.length; index += OPEN_BATCH) {
        clients.push(...await Promise.all(tasks.slice(index, index + OPEN_BATCH).map(async (task) => {
          try { return await open(task); } catch (error) { return error; }
        })));
      }
      const broken = clients.find((client) => client instanceof Error);
      if (broken) throw broken;
    } catch (error) {
      await Promise.all(clients.filter((client) => !(client instanceof Error)).map((client) => client.end().catch(() => {})));
      throw error;
    }
    // Todas las transacciones están abiertas y ociosas: salen juntas.
    const results = await Promise.all(clients.map((client, index) => fire(client, tasks[index])));
    tally.calls += results.length;
    tally.slowestMs = Math.max(tally.slowestMs, ...results.map((result) => result.ms));
    for (let index = 0; index < results.length; index += 1) {
      if (results[index].ok || results[index].code !== '40P01') continue;
      // Deadlock: Postgres eligió una víctima. Quien llama reintenta; acá queda contado.
      tally.deadlocks += 1;
      const retry = await fire(await open(tasks[index]), tasks[index]);
      if (retry.code !== '40P01') tally.deadlockRetriesOk += 1;
      results[index] = { ...retry, deadlockRetried: true };
    }
    return results;
  };
  const call = async (identity, sql, params = []) => (await race([{ identity, sql, params }]))[0];
  const mustCall = async (what, identity, sql, params = []) => {
    const result = await call(identity, sql, params);
    assert.ok(result.ok, `${what}: ${result.code} ${result.message}`);
    return result.value;
  };

  // ── Las dos puertas ──────────────────────────────────────────────────────────
  const manualOrder = (customerId, key, productId, quantity, basket = null) => ({
    door: 'manual', customerId, key, productId, quantity, identity: buyer(customerId),
    sql: 'select public.create_order_with_items($1::jsonb) as result',
    params: [JSON.stringify({
      business_id: BUSINESS,
      client_request_id: key,
      tracking_token: `${key}-${'t'.repeat(40)}`.slice(0, 48),
      items: basket || [{ product_id: productId, quantity }],
      customer_name: 'Cliente Carrera Stock',
      customer_phone: '2996209137',
      delivery_mode: 'pickup',
      payment_method: 'cash',
    })],
  });
  // La puerta de Mercado Pago: lo que llama la Edge Function con su cliente de servicio.
  const checkout = (customerId, key, productId, quantity, basket = null) => ({
    door: 'checkout', customerId, key, productId, quantity, identity: service,
    sql: 'select public.create_checkout_session($1::uuid, $2::jsonb) as result',
    params: [customerId, JSON.stringify({
      business_id: BUSINESS,
      client_request_id: key,
      items: basket || [{ product_id: productId, quantity }],
      fulfillment_type: 'pickup',
      contact: { name: 'Cliente Carrera Stock', phone: '5492990000000' },
      address: {},
      age_confirmed: false,
      payment_method: 'mercadopago',
    })],
  });
  const idOf = (result) => (result.task.door === 'manual' ? result.value?.id : result.value?.checkout_session_id);

  const refusedForStock = (result) => {
    if (result.ok) return false;
    const { productId, door } = result.task;
    const soldOut = door === 'manual' ? `producto no disponible: ${productId}` : `producto no disponible para pago: ${productId}`;
    return (result.code === '23514' && result.message === `stock insuficiente para producto: ${productId}`)
      || (result.code === '55000' && result.message === soldOut);
  };
  const noteRefusal = (result) => {
    const label = `${result.code} ${String(result.message).replace(/[0-9a-f]{8}-[0-9a-f-]{27}/g, '<id>')}`;
    refusals.set(label, (refusals.get(label) || 0) + 1);
  };
  const codes = (results) => {
    const seen = new Map();
    for (const result of results) {
      const label = result.ok ? 'ok' : `${result.code} ${result.message}`;
      seen.set(label, (seen.get(label) || 0) + 1);
    }
    return JSON.stringify(Object.fromEntries(seen));
  };

  // ── Fixtures ─────────────────────────────────────────────────────────────────
  const customers = (count) => {
    assert.ok(customersUsed + count <= CUSTOMERS, 'faltan clientes en el fixture');
    customersUsed += count;
    return Array.from({ length: count }, (_, index) => customer(customersUsed - count + index + 1));
  };
  const newProduct = async (label, stock) => {
    productsUsed += 1;
    const id = product(productsUsed);
    await admin.query(`insert into public.products(id,business_id,name,category,subcategory,price,price_status,is_active,brand,
        variant,presentation,capacity_value,capacity_unit,capacity,packaging_type,stock,available,merchant_available,is_alcoholic,
        tags,is_verified,verified_at,verified_by,external_id,sku,catalog_origin,units_per_pack)
      values ($1,$2,$3,'Gaseosas','Cola',1000,'confirmed',true,'Marca Carrera','Lata','Lata',473,'ml','473 ml','lata',
        $4,true,true,false,'{}',true,now(),$5,$6,$6,'commercial',1)`,
    [id, BUSINESS, `Lata Carrera Stock ${label}`, stock, OWNER, `stock-race-${label}`]);
    ledger.set(id, { label, initial: stock, orders: new Map(), sessions: new Map() });
    return id;
  };

  // Lo que la base dice de un producto, con la definición de `private.pos_reserved_quantity`.
  const stateOf = (productId) => one(`select p.stock, p.available, p.is_active, p.is_verified, p.merchant_available,
      coalesce((select sum(r.quantity) from public.inventory_reservations r
                 where r.product_id = p.id and r.status = 'active'), 0)::int as reserved,
      coalesce((select sum(oi.quantity) from public.order_items oi join public.orders o on o.id = oi.order_id
                 where oi.product_uuid = p.id and o.inventory_released_at is null and o.status = any($2)), 0)::int as held,
      coalesce((select sum(oi.quantity) from public.order_items oi join public.orders o on o.id = oi.order_id
                 where oi.product_uuid = p.id and o.inventory_released_at is null and o.status <> all($2)), 0)::int as consumed,
      coalesce((select sum(oi.quantity) from public.order_items oi join public.orders o on o.id = oi.order_id
                 where oi.product_uuid = p.id and o.inventory_released_at is not null), 0)::int as returned,
      private.pos_reserved_quantity(p.id) as system_reserved
    from public.products p where p.id = $1`, [productId, HOLDING]);

  const assertConserved = async (productId, where) => {
    const entry = ledger.get(productId);
    const state = await stateOf(productId);
    assert.ok(state.stock >= 0, `${where}: stock negativo en ${entry.label} (${state.stock})`);
    assert.equal(state.reserved + state.held, state.system_reserved,
      `${where}: la cuenta de unidades retenidas coincide con private.pos_reserved_quantity (${entry.label})`);
    assert.equal(state.stock + state.reserved + state.held + state.consumed, entry.initial,
      `${where}: conservacion de ${entry.label}: stock ${state.stock} + reservas ${state.reserved} + pedidos ${state.held}`
      + ` + entregado ${state.consumed} = ${entry.initial} inicial`);
    return state;
  };

  // Los pedidos y las sesiones que existen para un producto son exactamente los que
  // la carrera aceptó, cada uno con su renglón y su cantidad.
  const assertDoors = async (productId, where) => {
    const entry = ledger.get(productId);
    const orders = await rows(`select o.id,
        (select count(*)::int from public.order_items oi where oi.order_id = o.id) as lines,
        (select coalesce(sum(oi.quantity), 0)::int from public.order_items oi
          where oi.order_id = o.id and oi.product_uuid = $2) as units
      from public.orders o
     where o.business_id = $1
       and exists (select 1 from public.order_items oi where oi.order_id = o.id and oi.product_uuid = $2)`, [BUSINESS, productId]);
    assert.deepEqual(
      orders.map((row) => `${row.id}:${row.lines}:${row.units}`).sort(),
      [...entry.orders].map(([id, line]) => `${id}:${line.lines}:${line.quantity}`).sort(),
      `${where}: los pedidos de ${entry.label} son los aceptados, cada uno con su renglon`);
    const sessions = await rows(`select s.id,
        (select count(*)::int from public.checkout_session_items i where i.checkout_session_id = s.id) as lines,
        (select coalesce(sum(r.quantity), 0)::int from public.inventory_reservations r
          where r.checkout_session_id = s.id and r.product_id = $2) as units,
        (select count(*)::int from public.inventory_reservations r where r.checkout_session_id = s.id) as reservations,
        (select count(*)::int from public.payment_intents pi where pi.checkout_session_id = s.id) as intents
      from public.checkout_sessions s
     where s.business_id = $1
       and exists (select 1 from public.checkout_session_items i where i.checkout_session_id = s.id and i.product_id = $2)`,
    [BUSINESS, productId]);
    assert.deepEqual(
      sessions.map((row) => `${row.id}:${row.lines}:${row.units}:${row.reservations}:${row.intents}`).sort(),
      [...entry.sessions].map(([id, line]) => `${id}:${line.lines}:${line.quantity}:${line.lines}:1`).sort(),
      `${where}: las sesiones de ${entry.label} son las aceptadas, cada una con su reserva y su intent`);
    // Un intento rechazado no deja nada a medias en el comercio.
    assert.deepEqual(await one(`select
        (select count(*)::int from public.orders o where o.business_id = $1
           and not exists (select 1 from public.order_items oi where oi.order_id = o.id)) as orders_without_items,
        (select count(*)::int from public.checkout_sessions s where s.business_id = $1
           and (not exists (select 1 from public.checkout_session_items i where i.checkout_session_id = s.id)
             or not exists (select 1 from public.inventory_reservations r where r.checkout_session_id = s.id))) as sessions_without_reservation`,
    [BUSINESS]), { orders_without_items: 0, sessions_without_reservation: 0 }, `${where}: ningun pedido sin renglones ni sesion sin reserva`);
  };

  // Stock con el que cada producto llega a su próxima carrera de compra.
  const stockBefore = new Map();
  const refresh = async (productId) => { stockBefore.set(productId, (await stateOf(productId)).stock); };

  // Cierra una carrera de compra sobre un producto: quien no entró quedó afuera por
  // stock, lo aceptado nunca supera lo que había y a nadie se le negó una unidad que
  // quedaba. `returned` son las unidades que otra llamada de la MISMA carrera devolvió
  // al stock (un barrido): ahí un rechazo pudo llegar antes de la devolución.
  const settle = async (where, productId, results, { returned = 0 } = {}) => {
    const entry = ledger.get(productId);
    const before = (stockBefore.get(productId) ?? entry.initial) + returned;
    const accepted = results.filter((result) => result.ok);
    const refused = results.filter((result) => !result.ok);
    for (const result of refused) noteRefusal(result);
    assert.ok(refused.every(refusedForStock), `${where}: todo rechazo es por stock y por nada mas -> ${codes(refused)}`);
    assert.ok(accepted.every((result) => idOf(result)), `${where}: toda respuesta aceptada trae su id -> ${codes(accepted)}`);
    const unique = new Map();
    for (const result of accepted) unique.set(idOf(result), result.task);
    for (const [id, task] of unique) (task.door === 'manual' ? entry.orders : entry.sessions).set(id, { quantity: task.quantity, lines: 1 });
    const units = sum([...unique.values()].map((task) => task.quantity));
    const state = await assertConserved(productId, where);
    assert.ok(units <= before, `${where}: lo aceptado (${units}) no supera el stock que habia (${before})`);
    assert.equal(state.stock, before - units, `${where}: stock = ${before} - ${units} unidades aceptadas`);
    assert.ok(state.is_active && state.is_verified && state.merchant_available,
      `${where}: el producto sigue activo, verificado y ofrecido por el comercio: lo unico que falto fue stock`);
    assert.equal(state.available, state.stock > 0, `${where}: publicado si y solo si queda stock`);
    if (returned === 0) {
      for (const result of refused) {
        assert.ok(result.task.quantity > state.stock,
          `${where}: a nadie se le nego una cantidad (${result.task.quantity}) que el stock final (${state.stock}) cubria`);
        if (result.code === '55000') assert.equal(state.stock, 0, `${where}: «no disponible» solo con el producto agotado`);
      }
    }
    await assertDoors(productId, where);
    stockBefore.set(productId, state.stock);
    return { accepted, refused, units, unique, state };
  };

  // ── Mercado Pago: lo que hacen las funciones Edge después de crear la sesión ──
  const preference = async (sessionId, customerId, ref) => {
    const prepared = await mustCall('preparar la preferencia', service,
      'select public.prepare_mercadopago_preference_v2($1::uuid, $2::uuid, false) as result', [sessionId, customerId]);
    const authority = await mustCall('leer la autoridad del intento', platform,
      `select public.get_mercadopago_payment_authority_v2($1::uuid, 'test', $2::uuid, $3::uuid, $4::uuid) ->> 'authority_version' as result`,
      [BUSINESS, sessionId, customerId, prepared.payment_attempt_id]);
    assert.match(authority || '', /^[a-f0-9]{64}$/, 'la autoridad del intento existe: vendedor conectado y reserva vigente');
    await mustCall('asentar la preferencia', platform,
      `select public.record_mercadopago_preference_created_v2($1::uuid, 'test', $2::uuid, $3::uuid, $4::uuid, $5, $6, $7, $8, $9, $10) as result`,
      [BUSINESS, sessionId, customerId, prepared.payment_attempt_id, authority, `PREF-${ref}`,
        `https://www.mercadopago.com.ar/checkout/v1/redirect?pref_id=${ref}`,
        `https://sandbox.mercadopago.com.ar/checkout/v1/redirect?pref_id=${ref}`, sha256(`pref-${ref}`), `req-${ref}`]);
  };
  // Lo que el worker persiste después de leer el pago en Mercado Pago. La misma
  // semilla es la misma respuesta del proveedor: un aviso duplicado.
  const snapshotTask = async (sessionId, paymentId, status, seed) => {
    const context = await one(`select pi.id as intent, pi.external_reference, pi.preference_id, cs.total::text as total,
        to_char(clock_timestamp() at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as at
      from public.payment_intents pi join public.checkout_sessions cs on cs.id = pi.checkout_session_id
     where cs.id = $1`, [sessionId]);
    return {
      identity: service,
      sql: 'select public.record_mercadopago_payment_snapshot($1::uuid, $2::jsonb, $3, null) as result',
      params: [context.intent, JSON.stringify({
        provider_payment_id: paymentId,
        external_reference: context.external_reference,
        preference_id: context.preference_id,
        merchant_order_id: `MO-${paymentId}`,
        collector_id: COLLECTOR,
        application_id: '',
        currency: 'ARS',
        transaction_amount: context.total,
        status,
        status_detail: 'detalle_de_prueba',
        payment_method: 'visa',
        live_mode: false,
        provider_occurred_at: context.at,
        refunded_amount: '0.00',
        payer_email_hash: 'e'.repeat(64),
        raw_response_hash: sha256(seed),
      }), 'webhook'],
    };
  };
  const sweep = { identity: service, sql: 'select public.sweep_expired_checkout_sessions() as result', params: [] };
  // La sesión y sus reservas vencieron hace un minuto (misma forma que la suite pgTAP).
  const expire = async (sessionIds) => {
    await admin.query(`update public.checkout_sessions
        set created_at = clock_timestamp() - interval '2 hours', expires_at = clock_timestamp() - interval '1 minute'
      where id = any($1)`, [sessionIds]);
    await admin.query(`update public.inventory_reservations
        set created_at = clock_timestamp() - interval '2 hours', expires_at = clock_timestamp() - interval '1 minute'
      where checkout_session_id = any($1)`, [sessionIds]);
  };
  // El barrido es global: en una base compartida con otras suites puede vencer sesiones
  // ajenas. Se descuentan para que la cuenta de las propias sea exacta.
  const foreignExpiredSince = async (since) => (await one(`select count(*)::int as n from public.checkout_sessions
     where business_id <> $1 and status = 'expired' and updated_at >= $2`, [BUSINESS, since])).n;
  const dbNow = async () => (await one('select clock_timestamp() as at')).at;
  const sessionsOf = (ids) => rows(`select s.id, s.status,
      (select array_agg(r.status || ':' || coalesce(r.release_reason, '-') order by r.id)
         from public.inventory_reservations r where r.checkout_session_id = s.id) as reservations
    from public.checkout_sessions s where s.id = any($1) order by s.id`, [ids]);

  try {
    // ── Fixture: un comercio abierto con Mercado Pago conectado y su equipo ───
    await admin.query(`insert into auth.users(id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
      values ($1,'authenticated','authenticated','stock-race-owner@example.invalid','',now(),'{}','{}',now(),now()),
             ($2,'authenticated','authenticated','stock-race-staff@example.invalid','',now(),'{}','{}',now(),now()),
             ($3,'authenticated','authenticated','stock-race-manager@example.invalid','',now(),'{}','{}',now(),now())`, [OWNER, STAFF, MANAGER]);
    await admin.query(`insert into auth.users(id,aud,role,encrypted_password,raw_app_meta_data,raw_user_meta_data,is_anonymous,created_at,updated_at)
      select id,'authenticated','authenticated','','{}','{}',true,now(),now() from unnest($1::uuid[]) as id`,
    [Array.from({ length: CUSTOMERS }, (_, index) => customer(index + 1))]);
    // Los topes del guardián de admisión quedan altos: acá lo único que puede frenar
    // a un comprador es el stock. `abandoned_order_minutes` en su máximo (7 días):
    // sólo vence por desatención el pedido que el escenario 8 envejece a propósito.
    await admin.query(`insert into public.businesses(id,name,slug,status,is_active,ordering_enabled,ordering_verified,
        ordering_verified_at,ordering_verified_by,currency_code,pickup_enabled,delivery_enabled,delivery_fee,minimum_delivery_subtotal,
        max_pending_orders_per_customer,order_rate_limit_per_10_minutes,order_ip_rate_limit_per_10_minutes,
        max_pending_orders_per_ip,order_business_rate_limit_per_10_minutes,abandoned_order_minutes)
      values ($1,'TABA CARRERA DE STOCK','taba-carrera-stock','open',true,true,true,now(),$2,'ARS',true,false,0,0,
        1000,1000,1000,1000,100000,10080)`, [BUSINESS, OWNER]);
    await admin.query(`insert into public.business_members(business_id,user_id,role,is_active)
      values ($1,$2,'owner',true), ($1,$3,'staff',true), ($1,$4,'admin',true)`, [BUSINESS, OWNER, STAFF, MANAGER]);
    await admin.query(`insert into public.identity_sessions(session_id,user_id,business_id,role_at_login,client)
      values ($1,$2,$5,'owner','panel_web'), ($3,$4,$5,'staff','panel_web'), ($6,$7,$5,'admin','panel_web')`,
    [SESSION[OWNER], OWNER, SESSION[STAFF], STAFF, BUSINESS, SESSION[MANAGER], MANAGER]);
    await admin.query(`insert into public.business_payment_settings(business_id,enabled,environment,checkout_mode,currency,reserve_stock,
        collector_id,application_id,configured_at,verified_at)
      values ($1,true,'test','checkout_pro','ARS',true,$2,$3,clock_timestamp(),clock_timestamp())`, [BUSINESS, COLLECTOR, APPLICATION]);
    await admin.query(`insert into public.mp_seller_connections(business_id,environment,seller_id,application_id,status,protected_tokens,expires_at)
      values ($1,'test',$2,$3,'connected','ciphertext-only-local-fixture',now() + interval '2 days')`, [BUSINESS, COLLECTOR, APPLICATION]);

    // ── 1 · la última unidad, dos compradores, diez rondas ────────────────────
    {
      let firstDispatchedWon = 0;
      for (let round = 1; round <= 10; round += 1) {
        const item = await newProduct(`s01-r${pad(round)}`, 1);
        const [a, b] = customers(2);
        const tasks = [manualOrder(a, `stock-race-s01-r${pad(round)}-a`, item, 1), manualOrder(b, `stock-race-s01-r${pad(round)}-b`, item, 1)];
        if (round % 2 === 0) tasks.reverse();
        const results = await race(tasks);
        const outcome = await settle(`ultima unidad, ronda ${round}`, item, results);
        assert.equal(outcome.unique.size, 1, `ronda ${round}: exactamente un pedido por la ultima unidad -> ${codes(results)}`);
        assert.equal(outcome.refused.length, 1, `ronda ${round}: el otro comprador queda afuera por stock`);
        assert.equal(outcome.state.stock, 0, `ronda ${round}: stock 0`);
        if (results[0].ok) firstDispatchedWon += 1;
      }
      log(`STOCK_RACE_LAST_UNIT: 10 rondas, dos clientes por la ultima unidad -> 1 pedido, stock 0, el otro rechazado por stock`
        + ` (gano la primera llamada ${firstDispatchedWon}/10): PASS`);
    }

    // ── 2 · diez a la vez por tres unidades ───────────────────────────────────
    {
      const item = await newProduct('s02', 3);
      const results = await race(customers(10).map((id, index) => manualOrder(id, `stock-race-s02-${pad(index)}`, item, 1)));
      const outcome = await settle('diez por tres', item, results);
      assert.equal(outcome.unique.size, 3, `entran exactamente 3 -> ${codes(results)}`);
      assert.equal(outcome.refused.length, 7, 'los otros 7 quedan afuera por stock');
      assert.equal(outcome.state.stock, 0, 'stock 0');
      // Lo mismo pidiendo de a 2: entra uno, queda 1 unidad y a los otros nueve no les
      // alcanza. El producto sigue publicado, así que el rechazo es el de stock a secas.
      const pairs = await newProduct('s02-pares', 3);
      const short = await settle('diez por tres, de a dos', pairs,
        await race(customers(10).map((id, index) => manualOrder(id, `stock-race-s02-p${pad(index)}`, pairs, 2))));
      assert.equal(short.unique.size, 1, 'entra exactamente un pedido de 2');
      assert.equal(short.state.stock, 1, 'queda 1 unidad');
      assert.ok(short.refused.length === 9 && short.refused.every((result) => result.code === '23514'),
        `los otros 9 reciben 23514 stock insuficiente -> ${codes(short.refused)}`);
      const [last] = customers(1);
      const single = await settle('diez por tres, la unidad que quedo', pairs, await race([manualOrder(last, 'stock-race-s02-last', pairs, 1)]));
      assert.equal(single.unique.size, 1, 'la unidad que quedo se vende');
      log('STOCK_RACE_TEN_FOR_THREE: stock 3, 10 clientes a la vez -> 3 pedidos, stock 0, 7 rechazados por stock;'
        + ' pidiendo de a 2 -> 1 pedido, queda 1, 9 rechazados con 23514: PASS');
    }

    // ── 3 · cincuenta a la vez, cantidades mezcladas ──────────────────────────
    {
      const item = await newProduct('s03', 20);
      const results = await race(customers(50).map((id, index) => manualOrder(id, `stock-race-s03-${pad(index)}`, item, 1 + (index % 3))));
      const outcome = await settle('cincuenta por veinte', item, results);
      assert.ok(outcome.units <= 20, `las unidades aceptadas (${outcome.units}) no superan 20`);
      assert.equal(outcome.state.stock, 20 - outcome.units, 'stock = 20 - unidades aceptadas');
      assert.equal(outcome.accepted.length, outcome.unique.size, 'cada cliente aceptado tiene su propio pedido');
      log(`STOCK_RACE_FIFTY_MIXED: stock 20, 50 clientes pidiendo 1, 2 o 3 -> ${outcome.unique.size} pedidos por ${outcome.units} unidades,`
        + ` stock ${outcome.state.stock}, ${outcome.refused.length} rechazados por stock: PASS`);
    }

    // ── 4 · cincuenta sesiones de Mercado Pago por cinco unidades ─────────────
    {
      const item = await newProduct('s04', 5);
      const results = await race(customers(50).map((id, index) => checkout(id, `stock-race-s04-${pad(index)}`, item, 1)));
      const outcome = await settle('cincuenta sesiones por cinco', item, results);
      assert.ok(outcome.state.reserved <= 5, 'a lo sumo 5 unidades reservadas');
      assert.equal(outcome.unique.size, 5, `exactamente 5 sesiones con reserva -> ${codes(results)}`);
      assert.equal(outcome.state.reserved, 5, '5 unidades en reservas activas');
      assert.equal(outcome.state.stock, 0, 'stock = 5 - 5 reservadas');
      assert.equal(outcome.refused.length, 45, 'las otras 45 quedan afuera por stock');
      const sessions = await sessionsOf([...outcome.unique.keys()]);
      assert.ok(sessions.every((row) => row.status === 'ready_for_payment' && row.reservations.join() === 'active:-'),
        'cada sesion aceptada queda lista para pagar con su reserva activa');
      log('STOCK_RACE_CHECKOUT_FIFTY: stock 5, 50 sesiones de Mercado Pago a la vez -> 5 reservas activas, stock 0, 45 rechazadas por stock: PASS');
    }

    // ── 5 · las dos puertas a la vez ──────────────────────────────────────────
    {
      const item = await newProduct('s05', 6);
      const results = await race(customers(50).map((id, index) => (index % 2 === 0
        ? manualOrder(id, `stock-race-s05-m${pad(index)}`, item, 1 + ((index / 2) % 2))
        : checkout(id, `stock-race-s05-c${pad(index)}`, item, 1 + (((index - 1) / 2) % 2)))));
      const outcome = await settle('las dos puertas', item, results);
      assert.ok(outcome.state.held + outcome.state.reserved <= 6, 'pedidos + reservas no superan 6');
      assert.equal(outcome.state.stock, 6 - (outcome.state.held + outcome.state.reserved), 'stock = 6 - (pedidos + reservas)');
      assert.equal(outcome.state.held + outcome.state.reserved, outcome.units, 'lo retenido es lo aceptado');
      log(`STOCK_RACE_BOTH_DOORS: stock 6, 25 pedidos y 25 sesiones a la vez -> ${outcome.state.held} unidades en pedidos`
        + ` + ${outcome.state.reserved} en reservas, stock ${outcome.state.stock}: PASS`);
    }

    // ── 6 · checkout abandonado: el barrido desde cinco conexiones ────────────
    {
      const item = await newProduct('s06', 3);
      const holders = customers(3);
      const held = await settle('checkout abandonado: reservar', item,
        await race(holders.map((id, index) => checkout(id, `stock-race-s06-h${pad(index)}`, item, 1))));
      assert.equal(held.unique.size, 3, 'tres sesiones se llevan las tres unidades');
      const sessionIds = held.accepted.map(idOf);
      // Dos llegaron a Checkout Pro (preferencia creada); la tercera ni eso.
      await preference(sessionIds[0], holders[0], 's06-0');
      await preference(sessionIds[1], holders[1], 's06-1');
      const [late] = customers(1);
      const blocked = await settle('checkout abandonado: la reserva retiene', item,
        await race([manualOrder(late, 'stock-race-s06-late', item, 1)]));
      assert.equal(blocked.refused.length, 1, 'mientras la reserva vive, nadie mas compra esa unidad');

      // Lo que ya estuviera vencido en la base (de otra suite) no entra en la cuenta.
      await mustCall('barrido previo', service, sweep.sql);
      await expire(sessionIds);
      const since = await dbNow();
      const sweeps = await race(Array.from({ length: 5 }, () => sweep));
      assert.ok(sweeps.every((result) => result.ok), `el barrido concurrente no falla -> ${codes(sweeps)}`);
      const foreign = await foreignExpiredSince(since);
      assert.equal(sum(sweeps.map((result) => result.value)) - foreign, 3, 'entre los cinco barridos cada sesion vence exactamente una vez');
      let state = await assertConserved(item, 'checkout abandonado: barrido');
      assert.equal(state.stock, 3, 'cada unidad vuelve una vez: stock 3, no 6');
      assert.equal(state.reserved, 0, 'no queda reserva activa');
      assert.equal(state.available, true, 'el producto vuelve a ofrecerse');
      assert.deepEqual((await sessionsOf(sessionIds)).map((row) => `${row.status}/${row.reservations.join()}`),
        Array(3).fill('expired/released:checkout_expired'), 'las tres sesiones vencidas, cada reserva liberada una vez');
      const again = await race(Array.from({ length: 5 }, () => sweep));
      assert.ok(again.every((result) => result.ok), `repetir el barrido no falla -> ${codes(again)}`);
      assert.equal(sum(again.map((result) => result.value)) - (await foreignExpiredSince(since) - foreign), 0,
        'repetir el barrido no vence nada');
      state = await assertConserved(item, 'checkout abandonado: barrido repetido');
      assert.equal(state.stock, 3, 'repetir el barrido no devuelve stock otra vez');

      await refresh(item);
      const rebuy = await settle('checkout abandonado: recompra', item,
        await race(customers(5).map((id, index) => manualOrder(id, `stock-race-s06-b${pad(index)}`, item, 1))));
      assert.equal(rebuy.unique.size, 3, 'las tres unidades devueltas se venden, y solo tres');
      assert.equal(rebuy.state.stock, 0, 'stock 0');
      log('STOCK_RACE_ABANDONED_CHECKOUT: 3 sesiones vencidas, barrido desde 5 conexiones (dos veces) -> stock vuelve a 3 una sola vez,'
        + ' 5 clientes recompran 3: PASS');
    }

    // ── 7 · pago rechazado: la reserva sigue; vuelve una vez al vencer ────────
    {
      const item = await newProduct('s07', 2);
      const [payer, other, eager, keen, later] = customers(5);
      const held = await settle('pago rechazado: reservar', item, await race([checkout(payer, 'stock-race-s07-pay', item, 2)]));
      const [sessionId] = held.accepted.map(idOf);
      await preference(sessionId, payer, 's07');
      const rejected = await snapshotTask(sessionId, 'STOCK-RACE-PAY-S07', 'rejected', 'stock-race-s07-rejected');
      // El mismo rechazo llega tres veces a la vez mientras otro cliente quiere las unidades.
      const during = await race([rejected, rejected, rejected, manualOrder(other, 'stock-race-s07-other', item, 2)]);
      assert.ok(during.slice(0, 3).every((result) => result.ok && result.value.ok === true && result.value.finalize_required === false),
        `el rechazo se registra sin pedir finalizacion -> ${codes(during.slice(0, 3))}`);
      await settle('pago rechazado: la reserva retiene', item, during.slice(3));
      let state = await assertConserved(item, 'pago rechazado');
      assert.deepEqual({ stock: state.stock, reserved: state.reserved }, { stock: 0, reserved: 2 },
        'un pago rechazado NO libera la reserva: las 2 unidades siguen reservadas');
      assert.deepEqual((await sessionsOf([sessionId])).map((row) => `${row.status}/${row.reservations.join()}`), ['redirected/active:-'],
        'la sesion sigue en Checkout Pro con su reserva activa');
      assert.equal((await one(`select count(*)::int as n from public.payment_events pe join public.payment_intents pi on pi.id = pe.payment_intent_id
         where pi.checkout_session_id = $1 and pe.event_type = 'payment.rejected'`, [sessionId])).n, 1, 'tres avisos iguales, un evento');

      await mustCall('barrido previo', service, sweep.sql);
      await expire([sessionId]);
      const since = await dbNow();
      // Cinco barridos, dos avisos de rechazo repetidos y dos compradores que ya quieren
      // las unidades, todos a la vez: la devolución y la venta compiten por la misma fila.
      const expiry = await race([sweep, rejected, manualOrder(eager, 'stock-race-s07-eager', item, 2), sweep, sweep, rejected,
        manualOrder(keen, 'stock-race-s07-keen', item, 2), sweep, sweep]);
      const others = expiry.filter((result) => !result.task.door);
      assert.ok(others.every((result) => result.ok), `barrido y avisos concurrentes no fallan -> ${codes(others)}`);
      const swept = sum(expiry.filter((result) => result.task === sweep).map((result) => result.value)) - await foreignExpiredSince(since);
      assert.equal(swept, 1, 'la sesion vence exactamente una vez');
      assert.deepEqual((await sessionsOf([sessionId])).map((row) => `${row.status}/${row.reservations.join()}`),
        ['expired/released:checkout_expired'], 'sesion vencida, reserva liberada una vez');
      const during2 = await settle('pago rechazado: vencimiento', item, expiry.filter((result) => result.task.door), { returned: 2 });
      assert.ok(during2.units === 0 || during2.units === 2, 'las 2 unidades devueltas se venden a un solo comprador o a ninguno');
      assert.deepEqual({ back: during2.state.stock + during2.units, reserved: during2.state.reserved }, { back: 2, reserved: 0 },
        'el stock vuelve una vez: 2 unidades entre stock y venta nueva, no 4');

      const rebuy = await settle('pago rechazado: recompra', item, await race([manualOrder(later, 'stock-race-s07-later', item, 2)]));
      assert.equal(during2.unique.size + rebuy.unique.size, 1, 'las 2 unidades devueltas se venden exactamente una vez');
      assert.equal(rebuy.state.stock, 0, 'stock 0');
      log('STOCK_RACE_REJECTED_THEN_EXPIRED: pago rechazado conserva la reserva (stock 0), vence con 5 barridos, 2 avisos y 2 compradores a la vez'
        + ` -> stock vuelve 2 una sola vez y se revende una vez (${during2.units ? 'durante' : 'despues de'} la carrera): PASS`);
    }

    // ── 8 · seis cancelaciones del mismo pedido a la vez ──────────────────────
    {
      const item = await newProduct('s08', 2);
      const [owner, next] = customers(2);
      const placed = await settle('cancelacion: pedido', item, await race([manualOrder(owner, 'stock-race-s08-order', item, 2)]));
      const [orderId] = placed.accepted.map(idOf);
      // Envejecido 8 días: con `abandoned_order_minutes` = 7 días ya vence por desatención.
      await admin.query(`update public.orders set created_at = clock_timestamp() - interval '8 days' where id = $1`, [orderId]);
      const before = await one('select status, revision, inventory_released_at, payment_method, manual_payment_status from public.orders where id = $1', [orderId]);
      assert.deepEqual({ status: before.status, released: before.inventory_released_at, method: before.payment_method, payment: before.manual_payment_status },
        { status: 'received', released: null, method: 'cash', payment: 'pending' }, 'pedido en efectivo, recibido y sin atender: las tres puertas son legales');
      const byBusiness = (user, revision, key) => ({ kind: 'business', identity: operator(user),
        sql: 'select public.cancel_order($1::uuid, $2::bigint, $3, $4) as result', params: [orderId, revision, 'Carrera de stock: cancelacion simultanea', key] });
      const byCustomer = (key) => ({ kind: 'customer', identity: buyer(owner),
        sql: 'select public.cancel_own_order($1::uuid, $2, $3) as result', params: [orderId, key, 'Carrera de stock: me arrepenti'] });
      const byTimeout = { kind: 'timeout', identity: service, sql: 'select public.expire_unattended_manual_orders(100) as result', params: [] };
      const cancelledOnce = async (where, revision) => {
        const order = await one('select status, revision, inventory_released_at from public.orders where id = $1', [orderId]);
        assert.equal(order.status, 'cancelled', `${where}: un solo estado final`);
        assert.ok(order.inventory_released_at, `${where}: el pedido marca su stock como devuelto`);
        assert.equal(Number(order.revision), revision, `${where}: el pedido cambio una sola vez`);
        const events = await one(`select
            count(*) filter (where event_type = 'order.status_changed' and metadata ->> 'next_status' = 'cancelled')::int as cancelled,
            count(*) filter (where event_type in ('business_cancel_reason', 'order.cancelled_by_customer', 'order.expired_unattended'))::int as reasons,
            (select count(*)::int from public.business_command_receipts r where r.order_id = $1 and r.command_type = 'cancel_order') as receipts
          from public.order_events where order_id = $1`, [orderId]);
        assert.equal(events.cancelled, 1, `${where}: una sola transicion a cancelado`);
        assert.equal(events.reasons, 1, `${where}: un solo motivo, el de quien cancelo`);
        assert.ok(events.receipts <= 1, `${where}: a lo sumo un recibo de cancelacion`);
        const state = await assertConserved(item, where);
        assert.equal(state.stock, 2, `${where}: el stock vuelve una vez: +2, no +4`);
        assert.equal(state.returned, 2, `${where}: las 2 unidades del pedido figuran devueltas`);
        assert.equal(state.available, true, `${where}: el producto vuelve a ofrecerse`);
      };
      // Limpio o conflicto reintentable: nunca otra cosa.
      const clean = (result) => (result.ok
        ? (result.task.kind === 'timeout' ? Number.isInteger(result.value) : result.value.status === 'cancelled')
        : result.task.kind === 'business' && result.code === 'PT409' && /^revision desactualizada: esperada \d+, actual \d+$/.test(result.message));

      // Primero la puerta del vencimiento sola, tres a la vez sobre otro pedido: así se
      // sabe que está viva antes de mezclarla con las otras dos.
      const lone = await newProduct('s08-vencimiento', 1);
      const [forgotten] = customers(1);
      const stale = await settle('vencimiento: pedido', lone, await race([manualOrder(forgotten, 'stock-race-s08-forgotten', lone, 1)]));
      const [staleId] = stale.accepted.map(idOf);
      await admin.query(`update public.orders set created_at = clock_timestamp() - interval '8 days' where id = $1`, [staleId]);
      const timeouts = await race([byTimeout, byTimeout, byTimeout]);
      assert.ok(timeouts.every((result) => result.ok && Number.isInteger(result.value)), `el vencimiento concurrente no falla -> ${codes(timeouts)}`);
      assert.ok(sum(timeouts.map((result) => result.value)) >= 1, 'alguno de los tres vencimientos tomo el pedido');
      assert.deepEqual(await one(`select o.status, o.inventory_released_at is not null as released,
          (select count(*)::int from public.order_events e where e.order_id = o.id and e.event_type = 'order.expired_unattended') as expired,
          (select count(*)::int from public.order_events e where e.order_id = o.id and e.event_type = 'order.status_changed') as changes
        from public.orders o where o.id = $1`, [staleId]), { status: 'cancelled', released: true, expired: 1, changes: 1 },
      'el pedido sin atender vence una sola vez');
      const loneState = await assertConserved(lone, 'vencimiento');
      assert.deepEqual({ stock: loneState.stock, returned: loneState.returned, available: loneState.available },
        { stock: 1, returned: 1, available: true }, 'el vencimiento devuelve la unidad una vez: stock 1, no 2 ni 3');

      const revision = Number(before.revision);
      const storm = await race([
        byBusiness(MANAGER, revision, 'stock-race-s08-manager'),
        byCustomer('stock-race-s08-customer'),
        byBusiness(MANAGER, revision, 'stock-race-s08-manager'),
        byTimeout,
        byBusiness(OWNER, revision, 'stock-race-s08-owner'),
        byCustomer('stock-race-s08-customer'),
      ]);
      assert.ok(storm.every(clean), `cada cancelacion termina limpia o en conflicto reintentable -> ${codes(storm)}`);
      await cancelledOnce('cancelacion simultanea', revision + 1);
      const winner = (await one(`select event_type from public.order_events where order_id = $1
          and event_type in ('business_cancel_reason', 'order.cancelled_by_customer', 'order.expired_unattended')`, [orderId])).event_type;
      const conflicts = storm.filter((result) => !result.ok).length;

      // Repetir: cada puerta de nuevo, una por una y después las seis juntas. Con la
      // revisión al día es un no-op. El MISMO envío de antes (misma clave, misma
      // revisión) devuelve el recibo guardado si fue el que canceló y, si no, choca
      // limpio contra la revisión nueva.
      const noOp = (result) => (result.ok && result.task.kind !== 'timeout'
        ? result.value.status === 'cancelled' && (result.value.idempotent_no_op === true || result.value.idempotent_replay === true)
        : clean(result));
      const repeat = [
        byBusiness(MANAGER, revision + 1, 'stock-race-s08-manager-again'),
        byCustomer('stock-race-s08-customer-again'),
        byBusiness(MANAGER, revision, 'stock-race-s08-manager'),
        byTimeout,
        byBusiness(OWNER, revision + 1, 'stock-race-s08-owner-again'),
        byCustomer('stock-race-s08-customer'),
      ];
      for (const task of repeat) {
        const [result] = await race([task]);
        assert.ok(noOp(result), `repetir la cancelacion no cancela otra vez -> ${codes([result])}`);
        if (task.params[1] !== revision) assert.ok(result.ok, `con la revision al dia, repetir no es un error -> ${codes([result])}`);
      }
      const replay = await race(repeat);
      assert.ok(replay.every(noOp), `seis repeticiones a la vez son no-ops -> ${codes(replay)}`);
      await cancelledOnce('cancelacion repetida', revision + 1);

      await refresh(item);
      const rebuy = await settle('cancelacion: recompra', item, await race([manualOrder(next, 'stock-race-s08-next', item, 2)]));
      assert.equal(rebuy.unique.size, 1, 'otro cliente compra las 2 unidades devueltas');
      // Ese pedido se entrega: las unidades salen del local y dejan de estar «retenidas».
      let delivered = { id: idOf(rebuy.accepted[0]), revision: Number(rebuy.accepted[0].value.revision) };
      for (const status of ['accepted', 'preparing', 'ready', 'delivered']) {
        const moved = await mustCall(`pasar el pedido a ${status}`, operator(STAFF),
          'select public.transition_order($1::uuid, $2::bigint, $3, $4) as result',
          [delivered.id, delivered.revision, status, `stock-race-s08-${status}`]);
        delivered = { id: delivered.id, revision: Number(moved.revision) };
      }
      const final = await assertConserved(item, 'cancelacion: entrega');
      assert.deepEqual({ stock: final.stock, held: final.held, consumed: final.consumed, returned: final.returned },
        { stock: 0, held: 0, consumed: 2, returned: 2 }, '2 unidades devueltas por la cancelacion y 2 entregadas');
      log(`STOCK_RACE_CANCELLATION: 6 cancelaciones a la vez (comercio x3, cliente x2, vencimiento) -> cancela ${winner},`
        + ` ${conflicts} conflicto(s) PT409, stock +2 una sola vez, repetir es no-op, se revende y se entrega: PASS`);
    }

    // ── 9 · el mismo pago aprobado diez veces, diez finalizaciones ────────────
    {
      const item = await newProduct('s09', 3);
      const [payer] = customers(1);
      const held = await settle('webhook duplicado: reservar', item, await race([checkout(payer, 'stock-race-s09-pay', item, 2)]));
      const [sessionId] = held.accepted.map(idOf);
      await preference(sessionId, payer, 's09');
      const approved = await snapshotTask(sessionId, 'STOCK-RACE-PAY-S09', 'approved', 'stock-race-s09-approved');
      const finalize = { identity: service, sql: 'select public.finalize_paid_checkout_session($1::uuid) as result', params: [sessionId] };

      const webhooks = await race(Array.from({ length: 10 }, () => approved));
      assert.ok(webhooks.every((result) => result.ok && result.value.ok === true && result.value.manual_review_required === false),
        `los diez avisos del mismo pago se registran sin error ni revision manual -> ${codes(webhooks)}`);
      // Diez finalizaciones mientras siguen llegando diez avisos repetidos.
      const closing = await race(Array.from({ length: 20 }, (_, index) => (index % 2 === 0 ? finalize : approved)));
      assert.ok(closing.every((result) => result.ok && result.value.ok === true), `finalizar y avisar a la vez no falla -> ${codes(closing)}`);
      const finals = closing.filter((result) => result.task === finalize).map((result) => result.value);
      assert.equal(new Set(finals.map((value) => value.order_id)).size, 1, 'las diez finalizaciones devuelven el mismo pedido');
      assert.equal(finals.filter((value) => value.idempotent === false).length, 1, 'una sola finalizacion crea el pedido');
      const orderId = finals[0].order_id;
      ledger.get(item).orders.set(orderId, { quantity: 2, lines: 1 });

      const paid = await one(`select
          (select count(*)::int from public.orders o where o.business_id = $2 and o.client_request_id = 'mp_' || replace(cs.id::text, '-', '')) as orders,
          (select array_agg(r.status order by r.id) from public.inventory_reservations r where r.checkout_session_id = cs.id) as reservations,
          (select count(*)::int from public.inventory_reservations r where r.checkout_session_id = cs.id and r.converted_at is not null) as converted,
          cs.status as session_status, cs.completed_order_id, pi.order_id, pi.internal_status, pi.provider_payment_id, pi.provider_status,
          (select count(*)::int from public.payment_events pe where pe.payment_intent_id = pi.id and pe.event_type = 'payment.approved') as approved_events,
          (select count(*)::int from public.payment_events pe where pe.payment_intent_id = pi.id and pe.event_type = 'payment.order_completed') as completed_events,
          (select count(*)::int from public.payment_events pe where pe.payment_intent_id = pi.id
            and pe.event_type in ('payment.duplicate_approved', 'payment.secondary_payment', 'payment.manual_review_required',
              'payment.security_review_required', 'payment.post_completion_anomaly')) as anomalies,
          (select count(distinct pe.provider_event_id)::int from public.payment_events pe where pe.payment_intent_id = pi.id and pe.provider_event_id is not null) as payment_ids
        from public.checkout_sessions cs join public.payment_intents pi on pi.checkout_session_id = cs.id where cs.id = $1`, [sessionId, BUSINESS]);
      assert.deepEqual(paid, {
        orders: 1, reservations: ['converted'], converted: 1,
        session_status: 'completed', completed_order_id: orderId, order_id: orderId, internal_status: 'completed',
        provider_payment_id: 'STOCK-RACE-PAY-S09', provider_status: 'approved',
        approved_events: 1, completed_events: 1, anomalies: 0, payment_ids: 1,
      }, 'un pedido, la reserva convertida una vez, un pago');
      const state = await assertConserved(item, 'webhook duplicado');
      assert.deepEqual({ stock: state.stock, reserved: state.reserved, held: state.held }, { stock: 1, reserved: 0, held: 2 },
        'el stock se desconto una sola vez, al reservar: 3 - 2 = 1');
      await assertDoors(item, 'webhook duplicado');
      log('STOCK_RACE_DUPLICATE_WEBHOOK: el mismo pago aprobado 20 veces y 10 finalizaciones a la vez -> 1 pedido,'
        + ' reserva convertida una vez, stock descontado una vez, un pago: PASS');
    }

    // ── 10 · tormenta de reintentos por la última unidad ──────────────────────
    {
      const winners = [];
      for (let round = 1; round <= 2; round += 1) {
        const item = await newProduct(`s10-r${pad(round)}`, 1);
        const [retrier, rival] = customers(2);
        const storm = Array.from({ length: 25 }, () => manualOrder(retrier, `stock-race-s10-r${pad(round)}-same`, item, 1));
        const other = manualOrder(rival, `stock-race-s10-r${pad(round)}-rival`, item, 1);
        // El rival sale primero en una ronda y último en la otra.
        const results = await race(round === 1 ? [other, ...storm] : [...storm, other]);
        const outcome = await settle(`reintentos, ronda ${round}`, item, results);
        assert.equal(outcome.unique.size, 1, `ronda ${round}: nunca mas de una unidad vendida -> ${codes(results)}`);
        assert.equal(outcome.state.stock, 0, `ronda ${round}: stock 0`);
        const mine = results.filter((result) => result.task.customerId === retrier);
        const theirs = results.find((result) => result.task.customerId === rival);
        if (theirs.ok) {
          assert.ok(mine.every((result) => !result.ok), `ronda ${round}: si gana el rival, los 25 reintentos quedan afuera por stock`);
        } else {
          assert.ok(mine.every((result) => result.ok), `ronda ${round}: si gana el que reintenta, sus 25 envios se aceptan`);
          assert.equal(new Set(mine.map(idOf)).size, 1, `ronda ${round}: las 25 respuestas son el mismo pedido`);
          assert.equal((await one('select count(*)::int as n from private.order_intake_log where order_id = $1', [idOf(mine[0])])).n, 1,
            `ronda ${round}: una sola admision contada`);
        }
        winners.push(theirs.ok ? 'gana el rival, 25 rechazos por stock' : 'gana el que reintenta, 25 respuestas con el mismo pedido');
      }
      log(`STOCK_RACE_RETRY_STORM: stock 1, el mismo pedido 25 veces y otro cliente a la vez, 2 rondas -> 1 unidad vendida (${winners.join('; ')}): PASS`);
    }

    // ── Invariantes finales, producto por producto ────────────────────────────
    let committed = 0;
    for (const [productId, entry] of ledger) {
      const state = await assertConserved(productId, 'invariante final');
      await assertDoors(productId, 'invariante final');
      assert.ok(state.reserved + state.held + state.consumed <= entry.initial,
        `invariante final: lo comprometido de ${entry.label} no supera su stock inicial`);
      committed += state.reserved + state.held + state.consumed;
    }
    const loose = await one(`select
        (select count(*)::int from public.products p where p.business_id = $1 and (p.stock is null or p.stock < 0)) as negative,
        (select count(*)::int from public.products p where p.business_id = $1) as products,
        (select count(*)::int from public.orders o where o.business_id = $1
           and not exists (select 1 from public.order_items oi where oi.order_id = o.id)) as orders_without_items,
        (select count(*)::int from public.checkout_sessions s where s.business_id = $1
           and not exists (select 1 from public.inventory_reservations r where r.checkout_session_id = s.id)) as sessions_without_reservation,
        (select count(*)::int from public.inventory_reservations r join public.checkout_sessions s on s.id = r.checkout_session_id
          where s.business_id = $1 and r.status = 'active' and s.status in ('expired', 'cancelled', 'completed')) as active_on_closed_session,
        (select count(*)::int from public.inventory_reservations r join public.checkout_sessions s on s.id = r.checkout_session_id
          where s.business_id = $1 and r.status = 'converted' and s.completed_order_id is null) as converted_without_order`, [BUSINESS]);
    assert.deepEqual(loose, { negative: 0, products: ledger.size, orders_without_items: 0, sessions_without_reservation: 0,
      active_on_closed_session: 0, converted_without_order: 0 }, 'nada suelto en el comercio de la carrera');
    const refusalSummary = [...refusals].sort().map(([label, count]) => `${label} x${count}`).join(' | ');
    log(`STOCK_RACE_REFUSALS: ${refusalSummary}`);
    log(`STOCK_RACE_CONSERVATION: ${ledger.size} productos, ${sum([...ledger.values()].map((entry) => entry.initial))} unidades iniciales,`
      + ` ${committed} comprometidas, stock inicial = stock + reservas + pedidos + entregado en todos: PASS`);
    log('OVERSALE: 0');
    log('NEGATIVE_STOCK: 0');
    log(`DEADLOCKS: ${tally.deadlocks}${tally.deadlocks ? ` (reintentos resueltos: ${tally.deadlockRetriesOk})` : ''}`);
    log(`STOCK_RACE_DONE: ${tally.calls} llamadas en conexiones propias, la mas lenta ${tally.slowestMs} ms, ${((Date.now() - startedAt) / 1000).toFixed(1)} s`);
  } finally {
    await admin.end();
  }
}

const invoked = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(import.meta.filename);
if (invoked) {
  if (process.env.TABA_LOCAL_INTAKE_DB !== '1') {
    console.error('Refusing to run without TABA_LOCAL_INTAKE_DB=1: this suite writes fixtures into a disposable database.');
    process.exit(2);
  }
  const url = process.argv[2];
  if (!url) {
    console.error('usage: TABA_LOCAL_INTAKE_DB=1 node scripts/order-intake/stock-race.mjs <postgres url of a disposable database>');
    process.exit(2);
  }
  assert.ok(['127.0.0.1', 'localhost'].includes(new URL(url).hostname), 'solo contra una base local descartable');
  const { default: pg } = await import('pg');
  await runStockRace(async () => {
    // Los mismos topes que la conexión de CI (tests/fixtures/release-v5-database.mjs).
    const client = new pg.Client({ connectionString: url, statement_timeout: 30_000, lock_timeout: 5_000 });
    client.on('error', () => {});
    await client.connect();
    return client;
  });
}
