#!/usr/bin/env node
/*
 * UN intento automatizado de Checkout Pro con el comprador de prueba — Staging.
 *
 * Abre EXACTAMENTE el `init_point` que devolvió la preferencia de
 * `certificar.mjs preparar` —nunca `sandbox_init_point`, nunca un host
 * reescrito— en un contexto de Chrome nuevo y efímero (sin cookies, sin sesión
 * del vendedor), entra con el comprador de prueba y paga con la tarjeta oficial
 * de prueba a nombre de APRO.
 *
 * Si Mercado Pago pide «Verificá tu identidad» se DETIENE: no hay bypass, no se
 * tocan señales antifraude, no se reintenta. Queda registrado el flow, los
 * request IDs y la hora, para la prueba manual de control y para WCS-51579.
 *
 * El código de verificación que Mercado Pago pide a una cuenta de prueba es el
 * que muestra «Cuentas de prueba» (los últimos 6 dígitos del User ID); se lee
 * del Credential Manager, se tipea y no se imprime ni se guarda.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright';
import { leerSecreto } from '../../e2e-production-sale/secretos-windows.mjs';

const DIR = path.join(os.tmpdir(), 'la-taba-mp-directo');
const ESTADO = process.argv.find((a) => a.startsWith('--estado='))?.slice('--estado='.length) || path.join(DIR, 'estado.json');
const FORZAR_TARJETA = process.argv.includes('--forzar-tarjeta');
const COMPRADOR = '3594962710';
const VENDEDOR = '3594962708';
const TARJETA = { numero: '5031755734530604', titular: 'APRO', vencimiento: '11/30', cvv: '123', dni: '12345678' };

const estado = JSON.parse(readFileSync(ESTADO, 'utf8'));
if (estado.fase !== 'preferencia_creada') throw new Error(`ESTADO_NO_LISTO:${estado.fase}`);
// Un solo intento automatizado de CHECKOUT. Sólo se admite volver a correr si el
// anterior murió por un defecto de la automatización ANTES de que existiera un
// flow de Checkout Pro (ningún pago, ningún desafío del proveedor), y queda
// registrado en `corridas_abortadas`.
const DEFECTOS_DE_AUTOMATIZACION = new Set(['LOGIN_IDENTIFIER_NOT_FOUND', 'AUTOMATION_EXCEPTION', 'NO_OUTCOME_WITHIN_STEPS', 'LOGIN_METHOD_MISCLASSIFIED']);
if (estado.intento_automatizado) {
  const previo = estado.intento_automatizado;
  if (!process.argv.includes('--tras-defecto-de-automatizacion') || !DEFECTOS_DE_AUTOMATIZACION.has(previo.resultado)
    || previo.pago_enviado) throw new Error('YA_HUBO_UN_INTENTO_AUTOMATIZADO');
  estado.corridas_abortadas = [...(estado.corridas_abortadas || []), previo];
  delete estado.intento_automatizado;
}
const initPoint = new URL(estado.preferencia.init_point);
if (initPoint.hostname !== 'www.mercadopago.com.ar' || initPoint.protocol !== 'https:') throw new Error('INIT_POINT_INVALIDO');
if (Date.parse(estado.expires_at) < Date.now() + 5 * 60_000) throw new Error('PREFERENCIA_POR_VENCER');

const cuenta = leerSecreto('MP STAGING BUYER STABLE');
const datos = JSON.parse(cuenta?.secreto || '{}');
if (datos.id !== COMPRADOR || datos.id === VENDEDOR || !cuenta?.usuario || !datos.password) throw new Error('COMPRADOR_DE_PRUEBA_NO_DISPONIBLE');
const codigo = String(datos.code || COMPRADOR.slice(-6));
const secretos = [datos.password, codigo, cuenta.usuario].filter(Boolean);
const limpiar = (texto) => secretos.reduce((t, s) => t.split(s).join('[REDACTADO]'), String(texto || '')).replace(/TESTUSER[\w*]*/gi, '[USUARIO_DE_PRUEBA]');

