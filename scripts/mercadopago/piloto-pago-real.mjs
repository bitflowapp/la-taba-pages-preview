/*
 * Piloto cerrado de cobro real: el asistente de PREFLIGHT y de LIVE SMOKE TEST.
 *
 *   node scripts/mercadopago/piloto-pago-real.mjs plantilla [--destino qa|production] [--salida <archivo.json>]
 *   node scripts/mercadopago/piloto-pago-real.mjs validar            --archivo <autorizacion.json>
 *   node scripts/mercadopago/piloto-pago-real.mjs estado             --target qa|production --business <uuid>
 *   node scripts/mercadopago/piloto-pago-real.mjs preflight          --target qa|production --business <uuid> [--archivo <autorizacion.json>] [--con-red]
 *   node scripts/mercadopago/piloto-pago-real.mjs autorizar          --target ... --archivo <autorizacion.json> --evidencia <carpeta fuera del repo>
 *                                                                   --confirmo-importe <ARS> --confirmo-sha <12 hex> [--confirmo-dinero-real]
 *   node scripts/mercadopago/piloto-pago-real.mjs abortar            --target ... --autorizacion <uuid> --motivo "<texto>"
 *   node scripts/mercadopago/piloto-pago-real.mjs cerrar-piloto      --target ... --business <uuid>        (vuelve a cerrar el comercio)
 *   node scripts/mercadopago/piloto-pago-real.mjs verificar          --target ... --autorizacion <uuid> [--evidencia <carpeta>]
 *   node scripts/mercadopago/piloto-pago-real.mjs verificar-devolucion --target ... --autorizacion <uuid> --importe <ARS> --operacion <n.º de pago> [--evidencia <carpeta>] [--entregado]
 *
 * PREFLIGHT (preflight, estado, validar, verificar*) no mueve dinero ni crea operaciones financieras: se repite las veces
 * que haga falta. LIVE SMOKE TEST (autorizar) sólo escribe una AUTORIZACIÓN en la base: el dinero lo mueve la persona
 * compradora, en su dispositivo, y sólo si compra exactamente lo autorizado. Autorizar exige:
 *   - un documento completo y firmado por quien tiene autoridad (titular y cuenta del vendedor, cuenta compradora distinta,
 *     producto o concepto, importe exacto en ARS, quién asume las comisiones, devolución, condiciones de aborto);
 *   - que el importe y la huella se repitan a mano (--confirmo-importe, --confirmo-sha) y, en producción, --confirmo-dinero-real;
 *   - un preflight sin bloqueos, ejecutado en ese mismo momento.
 * Esta herramienta NO abre el comercio al público: eso es una decisión aparte (RPC set_live_payment_scope con confirmación
 * escrita) y no está en ningún comando de acá.
 */
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createClient } from '@supabase/supabase-js';
import { leerSecreto } from '../e2e-production-sale/secretos-windows.mjs';
import { loadTargetKeys } from '../controlled-production/target-keys.mjs';
import { productionTarget } from '../lib/environments.mjs';
import { plantilla, validar, resumen, huella, parametrosRpc } from './piloto/documento.mjs';
import { verificarCompra, verificarDevolucion, imprimir } from './piloto/verificacion.mjs';
import { evaluarPreflight, imprimirPreflight } from './piloto/preflight.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const COMANDOS = new Set(['plantilla', 'validar', 'estado', 'preflight', 'autorizar', 'abortar', 'cerrar-piloto', 'verificar', 'verificar-devolucion']);

export function leerArgumentos(argv) {
  const [comando, ...resto] = argv;
  const valor = (nombre) => { const i = resto.indexOf(`--${nombre}`); return i >= 0 ? resto[i + 1] : null; };
  const bandera = (nombre) => resto.includes(`--${nombre}`);
  return {
    comando, destino: valor('destino') || 'production', salida: valor('salida'), archivo: valor('archivo'),
    target: valor('target'), business: valor('business'), evidencia: valor('evidencia'), autorizacion: valor('autorizacion'),
    motivo: valor('motivo'), importe: valor('importe'), operacion: valor('operacion'), confirmoImporte: valor('confirmo-importe'), confirmoSha: valor('confirmo-sha'),
    confirmoDineroReal: bandera('confirmo-dinero-real'), conRed: bandera('con-red'), entregado: bandera('entregado'),
  };
}

