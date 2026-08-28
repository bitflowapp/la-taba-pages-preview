/*
 * LA BANDEJA CUANDO CAMBIA UN SOLO PEDIDO.
 * ===========================================================================
 * `business-panel-bench.mjs` (PR #90) mide el tamaño del tablero y cuántas
 * veces se repinta SIN novedades. Esa es la mitad barata del problema y ya está
 * cerrada: sin novedades, el tablero no se toca.
 *
 * La mitad cara es la otra: cuando SÍ hay una novedad. Un pedido que pasa de
 * «recibido» a «en preparación» es un cambio de una tarjeta, y hoy cuesta
 * reconstruir las N. Este guion mide exactamente eso, que es el riesgo 3 que
 * aquel trabajo dejó anotado y no cerró.
 *
 * Qué mide, por cada tamaño de bandeja (50 · 100 · 300 · 500):
 *
 *   1. `bandeja`     — nodos, bytes y milisegundos hasta tener las N tarjetas.
 *   2. `unPedido`    — un pedido cambia de estado en el servidor y se cronometra
 *                      la actualización: cuántos elementos se SACAN del DOM,
 *                      cuántos se PONEN, y cuánto tarda en asentarse. Con
 *                      render completo, «sacados» ≈ el tablero entero.
 *   3. `continuidad` — si al terminar esa actualización sobrevivieron el scroll,
 *                      el texto a medio escribir, el `<details>` abierto y el
 *                      foco. Es lo que separa «rápido» de «usable»: un tablero
 *                      que se rearma bajo el dedo pierde el motivo de
 *                      cancelación que el operador estaba tipeando.
 *   4. `memoria`     — heap y nodos después de 30 cambios seguidos, con
 *                      recolección forzada. Una sesión de jornada completa son
 *                      cientos de estos.
 *
 * No toca Supabase, Mercado Pago ni ARCA: intercepta las llamadas del cliente y
 * contesta con datos inventados. No hay datos reales en la salida.
 *
 *   node scripts/business-tray-scale-bench.mjs --label antes
 *   node scripts/business-tray-scale-bench.mjs --label despues --pedidos 300
 */
import { chromium } from '@playwright/test';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

import { BUSINESS_ID, SUPABASE_URL, instalarDatosDePrueba, pedidosSinteticos } from './lib/business-panel-fixtures.mjs';

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? fallback : process.argv[i + 1];
}

const PORT = Number.parseInt(arg('port', '8207'), 10);
const BASE = `http://127.0.0.1:${PORT}`;
const LABEL = arg('label', 'estado');
const OUT = path.resolve(arg('out', 'artifacts/taba2-panel-escalabilidad'));
const TAMANOS = String(arg('pedidos', '50,100,300,500'))
  .split(',').map((n) => Number.parseInt(n.trim(), 10)).filter(Number.isFinite);
const CICLOS_MEMORIA = Number.parseInt(arg('ciclos', '30'), 10);
// La jornada larga: cientos de cambios seguidos con idas y vueltas de vista,
// que es lo que hace un mostrador en ocho horas. 0 lo apaga.
const CICLOS_JORNADA = Number.parseInt(arg('jornada', '0'), 10);
// Los cinco escenarios A-E. Se pueden apagar (`--escenarios no`) para repetir
// sólo la medición histórica, que es la que compara contra corridas anteriores.
const ESCENARIOS_ACTIVOS = String(arg('escenarios', 'si')) !== 'no';
// El orden en que se REPORTAN. El orden en que se CORREN lo fija
// `medirEscenarios()`: el del reloj va primero, con el servidor quieto.
const ESCENARIOS = ['A-sin-cambio-de-seccion', 'B-cambio-de-seccion', 'C-alta', 'D-baja', 'E-solo-reloj'];
const POLL_MS = 1200;
const VIEWPORT = { width: 390, height: 844 };

// El estado y la revisión son lo que el coordinador mira para decidir si un
// snapshot trae novedades: sin subir `revision`, el pedido cambiado se descarta
// por atrasado y no se mediría ninguna actualización.
//
// El estado del servidor y el que se ve en la píldora no son el mismo nombre
// (`submitted` se muestra «Recibido»), así que el ciclo lleva los dos: uno para
// escribir en el snapshot y otro para esperarlo en el DOM.
const CICLO_DE_ESTADO = [
  { servidor: 'submitted', pildora: 'received' },
  { servidor: 'preparing', pildora: 'preparing' },
  { servidor: 'ready', pildora: 'ready' },
];
const siguienteEstado = (actual) => CICLO_DE_ESTADO[
  (CICLO_DE_ESTADO.findIndex((e) => e.servidor === actual) + 1) % CICLO_DE_ESTADO.length
];

/** N pedidos derivados de los seis de la biblioteca, con identidad propia. */
function muchosPedidos(cuantos) {
  // El molde vive en `business-panel-fixtures.mjs`: es el mismo que usa el banco
  // de la bandeja operativa. Estaba duplicado, y la copia de allá tenía el UUID
  // de 35 caracteres que este comentario describía. Una sola función y una
  // prueba que la mira es lo que impide que vuelvan a separarse.
  return pedidosSinteticos(cuantos, { prefijo: 'LT-8' });
}

fs.mkdirSync(OUT, { recursive: true });

const server = spawn(process.execPath, ['scripts/realtime-relay.mjs', String(PORT)], { stdio: 'ignore' });
// `--enable-precise-memory-info` es lo que hace que `performance.memory` deje de
// redondear a 5 MB. Sin eso, medir el crecimiento de una sesión larga es medir
// el redondeo.
const browser = await chromium.launch({ args: ['--enable-precise-memory-info', '--js-flags=--expose-gc'] });
const medidas = [];

try {
  await esperarServidor();
  for (const cuantos of TAMANOS) {
    console.log(`\n· midiendo con ${cuantos} pedidos…`);
    medidas.push(await medirTamano(cuantos));
  }
} finally {
  await browser.close();
  server.kill();
}

const reporte = {
  schemaVersion: 1,
  label: LABEL,
  generatedAtUtc: new Date().toISOString(),
  businessId: BUSINESS_ID,
  viewport: `${VIEWPORT.width}x${VIEWPORT.height}`,
  pollMs: POLL_MS,
  ciclosDeMemoria: CICLOS_MEMORIA,
  escenarios: ESCENARIOS_ACTIVOS ? ESCENARIOS : null,
  medidas,
};
const archivo = path.join(OUT, `BANDEJA-${LABEL}.json`);
fs.writeFileSync(archivo, `${JSON.stringify(reporte, null, 2)}\n`, 'utf8');
console.log(`\n${tabla(medidas)}`);
if (ESCENARIOS_ACTIVOS) console.log(`\n${tablaDeEscenarios(medidas)}`);
console.log(`\nreporte: ${path.relative(process.cwd(), archivo)}`);

