/**
 * Sonda externa del planificador de TABA2.
 *
 * El barrido de alertas (`taba-operational-alerts-sweep`) detecta todo lo demás,
 * pero no puede denunciar su propia ausencia: si pg_cron deja de ejecutarlo, no
 * queda nadie adentro para decirlo. Este Worker es ese alguien de afuera. Corre
 * en Cloudflare, con su propio reloj, y no comparte NADA con el planificador que
 * vigila: ni proceso, ni base, ni scheduler.
 *
 * Dos superficies, a propósito distintas:
 *
 *   scheduled()  cada 5 minutos llama a `check_scheduler_watchdog`, que mide el
 *                atraso real contra la base y abre o cierra la alerta. La
 *                condición la decide el servidor: este Worker no puede inventar
 *                una alerta ni silenciarla, sólo pedir que se mire el reloj.
 *
 *   fetch()      cualquiera puede abrir la URL y ver el estado. Es de sólo
 *                lectura (`scheduler_heartbeat`) y responde 503 cuando el
 *                barrido está atrasado, así que sirve como destino para
 *                cualquier monitor de uptime que se quiera enchufar después,
 *                sin tocar una línea de este código.
 *
 * No guarda ningún secreto de negocio: la única credencial es la clave anónima,
 * la misma que el sitio publica en el navegador.
 */

const SOURCE = 'cloudflare_cron';

async function callRpc(env, name, body) {
  const response = await fetch(`${env.SUPABASE_URL}/rest/v1/rpc/${name}`, {
    method: 'POST',
    headers: {
      apikey: env.SUPABASE_ANON_KEY,
      authorization: `Bearer ${env.SUPABASE_ANON_KEY}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify(body || {}),
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`${name} respondió ${response.status}: ${text.slice(0, 200)}`);
  }
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`${name} devolvió algo que no es JSON`);
  }
}

function describe(beat, extra) {
  return [
    `servicio        ${beat.service}`,
    `última corrida  ${beat.last_run_at ?? 'nunca'}`,
    `antigüedad      ${beat.age_seconds ?? '?'} s`,
    `se espera cada  ${beat.expected_every_seconds} s`,
    `atrasado desde  ${beat.stale_after_seconds} s`,
    `estado          ${beat.healthy ? 'AL DÍA' : 'ATRASADO'}`,
    ...(extra ? [`acción          ${extra}`] : []),
    '',
    'Esta página la sirve un Worker de Cloudflare, con su propio reloj.',
    'Si dice ATRASADO, el sistema dejó de revisarse solo.',
  ].join('\n');
}

export default {
  /** El reloj de afuera. Es la única razón de ser de este Worker. */
  async scheduled(event, env, ctx) {
    ctx.waitUntil((async () => {
      try {
        const result = await callRpc(env, 'check_scheduler_watchdog', { p_source: SOURCE });
        console.log(JSON.stringify({
          at: new Date(event.scheduledTime).toISOString(),
          healthy: result.healthy,
          age_seconds: result.age_seconds,
          action: result.action,
        }));
      } catch (error) {
        // Si ni siquiera se puede preguntar, el problema es más grande que el
        // planificador. Queda en el registro del Worker y en el 503 de la URL.
        console.error(JSON.stringify({ at: new Date(event.scheduledTime).toISOString(), error: String(error.message || error) }));
      }
    })());
  },

  /** Estado legible, de sólo lectura, apto para un monitor externo. */
  async fetch(request, env) {
    if (new URL(request.url).pathname === '/favicon.ico') {
      return new Response(null, { status: 204 });
    }
    try {
      const beat = await callRpc(env, 'scheduler_heartbeat', {});
      return new Response(describe(beat), {
        status: beat.healthy ? 200 : 503,
        headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' },
      });
    } catch (error) {
      return new Response(`No se pudo consultar el estado del planificador.\n${String(error.message || error)}\n`, {
        status: 503,
        headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' },
      });
    }
  },
};
