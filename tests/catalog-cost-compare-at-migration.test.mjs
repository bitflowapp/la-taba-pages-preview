/*
 * CONTRATO DE LA MIGRACIÓN 20261021234000 (costo, precio regular y lectura de costos).
 *
 * La base no corre acá: esto fija, leyendo el SQL, lo que la migración
 * promete — misma firma de la planilla, todas sus validaciones de antes,
 * permisos explícitos, 42501 para quien no es dueño ni encargado — y que la
 * prueba pgTAP que la acompaña tenga tantas aserciones como planea.
 */
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import test from 'node:test';
import { reviewMigrations } from '../scripts/validate-supabase-migrations.mjs';

const MIGRATION = '20261021234000_catalog_cost_compare_at.sql';
const PREVIOUS = '20260928160000_publish_sets_merchant_intent.sql';
const dir = new URL('../supabase/migrations/', import.meta.url);
const raw = readFileSync(new URL(MIGRATION, dir));
const sql = raw.toString('utf8');
const previous = readFileSync(new URL(PREVIOUS, dir), 'utf8');
const pgtap = readFileSync(new URL('../supabase/tests/catalog_cost_compare_at_test.sql', import.meta.url), 'utf8');
const names = readdirSync(dir).filter((name) => name.endsWith('.sql')).sort();
const strip = (text) => text.replace(/--.*$/gm, '');

function functionBlock(source, name) {
  const start = source.search(new RegExp(`create or replace function public\\.${name}\\(`, 'i'));
  assert.notEqual(start, -1, `falta ${name}`);
  const tag = /as (\$[a-z_]*\$)/i.exec(source.slice(start));
  const end = source.indexOf(tag[1], source.indexOf(tag[1], start) + tag[1].length);
  return source.slice(start, end + tag[1].length);
}

test('nombre, codificación y revisión estática', () => {
  assert.ok(names.includes(MIGRATION));
  assert.ok(names.indexOf(MIGRATION) > names.indexOf('20261021233000_mp_rejected_payment_keeps_reservation.sql')
    || !names.includes('20261021233000_mp_rejected_payment_keeps_reservation.sql'), 'va después de lo ya aplicado en QA');
  assert.notDeepEqual([...raw.subarray(0, 3)], [0xef, 0xbb, 0xbf], 'sin BOM');
  assert.equal(sql.includes('\r\n'), false, 'fin de línea LF');
  const errors = reviewMigrations().issues.filter((issue) => issue.severity === 'error');
  assert.deepEqual(errors, []);
});

test('la planilla conserva su firma y su retorno', () => {
  const header = (source) => /create or replace function public\.apply_commercial_catalog_batch\(([^)]*)\)\s*returns table\(([^)]*)\)/i.exec(source)
    .slice(1).map((part) => part.replace(/\s+/g, ' ').trim());
  assert.deepEqual(header(sql), header(previous));
  assert.equal(names.filter((name) => name > MIGRATION
    && /create or replace function public\.apply_commercial_catalog_batch/i.test(readFileSync(new URL(name, dir), 'utf8'))).length, 0,
  'ninguna migración posterior la vuelve a pisar');
});

test('todas las validaciones y compuertas de antes siguen, con el mismo texto', () => {
  const block = functionBlock(sql, 'apply_commercial_catalog_batch');
  const before = functionBlock(previous, 'apply_commercial_catalog_batch');
  const messages = [...strip(before).matchAll(/raise exception '([^']+)'/g)].map((match) => match[1]);
  assert.ok(messages.length >= 18, 'se leyeron los mensajes de la versión anterior');
  for (const message of messages) assert.ok(block.includes(`'${message}'`), `falta: ${message}`);
  for (const rule of [
    "'^[0-9]+([.][0-9]{1,2})?$'", "'^[0-9]+$'", '> 2147483647', 'jsonb_array_length(p_rows) > 500',
    'for update', 'public.product_commercial_image_valid(v_product)', 'v_alcohol_open', 'merchant_available = coalesce(v_publish, p.merchant_available)',
    "(-staging-only$)|(^qa[-_])|(\\yqa\\y)|(\\y(test|prueba|sintetica|sintetico|synthetic|fixture|dummy)\\y)",
  ]) assert.ok(block.includes(rule), `falta la regla ${rule}`);
});