// ---------------------------------------------------------------------------

async function medirTamano(cuantos) {
  const context = await browser.newContext({ viewport: VIEWPORT, hasTouch: true, isMobile: true });
  const page = await context.newPage();
  await instalarDatosDePrueba(page, { conSesion: true });

  // La lista viva: el interceptor contesta SIEMPRE el contenido actual, así que
  // mutarla acá es lo que en producción sería un cambio en el servidor.
  const estado = { lista: muchosPedidos(cuantos) };
  await page.route(`${SUPABASE_URL}/**`, async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname.includes('/rest/v1/orders')) {
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(estado.lista) });
    }
    return route.fallback();
  });
  await page.addInitScript((ms) => {
    const config = globalThis.__LA_TABA_RUNTIME_CONFIG__;
    if (config?.repository) config.repository.pollMs = ms;
    // Sin Tauri: se mide el Panel del navegador, que es el que corre en el
    // teléfono del mostrador.
    try { delete globalThis.__TAURI__; } catch (_) { globalThis.__TAURI__ = undefined; }

    /*
     * LO QUE `querySelectorAll('*')` NO VE.
     * -----------------------------------------------------------------------
     * Un tablero puede no crecer un solo elemento y estar perdiendo memoria
     * igual: temporizadores que nadie apaga, observadores que nadie desconecta,
     * canales entre pestañas que quedan abiertos, escuchas colgadas de nodos
     * que ya no están. Nada de eso aparece contando elementos, así que se
     * cuenta acá, envolviendo las fábricas ANTES de que la aplicación arranque.
     *
     * Se cuentan ALTAS y BAJAS, y lo que importa es la diferencia: un Panel que
     * abre y cierra mil temporizadores está bien; uno que abre mil y cierra
     * novecientos, no.
     */
    const vivos = {
      intervalos: 0, temporizadores: 0, observadoresDom: 0,
      observadoresDeTamano: 0, observadoresDeRendimiento: 0, canales: 0, escuchas: 0,
    };
    globalThis.__vivos = vivos;

    const setIntervalOriginal = globalThis.setInterval;
    const clearIntervalOriginal = globalThis.clearInterval;
    globalThis.setInterval = function (...args) { vivos.intervalos += 1; return setIntervalOriginal.apply(this, args); };
    globalThis.clearInterval = function (...args) { if (args[0] != null) vivos.intervalos -= 1; return clearIntervalOriginal.apply(this, args); };

    const setTimeoutOriginal = globalThis.setTimeout;
    globalThis.setTimeout = function (fn, ...resto) {
      vivos.temporizadores += 1;
      const envuelto = typeof fn === 'function'
        ? function (...a) { vivos.temporizadores -= 1; return fn.apply(this, a); }
        : fn;
      return setTimeoutOriginal.call(this, envuelto, ...resto);
    };

    const envolverObservador = (Clase, clave) => {
      if (typeof Clase !== 'function') return Clase;
      class Contado extends Clase {
        constructor(...args) { super(...args); vivos[clave] += 1; }
        disconnect(...args) { vivos[clave] -= 1; return super.disconnect(...args); }
      }
      return Contado;
    };
    globalThis.MutationObserver = envolverObservador(globalThis.MutationObserver, 'observadoresDom');
    globalThis.ResizeObserver = envolverObservador(globalThis.ResizeObserver, 'observadoresDeTamano');
    globalThis.PerformanceObserver = envolverObservador(globalThis.PerformanceObserver, 'observadoresDeRendimiento');

    if (typeof globalThis.BroadcastChannel === 'function') {
      const Canal = globalThis.BroadcastChannel;
      class CanalContado extends Canal {
        constructor(...args) { super(...args); vivos.canales += 1; }
        close(...args) { vivos.canales -= 1; return super.close(...args); }
      }
      globalThis.BroadcastChannel = CanalContado;
    }

    const agregar = EventTarget.prototype.addEventListener;
    const quitar = EventTarget.prototype.removeEventListener;
    EventTarget.prototype.addEventListener = function (...args) { vivos.escuchas += 1; return agregar.apply(this, args); };
    EventTarget.prototype.removeEventListener = function (...args) { vivos.escuchas -= 1; return quitar.apply(this, args); };
  }, POLL_MS);

  await page.goto(`${BASE}/#business`, { waitUntil: 'domcontentloaded' });
  await page.locator('[data-production-workspace="business"]').waitFor({ state: 'visible', timeout: 60_000 });

  // 1 · desde el toque hasta las N tarjetas.
  await page.evaluate(() => { globalThis.__t0 = performance.now(); });
  await page.locator('[data-production-orders-view]:visible').first().click();
  await page.locator('.production-order-card').nth(cuantos - 1).waitFor({ state: 'attached', timeout: 120_000 });
  const msHastaLaBandeja = Math.round(await page.evaluate(() => performance.now() - globalThis.__t0));

  const bandeja = await page.evaluate(() => {
    const raiz = document.querySelector('[data-production-workspace="business"]');
    return {
      tarjetas: raiz.querySelectorAll('.production-order-card').length,
      nodos: raiz.querySelectorAll('*').length,
      bytes: raiz.innerHTML.length,
    };
  });

  // 2 y 3 · UN pedido cambia, y el operador está trabajando en OTRO.
  //
  // Esa separación es el punto: la pregunta no es si la tarjeta que cambia se
  // repinta —tiene que repintarse— sino si arrastra a las demás. El borrador se
  // deja en una tarjeta distinta de la que va a cambiar, que es lo que pasa en
  // un mostrador: alguien tipea un motivo mientras entra otra novedad.
  const objetivo = estado.lista[Math.min(2, cuantos - 1)];
  const borrador = await prepararContinuidad(page, objetivo.public_code);
  await instalarObservador(page);

  const siguiente = siguienteEstado(objetivo.status);
  estado.lista = estado.lista.map((pedido) => (
    pedido.public_code === objetivo.public_code
      ? { ...pedido, status: siguiente.servidor, revision: pedido.revision + 1, updated_at: new Date().toISOString() }
      : pedido
  ));
  const unPedido = await esperarActualizacion(page, objetivo.public_code, siguiente.pildora);
  const continuidad = await leerContinuidad(page, borrador);

  // 4 · los cinco escenarios, con el mismo arnés y sobre la misma bandeja.
  const escenarios = ESCENARIOS_ACTIVOS ? await medirEscenarios(page, estado, cuantos) : null;

  // 5 · treinta cambios seguidos, que es un rato de jornada, y qué queda.
  const memoria = await medirMemoria(page, estado, cuantos);
  const jornada = CICLOS_JORNADA > 0 ? await medirJornada(page, estado, cuantos) : null;

  await context.close();
  return {
    pedidos: cuantos,
    msHastaLaBandeja,
    ...bandeja,
    unPedido,
    continuidad,
    ...(escenarios ? { escenarios } : {}),
    memoria,
    ...(jornada ? { jornada } : {}),
  };
}

