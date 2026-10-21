import { conToken } from '../lib/supabase-cli-token.mjs';
import { assertRecoveryTarget, assertRecoveryOrganization } from './plan.mjs';

// Every write is confined to a receipt-bound project in the dedicated Free org.
export async function withRecoveryProject(target, action) {
  assertRecoveryTarget(target);
  return conToken(async token => {
    const headers = { Authorization: `Bearer ${token}`, 'content-type': 'application/json' };
    const base = `https://api.supabase.com/v1/projects/${target.projectRef}`;
    const decode = async response => {
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        const message = String(body.message || body.error || 'Provider request failed')
          .replace(/(?:sbp_|sb_secret_|APP_USR-|TEST-)[A-Za-z0-9_-]+/g, '[redacted]').slice(0, 1500);
        throw new Error(`Recovery HTTP ${response.status}: ${message}`);
      }
      return body;
    };
    const organization = await decode(await fetch(`https://api.supabase.com/v1/organizations/${target.organizationId}`, {
      headers, signal: AbortSignal.timeout(15000),
    }));
    assertRecoveryOrganization(target, organization);
    const request = async (suffix, init = {}) => {
      if (!/^\/[a-z0-9/?=&_-]+$/i.test(suffix)) throw new Error('Invalid project API suffix');
      const requestHeaders = new Headers({ ...headers, ...init.headers });
      if (init.body instanceof FormData) requestHeaders.delete('content-type');
      return decode(await fetch(base + suffix, { ...init, headers: requestHeaders,
        signal: AbortSignal.timeout(150000) }));
    };
    const project = await decode(await fetch(base, { headers, signal: AbortSignal.timeout(15000) }));
    assertRecoveryTarget(target, project);
    const query = query => request('/database/query', { method: 'POST', body: JSON.stringify({ query }) });
    return action({ request, query, project, organization });
  });
}
