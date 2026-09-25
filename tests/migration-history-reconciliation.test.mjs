import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const migrations = path.join(root, 'supabase', 'migrations');
const recovered = new Map([
  ['20260913011340_commerce_v3_product_draft_details.sql',
    'a0cf556b75964f3a4bc258816ed11590d628e5dce16c18ab24e2af6bdfcbf161'],
  ['20260918010000_merchant_availability_separate_from_stock.sql',
    '11cf34278f1667ede737b0898a3e36e3c30df1905b38900047f60729adce62b8'],
]);

test('el candidato contiene los dos artefactos ya aplicados remotamente, byte por byte', () => {
  for (const [name, expected] of recovered) {
    const actual = createHash('sha256').update(readFileSync(path.join(migrations, name))).digest('hex');
    assert.equal(actual, expected, name);
  }
});

test('cada versión es única y la migración candidata conserva el orden histórico', () => {
  const names = readdirSync(migrations).filter((name) => name.endsWith('.sql')).sort();
  const versions = names.map((name) => name.slice(0, 14));
  assert.equal(new Set(versions).size, versions.length, 'no hay versiones duplicadas');
  assert.ok(
    names.indexOf('20260913011340_commerce_v3_product_draft_details.sql')
      < names.indexOf('20260918010000_merchant_availability_separate_from_stock.sql'),
  );
  assert.ok(
    names.indexOf('20260918010000_merchant_availability_separate_from_stock.sql')
      < names.indexOf('20260919120000_business_self_delivery_and_finished_today.sql'),
  );
});
