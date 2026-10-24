// Cliente de la Management API para el proyecto de PRODUCCIÓN, con la misma disciplina que el de QA
// (scripts/recovery/hosted-client.mjs) pero con su propia guardia:
//
//   · el destino sale de deploy/environments.json (sin proyecto de producción, no se lee ninguna credencial);
//   · el ref no puede ser QA, retirado ni de otro producto;
//   · la organización tiene que ser la del registro y NO estar en el plan gratuito;
//   · el proyecto tiene que estar sano, en la región del registro y en esa organización;
//   · después del primer despliegue, la base tiene que llevar la marca de producción con ese mismo ref.
//
// Nada de esto crea proyectos ni cambia planes.
import { conToken } from '../lib/supabase-cli-token.mjs';
import { forbiddenRefsFor, productionTarget, readEnvironments } from '../lib/environments.mjs';

export const MARKER_TABLE = 'private.la_taba_deployment_target';
export const LEDGER_TABLE = 'private.la_taba_deployment_migrations';
const REDACT = /(?:sbp_|sb_secret_|APP_USR-|TEST-)[A-Za-z0-9_-]+/g;

/** La guardia sobre lo que contesta la Management API. Pura: se prueba sin red. */
export function assertProductionPlatform(target, { organization, project }) {
  const problems = [];
  if (organization?.id !== target.organizationId) problems.push('la organización no es la del registro');
  if (!organization?.plan || String(organization.plan).toLowerCase() === 'free') problems.push('la organización está en el plan gratuito');
  if (project?.id !== target.ref && project?.ref !== target.ref) problems.push('el proyecto no es el del registro');
  if (project?.organization_id !== target.organizationId) problems.push('el proyecto pertenece a otra organización');
  if (project?.region !== target.region) problems.push(`región ${project?.region}, se esperaba ${target.region}`);
  if (project?.status !== 'ACTIVE_HEALTHY') problems.push(`estado ${project?.status}`);
  if (problems.length) throw new Error(`Destino de producción rechazado: ${problems.join('; ')}`);
}

/**
 * Presta `request` y `query` contra el proyecto de producción del registro, después de la guardia.
 * `requireMarker: false` sólo para el primer despliegue (la marca todavía no existe).
 */
export async function withProductionProject(action, { registry = readEnvironments(), requireMarker = true, withToken = conToken, fetchImpl = fetch } = {}) {
  const target = productionTarget({ registry, allowProvisioned: true });
  if (forbiddenRefsFor('production', registry).has(target.ref)) throw new Error('El ref de producción coincide con QA, un retirado o un ajeno');
  return withToken(async (token) => {
    const headers = { Authorization: `Bearer ${token}`, 'content-type': 'application/json' };
    const decode = async (response) => {
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        const message = String(body.message || body.error || 'Provider request failed').replace(REDACT, '[redacted]').slice(0, 1500);
        throw new Error(`Production HTTP ${response.status}: ${message}`);
      }
      return body;
    };
    const organization = await decode(await fetchImpl(`https://api.supabase.com/v1/organizations/${target.organizationId}`, { headers, signal: AbortSignal.timeout(15000) }));
    const base = `https://api.supabase.com/v1/projects/${target.ref}`;
    const project = await decode(await fetchImpl(base, { headers, signal: AbortSignal.timeout(15000) }));
    assertProductionPlatform(target, { organization, project });
    const request = async (suffix, init = {}) => {
      if (!/^\/[a-z0-9/?=&_-]+$/i.test(suffix)) throw new Error('Invalid project API suffix');
      const requestHeaders = new Headers({ ...headers, ...init.headers });
      if (init.body instanceof FormData) requestHeaders.delete('content-type');
      return decode(await fetchImpl(base + suffix, { ...init, headers: requestHeaders, signal: AbortSignal.timeout(150000) }));
    };
    const query = (sql) => request('/database/query', { method: 'POST', body: JSON.stringify({ query: sql }) });
    if (requireMarker) {
      const marker = await query(`select project_ref, environment from ${MARKER_TABLE} where singleton`).catch(() => []);
      if (marker.length !== 1 || marker[0].project_ref !== target.ref || marker[0].environment !== 'production') {
        throw new Error('La base no lleva la marca de producción de este ref: ¿falta el primer despliegue o es otra base?');
      }
    }
    return action({ target, request, query, project, organization });
  });
}
