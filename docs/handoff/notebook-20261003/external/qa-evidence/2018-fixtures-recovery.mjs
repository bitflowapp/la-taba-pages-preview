/**
 * Dos cobros QA para certificar el rearmado del Panel contra la base VIVA.
 *
 * Escenario real: el cobro entro (provider_status approved) y la reserva
 * vencio (checkout_session expired), asi que el pedido nunca se armo. Es
 * exactamente lo que `can_recover_paid_checkout` habilita.
 *
 *   A · un producto activo, 1 unidad  -> el rearmado DEBE armar el pedido
 *   B · 900 unidades                  -> el rearmado DEBE negarse con el detalle
 *
 * Son de RETIRO EN LOCAL a proposito: asi no se roza el contrato de punto de
 * entrega confirmado, que no se relaja ni se toca.
 *
 * Todo lo creado lleva correlation_id 'rc1-qa-recovery-*', que es la unica
 * llave que usa el borrado. Nada sin esa marca se toca jamas.
 *
 * Uso: node fixtures-recovery.mjs crear|estado|borrar
 */
import crypto from 'node:crypto';

const SB = 'https://ukxqbgswjlibmnjemrzd.supabase.co';
const SR = process.env.TABA_SERVICE_ROLE;
const BID = '00000000-0000-4000-8000-000000000001';
// correlation_id es uuid, asi que la marca son DOS uuid fijos e irrepetibles.
// Son la unica llave que usa el borrado: nada sin uno de estos dos se toca.
const MARCA = { A: '11111111-0000-4000-8000-0000000000aa', B: '11111111-0000-4000-8000-0000000000bb' };
const MARCAS = `(${MARCA.A},${MARCA.B})`;
if (!SR) { console.error('falta TABA_SERVICE_ROLE en el entorno'); process.exit(1); }

const H = { apikey: SR, Authorization: `Bearer ${SR}`, 'Content-Type': 'application/json' };
const api = async (path, init = {}) => {
  const r = await fetch(`${SB}/rest/v1/${path}`, { ...init, headers: { ...H, ...(init.headers || {}) } });
  const t = await r.text();
  let j = null; try { j = t ? JSON.parse(t) : null; } catch { j = t; }
  if (!r.ok) throw new Error(`${r.status} ${path} :: ${String(t).slice(0, 300)}`);
  return j;
};
const get = (p) => api(p);
const post = (p, body, prefer = 'return=representation') =>
  api(p, { method: 'POST', headers: { Prefer: prefer }, body: JSON.stringify(body) });
const del = (p) => api(p, { method: 'DELETE', headers: { Prefer: 'return=representation' } });

const cmd = process.argv[2] || 'estado';

async function estado() {
  const ses = await get(`checkout_sessions?select=id,status,total,correlation_id&correlation_id=in.${MARCAS}`);
  const pis = await get(`payment_intents?select=id,provider_status,internal_status,order_id,correlation_id&correlation_id=in.${MARCAS}`);
  const ord = await get(`orders?select=id,public_code,status,correlation_id&correlation_id=in.${MARCAS}`);
  const its = ses.length
    ? await get(`checkout_session_items?select=id,checkout_session_id&checkout_session_id=in.(${ses.map((s) => s.id).join(',')})`)
    : [];
  const res = ses.length
    ? await get(`inventory_reservations?select=id,status,quantity,product_id,checkout_session_id&checkout_session_id=in.(${ses.map((s) => s.id).join(',')})`)
    : [];
  console.log(JSON.stringify({ sesiones: ses, items: its.length, cobros: pis, pedidos: ord, reservas: res }, null, 2));
  return { ses, pis, ord, its, res };
}

