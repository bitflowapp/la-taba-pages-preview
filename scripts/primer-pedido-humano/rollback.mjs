// Rollback del pedido humano si algo sale mal.
//
// No ejecuta nada por su cuenta: diagnostica el estado y dice EXACTAMENTE que
// camino corresponde y con que comando. Un pedido real no se mueve por SQL ni
// por una decision automatica; se retira por la UI del negocio o se termina
// desde la app, que es lo que haria una persona.
//
//   node rollback.mjs LT-0104            -> diagnostica y muestra el camino
//   node rollback.mjs LT-0104 --verificar -> revisa que el rollback quedo limpio
import { execFileSync } from 'node:child_process';
import { REF, URL_BASE, SUPABASE_CLI } from './entorno.mjs';

const CODE = process.argv[2];
const VERIFICAR = process.argv.includes('--verificar');
if (!CODE) {
  console.log('uso: node rollback.mjs LT-XXXX [--verificar]');
  process.exit(1);
}

const keys = JSON.parse(execFileSync(SUPABASE_CLI,
  ['projects', 'api-keys', '--project-ref', REF, '--output', 'json'],
  { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }));
const SERVICE = keys.filter((k) => k.name === 'service_role')[0].api_key;
const H = { apikey: SERVICE, Authorization: `Bearer ${SERVICE}`, 'Content-Type': 'application/json' };
const rest = async (p) => (await fetch(`${URL_BASE}/rest/v1/${p}`, { headers: H })).json();

const [o] = await rest(`orders?code=eq.${CODE}&select=id,code,status,revision,origin,total,assigned_rider_user_id,delivered_at`);
if (!o) { console.log(`no existe ${CODE}`); process.exit(1); }
const [prod] = await rest('products?name=ilike.*red%20bull*&select=name,stock');
const locs = await rest(`rider_locations?order_id=eq.${o.id}&select=id`);
const [handoff] = await rest(`order_delivery_handoffs?order_id=eq.${o.id}&select=failed_attempts,confirmed_at`) || [];

console.log(`\n${o.code}: ${o.status}, revisión ${o.revision}, origin=${o.origin}, $${o.total}`);
console.log(`  rider asignado: ${o.assigned_rider_user_id ? 'sí' : 'no'} · ubicaciones: ${Array.isArray(locs) ? locs.length : '?'} · stock actual: ${prod.stock}`);
console.log(`  código: ${handoff ? (handoff.confirmed_at ? 'confirmado' : `${handoff.failed_attempts} intentos fallidos`) : 'sin emitir'}`);

if (VERIFICAR) {
  const [lt30] = await rest('orders?code=eq.LT-0030&select=status,revision,total');
  const fiscales = await rest('fiscal_documents?select=id&limit=2');
  const pos = await rest('pos_sales?select=id&limit=2');
  const gemelos = await rest(`orders?code=eq.${CODE}&select=id`);
  const enVuelo = o.assigned_rider_user_id
    ? await rest(`orders?assigned_rider_user_id=eq.${o.assigned_rider_user_id}&status=in.(assigned,picked_up,on_the_way,arrived)&select=code`)
    : [];
  const terminal = ['delivered', 'cancelled', 'rejected'].includes(o.status);
  const filas = [
    ['pedido en estado terminal', terminal, o.status],
    ['sin duplicados', Array.isArray(gemelos) && gemelos.length === 1, `${gemelos.length} fila(s)`],
    ['coordenadas purgadas', Array.isArray(locs) && locs.length === 0, `${locs.length} punto(s)`],
    ['rider libre', Array.isArray(enVuelo) && enVuelo.length === 0, `${enVuelo.length} en vuelo`],
    ['LT-0030 intacto', lt30.status === 'arrived' && Number(lt30.revision) === 11, `${lt30.status} r${lt30.revision}`],
    ['ARCA sin emisión', fiscales.length === 0 && pos.length === 0, `${fiscales.length}/${pos.length}`],
  ];
  console.log('\n--- verificación del rollback ---');
  let ok = true;
  for (const [nombre, pasa, detalle] of filas) {
    if (!pasa) ok = false;
    console.log(`  [${pasa ? 'PASS ' : 'FALLA'}] ${nombre.padEnd(26)} ${detalle}`);
  }
  console.log(ok ? '\nrollback limpio' : '\nel rollback NO quedó limpio: mirar arriba');
  process.exit(ok ? 0 : 1);
}

// ------------------------------------------------------- el camino correcto -
const PRECLAIM = ['received', 'accepted', 'preparing', 'ready'];
const ENVUELO = ['assigned', 'picked_up', 'on_the_way', 'arrived'];
console.log('\n--- camino que corresponde ---');
if (['delivered', 'cancelled', 'rejected'].includes(o.status)) {
  console.log('  El pedido ya está terminado. No hay rollback que hacer.');
  console.log(`  Para comprobar que quedó limpio:  node rollback.mjs ${CODE} --verificar`);
} else if (PRECLAIM.includes(o.status)) {
  console.log('  Todavía no lo tomó el Rider: se retira DESDE EL PANEL, con motivo obligatorio.');
  console.log('  No por SQL: mover un pedido real por fuera de la UI del negocio es lo que este trabajo evita.');
  console.log('');
  console.log(`    QA_ORDER=${CODE} QA_MOTIVO="Pedido de prueba: se retira antes de repartir" node negocio-cancelar.mjs`);
  console.log('');
  console.log('  La unidad vuelve al stock por el mismo camino que cualquier cancelación del negocio.');
} else if (ENVUELO.includes(o.status)) {
  console.log('  Ya lo tomó el Rider. NO se cancela por atrás: se termina desde la app, como una entrega real.');
  console.log('  El código lo tiene el cliente en su seguimiento; se recupera desde su navegador:');
  console.log('');
  console.log(`    QA_ORDER=${CODE} node cliente-tracking.mjs        # imprime el código de 4 dígitos`);
  console.log(`    .\\llegada-y-codigo.ps1 -DeliveryCode XXXX -OrderCode ${CODE}   # llegada + código incorrecto rechazado`);
  console.log(`    .\\entregar.ps1 -DeliveryCode XXXX -OrderCode ${CODE} # confirma la entrega`);
  console.log('');
  console.log('  Si el pedido no se puede entregar de verdad, el negocio lo cancela desde el Panel');
  console.log('  con motivo, y ahí el Rider queda libre.');
}
console.log(`\nDespués, siempre:  node rollback.mjs ${CODE} --verificar`);
