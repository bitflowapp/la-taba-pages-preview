import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function encodePurl(value) {
  return encodeURIComponent(value).replaceAll('%2F', '/');
}

function npmComponents(lock) {
  const components = [];
  for (const [packagePath, metadata] of Object.entries(lock.packages || {})) {
    if (!packagePath || !metadata?.version || !packagePath.includes('node_modules/')) continue;
    const name = metadata.name || packagePath.slice(packagePath.lastIndexOf('node_modules/') + 13);
    const component = {
      type: 'library',
      name,
      version: String(metadata.version),
      'bom-ref': `pkg:npm/${encodePurl(name)}@${encodeURIComponent(String(metadata.version))}`,
      purl: `pkg:npm/${encodePurl(name)}@${encodeURIComponent(String(metadata.version))}`,
      properties: [{ name: 'taba:ecosystem', value: 'npm' }],
    };
    const integrity = String(metadata.integrity || '');
    const match = integrity.match(/^sha512-([A-Za-z0-9+/=]+)$/);
    if (match) component.hashes = [{ alg: 'SHA-512', content: Buffer.from(match[1], 'base64').toString('hex') }];
    components.push(component);
  }
  return components;
}

function cargoComponents(lockText) {
  return lockText.split(/^\[\[package\]\]\s*$/m).slice(1).flatMap((block) => {
    const name = block.match(/^name\s*=\s*"([^"]+)"/m)?.[1];
    const version = block.match(/^version\s*=\s*"([^"]+)"/m)?.[1];
    if (!name || !version) return [];
    const purl = `pkg:cargo/${encodeURIComponent(name)}@${encodeURIComponent(version)}`;
    const component = {
      type: 'library', name, version, 'bom-ref': purl, purl,
      properties: [{ name: 'taba:ecosystem', value: 'cargo' }],
    };
    const checksum = block.match(/^checksum\s*=\s*"([0-9a-f]{64})"/m)?.[1];
    if (checksum) component.hashes = [{ alg: 'SHA-256', content: checksum }];
    return [component];
  });
}

export function createSbom({ packageLockText, cargoLockText, gitHead, appVersion = '0.0.0' }) {
  const packageLock = JSON.parse(packageLockText);
  const sourceDigest = crypto.createHash('sha256')
    .update(packageLockText).update('\0').update(cargoLockText).update('\0').update(gitHead)
    .digest('hex');
  const uuid = `${sourceDigest.slice(0, 8)}-${sourceDigest.slice(8, 12)}-5${sourceDigest.slice(13, 16)}-a${sourceDigest.slice(17, 20)}-${sourceDigest.slice(20, 32)}`;
  const byReference = new Map();
  for (const component of [...npmComponents(packageLock), ...cargoComponents(cargoLockText)]) {
    byReference.set(component['bom-ref'], component);
  }
  return {
    bomFormat: 'CycloneDX',
    specVersion: '1.5',
    serialNumber: `urn:uuid:${uuid}`,
    version: 1,
    metadata: {
      component: {
        type: 'application',
        name: 'TABA2 production release candidate',
        version: appVersion,
        'bom-ref': `pkg:generic/taba2@${encodeURIComponent(appVersion)}?commit=${gitHead}`,
        properties: [{ name: 'taba:git-head', value: gitHead }],
      },
      tools: { components: [{ type: 'application', name: 'taba-sbom-generator', version: '1' }] },
    },
    components: [...byReference.values()].sort((left, right) => left['bom-ref'].localeCompare(right['bom-ref'])),
  };
}

export function writeSbom(outputPath, root = ROOT) {
  const head = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
  const packageJson = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  const sbom = createSbom({
    packageLockText: fs.readFileSync(path.join(root, 'package-lock.json'), 'utf8'),
    cargoLockText: fs.readFileSync(path.join(root, 'src-tauri', 'Cargo.lock'), 'utf8'),
    gitHead: head,
    appVersion: packageJson.version || JSON.parse(fs.readFileSync(path.join(root, 'src-tauri', 'tauri.conf.json'), 'utf8')).version,
  });
  const absolute = path.resolve(outputPath);
  fs.mkdirSync(path.dirname(absolute), { recursive: true });
  fs.writeFileSync(absolute, `${JSON.stringify(sbom, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' });
  return { path: absolute, components: sbom.components.length, serialNumber: sbom.serialNumber };
}

function run() {
  const index = process.argv.indexOf('--output');
  if (index < 0 || !process.argv[index + 1]) throw new Error('Usage: node scripts/create-sbom.mjs --output <sbom.cdx.json>');
  const result = writeSbom(process.argv[index + 1]);
  console.log(`CycloneDX SBOM created with ${result.components} components.`);
}

if (path.resolve(process.argv[1] || '') === fileURLToPath(import.meta.url)) {
  try { run(); } catch (error) {
    console.error(error instanceof Error ? error.message : 'SBOM generation failed.');
    process.exitCode = 1;
  }
}
