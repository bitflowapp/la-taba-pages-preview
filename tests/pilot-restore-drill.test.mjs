import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const script = fs.readFileSync(new URL('../scripts/pilot-ops-restore-drill.mjs', import.meta.url), 'utf8');
const fixture = fs.readFileSync(new URL('../scripts/sql/pilot-ops-synthetic-fixture.sql', import.meta.url), 'utf8');
const assertions = fs.readFileSync(new URL('../scripts/sql/pilot-ops-contract-assertions.sql', import.meta.url), 'utf8');

test('el simulacro exige confirmación explícita y se niega a correr contra algo hospedado', () => {
  assert.match(script, /I_UNDERSTAND_THIS_IS_LOCAL_ONLY/);
  assert.match(script, /supabase\\\.\(co\|com\)/);
  for (const name of ['SUPABASE_URL', 'SUPABASE_DB_URL', 'DATABASE_URL']) {
    assert.ok(script.includes(`'${name}'`), `falta el guard de ${name}`);
  }
  assert.match(script, /El simulacro es local-only/);
});

test('el simulacro prueba la reconstrucción desde cero y aborta al primer corte', () => {
  assert.match(script, /replayMigrations/);
  assert.match(script, /La cadena de migraciones no es replayable: cortó en/);
  assert.match(script, /rebuildFromMigrations/);
});

test('la restauración va a un clúster nuevo, no a otra base del mismo', () => {
  // Restaurar al lado del original no prueba nada sobre recuperar un proyecto:
  // comparte extensiones, roles y configuración de clúster.
  assert.match(script, /const TARGET = `\$\{PREFIX\}-target`/);
  assert.match(script, /boot\(TARGET\)/);
  assert.match(script, /replayMigrations\(TARGET\)/);
});

test('el backup se hashea y la restauración compara filas y contenido', () => {
  assert.match(script, /pg_dump[\s\S]{0,200}--format=custom/);
  assert.match(script, /createHash\('sha256'\)\.update\(dump\)/);
  assert.match(script, /pg_restore[\s\S]{0,200}--exit-on-error/);
  assert.match(script, /--single-transaction/);
  assert.match(script, /La base restaurada no tiene la misma cantidad de filas por tabla/);
  assert.match(script, /El contenido operativo restaurado no coincide con el original/);
});

test('el contrato operativo se verifica antes del backup y sobre el proyecto recuperado', () => {
  assert.match(script, /contractBeforeBackup/);
  assert.match(script, /contractAfterRestore/);
  const calls = script.match(/psql\((SOURCE|TARGET), assertionsSql\)/g) || [];
  assert.equal(calls.length, 2, 'las aserciones tienen que correr en los dos lados');
});

test('el simulacro deja evidencia y declara que no tocó datos reales', () => {
  assert.match(script, /productionDataUsed: false/);
  assert.match(script, /stagingTouched: false/);
  assert.match(script, /artifacts', 'pilot-ops-restore-drill\.json/);
  assert.match(script, /process\.exitCode = 1/);
});

test('los contenedores efímeros se borran salvo pedido explícito de conservarlos', () => {
  assert.match(script, /finally \{\s*\n\s*if \(String\(process\.env\.TABA_PILOT_DRILL_KEEP \|\| ''\) !== '1'\) cleanup\(\);/);
  assert.match(script, /for \(const container of \[SOURCE, TARGET\]\)/);
});

test('el fixture es sintético declarado: sin datos humanos ni dominios resolubles', () => {
  assert.match(fixture, /Cero datos humanos/);
  assert.match(fixture, /fixture\.invalid/);
  // RFC 2606: `.invalid` no resuelve nunca, así que ningún correo del fixture
  // puede alcanzar a una persona por accidente.
  assert.doesNotMatch(fixture, /@(gmail|hotmail|outlook|yahoo|icloud)\./i);
  assert.doesNotMatch(fixture, /\+54\s?9?\s?11/);
});

test('el fixture publica productos por la puerta legítima del catálogo', () => {
  // Saltearse los invariantes de publicación haría que el drill certifique una
  // superficie que en producción no existiría.
  assert.match(fixture, /catalog_image_identity_sha256/);
  assert.match(fixture, /catalog_asset_binding_sha256/);
  assert.match(fixture, /is_verified/);
});

test('las aserciones cubren dinero, excepciones, colas, stock, salud, traza y reporte', () => {
  for (const key of [
    'today.revenue_booked', 'today.ticket_average', 'today.qa_orders_excluded',
    'payments.approved_without_order.count', 'payments.amount_mismatch.count',
    'attention.unaccepted_orders.count', 'attention.ready_without_rider.count',
    'queues.payments.dead_letter', 'stock.expired_reservations.count',
    'servicios medidos', 'trace.o4.break', 'report.hoy.muestra', 'report.ayer.best_seller',
  ]) assert.ok(assertions.includes(`'${key}'`), `falta la aserción ${key}`);
});

test('las aserciones prohíben explícitamente lo que no puede pasar', () => {
  assert.match(assertions, /una alerta abierta apunta a un sujeto QA/);
  assert.match(assertions, /un servicio se declaró sano sin evidencia/);
  assert.match(assertions, /la traza filtró el nombre del cliente/);
  assert.match(assertions, /se declaró un más vendido con muestra insuficiente/);
  assert.match(assertions, /repetir el reconocimiento reatribuyó actor u hora/);
});
