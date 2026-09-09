// Sole production Edge/EXPAND/CONTRACT entrypoint. Explicit action and project
// confirmation are required. The --dry-run path has no external operations.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { pathToFileURL } from 'node:url';
import { PROJECT, ROOT, PROTOCOL, target, cliDeployArgs } from './release-v5/model.mjs';
import { buildSources, localContext } from './release-v5/identity.mjs';
import { Platform } from './release-v5/platform.mjs';
import { Session, databaseConfiguration } from './release-v5/session.mjs';
import { Lifecycle } from './release-v5/lifecycle.mjs';

export function argumentsFor(argv) {
  const { values } = parseArgs({ args: argv, strict: true, allowPositionals: false, options: {
    mode: { type: 'string' }, 'project-ref': { type: 'string' }, 'confirm-project': { type: 'string' },
    'release-id': { type: 'string' }, 'dry-run': { type: 'boolean', default: false },
    'lock-timeout-ms': { type: 'string', default: '30000' }, 'evidence-file': { type: 'string' },
  } });
  target(values['project-ref']);
  if (values['release-id']) values['release-id'] = values['release-id'].toLowerCase();
  const modes = ['preflight', 'expand', 'verify-expand', 'quiesce', 'drain', 'release', 'recover', 'verify', 'attest', 'contract', 'verify-contract', 'resume', 'abort', 'status', 'health'];
  assert.ok(values['dry-run'] || modes.includes(values.mode), 'explicit lifecycle mode required');
  const readOnly = ['preflight', 'verify-expand', 'verify-contract', 'status', 'health'].includes(values.mode);
  if (!values['dry-run'] && !readOnly) target(values['confirm-project']);
  if (!values['dry-run'] && !['preflight', 'expand', 'verify-expand', 'quiesce', 'status'].includes(values.mode)) assert.match(values['release-id'] || '', /^[a-f0-9-]{36}$/i, 'release ID required');
  return { ...values, readOnly };
}
export async function main(argv = process.argv.slice(2)) {
  const args = argumentsFor(argv);
  let auditOutput;
  if (args['evidence-file'] && !args['dry-run']) {
    auditOutput = path.resolve(args['evidence-file']);
    const parent = fs.realpathSync(path.dirname(auditOutput));
    const relative = path.relative(fs.realpathSync(ROOT),parent);
    assert.ok(relative.startsWith('..'+path.sep) || path.isAbsolute(relative), 'audit output must be outside the checkout');
    assert.equal(fs.existsSync(auditOutput),false,'audit output already exists');
    fs.accessSync(parent,fs.constants.W_OK);
  }
  const context = localContext(ROOT, { requireClean: !args['dry-run'] });
  const built = await buildSources(ROOT, { commit: args['dry-run'] ? undefined : context.commit });
  if (!args['dry-run']) assert.deepEqual(localContext(ROOT),context,'immutable checkout changed during build');
  if (args['dry-run']) {
    const output = { protocol: PROTOCOL, dry_run: true, mutations: 0, production_checks: 'NOT_EXECUTED',
      source_identity: built.sourceIdentity, context, equivalent_pinned_cli: cliDeployArgs(PROJECT),
      functions: Object.fromEntries(Object.entries(built.outputs).map(([slug, v]) => [slug, { sha256: v.sha256, inputs: v.inputs, verify_jwt: v.verify_jwt }])) };
    console.log(JSON.stringify(output, null, 2));
    return output;
  }
  databaseConfiguration(process.env.TABA_A1_A4_DATABASE_URL, process.env.TABA_DATABASE_CA_FILE);
  const cancellation = new AbortController();
  const interrupt = () => cancellation.abort(new Error('RELEASE_CANCELLED_QUIESCENCE_RETAINED'));
  process.once('SIGINT', interrupt); process.once('SIGTERM', interrupt);
  let session;
  try {
    const platform = new Platform(process.env.SUPABASE_ACCESS_TOKEN, { signal: cancellation.signal });
    await platform.project();
    session = await Session.connect(platform, process.env.TABA_A1_A4_DATABASE_URL, process.env.TABA_DATABASE_CA_FILE, { readOnly: args.readOnly });
    session.onLost = interrupt;
    if (!args.readOnly) await session.acquire(Number(args['lock-timeout-ms']), cancellation.signal);
    const lifecycle = new Lifecycle({ session, platform, context, built, signal: cancellation.signal, report: v => console.log(JSON.stringify(v)) });
    const id = args['release-id'];
    let result;
    if (args.mode === 'preflight') result = await lifecycle.preflight();
    if (args.mode === 'expand') result = await lifecycle.expand();
    if (args.mode === 'verify-expand') result = await lifecycle.verifyExpand();
    if (args.mode === 'quiesce') result = await lifecycle.quiesce();
    if (args.mode === 'drain') result = await lifecycle.drain(id);
    if (['release', 'recover'].includes(args.mode)) result = await lifecycle.release(id);
    if (args.mode === 'verify') result = await lifecycle.verify(id);
    if (args.mode === 'attest') result = await lifecycle.attest(id);
    if (args.mode === 'contract') result = await lifecycle.contract(id);
    if (args.mode === 'verify-contract') result = await lifecycle.verifyContract(id);
    if (args.mode === 'resume') result = await lifecycle.finish(id);
    if (args.mode === 'abort') result = await lifecycle.finish(id, true);
    if (args.mode === 'health') result = await lifecycle.health(id);
    if (args.mode === 'status') result = await session.value(`select coalesce(jsonb_agg(jsonb_build_object('release_id',id,'phase',phase,'commit',commit_sha,'source_sha',source_sha,'started_at',started_at,'proof_expires_at',proof_expires_at) order by started_at),'[]') from private.a1_a4_releases_v5`);
    const audit = { protocol: PROTOCOL, project: PROJECT, mode: args.mode, dry_run: false, result };
    if (auditOutput) fs.writeFileSync(auditOutput, JSON.stringify(audit, null, 2)+'\n', { flag: 'wx' });
    console.log(JSON.stringify(audit, null, 2));
    return audit;
  } finally {
    if (session) await session.close();
    process.removeListener('SIGINT', interrupt); process.removeListener('SIGTERM', interrupt);
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch(error => {
    const label = /^[A-Z][A-Z0-9_]+$/.test(error.message) ? error.message : error.name === 'AssertionError' ? error.message.split('\n')[0] : 'PLATFORM_OR_DATABASE_REQUEST_FAILED';
    console.error(`RELEASE_FAILED: ${label}. Durable quiescence is retained after a release starts.`);
    process.exitCode = 1;
  });
}
