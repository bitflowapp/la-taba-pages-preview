/*
 * Pila descartable del banco de cobros: PostgreSQL de Supabase (la MISMA imagen, por digest, que usa la CI) +
 * PostgREST, en una red de Docker interna (sin salida a internet), con el esquema completo de supabase/migrations.
 *
 * El esquema se construye exactamente como el clúster «final» de scripts/run-release-v5-db.mjs (que es como se
 * construyen hoy QA y la producción nueva): migraciones viejas con la plataforma simulada, EXPAND como superusuario,
 * privilegios de la plataforma administrada, el interlock y todas las posteriores como `postgres` sin superusuario.
 * Si aquel orden cambia, este también: las constantes se importan de scripts/release-v5/model.mjs.
 *
 * Nada de esto toca un proyecto alojado: la base vive en tmpfs, la red es `--internal` (en Docker Desktop: puertos sólo en
 * 127.0.0.1 y sin DNS externo, ver PUBLISH_PORTS) y los contenedores se
 * borran al terminar (también si el proceso falla).
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { randomBytes, randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import pg from 'pg';

import { ROOT, EXPAND } from '../release-v5/model.mjs';

export const POSTGRES_IMAGE = 'public.ecr.aws/supabase/postgres:17.6.1.166';
const POSTGRES_DIGEST = 'sha256:b3bfedb107413abb3b8cb0d0874b0414a1dceb3d55bc0c778de6ad22d1f7dc86';
const POSTGRES_SOURCES = [`ghcr.io/supabase/postgres@${POSTGRES_DIGEST}`, `public.ecr.aws/supabase/postgres@${POSTGRES_DIGEST}`];
// PostgREST de la línea 12, la que corre en los proyectos alojados de Supabase.
export const POSTGREST_IMAGE = 'public.ecr.aws/supabase/postgrest:v12.2.12';
const POSTGREST_SOURCES = ['public.ecr.aws/supabase/postgrest:v12.2.12', 'postgrest/postgrest:v12.2.12'];

// Los mismos cortes que scripts/bootstrap-a1-v2-local.mjs y scripts/run-release-v5-db.mjs.
const OLD_MIGRATIONS_BEFORE = EXPAND[0].slice(0, 14);
const INTERLOCK = EXPAND[3];
const WORKER_VAULT_SECRETS = "select vault.create_secret('fixture-worker-hmac-only-for-local-tests','taba_payment_worker_hmac_secret'); select vault.create_secret('https://wwcpogltfgzgkrlilbcd.supabase.co/functions/v1/mercadopago-payment-worker','taba_payment_worker_url')";
const MANAGED_PLATFORM_PRIVILEGES = `alter database postgres owner to postgres;
    alter table cron.job owner to supabase_admin;
    revoke all on cron.job from postgres; grant select on cron.job to postgres;
    alter function cron.alter_job(bigint,text,text,text,text,boolean) owner to supabase_admin;
    grant execute on function cron.alter_job(bigint,text,text,text,text,boolean) to postgres;
    alter table net.http_request_queue owner to supabase_admin;
    alter table net._http_response owner to supabase_admin;
    grant set on parameter session_replication_role to postgres;
    grant anon, authenticated, service_role to postgres with admin option;
    alter role postgres nosuperuser bypassrls createdb createrole;`;

// En Linux (la CI) el host alcanza la IP del contenedor dentro de una red `--internal`. En Docker Desktop (Windows/macOS) las
// IP de los contenedores viven dentro de una máquina virtual: el host sólo los alcanza por puertos publicados, y Docker no
// publica puertos de redes internas. Ahí la red es normal, los puertos van SOLO a 127.0.0.1 y los contenedores no resuelven
// nombres externos (--dns 127.0.0.1): el cron de la base está apagado y ninguna prueba necesita salir a internet.
export const PUBLISH_PORTS = process.platform !== 'linux' || process.env.TABA_BENCH_PUBLISH_PORTS === '1';

const docker = (args, options = {}) => execFileSync('docker', args, {
  cwd: ROOT, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024, stdio: ['pipe', 'pipe', 'pipe'], ...options,
});

async function ensureImage(image, sources, digest) {
  try { docker(['image', 'inspect', image]); return; } catch { /* se baja abajo */ }
  // Como run-release-v5-db.mjs: varios orígenes y reintentos (ECR Public corta pulls anónimos por volumen).
  for (let attempt = 1; attempt <= 4; attempt += 1) {
    for (const source of sources) {
      try {
        docker(['pull', source]);
        if (source !== image) docker(['tag', source, image]);
        if (digest) assert.ok(docker(['image', 'inspect', '--format', '{{json .RepoDigests}}', image]).includes(digest), 'IMAGE_DIGEST_MISMATCH');
        return;
      } catch (error) {
        console.warn(`docker pull ${source} (intento ${attempt}/4): ${String(error.stderr || error.message).trim().split(/\r?\n/).pop()}`);
      }
    }
    await new Promise((resolve) => setTimeout(resolve, attempt * 5000));
  }
  throw new Error(`IMAGE_UNAVAILABLE: ${image}`);
}

