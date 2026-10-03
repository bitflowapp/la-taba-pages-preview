// TABA · Idempotencia global · CARRERAS REALES: todo comando que puede llegar dos veces
//
// pgTAP corre en una sola transacción: prueba qué contesta un comando repetido DESPUÉS
// del primero, no qué pasa cuando las dos copias llegan en el mismo instante. Acá cada
// copia abre SU conexión, hace begin, fija el rol y `request.jwt.claims` de quien llama
// de verdad, llama a la función pública, confirma y cierra, que es lo que hace PostgREST.
// Todas las conexiones de una carrera quedan abiertas y con la transacción iniciada ANTES
// de disparar: las llamadas salen juntas, no escalonadas por el tiempo de conexión.
//
// Para cada comando se prueban dos cosas: (a) el MISMO envío repetido N veces a la vez
// tiene un solo efecto y cada copia recibe una respuesta definida; (b) dos envíos
// DISTINTOS que compiten por lo mismo: gana uno.
//
//    1. CHECKOUT            la misma sesión de pago x20; la misma clave con otro carrito;
//                           dos clientes con la misma clave.
//    2. PREFERENCIA         preparar x10, asentar x10, reintento controlado x5.
//    3. WEBHOOK Y COLA      el mismo aviso x20, firmado y sin firmar a la vez, cinco workers
//                           reclamando, empezar/terminar/fallar el mismo trabajo a la vez.
//    4. TRANSICIONES        la misma transición x10, dos pestañas con claves distintas,
//                           la misma clave sobre dos pedidos.
//    5. COBRO MANUAL        confirmar x10, dos claves, dos medios; devolver x10.
//    6. ENTREGA             retiro x10; repartidor: código bueno x10 mezclado con códigos
//                           malos; el comercio cerrando su propio envío; y (6d) el comercio
//                           ofreciendo el pedido a otro repartidor mientras el primero acepta.
//    7. REEMBOLSO           la misma clave x10, dos claves por el total, la respuesta del
//                           proveedor x10, parcial + dos por el resto.
//    8. CANCELACIÓN DE PAGO la misma cancelación x10, dos claves, la marca «dudosa» contra el
//                           segundo toque, y la cancelación contra el aviso de aprobado del
//                           mismo pago (cinco rondas).
//    9. REARMADO vs REEMBOLSO  rearmar x5 contra un reembolso total de un cobro en revisión
//                           manual (cinco rondas, y dos con el rearmado llegando primero).
//   10. PERFIL Y DIRECCIÓN  guardar el mismo perfil y la misma dirección x10; dos pedidos de
//                           dirección principal; archivar la principal contra elegir otra.
//
// Lo que NO se repite acá porque ya corre en el gate, con conexiones reales:
//   · crear el mismo pedido x20 / x25            intake-race.mjs (2), stock-race.mjs (10)
//   · reservar, convertir y liberar stock una vez stock-race.mjs (4 a 7)
//   · seis cancelaciones del mismo pedido        stock-race.mjs (8)
//   · el mismo pago aprobado x20 + finalizar x10 stock-race.mjs (9)
//
// Al final, sobre todo lo que creó: ningún pedido sin renglones, ninguna sesión sin
// reserva, un pago del proveedor en un solo cobro, total = cobrado y devuelto <= cobrado
// en cada pedido pagado, ninguna reserva convertida y liberada, conservación de stock con
// la definición de `private.pos_reserved_quantity` y una sola fila por clave en cada tabla
// de recibos.
//
// Un deadlock (40P01) o un lock_timeout (55P03) no se esconden: se cuentan, se reintenta
// una vez como haría quien llama y las líneas DEADLOCKS y LOCK_TIMEOUTS dicen cuántos hubo
// y en qué carrera. Un deadlock que ningún DEFECTO explica también falla la corrida
// (UNEXPECTED_DEADLOCK); una espera agotada, que depende de la carga de la máquina, no.
// Donde una carrera libre depende de la suerte, además se fija el ORDEN DE LLEGADA de las
// mismas llamadas (`staged`): así un orden de candados invertido termina en deadlock
// siempre, no «a veces».
//
// Lo que la base hace hoy y no debería queda en un bloque `// DEFECTO:`: imprime una línea
// IDEMPOTENCY_DEFECT, la corrida sigue para medir el resto y el veredicto es
// GLOBAL_IDEMPOTENCY: FAIL (y la función lanza). Cada bloque comprueba el comportamiento
// correcto: cuando la base se arregla deja de dispararse solo, sin tocar este archivo.
//
// La usan scripts/run-release-v5-db.mjs (CI, contenedor sin red) y la corrida local contra
// una base descartable:
//   TABA_LOCAL_INTAKE_DB=1 node scripts/order-intake/idempotency-race.mjs postgres://postgres@127.0.0.1:55432/taba
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import path from 'node:path';
import process from 'node:process';

const BUSINESS = 'b7500000-0000-4000-8000-0000000000a1';
const OWNER = 'a7500000-0000-4000-8000-0000000000ff';
const STAFF = 'a7500000-0000-4000-8000-0000000000fe';
const RIDER = 'a7500000-0000-4000-8000-0000000000fd';
// El segundo repartidor: a quien el comercio le ofrece el pedido mientras el primero acepta (6d).
const RIDER_B = 'a7500000-0000-4000-8000-0000000000fc';
const SESSION = {
  [OWNER]: 'e7500000-0000-4000-8000-0000000000ff',
  [STAFF]: 'e7500000-0000-4000-8000-0000000000fe',
  [RIDER]: 'e7500000-0000-4000-8000-0000000000fd',
  [RIDER_B]: 'e7500000-0000-4000-8000-0000000000fc',
};
const COLLECTOR = 'idem-race-collector';
const APPLICATION = 'idem-race-app';
const CUSTOMERS = 60;
// Tope de conexiones abiertas a la vez (más la administrativa) y de aperturas en paralelo.
const MAX_AT_ONCE = 50;
const OPEN_BATCH = 10;
// Estados en los que un pedido retiene stock: los de `private.pos_reserved_quantity`.
const HOLDING = ['received', 'submitted', 'accepted', 'preparing', 'ready', 'assigned'];

const customer = (index) => `a7500000-0000-4000-8000-${String(index).padStart(12, '0')}`;
const product = (index) => `c7500000-0000-4000-8000-${String(index).padStart(12, '0')}`;
const requestKey = (index) => `d7500000-0000-4000-8000-${String(index).padStart(12, '0')}`;
const sha256 = (value) => createHash('sha256').update(value, 'utf8').digest('hex');
const sum = (values) => values.reduce((total, value) => total + value, 0);
const times = (count, build) => Array.from({ length: count }, (_, index) => build(index));
// Una consulta administrativa por vez: la conexión administrativa es una sola.
const inOrder = async (items, build) => {
  const built = [];
  for (const item of items) built.push(await build(item));
  return built;
};
const trackingToken = (key) => `${key}-${'t'.repeat(40)}`.slice(0, 48);

const buyer = (id) => ({ role: 'authenticated', claims: { sub: id, role: 'authenticated', is_anonymous: true } });
// Un integrante del comercio (dueño, operador o repartidor) con su sesión registrada.
const member = (id) => ({ role: 'authenticated', claims: { sub: id, role: 'authenticated', session_id: SESSION[id] } });
const service = { role: 'service_role', claims: { role: 'service_role' } };
// Las dos funciones SECURITY INVOKER de la preferencia (`get_mercadopago_payment_authority_v2`
// y `record_mercadopago_preference_created_v2`) llegan a `business_is_open`, que en la
// plataforma `service_role` ejecuta por los privilegios por defecto y en la base de CI no
// (no hay privilegios por defecto sobre funciones). Se llaman con el rol de la conexión,
// igual que en stock-race.mjs y en mercadopago_snapshot_finalization_hardening_test.sql.
const platform = { role: null, claims: { role: 'service_role' } };

const ok = (result) => result.ok;
const refusedWith = (result, code, message) => !result.ok && result.code === code && result.message === message;
const identical = (values) => new Set(values.map((value) => JSON.stringify(value))).size === 1;
const without = (value, ...keys) => Object.fromEntries(Object.entries(value).filter(([key]) => !keys.includes(key)));
const pick = (value, ...keys) => Object.fromEntries(keys.map((key) => [key, value[key]]));
const count = (results, test) => results.filter(test).length;