async function crear() {
  const [prod] = await get('products?select=id,sku,name,price,stock,is_active&sku=eq.imperial-apa-lata-473ml');
  if (!prod?.is_active) throw new Error('el producto molde no esta activo');
  console.log(`producto elegido: ${prod.sku}  stock=${prod.stock}  precio=${prod.price}`);

  const casos = [
    { tag: 'A', cantidad: 1, nota: 'debe ARMAR el pedido' },
    { tag: 'B', cantidad: 900, nota: 'debe NEGARSE por stock' },
  ];
  const creados = [];
  for (const c of casos) {
    const total = Number((Number(prod.price) * c.cantidad).toFixed(2));
    const corr = MARCA[c.tag];
    const [ses] = await post('checkout_sessions', [{
      business_id: BID,
      // Cliente QA que YA existia (sin pedidos). No se crea ninguna persona.
      customer_id: '7c426065-0a6c-44b4-9eb0-7ae41d2806ec',
      client_request_id: crypto.randomUUID(),
      normalized_intent_hash: crypto.createHash('sha256').update(`rc1-qa-recovery-${c.tag}-${Date.now()}`).digest('hex'),
      fulfillment_type: 'pickup',
      address_snapshot: { source: 'manual' },
      contact_snapshot: { name: `QA RC1 recovery ${c.tag}`, phone: '2990000000' },
      currency: 'ARS',
      subtotal: total,
      discount_total: 0,
      delivery_fee: 0,
      total,
      status: 'expired',
      contains_alcohol: false,
      // checkout_sessions_expiry_check no admite una expiracion ya vencida al
      // insertar. No importa: `can_recover_paid_checkout` NO mira expires_at.
      expires_at: new Date(Date.now() + 600_000).toISOString(),
      correlation_id: corr,
    }]);
    await post('checkout_session_items', [{
      checkout_session_id: ses.id,
      product_id: prod.id,
      product_snapshot: { sku: prod.sku, name: `QA RC1 recovery ${c.tag}`, category: 'QA' },
      quantity: c.cantidad,
      unit_price: prod.price,
      subtotal: total,
    }]);
    const [pi] = await post('payment_intents', [{
      checkout_session_id: ses.id,
      business_id: BID,
      provider: 'mercadopago',
      environment: 'test',
      idempotency_key: crypto.randomUUID(),
      external_reference: `taba2:checkout:${ses.id}`,
      currency: 'ARS',
      expected_amount: total,
      paid_amount: total,
      provider_status: 'approved',
      internal_status: 'expired',
      approved_at: new Date(Date.now() - 7200_000).toISOString(),
      correlation_id: corr,
    }]);
    creados.push({ caso: c.tag, nota: c.nota, sesion: ses.id, cobro: pi.id, total, cantidad: c.cantidad });
    console.log(`  ${c.tag}: sesion ${ses.id} · cobro ${pi.id} · ${c.cantidad} u · $${total} · ${c.nota}`);
  }
  console.log('\ncomprobando que el backend los ve recuperables...');
  for (const c of creados) {
    const [ok] = await post('rpc/can_recover_paid_checkout', { p_payment_intent_id: c.cobro }, 'return=representation')
      .then((r) => [r]).catch((e) => [`error: ${e.message}`]);
    console.log(`  ${c.caso}: can_recover_paid_checkout = ${JSON.stringify(ok)}`);
  }
  return creados;
}

async function borrar() {
  const { ses, ord } = await estado();
  // 1 · soltar la referencia de la sesion al pedido, que es una FK
  for (const s of ses) {
    await api(`checkout_sessions?id=eq.${s.id}`, {
      method: 'PATCH', headers: { Prefer: 'return=minimal' },
      body: JSON.stringify({ completed_order_id: null }),
    }).catch(() => {});
  }
  // 2 · los pedidos que el rearmado haya creado, con todo lo que cuelga
  for (const o of ord) {
    for (const tabla of ['order_items', 'order_status_events', 'order_status_history',
      'order_events', 'delivery_assignments', 'order_delivery_codes']) {
      await del(`${tabla}?order_id=eq.${o.id}`).catch(() => {});
    }
    await del(`payment_intents?order_id=eq.${o.id}`).catch(() => {});
    try {
      await del(`orders?id=eq.${o.id}`);
      console.log(`borrado pedido ${o.public_code || o.id}`);
    } catch (e) {
      console.log(`NO se pudo borrar ${o.public_code}: ${e.message.slice(0, 200)}`);
    }
  }
  for (const s of ses) {
    // 2 · devolver el stock que la reserva haya descontado
    const res = await get(`inventory_reservations?select=id,product_id,quantity,status&checkout_session_id=eq.${s.id}`);
    for (const r of res) {
      const [p] = await get(`products?select=id,stock&id=eq.${r.product_id}`);
      await api(`products?id=eq.${r.product_id}`, {
        method: 'PATCH', headers: { Prefer: 'return=minimal' },
        body: JSON.stringify({ stock: Number(p.stock) + Number(r.quantity) }),
      });
      console.log(`devueltas ${r.quantity} u a ${r.product_id} (stock ${p.stock} -> ${Number(p.stock) + Number(r.quantity)})`);
    }
    await del(`inventory_reservations?checkout_session_id=eq.${s.id}`).catch(() => {});
    await del(`payment_events?payment_intent_id=in.(${(await get(`payment_intents?select=id&checkout_session_id=eq.${s.id}`)).map((x) => x.id).join(',') || '00000000-0000-0000-0000-000000000000'})`).catch(() => {});
    await del(`payment_intents?checkout_session_id=eq.${s.id}`).catch(() => {});
    await del(`checkout_session_items?checkout_session_id=eq.${s.id}`).catch(() => {});
    await del(`checkout_sessions?id=eq.${s.id}`);
    console.log(`borrada sesion ${s.id}`);
  }
  // 3 · alertas que hayan nacido de estos fixtures
  const al = await get(`operational_alerts?select=id,alert_code,correlation_id&correlation_id=in.${MARCAS}`).catch(() => []);
  for (const a of al) { await del(`operational_alerts?id=eq.${a.id}`); console.log(`borrada alerta ${a.alert_code}`); }
  console.log('\nestado final de la marca:');
  await estado();
}

if (cmd === 'crear') await crear();
else if (cmd === 'borrar') await borrar();
else await estado();
