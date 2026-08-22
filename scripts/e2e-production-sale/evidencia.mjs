/*
 * Evidencia y redacción.
 *
 * Todo lo que sale de una corrida pasa por acá antes de tocar el disco. El PIN
 * de entrega es el caso que manda: se lee de la pantalla del cliente, se usa en
 * el teléfono del repartidor y NO puede quedar escrito en ningún lado. El
 * reporte dice que se leyó y que funcionó; nunca cuál era.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { PATRONES_SENSIBLES, RUTAS } from './contrato.mjs';

export function redactar(texto) {
  let salida = String(texto ?? '');
  for (const { patron, reemplazo } of PATRONES_SENSIBLES) {
    salida = salida.replace(patron, reemplazo);
  }
  return salida;
}

/** Redacta recursivamente cualquier estructura antes de serializarla. */
export function redactarProfundo(valor) {
  if (typeof valor === 'string') return redactar(valor);
  if (Array.isArray(valor)) return valor.map(redactarProfundo);
  if (valor && typeof valor === 'object') {
    return Object.fromEntries(Object.entries(valor).map(([clave, contenido]) => {
      // Una clave que se llama como un secreto no viaja ni redactada.
      if (/pin|token|password|secret|clave/i.test(clave)) return [clave, '[REDACTADO]'];
      return [clave, redactarProfundo(contenido)];
    }));
  }
  return valor;
}

export function crearEvidencia(runId, { raiz = process.cwd() } = {}) {
  const directorio = path.join(raiz, RUTAS.evidencia, runId);
  mkdirSync(directorio, { recursive: true });

  const registro = [];
  /*
   * La línea de tiempo es lo que se lee cuando algo salió mal: cada hito con su
   * marca y con cuánto pasó desde el anterior. Se arma en memoria y se vuelca
   * al final, para que una corrida interrumpida igual deje lo que alcanzó.
   */
  const lineaDeTiempo = [];
  const arranque = Date.now();

  const anotar = (linea) => {
    const seguro = redactar(linea);
    registro.push(`${new Date().toISOString()} ${seguro}`);
    console.log(`  ${seguro}`);
  };

  return Object.freeze({
    directorio,
    anotar,
    ruta: (nombre) => path.join(directorio, nombre),
    hito(nombre, detalle = '') {
      const ahora = Date.now();
      const anterior = lineaDeTiempo.length ? lineaDeTiempo[lineaDeTiempo.length - 1].msDesdeElInicio : 0;
      lineaDeTiempo.push({
        nombre: redactar(nombre),
        detalle: redactar(detalle),
        utc: new Date(ahora).toISOString(),
        msDesdeElInicio: ahora - arranque,
        msDesdeElHitoAnterior: (ahora - arranque) - anterior,
      });
    },
    /**
     * Una captura de pantalla del navegador. Nunca falla la corrida: una
     * evidencia que no se pudo sacar es una evidencia menos, no un error de la
     * tienda.
     */
    async capturar(pagina, nombre) {
      try {
        await pagina.screenshot({ path: path.join(directorio, `${nombre}.png`), fullPage: true });
        return true;
      } catch {
        return false;
      }
    },
    guardarJson(nombre, datos) {
      writeFileSync(path.join(directorio, nombre), `${JSON.stringify(redactarProfundo(datos), null, 2)}\n`);
    },
    guardarTexto(nombre, texto) {
      writeFileSync(path.join(directorio, nombre), redactar(texto));
    },
    volcarRegistro() {
      writeFileSync(path.join(directorio, 'run.log'), `${registro.join('\n')}\n`);
      writeFileSync(
        path.join(directorio, 'timeline.json'),
        `${JSON.stringify(redactarProfundo(lineaDeTiempo), null, 2)}\n`,
      );
    },
  });
}

/**
 * El reporte que el dueño lee. Los pasos en el mismo orden en que ocurren, con
 * su resultado y el tiempo que tardó cada transición.
 */
export function construirReporte({ runId, pasos, tiempos, resumen, modo }) {
  const lineas = [];
  lineas.push('TABA PRODUCTION SALE E2E');
  lineas.push('');
  for (const paso of pasos) {
    const puntos = '.'.repeat(Math.max(1, 23 - paso.nombre.length));
    lineas.push(`${paso.nombre} ${puntos} ${paso.estado}${paso.detalle ? ` · ${paso.detalle}` : ''}`);
  }
  lineas.push('');
  lineas.push(resumen);
  const texto = redactar(lineas.join('\n'));

  const md = [];
  md.push(`# Prueba de venta real — ${runId}`);
  md.push('');
  md.push(`Modo: **${modo}**`);
  md.push('');
  md.push('```text');
  md.push(texto);
  md.push('```');
  if (tiempos && Object.keys(tiempos).length) {
    md.push('');
    md.push('## Latencia de cada transición');
    md.push('');
    md.push('| transición | ms |');
    md.push('|---|---|');
    for (const [nombre, ms] of Object.entries(tiempos)) md.push(`| ${nombre} | ${ms} |`);
  }
  md.push('');
  md.push('El PIN de entrega se leyó de la pantalla del cliente y no se escribió en ningún archivo.');
  return { texto, markdown: redactar(md.join('\n')) };
}
