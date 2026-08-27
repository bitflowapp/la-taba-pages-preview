/*
 * QUÉ CUESTA LA BANDEJA DEL NEGOCIO CON EL HISTORIAL CRECIENDO.
 *
 * POR QUÉ EXISTE
 * --------------
 * `renderBusinessDashboard()` reemplaza el `innerHTML` del panel ENTERO en cada
 * render, y el panel se vuelve a dibujar con cada evento de tiempo real. La
 * pregunta no es si eso «suena mal»: es cuánto cuesta con 50, 100 y 500 pedidos,
 * y qué se lleva puesto cuando ocurre. Sin ese número, cualquier refactor es una
 * corazonada cara.
 *
 * Este guion NO toca producción. Corre en modo demostración, sobre el servidor
 * local, y fabrica los pedidos CLONANDO uno real creado por el checkout de
 * verdad: la forma del dato sale del código, no de mi cabeza.
 *
 * QUÉ MIDE, Y POR QUÉ ESO
 * -----------------------
 *   · render inicial, pedido nuevo, cambio de estado, filtro  — el costo en ms
 *   · nodos del DOM                                            — de dónde sale ese costo
 *   · memoria                                                  — si escala o se acumula
 *   · scroll, foco, <details> abiertos y selección             — QUÉ SE PIERDE
 *
 * Lo último es lo que un promedio de milisegundos esconde: con un reemplazo
 * total de `innerHTML`, un operador que estaba leyendo un pedido a mitad de la
 * bandeja vuelve arriba, con el detalle cerrado y sin foco, cada vez que entra
 * un pedido. Eso no es lentitud, es pérdida de trabajo, y se mide aparte.
 *
 *   node scripts/measure-business-inbox-performance.mjs [--cantidades=50,100,500]
 *                                                       [--repeticiones=3]
 *                                                       [--salida=archivo.json]
 */
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from '@playwright/test';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PUERTO = Number(process.env.TABA_E2E_HTTP_PORT || 8123);
const BASE = `http://127.0.0.1:${PUERTO}`;

const argumento = (nombre, porDefecto) => {
  const encontrado = process.argv.find((a) => a.startsWith(`--${nombre}=`));
  return encontrado ? encontrado.slice(nombre.length + 3) : porDefecto;
};

const CANTIDADES = String(argumento('cantidades', '50,100,500'))
  .split(',').map((n) => Number(n.trim())).filter((n) => Number.isFinite(n) && n > 0);
const REPETICIONES = Number(argumento('repeticiones', '3'));
const SALIDA = argumento('salida', '');
const ETIQUETA = argumento('etiqueta', 'sin-etiqueta');

/** Estados operativos reales de la bandeja, para que el reparto por pestañas sea realista. */
const ESTADOS = ['received', 'preparing', 'ready', 'on_the_way', 'delivered'];

async function abrirPanel(page) {
  await page.goto(`${BASE}/?reset=1&demo=1#business`, { waitUntil: 'domcontentloaded' });
  await page.waitForURL((url) => !url.searchParams.has('reset'), { waitUntil: 'domcontentloaded' });
  await page.waitForLoadState('load');
  await page.locator('html[data-taba-startup="ready"]').waitFor({ state: 'attached', timeout: 60_000 });
  await page.locator('[data-open-pin][data-admin-target="business"]').click();
  await page.locator('[data-pin-form] input[name="pin"]').fill('1234');
  await page.locator('[data-pin-form]').press('Enter');
  await page.locator('[data-view="business"]').waitFor({ state: 'visible', timeout: 30_000 });
  await page.locator('[data-order-inbox]').waitFor({ state: 'attached', timeout: 30_000 });
}

/**
 * Un pedido REAL, creado por el checkout de demostración. Es la semilla que se
 * clona: así la forma del dato —campos, tipos, anidados— sale del código y no
 * de una invención mía que podría medir una estructura que no existe.
 */
async function crearPedidoSemilla(page) {
  await page.evaluate(() => { window.location.hash = '#catalog'; });
  const add = page.locator('[data-product-grid] [data-add-product]:not([disabled]) >> visible=true').first();
  await add.waitFor({ state: 'visible', timeout: 30_000 });
  const productId = await add.getAttribute('data-add-product');
  await add.click();
  await page.locator(`[data-cart-inc="${productId}"] >> visible=true`).first().click();

  await page.evaluate(() => { window.location.hash = '#cart'; });
  await page.locator('[data-checkout-form]').waitFor({ state: 'visible', timeout: 30_000 });
  await page.getByLabel('Retiro en local').check();
  await page.evaluate(() => {
    const form = document.querySelector('[data-checkout-form]');
    form.querySelector('[name="customerName"]').value = 'Cliente Benchmark';
    form.querySelector('[name="customerPhone"]').value = '2995550000';
  });
  await page.locator('[data-checkout-form] [type="submit"]').click();
  await page.waitForFunction(async () => {
    const { getState } = await import('/js/state.js');
    return getState().orders.length > 0;
  }, null, { timeout: 30_000 });

  return page.evaluate(async () => {
    const { getState } = await import('/js/state.js');
    return JSON.parse(JSON.stringify(getState().orders[0]));
  });
}

