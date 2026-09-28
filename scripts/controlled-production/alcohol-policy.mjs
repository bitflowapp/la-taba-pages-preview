// Política de venta de alcohol del comercio real (CONTROLLED_PRODUCTION).
//
//   npm run alcohol:policy -- status
//   npm run alcohol:policy -- apply --credential "<dueño o encargado>" --min-age 18 --start 10:00 --end 23:00 [--timezone America/Argentina/Buenos_Aires]
//   npm run alcohol:policy -- disable --credential "<dueño o encargado>"
//
// Es una decisión del comercio (docs/ALCOHOL-ACTIVATION.md). Por eso escribe con
// la SESIÓN del dueño o encargado —las columnas de la política son suyas por
// permiso de columna— y nunca con la clave de servicio. `apply` pide escribir
// HABILITAR ALCOHOL y manda edad, franja, huso y el interruptor en un solo
// cambio: la base (`businesses_alcohol_policy_complete`) lo acepta completo o
// no lo acepta. `status` sólo lee.
import { createInterface } from 'node:readline/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createClient } from '@supabase/supabase-js';
import { leerSecreto } from '../e2e-production-sale/secretos-windows.mjs';
import { REAL_BUSINESS_SLUG, connectControlledProduction, readOption, resolveBusiness } from './opening-tools.mjs';

const OPTIONS = { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } };
export const ENABLE_PHRASE = 'HABILITAR ALCOHOL';
const TIME = /^([01][0-9]|2[0-3]):[0-5][0-9]$/;

export function parseAlcoholArgs(args = []) {
  const [command] = args;
  if (!['status', 'apply', 'disable'].includes(command)) throw Error('Usá status, apply o disable.');
  const known = ['--business', '--credential', '--min-age', '--start', '--end', '--timezone', '--confirm'];
  const unknown = args.slice(1).filter((arg) => arg.startsWith('--') && !known.includes(arg));
  if (unknown.length) throw Error(`Flag desconocido: ${unknown[0]}`);
  const options = { command, business: readOption(args, '--business', REAL_BUSINESS_SLUG), credential: readOption(args, '--credential', '') };
  if (command === 'status') return options;
  if (!options.credential) throw Error(`${command} necesita --credential con la cuenta del dueño o encargado.`);
  if (command === 'disable') return options;
  const minAge = Number(readOption(args, '--min-age', ''));
  if (!Number.isInteger(minAge) || minAge < 18 || minAge > 99) throw Error('--min-age va de 18 a 99.');
  const start = readOption(args, '--start', '');
  const end = readOption(args, '--end', '');
  if (!TIME.test(start) || !TIME.test(end) || start === end) throw Error('--start y --end son horas HH:MM distintas.');
  const timezone = readOption(args, '--timezone', 'America/Argentina/Buenos_Aires');
  try { new Intl.DateTimeFormat('es-AR', { timeZone: timezone }); } catch { throw Error('--timezone no es un huso válido.'); }
  return { ...options, minAge, start, end, timezone, confirm: readOption(args, '--confirm', '') };
}

/** Lo que se escribe, en un solo cambio. */
export function policyPatch(options) {
  if (options.command === 'disable') return { alcohol_sales_enabled: false };
  return {
    alcohol_minimum_age: options.minAge,
    alcohol_sales_start: options.start,
    alcohol_sales_end: options.end,
    alcohol_timezone: options.timezone,
    alcohol_sales_enabled: true,
  };
}

async function main(args) {
  let options;
  try { options = parseAlcoholArgs(args); } catch (error) { console.error(`ERROR ${error.message}`); process.exitCode = 2; return; }
  const { keys, admin } = await connectControlledProduction();
  const business = await resolveBusiness(admin, options.business);
  const read = async () => {
    const { data, error } = await admin.from('businesses')
      .select('alcohol_sales_enabled,alcohol_minimum_age,alcohol_sales_start,alcohol_sales_end,alcohol_timezone,alcohol_hours_enforced')
      .eq('id', business.id).single();
    if (error) throw Error(`BUSINESS_READ:${error.code || 'ERROR'}`);
    const products = await admin.from('products').select('is_alcoholic,available').eq('business_id', business.id).eq('is_alcoholic', true);
    return { ...data, alcoholic_products: products.data?.length || 0, alcoholic_published: (products.data || []).filter((row) => row.available).length };
  };
  if (options.command === 'status') { console.log(JSON.stringify({ business: business.slug, ...(await read()) }, null, 2)); return; }

  if (options.command === 'apply') {
    const confirmation = options.confirm || await (async () => {
      const rl = createInterface({ input: process.stdin, output: process.stdout });
      try { return (await rl.question(`Vas a HABILITAR la venta de alcohol en ${business.name} desde ${options.minAge} años, de ${options.start} a ${options.end}. Escribí ${ENABLE_PHRASE}: `)).trim(); }
      finally { rl.close(); }
    })();
    if (confirmation !== ENABLE_PHRASE) { console.log('No se confirmó. No se escribió nada.'); process.exitCode = 3; return; }
  }

  const stored = leerSecreto(options.credential);
  if (!stored?.usuario || !stored?.secreto) throw Error('La credencial no existe en el Administrador de credenciales.');
  const client = createClient(keys.url, keys.publishable, OPTIONS);
  const signed = await client.auth.signInWithPassword({ email: stored.usuario, password: stored.secreto });
  if (signed.error || !signed.data?.session) throw Error('No se pudo iniciar sesión con esa cuenta.');
  try {
    const registered = await client.rpc('identity_register_session', {
      p_business_id: business.id, p_client: 'panel_web', p_device_label: 'Política de alcohol (terminal)', p_device_key_hash: null, p_app_version: 'alcohol-policy',
    });
    if (registered.error || registered.data?.ok !== true) throw Error('Esa cuenta no es dueño ni encargado activo del comercio.');
    const { error } = await client.from('businesses').update(policyPatch(options)).eq('id', business.id).select('id').single();
    if (error) throw Error(`La base no aceptó la política (${error.code || 'sin código'}). No cambió nada.`);
  } finally {
    await client.rpc('identity_close_own_session', { p_business_id: business.id }).catch(() => {});
    await client.auth.signOut({ scope: 'local' }).catch(() => {});
  }
  console.log(JSON.stringify({ business: business.slug, ...(await read()) }, null, 2));
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  main(process.argv.slice(2)).catch((error) => { console.error(`ALCOHOL_POLICY_FAILED: ${error.message}`); process.exitCode = 2; });
}
