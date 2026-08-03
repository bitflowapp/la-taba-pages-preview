import { createClient } from 'npm:@supabase/supabase-js@2';

const URL = requiredEnvironment('SUPABASE_URL');
const ANON_KEY = requiredEnvironment('SUPABASE_ANON_KEY');
const SERVICE_ROLE = requiredEnvironment('SUPABASE_SERVICE_ROLE_KEY');
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

Deno.serve(async (request) => {
  const cors = corsHeaders(request);
  if (request.method === 'OPTIONS') return new Response(null, { status: cors ? 204 : 403, headers: cors || undefined });
  if (request.method !== 'POST') return json({ code: 'METHOD_NOT_ALLOWED' }, 405, cors);
  const authorization = request.headers.get('authorization') || '';
  if (!/^Bearer\s+.+/i.test(authorization)) return json({ code: 'AUTH_REQUIRED' }, 401, cors);
  let body: { artifactId?: unknown; action?: unknown };
  try { body = await request.json(); } catch { return json({ code: 'INVALID_REQUEST' }, 400, cors); }
  const artifactId = String(body.artifactId || '');
  const action = String(body.action || '');
  if (!UUID.test(artifactId) || !['preview', 'download', 'print'].includes(action)) return json({ code: 'INVALID_REQUEST' }, 400, cors);

  const user = createClient(URL, ANON_KEY, { global: { headers: { Authorization: authorization } } });
  const { data: grant, error: grantError } = await user.rpc('authorize_fiscal_artifact_access', {
    p_artifact_id: artifactId,
    p_action: action,
  });
  if (grantError || !grant?.artifact_id) return json({ code: 'ARTIFACT_ACCESS_DENIED' }, 403, cors);

  const admin = createClient(URL, SERVICE_ROLE, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: artifact, error: artifactError } = await admin
    .from('fiscal_document_artifacts')
    .select('storage_path,mime_type')
    .eq('id', artifactId)
    .eq('is_current', true)
    .eq('state', 'artifact_ready')
    .maybeSingle();
  if (artifactError || !artifact?.storage_path || artifact.mime_type !== 'application/pdf') return json({ code: 'ARTIFACT_NOT_AVAILABLE' }, 404, cors);

  const { data: signed, error: signedError } = await admin.storage
    .from('fiscal-documents')
    .createSignedUrl(artifact.storage_path, 60, action === 'download' ? { download: `comprobante-${artifactId}.pdf` } : undefined);
  if (signedError || !signed?.signedUrl) return json({ code: 'ARTIFACT_ACCESS_UNAVAILABLE' }, 503, cors);
  return json({ signedUrl: signed.signedUrl, expiresAt: new Date(Date.now() + 60_000).toISOString(), sha256: grant.sha256 }, 200, cors);
});

function requiredEnvironment(name: string): string {
  const value = Deno.env.get(name)?.trim();
  if (!value) throw new Error(`${name} is required by fiscal-artifact-access`);
  return value;
}

function corsHeaders(request: Request): HeadersInit | null {
  const origin = request.headers.get('origin');
  if (!origin) return {};
  const configured = (Deno.env.get('FISCAL_PANEL_ORIGINS') || '').split(',').map((value) => value.trim()).filter(Boolean);
  const tauriOrigin = /^tauri:\/\/localhost$|^http:\/\/tauri\.localhost$/i.test(origin);
  if (!tauriOrigin && !configured.includes(origin)) return null;
  return {
    'access-control-allow-origin': origin,
    'access-control-allow-headers': 'authorization, apikey, content-type, x-client-info',
    'access-control-allow-methods': 'POST, OPTIONS',
    vary: 'Origin',
  };
}

function json(value: Record<string, unknown>, status: number, cors: HeadersInit | null): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', ...(cors || {}) },
  });
}
