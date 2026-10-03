import { spawnSync } from 'node:child_process';
import { chmodSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const PROJECT_REF = 'yakhtrkukqlgzvxuvhzs';
const PROJECT_NAME = 'la-taba-demo';
const SUPABASE_URL = `https://${PROJECT_REF}.supabase.co`;
const WORKTREE = 'C:\\1212\\la-taba-pages-rider-map';
const RUNTIME_ROOT = 'C:\\1212\\taba-device-test-runtime';
const SESSION_ROOT = path.join(RUNTIME_ROOT, 'rider-map-session');
const ACCESS_PATH = path.join(RUNTIME_ROOT, 'device-test-access.txt');
const RUNTIME_PATH = path.join(SESSION_ROOT, 'runtime-config.local.js');
const RESULT_PATH = path.join(SESSION_ROOT, 'publishable-resolution.json');

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function parseCliJson(stdout) {
  const text = String(stdout || '').trim();
  const starts = [0, text.indexOf('['), text.indexOf('{')].filter((value) => value >= 0);
  for (const start of [...new Set(starts)]) {
    try {
      return JSON.parse(text.slice(start));
    } catch {
      // Never print raw CLI output because an api-keys response contains keys.
    }
  }
  throw new Error('Supabase CLI did not return parseable JSON.');
}

function runSupabase(args) {
  const command = process.platform === 'win32' ? 'powershell.exe' : 'npx';
  const commandArgs = process.platform === 'win32'
    ? [
      '-NoProfile',
      '-NonInteractive',
      '-Command',
      `& npx supabase ${args.map(quotePowerShell).join(' ')}`,
    ]
    : ['supabase', ...args];
  const result = spawnSync(command, commandArgs, {
    cwd: WORKTREE,
    encoding: 'utf8',
    windowsHide: true,
    timeout: 120_000,
    maxBuffer: 4 * 1024 * 1024,
  });
  assert(result.status === 0, 'Supabase CLI authentication or Management API request failed.');
  return parseCliJson(result.stdout);
}

function quotePowerShell(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}

function projectRows(payload) {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.projects)) return payload.projects;
  return [];
}

function apiKeyRows(payload) {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.api_keys)) return payload.api_keys;
  if (Array.isArray(payload?.keys)) return payload.keys;
  return [];
}

function isActiveKey(row) {
  const status = String(row?.status || '').toLowerCase();
  return row?.disabled !== true
    && !row?.deleted_at
    && !row?.revoked_at
    && !['disabled', 'inactive', 'revoked', 'deleted', 'expired'].includes(status);
}

function readBusinessId() {
  const access = readFileSync(ACCESS_PATH, 'utf8');
  const businessId = access.match(/^Business ID:\s*([0-9a-f-]{36})\s*$/im)?.[1]?.trim() || '';
  assert(/^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(businessId), 'QA business ID is unavailable.');
  return businessId;
}

function restrictFile(pathname) {
  try {
    chmodSync(pathname, 0o600);
  } catch {
    // Windows ACLs are tightened below.
  }
  if (process.platform !== 'win32') return;
  const user = String(process.env.USERNAME || '').trim();
  if (!user) return;
  const result = spawnSync('icacls.exe', [
    pathname,
    '/inheritance:r',
    '/grant:r',
    `${user}:(R,W)`,
    'SYSTEM:(F)',
  ], {
    encoding: 'utf8',
    windowsHide: true,
    timeout: 15_000,
  });
  assert(result.status === 0, 'Temporary runtime ACL could not be restricted.');
}

try {
  const projects = projectRows(runSupabase(['projects', 'list', '--output', 'json']));
  const project = projects.find((row) => row?.ref === PROJECT_REF && row?.name === PROJECT_NAME);
  assert(project, 'Authenticated Supabase session cannot see the requested project.');
  assert(
    !project.status || project.status === 'ACTIVE_HEALTHY',
    'Supabase project is not ACTIVE_HEALTHY.',
  );

  const rows = apiKeyRows(runSupabase([
    'projects',
    'api-keys',
    '--project-ref',
    PROJECT_REF,
    '--output',
    'json',
  ]));
  const candidates = rows
    .map((row) => ({
      row,
      type: String(row?.type || '').toLowerCase(),
      name: String(row?.name || row?.key_name || '').toLowerCase(),
      key: String(row?.api_key || row?.key || row?.value || '').trim(),
      insertedAt: Date.parse(row?.inserted_at || row?.created_at || 0) || 0,
    }))
    .filter(({ row, type, name, key }) => (
      isActiveKey(row)
      && key.startsWith('sb_publishable_')
      && (type === 'publishable' || name === 'publishable' || key.startsWith('sb_publishable_'))
    ))
    .sort((left, right) => right.insertedAt - left.insertedAt);
  assert(candidates.length > 0, 'No active sb_publishable_ key is available.');
  const publishableKey = candidates[0].key;
  assert(/^sb_publishable_[A-Za-z0-9_-]{20,}$/.test(publishableKey), 'Publishable key prefix is invalid.');
  assert(!/^sb_secret_/i.test(publishableKey), 'Secret key selection was blocked.');

  const businessId = readBusinessId();
  const runtimeConfig = `globalThis.__LA_TABA_RUNTIME_CONFIG__ = Object.freeze({
  mode: 'production',
  repository: Object.freeze({
    provider: 'supabase',
    deploymentEnvironment: 'staging',
    supabaseUrl: ${JSON.stringify(SUPABASE_URL)},
    publishableKey: ${JSON.stringify(publishableKey)},
    businessId: ${JSON.stringify(businessId)},
    pollMs: 5000,
  }),
});
`;
  assert(!/sb_secret_|service_role/i.test(runtimeConfig), 'Forbidden key material was detected.');
  writeFileSync(RUNTIME_PATH, runtimeConfig, { encoding: 'utf8', mode: 0o600 });
  restrictFile(RUNTIME_PATH);

  writeFileSync(RESULT_PATH, `${JSON.stringify({
    management_auth: 'yes',
    project_active: 'yes',
    publishable_key_resolved: 'yes',
    prefix_valid: 'yes',
    projectRef: PROJECT_REF,
    businessId,
    runtimePath: RUNTIME_PATH,
  }, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
  restrictFile(RESULT_PATH);

  console.log('management_auth=yes');
  console.log('project_active=yes');
  console.log('publishable_key_resolved=yes');
  console.log('prefix_valid=yes');
} catch (error) {
  console.error(`resolution_error=${String(error?.message || 'unknown').replace(/sb_[A-Za-z0-9_-]+/g, '[key]')}`);
  process.exitCode = 1;
}
