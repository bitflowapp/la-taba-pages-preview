import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const root = path.resolve(import.meta.dirname, '..');
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8');
const config = JSON.parse(read('src-tauri/tauri.conf.json'));
const capability = JSON.parse(read('src-tauri/capabilities/default.json'));
const shell = read('src-tauri/src/lib.rs');
const outbox = read('src-tauri/src/outbox.rs');
const printing = read('src-tauri/src/printing.rs');
const support = read('src-tauri/src/support.rs');

test('desktop empaqueta la misma aplicación con identidad Windows estable', () => {
  assert.equal(config.productName, 'TABA Negocio');
  assert.equal(config.identifier, 'ar.com.lataba.negocio');
  assert.equal(config.build.frontendDist, '../dist-desktop');
  assert.deepEqual(config.bundle.targets, ['msi', 'nsis']);
  assert.equal(config.bundle.windows.nsis.installMode, 'currentUser');
});

test('CSP y capabilities permanecen cerradas a APIs y hosts necesarios', () => {
  assert.match(config.app.security.csp, /default-src 'self'/);
  assert.match(config.app.security.csp, /https:\/\/\*\.supabase\.co/);
  assert.doesNotMatch(config.app.security.csp, /https:\s|http:\s|\*\s*;/);
  assert.deepEqual(capability.permissions, ['core:default']);
  assert.doesNotMatch(JSON.stringify(capability), /shell|process|fs:/i);
});

test('shell implementa instancia única, bandeja y cierre explícito', () => {
  assert.match(shell, /tauri_plugin_single_instance::init/);
  assert.match(shell, /TrayIconBuilder/);
  assert.match(shell, /CloseRequested/);
  assert.match(shell, /explicit_exit/);
  assert.match(shell, /tauri_plugin_window_state/);
});

test('outbox nativo es SQLite durable y no almacena secretos', () => {
  for (const field of ['idempotency_key', 'attempt_count', 'next_attempt_at', 'last_error']) {
    assert.match(outbox, new RegExp(field));
  }
  assert.match(outbox, /journal_mode\s*=\s*WAL/);
  assert.match(outbox, /rejects_sensitive_payload/);
  for (const blockedKey of ['servicerole', 'privatekey', 'certificate']) {
    assert.match(outbox, new RegExp(`"${blockedKey}"`));
  }
});

test('impresión usa Winspool con contrato RAW acotado, sin shell arbitrario', () => {
  for (const api of ['OpenPrinterW', 'StartDocPrinterW', 'WritePrinter', 'ClosePrinter']) {
    assert.match(printing, new RegExp(api));
  }
  assert.match(printing, /raw_text/);
  assert.doesNotMatch(printing, /Command::new|powershell|cmd\.exe/i);
});

test('backup y diagnóstico nativos son verificables y no exponen rutas o payloads', () => {
  const supportRuntime = support.split('#[cfg(test)]')[0];
  assert.match(support, /VACUUM INTO/);
  assert.match(support, /PRAGMA quick_check/);
  assert.match(support, /Sha256/);
  assert.match(support, /OpenFlags::SQLITE_OPEN_READ_ONLY/);
  assert.match(support, /correlationIds/);
  assert.doesNotMatch(shell, /database_path:\s*String|log_directory:\s*String/);
  assert.doesNotMatch(supportRuntime, /printer_name|payload_json|last_error_message/);
});

test('la ventana mínima del escritorio queda por encima del corte móvil del Panel', () => {
  // El Panel cambia a navegación de teléfono por debajo de 1020px. La ventana
  // de escritorio declaraba `minWidth: 1024`: cuatro píxeles de margen sobre el
  // corte, medidos sobre el ancho de la VENTANA, no del webview. En Windows el
  // área de cliente descuenta bordes y la barra de desplazamiento, así que una
  // ventana de 1024 deja un viewport de ~1000 y la aplicación de escritorio
  // habría mostrado la barra inferior de teléfono dentro de un monitor.
  //
  // No es hipotético: es la misma clase de desajuste que aparece cada vez que
  // dos números que tienen que estar relacionados viven en archivos distintos.
  // Acá se relacionan.
  const [ventana] = config.app.windows;
  const panel = read('styles/business.css');
  const cortes = [...panel.matchAll(/@media \(max-width: (\d+)px\)/g)].map((m) => Number(m[1]));
  const corteMovil = Math.max(...cortes);

  assert.ok(Number.isFinite(corteMovil), 'el Panel ya no declara un corte móvil');
  assert.ok(
    ventana.minWidth >= corteMovil + 64,
    `minWidth ${ventana.minWidth} deja el escritorio a ${ventana.minWidth - corteMovil}px del corte móvil `
    + `(${corteMovil}px); hacen falta al menos 64 para que el webview no caiga del otro lado`,
  );
  assert.ok(ventana.width >= ventana.minWidth, 'la ventana por defecto no puede ser menor que su mínimo');
});
