/*
 * LO QUE EL TELÉFONO DICE DE SÍ MISMO, ANTES DE TOCARLO.
 *
 * Este archivo tenía además un precheck completo —base, sesiones, compuertas—
 * que dejó de usarse cuando el runner autónomo pasó a armar el suyo. Dos
 * prechecks que tienen que decir lo mismo terminan diciendo cosas distintas, y
 * el que decide si se crea un pedido de producción no puede ser el que quedó
 * desactualizado. Quedó sólo la parte que nadie más sabe hacer: mirar el
 * teléfono sin abrir la aplicación.
 */
import { execFileSync } from 'node:child_process';
import { RIDER } from './contrato.mjs';

/**
 * En qué estado está el teléfono para adb.
 *
 * La diferencia importa más de lo que parece. `device` es lo único que sirve,
 * pero un teléfono que NO APARECE y uno que aparece `offline` mandan a hacer
 * cosas distintas: el primero es un cable, y el segundo es una pantalla
 * bloqueada o un permiso de depuración esperando que alguien lo acepte. Decir
 * «no aparece en adb» cuando aparece offline manda a buscar un cable que ya
 * estaba puesto — se midió el 2026-08-22, con el cable conectado.
 */
export function estadoAdbDelTelefono(salidaDeDevices, serie = RIDER.serie) {
  const linea = String(salidaDeDevices || '').split('\n')
    .map((l) => l.trim())
    .find((l) => l.startsWith(serie));
  if (!linea) return 'ausente';
  return linea.split(/\s+/)[1] || 'desconocido';
}

/** El teléfono, mirado sin tocar la aplicación. */
export function inspeccionarRider() {
  const adb = (argumentos) => execFileSync('adb', argumentos, { encoding: 'utf8', timeout: 30_000 }).trim();
  try {
    const estadoAdb = estadoAdbDelTelefono(adb(['devices']));
    if (estadoAdb !== 'device') {
      return {
        dispositivoConectado: false, estadoAdb, paquete: null, version: null, pantalla: null, bateria: null,
      };
    }
    const paquetes = adb(['-s', RIDER.serie, 'shell', 'pm', 'list', 'packages', RIDER.paquete]);
    const instalado = paquetes.split('\n').map((l) => l.trim()).includes(`package:${RIDER.paquete}`);
    const info = instalado ? adb(['-s', RIDER.serie, 'shell', 'dumpsys', 'package', RIDER.paquete]) : '';
    const tamano = adb(['-s', RIDER.serie, 'shell', 'wm', 'size']);
    const bateria = (adb(['-s', RIDER.serie, 'shell', 'dumpsys', 'battery']).match(/level:\s*(\d+)/) || [])[1] || null;
    return {
      dispositivoConectado: true,
      estadoAdb,
      paquete: instalado ? RIDER.paquete : null,
      version: (info.match(/versionName=([^\s]+)/) || [])[1] || null,
      pantalla: (tamano.match(/Physical size:\s*(\S+)/) || [])[1] || null,
      bateria: bateria ? Number(bateria) : null,
    };
  } catch (error) {
    return { dispositivoConectado: false, estadoAdb: 'error', error: String(error.message || error).slice(0, 200) };
  }
}
