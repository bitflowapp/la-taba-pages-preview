import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { PROJECT } from './model.mjs';
import { main } from '../release-edge-production.mjs';

let directory;
try {
  assert.equal(process.env.GITHUB_EVENT_NAME, 'workflow_dispatch');
  assert.equal(process.env.GITHUB_REPOSITORY, 'bitflowapp/la-taba-pages-preview');
  assert.equal(process.env.GITHUB_RUN_ATTEMPT, '1');
  assert.equal(process.env.PROJECT_CONFIRMATION, PROJECT);
  for (const name of ['SUPABASE_ACCESS_TOKEN', 'TABA_A1_A4_DATABASE_URL']) assert.ok(process.env[name], `Missing production configuration: ${name}`);
  const args = ['--project-ref', PROJECT, '--confirm-project', PROJECT, '--mode', process.env.RELEASE_MODE];
  if (process.env.RELEASE_ID) args.push('--release-id', process.env.RELEASE_ID);
  // A public CA certificate is not a credential. Passwords/tokens remain in
  // the environment and are never written to artifacts.
  if (process.env.TABA_DATABASE_CA_PEM) {
    directory = fs.mkdtempSync(path.join(os.tmpdir(), 'taba-release-ca-'));
    const file = path.join(directory, 'ca.pem');
    fs.writeFileSync(file, process.env.TABA_DATABASE_CA_PEM, { mode: 0o600 });
    process.env.TABA_DATABASE_CA_FILE = file;
  }
  await main(args);
} catch {
  console.error('Production stage failed; inspect durable status. Quiescence is retained.');
  process.exitCode = 1;
} finally {
  if (directory) fs.rmSync(directory, { recursive: true, force: true });
}
