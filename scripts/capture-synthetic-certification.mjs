// Capturas de la jornada sintética, con datos QA inequívocos en pantalla.
// Intercepta todas las llamadas al backend: no toca Supabase, Mercado Pago ni ARCA.
import { chromium } from '@playwright/test';
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { QA_MARKERS } from '../tests/synthetic/qa-fixtures.mjs';
import { installQaPanelFixtures } from '../tests/synthetic/panel-browser-fixtures.mjs';

const PORT = Number.parseInt(process.env.TABA_CERT_SHOT_PORT || '8163', 10);
const BASE = `http://127.0.0.1:${PORT}`;
// Ruta relativa al repositorio por defecto: una ruta de disco local no puede vivir en el árbol.
const OUT = path.resolve(process.env.TABA_CERT_SHOT_DIR || 'artifacts/la-taba-business-synthetic-certification/capturas');

const SCREENS = [
  ['day-open', '01-apertura'],
  ['operation-center', '02-centro-de-operacion'],
  ['payments', '03-pagos-fixtures'],
  ['payments-setup', '04-conectar-mercado-pago'],
  ['fiscal-setup', '05-facturacion-homologacion'],
  ['devices', '06-dispositivos'],
  ['product-create', '07-alta-de-producto'],
  ['day-close', '08-cierre-diario'],
];

mkdirSync(OUT, { recursive: true });
const server = spawn(process.execPath, ['scripts/realtime-relay.mjs', String(PORT)], { stdio: 'ignore' });
const browser = await chromium.launch();
const captured = [];

try {
  await waitForServer();
  const context = await browser.newContext({ viewport: { width: 1280, height: 1000 } });
  const page = await context.newPage();
  await installQaPanelFixtures(page);
  await page.goto(`${BASE}/#business`);
  await page.locator('[data-production-workspace="business"]').waitFor({ state: 'visible', timeout: 30_000 });

  for (const [view, name] of SCREENS) {
    await page.locator(`[data-business-ops-view="${view}"]`).first().click();
    await page.locator(`[data-business-ops-center="${view}"]`).waitFor({ state: 'visible', timeout: 15_000 });
    await page.waitForTimeout(350);
    await page.screenshot({ path: path.join(OUT, `${name}.png`), fullPage: true });
    captured.push(`${name}.png — ${view}`);
  }
  await context.close();
} finally {
  await browser.close();
  server.kill();
}

writeFileSync(path.join(OUT, 'CAPTURAS.md'), `# Capturas de la jornada sintética

Todos los datos en pantalla están etiquetados como QA (${Object.values(QA_MARKERS).join(', ')}).
Ninguna captura contiene datos reales de clientes, cobros ni comprobantes.

${captured.map((line) => `- ${line}`).join('\n')}
`);
console.log(`Capturas de certificación: ${captured.length} en ${OUT}`);

async function waitForServer() {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try {
      const response = await fetch(`${BASE}/`);
      if (response.ok) return;
    } catch (_) { /* todavía no acepta conexiones */ }
    await new Promise((resolve) => { setTimeout(resolve, 500); });
  }
  throw new Error('El servidor local no respondió a tiempo.');
}
