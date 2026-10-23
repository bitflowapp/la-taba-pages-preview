import fs from 'node:fs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { psqlRaw } from '../../scripts/local-db/lib.mjs';
test('local throws_like distinguishes a matching error, wrong error and missing exception',()=>{
  const sql=fs.readFileSync('scripts/local-db/pgtap-shim.sql','utf8');
  const r=psqlRaw(process.env.TABA_LOCAL_DB||'taba_local_base',`begin; ${sql}
    select extensions.plan(3);
    select extensions.throws_like('do $x$begin raise exception ''expected ERROR'';end $x$','%expected%','match');
    select extensions.throws_like('do $x$begin raise exception ''other error'';end $x$','%expected%','wrong');
    select extensions.throws_like('select 1','%expected%','missing');
    rollback;`,{tuples:true});
  assert.match(r.stdout,/\nok 1 - match/);
  assert.match(r.stdout,/\nnot ok 2 - wrong/);
  assert.match(r.stdout,/\nnot ok 3 - missing/);
});
