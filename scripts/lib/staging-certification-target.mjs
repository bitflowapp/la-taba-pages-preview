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

async function readGuardQuery(query, { required = true } = {}) {
  try {
    const { data, error, status } = await query.abortSignal(AbortSignal.timeout(15_000)).maybeSingle();
    if (error) {
      const reason = error.code === 'PGRST116' ? 'MULTIPLE_ROWS'
        : [401, 403, 500, 502, 503, 504].includes(status) ? `HTTP_${status}` : 'UPSTREAM_ERROR';
      throw new Error(`STAGING_CERTIFICATION_IDENTITY_UNVERIFIED:${reason}`);
    }
    if (required && !data) throw new Error('STAGING_CERTIFICATION_IDENTITY_UNVERIFIED:NOT_FOUND');
    return data;
  } catch (error) {
    if (/^STAGING_CERTIFICATION_IDENTITY_UNVERIFIED:(?:MULTIPLE_ROWS|HTTP_\d{3}|UPSTREAM_ERROR|NOT_FOUND)$/.test(error?.message)) {
      throw error;
    }
    // Backend errors can contain request details. Do not echo credentials or
    // raw responses from a privileged client into certification evidence.
    const reason = ['AbortError', 'TimeoutError'].includes(error?.name) ? 'TIMEOUT' : 'UPSTREAM_ERROR';
    throw new Error(`STAGING_CERTIFICATION_IDENTITY_UNVERIFIED:${reason}`);
  }
}

/** Read-only preflight; callers must await this before their first mutation. */
export async function verifyStagingCertificationIdentity(client, target) {
  assertStagingCertificationTarget(target);
  const business = await readGuardQuery(client.from('businesses')
    .select('id,slug,is_active').eq('id', target.businessId));
  if (business.id !== STAGING_CERTIFICATION_TARGET.businessId
    || business.slug !== STAGING_CERTIFICATION_TARGET.businessSlug
    || business.is_active !== true) {
    throw new Error('STAGING_CERTIFICATION_QA_IDENTITY_MISMATCH');
  }
  const paymentSettings = await readGuardQuery(client.from('business_payment_settings')
    .select('business_id,environment').eq('business_id', target.businessId));
  if (paymentSettings.business_id !== STAGING_CERTIFICATION_TARGET.businessId
    || paymentSettings.environment !== 'test') {
    throw new Error('STAGING_CERTIFICATION_TEST_PAYMENTS_REQUIRED');
  }
  return STAGING_CERTIFICATION_TARGET;
}

/** Refuse account takeover and terminal/wrong-tenant orders before actors exist. */
export async function verifyStagingCertificationOrder(client, target, publicCode) {
  assertStagingCertificationTarget(target);
  const order = await readGuardQuery(client.from('orders')
    .select('id,business_id,status,revision,total,subtotal,discount_total,origin,customer_user_id,assigned_rider_user_id')
    .eq('business_id', target.businessId).eq('public_code', publicCode), { required: false });
  if (!order) throw new Error('STAGING_CERTIFICATION_QA_ORDER_NOT_FOUND');
  if (order.business_id !== target.businessId) throw new Error('STAGING_CERTIFICATION_QA_BUSINESS_REJECTED');
  if (!['received', 'accepted', 'preparing', 'ready', 'assigned', 'picked_up', 'on_the_way', 'arrived'].includes(order.status)) {
    throw new Error('STAGING_CERTIFICATION_ORDER_STATE_REJECTED');
  }
  if (!order.customer_user_id) throw new Error('STAGING_CERTIFICATION_QA_CUSTOMER_REQUIRED');

  let timer;
  let customer;
  try {
    const result = await Promise.race([
      client.auth.admin.getUserById(order.customer_user_id),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error('timeout')), 15_000);
      }),
    ]);
    if (result.error) throw new Error('unverified');
    customer = result.data?.user;
  } catch {
    throw new Error('STAGING_CERTIFICATION_CUSTOMER_UNVERIFIED');
  } finally {
    clearTimeout(timer);
  }
  if (customer?.id !== order.customer_user_id || customer.is_anonymous !== true
    || customer.email || customer.phone) {
    throw new Error('STAGING_CERTIFICATION_ANONYMOUS_CUSTOMER_REQUIRED');
  }
  const membership = await readGuardQuery(client.from('business_members').select('id')
    .eq('user_id', order.customer_user_id).limit(1), { required: false });
  if (membership) throw new Error('STAGING_CERTIFICATION_CUSTOMER_MEMBERSHIP_REJECTED');
  return order;
}
