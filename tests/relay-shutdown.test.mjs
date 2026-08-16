// Que el relay se apague cuando se lo piden.
//
// No manejaba ninguna señal. Playwright lo levanta como su `webServer` y al
// terminar la corrida le pide que pare; el relay se quedaba con las conexiones
// SSE abiertas —que por definición no terminan— y no salía nunca. A los 300 s
// Playwright lo mataba a la fuerza, escribía un error de apagado, y
// `npm run test:e2e` devolvía 1 con las 404 pruebas en verde.
//
// `ci.yml:97` corre ese mismo comando, así que el gate daba rojo con todo bien.
// Un gate que da rojo cuando todo pasó se termina ignorando.
//
// UN MATIZ QUE CONVIENE SABER ANTES DE VOLVER A PERSEGUIRLO. El síntoma también
// depende de la carga de la máquina. Medido, en este orden:
//
//   sin manejo de señales, máquina cargada    404 passed · 2 errores · exit 1
//   con manejo de señales, máquina cargada    404 passed · 2 errores · exit 1
//   con manejo de señales, máquina libre      404 passed · 0 errores · exit 0  (17.4 min)
//
// O sea: el apagado ordenado hacía falta —sin él el relay no salía nunca— pero
// no es lo único en juego. Bajo contención los workers de Playwright tampoco
// alcanzan a parar dentro de su ventana. Si el síntoma reaparece en un runner
// apretado, no es este archivo: es la ventana de teardown de Playwright.

import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const RELAY = path.join(import.meta.dirname, '..', 'scripts', 'realtime-relay.mjs');

test('el relay declara los manejadores de apagado', () => {
  const source = fs.readFileSync(RELAY, 'utf8');
  assert.match(source, /function shutdown\(\)/);
  assert.match(source, /SIGTERM/);
  assert.match(source, /SIGINT/);
  assert.match(source, /server\.close\(/);
  // Cerrar el servidor no alcanza: las conexiones abiertas lo mantienen vivo.
  assert.match(source, /closeAllConnections/);
  // Y el plazo, por si algo queda colgado igual.
  assert.match(source, /setTimeout\(\(\) => process\.exit\(0\), \d+\)/);
});

test('levanta, responde y sale cuando se lo piden', { timeout: 30_000 }, async () => {
  const port = 18000 + Math.floor(process.pid % 500);
  const child = spawn(process.execPath, [RELAY, String(port)], { stdio: 'ignore' });
  const exited = new Promise((resolve) => child.once('exit', (code, signal) => resolve({ code, signal })));

  try {
    // Esperar a que escuche, sin dormir un plazo fijo.
    let up = false;
    for (let i = 0; i < 60 && !up; i += 1) {
      try {
        const r = await fetch(`http://127.0.0.1:${port}/health`);
        up = r.ok;
      } catch { await new Promise((r) => setTimeout(r, 100)); }
    }
    assert.ok(up, 'el relay no llegó a escuchar');

    child.kill('SIGTERM');
    const carrera = await Promise.race([
      exited,
      new Promise((resolve) => setTimeout(() => resolve('PLAZO'), 15_000)),
    ]);
    assert.notEqual(carrera, 'PLAZO', 'el relay no salió a los 15 s de pedírselo');
  } finally {
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
  }
});
