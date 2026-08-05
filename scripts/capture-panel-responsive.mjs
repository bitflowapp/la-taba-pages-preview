// Capturas del panel en los anchos reales de los teléfonos del mostrador.
// Usa los mismos fixtures QA que la regresión visual: no toca ningún backend real.
import { chromium } from '@playwright/test';
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { installQaPanelFixtures } from '../tests/synthetic/panel-browser-fixtures.mjs';
import { QA_MARKERS } from '../tests/synthetic/qa-fixtures.mjs';

const PORT = Number.parseInt(process.env.TABA_RESPONSIVE_SHOT_PORT || '8185', 10);
const BASE = `http://127.0.0.1:${PORT}`;
// Ruta relativa por defecto: una ruta de disco local no puede vivir en el árbol.
const OUT = path.resolve(process.env.TABA_RESPONSIVE_SHOT_DIR || 'artifacts/panel-responsive');
const WIDTHS = [320, 360, 390, 412, 432];
const SCREENS = [['day-open', 'abrir-el-negocio'], ['devices', 'probar-dispositivos']];

mkdirSync(OUT, { recursive: true });
const server = spawn(process.execPath, ['scripts/realtime-relay.mjs', String(PORT)], { stdio: 'ignore' });
const browser = await chromium.launch();
const captured = [];

try {
  await waitForServer();
  for (const width of WIDTHS) {
    const context = await browser.newContext({ viewport: { width, height: 900 } });
    const page = await context.newPage();
    await installQaPanelFixtures(page);
    await page.goto(`${BASE}/#business`);
    await page.locator('[data-production-workspace="business"]').waitFor({ state: 'visible', timeout: 30_000 });

    for (const [view, name] of SCREENS) {
      await page.locator(`[data-business-ops-view="${view}"]`).first().click();
      await page.locator(`[data-business-ops-center="${view}"]`).waitFor({ state: 'visible', timeout: 15_000 });
      await page.waitForTimeout(300);
      const file = `${name}-${width}px.png`;
      await page.screenshot({ path: path.join(OUT, file), fullPage: true });
      captured.push(`${file} — ${view} a ${width} px`);
    }
    await context.close();
  }
} finally {
  await browser.close();
  server.kill();
}

writeFileSync(path.join(OUT, 'CAPTURAS-RESPONSIVE.md'), `# Panel en los anchos del mostrador

Anchos verificados: ${WIDTHS.join(', ')} px. Pantallas: Abrir el negocio y Probar dispositivos.
Datos QA (${Object.values(QA_MARKERS).join(', ')}); ninguna captura contiene datos reales.

Lo que se busca en cada una: que "Impresoras" y "Facturación" se lean enteras, que la etiqueta
de estado caiga a la línea siguiente cuando no entra, y que los botones de confirmación digan
"Salió el papel de la térmica" y "Salió el papel de la A4".

${captured.map((line) => `- ${line}`).join('\n')}
`);
console.log(`Capturas responsive: ${captured.length} en ${OUT}`);

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
