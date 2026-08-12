/**
 * Ensayos hostiles de la capa de identidad contra una base PostgreSQL real y
 * descartable.
 *
 * Levanta una base efímera en un contenedor PROPIO, le aplica la cadena
 * completa de migraciones DESDE VACÍO —que es también la prueba de que PROD
 * puede arrancar sin copiar nada de staging— y corre
 * `supabase/tests/identity_rbac_drills.local.sql`: cada intento hostil se hace
 * de verdad contra el motor, con los mismos claims que pone PostgREST.
 *
 *   TABA_LOCAL_IDENTITY_DB=1 node scripts/run-identity-rbac-drills.mjs
 *
 * Por qué un contenedor propio y no el stack local que ya esté corriendo: para
 * instalar pg_cron hay que apuntar el GUC `cron.database_name` del CLÚSTER a la
 * base efímera y reiniciar el servidor. Hacer eso sobre el stack de otra sesión
 * le reinicia la base abajo de los pies.
 *
 * Nunca toca staging ni producción: sólo habla con el contenedor nombrado.
 */
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

if (process.env.TABA_LOCAL_IDENTITY_DB !== '1') {
  console.error('Este arnés es local y descartable. Exigimos TABA_LOCAL_IDENTITY_DB=1 para correrlo.');
  process.exit(2);
}

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dockerCommand = process.platform === 'win32' ? 'docker.exe' : 'docker';
const container = process.env.TABA_IDENTITY_DB_CONTAINER || 'taba2-identity-db';
const image = process.env.TABA_IDENTITY_DB_IMAGE || 'public.ecr.aws/supabase/postgres:17.6.1.143';
// De acá sólo se LEE el esquema de plataforma (auth y storage), que la imagen
// desnuda no trae completo. Un pg_dump no muta nada.
const platformContainer = process.env.TABA_IDENTITY_PLATFORM_CONTAINER || 'supabase_db_la-taba-pages';
const database = (process.env.TABA_IDENTITY_DB_NAME || `taba2_identity_${process.pid}`).toLowerCase();
const keep = process.env.TABA_IDENTITY_DB_KEEP === '1';
const drillFile = process.argv[2] || path.join('supabase', 'tests', 'identity_rbac_drills.local.sql');
const CRON_CONF = '/etc/postgresql-custom/conf.d/pg_cron.conf';

const migrations = fs.readdirSync(path.join(root, 'supabase', 'migrations'))
  .filter((name) => name.endsWith('.sql'))
  .sort()
  .map((name) => path.join(root, 'supabase', 'migrations', name));

function docker(args, options = {}) {
  return execFileSync(dockerCommand, args, {
    cwd: root,
    encoding: 'utf8',
    stdio: options.input !== undefined ? ['pipe', 'inherit', 'inherit'] : 'inherit',
    input: options.input,
  });
}

function psql(sql, targetDatabase = database) {
  docker(['exec', '-i', container, 'psql', '-U', 'postgres', '-d', targetDatabase, '-v', 'ON_ERROR_STOP=1', '-q'], { input: sql });
}

function psqlCapture(sql, targetDatabase = database) {
  return execFileSync(dockerCommand, [
    'exec', '-i', container, 'psql', '-U', 'postgres', '-d', targetDatabase,
    '-v', 'ON_ERROR_STOP=1', '-q', '-X', '-A', '-t',
  ], { cwd: root, encoding: 'utf8', input: sql, stdio: ['pipe', 'pipe', 'inherit'] });
}

function containerState() {
  const probe = spawnSync(dockerCommand, ['inspect', '--format', '{{.State.Running}}', container], { encoding: 'utf8' });
  if (probe.status !== 0) return 'missing';
  return probe.stdout.trim() === 'true' ? 'running' : 'stopped';
}

function waitForDatabase(timeoutMs = 180000) {
  const started = Date.now();
  for (;;) {
    const probe = spawnSync(dockerCommand, ['exec', container, 'pg_isready', '-U', 'postgres'], { encoding: 'utf8' });
    if (probe.status === 0) return;
    if (Date.now() - started > timeoutMs) throw new Error('la base local no llegó a aceptar conexiones');
  }
}

