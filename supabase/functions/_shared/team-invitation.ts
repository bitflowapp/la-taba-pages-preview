/**
 * Invitación al equipo: la persona invitada crea su cuenta sin SMTP y sin terminal.
 *
 * EL PROBLEMA
 * -----------
 * CONTROLLED_PRODUCTION exige confirmar el correo y no tiene SMTP. Cada persona
 * nueva del equipo (el dueño comercial, un encargado, un repartidor) necesitaba
 * que un operador con la clave de servicio le creara la cuenta y le pasara un
 * enlace de un solo uso (`accounts.mjs create-account` + `access-link`).
 *
 * EL VÍNCULO DE CONFIANZA
 * -----------------------
 * El dueño ya crea la invitación desde el Panel (`identity_create_invitation`):
 * token de 256 bits, un solo correo, un solo uso, vence y se revoca. Quien tiene
 * ese link Y sabe a qué correo está dirigido puede crear la cuenta de ESE
 * correo. Es exactamente la confianza que daba el enlace del operador, sin el
 * operador.
 *
 * LO QUE ESTA FUNCIÓN NO HACE
 * ---------------------------
 *   · No otorga rol. La membresía la sigue creando `identity_accept_invitation`
 *     con la sesión de la persona, como siempre.
 *   · No toca una cuenta que ya existe (salvo la que creó esta misma invitación
 *     y nunca se usó): con una cuenta existente la persona entra con su
 *     contraseña. Si no, un link filtrado serviría para quedarse con la cuenta
 *     de otro.
 *   · No manda correos, no guarda el token y no lo loguea.
 *
 * Devuelve un `token_hash` de recuperación, el mismo que ya canjea /cuenta/
 * (verifyOtp) para elegir la contraseña con la política de Auth (12+ y
 * filtraciones conocidas).
 */

export const TOKEN_PATTERN = /^[0-9a-f]{64}$/;
const EMAIL_PATTERN = /^[^@\s]{1,64}@[^@\s]{1,190}\.[^@\s]{2,}$/;
const MAX_BODY_BYTES = 4 * 1024;

export interface InvitationAccount {
  exists: boolean;
  user_id: string | null;
  created_by_invitation: boolean;
  ever_signed_in: boolean;
  banned: boolean;
}

export interface InvitationLookup {
  found: boolean;
  status?: 'pending' | 'accepted' | 'revoked' | 'expired';
  invitation_id?: string;
  business_name?: string;
  invited_email?: string;
  invited_role?: 'owner' | 'admin' | 'staff' | 'rider';
  full_name?: string;
  expires_at?: string;
  account?: InvitationAccount;
}

export interface TeamInvitationDeps {
  lookup: (token: string) => Promise<InvitationLookup>;
  createUser: (input: { email: string; fullName: string; invitationId: string }) => Promise<{ userId: string } | { exists: true }>;
  recoveryTokenHash: (email: string) => Promise<string>;
  recordActivation: (token: string, userId: string, created: boolean) => Promise<void>;
  allowedOrigins: string[];
  log?: (event: Record<string, unknown>) => void;
}

type Json = Record<string, unknown>;

export function emailHint(email: string): string {
  const [local, domain] = String(email || '').split('@');
  if (!local || !domain) return '';
  const visible = local.length <= 2 ? local.slice(0, 1) : local.slice(0, 2);
  return `${visible}${'•'.repeat(Math.max(1, Math.min(6, local.length - visible.length)))}@${domain}`;
}

/** Una cuenta es «nueva» si no existe, o si la creó esta invitación y nunca se usó. */
export function accountIsFresh(account?: InvitationAccount): boolean {
  if (!account || !account.exists) return true;
  return account.created_by_invitation && !account.ever_signed_in && !account.banned;
}

export function corsHeaders(request: Request, allowed: string[]): Record<string, string> | null {
  const origin = request.headers.get('origin') || '';
  if (!origin) return {};
  const local = /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin);
  if (!allowed.includes(origin) && !local) return null;
  return {
    'access-control-allow-origin': origin,
    'access-control-allow-headers': 'authorization, apikey, content-type, x-client-info',
    'access-control-allow-methods': 'POST, OPTIONS',
    'cache-control': 'no-store',
    vary: 'Origin',
  };
}

function json(value: Json, status: number, cors: Record<string, string> | null): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...(cors || {}) },
  });
}

