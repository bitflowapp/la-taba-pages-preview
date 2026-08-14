/*
 * B5 · Una publicación, una identidad.
 *
 * El gate no pregunta «¿alguien se acordó de subir el número?». Deriva la
 * identidad del CONTENIDO de todo lo que se precachea —hoy más de cien módulos,
 * de los cuales sólo cuatro llevan `?v=`— y la compara contra la firmada.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import {
  calcularIdentidad,
  compararIdentidad,
  verificarTokens,
} from '../scripts/check-release-identity.mjs';

const FIRMADA = JSON.parse(readFileSync(new URL('../release-identity.json', import.meta.url), 'utf8'));

const identidadDe = (cacheName, assetsDigest, assetCount = 127) => ({ cacheName, assetsDigest, assetCount });

test('el árbol publicable coincide con la identidad firmada', () => {
  const { identidad, fallas } = calcularIdentidad();
  assert.deepEqual(fallas, [], 'no debe haber incoherencias de tokens ni archivos ausentes');
  assert.equal(identidad.cacheName, FIRMADA.cacheName);
  assert.equal(identidad.assetsDigest, FIRMADA.assetsDigest);
  assert.equal(identidad.assetCount, FIRMADA.assetCount);
  assert.deepEqual(compararIdentidad(FIRMADA, identidad), []);
});

test('EL CASO QUE IMPORTA: contenido nuevo bajo la misma identidad se rechaza', () => {
  const fallas = compararIdentidad(
    identidadDe('la-taba-runtime-v66-production-blockers', 'aaaa'),
    identidadDe('la-taba-runtime-v66-production-blockers', 'bbbb'),
  );
  assert.equal(fallas.length, 1);
  assert.match(fallas[0], /contenido del precache CAMBIÓ y CACHE_NAME no/);
  assert.match(fallas[0], /rollback sin ancla/, 'el mensaje dice por qué importa, no sólo qué pasó');
});

test('un módulo SIN ?v= también rompe el gate: lo protege sólo CACHE_NAME', () => {
  // `js/core/browser-resume.js` y `js/ui.js` no llevan token propio. Cambiarles
  // un byte mueve el digest del artefacto, y ahí es donde este gate gana.
  const worker = readFileSync(new URL('../sw.js', import.meta.url), 'utf8');
  assert.ok(worker.includes("'./js/core/browser-resume.js'"), 'está precacheado');
  assert.ok(!worker.includes('browser-resume.js?v='), 'y no tiene versión propia');

  const fallas = compararIdentidad(
    identidadDe(FIRMADA.cacheName, FIRMADA.assetsDigest),
    identidadDe(FIRMADA.cacheName, 'digest-con-un-byte-distinto'),
  );
  assert.equal(fallas.length, 1);
});

test('subir CACHE_NAME sin cambiar un byte también se avisa', () => {
  const fallas = compararIdentidad(
    identidadDe('la-taba-runtime-v66-production-blockers', 'aaaa'),
    identidadDe('la-taba-runtime-v67-sin-motivo', 'aaaa'),
  );
  assert.equal(fallas.length, 1);
  assert.match(fallas[0], /sin que cambiara un solo byte/);
});

test('una publicación nueva y bien formada sólo pide refrescar la firma', () => {
  const fallas = compararIdentidad(
    identidadDe('la-taba-runtime-v66-production-blockers', 'aaaa'),
    identidadDe('la-taba-runtime-v67-siguiente', 'bbbb'),
  );
  assert.equal(fallas.length, 1);
  assert.match(fallas[0], /quedó atrás/);
});

test('los cuatro tokens tienen que coincidir entre index.html y sw.js', () => {
  const coherente = {
    indexHtml: '<link href="styles.css?v=50"><script src="js/app.js?v=42"></script>'
      + '<script src="js/pwa-update.js?v=3"></script><script src="js/startup-recovery.js?v=2"></script>',
    worker: "'./styles.css?v=50','./js/app.js?v=42','./js/pwa-update.js?v=3','./js/startup-recovery.js?v=2'",
  };
  assert.deepEqual(verificarTokens(coherente), []);

  // El worker se quedó en la versión anterior de app.js: dos URLs para el mismo
  // byte, y el precache partido.
  const desfasado = { ...coherente, worker: coherente.worker.replace('app.js?v=42', 'app.js?v=41') };
  const fallas = verificarTokens(desfasado);
  assert.equal(fallas.length, 1);
  assert.match(fallas[0], /sw\.js no precachea '\.\/js\/app\.js\?v=42'/);
});

test('un index.html sin token declarado no pasa', () => {
  const fallas = verificarTokens({
    indexHtml: '<script src="js/app.js"></script>',
    worker: "'./js/app.js'",
  });
  assert.ok(fallas.length >= 1);
  assert.ok(fallas.some((falla) => /no carga .* con un token \?v=/.test(falla)));
});
