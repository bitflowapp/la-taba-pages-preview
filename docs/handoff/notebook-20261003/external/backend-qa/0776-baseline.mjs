import { count, rest } from './q.mjs';

const tables = [
  'orders', 'order_items', 'order_events', 'checkout_sessions', 'checkout_session_items',
  'payment_intents', 'payment_attempts', 'payment_events', 'payment_webhook_receipts',
  'payment_outbox', 'inventory_reservations', 'inventory_movements', 'products',
  'customers', 'businesses', 'riders', 'notification_outbox', 'delivery_outbox',
];

const snapshot = {};
for (const table of tables) snapshot[table] = await count(table);
console.log('=== CONTEOS BASELINE ===');
console.log(JSON.stringify(snapshot, null, 2));

const lt = await rest('orders?select=id,code,status,payment_status,created_at&code=eq.LT-0030');
console.log('\n=== LT-0030 ===');
console.log(JSON.stringify(lt.body, null, 2));

const outbox = await rest('payment_outbox?select=id,status,attempts,created_at&order=created_at.desc&limit=10');
console.log('\n=== payment_outbox (10 recientes) ===');
console.log(JSON.stringify(outbox.body, null, 2));

const receipts = await rest('payment_webhook_receipts?select=*&order=received_at.desc&limit=5');
console.log('\n=== payment_webhook_receipts (5 recientes) ===');
console.log(JSON.stringify(receipts.body, null, 2));