/** Lo que se decide sin tocar la red. Devuelve el primer motivo de rechazo o null. */
export function rechazo(a) {
  if (!COMANDOS.has(a.comando)) return 'COMANDO_INVALIDO';
  if (['plantilla'].includes(a.comando)) return ['qa', 'production'].includes(a.destino) ? null : 'DESTINO_INVALIDO';
  if (a.comando === 'validar') return a.archivo ? null : 'FALTA_ARCHIVO';
  if (!['qa', 'production'].includes(a.target)) return 'TARGET_INVALIDO';
  if (['estado', 'preflight', 'cerrar-piloto'].includes(a.comando) && !UUID.test(a.business || '')) return 'NEGOCIO_INVALIDO';
  if (['abortar', 'verificar', 'verificar-devolucion'].includes(a.comando) && !UUID.test(a.autorizacion || '')) return 'AUTORIZACION_INVALIDA';
  if (a.comando === 'abortar' && (a.motivo || '').trim().length < 5) return 'FALTA_MOTIVO';
  if (a.comando === 'verificar-devolucion' && !(Number(a.importe) > 0)) return 'FALTA_IMPORTE_DEVUELTO';
  if (a.comando === 'verificar-devolucion' && !/^[1-9][0-9]{4,19}$/.test(a.operacion || '')) return 'FALTA_OPERACION_AUTORIZADA';
  if (a.comando === 'autorizar') {
    if (!a.archivo) return 'FALTA_ARCHIVO';
    if (!a.evidencia) return 'FALTA_CARPETA_DE_EVIDENCIA';
    if (!a.confirmoImporte) return 'FALTA_CONFIRMO_IMPORTE';
    if (!/^[a-f0-9]{12}$/i.test(a.confirmoSha || '')) return 'FALTA_CONFIRMO_SHA';
    if (a.target === 'production' && !a.confirmoDineroReal) return 'FALTA_CONFIRMO_DINERO_REAL';
  }
  return null;
}

/** La carpeta de evidencia contiene el documento firmado y cuentas ajenas: nunca dentro del repositorio público. */
export function carpetaFueraDelRepo(carpeta) {
  const relativa = path.relative(ROOT, path.resolve(carpeta));
  return relativa.startsWith('..') || path.isAbsolute(relativa);
}

async function clienteDeServicio(target) {
  if (target === 'production') {
    const claves = await loadTargetKeys('production');
    return { ref: claves.ref, entorno: 'production', db: createClient(claves.url, claves.secret, { auth: { persistSession: false, autoRefreshToken: false } }) };
  }
  const recibo = JSON.parse(fs.readFileSync(path.join(ROOT, 'deploy/recovery-free-hosted.json'), 'utf8'));
  if (recibo.environment !== 'test' || recibo.commercialPaymentsEnabled !== false) throw Error('QA_RECEIPT_NOT_TEST');
  const guardada = leerSecreto('RECOVERY SUPABASE SERVICE KEY');
  if (guardada?.usuario !== recibo.projectRef) throw Error('QA_SERVICE_KEY_NOT_BOUND');
  return { ref: recibo.projectRef, entorno: 'test', db: createClient(`https://${recibo.projectRef}.supabase.co`, guardada.secreto, { auth: { persistSession: false, autoRefreshToken: false } }) };
}

async function leer(pedido, etiqueta) {
  const { data, error, count } = await pedido;
  // Una lectura financiera fallida nunca se convierte en una lista vacía «limpia».
  if (error) throw Error(`no se pudo leer ${etiqueta} (${error.code || 'sin código'})`);
  return count ?? data;
}