test('costo y precio regular: claves opcionales, null borra, ninguno despublica', () => {
  const block = strip(functionBlock(sql, 'apply_commercial_catalog_batch'));
  assert.match(block, /v_row -> 'unit_cost' is not null/);
  assert.match(block, /v_row -> 'compare_at_price' is not null/);
  assert.match(block, /unit_cost = case when v_cost_set then v_cost else p\.unit_cost end/);
  assert.match(block, /compare_at_price = v_next_compare/);
  assert.match(block, /v_next_compare <= coalesce\(v_next_price, 0\)/);
  assert.match(block, /and not v_cost_set and not v_compare_set/);
  assert.doesNotMatch(block, /\?\s*'unit_cost'/, 'sin el operador ? (algunos drivers lo toman como parámetro)');
  const trigger = readFileSync(new URL('20260725110000_catalog_publication_authority.sql', dir), 'utf8');
  const triggerBlock = /create or replace function public\.fail_close_verified_product_master_change\(\)[\s\S]*?\$\$;/i.exec(trigger)[0];
  assert.doesNotMatch(triggerBlock, /unit_cost|compare_at_price/);
  assert.equal(names.filter((name) => /create or replace function public\.fail_close_verified_product_master_change/i
    .test(readFileSync(new URL(name, dir), 'utf8'))).length, 1, 'el disparador de datos maestros no se redefinió después');
});

test('autorización: 42501, search_path fijo, permisos explícitos', () => {
  for (const name of ['apply_commercial_catalog_batch', 'get_catalog_costs']) {
    const block = functionBlock(sql, name);
    assert.match(block, /security definer/i, name);
    assert.match(block, /set search_path = pg_catalog, public, pg_temp/, name);
    assert.match(block, /has_business_role\(p_business_id, array\['owner', 'admin'\]\)[\s\S]{0,200}using errcode = '42501'/, name);
  }
  assert.match(sql, /revoke all on function public\.apply_commercial_catalog_batch\(uuid, jsonb\)\s+from public, anon, authenticated;/);
  assert.match(sql, /grant execute on function public\.apply_commercial_catalog_batch\(uuid, jsonb\)\s+to authenticated;/);
  assert.match(sql, /revoke all on function public\.get_catalog_costs\(uuid\) from public, anon, authenticated;/);
  assert.match(sql, /grant execute on function public\.get_catalog_costs\(uuid\) to authenticated;/);
  assert.doesNotMatch(strip(sql), /grant [^;]*to (?:anon|public)[^;]*get_catalog_costs|grant execute on function public\.get_catalog_costs\(uuid\) to [^;]*anon/i);
});

test('precio regular público como el precio; costo privado como siempre', () => {
  const body = strip(sql);
  assert.match(body, /add column if not exists compare_at_price numeric\(12, 2\);/);
  assert.match(body, /check \(compare_at_price is null or compare_at_price > price\)/);
  assert.match(body, /grant select \(compare_at_price\) on table public\.products to anon, authenticated;/);
  assert.doesNotMatch(body, /grant select[^;]*unit_cost/i, 'unit_cost no se le abre a nadie');
  const costs = functionBlock(sql, 'get_catalog_costs');
  assert.match(costs, /returns table\(sku text, price numeric, unit_cost numeric, compare_at_price numeric\)/);
  assert.match(costs, /p\.catalog_origin = 'commercial'/);
  assert.match(costs, /stable/);
});

test('la prueba pgTAP planea exactamente las aserciones que hace', () => {
  const planned = Number(/select plan\((\d+)\);/.exec(pgtap)[1]);
  const asserted = (pgtap.match(/^select (?:has_column|col_type_is|ok|is|isnt|lives_ok|throws_ok)\(/gm) || []).length;
  assert.equal(asserted, planned);
  assert.match(pgtap, /^begin;/m);
  assert.match(pgtap, /^rollback;\s*$/m);
  for (const covered of ['get_catalog_costs', "'42501'", "'22023'", "'23514'", 'unit_cost', 'compare_at_price', 'Invalid price format']) {
    assert.ok(pgtap.includes(covered), `la prueba no cubre ${covered}`);
  }
});
