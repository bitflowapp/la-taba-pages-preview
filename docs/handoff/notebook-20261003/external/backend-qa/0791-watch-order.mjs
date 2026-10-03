import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// Waits for the shopper's order to land and then exits, so the run produces a
// single notification instead of a stream.
const KEY = fs.readFileSync(path.join(os.tmpdir(), 'taba-sr.txt'), 'utf8').trim();
const BASE = 'https://ukxqbgswjlibmnjemrzd.supabase.co/rest/v1';
const SINCE = process.argv[2];
const DEADLINE = Date.now() + 90 * 60 * 1000;

const get = async (q) => {
  const r = await fetch(`${BASE}/${q}`, { headers: { apikey: KEY, Authorization: `Bearer ${KEY}` } });
  return r.json().catch(() => null);
};

console.log(`esperando pedido nuevo posterior a ${SINCE}`);
while (Date.now() < DEADLINE) {
  const orders = await get(`orders?select=id,code,status,total,payment_method,delivery_address_formatted,created_at&payment_method=eq.mercadopago&created_at=gt.${encodeURIComponent(SINCE)}&order=created_at.asc`).catch(() => null);
  if (Array.isArray(orders) && orders.length) {
    const o = orders[0];
    const intents = await get(`payment_intents?select=internal_status,provider_payment_id,paid_amount,expected_amount&order_id=eq.${o.id}`);
    const items = await get(`order_items?select=name,quantity,unit_price&order_id=eq.${o.id}`);
    console.log('PEDIDO NUEVO');
    console.log(JSON.stringify({ pedido: o, intent: intents?.[0] || null, items: items || [] }, null, 1));
    process.exit(0);
  }
  await new Promise((r) => setTimeout(r, 15000));
}
console.log('ventana de espera agotada sin pedido nuevo');
process.exit(1);