async function reunirPreflight({ db, entorno }, { target, business, documento }) {
  const hace7 = new Date(Date.now() - 7 * 86_400_000).toISOString();
  const settings = (await leer(db.from('business_payment_settings').select('enabled,environment,production_review_status,collector_id,application_id').eq('business_id', business).eq('provider', 'mercadopago'), 'la configuración de pagos'))?.[0] ?? null;
  const conexion = (await leer(db.from('mp_seller_connections').select('environment,status,seller_id,application_id,expires_at').eq('business_id', business).eq('environment', entorno), 'la conexión del vendedor'))?.[0] ?? null;
  const { data: estadoPiloto, error } = await db.rpc('get_live_pilot_status', { p_business_id: business, p_environment: entorno });
  if (error) throw Error(`no se pudo leer el estado del piloto (${error.code || error.message})`);
  const sesionesAbiertas = await leer(db.from('checkout_sessions').select('*', { count: 'exact', head: true }).eq('business_id', business)
    .in('status', ['ready_for_payment', 'redirected', 'payment_pending']).gt('expires_at', new Date().toISOString()), 'las sesiones abiertas');
  const intencionesEntorno = await leer(db.from('payment_intents').select('*', { count: 'exact', head: true }).eq('business_id', business).eq('environment', entorno), 'las intenciones de pago');
  const discrepanciasAbiertas = await leer(db.from('payment_discrepancies').select('*', { count: 'exact', head: true }).eq('business_id', business).neq('status', 'resolved'), 'las discrepancias');
  const intents = await leer(db.from('payment_intents').select('id,internal_status,order_id,updated_at').eq('business_id', business)
    .or(`updated_at.gte.${hace7},internal_status.in.(ambiguous,security_review_required,approved_order_pending,approved)`).limit(1000), 'las intenciones recientes');
  const ids = intents.map((fila) => fila.id);
  const outbox = [
    ...(ids.length ? await leer(db.from('payment_outbox').select('status,next_attempt_at,lease_expires_at').in('payment_intent_id', ids).neq('status', 'completed'), 'la cola') : []),
    ...await leer(db.from('payment_outbox').select('status,next_attempt_at,lease_expires_at').is('payment_intent_id', null).neq('status', 'completed').limit(1000), 'la cola general'),
  ];
  const refunds = ids.length ? await leer(db.from('payment_refunds').select('status').in('payment_intent_id', ids).eq('status', 'ambiguous'), 'las devoluciones') : [];
  const receipts = await leer(db.from('payment_webhook_receipts').select('processing_status,signature_valid').gte('received_at', hace7).limit(5000), 'los avisos');
  let productos;
  if (documento) {
    productos = await leer(db.from('products').select('id,sku,price,stock,is_active,available,price_status,is_alcoholic')
      .eq('business_id', business).in('id', documento.compra.items.map((item) => item.producto_id)), 'los productos');
  }
  const registro = target === 'production' ? { status: (() => { try { productionTarget({ allowProvisioned: true }); return 'provisioned'; } catch { return 'not_provisioned'; } })() } : undefined;
  return { target, registro, ahora: Date.now(), settings, conexion, estadoPiloto, sesionesAbiertas, intencionesEntorno,
    discrepanciasAbiertas, mp: { outbox, intents, refunds, receipts }, productos, documento };
}

function leerDocumento(archivo) {
  let bruto;
  try { bruto = JSON.parse(fs.readFileSync(archivo, 'utf8')); } catch (error) { throw Error(`no se pudo leer ${archivo}: ${error.message}`); }
  return bruto;
}

async function instantanea({ db, entorno }, autorizacionId) {
  const auth = (await leer(db.from('payment_live_pilot_authorizations').select('*').eq('id', autorizacionId), 'la autorización'))?.[0];
  if (!auth) throw Error('autorización inexistente');
  if (auth.environment !== entorno) throw Error('la autorización es de otro entorno');
  const intencion = auth.consumed_by_intent_id;
  const sesionId = auth.consumed_checkout_session_id;
  const base = { authorization: auth, settings: (await leer(db.from('business_payment_settings').select('collector_id,environment').eq('business_id', auth.business_id).eq('provider', 'mercadopago'), 'la configuración'))?.[0] ?? {} };
  if (!intencion) return { ...base, intents: [], payments: [], attempts: [], receipts: [], outbox: [], orders: [], reservations: [], refunds: [], discrepancies: [], stockNow: [] };
  const session = (await leer(db.from('checkout_sessions').select('*').eq('id', sesionId), 'la sesión'))?.[0];
  const intents = await leer(db.from('payment_intents').select('*').eq('checkout_session_id', sesionId), 'las intenciones');
  const ids = intents.map((fila) => fila.id);
  const porIntencion = async (tabla, etiqueta) => (ids.length ? leer(db.from(tabla).select('*').in('payment_intent_id', ids), etiqueta) : []);
  const payments = await porIntencion('payment_provider_payments', 'los pagos');
  const idsPago = [...new Set([...intents.map((i) => i.provider_payment_id), ...payments.map((p) => p.provider_payment_id)].filter(Boolean).map(String))];
  const orderIds = [...new Set([session?.completed_order_id, ...intents.map((i) => i.order_id)].filter(Boolean))];
  return {
    ...base, session, intents, payments,
    attempts: await porIntencion('payment_attempts', 'los intentos'),
    outbox: await porIntencion('payment_outbox', 'la cola'),
    refunds: await porIntencion('payment_refunds', 'las devoluciones'),
    discrepancies: await porIntencion('payment_discrepancies', 'las discrepancias'),
    receipts: idsPago.length ? await leer(db.from('payment_webhook_receipts').select('*').eq('environment', auth.environment).in('resource_id', idsPago), 'los avisos') : [],
    orders: orderIds.length ? await leer(db.from('orders').select('*').eq('business_id', auth.business_id).in('id', orderIds), 'los pedidos') : [],
    reservations: await leer(db.from('inventory_reservations').select('*').eq('checkout_session_id', sesionId), 'las reservas'),
    stockNow: await leer(db.from('products').select('id,sku,stock').eq('business_id', auth.business_id), 'el stock'),
  };
}

