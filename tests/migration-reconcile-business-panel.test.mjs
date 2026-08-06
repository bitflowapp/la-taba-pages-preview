import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const migrationsDir = path.join(root, 'supabase', 'migrations');

const PANEL = '20260804090000_business_operations_panel.sql';
const RECONCILE = '20260804093000_reconcile_business_operations_panel_version_collision.sql';
// 20260805120000 usa fiscal_profiles.homologation_authorized_at/_by, columnas que
// crea el Panel. Con el Panel salteado en staging, esa migración aborta el push
// entero. Por eso la reconciliación tiene que ir ANTES que ella, no al final.
const DEPENDS_ON_PANEL = '20260805120000';
const OCCUPIED_IN_STAGING = '20260804090000';

const readMigration = (name) => fs.readFileSync(path.join(migrationsDir, name), 'utf8');

test('la reconciliación usa una versión libre y ordenada antes de quien depende del Panel', () => {
  const versions = fs.readdirSync(migrationsDir)
    .filter((f) => f.endsWith('.sql'))
    .map((f) => f.slice(0, 14));

  const mine = RECONCILE.slice(0, 14);
  assert.equal(versions.filter((v) => v === mine).length, 1, 'la versión de reconciliación no puede estar duplicada');

  assert.ok(mine > OCCUPIED_IN_STAGING, 'debe ser posterior a la versión ocupada en staging');
  assert.ok(mine < DEPENDS_ON_PANEL, `debe correr antes de ${DEPENDS_ON_PANEL}, que usa columnas del Panel`);

  // La versión ocupada en staging por la migración sólo-remota sigue existiendo
  // como archivo local, intacta: no se renombra ni se reutiliza.
  assert.ok(versions.includes(OCCUPIED_IN_STAGING), 'no se debe borrar ni renumerar la migración del Panel');
});

test('20260805120000 realmente depende de columnas que aporta el Panel', () => {
  // Si esto dejara de ser cierto, la reconciliación podría ir al final y este
  // test debe fallar para que alguien revise la decisión de versión.
  const dependent = readMigration('20260805120000_fiscal_homologation_authorization_split.sql');
  assert.match(dependent, /homologation_authorized_at/, 'se esperaba el uso de la columna del Panel');

  const panel = readMigration(PANEL);
  assert.match(panel, /add column if not exists homologation_authorized_at/, 'el Panel debe ser quien crea la columna');
});

test('el cuerpo del Panel dentro de la reconciliación es idéntico al original', () => {
  const panel = readMigration(PANEL);
  const reconcile = readMigration(RECONCILE);

  const begin = '-- ===== BEGIN PANEL CONTRACT';
  const end = '-- ===== END PANEL CONTRACT';
  const beginAt = reconcile.indexOf(begin);
  const endAt = reconcile.indexOf(end);
  assert.ok(beginAt !== -1, 'falta el marcador BEGIN PANEL CONTRACT');
  assert.ok(endAt !== -1, 'falta el marcador END PANEL CONTRACT');

  // El cuerpo arranca después de la línea del marcador BEGIN y de su bloque de
  // comentario, y termina justo antes del marcador END.
  const afterBeginLine = reconcile.indexOf('\n', beginAt) + 1;
  const commentBlockEnd = reconcile.indexOf('\n\n', afterBeginLine) + 2;
  const embedded = reconcile.slice(commentBlockEnd, endAt);

  assert.equal(
    embedded.trimEnd(),
    panel.trimEnd(),
    'el contrato embebido divergió del original: actualizá ambos archivos juntos',
  );
});

test('la reconciliación no muta la migración sólo-remota del rider map', () => {
  const reconcile = readMigration(RECONCILE).toLowerCase();

  // Puede LEER el trigger y el esquema private para probar que quedaron intactos,
  // pero nunca escribirlos.
  const forbidden = [
    /drop\s+trigger[^;]*rider_map_capture_order_location/,
    /create\s+trigger\s+rider_map_capture_order_location/,
    /drop\s+schema\s+(if\s+exists\s+)?private/,
    /drop\s+table[^;]*private\./,
    /drop\s+function[^;]*private\./,
    /alter\s+table\s+(if\s+exists\s+)?private\./,
    /create\s+(or\s+replace\s+)?function\s+private\./,
    /create\s+table[^;]*private\.rider_map/,
    /truncate[^;]*private\./,
    /(insert\s+into|update|delete\s+from)\s+private\./,
  ];

  for (const pattern of forbidden) {
    assert.ok(!pattern.test(reconcile), `la reconciliación no debe tocar la migración remota: ${pattern}`);
  }

  // Y debe verificar explícitamente que sigue ahí.
  assert.ok(
    reconcile.includes('rider_map_trigger_definition_changed'),
    'debe aserverar que la definición del trigger remoto no cambió',
  );
  assert.ok(
    reconcile.includes('rider_map_private_schema_changed'),
    'debe aserverar que el esquema private no cambió',
  );
});

test('la reconciliación detecta el estado antes de mutar y clasifica el parcial', () => {
  const reconcile = readMigration(RECONCILE);

  const preflightAt = reconcile.indexOf('$taba_reconcile_preflight$');
  const contractAt = reconcile.indexOf('-- ===== BEGIN PANEL CONTRACT');
  assert.ok(preflightAt !== -1, 'falta el bloque de preflight');
  assert.ok(preflightAt < contractAt, 'la detección de estado debe ocurrir antes del DDL');

  assert.ok(
    reconcile.includes('BUSINESS_PANEL_PARTIAL_SCHEMA_DETECTED'),
    'el estado parcial debe abortar con la clasificación exigida',
  );
  assert.ok(
    reconcile.includes('BUSINESS_PANEL_MISSING_DEPENDENCIES'),
    'una dependencia ausente debe abortar con su nombre técnico',
  );
  assert.ok(
    reconcile.includes('BUSINESS_PANEL_RECONCILE_INCOMPLETE'),
    'debe verificar la postcondición del contrato completo',
  );
});

test('la reconciliación no altera datos ni debilita RLS', () => {
  const reconcile = readMigration(RECONCILE);

  // Todo DML del Panel vive dentro de cuerpos de función; a nivel de migración
  // no debe haber ninguno. Se descartan comentarios antes de analizar.
  const withoutComments = reconcile
    .split('\n')
    .filter((line) => !line.trimStart().startsWith('--'))
    .join('\n');

  // El cuerpo de las funciones sí contiene DML: se acota el análisis al DDL de
  // primer nivel quitando los bloques dollar-quoted.
  const topLevel = withoutComments.replace(/\$([a-z_]*)\$[\s\S]*?\$\1\$/g, '<<BLOQUE>>');

  assert.ok(!/\binsert\s+into\b/i.test(topLevel), 'no debe insertar datos a nivel de migración');
  assert.ok(!/\bdelete\s+from\b/i.test(topLevel), 'no debe borrar datos a nivel de migración');
  assert.ok(!/\bupdate\s+public\./i.test(topLevel), 'no debe actualizar datos a nivel de migración');
  assert.ok(!/\bdrop\s+table\b/i.test(topLevel), 'no debe borrar tablas');
  assert.ok(!/disable\s+row\s+level\s+security/i.test(reconcile), 'no debe debilitar RLS');
});
