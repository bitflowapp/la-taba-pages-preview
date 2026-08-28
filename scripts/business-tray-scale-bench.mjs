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

import { BUSINESS_ID, SUPABASE_URL, instalarDatosDePrueba, pedidos } from './lib/business-panel-fixtures.mjs';

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
  const base = pedidos();
  const salida = [];
  for (let i = 0; i < cuantos; i += 1) {
    const molde = base[i % base.length];
    const n = String(i + 1).padStart(4, '0');
    salida.push({
      ...molde,
      // El UUID tiene que ser VÁLIDO, y no es un detalle cosmético: con un
      // último grupo de once dígitos en vez de doce, el adaptador descarta el
      // `backendId` y el pedido pierde la identidad con la que el coordinador
      // compara revisiones. El resultado es una bandeja que se dibuja bien y
      // NUNCA se actualiza: medir un cambio sobre eso da cero movimiento y una
      // conclusión falsa. Costó una tarde encontrarlo.
      id: `00000000-0000-4000-8000-${n.padStart(12, '0')}`,
      public_code: `LT-8${n}`,
      revision: (i % 7) + 1,
      order_items: molde.order_items.map((item, j) => ({ ...item, id: `${n}-${j}` })),
    });
  }
  return salida;
}

fs.mkdirSync(OUT, { recursive: true });

const server = spawn(process.execPath, ['scripts/realtime-relay.mjs', String(PORT)], { stdio: 'ignore' });
// `--enable-precise-memory-info` es lo que hace que `performance.memory` deje de
// redondear a 5 MB. Sin eso, medir el crecimiento de una sesión larga es medir
// el redondeo.
// `TABA_CHROMIUM_PATH` es para entornos donde el navegador ya está instalado
// fuera de la carpeta que espera esta versión de Playwright. Sin la variable,
// se usa el de siempre.
const browser = await chromium.launch({
  args: ['--enable-precise-memory-info', '--js-flags=--expose-gc'],
  ...(process.env.TABA_CHROMIUM_PATH ? { executablePath: process.env.TABA_CHROMIUM_PATH } : {}),
});
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
  medidas,
};
const archivo = path.join(OUT, `BANDEJA-${LABEL}.json`);
fs.writeFileSync(archivo, `${JSON.stringify(reporte, null, 2)}\n`, 'utf8');
console.log(`\n${tabla(medidas)}`);
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

  // 4 · treinta cambios seguidos, que es un rato de jornada, y qué queda.
  const memoria = await medirMemoria(page, estado, cuantos);
  const jornada = CICLOS_JORNADA > 0 ? await medirJornada(page, estado, cuantos) : null;

  await context.close();
  return {
    pedidos: cuantos, msHastaLaBandeja, ...bandeja, unPedido, continuidad, memoria, ...(jornada ? { jornada } : {}),
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
      ...(await page.evaluate(() => {
        const workspace = document.querySelector('[data-production-workspace="business"]');
        return {
          heapBytes: performance.memory?.usedJSHeapSize ?? null,
          elementosDelDocumento: document.querySelectorAll('*').length,
          hijosDelWorkspace: workspace?.childNodes.length ?? null,
          tarjetas: document.querySelectorAll('.production-order-card').length,
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
  return {
    ciclos: CICLOS_JORNADA,
    muestras,
    heapDeltaBytes: ultima.heapBytes - primera.heapBytes,
    heapPorCiclo: Math.round((ultima.heapBytes - primera.heapBytes) / CICLOS_JORNADA),
    elementosDelta: ultima.elementosDelDocumento - primera.elementosDelDocumento,
    hijosDelWorkspaceDelta: ultima.hijosDelWorkspace - primera.hijosDelWorkspace,
    tarjetasAlFinal: ultima.tarjetas,
  };
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
