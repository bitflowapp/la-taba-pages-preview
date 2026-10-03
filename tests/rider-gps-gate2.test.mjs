import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

import {
  canShareProductionRiderGps,
  createProductionRiderGpsController,
} from '../js/tracking/production_rider_gps.js';

const migration = fs.readFileSync(new URL(
  '../supabase/migrations/20260801040000_rider_gps_tracking_gate2.sql',
  import.meta.url,
), 'utf8');

function functionSql(name) {
  const start = migration.search(new RegExp(
    `create (?:or replace )?function public\\.${name}\\b`,
    'i',
  ));
  assert.notEqual(start, -1, `No se encontró ${name}`);
  const tail = migration.slice(start);
  const end = tail.search(/\n\$\$;/);
  assert.notEqual(end, -1, `No se encontró el cierre de ${name}`);
  return tail.slice(0, end + 4);
}

test('Gate 2 reemplaza el claim legacy por una RPC con revision y no-op', () => {
  const claim = functionSql('claim_available_rider_order');
  assert.match(migration, /drop function if exists public\.claim_available_rider_order\(uuid, text, text, uuid\)/i);
  assert.match(claim, /auth\.uid\(\)/i);
  assert.match(claim, /bm\.role = 'rider'/i);
  assert.match(claim, /from public\.orders o[\s\S]*for update/i);
  assert.match(claim, /v_order\.revision <> p_expected_revision/i);
  assert.match(claim, /assigned_rider_user_id = v_user_id/i);
  assert.match(claim, /where id = v_order\.id[\s\S]*revision = p_expected_revision/i);
  assert.match(claim, /idempotent_no_op/i);
  assert.match(claim, /order\.rider_claimed/i);
});

test('el inicio de entrega exige actor, asignacion, estado y delega el CAS de Gate 1', () => {
  const start = functionSql('start_rider_delivery');
  assert.match(start, /bm\.role = 'rider'/i);
  assert.match(start, /assigned_rider_user_id is distinct from v_user_id/i);
  assert.match(start, /v_order\.status not in \('assigned', 'picked_up'\)/i);
  assert.match(start, /v_order\.revision <> p_expected_revision/i);
  assert.match(start, /public\.transition_order\(/i);
  assert.match(start, /status = 'on_the_way'/i);
});

test('las muestras GPS tienen orden total, revision de pedido y reloj de servidor', () => {
  const gps = functionSql('publish_rider_location');
  assert.match(migration, /create sequence if not exists public\.rider_locations_sequence_seq/i);
  assert.match(migration, /alter column sequence set not null/i);
  assert.match(migration, /create unique index if not exists rider_locations_sequence_key/i);
  assert.match(migration, /alter column recorded_at set not null/i);
  assert.match(migration, /new\.recorded_at := clock_timestamp\(\)/i);
  assert.match(gps, /p_expected_revision/i);
  assert.match(gps, /v_order\.revision <> p_expected_revision/i);
  assert.match(gps, /p_captured_at > v_now \+ interval '30 seconds'/i);
  assert.match(gps, /p_captured_at < v_now - interval '3 minutes'/i);
  assert.match(gps, /recorded_at > v_now - interval '5 seconds'/i);
  assert.match(gps, /p_lat < -90|p_lng > 180/i);
  assert.match(gps, /source = 'gps'/i);
});

test('el DTO público sólo devuelve el último fix por sequence y no historia', () => {
  const tracking = functionSql('get_public_order_tracking');
  assert.match(tracking, /rl\.rider_user_id = v_order\.assigned_rider_user_id/i);
  assert.match(tracking, /order by rl\.sequence desc/i);
  assert.match(tracking, /rl\.recorded_at >= clock_timestamp\(\) - interval '3 minutes'/i);
  assert.match(tracking, /'sequence', rl\.sequence/i);
  assert.doesNotMatch(tracking, /jsonb_agg\(to_jsonb\(rl\)/i);
  const dto = tracking.match(/return jsonb_strip_nulls\(jsonb_build_object\([\s\S]*$/i)?.[0] || '';
  assert.doesNotMatch(dto, /assigned_rider_user_id/i);
});

test('RLS elimina lectura y escritura directa de rider_locations', () => {
  assert.match(migration, /drop policy if exists "tracking rider locations readable by operators"/i);
  assert.match(migration, /revoke all privileges on table public\.rider_locations from public, anon, authenticated/i);
  assert.match(migration, /revoke all on function public\.publish_rider_location\([\s\S]*timestamptz\s*\)/i);
  assert.match(migration, /grant execute on function public\.publish_rider_location\([\s\S]*timestamptz\s*\)[\s\S]*to authenticated/i);
});

test('el cliente productivo transporta revision y timestamp declarado sólo para validacion', () => {
  const repository = fs.readFileSync(new URL(
    '../js/repositories/supabase_order_repository.js',
    import.meta.url,
  ), 'utf8');
  assert.match(repository, /p_expected_revision/);
  assert.match(repository, /p_captured_at/);
  assert.match(repository, /recorded_at \|\| data\?\.created_at/);
  assert.match(repository, /rpcName = 'start_rider_delivery'/);
});

test('el watcher de rider se recupera en foreground después de pagehide', () => {
  const RIDER_ID = 'rider-gate2';
  const order = {
    id: 'LT-GATE2-RESUME',
    deliveryMode: 'delivery',
    assignedRiderId: RIDER_ID,
    workflowStatus: 'on_the_way',
  };
  let watches = 0;
  const cleared = [];
  const controller = createProductionRiderGpsController({
    getAccess: () => ({ user: { id: RIDER_ID }, membership: { role: 'rider' } }),
    getOrder: () => order,
    navigatorRef: {
      geolocation: {
        watchPosition() { watches += 1; return watches; },
        clearWatch(id) { cleared.push(id); },
      },
    },
  });
  assert.equal(canShareProductionRiderGps({ order, userId: RIDER_ID, role: 'rider' }), true);
  assert.equal(controller.start(order.id).ok, true);
  assert.equal(controller.pause(), true);
  assert.equal(controller.getSnapshot().state, 'paused');
  assert.equal(controller.resume(), true);
  assert.equal(watches, 2);
  assert.deepEqual(cleared, [1]);
});