export async function runIdempotencyRace(connect, { log = console.log } = {}) {
  const admin = await connect();
  const startedAt = Date.now();
  const ledger = new Map();
  const families = [];
  const defects = [];
  const tally = { calls: 0, deadlocks: 0, lockTimeouts: 0, retriesOk: 0, slowestMs: 0, sites: new Map() };
  let customersUsed = 0;
  let productsUsed = 0;
  let keysUsed = 0;
  let providerRefunds = 0;

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
  const race = async (site, tasks) => {
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
    return settled(site, tasks, await Promise.all(clients.map((client, index) => fire(client, tasks[index]))));
  };
  // Deadlock (40P01) o espera agotada (55P03): Postgres cortó esa copia. Quien llama
  // reintenta una vez; acá queda contado, con la carrera en la que pasó.
  const settled = async (site, tasks, results) => {
    tally.calls += results.length;
    tally.slowestMs = Math.max(tally.slowestMs, ...results.map((result) => result.ms));
    for (let index = 0; index < results.length; index += 1) {
      const { code } = results[index];
      if (results[index].ok || (code !== '40P01' && code !== '55P03')) continue;
      if (code === '40P01') tally.deadlocks += 1; else tally.lockTimeouts += 1;
      tally.sites.set(`${site} ${code}`, (tally.sites.get(`${site} ${code}`) || 0) + 1);
      const retry = await fire(await open(tasks[index]), tasks[index]);
      if (retry.code !== '40P01' && retry.code !== '55P03') tally.retriesOk += 1;
      results[index] = { ...retry, retriedAfter: code };
    }
    return results;
  };
  // Las mismas llamadas reales, con el ORDEN DE LLEGADA fijado. La conexión administrativa
  // retiene el candado de una fila; cada llamada se dispara cuando la anterior ya quedó
  // esperando, y recién entonces se suelta el candado. Lo que pasa después depende sólo del
  // orden en que cada función toma sus candados: si dos funciones los toman en orden inverso,
  // acá el deadlock es seguro y no una cuestión de suerte.
  const staged = async (site, hold, tasks) => {
    // Las conexiones se abren ANTES de retener el candado: mientras está retenido sólo se dispara
    // y se mira, así el tiempo de conexión no corre contra el lock_timeout de las que esperan.
    const waiters = [];
    const fired = [];
    try {
      for (const task of tasks) {
        const waiter = { client: await open(task), pid: null };
        waiters.push(waiter);
        waiter.pid = (await waiter.client.query('select pg_backend_pid() as pid')).rows[0].pid;
      }
      await admin.query('begin');
      try {
        await admin.query(hold.sql, hold.params);
        for (const [index, task] of tasks.entries()) {
          fired.push(fire(waiters[index].client, task));
          const deadline = Date.now() + 4000;
          for (;;) {
            const { waiting } = await one('select count(*)::int as waiting from pg_locks where pid = $1 and not granted', [waiters[index].pid]);
            if (waiting > 0) break;
            assert.ok(Date.now() < deadline, `${site}: la llamada tenia que quedar esperando un candado`);
            await new Promise((resolve) => { setTimeout(resolve, 10); });
          }
        }
        await admin.query('commit');
      } catch (error) {
        await admin.query('rollback').catch(() => {});
        throw error;
      }
    } catch (error) {
      await Promise.all(fired);
      await Promise.all(waiters.slice(fired.length).map((waiter) => waiter.client.end().catch(() => {})));
      throw error;
    }
    return settled(site, tasks, await Promise.all(fired));
  };
  // El candado que más se disputa: el del cobro.
  const holdIntent = (session) => ({ sql: 'select 1 from public.payment_intents where id = $1 for update', params: [session.intentId] });
  const mustCall = async (what, task) => {
    const [result] = await race(what, [task]);
    assert.ok(result.ok, `${what}: ${result.code} ${result.message}`);
    return result.value;
  };
  // Varias llamadas independientes (otra sesión, otro pedido) que tienen que salir bien: el armado de un escenario.
  const mustAll = async (what, tasks) => {
    const results = await race(what, tasks);
    assert.ok(results.every(ok), `${what}: ${codes(results)}`);
    return results.map((result) => result.value);
  };
  const codes = (results) => {
    const seen = new Map();
    for (const result of results) {
      const label = result.ok ? `ok ${JSON.stringify(result.value).slice(0, 160)}` : `${result.code} ${result.message}`;
      seen.set(label, (seen.get(label) || 0) + 1);
    }
    return JSON.stringify(Object.fromEntries(seen));
  };
  const family = (name, copies, effect) => families.push(`${name}: ${copies} -> ${effect}`);
  // DEFECTO: lo que la base hace hoy y no debería. Se deja escrito, la corrida sigue para
  // medir el resto y el veredicto final es FAIL. Un defecto de orden de candados dice además
  // qué carreras explica: un deadlock en cualquier otra es un defecto que nadie esperaba.
  const explained = new Set();
  const defect = (id, text, explains = []) => {
    defects.push(id);
    for (const site of explains) explained.add(site);
    log(`IDEMPOTENCY_DEFECT: ${id}: ${text}`);
  };

  // ── Lo que llama cada actor ─────────────────────────────────────────────────
  // La Edge Function `mercadopago-create-checkout-session`, con su cliente de servicio.
  const checkout = (customerId, key, productId, quantity) => ({
    customerId, key, quantity, identity: service,
    sql: 'select public.create_checkout_session($1::uuid, $2::jsonb) as result',
    params: [customerId, JSON.stringify({
      business_id: BUSINESS,
      client_request_id: key,
      items: [{ product_id: productId, quantity }],
      fulfillment_type: 'pickup',
      contact: { name: 'Cliente Carrera Idempotencia', phone: '5492990000000' },
      address: {},
      age_confirmed: false,
      payment_method: 'mercadopago',
    })],
  });
  // La tienda, con el token del cliente anónimo.
  const manualOrder = (customerId, key, productId, quantity, extra = {}) => ({
    identity: buyer(customerId),
    sql: 'select public.create_order_with_items($1::jsonb) as result',
    params: [JSON.stringify({
      business_id: BUSINESS,
      client_request_id: key,
      tracking_token: trackingToken(key),
      items: [{ product_id: productId, quantity }],
      customer_name: 'Cliente Carrera Idempotencia',
      customer_phone: '2996209137',
      delivery_mode: 'pickup',
      payment_method: 'cash',
      ...extra,
    })],
  });
  const prepare = (session, newAttempt = false) => ({
    identity: service,
    sql: 'select public.prepare_mercadopago_preference_v2($1::uuid, $2::uuid, $3::boolean) as result',
    params: [session.sessionId, session.customer, newAttempt],
  });
  const authorityOf = (session) => ({
    identity: platform,
    sql: `select public.get_mercadopago_payment_authority_v2($1::uuid, 'test', $2::uuid, $3::uuid, $4::uuid) ->> 'authority_version' as result`,
    params: [BUSINESS, session.sessionId, session.customer, session.attemptId],
  });
  const recordPreference = (session, authority) => ({
    identity: platform,
    sql: `select public.record_mercadopago_preference_created_v2($1::uuid, 'test', $2::uuid, $3::uuid, $4::uuid, $5, $6, $7, $8, $9, $10) as result`,
    params: [BUSINESS, session.sessionId, session.customer, session.attemptId, authority, `IDEM-RACE-PREF-${session.ref}`,
      `https://www.mercadopago.com.ar/checkout/v1/redirect?pref_id=idem-race-${session.ref}`,
      `https://sandbox.mercadopago.com.ar/checkout/v1/redirect?pref_id=idem-race-${session.ref}`,
      sha256(`idem-race-pref-${session.ref}`), `idem-race-req-${session.ref}`],
  });
  // Lo que el worker persiste después de leer el pago en Mercado Pago. La misma semilla
  // es la misma respuesta del proveedor: un aviso duplicado.
  const snapshot = async (session, status, seed) => {
    const context = await one(`select pi.external_reference, pi.preference_id, cs.total::text as total,
        to_char(clock_timestamp() at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as at
      from public.payment_intents pi join public.checkout_sessions cs on cs.id = pi.checkout_session_id
     where pi.id = $1`, [session.intentId]);
    return {
      kind: 'snapshot', identity: service,
      sql: 'select public.record_mercadopago_payment_snapshot($1::uuid, $2::jsonb, $3, null) as result',
      params: [session.intentId, JSON.stringify({
        provider_payment_id: session.paymentId,
        external_reference: context.external_reference,
        preference_id: context.preference_id,
        merchant_order_id: `MO-${session.paymentId}`,
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
        payer_email_hash: sha256(`idem-race-payer-${session.ref}`),
        raw_response_hash: sha256(seed),
      }), 'webhook'],
    };
  };
  const finalize = (session) => ({ identity: service,
    sql: 'select public.finalize_paid_checkout_session($1::uuid) as result', params: [session.sessionId] });
  // El Panel: un comando con clave de idempotencia y revisión esperada.
  const transition = (user, orderId, revision, status, key) => ({ key, identity: member(user),
    sql: 'select public.transition_order($1::uuid, $2::bigint, $3, $4) as result', params: [orderId, revision, status, key] });
  const confirmPayment = (user, orderId, revision, method, key) => ({ key, method, identity: member(user),
    sql: 'select public.confirm_manual_order_payment($1::uuid, $2::bigint, $3, $4) as result', params: [orderId, revision, method, key] });
  const reversePayment = (user, orderId, revision, key) => ({ key, identity: member(user),
    sql: 'select public.reverse_manual_order_payment($1::uuid, $2::bigint, $3, $4) as result',
    params: [orderId, revision, 'Carrera de idempotencia: devolucion', key] });
  // El dueño desde el Panel: la Edge Function llama a estas dos con el token de la persona.
  const refund = (intentId, amount, key) => ({ key, identity: member(OWNER),
    sql: 'select public.prepare_payment_refund_v2($1::uuid, $2::numeric, $3::uuid, $4) as result',
    params: [intentId, amount, key, 'Carrera de idempotencia'] });
  const cancelPayment = (intentId, key) => ({ key, identity: member(OWNER),
    sql: 'select public.prepare_payment_cancellation($1::uuid, $2::uuid) as result', params: [intentId, key] });
  const recover = (session) => ({ kind: 'recover', identity: member(OWNER),
    sql: 'select public.recover_paid_checkout_order($1::uuid) as result', params: [session.sessionId] });
  // Y con su cliente de servicio asienta lo que contestó Mercado Pago.
  const refundIdentity = (session, refundId, key, providerRefundId) => ({ identity: service,
    sql: 'select public.record_payment_refund_identity($1::uuid, $2::uuid, $3, $4::uuid, $5) as result',
    params: [refundId, session.intentId, session.paymentId, key, providerRefundId] });
  const refundResponse = (refundId, providerRefundId, status, amount, seed) => ({ identity: service,
    sql: 'select public.record_payment_refund_response_v2($1::uuid, $2, $3, $4::numeric, $5) as result',
    params: [refundId, providerRefundId, status, amount, sha256(seed)] });
  const refundAmbiguous = (refundId, seed) => ({ identity: service,
    sql: 'select public.mark_payment_refund_ambiguous($1::uuid, $2, $3) as result', params: [refundId, sha256(seed), 'network_or_timeout'] });
  const cancellationResponse = (cancellationId, status, seed) => ({ kind: 'cancellation', identity: service,
    sql: 'select public.record_payment_cancellation_response($1::uuid, $2, $3) as result', params: [cancellationId, status, sha256(seed)] });
  const cancellationAmbiguous = (cancellationId, seed) => ({ kind: 'ambiguous', identity: service,
    sql: 'select public.mark_payment_cancellation_ambiguous($1::uuid, $2, $3) as result', params: [cancellationId, sha256(seed), 'network_or_timeout'] });

  // ── Fixtures ─────────────────────────────────────────────────────────────────
  const customers = (howMany) => {
    assert.ok(customersUsed + howMany <= CUSTOMERS, 'faltan clientes en el fixture');
    customersUsed += howMany;
    return times(howMany, (index) => customer(customersUsed - howMany + index + 1));
  };
  const newKey = () => { keysUsed += 1; return requestKey(keysUsed); };
  // Mercado Pago identifica cada devolución con un número.
  const newProviderRefund = () => { providerRefunds += 1; return String(7500000000 + providerRefunds); };
  const newProduct = async (label, stock) => {
    productsUsed += 1;
    const id = product(productsUsed);
    await admin.query(`insert into public.products(id,business_id,name,category,subcategory,price,price_status,is_active,brand,
        variant,presentation,capacity_value,capacity_unit,capacity,packaging_type,stock,available,merchant_available,is_alcoholic,
        tags,is_verified,verified_at,verified_by,external_id,sku,catalog_origin,units_per_pack)
      values ($1,$2,$3,'Gaseosas','Cola',1000,'confirmed',true,'Marca Carrera','Lata','Lata',473,'ml','473 ml','lata',
        $4,true,true,false,'{}',true,now(),$5,$6,$6,'commercial',1)`,
    [id, BUSINESS, `Lata Carrera Idempotencia ${label}`, stock, OWNER, `idem-race-${label}`]);
    ledger.set(id, { label, initial: stock });
    return id;
  };

  // Lo que la base dice de un producto, con la definición de `private.pos_reserved_quantity`.
  const stateOf = (productId) => one(`select p.stock,
      coalesce((select sum(r.quantity) from public.inventory_reservations r
                 where r.product_id = p.id and r.status = 'active'), 0)::int as reserved,
      coalesce((select sum(oi.quantity) from public.order_items oi join public.orders o on o.id = oi.order_id
                 where oi.product_uuid = p.id and o.inventory_released_at is null and o.status = any($2)), 0)::int as held,
      coalesce((select sum(oi.quantity) from public.order_items oi join public.orders o on o.id = oi.order_id
                 where oi.product_uuid = p.id and o.inventory_released_at is null and o.status <> all($2)), 0)::int as consumed,
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
  // Stock, unidades en reservas activas y unidades en pedidos: lo que un escenario espera ver.
  const assertStock = async (productId, where, expected) => {
    const state = await assertConserved(productId, where);
    assert.deepEqual(Object.fromEntries(Object.keys(expected).map((key) => [key, state[key]])), expected, `${where}: stock de ${ledger.get(productId).label}`);
    return state;
  };

  // ── Mercado Pago: lo que hacen las funciones Edge después de crear la sesión ──
  // Varias sesiones a la vez (son independientes): sesión -> preferencia asentada.
  const sessionsWithPreference = async (where, specs) => {
    const created = await mustAll(`${where}: crear la sesion`, specs.map((spec) => checkout(spec.customer, spec.key, spec.product, spec.quantity)));
    const sessions = specs.map((spec, index) => ({ ...spec, sessionId: created[index].checkout_session_id,
      intentId: created[index].payment_intent_id, paymentId: `IDEM-RACE-PAY-${spec.ref}` }));
    const prepared = await mustAll(`${where}: preparar la preferencia`, sessions.map((session) => prepare(session)));
    sessions.forEach((session, index) => { session.attemptId = prepared[index].payment_attempt_id; });
    const authorities = await mustAll(`${where}: leer la autoridad`, sessions.map(authorityOf));
    assert.ok(authorities.every((value) => /^[a-f0-9]{64}$/.test(value || '')), `${where}: la autoridad del intento existe: vendedor conectado y reserva vigente`);
    await mustAll(`${where}: asentar la preferencia`, sessions.map((session, index) => recordPreference(session, authorities[index])));
    return sessions;
  };
  // ... -> pago aprobado -> pedido: un pedido pagado por Mercado Pago.
  const paidOrders = async (where, specs) => {
    const sessions = await sessionsWithPreference(where, specs);
    const approved = await mustAll(`${where}: asentar el pago aprobado`,
      await inOrder(sessions, (session) => snapshot(session, 'approved', `idem-race-${session.ref}-approved`)));
    assert.ok(approved.every((value) => value.ok === true && value.finalize_required === true), `${where}: el aprobado pide finalizar`);
    const finalized = await mustAll(`${where}: finalizar`, sessions.map(finalize));
    assert.ok(finalized.every((value) => value.ok === true && value.order_id), `${where}: cada cobro tiene su pedido`);
    sessions.forEach((session, index) => { session.orderId = finalized[index].order_id; });
    return sessions;
  };
  // La sesión y sus reservas vencieron hace un minuto (misma forma que la suite pgTAP).
  const expire = async (sessionIds) => {
    await admin.query(`update public.checkout_sessions
        set created_at = clock_timestamp() - interval '2 hours', expires_at = clock_timestamp() - interval '1 minute'
      where id = any($1)`, [sessionIds]);
    await admin.query(`update public.inventory_reservations
        set created_at = clock_timestamp() - interval '2 hours', expires_at = clock_timestamp() - interval '1 minute'
      where checkout_session_id = any($1)`, [sessionIds]);
  };
  // Lo que quedó escrito de una sesión de pago.
  const sessionState = (sessionId) => one(`select cs.status as session, cs.revision::int as session_revision, cs.completed_order_id as order_id,
      pi.internal_status as intent, pi.order_id as intent_order_id,
      pi.paid_amount::float8 as paid, pi.refunded_amount::float8 as refunded, pi.security_review_reason as review,
      (select coalesce(array_agg(r.status || ':' || r.quantity || ':' || coalesce(r.release_reason, '-') order by r.reservation_generation, r.id), '{}')
         from public.inventory_reservations r where r.checkout_session_id = cs.id) as reservations,
      (select count(*)::int from public.orders o where o.business_id = cs.business_id
          and o.client_request_id = 'mp_' || replace(cs.id::text, '-', '')) as orders
    from public.checkout_sessions cs join public.payment_intents pi on pi.checkout_session_id = cs.id where cs.id = $1`, [sessionId]);
  const paymentEvents = async (intentId, type) => (await one(
    'select count(*)::int as n from public.payment_events where payment_intent_id = $1 and event_type = $2', [intentId, type])).n;
  // Lo que quedó escrito de un pedido.
  const orderState = (orderId) => one(`select o.status, o.revision::int as revision, o.manual_payment_status as payment, o.manual_payment_method as method,
      o.assigned_rider_user_id as rider, o.delivered_at is not null as delivered,
      (select count(*)::int from public.order_events e where e.order_id = o.id and e.event_type = 'order.status_changed') as changes,
      (select count(*)::int from public.business_command_receipts r where r.order_id = o.id) as receipts
    from public.orders o where o.id = $1`, [orderId]);
  const orderEvents = async (orderId, type) => (await one(
    'select count(*)::int as n from public.order_events where order_id = $1 and event_type = $2', [orderId, type])).n;
  const receiptsOf = async (key) => (await one(
    'select count(*)::int as n from public.business_command_receipts where business_id = $1 and idempotency_key = $2', [BUSINESS, key])).n;

  // Un comando del Panel con recibo: de las claves que compiten gana UNA. Una copia de esa
  // clave aplica el comando y las demás devuelven el recibo guardado; las copias de las
  // otras claves chocan contra la revisión nueva, sin escribir nada.
  const oneKeyWins = (where, results, revision) => {
    const keys = [...new Set(results.map((result) => result.task.key))];
    const winners = keys.filter((key) => results.some((result) => result.task.key === key && result.ok));
    assert.equal(winners.length, 1, `${where}: gana exactamente una clave -> ${codes(results)}`);
    const mine = results.filter((result) => result.task.key === winners[0]);
    const others = results.filter((result) => result.task.key !== winners[0]);
    assert.ok(mine.every(ok), `${where}: todas las copias de la clave que gano reciben respuesta -> ${codes(mine)}`);
    assert.equal(count(mine, (result) => result.value.idempotent_replay === false), 1, `${where}: una sola copia aplica el comando -> ${codes(mine)}`);
    assert.equal(count(mine, (result) => result.value.idempotent_replay === true), mine.length - 1, `${where}: las demas copias repiten el recibo guardado`);
    assert.ok(identical(mine.map((result) => without(result.value, 'idempotent_replay'))), `${where}: todas las copias devuelven el mismo recibo`);
    const conflict = `revision desactualizada: esperada ${revision}, actual ${revision + 1}`;
    assert.ok(others.every((result) => refusedWith(result, 'PT409', conflict)),
      `${where}: las copias de las otras claves chocan con PT409 «${conflict}» -> ${codes(others)}`);
    return { key: winners[0], value: mine[0].value, replays: mine.length - 1, conflicts: others.length };
  };

  try {
    // ── Fixture: un comercio abierto, con retiro y envío, Mercado Pago conectado y su equipo ──
    await admin.query(`insert into auth.users(id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
      values ($1,'authenticated','authenticated','idem-race-owner@example.invalid','',now(),'{}','{}',now(),now()),
             ($2,'authenticated','authenticated','idem-race-staff@example.invalid','',now(),'{}','{}',now(),now()),
             ($3,'authenticated','authenticated','idem-race-rider@example.invalid','',now(),'{}','{}',now(),now()),
             ($4,'authenticated','authenticated','idem-race-rider-b@example.invalid','',now(),'{}','{}',now(),now())`, [OWNER, STAFF, RIDER, RIDER_B]);
    await admin.query(`insert into auth.users(id,aud,role,encrypted_password,raw_app_meta_data,raw_user_meta_data,is_anonymous,created_at,updated_at)
      select id,'authenticated','authenticated','','{}','{}',true,now(),now() from unnest($1::uuid[]) as id`,
    [times(CUSTOMERS, (index) => customer(index + 1))]);
    // Los topes del guardián de admisión quedan altos y el vencimiento por desatención en
    // su máximo: acá lo único que puede frenar una copia es la idempotencia.
    await admin.query(`insert into public.businesses(id,name,slug,status,is_active,ordering_enabled,ordering_verified,
        ordering_verified_at,ordering_verified_by,currency_code,pickup_enabled,delivery_enabled,delivery_fee,minimum_delivery_subtotal,
        max_pending_orders_per_customer,order_rate_limit_per_10_minutes,order_ip_rate_limit_per_10_minutes,
        max_pending_orders_per_ip,order_business_rate_limit_per_10_minutes,abandoned_order_minutes)
      values ($1,'TABA CARRERA DE IDEMPOTENCIA','taba-carrera-idempotencia','open',true,true,true,now(),$2,'ARS',true,true,500,0,
        1000,1000,1000,1000,100000,10080)`, [BUSINESS, OWNER]);
    await admin.query(`insert into public.business_members(business_id,user_id,role,is_active)
      values ($1,$2,'owner',true), ($1,$3,'staff',true), ($1,$4,'rider',true), ($1,$5,'rider',true)`, [BUSINESS, OWNER, STAFF, RIDER, RIDER_B]);
    await admin.query(`insert into public.identity_sessions(session_id,user_id,business_id,role_at_login,client)
      values ($1,$2,$9,'owner','panel_web'), ($3,$4,$9,'staff','panel_web'), ($5,$6,$9,'rider','rider_android'), ($7,$8,$9,'rider','rider_android')`,
    [SESSION[OWNER], OWNER, SESSION[STAFF], STAFF, SESSION[RIDER], RIDER, SESSION[RIDER_B], RIDER_B, BUSINESS]);
    await admin.query(`insert into public.business_payment_settings(business_id,enabled,environment,checkout_mode,currency,reserve_stock,
        collector_id,application_id,configured_at,verified_at)
      values ($1,true,'test','checkout_pro','ARS',true,$2,$3,clock_timestamp(),clock_timestamp())`, [BUSINESS, COLLECTOR, APPLICATION]);
    await admin.query(`insert into public.mp_seller_connections(business_id,environment,seller_id,application_id,status,protected_tokens,expires_at)
      values ($1,'test',$2,$3,'connected','ciphertext-only-local-fixture',now() + interval '2 days')`, [BUSINESS, COLLECTOR, APPLICATION]);

    // ── 1 · CHECKOUT: la misma sesión de pago veinte veces ────────────────────
    {
      const item = await newProduct('s01', 100);
      const [same, mixed, twinA, twinB] = customers(4);
      const sessionsOf = (key) => rows(`select s.id, s.customer_id, s.status,
          (select count(*)::int from public.checkout_session_items i where i.checkout_session_id = s.id) as lines,
          (select coalesce(array_agg(r.status || ':' || r.quantity order by r.id), '{}') from public.inventory_reservations r where r.checkout_session_id = s.id) as reservations,
          (select count(*)::int from public.payment_intents pi where pi.checkout_session_id = s.id) as intents,
          (select count(*)::int from public.payment_events pe join public.payment_intents pi on pi.id = pe.payment_intent_id
            where pi.checkout_session_id = s.id and pe.event_type = 'checkout.session_created') as created_events,
          (select count(*)::int from private.order_intake_log l where l.checkout_session_id = s.id) as admissions
        from public.checkout_sessions s where s.business_id = $1 and s.client_request_id = $2 order by s.customer_id`, [BUSINESS, key]);
      const single = (id, customerId, quantity) => ({ id, customer_id: customerId, status: 'ready_for_payment', lines: 1,
        reservations: [`active:${quantity}`], intents: 1, created_events: 1, admissions: 1 });

      // La misma sesión (misma clave, mismo carrito) veinte veces a la vez.
      const copies = await race('checkout x20', times(20, () => checkout(same, 'idem-race-s01-same', item, 2)));
      assert.ok(copies.every(ok), `el mismo checkout veinte veces nunca se rechaza -> ${codes(copies)}`);
      assert.ok(identical(copies.map((result) => result.value)), 'las veinte respuestas son identicas');
      const sessionId = copies[0].value.checkout_session_id;
      assert.deepEqual(await sessionsOf('idem-race-s01-same'), [single(sessionId, same, 2)],
        'una sesion, un renglon, una reserva, un intent, un evento de alta y una admision contada');
      await assertStock(item, 'checkout x20', { stock: 98, reserved: 2 });

      // La misma clave con dos carritos distintos, cinco copias de cada uno, sobre una clave nueva.
      const fork = await race('checkout misma clave otro carrito',
        times(10, (index) => checkout(mixed, 'idem-race-s01-fork', item, index % 2 === 0 ? 1 : 3)));
      const accepted = fork.filter(ok);
      const rejected = fork.filter((result) => !result.ok);
      assert.equal(accepted.length, 5, `gana un carrito con sus cinco copias -> ${codes(fork)}`);
      const wonQuantity = accepted[0].task.quantity;
      assert.ok(accepted.every((result) => result.task.quantity === wonQuantity) && identical(accepted.map((result) => result.value)),
        'las cinco copias del carrito que gano reciben la misma sesion');
      assert.ok(rejected.every((result) => result.task.quantity !== wonQuantity
        && refusedWith(result, '23505', 'client_request_id reutilizado con un checkout diferente')),
      `las cinco copias del otro carrito reciben 23505 «client_request_id reutilizado con un checkout diferente» -> ${codes(rejected)}`);
      const forkId = accepted[0].value.checkout_session_id;
      assert.deepEqual(await sessionsOf('idem-race-s01-fork'), [single(forkId, mixed, wonQuantity)], 'una sola sesion, con el carrito que gano');
      await assertStock(item, 'checkout misma clave otro carrito', { stock: 98 - wonQuantity, reserved: 2 + wonQuantity });
      // Lo mismo otra vez, con la sesión ya creada: nadie escribe nada.
      const again = await race('checkout misma clave otro carrito, repetido',
        times(6, (index) => checkout(mixed, 'idem-race-s01-fork', item, index % 2 === 0 ? 1 : 3)));
      assert.ok(again.every((result) => (result.task.quantity === wonQuantity
        ? result.ok && result.value.checkout_session_id === forkId
        : refusedWith(result, '23505', 'client_request_id reutilizado con un checkout diferente'))),
      `repetido, cada carrito recibe lo mismo que antes -> ${codes(again)}`);
      assert.deepEqual(await sessionsOf('idem-race-s01-fork'), [single(forkId, mixed, wonQuantity)], 'repetir no escribe nada');

      // Dos clientes con la MISMA clave: la clave es por cliente.
      const twins = await race('checkout dos clientes una clave',
        times(10, (index) => checkout(index % 2 === 0 ? twinA : twinB, 'idem-race-s01-twin', item, 1)));
      assert.ok(twins.every(ok), `ninguno de los dos clientes se rechaza -> ${codes(twins)}`);
      const idOf = (who) => twins.find((result) => result.task.customerId === who).value.checkout_session_id;
      assert.ok(twins.every((result) => result.value.checkout_session_id === idOf(result.task.customerId)), 'cada cliente recibe siempre SU sesion');
      assert.notEqual(idOf(twinA), idOf(twinB), 'dos clientes, dos sesiones');
      assert.deepEqual(await sessionsOf('idem-race-s01-twin'), [single(idOf(twinA), twinA, 1), single(idOf(twinB), twinB, 1)],
        'una sesion por cliente, cada una con su reserva');
      await assertStock(item, 'checkout dos clientes una clave', { stock: 96 - wonQuantity, reserved: 4 + wonQuantity });
      family('checkout (create_checkout_session)', 'x20 misma clave', '1 sesion, 1 reserva, 1 intent, stock descontado una vez');
      family('stock reservation', 'x20 la misma sesion / x5+x5 dos carritos con una clave', '1 juego de reservas por sesion');
      log(`IDEMPOTENCY_CHECKOUT: la misma sesion x20 -> 1 sesion, 20 respuestas identicas, stock -2 una vez; misma clave con dos carritos x5+x5 ->`
        + ` gana el de ${wonQuantity} unidad(es), el otro recibe 23505; dos clientes con una clave x5+x5 -> 2 sesiones: PASS`);
    }

    // ── 2 · PREFERENCIA: preparar, asentar y reintentar ───────────────────────
    {
      const item = await newProduct('s02', 50);
      const [payer] = customers(1);
      const created = await mustCall('preferencia: crear la sesion', checkout(payer, 'idem-race-s02-pay', item, 2));
      const session = { customer: payer, ref: 's02', sessionId: created.checkout_session_id, intentId: created.payment_intent_id, paymentId: 'IDEM-RACE-PAY-s02' };
      const attempts = () => rows(`select pa.id, pa.attempt_number as number, pa.status, pa.preference_id from public.payment_attempts pa
         where pa.payment_intent_id = $1 and pa.attempt_type = 'preference' order by pa.attempt_number`, [session.intentId]);

      const prepared = await race('preparar preferencia x10', times(10, () => prepare(session)));
      assert.ok(prepared.every(ok), `preparar la misma preferencia diez veces nunca se rechaza -> ${codes(prepared)}`);
      assert.ok(identical(prepared.map((result) => result.value)), 'las diez respuestas son identicas');
      assert.deepEqual({ number: prepared[0].value.attempt_number, status: prepared[0].value.attempt_status, preference: prepared[0].value.preference_id },
        { number: 1, status: 'prepared', preference: null }, 'todas devuelven el intento 1, preparado');
      session.attemptId = prepared[0].value.payment_attempt_id;
      assert.deepEqual(await attempts(), [{ id: session.attemptId, number: 1, status: 'prepared', preference_id: null }], 'un solo intento de preferencia');

      // Diez instancias de la Edge Function leyeron la misma autoridad y asientan la misma preferencia.
      const authority = await mustCall('preferencia: leer la autoridad', authorityOf(session));
      const before = await sessionState(session.sessionId);
      const recorded = await race('asentar preferencia x10', times(10, () => recordPreference(session, authority)));
      assert.equal(count(recorded, ok), 1, `una sola copia asienta la preferencia -> ${codes(recorded)}`);
      assert.ok(recorded.filter((result) => !result.ok).every((result) => refusedWith(result, '55000', 'autoridad del intento cambio')),
        `las otras nueve reciben 55000 «autoridad del intento cambio» -> ${codes(recorded)}`);
      const redirected = await sessionState(session.sessionId);
      assert.deepEqual({ session: redirected.session, intent: redirected.intent, moved: redirected.session_revision - before.session_revision },
        { session: 'redirected', intent: 'preference_created', moved: 1 }, 'la sesion pasa a redirected una sola vez');
      assert.deepEqual(await attempts(), [{ id: session.attemptId, number: 1, status: 'created', preference_id: 'IDEM-RACE-PREF-s02' }],
        'una preferencia asentada en el intento 1');
      // Quien recibió el conflicto vuelve a pedir: todos reciben el intento ya creado con su enlace.
      const retried = await race('preparar preferencia ya asentada x10', times(10, () => prepare(session)));
      assert.ok(retried.every(ok) && identical(retried.map((result) => result.value)), `pedirla de nuevo devuelve lo mismo a todos -> ${codes(retried)}`);
      assert.deepEqual({ id: retried[0].value.payment_attempt_id, status: retried[0].value.attempt_status, preference: retried[0].value.preference_id,
        link: retried[0].value.init_point },
      { id: session.attemptId, status: 'created', preference: 'IDEM-RACE-PREF-s02', link: 'https://www.mercadopago.com.ar/checkout/v1/redirect?pref_id=idem-race-s02' },
      'el mismo intento, ya creado, con el enlace guardado');

      // Pago rechazado y cinco pedidos de reintento controlado a la vez.
      const rejected = await mustCall('preferencia: pago rechazado', await snapshot(session, 'rejected', 'idem-race-s02-rejected'));
      assert.deepEqual({ ok: rejected.ok, status: rejected.internal_status, finalize: rejected.finalize_required },
        { ok: true, status: 'rejected', finalize: false }, 'el rechazo se registra');
      const retries = await race('reintento controlado x5', times(5, () => prepare(session, true)));
      assert.equal(count(retries, ok), 1, `un solo reintento crea un intento nuevo -> ${codes(retries)}`);
      assert.ok(retries.filter((result) => !result.ok).every((result) => refusedWith(result, '55000', 'el pago actual no admite un nuevo intento controlado')),
        `los otros cuatro reciben 55000 «el pago actual no admite un nuevo intento controlado» -> ${codes(retries)}`);
      const second = retries.find(ok).value;
      assert.deepEqual({ number: second.attempt_number, status: second.attempt_status }, { number: 2, status: 'prepared' }, 'el intento nuevo es el 2');
      assert.deepEqual((await attempts()).map((row) => `${row.number}:${row.status}`), ['1:created', '2:prepared'], 'intentos 1 y 2: nunca un 3');
      const after = await sessionState(session.sessionId);
      assert.deepEqual({ intent: after.intent, reservations: after.reservations }, { intent: 'preference_creating', reservations: ['active:2:-'] },
        'el cobro vuelve a preparar una preferencia sobre la misma reserva');
      // Sin pedir intento nuevo, todos reciben el intento 2.
      const current = await race('preparar preferencia tras el reintento x5', times(5, () => prepare(session)));
      assert.ok(current.every((result) => result.ok && result.value.payment_attempt_id === second.payment_attempt_id), `todos ven el intento 2 -> ${codes(current)}`);
      await assertStock(item, 'preferencia', { stock: 48, reserved: 2 });
      family('payment creation (prepare_mercadopago_preference_v2)', 'x10', '1 intento (numero 1), la misma respuesta para todos');
      family('payment creation (record_mercadopago_preference_created_v2)', 'x10', '1 preferencia asentada; 9 conflictos 55000 «autoridad del intento cambio»');
      family('payment retry (p_new_attempt)', 'x5', '1 intento nuevo (numero 2); 4 rechazos 55000');
      log('IDEMPOTENCY_PREFERENCE: preparar x10 -> 1 intento, 10 respuestas identicas; asentar x10 -> 1 preferencia, sesion redirected una vez,'
        + ' 9 x 55000 «autoridad del intento cambio»; reintento controlado x5 -> intento 2 una vez, 4 x 55000: PASS');
    }

    // ── 3 · WEBHOOK Y COLA: el mismo aviso veinte veces, cinco workers ────────
    {
      const notice = (fn, event, valid) => ({ valid, identity: service,
        sql: `select public.${fn}($1, $2, $3, $4, $5, $6, $7${fn === 'mp_record_seller_webhook' ? ', $8::uuid' : ''}) as result`,
        params: ['test', `idem-race-evt-${event}`, 'payment', `IDEM-RACE-PAY-W-${event}`, valid, `idem-race-req-${event}`,
          sha256(`idem-race-webhook-${event}`), ...(fn === 'mp_record_seller_webhook' ? [BUSINESS] : [])] });
      const receipt = (event, valid = true) => notice('record_mercadopago_webhook_receipt', event, valid);
      // Con el vendedor conectado por OAuth la Edge Function entra por esta otra puerta.
      const sellerReceipt = (event) => notice('mp_record_seller_webhook', event, true);
      const receiptsOf = (event) => rows(`select r.id, r.signature_valid as valid, r.processing_status as status, r.attempt_count as attempts,
          r.seller_business_id as seller,
          (select coalesce(array_agg(o.topic || ':' || o.status || ':' || o.resource_id order by o.created_at), '{}')
             from public.payment_outbox o where o.webhook_receipt_id = r.id) as jobs
        from public.payment_webhook_receipts r where r.environment = 'test' and r.webhook_event_id = $1`, [`idem-race-evt-${event}`]);
      const claim = (owner, limit = 5, lease = 150) => ({ owner, identity: service,
        sql: `select coalesce(jsonb_agg(to_jsonb(job)), '[]'::jsonb) as result from public.claim_payment_outbox_v2($1, $2, $3) as job`,
        params: [owner, limit, lease] });
      const work = (fn, jobId, owner, ...more) => ({ fn, owner, identity: service,
        sql: `select public.${fn}($1::uuid, $2${more.length ? ', $3' : ''}) as result`, params: [jobId, owner, ...more] });
      const myJobs = () => rows(`select o.id, o.status, o.owner, o.attempts, o.lease_expires_at > clock_timestamp() as leased, r.processing_status as receipt
          from public.payment_outbox o join public.payment_webhook_receipts r on r.id = o.webhook_receipt_id
         where r.webhook_event_id like 'idem-race-evt-%' order by o.created_at, o.id`);

      // La cola es una sola para toda la base: lo que ya estuviera pendiente (de otra
      // suite) se aparta con un plazo largo y no entra en la cuenta.
      let foreign = 0;
      for (;;) {
        const batch = await mustCall('cola: apartar lo ajeno', claim('idem-race-drain', 100, 600));
        foreign += batch.length;
        if (batch.length < 100) break;
      }

      const same = await race('webhook x20', times(20, () => receipt('same')));
      assert.ok(same.every(ok), `el mismo aviso veinte veces nunca falla -> ${codes(same)}`);
      assert.equal(new Set(same.map((result) => result.value.receipt_id)).size, 1, 'las veinte respuestas llevan el mismo recibo');
      assert.equal(count(same, (result) => result.value.duplicate === false && result.value.queued === true), 1, `una sola copia encola el trabajo -> ${codes(same)}`);
      assert.equal(count(same, (result) => result.value.duplicate === true && result.value.queued === false), 19, 'las otras diecinueve responden duplicado, sin encolar');
      assert.deepEqual(await receiptsOf('same'), [{ id: same[0].value.receipt_id, valid: true, status: 'queued', attempts: 19, seller: null,
        jobs: ['payment:pending:IDEM-RACE-PAY-W-same'] }], 'un recibo, diecinueve repeticiones contadas, un trabajo en la cola');

      // El mismo aviso llega a la vez sin firma válida (cinco) y firmado (cinco): un recibo, un trabajo.
      const signed = await race('webhook firmado y sin firma x10', times(10, (index) => receipt('signed', index % 2 === 1)));
      assert.ok(signed.every(ok), `ninguna copia falla -> ${codes(signed)}`);
      assert.equal(new Set(signed.map((result) => result.value.receipt_id)).size, 1, 'un solo recibo para las diez');
      assert.equal(count(signed, (result) => result.value.queued === true), 1, `una sola copia encola -> ${codes(signed)}`);
      assert.ok(signed.every((result) => result.task.valid || result.value.queued === false), 'una copia sin firma nunca encola');
      const [mixedReceipt] = await receiptsOf('signed');
      assert.deepEqual(pick(mixedReceipt, 'valid', 'status', 'attempts', 'jobs'),
        { valid: true, status: 'queued', attempts: 9, jobs: ['payment:pending:IDEM-RACE-PAY-W-signed'] }, 'el recibo queda firmado, con un trabajo');

      // La puerta del vendedor conectado.
      const seller = await race('webhook del vendedor x10', times(10, () => sellerReceipt('seller')));
      assert.ok(seller.every(ok), `ninguna copia falla -> ${codes(seller)}`);
      assert.equal(count(seller, (result) => result.value.queued === true), 1, 'una sola copia encola');
      assert.deepEqual((await receiptsOf('seller')).map((row) => pick(row, 'valid', 'status', 'attempts', 'seller', 'jobs')),
        [{ valid: true, status: 'queued', attempts: 9, seller: BUSINESS, jobs: ['payment:pending:IDEM-RACE-PAY-W-seller'] }],
        'un recibo del vendedor, con su comercio y un trabajo');

      // Nueve avisos más, distintos: doce trabajos en la cola y cinco workers reclamando a la vez.
      const more = await mustAll('cola: nueve avisos mas', times(9, (index) => receipt(`queue-${index}`)));
      assert.ok(more.every((value) => value.queued === true && value.duplicate === false), 'cada aviso nuevo encola su trabajo');
      const queued = await myJobs();
      assert.deepEqual(queued.map((job) => `${job.status}:${job.attempts}`), Array(12).fill('pending:0'), 'doce trabajos pendientes, sin reclamar');
      const mine = new Set(queued.map((job) => job.id));
      const owners = new Map();
      const claimedOnce = async (where, round, expected) => {
        const claims = await race(where, times(5, (index) => claim(`idem-race-worker-${round}-${index}`)));
        assert.ok(claims.every(ok), `${where}: reclamar a la vez no falla -> ${codes(claims)}`);
        const taken = claims.flatMap((result) => result.value.map((job) => ({ id: job.id, owner: result.task.owner, attempts: job.attempts })));
        assert.equal(new Set(taken.map((job) => job.id)).size, taken.length, `${where}: ningun trabajo sale para dos workers`);
        assert.deepEqual(taken.filter((job) => mine.has(job.id)).map((job) => job.id).sort(), [...expected].sort(),
          `${where}: cada trabajo esperado sale para exactamente un worker`);
        for (const job of taken) owners.set(job.id, job.owner);
        return taken;
      };
      const first = await claimedOnce('cinco workers reclaman', 1, mine);
      assert.ok(first.every((job) => job.attempts === 1), 'cada trabajo cuenta un intento');
      assert.ok((await myJobs()).every((job) => job.status === 'claimed' && job.leased && job.owner === owners.get(job.id) && job.attempts === 1),
        'en la base cada trabajo quedo reclamado por el worker que lo recibio');
      await claimedOnce('cinco workers reclaman otra vez', 2, []);
      const [jobA, jobB, jobC, jobD] = queued.map((job) => job.id);

      // Dos plazos vencen: esos trabajos vuelven a salir, cada uno para un solo worker, y el dueño anterior ya no puede empezarlos.
      const previous = owners.get(jobC);
      await admin.query(`update public.payment_outbox set lease_expires_at = clock_timestamp() - interval '1 second' where id = any($1)`, [[jobC, jobD]]);
      const again = await claimedOnce('cinco workers reclaman los plazos vencidos', 3, [jobC, jobD]);
      assert.ok(again.filter((job) => mine.has(job.id)).every((job) => job.attempts === 2), 'el segundo reclamo cuenta el segundo intento');
      const stale = await race('empezar con el reclamo viejo y con el nuevo', [work('start_payment_outbox_job', jobC, previous),
        work('start_payment_outbox_job', jobC, owners.get(jobC))]);
      assert.deepEqual(stale.map((result) => result.ok && result.value), [false, true], 'empieza el worker del reclamo vigente, no el anterior');

      // Empezar el mismo trabajo dos veces (y un worker que no es el dueño), terminarlo cinco veces.
      const started = await race('empezar el mismo trabajo x3', [work('start_payment_outbox_job', jobA, owners.get(jobA)),
        work('start_payment_outbox_job', jobA, 'idem-race-worker-ajeno'), work('start_payment_outbox_job', jobA, owners.get(jobA))]);
      assert.ok(started.every(ok), `empezar a la vez no falla -> ${codes(started)}`);
      assert.deepEqual(started.map((result) => result.value).sort(), [false, false, true], 'una sola copia empieza el trabajo');
      assert.equal(started[1].value, false, 'el worker que no lo reclamo no lo empieza');
      const completed = await race('terminar el mismo trabajo x5', times(5, () => work('complete_payment_outbox_job', jobA, owners.get(jobA))));
      assert.ok(completed.every(ok), `terminar a la vez no falla -> ${codes(completed)}`);
      assert.equal(count(completed, (result) => result.value === true), 1, 'una sola copia lo termina; las demas reciben false');
      assert.deepEqual((await myJobs()).filter((job) => job.id === jobA).map((job) => pick(job, 'status', 'receipt')),
        [{ status: 'completed', receipt: 'completed' }], 'el trabajo y su recibo quedan terminados');
      // Terminar y fallar el mismo trabajo a la vez: gana uno.
      assert.equal(await mustCall('cola: empezar el segundo trabajo', work('start_payment_outbox_job', jobB, owners.get(jobB))), true, 'el segundo trabajo empieza');
      const closing = await race('terminar y fallar el mismo trabajo', [work('complete_payment_outbox_job', jobB, owners.get(jobB)),
        work('fail_payment_outbox_job', jobB, owners.get(jobB), 'provider_http_503'), work('complete_payment_outbox_job', jobB, owners.get(jobB)),
        work('fail_payment_outbox_job', jobB, owners.get(jobB), 'provider_http_503')]);
      assert.ok(closing.every(ok), `terminar y fallar a la vez no falla -> ${codes(closing)}`);
      const closed = closing.filter((result) => result.value === true || result.value === 'retry_wait');
      assert.equal(closed.length, 1, `una sola copia cierra el trabajo -> ${codes(closing)}`);
      assert.ok(closing.filter((result) => result !== closed[0]).every((result) => result.value === false || result.value === null),
        'las demas reciben false (terminar) o null (fallar)');
      const closedAs = closed[0].value === true ? 'completed' : 'retry_wait';
      assert.deepEqual((await myJobs()).filter((job) => job.id === jobB).map((job) => pick(job, 'status', 'receipt')),
        [{ status: closedAs, receipt: closedAs }], 'el trabajo quedo en el estado de la copia que gano');
      family('webhook handling (record_mercadopago_webhook_receipt)', 'x20 el mismo aviso', '1 recibo, 1 trabajo en la cola');
      family('webhook handling (claim_payment_outbox_v2)', 'x5 workers, 12 trabajos', 'cada trabajo para un solo worker');
      family('webhook handling (start/complete/fail_payment_outbox_job)', 'x3 / x5 / x4', '1 empieza, 1 termina, 1 cierra');
      log(`IDEMPOTENCY_WEBHOOK: el mismo aviso x20 -> 1 recibo, 1 trabajo, 19 duplicados; firmado y sin firma x5+x5 -> 1 recibo firmado, 1 trabajo;`
        + ` puerta del vendedor x10 -> 1 recibo, 1 trabajo: PASS`);
      log(`IDEMPOTENCY_OUTBOX: 12 trabajos y 5 workers a la vez -> cada trabajo para un solo worker (${foreign} ajeno(s) apartado(s)); otra ronda -> nada;`
        + ` plazo vencido -> 1 reclamo nuevo por trabajo; empezar x3 -> 1; terminar x5 -> 1; terminar y fallar x2+x2 -> queda ${closedAs}: PASS`);
    }

    // ── 4 · TRANSICIONES DEL PANEL: la misma transición diez veces, dos pestañas ──
    let pickup;
    {
      const item = await newProduct('s04', 20);
      const [walker, left, right] = customers(3);
      const placed = await mustAll('transiciones: pedidos', [manualOrder(walker, 'idem-race-s04-walk', item, 2),
        manualOrder(left, 'idem-race-s04-left', item, 1), manualOrder(right, 'idem-race-s04-right', item, 1)]);
      const order = { id: placed[0].id, revision: Number(placed[0].revision), item };
      const moved = async (where, status, results, changes) => {
        const step = oneKeyWins(where, results, order.revision);
        assert.deepEqual({ status: step.value.status, revision: Number(step.value.revision) }, { status, revision: order.revision + 1 },
          `${where}: el recibo trae el pedido en ${status} con la revision siguiente`);
        assert.deepEqual(pick(await orderState(order.id), 'status', 'revision', 'changes', 'receipts'),
          { status, revision: order.revision + 1, changes, receipts: changes }, `${where}: una transicion, un evento, un recibo`);
        assert.equal(await receiptsOf(step.key), 1, `${where}: un recibo para la clave que gano`);
        order.revision += 1;
        return step;
      };
      // received -> accepted: el mismo envío, diez veces.
      await moved('aceptar x10', 'accepted', await race('transition_order x10',
        times(10, () => transition(STAFF, order.id, order.revision, 'accepted', 'idem-race-s04-accept'))), 1);
      // accepted -> preparing: dos pestañas (el operador y el dueño), cada una con su clave y la misma revisión.
      const tabs = await moved('dos pestanas', 'preparing', await race('transition_order dos claves', times(10, (index) => (index % 2 === 0
        ? transition(STAFF, order.id, order.revision, 'preparing', 'idem-race-s04-tab-staff')
        : transition(OWNER, order.id, order.revision, 'preparing', 'idem-race-s04-tab-owner')))), 2);
      assert.equal(await receiptsOf(tabs.key === 'idem-race-s04-tab-staff' ? 'idem-race-s04-tab-owner' : 'idem-race-s04-tab-staff'), 0,
        'la clave que perdio no deja recibo');
      // preparing -> ready: la misma clave desde las dos personas, contra una tercera clave.
      const third = await moved('una clave contra otra', 'ready', await race('transition_order x8 + x2', [
        ...times(4, () => transition(STAFF, order.id, order.revision, 'ready', 'idem-race-s04-ready')),
        ...times(2, () => transition(OWNER, order.id, order.revision, 'ready', 'idem-race-s04-ready-otra')),
        ...times(4, () => transition(OWNER, order.id, order.revision, 'ready', 'idem-race-s04-ready'))]), 3);
      // Un envío viejo (la clave del primer paso, con su revisión) sigue devolviendo su recibo.
      const old = await race('transition_order: recibo viejo x3', times(3, () => transition(STAFF, order.id, order.revision - 3, 'accepted', 'idem-race-s04-accept')));
      assert.ok(old.every((result) => result.ok && result.value.idempotent_replay === true && result.value.status === 'accepted'),
        `la clave del primer paso devuelve su recibo, no vuelve a aceptar -> ${codes(old)}`);
      assert.deepEqual(pick(await orderState(order.id), 'status', 'revision', 'changes', 'receipts'),
        { status: 'ready', revision: order.revision, changes: 3, receipts: 3 }, 'repetir un envio viejo no mueve el pedido');

      // La misma clave sobre dos pedidos distintos, a la vez: la clave es del comercio, vale para un solo comando.
      const clash = await race('transition_order: una clave, dos pedidos', [
        transition(STAFF, placed[1].id, Number(placed[1].revision), 'accepted', 'idem-race-s04-clash'),
        transition(OWNER, placed[2].id, Number(placed[2].revision), 'accepted', 'idem-race-s04-clash')]);
      assert.equal(count(clash, ok), 1, `uno solo de los dos pedidos usa la clave -> ${codes(clash)}`);
      const refused = clash.find((result) => !result.ok);
      const refusals = ['idempotency_key reutilizada con otro payload',
        'duplicate key value violates unique constraint "business_command_receipts_business_id_idempotency_key_key"'];
      assert.ok(refused.code === '23505' && refusals.includes(refused.message), `el otro recibe 23505 -> ${codes([refused])}`);
      const twins = await inOrder([placed[1].id, placed[2].id], orderState);
      assert.deepEqual(twins.map((state) => `${state.status}:${state.changes}:${state.receipts}`).sort(), ['accepted:1:1', 'received:0:0'],
        'un pedido aceptado con su recibo; el otro intacto');
      assert.equal(await receiptsOf('idem-race-s04-clash'), 1, 'un recibo para esa clave');
      await assertStock(item, 'transiciones', { stock: 16, held: 4 });
      pickup = order;
      family('order transition (transition_order)', 'x10 misma clave', '1 transicion, 1 evento, 1 recibo; 9 repeticiones del recibo');
      family('order transition (transition_order)', 'dos claves x5+x5', '1 aplica; la otra clave recibe PT409');
      log(`IDEMPOTENCY_ORDER_TRANSITION: aceptar x10 -> 1 transicion, 9 recibos repetidos; dos pestanas x5+x5 -> gana ${tabs.key.replace('idem-race-s04-tab-', '')},`
        + ` ${tabs.conflicts} x PT409; una clave x8 contra otra x2 -> gana ${third.key === 'idem-race-s04-ready' ? 'la de 8' : 'la de 2'}, ${third.conflicts} x PT409;`
        + ` una clave sobre dos pedidos -> 1 aplica, el otro 23505 (${refused.message.startsWith('duplicate') ? 'indice unico' : 'mensaje propio'}): PASS`);
    }

    // ── 5 · COBRO MANUAL: confirmar y devolver ─────────────────────────────────
    {
      const item = await newProduct('s05', 20);
      const [cashBuyer, coordBuyer] = customers(2);
      const placed = await mustAll('cobro manual: pedidos', [manualOrder(cashBuyer, 'idem-race-s05-cash', item, 2),
        manualOrder(coordBuyer, 'idem-race-s05-coord', item, 1, { payment_method: 'coordinate' })]);
      const cash = { id: placed[0].id, revision: Number(placed[0].revision) };
      const coord = { id: placed[1].id, revision: Number(placed[1].revision) };
      // Una clave gana: una copia escribe (sin `idempotent_replay`), las demás repiten el recibo; las
      // otras claves reciben el no-op `already_*`.
      const oneWrites = (where, results, code, noOp) => {
        assert.ok(results.every(ok), `${where}: ninguna copia falla -> ${codes(results)}`);
        const fresh = results.filter((result) => result.value.code === code && result.value.idempotent_replay === undefined);
        assert.equal(fresh.length, 1, `${where}: una sola copia escribe -> ${codes(results)}`);
        const mine = results.filter((result) => result.task.key === fresh[0].task.key);
        const others = results.filter((result) => result.task.key !== fresh[0].task.key);
        assert.equal(count(mine, (result) => result.value.code === code && result.value.idempotent_replay === true), mine.length - 1,
          `${where}: las demas copias de esa clave repiten el recibo -> ${codes(mine)}`);
        assert.ok(others.every((result) => result.value.ok === true && result.value.code === noOp && result.value.idempotent_no_op === true),
          `${where}: las otras claves reciben ${noOp} -> ${codes(others)}`);
        return fresh[0];
      };
      const paymentOf = async (order, event) => ({ ...pick(await orderState(order.id), 'payment', 'method', 'revision'),
        events: await orderEvents(order.id, event) });

      const same = await race('confirmar cobro x10', times(10, () => confirmPayment(STAFF, cash.id, cash.revision, 'cash', 'idem-race-s05-pay')));
      const confirmed = oneWrites('confirmar cobro x10', same, 'confirmed', 'already_confirmed');
      assert.deepEqual(pick(confirmed.value, 'manual_payment_status', 'amount', 'actual_method'),
        { manual_payment_status: 'confirmed', amount: 2000, actual_method: 'cash' }, 'el cobro confirmado es el total del pedido, en efectivo');
      assert.deepEqual(await paymentOf(cash, 'order.manual_payment_confirmed'), { payment: 'confirmed', method: 'cash', revision: cash.revision + 1, events: 1 },
        'un cobro, un evento');
      assert.equal(await receiptsOf('idem-race-s05-pay'), 1, 'un recibo');
      cash.revision += 1;

      // Dos personas cobran el mismo pedido «a coordinar» a la vez, una en efectivo y otra por transferencia.
      const duel = await race('confirmar cobro: dos claves, dos medios', times(10, (index) => (index % 2 === 0
        ? confirmPayment(STAFF, coord.id, coord.revision, 'cash', 'idem-race-s05-cash-key')
        : confirmPayment(OWNER, coord.id, coord.revision, 'transfer', 'idem-race-s05-transfer-key'))));
      const won = oneWrites('confirmar cobro: dos claves', duel, 'confirmed', 'already_confirmed');
      assert.deepEqual(await paymentOf(coord, 'order.manual_payment_confirmed'),
        { payment: 'confirmed', method: won.task.method, revision: coord.revision + 1, events: 1 }, 'un solo cobro, con el medio de quien gano');
      assert.deepEqual([await receiptsOf('idem-race-s05-cash-key'), await receiptsOf('idem-race-s05-transfer-key')].sort(), [0, 1], 'un recibo: el de la clave que gano');
      coord.revision += 1;

      // La devolución del cobro manual: el mismo envío diez veces, y dos claves a la vez.
      const reversed = oneWrites('devolver cobro x10', await race('devolver cobro x10',
        times(10, () => reversePayment(OWNER, cash.id, cash.revision, 'idem-race-s05-reverse'))), 'reversed', 'already_reversed');
      assert.equal(Number(reversed.value.amount), 2000, 'se devuelve el total cobrado');
      assert.deepEqual(await paymentOf(cash, 'order.manual_payment_reversed'), { payment: 'reversed', method: 'cash', revision: cash.revision + 1, events: 1 },
        'una devolucion, un evento');
      oneWrites('devolver cobro: dos claves', await race('devolver cobro: dos claves', times(6, (index) =>
        reversePayment(OWNER, coord.id, coord.revision, index % 2 === 0 ? 'idem-race-s05-reverse-a' : 'idem-race-s05-reverse-b'))), 'reversed', 'already_reversed');
      assert.deepEqual(pick(await paymentOf(coord, 'order.manual_payment_reversed'), 'payment', 'events'), { payment: 'reversed', events: 1 },
        'una sola devolucion aunque lleguen dos claves');
      // Un cobro devuelto no se vuelve a confirmar.
      const late = await race('confirmar un cobro devuelto x4', times(4, (index) => confirmPayment(STAFF, cash.id, cash.revision + 1, 'cash', `idem-race-s05-late-${index % 2}`)));
      assert.ok(late.every((result) => refusedWith(result, '55000', 'El cobro fue devuelto y no puede confirmarse otra vez')),
        `confirmar despues de devolver se rechaza con 55000 -> ${codes(late)}`);
      await assertStock(item, 'cobro manual', { stock: 17, held: 3 });
      family('manual payment (confirm_manual_order_payment)', 'x10 misma clave / dos claves x5+x5', '1 cobro, 1 evento, 1 recibo; la otra clave recibe already_confirmed');
      family('refund manual (reverse_manual_order_payment)', 'x10 misma clave / dos claves x3+x3', '1 devolucion; la otra clave recibe already_reversed');
      log(`IDEMPOTENCY_MANUAL_PAYMENT: confirmar x10 -> 1 cobro, 9 recibos repetidos; dos claves con dos medios x5+x5 -> cobra ${won.task.method},`
        + ' la otra clave recibe already_confirmed; devolver x10 -> 1 devolucion; dos claves x3+x3 -> 1 devolucion, already_reversed;'
        + ' confirmar lo devuelto -> 55000: PASS');
    }

    // ── 6 · ENTREGA: retiro, repartidor y envío propio del comercio ────────────
    {
      // Retiro: el pedido del escenario 4 está listo; el mismo «entregado» diez veces.
      const taken = oneKeyWins('entregar retiro x10', await race('transition_order entregar x10',
        times(10, () => transition(STAFF, pickup.id, pickup.revision, 'delivered', 'idem-race-s06-pickup'))), pickup.revision);
      assert.equal(taken.value.status, 'delivered', 'el recibo trae el pedido entregado');
      assert.deepEqual(pick(await orderState(pickup.id), 'status', 'revision', 'delivered', 'changes', 'receipts'),
        { status: 'delivered', revision: pickup.revision + 1, delivered: true, changes: 4, receipts: 4 }, 'entregado una vez: un evento y un recibo mas');
      await assertStock(pickup.item, 'entrega de retiro', { stock: 16, held: 2, consumed: 2 });
      family('delivery completion (retiro, transition_order)', 'x10', 'entregado una vez');
      log('IDEMPOTENCY_DELIVERY_PICKUP: entregar el retiro x10 -> entregado una vez, 9 recibos repetidos, stock sin cambios: PASS');

      const item = await newProduct('s06', 20);
      const [receiver, neighbour] = customers(2);
      const { at } = await one(`select to_char(clock_timestamp() at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as at`);
      const address = { delivery_mode: 'delivery', customer_street_address: 'Rio Senguer 1234', customer_neighborhood: 'Centro',
        delivery_latitude: '-38.9540', delivery_longitude: '-68.0600', delivery_location_source: 'map_pin', delivery_location_confirmed_at: at };
      const placed = await mustAll('entrega: pedidos con envio', [manualOrder(receiver, 'idem-race-s06-ride', item, 2, address),
        manualOrder(neighbour, 'idem-race-s06-self', item, 1, address)]);
      const ride = { id: placed[0].id, revision: Number(placed[0].revision) };
      const self = { id: placed[1].id, revision: Number(placed[1].revision) };
      const handoff = (orderId) => one(`select h.confirmed_at is not null as confirmed, h.confirmed_by_user_id as confirmed_by, h.failed_attempts as failed,
          h.locked_until is not null as locked,
          (select count(*)::int from public.order_delivery_handoffs x where x.order_id = h.order_id) as handoffs,
          (select coalesce(jsonb_object_agg(a.result, a.n), '{}'::jsonb) from (select result, count(*)::int as n
             from public.delivery_confirmation_attempts where order_id = h.order_id group by result) a) as attempts
        from public.order_delivery_handoffs h where h.order_id = $1`, [orderId]);

      // El cliente pide su código de entrega: el mismo pedido cinco veces devuelve el mismo código.
      const issue = (customerId, orderId, key) => ({ identity: buyer(customerId),
        sql: 'select public.issue_order_delivery_code($1::uuid, $2) as result', params: [orderId, trackingToken(key)] });
      const issued = await race('codigo de entrega x5', times(5, () => issue(receiver, ride.id, 'idem-race-s06-ride')));
      assert.ok(issued.every(ok) && identical(issued.map((result) => result.value)), `pedir el codigo cinco veces devuelve lo mismo -> ${codes(issued)}`);
      const code = issued[0].value.delivery_code;
      assert.match(code, /^[0-9]{4}$/, 'el codigo de entrega son cuatro digitos');
      assert.deepEqual(pick(await handoff(ride.id), 'handoffs', 'confirmed', 'failed'), { handoffs: 1, confirmed: false, failed: 0 }, 'un solo codigo emitido');
      const selfCode = (await mustCall('entrega: codigo del envio propio', issue(neighbour, self.id, 'idem-race-s06-self'))).delivery_code;
      const wrong = (right) => (right === '0000' ? '1111' : '0000');

      // El comercio prepara los dos pedidos.
      for (const status of ['accepted', 'preparing', 'ready']) {
        const stepped = await mustAll(`entrega: pasar a ${status}`, [transition(STAFF, ride.id, ride.revision, status, `idem-race-s06-ride-${status}`),
          transition(STAFF, self.id, self.revision, status, `idem-race-s06-self-${status}`)]);
        ride.revision = Number(stepped[0].revision);
        self.revision = Number(stepped[1].revision);
      }

      // Repartidor: oferta, aceptación, retiro, salida y llegada. Cada paso repetido a la vez.
      const offers = await race('ofrecer al repartidor x3', times(3, () => ({ identity: member(STAFF),
        sql: 'select public.offer_order_to_rider($1::uuid, $2, $3::uuid, $4::uuid) as result', params: [ride.id, 'ready', null, RIDER] })));
      assert.ok(offers.every(ok), `ofrecer tres veces no falla -> ${codes(offers)}`);
      assert.equal(count(offers, (result) => result.value.ok === true && result.value.code === 'offered'), 1, `una sola oferta -> ${codes(offers)}`);
      const offered = offers.find((result) => result.value.code === 'offered').value;
      assert.ok(offers.every((result) => result.value.code === 'offered'
        || (result.value.ok === false && result.value.code === 'already_offered' && result.value.offer.offer_id === offered.offer_id)),
      'las otras dos reciben already_offered con la misma oferta');
      const riderStep = async (where, fn, key, copies, args) => {
        const results = await race(where, times(copies, () => ({ identity: member(RIDER),
          sql: `select public.${fn}($1::uuid, $2::bigint, $3) as result`, params: [...args, key] })));
        assert.ok(results.every((result) => result.ok && result.value.ok === true), `${where}: ninguna copia falla -> ${codes(results)}`);
        assert.equal(count(results, (result) => result.value.idempotent_no_op === false), 1, `${where}: una sola copia aplica -> ${codes(results)}`);
        assert.ok(identical(results.map((result) => without(result.value, 'idempotent_no_op'))), `${where}: todas reciben el mismo resultado`);
        ride.revision = Number(results[0].value.order.revision);
        return results[0].value;
      };
      const accepted = await riderStep('aceptar la oferta x5', 'accept_rider_order_offer', 'idem-race-s06-accept', 5, [offered.offer_id, offered.version]);
      assert.deepEqual({ code: accepted.code, status: accepted.order.status }, { code: 'accepted', status: 'assigned' }, 'la oferta se acepta una vez');
      assert.deepEqual(pick(await orderState(ride.id), 'status', 'rider'), { status: 'assigned', rider: RIDER }, 'el pedido queda asignado al repartidor');
      assert.equal(await orderEvents(ride.id, 'order.rider_accepted_offer'), 1, 'un solo evento de aceptacion');
      for (const [fn, key, status] of [['mark_delivery_picked_up', 'idem-race-s06-picked', 'picked_up'],
        ['start_rider_delivery', 'idem-race-s06-route', 'on_the_way'], ['mark_rider_arrived', 'idem-race-s06-arrived', 'arrived']]) {
        const step = await riderStep(`${fn} x3`, fn, key, 3, [ride.id, ride.revision]);
        assert.equal(step.order.status, status, `${fn}: el pedido pasa a ${status}`);
      }
      const beforeDelivery = await orderState(ride.id);
      const confirm = (typed, key) => ({ typed, key, identity: member(RIDER),
        sql: 'select public.confirm_delivery_code($1::uuid, $2::bigint, $3, $4) as result', params: [ride.id, ride.revision, typed, key] });

      // Un código mal tipeado, enviado tres veces (el mismo envío): cuenta UN intento fallido.
      const typo = await race('codigo equivocado, el mismo envio x3', times(3, () => confirm(wrong(code), 'idem-race-s06-typo')));
      assert.ok(typo.every((result) => result.ok && result.value.ok === false && result.value.code === 'incorrect_code' && result.value.remaining_attempts === 4),
        `las tres copias reciben incorrect_code con 4 intentos restantes -> ${codes(typo)}`);
      assert.equal(count(typo, (result) => result.value.idempotent_no_op === true), 2, 'dos de las tres son la repeticion del resultado guardado');
      assert.deepEqual(pick(await handoff(ride.id), 'confirmed', 'failed', 'locked', 'attempts'),
        { confirmed: false, failed: 1, locked: false, attempts: { incorrect_code: 1 } }, 'un solo intento fallido contado');

      // El código bueno diez veces, mezclado con tres códigos equivocados (otros tres envíos).
      const finish = await race('entrega con codigo x10 + 3 equivocados', [
        ...times(3, (index) => confirm(wrong(code), `idem-race-s06-wrong-${index}`)), ...times(10, () => confirm(code, 'idem-race-s06-confirm'))]);
      assert.ok(finish.every(ok), `ninguna copia falla -> ${codes(finish)}`);
      const good = finish.filter((result) => result.task.typed === code);
      const bad = finish.filter((result) => result.task.typed !== code);
      assert.ok(good.every((result) => result.value.ok === true && result.value.outcome === 'confirmed'), `el codigo bueno nunca queda bloqueado -> ${codes(good)}`);
      assert.equal(count(good, (result) => result.value.idempotent_no_op === false), 1, 'una sola copia confirma la entrega');
      assert.ok(identical(good.map((result) => without(result.value, 'idempotent_no_op'))), 'las diez copias reciben el mismo resultado');
      const counted = bad.filter((result) => result.value.ok === false && result.value.code === 'incorrect_code');
      const afterwards = bad.filter((result) => result.value.ok === true && result.value.outcome === 'already_delivered');
      assert.equal(counted.length + afterwards.length, 3, `cada codigo equivocado cuenta como intento fallido o llega con el pedido ya entregado -> ${codes(bad)}`);
      assert.deepEqual(counted.map((result) => result.value.remaining_attempts).sort((a, b) => b - a), [3, 2, 1].slice(0, counted.length),
        'cada intento fallido descuenta uno: ninguno se pierde');
      assert.deepEqual(pick(await orderState(ride.id), 'status', 'delivered', 'revision', 'changes'),
        { status: 'delivered', delivered: true, revision: ride.revision + 1, changes: beforeDelivery.changes + 1 }, 'entregado exactamente una vez');
      const expectedAttempts = { confirmed: 1, incorrect_code: 1 + counted.length, ...(afterwards.length ? { already_delivered: afterwards.length } : {}) };
      assert.deepEqual(pick(await handoff(ride.id), 'confirmed', 'confirmed_by', 'failed', 'locked', 'attempts'),
        { confirmed: true, confirmed_by: RIDER, failed: 0, locked: false, attempts: expectedAttempts },
        'una entrega confirmada por el repartidor; los intentos fallidos quedaron anotados');
      assert.equal((await one(`select count(*)::int as n from public.delivery_outbox where order_id = $1 and event_type = 'delivery_confirmed'`, [ride.id])).n, 1,
        'un solo aviso de entrega confirmada');
      // Repetir después: el mismo envío devuelve su resultado y cualquier otro encuentra el pedido entregado.
      const repeat = await race('entrega repetida x5', [confirm(code, 'idem-race-s06-confirm'), confirm(code, 'idem-race-s06-otra-vez'),
        confirm(wrong(code), 'idem-race-s06-tarde'), confirm(wrong(code), 'idem-race-s06-typo'), confirm(code, 'idem-race-s06-confirm')]);
      assert.deepEqual(repeat.map((result) => (result.ok ? `${result.value.outcome || result.value.code}:${result.value.idempotent_no_op}` : result.code)),
        ['confirmed:true', 'already_delivered:true', 'already_delivered:true', 'incorrect_code:true', 'confirmed:true'], 'repetir es un no-op para todos');
      assert.deepEqual(pick(await orderState(ride.id), 'status', 'revision'), { status: 'delivered', revision: ride.revision + 1 }, 'repetir no mueve el pedido');
      assert.deepEqual(pick(await handoff(ride.id), 'failed', 'locked'), { failed: 0, locked: false }, 'ni cuenta intentos fallidos nuevos');
      family('delivery completion (confirm_delivery_code)', 'x10 codigo bueno + x3 equivocados', 'entregado una vez, 1 entrega confirmada');
      log(`IDEMPOTENCY_DELIVERY_RIDER: codigo de entrega x5 -> 1 codigo; oferta x3 -> 1; aceptar x5, retirar x3, salir x3, llegar x3 -> 1 cada uno;`
        + ` el mismo codigo equivocado x3 -> 1 intento fallido; codigo bueno x10 + 3 equivocados -> entregado una vez,`
        + ` ${counted.length} fallido(s) antes y ${afterwards.length} con el pedido ya entregado, sin bloqueo; repetir -> no-op: PASS`);

      // El comercio lleva su propio envío y lo cierra con el código del cliente.
      const dispatched = await mustCall('entrega: despachar el envio propio', transition(STAFF, self.id, self.revision, 'on_the_way', 'idem-race-s06-self-dispatch'));
      self.revision = Number(dispatched.revision);
      const close = (typed, key) => ({ typed, key, identity: member(STAFF),
        sql: 'select public.confirm_business_delivery_code($1::uuid, $2::bigint, $3, $4) as result', params: [self.id, self.revision, typed, key] });
      const selfTypo = await race('cierre del comercio: el mismo codigo equivocado x3', times(3, () => close(wrong(selfCode), 'idem-race-s06-self-typo')));
      assert.ok(selfTypo.every((result) => result.ok && result.value.ok === false && result.value.code === 'incorrect_code'),
        `las tres copias reciben incorrect_code -> ${codes(selfTypo)}`);
      const selfFailed = (await handoff(self.id)).failed;
      // DEFECTO: el mismo envío (misma clave) con un código equivocado gasta un intento por
      // cada copia: el recibo sólo se guarda cuando la entrega se confirma. Debería contar uno.
      if (selfFailed !== 1) {
        assert.equal(selfFailed, 3, 'el defecto conocido cuenta un intento por copia');
        defect('BUSINESS_DELIVERY_WRONG_CODE_RETRY', 'confirm_business_delivery_code: el mismo envio (misma clave) con un codigo equivocado x3 conto'
          + ` ${selfFailed} intentos fallidos en vez de 1 (respuestas: ${selfTypo.map((result) => result.value.remaining_attempts).sort().join('/')} intentos restantes)`);
      }
      // Con el reintento reconocido: una copia cuenta el intento y las otras dos son su repetición, con
      // los mismos intentos restantes.
      if (selfFailed === 1) {
        assert.ok(selfTypo.every((result) => result.value.remaining_attempts === 4), `las tres copias ven 4 intentos restantes -> ${codes(selfTypo)}`);
        assert.equal(count(selfTypo, (result) => result.value.idempotent_replay === true), 2, 'dos de las tres son la repeticion del mismo envio');
        assert.deepEqual(pick(await handoff(self.id), 'locked', 'attempts'), { locked: false, attempts: { incorrect_code: 1 } },
          'un solo intento anotado, sin demora');
      }
      const closedByBusiness = oneKeyWins('cierre del comercio x10', await race('confirm_business_delivery_code x10',
        times(10, () => close(selfCode, 'idem-race-s06-self-close'))), self.revision);
      assert.deepEqual(pick(closedByBusiness.value, 'status', 'outcome', 'code_verified'), { status: 'delivered', outcome: 'confirmed', code_verified: true },
        'el comercio cierra la entrega con el codigo');
      assert.deepEqual(pick(await orderState(self.id), 'status', 'delivered', 'revision'), { status: 'delivered', delivered: true, revision: self.revision + 1 },
        'entregado una vez');
      assert.equal(await orderEvents(self.id, 'order.business_self_delivery'), 1, 'un solo evento de entrega propia');
      assert.deepEqual(pick(await handoff(self.id), 'confirmed', 'confirmed_by', 'failed'), { confirmed: true, confirmed_by: STAFF, failed: 0 }, 'una entrega confirmada');
      await assertStock(item, 'entrega con envio', { stock: 17, held: 0, consumed: 3 });
      family('delivery completion (confirm_business_delivery_code)', 'x10', 'entregado una vez, 9 recibos repetidos');
      log(`IDEMPOTENCY_DELIVERY_BUSINESS: cierre del comercio x10 -> entregado una vez, 9 recibos repetidos; el mismo codigo equivocado x3 -> ${selfFailed} intento(s) fallido(s):`
        + ` ${selfFailed === 1 ? 'PASS' : 'DEFECT'}`);
    }

    // ── 6d · OFERTA contra ACEPTACIÓN: el comercio ofrece el pedido a otro repartidor mientras el primero acepta ──
    {
      const item = await newProduct('s06d', 10);
      const { at } = await one(`select to_char(clock_timestamp() at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as at`);
      const address = { delivery_mode: 'delivery', customer_street_address: 'Rio Senguer 1234', customer_neighborhood: 'Centro',
        delivery_latitude: '-38.9540', delivery_longitude: '-68.0600', delivery_location_source: 'map_pin', delivery_location_confirmed_at: at };
      // Seis pedidos listos, cada uno ofrecido a un repartidor. Se alternan: un repartidor lleva a lo sumo tres entregas.
      const placed = await mustAll('oferta contra aceptacion: pedidos con envio',
        customers(6).map((id, index) => manualOrder(id, `idem-race-s06d-${index}`, item, 1, address)));
      const rounds = placed.map((row, index) => ({ index, id: row.id, revision: Number(row.revision),
        rider: index % 2 === 0 ? RIDER : RIDER_B, other: index % 2 === 0 ? RIDER_B : RIDER }));
      for (const status of ['accepted', 'preparing', 'ready']) {
        const stepped = await mustAll(`oferta contra aceptacion: pasar a ${status}`,
          rounds.map((round) => transition(STAFF, round.id, round.revision, status, `idem-race-s06d-${round.index}-${status}`)));
        rounds.forEach((round, index) => { round.revision = Number(stepped[index].revision); });
      }
      const offerTo = (round, rider) => ({ kind: 'offer', identity: member(STAFF),
        sql: 'select public.offer_order_to_rider($1::uuid, $2, $3::uuid, $4::uuid) as result', params: [round.id, 'ready', null, rider] });
      const acceptOf = (round) => ({ kind: 'accept', identity: member(round.rider),
        sql: 'select public.accept_rider_order_offer($1::uuid, $2::bigint, $3) as result',
        params: [round.offer.offer_id, round.offer.version, `idem-race-s06d-accept-${round.index}`] });
      const withdrawOf = (round) => ({ kind: 'withdraw', identity: member(STAFF),
        sql: 'select public.withdraw_rider_order_offer($1::uuid) as result', params: [round.offer.offer_id] });
      const offersOf = (orderId) => rows(`select f.rider_user_id as rider, f.status from public.rider_order_offers f
         where f.order_id = $1 order by f.offered_at, f.id`, [orderId]);
      // El candado que se disputa acá: el del pedido.
      const holdOrder = (round) => ({ sql: 'select 1 from public.orders where id = $1 for update', params: [round.id] });
      const offered = await mustAll('oferta contra aceptacion: ofrecer', rounds.map((round) => offerTo(round, round.rider)));
      assert.ok(offered.every((value) => value.ok === true && value.code === 'offered'), 'cada pedido queda ofrecido a su repartidor');
      rounds.forEach((round, index) => { round.offer = offered[index]; });
      // Sólo hay un final: el repartidor acepta SU oferta y el pedido es suyo. La oferta al otro repartidor
      // no entra nunca: si llegó con la primera todavía pendiente recibe `offer_in_flight` con esa oferta; si
      // llegó con el pedido ya asignado, el conflicto de asignación del Panel (PT409).
      const assignedOnce = async (where, round, results) => {
        const accepted = results.find((result) => result.task.kind === 'accept');
        const rival = results.find((result) => result.task.kind === 'offer');
        assert.ok(accepted.ok && accepted.value.ok === true && accepted.value.code === 'accepted' && accepted.value.idempotent_no_op === false,
          `${where}: el repartidor acepta su oferta (tras un reintento si hubo deadlock) -> ${codes([accepted])}`);
        const inFlight = rival.ok && rival.value.ok === false && rival.value.code === 'offer_in_flight' && rival.value.offer.offer_id === round.offer.offer_id;
        assert.ok(inFlight || refusedWith(rival, 'PT409', 'conflicto de asignacion: estado o rider esperado cambio'),
          `${where}: la oferta al otro repartidor recibe offer_in_flight o el conflicto de asignacion -> ${codes([rival])}`);
        assert.deepEqual(pick(await orderState(round.id), 'status', 'rider'), { status: 'assigned', rider: round.rider },
          `${where}: el pedido queda asignado a quien acepto`);
        assert.deepEqual(await offersOf(round.id), [{ rider: round.rider, status: 'accepted' }], `${where}: una sola oferta, aceptada; ninguna para el otro repartidor`);
        assert.equal(await orderEvents(round.id, 'order.rider_accepted_offer'), 1, `${where}: un solo evento de aceptacion`);
        return inFlight ? 'in_flight' : 'conflict';
      };

      // Primero con la llegada fijada: la oferta al otro repartidor entra antes (toma el pedido) y la aceptación después.
      const [probe, ...rest] = rounds;
      const free = rest.slice(0, 4);
      const pulled = rest[4];
      const crossing = await staged('oferta: el comercio ofrece a otro repartidor contra la aceptacion del primero',
        holdOrder(probe), [offerTo(probe, probe.other), acceptOf(probe)]);
      const offerVictims = crossing.filter((result) => result.retriedAfter === '40P01')
        .map((result) => (result.task.kind === 'accept' ? 'la aceptacion del repartidor' : 'la oferta del comercio'));
      const staggered = await assignedOnce('oferta primero, aceptacion despues', probe, crossing);
      if (!offerVictims.length) assert.equal(staggered, 'in_flight', 'sin deadlock, la oferta que llego primero encuentra la otra todavia pendiente');
      // DEFECTO: `accept_rider_order_offer` toma la oferta y después el pedido, al revés que
      // `offer_order_to_rider` (pedido -> oferta pendiente). Con las llegadas en ese orden el deadlock
      // es seguro: Postgres corta una de las dos y, si es la del repartidor, tiene que volver a aceptar.
      if (offerVictims.length) {
        defect('RIDER_OFFER_ACCEPT_LOCK_ORDER', 'accept_rider_order_offer toma oferta -> pedido, al reves que offer_order_to_rider (pedido -> oferta):'
          + ` ${offerVictims.length} deadlock(s) 40P01 con el orden de llegada fijado; Postgres corto ${offerVictims.join(' y ')}`,
        ['oferta: el comercio ofrece a otro repartidor contra la aceptacion del primero', 'oferta a otro repartidor contra aceptacion']);
      }

      // Y cuatro rondas libres: la aceptación y la oferta al otro repartidor salen en el mismo instante.
      const split = { in_flight: 0, conflict: 0 };
      for (const round of free) {
        const pair = round.index % 2 === 0 ? [acceptOf(round), offerTo(round, round.other)] : [offerTo(round, round.other), acceptOf(round)];
        split[await assignedOnce(`ronda libre ${round.index}`, round, await race('oferta a otro repartidor contra aceptacion', pair))] += 1;
      }
      // Aceptar otra vez lo ya aceptado (el mismo envío): no-op para las tres copias.
      const again = await race('aceptar la oferta ya aceptada x3', times(3, () => acceptOf(probe)));
      assert.ok(again.every((result) => result.ok && result.value.ok === true && result.value.idempotent_no_op === true),
        `repetir la aceptacion devuelve el resultado guardado -> ${codes(again)}`);
      assert.deepEqual(await offersOf(probe.id), [{ rider: probe.rider, status: 'accepted' }], 'repetir no crea otra oferta ni mueve la aceptada');

      // Lo que corregir el cruce de arriba no puede romper: el comercio RETIRA la oferta mientras el repartidor
      // la acepta. Retirar (y rechazar) toma la oferta y después anota un evento del pedido, que por su clave
      // foránea pide KEY SHARE sobre el pedido. Si la aceptación tomara el pedido FOR UPDATE estas dos se
      // trabarían; con FOR NO KEY UPDATE no. Gana una de las dos y nadie recibe un deadlock.
      const tug = await staged('oferta: la aceptacion contra el retiro de la oferta', holdOrder(pulled), [acceptOf(pulled), withdrawOf(pulled)]);
      assert.equal(count(tug, (result) => result.retriedAfter === '40P01'), 0, `aceptar y retirar la misma oferta no se traban -> ${codes(tug)}`);
      const [late, withdrawal] = tug;
      const withdrawn = withdrawal.ok && withdrawal.value.ok === true && withdrawal.value.code === 'withdrawn';
      if (withdrawn) {
        assert.ok(late.ok && late.value.ok === false && late.value.code === 'offer_not_available' && late.value.offer_status === 'withdrawn',
          `gano el retiro: la aceptacion encuentra la oferta retirada -> ${codes(tug)}`);
        assert.deepEqual([pick(await orderState(pulled.id), 'status', 'rider'), await offersOf(pulled.id)],
          [{ status: 'ready', rider: null }, [{ rider: pulled.rider, status: 'withdrawn' }]], 'el pedido sigue listo y sin repartidor, con la oferta retirada');
      } else {
        assert.ok(late.ok && late.value.ok === true && late.value.code === 'accepted'
          && withdrawal.ok && withdrawal.value.ok === false && withdrawal.value.code === 'offer_not_pending',
        `gano la aceptacion: el retiro encuentra la oferta ya respondida -> ${codes(tug)}`);
        assert.deepEqual([pick(await orderState(pulled.id), 'status', 'rider'), await offersOf(pulled.id)],
          [{ status: 'assigned', rider: pulled.rider }, [{ rider: pulled.rider, status: 'accepted' }]], 'el pedido queda asignado, con la oferta aceptada');
      }
      await assertStock(item, 'oferta contra aceptacion', { stock: 4, held: 6, consumed: 0 });
      family('rider assignment (accept_rider_order_offer vs offer_order_to_rider)', '1 + 1 con la llegada fijada, 4 rondas libres',
        'el pedido queda asignado una vez a quien acepto; la oferta al otro repartidor no entra');
      family('rider assignment (accept_rider_order_offer vs withdraw_rider_order_offer)', '1 + 1 con la llegada fijada', 'gana una de las dos; sin deadlock');
      log('IDEMPOTENCY_RIDER_OFFER: el comercio ofrece el pedido a otro repartidor mientras el primero acepta, con la llegada fijada ->'
        + ` ${offerVictims.length ? `deadlock, Postgres corto ${offerVictims.join(' y ')}` : 'aceptado, la otra oferta recibe offer_in_flight'};`
        + ` 4 rondas libres -> 4 pedidos asignados a quien acepto (${split.in_flight} x offer_in_flight, ${split.conflict} x PT409 para la otra oferta);`
        + ` aceptar otra vez x3 -> no-op; aceptar contra retirar la oferta -> gana ${withdrawn ? 'el retiro' : 'la aceptacion'}, sin deadlock:`
        + ` ${offerVictims.length ? 'DEFECT' : 'PASS'}`);
    }

    // ── 7 · REEMBOLSO de un pedido pagado por Mercado Pago ─────────────────────
    {
      const item = await newProduct('s07', 30);
      const [whole, rivals, partial] = await paidOrders('reembolso', customers(3).map((id, index) => (
        { customer: id, key: `idem-race-s07-${index}`, product: item, quantity: 3, ref: `s07-${index}` })));
      const refundsOf = (session) => rows(`select r.id, r.status, r.amount::float8 as amount, r.idempotency_key as key, r.provider_refund_id as provider,
          r.order_id, r.provider_attempts as attempts, r.completed_at is not null as completed
        from public.payment_refunds r where r.payment_intent_id = $1 order by r.requested_at, r.id`, [session.intentId]);
      const money = async (session) => pick(await sessionState(session.sessionId), 'intent', 'paid', 'refunded');
      const committed = async (session) => sum((await refundsOf(session)).filter((row) => row.status !== 'rejected' && row.status !== 'failed').map((row) => row.amount));
      // Lo que hace la Edge Function con la respuesta de Mercado Pago: primero la identidad, después el resultado.
      const settle = async (where, session, refundId, key, amount, copies) => {
        const providerId = newProviderRefund();
        const identities = await race(`${where}: identidad x${copies}`, times(copies, () => refundIdentity(session, refundId, key, providerId)));
        assert.ok(identities.every((result) => result.ok && result.value === true), `${where}: la identidad se asienta igual para todas las copias -> ${codes(identities)}`);
        const answers = await race(`${where}: respuesta x${copies}`,
          times(copies, () => refundResponse(refundId, providerId, 'approved', amount, `idem-race-refund-${providerId}`)));
        assert.ok(answers.every((result) => result.ok && result.value.ok === true), `${where}: la respuesta del proveedor nunca falla -> ${codes(answers)}`);
        assert.equal(count(answers, (result) => result.value.idempotent === false), 1, `${where}: una sola copia asienta el reembolso -> ${codes(answers)}`);
        assert.equal(count(answers, (result) => result.value.idempotent === true), copies - 1, `${where}: las demas responden idempotent`);
        return providerId;
      };
      // Una clave gana: una copia crea la solicitud, sus otras copias y TODAS las de las otras claves
      // reciben esa misma solicitud con `reconciliation_required` (la Edge Function no vuelve a enviar).
      const oneRefund = (where, results, session, amount) => {
        assert.ok(results.every(ok), `${where}: ninguna copia falla -> ${codes(results)}`);
        const fresh = results.filter((result) => result.value.idempotent === false);
        assert.equal(fresh.length, 1, `${where}: una sola copia crea la solicitud -> ${codes(results)}`);
        const made = fresh[0].value;
        assert.deepEqual(pick(made, 'provider_payment_id', 'amount', 'idempotency_key'),
          { provider_payment_id: session.paymentId, amount, idempotency_key: fresh[0].task.key }, `${where}: la solicitud es por ${amount} con la clave de quien gano`);
        const rest = results.filter((result) => result !== fresh[0]);
        assert.ok(rest.every((result) => result.value.idempotent === true && result.value.reconciliation_required === true
          && result.value.refund_id === made.refund_id && result.value.idempotency_key === made.idempotency_key && Number(result.value.amount) === amount),
        `${where}: las demas copias reciben la MISMA solicitud y reconciliation_required -> ${codes(rest)}`);
        return { ...made, key: fresh[0].task.key, full: made.full_refund };
      };

      // (a) La misma clave diez veces, por el total.
      const keyA = newKey();
      const first = oneRefund('reembolso x10', await race('prepare_payment_refund_v2 x10', times(10, () => refund(whole.intentId, null, keyA))), whole, 3000);
      assert.equal(first.full, true, 'la base dice que es el reembolso total');
      assert.deepEqual(await refundsOf(whole), [{ id: first.refund_id, status: 'requested', amount: 3000, key: keyA, provider: null, order_id: whole.orderId,
        attempts: 1, completed: false }], 'una sola solicitud de reembolso');
      // (c) La respuesta del proveedor diez veces.
      const providerA = await settle('reembolso', whole, first.refund_id, keyA, 3000, 10);
      assert.deepEqual(await refundsOf(whole), [{ id: first.refund_id, status: 'approved', amount: 3000, key: keyA, provider: providerA, order_id: whole.orderId,
        attempts: 1, completed: true }], 'la solicitud queda aprobada una vez');
      assert.deepEqual(await money(whole), { intent: 'refunded', paid: 3000, refunded: 3000 }, 'devuelto una vez: 3000, no 6000');
      assert.equal(await paymentEvents(whole.intentId, 'payment.refund_approved'), 1, 'un solo evento de reembolso aprobado');
      // Respuestas tardías de todo tipo, a la vez: nada cambia.
      const late = await race('reembolso: respuestas tardias', [
        ...times(3, () => refundIdentity(whole, first.refund_id, keyA, providerA)),
        ...times(3, () => refundResponse(first.refund_id, providerA, 'approved', 3000, `idem-race-refund-${providerA}`)),
        ...times(3, () => refundAmbiguous(first.refund_id, 'idem-race-s07-late')),
        refund(whole.intentId, null, keyA), refund(whole.intentId, null, newKey())]);
      assert.ok(late.slice(0, 9).every((result) => result.ok && (result.value === true || result.value.idempotent === true)),
        `identidad, respuesta y marca dudosa tardias son no-ops -> ${codes(late.slice(0, 9))}`);
      assert.ok(late.slice(9).every((result) => refusedWith(result, '55000', 'pago no reembolsable en su estado actual')),
        `pedir otro reembolso de un cobro devuelto entero se rechaza con 55000 -> ${codes(late.slice(9))}`);
      assert.deepEqual([await money(whole), await paymentEvents(whole.intentId, 'payment.refund_approved'), (await refundsOf(whole)).length,
        (await one(`select count(*)::int as n from public.payment_outbox where refund_id = $1`, [first.refund_id])).n],
      [{ intent: 'refunded', paid: 3000, refunded: 3000 }, 1, 1, 0], 'ni importe, ni evento, ni solicitud, ni trabajo de conciliacion nuevos');

      // (b) Dos claves distintas, cada una por el total, a la vez.
      const [keyB, keyC] = [newKey(), newKey()];
      const duel = oneRefund('reembolso total: dos claves', await race('prepare_payment_refund_v2 dos claves',
        times(10, (index) => refund(rivals.intentId, null, index % 2 === 0 ? keyB : keyC))), rivals, 3000);
      assert.deepEqual((await refundsOf(rivals)).map((row) => `${row.status}:${row.amount}:${row.key}`), [`requested:3000:${duel.key}`],
        'una sola solicitud por el total: nunca dos');
      assert.equal(await committed(rivals), 3000, 'lo comprometido en reembolsos no supera lo cobrado');
      await settle('reembolso total: dos claves', rivals, duel.refund_id, duel.key, 3000, 3);
      assert.deepEqual(await money(rivals), { intent: 'refunded', paid: 3000, refunded: 3000 }, 'devuelto una vez');

      // (d) Un parcial, y después dos reembolsos del resto a la vez.
      const keyD = newKey();
      const part = oneRefund('reembolso parcial', await race('prepare_payment_refund_v2 parcial x4', times(4, () => refund(partial.intentId, 1000, keyD))), partial, 1000);
      assert.equal(part.full, false, 'la base dice que es parcial');
      await settle('reembolso parcial', partial, part.refund_id, keyD, 1000, 3);
      assert.deepEqual(await money(partial), { intent: 'partially_refunded', paid: 3000, refunded: 1000 }, 'parcial asentado: 1000 de 3000');
      // Más que el resto no entra, aunque lo pidan dos a la vez.
      const greedy = await race('reembolso: dos pedidos por mas que el resto', [refund(partial.intentId, 2500, newKey()), refund(partial.intentId, 2000.01, newKey())]);
      assert.ok(greedy.every((result) => refusedWith(result, '22023', 'importe de reembolso invalido')), `pedir mas que el resto se rechaza con 22023 -> ${codes(greedy)}`);
      const [keyE, keyF] = [newKey(), newKey()];
      const rest = oneRefund('reembolso del resto: dos claves', await race('prepare_payment_refund_v2 resto dos claves', [
        refund(partial.intentId, null, keyE), refund(partial.intentId, 2000, keyF), refund(partial.intentId, null, keyE), refund(partial.intentId, 2000, keyF)]), partial, 2000);
      assert.deepEqual((await refundsOf(partial)).map((row) => `${row.status}:${row.amount}`), ['approved:1000', 'requested:2000'],
        'un parcial aprobado y UNA solicitud por el resto');
      assert.equal(await committed(partial), 3000, 'parcial + resto = lo cobrado, nunca mas');
      await settle('reembolso del resto', partial, rest.refund_id, rest.key, 2000, 3);
      assert.deepEqual(await money(partial), { intent: 'refunded', paid: 3000, refunded: 3000 }, 'devuelto entero: 1000 + 2000');
      assert.deepEqual([await paymentEvents(partial.intentId, 'payment.refund_approved'), await committed(partial)], [2, 3000], 'dos reembolsos aprobados que suman lo cobrado');
      // Los pedidos siguen ahí con su stock: devolver el dinero no toca el inventario.
      await assertStock(item, 'reembolso', { stock: 21, reserved: 0, held: 9 });
      family('refund (prepare_payment_refund_v2)', 'x10 misma clave / dos claves x5+x5', '1 solicitud; las demas copias reciben esa solicitud y reconciliation_required');
      family('refund (record_payment_refund_identity + record_payment_refund_response_v2)', 'x10', 'devuelto una vez, 1 evento');
      log('IDEMPOTENCY_REFUND: la misma clave x10 -> 1 solicitud, el mismo refund_id; respuesta del proveedor x10 -> devuelto 3000 una vez, 1 evento;'
        + ' dos claves por el total x5+x5 -> 1 solicitud, la otra clave recibe reconciliation_required; parcial 1000 + dos por el resto ->'
        + ' 1 solicitud de 2000, total devuelto 3000 = cobrado; pedir de mas -> 22023; cobro devuelto -> 55000: PASS');
    }

    // ── 8 · CANCELACIÓN DE UN PAGO PENDIENTE ─────────────────────────────────────
    {
      const item = await newProduct('s08', 40);
      const sessions = await sessionsWithPreference('cancelacion de pago', customers(9).map((id, index) => (
        { customer: id, key: `idem-race-s08-${index}`, product: item, quantity: 2, ref: `s08-${index}` })));
      // El comprador eligió un medio que queda pendiente (un cupón de pago): el cobro existe y el dueño lo puede cancelar.
      const pending = await mustAll('cancelacion de pago: pago pendiente',
        await inOrder(sessions, (session) => snapshot(session, 'pending', `idem-race-${session.ref}-pending`)));
      assert.ok(pending.every((value) => value.ok === true && value.internal_status === 'pending' && value.finalize_required === false), 'los nueve pagos quedan pendientes');
      await assertStock(item, 'cancelacion de pago: reservado', { stock: 22, reserved: 18 });
      const [repeated, rivals, probe, doubt, ...rounds] = sessions;
      const cancellationsOf = (session) => rows(`select c.id, c.status, c.idempotency_key as key, c.completed_at is not null as completed,
          (select count(*)::int from public.payment_outbox o where o.cancellation_id = c.id) as jobs
        from public.payment_cancellations c where c.payment_intent_id = $1 order by c.requested_at, c.id`, [session.intentId]);
      const answeredOnce = (where, results) => {
        assert.ok(results.every((result) => result.ok && result.value.ok === true), `${where}: la respuesta del proveedor nunca falla -> ${codes(results)}`);
        assert.equal(count(results, (result) => result.value.idempotent === false), 1, `${where}: una sola copia asienta la respuesta -> ${codes(results)}`);
      };
      const notCancellable = (result) => refusedWith(result, '55000', 'pago no cancelable en su estado actual');
      const lockOrderVictims = [];

      // La misma cancelación diez veces.
      const keyA = newKey();
      const same = await race('prepare_payment_cancellation x10', times(10, () => cancelPayment(repeated.intentId, keyA)));
      assert.ok(same.every(ok), `la misma cancelacion diez veces nunca falla -> ${codes(same)}`);
      assert.equal(count(same, (result) => result.value.idempotent === false), 1, `una sola copia crea la solicitud -> ${codes(same)}`);
      assert.ok(identical(same.map((result) => pick(result.value, 'cancellation_id', 'provider_payment_id', 'idempotency_key')))
        && same[0].value.idempotency_key === keyA && same[0].value.provider_payment_id === repeated.paymentId, 'las diez llevan la misma solicitud, la misma clave y el mismo pago');
      assert.ok(same.filter((result) => result.value.idempotent).every((result) => result.value.reconciliation_required === false),
        'la repeticion de la misma clave no pide conciliacion: reenvia con la MISMA clave y el proveedor deduplica');
      const cancellationId = same[0].value.cancellation_id;
      assert.deepEqual(await cancellationsOf(repeated), [{ id: cancellationId, status: 'requested', key: keyA, completed: false, jobs: 0 }], 'una sola solicitud de cancelacion');
      // Mercado Pago contesta «cancelado»: la misma respuesta diez veces.
      answeredOnce('respuesta de cancelacion x10', await race('record_payment_cancellation_response x10',
        times(10, () => cancellationResponse(cancellationId, 'cancelled', 'idem-race-s08-cancelled'))));
      const cancelledState = { session: 'cancelled', intent: 'cancelled', reservations: ['released:2:owner_cancelled_payment'], orders: 0 };
      assert.deepEqual(pick(await sessionState(repeated.sessionId), 'session', 'intent', 'reservations', 'orders'), cancelledState,
        'cobro y sesion cancelados, la reserva liberada una vez');
      assert.equal(await paymentEvents(repeated.intentId, 'payment.cancellation_cancelled'), 1, 'un solo evento de cancelacion');
      await assertStock(item, 'cancelacion de pago x10', { stock: 24, reserved: 16 });
      // Todo lo que puede llegar tarde, a la vez: nada cambia.
      const late = await race('cancelacion de pago: respuestas tardias', [
        ...times(3, () => cancellationResponse(cancellationId, 'cancelled', 'idem-race-s08-cancelled-otra-lectura')),
        ...times(3, () => cancellationAmbiguous(cancellationId, 'idem-race-s08-late')),
        cancelPayment(repeated.intentId, keyA), cancelPayment(repeated.intentId, newKey()),
        cancellationResponse(cancellationId, 'rejected', 'idem-race-s08-contradice')]);
      assert.ok(late.slice(0, 6).every((result) => result.ok && (result.value === true || result.value.idempotent === true)),
        `la misma respuesta y la marca dudosa tardias son no-ops -> ${codes(late.slice(0, 6))}`);
      assert.ok(late.slice(6, 8).every(notCancellable), `volver a pedir la cancelacion de un pago cancelado se rechaza con 55000 -> ${codes(late.slice(6, 8))}`);
      assert.ok(refusedWith(late[8], '55000', 'resultado de cancelacion ya confirmado'), `una respuesta contradictoria se rechaza con 55000 -> ${codes(late.slice(8))}`);
      assert.deepEqual([pick(await sessionState(repeated.sessionId), 'session', 'intent', 'reservations', 'orders'),
        await paymentEvents(repeated.intentId, 'payment.cancellation_cancelled'), await cancellationsOf(repeated)],
      [cancelledState, 1, [{ id: cancellationId, status: 'cancelled', key: keyA, completed: true, jobs: 0 }]], 'ni estado, ni evento, ni trabajo de conciliacion nuevos');
      await assertStock(item, 'cancelacion de pago repetida', { stock: 24, reserved: 16 });

      // Dos claves distintas a la vez: una solicitud. Mercado Pago la rechaza: el pago y su reserva siguen.
      const [keyB, keyC] = [newKey(), newKey()];
      const duel = await race('prepare_payment_cancellation dos claves', times(10, (index) => cancelPayment(rivals.intentId, index % 2 === 0 ? keyB : keyC)));
      assert.ok(duel.every(ok), `ninguna copia falla -> ${codes(duel)}`);
      const made = duel.filter((result) => result.value.idempotent === false);
      assert.equal(made.length, 1, `una sola copia crea la solicitud -> ${codes(duel)}`);
      assert.ok(duel.every((result) => result.value.cancellation_id === made[0].value.cancellation_id && result.value.idempotency_key === made[0].task.key),
        'las diez copias reciben la solicitud y la clave de quien gano');
      assert.ok(duel.filter((result) => result.task.key !== made[0].task.key).every((result) => result.value.idempotent === true && result.value.reconciliation_required === true),
        'la otra clave recibe reconciliation_required: no se envia una segunda cancelacion');
      answeredOnce('cancelacion rechazada x5', await race('record_payment_cancellation_response rechazada x5',
        times(5, () => cancellationResponse(made[0].value.cancellation_id, 'rejected', 'idem-race-s08-rejected'))));
      assert.deepEqual(pick(await sessionState(rivals.sessionId), 'session', 'intent', 'reservations'),
        { session: 'payment_pending', intent: 'pending', reservations: ['active:2:-'] }, 'el rechazo del proveedor no libera nada');
      const contradicted = await race('cancelacion rechazada: respuesta contradictoria x2',
        times(2, () => cancellationResponse(made[0].value.cancellation_id, 'cancelled', 'idem-race-s08-rejected-contradice')));
      assert.ok(contradicted.every((result) => refusedWith(result, '55000', 'resultado de cancelacion ya confirmado')),
        `un rechazo confirmado no se pisa con una cancelacion -> ${codes(contradicted)}`);

      // Tras el rechazo el dueño vuelve a pedir la cancelación. Su pedido llega duplicado (doble toque) justo
      // cuando se asienta la respuesta del primero: el duplicado llegó antes y la respuesta después.
      const keyD = newKey();
      const second = await mustCall('cancelacion de pago: segunda solicitud', cancelPayment(rivals.intentId, keyD));
      assert.equal(second.idempotent, false, 'despues de un rechazo se puede pedir otra cancelacion');
      const overlap = await staged('cancelacion: pedido duplicado contra la respuesta del proveedor', holdIntent(rivals),
        [cancelPayment(rivals.intentId, keyD), cancellationResponse(second.cancellation_id, 'cancelled', 'idem-race-s08-second')]);
      lockOrderVictims.push(...overlap.filter((result) => result.retriedAfter === '40P01')
        .map((result) => (result.task.kind === 'cancellation' ? 'la respuesta del proveedor' : 'el pedido duplicado')));
      assert.ok(overlap[1].ok && overlap[1].value.ok === true, `la respuesta del proveedor se asienta -> ${codes(overlap)}`);
      assert.ok((overlap[0].ok && overlap[0].value.cancellation_id === second.cancellation_id && overlap[0].value.idempotent === true) || notCancellable(overlap[0]),
        `el pedido duplicado recibe la misma solicitud o «pago no cancelable» -> ${codes(overlap)}`);
      assert.deepEqual(pick(await sessionState(rivals.sessionId), 'session', 'intent', 'reservations', 'orders'), cancelledState, 'cancelado una vez, la reserva liberada una vez');
      assert.deepEqual((await cancellationsOf(rivals)).map((row) => `${row.status}:${row.jobs}`), ['rejected:0', 'cancelled:0'],
        'la primera solicitud rechazada, la segunda cancelada');

      // El envío a Mercado Pago venció y la Edge Function marca la solicitud como dudosa, justo cuando llega
      // el segundo toque del dueño (la misma clave): el toque llegó antes y la marca después.
      const keyE = newKey();
      const unsure = await mustCall('cancelacion de pago: solicitud que queda dudosa', cancelPayment(doubt.intentId, keyE));
      const doubted = await staged('cancelacion: pedido duplicado contra la marca dudosa', holdIntent(doubt),
        [cancelPayment(doubt.intentId, keyE), cancellationAmbiguous(unsure.cancellation_id, 'idem-race-s08-doubt')]);
      const doubtVictims = doubted.filter((result) => result.retriedAfter === '40P01')
        .map((result) => (result.task.kind === 'ambiguous' ? 'la marca dudosa' : 'el pedido duplicado'));
      assert.ok(doubted[1].ok && doubted[1].value === true, `la marca dudosa se asienta -> ${codes(doubted)}`);
      assert.ok(doubted[0].ok && doubted[0].value.cancellation_id === unsure.cancellation_id && doubted[0].value.idempotent === true,
        `el pedido duplicado recibe la misma solicitud -> ${codes(doubted)}`);
      assert.deepEqual(await cancellationsOf(doubt), [{ id: unsure.cancellation_id, status: 'ambiguous', key: keyE, completed: false, jobs: 1 }],
        'la solicitud queda dudosa, con UN trabajo de conciliacion');
      // DEFECTO: `mark_payment_cancellation_ambiguous` toma solicitud -> cobro, al revés que
      // `prepare_payment_cancellation` (cobro -> solicitud). Con las llegadas en ese orden el deadlock es
      // seguro. Cuando la víctima es la marca, la Edge Function contesta «se está verificando» sin haber
      // encolado nada: la solicitud queda `requested` y nadie la concilia.
      if (doubtVictims.length) {
        defect('PAYMENT_CANCELLATION_AMBIGUOUS_LOCK_ORDER', 'mark_payment_cancellation_ambiguous toma solicitud -> cobro, al reves que prepare_payment_cancellation'
          + ` (cobro -> solicitud): ${doubtVictims.length} deadlock(s) 40P01 con el orden de llegada fijado; Postgres corto ${doubtVictims.join(' y ')}`,
        ['cancelacion: pedido duplicado contra la marca dudosa']);
      }
      // La conciliación lee el pago en Mercado Pago y confirma la cancelación: la reserva vuelve, una vez.
      answeredOnce('cancelacion dudosa confirmada x3', await race('record_payment_cancellation_response tras la marca dudosa x3',
        times(3, () => cancellationResponse(unsure.cancellation_id, 'cancelled', 'idem-race-s08-doubt-cancelled'))));
      assert.deepEqual(pick(await sessionState(doubt.sessionId), 'session', 'intent', 'reservations', 'orders'), cancelledState,
        'la cancelacion dudosa se confirma: cancelado una vez, la reserva liberada una vez');
      assert.deepEqual((await cancellationsOf(doubt)).map((row) => `${row.status}:${row.jobs}`), ['cancelled:1'], 'la solicitud queda cancelada; el trabajo de conciliacion sigue siendo uno');

      // La cancelación contra el aviso de «aprobado» del MISMO pago. Como el worker, se finaliza si el
      // aviso lo pidió. Sólo hay dos finales: o el pago quedó aprobado y es un pedido con su reserva
      // convertida (la cancelación no tocó stock), o se canceló, la reserva volvió una vez y el aprobado
      // quedó en revisión manual sin pedido. Nunca los dos, nunca un pedido sin su stock.
      const reviewState = { session: 'manual_review_required', intent: 'security_review_required', review: 'approved_after_reservation_expired',
        reservations: ['released:2:owner_cancelled_payment'], orders: 0, order_id: null, paid: 2000 };
      const crossed = async (where, session, results) => {
        assert.ok(results.every((result) => result.ok && result.value.ok === true), `${where}: cada copia termina bien (tras un reintento si hubo deadlock) -> ${codes(results)}`);
        answeredOnce(where, results.filter((result) => result.task.kind === 'cancellation'));
        const finalizing = results.some((result) => result.task.kind === 'snapshot' && result.value.finalize_required === true);
        if (finalizing) {
          const finals = await race('finalizar tras la carrera x2', times(2, () => finalize(session)));
          assert.ok(finals.every((result) => result.ok && result.value.ok === true), `${where}: finalizar no falla -> ${codes(finals)}`);
          assert.equal(new Set(finals.map((result) => result.value.order_id)).size, 1, `${where}: un solo pedido`);
        }
        const state = await sessionState(session.sessionId);
        assert.deepEqual([(await cancellationsOf(session)).map((row) => row.status), await paymentEvents(session.intentId, 'payment.cancellation_cancelled'),
          await paymentEvents(session.intentId, 'payment.approved')], [['cancelled'], 1, 1], `${where}: una cancelacion asentada y un aprobado asentado`);
        if (state.orders === 1) {
          assert.deepEqual(pick(state, 'session', 'intent', 'reservations', 'paid'),
            { session: 'completed', intent: 'completed', reservations: ['converted:2:-'], paid: 2000 }, `${where}: pedido con su reserva convertida una vez`);
          assert.ok(state.order_id && state.order_id === state.intent_order_id, `${where}: sesion y cobro apuntan al mismo pedido`);
          return 'order';
        }
        assert.ok(!finalizing, `${where}: sin reserva nadie pide finalizar`);
        assert.deepEqual(pick(state, ...Object.keys(reviewState)), reviewState, `${where}: reserva liberada una vez, cobro en revision manual, sin pedido`);
        return 'cancelled';
      };
      const split = { order: 0, cancelled: 0 };

      // Primero con la llegada fijada: la respuesta «cancelado» entra antes y el aviso de «aprobado» después.
      const third = await mustCall('cancelacion de pago: solicitud cruzada', cancelPayment(probe.intentId, newKey()));
      const crossing = await staged('cancelacion: respuesta del proveedor contra aviso de pago aprobado', holdIntent(probe),
        [cancellationResponse(third.cancellation_id, 'cancelled', 'idem-race-s08-crossed'), await snapshot(probe, 'approved', 'idem-race-s08-crossed-approved')]);
      const crossingVictims = crossing.filter((result) => result.retriedAfter === '40P01')
        .map((result) => (result.task.kind === 'cancellation' ? 'la respuesta del proveedor' : 'el aviso de pago'));
      lockOrderVictims.push(...crossingVictims);
      const staggered = await crossed('cancelacion primero, aprobado despues', probe, crossing);
      if (!crossingVictims.length) assert.equal(staggered, 'cancelled', 'sin deadlock, con la cancelacion llegando primero la reserva se libera y el aprobado queda en revision');
      // DEFECTO: `record_payment_cancellation_response` toma sus candados en el orden inverso al del
      // resto: solicitud -> cobro -> sesión, contra cobro -> solicitud de `prepare_payment_cancellation`
      // y sesión -> cobro del snapshot, la finalización y el barrido. Con las llegadas en ese orden el
      // deadlock es seguro. Cuando la víctima es la respuesta del proveedor, la Edge Function
      // `mercadopago-cancel-payment` contesta «no disponible» sin reintentar ni marcar la solicitud
      // como dudosa: la solicitud queda `requested` y nadie la concilia.
      if (lockOrderVictims.length) {
        defect('PAYMENT_CANCELLATION_LOCK_ORDER', 'record_payment_cancellation_response toma solicitud -> cobro -> sesion, al reves que prepare_payment_cancellation'
          + ` (cobro -> solicitud) y que record_mercadopago_payment_snapshot (sesion -> cobro): ${lockOrderVictims.length} deadlock(s) 40P01 con el orden de llegada fijado;`
          + ` Postgres corto ${lockOrderVictims.join(' y ')}`,
        ['cancelacion: pedido duplicado contra la respuesta del proveedor', 'cancelacion: respuesta del proveedor contra aviso de pago aprobado',
          'cancelacion contra pago aprobado']);
      }

      // Y cinco rondas libres: la respuesta «cancelado» y el aviso de «aprobado» salen en el mismo instante.
      const requests = await mustAll('cancelacion contra aprobado: pedir la cancelacion', rounds.map((session) => cancelPayment(session.intentId, newKey())));
      for (const [index, session] of rounds.entries()) {
        const approved = await snapshot(session, 'approved', `idem-race-${session.ref}-approved`);
        const answer = cancellationResponse(requests[index].cancellation_id, 'cancelled', `idem-race-${session.ref}-cancelled`);
        split[await crossed(`ronda libre ${index + 1}`, session,
          await race('cancelacion contra pago aprobado', index % 2 === 0 ? [answer, approved] : [approved, answer]))] += 1;
      }
      const orders = split.order + (staggered === 'order' ? 1 : 0);
      await assertStock(item, 'cancelacion contra aprobado', { stock: 40 - 2 * orders, reserved: 0, held: 2 * orders });
      family('payment cancellation (prepare_payment_cancellation)', 'x10 misma clave / dos claves x5+x5', '1 solicitud');
      family('payment cancellation (record_payment_cancellation_response)', 'x10', 'cancelado una vez, reserva liberada una vez');
      family('stock release', 'x10 la misma respuesta de cancelacion', 'la reserva vuelve al stock una vez');
      log('IDEMPOTENCY_PAYMENT_CANCELLATION: la misma cancelacion x10 -> 1 solicitud; respuesta x10 -> cancelado una vez, reserva liberada una vez;'
        + ' dos claves x5+x5 -> 1 solicitud, la otra recibe reconciliation_required; rechazo x5 -> nada liberado; tardias y contradictorias -> no-op o 55000;'
        + ' marca dudosa contra el segundo toque -> dudosa con 1 trabajo, despues cancelada una vez;'
        + ` cancelacion primero y aprobado despues -> ${staggered === 'order' ? 'pedido' : 'cancelado, reserva liberada una vez, cobro en revision'};`
        + ` cancelacion contra aprobado, 5 rondas libres -> ${split.order} pedido(s) con reserva convertida,`
        + ` ${split.cancelled} cancelada(s) con reserva liberada y cobro en revision:`
        + ` ${lockOrderVictims.length || doubtVictims.length ? 'DEFECT' : 'PASS'}`);
    }

    // ── 9 · REARMADO contra REEMBOLSO de un cobro en revisión manual ──────────
    {
      const item = await newProduct('s09', 30);
      const sessions = await sessionsWithPreference('rearmado contra reembolso', customers(7).map((id, index) => (
        { customer: id, key: `idem-race-s09-${index}`, product: item, quantity: 3, ref: `s09-${index}` })));
      // La reserva vence sin que pase el barrido y después llega el pago aprobado: el cobro queda
      // en revisión manual con sus unidades todavía retenidas. El dueño puede rearmar el pedido o devolver el dinero.
      await expire(sessions.map((session) => session.sessionId));
      const approved = await mustAll('rearmado contra reembolso: aprobado sobre sesion vencida',
        await inOrder(sessions, (session) => snapshot(session, 'approved', `idem-race-${session.ref}-approved`)));
      assert.ok(approved.every((value) => value.ok === true && value.manual_review_required === true && value.finalize_required === false),
        'un aprobado sobre una sesion vencida queda en revision manual');
      const review = { session: 'manual_review_required', intent: 'security_review_required', review: 'approved_after_reservation_expired',
        reservations: ['active:3:-'], orders: 0, order_id: null, paid: 3000, refunded: 0 };
      for (const session of sessions) {
        assert.deepEqual(pick(await sessionState(session.sessionId), ...Object.keys(review)), review, 'cobro en revision, reserva retenida, sin pedido');
      }
      await assertStock(item, 'rearmado contra reembolso: en revision', { stock: 9, reserved: 21, held: 0 });
      const refundsOf = (session) => rows(`select r.id, r.status, r.amount::float8 as amount, r.order_id from public.payment_refunds r
         where r.payment_intent_id = $1 order by r.requested_at, r.id`, [session.intentId]);
      const split = { recovered: 0, refunded: 0 };
      // Una ronda: cinco rearmados y un reembolso total del mismo cobro. `results` trae lo que contestó cada copia.
      const judge = async (round, session, key, results) => {
        const recoveries = results.filter((result) => result.task.kind === 'recover');
        const asked = results.find((result) => result.task.key === key);
        assert.ok(asked.ok && asked.value.idempotent === false && asked.value.full_refund === true && Number(asked.value.amount) === 3000,
          `${round}: el reembolso total queda pedido -> ${codes([asked])}`);
        const state = await sessionState(session.sessionId);
        const [request, ...extra] = await refundsOf(session);
        assert.deepEqual([extra.length, request.status, request.amount], [0, 'requested', 3000], `${round}: una sola solicitud de reembolso, por lo cobrado`);
        assert.ok(state.orders <= 1, `${round}: a lo sumo un pedido`);
        // Lo que no puede pasar: un pedido armado sobre dinero que ya se estaba devolviendo.
        assert.ok(!(state.orders === 1 && request.order_id === null), `${round}: nunca un pedido sobre un cobro con el reembolso ya pedido`);
        const providerId = newProviderRefund();
        const settleRefund = async () => {
          assert.equal(await mustCall(`${round}: identidad del reembolso`, refundIdentity(session, request.id, key, providerId)), true, `${round}: identidad asentada`);
          const answers = await race('respuesta del reembolso x3', times(3, () => refundResponse(request.id, providerId, 'approved', 3000, `idem-race-refund-${providerId}`)));
          assert.ok(answers.every((result) => result.ok && result.value.ok === true) && count(answers, (result) => result.value.idempotent === false) === 1,
            `${round}: la devolucion se asienta una vez -> ${codes(answers)}`);
          return sessionState(session.sessionId);
        };
        if (state.orders === 0) {
          // Ganó el reembolso: los cinco rearmados se rechazan y la reserva sigue retenida hasta que el dinero vuelva.
          assert.ok(recoveries.every((result) => refusedWith(result, '55000', 'este cobro tiene un reembolso en curso') && result.detail === 'PAYMENT_REFUND_IN_FLIGHT'),
            `${round}: los rearmados reciben 55000 «este cobro tiene un reembolso en curso» -> ${codes(recoveries)}`);
          assert.deepEqual(pick(state, ...Object.keys(review)), review, `${round}: nada se movio: sin pedido, la reserva sigue retenida`);
          // Mercado Pago confirma la devolución (tres veces): las unidades vuelven una vez.
          assert.deepEqual(pick(await settleRefund(), 'session', 'reservations', 'orders', 'paid', 'refunded'),
            { session: 'manual_review_required', reservations: ['released:3:refund_approved_without_order'], orders: 0, paid: 3000, refunded: 3000 },
            `${round}: dinero devuelto, reserva liberada una vez, sin pedido`);
          assert.equal(await paymentEvents(session.intentId, 'payment.manual_review_stock_released'), 1, `${round}: un solo evento de liberacion`);
          const afterwards = await race('rearmado tras el reembolso x3', times(3, () => recover(session)));
          assert.ok(afterwards.every((result) => refusedWith(result, '55000', 'este cobro ya tiene dinero devuelto') && result.detail === 'PAYMENT_REFUND_RECORDED'),
            `${round}: rearmar despues de devolver se rechaza con 55000 -> ${codes(afterwards)}`);
          assert.equal((await sessionState(session.sessionId)).orders, 0, `${round}: sigue sin pedido`);
          split.refunded += 1;
          return 'refunded';
        }
        // Ganó el rearmado: UN pedido, la reserva convertida una vez, y el reembolso quedó pedido sobre ese pedido ya armado.
        assert.ok(recoveries.every((result) => result.ok && result.value.ok === true && result.value.order_id === state.order_id),
          `${round}: todos los rearmados devuelven el mismo pedido -> ${codes(recoveries)}`);
        assert.equal(count(recoveries, (result) => result.value.recovered === true), 1, `${round}: una sola copia arma el pedido -> ${codes(recoveries)}`);
        assert.equal(count(recoveries, (result) => result.value.idempotent === true), recoveries.length - 1, `${round}: las demas responden idempotent`);
        assert.deepEqual(pick(state, 'session', 'intent', 'reservations', 'paid', 'refunded'),
          { session: 'completed', intent: 'completed', reservations: ['converted:3:-'], paid: 3000, refunded: 0 }, `${round}: pedido armado con la reserva que ya tenia`);
        assert.equal(request.order_id, state.order_id, `${round}: el reembolso se pidio sobre el pedido ya armado`);
        assert.equal(await paymentEvents(session.intentId, 'payment.order_recovered_by_operator'), 1, `${round}: un solo evento de rearmado`);
        // El reembolso de un pedido ya armado devuelve el dinero una vez y no toca su stock.
        assert.deepEqual(pick(await settleRefund(), 'session', 'intent', 'reservations', 'orders', 'paid', 'refunded'),
          { session: 'completed', intent: 'refunded', reservations: ['converted:3:-'], orders: 1, paid: 3000, refunded: 3000 },
          `${round}: dinero devuelto una vez; el pedido y su reserva convertida siguen`);
        split.recovered += 1;
        return 'recovered';
      };
      // Cinco rondas libres: todo sale en el mismo instante. El pedido de reembolso va en un lugar distinto cada vez.
      const free = [];
      for (const [index, session] of sessions.slice(0, 5).entries()) {
        const key = newKey();
        const tasks = times(5, () => recover(session));
        tasks.splice(index + 1, 0, refund(session.intentId, null, key));
        free.push(await judge(`ronda libre ${index + 1}`, session, key, await race('rearmado x5 contra reembolso total', tasks)));
      }
      // Dos rondas con la llegada fijada: un rearmado entra primero, después el reembolso y después los otros rearmados.
      // El reembolso toma su candado (el cobro) de entrada y el rearmado toma antes el de la sesión: suelto, el reembolso
      // gana casi siempre. Acá se prueba la otra mitad: con el pedido ya armado, el reembolso es el de un pedido completo.
      for (const [index, session] of sessions.slice(5).entries()) {
        const key = newKey();
        const results = await staged('rearmado primero, reembolso despues', holdIntent(session),
          [recover(session), refund(session.intentId, null, key), recover(session), recover(session)]);
        assert.equal(await judge(`ronda con el rearmado primero ${index + 1}`, session, key, results), 'recovered', 'si el rearmado llego primero hay pedido');
      }
      await assertStock(item, 'rearmado contra reembolso', { stock: 9 + 3 * split.refunded, reserved: 0, held: 3 * split.recovered });
      family('recovery (recover_paid_checkout_order)', 'x5 + 1 reembolso total', 'a lo sumo 1 pedido; nunca sobre dinero con el reembolso ya pedido');
      family('stock commit', 'x5 / x3 el mismo rearmado', 'la reserva se convierte una vez');
      log(`IDEMPOTENCY_RECOVERY_VS_REFUND: 5 rondas libres de rearmar x5 contra un reembolso total -> ${count(free, (outcome) => outcome === 'recovered')} con pedido,`
        + ` ${count(free, (outcome) => outcome === 'refunded')} sin pedido (5 x 55000 «este cobro tiene un reembolso en curso», reserva liberada una vez al volver el dinero);`
        + ' 2 rondas con el rearmado llegando primero -> 1 pedido, reserva convertida una vez, el reembolso pedido sobre el pedido ya armado: PASS');
    }

    // ── 10 · PERFIL Y DIRECCIÓN DEL CLIENTE: lo que la tienda guarda antes de pedir ──
    {
      const [newcomer, regular] = customers(2);
      const profile = (customerId, name) => ({ name, identity: buyer(customerId),
        sql: 'select public.upsert_current_customer_profile($1, $2) as result', params: [name, '2996209137'] });
      const address = (customerId, fields) => ({ identity: buyer(customerId),
        sql: 'select public.upsert_current_customer_address($1::jsonb) as result',
        params: [JSON.stringify({ label: 'Casa', street: 'Rio Senguer', streetNumber: '1234', city: 'Neuquen', ...fields })] });
      const addressesOf = (customerId) => rows(`select a.id, a.street || ' ' || a.street_number as line, a.is_default from public.customer_addresses a
         where a.customer_id = $1 and a.deleted_at is null order by a.created_at, a.id`, [customerId]);
      const profilesOf = (customerId) => rows('select c.name, c.phone from public.customers c where c.id = $1', [customerId]);

      // El perfil es un upsert por cliente: el mismo guardado diez veces, y dos nombres a la vez.
      const saved = await race('perfil x10', [...times(10, () => profile(newcomer, 'Cliente Carrera Idempotencia')), profile(regular, 'Cliente Habitual')]);
      assert.ok(saved.every(ok), `guardar el mismo perfil diez veces nunca falla -> ${codes(saved)}`);
      assert.ok(identical(saved.slice(0, 10).map((result) => without(result.value, 'updatedAt'))), 'las diez respuestas traen el mismo perfil');
      assert.deepEqual(await profilesOf(newcomer), [{ name: 'Cliente Carrera Idempotencia', phone: '2996209137' }], 'un solo perfil');
      const renamed = await race('perfil: dos nombres a la vez', times(6, (index) => profile(newcomer, index % 2 === 0 ? 'Nombre Uno' : 'Nombre Dos')));
      assert.ok(renamed.every(ok), `dos nombres a la vez no fallan -> ${codes(renamed)}`);
      const [kept] = await profilesOf(newcomer);
      assert.ok(['Nombre Uno', 'Nombre Dos'].includes(kept.name) && (await profilesOf(newcomer)).length === 1, 'queda un perfil, con uno de los dos nombres');

      // La dirección no lleva clave de idempotencia: la base la deduplica por su texto normalizado
      // y contesta `{ok:false, code:'duplicate', address}` con la que ya estaba. El mismo guardado diez
      // veces tiene que dejar UNA dirección: una copia la guarda y las otras nueve reciben «duplicate».
      const savedOnce = async (where, customerId, line, results) => {
        const stored = (await addressesOf(customerId)).filter((row) => row.line === line);
        const created = results.filter((result) => result.ok && result.value.ok === true);
        const duplicates = results.filter((result) => result.ok && result.value.ok === false && result.value.code === 'duplicate');
        const raw = results.filter((result) => !result.ok);
        assert.equal(created.length + duplicates.length + raw.length, results.length, `${where}: cada copia guarda, recibe duplicate o falla -> ${codes(results)}`);
        assert.equal(created.length, stored.length, `${where}: cada copia que dice «guardada» dejo una fila`);
        assert.ok(stored.length >= 1, `${where}: la direccion queda guardada`);
        if (stored.length === 1 && raw.length === 0) {
          assert.ok(duplicates.every((result) => result.value.address.id === stored[0].id), `${where}: las demas copias reciben la direccion guardada`);
          return null;
        }
        assert.ok(raw.every((result) => refusedWith(result, '23505', 'duplicate key value violates unique constraint "customer_addresses_one_default_idx"')),
          `${where}: el unico error conocido es el indice unico de la direccion principal -> ${codes(raw)}`);
        return `${where}: ${stored.length} fila(s), ${duplicates.length} «duplicate», ${raw.length} x 23505 crudo del indice customer_addresses_one_default_idx`;
      };
      const firstAddress = await race('direccion x10 (la primera del cliente)', times(10, () => address(newcomer, {})));
      await mustCall('direccion: la primera del cliente habitual', address(regular, { label: 'Casa', streetNumber: '100' }));
      const anotherAddress = await race('direccion x10 (una mas)', times(10, () => address(regular, { label: 'Trabajo', streetNumber: '200' })));
      const symptoms = [await savedOnce('la primera direccion x10', newcomer, 'Rio Senguer 1234', firstAddress),
        await savedOnce('otra direccion x10', regular, 'Rio Senguer 200', anotherAddress)].filter(Boolean);
      // DEFECTO: `upsert_current_customer_address` busca el duplicado y elige la principal sin serializar
      // por cliente. Copias simultáneas no se ven entre sí: o guardan varias filas iguales, o chocan
      // contra el índice de «una sola principal» y devuelven su 23505 crudo en vez de «duplicate».
      if (symptoms.length) {
        defect('CUSTOMER_ADDRESS_SAVE_NOT_SERIALIZED', `upsert_current_customer_address, el mismo guardado x10 (esperado: 1 fila, 9 «duplicate») -> ${symptoms.join('; ')}`);
      }
      assert.equal(count(await addressesOf(newcomer), (row) => row.is_default), 1, 'el cliente nuevo queda con una sola direccion principal');
      assert.equal(count(await addressesOf(regular), (row) => row.is_default), 1, 'el cliente habitual sigue con una sola direccion principal');

      // Dos pedidos distintos de «hacela mi dirección principal», uno detrás del otro, mientras la principal actual está tomada.
      const setDefault = (customerId, addressId) => ({ addressId, identity: buyer(customerId),
        sql: 'select public.set_current_customer_default_address($1::uuid) as result', params: [addressId] });
      const depot = (await mustCall('direccion: una tercera', address(regular, { label: 'Deposito', streetNumber: '300' }))).address;
      const book = await addressesOf(regular);
      const workplace = book.find((row) => row.line === 'Rio Senguer 200');
      const mains = await staged('direccion principal: dos pedidos distintos', { sql: 'select 1 from public.customer_addresses where id = $1 for update',
        params: [book.find((row) => row.is_default).id] }, [setDefault(regular, workplace.id), setDefault(regular, depot.id)]);
      const main = (await addressesOf(regular)).filter((row) => row.is_default);
      assert.equal(main.length, 1, 'siempre una sola direccion principal');
      // DEFECTO: `set_current_customer_default_address` tampoco serializa por cliente: el segundo pedido no ve
      // la principal que acaba de poner el primero y choca contra el índice único, con su 23505 crudo.
      if (mains.every((result) => result.ok)) {
        assert.equal(main[0].id, depot.id, 'queda como principal la del pedido que llego ultimo');
      } else {
        assert.ok(mains[0].ok && main[0].id === workplace.id
          && refusedWith(mains[1], '23505', 'duplicate key value violates unique constraint "customer_addresses_one_default_idx"'),
        `el defecto conocido: el segundo pedido recibe el 23505 crudo del indice -> ${codes(mains)}`);
        defect('CUSTOMER_DEFAULT_ADDRESS_RAW_UNIQUE_VIOLATION', 'set_current_customer_default_address: dos pedidos distintos, uno detras del otro -> el segundo recibe'
          + ' 23505 «duplicate key value violates unique constraint "customer_addresses_one_default_idx"» en vez de quedar como principal');
      }
      // Archivar la misma dirección cinco veces: se archiva una vez; las demás copias ya no la encuentran.
      const archive = (customerId, addressId) => ({ identity: buyer(customerId),
        sql: 'select public.archive_current_customer_address($1::uuid) as result', params: [addressId] });
      const archived = await race('archivar la misma direccion x5', times(5, () => archive(regular, depot.id)));
      assert.equal(count(archived, (result) => result.ok && result.value.archived === true), 1, `una sola copia archiva -> ${codes(archived)}`);
      assert.ok(archived.filter((result) => !result.ok).every((result) => refusedWith(result, '42501', 'direccion no encontrada')),
        `las otras cuatro reciben 42501 «direccion no encontrada» -> ${codes(archived)}`);
      assert.equal(count(await addressesOf(regular), (row) => row.is_default), 1, 'tras archivar sigue habiendo una sola direccion principal');

      // Dos pestañas de la libreta: una archiva la dirección principal y la otra elige otra como principal, en ese
      // orden de llegada. Archivar toma la principal y después la que la reemplaza; elegir toma la elegida y después
      // la principal. Sólo hay un final: la otra queda como única principal y ninguna de las dos llamadas se pierde.
      const [mover] = customers(1);
      await mustCall('direccion: perfil de quien reordena su libreta', profile(mover, 'Cliente Libreta'));
      const home = (await mustCall('direccion: la principal de quien reordena', address(mover, { label: 'Casa', streetNumber: '400' }))).address;
      const office = (await mustCall('direccion: la otra de quien reordena', address(mover, { label: 'Trabajo', streetNumber: '500' }))).address;
      const reorder = await staged('direccion: archivar la principal contra elegir otra', { sql: 'select 1 from public.customer_addresses where id = $1 for update',
        params: [home.id] }, [archive(mover, home.id), setDefault(mover, office.id)]);
      const reorderVictims = reorder.filter((result) => result.retriedAfter === '40P01')
        .map((result) => (result.task.sql.includes('archive_') ? 'el archivo' : 'la eleccion de la principal'));
      assert.ok(reorder.every(ok) && reorder[0].value.archived === true, `archivar y elegir terminan bien (tras un reintento si hubo deadlock) -> ${codes(reorder)}`);
      assert.deepEqual((await addressesOf(mover)).map((row) => `${row.line}:${row.is_default}`), ['Rio Senguer 500:true'],
        'queda la otra direccion, como unica principal');
      // DEFECTO: `archive_current_customer_address` y `set_current_customer_default_address` toman las mismas dos
      // filas en orden inverso y nada las pone en fila por cliente: con las llegadas en ese orden el deadlock es
      // seguro y una de las dos pestañas recibe un error.
      if (reorderVictims.length) {
        defect('CUSTOMER_ADDRESS_ARCHIVE_DEADLOCK', 'archive_current_customer_address contra set_current_customer_default_address del mismo cliente:'
          + ` ${reorderVictims.length} deadlock(s) 40P01 con el orden de llegada fijado; Postgres corto ${reorderVictims.join(' y ')}`,
        ['direccion: archivar la principal contra elegir otra']);
      }
      family('customer profile (upsert_current_customer_profile)', 'x10', '1 perfil');
      family('customer address (upsert_current_customer_address)', 'x10', symptoms.length ? 'DEFECTO: varias filas o 23505 crudo' : '1 direccion; 9 «duplicate»');
      family('customer address (archive_current_customer_address vs set_current_customer_default_address)', '1 + 1 con la llegada fijada',
        reorderVictims.length ? 'DEFECTO: deadlock' : 'la otra queda como unica principal; sin deadlock');
      log('IDEMPOTENCY_CUSTOMER_PROFILE: el mismo perfil x10 -> 1 perfil; dos nombres x3+x3 -> 1 perfil;'
        + ` la misma direccion x10 -> ${symptoms.length ? 'ver IDEMPOTENCY_DEFECT' : '1 direccion, 9 «duplicate»'};`
        + ` dos pedidos de direccion principal -> 1 principal${mains.every((result) => result.ok) ? '' : ' (ver IDEMPOTENCY_DEFECT)'}; archivar x5 -> 1 archivada, 4 x 42501;`
        + ` archivar la principal contra elegir otra -> ${reorderVictims.length ? `deadlock, Postgres corto ${reorderVictims.join(' y ')}` : 'la otra queda principal, sin deadlock'}:`
        + ` ${symptoms.length || !mains.every((result) => result.ok) || reorderVictims.length ? 'DEFECT' : 'PASS'}`);
    }

    // ── Invariantes finales sobre todo lo que creó la carrera ─────────────────
    let committed = 0;
    for (const [productId, entry] of ledger) {
      const state = await assertConserved(productId, 'invariante final');
      assert.ok(state.reserved + state.held + state.consumed <= entry.initial, `invariante final: lo comprometido de ${entry.label} no supera su stock inicial`);
      committed += state.reserved + state.held + state.consumed;
    }
    const totals = await one(`select
        (select count(*)::int from public.orders o where o.business_id = $1) as orders,
        (select count(*)::int from public.checkout_sessions s where s.business_id = $1) as sessions,
        (select count(*)::int from public.orders o join public.payment_intents pi on pi.order_id = o.id where o.business_id = $1) as paid_orders,
        (select count(*)::int from public.products p where p.business_id = $1) as products`, [BUSINESS]);
    const loose = await one(`select
        (select count(*)::int from public.orders o where o.business_id = $1
           and not exists (select 1 from public.order_items oi where oi.order_id = o.id)) as orders_without_items,
        (select count(*)::int from public.checkout_sessions s where s.business_id = $1
           and (not exists (select 1 from public.checkout_session_items i where i.checkout_session_id = s.id)
             or not exists (select 1 from public.inventory_reservations r where r.checkout_session_id = s.id))) as sessions_without_reservation,
        (select count(*)::int from public.checkout_sessions s where s.business_id = $1
           and (select count(*) from public.payment_intents pi where pi.checkout_session_id = s.id) <> 1) as sessions_without_one_intent,
        (select count(*)::int from (select 1 from public.payment_intents pi where pi.business_id = $1 and pi.provider_payment_id is not null
            group by pi.provider, pi.environment, pi.provider_payment_id having count(*) > 1) repeated) as provider_payments_on_two_intents,
        (select count(*)::int from public.orders o join public.payment_intents pi on pi.order_id = o.id where o.business_id = $1
           and (o.total is distinct from pi.paid_amount or o.payment_method is distinct from 'mercadopago')) as paid_orders_with_another_total,
        (select count(*)::int from public.payment_intents pi where pi.business_id = $1
           and pi.refunded_amount > coalesce(pi.paid_amount, 0)) as refunded_more_than_paid,
        (select count(*)::int from public.payment_intents pi where pi.business_id = $1
           and (select coalesce(sum(r.amount), 0) from public.payment_refunds r
                 where r.payment_intent_id = pi.id and r.status not in ('rejected', 'failed')) > coalesce(pi.paid_amount, 0)) as refunds_committed_over_paid,
        (select count(*)::int from public.inventory_reservations r join public.checkout_sessions s on s.id = r.checkout_session_id
          where s.business_id = $1 and ((r.converted_at is not null and r.released_at is not null)
            or (r.status = 'converted') <> (r.converted_at is not null) or (r.status = 'released') <> (r.released_at is not null))) as converted_and_released,
        (select count(*)::int from public.inventory_reservations r join public.checkout_sessions s on s.id = r.checkout_session_id
          where s.business_id = $1 and r.status = 'converted' and s.completed_order_id is null) as converted_without_order,
        (select count(*)::int from public.checkout_sessions s where s.business_id = $1 and s.completed_order_id is not null
           and not exists (select 1 from public.inventory_reservations r
                            where r.checkout_session_id = s.id and r.status = 'converted')) as orders_without_converted_reservation,
        (select count(*)::int from public.inventory_reservations r join public.checkout_sessions s on s.id = r.checkout_session_id
          where s.business_id = $1 and r.status = 'active' and s.status in ('expired', 'cancelled', 'completed')) as active_on_closed_session,
        (select count(*)::int from public.products p where p.business_id = $1 and (p.stock is null or p.stock < 0)) as negative_stock`, [BUSINESS]);
    assert.deepEqual(loose, Object.fromEntries(Object.keys(loose).map((key) => [key, 0])), 'nada suelto en el comercio de la carrera');
    assert.equal(totals.products, ledger.size, 'los productos del comercio son los de la carrera');
    // Una fila por clave en cada tabla de recibos: el índice único existe, está válido, y no hay claves repetidas.
    const keyed = [
      ['business_command_receipts', ['business_id', 'idempotency_key']],
      ['rider_delivery_operations', ['order_id', 'rider_user_id', 'operation', 'idempotency_key']],
      ['delivery_confirmation_attempts', ['order_id', 'rider_id', 'request_id']],
      ['delivery_outbox', ['order_id', 'event_type', 'event_key']],
      ['order_delivery_handoffs', ['order_id']],
      ['orders', ['business_id', 'client_request_id']],
      ['checkout_sessions', ['business_id', 'customer_id', 'client_request_id']],
      ['payment_intents', ['checkout_session_id']],
      ['payment_intents', ['provider', 'environment', 'provider_payment_id']],
      ['payment_attempts', ['payment_intent_id', 'attempt_number', 'attempt_type']],
      ['payment_attempts', ['idempotency_key']],
      ['payment_refunds', ['idempotency_key']],
      ['payment_refunds', ['provider_refund_id']],
      ['payment_cancellations', ['idempotency_key']],
      ['payment_webhook_receipts', ['provider', 'environment', 'webhook_event_id', 'event_type', 'resource_id']],
      ['payment_outbox', ['webhook_receipt_id']],
      ['payment_events', ['payment_intent_id', 'webhook_receipt_id', 'event_type']],
    ];
    for (const [table, columns] of keyed) {
      const { indexes } = await one(`select count(*)::int as indexes from pg_index i join pg_class c on c.oid = i.indrelid
          join pg_namespace n on n.oid = c.relnamespace
         where n.nspname = 'public' and c.relname = $1 and i.indisunique and i.indisvalid and i.indisready
           and (select array_agg(a.attname::text order by k.position) from unnest(i.indkey::int2[]) with ordinality as k(attnum, position)
                  join pg_attribute a on a.attrelid = i.indrelid and a.attnum = k.attnum) = $2::text[]`, [table, columns]);
      assert.ok(indexes >= 1, `invariante final: public.${table} tiene un indice unico valido sobre (${columns.join(', ')})`);
      const { repeated } = await one(`select count(*)::int as repeated from (select 1 from public.${table}
          where ${columns.map((column) => `${column} is not null`).join(' and ')} group by ${columns.join(', ')} having count(*) > 1) keys`);
      assert.equal(repeated, 0, `invariante final: ninguna clave repetida en public.${table} (${columns.join(', ')})`);
    }
    log(`IDEMPOTENCY_INVARIANTS: ${totals.orders} pedidos (${totals.paid_orders} pagados por Mercado Pago) y ${totals.sessions} sesiones: ninguno sin renglones ni sin reserva,`
      + ' un pago del proveedor por cobro, total = cobrado y devuelto <= cobrado, ninguna reserva convertida y liberada,'
      + ` ${keyed.length} claves unicas de recibos sin repetir: PASS`);
    log(`IDEMPOTENCY_CONSERVATION: ${ledger.size} productos, ${sum([...ledger.values()].map((entry) => entry.initial))} unidades iniciales,`
      + ` ${committed} comprometidas, stock inicial = stock + reservas + pedidos + entregado en todos: PASS`);
    for (const line of families) log(`IDEMPOTENCY_FAMILY: ${line}`);
    log('IDEMPOTENCY_COVERED_BY_OTHER_RACES: order creation x20/x25 -> intake-race.mjs (ORDER_INTAKE_SAME_KEY_RACE), stock-race.mjs (STOCK_RACE_RETRY_STORM);'
      + ' cancel order x6 -> stock-race.mjs (STOCK_RACE_CANCELLATION); approved payment x20 + finalize x10 -> stock-race.mjs (STOCK_RACE_DUPLICATE_WEBHOOK);'
      + ' stock reservation/commit/release under contention -> stock-race.mjs (4 a 7)');
    const sitesOf = (code) => [...tally.sites].filter(([key]) => key.endsWith(` ${code}`)).map(([key, times]) => `${key} x${times}`).join(' | ');
    log(`DEADLOCKS: ${tally.deadlocks}${tally.deadlocks ? ` (${sitesOf('40P01')}; reintentos resueltos: ${tally.retriesOk})` : ''}`);
    // Una espera agotada depende de la carga de la máquina (el tope es el de la conexión de CI): se
    // reintenta, se cuenta y se dice dónde, pero no falla la corrida.
    log(`LOCK_TIMEOUTS: ${tally.lockTimeouts}${tally.lockTimeouts ? ` (${sitesOf('55P03')})` : ''}`);
    log(`IDEMPOTENCY_RACE_DONE: ${tally.calls} llamadas en conexiones propias, la mas lenta ${tally.slowestMs} ms, ${((Date.now() - startedAt) / 1000).toFixed(1)} s`);
    // Un deadlock, en cambio, es un orden de candados invertido. Si ningún DEFECTO lo explica, el reintento
    // de arriba lo dejó pasar, pero quien llama de verdad no siempre reintenta (la Edge Function de la
    // cancelación no lo hacía): también es un defecto.
    const unexplained = [...tally.sites].filter(([key]) => key.endsWith(' 40P01') && !explained.has(key.slice(0, -' 40P01'.length)));
    if (unexplained.length) {
      defect('UNEXPECTED_DEADLOCK', `deadlock(s) 40P01 que ningun defecto conocido explica: ${unexplained.map(([key, times]) => `${key} x${times}`).join(' | ')}`);
    }
    if (defects.length) {
      log(`GLOBAL_IDEMPOTENCY: FAIL (${defects.length} defecto(s): ${defects.join(', ')})`);
      throw new Error(`GLOBAL_IDEMPOTENCY: FAIL (${defects.join(', ')})`);
    }
    log('GLOBAL_IDEMPOTENCY: PASS');
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
    console.error('usage: TABA_LOCAL_INTAKE_DB=1 node scripts/order-intake/idempotency-race.mjs <postgres url of a disposable database>');
    process.exit(2);
  }
  const target = new URL(url);
  // `?host=` (o `hostaddr`) pisa el host de la URL en el cliente de pg: con eso una URL «local» podía
  // conectar a otra máquina. No se aceptan, y el host del cliente se vuelve a mirar antes de conectar.
  assert.ok(['127.0.0.1', 'localhost'].includes(target.hostname) && !target.searchParams.has('host') && !target.searchParams.has('hostaddr'),
    'solo contra una base local descartable');
  const { default: pg } = await import('pg');
  await runIdempotencyRace(async () => {
    // Los mismos topes que la conexión de CI (tests/fixtures/release-v5-database.mjs).
    const client = new pg.Client({ connectionString: url, statement_timeout: 30_000, lock_timeout: 5_000 });
    client.on('error', () => {});
    assert.ok(['127.0.0.1', 'localhost'].includes(client.host), 'solo contra una base local descartable');
    await client.connect();
    return client;
  });
}
