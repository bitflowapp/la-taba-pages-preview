# -*- coding: utf-8 -*-
import sys
sys.path.insert(0, '.local/qa')
from editar import reemplazar

VIEJO_INVITACION = """async function verificarInvitacion() {
  lineas.push('');
  lineas.push('INVITACIÓN');

  // Android con el evento disponible.
  const android = await browser.newContext({ userAgent: ANDROID_UA, viewport: { width: 390, height: 844 }, hasTouch: true });
  const pageAndroid = await android.newPage();
  await pageAndroid.addInitScript(() => {
    window.__prompts = 0;
    window.__fire = () => {
      const evento = new Event('beforeinstallprompt');
      evento.prompt = async () => { window.__prompts += 1; return { outcome: 'dismissed' }; };
      evento.userChoice = Promise.resolve({ outcome: 'dismissed' });
      window.dispatchEvent(evento);
    };
  });
  await pageAndroid.goto(`${ENTRADA}`, { waitUntil: 'load' });
  await pageAndroid.locator('html[data-taba-startup="ready"]').waitFor({ state: 'attached', timeout: 60_000 });
  await pageAndroid.evaluate(() => window.__fire());
  const hojaAndroid = pageAndroid.locator('[data-install-sheet]');
  await hojaAndroid.waitFor({ state: 'visible', timeout: 15_000 }).catch(() => undefined);
  if (await hojaAndroid.isVisible()) ok('Android: la hoja se abre con el evento del navegador capturado');
  else mal('Android: la hoja no se abrió con el evento disponible');
  const titulo = await pageAndroid.locator('[data-install-view="android"] .install-sheet-title').textContent().catch(() => '');
  dato(`título: ${String(titulo || '').trim()}`);
  await android.close();

  // iPhone sin instalar.
  const ios = await browser.newContext({ userAgent: IPHONE_UA, viewport: { width: 390, height: 844 }, hasTouch: true });
  const pageIos = await ios.newPage();
  await pageIos.goto(`${ENTRADA}`, { waitUntil: 'load' });
  await pageIos.locator('html[data-taba-startup="ready"]').waitFor({ state: 'attached', timeout: 60_000 });
  const hojaIos = pageIos.locator('[data-install-view="ios"]');
  await hojaIos.waitFor({ state: 'visible', timeout: 15_000 }).catch(() => undefined);
  if (await hojaIos.isVisible()) ok('iPhone: se ofrece la guía y no un prompt inexistente');
  else mal('iPhone: no apareció la guía');"""