function lineaBase(evidencia) {
  if (!evidencia) return null;
  const archivo = path.join(evidencia, 'linea-base.json');
  return fs.existsSync(archivo) ? JSON.parse(fs.readFileSync(archivo, 'utf8')).stock : null;
}

export async function main(argv = process.argv.slice(2)) {
  const a = leerArgumentos(argv);
  const motivo = rechazo(a);
  if (motivo) { console.error(`RECHAZADO: ${motivo}`); process.exitCode = 2; return; }

  if (a.comando === 'plantilla') {
    const texto = `${JSON.stringify(plantilla(a.destino), null, 2)}\n`;
    if (a.salida) {
      if (!carpetaFueraDelRepo(path.dirname(a.salida))) { console.error('RECHAZADO: escribí la autorización FUERA del repositorio (es público).'); process.exitCode = 2; return; }
      fs.writeFileSync(a.salida, texto, { flag: 'wx' });
      console.log(`plantilla escrita en ${a.salida}: completala (todo lo que diga __COMPLETAR__) y validala con «validar».`);
    } else process.stdout.write(texto);
    return;
  }
  if (a.comando === 'validar') {
    const documento = leerDocumento(a.archivo);
    const errores = validar(documento);
    if (errores.length) {
      for (const e of errores) console.log(`FALTA  ${e.ruta || '(documento)'}: ${e.motivo}`);
      console.log('\nAutorización INCOMPLETA: no se puede usar.');
      process.exitCode = 1; return;
    }
    console.log(resumen(documento));
    console.log(`\nHuella (sha256): ${huella(documento)}\nPara autorizar repetí a mano: --confirmo-importe ${documento.compra.importe_ars} --confirmo-sha ${huella(documento).slice(0, 12)}`);
    return;
  }

  const cliente = await clienteDeServicio(a.target);
  if (a.comando === 'estado') {
    const { data, error } = await cliente.db.rpc('get_live_pilot_status', { p_business_id: a.business, p_environment: cliente.entorno });
    if (error) throw Error(`estado: ${error.code || error.message}`);
    console.log(JSON.stringify(data, null, 2));
    return;
  }
  if (a.comando === 'preflight') {
    const documento = a.archivo ? leerDocumento(a.archivo) : undefined;
    if (documento) {
      const errores = validar(documento);
      if (errores.length) { for (const e of errores) console.log(`FALTA  ${e.ruta}: ${e.motivo}`); process.exitCode = 1; return; }
    }
    const resultado = evaluarPreflight(await reunirPreflight(cliente, { target: a.target, business: a.business, documento }));
    if (a.conRed) {
      const red = spawnSync(process.execPath, [path.join(ROOT, 'scripts/mercadopago/asistente-activacion.mjs'), 'red', '--target', a.target], { cwd: ROOT, encoding: 'utf8' });
      resultado.checks.push({ id: 'red', estado: red.status === 0 ? 'PASS' : 'FAIL', titulo: 'Sitio, OAuth, webhook y CORS (asistente-activacion red)', detalle: (red.stdout || red.stderr || '').trim().split('\n').slice(-3).join(' | ') });
      resultado.ok = resultado.ok && red.status === 0;
    }
    imprimirPreflight(resultado);
    process.exitCode = resultado.ok ? 0 : 1;
    return;
  }
  if (a.comando === 'autorizar') {
    if (!carpetaFueraDelRepo(a.evidencia)) { console.error('RECHAZADO: la carpeta de evidencia debe estar FUERA del repositorio (es público).'); process.exitCode = 2; return; }
    const documento = leerDocumento(a.archivo);
    const errores = validar(documento);
    if (errores.length) { for (const e of errores) console.log(`FALTA  ${e.ruta || '(documento)'}: ${e.motivo}`); process.exitCode = 1; return; }
    if (documento.destino !== a.target) { console.error('RECHAZADO: el destino del documento no es el de --target.'); process.exitCode = 2; return; }
    const sha = huella(documento);
    if (Number(a.confirmoImporte) !== documento.compra.importe_ars) { console.error('RECHAZADO: --confirmo-importe no coincide con el importe del documento.'); process.exitCode = 2; return; }
    if (a.confirmoSha.toLowerCase() !== sha.slice(0, 12)) { console.error('RECHAZADO: --confirmo-sha no coincide con la huella del documento (¿lo modificaron después de firmarlo?).'); process.exitCode = 2; return; }
    const resultado = evaluarPreflight(await reunirPreflight(cliente, { target: a.target, business: documento.comercio.id, documento }));
    imprimirPreflight(resultado);
    if (!resultado.ok) { console.error('\nNO SE AUTORIZA: el preflight tiene bloqueos.'); process.exitCode = 1; return; }
    console.log(`\n${resumen(documento)}\n`);
    // La carpeta de evidencia y la línea base de stock se resuelven ANTES de autorizar: si el disco falla, no queda una
    // autorización abierta sin su evidencia.
    fs.mkdirSync(a.evidencia, { recursive: true });
    const productos = await leer(cliente.db.from('products').select('id,stock').eq('business_id', documento.comercio.id), 'el stock inicial');
    const stock = Object.fromEntries(productos.map((p) => [p.id, p.stock]));
    fs.writeFileSync(path.join(a.evidencia, 'autorizacion.json'), `${JSON.stringify(documento, null, 2)}
`);
    fs.writeFileSync(path.join(a.evidencia, 'preflight.json'), `${JSON.stringify(resultado, null, 2)}
`);
    const { data, error } = await cliente.db.rpc('authorize_live_pilot_payment', parametrosRpc(documento, { huellaDocumento: sha }));
    if (error) throw Error(`la base rechazó la autorización: ${error.message}`);
    const lineaBase = `${JSON.stringify({ at: new Date().toISOString(), authorization_id: data.authorization_id, stock }, null, 2)}
`;
    try { fs.writeFileSync(path.join(a.evidencia, 'linea-base.json'), lineaBase); } catch (error2) {
      console.error(`No se pudo escribir linea-base.json (${error2.message}). Guardala a mano:
${lineaBase}`);
    }
    console.log(`AUTORIZADA ${data.authorization_id}: vence ${data.expires_at}. Evidencia en ${a.evidencia}.`);
    console.log('La compra la hace la persona autorizada, en su dispositivo. Ahora ni esta herramienta ni ingeniería mueven dinero.');
    return;
  }
  if (a.comando === 'abortar') {
    const { data, error } = await cliente.db.rpc('abort_live_pilot_payment', { p_authorization_id: a.autorizacion, p_reason: a.motivo });
    if (error) throw Error(`abortar: ${error.message}`);
    console.log(JSON.stringify(data));
    return;
  }
  if (a.comando === 'cerrar-piloto') {
    const { data, error } = await cliente.db.rpc('set_live_payment_scope', { p_business_id: a.business, p_environment: cliente.entorno, p_scope: 'pilot', p_changed_by: 'piloto-pago-real cerrar-piloto' });
    if (error) throw Error(`cerrar-piloto: ${error.message}`);
    console.log(JSON.stringify(data));
    return;
  }
  const snapshot = await instantanea(cliente, a.autorizacion);
  const base = lineaBase(a.evidencia);
  if (a.comando === 'verificar') {
    const resultado = verificarCompra(snapshot, { baselineStock: base });
    imprimir(resultado);
    process.exitCode = resultado.ok ? 0 : 1;
    return;
  }
  const resultado = verificarDevolucion(snapshot, { importeDevuelto: Number(a.importe), operacion: a.operacion, baselineStock: base, entregado: a.entregado });
  imprimir(resultado);
  process.exitCode = resultado.ok ? 0 : 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(String(error?.message || error).replace(/(?:sbp_|sb_secret_|APP_USR-|TEST-|eyJ)[A-Za-z0-9._-]+/g, '[redactado]'));
    process.exitCode = 2;
  });
}
