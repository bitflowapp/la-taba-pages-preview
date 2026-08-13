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

/**
 * Los centinelas de la plantilla.
 *
 * `resolveRuntimeConfig` valida la FORMA —que la URL sea una URL, que el id sea
 * un uuid, que la clave tenga el prefijo correcto— y la plantilla sin editar
 * cumple las tres. Medido: `runtime-config.example.js` tal cual sale del repo
 * imprimía «Runtime válido: host=project_ref.supabase.co,
 * business=00000000-0000-4000-8000-000000000000, key=sb_pub…AZAR».
 *
 * O sea que un despliegue con la plantilla sin tocar pasaba el gate y publicaba
 * un sitio que no puede hablar con ningún backend.
 *
 * Esta capa mira el CONTENIDO y vive en el gate de despliegue, no en el
 * resolutor del navegador: así no cambia lo que hace el cliente en runtime,
 * sólo lo que se deja publicar.
 */
export function sentinelErrors(repository = {}) {
  const errores = [];
  const host = String(repository.supabaseUrl || '');
  const clave = String(repository.publishableKey || '');
  const negocio = String(repository.businessId || '');

  if (/project[_-]?ref|tu-proyecto|your-project|example\.com/i.test(host)) {
    errores.push(`supabaseUrl sigue siendo el de la plantilla: ${host}`);
  }
  if (/reemplazar|replace|placeholder|cambiar|xxxx/i.test(clave)) {
    errores.push('publishableKey sigue siendo el centinela de la plantilla');
  }
  if (/^0{8}-0{4}-[0-9a-f]0{3}-[0-9a-f]0{3}-0{12}$/i.test(negocio)) {
    errores.push(`businessId es el uuid de ceros de la plantilla: ${negocio}`);
  }
  return errores;
}

export async function checkRuntimeConfig(filePath = DEFAULT_FILE) {
  const { resolveRuntimeConfig } = await import(
    pathToFileURL(path.join(ROOT, 'js/core/runtime-config.js')).href
  );
  const raw = readRuntimeFile(filePath);
  const result = resolveRuntimeConfig(raw);
  const centinelas = sentinelErrors(result.repository || {});
  if (centinelas.length) {
    return {
      ok: false,
      status: result.status,
      environment: result.repository?.deploymentEnvironment || null,
      supabaseHost: result.repository?.supabaseUrl
        ? new URL(result.repository.supabaseUrl).hostname
        : null,
      businessId: result.repository?.businessId || null,
      keyFingerprint: result.repository?.publishableKey
        ? redact(result.repository.publishableKey)
        : null,
      errors: [...(result.errors || []), ...centinelas],
    };
  }
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
