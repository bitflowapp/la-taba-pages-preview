import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { readFile, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

const RUNTIME_ROOT = 'C:\\1212\\taba-device-test-runtime';
const WORKTREE_PACKAGE = 'C:\\1212\\la-taba-s23-iphone-test\\package.json';
const SUPABASE_URL = 'https://yakhtrkukqlgzvxuvhzs.supabase.co';
const PROJECT_REF = 'yakhtrkukqlgzvxuvhzs';
const ACCESS_PATH = `${RUNTIME_ROOT}\\device-test-access.txt`;
const RESULT_PATH = `${RUNTIME_ROOT}\\qa-runtime-validation.json`;
const RUNTIME_CONFIG_PATH = `${RUNTIME_ROOT}\\runtime-config.local.js`;

const requireFromWorktree = createRequire(WORKTREE_PACKAGE);
const { createClient } = requireFromWorktree('@supabase/supabase-js');

const AUTH_OPTIONS = Object.freeze({
  persistSession: false,
  autoRefreshToken: false,
  detectSessionInUrl: false,
});

export function membershipNeedsFix(row, businessId, role) {
  return !row
    || String(row.business_id || '').trim() !== String(businessId || '').trim()
    || String(row.role || '').trim().toLowerCase() !== role
    || row.is_active !== true;
}

export function resolveDirectoryRiderIds(rows) {
  return new Set((Array.isArray(rows) ? rows : [])
    .map((row) => String(row?.rider_user_id || '').trim().toLowerCase())
    .filter(Boolean));
}

export function directoryMatchesBusiness(rows, expectedActiveRiderIds, targetRiderId) {
  const expected = new Set(
    [...expectedActiveRiderIds].map((value) => String(value).trim().toLowerCase()),
  );
  const actual = resolveDirectoryRiderIds(rows);
  const target = String(targetRiderId || '').trim().toLowerCase();
  return actual.has(target) && [...actual].every((id) => expected.has(id));
}

export function parseQaAccess(text) {
  const businessId = text.match(/^Business ID:\s*([0-9a-f-]{36})\s*$/im)?.[1]?.trim();
  const ownerBlock = text.match(/Owner QA\s+Email:\s*([^\r\n]+)\s+Password:\s*([^\r\n]+)/i);
  const riderBlock = text.match(/Rider QA\s+Email:\s*([^\r\n]+)\s+Password:\s*([^\r\n]+)/i);
  const parsed = {
    businessId,
    ownerEmail: ownerBlock?.[1]?.trim(),
    ownerPassword: ownerBlock?.[2]?.trim(),
    riderEmail: riderBlock?.[1]?.trim(),
    riderPassword: riderBlock?.[2]?.trim(),
  };
  if (!/^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(parsed.businessId || '')
      || !parsed.ownerEmail || !parsed.ownerPassword
      || !parsed.riderEmail || !parsed.riderPassword) {
    throw new Error('El archivo local QA está incompleto o no tiene el formato esperado.');
  }
  return parsed;
}

export function sanitizeMessage(value) {
  return String(value || 'error desconocido')
    .replace(/\b[0-9a-f]{8}-[0-9a-f-]{27}\b/gi, '[id]')
    .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, '[email]')
    .replace(/\bsb_(?:secret|publishable)_[A-Za-z0-9_-]+\b/g, '[key]')
    .replace(/\beyJ[A-Za-z0-9_.-]+\b/g, '[token]')
    .slice(0, 300);
}

function createIsolatedClient(key) {
  return createClient(SUPABASE_URL, key, {
    auth: { ...AUTH_OPTIONS },
  });
}

function fingerprint(value) {
  return createHash('sha256').update(String(value)).digest('hex').slice(0, 12);
}

function failIf(error, context) {
  if (error) throw new Error(`${context}: ${sanitizeMessage(error.message)}`);
}

async function authenticate(client, email, password, label) {
  const { data, error } = await client.auth.signInWithPassword({ email, password });
  failIf(error, `No se pudo autenticar ${label}`);
  if (!data?.user?.id || !data?.session) {
    throw new Error(`La autenticación de ${label} no devolvió una sesión válida.`);
  }
  return data.user.id;
}

