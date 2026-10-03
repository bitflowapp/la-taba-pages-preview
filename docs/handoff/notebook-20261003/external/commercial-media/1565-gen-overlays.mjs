// Genera los sobreimpresos y placas del video como PNG 1080x1920.
// Tipografía system (la misma del producto) + tokens de marca TABA.
import { createRequire } from 'node:module';
import fs from 'node:fs';

const REPO = 'C:/Users/marco/dev/la-taba-business-panel-automation';
const require = createRequire(REPO + '/package.json');
const { chromium } = require('@playwright/test');

const OUT = 'D:/1212/taba-promo-v2/overlays';
const BASE = 'http://127.0.0.1:8093';

const CSS = `
  * { margin: 0; padding: 0; box-sizing: border-box; }
  html, body { width: 1080px; height: 1920px; background: transparent;
    font-family: "Segoe UI", system-ui, -apple-system, Roboto, Arial, sans-serif;
    color: #f5f5f7; overflow: hidden; }
  .abs { position: absolute; left: 0; right: 0; }
  .center { display: flex; justify-content: center; }
  .pill { display: inline-flex; align-items: center; gap: 14px;
    background: rgba(13,16,20,0.74); border: 1px solid rgba(255,255,255,0.16);
    border-radius: 999px; padding: 20px 38px;
    box-shadow: 0 10px 34px rgba(0,0,0,0.45); }
  .pill .txt { font-size: 40px; font-weight: 600; letter-spacing: -0.01em; white-space: nowrap; }
  .chip { display: inline-flex; align-items: center; gap: 12px;
    background: rgba(13,16,20,0.74); border: 1px solid rgba(255,255,255,0.16);
    border-radius: 999px; padding: 14px 28px; }
  .chip .dot { width: 12px; height: 12px; border-radius: 999px; background: #d0000d; }
  .chip .txt { font-size: 27px; font-weight: 700; letter-spacing: 0.16em; color: #e8e9ec; }
  .hook { text-align: center; font-weight: 800; font-size: 72px; line-height: 1.14;
    letter-spacing: -0.015em; text-shadow: 0 6px 30px rgba(0,0,0,0.75), 0 2px 8px rgba(0,0,0,0.6); }
  .hook .red { color: #ff5f66; }
  .osm { position: absolute; left: 34px; bottom: 148px; font-size: 21px;
    color: rgba(255,255,255,0.5); text-shadow: 0 2px 8px rgba(0,0,0,0.8); }
`;

const overlays = [
  { id: 'hook1', html: `<div class="abs" style="top: 560px;"><div class="hook">¿Y si tu comercio<br>tuviera esto?</div></div>` },
  { id: 'hook2', html: `<div class="abs" style="top: 530px;"><div class="hook">Su <span class="red">propio sistema</span><br>de pedidos y delivery.</div></div>` },
  { id: 'chip-cliente', html: `<div class="abs center" style="top: 1466px;"><span class="chip"><span class="dot"></span><span class="txt">LO QUE VE TU CLIENTE</span></span></div>` },
  { id: 'chip-negocio', html: `<div class="abs center" style="top: 1466px;"><span class="chip"><span class="dot"></span><span class="txt">LO QUE VE TU NEGOCIO</span></span></div>` },
  { id: 'chip-reparto', html: `<div class="abs center" style="top: 1466px;"><span class="chip"><span class="dot"></span><span class="txt">EL REPARTO</span></span></div>` },
  { id: 'cap-catalogo', html: `<div class="abs center" style="top: 1568px;"><span class="pill"><span class="txt">Tu catálogo, con tu marca</span></span></div>` },
  { id: 'cap-pedido', html: `<div class="abs center" style="top: 1568px;"><span class="pill"><span class="txt">Pedido en segundos</span></span></div>` },
  { id: 'cap-confirmado', html: `<div class="abs center" style="top: 1568px;"><span class="pill"><span class="txt">Confirmado. Sin llamadas, sin planillas.</span></span></div>` },
  { id: 'cap-negocio', html: `<div class="abs center" style="top: 1568px;"><span class="pill"><span class="txt">El negocio tiene su panel</span></span></div>` },
  { id: 'cap-panel', html: `<div class="abs center" style="top: 1568px;"><span class="pill"><span class="txt">El pedido entra solo, con timbre</span></span></div>` },
  { id: 'cap-estados', html: `<div class="abs center" style="top: 1568px;"><span class="pill"><span class="txt">Estados claros. Cola bajo control.</span></span></div>` },
  { id: 'cap-reparto', html: `<div class="abs center" style="top: 1568px;"><span class="pill"><span class="txt">El reparto, coordinado</span></span></div>` },
  { id: 'cap-mapa', html: `<div class="abs center" style="top: 1290px;"><span class="pill"><span class="txt">Seguimiento en vivo sobre el mapa</span></span></div><div class="osm" style="left: 34px; bottom: auto; top: 1360px;">Mapa © OpenStreetMap</div>` },
  { id: 'cap-codigo', html: `<div class="abs center" style="top: 1290px;"><span class="pill"><span class="txt">Entrega con código de seguridad</span></span></div>` },
];

