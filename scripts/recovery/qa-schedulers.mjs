// The taba-* pg_cron jobs of the hosted recovery project. bootstrap-hosted.mjs leaves them INACTIVE; without them
// checkout reservations never expire, the payment outbox only moves when someone calls the worker and QA windows
// never close. This script lists them and, with --enable/--disable <jobs|all>, toggles them in the QA project only.
// It never prints job commands (they may reference Vault secret names).
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { withRecoveryProject } from './hosted-client.mjs';

const arg = name => { const i = process.argv.indexOf(name); return i < 0 ? undefined : process.argv[i + 1]; };
const target = JSON.parse(fs.readFileSync(arg('--target') || 'deploy/recovery-free-hosted.json', 'utf8'));
assert.equal(target.environment, 'test');
const mode = process.argv.includes('--enable') ? 'enable' : process.argv.includes('--disable') ? 'disable' : 'list';
const selection = (arg('--enable') || arg('--disable') || '').split(',').map(s => s.trim()).filter(Boolean);
const quote = value => "'" + String(value).replaceAll("'", "''") + "'";

await withRecoveryProject(target, async ({ query }) => {
  const list = () => query(`select jobid, jobname, schedule, active from cron.job where jobname like 'taba-%' order by jobname`);
  let jobs = await list();
  if (mode !== 'list') {
    const names = selection.includes('all') ? jobs.map(j => j.jobname) : selection;
    const unknown = names.filter(name => !jobs.some(j => j.jobname === name));
    if (unknown.length) throw new Error(`Unknown jobs: ${unknown.join(', ')}`);
    await query(`do $qa_cron$ declare j record; begin
      for j in select jobid from cron.job where jobname in (${names.map(quote).join(',')}) loop
        perform cron.alter_job(j.jobid, active := ${mode === 'enable' ? 'true' : 'false'});
      end loop; end $qa_cron$;`);
    jobs = await list();
  }
  const recent = await query(`select j.jobname, d.status, d.start_time
    from cron.job_run_details d join cron.job j on j.jobid = d.jobid
    where j.jobname like 'taba-%' and d.start_time > now() - interval '30 minutes'
    order by d.start_time desc limit 12`).catch(() => []);
  console.log(JSON.stringify({ mode, jobs: jobs.map(({ jobname, schedule, active }) => ({ jobname, schedule, active })),
    recentRuns: recent.map(({ jobname, status, start_time }) => ({ jobname, status, start_time })) }, null, 1));
});
