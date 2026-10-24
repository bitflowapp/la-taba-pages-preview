import assert from 'node:assert/strict';
import test from 'node:test';

import fs from 'node:fs';

import { resolverConfiguracion, consultar, sondear, vigiaDeProduccion } from '../scripts/scheduler-watchdog-probe.mjs';

/*
 * LA SONDA DEL PLANIFICADOR, PROBADA SIN TOCAR LA RED NI EMITIR UNA ALERTA.
 *
 * Ninguna de estas pruebas sale a internet: todas inyectan `buscar`. Una prueba
 * que consultara el servidor real mediría el humor de la red, y una que
 * disparara la RPC de verdad dejaría rastro en el registro de un sistema de
 * alertas por el sólo hecho de correr la suite.
 *
 * El defecto que cierran: el flujo llevaba 133 corridas fallando cada diez
 * minutos con «Falta configurar SUPABASE_URL (variable) o SUPABASE_ANON_KEY
 * (secreto)» —sin decir cuál de las dos— y ese tramo vivía en un bloque de
 * shell donde no había forma de ejercitarlo.
 */

const RESPUESTA_SANA = JSON.stringify({
  healthy: true,
  service: 'taba-operational-alerts-sweep',
  last_run_at: '2026-08-24T03:31:00Z',
  age_seconds: 45,
  stale_after_seconds: 600,
  action: 'ninguna',
});

const RESPUESTA_MUERTA = JSON.stringify({
  healthy: false,
  service: 'taba-operational-alerts-sweep',
  last_run_at: '2026-08-24T02:00:00Z',
  age_seconds: 5400,
  stale_after_seconds: 600,
  action: 'revisar pg_cron',
});

const CONFIG_PUBLICADA = `
globalThis.__LA_TABA_RUNTIME_CONFIG__ = {
  repository: {
    supabaseUrl: 'https://wwcpogltfgzgkrlilbcd.supabase.co',
    publishableKey: 'sb_publishable_ejemplo',
  },
};`;

/** Un `fetch` de mentira que contesta según la URL pedida. */
function red({ runtimeConfig = CONFIG_PUBLICADA, rpc = RESPUESTA_SANA, estadoRpc = 200, estadoConfig = 200 } = {}) {
  const pedidos = [];
  const buscar = async (url, opciones = {}) => {
    pedidos.push({ url, opciones });
    if (String(url).endsWith('/runtime-config.js')) {
      return { ok: estadoConfig >= 200 && estadoConfig < 300, status: estadoConfig, text: async () => runtimeConfig };
    }
    if (typeof rpc === 'function') return rpc(opciones);
    return { ok: estadoRpc >= 200 && estadoRpc < 300, status: estadoRpc, text: async () => rpc };
  };
  return { buscar, pedidos };
}

const ENTORNO_COMPLETO = {
  SUPABASE_URL: 'https://wwcpogltfgzgkrlilbcd.supabase.co',
  SUPABASE_ANON_KEY: 'sb_publishable_del_secreto',
};

test('con la variable y el secreto puestos, gana la fuente explícita', async () => {
  const { buscar, pedidos } = red();
  const config = await resolverConfiguracion({ entorno: ENTORNO_COMPLETO, buscar });
  assert.equal(config.clave, 'sb_publishable_del_secreto');
  assert.match(config.origen, /variable y secreto/);
  assert.equal(pedidos.length, 0, 'no hace falta salir a la red si la configuración ya está');
});

test('sin la URL, la toma del sitio publicado en vez de morir', async () => {
  const { buscar } = red();
  const config = await resolverConfiguracion({
    entorno: { SUPABASE_ANON_KEY: 'sb_publishable_del_secreto' },
    buscar,
  });
  assert.equal(config.url, 'https://wwcpogltfgzgkrlilbcd.supabase.co');
  assert.equal(config.clave, 'sb_publishable_del_secreto', 'el secreto explícito sigue mandando');
});

