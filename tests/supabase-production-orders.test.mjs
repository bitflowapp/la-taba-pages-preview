import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const migrationName = '20260725030000_taba_production_orders.sql';
const migrationPath = path.join(root, 'supabase', 'migrations', migrationName);
const sql = fs.readFileSync(migrationPath, 'utf8');
const compactSql = sql.replace(/\s+/g, ' ');

function functionSql(name, nextMarker) {
  const start = sql.indexOf(`create or replace function public.${name}`);
  assert.notEqual(start, -1, `${name} debe existir`);
  const end = nextMarker ? sql.indexOf(nextMarker, start) : sql.length;
  assert.notEqual(end, -1, `no se pudo delimitar ${name}`);
  return sql.slice(start, end);
}

test('production migration is ordered after the operational v1 migration', () => {
  const migrationNames = fs.readdirSync(path.dirname(migrationPath))
    .filter((name) => name.endsWith('.sql'))
    .sort();

  assert.equal(fs.existsSync(migrationPath), true);
  assert.ok(migrationNames.indexOf(migrationName) > migrationNames.indexOf('20260601205707_operational_orders_v1.sql'));
  assert.ok(migrationNames.indexOf('20260725050000_tracking_rider_privacy.sql') > migrationNames.indexOf(migrationName));
});

test('beverage master catalog contains every requested field and defaults fail closed', () => {
  for (const definition of [
    /add column if not exists brand text/i,
    /add column if not exists subcategory text/i,
    /add column if not exists presentation text/i,
    /add column if not exists capacity text/i,
    /add column if not exists packaging_type text/i,
    /add column if not exists stock integer/i,
    /add column if not exists available boolean not null default false/i,
    /add column if not exists is_alcoholic boolean/i,
    /add column if not exists tags text\[\] not null default '\{\}'::text\[\]/i,
    /add column if not exists is_verified boolean not null default false/i,
    /add column if not exists verified_at timestamptz/i,
    /add column if not exists verified_by uuid references auth\.users/i,
  ]) {
    assert.match(sql, definition);
  }

  // Existing name/category/price/image_url/sort_order columns remain the source
  // for the other requested master fields. No product rows are invented here.
  assert.match(sql, /update public\.products\s+set available = false,\s+is_verified = false/is);
  assert.match(sql, /products_verified_master_data[\s\S]*brand is not null[\s\S]*presentation is not null[\s\S]*capacity is not null[\s\S]*packaging_type is not null[\s\S]*price > 0[\s\S]*stock is not null[\s\S]*image_url is not null/i);
  assert.match(sql, /products_available_requires_verification[\s\S]*not available[\s\S]*is_verified[\s\S]*stock > 0/i);
  assert.doesNotMatch(sql, /insert\s+into\s+public\.products/i);
});

test('business ordering configuration is explicit, verified and disabled by default', () => {
  for (const definition of [
    /ordering_enabled boolean not null default false/i,
    /ordering_verified boolean not null default false/i,
    /ordering_verified_at timestamptz/i,
    /ordering_verified_by uuid references auth\.users/i,
    /currency_code text/i,
    /delivery_enabled boolean not null default false/i,
    /pickup_enabled boolean not null default false/i,
    /delivery_fee numeric\(12,\s*2\)/i,
    /minimum_delivery_subtotal numeric\(12,\s*2\)/i,
  ]) {
    assert.match(sql, definition);
  }

  assert.match(sql, /businesses_ordering_enabled_requires_verification[\s\S]*not ordering_enabled[\s\S]*ordering_verified[\s\S]*status = 'open'/i);
  assert.match(sql, /not v_business\.ordering_verified[\s\S]*not v_business\.ordering_enabled/i);
});

