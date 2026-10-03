import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { MARKER, excludedPatterns, wrapBody } from '../scripts/db/wrap-api-boundary.mjs';
import { REFUSAL_STATUS } from '../scripts/e2e-staging/ecommerce/http.mjs';

const read = (relative) => readFileSync(new URL(relative, import.meta.url), 'utf8');
const contract = JSON.parse(read('../docs/ecommerce-hardening/http-contract.json'));
const PGTAP = read('../supabase/tests/http_error_contract_test.sql');
const MIGRATION = read('../supabase/migrations/20261002090000_api_boundary_answers_refusals_as_4xx.sql');
const ROLLBACK = read('../docs/migrations/rollback/20261002090000_api_boundary_answers_refusals_as_4xx.rollback.sql');

const guardRows = (sql) => [...sql.matchAll(/^ {6}\('(public\.[^']+)', '([0-9a-f]{32})', '([0-9a-f]{32})'\)/gm)]
  .map(([, signature, first, second]) => ({ signature, first, second }));

test('the pgTAP exclusion list is the one in http-contract.json', () => {
  const block = /insert into api_excluded values([\s\S]*?);\n/.exec(PGTAP);
  assert.ok(block, 'the pgTAP declares api_excluded');
  const inPgtap = [...block[1].matchAll(/\('([^']+)'\)/g)].map((match) => match[1]).sort();
  assert.deepEqual(inPgtap, excludedPatterns(contract));
  assert.match(PGTAP, new RegExp(`select is\\(\\(select count\\(\\*\\)::integer from api_excluded\\), ${inPgtap.length},`));
  for (const group of contract.excluded) assert.ok(group.reason && group.still_answers, `${group.group} says why and what it still answers`);
});

test('the handler the pgTAP pins is the one the generator writes', () => {
  const handler = /position\(\$h\$([\s\S]*?)\$h\$ in src\)/.exec(PGTAP)[1];
  const wrapped = wrapBody('\nbegin\n  return 1;\nend;\n').body;
  assert.ok(wrapped.endsWith(handler), 'the generator output ends with the handler the pgTAP looks for');
  assert.ok(PGTAP.includes(`declare\\n  -- ${MARKER}: `), 'the pgTAP looks for the outer declare with the marker');
});

test('the migration and its rollback cover the same functions with swapped md5 guards', () => {
  const forward = guardRows(MIGRATION);
  const back = guardRows(ROLLBACK);
  assert.equal(forward.length, 109);
  assert.deepEqual(back.map((row) => row.signature), forward.map((row) => row.signature));
  for (let index = 0; index < forward.length; index += 1) {
    assert.equal(back[index].first, forward[index].second, `${forward[index].signature}: applied md5`);
    assert.equal(back[index].second, forward[index].first, `${forward[index].signature}: previous md5`);
  }
  assert.equal(MIGRATION.split('\nCREATE OR REPLACE FUNCTION ').length - 1, 109);
  assert.equal(ROLLBACK.split('\nCREATE OR REPLACE FUNCTION ').length - 1, 109);
  assert.equal(MIGRATION.split(`-- ${MARKER}: `).length - 1, 109, 'every function in the migration carries the marker');
  assert.ok(!ROLLBACK.includes(`-- ${MARKER}: `), 'the rollback restores bodies without the wrapper');
  assert.match(PGTAP, /select is\(\(select count\(\*\)::integer from api_functions where wrapped\), 109,/);
  // Ninguna excluida se regenera.
  const excluded = excludedPatterns(contract).map((pattern) => new RegExp(`^public\\.${pattern.replaceAll('*', '[a-z0-9_]*')}\\(`));
  for (const { signature } of forward) assert.ok(!excluded.some((regex) => regex.test(signature)), `${signature} is excluded by owner`);
  // Sin permisos reescritos: CREATE OR REPLACE conserva los de cada función.
  assert.doesNotMatch(MIGRATION.replace(/\$function\$[\s\S]*?\$function\$/g, ''), /\b(grant|revoke)\b/i);
});

test('the certifier answers the policy statuses for a refusal by state and for a missing resource', () => {
  const statusOf = (code) => contract.status_by_sqlstate.find((row) => row.sqlstates.includes(code)).http;
  assert.equal(statusOf('55000'), 409);
  assert.equal(statusOf('P0002'), 404);
  assert.equal(REFUSAL_STATUS[55000], statusOf('55000'));
  assert.equal(REFUSAL_STATUS.P0002, statusOf('P0002'));
  for (const code of ['22023', '23502', '23514', '23503', '23505', 'PT409', 'PT429']) {
    assert.equal(REFUSAL_STATUS[code], statusOf(code), `${code} in REFUSAL_STATUS follows the policy`);
  }
});
