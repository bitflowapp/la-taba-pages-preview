import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const migrationPath = path.join(root, 'supabase/migrations/20260531030000_la_taba_phase1_orders.sql');

test('Supabase phase 1 migration defines the persistent order model', () => {
  const sql = fs.readFileSync(migrationPath, 'utf8');

  for (const table of ['businesses', 'orders', 'order_items', 'riders', 'rider_locations', 'order_events']) {
    assert.match(sql, new RegExp(`create table if not exists public\\.${table}`));
    assert.match(sql, new RegExp(`alter table public\\.${table} enable row level security`));
  }

  assert.match(sql, /orders_total_matches_parts/);
  assert.match(sql, /source in \('gps', 'simulation', 'manual'\)/);
  assert.match(sql, /create policy "phase1 public create orders"/);
  assert.match(sql, /create policy "phase1 public update orders"/);
  assert.match(sql, /00000000-0000-4000-8000-000000000001/);
});

test('Supabase migration does not hardcode API secrets', () => {
  const sql = fs.readFileSync(migrationPath, 'utf8');
  assert.doesNotMatch(sql, /eyJ[a-zA-Z0-9_-]{20,}/);
  assert.doesNotMatch(sql, /service_role/i);
  assert.doesNotMatch(sql, /supabaseAnonKey/i);
});

const hardeningPath = path.join(root, 'supabase/migrations/20260531040000_la_taba_phase1_hardening.sql');
const operationalPath = path.join(root, 'supabase/migrations/20260601205707_operational_orders_v1.sql');

test('hardening migration adds a transactional create_order_with_items RPC', () => {
  const sql = fs.readFileSync(hardeningPath, 'utf8');
  assert.match(sql, /create or replace function public\.create_order_with_items\(payload jsonb\)/);
  assert.match(sql, /security definer/i);
  // Inserta order, items y evento en una sola función (transacción).
  assert.match(sql, /insert into public\.orders/);
  assert.match(sql, /insert into public\.order_items/);
  assert.match(sql, /insert into public\.order_events/);
  // Validaciones mínimas.
  assert.match(sql, /business_id requerido/);
  assert.match(sql, /al menos un ítem/);
  assert.match(sql, /grant execute on function public\.create_order_with_items/);
});

test('hardening migration removes broad anon insert policies', () => {
  const sql = fs.readFileSync(hardeningPath, 'utf8');
  assert.match(sql, /drop policy if exists "phase1 public create orders" on public\.orders/);
  assert.match(sql, /drop policy if exists "phase1 public create order items" on public\.order_items/);
  // Documenta explícitamente que el resto sigue siendo demo/piloto.
  assert.match(sql, /DEMO\/PILOTO/);
});

test('hardening migration does not hardcode API secrets', () => {
  const sql = fs.readFileSync(hardeningPath, 'utf8');
  assert.doesNotMatch(sql, /eyJ[a-zA-Z0-9_-]{20,}/);
  assert.doesNotMatch(sql, /service_role/i);
  assert.doesNotMatch(sql, /supabaseAnonKey/i);
});

test('Supabase operational v1 migration defines the commerce order database', () => {
  const sql = fs.readFileSync(operationalPath, 'utf8');

  for (const table of ['business_members', 'products', 'order_public_tokens']) {
    assert.match(sql, new RegExp(`create table if not exists public\\.${table}`));
    assert.match(sql, new RegExp(`alter table public\\.${table} enable row level security`));
  }

  for (const table of ['businesses', 'orders', 'order_items', 'order_events', 'rider_locations', 'riders']) {
    assert.match(sql, new RegExp(`alter table public\\.${table}`));
    assert.match(sql, new RegExp(`alter table public\\.${table} enable row level security`));
  }

  assert.match(sql, /public_code text/);
  assert.match(sql, /delivery_mode text/);
  assert.match(sql, /assigned_rider_user_id uuid references auth\.users/);
  assert.match(sql, /rider_user_id uuid references auth\.users/);
  assert.match(sql, /source = 'gps'/);
});

test('Supabase operational v1 includes RLS helpers and conservative policies', () => {
  const sql = fs.readFileSync(operationalPath, 'utf8');

  for (const fn of ['is_business_member', 'has_business_role', 'can_access_order', 'is_assigned_rider']) {
    assert.match(sql, new RegExp(`create or replace function public\\.${fn}`));
  }

  assert.match(sql, /drop policy if exists "phase1 public read orders"/);
  assert.match(sql, /operational orders readable by token or team/);
  assert.match(sql, /operational assigned rider writes gps/);
  assert.match(sql, /operational token reads itself/);
  assert.match(sql, /x-order-token/);
});

test('Supabase operational v1 prepares realtime publication', () => {
  const sql = fs.readFileSync(operationalPath, 'utf8');

  assert.match(sql, /alter publication supabase_realtime add table public\.orders/);
  assert.match(sql, /alter publication supabase_realtime add table public\.order_events/);
  assert.match(sql, /alter publication supabase_realtime add table public\.rider_locations/);
});

test('Supabase operational v1 docs and seed exist without secrets', () => {
  const files = [
    operationalPath,
    path.join(root, 'supabase/seed.sql'),
    path.join(root, 'supabase/README.md'),
    path.join(root, 'docs/backend-operativo-v1.md'),
    path.join(root, '.env.example'),
  ];

  for (const file of files) {
    assert.equal(fs.existsSync(file), true, `${path.relative(root, file)} debe existir`);
    const text = fs.readFileSync(file, 'utf8');
    assert.doesNotMatch(text, /eyJ[a-zA-Z0-9_-]{20,}/, `${file} no debe contener JWTs`);
    assert.doesNotMatch(text, /service_role/i, `${file} no debe mencionar llaves privilegiadas por nombre`);
    assert.doesNotMatch(text, /supabaseAnonKey\s*[:=]\s*['"][^'"]+['"]/i, `${file} no debe hardcodear anon keys`);
  }
});