const hora = () => {
  const utc = new Date();
  return { utc: utc.toISOString(), argentina: new Date(utc.getTime() - 3 * 3600_000).toISOString().replace('Z', '-03:00') };
};
const marca = new Date().toISOString().replace(/[:.]/g, '-');
const evidencia = {
  modo: 'automatizado', navegador: null, inicio: hora(), init_point_usado: initPoint.toString(),
  usa_sandbox_init_point: false, forzar_tarjeta: FORZAR_TARJETA, flujo_estado: path.basename(ESTADO),
  navegaciones: [], flujo: [], respuestas: [], resultado: null, capturas: [], flow_ids: [],
};
mkdirSync(DIR, { recursive: true });
const guardar = () => {
  writeFileSync(path.join(DIR, `comprador-${marca}.json`), `${JSON.stringify(evidencia, null, 2)}\n`);
};

const browser = await chromium.launch({ channel: 'chrome', headless: false });
evidencia.navegador = `chrome ${browser.version()}`;
const context = await browser.newContext({ locale: 'es-AR', viewport: { width: 1280, height: 900 } });
const page = await context.newPage();
page.setDefaultTimeout(20_000);

page.on('framenavigated', (frame) => {
  if (frame !== page.mainFrame()) return;
  const url = new URL(frame.url());
  evidencia.navegaciones.push({ momento: hora().utc, host: url.host, path: url.pathname });
  const flujo = /\/checkout\/v1\/payment\/redirect\/([0-9a-f-]{36})\//.exec(url.pathname)?.[1];
  if (flujo && !evidencia.flow_ids.includes(flujo)) evidencia.flow_ids.push(flujo);
});
page.on('response', async (response) => {
  const url = new URL(response.url());
  if (!/mercadopago|mercadolibre|mercadolivre/.test(url.host)) return;
  if (!/\/checkout\/v1\/(payment\/)?api\/|\/reauth|\/challenge/.test(url.pathname)) return;
  const fila = {
    momento: hora().utc, status: response.status(), metodo: response.request().method(), path: url.pathname,
    x_request_id: response.headers()['x-request-id'] || null,
    x_correlation_id: response.headers()['x-correlation-id'] || null,
  };
  if (url.pathname.includes('/checkout/v1/api/flow/')) {
    fila.flow_id = url.pathname.split('/flow/')[1]?.split('/')[0] || null;
    try {
      const cuerpo = await response.json();
      Object.assign(fila, { step: cuerpo?.step ?? null, title: cuerpo?.title ?? cuerpo?.header?.title ?? null, live_mode: cuerpo?.liveMode ?? null });
      evidencia.flujo.push({ momento: fila.momento, flow_id: fila.flow_id, step: fila.step, title: fila.title, live_mode: fila.live_mode, x_request_id: fila.x_request_id });
    } catch { /* cuerpo no JSON: sólo metadatos */ }
  }
  evidencia.respuestas.push(fila);
});

const visible = (locator) => locator.isVisible().catch(() => false);
const textoPagina = async () => limpiar((await page.locator('body').innerText().catch(() => '')).replace(/\s+/g, ' ').trim());
const captura = async (nombre) => {
  const archivo = path.join(DIR, `comprador-${marca}-${nombre}.png`);
  await page.screenshot({ path: archivo, fullPage: true }).catch(() => {});
  evidencia.capturas.push(archivo);
};
// Click como el de una persona: si el elemento no es «accionable» para Playwright
// (texto dentro de una tarjeta clickeable), se hace clic en el centro de su caja.
const clic = async (locator) => {
  try { await locator.click({ timeout: 5_000 }); return; } catch { /* sigue con el mouse */ }
  await locator.scrollIntoViewIfNeeded({ timeout: 2_000 }).catch(() => {});
  const caja = await locator.boundingBox({ timeout: 2_000 }).catch(() => null);
  if (!caja) throw new Error('CONTROL_SIN_CAJA');
  await page.mouse.click(caja.x + caja.width / 2, caja.y + caja.height / 2);
};
const buscarCampo = async (selector, ms = 12_000) => {
  const limite = Date.now() + ms;
  while (Date.now() < limite) {
    for (const scope of [page, ...page.frames()]) {
      const campo = scope.locator(selector).first();
      if (await visible(campo)) return campo;
    }
    await page.waitForTimeout(250);
  }
  return null;
};

