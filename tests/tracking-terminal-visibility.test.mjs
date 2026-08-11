import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import test from 'node:test';

const recoveryPath = new URL(
  '../supabase/migrations/20260725100000_tracking_handoff_recovery.sql',
  import.meta.url,
);
const handoffPath = new URL(
  '../supabase/migrations/20260725090000_delivery_handoff_code.sql',
  import.meta.url,
);
const privacyPath = new URL(
  '../supabase/migrations/20260725050000_tracking_rider_privacy.sql',
  import.meta.url,
);
const productionPath = new URL(
  '../supabase/migrations/20260725030000_taba_production_orders.sql',
  import.meta.url,
);
const fixPath = new URL(
  '../supabase/migrations/20260729203000_public_tracking_terminal_visibility.sql',
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
const uiPath = new URL('../js/ui.js', import.meta.url);
const mapViewPath = new URL('../js/map/map_view.js', import.meta.url);
const timelinePath = new URL('../js/core/order-timeline.js', import.meta.url);
const recoverySql = readFileSync(recoveryPath, 'utf8');
const handoffSql = readFileSync(handoffPath, 'utf8');
const privacySql = readFileSync(privacyPath, 'utf8');
const productionSql = readFileSync(productionPath, 'utf8');
const fixSql = existsSync(fixPath) ? readFileSync(fixPath, 'utf8') : '';
const repositorySource = readFileSync(repositoryPath, 'utf8');
const pollingSource = readFileSync(pollingPath, 'utf8');
const uiSource = readFileSync(uiPath, 'utf8');
const mapViewSource = readFileSync(mapViewPath, 'utf8');
const timelineSource = readFileSync(timelinePath, 'utf8');

function sqlFunction(source, name) {
  return source.match(
    new RegExp(`create or replace function public\\.${name}\\([^)]*\\)([\\s\\S]*?)\\$\\$;`, 'i'),
  )?.[0] || '';
}

function publicRead({ order, token, now }) {
  if (token.revokedAt || token.expiresAt <= now) return null;
  return { status: order.status };
}

test('reproduce el cierre P1: delivered revoca el token antes del siguiente poll', () => {
  assert.match(
    recoverySql,
    /update public\.order_public_tokens[\s\S]*set revoked_at = coalesce\(revoked_at, clock_timestamp\(\)\)/i,
  );
  assert.match(handoffSql, /opt\.revoked_at is null/i);

  const now = new Date('2026-07-29T18:00:00.000Z');
  const order = { status: 'arrived', gpsEnabled: true };
  const token = {
    revokedAt: null,
    expiresAt: new Date('2026-07-30T18:00:00.000Z'),
  };
  let browserTitle = 'Tu pedido llegó';

  assert.deepEqual(publicRead({ order, token, now }), { status: 'arrived' });
  order.status = 'delivered';
  order.gpsEnabled = false;
  token.revokedAt = now;

  assert.equal(order.gpsEnabled, false);
  const nextSnapshot = publicRead({ order, token, now });
  assert.equal(nextSnapshot, null);
  if (nextSnapshot?.status === 'delivered') browserTitle = 'Pedido entregado';
  assert.equal(browserTitle, 'Tu pedido llegó');
});

test('el contrato corregido exige una ventana terminal separada de revoked_at', () => {
  assert.notEqual(
    fixSql,
    '',
    'Falta la migración correctiva nueva; el snapshot actual todavía reproduce el P1.',
  );
  assert.match(
    fixSql,
    /add column if not exists terminal_visible_until timestamptz/i,
  );
  assert.match(
    fixSql,
    /v_terminal_window constant interval := interval '30 minutes'/i,
  );
  assert.match(
    fixSql,
    /new\.status in \('delivered', 'canceled', 'cancelled', 'rejected'\)[\s\S]*set terminal_visible_until/i,
  );
  assert.doesNotMatch(
    fixSql.match(
      /create or replace function public\.purge_terminal_order_rider_locations\(\)([\s\S]*?)\$\$;/i,
    )?.[1] || '',
    /set revoked_at/i,
  );
  assert.match(
    fixSql,
    /opt\.revoked_at is null[\s\S]*opt\.expires_at > clock_timestamp\(\)[\s\S]*terminal_visible_until > clock_timestamp\(\)/i,
  );
});

test('el trigger terminal purga inmediatamente el GPS exacto del pedido', () => {
  const trigger = sqlFunction(fixSql, 'purge_terminal_order_rider_locations');
  assert.match(trigger, /delete from public\.rider_locations[\s\S]*where order_id = new\.id/i);
  assert.match(trigger, /old\.status is distinct from new\.status/i);
});

test('el trigger terminal no convierte el cierre operativo en revocación de seguridad', () => {
  const trigger = sqlFunction(fixSql, 'purge_terminal_order_rider_locations');
  assert.doesNotMatch(trigger, /set\s+revoked_at/i);
  assert.match(trigger, /where order_id = new\.id[\s\S]*and revoked_at is null/i);
});

test('la ventana terminal queda acotada por la expiración general del token', () => {
  assert.match(
    fixSql,
    /set terminal_visible_until = least\(\s*expires_at,\s*clock_timestamp\(\) \+ v_terminal_window\s*\)/i,
  );
});

test('la lectura pública sigue ligada al hash y al mismo pedido', () => {
  const rpc = sqlFunction(fixSql, 'get_public_order_tracking');
  assert.match(rpc, /join public\.order_public_tokens opt on opt\.order_id = o\.id/i);
  assert.match(rpc, /opt\.token_hash = v_token_hash/i);
  assert.match(rpc, /o\.id::text = btrim\(p_public_id\) or o\.public_code = btrim\(p_public_id\)/i);
});

test('un token ausente o un identificador vacío devuelve cero datos', () => {
  const rpc = sqlFunction(fixSql, 'get_public_order_tracking');
  assert.match(
    rpc,
    /if v_token_hash is null or p_public_id is null or btrim\(p_public_id\) = '' then\s*return null/i,
  );
});

test('la revocación manual continúa siendo inmediata y prevalece sobre la ventana', () => {
  assert.match(
    privacySql,
    /function public\.revoke_public_tracking[\s\S]*set revoked_at = coalesce\(revoked_at, clock_timestamp\(\)\)/i,
  );
  assert.match(sqlFunction(fixSql, 'get_public_order_tracking'), /opt\.revoked_at is null/i);
});

test('un token terminal vencido queda fail-closed sin cron ni reactivación', () => {
  const rpc = sqlFunction(fixSql, 'get_public_order_tracking');
  assert.match(rpc, /opt\.terminal_visible_until > clock_timestamp\(\)/i);
  assert.doesNotMatch(fixSql, /\bcron\b|\bpg_cron\b/i);
  assert.doesNotMatch(fixSql, /set\s+revoked_at\s*=\s*null/i);
});

test('la expiración general continúa siendo obligatoria en estados activos y terminales', () => {
  assert.match(
    sqlFunction(fixSql, 'get_public_order_tracking'),
    /opt\.expires_at > clock_timestamp\(\)/i,
  );
});

test('delivered no devuelve mapa, ubicación ni código de entrega activo', () => {
  const rpc = sqlFunction(fixSql, 'get_public_order_tracking');
  assert.match(rpc, /v_order\.status in \('picked_up', 'on_the_way', 'arrived'\)/i);
  assert.match(rpc, /if v_order\.status = 'arrived' then/i);
  assert.doesNotMatch(
    rpc.match(/if v_order\.status = 'arrived' then([\s\S]*?)end if;/i)?.[1] || '',
    /delivered/i,
  );
});

test('arrived conserva el código únicamente antes de su confirmación', () => {
  const rpc = sqlFunction(fixSql, 'get_public_order_tracking');
  assert.match(rpc, /if v_order\.status = 'arrived'[\s\S]*h\.confirmed_at is null/i);
  assert.match(rpc, /h\.expires_at > clock_timestamp\(\)/i);
});

test('el DTO terminal es mínimo y no incorpora PII ni IDs administrativos', () => {
  const rpc = sqlFunction(fixSql, 'get_public_order_tracking');
  const dto = rpc.match(/return jsonb_strip_nulls\(jsonb_build_object\(([\s\S]*?)\)\);/i)?.[1] || '';
  assert.match(dto, /'public_code'[\s\S]*'status'[\s\S]*'delivered_at'/i);
  assert.doesNotMatch(
    dto,
    /customer_name|customer_phone|address|assigned_rider_user_id|business_id|rider_user_id|'id'/i,
  );
});

test('cancelación y rechazo conservan el mismo cierre público acotado ya soportado por producto', () => {
  const trigger = sqlFunction(fixSql, 'purge_terminal_order_rider_locations');
  const rpc = sqlFunction(fixSql, 'get_public_order_tracking');
  assert.match(trigger, /'canceled', 'cancelled', 'rejected'/i);
  assert.match(rpc, /'cancelled_at'[\s\S]*'rejected_at'/i);
});

test('el backfill nunca revive tokens ya revocados', () => {
  const backfill = fixSql.match(
    /update public\.order_public_tokens opt([\s\S]*?)and o\.status in \('delivered', 'canceled', 'cancelled', 'rejected'\);/i,
  )?.[0] || '';
  assert.match(backfill, /opt\.revoked_at is null/i);
  assert.match(backfill, /opt\.terminal_visible_until is null/i);
});

test('la función pública conserva search_path cerrado y permisos mínimos', () => {
  const rpc = sqlFunction(fixSql, 'get_public_order_tracking');
  assert.match(rpc, /security definer[\s\S]*set search_path = pg_catalog, public, extensions, pg_temp/i);
  assert.match(
    fixSql,
    /revoke all on function public\.get_public_order_tracking\(text\)[\s\S]*grant execute[\s\S]*to anon, authenticated/i,
  );
  assert.doesNotMatch(fixSql, /disable row level security|grant all/i);
});

test('GPS posterior y mutaciones posteriores a delivered siguen bloqueados por contratos existentes', () => {
  assert.match(
    handoffSql,
    /v_order\.status in \('delivered', 'canceled', 'cancelled', 'rejected'\)[\s\S]*raise exception/i,
  );
  assert.match(
    productionSql,
    /v_current_status not in \('delivered', 'cancelled', 'rejected'\)/i,
  );
});

test('el frontend conserva el handoff terminal para recargar dentro de la ventana', () => {
  const snapshotHandler = repositorySource.match(
    /onSnapshot: \(order\) => \{([\s\S]*?)\n\s*\},/i,
  )?.[1] || '';
  assert.doesNotMatch(snapshotHandler, /removeStoredAccess|lastOrderAccess = null/i);
  assert.match(repositorySource, /terminalVisibleUntil: selected\?\.terminalVisibleUntil/i);
  assert.match(repositorySource, /terminalVisibleUntil = normalizeOptionalIso\(dto\.terminal_visible_until\)/i);
  assert.match(repositorySource, /terminalVisibleUntil: tracking\.terminalVisibleUntil/i);
});

test('delivered reemplaza polling frecuente por un timer terminal desmontable', () => {
  assert.match(pollingSource, /if \(status === 'delivered'\) \{[\s\S]*startTerminalVisibility/i);
  assert.match(pollingSource, /function scheduleTerminalRevalidation\(\)/i);
  assert.match(pollingSource, /addEventListener\?\.\('online', onLifecycleResume\)/i);
  assert.match(pollingSource, /clearTimer\(\);[\s\S]*abortRequest\(\);[\s\S]*unbindLifecycle\(\)/i);
  assert.doesNotMatch(
    pollingSource.match(/function revalidateTerminal\(\) \{([\s\S]*?)\n  \}/i)?.[1] || '',
    /onTick\(/i,
  );
});

test('la pantalla final usa copy entregado, timeline de cuatro pasos y oculta el código', () => {
  assert.match(uiSource, /if \(order\.status === 'delivered'\)[\s\S]*title: 'Pedido entregado'/i);
  assert.match(
    timelineSource,
    /PUBLIC_ORDER_TIMELINE_STEPS[\s\S]*'Confirmado'[\s\S]*'Preparando'[\s\S]*'En camino'[\s\S]*'Entregado'/i,
  );
  assert.match(uiSource, /if \(!\['arrived', 'arriving'\]\.includes\(order\.status\)\) return ''/i);
});

/*
 * El mapa dejó de esconderse al terminar el pedido: «Seguir» es una sección de
 * mapa permanente y la pantalla final vuelve al mismo lienzo en su estado sin
 * pedido. Lo que este test protege es lo que SÍ tiene que desaparecer, que era
 * el motivo real del cierre P1: el rider. Un marcador que sobreviva al
 * `delivered` está afirmando un reparto que ya no existe.
 */
test('al terminar el pedido desaparece el rider, no el mapa', () => {
  const terminal = /const isTerminal = \['delivered', 'cancelled'\]\.includes\(order\.status\);/;
  assert.match(uiSource, terminal);
  assert.match(uiSource, /const riderOnMap = isDelivery\s*\n\s*&& !isTerminal/);
  // La capa de datos tampoco entrega una ubicación de rider en estado terminal,
  // así que el marcador no puede reaparecer por otro camino.
  assert.match(mapViewSource, /const TERMINAL_STATUSES = new Set\(\['delivered', 'cancelled'\]\);/);
  assert.match(
    mapViewSource,
    /const riderLocation = order && !TERMINAL_STATUSES\.has\(order\.status\)\s*\n\s*\? getRiderLocation/,
  );
  // Y si el marcador ya estaba dibujado cuando llega el estado final, se retira.
  assert.match(mapViewSource, /existing\.adapter\.clearRider\?\.\(\)/);
});
