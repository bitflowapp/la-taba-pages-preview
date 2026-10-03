// Read/write helper against staging PostgREST with the service_role key.
// Runs only from this workstation; the key is never written to the repo.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const KEY = fs.readFileSync(path.join(os.tmpdir(), 'taba-sr.txt'), 'utf8').trim();
const BASE = 'https://ukxqbgswjlibmnjemrzd.supabase.co';

export async function rest(pathAndQuery, init = {}) {
  const response = await fetch(`${BASE}/rest/v1/${pathAndQuery}`, {
    ...init,
    headers: {
      apikey: KEY,
      Authorization: `Bearer ${KEY}`,
      'Content-Type': 'application/json',
      Prefer: init.prefer || 'count=exact',
      ...(init.headers || {}),
    },
  });
  const text = await response.text();
  let body = null;
  try { body = JSON.parse(text); } catch { body = text; }
  return { status: response.status, range: response.headers.get('content-range'), body };
}

export async function count(table, filter = '') {
  const r = await rest(`${table}?select=*${filter ? `&${filter}` : ''}&limit=0`);
  return r.range ? Number(String(r.range).split('/')[1]) : `ERR ${r.status} ${JSON.stringify(r.body)}`;
}

if (process.argv[2] === 'run') {
  const arg = process.argv[3];
  const r = await rest(arg);
  console.log(JSON.stringify(r.body, null, 2));
}
