// Reads only /users/me. No checkout, payment, token exchange or account mutation.
// The credential arrives through stdin, never argv, environment files or logs.
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export async function checkTestCredential(input, request = fetch) {
  if (input.applicationId !== '2691240967769590' || input.source !== 'test_access_token' ||
    typeof input.testAccessToken !== 'string' ||
    !/^(?:APP_USR|TEST)-[A-Za-z0-9_-]{20,}$/.test(input.testAccessToken)) {
    throw new Error('Only the TABA2 Staging test credential is accepted');
  }
  const response = await request('https://api.mercadopago.com/users/me', {
    method: 'GET', headers: { Authorization: `Bearer ${input.testAccessToken}` },
    signal: AbortSignal.timeout(10000),
  });
  const body = await response.json().catch(() => ({}));
  return {
    applicationId: input.applicationId, httpStatus: response.status,
    authenticated: response.ok, countryArgentina: body.site_id === 'MLA',
    testUser: Array.isArray(body.tags) && body.tags.includes('test_user'),
    // Authentication is not proof of OAuth permission, checkout capability or
    // webhook delivery. Those need the new hosted project and a test seller.
    oauthVerified: false, checkoutVerified: false, webhookVerified: false,
    realPaymentsAuthorized: false,
  };
}

async function main() {
  if (!process.argv.includes('--stdin')) throw new Error('Explicit stdin mode required');
  const terminal = Boolean(process.stdin.isTTY);
  if (terminal) process.stdin.setRawMode(true);
  process.stdin.setEncoding('utf8');
  process.stdout.write('AWAITING_TEST_CREDENTIALS\n');
  try {
    const input = await new Promise((resolve, reject) => {
      let bytes = '';
      const timer = setTimeout(() => reject(new Error('Input timed out')), 60000);
      const onData = chunk => {
        bytes += chunk;
        if (bytes.length > 8000) { clearTimeout(timer); reject(new Error('Input too large')); }
        else if (/[\r\n]/.test(bytes)) {
          clearTimeout(timer); process.stdin.off('data', onData);
          try { resolve(JSON.parse(bytes.slice(0, bytes.search(/[\r\n]/)))); }
          catch { reject(new Error('Invalid input')); }
        }
      };
      process.stdin.on('data', onData);
    });
    console.log(JSON.stringify(await checkTestCredential(input)));
  } finally {
    if (terminal) process.stdin.setRawMode(false);
    process.stdin.pause();
  }
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(() => { console.error('Test credential verification unavailable; no mutations attempted.'); process.exitCode = 1; });
}
