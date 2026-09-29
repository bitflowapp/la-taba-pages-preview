import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import sharp from 'sharp';
import { skuFromPhotoName } from '../js/business/business-photo-intake.js';

const root = path.resolve(import.meta.dirname, '..');
const FINAL_STATUSES = new Set(['APPROVED_REAL_IMAGE', 'READY_FOR_OWNER_APPROVAL', 'PHOTO_REQUIRED_FROM_STORE', 'RIGHTS_PERMISSION_REQUIRED', 'EXACT_PRODUCT_NOT_FOUND', 'PRODUCT_CONFIRMATION_REQUIRED']);

function parseCsv(text) {
  const rows = []; let row = []; let field = ''; let quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const c = text[i];
    if (quoted) { if (c === '"') { if (text[i + 1] === '"') { field += '"'; i += 1; } else quoted = false; } else field += c; }
    else if (c === '"') quoted = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
    else if (c !== '\r') field += c;
  }
  const [head, ...body] = rows;
  return body.filter((r) => r.length > 1).map((r) => Object.fromEntries(head.map((key, i) => [key, r[i]])));
}

const manifest = parseCsv(fs.readFileSync(path.join(root, 'catalog/real-catalog-images.csv'), 'utf8'));

test('real image manifest: one row per SKU, one exact status each, no ambiguous state', () => {
  assert.equal(manifest.length, 46);
  assert.equal(new Set(manifest.map((row) => row.sku)).size, 46, 'SKU duplicado');
  for (const row of manifest) {
    assert.ok(FINAL_STATUSES.has(row.final_status), `${row.sku}: ${row.final_status}`);
    for (const key of ['sku', 'product_name', 'gtin', 'source', 'source_url', 'license', 'rights_status', 'visual_status', 'local_source_path', 'staging_path', 'approved_path', 'associated', 'notes']) assert.ok(key in row, `columna ${key}`);
    assert.doesNotMatch(Object.values(row).join(' '), /[A-Za-z]:[\\]/, `${row.sku}: ruta local absoluta`);
    assert.doesNotMatch(row.final_status, /^(REVIEW|PENDING)$/);
  }
});

test('real image manifest: only an image with verified rights, exact identity and a visual pass is approved or associated', () => {
  for (const row of manifest) {
    const approved = row.final_status === 'APPROVED_REAL_IMAGE';
    assert.equal(row.associated === 'YES', approved, `${row.sku}: asociada sin estar aprobada (o al revés)`);
    if (approved) {
      assert.equal(row.rights_status, 'RIGHTS_VERIFIED');
      assert.equal(row.visual_status, 'PASS');
      assert.ok(row.license && row.source_url && row.approved_path, `${row.sku}: falta licencia, fuente o ruta aprobada`);
      if (/CC BY/i.test(row.license)) assert.equal(row.attribution_required, 'YES');
    } else {
      assert.equal(row.rights_status, 'UNVERIFIED', `${row.sku}: derechos sin verificar deben decir UNVERIFIED`);
      assert.equal(row.approved_path, '', `${row.sku}: ruta aprobada sin estar aprobada`);
      assert.ok(row.blocker.trim() && row.unblock_path.trim(), `${row.sku}: falta qué falta exactamente`);
    }
  }
  assert.equal(manifest.filter((row) => row.final_status === 'PRODUCT_CONFIRMATION_REQUIRED').every((row) => /^cepita-/.test(row.sku)), true);
});

test('shot list names every non-approved SKU exactly once with a filename the Panel bulk intake recognises', () => {
  const list = fs.readFileSync(path.join(root, 'catalog/photo-intake/PHOTO-SHOT-LIST.md'), 'utf8');
  const files = list.split('\n').filter((line) => line.startsWith('| ☐')).map((line) => /`([a-z0-9-]+\.jpg)`/.exec(line)?.[1]);
  const wanted = manifest.filter((row) => row.final_status !== 'APPROVED_REAL_IMAGE').map((row) => row.sku).sort();
  assert.deepEqual(files.map((file) => file.replace(/\.jpg$/, '')).filter((sku) => manifest.some((row) => row.sku === sku)).sort(), wanted);
  for (const row of manifest) assert.deepEqual(skuFromPhotoName(`${row.sku}.jpg`), { sku: row.sku, kind: 'front' });
  assert.match(list, /## Carnicería/);
});

test('local photo validator recognises <sku>.jpg for CP SKUs missing from products.json and rejects lookalikes', async () => {
  const intake = fs.mkdtempSync(path.join(os.tmpdir(), 'taba-real-photos-'));
  try {
    const good = await sharp({ create: { width: 1300, height: 1300, channels: 3, background: '#ffffff' } }).jpeg().toBuffer();
    fs.writeFileSync(path.join(intake, 'fernet-branca-750ml.jpg'), good);
    fs.writeFileSync(path.join(intake, 'coca-cola-original-2250ml-local__front.jpg'), good);
    fs.writeFileSync(path.join(intake, 'fernet-branca-750.jpg'), good);
    fs.writeFileSync(path.join(intake, 'foto 1.jpg'), good);
    const result = spawnSync(process.execPath, ['scripts/catalog-photos.mjs', 'validate'], { cwd: root, encoding: 'utf8', env: { ...process.env, TABA_CATALOG_PHOTO_INTAKE_DIR: intake } });
    assert.equal(result.status, 0, result.stderr || result.stdout);
    const report = JSON.parse(fs.readFileSync(path.join(intake, 'validation.json'), 'utf8'));
    assert.deepEqual(report.valid.map((row) => [row.sku, row.channel]).sort(), [['coca-cola-original-2250ml-local', 'panel'], ['fernet-branca-750ml', 'panel']]);
    assert.deepEqual(report.invalid.map((row) => row.file).sort(), ['fernet-branca-750.jpg', 'foto 1.jpg']);
  } finally {
    fs.rmSync(intake, { recursive: true, force: true });
  }
});
