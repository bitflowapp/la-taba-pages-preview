// Local test adapter for PostgreSQL distributions that ship the server without psql.
// SQL arrives on stdin. This cannot select a hosted database or load credentials.
import pg from 'pg';
const args = process.argv.slice(2);
const value = flag => args[args.indexOf(flag) + 1];
const host = value('-h'), port = Number(value('-p')), database = value('-d');
if (host !== '127.0.0.1' || !Number.isInteger(port) || port < 1024 || port > 65535 ||
    !(database === 'postgres' || /^taba_local_[a-z0-9_]+$/.test(database))) throw Error('LOCAL_TEST_DATABASE_ONLY');
let sql = '';
for await (const part of process.stdin) sql += part;
const client = new pg.Client({ host, port, database, user: 'postgres', connectionTimeoutMillis: 5000 });
try {
  await client.connect();
  const statements = /^\s*(drop|create) database/i.test(sql) ? sql.split(';').filter(s => s.trim()) : [sql];
  for (const statement of statements) {
    const result = await client.query(statement);
    for (const response of Array.isArray(result) ? result : [result]) {
      for (const row of response.rows || []) console.log(Object.values(row).map(v =>
        v === null ? '' : typeof v === 'object' ? JSON.stringify(v) : String(v)).join('|'));
    }
  }
} catch (error) {
  console.error(`${error.code || 'ERROR'}: ${error.message}`);
  process.exitCode = 1;
} finally { await client.end(); }
