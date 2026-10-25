// Arnés del Moto G15 físico: maneja SOLO la pestaña de la tienda (localhost:8261)
// del Chrome del teléfono por DevTools, con eventos táctiles reales, y saca
// capturas de pantalla reales con `adb screencap`.
//
// Requisitos (ver README del informe): `adb reverse tcp:8261 tcp:8261` y
// `adb forward tcp:9261 localabstract:chrome_devtools_remote`.
import { chromium } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

// El serial del teléfono NO se versiona: se toma de MOTO_SERIAL o del único dispositivo autorizado.
function detectarSerial() {
  if (process.env.MOTO_SERIAL) return process.env.MOTO_SERIAL;
  const lista = execFileSync('adb', ['devices'], { env: { ...process.env, MSYS_NO_PATHCONV: '1' } }).toString()
    .split('\n').slice(1).map((l) => l.trim().split(/\s+/)).filter((c) => c[1] === 'device').map((c) => c[0]);
  if (lista.length !== 1) throw new Error(`Se esperaba un único dispositivo adb autorizado (hay ${lista.length}); definí MOTO_SERIAL.`);
  return lista[0];
}
export const SERIAL = detectarSerial();
export const BASE = process.env.TABA_BASE || 'http://localhost:8261';
export const CDP = process.env.MOTO_CDP || 'http://localhost:9261';
const env = { ...process.env, MSYS_NO_PATHCONV: '1' };

const adbCrudo = (...args) => execFileSync('adb', ['-s', SERIAL, ...args], { env, maxBuffer: 64 * 1024 * 1024 });

// El teléfono es PERSONAL: puede tener otra app al frente o una notificación emergente con datos
// de terceros. Nada se escribe en el aparato (`input`) si Chrome no está al frente, y ninguna
// captura se conserva con una notificación encima.
export function chromeAlFrente() {
  const linea = adbCrudo('shell', 'dumpsys', 'window').toString().split('\n').find((l) => l.includes('mCurrentFocus')) || '';
  return /com\.android\.chrome/.test(linea);
}

export function headsUpVisible() {
  const texto = adbCrudo('shell', 'dumpsys', 'activity', 'service', 'com.android.systemui/.SystemUIService').toString();
  const region = (texto.match(/mTouchableRegion=SkRegion\(([^\n]*)\)/) || [])[1] || '';
  const bottoms = [...region.matchAll(/\((\d+),(\d+),(\d+),(\d+)\)/g)].map((m) => Number(m[4]));
  return Math.max(0, ...bottoms) > 140;
}

export function adb(...args) {
  if (args[0] === 'shell' && args[1] === 'input' && !chromeAlFrente()) {
    throw new Error('Chrome no está al frente: no se escribe nada en el teléfono personal');
  }
  return adbCrudo(...args);
}

// Devuelve la ruta realmente escrita: con una notificación encima el archivo lleva el sufijo
// -CON-NOTIFICACION para descartarlo (nunca se versiona ni se comparte).
export function screencap(file) {
  mkdirSync(path.dirname(file), { recursive: true });
  const fin = Date.now() + 12000;
  while (headsUpVisible() && Date.now() < fin) execFileSync(process.execPath, ['-e', 'setTimeout(()=>{},700)']);
  const antes = headsUpVisible();
  const datos = adbCrudo('exec-out', 'screencap', '-p');
  const conNotificacion = antes || headsUpVisible();
  const destino = conNotificacion ? file.replace(/\.png$/, '-CON-NOTIFICACION.png') : file;
  writeFileSync(destino, datos);
  if (conNotificacion) console.warn('AVISO: notificación emergente en pantalla; la captura se marcó para descartarla:', destino);
  return destino;
}

// Toques físicos recientes: si hay una persona tocando el teléfono, no se toca.
export function personaTocando(segundos = 4) {
  try {
    const out = execFileSync('adb', ['-s', SERIAL, 'shell', `timeout ${segundos} getevent -lt /dev/input/event10`],
      { env, timeout: (segundos + 6) * 1000 }).toString();
    return /ABS_MT/.test(out);
  } catch (error) {
    return /ABS_MT/.test(String(error.stdout || ''));
  }
}

export async function connect({ match = BASE } = {}) {
  const browser = await chromium.connectOverCDP(CDP);
  const pages = browser.contexts().flatMap((context) => context.pages());
  // Mi pestaña puede estar en 8261 (relay) o 8262 (estático comprimido): sólo se toca una de las dos.
  const page = pages.find((candidate) => candidate.url().startsWith(match))
    || pages.find((candidate) => /^https?:\/\/localhost:826[1-9]/.test(candidate.url()));
  if (!page) throw new Error(`No hay pestaña de ${match} en el Chrome del Moto. Abrila con adb (am start -d).`);
  await page.bringToFront();
  // Banco HTTP/2 propio (certificado autofirmado, sólo localhost vía adb reverse): el error de
  // certificado se ignora SÓLO en esta sesión de DevTools; no se toca ninguna configuración del teléfono.
  if (process.env.MOTO_IGNORE_CERTS === '1') {
    const sesion = await browser.newBrowserCDPSession();
    await sesion.send('Security.setIgnoreCertificateErrors', { ignore: true });
  }
  return { browser, page };
}

export async function metrics(page) {
  return page.evaluate(() => ({
    innerWidth: window.innerWidth,
    innerHeight: window.innerHeight,
    dpr: window.devicePixelRatio,
    visualViewport: window.visualViewport
      ? { w: window.visualViewport.width, h: window.visualViewport.height, scale: window.visualViewport.scale }
      : null,
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
    overflowX: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
    scrollHeight: document.documentElement.scrollHeight,
    scrollY: Math.round(window.scrollY),
    ua: navigator.userAgent,
    deviceMemory: navigator.deviceMemory ?? null,
    cores: navigator.hardwareConcurrency,
    connection: navigator.connection
      ? { type: navigator.connection.effectiveType, downlink: navigator.connection.downlink, rtt: navigator.connection.rtt }
      : null,
  }));
}

// Toque real: Input.dispatchTouchEvent del Chrome del teléfono (no emula el ratón).
const sesiones = new WeakMap();
export async function cdpDe(page) {
  if (!sesiones.has(page)) sesiones.set(page, await page.context().newCDPSession(page));
  return sesiones.get(page);
}
export async function tapXY(page, x, y) {
  const cdp = await cdpDe(page);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y, id: 1 }] });
  await sleep(60);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
}
export async function tap(page, locator) {
  const target = typeof locator === 'string' ? page.locator(locator).first() : locator;
  await target.scrollIntoViewIfNeeded();
  const box = await target.boundingBox();
  if (!box) throw new Error('Sin caja para tocar');
  await tapXY(page, box.x + box.width / 2, box.y + box.height / 2);
  return box;
}
// Arrastre vertical con el dedo (inercia propia de Chrome, no scrollTo).
export async function swipeY(page, desdeY, hastaY, x = 216, pasos = 8, ms = 220) {
  const cdp = await cdpDe(page);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y: desdeY, id: 1 }] });
  for (let i = 1; i <= pasos; i += 1) {
    await sleep(ms / pasos);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y: desdeY + ((hastaY - desdeY) * i) / pasos, id: 1 }] });
  }
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
}

export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
