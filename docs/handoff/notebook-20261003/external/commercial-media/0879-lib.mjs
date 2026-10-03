/*
 * Motor de captura del video comercial de TABA2.
 *
 * La idea: una sola página de 1920x1080 (el compositor) que contiene un
 * <iframe> con la app REAL corriendo en modo demo. Playwright maneja la app
 * dentro del iframe y, en la misma pasada, anima el texto de la escena por
 * encima. Se graba la página compuesta: no hay montaje posterior de capas.
 *
 * Se graba a deviceScaleFactor 2 y se codifica a 1920x1080, así el video sale
 * supermuestreado y la tipografía queda limpia.
 */
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const PW = 'D:/1212/la-taba2-first-physical-e2e/node_modules/playwright/index.js';
const pwmod = await import(pathToFileURL(PW).href);
export const { chromium } = pwmod.default ?? pwmod;

export const ROOT = 'D:/1212/artifacts/taba2-walter-commercial-demo';
export const WORK = path.join(ROOT, '_work');
export const RAW = path.join(WORK, 'raw');

export const APP = 'http://127.0.0.1:8481';   // worktree integrado (storefront + panel + tracking)
export const ARCA = 'http://127.0.0.1:8482';  // worktree de automatización fiscal

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Abre el compositor con grabación de video. Devuelve utilidades de escena. */
export async function openScene(name, { base = APP, onContext = null } = {}) {
  const dir = path.join(RAW, name);
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });

  const browser = await chromium.launch();
  const context = await browser.newContext({
    viewport: { width: 1920, height: 1080 },
    deviceScaleFactor: 2,
    locale: 'es-AR',
    timezoneId: 'America/Argentina/Buenos_Aires',
    serviceWorkers: 'block',
    recordVideo: { dir, size: { width: 1920, height: 1080 } },
  });

  if (onContext) await onContext(context);

  const page = await context.newPage();
  const t0 = Date.now();
  const problems = [];
  page.on('pageerror', (e) => problems.push(`pageerror: ${e.message.slice(0, 180)}`));
  await page.goto(`${base}/__demo/compositor.html`, { waitUntil: 'load' });

  /* Cada línea de narración queda anotada con el segundo en que entró y en que
     salió: de ahí sale el .srt, sin transcribir el video a mano. */
  const cues = [];
  const vfx = new Proxy({}, {
    get: (_t, key) => (...args) => {
      if (String(key) === 'say') {
        const t = (Date.now() - t0) / 1000;
        const last = cues[cues.length - 1];
        if (last && last.end === null) last.end = t;
        const text = String(args[0] ?? '');
        if (text) cues.push({ start: t, end: null, text });
      }
      return page.evaluate(([k, a]) => window.VFX[k](...a), [String(key), args]);
    },
  });

  const scene = {
    page, context, browser, dir, problems, vfx, base,
    phone: page.frameLocator('#pframe'),
    win: page.frameLocator('#wframe'),

    /* La puesta en escena (crear el pedido, avanzarlo, sacar al rider) también
       queda grabada. Se hace a negro y se anota el segundo exacto en que
       empieza lo que sí va al video; el montaje corta por ahí. */
    elapsed() { return ((Date.now() - t0) / 1000).toFixed(2); },
    cues,
    marcarCorte() { scene.cut = (Date.now() - t0) / 1000; return scene.cut.toFixed(2); },

    async close() {
      const total = (Date.now() - t0) / 1000;
      const last = cues[cues.length - 1];
      if (last && last.end === null) last.end = total;
      await context.close();
      await browser.close();
      fs.writeFileSync(path.join(RAW, `${name}.json`), JSON.stringify({
        escena: name, corte: scene.cut ?? 0, total, cues,
      }, null, 1));
      const files = fs.readdirSync(dir).filter((f) => f.endsWith('.webm'));
      if (!files.length) throw new Error(`sin video en ${dir}`);
      const from = path.join(dir, files[0]);
      const to = path.join(RAW, `${name}.webm`);
      fs.rmSync(to, { force: true });
      fs.renameSync(from, to);
      fs.rmSync(dir, { recursive: true, force: true });
      return to;
    },
  };
  return scene;
}

/* ── conducción de la app dentro del iframe ───────────────────────────────── */

/*
 * Los paneles demo re-renderizan por intervalo y despegan sus nodos: el click
 * "accionable" de Playwright resuelve el locator y el nodo desaparece antes
 * del gesto. Los handlers del producto están delegados en document, así que
 * despachar el evento al nodo vigente ejerce el mismo código sin la carrera.
 */
export async function tapRaw(locator, { timeout = 12000 } = {}) {
  const el = locator.first();
  await el.waitFor({ state: 'attached', timeout });
  for (let i = 0; i < 5; i += 1) {
    try { await el.dispatchEvent('click', {}, { timeout: 2500 }); return; }
    catch (e) { if (i === 4) throw e; await sleep(220); }
  }
}

