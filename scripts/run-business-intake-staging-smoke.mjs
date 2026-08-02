#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { normalizeBrowserSupabaseKey } from '../js/core/runtime-config.js';

export const EXPECTED_STAGING_REF = 'ukxqbgswjlibmnjemrzd';
export const REQUIRED_CONFIRMATION = 'I_UNDERSTAND_THIS_CREATES_SYNTHETIC_ORDERS_IN_STAGING';
const DEFAULT_PUBLIC_RUNTIME_PATH = fileURLToPath(
  new URL('../../la-taba-real-pilot-staging/runtime-config.js', import.meta.url),
);

export function hydrateBusinessIntakeStagingPublicEnvironment(
  environment = process.env,
  runtimeSource,
) {
  if (
    String(environment.SUPABASE_URL || '').trim()
    && String(environment.SUPABASE_PUBLISHABLE_KEY || environment.SUPABASE_ANON_KEY || '').trim()
    && String(environment.SUPABASE_BUSINESS_ID || '').trim()
  ) return { ...environment };

  const runtimePath = String(
    environment.TABA_STAGING_RUNTIME_CONFIG_PATH || DEFAULT_PUBLIC_RUNTIME_PATH,
  ).trim();
  const source = runtimeSource === undefined
    ? readFileSync(runtimePath, 'utf8')
    : String(runtimeSource);
  const url = publicRuntimeValue(source, 'supabaseUrl');
  const key = publicRuntimeValue(source, 'publishableKey');
  const businessId = publicRuntimeValue(source, 'businessId');

  return {
    ...environment,
    ...(environment.SUPABASE_URL ? {} : { SUPABASE_URL: url }),
    ...(environment.SUPABASE_PUBLISHABLE_KEY || environment.SUPABASE_ANON_KEY
      ? {}
      : { SUPABASE_PUBLISHABLE_KEY: key }),
    ...(environment.SUPABASE_BUSINESS_ID ? {} : { SUPABASE_BUSINESS_ID: businessId }),
  };
}

export function validateBusinessIntakeStagingSmokeEnvironment(environment = process.env) {
  const url = String(environment.SUPABASE_URL || '').trim().replace(/\/+$/, '');
  const publishableKey = String(
    environment.SUPABASE_PUBLISHABLE_KEY
    || environment.SUPABASE_ANON_KEY
    || '',
  ).trim();
  const businessId = String(environment.SUPABASE_BUSINESS_ID || '').trim();
  const staffEmail = String(environment.SUPABASE_STAFF_EMAIL || '').trim();
  const staffPassword = String(environment.SUPABASE_STAFF_PASSWORD || '');
  const errors = [];

  if (environment.TABA_SMOKE_CONFIRM !== REQUIRED_CONFIRMATION) {
    errors.push(`Definí TABA_SMOKE_CONFIRM=${REQUIRED_CONFIRMATION}.`);
  }

  let projectRef = '';
  try {
    const parsed = new URL(url);
    const expectedHost = `${EXPECTED_STAGING_REF}.supabase.co`;
    if (
      parsed.protocol !== 'https:'
      || parsed.hostname !== expectedHost
      || parsed.username
      || parsed.password
      || parsed.pathname !== '/'
      || parsed.search
      || parsed.hash
    ) {
      errors.push(`SUPABASE_URL debe apuntar exactamente a https://${expectedHost}.`);
    } else {
      projectRef = EXPECTED_STAGING_REF;
    }
  } catch (_) {
    errors.push('SUPABASE_URL no es una URL válida de staging.');
  }

  if (!publishableKey || normalizeBrowserSupabaseKey(publishableKey) !== publishableKey) {
    errors.push('Se requiere una publishable/anon key pública; service_role y sb_secret_ están prohibidas.');
  }
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(businessId)) {
    errors.push('SUPABASE_BUSINESS_ID debe ser un UUID válido.');
  }
  if (!staffEmail || !staffPassword) {
    errors.push('Faltan SUPABASE_STAFF_EMAIL/SUPABASE_STAFF_PASSWORD para una membresía operativa autorizada.');
  }

  return {
    ok: errors.length === 0,
    errors,
    projectRef,
    businessId,
    hasPublicKey: Boolean(publishableKey),
    hasStaffCredentials: Boolean(staffEmail && staffPassword),
  };
}

export function runBusinessIntakeStagingSmoke(environment = process.env) {
  let resolvedEnvironment;
  try {
    resolvedEnvironment = hydrateBusinessIntakeStagingPublicEnvironment(environment);
  } catch (_) {
    console.error('FAIL: No se pudo cargar el runtime público de staging.');
    return 1;
  }
  const validation = validateBusinessIntakeStagingSmokeEnvironment(resolvedEnvironment);
  if (!validation.ok) {
    for (const error of validation.errors) console.error(`FAIL: ${error}`);
    return 1;
  }

  console.log(`Staging autorizado: ${validation.projectRef}`);
  console.log(`Business: ${validation.businessId}`);
  console.log('La key pública y las credenciales están presentes; sus valores no se registran.');

  const cliPath = fileURLToPath(new URL('../node_modules/@playwright/test/cli.js', import.meta.url));
  const configPath = fileURLToPath(new URL('../playwright.staging.config.mjs', import.meta.url));
  const temporaryOutput = mkdtempSync(path.join(tmpdir(), 'taba-business-intake-staging-'));
  try {
    const result = spawnSync(process.execPath, [
      cliPath,
      'test',
      '--config',
      configPath,
    ], {
      cwd: fileURLToPath(new URL('..', import.meta.url)),
      env: {
        ...resolvedEnvironment,
        TABA_STAGING_SMOKE_OUTPUT_DIR: temporaryOutput,
      },
      stdio: 'inherit',
    });
    return Number.isInteger(result.status) ? result.status : 1;
  } finally {
    // Directorio creado por este proceso con prefijo fijo dentro del temp del
    // sistema. Nunca apunta al repo, al worktree ni a evidencia del usuario.
    rmSync(temporaryOutput, { recursive: true, force: true });
  }
}

function publicRuntimeValue(source, name) {
  const match = String(source || '').match(new RegExp(`${name}\\s*:\\s*['\"]([^'\"]+)['\"]`));
  return String(match?.[1] || '').trim();
}

if (process.argv[1] && fileURLToPath(import.meta.url) === fileURLToPath(new URL(`file:///${process.argv[1].replaceAll('\\', '/')}`))) {
  process.exitCode = runBusinessIntakeStagingSmoke(process.env);
}
