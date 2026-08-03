import { execFileSync, spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { chromium } from '@playwright/test';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outputPath = path.resolve(
  root,
  process.env.TABA_PERFORMANCE_OUTPUT || 'artifacts/performance/local-rc1.json',
);
const iterations = boundedInteger(process.env.TABA_PERFORMANCE_ITERATIONS, 7, 3, 30);
const port = boundedInteger(process.env.TABA_PERFORMANCE_PORT, 18082, 1024, 65535);
const baseUrl = `http://127.0.0.1:${port}`;
const startedAt = new Date().toISOString();
const localRegressionBudgetMs = Object.freeze({
  initial_load: 1500,
  catalog_render: 750,
  catalog_search: 150,
  cart_update: 650,
  cart_render: 200,
  tracking_render: 150,
  business_panel_unlock_and_render: 600,
  fiscal_pdf_generation: 200,
});
const server = spawn(process.execPath, ['scripts/realtime-relay.mjs', String(port)], {
  cwd: root,
  env: { ...process.env, TABA_RELAY_STATE_DIR: '' },
  stdio: 'ignore',
  windowsHide: true,
});

let browser;
try {
  await waitForServer(`${baseUrl}/health`);
  browser = await chromium.launch({ headless: true });
  const profiles = [];
  for (const profile of [
    { id: 'windows-host-chromium-1280x900', viewport: { width: 1280, height: 900 } },
    { id: 'mobile-viewport-emulation-390x844', viewport: { width: 390, height: 844 } },
  ]) {
    profiles.push(await measureBrowserProfile(browser, profile));
  }

  const pdf = await measureFiscalPdf();
  const budgetEvaluation = evaluateLocalBudget(profiles, pdf);
  if (!budgetEvaluation.passed) {
    throw new Error(`Presupuesto local excedido: ${budgetEvaluation.failures.join(', ')}`);
  }
  const payload = {
    schemaVersion: 1,
    scope: 'local_synthetic_release_candidate_measurement',
    startedAt,
    completedAt: new Date().toISOString(),
    gitHead: gitValue(['rev-parse', 'HEAD']),
    gitBranch: gitValue(['branch', '--show-current']),
    iterations,
    host: {
      platform: os.platform(),
      release: os.release(),
      architecture: os.arch(),
      cpuModel: os.cpus()[0]?.model || 'unknown',
      logicalCpuCount: os.cpus().length,
      totalMemoryBytes: os.totalmem(),
      node: process.version,
      browser: browser.version(),
    },
    profiles,
    fiscalPdf: pdf,
    localRegressionBudget: {
      scope: 'same_windows_host_loopback_only',
      statistic: 'p95',
      unit: 'milliseconds',
      thresholds: localRegressionBudgetMs,
      ...budgetEvaluation,
    },
    notRun: [
      notRun('checkout_preference', 'Requiere API Mercado Pago de prueba y backend desplegado; esta medicion no usa credenciales ni llama proveedores.'),
      notRun('webhook_payment_order', 'Requiere PostgreSQL/Supabase aislado y webhook firmado; Docker local no estaba disponible al preparar el RC.'),
      notRun('packing_server_cas', 'Requiere PostgreSQL con las migraciones del RC; las pruebas estaticas no son una medicion de latencia.'),
      notRun('daily_close_server', 'Requiere PostgreSQL con datos sinteticos y roles reales en un entorno aislado.'),
      notRun('private_pdf_storage_download', 'Requiere Supabase Storage privado aislado y URL firmada; no se consulto staging.'),
      notRun('print_spool_and_physical_output', 'Requiere impresora, driver y observacion fisica del resultado.'),
      notRun('moto_g15', 'Requiere el dispositivo fisico y la matriz de conectividad solicitada.'),
      notRun('iphone', 'Requiere un iPhone fisico; el viewport emulado no lo sustituye.'),
      notRun('wifi_mobile_and_degraded_networks', 'Requiere redes y dispositivos reales; no se fabrican cifras con shaping sintetico.'),
    ],
  };
  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  await fs.writeFile(outputPath, `${JSON.stringify(payload, null, 2)}\n`, { flag: 'wx' });
  process.stdout.write(`${JSON.stringify({ ok: true, output: path.relative(root, outputPath), gitHead: payload.gitHead, profiles: profiles.length, pdf: pdf.status })}\n`);
} finally {
  await browser?.close().catch(() => undefined);
  if (!server.killed) server.kill();
}

async function measureBrowserProfile(browserInstance, profile) {
  const samples = {
    initial_load: [],
    catalog_render: [],
    catalog_search: [],
    cart_update: [],
    cart_render: [],
    tracking_render: [],
    business_panel_unlock_and_render: [],
  };

  for (let index = 0; index < iterations; index += 1) {
    const context = await browserInstance.newContext({
      viewport: profile.viewport,
      serviceWorkers: 'block',
    });
    const page = await context.newPage();
    const pageErrors = [];
    page.on('pageerror', (error) => pageErrors.push(error.message));
    page.on('console', (message) => {
      if (message.type() === 'error' && !/Failed to load resource|Service Worker/i.test(message.text())) {
        pageErrors.push(message.text());
      }
    });
    await page.addInitScript(() => {
      localStorage.clear();
      sessionStorage.clear();
      window.open = () => null;
      try {
        Object.defineProperty(navigator, 'clipboard', {
          configurable: true,
          value: { writeText: async () => undefined, readText: async () => '' },
        });
      } catch (_) {
        // Clipboard is not part of the measured path.
      }
    });

    samples.initial_load.push(await duration(async () => {
      await page.goto(`${baseUrl}/?reset=1&demo=1#home`, { waitUntil: 'load' });
      await page.waitForURL((url) => !url.searchParams.has('reset'), { waitUntil: 'load' });
      await page.locator('[data-view="home"]').waitFor({ state: 'visible' });
      await page.locator('[data-home-catalog-preview] .home-catalog-card').first().waitFor({ state: 'visible' });
    }));

    samples.catalog_render.push(await duration(async () => {
      await page.evaluate(() => { window.location.hash = '#catalog'; });
      await page.locator('[data-view="catalog"]').waitFor({ state: 'visible' });
      await page.locator('[data-product-grid] .product-card').first().waitFor({ state: 'visible' });
    }));

    samples.catalog_search.push(await duration(async () => {
      await page.locator('[data-view="catalog"] [data-search-input]').fill('imperial golden');
      await page.waitForFunction(() => (
        [...document.querySelectorAll('[data-product-grid] .product-card')]
          .some((card) => card.getBoundingClientRect().height > 0)
      ));
    }));

    samples.cart_update.push(await duration(async () => {
      await page.locator('[data-product-grid] [data-add-product]:not([disabled]):visible').first().click();
      await page.waitForFunction(() => (
        [...document.querySelectorAll('[data-cart-count]')]
          .some((node) => node.getBoundingClientRect().height > 0 && node.textContent?.trim() !== '0')
      ));
    }));

    samples.cart_render.push(await duration(async () => {
      await page.evaluate(() => { window.location.hash = '#cart'; });
      await page.locator('[data-view="cart"]').waitFor({ state: 'visible' });
      await page.locator('[data-cart-list] .cart-item').first().waitFor({ state: 'visible' });
    }));

    samples.tracking_render.push(await duration(async () => {
      await page.evaluate(() => { window.location.hash = '#tracking'; });
      await page.locator('[data-view="tracking"]').waitFor({ state: 'visible' });
      await page.locator('[data-tracking-panel]').waitFor({ state: 'visible' });
    }));

    samples.business_panel_unlock_and_render.push(await duration(async () => {
      await page.goto(`${baseUrl}/?demo=1#business`, { waitUntil: 'load' });
      const unlock = page.locator('[data-open-pin][data-admin-target="business"]');
      if (await unlock.isVisible().catch(() => false)) {
        await unlock.click();
        await page.locator('[data-pin-form] input[name="pin"]').fill('1234');
        await page.locator('[data-pin-form]').press('Enter');
      }
      await page.locator('[data-business-dashboard]').waitFor({ state: 'visible' });
    }));

    if (pageErrors.length > 0) {
      throw new Error(`Errores de pagina durante la medicion: ${pageErrors.join(' | ')}`);
    }
    await context.close();
  }

  return {
    id: profile.id,
    environment: 'loopback_static_server_headless_chromium',
    physicalDevice: false,
    realNetwork: false,
    viewport: profile.viewport,
    unit: 'milliseconds',
    metrics: Object.fromEntries(Object.entries(samples).map(([name, values]) => [name, summarize(values)])),
  };
}

async function measureFiscalPdf() {
  const modulePath = path.join(root, 'services', 'arca-fiscal-bridge', 'dist', 'src', 'pdf.js');
  try {
    await fs.access(modulePath);
  } catch (_) {
    return notRun('fiscal_pdf_generation', 'El bridge TypeScript compilado no existe; ejecutar npm run fiscal:build antes de medir.');
  }
  const { createAuthorizedFiscalPdf, sha256Pdf, FISCAL_PDF_GENERATOR_VERSION } = await import(pathToFileURL(modulePath));
  const qr = {
    issueDate: '2026-08-02',
    cuit: '20123456789',
    pointOfSale: 5,
    documentType: 13,
    documentNumber: 43,
    totalAmount: 121,
    currencyCode: 'PES',
    currencyRate: 1,
    recipientDocumentType: 99,
    recipientDocumentNumber: '0',
    authorizationType: 'E',
    authorizationCode: '12345678901234',
  };
  const input = {
    businessName: 'TABA fixture sintetico',
    legalName: 'TABA fixture sintetico S.R.L.',
    cuit: qr.cuit,
    address: 'Domicilio sintetico',
    recipientName: 'Receptor sintetico',
    recipientCondition: 'consumidor_final',
    recipientDocumentType: 99,
    recipientDocumentNumber: '0',
    documentLabel: 'Nota de credito C',
    pointOfSale: 5,
    documentNumber: 43,
    issueDate: '2026-08-02',
    currencyCode: 'PES',
    items: [{ description: 'Producto sintetico', quantity: 1, unitPrice: 121, amount: 121, netAmount: 100, taxAmount: 21, taxCode: 5 }],
    netAmount: 100,
    vatAmount: 21,
    exemptAmount: 0,
    nonTaxedAmount: 0,
    otherTaxesAmount: 0,
    totalAmount: 121,
    cae: qr.authorizationCode,
    caeExpiration: '2026-08-12',
    qr,
    associatedDocument: { documentType: 11, pointOfSale: 5, documentNumber: 42, issueDate: '2026-08-02' },
    legends: ['Fixture sintetico sin valor comercial'],
  };
  const values = [];
  const hashes = [];
  let sizeBytes = 0;
  for (let index = 0; index < Math.max(iterations, 10); index += 1) {
    const start = performance.now();
    const bytes = await createAuthorizedFiscalPdf(input);
    values.push(performance.now() - start);
    hashes.push(sha256Pdf(bytes));
    sizeBytes = bytes.byteLength;
  }
  if (new Set(hashes).size !== 1) throw new Error('La salida PDF de la medicion no fue determinista.');
  return {
    status: 'MEASURED_LOCAL_SYNTHETIC',
    generatorVersion: FISCAL_PDF_GENERATOR_VERSION,
    unit: 'milliseconds',
    samples: values.length,
    duration: summarize(values),
    sizeBytes,
    deterministicSha256: hashes[0],
  };
}

async function duration(action) {
  const start = performance.now();
  await action();
  return performance.now() - start;
}

function summarize(values) {
  const sorted = [...values].sort((left, right) => left - right);
  return {
    samples: sorted.length,
    min: round(sorted[0]),
    p50: round(percentile(sorted, 0.50)),
    p95: round(percentile(sorted, 0.95)),
    max: round(sorted[sorted.length - 1]),
  };
}

function percentile(sorted, ratio) {
  const index = Math.min(sorted.length - 1, Math.ceil(sorted.length * ratio) - 1);
  return sorted[Math.max(0, index)];
}

function round(value) {
  return Math.round(value * 100) / 100;
}

function boundedInteger(value, fallback, minimum, maximum) {
  const parsed = Number.parseInt(value || String(fallback), 10);
  if (!Number.isInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new Error(`Valor entero fuera de rango ${minimum}-${maximum}.`);
  }
  return parsed;
}

async function waitForServer(url) {
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    if (server.exitCode !== null) throw new Error('El servidor local termino antes de iniciar.');
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(1_000) });
      if (response.ok) return;
    } catch (_) {
      // Startup polling is bounded by the deadline.
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error('El servidor local no respondio dentro del plazo.');
}

function gitValue(args) {
  return execFileSync('git', args, { cwd: root, encoding: 'utf8', windowsHide: true }).trim();
}

function notRun(metric, reason) {
  return { metric, status: 'NOT_RUN', reason };
}

function evaluateLocalBudget(profiles, pdf) {
  const failures = [];
  for (const profile of profiles) {
    for (const [metric, threshold] of Object.entries(localRegressionBudgetMs)) {
      if (metric === 'fiscal_pdf_generation') continue;
      const value = profile.metrics[metric]?.p95;
      if (!Number.isFinite(value) || value > threshold) {
        failures.push(`${profile.id}:${metric}:${value ?? 'missing'}>${threshold}`);
      }
    }
  }
  const pdfP95 = pdf.status === 'MEASURED_LOCAL_SYNTHETIC' ? pdf.duration?.p95 : undefined;
  if (!Number.isFinite(pdfP95) || pdfP95 > localRegressionBudgetMs.fiscal_pdf_generation) {
    failures.push(`fiscal_pdf_generation:${pdfP95 ?? 'missing'}>${localRegressionBudgetMs.fiscal_pdf_generation}`);
  }
  return { passed: failures.length === 0, failures };
}