/** Lleva el puntero hasta el elemento, lo golpea y recién ahí dispara el click. */
export async function tap(scene, locator, { settle = 620, after = 700 } = {}) {
  const el = locator.first();
  await el.waitFor({ state: 'attached', timeout: 15000 });
  const box = await el.boundingBox().catch(() => null);
  if (box) {
    await scene.vfx.cursor(box.x + box.width / 2, box.y + Math.min(box.height / 2, 28));
    await sleep(settle);
    await scene.vfx.tap();
    await sleep(150);
  }
  await tapRaw(el);
  await sleep(after);
}

/** Escribe como una persona: pulsación por pulsación. */
export async function type(scene, locator, text, { delay = 58, focusFirst = true } = {}) {
  const el = locator.first();
  await el.waitFor({ state: 'visible', timeout: 15000 });
  const box = await el.boundingBox().catch(() => null);
  if (box && focusFirst) {
    await scene.vfx.cursor(box.x + Math.min(box.width / 2, 160), box.y + box.height / 2);
    await sleep(420);
    await scene.vfx.tap();
  }
  await el.click({ timeout: 8000 }).catch(() => el.focus().catch(() => {}));
  await el.pressSequentially(text, { delay });
  await sleep(220);
}

/* El frame VIGENTE del iframe. Guardar la referencia entre pasos no sirve: el
   modo demo renavega (`?reset=1`) y el contexto de ejecución anterior muere. */
export async function frameOf(scene, which) {
  const sel = which === 'win' ? '#wframe' : '#pframe';
  const handle = await scene.page.locator(sel).elementHandle();
  return handle.contentFrame();
}

/* `?reset=1` renavega: la app limpia el estado y vuelve a cargarse sin ese
   parámetro. Interactuar entre medio encuentra un DOM que ya no existe. */
export async function waitApp(scene, which, selector, { timeout = 45000 } = {}) {
  const sel = which === 'win' ? '#wframe' : '#pframe';
  const t0 = Date.now();
  while (Date.now() - t0 < timeout) {
    const url = await scene.page.locator(sel).getAttribute('src').catch(() => '');
    const frame = await frameOf(scene, which);
    const live = frame ? await frame.url() : '';
    if (live && !/[?&]reset=/.test(live)) {
      const ok = await frame.locator(selector).first().waitFor({ state: 'attached', timeout: 6000 })
        .then(() => true).catch(() => false);
      if (ok) { await sleep(350); return frame; }
    }
    void url;
    await sleep(400);
  }
  throw new Error(`la app no quedó lista para ${selector}`);
}

/** Desplazamiento suave dentro del iframe, medido en píxeles CSS del iframe. */
export async function scrollBy(scene, which, dy, { ms = 900 } = {}) {
  const sel = which === 'win' ? '#wframe' : '#pframe';
  const frame = await (await scene.page.locator(sel).elementHandle()).contentFrame();
  await frame.evaluate(([delta, dur]) => new Promise((done) => {
    const start = window.scrollY;
    const t0 = performance.now();
    const step = (t) => {
      const k = Math.min(1, (t - t0) / dur);
      const e = k < .5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2;
      window.scrollTo(0, start + delta * e);
      if (k < 1) requestAnimationFrame(step); else done();
    };
    requestAnimationFrame(step);
  }), [dy, ms]);
  await sleep(ms + 180);
}

export async function scrollTo(scene, which, selector, { ms = 900, offset = -80 } = {}) {
  const sel = which === 'win' ? '#wframe' : '#pframe';
  const frame = await (await scene.page.locator(sel).elementHandle()).contentFrame();
  const y = await frame.evaluate(([s, off]) => {
    const node = document.querySelector(s);
    if (!node) return null;
    return Math.max(0, node.getBoundingClientRect().top + window.scrollY + off);
  }, [selector, offset]);
  if (y === null) return false;
  const cur = await frame.evaluate(() => window.scrollY);
  await scrollBy(scene, which, y - cur, { ms });
  return true;
}

/* El gate del PIN tapa la bandeja: el botón de avance existe en el DOM pero no
   es accionable hasta desbloquear. Se comprueba la visibilidad del BOTÓN, que
   es lo que el paso siguiente necesita, no la del gate. */
