// Small, offline recovery package: references existing migration/function files.
// No dependencies, downloads, credentials or network access are needed.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { inspectBackup } from '../audit-la-taba-recovery.mjs';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
export const BLOCKED_REFS = new Set(['wwcpogltfgzgkrlilbcd', 'tkanbadcglszlcyfjvpv',
  'ucbtjcurawxjwjdvvcvj', 'ukxqbgswjlibmnjemrzd', 'yakhtrkukqlgzvxuvhzs',
  'enznqfzhikpasjzpvjfd', 'udftddjacdsinscehlke', 'zvmfdlynnutxquktrgyl']);
export const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');

export function assertRecoveryTarget(target, project) {
  if (target.purpose !== 'la-taba-recovery-test' || target.projectName !== 'la-taba-recovery-test' ||
    target.environment !== 'test' || target.commercialPaymentsEnabled !== false ||
    target.mercadoPagoApplicationId !== '2691240967769590' ||
    !/^[a-z]{20}$/.test(target.projectRef || '') || BLOCKED_REFS.has(target.projectRef) ||
    !/^[a-z]{20}$/.test(target.organizationId || '') || target.region !== 'sa-east-1' ||
    !Number.isFinite(Date.parse(target.createdAt)) || Date.parse(target.createdAt) < Date.parse('2026-10-20T00:00:00Z') ||
    !/^https:\/\/(?:[a-z0-9-]+\.taba2-staging|la-taba-recovery-test)\.pages\.dev$/.test(target.checkoutOrigin || '')) {
    throw new Error('A bound, isolated test recovery target is required');
  }
  if (project && (project.id !== target.projectRef || project.name !== target.projectName ||
    project.organization_id !== target.organizationId || project.region !== target.region ||
    project.created_at !== target.createdAt || project.status !== 'ACTIVE_HEALTHY')) {
    throw new Error('Hosted project does not match the provisioning receipt');
  }
}