async function readBody(request: Request): Promise<Json | null> {
  const declared = Number(request.headers.get('content-length') || 0);
  if (declared > MAX_BODY_BYTES) return null;
  let text: string;
  try { text = await request.text(); } catch (_) { return null; }
  if (new TextEncoder().encode(text).length > MAX_BODY_BYTES) return null;
  try {
    const parsed = JSON.parse(text);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Json : null;
  } catch (_) {
    return null;
  }
}

/** Qué se le contesta a una invitación que no está vigente. Un solo código para todo lo que no sirve. */
function notUsable(lookup: InvitationLookup): Json | null {
  if (!lookup.found || !lookup.status) return { ok: false, code: 'invalid_token' };
  if (lookup.status === 'accepted') return { ok: false, code: 'already_accepted' };
  if (lookup.status !== 'pending') return { ok: false, code: 'invalid_token' };
  if (lookup.account?.banned) return { ok: false, code: 'account_disabled' };
  return null;
}

export async function handleTeamInvitation(request: Request, deps: TeamInvitationDeps): Promise<Response> {
  const cors = corsHeaders(request, deps.allowedOrigins);
  if (request.method === 'OPTIONS') return new Response(null, { status: cors ? 204 : 403, headers: cors || undefined });
  if (!cors) return json({ ok: false, code: 'ORIGIN_NOT_ALLOWED' }, 403, null);
  if (request.method !== 'POST') return json({ ok: false, code: 'METHOD_NOT_ALLOWED' }, 405, cors);

  const body = await readBody(request);
  if (!body) return json({ ok: false, code: 'INVALID_REQUEST' }, 400, cors);
  const action = String(body.action || '');
  const token = String(body.token || '').trim();
  if (!['inspect', 'activate'].includes(action)) return json({ ok: false, code: 'INVALID_REQUEST' }, 400, cors);
  if (!TOKEN_PATTERN.test(token)) return json({ ok: false, code: 'invalid_token' }, 200, cors);

  try {
    const lookup = await deps.lookup(token);
    const refused = notUsable(lookup);
    if (refused) {
      deps.log?.({ event: 'team_invitation', action, outcome: refused.code });
      return json(refused, 200, cors);
    }
    const fresh = accountIsFresh(lookup.account);

    if (action === 'inspect') {
      deps.log?.({ event: 'team_invitation', action, outcome: 'ok', account: fresh ? 'new' : 'existing' });
      return json({
        ok: true,
        business_name: lookup.business_name || 'La Taba',
        role: lookup.invited_role,
        full_name: lookup.full_name || '',
        email_hint: emailHint(lookup.invited_email || ''),
        expires_at: lookup.expires_at,
        account: fresh ? 'new' : 'existing',
      }, 200, cors);
    }

    // activate
    const email = String(body.email || '').trim().toLowerCase();
    if (!EMAIL_PATTERN.test(email) || email !== String(lookup.invited_email || '').toLowerCase()) {
      deps.log?.({ event: 'team_invitation', action, outcome: 'email_mismatch' });
      return json({ ok: false, code: 'email_mismatch' }, 200, cors);
    }
    if (!fresh) {
      deps.log?.({ event: 'team_invitation', action, outcome: 'account_exists' });
      return json({ ok: false, code: 'account_exists' }, 200, cors);
    }

    let userId = lookup.account?.exists ? String(lookup.account.user_id || '') : '';
    let created = false;
    if (!userId) {
      const outcome = await deps.createUser({ email, fullName: lookup.full_name || '', invitationId: String(lookup.invitation_id) });
      if ('exists' in outcome) {
        // Alguien creó la cuenta entre la consulta y ahora: se vuelve a mirar
        // con las mismas reglas en vez de adivinar.
        const again = await deps.lookup(token);
        if (!accountIsFresh(again.account) || !again.account?.user_id) {
          return json({ ok: false, code: 'account_exists' }, 200, cors);
        }
        userId = String(again.account.user_id);
      } else {
        userId = outcome.userId;
        created = true;
      }
    }

    const tokenHash = await deps.recoveryTokenHash(email);
    await deps.recordActivation(token, userId, created);
    deps.log?.({ event: 'team_invitation', action, outcome: 'ok', created });
    return json({ ok: true, token_hash: tokenHash, type: 'recovery' }, 200, cors);
  } catch (_) {
    deps.log?.({ event: 'team_invitation', action, outcome: 'error' });
    return json({ ok: false, code: 'SERVICE_UNAVAILABLE' }, 503, cors);
  }
}
