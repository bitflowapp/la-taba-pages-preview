import { conToken } from './lib/supabase-cli-token.mjs';

const ref = 'ucbtjcurawxjwjdvvcvj';
const businessId = 'a57b1c20-0f4e-4a6b-9d31-7c2e5f8a41d0';

export async function checkOAuthState() {
  return conToken(async token => {
    const query = async (sql) => {
      const res = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: sql })
      });
      return res.json();
    };

    const headers = { Authorization: `Bearer ${token}` };
    const logsSql = encodeURIComponent("select timestamp, event_message from edge_logs where event_message like '%mercadopago-oauth-callback%' order by timestamp desc limit 5");
    const logsRes = await fetch(`https://api.supabase.com/v1/projects/${ref}/analytics/endpoints/logs.all?sql=${logsSql}`, { headers });
    const logs = logsRes.ok ? await logsRes.json() : null;

    const connections = await query(`SELECT * FROM public.mp_seller_connections WHERE business_id = '${businessId}';`);
    const settings = await query(`SELECT * FROM public.business_payment_settings WHERE business_id = '${businessId}';`);
    const states = await query(`SELECT * FROM public.mp_oauth_states WHERE business_id = '${businessId}' ORDER BY created_at DESC LIMIT 3;`);

    return { logs, connections, settings, states };
  });
}

const res = await checkOAuthState();
console.log(JSON.stringify(res, null, 2));
