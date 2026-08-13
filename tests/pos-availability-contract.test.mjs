// Vender la última unidad por mostrador no puede voltear la venta entera (F01).
//
// POR QUÉ EXISTE ESTE ARCHIVO
// ---------------------------
// `checkout_pos_sale` descontaba stock escribiendo SÓLO `stock`. El contrato
// comercial impone, sobre la misma tabla:
//
//   products_available_requires_verification:
//     not available or (is_verified and is_active and stock > 0
//                       and price_status = 'confirmed' and price > 0)
//
// Al vender la ÚLTIMA unidad el producto quedaba en `stock = 0` con
// `available = true` —las dos ramas del CHECK en falso—, el UPDATE levantaba
// 23514 y, como la función no tiene bloque `exception`, se caía la transacción
// COMPLETA: no se registraba la venta, no se asentaba el pago, y el operador
// veía un error genérico con el cliente enfrente.
//
// El camino online nunca lo tuvo: `create_order_with_items` ya escribía
// `available` junto al stock. El mostrador era el único que no, y esa asimetría
// es justamente lo que este archivo fija.
//
// La migración está PREPARADA Y NO APLICADA, así que esto comprueba el SQL del
// árbol. Cuando se aplique, la comprobación viva es la que describe el
// encabezado de la migración.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const migraciones = path.join(root, 'supabase', 'migrations');
const leer = (archivo) => fs.readFileSync(path.join(migraciones, archivo), 'utf8');

const CORRECCION = '20260813010000_pos_last_unit_keeps_availability_contract.sql';
const CONTRATO = '20260809060000_commercial_price_and_stock_contract.sql';
const ORIGEN = '20260802160000_business_windows_scanner_fiscal.sql';

/** El último `create or replace` de una función, en orden de migración. */
function ultimaDefinicion(nombre) {
  const archivos = fs.readdirSync(migraciones).filter((f) => f.endsWith('.sql')).sort();
  let ultima = null;
  for (const archivo of archivos) {
    const sql = leer(archivo);
    if (sql.includes(`create or replace function public.${nombre}(`)) ultima = { archivo, sql };
  }
  assert.ok(ultima, `no se encontró ninguna definición de ${nombre}`);
  return ultima;
}

test('la corrección del mostrador es la definición vigente de checkout_pos_sale', () => {
  // Si alguien agrega después otra migración que redefina la función sin este
  // arreglo, el defecto vuelve en silencio. Por eso se comprueba cuál gana.
  assert.equal(ultimaDefinicion('checkout_pos_sale').archivo, CORRECCION);
});

test('el mostrador recalcula la disponibilidad al descontar stock', () => {
  const sql = leer(CORRECCION);
  const update = sql.match(/update public\.products\s+set stock = stock - v_quantity,\s+available = ([^\n]+)\n\s+where id = v_product\.id;/);
  assert.ok(update, 'el UPDATE del mostrador tiene que escribir `available` junto con `stock`');
  assert.match(update[1], /available and \(stock - v_quantity\) > 0/);
});

test('vender no reactiva un producto que el comercio pausó a mano', () => {
  // `available and (…)` y no `(…)` a secas: la diferencia importa. Con la
  // segunda forma, vender una unidad de un producto pausado lo volvería a
  // publicar, y eso es una decisión del comercio, no una consecuencia de vender.
  const sql = leer(CORRECCION);
  assert.doesNotMatch(
    sql,
    /set stock = stock - v_quantity,\s+available = \(stock - v_quantity\) > 0/,
    'esa forma reactivaría un producto pausado',
  );
});

test('la corrección no toca nada más de la función', () => {
  const corregida = leer(CORRECCION);
  // Autorización, idempotencia, bloqueo de fila y asientos: todo igual.
  assert.match(corregida, /has_business_role\(p_business_id, array\['owner','admin','staff'\]\)/);
  assert.match(corregida, /where s\.business_id = p_business_id and s\.idempotency_key = p_idempotency_key/);
  assert.match(corregida, /for update/);
  assert.match(corregida, /insert into public\.pos_sale_items/);
  assert.match(corregida, /insert into public\.inventory_movements/);
  assert.match(corregida, /insert into public\.pos_payments/);
  assert.match(corregida, /security definer/);
  assert.match(corregida, /set search_path = pg_catalog, public, extensions, pg_temp/);

  // Y la comprobación de stock suficiente sigue antes del UPDATE: el arreglo no
  // es «dejar vender de más», es «al vender lo último, decirlo en la fila».
  assert.ok(
    corregida.indexOf('stock insuficiente') < corregida.indexOf('available = available and'),
    'la guardia de stock insuficiente tiene que seguir antes del descuento',
  );
});

test('el CHECK que provocaba la caída sigue en pie: no se arregló debilitándolo', () => {
  const contrato = leer(CONTRATO);
  assert.match(contrato, /add constraint products_available_requires_verification check \(/);
  assert.match(contrato, /and stock > 0/);
  assert.match(contrato, /and price_status = 'confirmed'/);
  assert.match(contrato, /and price > 0/);
  // Y la corrección no lo ALTERA. Lo nombra en su encabezado, que es donde
  // explica por qué existe; lo que no puede hacer es tocarlo.
  const codigo = leer(CORRECCION)
    .split('\n')
    .filter((linea) => !linea.trim().startsWith('--'))
    .join('\n');
  assert.doesNotMatch(codigo, /drop constraint/i);
  assert.doesNotMatch(codigo, /alter table public\.products/i);
  assert.doesNotMatch(codigo, /products_available_requires_verification/);
});

test('el defecto estaba en el mostrador, no en el camino online', () => {
  // La asimetría es el corazón del hallazgo: el pedido online ya lo hacía bien.
  const online = leer('20260725030000_taba_production_orders.sql');
  assert.match(
    online,
    /update public\.products\s+set stock = stock - v_item\.quantity,\s+available = \(stock - v_item\.quantity\) > 0/,
  );
  // Y la definición original del mostrador sólo escribía stock.
  assert.match(
    leer(ORIGEN),
    /update public\.products set stock = stock - v_quantity where id = v_product\.id;/,
  );
});
