/*
 * Mercado Pago por negocio: el interruptor del operador.
 *
 *   node scripts/mercadopago/cobro-negocio.mjs estado   --target=controlled-production --business=<uuid>
 *   node scripts/mercadopago/cobro-negocio.mjs apagar   --target=controlled-production --business=<uuid> --confirmar=<slug>
 *   node scripts/mercadopago/cobro-negocio.mjs encender --target=controlled-production --business=<uuid> --confirmar=<slug> --revision-aprobada
 *
 * `apagar` es el ROLLBACK de Mercado Pago para UN negocio: el checkout deja de
 * ofrecerlo en el acto y el cobro manual sigue. La conexión del vendedor (y su
 * credencial sellada), los pagos, los pedidos y los reembolsos no se tocan, así
 * que volver a encender no exige reconectar la cuenta.
 *
 * `encender` es el cutover ACOTADO a ese negocio: exige una cuenta conectada del
 * entorno del destino y de la aplicación de ese destino. En producción exige
 * además `--revision-aprobada`, que es la decisión humana de que la aplicación
 * pasó la revisión productiva. Encender NO cobra nada: sólo hace que el
 * checkout ofrezca Mercado Pago.
 *
 * Todo pasa por la RPC `operator_set_mercadopago_for_business` (atómica y
 * auditada en business_config_audit). Los valores que se leen para `estado`
 * nunca incluyen credenciales, la cuenta del vendedor ni datos de pagadores.
 * `--confirmar` repite el slug del negocio: un UUID copiado del negocio
 * equivocado no alcanza para cambiar nada.
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createClient } from '@supabase/supabase-js';
import { loadTargetKeys } from '../controlled-production/target-keys.mjs';

export const PLANES = Object.freeze({
  staging: Object.freeze({ environment: 'test', application: '2691240967769590' }),
  'controlled-production': Object.freeze({ environment: 'production', application: '7677852968049976' }),
});
const COMANDOS = new Set(['estado', 'apagar', 'encender']);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export function leerArgumentos(argv) {
  const [comando, ...resto] = argv;
  const valor = (nombre) => resto.find((arg) => arg.startsWith(`--${nombre}=`))?.slice(nombre.length + 3) ?? null;
  return {
    comando,
    target: valor('target'),
    business: valor('business'),
    confirmar: valor('confirmar'),
    revisionAprobada: resto.includes('--revision-aprobada'),
  };
}

/** Lo que se puede decidir sin tocar la red. Devuelve el primer motivo de rechazo o null. */
export function validar(args) {
  if (!COMANDOS.has(args.comando)) return 'COMANDO_INVALIDO';
  if (!PLANES[args.target]) return 'DESTINO_INVALIDO';
  if (!UUID.test(args.business || '')) return 'NEGOCIO_INVALIDO';
  if (args.comando === 'estado') return null;
  if (!args.confirmar) return 'FALTA_CONFIRMAR_EL_SLUG';
  if (args.comando === 'encender' && PLANES[args.target].environment === 'production' && !args.revisionAprobada) {
    return 'COBRO_REAL_SIN_REVISION_PRODUCTIVA_CONFIRMADA';
  }
  return null;
}

async function leer(consulta, codigo) {
  const { data, error } = await consulta;
  if (error) throw Error(`${codigo}:${error.code || error.message}`);
  return data;
}

export async function estado(db, businessId, plan, ahora = Date.now()) {
  const negocio = await leer(db.from('businesses').select('slug,status,ordering_enabled').eq('id', businessId).maybeSingle(), 'NEGOCIO');
  if (!negocio) throw Error('NEGOCIO_INEXISTENTE');
  const ajustes = await leer(db.from('business_payment_settings').select('enabled,environment,production_review_status,application_id,updated_at')
    .eq('business_id', businessId).eq('provider', 'mercadopago').maybeSingle(), 'AJUSTES');
  const conexiones = await leer(db.from('mp_seller_connections').select('environment,status,application_id,expires_at,updated_at')
    .eq('business_id', businessId), 'CONEXION');
  const conexion = conexiones.find((fila) => fila.environment === plan.environment) || null;
  const disponibilidad = await leer(db.rpc('get_mercadopago_checkout_availability', { p_business_id: businessId }), 'DISPONIBILIDAD');
  const auditoria = await leer(db.from('business_config_audit').select('action,actor_kind,created_at')
    .eq('business_id', businessId).eq('scope', 'payments').order('created_at', { ascending: false }).limit(5), 'AUDITORIA');
  return {
    negocio: { slug: negocio.slug, status: negocio.status, ordering_enabled: negocio.ordering_enabled },
    ajustes: ajustes ? { enabled: ajustes.enabled, environment: ajustes.environment,
      production_review_status: ajustes.production_review_status, aplicacion_esperada: ajustes.application_id === plan.application } : null,
    conexion: conexion ? { environment: conexion.environment, status: conexion.status,
      aplicacion_esperada: conexion.application_id === plan.application,
      dias_hasta_vencer: conexion.expires_at ? Math.floor((Date.parse(conexion.expires_at) - ahora) / 86_400_000) : null } : null,
    ofrecido_en_checkout: disponibilidad?.available === true,
    ultimos_cambios: auditoria,
  };
}

async function main(argv) {
  const args = leerArgumentos(argv);
  const motivo = validar(args);
  if (motivo) {
    console.error(`${motivo}\nuso: cobro-negocio.mjs estado|apagar|encender --target=staging|controlled-production --business=<uuid> [--confirmar=<slug>] [--revision-aprobada]`);
    process.exitCode = 2;
    return;
  }
  const plan = PLANES[args.target];
  const keys = await loadTargetKeys(args.target);
  const db = createClient(keys.url, keys.secret, { auth: { persistSession: false, autoRefreshToken: false } });
  const antes = await estado(db, args.business, plan);
  if (args.comando === 'estado') {
    console.log(JSON.stringify({ target: args.target, ref: keys.ref, ...antes }, null, 2));
    return;
  }
  if (antes.negocio.slug !== args.confirmar) throw Error('EL_SLUG_CONFIRMADO_NO_ES_EL_DEL_NEGOCIO');
  const encender = args.comando === 'encender';
  const resultado = await leer(db.rpc('operator_set_mercadopago_for_business', {
    p_business_id: args.business,
    p_environment: plan.environment,
    p_enabled: encender,
    p_expected_application_id: encender ? plan.application : null,
    p_production_review_approved: encender && args.revisionAprobada,
  }), 'INTERRUPTOR');
  const despues = await estado(db, args.business, plan);
  console.log(JSON.stringify({ target: args.target, ref: keys.ref, comando: args.comando, resultado, antes, despues }, null, 2));
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  main(process.argv.slice(2)).catch((error) => { console.error(`COBRO_NEGOCIO_FALLO:${error.message}`); process.exitCode = 1; });
}
