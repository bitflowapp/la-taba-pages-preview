// Espera a que la persona confirme su pedido en el storefront y avisa el
// codigo. Solo lectura. Se planta solo cuando aparece un pedido production
// creado DESPUES de arrancar, asi no confunde a LT-0118 ni a ninguno viejo.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { REF, URL_BASE, SUPABASE_CLI, evidencia } from './entorno.mjs';

const DESDE = process.env.DESDE || new Date().toISOString();
const MINUTOS = Number(process.env.MINUTOS || 120);
const EV = evidencia('gate-cliente');

const keys = JSON.parse(execFileSync(SUPABASE_CLI,
  ['projects', 'api-keys', '--project-ref', REF, '--output', 'json'],
  { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }));
const SERVICE = keys.filter((k) => k.name === 'service_role')[0].api_key;
const H = { apikey: SERVICE, Authorization: `Bearer ${SERVICE}`, 'Content-Type': 'application/json' };
const rest = async (p) => (await fetch(`${URL_BASE}/rest/v1/${p}`, { headers: H })).json();

console.log(`esperando un pedido production creado despues de ${DESDE} (hasta ${MINUTOS} min)`);
const limite = Date.now() + MINUTOS * 60000;

while (Date.now() < limite) {
  const nuevos = await rest(
    `orders?origin=eq.production&created_at=gt.${encodeURIComponent(DESDE)}`
    + '&select=id,code,status,total,payment_method,customer_name,customer_phone,delivery_address_formatted,'
    + 'delivery_latitude,delivery_longitude,delivery_geolocation_accuracy,created_at&order=created_at.asc',
  );
  if (Array.isArray(nuevos) && nuevos.length) {
    const o = nuevos[0];
    const items = await rest(`order_items?order_id=eq.${o.id}&select=name,quantity,unit_price,subtotal`);
    console.log('\n=== PEDIDO HUMANO DETECTADO ===');
    console.log(`codigo: ${o.code}`);
    console.log(`estado: ${o.status}  total: $${o.total}  pago: ${o.payment_method}`);
    console.log(`items: ${items.map((i) => `${i.quantity}x ${i.name}`).join(', ')}`);
    console.log(`entrega: ${o.delivery_address_formatted || '-'}`);
    console.log(`punto: ${o.delivery_latitude}, ${o.delivery_longitude} (precision ${o.delivery_geolocation_accuracy} m)`);
    console.log(`creado: ${o.created_at}`);
    console.log(`id: ${o.id}`);
    fs.writeFileSync(path.join(EV, 'pedido-humano.json'), JSON.stringify({ pedido: o, items }, null, 2), 'utf8');
    if (nuevos.length > 1) console.log(`\nOJO: hay ${nuevos.length} pedidos nuevos: ${nuevos.map((x) => x.code).join(', ')}`);
    process.exit(0);
  }
  await new Promise((r) => setTimeout(r, 5000));
}
console.log('se acabo la espera sin pedido nuevo');
process.exitCode = 2;
