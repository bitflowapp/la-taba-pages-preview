// The same designated QA tenant used by scripts/e2e-staging. Changing this
// allowlist requires verifying the new project and QA business first.
export const STAGING_CERTIFICATION_TARGET = Object.freeze({
  projectRef: 'ucbtjcurawxjwjdvvcvj',
  url: 'https://ucbtjcurawxjwjdvvcvj.supabase.co',
  businessId: 'a57b1c20-0f4e-4a6b-9d31-7c2e5f8a41d0',
  businessSlug: 'la-taba-staging',
});

export const STAGING_CERTIFICATION_CONFIRMATION = 'I_UNDERSTAND_THIS_MUTATES_STAGING';

export function assertStagingCertificationTarget({ supabaseUrl, businessId, confirmation }) {
  if (confirmation !== STAGING_CERTIFICATION_CONFIRMATION) {
    throw new Error('STAGING_CERTIFICATION_CONFIRMATION_REQUIRED');
  }
  // Exact comparison intentionally rejects custom domains, credentials, paths,
  // query strings, retired staging projects and both production projects.
  if (supabaseUrl !== STAGING_CERTIFICATION_TARGET.url) {
    throw new Error('STAGING_CERTIFICATION_PROJECT_REJECTED');
  }
  if (businessId !== STAGING_CERTIFICATION_TARGET.businessId) {
    throw new Error('STAGING_CERTIFICATION_QA_BUSINESS_REJECTED');
  }
}

async function readIdentityRow(client, table, columns, key, value) {
  try {
    const { data, error } = await client.from(table).select(columns).eq(key, value)
      .abortSignal(AbortSignal.timeout(15_000)).maybeSingle();
    if (error || !data) throw new Error('unverified');
    return data;
  } catch {
    // Backend errors can contain request details. Do not echo credentials or
    // raw responses from a privileged client into certification evidence.
    throw new Error('STAGING_CERTIFICATION_IDENTITY_UNVERIFIED');
  }
}

/** Read-only preflight; callers must await this before their first mutation. */
export async function verifyStagingCertificationIdentity(client, target) {
  assertStagingCertificationTarget(target);
  const business = await readIdentityRow(
    client, 'businesses', 'id,slug,is_active', 'id', target.businessId,
  );
  if (business.id !== STAGING_CERTIFICATION_TARGET.businessId
    || business.slug !== STAGING_CERTIFICATION_TARGET.businessSlug
    || business.is_active !== true) {
    throw new Error('STAGING_CERTIFICATION_QA_IDENTITY_MISMATCH');
  }
  const paymentSettings = await readIdentityRow(
    client, 'business_payment_settings', 'business_id,environment', 'business_id', target.businessId,
  );
  if (paymentSettings.business_id !== STAGING_CERTIFICATION_TARGET.businessId
    || paymentSettings.environment !== 'test') {
    throw new Error('STAGING_CERTIFICATION_TEST_PAYMENTS_REQUIRED');
  }
  return STAGING_CERTIFICATION_TARGET;
}