/**
 * Deja el tablero como lo tendría alguien trabajando: scrolleado, con un motivo
 * a medio escribir, un detalle abierto y el foco puesto. Devuelve el código de
 * la tarjeta donde quedó el borrador, que NO es la que va a cambiar.
 */
async function prepararContinuidad(page, codigoQueVaACambiar) {
  return page.evaluate((codigoExcluido) => {
    const codigoDe = (tarjeta) => tarjeta.querySelector('.production-order-code')?.textContent?.trim() || '';
    const tarjetas = [...document.querySelectorAll('.production-order-card')];
    const conEntrada = tarjetas.find((t) => (
      codigoDe(t) !== codigoExcluido && t.querySelector('[data-production-cancel-reason]')
    )) || tarjetas.find((t) => codigoDe(t) !== codigoExcluido);
    if (!conEntrada) return null;

    conEntrada.scrollIntoView({ block: 'center' });
    const entrada = conEntrada.querySelector('[data-production-cancel-reason]');
    if (entrada) {
      entrada.value = 'el cliente pidio esperar';
      entrada.focus();
    }
    const detalle = conEntrada.querySelector('details');
    if (detalle) detalle.open = true;
    const seleccion = entrada ? [entrada.selectionStart, entrada.selectionEnd] : null;
    return {
      codigo: codigoDe(conEntrada),
      scroll: globalThis.scrollY,
      texto: entrada?.value || '',
      conEntrada: Boolean(entrada),
      conDetalle: Boolean(detalle),
      seleccion,
    };
  }, codigoQueVaACambiar);
}

async function leerContinuidad(page, esperado) {
  if (!esperado) return { medible: false };
  return page.evaluate((ref) => {
    const tarjeta = [...document.querySelectorAll('.production-order-card')].find((t) => (
      t.querySelector('.production-order-code')?.textContent?.trim() === ref.codigo
    ));
    const entrada = tarjeta?.querySelector('[data-production-cancel-reason]') || null;
    const detalle = tarjeta?.querySelector('details') || null;
    const scrollAhora = globalThis.scrollY;
    return {
      medible: true,
      // Un salto de más de 8px es visible: la tarjeta que se estaba mirando se
      // fue de la pantalla.
      scrollConservado: Math.abs(scrollAhora - (ref.scroll || 0)) <= 8,
      scrollAntes: Math.round(ref.scroll || 0),
      scrollDespues: Math.round(scrollAhora),
      textoConservado: !ref.conEntrada || entrada?.value === ref.texto,
      detalleAbierto: !ref.conDetalle || Boolean(detalle?.open),
      focoConservado: !ref.conEntrada
        || document.activeElement?.hasAttribute?.('data-production-cancel-reason') === true,
      // Que el cursor vuelva al final del texto y no al principio: si se
      // reemplaza el nodo, la posición se pierde aunque el texto se restaure.
      cursorConservado: !ref.conEntrada || !ref.seleccion
        || (entrada?.selectionStart === ref.seleccion[0] && entrada?.selectionEnd === ref.seleccion[1]),
    };
  }, esperado);
}

/*
 * El observador cuenta ELEMENTOS, no mutaciones. La pregunta que importa no es
 * «cuántas veces se tocó el DOM» sino «cuántos elementos hubo que tirar y
 * volver a construir para mostrar que un pedido cambió de estado».
 */
async function instalarObservador(page) {
  await page.evaluate(() => {
    const raiz = document.querySelector('[data-production-workspace="business"]');
    globalThis.__obs = { agregados: 0, quitados: 0, lotes: 0, reemplazosDeRaiz: 0, tarjetasTocadas: 0 };
    globalThis.__observer = new MutationObserver((mutaciones) => {
      for (const m of mutaciones) {
        if (m.type !== 'childList') continue;
        const agregados = [...m.addedNodes].filter((n) => n.nodeType === 1);
        const quitados = [...m.removedNodes].filter((n) => n.nodeType === 1);
        if (!agregados.length && !quitados.length) continue;
        globalThis.__obs.lotes += 1;
        // Un reemplazo del tablero entero se ve acá: el hijo directo del
        // workspace sale y entra. Es la diferencia entre «se repintó una
        // tarjeta» y «se rearmó todo».
        if (m.target === raiz) globalThis.__obs.reemplazosDeRaiz += 1;
        for (const nodo of [...agregados, ...quitados]) {
          if (nodo.classList?.contains('production-order-card')) globalThis.__obs.tarjetasTocadas += 1;
          else globalThis.__obs.tarjetasTocadas += nodo.querySelectorAll?.('.production-order-card').length || 0;
        }
        // Un subárbol que entra o sale cuenta por todo lo que trae: reemplazar
        // el workspace es UNA mutación y quince mil elementos.
        for (const nodo of agregados) globalThis.__obs.agregados += 1 + nodo.querySelectorAll('*').length;
        for (const nodo of quitados) globalThis.__obs.quitados += 1 + nodo.querySelectorAll('*').length;
      }
    });
    globalThis.__observer.observe(raiz, { childList: true, subtree: true });
    globalThis.__obsInicio = performance.now();
  });
}

async function esperarActualizacion(page, codigo, pildoraEsperada) {
  const inicio = Date.now();
  try {
    await page.waitForFunction(
      ({ c, p }) => {
        const tarjeta = [...document.querySelectorAll('.production-order-card')].find((t) => (
          t.querySelector('.production-order-code')?.textContent?.trim() === c
        ));
        return Boolean(tarjeta?.querySelector(`.status-pill.${p}`));
      },
      { c: codigo, p: pildoraEsperada },
      { timeout: 60_000 },
    );
  } catch (error) {
    // Un benchmark que se cae sin decir qué vio no sirve para nada.
    const visto = await page.evaluate((c) => {
      const tarjetas = [...document.querySelectorAll('.production-order-card')];
      const tarjeta = tarjetas.find((t) => t.querySelector('.production-order-code')?.textContent?.trim() === c);
      return {
        tarjetas: tarjetas.length,
        codigosVisibles: tarjetas.slice(0, 5).map((t) => t.querySelector('.production-order-code')?.textContent?.trim()),
        encontrada: Boolean(tarjeta),
        pildora: tarjeta?.querySelector('.status-pill')?.className || null,
      };
    }, codigo);
    throw new Error(`no llegó el cambio de ${codigo} → ${pildoraEsperada}: ${JSON.stringify(visto)}`);
  }
  // Un respiro para que el lote termine de entregarse antes de leer el contador.
  await page.waitForTimeout(150);
  const obs = await page.evaluate(() => {
    globalThis.__observer.disconnect();
    return { ...globalThis.__obs };
  });
  return {
    elementosQuitados: obs.quitados,
    elementosAgregados: obs.agregados,
    lotesDeMutacion: obs.lotes,
    reemplazosDelTablero: obs.reemplazosDeRaiz,
    tarjetasTocadas: obs.tarjetasTocadas,
    msHastaElCambio: Date.now() - inicio,
  };
}

