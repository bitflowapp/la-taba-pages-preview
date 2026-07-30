import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import test from 'node:test';

const migrationPath = new URL(
  '../supabase/migrations/20260729210000_tracking_terminal_visibility.sql',
  import.meta.url,
);
const supersededMigrationPath = new URL(
  '../supabase/migrations/20260729203000_public_tracking_terminal_visibility.sql',
  import.meta.url,
);
const privacyPath = new URL(
  '../supabase/migrations/20260725050000_tracking_rider_privacy.sql',
  import.meta.url,
);
const assignmentPath = new URL(
  '../supabase/migrations/20260725080000_rider_assignment_tracking_gate.sql',
  import.meta.url,
);
const repositoryPath = new URL(
  '../js/repositories/supabase_order_repository.js',
  import.meta.url,
);
const pollingPath = new URL(
  '../js/tracking/customer_tracking_poll.js',
  import.meta.url,
);
const appPath = new URL('../js/app.js', import.meta.url);

const sql = readFileSync(migrationPath, 'utf8');
const privacySql = readFileSync(privacyPath, 'utf8');
const assignmentSql = readFileSync(assignmentPath, 'utf8');
const repositorySource = readFileSync(repositoryPath, 'utf8');
const pollingSource = readFileSync(pollingPath, 'utf8');
const appSource = readFileSync(appPath, 'utf8');

function sqlFunction(source, name) {
  const start = source.search(new RegExp(
    `create or replace function public\\.${name}\\b`,
    'i',
  ));
  assert.notEqual(start, -1, `No se encontró ${name}`);
  const tail = source.slice(start);
  const end = tail.search(/\n\$\$;/);
  assert.notEqual(end, -1, `No se encontró el cierre de ${name}`);
  return tail.slice(0, end + 4);
}

test('la migración terminal usa el nombre y orden del contrato certificado', () => {
  assert.equal(existsSync(migrationPath), true);
  assert.equal(existsSync(supersededMigrationPath), false);
  assert.match(sql, /alter table public\.orders[\s\S]*terminal_visible_until timestamptz/i);
  assert.doesNotMatch(sql, /alter table public\.order_public_tokens[\s\S]*terminal_visible_until/i);
});

test('la primera transición a delivered establece una ventana de treinta minutos', () => {
  const terminal = sqlFunction(sql, 'set_order_terminal_tracking_visibility');
  assert.match(terminal, /new\.status = 'delivered'/i);
  assert.match(terminal, /old\.status is distinct from 'delivered'/i);
  assert.match(
    terminal,
    /coalesce\(\s*old\.terminal_visible_until,\s*new\.delivered_at \+ interval '30 minutes',\s*clock_timestamp\(\) \+ interval '30 minutes'\s*\)/i,
  );
  assert.match(
    sql,
    /before update of status, terminal_visible_until on public\.orders/i,
  );
});

test('delivered repetido y transiciones terminales no renuevan la ventana', () => {
  const terminal = sqlFunction(sql, 'set_order_terminal_tracking_visibility');
  assert.match(
    terminal,
    /elsif old\.terminal_visible_until is not null then\s*new\.terminal_visible_until := old\.terminal_visible_until/i,
  );
  assert.doesNotMatch(
    terminal,
    /new\.status in \('delivered', 'canceled', 'cancelled', 'rejected'\)/i,
  );
});

test('la purga terminal elimina GPS sin convertir el cierre en revocación', () => {
  const purge = sqlFunction(sql, 'purge_terminal_order_rider_locations');
  assert.match(
    purge,
    /new\.status in \('delivered', 'canceled', 'cancelled', 'rejected'\)/i,
  );
  assert.match(purge, /delete from public\.rider_locations[\s\S]*order_id = new\.id/i);
  assert.doesNotMatch(purge, /order_public_tokens|revoked_at/i);
});

test('revocación manual y expiración general prevalecen sobre delivered', () => {
  const tracking = sqlFunction(sql, 'get_public_order_tracking');
  assert.match(
    privacySql,
    /function public\.revoke_public_tracking[\s\S]*set revoked_at = coalesce\(revoked_at, clock_timestamp\(\)\)/i,
  );
  assert.match(tracking, /opt\.token_hash = v_token_hash/i);
  assert.match(tracking, /opt\.revoked_at is null/i);
  assert.match(tracking, /opt\.expires_at > clock_timestamp\(\)/i);
});

