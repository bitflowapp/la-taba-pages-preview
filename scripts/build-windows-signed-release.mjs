import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { writeSbom } from './create-sbom.mjs';
import { writeSignedReleaseConfig } from './prepare-tauri-signed-release-config.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function git(...args) {
  return execFileSync('git', args, { cwd: ROOT, encoding: 'utf8' }).trim();
}

function walk(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const absolute = path.join(directory, entry.name);
    return entry.isDirectory() ? walk(absolute) : [absolute];
  });
}

function sha256(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

function authenticode(filePath, expectedThumbprint) {
  const script = [
    '$signature = Get-AuthenticodeSignature -LiteralPath $args[0]',
    '$result = [pscustomobject]@{ Status = [string]$signature.Status; Thumbprint = [string]$signature.SignerCertificate.Thumbprint; Timestamped = $null -ne $signature.TimeStamperCertificate }',
    '$result | ConvertTo-Json -Compress',
  ].join('; ');
  const output = execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script, filePath], {
    cwd: ROOT, encoding: 'utf8', windowsHide: true,
  });
  const result = JSON.parse(output);
  if (result.Status !== 'Valid' || String(result.Thumbprint || '').toUpperCase() !== expectedThumbprint || result.Timestamped !== true) {
    throw new Error(`Authenticode verification failed for ${path.basename(filePath)}.`);
  }
  return { status: result.Status, thumbprint: result.Thumbprint, timestamped: true };
}

function run() {
  if (process.platform !== 'win32') throw new Error('Signed Windows release builds must run on Windows.');
  const branch = git('branch', '--show-current');
  const head = git('rev-parse', 'HEAD');
  if (!branch.startsWith('release/')) throw new Error('Signed release builds require a release/* branch.');
  if (git('status', '--porcelain')) throw new Error('Signed release builds require a clean Git worktree.');

  const requestedOutput = String(process.env.TABA_WINDOWS_RELEASE_OUTPUT || '').trim();
  const outputRoot = path.resolve(requestedOutput || path.join(ROOT, 'artifacts', 'windows-release', head));
  if (fs.existsSync(outputRoot)) throw new Error('Release output already exists; refusing to overwrite build evidence.');

  const configPath = path.join(outputRoot, 'tauri.signed.generated.json');
  writeSignedReleaseConfig(configPath);
  const cargoTarget = path.join(outputRoot, 'cargo-target');
  const commitEpoch = git('show', '-s', '--format=%ct', head);
  const environment = {
    ...process.env,
    CARGO_TARGET_DIR: cargoTarget,
    SOURCE_DATE_EPOCH: commitEpoch,
    TABA_BUILD_SHA: head,
    TABA_SIGNED_UPDATER_CONFIGURED: '1',
  };

  execFileSync(process.execPath, [path.join(ROOT, 'scripts', 'build-desktop-assets.mjs')], {
    cwd: ROOT, env: environment, stdio: 'inherit',
  });
  const tauriCli = path.join(ROOT, 'node_modules', '.bin', 'tauri.cmd');
  execFileSync(tauriCli, ['build', '--config', configPath], {
    cwd: ROOT, env: environment, stdio: 'inherit', windowsHide: true,
  });

  const releaseRoot = path.join(cargoTarget, 'release');
  const files = walk(releaseRoot);
  const appExecutable = files.find((file) => path.basename(file).toLowerCase() === 'taba-negocio.exe' && !file.includes(`${path.sep}bundle${path.sep}`));
  const msi = files.filter((file) => file.toLowerCase().endsWith('.msi'));
  const nsis = files.filter((file) => /-setup\.exe$/i.test(file));
  const updaterSignatures = files.filter((file) => file.toLowerCase().endsWith('.sig'));
  if (!appExecutable || msi.length !== 1 || nsis.length !== 1 || updaterSignatures.length < 2) {
    throw new Error('Signed build did not produce one app EXE, one MSI, one NSIS installer, and both updater signatures.');
  }

  const expectedThumbprint = String(process.env.TABA_WINDOWS_CERTIFICATE_THUMBPRINT).replaceAll(/\s/g, '').toUpperCase();
  const signedFiles = [appExecutable, ...msi, ...nsis];
  const signatures = new Map(signedFiles.map((file) => [file, authenticode(file, expectedThumbprint)]));
  const sbomPath = path.join(outputRoot, 'sbom.cdx.json');
  const sbom = writeSbom(sbomPath);
  const artifactFiles = [...signedFiles, ...updaterSignatures, sbomPath].sort();
  const artifacts = artifactFiles.map((file) => ({
    path: path.relative(outputRoot, file).replaceAll('\\', '/'),
    sizeBytes: fs.statSync(file).size,
    sha256: sha256(file),
    authenticode: signatures.get(file) || null,
  }));
  const manifest = {
    schemaVersion: 1,
    branch,
    head,
    sourceDateEpoch: Number(commitEpoch),
    buildOnce: true,
    signedUpdaterConfigured: true,
    productionDeployed: false,
    sbom: { path: path.relative(outputRoot, sbom.path).replaceAll('\\', '/'), components: sbom.components },
    artifacts,
  };
  fs.writeFileSync(path.join(outputRoot, 'RELEASE.json'), `${JSON.stringify(manifest, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' });
  fs.writeFileSync(
    path.join(outputRoot, 'SHA256SUMS'),
    `${artifacts.map((artifact) => `${artifact.sha256}  ${artifact.path}`).join('\n')}\n`,
    { encoding: 'utf8', flag: 'wx' },
  );
  console.log(`Signed Windows release built once for ${head}. No deployment was performed.`);
}

try { run(); } catch (error) {
  console.error(error instanceof Error ? error.message : 'Signed Windows release build failed.');
  process.exitCode = 1;
}