function ensureContainer() {
  const state = containerState();
  if (state === 'missing') {
    console.log(`· creando el contenedor ${container}`);
    execFileSync(dockerCommand, [
      'run', '-d', '--name', container,
      '-e', 'POSTGRES_HOST_AUTH_METHOD=trust',
      '-e', 'POSTGRES_PASSWORD=postgres',
      image,
    ], { cwd: root, stdio: 'pipe' });
  } else if (state === 'stopped') {
    execFileSync(dockerCommand, ['start', container], { cwd: root, stdio: 'pipe' });
  }
  waitForDatabase();
}

function setClusterCronDatabase(name) {
  const value = name === null ? 'postgres' : name;
  execFileSync(dockerCommand, ['exec', '-u', 'root', container, 'sh', '-c',
    `sed -i "s|^cron.database_name = .*|cron.database_name = '${value}'|" ${CRON_CONF}`], { cwd: root, stdio: 'pipe' });
  execFileSync(dockerCommand, ['restart', container], { cwd: root, stdio: 'pipe' });
  waitForDatabase();
  const active = execFileSync(dockerCommand, ['exec', container, 'psql', '-U', 'postgres', '-d', 'postgres', '-A', '-t', '-c',
    'show cron.database_name;'], { cwd: root, encoding: 'utf8' }).trim();
  if (active !== value) throw new Error(`el fixture de pg_cron no tomó: cron.database_name=${active} esperado=${value}`);
}

function loadPlatformSchemas() {
  const cache = process.env.TABA_IDENTITY_PLATFORM_DUMP
    || path.join(process.env.TEMP || root, 'taba2-platform-schema.sql');
  let dump = '';
  try {
    dump = execFileSync(dockerCommand, [
      'exec', platformContainer, 'pg_dump', '-U', 'postgres', '-d', 'postgres', '--schema-only',
      '--schema=auth', '--schema=storage', '--no-owner', '--no-privileges',
    ], { cwd: root, encoding: 'utf8', maxBuffer: 128 * 1024 * 1024 });
    fs.writeFileSync(cache, dump, 'utf8');
  } catch (error) {
    if (!fs.existsSync(cache)) {
      throw new Error(
        `no se pudo leer el esquema de plataforma de ${platformContainer} ni hay copia en ${cache}. `
        + 'Levantá un stack de Supabase local (docker start) o apuntá TABA_IDENTITY_PLATFORM_DUMP a un volcado.',
      );
    }
    console.log(`· ${platformContainer} no está disponible: se usa la copia de ${cache}`);
    dump = fs.readFileSync(cache, 'utf8');
  }
  psql(dump);
}

let failed = false;