/** Instala N clones del pedido semilla, repartidos entre los estados operativos. */
async function sembrar(page, semilla, cantidad, estados) {
  await page.evaluate(async ({ semilla: base, cantidad: n, estados: sts }) => {
    const { updateState } = await import('/js/state.js');
    const pedidos = [];
    for (let i = 0; i < n; i += 1) {
      const clon = JSON.parse(JSON.stringify(base));
      clon.id = `BENCH-${String(i).padStart(4, '0')}`;
      clon.status = sts[i % sts.length];
      clon.customerName = `Cliente ${i}`;
      clon.createdAt = new Date(Date.now() - i * 60_000).toISOString();
      pedidos.push(clon);
    }
    // `updateState` MUTA un borrador y descarta lo que devuelva el mutador.
    // Devolver un objeto nuevo acá no sembraba nada y el banco medía siempre
    // el mismo pedido: los tres tamaños daban idéntico, que fue la señal.
    updateState((estado) => { estado.orders = pedidos; });
  }, { semilla, cantidad, estados: ESTADOS });
}

/** Corre `renderBusinessDashboard` y devuelve cuánto tardó, medido adentro de la página. */
async function medirRender(page) {
  return page.evaluate(async () => {
    const { renderBusinessDashboard } = await import('/js/business.js');
    const t0 = performance.now();
    renderBusinessDashboard();
    const t1 = performance.now();
    return t1 - t0;
  });
}

async function medirDom(page) {
  return page.evaluate(() => ({
    total: document.querySelectorAll('*').length,
    bandeja: document.querySelectorAll('[data-inbox-order]').length,
    panel: document.querySelector('[data-business-dashboard]')?.querySelectorAll('*').length || 0,
    htmlBytes: new TextEncoder().encode(
      document.querySelector('[data-business-dashboard]')?.innerHTML || '',
    ).byteLength,
  }));
}

async function medirMemoria(page) {
  return page.evaluate(() => {
    const m = performance.memory;
    return m ? Math.round(m.usedJSHeapSize / 1024 / 1024) : null;
  });
}

/*
 * LO QUE EL REEMPLAZO TOTAL SE LLEVA PUESTO.
 *
 * Se deja la bandeja en el estado en que la tendría un operador trabajando —con
 * scroll a la mitad, un detalle abierto y el foco en un control—, entra un
 * pedido, y se mira qué sobrevivió. No mide velocidad: mide si el operador
 * pierde lo que estaba haciendo.
 */
async function medirPreservacion(page) {
  const preparado = await page.evaluate(() => {
    const tarjetas = document.querySelectorAll('[data-inbox-order]');
    if (tarjetas.length < 6) return null;
    const objetivo = tarjetas[Math.floor(tarjetas.length / 2)];
    const detalle = objetivo.querySelector('details');
    if (detalle) detalle.open = true;
    const boton = objetivo.querySelector('button');
    if (boton) boton.focus();
    const contenedor = document.scrollingElement || document.documentElement;
    contenedor.scrollTop = Math.floor(contenedor.scrollHeight / 2);
    return {
      id: objetivo.getAttribute('data-inbox-order'),
      scroll: contenedor.scrollTop,
      detalleAbierto: detalle ? detalle.open : null,
      foco: boton ? (boton.textContent || '').trim().slice(0, 40) : null,
    };
  });
  if (!preparado) return null;

  // Entra un pedido, como en un turno real.
  await page.evaluate(async () => {
    const { getState, updateState } = await import('/js/state.js');
    const base = getState().orders[0];
    const nuevo = JSON.parse(JSON.stringify(base));
    nuevo.id = 'BENCH-NUEVO';
    nuevo.status = 'received';
    nuevo.createdAt = new Date().toISOString();
    updateState((estado) => { estado.orders = [nuevo, ...estado.orders]; });
    const { renderBusinessDashboard } = await import('/js/business.js');
    renderBusinessDashboard();
  });

  const despues = await page.evaluate((id) => {
    const contenedor = document.scrollingElement || document.documentElement;
    const objetivo = document.querySelector(`[data-inbox-order="${id}"]`);
    const detalle = objetivo?.querySelector('details');
    const activo = document.activeElement;
    return {
      scroll: contenedor.scrollTop,
      detalleAbierto: detalle ? detalle.open : null,
      focoEnBody: activo === document.body || activo === document.documentElement,
      focoTexto: activo && activo !== document.body ? (activo.textContent || '').trim().slice(0, 40) : null,
    };
  }, preparado.id);

  return {
    antes: preparado,
    despues,
    scrollPreservado: Math.abs((despues.scroll || 0) - (preparado.scroll || 0)) <= 4,
    detallePreservado: despues.detalleAbierto === true,
    focoPreservado: !despues.focoEnBody,
  };
}

