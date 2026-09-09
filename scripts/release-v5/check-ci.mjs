import assert from 'node:assert/strict';
const { GITHUB_REPOSITORY: repo, RELEASE_COMMIT: sha, GITHUB_SHA: head, GH_TOKEN: token } = process.env;
assert.equal(repo, 'bitflowapp/la-taba-pages-preview');
assert.match(sha || '', /^[a-f0-9]{40}$/); assert.equal(sha, head); assert.ok(token);
const response = await fetch(`https://api.github.com/repos/${repo}/actions/workflows/ci.yml/runs?head_sha=${sha}&per_page=100`, {
  headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json' }, redirect: 'error', signal: AbortSignal.timeout(30_000),
});
assert.equal(response.status, 200, 'CI history unavailable');
const data = await response.json();
assert.ok(data.workflow_runs.some(run => run.head_sha === sha && run.path === '.github/workflows/ci.yml'
  && run.head_repository?.full_name === repo && run.head_branch === 'main'
  && ['push', 'workflow_dispatch'].includes(run.event) && run.status === 'completed' && run.conclusion === 'success'), 'exact commit requires passing canonical CI');
console.log('Exact production commit has passing canonical CI.');