function containerIp(name, network) {
  const ip = docker(['inspect', '-f', `{{(index .NetworkSettings.Networks "${network}").IPAddress}}`, name]).trim();
  assert.match(ip, /^\d+\.\d+\.\d+\.\d+$/, `sin IP para ${name}`);
  return ip;
}

function psql(container, sql, { user = 'postgres', searchPath = true } = {}) {
  return docker(['exec', '-i', container, 'psql', '-h', '/tmp', '-U', user, '-d', 'postgres', '-X', '-q', '-v', 'ON_ERROR_STOP=1'],
    { input: (searchPath ? 'set search_path=public,extensions;\n' : '') + sql });
}

const migrationSql = (name) => fs.readFileSync(path.join(ROOT, 'supabase/migrations', name), 'utf8');

/**
 * Levanta la pila. `egress: true` crea una red con salida (sólo para el modo contra el sandbox real de Mercado
 * Pago, donde el host de funciones necesita llegar a api.mercadopago.com; la base nunca la necesita).
 */
export async function startPaymentStack({ egress = false, log = () => {} } = {}) {
  await ensureImage(POSTGRES_IMAGE, POSTGRES_SOURCES, POSTGRES_DIGEST);
  await ensureImage(POSTGREST_IMAGE, POSTGREST_SOURCES, null);
  const id = `${process.pid}-${randomUUID().slice(0, 8)}`;
  const network = `taba-pay-bench-${id}`;
  const db = `taba-pay-bench-db-${id}`;
  const rest = `taba-pay-bench-rest-${id}`;
  const password = randomBytes(18).toString('base64url');
  const jwtSecret = randomBytes(48).toString('base64url');
  const created = { network: false, db: false, rest: false };
  const stop = () => {
    for (const name of [rest, db]) { try { docker(['rm', '-f', '-v', name]); } catch { /* ya no existe */ } }
    if (created.network) { try { docker(['network', 'rm', network]); } catch { /* ya no existe */ } }
  };
  try {
    docker(['network', 'create', ...(egress || PUBLISH_PORTS ? [] : ['--internal']), network]);
    created.network = true;
    // Igual que startCluster() de run-release-v5-db.mjs, más: escucha en la red interna con contraseña (scram).
    docker(['run', '-d', '--name', db, '--network', network, ...(PUBLISH_PORTS ? ['-p', '127.0.0.1::5432', '--dns', '127.0.0.1'] : []), '--user', 'postgres',
      '--tmpfs', '/var/lib/postgresql/data:rw,size=1536m,uid=100,gid=101', '--tmpfs', '/tmp:rw,size=128m',
      '--tmpfs', '/etc/postgresql-custom:rw,size=1m,uid=100,gid=101',
      '--entrypoint', '/bin/sh', POSTGRES_IMAGE, '-c',
      'initdb -D /var/lib/postgresql/data/db -U supabase_admin -A trust >/tmp/init.log' +
      ' && echo "host all all 0.0.0.0/0 scram-sha-256" >> /var/lib/postgresql/data/db/pg_hba.conf' +
      ' && postgres -D /var/lib/postgresql/data/db -k /tmp -c listen_addresses=* -c max_connections=200' +
      ' -c shared_preload_libraries=pg_cron,pg_net,supabase_vault -c vault.getkey_script=/usr/lib/postgresql/bin/pgsodium_getkey.sh' +
      ' -c cron.database_name=postgres -c cron.launch_active_jobs=off']);
    created.db = true;
    for (let attempt = 0; ; attempt += 1) {
      try { docker(['exec', db, 'pg_isready', '-h', '/tmp', '-U', 'supabase_admin']); break; } catch (error) {
        if (attempt === 150) throw error;
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
    }
    psql(db, 'create role postgres login superuser createdb createrole', { user: 'supabase_admin', searchPath: false });
    psql(db, 'create extension pg_cron with schema pg_catalog; grant usage on schema cron to postgres; grant select on cron.job to postgres; grant execute on all functions in schema cron to postgres',
      { user: 'supabase_admin', searchPath: false });
    // scripts/bootstrap-a1-v2-local.mjs, paso por paso.
    psql(db, `create role anon; create role authenticated; create role service_role bypassrls;
      create role supabase_auth_admin; create role supabase_storage_admin;
      create schema extensions; create extension pgcrypto with schema extensions;
      grant usage on schema extensions to anon,authenticated,service_role;
      create schema vault;`);
    psql(db, fs.readFileSync(path.join(ROOT, 'supabase/tests/fixtures/a1-platform-auth.sql'), 'utf8'));
    psql(db, `create schema if not exists storage;
      create table if not exists storage.buckets(id text primary key,name text,created_at timestamptz default now(),updated_at timestamptz default now(),public boolean,file_size_limit bigint,allowed_mime_types text[]);
      create table if not exists storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text,name text);
      alter table storage.objects enable row level security;`);
    psql(db, `grant usage on schema auth,storage to anon,authenticated,service_role;
      grant all on all tables in schema auth,storage to service_role;
      alter default privileges in schema public grant all on tables to service_role;
      alter default privileges in schema public grant all on sequences to service_role;`);
    // Diferencia deliberada con bootstrap-a1-v2-local.mjs: el banco entra por PostgREST con los roles del JWT, así que
    // necesita los privilegios por defecto REALES de la plataforma alojada (todo objeto nuevo de `postgres` en public
    // queda otorgado a anon, authenticated y service_role; las migraciones revocan lo que no corresponde). Medido en
    // producción: docs/PRODUCTION-SUPABASE-SECURITY.md, «privilegios por defecto del schema». Sin esto, service_role
    // perdería funciones que las migraciones sólo le quitan a public/anon/authenticated (p. ej. business_is_open).
    psql(db, `grant usage on schema public to anon, authenticated, service_role;
      alter default privileges for role postgres in schema public grant all on tables to anon, authenticated, service_role;
      alter default privileges for role postgres in schema public grant all on functions to anon, authenticated, service_role;
      alter default privileges for role postgres in schema public grant all on sequences to anon, authenticated, service_role;`);
    const all = fs.readdirSync(path.join(ROOT, 'supabase/migrations')).filter((name) => name.endsWith('.sql')).sort();
    const old = all.filter((name) => name.slice(0, 14) < OLD_MIGRATIONS_BEFORE);
    for (const name of old) psql(db, migrationSql(name));
    log(`OLD_MIGRATIONS=${old.length}`);
    // EXPAND como superusuario, con el search_path con el que se aplicaron en V5.
    for (const name of EXPAND.slice(0, 3)) psql(db, migrationSql(name));
    psql(db, WORKER_VAULT_SECRETS, { searchPath: false });
    // Ninguna migración lee el historial: alcanza con versión y nombre (el texto completo lo guarda run-release-v5-db).
    psql(db, 'create schema supabase_migrations; create table supabase_migrations.schema_migrations(version text primary key,name text,statements text[]);' +
      `insert into supabase_migrations.schema_migrations(version,name) values ${old.map((name) => `('${name.slice(0, 14)}','${name.slice(15, -4)}')`).join(',')};`,
    { searchPath: false });
    psql(db, MANAGED_PLATFORM_PRIVILEGES, { searchPath: false });
    psql(db, migrationSql(INTERLOCK), { searchPath: false });
    psql(db, `insert into supabase_migrations.schema_migrations(version,name,statements) values ('${INTERLOCK.slice(0, 14)}','${INTERLOCK.slice(15, -4)}',array['interlock'])`, { searchPath: false });
    const later = all.filter((name) => name.slice(0, 14) > INTERLOCK.slice(0, 14));
    for (const name of later) {
      psql(db, migrationSql(name), { searchPath: false });
      psql(db, `insert into supabase_migrations.schema_migrations(version,name,statements) values ('${name.slice(0, 14)}','${name.slice(15, -4).replaceAll("'", "''")}',array['bench'])`, { searchPath: false });
    }
    log(`MIGRATIONS_APPLIED=${old.length + EXPAND.length + later.length} (${all.length} en supabase/migrations)`);
    assert.equal(old.length + EXPAND.length + later.length, all.length, 'el banco aplicó exactamente las migraciones del repositorio');

    // El rol con el que PostgREST se conecta y cambia al rol del JWT, como en Supabase.
    psql(db, `create role authenticator noinherit login password '${password}';
      grant anon, authenticated, service_role to authenticator;`, { user: 'supabase_admin', searchPath: false });
    psql(db, `alter role postgres password '${password}'`, { user: 'supabase_admin', searchPath: false });
    const hostPort = (name, port) => {
      const mapped = docker(['port', name, `${port}/tcp`]).trim().split(/\r?\n/)[0] || '';
      const match = /127\.0\.0\.1:(\d+)$/.exec(mapped);
      assert.ok(match, `sin puerto publicado para ${name}:${port} (${mapped})`);
      return Number(match[1]);
    };
    const dbIp = PUBLISH_PORTS ? '127.0.0.1' : containerIp(db, network);
    const dbPort = PUBLISH_PORTS ? hostPort(db, 5432) : 5432;

    docker(['run', '-d', '--name', rest, '--network', network, ...(PUBLISH_PORTS ? ['-p', '127.0.0.1::3000', '-p', '127.0.0.1::3001', '--dns', '127.0.0.1'] : []),
      '-e', `PGRST_DB_URI=postgres://authenticator:${password}@${db}:5432/postgres`,
      '-e', 'PGRST_DB_SCHEMAS=public', '-e', 'PGRST_DB_ANON_ROLE=anon', '-e', 'PGRST_DB_EXTRA_SEARCH_PATH=public,extensions',
      '-e', 'PGRST_DB_MAX_ROWS=1000', '-e', `PGRST_JWT_SECRET=${jwtSecret}`, '-e', 'PGRST_ADMIN_SERVER_PORT=3001',
      '-e', 'PGRST_DB_POOL=20', POSTGREST_IMAGE]);
    created.rest = true;
    const restIp = PUBLISH_PORTS ? '127.0.0.1' : containerIp(rest, network);
    const restUrl = `http://${restIp}:${PUBLISH_PORTS ? hostPort(rest, 3000) : 3000}`;
    const adminUrl = `http://${restIp}:${PUBLISH_PORTS ? hostPort(rest, 3001) : 3001}`;
    for (let attempt = 0; ; attempt += 1) {
      try {
        const ready = await fetch(`${adminUrl}/ready`, { signal: AbortSignal.timeout(2000) });
        if (ready.ok) break;
      } catch { /* todavía arrancando */ }
      if (attempt === 200) throw new Error('POSTGREST_NOT_READY');
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    const pool = new pg.Pool({ host: dbIp, port: dbPort, user: 'postgres', password, database: 'postgres', max: 8 });
    pool.on('error', () => {});
    return {
      id, network, dbContainer: db, restContainer: rest, dbIp, restUrl, jwtSecret,
      query: (sql, params = []) => pool.query(sql, params),
      superuser: (sql) => psql(db, sql, { user: 'supabase_admin', searchPath: false }),
      async close() { await pool.end().catch(() => {}); stop(); },
    };
  } catch (error) {
    stop();
    throw error;
  }
}