function functionGraph(entry, root) {
  const visited = new Map();
  function visit(file) {
    const absolute = path.resolve(root, file);
    const relative = path.relative(root, absolute).replaceAll('\\', '/');
    if (!relative.startsWith('supabase/functions/') || relative.split('/').includes('..') ||
      /\.deno\.ts$|\.test\./.test(relative)) throw new Error('Invalid Edge source dependency');
    if (visited.has(relative)) return;
    const bytes = fs.readFileSync(absolute), source = bytes.toString('utf8');
    visited.set(relative, { path: relative, sha256: sha256(bytes), bytes: bytes.length });
    for (const match of source.matchAll(/(?:\bfrom\s*|\bimport\s*\(?\s*)['"]([^'"\n]+)['"]/g)) {
      const specifier = match[1];
      if (specifier.startsWith('.')) visit(path.relative(root, path.resolve(path.dirname(absolute), specifier)));
      else if (specifier === 'jsr:@supabase/functions-js/edge-runtime.d.ts') {
        // Supabase's platform type declaration is not a runtime SDK import.
      } else if (/^(?:npm:|jsr:)/.test(specifier) && !/@\d+\.\d+\.\d+(?:\/|$)/.test(specifier)) {
        throw new Error('Unpinned Edge dependency');
      } else if (/^https?:/.test(specifier)) throw new Error('Remote source import needs explicit review');
    }
  }
  visit(entry);
  return [...visited.values()].sort((a, b) => a.path.localeCompare(b.path));
}

export function recoveryPlan(root = ROOT, backupBytes) {
  const migrationRoot = path.join(root, 'supabase/migrations');
  const versions = new Set();
  const migrations = fs.readdirSync(migrationRoot).filter(n => n.endsWith('.sql')).sort().map(name => {
    if (!/^\d{14}_[a-z0-9_]+\.sql$/.test(name) || versions.has(name.slice(0, 14))) throw new Error('Invalid migration order');
    versions.add(name.slice(0, 14));
    const bytes = fs.readFileSync(path.join(migrationRoot, name));
    const source = bytes.toString('utf8');
    if (bytes.subarray(0, 3).equals(Buffer.from([239, 187, 191])) || /^\s*(?:begin|commit|rollback);/im.test(source)) {
      throw new Error('Migration cannot be enclosed in the recovery transaction');
    }
    return { path: `supabase/migrations/${name}`, version: name.slice(0, 14), sha256: sha256(bytes), bytes: bytes.length };
  });
  const config = fs.readFileSync(path.join(root, 'supabase/config.toml'), 'utf8');
  const functions = fs.readdirSync(path.join(root, 'supabase/functions'), { withFileTypes: true })
    .filter(e => e.isDirectory() && !e.name.startsWith('_')).map(({ name }) => {
      const section = new RegExp(`\\[functions\\.${name}\\]([\\s\\S]*?)(?=\\n\\[|$)`).exec(config)?.[1];
      const gateway = /^verify_jwt\s*=\s*(true|false)/m.exec(section || '');
      const entry = `supabase/functions/${name}/index.ts`;
      return { name, entrypoint: entry, verifyJwt: gateway ? gateway[1] === 'true' : true,
        gatewaySource: gateway ? 'config.toml' : 'default_true', files: functionGraph(entry, root) };
    }).sort((a, b) => a.name.localeCompare(b.name));
  const auth = { disable_signup: false, external_anonymous_users_enabled: true,
    external_email_enabled: true, mailer_autoconfirm: false, password_min_length: 12,
    jwt_exp: 3600 };
  const plan = { schemaVersion: 1, purpose: 'la-taba-recovery-test',
    migrations, functions, auth, authSecurityRequirements: { refreshTokenRotation: true, exactRedirectOrigins: true },
    commercialPaymentsEnabled: false,
    applySeedSql: false, restoreHistoricalUsers: false, restoreHistoricalOrders: false,
    historicalSeedBusiness: { migration: migrations[0].path, id: '00000000-0000-4000-8000-000000000001',
      provenance: 'repository_seed_not_recovered_history', orderingEnabled: false },
    backup: backupBytes ? inspectBackup(backupBytes) : null,
    pendingVerification: ['full_hosted_migration_replay', 'auth_api', 'rls_advisors', 'storage_objects',
      'realtime_subscription', 'edge_deployment', 'test_seller_oauth', 'test_payment',
      'signed_provider_webhook', 'unique_order_and_stock_effect', 'test_refund_and_cancellation'] };
  return { ...plan, sourceManifestSha256: sha256(JSON.stringify(plan)) };
}

export function recoveryEnvironment(target) {
  assertRecoveryTarget(target);
  return {
    TABA_RECOVERY_PROJECT_REF: target.projectRef,
    TABA_RECOVERY_CHECKOUT_ORIGIN: target.checkoutOrigin,
    TABA_DEPLOYMENT_ENV: 'staging', MERCADOPAGO_ENVIRONMENT: 'test',
    MERCADOPAGO_OAUTH_ENVIRONMENT: 'test', MERCADOPAGO_CREDENTIAL_MODE: 'oauth',
    MERCADOPAGO_OAUTH_PROJECT_REF: target.projectRef,
    MERCADOPAGO_CLIENT_ID: '2691240967769590',
    MERCADOPAGO_OAUTH_PANEL_URL: target.checkoutOrigin + '/',
    TABA_CHECKOUT_BASE_URL: target.checkoutOrigin, TABA_ALLOWED_ORIGINS: target.checkoutOrigin,
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const option = name => args.includes(name) ? args[args.indexOf(name) + 1] : undefined;
  const bytes = option('--backup') ? fs.readFileSync(option('--backup')) : undefined;
  const plan = recoveryPlan(ROOT, bytes);
  if (option('--output')) fs.writeFileSync(option('--output'), JSON.stringify(plan, null, 2) + '\n', { flag: 'wx' });
  console.log(JSON.stringify({ networkAccess: false, migrations: plan.migrations.length, functions: plan.functions.length,
    historicalUsersRestored: false, historicalOrdersRestored: false, commercialPaymentsEnabled: false,
    sourceManifestSha256: plan.sourceManifestSha256, backup: plan.backup }));
}