/*
 * Treinta cambios de estado seguidos con recolección forzada al principio y al
 * final. Lo que se busca no es el número absoluto de heap —depende del momento
 * del recolector— sino que no CREZCA con cada vuelta: eso es lo que convierte un
 * turno de ocho horas en un panel que hay que recargar.
 */
async function medirMemoria(page, estado, cuantos) {
  const cdp = await page.context().newCDPSession(page);
  const leer = async () => {
    await cdp.send('HeapProfiler.collectGarbage');
    await page.waitForTimeout(250);
    return page.evaluate(() => ({
      heapBytes: performance.memory?.usedJSHeapSize ?? null,
      nodosDelDocumento: document.querySelectorAll('*').length,
      escuchasEstimadas: globalThis.__la_taba_listener_count ?? null,
    }));
  };

  const antes = await leer();
  const codigo = estado.lista[Math.min(4, cuantos - 1)].public_code;
  for (let vuelta = 0; vuelta < CICLOS_MEMORIA; vuelta += 1) {
    const actual = estado.lista.find((p) => p.public_code === codigo);
    const siguiente = siguienteEstado(actual.status);
    estado.lista = estado.lista.map((pedido) => (
      pedido.public_code === codigo
        ? { ...pedido, status: siguiente.servidor, revision: pedido.revision + 1 }
        : pedido
    ));
    await page.waitForFunction(
      ({ c, p }) => {
        const tarjeta = [...document.querySelectorAll('.production-order-card')].find((t) => (
          t.querySelector('.production-order-code')?.textContent?.trim() === c
        ));
        return Boolean(tarjeta?.querySelector(`.status-pill.${p}`));
      },
      { c: codigo, p: siguiente.pildora },
      { timeout: 60_000 },
    );
  }
  const despues = await leer();
  await cdp.detach();
  return {
    vueltas: CICLOS_MEMORIA,
    heapAntes: antes.heapBytes,
    heapDespues: despues.heapBytes,
    heapDeltaBytes: antes.heapBytes != null && despues.heapBytes != null
      ? despues.heapBytes - antes.heapBytes : null,
    heapPorVuelta: antes.heapBytes != null && despues.heapBytes != null
      ? Math.round((despues.heapBytes - antes.heapBytes) / CICLOS_MEMORIA) : null,
    nodosAntes: antes.nodosDelDocumento,
    nodosDespues: despues.nodosDelDocumento,
    nodosDelta: despues.nodosDelDocumento - antes.nodosDelDocumento,
  };
}

/*
 * LA JORNADA LARGA.
 * ===========================================================================
 * Treinta cambios dicen si hay una fuga grosera. Trescientos, con la bandeja
 * llena y cambiando de vista cada tanto, dicen si el Panel aguanta un turno.
 *
 * Se mide lo que crece, no lo que es grande: el heap después de forzar
 * recolección, los ELEMENTOS del documento y —esto es lo que casi se escapa—
 * los HIJOS DIRECTOS del workspace contando nodos de TEXTO. Un parche por
 * región que no recorta su marcado deja un nodo de texto suelto por vez, y eso
 * no aparece en ningún `querySelectorAll('*')`.
 */