export async function unlockPanel(scene, which) {
  const frame = which === 'win' ? scene.win : scene.phone;
  const pin = frame.locator('[data-open-pin][data-admin-target="business"]');
  for (let attempt = 0; attempt < 4; attempt += 1) {
    if (!(await pin.first().isVisible().catch(() => false))) return true;
    await tapRaw(pin);
    const input = frame.locator('[data-pin-form] input[name="pin"]');
    await input.waitFor({ state: 'visible', timeout: 8000 }).catch(() => {});
    await input.fill('1234').catch(() => {});
    // Submit por el botón: el form es method=dialog y Enter puede enviar el
    // valor sin confirmar.
    await tapRaw(frame.locator('[data-pin-form] button[type="submit"]'));
    await sleep(1300);
  }
  return !(await pin.first().isVisible().catch(() => false));
}

/* Agregar al carrito de verdad: el toast de confirmación y el re-render de la
   tarjeta hacen que un segundo click "de una" se pierda. Se verifica el estado. */
export async function addToCart(scene, which, productId, { tries = 4 } = {}) {
  const frame = which === 'win' ? scene.win : scene.phone;
  const before = await cartSize(scene, which);
  for (let i = 0; i < tries; i += 1) {
    await tapRaw(frame.locator(`[data-add-product="${productId}"]`)).catch(() => {});
    await sleep(650);
    if (await cartSize(scene, which) > before) return true;
  }
  return false;
}

export async function cartSize(scene, which) {
  const frame = await frameOf(scene, which);
  return frame.evaluate(async () => {
    const st = await import(new URL('js/state.js', location.href).href);
    return (st.getState().cart || []).length;
  }).catch(() => -1);
}

/** Marca un elemento real de la app: anillo + etiqueta con línea. */
export async function mark(scene, locator, text, { side = 'rtl', id = 'a', ring = true, gap = 24 } = {}) {
  const box = await locator.first().boundingBox().catch(() => null);
  if (!box) return false;
  if (ring) await scene.vfx.ring({ x: box.x, y: box.y, w: box.width, h: box.height, id });
  const y = box.y + box.height / 2;
  const x = side === 'rtl' ? box.x - gap : box.x + box.width + gap;
  await scene.vfx.callout({ x, y, text, side, id });
  return true;
}

export async function textOf(locator) {
  return (await locator.first().textContent().catch(() => '') || '').replace(/\s+/g, ' ').trim();
}

/*
 * ¿El dispositivo está pintando algo?
 *
 * Pasó una vez y no se puede volver a permitir: el DOM del iframe existía, las
 * esperas pasaban en verde y la pantalla salía negra en el video. El DOM no
 * alcanza como prueba. Se saca una captura del área del dispositivo: un PNG de
 * un rectángulo liso comprime a unos pocos KB, uno con interfaz de verdad pesa
 * decenas. Es tosco y funciona.
 */
export async function assertPintado(scene, which) {
  const sel = which === 'win' ? '#wframe' : '#pframe';
  const caja = await scene.page.locator(sel).boundingBox();
  if (!caja) throw new Error(`no se encontró el marco ${which}`);

  // 1 · nadie tapa el dispositivo. El fundido a negro no cuenta: es de la escena.
  const encima = await scene.page.evaluate(({ x, y, id }) => {
    // Un dispositivo apagado (opacidad 0) sigue estando en el layout y aparece
    // en elementsFromPoint; no tapa nada, así que no cuenta.
    const invisible = (n) => {
      for (let a = n; a && a !== document.body; a = a.parentElement) {
        if (Number(getComputedStyle(a).opacity) < 0.05) return true;
      }
      return false;
    };
    const capas = document.elementsFromPoint(x, y).filter((n) => n.id !== 'black' && !invisible(n));
    const primero = capas[0];
    return {
      primero: primero ? `${primero.tagName}#${primero.id}.${String(primero.className).slice(0, 40)}` : 'nada',
      esElMarco: Boolean(primero && (primero.id === id.slice(1) || primero.closest('.stills'))),
    };
  }, { x: caja.x + caja.width / 2, y: caja.y + caja.height / 2, id: sel });
  if (!encima.esElMarco) throw new Error(`algo tapa el marco ${which}: ${encima.primero}`);

  // 2 · la app de adentro pintó contenido de verdad.
  const frame = await frameOf(scene, which);
  const vivo = await frame.evaluate(() => ({
    alto: document.body?.getBoundingClientRect().height || 0,
    texto: (document.body?.innerText || '').replace(/\s+/g, ' ').trim().length,
  })).catch(() => ({ alto: 0, texto: 0 }));
  if (vivo.alto < 200 || vivo.texto < 30) {
    throw new Error(`el marco ${which} está vacío (alto ${Math.round(vivo.alto)}px, ${vivo.texto} caracteres)`);
  }
  return vivo.texto;
}

/** Instantánea de entrega, a 2x, dentro de screenshots/ */
export async function shot(scene, name) {
  const out = path.join(ROOT, 'screenshots', `${name}.png`);
  fs.mkdirSync(path.dirname(out), { recursive: true });
  await scene.page.screenshot({ path: out });
  return out;
}
