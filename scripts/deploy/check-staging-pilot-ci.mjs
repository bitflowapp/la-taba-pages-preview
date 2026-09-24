import assert from 'node:assert/strict';
import path from 'node:path';
import process from 'node:process';

const REPO = 'bitflowapp/la-taba-pages-preview';
const RELEASE_BRANCHES = ['release/taba-commercial-pilot', 'release/taba-controlled-production'];
const BRANCH = RELEASE_BRANCHES.includes(process.env.RELEASE_BRANCH) ? process.env.RELEASE_BRANCH : RELEASE_BRANCHES[0];
const WORKFLOWS = ['ci.yml', 'rider-android-ci.yml'];

export function hasPassingRun(runs, { sha, workflow }) {
  return Array.isArray(runs) && runs.some((run) => run.head_sha === sha
    && run.path === `.github/workflows/${workflow}`
    && run.head_repository?.full_name === REPO
    && run.head_branch === BRANCH
    && run.event === 'push'
    && run.status === 'completed'
    && run.conclusion === 'success');
}

const invoked = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(import.meta.filename);
if (invoked) {
  const { GITHUB_REPOSITORY: repo, RELEASE_COMMIT: sha, GITHUB_SHA: head, GH_TOKEN: token } = process.env;
  assert.equal(repo, REPO);
  assert.match(sha || '', /^[a-f0-9]{40}$/);
  assert.equal(sha, head, 'Staging deploy must use dispatched branch HEAD');
  assert.ok(token, 'GitHub read token required');
  const deadline = Date.now() + 50 * 60_000;
  while (Date.now() < deadline) {
    let allPassed = true;
    for (const workflow of WORKFLOWS) {
      const response = await fetch(`https://api.github.com/repos/${REPO}/actions/workflows/${workflow}/runs?head_sha=${sha}&per_page=100`, {
        headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json' },
        redirect: 'error', signal: AbortSignal.timeout(30_000),
      });
      assert.equal(response.status, 200, `${workflow} history unavailable`);
      const payload = await response.json();
      if (hasPassingRun(payload.workflow_runs, { sha, workflow })) continue;
      const exact = (payload.workflow_runs || []).filter((run) => run.head_sha === sha
        && run.path === `.github/workflows/${workflow}` && run.head_repository?.full_name === REPO
        && run.head_branch === BRANCH && run.event === 'push');
      assert.ok(!exact.some((run) => run.status === 'completed'
        && ['failure', 'cancelled', 'timed_out', 'action_required'].includes(run.conclusion)),
      `${workflow} failed on exact Staging SHA`);
      allPassed = false;
    }
    if (allPassed) {
      console.log('Exact Staging SHA has passing web and Android CI.');
      process.exit(0);
    }
    await new Promise((resolve) => setTimeout(resolve, 30_000));
  }
  throw new Error('STAGING_CI_WAIT_TIMEOUT');
}
