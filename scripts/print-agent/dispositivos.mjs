/*
 * Agentes locales de impresión: la herramienta del operador.
 *
 *   node scripts/print-agent/dispositivos.mjs codigo  --target=controlled-production --business=<uuid> --confirmar=<slug> --nombre="Mostrador"
 *   node scripts/print-agent/dispositivos.mjs estado  --target=controlled-production --business=<uuid>
 *   node scripts/print-agent/dispositivos.mjs revocar --target=controlled-production --device=<uuid> --motivo="PC robada"
 *
 * `codigo` emite un código de emparejamiento de UN solo uso, válido 15 minutos,
 * que se escribe en la PC del local con «TabaLocalAgent register --code …». El
 * código se muestra una vez; la base guarda sólo su hash. El agente genera su
 * propio secreto y nunca recibe service_role.
 *
 * `estado` muestra agentes (nombre, versión, último latido, impresoras) y la
 * cola del negocio por estado. Nunca hashes, credenciales ni contenido de tickets.
 *
 * `revocar` corta el acceso de un agente en el acto: lo que tenía reclamado sin
 * empezar vuelve a la cola, lo que estaba imprimiendo queda para revisión.
 *
 * Mientras el Panel no tenga la pantalla de dispositivos, el alta y la baja las
 * hace operación. Las RPC `operator_*_local_device*` son sólo service_role y
 * requieren la migración 20260926160000 aplicada en el destino.
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createClient } from '@supabase/supabase-js';
import { loadTargetKeys } from '../controlled-production/target-keys.mjs';

const DESTINOS = new Set(['staging', 'controlled-production']);
const COMANDOS = new Set(['codigo', 'estado', 'revocar']);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export function leerArgumentos(argv) {
  const [comando, ...resto] = argv;
  const valor = (nombre) => resto.find((arg) => arg.startsWith(`--${nombre}=`))?.slice(nombre.length + 3) ?? null;
  return {
    comando,
    target: valor('target'),
    business: valor('business'),
    device: valor('device'),
    confirmar: valor('confirmar'),
    nombre: valor('nombre'),
    motivo: valor('motivo'),
  };
}

/** Lo que se decide sin red. Devuelve el primer motivo de rechazo o null. */
export function validar(args) {
  if (!COMANDOS.has(args.comando)) return 'COMANDO_INVALIDO';
  if (!DESTINOS.has(args.target)) return 'DESTINO_INVALIDO';
  if (args.comando === 'revocar') {
    if (!UUID.test(args.device || '')) return 'DISPOSITIVO_INVALIDO';
    if ((args.motivo || '').trim().length < 3) return 'FALTA_EL_MOTIVO';
    return null;
  }
  if (!UUID.test(args.business || '')) return 'NEGOCIO_INVALIDO';
  if (args.comando === 'codigo') {
    if (!args.confirmar) return 'FALTA_CONFIRMAR_EL_SLUG';
    const nombre = (args.nombre || '').trim();
    if (nombre.length < 1 || nombre.length > 80) return 'NOMBRE_INVALIDO';
  }
  return null;
}

export function resumirEstado(devices, jobs, now = Date.now()) {
  return {
    agentes: devices.map((d) => ({
      id: d.id,
      nombre: d.device_name,
      estado: d.status,
      version: d.agent_version,
      ultimo_latido: d.last_seen_at,
      en_linea: d.status === 'active' && d.last_seen_at != null && now - Date.parse(d.last_seen_at) < 150_000,
      impresoras: d.last_report?.printers ?? [],
    })),
    cola: jobs.reduce((acc, job) => ({ ...acc, [job.status]: (acc[job.status] || 0) + 1 }), {}),
  };
}

async function main(argv) {
  const args = leerArgumentos(argv);
  const rechazo = validar(args);
  if (rechazo) {
    console.error(`RECHAZADO: ${rechazo}`);
    return 2;
  }
  const keys = await loadTargetKeys(args.target);
  const admin = createClient(keys.url, keys.secret, { auth: { persistSession: false, autoRefreshToken: false } });
  const faltaMigracion = (error) => error?.code === 'PGRST202' || error?.code === '42P01' || /does not exist/i.test(error?.message || '');

  if (args.comando === 'codigo') {
    const { data: business, error } = await admin.from('businesses').select('id,slug,name').eq('id', args.business).maybeSingle();
    if (error || !business) throw Error('NEGOCIO_INEXISTENTE');
    if (business.slug !== args.confirmar) throw Error('EL_SLUG_NO_COINCIDE');
    const { data, error: rpcError } = await admin.rpc('operator_create_local_device_pairing', {
      p_business_id: args.business, p_device_name: args.nombre.trim(),
    });
    if (faltaMigracion(rpcError)) throw Error('MIGRACION_20260926160000_NO_APLICADA');
    if (rpcError) throw Error(`EMPAREJAMIENTO_RECHAZADO:${rpcError.code || rpcError.message}`);
    console.log(JSON.stringify({ negocio: business.name, dispositivo: data.device_name, codigo: data.pairing_code, vence: data.expires_at }, null, 2));
    console.log('En la PC del local (consola de administrador): TabaLocalAgent register --code ' + data.pairing_code + ` --name "${data.device_name}"`);
    return 0;
  }

  if (args.comando === 'revocar') {
    const { data, error } = await admin.rpc('operator_revoke_local_device', { p_device_id: args.device, p_reason: args.motivo.trim() });
    if (faltaMigracion(error)) throw Error('MIGRACION_20260926160000_NO_APLICADA');
    if (error) throw Error(`REVOCACION_RECHAZADA:${error.code || error.message}`);
    console.log(JSON.stringify(data, null, 2));
    return 0;
  }

  const { data: devices, error: devicesError } = await admin.from('local_devices')
    .select('id,device_name,status,agent_version,last_seen_at,last_report,created_at,revoked_at')
    .eq('business_id', args.business).order('created_at');
  if (faltaMigracion(devicesError)) throw Error('MIGRACION_20260926160000_NO_APLICADA');
  if (devicesError) throw Error(`LECTURA_FALLIDA:${devicesError.code}`);
  const { data: jobs, error: jobsError } = await admin.from('print_jobs').select('status')
    .eq('business_id', args.business).gte('created_at', new Date(Date.now() - 86_400_000).toISOString());
  if (jobsError) throw Error(`LECTURA_FALLIDA:${jobsError.code}`);
  console.log(JSON.stringify(resumirEstado(devices, jobs), null, 2));
  return 0;
}

const invoked = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));
if (invoked) {
  main(process.argv.slice(2)).then((code) => process.exit(code), (error) => {
    console.error(`ERROR: ${error.message}`);
    process.exit(1);
  });
}