try {
  ensureContainer();
  setClusterCronDatabase(database);
  docker(['exec', container, 'dropdb', '-U', 'postgres', '--if-exists', '--force', database]);
  docker(['exec', container, 'createdb', '-U', 'postgres', database]);

  // Los roles que PostgREST usa para hablar con la base. La imagen desnuda ya
  // los trae; se crean igual por si el arnés corre contra otra imagen.
  psql(`
    do $$
    begin
      if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin noinherit; end if;
      if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin noinherit; end if;
      if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role nologin noinherit bypassrls; end if;
    end
    $$;
    create schema if not exists extensions;
    grant usage on schema extensions to anon, authenticated, service_role;
    create extension if not exists pgcrypto with schema extensions;
    create schema if not exists vault;

    -- Privilegios por defecto, como los deja Supabase al crear un proyecto.
    --
    -- Sin esto, en la base efímera nadie salvo el dueño tenía permisos sobre
    -- las tablas nuevas, y eso ocultó un defecto real: el guard de membresías
    -- bloqueaba a service_role, que es la única vía para crear el primer owner
    -- de un entorno. El ensayo daba verde porque acá service_role tampoco tenía
    -- el grant, así que fallaba por el motivo equivocado. Una base de pruebas
    -- que no reproduce los permisos del entorno real no prueba los permisos.
    grant usage on schema public to anon, authenticated, service_role;
    alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
    alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
    alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
  `);

  loadPlatformSchemas();

  console.log(`· aplicando ${migrations.length} migraciones sobre una base vacía`);
  for (const migration of migrations) psql(fs.readFileSync(migration));

  const summary = JSON.parse(psqlCapture(`
    select json_build_object(
      'identity_tables', (select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace
                           where n.nspname='public' and c.relkind='r' and c.relname like 'identity\\_%'),
      'identity_functions', (select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace
                              where n.nspname='public' and p.proname like 'identity\\_%'),
      'admin_role_allowed', (
        select count(*) > 0 from pg_constraint
         where conname = 'business_members_role_check'
           and pg_get_constraintdef(oid) like '%admin%')
    )::text;
  `).trim());
  console.log(`· identidad instalada: ${summary.identity_tables} tablas, ${summary.identity_functions} funciones, rol admin habilitado=${summary.admin_role_allowed}`);

  const output = psqlCapture(fs.readFileSync(path.join(root, drillFile), 'utf8'));
  process.stdout.write(output);

  // Segunda fase, con la semantica de conexion de produccion.
  //
  // PostgREST no entra como `postgres`: entra como `authenticator` y hace
  // `SET LOCAL ROLE authenticated`. Eso importa porque el trigger que cierra
  // la escritura de membresias mira `session_user` para dejar pasar a las
  // migraciones y a los fixtures. Con `set role` desde postgres, session_user
  // sigue siendo postgres y el trigger dejaria pasar el intento hostil: el
  // ensayo se veria verde por el motivo equivocado. Acá se abre una conexion
  // de verdad con un rol de login que no es privilegiado.
  psql(`
    do $$
    begin
      if not exists (select 1 from pg_roles where rolname = 'taba_drill_authenticator') then
        create role taba_drill_authenticator login noinherit;
      end if;
    end
    $$;
    grant authenticated to taba_drill_authenticator;
    grant connect on database ${database} to taba_drill_authenticator;
    grant usage on schema identity_drill to taba_drill_authenticator, authenticated;
    grant select on identity_drill.fixture to taba_drill_authenticator, authenticated;
  `);

  // El intento hostil DEBE fallar, asi que psql sale con codigo distinto de
  // cero: eso no es un error del arnes. Lo que decide es la sonda posterior.
  try {
    execFileSync(dockerCommand, [
      'exec', '-i', container, 'psql', '-U', 'taba_drill_authenticator', '-d', database,
      '-q', '-X', '-A', '-t',
    ], {
      cwd: root,
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
      input: `
        set role authenticated;
        select set_config('request.jwt.claims',
          json_build_object('sub', (select value from identity_drill.fixture where key = 'rider'),
                            'role', 'authenticated', 'is_anonymous', false)::text, false);
        insert into public.business_members (business_id, user_id, role, is_active)
        select (select value from identity_drill.fixture where key = 'business')::uuid,
               (select value from identity_drill.fixture where key = 'rider')::uuid,
               'owner', true;
      `,
    });
  } catch (hostile) {
    // Rechazado, que es lo esperado.
  }

  const lockdownProbe = psqlCapture(`
    select case when exists (
      select 1 from public.business_members bm
       where bm.business_id = (select value from identity_drill.fixture where key = 'business')::uuid
         and bm.user_id = (select value from identity_drill.fixture where key = 'rider')::uuid
         and bm.role = 'owner'
    ) then 'ESCALO' else 'CONTENIDO' end;
  `).trim();

  const lockdownLine = lockdownProbe === 'CONTENIDO'
    ? `OK    ${'una conexion tipo PostgREST tampoco puede escribir membresias'.padEnd(66, '.')}  el rider sigue siendo rider`
    : `FALLA ${'una conexion tipo PostgREST tampoco puede escribir membresias'.padEnd(66, '.')}  ESCALO A OWNER`;
  console.log(lockdownLine);

  const allOutput = `${output}\n${lockdownLine}`;
  const failures = allOutput.split('\n').filter((line) => line.startsWith('FALLA'));
  const passes = allOutput.split('\n').filter((line) => line.startsWith('OK')).length;
  if (failures.length > 0 || passes === 0) {
    failed = true;
    console.error(`\n${failures.length} ensayo(s) fallaron sobre ${passes + failures.length}.`);
  } else {
    console.log(`\n${passes} ensayos hostiles pasaron. Ninguno pudo escalar privilegios.`);
  }
} catch (error) {
  failed = true;
  console.error(error.message || error);
} finally {
  try {
    setClusterCronDatabase(null);
    if (!keep) {
      docker(['exec', container, 'dropdb', '-U', 'postgres', '--if-exists', '--force', database]);
    } else {
      console.log(`· base conservada: ${database} en ${container}`);
    }
  } catch (cleanupError) {
    console.error(`· la limpieza no terminó: ${cleanupError.message || cleanupError}`);
  }
}

process.exit(failed ? 1 : 0);
