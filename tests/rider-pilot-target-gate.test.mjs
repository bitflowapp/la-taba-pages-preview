import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

const builder = 'scripts/e2e-staging/build-rider-pilot.mjs';
const run = (...args) => spawnSync(process.execPath, [builder, ...args], {
  encoding: 'utf8', windowsHide: true, timeout: 10_000,
});

test('PILOT Rider refuses Production and Staging project refs before secrets or Gradle', () => {
  for (const ref of ['wwcpogltfgzgkrlilbcd', 'ucbtjcurawxjwjdvvcvj']) {
    const result = run('--target', 'pilot', '--project-ref', ref,
      '--version-code', '4', '--version-name', '0.1.3-canonical');
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /PILOT_BACKEND_REF_REQUIRED_AND_MUST_BE_ISOLATED/);
  }
});

test('signed Rider build has no implicit target', () => {
  const result = run('--version-code', '4', '--version-name', '0.1.3-canonical');
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /RIDER_TARGET_REQUIRED/);
});

test('signed PILOT requires a version above the Staging QA v3', () => {
  const result = run('--target', 'pilot', '--project-ref', 'abcdefghijklmnopqrst',
    '--version-code', '3', '--version-name', '0.1.2-canonical');
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /PILOT_VERSION_MUST_UPGRADE_STAGING_V3/);
});

test('compiled Rider checks its backend ref and displays its target mode', () => {
  const gradle = readFileSync('apps/rider-android/app/build.gradle.kts', 'utf8');
  const api = readFileSync('apps/rider-android/app/src/main/java/com/lataba/rider/RiderApi.kt', 'utf8');
  const activity = readFileSync('apps/rider-android/app/src/main/java/com/lataba/rider/MainActivity.kt', 'utf8');
  assert.match(gradle, /backendRef != productionRef/);
  assert.match(gradle, /Staging and PILOT Rider builds require distinct backends/);
  assert.match(gradle, /PILOT Rider requires an explicit publishable key/);
  assert.match(api, /BuildConfig\.BACKEND_REF != "wwcpogltfgzgkrlilbcd"/);
  assert.match(activity, /BuildConfig\.TARGET_MODE\.uppercase\(\)/);
});
