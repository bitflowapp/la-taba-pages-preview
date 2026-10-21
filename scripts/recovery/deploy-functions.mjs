import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ROOT, recoveryPlan, sha256 } from './plan.mjs';
import { withRecoveryProject } from './hosted-client.mjs';

export async function deployRecoveryFunctions(target, plan, record) {
  if (JSON.stringify(plan.functions) !== JSON.stringify(recoveryPlan().functions)) throw new Error('Function manifest changed');
  return withRecoveryProject(target, async ({ request }) => {
    for (const fn of plan.functions) {
      const form = new FormData();
      form.set('metadata', JSON.stringify({ name: fn.name, verify_jwt: fn.verifyJwt,
        entrypoint_path: fn.entrypoint.replace('supabase/functions/', '') }));
      for (const file of fn.files) {
        const bytes = fs.readFileSync(path.join(ROOT, file.path));
        if (sha256(bytes) !== file.sha256) throw new Error('Function source hash mismatch');
        form.append('file', new Blob([bytes], { type: 'application/typescript' }), file.path.replace('supabase/functions/', ''));
      }
      const result = await request(`/functions/deploy?slug=${fn.name}`, {
        method: 'POST', body: form,
      });
      await record({ name: fn.name, status: result.status, version: result.version, verifyJwt: fn.verifyJwt,
        at: new Date().toISOString() });
    }
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const value = option => process.argv[process.argv.indexOf(option) + 1];
  if (!process.argv.includes('--apply')) console.log('No writes. Requires --apply --target --manifest --evidence.');
  else {
    const target = JSON.parse(fs.readFileSync(value('--target'), 'utf8'));
    const plan = JSON.parse(fs.readFileSync(value('--manifest'), 'utf8'));
    await deployRecoveryFunctions(target, plan, row => {
      fs.appendFileSync(value('--evidence'), JSON.stringify(row) + '\n');
      console.log(JSON.stringify(row));
    });
  }
}
