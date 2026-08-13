import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source = readFileSync(
  new URL('../scripts/certify-real-order-pipeline.mjs', import.meta.url),
  'utf8',
);

test('la certificación integral queda fijada al staging exacto', () => {
  assert.match(source, /const STAGING_PROJECT_REF = 'ukxqbgswjlibmnjemrzd'/);
  assert.match(source, /SUPABASE_URL !== STAGING_URL/);
  assert.match(source, /TABA_CERTIFY_CONFIRM/);
});

test('la ausencia deliberada de fixtures QA no muta el catálogo para forzar el gate', () => {
  assert.match(source, /if \(!qaProduct\)/);
  assert.match(source, /sin fixture QA disponible; no se mutó el catálogo/);
  assert.doesNotMatch(source, /products'[\s\S]{0,120}update\(\{\s*available:/);
});

test('los actores operativos registran y cierran su sesión autoritativa', () => {
  assert.match(source, /client\.rpc\('identity_register_session'/);
  assert.match(source, /registration\?\.ok !== true/);
  assert.match(source, /!registration\?\.session_id/);
  assert.match(source, /client\.rpc\('identity_close_own_session'/);
  assert.match(source, /role === 'rider' \? 'rider_android' : 'panel_web'/);
});

test('el circuito certifica el recibo GPS y el DTO público, no sólo la ausencia de errores', () => {
  assert.match(source, /delivery_location_source: 'map_pin'/);
  assert.match(source, /delivery_location_confirmed_at: new Date\(\)\.toISOString\(\)/);
  assert.match(source, /client\.rpc\('publish_rider_location_receipt'/);
  assert.match(source, /gpsReceipt\?\.ok === true && gpsReceipt\?\.code === 'accepted'/);
  assert.match(source, /throttledReceipt\?\.ok === false && throttledReceipt\?\.code === 'throttled'/);
  assert.match(source, /location_quality === 'valid'/);
  assert.match(source, /terminal_visible_until/);
  assert.match(source, /!terminalTracking\?\.rider_location/);
});

test('la limpieza conserva auditoría, repone stock y sus errores hacen fallar el gate', () => {
  assert.match(source, /classify_order_as_qa/);
  assert.match(source, /apply_inventory_movement/);
  assert.match(source, /p_movement_type: 'manual_adjustment'/);
  assert.match(source, /failures \+= 1;\s*console\.error\(`limpieza:/);
});
