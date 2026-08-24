/*
 * El informe de pruebas INESTABLES: las que fallaron y pasaron al reintentar.
 *
 * POR QUÉ EXISTE
 * --------------
 * Reintentar recupera señal —el gate deja de morir por un error del motor a los
 * 28 minutos— pero abre un agujero: un reintento que pasa por casualidad tapa
 * una regresión de verdad, y nadie se entera nunca. «Verde» pasaría a
 * significar dos cosas distintas y sólo una sería cierta.
 *
 * Este informe corta eso. Una corrida con reintentos exitosos NO se lee igual
 * que una limpia:
 *
 *   0 inestables          verde, y verde quiere decir verde.
 *   1..UMBRAL inestables  verde CON AVISO. Cada una queda nombrada en el log,
 *                         con el error de su primer intento, y en un archivo
 *                         que se sube como artefacto para poder contarlas entre
 *                         corridas sin montar una base de datos.
 *   > UMBRAL inestables   ROJO. Una corrida donde muchas pruebas necesitaron
 *                         reintento no es «verde con un aviso»: es una corrida
 *                         inestable, y declararla buena sería el mismo verde
 *                         silencioso que esto existe para evitar.
 *
 * Lo que NO hace: tocar una aserción. Una prueba que falla las DOS veces sigue
 * roja, con su mensaje intacto.
 */
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

/** Cuántas inestables se toleran antes de considerar la corrida inestable. */
export const UMBRAL_INESTABLES = Number(process.env.TABA_E2E_FLAKY_MAX ?? 3);

const SALIDA = process.env.TABA_E2E_FLAKY_REPORT || 'artifacts/ci/e2e-flaky.json';

/** El nombre completo de una prueba, como se lo lee en el log. */
export function nombreCompleto(test) {
  const proyecto = test.parent?.project?.()?.name ?? '';
  const titulo = test.titlePath ? test.titlePath().filter(Boolean).join(' › ') : test.title;
  return proyecto && !titulo.startsWith(proyecto) ? `[${proyecto}] ${titulo}` : titulo;
}

/**
 * La decisión, separada del reporter para poder probarla sin Playwright.
 * @param {{inestables: Array<{nombre: string}>, estado: string, umbral: number}} entrada
 */
export function decidir({ inestables, estado, umbral = UMBRAL_INESTABLES }) {
  // Una corrida ya roja se queda roja: los reintentos no la salvan ni la
  // empeoran, y pisar ese estado escondería la falla real.
  if (estado !== 'passed') return { estado, lineas: [] };

  if (inestables.length === 0) {
    return { estado: 'passed', lineas: ['E2E estable: ninguna prueba necesitó reintento.'] };
  }

  const lineas = inestables.map(({ nombre, error }) => (
    `::warning::PRUEBA INESTABLE (pasó al reintentar): ${nombre}${error ? ` — primer intento: ${error}` : ''}`
  ));
  lineas.push(`${inestables.length} prueba(s) inestable(s). El verde de esta corrida NO es un verde limpio.`);

  if (inestables.length > umbral) {
    lineas.push(`::error::${inestables.length} inestables supera el umbral de ${umbral}: la corrida se considera INESTABLE, no verde.`);
    return { estado: 'failed', lineas };
  }
  lineas.push(`Umbral: ${umbral}. Se acepta con aviso, y queda registrado en ${SALIDA}.`);
  return { estado: 'passed', lineas };
}

/** El primer renglón del error del intento fallido, sin volcar la traza entera. */
function resumenDeError(resultado) {
  const crudo = resultado?.error?.message || resultado?.errors?.[0]?.message || '';
  return crudo.split('\n').map((l) => l.trim()).find(Boolean)?.slice(0, 200) || '';
}

export default class ReporterInestables {
  constructor(opciones = {}) {
    this.umbral = opciones.umbral ?? UMBRAL_INESTABLES;
    this.salida = opciones.salida ?? SALIDA;
    this.inestables = [];
  }

  onTestEnd(test, resultado) {
    // `flaky` es el veredicto de Playwright para «falló y después pasó».
    if (test.outcome?.() !== 'flaky') return;
    if (resultado.status === 'passed' && resultado.retry === 0) return;
    if (this.inestables.some((x) => x.nombre === nombreCompleto(test))) return;
    const fallido = test.results?.find((r) => r.status !== 'passed');
    this.inestables.push({ nombre: nombreCompleto(test), error: resumenDeError(fallido) });
  }

  async onEnd(resultado) {
    const { estado, lineas } = decidir({
      inestables: this.inestables,
      estado: resultado.status,
      umbral: this.umbral,
    });
    for (const linea of lineas) console.log(linea);

    try {
      fs.mkdirSync(path.dirname(this.salida), { recursive: true });
      fs.writeFileSync(this.salida, `${JSON.stringify({
        total: this.inestables.length,
        umbral: this.umbral,
        estado,
        pruebas: this.inestables,
      }, null, 2)}\n`);
    } catch (error) {
      console.log(`::warning::No se pudo escribir el informe de inestables: ${error.message}`);
    }

    return { status: estado };
  }
}