test('Auth roles include admin with owner-like operations but protected owner/admin membership', () => {
  assert.match(
    sql,
    /business_members_role_check[\s\S]*role in \('owner', 'admin', 'staff', 'rider'\)/i,
  );
  assert.match(
    sql,
    /can_access_order[\s\S]*has_business_role\(o\.business_id, array\['owner', 'admin', 'staff'\]\)/i,
  );
  assert.match(
    sql,
    /log_order_status_event[\s\S]*has_business_role\(new\.business_id, array\['owner', 'admin', 'staff'\]\)/i,
  );
  assert.match(
    sql,
    /v_is_business := public\.has_business_role\([\s\S]*array\['owner', 'admin', 'staff'\]/i,
  );
  assert.match(
    sql,
    /production owners update business ordering[\s\S]*array\['owner', 'admin'\]/i,
  );
  assert.match(
    sql,
    /production team reads products[\s\S]*array\['owner', 'admin', 'staff'\]/i,
  );

  const adminInsertPolicy = compactSql.match(
    /create policy "production admins add staff and riders" .*?;/i,
  )?.[0] || '';
  const adminUpdatePolicy = compactSql.match(
    /create policy "production admins update staff and riders" .*?;/i,
  )?.[0] || '';
  const adminDeletePolicy = compactSql.match(
    /create policy "production admins remove staff and riders" .*?;/i,
  )?.[0] || '';

  for (const policy of [adminInsertPolicy, adminUpdatePolicy, adminDeletePolicy]) {
    assert.match(policy, /array\['admin'\]/i);
    assert.match(policy, /role in \('staff', 'rider'\)/i);
    assert.doesNotMatch(policy, /role in \([^)]*'owner'/i);
    assert.doesNotMatch(policy, /role in \([^)]*'admin'/i);
  }
});

test('orders have Auth ownership and a business-scoped idempotency key', () => {
  assert.match(sql, /orders add column if not exists customer_user_id uuid references auth\.users\(id\) on delete set null/i);
  assert.match(sql, /orders add column if not exists client_request_id text/i);
  assert.match(sql, /orders add column if not exists client_request_fingerprint text/i);
  assert.match(sql, /alter table public\.orders alter column client_request_id set not null/i);
  assert.match(sql, /create unique index if not exists orders_business_client_request_key\s+on public\.orders\(business_id,\s*client_request_id\)/i);
  assert.match(sql, /pg_advisory_xact_lock[\s\S]*business_id[\s\S]*client_request_id/i);
  assert.match(sql, /jsonb_agg\([\s\S]*order by normalized\.product_id[\s\S]*into v_intent_items/i);
  assert.match(sql, /Fingerprint the normalized intent/i);
});

test('create_order_with_items preserves the RPC signature but accepts only intent data', () => {
  const fn = functionSql('create_order_with_items(payload jsonb)', '-- ===== Concurrency-safe status transition RPC =====');

  assert.match(fn, /returns jsonb[\s\S]*security definer[\s\S]*set search_path/i);
  assert.match(fn, /v_customer_user_id is null[\s\S]*autenticacion de cliente requerida/i);
  assert.match(fn, /campo no permitido en pedido/i);
  assert.match(fn, /item_keys\.key not in \('product_id', 'quantity'\)/i);
  assert.match(fn, /\(item\.value->>'product_id'\)::uuid/i);
  assert.match(fn, /quantity entero/i);

  // These fields may appear only as forbidden concepts/comments or in
  // server-side writes; they are not in the accepted outer/item key lists.
  const allowedKeysBlock = fn.match(/where key not in \(([\s\S]*?)\)\s+limit 1/i)?.[1] || '';
  for (const forbidden of ['status', 'subtotal', 'delivery_fee', 'total', 'unit_price', 'code', 'id']) {
    assert.doesNotMatch(allowedKeysBlock, new RegExp(`'${forbidden}'`, 'i'));
  }
});

test('order creation locks products, computes money in DB and decrements stock atomically', () => {
  const fn = functionSql('create_order_with_items(payload jsonb)', '-- ===== Concurrency-safe status transition RPC =====');

  assert.match(fn, /from public\.products p[\s\S]*for update/i);
  assert.match(fn, /not v_product\.is_verified/i);
  assert.match(fn, /v_line_subtotal := v_product\.price \* v_item\.quantity/i);
  assert.match(fn, /v_subtotal := v_subtotal \+ v_line_subtotal/i);
  assert.match(fn, /v_delivery_fee := v_business\.delivery_fee/i);
  assert.match(fn, /v_total := v_subtotal \+ v_delivery_fee/i);
  assert.match(fn, /set stock = stock - v_item\.quantity,\s+available = \(stock - v_item\.quantity\) > 0/i);
  assert.match(fn, /status,[\s\S]*'received'/i);
});

test('idempotent retry returns the original order without a second stock mutation', () => {
  const fn = functionSql('create_order_with_items(payload jsonb)', '-- ===== Concurrency-safe status transition RPC =====');
  const existingBranch = fn.slice(fn.indexOf('if found then'), fn.indexOf('select b.*'));

  assert.match(existingBranch, /client_request_id ya pertenece a otro pedido/i);
  assert.match(existingBranch, /client_request_fingerprint[\s\S]*payload diferente/i);
  assert.match(existingBranch, /return v_result/i);
  assert.doesNotMatch(existingBranch, /update public\.products/i);
});

test('creation repairs the event NOT NULL incompatibility', () => {
  const fn = functionSql('create_order_with_items(payload jsonb)', '-- ===== Concurrency-safe status transition RPC =====');
  const eventInsert = fn.match(/insert into public\.order_events\s*\(([\s\S]*?)\)\s*values\s*\(([\s\S]*?)\);/i);

  assert.ok(eventInsert, 'la RPC debe crear el evento inicial');
  for (const requiredColumn of ['order_id', 'business_id', 'event_type', 'type', 'metadata', 'payload']) {
    assert.match(eventInsert[1], new RegExp(`\\b${requiredColumn}\\b`, 'i'));
  }
  assert.match(eventInsert[2], /v_business_id/i);
  assert.match(eventInsert[2], /'order\.received'/i);
});

test('tracking token is client-generated, stored only as SHA-256 and never directly readable', () => {
  assert.match(sql, /order_public_tokens add column if not exists token_hash bytea/i);
  assert.match(sql, /token_hash = digest\(token, 'sha256'\)/i);
  assert.match(sql, /alter column token drop not null/i);
  assert.match(sql, /expires_at = created_at \+ interval '30 days'/i);
  assert.match(sql, /alter column expires_at set not null/i);
  assert.match(sql, /set token = null/i);
  assert.match(sql, /v_tracking_token_hash := digest\(v_tracking_token, 'sha256'\)/i);
  assert.match(sql, /insert into public\.order_public_tokens[\s\S]*token_hash[\s\S]*v_tracking_token_hash/i);
  assert.match(sql, /opt\.token_hash = public\.request_order_token_hash\(\)/i);
  assert.match(sql, /opt\.revoked_at is null/i);
  assert.match(sql, /drop policy if exists "operational token reads itself"/i);
  assert.match(sql, /revoke all privileges on table public\.order_public_tokens from public, anon, authenticated/i);
  assert.doesNotMatch(sql, /grant\s+select\s+on\s+table\s+public\.order_public_tokens/i);
});

test('pre-dispatch cancellation releases stock once without inventing returned inventory', () => {
  assert.match(sql, /inventory_released_at timestamptz/i);
  const legacyBackfillAt = sql.search(
    /update public\.orders\s+set inventory_released_at = now\(\)\s+where inventory_released_at is null/i,
  );
  const createRpcAt = sql.indexOf('create or replace function public.create_order_with_items');
  assert.ok(legacyBackfillAt >= 0, 'los pedidos legacy deben quedar excluidos de la reposicion');
  assert.ok(legacyBackfillAt < createRpcAt, 'el backfill legacy debe anteceder a la RPC productiva');

  const fn = functionSql('change_order_status(', '-- ===== RLS: remove pilot bypasses');
  assert.match(
    fn,
    /v_new_status in \('cancelled', 'rejected'\)[\s\S]*v_current_status not in \('picked_up', 'on_the_way', 'arrived'\)[\s\S]*inventory_released_at is null/i,
  );
  assert.match(
    fn,
    /perform p\.id[\s\S]*from public\.products p[\s\S]*order by p\.id[\s\S]*for update[\s\S]*update public\.products p/i,
  );
  assert.match(fn, /set stock = coalesce\(p\.stock, 0\) \+ released\.quantity/i);
  assert.match(
    fn,
    /inventory_released_at = case[\s\S]*v_current_status not in \('picked_up', 'on_the_way', 'arrived'\)[\s\S]*coalesce\(inventory_released_at, now\(\)\)/i,
  );
  assert.doesNotMatch(fn, /set stock =[\s\S]{0,300}available\s*=/i);
  assert.match(
    sql,
    /'inventory_released',\s+new\.inventory_released_at is distinct from old\.inventory_released_at/i,
  );
});

test('change_order_status locks, compares expected status and enforces role transitions', () => {
  const fn = functionSql('change_order_status(', '-- ===== RLS: remove pilot bypasses');

  assert.match(fn, /p_expected_status text/i);
  assert.match(fn, /p_new_status text/i);
  assert.match(fn, /from public\.orders o[\s\S]*for update/i);
  assert.match(fn, /v_expected_status := case[\s\S]*when 'received' then 'submitted'/i);
  assert.match(fn, /when 'received' then 'submitted'/i);
  assert.match(fn, /v_current_status <> v_expected_status/i);
  assert.match(fn, /using errcode = '40001'/i);
  assert.match(fn, /has_business_role\([\s\S]*array\['owner', 'admin', 'staff'\]/i);
  assert.match(fn, /has_business_role\([\s\S]*array\['rider'\]/i);
  assert.match(fn, /v_order\.customer_user_id = v_user_id/i);
  assert.match(
    fn,
    /elsif v_is_rider then[\s\S]*v_order\.delivery_mode <> 'delivery'[\s\S]*retiro no admiten operacion de rider/i,
  );
  assert.match(fn, /'received', 'submitted'[\s\S]*'accepted', 'rejected', 'cancelled'/i);
  const businessBranch = fn.slice(
    fn.indexOf('if v_is_business then'),
    fn.indexOf('-- A rider may also be the customer'),
  );
  assert.match(
    businessBranch,
    /v_current_status not in \('delivered', 'cancelled', 'rejected'\)[\s\S]*v_new_status = 'cancelled'/i,
  );
  assert.match(fn, /v_current_status = 'ready'[\s\S]*v_new_status in \('assigned', 'on_the_way'\)/i);
  assert.match(fn, /assigned_rider_user_id[\s\S]*v_claim_rider/i);
  assert.ok(
    fn.indexOf("elsif v_is_customer\n    and v_current_status in ('received', 'submitted')")
      < fn.indexOf('elsif v_is_rider then'),
    'la cancelacion inicial del cliente debe evaluarse antes que el rol rider superpuesto',
  );
});

test('RLS removes pilot bypasses and routes order access through ownership helper', () => {
  assert.match(sql, /drop policy if exists "phase1 public read businesses" on public\.businesses/i);
  assert.match(sql, /drop policy if exists "operational team updates orders" on public\.orders/i);
  assert.match(sql, /production verified products are public[\s\S]*is_verified[\s\S]*ordering_enabled/i);
  assert.match(sql, /o\.customer_user_id = auth\.uid\(\)/i);
  assert.match(sql, /has_business_role\(o\.business_id, array\['owner', 'admin', 'staff'\]\)/i);
  assert.match(sql, /o\.assigned_rider_user_id = auth\.uid\(\)/i);
  assert.match(
    sql,
    /has_business_role\(o\.business_id, array\['rider'\]\)[\s\S]*o\.delivery_mode = 'delivery'/i,
  );
  assert.match(sql, /using \(public\.can_access_order\(id\)\)/i);
  assert.match(sql, /using \(public\.can_access_order\(order_id\)\)/i);
  assert.match(
    sql,
    /production assigned rider writes gps[\s\S]*has_business_role\(business_id, array\['rider'\]\)[\s\S]*o\.business_id = business_id[\s\S]*o\.delivery_mode = 'delivery'[\s\S]*o\.assigned_rider_user_id = auth\.uid\(\)/i,
  );
});

test('grants expose RPCs but revoke direct order and token mutation', () => {
  assert.match(sql, /revoke all privileges on table public\.orders from public, anon, authenticated/i);
  assert.match(sql, /grant select on table public\.orders to anon, authenticated/i);
  assert.doesNotMatch(compactSql, /grant (?:insert|update|delete)[^;]* on table public\.orders to/i);
  assert.match(sql, /revoke execute on function public\.create_order_with_items\(jsonb\) from public, anon, authenticated/i);
  assert.match(sql, /grant execute on function public\.create_order_with_items\(jsonb\) to authenticated/i);
  assert.doesNotMatch(sql, /grant execute on function public\.create_order_with_items\(jsonb\) to anon/i);
  assert.match(sql, /revoke execute on function public\.change_order_status\(uuid, text, text\) from public, anon, authenticated/i);
  assert.match(sql, /grant execute on function public\.change_order_status\(uuid, text, text\) to authenticated/i);
  assert.doesNotMatch(sql, /grant execute on function public\.change_order_status\(uuid, text, text\) to anon/i);
  assert.match(sql, /revoke all privileges on sequence public\.order_public_code_seq from public, anon, authenticated/i);
  assert.doesNotMatch(compactSql, /grant [^;]*delete[^;]* on table public\.products to/i);
  assert.doesNotMatch(
    compactSql,
    /create policy "production team [^"]*" on public\.products for (?:all|delete)/i,
  );
});

test('operational changes are independently included in Supabase Realtime', () => {
  assert.match(sql, /alter table public\.products replica identity full/i);
  assert.match(sql, /alter table public\.businesses replica identity full/i);

  const publicationBlocks = [...sql.matchAll(/do \$\$([\s\S]*?)\$\$;/gi)]
    .map((match) => match[1])
    .filter((block) => /alter publication supabase_realtime/i.test(block));
  const expectedTables = [
    'orders',
    'order_events',
    'rider_locations',
    'products',
    'businesses',
  ];

  for (const table of expectedTables) {
    const matchingBlocks = publicationBlocks.filter((block) => new RegExp(
      `alter publication supabase_realtime add table public\\.${table}\\b`,
      'i',
    ).test(block));
    assert.equal(matchingBlocks.length, 1, `${table} debe tener un bloque Realtime propio`);
    assert.match(matchingBlocks[0], /when duplicate_object then\s+null/i);
    assert.match(matchingBlocks[0], /when undefined_object then/i);
  }

  for (const block of publicationBlocks) {
    assert.equal(
      (block.match(/alter publication supabase_realtime add table/gi) || []).length,
      1,
      'cada bloque transaccional debe agregar una sola tabla',
    );
  }
});

test('legacy simulated rider locations are preserved but excluded from production reads', () => {
  assert.match(sql, /production rider locations readable with order[\s\S]*using \(source = 'gps' and public\.can_access_order\(order_id\)\)/i);
  const fn = functionSql('change_order_status(', '-- ===== RLS: remove pilot bypasses');
  assert.match(fn, /from public\.rider_locations rl[\s\S]*rl\.source = 'gps'/i);
});

test('rider no conserva acceso al pedido después del estado operativo', () => {
  const fn = functionSql('can_access_order(', '-- Attribute status audit events');
  assert.match(
    fn,
    /has_business_role\(o\.business_id,\s*array\['rider'\]\)[\s\S]*o\.status in \('ready', 'assigned', 'picked_up', 'on_the_way', 'arrived'\)/i,
  );
  assert.doesNotMatch(fn, /o\.status in \([^)]*'delivered'/i);
});

test('GPS productivo usa hora autoritativa del servidor', () => {
  assert.match(sql, /create or replace function public\.stamp_rider_location_server_time\(\)/i);
  assert.match(sql, /new\.created_at\s*:=\s*clock_timestamp\(\)/i);
  assert.match(sql, /before insert on public\.rider_locations/i);
});