async function medirCantidad(page, semilla, cantidad) {
  const rendersIniciales = [];
  const nuevos = [];
  const cambios = [];
  const filtros = [];

  for (let r = 0; r < REPETICIONES; r += 1) {
    await sembrar(page, semilla, cantidad, ESTADOS);
    rendersIniciales.push(await medirRender(page));

    // Un pedido nuevo entra a la bandeja.
    nuevos.push(await page.evaluate(async () => {
      const { getState, updateState } = await import('/js/state.js');
      const { renderBusinessDashboard } = await import('/js/business.js');
      const base = getState().orders[0];
      const nuevo = JSON.parse(JSON.stringify(base));
      nuevo.id = `BENCH-NEW-${Math.floor(performance.now())}`;
      nuevo.status = 'received';
      updateState((estado) => { estado.orders = [nuevo, ...estado.orders]; });
      const t0 = performance.now();
      renderBusinessDashboard();
      return performance.now() - t0;
    }));

    // Un pedido cambia de estado: es el evento más frecuente de un turno.
    cambios.push(await page.evaluate(async () => {
      const { getState, updateState } = await import('/js/state.js');
      const { renderBusinessDashboard } = await import('/js/business.js');
      const id = getState().orders[0].id;
      updateState((estado) => {
        estado.orders = estado.orders.map((o) => (o.id === id ? { ...o, status: 'preparing' } : o));
      });
      const t0 = performance.now();
      renderBusinessDashboard();
      return performance.now() - t0;
    }));

    // Cambiar de pestaña en la bandeja.
    filtros.push(await page.evaluate(async () => {
      const tab = document.querySelector('[data-inbox-tab]:not([aria-selected="true"])');
      if (!tab) return null;
      const t0 = performance.now();
      tab.click();
      return performance.now() - t0;
    }));
  }

  await sembrar(page, semilla, cantidad, ESTADOS);
  await medirRender(page);
  const dom = await medirDom(page);
  const memoria = await medirMemoria(page);
  const preservacion = await medirPreservacion(page);

  const mediana = (xs) => {
    const limpios = xs.filter((x) => Number.isFinite(x)).sort((a, b) => a - b);
    if (!limpios.length) return null;
    return Math.round(limpios[Math.floor(limpios.length / 2)] * 100) / 100;
  };

  return {
    pedidos: cantidad,
    renderInicialMs: mediana(rendersIniciales),
    pedidoNuevoMs: mediana(nuevos),
    cambioEstadoMs: mediana(cambios),
    filtroMs: mediana(filtros),
    dom,
    memoriaMB: memoria,
    preservacion,
  };
}

const navegador = await chromium.launch();
const contexto = await navegador.newContext({ viewport: { width: 390, height: 844 } });
const page = await contexto.newPage();
const resultados = [];
try {
  await abrirPanel(page);
  const semilla = await crearPedidoSemilla(page);
  await page.evaluate(() => { window.location.hash = '#business'; });
  await page.locator('[data-order-inbox]').waitFor({ state: 'attached', timeout: 30_000 });

  for (const cantidad of CANTIDADES) {
    const medicion = await medirCantidad(page, semilla, cantidad);
    resultados.push(medicion);
    const p = medicion.preservacion;
    console.log(
      `${String(cantidad).padStart(4)} pedidos  `
      + `render ${String(medicion.renderInicialMs).padStart(8)} ms  `
      + `nuevo ${String(medicion.pedidoNuevoMs).padStart(8)} ms  `
      + `estado ${String(medicion.cambioEstadoMs).padStart(8)} ms  `
      + `nodos ${String(medicion.dom.total).padStart(6)}  `
      + `html ${String(Math.round(medicion.dom.htmlBytes / 1024)).padStart(5)} KB  `
      + `mem ${String(medicion.memoriaMB).padStart(4)} MB`,
    );
    if (p) {
      console.log(
        `            al entrar un pedido:  scroll ${p.scrollPreservado ? 'OK' : 'PERDIDO'}  `
        + `detalle ${p.detallePreservado ? 'OK' : 'PERDIDO'}  `
        + `foco ${p.focoPreservado ? 'OK' : 'PERDIDO'}`,
      );
    }
  }
} finally {
  await contexto.close();
  await navegador.close();
}

const informe = {
  etiqueta: ETIQUETA,
  base: BASE,
  repeticiones: REPETICIONES,
  resultados,
};
if (SALIDA) {
  const destino = path.isAbsolute(SALIDA) ? SALIDA : path.join(ROOT, SALIDA);
  fs.mkdirSync(path.dirname(destino), { recursive: true });
  fs.writeFileSync(destino, `${JSON.stringify(informe, null, 2)}\n`);
  console.log(`\ninforme: ${path.relative(ROOT, destino)}`);
}