let tarjetaCargada = false;
let codigoEnviado = 0;
try {
  await page.goto(initPoint.toString(), { waitUntil: 'domcontentloaded', timeout: 60_000 });
  for (let paso = 0; paso < 70 && !evidencia.resultado; paso += 1) {
    await page.waitForTimeout(1_500);
    const url = new URL(page.url());
    const texto = await textoPagina();
    if (url.host === 'taba2-staging.pages.dev') {
      evidencia.resultado = { estado: 'RETURNED_TO_STORE', path: url.pathname, momento: hora() };
      break;
    }
    // El desafío que importa es el de Checkout Pro («Verificá tu identidad para
    // terminar el pago»). `/login/challenges` es sólo la elección del método de
    // inicio de sesión (Contraseña / E-mail) y se atiende más abajo.
    const desafioCheckout = url.pathname.startsWith('/checkout/') && (/Verific[aá] tu identidad/i.test(texto) || /\/challenge/.test(url.pathname));
    const pasoDesafio = evidencia.flujo.some((f) => f.step === 'challenge');
    if (desafioCheckout || pasoDesafio) {
      // El paso /challenge/ también aparece cuando la reautenticación se
      // resuelve sola (así pasó en el pago aprobado: 2 s y a congrats). Es un
      // bloqueo sólo si sigue ahí 20 s después.
      const salio = await page.waitForURL((d) => !/\/challenge/.test(d.pathname), { timeout: 20_000 }).then(() => true).catch(() => false);
      if (salio) { evidencia.flujo.push({ momento: hora().utc, step: 'checkout_challenge_passed_through' }); continue; }
      await captura('desafio-identidad');
      evidencia.resultado = { estado: 'IDENTITY_CHALLENGE', path: url.pathname, momento: hora(), texto: texto.slice(0, 400) };
      break;
    }
    if (/Oh, no, algo anduvo mal/i.test(texto) || /\/error\/?$/.test(url.pathname)) {
      await captura('error');
      evidencia.resultado = { estado: 'PROVIDER_ERROR', path: url.pathname, momento: hora(), texto: texto.slice(0, 400) };
      break;
    }
    if (/congrats|\/success/.test(url.pathname) || /Listo! Tu pago|pago (ya )?(se )?acredit|Pago aprobado/i.test(texto)) {
      await captura('aprobado');
      evidencia.resultado = { estado: 'APPROVED_SCREEN', path: url.pathname, momento: hora(), texto: texto.slice(0, 300) };
      break;
    }
    // Código de verificación de la cuenta de prueba (Cuentas de prueba).
    const campoCodigo = page.locator([
      'input[autocomplete="one-time-code"]', 'input[name*="code" i]:not([type="hidden"])',
      'input[inputmode="numeric"][maxlength="6"]:not([type="hidden"])', 'input[inputmode="numeric"][maxlength="1"]:not([type="hidden"])',
    ].join(',')).filter({ visible: true });
    if (await campoCodigo.count().catch(() => 0) && codigoEnviado < 1 && !url.pathname.includes('/card-form')) {
      codigoEnviado += 1;
      await campoCodigo.first().click();
      await page.keyboard.type(codigo, { delay: 60 });
      const confirmar = page.getByRole('button', { name: /Continuar|Confirmar|Verificar/i }).first();
      if (await visible(confirmar)) await confirmar.click();
      evidencia.flujo.push({ momento: hora().utc, step: 'test_account_code_submitted' });
      continue;
    }
    // Una persona acepta el aviso de cookies antes de seguir; sin eso el login
    // de Mercado Pago terminó en su 404 (`/login/identification/not-found`).
    const cookies = page.getByRole('button', { name: 'Aceptar cookies', exact: true });
    if (await visible(cookies)) { await cookies.click(); await page.waitForTimeout(800); }
    if (url.pathname.startsWith('/login/identification/not-found')) {
      await captura('login-no-encontrado');
      evidencia.resultado = { estado: 'LOGIN_IDENTIFIER_NOT_FOUND', path: url.pathname, momento: hora(), texto: texto.slice(0, 300) };
      break;
    }
    if (url.pathname === '/login/identification') {
      const campo = page.getByRole('textbox', { name: /DNI, e-?mail o tel[eé]fono/i }).first();
      if (await visible(campo) && !(await campo.inputValue().catch(() => ''))) {
        await campo.click();
        await campo.pressSequentially(cuenta.usuario, { delay: 45 });
        await page.waitForTimeout(700);
        const continuar = page.getByRole('button', { name: /^Continuar$/ }).first();
        if (await visible(continuar)) await continuar.click();
        await page.waitForURL((destino) => destino.pathname !== '/login/identification', { timeout: 15_000 }).catch(() => {});
        evidencia.flujo.push({ momento: hora().utc, step: 'buyer_identifier_submitted' });
        continue;
      }
    }
    if (url.pathname === '/login/challenges') {
      const metodo = page.getByText(/^Contraseña$/).first();
      if (await visible(metodo)) {
        await clic(metodo);
        await page.waitForURL((destino) => destino.pathname !== '/login/challenges', { timeout: 15_000 }).catch(() => {});
        evidencia.flujo.push({ momento: hora().utc, step: 'buyer_password_method_selected' });
        continue;
      }
    }
    const clave = page.locator('input[type="password"]').filter({ visible: true }).first();
    if (await visible(clave)) {
      await clave.click();
      await clave.pressSequentially(datos.password, { delay: 45 });
      await page.waitForTimeout(500);
      evidencia.flujo.push({ momento: hora().utc, step: 'buyer_password_submitted' });
      const confirmar = page.getByRole('button', { name: /Confirmar|Ingresar|Iniciar sesi[oó]n|Continuar/i }).first();
      if (await visible(confirmar)) await clic(confirmar);
      await page.waitForURL((destino) => !/password/.test(destino.pathname), { timeout: 20_000 }).catch(() => {});
      continue;
    }
    if (url.pathname.includes('/payment-option-form')) {
      const ingresar = page.locator('button[aria-labelledby="mp_login_row-content"]');
      if (await visible(ingresar)) { await ingresar.click({ force: true, noWaitAfter: true }); continue; }
      if (FORZAR_TARJETA) {
        const opcionTarjeta = page.getByText(/^(Nueva tarjeta|Agregar tarjeta|Tarjeta de cr[eé]dito|Tarjeta)$/).first();
        if (await visible(opcionTarjeta)) { await clic(opcionTarjeta); evidencia.flujo.push({ momento: hora().utc, step: 'card_option_chosen' }); continue; }
      }
      const nueva = page.getByText(/^Nueva tarjeta$/).first();
      if (await visible(nueva)) { await nueva.click({ force: true }); continue; }
      const tarjeta = page.getByRole('button', { name: /Tarjeta de cr[eé]dito|Tarjeta/i }).first();
      if (await visible(tarjeta)) { await tarjeta.click(); continue; }
    }
    if (url.pathname.includes('/card-form')) {
      const numero = await buscarCampo('input[name="cardNumber"],input[autocomplete="cc-number"]');
      if (!numero) { await captura('formulario-tarjeta'); throw new Error('CAMPO_NUMERO_NO_ENCONTRADO'); }
      await numero.fill(TARJETA.numero);
      await page.waitForTimeout(1_500);
      // El Checkout sandbox rotula el campo «Nombre del titular» sin name
      // `cardholderName`: se busca también por rótulo y por su placeholder.
      let titular = await buscarCampo('input[name="cardholderName"],input[name*="cardholder" i],input[placeholder*="María López" i],input[aria-label*="titular" i]', 4_000);
      if (!titular) {
        const porRotulo = page.getByLabel(/Nombre del titular/i).first();
        if (await visible(porRotulo)) titular = porRotulo;
      }
      if (titular) await titular.fill(TARJETA.titular);
      evidencia.flujo.push({ momento: hora().utc, step: titular ? 'cardholder_filled' : 'cardholder_field_missing' });
      const vence = await buscarCampo('input[name="expirationDate"],input[autocomplete="cc-exp"]', 6_000);
      if (vence) await vence.fill(TARJETA.vencimiento);
      const cvv = await buscarCampo('input[name="securityCode"],input[autocomplete="cc-csc"]', 6_000);
      if (cvv) await cvv.fill(TARJETA.cvv);
      const dni = page.getByTestId('identification-types--field');
      if (await visible(dni)) await dni.fill(TARJETA.dni);
      else {
        const doc = await buscarCampo('input[name*="identification" i],input[name*="docNumber" i]', 3_000);
        if (doc) await doc.fill(TARJETA.dni);
      }
      tarjetaCargada = true;
      const seguir = page.getByRole('button', { name: /Continuar|Agregar|Guardar|Siguiente/i }).first();
      if (await visible(seguir)) await seguir.click({ force: true });
      continue;
    }
    if (url.pathname.includes('/installments')) {
      const una = page.getByText(/^1x/).first();
      if (await visible(una)) { await una.click(); continue; }
    }
    if (url.pathname.includes('/review') && FORZAR_TARJETA && !tarjetaCargada) {
      // Mercado Pago preselecciona el dinero disponible del comprador; el
      // escenario pedido es la tarjeta oficial de prueba a nombre de APRO.
      const cambiar = page.getByText(/^(Modificar|Cambiar|Elegir otro medio de pago)$/).first();
      if (await visible(cambiar)) { await clic(cambiar); evidencia.flujo.push({ momento: hora().utc, step: 'switch_away_from_account_money' }); continue; }
      await captura('revision-sin-cambio');
      throw new Error('REVISION_SIN_OPCION_PARA_CAMBIAR_A_TARJETA');
    }
    if (url.pathname.includes('/review')) {
      for (const scope of [page, ...page.frames()]) {
        const cvv = scope.locator('input[name="securityCode"],input[placeholder="000"],input[inputmode="numeric"][maxlength="3"]').first();
        if (await visible(cvv) && !(await cvv.inputValue().catch(() => ''))) { await cvv.fill(TARJETA.cvv); break; }
      }
      const pagar = page.getByRole('button', { name: /^Pagar$/ }).first();
      if (await visible(pagar) && await pagar.isEnabled().catch(() => false)) {
        evidencia.flujo.push({ momento: hora().utc, step: 'pay_clicked', tarjeta_cargada: tarjetaCargada });
        await pagar.click();
        await page.waitForTimeout(6_000);
        continue;
      }
    }
  }
  if (!evidencia.resultado) {
    await captura('sin-resultado');
    evidencia.resultado = { estado: 'NO_OUTCOME_WITHIN_STEPS', path: new URL(page.url()).pathname, momento: hora(), texto: (await textoPagina()).slice(0, 400) };
  }
} catch (error) {
  await captura('excepcion');
  evidencia.resultado = { estado: 'AUTOMATION_EXCEPTION', detalle: limpiar(String(error?.message || error)).slice(0, 300), momento: hora() };
} finally {
  evidencia.fin = hora();
  guardar();
  estado.intento_automatizado = { archivo: path.join(DIR, `comprador-${marca}.json`), resultado: evidencia.resultado?.estado, fin: evidencia.fin, pago_enviado: evidencia.flujo.some((f) => f.step === 'pay_clicked'), flow_ids: [...new Set([...evidencia.flow_ids, ...evidencia.flujo.map((f) => f.flow_id).filter(Boolean)])] };
  writeFileSync(ESTADO, `${JSON.stringify(estado, null, 2)}\n`);
  await context.close().catch(() => {});
  await browser.close().catch(() => {});
}
const flows = [...new Set([...evidencia.flow_ids, ...evidencia.flujo.map((f) => f.flow_id).filter(Boolean)])];
console.log(JSON.stringify({
  USED_INIT_POINT: 'YES', USED_SANDBOX_INIT_POINT: 'NO', navegador: evidencia.navegador,
  resultado: evidencia.resultado, flow_ids: flows,
  pasos_del_flujo: evidencia.flujo.map((f) => `${f.momento} ${f.step ?? ''} ${f.title ?? ''} live_mode=${f.live_mode ?? ''} ${f.x_request_id ?? ''}`),
  evidencia: path.join(DIR, `comprador-${marca}.json`),
}, null, 2));
