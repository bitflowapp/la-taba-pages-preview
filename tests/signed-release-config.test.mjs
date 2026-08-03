import assert from 'node:assert/strict';
import test from 'node:test';

import { createSignedReleaseConfig } from '../scripts/prepare-tauri-signed-release-config.mjs';

const syntheticEnvironment = Object.freeze({
  TAURI_SIGNING_PRIVATE_KEY: 'synthetic-private-key-present-only-in-test-process',
  TABA_UPDATER_PUBLIC_KEY: `untrusted comment: synthetic updater public key\n${'A'.repeat(64)}`,
  TABA_UPDATER_ENDPOINTS_JSON: '["https://updates.example.test/{{target}}/{{arch}}/{{current_version}}"]',
  TABA_WINDOWS_CERTIFICATE_THUMBPRINT: 'AB'.repeat(20),
  TABA_WINDOWS_TIMESTAMP_URL: 'https://timestamp.example.test/',
});

test('perfil firmado exige updater, HTTPS y firma de código Windows', () => {
  const config = createSignedReleaseConfig(syntheticEnvironment);
  assert.equal(config.bundle.createUpdaterArtifacts, true);
  assert.equal(config.bundle.windows.digestAlgorithm, 'sha256');
  assert.equal(config.plugins.updater.dangerousInsecureTransportProtocol, false);
  assert.equal(config.plugins.updater.windows.installMode, 'passive');
  assert.match(config.plugins.updater.endpoints[0], /^https:\/\//);
  assert.doesNotMatch(JSON.stringify(config), /synthetic-private-key-present-only-in-test-process/);
});

test('perfil firmado falla cerrado sin clave privada o con endpoint inseguro', () => {
  assert.throws(
    () => createSignedReleaseConfig({ ...syntheticEnvironment, TAURI_SIGNING_PRIVATE_KEY: '' }),
    /TAURI_SIGNING_PRIVATE_KEY/,
  );
  assert.throws(
    () => createSignedReleaseConfig({ ...syntheticEnvironment, TABA_UPDATER_ENDPOINTS_JSON: '["http://updates.example.test/latest.json"]' }),
    /HTTPS/,
  );
  assert.throws(
    () => createSignedReleaseConfig({ ...syntheticEnvironment, TABA_WINDOWS_CERTIFICATE_THUMBPRINT: 'not-a-thumbprint' }),
    /thumbprint/,
  );
});