async function medirJornada(page, estado, cuantos) {
  const cdp = await page.context().newCDPSession(page);
  const muestra = async (ciclo) => {
    await cdp.send('HeapProfiler.collectGarbage');
    await page.waitForTimeout(200);
    return {
      ciclo,
      // `Memory.getDOMCounters` es del navegador y no de la página: cuenta los
      // nodos REALES —incluidos los desprendidos que todavía nadie recolectó— y
      // las escuchas vivas. Es la respuesta a «no declares que no hay fuga
      // porque `querySelectorAll('*')` no creció».
      contadoresDelNavegador: await cdp.send('Memory.getDOMCounters').catch(() => null),
      ...(await page.evaluate(() => {
        const workspace = document.querySelector('[data-production-workspace="business"]');
        return {
          heapBytes: performance.memory?.usedJSHeapSize ?? null,
          elementosDelDocumento: document.querySelectorAll('*').length,
          hijosDelWorkspace: workspace?.childNodes.length ?? null,
          tarjetas: document.querySelectorAll('.production-order-card').length,
          // Cuántos pedidos están marcados como «requieren atención». Crece solo
          // con el tiempo —los pedidos envejecen y cruzan los umbrales— y es la
          // explicación honesta de por qué el documento gana elementos durante
          // una jornada sin que eso sea una fuga.
          tarjetasEnAtencion: document.querySelectorAll('.production-order-card.is-attention').length,
          avisosDeAtencion: document.querySelectorAll('.order-attention li').length,
          secciones: document.querySelectorAll('[data-tray-section]').length,
          vivos: { ...(globalThis.__vivos || {}) },
        };
      })),
    };
  };

  const codigo = estado.lista[Math.min(7, cuantos - 1)].public_code;
  const cada = Math.max(1, Math.round(CICLOS_JORNADA / 6));
  const muestras = [await muestra(0)];
  for (let ciclo = 1; ciclo <= CICLOS_JORNADA; ciclo += 1) {
    const actual = estado.lista.find((pedido) => pedido.public_code === codigo);
    const siguiente = siguienteEstado(actual.status);
    estado.lista = estado.lista.map((pedido) => (
      pedido.public_code === codigo
        ? { ...pedido, status: siguiente.servidor, revision: pedido.revision + 1 }
        : pedido
    ));
    await page.waitForFunction(
      ({ c, p }) => {
        const tarjeta = [...document.querySelectorAll('.production-order-card')].find((item) => (
          item.querySelector('.production-order-code')?.textContent?.trim() === c
        ));
        return Boolean(tarjeta?.querySelector(`.status-pill.${p}`));
      },
      { c: codigo, p: siguiente.pildora },
      { timeout: 60_000 },
    );
    // Cada 25 vueltas, el operador se va a «Qué pasa» y vuelve. Es el camino que
    // fuerza el render completo, y el que más oportunidades de fuga tiene.
    if (ciclo % 25 === 0) {
      await page.locator('[data-business-ops-view="operation-center"]:visible').first().click();
      await page.locator('[data-business-ops-center="operation-center"]').waitFor({ state: 'visible', timeout: 30_000 });
      await page.locator('[data-production-orders-view]:visible').first().click();
      await page.locator('.production-order-card').nth(cuantos - 1).waitFor({ state: 'attached', timeout: 60_000 });
    }
    if (ciclo % cada === 0) muestras.push(await muestra(ciclo));
  }
  await cdp.detach();

  const primera = muestras[0];
  const ultima = muestras[muestras.length - 1];
  const delta = (camino) => {
    const leer = (m) => camino.split('.').reduce((v, k) => (v == null ? v : v[k]), m);
    const a = leer(primera);
    const b = leer(ultima);
    return a == null || b == null ? null : b - a;
  };
  return {
    ciclos: CICLOS_JORNADA,
    muestras,
    heapDeltaBytes: ultima.heapBytes - primera.heapBytes,
    heapPorCiclo: Math.round((ultima.heapBytes - primera.heapBytes) / CICLOS_JORNADA),
    /*
     * LA PENDIENTE DE LA SEGUNDA MITAD, que es la que dice si hay fuga.
     *
     * `heapPorCiclo` sobre la corrida entera engaña: el Panel sube de golpe en
     * las primeras vueltas —los pedidos envejecen, cruzan los umbrales y ganan
     * su aviso de atención, que es interfaz real y se queda— y después se
     * planta. Medir (último − primero) / ciclos reparte esa subida inicial entre
     * las 320 vueltas y la hace parecer un goteo constante.
     *
     * Una fuga se ve en la pendiente cuando la curva ya se estabilizó. Si la
     * segunda mitad es plana dentro del ruido del recolector, no hay fuga: hay
     * un escalón.
     */
    heapSegundaMitad: (() => {
      const mitad = muestras[Math.floor(muestras.length / 2)];
      if (!mitad || mitad === ultima) return null;
      return {
        desdeCiclo: mitad.ciclo,
        hastaCiclo: ultima.ciclo,
        deltaBytes: ultima.heapBytes - mitad.heapBytes,
        porCiclo: Math.round((ultima.heapBytes - mitad.heapBytes) / (ultima.ciclo - mitad.ciclo)),
        // El ruido contra el que hay que leer esa pendiente: cuánto oscila el
        // heap entre muestras consecutivas después de forzar recolección.
        oscilacionMaximaBytes: muestras.slice(1).reduce((max, m, i) => (
          Math.max(max, Math.abs(m.heapBytes - muestras[i].heapBytes))
        ), 0),
      };
    })(),
    elementosDelta: ultima.elementosDelDocumento - primera.elementosDelDocumento,
    hijosDelWorkspaceDelta: ultima.hijosDelWorkspace - primera.hijosDelWorkspace,
    tarjetasAlFinal: ultima.tarjetas,
    // Lo que explica el crecimiento de elementos sin invocar una fuga.
    avisosDeAtencionDelta: delta('avisosDeAtencion'),
    tarjetasEnAtencionDelta: delta('tarjetasEnAtencion'),
    seccionesDelta: delta('secciones'),
    // Lo que `querySelectorAll('*')` no ve.
    nodosDelNavegadorDelta: delta('contadoresDelNavegador.nodes'),
    escuchasDelNavegadorDelta: delta('contadoresDelNavegador.jsEventListeners'),
    documentosDelta: delta('contadoresDelNavegador.documents'),
    intervalosDelta: delta('vivos.intervalos'),
    temporizadoresDelta: delta('vivos.temporizadores'),
    observadoresDomDelta: delta('vivos.observadoresDom'),
    observadoresDeTamanoDelta: delta('vivos.observadoresDeTamano'),
    observadoresDeRendimientoDelta: delta('vivos.observadoresDeRendimiento'),
    canalesDelta: delta('vivos.canales'),
    escuchasDelta: delta('vivos.escuchas'),
  };
}

/*
 * LOS CINCO ESCENARIOS, CON EL MISMO ARNÉS.
 * ===========================================================================
 * La medición de arriba responde una pregunta: «un pedido que avanza de estado,
 * ¿cuánto cuesta?». La integración de las dos mitades del Panel obliga a
 * separarla en cinco, porque la bandeja ahora tiene SECCIONES y no todas las
 * novedades cuestan lo mismo:
 *
 *   A · el pedido cambia y NO cambia de sección. Es el caso más común del
 *       turno —cambia el nombre, una observación, un dato del cliente— y el que
 *       tiene que costar exactamente una tarjeta.
 *   B · el pedido cambia DE SECCIÓN. Sale de una, entra en otra, y los dos
 *       recuentos se corrigen. Es el que podría rearmar las dos secciones si la
 *       cabecera viajara pegada al cuerpo.
 *   C · entra un pedido NUEVO.
 *   D · se va un pedido TERMINADO.
 *   E · no pasa NADA en el servidor y sólo avanza el reloj vivo. Es el que
 *       decide si un minuto que pasa marca 500 tarjetas como modificadas.
 *
 * El criterio no son números mágicos: es que A, B, C y D cuesten
 * aproximadamente lo mismo con 50 que con 500, y que E no toque ninguna
 * tarjeta.
 *
 * ELEMENTOS DESTRUIDOS vs. MOVIDOS
 * --------------------------------
 * Un `MutationObserver` no distingue «este nodo se fue» de «este nodo se
 * movió»: las dos cosas son un `removedNodes` y un `addedNodes`. La diferencia
 * importa mucho —un nodo movido conserva su estado, sus escuchas y lo que el
 * operador tenía escrito adentro; uno destruido no— así que se distinguen por
 * IDENTIDAD: un nodo que sale y vuelve a entrar en la misma ventana se movió.
 */

/**
 * Espera a que no entre ni salga una tarjeta durante dos vueltas de sondeo.
 *
 * Sin esto, cualquier escenario puede empezar a medir con el repintado del
 * cambio ANTERIOR todavía en vuelo y atribuírselo.
 */
