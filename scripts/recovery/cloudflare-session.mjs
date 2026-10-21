// Reads the Cloudflare session saved by cloudflare-login.mjs, renewing it atomically when it is about to expire.
import fs from 'node:fs';
import { SESSION_FILE, saveSession } from './cloudflare-login.mjs';

export async function cloudflareToken() {
  const session = JSON.parse(fs.readFileSync(SESSION_FILE, 'utf8'));
  if (session.expires_at - Date.now() > 120_000) return session.access_token;
  const response = await fetch('https://dash.cloudflare.com/oauth2/token', { method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: session.refresh_token,
      client_id: '54d11594-84e4-41aa-b438-e81b8fa78ee7' }), signal: AbortSignal.timeout(30000) });
  const token = await response.json().catch(() => ({}));
  if (!response.ok || !token.access_token) throw new Error('Cloudflare session expired: run cloudflare-login.mjs');
  saveSession({ access_token: token.access_token, refresh_token: token.refresh_token || session.refresh_token,
    expires_at: Date.now() + token.expires_in * 1000, scope: token.scope || session.scope });
  return token.access_token;
}
