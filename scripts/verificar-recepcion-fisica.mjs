/*
 * READ-ONLY. Verifica UNA recepción hecha desde el Panel: que el movimiento de
 * inventario exista y sea el esperado, que el stock haya quedado donde tiene
 * que quedar, y que ningún otro producto se haya movido.
 *
 * No escribe nada. No carga stock. Sólo mira lo que el Panel dejó.
 *
 *   node scripts/verificar-recepcion-fisica.mjs --sku=<external_id> --esperado=<n> [--antes=<n>]
 */
import { conToken } from './lib/supabase-cli-token.mjs';

const BUSINESS_ID = '00000000-0000-4000-8000-000000000001';
const banderas = new Map();
for (const a of process.argv.slice(2)) {
  const i = a.indexOf('=');
  if (a.startsWith('--') && i !== -1) banderas.set(a.slice(2, i), a.slice(i + 1));
}
const sku = String(banderas.get('sku') || '');
const esperado = Number(banderas.get('esperado'));
const antes = banderas.has('antes') ? Number(banderas.get('antes')) : 0;
if (!sku || !Number.isFinite(esperado)) {
  console.error('ABORTAR: uso --sku=<external_id> --esperado=<stock final> [--antes=<stock previo>]');
  process.exit(2);
}
const lit = (v) => `'${String(v).replaceAll("'", "''")}'`;

let rojo = 0;
const medir = (nombre, ok, detalle = '') => {
  console.log(`  ${ok ? 'OK  ' : 'MAL '} ${nombre}${detalle ? ` · ${detalle}` : ''}`);
  if (!ok) rojo += 1;
};

await conToken(async (token) => {
  const sql = async (query) => {
    const r = await fetch('https://api.supabase.com/v1/projects/wwcpogltfgzgkrlilbcd/database/query', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', 'User-Agent': 'taba2-verificar-recepcion/1.0' },
      body: JSON.stringify({ query }),
    });
    const t = await r.text();
    if (!r.ok) throw new Error(`HTTP ${r.status} · ${t.slice(0, 800)}`);
    return t ? JSON.parse(t) : null;
  };

  const [producto] = await sql(`select id::text as id, external_id, name, stock, available, is_verified, price::text as precio, updated_at::text as updated_at
    from public.products where business_id = ${lit(BUSINESS_ID)} and external_id = ${lit(sku)};`);
  if (!producto) { console.error(`ABORTAR: no existe ${sku}`); process.exit(2); }

  console.log(`\n── ${producto.name} (${sku}) ──`);
  medir(`el stock quedó en ${esperado}`, producto.stock === esperado, `stock ${producto.stock}`);
  console.log(`       available=${producto.available} · precio ${producto.precio} · actualizado ${producto.updated_at}`);

  console.log('\n── el movimiento de ledger ──');
  const movimientos = await sql(`select m.movement_type, m.quantity_delta, m.previous_stock, m.resulting_stock, m.unit_factor,
      m.reference_type, coalesce(m.reason,'') as reason, m.operator_id::text as operator_id, m.created_at::text as created_at,
      coalesce(u.email,'(sin usuario)') as operador
    from public.inventory_movements m
    left join auth.users u on u.id = m.operator_id
    where m.business_id = ${lit(BUSINESS_ID)} and m.product_id = ${lit(producto.id)}
    order by m.created_at;`);
  medir('hay al menos un movimiento para este producto', movimientos.length > 0, `${movimientos.length} movimiento(s)`);
  for (const m of movimientos) {
    console.log(`       ${m.created_at} · ${m.movement_type} · Δ${m.quantity_delta} (×${m.unit_factor}) · ${m.previous_stock} → ${m.resulting_stock} · ${m.operador}${m.reason ? ` · «${m.reason}»` : ''}`);
  }
  const ultimo = movimientos.at(-1);
  if (ultimo) {
    medir('el movimiento parte del stock previo declarado', ultimo.previous_stock === antes, `previous_stock ${ultimo.previous_stock} (esperado ${antes})`);
    medir('el movimiento cierra en el stock final', ultimo.resulting_stock === esperado, `resulting_stock ${ultimo.resulting_stock}`);
    medir('el delta es exactamente lo recibido', ultimo.quantity_delta === esperado - antes, `Δ${ultimo.quantity_delta}`);
    medir('lo registró una persona con sesión, no un script', Boolean(ultimo.operator_id), ultimo.operador);
    medir('el stock del producto coincide con el ledger', producto.stock === ultimo.resulting_stock);
  }

  console.log('\n── nada más se movió ──');
  const [otros] = await sql(`select
      count(*)::int as productos,
      count(*) filter (where available and is_active and is_verified)::int as visibles,
      count(*) filter (where is_alcoholic and available)::int as alcohol_visible,
      sum(stock)::int as stock_total
    from public.products where business_id = ${lit(BUSINESS_ID)};`);
  const [ledger] = await sql(`select count(*)::int as total, count(distinct product_id)::int as productos_tocados
    from public.inventory_movements where business_id = ${lit(BUSINESS_ID)};`);
  const [pedidos] = await sql("select count(*)::int as total, (select status from public.orders where public_code='LT-0001') as lt0001 from public.orders;");
  console.log(`       catálogo: ${otros.productos} SKU · ${otros.visibles} visibles · alcohol visible ${otros.alcohol_visible} · stock total ${otros.stock_total}`);
  console.log(`       ledger:   ${ledger.total} movimiento(s) sobre ${ledger.productos_tocados} producto(s)`);
  console.log(`       pedidos:  ${pedidos.total} · LT-0001 ${pedidos.lt0001}`);
  medir('el ledger sólo tocó este producto', ledger.productos_tocados <= 1, `${ledger.productos_tocados}`);
  medir('0 alcohólicos visibles', otros.alcohol_visible === 0);
  medir('el catálogo sigue en 72 SKU', otros.productos === 72, `${otros.productos}`);
  medir('LT-0001 sigue on_the_way', pedidos.lt0001 === 'on_the_way', String(pedidos.lt0001));
  medir('no aparecieron pedidos nuevos', pedidos.total === 1, `${pedidos.total}`);
});

console.log(rojo === 0 ? '\nRECEPCIÓN VERIFICADA: PASS' : `\nRECEPCIÓN: ${rojo} falla(s)`);
process.exit(rojo === 0 ? 0 : 1);