NUEVO_INVITACION = """/*
 * LA INVITACIÓN NO SE OFRECE EN LA PUERTA, Y ESTA COMPROBACIÓN LO IGNORABA.
 *
 * Este guion abría la tienda con un contexto limpio —o sea, un cliente que
 * llega por primera vez— y exigía que la hoja de instalación apareciera. El
 * producto decidió lo contrario, y lo dice su propia prueba: «la PRIMERA
 * pantalla es la tienda: al estreno no se le pide nada». La invitación es para
 * quien VUELVE, o para quien ya puso algo en el carrito.
 *
 * Resultado: dos FALLA permanentes. Comprobado contra el sitio publicado
 * —runtime v86, código anterior a este cambio— el 2026-08-25: las mismas dos.
 * Un gate que está rojo siempre no protege nada; es la tercera vez que aparece
 * el mismo patrón en esta auditoría, junto con el preflight clavado en
 * `app.js?v=46` y la sonda de salud clavada en 103 migraciones.
 *
 * Ahora se comprueba el contrato VIGENTE, que es más exigente que el anterior
 * porque son dos afirmaciones en vez de una: en el estreno NO aparece, y al
 * volver SÍ. La marca de visitante conocido es la misma que usa la suite E2E.
 */
const VISITANTE_CONOCIDO = 'TABA_VISITOR_SEEN_V1';
// La invitación se programa con un retardo; hay que esperar más que eso para
// poder afirmar que no apareció.
const ESPERA_SIN_INVITACION = 4000;

async function verificarInvitacion() {
  lineas.push('');
  lineas.push('INVITACIÓN');

  // Estreno: la primera pantalla es la tienda y no se le pide nada a nadie.
  const estreno = await browser.newContext({ userAgent: ANDROID_UA, viewport: { width: 390, height: 844 }, hasTouch: true });
  const pageEstreno = await estreno.newPage();
  await pageEstreno.addInitScript(armarEventoDeInstalacion);
  await pageEstreno.goto(`${ENTRADA}`, { waitUntil: 'load' });
  await pageEstreno.locator('html[data-taba-startup="ready"]').waitFor({ state: 'attached', timeout: 60_000 });
  await pageEstreno.evaluate(() => window.__fire());
  await pageEstreno.waitForTimeout(ESPERA_SIN_INVITACION);
  if (!(await pageEstreno.locator('[data-install-sheet]').isVisible())) {
    ok('Estreno: la primera pantalla es la tienda, sin invitación encima');
  } else {
    mal('Estreno: la invitación tapó la primera pantalla del cliente nuevo');
  }
  await estreno.close();

  // Android que VUELVE, con el evento disponible.
  const android = await browser.newContext({ userAgent: ANDROID_UA, viewport: { width: 390, height: 844 }, hasTouch: true });
  const pageAndroid = await android.newPage();
  await pageAndroid.addInitScript(armarEventoDeInstalacion);
  await pageAndroid.addInitScript((clave) => { localStorage.setItem(clave, '1'); }, VISITANTE_CONOCIDO);
  await pageAndroid.goto(`${ENTRADA}`, { waitUntil: 'load' });
  await pageAndroid.locator('html[data-taba-startup="ready"]').waitFor({ state: 'attached', timeout: 60_000 });
  await pageAndroid.evaluate(() => window.__fire());
  const hojaAndroid = pageAndroid.locator('[data-install-sheet]');
  await hojaAndroid.waitFor({ state: 'visible', timeout: 15_000 }).catch(() => undefined);
  if (await hojaAndroid.isVisible()) ok('Android que vuelve: la hoja se abre con el evento del navegador capturado');
  else mal('Android que vuelve: la hoja no se abrió con el evento disponible');
  const titulo = await pageAndroid.locator('[data-install-view="android"] .install-sheet-title').textContent().catch(() => '');
  dato(`título: ${String(titulo || '').trim()}`);
  await android.close();

  // iPhone que vuelve, sin instalar.
  const ios = await browser.newContext({ userAgent: IPHONE_UA, viewport: { width: 390, height: 844 }, hasTouch: true });
  const pageIos = await ios.newPage();
  await pageIos.addInitScript((clave) => { localStorage.setItem(clave, '1'); }, VISITANTE_CONOCIDO);
  await pageIos.goto(`${ENTRADA}`, { waitUntil: 'load' });
  await pageIos.locator('html[data-taba-startup="ready"]').waitFor({ state: 'attached', timeout: 60_000 });
  const hojaIos = pageIos.locator('[data-install-view="ios"]');
  await hojaIos.waitFor({ state: 'visible', timeout: 15_000 }).catch(() => undefined);
  if (await hojaIos.isVisible()) ok('iPhone que vuelve: se ofrece la guía y no un prompt inexistente');
  else mal('iPhone que vuelve: no apareció la guía');"""

VIEJO_IGUAL = """function igual(campo, actual, esperado) {"""

NUEVO_IGUAL = """/** El evento que el navegador dispara cuando la app se puede instalar. */
function armarEventoDeInstalacion() {
  window.__prompts = 0;
  window.__fire = () => {
    const evento = new Event('beforeinstallprompt');
    evento.prompt = async () => { window.__prompts += 1; return { outcome: 'dismissed' }; };
    evento.userChoice = Promise.resolve({ outcome: 'dismissed' });
    window.dispatchEvent(evento);
  };
}

function igual(campo, actual, esperado) {"""

VIEJO_ESCRITORIO = """  const escritorio = await browser.newContext();
  const pageDesktop = await escritorio.newPage();
  await pageDesktop.goto(`${ENTRADA}`, { waitUntil: 'load' });
  await pageDesktop.locator('html[data-taba-startup="ready"]').waitFor({ state: 'attached', timeout: 60_000 });
  await pageDesktop.waitForTimeout(4000);"""

NUEVO_ESCRITORIO = """  // Con la marca de visitante conocido puesta: sin ella, «no apareció» pasaría
  // por el motivo equivocado —el estreno— y no por ser un escritorio.
  const escritorio = await browser.newContext();
  const pageDesktop = await escritorio.newPage();
  await pageDesktop.addInitScript((clave) => { localStorage.setItem(clave, '1'); }, VISITANTE_CONOCIDO);
  await pageDesktop.goto(`${ENTRADA}`, { waitUntil: 'load' });
  await pageDesktop.locator('html[data-taba-startup="ready"]').waitFor({ state: 'attached', timeout: 60_000 });
  await pageDesktop.waitForTimeout(ESPERA_SIN_INVITACION);"""

reemplazar('scripts/verify-pwa-install.mjs', [(VIEJO_INVITACION, NUEVO_INVITACION)])
reemplazar('scripts/verify-pwa-install.mjs', [(VIEJO_IGUAL, NUEVO_IGUAL)])
reemplazar('scripts/verify-pwa-install.mjs', [(VIEJO_ESCRITORIO, NUEVO_ESCRITORIO)])
print('gate de PWA actualizado al contrato vigente')