test('sin la clave, la toma del sitio publicado: es la que el navegador ya recibe', async () => {
  const { buscar } = red();
  const config = await resolverConfiguracion({ entorno: { SUPABASE_URL: 'https://otro.supabase.co' }, buscar });
  assert.equal(config.url, 'https://otro.supabase.co');
  assert.equal(config.clave, 'sb_publishable_ejemplo');
});

test('sin nada, y con el sitio caído, dice CUÁL falta —una por una—', async () => {
  const { buscar } = red({ estadoConfig: 503 });
  const config = await resolverConfiguracion({ entorno: {}, buscar });
  assert.deepEqual(config.faltan, ['SUPABASE_URL', 'SUPABASE_ANON_KEY']);

  const { lineas, sano } = await sondear({ entorno: {}, buscar });
  assert.equal(sano, false);
  const salida = lineas.join('\n');
  assert.match(salida, /WATCHDOG CONFIGURATION MISSING: SUPABASE_URL/);
  assert.match(salida, /WATCHDOG CONFIGURATION MISSING: SUPABASE_ANON_KEY/);
  assert.doesNotMatch(salida, /undefined/, 'un `undefined` en el log es exactamente lo que hay que evitar');
  assert.match(salida, /NO se necesita service_role/, 'tiene que cerrarle la puerta a ampliar privilegios');
});

test('falta sólo la clave y el sitio tampoco la da: nombra esa y no la otra', async () => {
  const { buscar } = red({ runtimeConfig: 'globalThis.__LA_TABA_RUNTIME_CONFIG__ = {};' });
  const config = await resolverConfiguracion({ entorno: { SUPABASE_URL: 'https://x.supabase.co' }, buscar });
  assert.deepEqual(config.faltan, ['SUPABASE_ANON_KEY']);
});

test('el servidor no responde: incidente, no falso verde', async () => {
  const { buscar } = red({ estadoRpc: 500, rpc: 'upstream down' });
  const { lineas, sano } = await sondear({ entorno: ENTORNO_COMPLETO, buscar });
  assert.equal(sano, false);
  assert.match(lineas.join('\n'), /contestó 500/);
});

test('el servidor tarda más del plazo: incidente con el motivo dicho', async () => {
  const nuncaContesta = (opciones) => new Promise((_, rechazar) => {
    opciones.signal.addEventListener('abort', () => {
      const error = new Error('abortada');
      error.name = 'AbortError';
      rechazar(error);
    });
  });
  const { buscar } = red({ rpc: nuncaContesta });
  const { lineas, sano } = await sondear({ entorno: ENTORNO_COMPLETO, buscar, limiteMs: 30 });
  assert.equal(sano, false);
  assert.match(lineas.join('\n'), /no contestó en/);
});

test('respuesta que no es JSON: incidente', async () => {
  const { buscar } = red({ rpc: '<html>502 Bad Gateway</html>' });
  const { lineas, sano } = await sondear({ entorno: ENTORNO_COMPLETO, buscar });
  assert.equal(sano, false);
  assert.match(lineas.join('\n'), /no devolvio JSON/);
});

test('condición sana: sale 0 y lo dice', async () => {
  const { buscar } = red();
  const { lineas, sano } = await sondear({ entorno: ENTORNO_COMPLETO, buscar });
  assert.equal(sano, true);
  assert.match(lineas.join('\n'), /El barrido corre al dia/);
});

test('condición que debe alertar: el barrido murió', async () => {
  const { buscar } = red({ rpc: RESPUESTA_MUERTA });
  const { lineas, sano } = await sondear({ entorno: ENTORNO_COMPLETO, buscar });
  assert.equal(sano, false);
  assert.match(lineas.join('\n'), /dejo de correr/);
});

test('la clave nunca aparece en la salida, ni siquiera cuando algo falla', async () => {
  /*
   * Publicable no es lo mismo que «da igual dónde quede». Un log de Actions es
   * público en un repositorio público, y una clave impresa ahí es una clave que
   * hay que rotar aunque no fuera secreta.
   */
  const secreta = 'sb_publishable_NO_DEBE_APARECER';
  const casos = [
    red({ estadoRpc: 500, rpc: `denegado para ${secreta}` }),
    red({ rpc: `no es json y menciona ${secreta}` }),
    red(),
  ];
  for (const { buscar } of casos) {
    const { lineas } = await sondear({ entorno: { ...ENTORNO_COMPLETO, SUPABASE_ANON_KEY: secreta }, buscar });
    assert.doesNotMatch(lineas.join('\n'), /NO_DEBE_APARECER/);
  }
});

