// Cloudflare OAuth login (same public client and PKCE flow as `wrangler login`) that stores the session
// OUTSIDE C: and writes it atomically. Opens nothing by itself: it prints the authorization URL and waits
// for the browser redirect on localhost:8976. Tokens are never printed.
import { createHash, randomBytes } from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';

export const SESSION_FILE = process.env.TABA_CF_SESSION || 'D:/work/taba-cf-session/session.json';
const CLIENT = '54d11594-84e4-41aa-b438-e81b8fa78ee7';
const REDIRECT = 'http://localhost:8976/oauth/callback';
const SCOPES = 'account:read user:read pages:write offline_access';

export function saveSession(tokens) {
  fs.mkdirSync(path.dirname(SESSION_FILE), { recursive: true });
  const tmp = SESSION_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify({ ...tokens, savedAt: new Date().toISOString() }));
  fs.renameSync(tmp, SESSION_FILE); // atomic: a failed write never truncates the previous session
}

if (import.meta.url === new URL(process.argv[1], 'file:///').href || process.argv[1].endsWith('cloudflare-login.mjs')) {
  const verifier = randomBytes(32).toString('base64url');
  const challenge = createHash('sha256').update(verifier).digest('base64url');
  const state = randomBytes(16).toString('base64url');
  const authorize = 'https://dash.cloudflare.com/oauth2/auth?' + new URLSearchParams({ response_type: 'code', client_id: CLIENT,
    redirect_uri: REDIRECT, scope: SCOPES, state, code_challenge: challenge, code_challenge_method: 'S256' });
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost:8976');
    if (url.pathname !== '/oauth/callback') { res.writeHead(404).end(); return; }
    try {
      if (url.searchParams.get('state') !== state) throw new Error('state mismatch');
      if (url.searchParams.get('error')) throw new Error('authorization denied: ' + url.searchParams.get('error'));
      const response = await fetch('https://dash.cloudflare.com/oauth2/token', { method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ grant_type: 'authorization_code', code: url.searchParams.get('code'), redirect_uri: REDIRECT,
          client_id: CLIENT, code_verifier: verifier }) });
      const token = await response.json();
      if (!response.ok || !token.access_token) throw new Error('token exchange failed: ' + (token.error || response.status));
      saveSession({ access_token: token.access_token, refresh_token: token.refresh_token,
        expires_at: Date.now() + token.expires_in * 1000, scope: token.scope });
      res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' }).end('Sesión de Cloudflare guardada. Podés cerrar esta pestaña.');
      console.log('session saved to', SESSION_FILE);
    } catch (error) {
      res.writeHead(500, { 'content-type': 'text/plain; charset=utf-8' }).end('Error: ' + error.message);
      console.log('login failed:', error.message);
    }
    setTimeout(() => process.exit(0), 300);
  });
  server.listen(8976, '127.0.0.1', () => console.log('AUTHORIZE_URL=' + authorize));
  setTimeout(() => { console.log('timeout waiting for authorization'); process.exit(2); }, 10 * 60 * 1000);
}