const LS_MONOGRAM = `
<svg width="150" height="150" viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg">
  <rect width="64" height="64" rx="18" fill="#0a0a0c"/>
  <rect x="5" y="5" width="54" height="54" rx="15" fill="#17191f" stroke="#ffffff" stroke-opacity="0.16" stroke-width="2"/>
  <circle cx="19" cy="20" r="4" fill="#2997ff"/>
  <text x="32" y="39" fill="#f5f5f7" font-family="Segoe UI, Inter, Arial, sans-serif" font-size="17" font-weight="700" text-anchor="middle">LS</text>
</svg>`;

const cards = [
  {
    id: 'card-taba',
    html: `
      <div style="position:absolute; inset:0; background:#0c0f13;"></div>
      <div style="position:absolute; inset:0; background: radial-gradient(900px 700px at 50% 30%, rgba(208,0,13,0.10), transparent 70%);"></div>
      <div style="position:absolute; left:0; right:0; top:0; bottom:0; display:flex; flex-direction:column; align-items:center; justify-content:center; gap:0;">
        <img src="__TABA_LOGO__" style="width:440px; display:block;" />
        <div style="width:84px; height:6px; border-radius:99px; background:#d0000d; margin:42px 0 54px;"></div>
        <div style="font-size:52px; font-weight:700; letter-spacing:-0.01em;">Esto es TABA.</div>
        <div style="font-size:36px; font-weight:400; color:#a8abb2; margin-top:20px;">Una plataforma real, funcionando hoy.</div>
      </div>`,
  },
  {
    id: 'card-luna',
    html: `
      <div style="position:absolute; inset:0; background:#0c0f13;"></div>
      <div style="position:absolute; inset:0; background: radial-gradient(900px 700px at 50% 24%, rgba(41,151,255,0.08), transparent 70%);"></div>
      <div style="position:absolute; left:0; right:0; top:0; bottom:0; display:flex; flex-direction:column; align-items:center; justify-content:center;">
        <div style="font-size:44px; font-weight:600; line-height:1.3; text-align:center; max-width:860px; letter-spacing:-0.01em;">
          Una muestra de lo que podemos<br>construir para tu negocio.
        </div>
        <div style="margin:64px 0 26px;">${LS_MONOGRAM}</div>
        <div style="font-size:56px; font-weight:700; letter-spacing:-0.015em;">Luna Systems</div>
        <div style="font-size:29px; font-weight:600; letter-spacing:0.22em; color:#a8abb2; margin-top:16px;">SOFTWARE A MEDIDA</div>
        <div style="margin-top:74px; background:#d0000d; border-radius:999px; padding:30px 52px; font-size:36px; font-weight:700; box-shadow: 0 14px 44px rgba(208,0,13,0.35);">
          Contanos qué necesita tu negocio
        </div>
        <div style="font-size:28px; color:#a8abb2; margin-top:30px;">WhatsApp <span style="color:#f5f5f7; font-weight:600;">299 620 9136</span></div>
      </div>`,
  },
];

fs.mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch({ headless: true });

// 1) Logotipo real de La Taba, capturado del producto a alta densidad.
{
  const ctx = await browser.newContext({ viewport: { width: 432, height: 768 }, deviceScaleFactor: 6, isMobile: true, hasTouch: true, serviceWorkers: 'block' });
  const page = await ctx.newPage();
  await page.addInitScript(() => { try { localStorage.setItem('TABA_INSTALL_PROMPT_V1', JSON.stringify({ v: 1, decision: 'declined', at: '2026-01-01T00:00:00.000Z', platform: 'e2e' })); } catch (_) {} });
  await page.goto(`${BASE}/?demo=1`, { waitUntil: 'load' });
  await page.locator('html[data-taba-startup="ready"]').waitFor({ state: 'attached' });
  await page.waitForTimeout(800);
  await page.locator('header .brand .brand-text').screenshot({ path: `${OUT}/taba-logo.png`, omitBackground: true });
  await ctx.close();
}

// 2) Overlays transparentes y placas opacas.
{
  const ctx = await browser.newContext({ viewport: { width: 1080, height: 1920 }, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  const logoDataUri = `data:image/png;base64,${fs.readFileSync(`${OUT}/taba-logo.png`).toString('base64')}`;
  for (const spec of [...overlays, ...cards]) {
    const opaque = spec.id.startsWith('card-');
    const html = spec.html.replaceAll('__TABA_LOGO__', logoDataUri);
    await page.setContent(`<!doctype html><html><head><meta charset="utf-8"><style>${CSS}</style></head><body>${html}</body></html>`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(120);
    await page.screenshot({ path: `${OUT}/${spec.id}.png`, omitBackground: !opaque });
    console.log('overlay:', spec.id);
  }
  await ctx.close();
}

await browser.close();
console.log('OK overlays →', OUT);
