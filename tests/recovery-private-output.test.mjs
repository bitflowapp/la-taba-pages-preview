import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { assertPrivateOutputDirectory } from '../scripts/recovery/private-output.mjs';
import { createPostgresBackup } from '../scripts/recovery/postgres-backup.mjs';
import { restoreApplication } from '../scripts/recovery/restore-postgres-application.mjs';
import { verifyRestore } from '../scripts/recovery/verify-postgres-restore.mjs';
import { prepareOffsiteBackup } from '../scripts/recovery/prepare-offsite-backup.mjs';

test('recovery output cannot enter this checkout or another worktree, including a nonexistent nested directory',()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'taba-private-output-'));
  try {
    const checkout=path.join(root,'other-worktree');fs.mkdirSync(checkout);
    fs.writeFileSync(path.join(checkout,'.git'),'gitdir: fixture-only');
    assert.equal(assertPrivateOutputDirectory(path.join(root,'private-backup')),path.join(root,'private-backup'));
    assert.throws(()=>assertPrivateOutputDirectory(path.join(checkout,'not-created','backup')),/outside Git checkouts/);
    assert.throws(()=>assertPrivateOutputDirectory(path.resolve('docs','must-not-exist')),/outside Git checkouts/);
  } finally {fs.rmSync(root,{recursive:true,force:true});}
});
test('backup, restore and verification reject checkout output before credentials or network access',async()=>{
  const out=path.resolve('docs','must-not-be-created');
  for(const action of [createPostgresBackup,restoreApplication,verifyRestore])
    await assert.rejects(action({out}),/outside Git checkouts/);
  assert.throws(()=>prepareOffsiteBackup('unused-must-not-be-read',out),/outside Git checkouts/);
  assert.equal(fs.existsSync(out),false);
});