test('la sonda pide exactamente la RPC del reloj, y sólo lee', async () => {
  const { buscar, pedidos } = red();
  await consultar({ url: 'https://x.supabase.co', clave: 'k', buscar });
  const pedido = pedidos.at(-1);
  assert.equal(pedido.url, 'https://x.supabase.co/rest/v1/rpc/check_scheduler_watchdog');
  assert.equal(pedido.opciones.method, 'POST');
  assert.equal(JSON.parse(pedido.opciones.body).p_source, 'github_actions');
});

// ---- El vigía de producción, atado a deploy/environments.json --------------------------------------------------
// Del 21 al 23/10/2026 el flujo falló en cada corrida: el sitio publicado apunta a un proyecto que ya no existe.

const REGISTRO_REAL = JSON.parse(fs.readFileSync(new URL('../deploy/environments.json', import.meta.url), 'utf8'));
const REGISTRO_ACTIVO = JSON.parse(fs.readFileSync(new URL('./fixtures/environments.production-active.json', import.meta.url), 'utf8'));
const URL_PRODUCCION = `https://${REGISTRO_ACTIVO.environments.production.supabase.ref}.supabase.co`;
const configApuntandoA = (url) => CONFIG_PUBLICADA.replace('https://wwcpogltfgzgkrlilbcd.supabase.co', url);

test('sin proyecto de producción el vigía queda en espera: sale sano, avisa y no consulta ningún reloj', async () => {
  const { buscar, pedidos } = red();
  const { lineas, sano, enEspera } = await vigiaDeProduccion({ registro: REGISTRO_REAL, entorno: {}, buscar });
  assert.equal(sano, true);
  assert.equal(enEspera, true);
  assert.ok(lineas.some((l) => l.startsWith('::warning::') && /no hay barrido que vigilar/.test(l)));
  assert.ok(lineas.some((l) => /proyecto retirado wwcpogltfgzgkrlilbcd/.test(l)), 'el sitio que apunta a un proyecto retirado no se pierde de vista');
  assert.ok(!pedidos.some((p) => String(p.url).includes('/rpc/')), 'no consulta ningún reloj');
});

test('con producción activa pregunta al proyecto del registro y sale sano si el sitio apunta ahí', async () => {
  const { buscar, pedidos } = red({ runtimeConfig: configApuntandoA(URL_PRODUCCION) });
  const { sano } = await vigiaDeProduccion({ registro: REGISTRO_ACTIVO, entorno: {}, buscar });
  assert.equal(sano, true);
  assert.ok(pedidos.some((p) => p.url === `${URL_PRODUCCION}/rest/v1/rpc/check_scheduler_watchdog`));
});

test('con producción activa es incidente que el sitio publicado siga apuntando a otro proyecto', async () => {
  const { buscar } = red();
  const { lineas, sano } = await vigiaDeProduccion({ registro: REGISTRO_ACTIVO, entorno: {}, buscar });
  assert.equal(sano, false);
  assert.ok(lineas.some((l) => l.startsWith('::error::') && /no al proyecto de producción del registro/.test(l)));
});

test('con producción activa es incidente que la variable del repositorio apunte a otro proyecto', async () => {
  const { buscar, pedidos } = red({ runtimeConfig: configApuntandoA(URL_PRODUCCION) });
  const { lineas, sano } = await vigiaDeProduccion({ registro: REGISTRO_ACTIVO, entorno: { SUPABASE_URL: 'https://wwcpogltfgzgkrlilbcd.supabase.co' }, buscar });
  assert.equal(sano, false);
  assert.match(lineas.join('\n'), /variable SUPABASE_URL/);
  assert.ok(!pedidos.some((p) => String(p.url).includes('/rpc/')));
});