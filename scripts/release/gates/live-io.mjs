// Compuertas de release del e-commerce: el cableado contra el entorno real.
//
// POR QUÉ ES UN ARCHIVO APARTE Y CHICO
// ------------------------------------
// Es lo único de esta herramienta que toca la red y una credencial, así que es
// lo único que los tests NO importan: lo leen como texto y comprueban que no
// sepa escribir. Para que esa comprobación valga, acá no hay un «request»
// genérico: hay exactamente tres llamadas, escritas enteras.
//
//   GET  /v1/projects/<ref>/functions                     (listado de Edge Functions)
//   GET  /v1/projects/<ref>/secrets                       (nombre y huella SHA-256 de cada secreto)
//   POST /v1/projects/<ref>/database/query/read-only      (SQL con el rol de sólo lectura)
//
// El de secretos devuelve, por secreto, el nombre y la HUELLA SHA-256 del valor
// (verificado: la de MERCADOPAGO_ENVIRONMENT de Staging es la de `test`); el
// valor no viaja. Acá se queda sólo con nombre y huella, y la huella no sale de
// `collect.mjs`: se compara contra los valores públicos del contrato y lo que
// queda es un estado. El cuerpo de esa respuesta no se repite en ningún error.
//
// El tercero es un POST porque así lo define la Management API; lo que corre
// del otro lado es `supabase_read_only_user` en una transacción de sólo
// lectura. Antes de salir, el texto pasa otra vez por `assertSelectOnly`.
//
// LA CREDENCIAL
// -------------
// El token de la Management API se lee recién cuando hace falta, nunca se
// imprime ni se guarda, y no viaja en ningún mensaje de error. Para
// CONTROLLED_PRODUCTION es la credencial «CP SUPABASE ACCESS TOKEN» del
// almacén de Windows; si no está, el token del CLI. Para Staging, el del CLI.
import { leerSecreto } from '../../e2e-production-sale/secretos-windows.mjs';
import { leerTokenDelCli } from '../../lib/supabase-cli-token.mjs';
import { NON_CP_REFS, TARGETS } from '../../controlled-production/target-keys.mjs';
import { assertSelectOnly } from './collect.mjs';

const MANAGEMENT_API = 'https://api.supabase.com';
// El mismo ref que `scripts/controlled-production/opening-tools.mjs` (CP_REF).
const CONTROLLED_PRODUCTION_REF = 'tkanbadcglszlcyfjvpv';
const CP_TOKEN_CREDENTIAL = 'CP SUPABASE ACCESS TOKEN';

export const PROJECT_REFS = Object.freeze({
  staging: TARGETS.staging.ref,
  'controlled-production': CONTROLLED_PRODUCTION_REF,
});

// Sólo lecturas: un corte transitorio se reintenta sin riesgo de duplicar nada.
const TRANSIENT = /HTTP_(429|5\d\d)|fetch failed|timeout|aborted|ECONNRESET|ENOTFOUND|EAI_AGAIN|UND_ERR/i;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function refOf(target) {
  const ref = PROJECT_REFS[target];
  if (!/^[a-z0-9]{20}$/.test(ref || '')) throw Error(`UNKNOWN_TARGET:${target}`);
  // Producción vieja y DEMO nunca son CONTROLLED_PRODUCTION, y CP nunca es Staging.
  if (target === 'controlled-production' && NON_CP_REFS.has(ref)) throw Error('CP_REF_IS_NOT_ISOLATED');
  if (target === 'staging' && ref === CONTROLLED_PRODUCTION_REF) throw Error('STAGING_REF_IS_CP');
  return ref;
}

function readToken(target) {
  if (target === 'controlled-production') {
    // Fuera de Windows el almacén no existe y el lector lanza: se cae al token del CLI
    // (o a SUPABASE_ACCESS_TOKEN), que es el camino previsto para ese caso.
    let stored = null;
    try { stored = leerSecreto(CP_TOKEN_CREDENTIAL)?.secreto?.trim(); } catch (_) { stored = null; }
    if (stored) return stored;
  }
  return leerTokenDelCli();
}

/**
 * El `io` de red para `collect()`: { runReadOnlySql, listFunctions, listSecrets }.
 * `fetchImpl` y `readTokenImpl` se pueden inyectar; por defecto, los reales.
 */
export function createLiveIo(target, { fetchImpl = fetch, readTokenImpl = readToken } = {}) {
  const ref = refOf(target);
  let token = null;
  const bearer = () => {
    token ??= readTokenImpl(target);
    if (!token) throw Error('MANAGEMENT_TOKEN_UNAVAILABLE');
    return token;
  };
  // El cuerpo de un error de la API se recorta y, por las dudas, se le quita el token.
  const safe = (body) => String(body ?? '').split(token || '\u0000').join('<redacted>').replace(/\s+/g, ' ').slice(0, 240);

  async function withRetry(task) {
    for (let attempt = 1; ; attempt += 1) {
      try {
        return await task();
      } catch (error) {
        if (attempt >= 4 || !TRANSIENT.test(`${error.name} ${error.message} ${error.cause?.code || ''}`)) throw error;
        await sleep(1500 * attempt);
      }
    }
  }

  async function parse(response, label) {
    const body = await response.text();
    if (!response.ok) throw Error(`MGMT_HTTP_${response.status}:${label}:${safe(body)}`);
    return body ? JSON.parse(body) : null;
  }

  const listFunctions = () => withRetry(async () => {
    const response = await fetchImpl(`${MANAGEMENT_API}/v1/projects/${ref}/functions`, {
      method: 'GET',
      headers: { Authorization: `Bearer ${bearer()}` },
      signal: AbortSignal.timeout(60_000),
    });
    const list = await parse(response, 'functions');
    if (!Array.isArray(list)) throw Error('FUNCTIONS_NOT_A_LIST');
    return list.map((fn) => ({
      slug: fn.slug, status: fn.status, verify_jwt: fn.verify_jwt, version: fn.version,
      bundle_sha256: fn.ezbr_sha256 ?? null, updated_at: fn.updated_at ?? null,
    }));
  });

  // Nombres y huellas, nada más. Ni el cuerpo de un error ni el de un JSON roto
  // se repiten: en esta respuesta hay huellas de secretos.
  const listSecrets = () => withRetry(async () => {
    const response = await fetchImpl(`${MANAGEMENT_API}/v1/projects/${ref}/secrets`, {
      method: 'GET',
      headers: { Authorization: `Bearer ${bearer()}` },
      signal: AbortSignal.timeout(60_000),
    });
    const body = await response.text();
    if (!response.ok) throw Error(`MGMT_HTTP_${response.status}:secrets`);
    let list;
    try { list = JSON.parse(body); } catch (_) { throw Error('SECRETS_NOT_JSON'); }
    if (!Array.isArray(list)) throw Error('SECRETS_NOT_A_LIST');
    return list.map((secret) => ({
      name: typeof secret?.name === 'string' ? secret.name : null,
      digest: typeof secret?.value === 'string' ? secret.value : null,
    }));
  });

  const runReadOnlySql = (sql) => {
    const query = assertSelectOnly(sql);
    return withRetry(async () => {
      const response = await fetchImpl(`${MANAGEMENT_API}/v1/projects/${ref}/database/query/read-only`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${bearer()}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ query }),
        signal: AbortSignal.timeout(90_000),
      });
      const rows = await parse(response, 'read-only-sql');
      if (!Array.isArray(rows)) throw Error('SQL_RESULT_NOT_ROWS');
      return rows;
    });
  };

  return Object.freeze({ target, ref, runReadOnlySql, listFunctions, listSecrets });
}