async function esperarBandejaQuieta(page, { vueltas = 2, intentos = 12 } = {}) {
  const ventana = POLL_MS * vueltas + 400;
  for (let intento = 0; intento < intentos; intento += 1) {
    await page.evaluate(() => {
      const raiz = document.querySelector('[data-production-workspace="business"]');
      globalThis.__quietud = 0;
      globalThis.__quietudObs = new MutationObserver((mutaciones) => {
        for (const m of mutaciones) {
          for (const nodo of [...m.addedNodes, ...m.removedNodes]) {
            if (nodo.nodeType !== 1) continue;
            globalThis.__quietud += nodo.classList?.contains('production-order-card')
              ? 1
              : (nodo.querySelectorAll?.('.production-order-card').length || 0);
          }
        }
      });
      globalThis.__quietudObs.observe(raiz, { childList: true, subtree: true });
    });
    await page.waitForTimeout(ventana);
    const movimiento = await page.evaluate(() => {
      globalThis.__quietudObs.disconnect();
      return globalThis.__quietud;
    });
    if (movimiento === 0) return true;
  }
  throw new Error('la bandeja no se aquietó: sigue moviendo tarjetas sin que el servidor cambie nada');
}

async function instalarContador(page) {
  await page.evaluate(() => {
    const raiz = document.querySelector('[data-production-workspace="business"]');
    const cuenta = {
      creados: 0, destruidos: 0, movidos: 0, tarjetasTocadas: 0,
      reemplazosDeRaiz: 0, lotes: 0, textoReescrito: 0,
      // De la primera a la última mutación del cambio. Es el trabajo de DOM en
      // sí, sin la espera del sondeo: `msHastaElCambio` está dominado por el
      // intervalo de poll (1200 ms) y diría lo mismo con seis pedidos que con
      // quinientos, así que no sirve para ver si algo escala.
      primeraMutacion: null, ultimaMutacion: null,
    };
    // La identidad de lo que salió, para reconocerlo si vuelve a entrar.
    const salidos = new Set();
    const entrados = new Set();
    globalThis.__cuenta = cuenta;
    globalThis.__contador = new MutationObserver((mutaciones) => {
      for (const m of mutaciones) {
        if (m.type === 'characterData') { cuenta.textoReescrito += 1; continue; }
        if (m.type !== 'childList') continue;
        const puestos = [...m.addedNodes];
        const quitados = [...m.removedNodes];
        // El reloj vivo reescribe el nodo de TEXTO de su `<time>`: no es un
        // elemento y no puede contarse como tal, pero sí se cuenta aparte.
        const elementosPuestos = puestos.filter((n) => n.nodeType === 1);
        const elementosQuitados = quitados.filter((n) => n.nodeType === 1);
        cuenta.textoReescrito += puestos.length - elementosPuestos.length;
        if (!elementosPuestos.length && !elementosQuitados.length) continue;
        cuenta.lotes += 1;
        const ahora = performance.now();
        if (cuenta.primeraMutacion === null) cuenta.primeraMutacion = ahora;
        cuenta.ultimaMutacion = ahora;
        if (m.target === raiz) cuenta.reemplazosDeRaiz += 1;
        for (const nodo of [...elementosPuestos, ...elementosQuitados]) {
          cuenta.tarjetasTocadas += nodo.classList?.contains('production-order-card')
            ? 1
            : (nodo.querySelectorAll?.('.production-order-card').length || 0);
        }
        for (const nodo of elementosQuitados) salidos.add(nodo);
        for (const nodo of elementosPuestos) entrados.add(nodo);
      }
      // Un nodo en las dos listas se movió: no se destruyó ni se creó.
      cuenta.movidos = 0;
      cuenta.destruidos = 0;
      cuenta.creados = 0;
      for (const nodo of salidos) {
        const peso = 1 + (nodo.querySelectorAll?.('*').length || 0);
        if (entrados.has(nodo)) cuenta.movidos += peso;
        else cuenta.destruidos += peso;
      }
      for (const nodo of entrados) {
        if (salidos.has(nodo)) continue;
        cuenta.creados += 1 + (nodo.querySelectorAll?.('*').length || 0);
      }
    });
    globalThis.__contador.observe(raiz, { childList: true, subtree: true, characterData: true });

    /*
     * EL TIEMPO DE CPU, QUE ES LO QUE DE VERDAD ESCALA.
     * -----------------------------------------------------------------------
     * `msHastaElCambio` está dominado por el sondeo (1200 ms) y `msDeTrabajoDeDom`
     * da cero porque todas las mutaciones de un cambio llegan en UN solo lote
     * del observador —el render es síncrono— y la resolución del reloj no lo
     * separa.
     *
     * Lo que sí se puede medir es cuánto bloqueó el hilo principal. Rearmar el
     * tablero de 500 pedidos es una tarea larga y aparece acá; reemplazar una
     * tarjeta, no. Es el número que contesta «¿esto se pone caro con la
     * bandeja llena?» sin depender del intervalo de sondeo.
     */
    globalThis.__cuenta.msDeTareasLargas = 0;
    globalThis.__cuenta.tareaMasLarga = 0;
    try {
      globalThis.__tareas = new PerformanceObserver((lista) => {
        for (const entrada of lista.getEntries()) {
          globalThis.__cuenta.msDeTareasLargas += Math.round(entrada.duration);
          globalThis.__cuenta.tareaMasLarga = Math.max(
            globalThis.__cuenta.tareaMasLarga, Math.round(entrada.duration),
          );
        }
      });
      globalThis.__tareas.observe({ entryTypes: ['longtask'] });
    } catch (_) {
      // Un navegador sin `longtask` no invalida el resto de la medición.
      globalThis.__cuenta.msDeTareasLargas = null;
    }
  });
}

async function leerContador(page) {
  await page.waitForTimeout(150);
  return page.evaluate(() => {
    globalThis.__contador.takeRecords?.();
    globalThis.__contador.disconnect();
    globalThis.__tareas?.disconnect?.();
    return { ...globalThis.__cuenta };
  });
}

/** El estado del DOM que sirve para comparar antes y después. */
async function fotoDelDom(page) {
  return page.evaluate(() => {
    const raiz = document.querySelector('[data-production-workspace="business"]');
    return {
      elementosDelDocumento: document.querySelectorAll('*').length,
      elementosDelWorkspace: raiz.querySelectorAll('*').length,
      hijosDelWorkspace: raiz.childNodes.length,
      tarjetas: raiz.querySelectorAll('.production-order-card').length,
      secciones: raiz.querySelectorAll('[data-tray-section]').length,
      heapBytes: performance.memory?.usedJSHeapSize ?? null,
    };
  });
}

/**
 * Corre un escenario: prepara el trabajo del operador, instala el contador,
 * aplica el cambio en el servidor, espera a verlo y devuelve el costo.
 *
 * `aplicar` muta `estado.lista`. `esperar` es la condición del DOM que dice que
 * el cambio llegó; para el escenario del reloj no hay ninguna y se mide una
 * ventana de tiempo.
 */
