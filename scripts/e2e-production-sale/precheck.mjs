/*
 * El precheck: todo lo que se puede saber ANTES de tocar nada.
 *
 * Lee la base en modo sólo lectura, mira el teléfono por adb y comprueba que
 * las sesiones guardadas existan y no estén vencidas. Devuelve una fotografía
 * —incluido `stock_before`— y la lista de compuertas que pasaron o bloquearon.
 *
 * No abre navegadores: eso es del dry-run.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { PRODUCCION, PRODUCTO_AUTORIZADO, RIDER, RUTAS } from './contrato.mjs';
import { consultar, lit } from './db-solo-lectura.mjs';
import { evaluarNegocio, evaluarPedidosAbiertos, evaluarProducto, evaluarRider, evaluarSesion } from './guards.mjs';

const RAIZ = path.resolve(path.dirname(new URL(import.meta.url).pathname).replace(/^\/([A-Za-z]:)/, '$1'), '../..');

/** Una sesión guardada sirve si existe y ninguna de sus cookies venció. */
export function inspeccionarSesion(rutaRelativa, nombre) {
  const ruta = path.join(RAIZ, rutaRelativa);
  if (!existsSync(ruta)) return { nombre, existe: false, vencida: false, verificada: false, edadHoras: null };
  let estado = null;
  try {
    estado = JSON.parse(readFileSync(ruta, 'utf8'));
  } catch {
    return { nombre, existe: true, vencida: true, verificada: false, edadHoras: null, detalle: 'archivo ilegible' };
  }
  const ahora = Date.now() / 1000;
  const cookies = Array.isArray(estado.cookies) ? estado.cookies : [];
  const vencidas = cookies.filter((c) => Number(c.expires) > 0 && Number(c.expires) < ahora);
  const origenes = Array.isArray(estado.origins) ? estado.origins : [];
  const tieneToken = origenes.some((origen) => (origen.localStorage || [])
    .some((entrada) => /supabase|sb-/i.test(entrada.name) && String(entrada.value || '').includes('access_token')));
  const edadHoras = Math.round(((Date.now() - statSync(ruta).mtimeMs) / 3_600_000) * 10) / 10;
  return {
    nombre,
    existe: true,
    vencida: vencidas.length > 0,
    verificada: tieneToken,
    edadHoras,
    cookies: cookies.length,
  };
}

/** Lo que el teléfono dice de sí mismo. Sin tocar la app. */
export function inspeccionarRider() {
  const adb = (argumentos) => execFileSync('adb', argumentos, { encoding: 'utf8', timeout: 30_000 }).trim();
  try {
    const dispositivos = adb(['devices']);
    const conectado = new RegExp(`${RIDER.serie}\\s+device`).test(dispositivos);
    if (!conectado) return { dispositivoConectado: false, paquete: null, version: null, pantalla: null };
    const paquetes = adb(['-s', RIDER.serie, 'shell', 'pm', 'list', 'packages', RIDER.paquete]);
    const instalado = paquetes.split('\n').map((l) => l.trim()).includes(`package:${RIDER.paquete}`);
    const info = instalado ? adb(['-s', RIDER.serie, 'shell', 'dumpsys', 'package', RIDER.paquete]) : '';
    const version = (info.match(/versionName=([^\s]+)/) || [])[1] || null;
    const tamano = adb(['-s', RIDER.serie, 'shell', 'wm', 'size']);
    const bateria = (adb(['-s', RIDER.serie, 'shell', 'dumpsys', 'battery']).match(/level:\s*(\d+)/) || [])[1] || null;
    return {
      dispositivoConectado: true,
      paquete: instalado ? RIDER.paquete : null,
      version,
      pantalla: (tamano.match(/Physical size:\s*(\S+)/) || [])[1] || null,
      bateria: bateria ? Number(bateria) : null,
    };
  } catch (error) {
    return { dispositivoConectado: false, error: String(error.message || error).slice(0, 200) };
  }
}

export async function correrPrecheck() {
  const [negocio] = await consultar(`select id::text as id, name, status, is_active, ordering_enabled, ordering_verified,
      delivery_enabled, alcohol_sales_enabled, delivery_fee::text as delivery_fee,
      minimum_delivery_subtotal::text as minimo
    from public.businesses where id = ${lit(PRODUCCION.businessId)}`);

  const [producto] = await consultar(`select id::text as id, external_id, name, stock, available, is_verified, is_active,
      price::text as price, is_alcoholic, capacity, variant
    from public.products
    where business_id = ${lit(PRODUCCION.businessId)} and external_id = ${lit(PRODUCTO_AUTORIZADO.externalId)}`);

  const [conteos] = await consultar(`select
      (select count(*) from public.orders)::int as pedidos_totales,
      (select count(*) from public.orders where status not in ('delivered','cancelled','canceled'))::int as pedidos_abiertos,
      (select count(*) from public.products where business_id = ${lit(PRODUCCION.businessId)} and available)::int as visibles,
      (select count(*) from public.inventory_movements)::int as movimientos`);

  const abiertos = await consultar(`select public_code, status, created_at::text as created_at, total::text as total
    from public.orders where status not in ('delivered','cancelled','canceled') order by created_at`);

  const [riderFila] = await consultar(`select bm.is_active, bm.role
    from public.business_members bm
    where bm.business_id = ${lit(PRODUCCION.businessId)} and bm.role = 'rider' and bm.is_active
    limit 1`);

  const rider = inspeccionarRider();
  const sesiones = {
    customer: inspeccionarSesion(RUTAS.sesionCustomer, 'cliente'),
    business: inspeccionarSesion(RUTAS.sesionBusiness, 'panel'),
  };

  return {
    negocio,
    producto,
    conteos,
    pedidosAbiertos: abiertos,
    rider,
    sesiones,
    stockBefore: producto ? Number(producto.stock) : null,
    compuertas: {
      negocio: evaluarNegocio(negocio),
      producto: evaluarProducto(producto),
      rider: evaluarRider({
        miembroActivo: Boolean(riderFila),
        paquete: rider.paquete,
        dispositivoConectado: rider.dispositivoConectado,
      }),
      pedidosAbiertos: evaluarPedidosAbiertos(abiertos),
      sesionCustomer: evaluarSesion(sesiones.customer),
      sesionBusiness: evaluarSesion(sesiones.business),
    },
  };
}
