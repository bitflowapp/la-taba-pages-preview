import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { pathToFileURL } from 'node:url';

const ROOT = path.resolve(import.meta.dirname, '..');
const DEFAULT_FILE = path.join(ROOT, process.env.TABA_RUNTIME_CONFIG_PATH || 'runtime-config.js');

export function redact(value) {
  const text = String(value || '');
  if (text.length < 10) return '[redactado]';
  return `${text.slice(0, 6)}…${text.slice(-4)}`;
}

export function readRuntimeFile(filePath = DEFAULT_FILE) {
  const absolute = path.resolve(filePath);
  const source = fs.readFileSync(absolute, 'utf8');
  const sandbox = { globalThis: {} };
  vm.runInNewContext(source, sandbox, { filename: absolute, timeout: 1000 });
  return sandbox.globalThis.__LA_TABA_RUNTIME_CONFIG__ ?? null;
}

export async function checkRuntimeConfig(filePath = DEFAULT_FILE) {
  const { resolveRuntimeConfig } = await import(
    pathToFileURL(path.join(ROOT, 'js/core/runtime-config.js')).href
  );
  const raw = readRuntimeFile(filePath);
  const result = resolveRuntimeConfig(raw);
  return {
    ok: result.isProductionReady,
    status: result.status,
    environment: result.repository?.deploymentEnvironment || null,
    supabaseHost: result.repository?.supabaseUrl
      ? new URL(result.repository.supabaseUrl).hostname
      : null,
    businessId: result.repository?.businessId || null,
    keyFingerprint: result.repository?.publishableKey
      ? redact(result.repository.publishableKey)
      : null,
    errors: result.errors,
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(import.meta.filename)) {
  const file = process.argv[2] || DEFAULT_FILE;
  try {
    const report = await checkRuntimeConfig(file);
    if (!report.ok) {
      console.error('Configuración runtime rechazada:');
      for (const error of report.errors) console.error(`- ${error}`);
      process.exitCode = 1;
    } else {
      console.log(
        `Runtime válido: entorno=${report.environment}, host=${report.supabaseHost}, `
        + `business=${report.businessId}, key=${report.keyFingerprint}`,
      );
    }
  } catch (error) {
    console.error(`No se pudo validar el runtime: ${error.message}`);
    process.exitCode = 1;
  }
}
