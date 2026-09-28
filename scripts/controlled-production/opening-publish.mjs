// Primera publicación (y cualquier carga masiva) con la planilla de apertura.
//
//   npm run opening:publish                                   # prueba, no escribe
//   npm run opening:publish -- --sheet <planilla.csv>          # prueba otra planilla
//   npm run opening:publish -- --apply --credential "CP OWNER MARCO PANEL"
//
// Aplica EXACTAMENTE el plan del importador comercial
// (`scripts/import-commercial-catalog.mjs --catalogo cp`), en UNA transacción:
// si una fila falla no se aplica ninguna. Lo hace con la sesión de un dueño o
// encargado del comercio —nunca con la clave de servicio—, así la base valida
// los permisos, verifica las fichas y deja registrado quién publicó.
//
// Seguro de repetir: aplicar dos veces la misma planilla no cambia nada la
// segunda vez (el plan sale vacío y no se escribe).
//
// La credencial se lee del Administrador de credenciales de Windows (usuario =
// correo, secreto = contraseña). Sin --credential, pide la contraseña sin
// mostrarla. Al terminar cierra la sesión que abrió.
import { spawnSync } from 'node:child_process';
import { createInterface } from 'node:readline/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createClient } from '@supabase/supabase-js';
import { leerSecreto } from '../e2e-production-sale/secretos-windows.mjs';
import {
  REAL_BUSINESS_SLUG, connectControlledProduction, presentFrom, readOpeningReadiness, readOption,
  renderOpeningLines, resolveBusiness,
} from './opening-tools.mjs';
import { DEFAULT_SHEET } from './opening-dry-run.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const OPTIONS = { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } };
export const APPLY_PHRASE = 'APLICAR';

export function parsePublishArgs(args = []) {
  const known = ['--sheet', '--apply', '--credential', '--as', '--confirm', '--business'];
  const unknown = args.filter((arg) => arg.startsWith('--') && !known.includes(arg));
  if (unknown.length) throw Error(`Flag desconocido: ${unknown[0]}`);
  const apply = args.includes('--apply');
  const credential = readOption(args, '--credential', '');
  const as = readOption(args, '--as', '');
  if (apply && !credential && !as) throw Error('--apply necesita --credential "<nombre>" o --as <correo del dueño o encargado>.');
  return {
    sheet: readOption(args, '--sheet', DEFAULT_SHEET),
    apply,
    credential,
    as,
    confirm: readOption(args, '--confirm', ''),
    business: readOption(args, '--business', REAL_BUSINESS_SLUG),
  };
}

function runImporter(sheet, businessId, extraArgs = [], env = {}) {
  return spawnSync(process.execPath, [path.join(ROOT, 'scripts/import-commercial-catalog.mjs'), path.resolve(sheet),
    '--catalogo', 'cp', '--business', businessId, ...extraArgs], {
    cwd: ROOT, encoding: 'utf8', timeout: 300_000, windowsHide: true, env: { ...process.env, ...env },
  });
}

async function hiddenPrompt(question) {
  if (!process.stdin.isTTY || typeof process.stdin.setRawMode !== 'function') {
    throw Error('No hay una terminal interactiva para pedir la contraseña: usá --credential.');
  }
  process.stdout.write(question);
  process.stdin.setRawMode(true);
  process.stdin.resume();
  let value = '';
  return new Promise((resolve, reject) => {
    const onData = (chunk) => {
      for (const char of chunk.toString('utf8')) {
        if (char === '\u0003') { cleanup(); reject(Error('Cancelado.')); return; }
        if (char === '\r' || char === '\n') { cleanup(); process.stdout.write('\n'); resolve(value); return; }
        if (char === '\u007f' || char === '\b') value = value.slice(0, -1);
        else value += char;
      }
    };
    const cleanup = () => { process.stdin.off('data', onData); process.stdin.setRawMode(false); process.stdin.pause(); };
    process.stdin.on('data', onData);
  });
}

async function askLine(question) {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try { return (await rl.question(question)).trim(); } finally { rl.close(); }
}