async function signOutQuietly(...clients) {
  await Promise.allSettled(clients.map((client) => client.auth.signOut({ scope: 'local' })));
}

async function main() {
  let secretKey = process.env.TABA_QA_SUPABASE_SECRET || '';
  let publishableKey = process.env.TABA_QA_SUPABASE_PUBLISHABLE || '';
  if (!/^sb_secret_[A-Za-z0-9_-]{20,}$/.test(secretKey)) {
    throw new Error('La secret activa no está disponible o tiene formato inválido.');
  }
  if (!/^sb_publishable_[A-Za-z0-9_-]{20,}$/.test(publishableKey)) {
    throw new Error('La publishable key activa no está disponible o tiene formato inválido.');
  }

  const adminClient = createIsolatedClient(secretKey);
  const ownerClient = createIsolatedClient(publishableKey);
  const riderClient = createIsolatedClient(publishableKey);
  const anonymousClient = createIsolatedClient(publishableKey);
  delete process.env.TABA_QA_SUPABASE_SECRET;
  delete process.env.TABA_QA_SUPABASE_PUBLISHABLE;

  const access = parseQaAccess(await readFile(ACCESS_PATH, 'utf8'));
  let ownerUserId;
  let riderUserId;
  let anonymousStatus = 0;
  let correctionApplied = false;

  try {
    ownerUserId = await authenticate(
      ownerClient,
      access.ownerEmail,
      access.ownerPassword,
      'Owner QA',
    );
    riderUserId = await authenticate(
      riderClient,
      access.riderEmail,
      access.riderPassword,
      'Rider QA',
    );
    if (ownerUserId === riderUserId) {
      throw new Error('Owner QA y Rider QA no pueden resolver al mismo usuario.');
    }

    const { data: businessRows, error: businessError } = await adminClient
      .from('businesses')
      .select('id,is_active,ordering_enabled,ordering_verified,delivery_enabled')
      .eq('id', access.businessId)
      .limit(1);
    failIf(businessError, 'No se pudo verificar el comercio QA');
    const business = businessRows?.[0];
    if (!business?.is_active || !business.ordering_enabled || !business.ordering_verified) {
      throw new Error('El comercio QA no está activo y habilitado para pedidos.');
    }

    const { data: membershipRows, error: membershipError } = await adminClient
      .from('business_members')
      .select('business_id,user_id,role,is_active')
      .in('user_id', [ownerUserId, riderUserId]);
    failIf(membershipError, 'No se pudieron auditar las memberships QA');

    const ownerMembership = (membershipRows || []).find((row) => (
      row.user_id === ownerUserId && row.business_id === access.businessId
    ));
    const riderMembership = (membershipRows || []).find((row) => (
      row.user_id === riderUserId && row.business_id === access.businessId
    ));
    const rowsToFix = [];
    if (membershipNeedsFix(ownerMembership, access.businessId, 'owner')) {
      rowsToFix.push({
        business_id: access.businessId,
        user_id: ownerUserId,
        role: 'owner',
        is_active: true,
      });
    }
    if (membershipNeedsFix(riderMembership, access.businessId, 'rider')) {
      rowsToFix.push({
        business_id: access.businessId,
        user_id: riderUserId,
        role: 'rider',
        is_active: true,
      });
    }
    if (rowsToFix.length) {
      const { error: upsertError } = await adminClient
        .from('business_members')
        .upsert(rowsToFix, { onConflict: 'business_id,user_id' });
      failIf(upsertError, 'No se pudieron corregir las memberships QA');
      correctionApplied = true;
    }

    const { data: verifiedRows, error: verifiedError } = await adminClient
      .from('business_members')
      .select('business_id,user_id,role,is_active')
      .in('user_id', [ownerUserId, riderUserId]);
    failIf(verifiedError, 'No se pudieron confirmar las memberships QA');
    const verifiedOwner = (verifiedRows || []).find((row) => (
      row.user_id === ownerUserId && row.business_id === access.businessId
    ));
    const verifiedRider = (verifiedRows || []).find((row) => (
      row.user_id === riderUserId && row.business_id === access.businessId
    ));
    if (membershipNeedsFix(verifiedOwner, access.businessId, 'owner')
        || membershipNeedsFix(verifiedRider, access.businessId, 'rider')) {
      throw new Error('Las memberships QA no coinciden con los roles activos esperados.');
    }

    const { data: activeRows, error: activeError } = await adminClient
      .from('business_members')
      .select('user_id')
      .eq('business_id', access.businessId)
      .eq('role', 'rider')
      .eq('is_active', true);
    failIf(activeError, 'No se pudo construir el conjunto operativo de riders');
    const expectedActiveRiderIds = new Set(
      (activeRows || []).map((row) => String(row.user_id).trim().toLowerCase()),
    );

    const { data: directoryRows, error: directoryError } = await ownerClient
      .rpc('list_active_business_riders', { p_business_id: access.businessId });
    failIf(directoryError, 'La RPC real del directorio rechazó al Owner QA');
    if (!directoryMatchesBusiness(directoryRows, expectedActiveRiderIds, riderUserId)) {
      throw new Error('La RPC real no contiene al Rider QA o devolvió un rider de otro comercio.');
    }

    const { error: anonymousError } = await anonymousClient.auth.signInAnonymously();
    anonymousStatus = anonymousError?.status || (anonymousError ? 400 : 200);
    if (anonymousError) {
      throw new Error(
        `Auth anónima status=${anonymousStatus} message=${sanitizeMessage(anonymousError.message)}`,
      );
    }

    const runtimeConfig = [
      'globalThis.__LA_TABA_RUNTIME_CONFIG__ = {',
      "  mode: 'production',",
      '  repository: {',
      "    provider: 'supabase',",
      `    supabaseUrl: ${JSON.stringify(SUPABASE_URL)},`,
      `    publishableKey: ${JSON.stringify(publishableKey)},`,
      `    businessId: ${JSON.stringify(access.businessId)},`,
      '    pollMs: 5000,',
      "    deploymentEnvironment: 'staging',",
      '  },',
      '};',
      '',
    ].join('\n');
    await writeFile(RUNTIME_CONFIG_PATH, runtimeConfig, 'utf8');

    await writeFile(RESULT_PATH, `${JSON.stringify({
      validatedAt: new Date().toISOString(),
      projectRef: PROJECT_REF,
      sameProject: true,
      ownerAuthenticated: true,
      riderAuthenticated: true,
      membershipValid: true,
      ownerRole: verifiedOwner.role,
      riderRole: verifiedRider.role,
      ownerActive: verifiedOwner.is_active,
      riderActive: verifiedRider.is_active,
      businessMatches: true,
      directoryRpc: 'list_active_business_riders',
      directoryField: 'rider_user_id',
      directoryContainsRider: true,
      directoryRowsBelongToBusiness: true,
      anonymousAuthStatus: 200,
      anonymousAuthMessage: 'anonymous_sign_in_ok',
      correctionApplied,
      ownerFingerprint: fingerprint(ownerUserId),
      riderFingerprint: fingerprint(riderUserId),
      businessFingerprint: fingerprint(access.businessId),
    }, null, 2)}\n`, 'utf8');

    console.log('DIRECTORY_AND_RIDER_VALIDATED_OK');
    console.log('same_project=yes owner_authenticated=yes rider_authenticated=yes membership=yes role=yes business=yes directory_contains_rider=yes');
    console.log('ANON_AUTH_OK status=200 message=anonymous_sign_in_ok');
  } finally {
    secretKey = '';
    publishableKey = '';
    await signOutQuietly(ownerClient, riderClient, anonymousClient);
  }
}

const invokedDirectly = process.argv[1]
  && pathToFileURL(process.argv[1]).href === import.meta.url;
if (invokedDirectly) {
  main().catch((error) => {
    console.error(`QA_RUNTIME_VALIDATION_FAILED: ${sanitizeMessage(error?.message)}`);
    process.exitCode = 1;
  });
}
