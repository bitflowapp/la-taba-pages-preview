import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

function required(environment, name) {
  const value = String(environment[name] || '').trim();
  if (!value) throw new Error(`${name} is required for a signed Windows release.`);
  return value;
}

function secureUrl(value, label, { allowTemplate = false } = {}) {
  const input = String(value || '').trim();
  if (!input.startsWith('https://')) throw new Error(`${label} must use HTTPS.`);
  const parseable = allowTemplate
    ? input.replaceAll('{{target}}', 'windows').replaceAll('{{arch}}', 'x86_64').replaceAll('{{current_version}}', '0.0.0')
    : input;
  let url;
  try { url = new URL(parseable); } catch { throw new Error(`${label} is not a valid URL.`); }
  const host = url.hostname.toLowerCase();
  const privateHost = host === 'localhost' || host === '::1' || host.endsWith('.local')
    || /^127\./.test(host) || /^10\./.test(host) || /^192\.168\./.test(host)
    || /^172\.(?:1[6-9]|2\d|3[01])\./.test(host);
  if (url.username || url.password || url.hash || privateHost) {
    throw new Error(`${label} must not contain credentials, fragments, or a private host.`);
  }
  return input;
}

function updaterPublicKey(value) {
  const key = String(value || '').trim();
  if (key.length < 40 || key.length > 4096 || /PRIVATE KEY/i.test(key) || key.includes('\0')) {
    throw new Error('TABA_UPDATER_PUBLIC_KEY is not a valid public updater key.');
  }
  return key;
}

function endpoints(value) {
  let parsed;
  try { parsed = JSON.parse(String(value || '')); } catch { throw new Error('TABA_UPDATER_ENDPOINTS_JSON must be a JSON array.'); }
  if (!Array.isArray(parsed) || parsed.length < 1 || parsed.length > 3) {
    throw new Error('TABA_UPDATER_ENDPOINTS_JSON must contain between one and three endpoints.');
  }
  return parsed.map((endpoint, index) => secureUrl(endpoint, `updater endpoint ${index + 1}`, { allowTemplate: true }));
}

export function createSignedReleaseConfig(environment = process.env) {
  required(environment, 'TAURI_SIGNING_PRIVATE_KEY');
  const publicKey = updaterPublicKey(required(environment, 'TABA_UPDATER_PUBLIC_KEY'));
  const updateEndpoints = endpoints(required(environment, 'TABA_UPDATER_ENDPOINTS_JSON'));
  const thumbprint = required(environment, 'TABA_WINDOWS_CERTIFICATE_THUMBPRINT').replaceAll(/\s/g, '').toUpperCase();
  if (!/^(?:[0-9A-F]{40}|[0-9A-F]{64})$/.test(thumbprint)) {
    throw new Error('TABA_WINDOWS_CERTIFICATE_THUMBPRINT must be a SHA-1 or SHA-256 thumbprint.');
  }
  const timestampUrl = secureUrl(
    required(environment, 'TABA_WINDOWS_TIMESTAMP_URL'),
    'TABA_WINDOWS_TIMESTAMP_URL',
  );
  return {
    bundle: {
      createUpdaterArtifacts: true,
      windows: {
        certificateThumbprint: thumbprint,
        digestAlgorithm: 'sha256',
        timestampUrl,
      },
    },
    plugins: {
      updater: {
        pubkey: publicKey,
        endpoints: updateEndpoints,
        windows: { installMode: 'passive' },
        dangerousInsecureTransportProtocol: false,
      },
    },
  };
}

export function writeSignedReleaseConfig(outputPath, environment = process.env) {
  const absolute = path.resolve(String(outputPath || ''));
  if (path.extname(absolute).toLowerCase() !== '.json') {
    throw new Error('Signed Tauri release config output must be a JSON file.');
  }
  const config = createSignedReleaseConfig(environment);
  fs.mkdirSync(path.dirname(absolute), { recursive: true });
  fs.writeFileSync(absolute, `${JSON.stringify(config, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' });
  return absolute;
}

function run() {
  const outputIndex = process.argv.indexOf('--output');
  if (outputIndex < 0 || !process.argv[outputIndex + 1]) {
    throw new Error('Usage: node scripts/prepare-tauri-signed-release-config.mjs --output <absolute.json>');
  }
  const output = writeSignedReleaseConfig(process.argv[outputIndex + 1]);
  console.log(`Signed Tauri release configuration created at ${output}`);
}

if (path.resolve(process.argv[1] || '') === fileURLToPath(import.meta.url)) {
  try { run(); } catch (error) {
    console.error(error instanceof Error ? error.message : 'Signed release configuration failed.');
    process.exitCode = 1;
  }
}
