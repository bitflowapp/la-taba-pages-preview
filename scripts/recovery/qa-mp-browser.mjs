// Local, isolated Chrome controller for the explicitly authorized QA test accounts.
// Commands on stdin contain action names only; credentials stay in OS storage/memory.
import { chromium } from 'playwright';
import { leerSecreto } from '../e2e-production-sale/secretos-windows.mjs';
import { createInterface } from 'node:readline';
import { mkdirSync, appendFileSync, existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const buyer = JSON.parse(leerSecreto('RECOVERY MP TEST BUYER')?.secreto || '{}');
if (buyer.id !== '3594962710' || buyer.profile !== 'buyer' || !buyer.password || !buyer.nickname) throw Error('QA_BUYER_REQUIRED');
const token = leerSecreto('RECOVERY MP TEST ACCESS TOKEN')?.secreto;
const official = await (await fetch('https://api.mercadopago.com/users/3594962710', { headers: { Authorization: `Bearer ${token}` } })).json();
if (String(official.id) !== buyer.id || official.site_id !== 'MLA' || official.nickname !== buyer.nickname) throw Error('OFFICIAL_BUYER_MISMATCH');
const dir = path.join(os.tmpdir(), 'la-taba-mp-final-20261023');
mkdirSync(dir, { recursive: true });
const evidence = path.join(dir, 'browser.jsonl');
const redact = s => String(s).split(buyer.password).join('[REDACTADO]').split(buyer.nickname).join('[COMPRADOR_QA]').replace(/TESTUSER\w+/gi, '[USUARIO_QA]');
const record = obj => {
  const row = { at: new Date().toISOString(), ...obj };
  appendFileSync(evidence, JSON.stringify(row) + '\n');
  console.log(JSON.stringify(row));
};
const browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: false });
const context = await browser.newContext({ locale: 'es-AR', viewport: { width: 1280, height: 900 } });
const page = await context.newPage();
page.setDefaultTimeout(8000);
const seenFlows = new Set();
page.on('response', async response => {
  const url = new URL(response.url());
  if (!url.host.endsWith('mercadopago.com.ar') || !url.pathname.startsWith('/checkout/')) return;
  record({kind:'provider_http',method:response.request().method(),path:url.pathname,http:response.status(),requestId:response.headers()['x-request-id'] || null,correlationId:response.headers()['x-correlation-id'] || null});
  if (!/\/api\/flow\//.test(url.pathname)) return;
  try {
    const body = await response.json();
    const key = `${url.pathname}:${body.step}`;
    if (!seenFlows.has(key)) {
      seenFlows.add(key);
      record({ kind: 'provider_flow', path: url.pathname, step: body.step, liveMode: body.liveMode, http: response.status(), requestId: response.headers()['x-request-id'] });
    }
  } catch { /* no response bodies are persisted */ }
});
let paySent = false;
let scenario = null;
let enteredCardScenario = null;
const priorPayments = new Set(existsSync(evidence) ? readFileSync(evidence,'utf8').trim().split('\n').filter(Boolean).map(line=>JSON.parse(line)).filter(r=>r.kind==='pay_submitted').map(r=>r.scenario) : []);
async function state() {
  return { kind: 'state', url: page.url().split('?')[0], text: redact(await page.locator('body').innerText()).slice(0,5000),
    inputs: await page.locator('input:not([type="hidden"])').evaluateAll(es => es.map(e => ({ type:e.type,name:e.name,id:e.id,placeholder:e.placeholder,autocomplete:e.autocomplete }))),
    frames: await Promise.all(page.frames().map(async(f,index)=>({index,url:f.url().split('?')[0],inputs:await f.locator('input:not([type="hidden"])').evaluateAll(es=>es.map(e=>({type:e.type,name:e.name,id:e.id,placeholder:e.placeholder,autocomplete:e.autocomplete}))).catch(()=>[])}))),
    buttons: await page.getByRole('button').allTextContents(), aria: redact(await page.locator('body').ariaSnapshot()).slice(0,7000), paySent };
}
async function command(c) {
  if (c.action === 'state') return state();
  if (c.action === 'goto') {
    const u = new URL(c.url);
    if (u.protocol !== 'https:' || u.host !== 'www.mercadopago.com.ar') throw Error('OFFICIAL_MP_AR_ONLY');
    await page.goto(c.url, { waitUntil: 'domcontentloaded', timeout: 30000 });
  } else if (c.action === 'login') {
    await page.getByRole('textbox', { name: /DNI, e-mail o teléfono/i }).fill(buyer.nickname);
    await page.getByRole('button', { name: 'Continuar', exact: true }).click();
  } else if (c.action === 'password') {
    await page.locator('#password').fill(buyer.password);
  } else if (c.action === 'checkout') {
    if (!['APRO','OTHE','CONT'].includes(c.scenario) || priorPayments.has(c.scenario)) throw Error('SCENARIO_ALREADY_SUBMITTED_OR_INVALID');
    const data=JSON.parse(readFileSync(path.join(dir, `${c.scenario}.json`),'utf8'));
    if(data.preference_http!==200 || Date.parse(data.expires_at)<Date.now()+120000) throw Error('CHECKOUT_NOT_READY');
    const u=new URL(data.init_point);
    if(u.origin!=='https://www.mercadopago.com.ar' || !u.searchParams.get('pref_id')?.startsWith('3594962708-')) throw Error('QA_COLLECTOR_REQUIRED');
    scenario=c.scenario; paySent=false;
    await page.goto(u.toString(),{waitUntil:'domcontentloaded',timeout:30000});
  } else if (c.action === 'click') {
    if (/pagar/i.test(c.name)) throw Error('USE_GUARDED_PAY_ACTION');
    await page.getByRole(c.role || 'button', { name: c.name, exact: true }).click();
  } else if (c.action === 'text-click') {
    if (/pagar/i.test(c.text)) throw Error('USE_GUARDED_PAY_ACTION');
    await page.getByText(c.text, { exact: true }).click();
  } else if (c.action === 'fill') {
    // Only public official test data may be supplied by the caller.
    if (!['5031755734530604','12345678','123','11/30','APRO','OTHE','CONT'].includes(c.value)) throw Error('PUBLIC_TEST_VALUE_ONLY');
    const frame=c.frame===undefined?page:page.frames()[c.frame];
    if(!frame) throw Error('FRAME_NOT_FOUND');
    await frame.locator(c.selector).fill(c.value);
    if(c.selector==='#cardholderName') enteredCardScenario=c.value;
  } else if (c.action === 'pay') {
    if (paySent || !scenario || c.scenario!==scenario || enteredCardScenario!==scenario || priorPayments.has(scenario)) throw Error('PAY_ALREADY_SENT_OR_SCENARIO_MISMATCH');
    if (!new URL(page.url()).pathname.includes('/review')) throw Error('REVIEW_REQUIRED');
    paySent = true; priorPayments.add(scenario); record({kind:'pay_submitted',scenario});
    await page.getByRole('button', { name:'Pagar',exact:true }).click();
  } else if (c.action === 'screenshot') {
    const file = path.join(dir, `screen-${Date.now()}.png`);
    await page.screenshot({path:file,fullPage:true,mask:[page.locator('input[type="password"]')]});
    return {kind:'screenshot',file};
  } else if (c.action === 'close') {
    await browser.close(); process.exit(0);
  } else throw Error('UNKNOWN_ACTION');
  return state();
}
record({kind:'ready',browser:browser.version(),buyerId:buyer.id,officialNicknameMatches:true,evidence});
const input=createInterface({input:process.stdin,crlfDelay:Infinity});
for await (const line of input) {
  try { record(await command(JSON.parse(line))); }
  catch(e) { record({kind:'error',message:redact(e.message).slice(0,1500)}); }
}