test('sólo delivered usa la ventana y cancelación o rechazo quedan fail-closed', () => {
  const tracking = sqlFunction(sql, 'get_public_order_tracking');
  assert.match(
    tracking,
    /o\.status not in \('delivered', 'canceled', 'cancelled', 'rejected'\)[\s\S]*o\.status = 'delivered'[\s\S]*o\.terminal_visible_until > clock_timestamp\(\)/i,
  );
  assert.doesNotMatch(
    tracking,
    /o\.status in \('delivered', 'canceled', 'cancelled', 'rejected'\)[\s\S]*terminal_visible_until > clock_timestamp\(\)/i,
  );
});

test('la expiración terminal queda fail-closed y no depende de cron', () => {
  const tracking = sqlFunction(sql, 'get_public_order_tracking');
  assert.match(tracking, /o\.terminal_visible_until is not null/i);
  assert.match(tracking, /o\.terminal_visible_until > clock_timestamp\(\)/i);
  assert.doesNotMatch(sql, /\bcron\b|\bpg_cron\b|set\s+revoked_at\s*=\s*null/i);
});

test('el DTO delivered no contiene GPS, código de entrega ni PII', () => {
  const tracking = sqlFunction(sql, 'get_public_order_tracking');
  const dto = tracking.match(
    /return jsonb_strip_nulls\(jsonb_build_object\([\s\S]*?\)\);/i,
  )?.[0] || '';

  assert.match(tracking, /v_order\.status in \('picked_up', 'on_the_way', 'arrived'\)/i);
  assert.match(tracking, /if v_order\.status = 'arrived' then/i);
  assert.match(dto, /'terminal_visible_until'[\s\S]*v_order\.terminal_visible_until/i);
  for (const prohibited of [
    'customer_name',
    'customer_phone',
    'customer_email',
    'customer_street_address',
    'customer_reference',
    'customer_user_id',
    'assigned_rider_user_id',
    'business_id',
    'token_hash',
  ]) {
    assert.doesNotMatch(dto, new RegExp(prohibited, 'i'));
  }
});

test('el backfill usa delivered_at y nunca revive un bearer revocado o vencido', () => {
  const backfill = sql.match(
    /update public\.orders o([\s\S]*?)\n\s*and exists \(([\s\S]*?)\n\s*\);/i,
  )?.[0] || '';
  assert.match(backfill, /o\.status = 'delivered'/i);
  assert.match(backfill, /o\.delivered_at \+ interval '30 minutes'/i);
  assert.match(backfill, /opt\.revoked_at is null/i);
  assert.match(backfill, /opt\.expires_at > clock_timestamp\(\)/i);
  assert.doesNotMatch(backfill, /canceled|cancelled|rejected|set\s+revoked_at/i);
  assert.match(
    sql,
    /drop trigger if exists orders_set_updated_at on public\.orders;[\s\S]*update public\.orders o[\s\S]*create trigger orders_set_updated_at\s*before update on public\.orders/i,
  );
});

test('GPS posterior al cierre sigue bloqueado por el contrato de publicación', () => {
  const publish = sqlFunction(assignmentSql, 'publish_rider_location');
  assert.match(
    publish,
    /v_order\.status not in \('assigned', 'picked_up', 'on_the_way', 'arrived'\)/i,
  );
  assert.doesNotMatch(
    publish,
    /v_order\.status not in \([^)]*(?:delivered|canceled|cancelled|rejected)[^)]*\)/i,
  );
});

test('la función pública conserva search_path cerrado y permisos mínimos', () => {
  const tracking = sqlFunction(sql, 'get_public_order_tracking');
  assert.match(
    tracking,
    /security definer[\s\S]*set search_path = pg_catalog, public, extensions, pg_temp/i,
  );
  assert.match(
    sql,
    /revoke all on function public\.get_public_order_tracking\(text\)[\s\S]*grant execute[\s\S]*to anon, authenticated/i,
  );
  assert.doesNotMatch(sql, /disable row level security|grant all|service_role/i);
});

test('frontend propaga la fecha terminal y limpia cache y bearer al vencer', () => {
  assert.match(repositorySource, /normalizeOptionalIso\(dto\.terminal_visible_until\)/i);
  assert.match(repositorySource, /terminalVisibleUntil: tracking\.terminalVisibleUntil/i);
  assert.match(appSource, /terminalVisibleUntil: order\.terminalVisibleUntil/i);
  assert.match(
    repositorySource,
    /invalidatePublicTrackingAccess[\s\S]*removeStoredAccess\(storage, lastAccessStorageKey\)[\s\S]*clearPublicTrackingState/i,
  );
  assert.match(pollingSource, /scheduleTerminalRevalidation/i);
  assert.match(pollingSource, /revalidateTerminal/i);
});
