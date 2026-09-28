// Cargar un instalador del equipo al bucket privado `team-apps` de CP.
//
//   npm run team-apps:status
//   npm run team-apps:publish -- --kind rider --file <apk> --expect-sha256 <sha> --receipt <receipt.json>          # prueba
//   npm run team-apps:publish -- --kind rider --file <apk> --expect-sha256 <sha> --receipt <receipt.json> --apply  # sube
//   npm run team-apps:publish -- --kind agent --file <msi> --expect-sha256 <sha> --version 0.1.0 --apply
//
// NO publica nada: el bucket es privado. Lo sube el operador con la clave de
// servicio a la carpeta del comercio (`<business_id>/<kind>/<archivo>`) y deja
// un `manifest.json` con versión, SHA-256 y si está firmado. Desde el Panel, el
// dueño o el encargado crean un link firmado y temporal para mandar.
//
// Se niega a subir un archivo que no es el certificado: el SHA-256 tiene que
// coincidir con el esperado y, para la app de repartidor, con el recibo del
// build firmado (paquete, versión y certificado de firma de CP).
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { REAL_BUSINESS_SLUG, connectControlledProduction, readOption, resolveBusiness } from './opening-tools.mjs';

export const BUCKET = 'team-apps';
export const RIDER_PACKAGE = 'com.lataba.rider.pilot';
export const RIDER_CERTIFICATE_SHA256 = '2dcc9b0a0cf022ebf59c500331103ee31cec9e9142d5431553131877948ec1aa';
const KINDS = Object.freeze({
  rider: { extension: '.apk', contentType: 'application/vnd.android.package-archive' },
  agent: { extension: '.msi', contentType: 'application/x-msi' },
});

export function parseTeamAppArgs(args = []) {
  const [first] = args;
  if (first === 'status') return { command: 'status', business: readOption(args, '--business', REAL_BUSINESS_SLUG) };
  const known = ['--kind', '--file', '--expect-sha256', '--receipt', '--version', '--apply', '--business'];
  const unknown = args.filter((arg) => arg.startsWith('--') && !known.includes(arg));
  if (unknown.length) throw Error(`Flag desconocido: ${unknown[0]}`);
  const kind = readOption(args, '--kind', '');
  if (!KINDS[kind]) throw Error('--kind es rider o agent.');
  const file = readOption(args, '--file', '');
  if (!file || path.extname(file).toLowerCase() !== KINDS[kind].extension) throw Error(`--file tiene que ser un ${KINDS[kind].extension}.`);
  const expected = readOption(args, '--expect-sha256', '').toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(expected)) throw Error('--expect-sha256 es el SHA-256 certificado del archivo.');
  const receipt = readOption(args, '--receipt', '');
  if (kind === 'rider' && !receipt) throw Error('La app de repartidor se sube con el recibo del build firmado (--receipt).');
  const version = readOption(args, '--version', '');
  if (kind === 'agent' && !/^[0-9]+\.[0-9]+\.[0-9]+([-+][0-9A-Za-z.-]+)?$/.test(version)) throw Error('--version del agente, por ejemplo 0.1.0.');
  return { command: 'publish', kind, file, expected, receipt, version, apply: args.includes('--apply'), business: readOption(args, '--business', REAL_BUSINESS_SLUG) };
}

/** Lo que va al manifiesto para un archivo ya verificado. */
export function manifestEntry({ kind, fileName, sha256, bytes, version, receipt = null, now = new Date().toISOString() }) {
  if (kind === 'rider') {
    return {
      file: fileName, version: receipt.versionName, version_code: receipt.versionCode, sha256, bytes,
      signed: true, certificate_sha256: receipt.certificateSha256, package: receipt.packageId, uploaded_at: now,
    };
  }
  return { file: fileName, version, sha256, bytes, signed: false, note: 'Instalador interno sin firma de código (Authenticode).', uploaded_at: now };
}

/** El recibo del build tiene que ser el de CP, del paquete y con el certificado de CP, y describir ESTE archivo. */
export function assertRiderReceipt(receipt, sha256) {
  assert.equal(receipt?.target, 'pilot', 'RECEIPT_TARGET_MUST_BE_PILOT');
  assert.equal(receipt?.backend, 'tkanbadcglszlcyfjvpv', 'RECEIPT_BACKEND_MUST_BE_CP');
  assert.equal(receipt?.packageId, RIDER_PACKAGE, 'RECEIPT_PACKAGE_MISMATCH');
  assert.equal(String(receipt?.certificateSha256 || '').toLowerCase(), RIDER_CERTIFICATE_SHA256, 'RECEIPT_CERTIFICATE_MISMATCH');
  assert.equal(String(receipt?.apkSha256 || '').toLowerCase(), sha256, 'RECEIPT_DOES_NOT_DESCRIBE_THIS_APK');
  return true;
}

async function main(args) {
  let options;
  try { options = parseTeamAppArgs(args); } catch (error) { console.error(`ERROR ${error.message}`); process.exitCode = 2; return; }
  const { admin } = await connectControlledProduction();
  const business = await resolveBusiness(admin, options.business);
  const storage = admin.storage.from(BUCKET);
  const manifestPath = `${business.id}/manifest.json`;
  const readManifest = async () => {
    const { data, error } = await storage.download(manifestPath);
    if (error || !data) return {};
    try { return JSON.parse(await data.text()); } catch (_) { return {}; }
  };

  if (options.command === 'status') {
    console.log(JSON.stringify({ business: business.slug, bucket: BUCKET, manifest: await readManifest() }, null, 2));
    return;
  }

  const bytes = readFileSync(options.file);
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  assert.equal(sha256, options.expected, 'FILE_SHA256_DOES_NOT_MATCH_THE_CERTIFIED_ONE');
  let receipt = null;
  if (options.kind === 'rider') {
    receipt = JSON.parse(readFileSync(options.receipt, 'utf8'));
    assertRiderReceipt(receipt, sha256);
  }
  const fileName = path.basename(options.file);
  const objectPath = `${business.id}/${options.kind}/${fileName}`;
  const entry = { ...manifestEntry({ kind: options.kind, fileName, sha256, bytes: statSync(options.file).size, version: options.version, receipt }), path: objectPath };
  console.log(JSON.stringify({ business: business.slug, upload: objectPath, entry, mode: options.apply ? 'apply' : 'dry-run' }, null, 2));
  if (!options.apply) { console.log('Prueba: no se subió nada. Para subir: --apply'); return; }

  const current = await readManifest();
  if (current?.[options.kind]?.sha256 === sha256) {
    console.log('Ese mismo archivo ya está cargado. No se cambió nada.');
    return;
  }
  const uploaded = await storage.upload(objectPath, bytes, { contentType: KINDS[options.kind].contentType, upsert: false });
  if (uploaded.error && !/exists|duplicate/i.test(String(uploaded.error.message || ''))) {
    throw Error(`UPLOAD_FAILED:${uploaded.error.statusCode || uploaded.error.message}`);
  }
  const manifest = { ...current, [options.kind]: entry, updated_at: new Date().toISOString() };
  const written = await storage.upload(manifestPath, Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`),
    { contentType: 'application/json', upsert: true });
  if (written.error) throw Error(`MANIFEST_FAILED:${written.error.statusCode || written.error.message}`);
  console.log(`Cargado: ${objectPath}. El dueño o el encargado crean el link desde el Panel.`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  main(process.argv.slice(2)).catch((error) => { console.error(`TEAM_APP_PUBLISH_FAILED: ${error.message}`); process.exitCode = 2; });
}
