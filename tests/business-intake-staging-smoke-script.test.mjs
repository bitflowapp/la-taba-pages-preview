import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  EXPECTED_STAGING_REF,
  REQUIRED_CONFIRMATION,
  hydrateBusinessIntakeStagingPublicEnvironment,
  validateBusinessIntakeStagingSmokeEnvironment,
} from '../scripts/run-business-intake-staging-smoke.mjs';

const validEnvironment = {
  TABA_SMOKE_CONFIRM: REQUIRED_CONFIRMATION,
  SUPABASE_URL: `https://${EXPECTED_STAGING_REF}.supabase.co`,
  SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_12345678',
  SUPABASE_BUSINESS_ID: '11111111-1111-4111-8111-111111111111',
  SUPABASE_STAFF_EMAIL: 'staff@example.test',
  SUPABASE_STAFF_PASSWORD: 'not-a-real-password',
};

test('el smoke de intake queda fijado al project ref de staging y exige confirmación', () => {
  assert.equal(validateBusinessIntakeStagingSmokeEnvironment(validEnvironment).ok, true);

  const wrongProject = validateBusinessIntakeStagingSmokeEnvironment({
    ...validEnvironment,
    SUPABASE_URL: 'https://production-project.supabase.co',
  });
  assert.equal(wrongProject.ok, false);
  assert.match(wrongProject.errors.join(' '), /exactamente/i);

  const noConfirmation = validateBusinessIntakeStagingSmokeEnvironment({
    ...validEnvironment,
    TABA_SMOKE_CONFIRM: '',
  });
  assert.equal(noConfirmation.ok, false);
  assert.match(noConfirmation.errors.join(' '), /TABA_SMOKE_CONFIRM/);
});

test('el guard rechaza secretos privilegiados y credenciales de staff ausentes', () => {
  const privileged = validateBusinessIntakeStagingSmokeEnvironment({
    ...validEnvironment,
    SUPABASE_PUBLISHABLE_KEY: 'sb_secret_123456789',
  });
  assert.equal(privileged.ok, false);
  assert.match(privileged.errors.join(' '), /service_role|sb_secret_/i);

  const noPublicKey = validateBusinessIntakeStagingSmokeEnvironment({
    ...validEnvironment,
    SUPABASE_PUBLISHABLE_KEY: '',
  });
  assert.equal(noPublicKey.ok, false);
  assert.equal(noPublicKey.hasPublicKey, false);

  const noStaff = validateBusinessIntakeStagingSmokeEnvironment({
    ...validEnvironment,
    SUPABASE_STAFF_PASSWORD: '',
  });
  assert.equal(noStaff.ok, false);
  assert.equal(noStaff.hasStaffCredentials, false);
});

test('el runner completa sólo la configuración pública desde el runtime staging', () => {
  const hydrated = hydrateBusinessIntakeStagingPublicEnvironment({
    TABA_SMOKE_CONFIRM: REQUIRED_CONFIRMATION,
    SUPABASE_STAFF_EMAIL: 'staff@example.test',
    SUPABASE_STAFF_PASSWORD: 'memory-only',
  }, `
    globalThis.__LA_TABA_RUNTIME_CONFIG__ = {
      repository: {
        supabaseUrl: 'https://${EXPECTED_STAGING_REF}.supabase.co',
        publishableKey: 'sb_publishable_12345678',
        businessId: '11111111-1111-4111-8111-111111111111',
      },
    };
  `);
  assert.equal(hydrated.SUPABASE_URL, `https://${EXPECTED_STAGING_REF}.supabase.co`);
  assert.equal(hydrated.SUPABASE_PUBLISHABLE_KEY, 'sb_publishable_12345678');
  assert.equal(hydrated.SUPABASE_BUSINESS_ID, '11111111-1111-4111-8111-111111111111');
  assert.equal(hydrated.SUPABASE_STAFF_EMAIL, 'staff@example.test');
  assert.equal(hydrated.SUPABASE_STAFF_PASSWORD, 'memory-only');
});

test('el spec real conserva IDs propios, limpia en finally y no captura el panel completo', () => {
  const source = readFileSync(
    new URL('./staging/business-intake-staging.spec.mjs', import.meta.url),
    'utf8',
  );
  assert.match(source, /createdOrders\.push/);
  assert.match(source, /finally\s*{/);
  assert.match(source, /transition_order/);
  assert.match(source, /assertSyntheticOrdersGone/);
  assert.match(source, /locator\([^\n]+\)\.screenshot/);
  assert.doesNotMatch(source, /page\.screenshot/);
  assert.doesNotMatch(source, /service_role|sb_secret_/i);

  const config = readFileSync(
    new URL('../playwright.staging.config.mjs', import.meta.url),
    'utf8',
  );
  assert.match(config, /trace:\s*'off'/);
  assert.doesNotMatch(config, /retain-on-failure|trace:\s*'on'/);

  const runner = readFileSync(
    new URL('../scripts/run-business-intake-staging-smoke.mjs', import.meta.url),
    'utf8',
  );
  assert.match(runner, /mkdtempSync/);
  assert.match(runner, /TABA_STAGING_SMOKE_OUTPUT_DIR/);
  assert.match(runner, /rmSync\(temporaryOutput, \{ recursive: true, force: true \}\)/);
});
