/**
 * Superficie de administración de identidad para el Panel.
 *
 * Todo lo que hay acá es una llamada a una RPC del backend. Ninguna decisión de
 * autorización vive en este archivo: el servidor devuelve `insufficient_privilege`
 * cuando corresponde y esto lo traduce a un mensaje. Si mañana alguien abre la
 * consola del navegador y llama a estas funciones con otro comercio, el backend
 * dice que no igual.
 */

const AUTHORIZATION_DENIED = 'No tenés permiso para hacer eso.';

export function createIdentityAdminService({ client, businessId }) {
  if (!client || typeof client.rpc !== 'function') {
    throw new Error('La administración de identidad requiere un cliente Supabase válido.');
  }
  if (!businessId) {
    throw new Error('La administración de identidad requiere un businessId.');
  }

  async function call(name, params = {}) {
    const { data, error } = await client.rpc(name, params);
    if (error) return { ok: false, message: readableError(error) };
    return { ok: true, data };
  }

  /** Equipo del comercio, con su estado y cuántas sesiones tiene abiertas. */
  async function listMembers() {
    const result = await call('identity_list_members', { p_business_id: businessId });
    if (!result.ok) return result;
    return { ok: true, members: Array.isArray(result.data) ? result.data : [] };
  }

  /** Sesiones y dispositivos vivos. */
  async function listSessions({ userId = null, includeRevoked = false } = {}) {
    const result = await call('identity_list_sessions', {
      p_business_id: businessId,
      p_user_id: userId,
      p_include_revoked: includeRevoked,
    });
    if (!result.ok) return result;
    return { ok: true, sessions: Array.isArray(result.data) ? result.data : [] };
  }

  /** Cierra una sesión puntual sin tocar las demás de esa persona. */
  async function revokeSession(sessionId) {
    if (!sessionId) return { ok: false, message: 'Falta la sesión a cerrar.' };
    const result = await call('identity_revoke_session', { p_session_id: sessionId });
    if (!result.ok) return result;
    return { ok: result.data?.ok === true, code: result.data?.code || null };
  }

  /** Cierra todas las sesiones de una persona, incluidas las desconocidas. */
  async function revokeAllSessions(userId) {
    if (!userId) return { ok: false, message: 'Falta la persona.' };
    const result = await call('identity_revoke_all_sessions', {
      p_business_id: businessId,
      p_user_id: userId,
    });
    if (!result.ok) return result;
    return {
      ok: result.data?.ok === true,
      sessionsRevoked: Number(result.data?.sessions_revoked || 0),
    };
  }

  /**
   * Da de baja o reactiva a una persona. La baja cierra sus sesiones y mueve la
   * línea de corte, así que un token viejo que nunca se registró tampoco sirve.
   */
  async function setMemberActive({ userId, isActive, reason = '' }) {
    if (!userId) return { ok: false, message: 'Falta la persona.' };
    const result = await call('identity_set_member_active', {
      p_business_id: businessId,
      p_user_id: userId,
      p_is_active: Boolean(isActive),
      p_reason: reason ? String(reason).slice(0, 200) : null,
    });
    if (!result.ok) return result;
    if (result.data?.ok !== true) {
      return { ok: false, code: result.data?.code || null, message: reasonMessage(result.data?.code) };
    }
    return { ok: true, sessionsRevoked: Number(result.data?.sessions_revoked || 0) };
  }

  /** Cambia el rol. Otorgar owner o admin sólo lo puede hacer un owner. */
  async function setMemberRole({ userId, role }) {
    const result = await call('identity_set_member_role', {
      p_business_id: businessId,
      p_user_id: userId,
      p_role: role,
    });
    if (!result.ok) return result;
    if (result.data?.ok !== true) {
      return { ok: false, code: result.data?.code || null, message: reasonMessage(result.data?.code) };
    }
    return { ok: true, role: result.data?.role || role };
  }

  /**
   * Emite una invitación. El token vuelve UNA sola vez: en la base queda
   * únicamente su sha256, así que si se pierde hay que emitir otra.
   */
  async function createInvitation({ email, role, fullName }) {
    const result = await call('identity_create_invitation', {
      p_business_id: businessId,
      p_email: email,
      p_role: role,
      p_full_name: fullName,
    });
    if (!result.ok) return result;
    if (result.data?.ok !== true) {
      return { ok: false, code: result.data?.code || null, message: reasonMessage(result.data?.code) };
    }
    return {
      ok: true,
      invitationId: result.data.invitation_id,
      token: result.data.token,
      expiresAt: result.data.expires_at,
      role: result.data.invited_role,
    };
  }

  async function listInvitations() {
    const result = await call('identity_list_invitations', { p_business_id: businessId });
    if (!result.ok) return result;
    return { ok: true, invitations: Array.isArray(result.data) ? result.data : [] };
  }

  async function revokeInvitation(invitationId) {
    const result = await call('identity_revoke_invitation', { p_invitation_id: invitationId });
    if (!result.ok) return result;
    return { ok: result.data?.ok === true, code: result.data?.code || null };
  }

  /** Últimos movimientos de identidad. Sin secretos y sin correos completos. */
  async function listAuditEvents({ limit = 100 } = {}) {
    const result = await call('identity_list_audit_events', {
      p_business_id: businessId,
      p_limit: limit,
    });
    if (!result.ok) return result;
    return { ok: true, events: Array.isArray(result.data) ? result.data : [] };
  }

  return {
    createInvitation,
    listAuditEvents,
    listInvitations,
    listMembers,
    listSessions,
    revokeAllSessions,
    revokeInvitation,
    revokeSession,
    setMemberActive,
    setMemberRole,
  };
}

function readableError(error) {
  const code = String(error?.code || '');
  if (code === '42501') return AUTHORIZATION_DENIED;
  if (code === 'P0002' || code === '02000') return 'Esa persona no pertenece al comercio.';
  return 'No pudimos completar la operación.';
}

function reasonMessage(code) {
  switch (code) {
    case 'last_owner':
      return 'El comercio no puede quedarse sin ningún dueño activo.';
    case 'role_above_actor':
      return 'Ese rol lo tiene que asignar el dueño del comercio.';
    case 'already_member':
      return 'Esa persona ya forma parte del equipo.';
    case 'invitation_pending':
      return 'Ya hay una invitación pendiente para ese correo.';
    case 'invalid_email':
      return 'Revisá el correo.';
    case 'invalid_role':
      return 'Ese rol no existe.';
    case 'invalid_name':
      return 'Falta el nombre de la persona.';
    case 'invalid_token':
      return 'La invitación no es válida, ya se usó o venció.';
    default:
      return 'No pudimos completar la operación.';
  }
}