async function correrEscenario(page, { nombre, estado, codigoQueCambia, aplicar, esperar, ventanaMs }) {
  // Cada escenario empieza con la bandeja quieta: lo que mida es SUYO y no la
  // cola del repintado anterior.
  await esperarBandejaQuieta(page);
  const borrador = await prepararContinuidad(page, codigoQueCambia);
  const antes = await fotoDelDom(page);
  await instalarContador(page);
  const t0 = Date.now();
  if (aplicar) aplicar();
  let msHastaElCambio = null;
  if (esperar) {
    await page.waitForFunction(esperar.fn, esperar.arg, { timeout: 60_000 });
    msHastaElCambio = Date.now() - t0;
  } else {
    await page.waitForTimeout(ventanaMs || 1000);
  }
  const cuenta = await leerContador(page);
  const continuidad = await leerContinuidad(page, borrador);
  const despues = await fotoDelDom(page);
  return {
    escenario: nombre,
    msHastaElCambio,
    ventanaMs: esperar ? null : (ventanaMs || 1000),
    elementosDestruidos: cuenta.destruidos,
    elementosCreados: cuenta.creados,
    elementosMovidos: cuenta.movidos,
    tarjetasTocadas: cuenta.tarjetasTocadas,
    reemplazosDelTablero: cuenta.reemplazosDeRaiz,
    lotesDeMutacion: cuenta.lotes,
    nodosDeTextoReescritos: cuenta.textoReescrito,
    msDeTrabajoDeDom: cuenta.primeraMutacion === null
      ? 0
      : Math.round(cuenta.ultimaMutacion - cuenta.primeraMutacion),
    msDeTareasLargas: cuenta.msDeTareasLargas,
    tareaMasLargaMs: cuenta.tareaMasLarga,
    domAntes: antes,
    domDespues: despues,
    continuidad,
  };
}

/** La píldora de estado que el DOM va a mostrar cuando llegue el cambio. */
function esperaDePildora(codigo, pildora) {
  return {
    fn: ({ c, p }) => {
      const tarjeta = [...document.querySelectorAll('.production-order-card')].find((t) => (
        t.querySelector('.production-order-code')?.textContent?.trim() === c
      ));
      return Boolean(tarjeta?.querySelector(`.status-pill.${p}`));
    },
    arg: { c: codigo, p: pildora },
  };
}