async function main(args) {
  let options;
  try { options = parsePublishArgs(args); } catch (error) { console.error(`ERROR ${error.message}`); process.exitCode = 2; return; }

  const { keys, admin } = await connectControlledProduction();
  const business = await resolveBusiness(admin, options.business);

  if (!options.apply) {
    const dry = runImporter(options.sheet, business.id);
    process.stdout.write(dry.stdout || '');
    process.stderr.write(dry.stderr || '');
    process.exitCode = dry.status ?? 1;
    return;
  }

  // 1 · El plan tiene que ser válido antes de pedir ninguna credencial.
  const planned = runImporter(options.sheet, business.id, ['--json']);
  let plan = null;
  try { plan = JSON.parse(planned.stdout); } catch (_) { plan = null; }
  if (!plan || plan.errors?.length) {
    console.log(plan ? `INVALID: ${plan.errors.length} fila(s) rechazada(s). No se escribió nada.` : 'No se pudo validar la planilla. No se escribió nada.');
    for (const error of (plan?.errors || []).slice(0, 30)) console.log(`  ${error}`);
    process.exitCode = 1;
    return;
  }
  const s = plan.summary || {};
  if (!s.changed && !s.altas) {
    console.log('La planilla no cambia nada: no hay nada que aplicar.');
    return;
  }

  // 2 · Sesión del dueño o encargado (nunca la clave de servicio).
  let email = options.as;
  let password = '';
  if (options.credential) {
    const stored = leerSecreto(options.credential);
    if (!stored?.usuario || !stored?.secreto) throw Error('La credencial no existe en el Administrador de credenciales.');
    email = stored.usuario;
    password = stored.secreto;
  } else {
    password = await hiddenPrompt(`Contraseña de ${email}: `);
  }
  const client = createClient(keys.url, keys.publishable, OPTIONS);
  const signed = await client.auth.signInWithPassword({ email, password });
  password = '';
  if (signed.error || !signed.data?.session) throw Error('No se pudo iniciar sesión con esa cuenta.');
  const registered = await client.rpc('identity_register_session', {
    p_business_id: business.id, p_client: 'panel_web', p_device_label: 'Planilla de apertura (terminal)', p_device_key_hash: null, p_app_version: 'opening-publish',
  });
  if (registered.error || registered.data?.ok !== true) {
    await client.auth.signOut({ scope: 'local' }).catch(() => {});
    throw Error('Esa cuenta no es dueño ni encargado activo del comercio.');
  }

  try {
    // 3 · Confirmación escrita, con el resumen a la vista.
    console.log(`Se va a aplicar en ${business.name} (${business.slug}): precio ${s.priceChanges} · stock ${s.stockChanges} · publicación ${s.publishChanges} · se vuelven comprables ${s.seVuelvenComprables}.`);
    const confirmation = options.confirm || await askLine(`Para aplicar, escribí ${APPLY_PHRASE}: `);
    if (confirmation !== APPLY_PHRASE) {
      console.log('No se confirmó. No se escribió nada.');
      process.exitCode = 3;
      return;
    }

    // 4 · El mismo importador, con la sesión recién abierta.
    const applied = runImporter(options.sheet, business.id, ['--apply', '--target', 'supabase'], {
      SUPABASE_URL: keys.url,
      SUPABASE_PUBLISHABLE_KEY: keys.publishable,
      SUPABASE_ACCESS_TOKEN: signed.data.session.access_token,
      TABA_BUSINESS_ID: business.id,
    });
    process.stdout.write((applied.stdout || '').split('\n').slice(-6).join('\n'));
    process.stderr.write(applied.stderr || '');
    if (applied.status !== 0) { process.exitCode = applied.status || 1; return; }
  } finally {
    await client.rpc('identity_close_own_session', { p_business_id: business.id }).catch(() => {});
    await client.auth.signOut({ scope: 'local' }).catch(() => {});
  }

  // 5 · Qué quedó pendiente, con la misma lista del Panel.
  const payload = await readOpeningReadiness(admin, business.id, 1);
  const presented = presentFrom(payload);
  console.log('');
  console.log(presented.headline);
  for (const line of renderOpeningLines(presented)) console.log(line);
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  main(process.argv.slice(2)).catch((error) => { console.error(`OPENING_PUBLISH_FAILED: ${error.message}`); process.exitCode = 2; });
}
