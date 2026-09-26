import assert from 'node:assert/strict';

const account = process.env.CLOUDFLARE_ACCOUNT_ID;
const token = process.env.CLOUDFLARE_API_TOKEN;
assert.ok(account && token, 'Cloudflare Staging deployment credentials required');
const response = await fetch(`https://api.cloudflare.com/client/v4/accounts/${account}/pages/projects/taba2-staging`, {
  headers: { Authorization: `Bearer ${token}` },
  redirect: 'error', signal: AbortSignal.timeout(20_000),
});
assert.equal(response.status, 200, 'Cloudflare Staging project unavailable');
const payload = await response.json();
assert.equal(payload.success, true);
assert.equal(payload.result?.name, 'taba2-staging');
assert.equal(payload.result?.production_branch, 'staging', 'Unexpected Staging Pages production branch');
console.log('Cloudflare target verified: taba2-staging / staging.');