async function medirEscenarios(page, estado, cuantos) {
  const salida = [];

  /*
   * E VA PRIMERO Y SE PREPARA, porque medirlo «a ver si pasa algo» no prueba
   * nada.
   *
   * Con las marcas de tiempo del molde, en una ventana de 32 segundos puede que
   * NINGÚN pedido cruce un minuto: el reloj no reescribe nada, la bandeja no se
   * mueve, y el escenario da cero por la razón equivocada. Sale un cero que no
   * demuestra lo que se quería demostrar.
   *
   * Así que primero se lleva a TODOS los pedidos a 3 minutos 45 segundos de
   * antigüedad. Dentro de la ventana, todos cruzan a «hace 4 min» y el reloj
   * tiene que reescribir las N etiquetas. Ahí sí, «cero tarjetas tocadas»
   * significa algo: el minuto pasó, el texto cambió en las quinientas, y
   * ninguna tarjeta se reconstruyó.
   *
   * 3:45 y no otra cosa: los tres umbrales de atención están en 10, 15 y 60+
   * minutos, así que cruzar de 3 a 4 no mueve un solo pedido de sección. El
   * escenario tiene que aislar el reloj, no disfrazarse de cambio de estado.
   *
   * `updated_at` y `ready_at` acompañan para que un pedido listo sin repartidor
   * no cruce su propio umbral de 15 minutos durante la ventana.
   */
  const hace345 = new Date(Date.now() - 225_000).toISOString();
  estado.lista = estado.lista.map((pedido) => ({
    ...pedido,
    created_at: hace345,
    updated_at: hace345,
    ...(pedido.ready_at ? { ready_at: hace345 } : {}),
    revision: pedido.revision + 1,
  }));
  /*
   * Y se espera a que ese cambio ATERRICE DEL TODO antes de medir.
   *
   * Esto no es una precaución de más: la primera versión esperaba a ver «hace
   * 3 min» en alguna tarjeta y arrancaba. Pero cambiar `created_at` en las N
   * cambia el `datetime` y la hora exacta del detalle de las N, o sea que es un
   * cambio REAL de las N tarjetas y las reconstruye una vez. Medido así, el
   * escenario del reloj reportaba una bandeja entera destruida —25.348
   * elementos con 500 pedidos— y la conclusión habría sido que un minuto que
   * pasa rearma el tablero. Lo que rearmaba el tablero era la preparación del
   * propio escenario.
   *
   * Se espera a que la bandeja quede QUIETA: dos vueltas de sondeo completas
   * sin que entre ni salga una tarjeta. Recién ahí empieza la ventana, y lo que
   * se mueva adentro se movió por el reloj.
   */
  await page.waitForFunction(() => [...document.querySelectorAll('[data-elapsed-from]')]
    .some((n) => n.textContent?.trim() === 'hace 3 min'), null, { timeout: 60_000 });
  await esperarBandejaQuieta(page);

  // La ventana es de 32 segundos porque el reloj vivo late cada 30.
  const soloReloj = await correrEscenario(page, {
    nombre: 'E-solo-reloj',
    estado,
    codigoQueCambia: null,
    aplicar: null,
    esperar: null,
    ventanaMs: 32_000,
  });
  soloReloj.relojesQueCruzaronDeMinuto = await page.evaluate(() => (
    [...document.querySelectorAll('[data-elapsed-from]')]
      .filter((n) => n.textContent?.trim() === 'hace 4 min').length
  ));
  salida.push(soloReloj);

  // A · cambia el pedido sin cambiar de sección: el nombre del cliente, que es
  //     lo que la tarjeta muestra arriba de todo y no mueve nada de lugar.
  const paraA = estado.lista[Math.min(2, cuantos - 1)];
  salida.push(await correrEscenario(page, {
    nombre: 'A-sin-cambio-de-seccion',
    estado,
    codigoQueCambia: paraA.public_code,
    aplicar: () => {
      estado.lista = estado.lista.map((pedido) => (
        pedido.public_code === paraA.public_code
          ? { ...pedido, customer_name: 'Cliente Renombrado', revision: pedido.revision + 1 }
          : pedido
      ));
    },
    esperar: {
      fn: (c) => {
        const tarjeta = [...document.querySelectorAll('.production-order-card')].find((t) => (
          t.querySelector('.production-order-code')?.textContent?.trim() === c
        ));
        return Boolean(tarjeta?.textContent?.includes('Cliente Renombrado'));
      },
      arg: paraA.public_code,
    },
  }));

  // B · cambia de sección.
  const paraB = estado.lista.find((p) => p.public_code === paraA.public_code);
  const siguiente = siguienteEstado(paraB.status);
  salida.push(await correrEscenario(page, {
    nombre: 'B-cambio-de-seccion',
    estado,
    codigoQueCambia: paraB.public_code,
    aplicar: () => {
      estado.lista = estado.lista.map((pedido) => (
        pedido.public_code === paraB.public_code
          ? {
            ...pedido,
            status: siguiente.servidor,
            revision: pedido.revision + 1,
            updated_at: new Date().toISOString(),
          }
          : pedido
      ));
    },
    esperar: esperaDePildora(paraB.public_code, siguiente.pildora),
  }));

  // C · entra un pedido nuevo. Se deriva del molde compartido para que su UUID
  //     sea válido: uno inválido pierde identidad y no llega nunca.
  const nuevo = {
    ...pedidosSinteticos(cuantos + 1)[cuantos],
    status: 'submitted',
    revision: 1,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
  const alta = await correrEscenario(page, {
    nombre: 'C-alta',
    estado,
    codigoQueCambia: nuevo.public_code,
    aplicar: () => { estado.lista = [nuevo, ...estado.lista]; },
    esperar: {
      fn: (c) => [...document.querySelectorAll('.production-order-code')]
        .some((n) => n.textContent?.trim() === c),
      arg: nuevo.public_code,
    },
  });
  // Con la bandeja en el tope, un alta cuesta además una baja: el repositorio
  // sirve como máximo `MAX_BUSINESS_INBOX_ORDERS`. No es un defecto y hay que
  // poder leerlo en la tabla, porque explica por qué a 500 este escenario toca
  // dos tarjetas en vez de una.
  alta.desalojoPorTope = alta.domDespues.tarjetas === alta.domAntes.tarjetas;
  salida.push(alta);

  /*
   * D · se va un pedido terminado: el repositorio lo saca de la bandeja.
   *
   * El pedido se elige LEYENDO EL DOM y no la lista del servidor. Con 500, la
   * bandeja está en el tope que sirve el repositorio
   * (`MAX_BUSINESS_INBOX_ORDERS`), así que el alta del escenario C desalojó al
   * último: dar de baja «el último de la lista» habría dado de baja a uno que no
   * estaba dibujado, y el escenario habría medido cero por no medir nada.
   */
  const codigoParaD = await page.evaluate(() => {
    const codigos = [...document.querySelectorAll('.production-order-card .production-order-code')];
    return codigos[codigos.length - 1]?.textContent?.trim() || null;
  });
  const paraD = estado.lista.find((pedido) => pedido.public_code === codigoParaD)
    || estado.lista[estado.lista.length - 1];
  salida.push(await correrEscenario(page, {
    nombre: 'D-baja',
    estado,
    codigoQueCambia: paraD.public_code,
    aplicar: () => {
      estado.lista = estado.lista.filter((pedido) => pedido.public_code !== paraD.public_code);
    },
    esperar: {
      fn: (c) => ![...document.querySelectorAll('.production-order-code')]
        .some((n) => n.textContent?.trim() === c),
      arg: paraD.public_code,
    },
  }));

  return salida;
}

/*
 * La tabla que contesta la pregunta del criterio: ¿el costo de UN cambio crece
 * con la cantidad de pedidos? Se lee por columnas, no por filas: para cada
 * escenario, los cuatro tamaños tienen que decir aproximadamente lo mismo.
 */
function tablaDeEscenarios(filas) {
  const cab = ['escenario', 'pedidos', 'destruidos', 'creados', 'movidos', 'tarj.', 'rearmes', 'ms→ver', 'CPU ms', 'tarea max', 'DOM', 'heap MB', 'texto'];
  const cuerpo = [];
  for (const nombre of ESCENARIOS) {
    for (const fila of filas) {
      const e = (fila.escenarios || []).find((x) => x.escenario === nombre);
      if (!e) continue;
      cuerpo.push([
        nombre, fila.pedidos,
        e.elementosDestruidos, e.elementosCreados, e.elementosMovidos,
        e.tarjetasTocadas, e.reemplazosDelTablero,
        e.msHastaElCambio ?? `ventana ${e.ventanaMs}`,
        e.msDeTareasLargas ?? '-',
        e.tareaMasLargaMs ?? '-',
        e.domDespues.elementosDelWorkspace,
        e.domDespues.heapBytes != null ? (e.domDespues.heapBytes / 1048576).toFixed(1) : '-',
        e.nodosDeTextoReescritos,
      ].map(String));
    }
  }
  const anchos = cab.map((c, i) => Math.max(c.length, ...cuerpo.map((f) => f[i].length)));
  const linea = (celdas) => celdas.map((c, i) => c.padStart(anchos[i])).join('  ');
  return [linea(cab), linea(anchos.map((a) => '-'.repeat(a))), ...cuerpo.map(linea)].join('\n');
}

function tabla(filas) {
  const cab = ['pedidos', 'nodos', 'bytes', 'ms→bandeja', 'quitados', 'tarj.tocadas', 'rearmes', 'ms cambio', 'heap/vuelta', 'nodos Δ', 'scroll', 'texto'];
  const cuerpo = filas.map((f) => [
    f.pedidos, f.nodos, f.bytes, f.msHastaLaBandeja,
    f.unPedido.elementosQuitados, f.unPedido.tarjetasTocadas,
    f.unPedido.reemplazosDelTablero, f.unPedido.msHastaElCambio,
    f.memoria.heapPorVuelta, f.memoria.nodosDelta,
    f.continuidad.scrollConservado ? 'ok' : 'PERDIDO',
    f.continuidad.textoConservado ? 'ok' : 'PERDIDO',
  ].map(String));
  const anchos = cab.map((c, i) => Math.max(c.length, ...cuerpo.map((f) => f[i].length)));
  const linea = (celdas) => celdas.map((c, i) => c.padStart(anchos[i])).join('  ');
  return [linea(cab), linea(anchos.map((a) => '-'.repeat(a))), ...cuerpo.map(linea)].join('\n');
}

async function esperarServidor() {
  for (let intento = 0; intento < 60; intento += 1) {
    try {
      const r = await fetch(`${BASE}/`);
      if (r.ok) return;
    } catch (_) { /* todavía no acepta conexiones */ }
    await new Promise((resolve) => { setTimeout(resolve, 500); });
  }
  throw new Error('el servidor local no respondió a tiempo');
}
