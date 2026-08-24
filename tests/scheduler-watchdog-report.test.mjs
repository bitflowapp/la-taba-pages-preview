// El informe del reloj externo, ejercitado.
//
// Antes era un `python3 -c '…'` dentro del YAML del flujo: sin pruebas, y sin
// forma de escribirlas. Estos casos fijan lo unico que importa de esa pieza —
// que un barrido detenido produzca salida distinta de cero, y que una respuesta
// que no se entiende NO se confunda con salud.

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

import { report } from '../scripts/scheduler-watchdog-report.mjs';

const sano = {
  service: 'operational_alerts',
  last_run_at: '2026-08-16T17:28:00Z',
  age_seconds: 35,
  stale_after_seconds: 600,
  action: 'none',
  healthy: true,
};

test('un barrido al dia sale sano y lo dice', () => {
  const { lines, healthy } = report(JSON.stringify(sano));
  assert.equal(healthy, true);
  assert.ok(lines.some((l) => l.includes('El barrido corre al dia.')));
  assert.ok(lines.some((l) => l.includes('operational_alerts')));
  assert.ok(!lines.some((l) => l.startsWith('::error::')));
});

test('un barrido detenido abre incidente', () => {
  const { lines, healthy } = report(JSON.stringify({ ...sano, healthy: false, age_seconds: 4200 }));
  assert.equal(healthy, false);
  assert.ok(lines.some((l) => l.startsWith('::error::')));
  assert.ok(lines.some((l) => l.includes('4200')));
});

test('healthy ausente NO es sano', () => {
  // Es el caso que decide si el reloj externo sirve: una respuesta que este
  // informe no sabe leer no puede pasar por buena, porque entonces el silencio
  // del planificador se veria igual que su salud.
  const { healthy } = report(JSON.stringify({ service: 'operational_alerts' }));
  assert.equal(healthy, false);
});

test('healthy con un valor que no es true tampoco es sano', () => {
  for (const valor of ['true', 1, null, undefined, {}]) {
    const { healthy } = report(JSON.stringify({ ...sano, healthy: valor }));
    assert.equal(healthy, false, `healthy=${JSON.stringify(valor)} no puede pasar por sano`);
  }
});

test('acepta la forma envuelta en arreglo que devuelve PostgREST', () => {
  const { healthy } = report(JSON.stringify([sano]));
  assert.equal(healthy, true);
});

test('una respuesta que no es JSON es incidente, no es salud', () => {
  for (const cuerpo of ['', '<html>502</html>', 'null', 'undefined']) {
    const { healthy, lines } = report(cuerpo);
    assert.equal(healthy, false, `"${cuerpo}" no puede pasar por sano`);
    assert.ok(lines.some((l) => l.startsWith('::error::')));
  }
});

/**
 * El YAML sin sus comentarios.
 *
 * Una aserción de ausencia contra el archivo entero se cumple sola en cuanto
 * alguien explica en un comentario por qué la cosa ausente ya no está — que es
 * exactamente lo que dice el comentario del paso de checkout.
 */
function sinComentarios(yaml) {
  return yaml
    .split('\n')
    .filter((line) => !line.trimStart().startsWith('#'))
    .join('\n');
}

const WORKFLOWS = path.join(import.meta.dirname, '..', '.github', 'workflows');

test('el flujo invoca la sonda del repositorio y ya no depende de python', () => {
  /*
   * La consulta y la resolución de configuración salieron del YAML hacia
   * `scheduler-watchdog-probe.mjs`, que sí tiene pruebas. Lo que este caso
   * protege no cambió: que el flujo corra CÓDIGO DEL REPOSITORIO, que traiga
   * los archivos que invoca —sin el checkout el paso muere con «no such file»
   * en cada corrida del cron— y que nadie vuelva a meter un intérprete ajeno.
   */
  const flujo = fs.readFileSync(path.join(WORKFLOWS, 'scheduler-watchdog.yml'), 'utf8');
  const codigo = sinComentarios(flujo);
  assert.ok(codigo.includes('node scripts/scheduler-watchdog-probe.mjs'));
  assert.ok(!/\bpython3?\b/.test(codigo));

  // Los dos archivos: la sonda importa al informe, así que traer sólo uno deja
  // el paso muerto igual.
  assert.ok(codigo.includes('scripts/scheduler-watchdog-probe.mjs'));
  assert.ok(codigo.includes('scripts/scheduler-watchdog-report.mjs'));

  // Que el despojado siga viendo el paso: un filtro que se coma el bloque
  // entero haría pasar las ausencias de arriba para siempre.
  assert.ok(codigo.includes('SUPABASE_ANON_KEY'));
});

test('la RPC del reloj sigue siendo la que la sonda consulta', () => {
  // La comprobación se mudó con el código: antes el nombre de la RPC estaba en
  // el YAML, ahora está en la sonda. Si desapareciera de las dos, el vigía
  // estaría preguntando otra cosa y nadie se enteraría.
  const sonda = fs.readFileSync(
    path.join(import.meta.dirname, '..', 'scripts', 'scheduler-watchdog-probe.mjs'),
    'utf8',
  );
  assert.ok(sonda.includes('check_scheduler_watchdog'));
});

test('ningun flujo del repositorio depende ya de python', () => {
  const restos = fs.readdirSync(WORKFLOWS)
    .filter((f) => f.endsWith('.yml') || f.endsWith('.yaml'))
    .filter((f) => /\bpython3?\b/.test(sinComentarios(fs.readFileSync(path.join(WORKFLOWS, f), 'utf8'))));
  assert.deepEqual(restos, []);
});
