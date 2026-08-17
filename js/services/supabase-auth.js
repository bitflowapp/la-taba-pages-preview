const TEAM_ROLES = new Set(['owner', 'admin', 'staff', 'rider']);
const PANEL_CLIENT = 'panel_web';

// Estado de una persona frente al comercio, visto desde el cliente. La
// autoridad sigue siendo el backend; esto es sólo cómo se llama acá a lo que el
// backend contestó, para que la vista no tenga que interpretar códigos.
export const TEAM_ACCESS_STATE = Object.freeze({
  MEMBER: 'member',
  PENDING: 'pending',
  REJECTED: 'rejected',
  NONE: 'none',
  UNKNOWN: 'unknown',
});

export const ACCESS_REQUEST_KINDS = Object.freeze(['panel', 'rider']);

export function createSupabaseAuthService({ client, businessId, deviceLabel = '', appVersion = '' }) {
  if (!client?.auth || typeof client.from !== 'function') {
    throw new Error('Auth requiere un cliente Supabase válido.');
  }
  if (!businessId) {
    throw new Error('Auth requiere un businessId.');
  }

  async function getSession() {
    const { data, error } = await client.auth.getSession();
    if (error) return authResult(false, { message: readableAuthError(error) });
    return authResult(true, {
      session: data?.session || null,
      user: data?.session?.user || null,
    });
  }

  async function ensureCustomerSession() {
    const current = await getSession();
    if (!current.ok) return current;
    if (current.session?.user) return current;

    const { data, error } = await client.auth.signInAnonymously({
      options: {
        data: {
          taba_actor: 'customer',
        },
      },
    });
    if (error || !data?.session?.user) {
      return authResult(false, {
        message: readableAuthError(error, 'No pudimos iniciar una sesión segura para el pedido.'),
      });
    }
    return authResult(true, {
      session: data.session,
      user: data.session.user,
      anonymous: true,
    });
  }

  // Crear la cuenta es crear una IDENTIDAD. No pide rol, no toca membresías y
  // no deja a nadie adentro del Panel: lo único que produce es alguien con quien
  // el comercio pueda, después, decidir qué hacer.
  async function signUpTeam({ email, password } = {}) {
    const normalizedEmail = String(email || '').trim();
    const normalizedPassword = String(password || '');
    if (!normalizedEmail || !normalizedPassword) {
      return authResult(false, { message: 'Ingresá email y contraseña.' });
    }

    const { data, error } = await client.auth.signUp({
      email: normalizedEmail,
      password: normalizedPassword,
      options: { data: { taba_actor: 'team' } },
    });

    if (error) {
      return authResult(false, {
        // Una cuenta ya existente no se confirma ni se desmiente: la frase sirve
        // igual en los dos casos y no convierte el alta en un buscador de
        // correos registrados.
        message: /already|registrad/i.test(String(error.message || ''))
          ? 'Si ya tenés una cuenta con ese correo, iniciá sesión.'
          : readableAuthError(error, 'No pudimos crear la cuenta. Revisá los datos.'),
      });
    }

    // Con confirmación de correo activada, Auth devuelve el usuario sin sesión.
    // Es un alta válida que todavía no puede seguir: se dice, no se disfraza.
    if (!data?.session) {
      return authResult(true, {
        user: data?.user || null,
        needsEmailConfirmation: true,
        message: 'Revisá tu correo para confirmar la cuenta y volvé a entrar.',
      });
    }

    return authResult(true, { session: data.session, user: data.session.user });
  }

  // Pedir acceso. El backend deriva la identidad del token: acá no se manda ni
  // se puede mandar un user_id ni un rol.
  async function requestTeamAccess({ access = 'panel', fullName = '', phone = '' } = {}) {
    if (!ACCESS_REQUEST_KINDS.includes(access)) {
      return authResult(false, { message: 'El tipo de acceso no es válido.' });
    }
    const name = String(fullName || '').trim();
    const contact = String(phone || '').trim();
    if (name.length < 2) return authResult(false, { message: 'Escribí tu nombre y apellido.' });
    if (access === 'rider' && !contact) {
      return authResult(false, { message: 'Escribí un teléfono para que el comercio pueda contactarte.' });
    }

    let response;
    try {
      response = await client.rpc('request_business_access', {
        p_business_id: businessId,
        p_access: access,
        p_full_name: name,
        p_contact_phone: contact || null,
      });
    } catch (_) {
      return authResult(false, { message: 'No pudimos enviar la solicitud. Probá de nuevo.' });
    }

    const { data, error } = response || {};
    if (error || !data) {
      return authResult(false, { message: 'No pudimos enviar la solicitud. Probá de nuevo.' });
    }
    if (data.ok !== true) {
      return authResult(false, { code: data.code || '', message: accessRequestMessage(data) });
    }
    return authResult(true, { code: data.code || '', request: normalizeAccessRequest(data) });
  }

  // Estado propio. Es la única lectura disponible para quien todavía no es del
  // equipo, y por eso no pasa por identity_current_context: a esa persona la
  // compuerta le contesta que no, con razón.
  async function readTeamAccessState() {
    let response;
    try {
      response = await client.rpc('get_my_business_access_request', { p_business_id: businessId });
    } catch (_) {
      return { state: TEAM_ACCESS_STATE.UNKNOWN, request: null };
    }
    const { data, error } = response || {};
    if (error || !data || data.ok !== true) {
      return { state: TEAM_ACCESS_STATE.UNKNOWN, request: null };
    }
    if (data.is_member === true) {
      return { state: TEAM_ACCESS_STATE.MEMBER, request: normalizeAccessRequest(data) };
    }
    if (data.status === 'pending') {
      return { state: TEAM_ACCESS_STATE.PENDING, request: normalizeAccessRequest(data) };
    }
    if (data.status === 'rejected') {
      return { state: TEAM_ACCESS_STATE.REJECTED, request: normalizeAccessRequest(data) };
    }
    // 'approved' sin membresía viva es un caso administrativo, no un pendiente:
    // el comercio lo resuelve. Se muestra como sin acceso, no como esperando.
    if (data.status === 'approved') {
      return { state: TEAM_ACCESS_STATE.NONE, request: normalizeAccessRequest(data) };
    }
    return { state: TEAM_ACCESS_STATE.NONE, request: null };
  }

  async function signInTeam({ email, password, expectedRole = '' } = {}) {
    const normalizedEmail = String(email || '').trim();
    if (!normalizedEmail || !String(password || '')) {
      return authResult(false, { message: 'Ingresá email y contraseña.' });
    }
    if (expectedRole && !TEAM_ROLES.has(expectedRole)) {
      return authResult(false, { message: 'El rol solicitado no es válido.' });
    }

    const { data, error } = await client.auth.signInWithPassword({
      email: normalizedEmail,
      password: String(password),
    });
    if (error || !data?.user) {
      return authResult(false, {
        message: readableAuthError(error, 'No pudimos iniciar sesión. Revisá tus credenciales.'),
      });
    }

    // La compuerta autoritativa sólo reconoce sesiones ya registradas. Por eso
    // el alta es el primer RPC posterior a Auth y valida la membresía por su
    // propio camino cerrado; recién después se pide el contexto operativo.
    const registration = await registerSession();
    if (!registration.ok || !registration.sessionId) {
      // Que la sesión no se registre puede ser dos cosas muy distintas: un
      // problema, o el estado NORMAL de alguien que acaba de crear su cuenta y
      // todavía no fue aprobado. Antes de tratarlo como error se pregunta cuál
      // de las dos es. Si es una espera, la sesión se conserva: sin ella la
      // persona no puede ni ver su estado ni cerrar sesión.
      const access = await readTeamAccessState();
      if (access.state === TEAM_ACCESS_STATE.PENDING
        || access.state === TEAM_ACCESS_STATE.REJECTED
        || access.state === TEAM_ACCESS_STATE.NONE) {
        return authResult(false, {
          awaitingAccess: true,
          accessState: access.state,
          accessRequest: access.request,
          session: data.session || null,
          user: data.user,
          message: '',
        });
      }
      await client.auth.signOut({ scope: 'local' });
      return authResult(false, { message: registration.message || 'No pudimos registrar esta sesión.' });
    }

    const membership = await getMembership(data.user.id);
    if (!membership.ok || (expectedRole && membership.membership?.role !== expectedRole)) {
      // Ya existe una fila revocable: cerrarla remotamente antes de vaciar el
      // navegador evita dejar una sesión huérfana si la vista no corresponde.
      await signOut();
      return authResult(false, {
        message: membership.ok
          ? 'Tu cuenta no tiene el rol requerido para esta vista.'
          : membership.message,
      });
    }

    return authResult(true, {
      session: data.session || null,
      user: data.user,
      membership: membership.membership,
      sessionId: registration.sessionId,
    });
  }

  async function registerSession() {
    let response;
    try {
      response = await client.rpc('identity_register_session', {
        p_business_id: businessId,
        p_client: PANEL_CLIENT,
        p_device_label: deviceLabel || null,
        p_device_key_hash: null,
        p_app_version: appVersion || null,
      });
    } catch (_) {
      return authResult(false, { message: 'No pudimos registrar esta sesión.' });
    }
    const { data, error } = response || {};
    if (error || data?.ok !== true || !data?.session_id) {
      return authResult(false, { message: 'No pudimos registrar esta sesión.' });
    }
    return authResult(true, { sessionId: data.session_id || null, role: data.role || null });
  }

  async function getMembership(userId) {
    if (!userId) return authResult(false, { message: 'No hay una sesión autenticada.' });

    // La autoridad es la compuerta del backend. Además de la membresía activa,
    // aplica bajas, revocaciones de sesión y cortes de tokens.
    const { data, error } = await client.rpc('identity_current_context', {
      p_business_id: businessId,
    });

    if (error) {
      return authResult(false, {
        message: 'No pudimos verificar el acceso al comercio.',
      });
    }
    const role = data?.role || '';
    const sessionId = data?.session_id || null;
    if (!TEAM_ROLES.has(role) || !sessionId) {
      return authResult(false, {
        message: 'La cuenta no tiene una membresía activa en este comercio.',
      });
    }

    return authResult(true, {
      membership: {
        business_id: businessId,
        user_id: data?.user_id || userId,
        role,
        is_active: true,
      },
      permissions: Array.isArray(data?.permissions) ? data.permissions : [],
      sessionId,
    });
  }

  async function getTeamAccess() {
    const current = await getSession();
    if (!current.ok || !current.user) {
      return authResult(false, { message: current.message || 'No hay una sesión autenticada.' });
    }
    const customerSession = current.user.is_anonymous === true
      || current.user.user_metadata?.taba_actor === 'customer';
    if (customerSession) {
      return authResult(false, {
        session: current.session,
        user: current.user,
        customerSession: true,
        message: '',
      });
    }
    const membership = await getMembership(current.user.id);
    if (!membership.ok) {
      // Mismo criterio que al entrar, y por el mismo motivo: al volver a abrir
      // el Panel, quien está esperando aprobación tiene que ver su espera y no
      // un error. Es lo que hace que cerrar y reabrir conserve el estado.
      const access = await readTeamAccessState();
      if (access.state === TEAM_ACCESS_STATE.PENDING
        || access.state === TEAM_ACCESS_STATE.REJECTED
        || access.state === TEAM_ACCESS_STATE.NONE) {
        return authResult(false, {
          awaitingAccess: true,
          accessState: access.state,
          accessRequest: access.request,
          session: current.session,
          user: current.user,
          message: '',
        });
      }
      return membership;
    }
    return authResult(true, {
      session: current.session,
      user: current.user,
      membership: membership.membership,
      permissions: membership.permissions || [],
      sessionId: membership.sessionId || null,
    });
  }

  async function signOut() {
    // Primero se cierra la sesión remota mientras el token todavía existe. Si
    // la red falla, el cierre local debe ejecutarse de todos modos.
    try {
      await client.rpc('identity_close_own_session', { p_business_id: businessId });
    } catch (_) {
      // Intencional: el cierre local no depende del remoto.
    }
    const { error } = await client.auth.signOut({ scope: 'local' });
    if (error) return authResult(false, { message: readableAuthError(error) });
    return authResult(true);
  }

  function onAuthStateChange(callback) {
    const subscription = client.auth.onAuthStateChange((event, session) => callback({
      event,
      session: session || null,
      user: session?.user || null,
    }));
    return () => subscription?.data?.subscription?.unsubscribe?.();
  }

  return {
    ensureCustomerSession,
    getMembership,
    getSession,
    getTeamAccess,
    onAuthStateChange,
    readTeamAccessState,
    registerSession,
    requestTeamAccess,
    signInTeam,
    signUpTeam,
    signOut,
  };
}

function normalizeAccessRequest(payload) {
  if (!payload || typeof payload !== 'object') return null;
  const id = String(payload.request_id || '');
  if (!id) return null;
  return {
    id,
    status: String(payload.status || ''),
    requestedAccess: String(payload.requested_access || ''),
    fullName: String(payload.full_name || ''),
    contactPhone: String(payload.contact_phone || ''),
    requestedAt: payload.requested_at || null,
    decidedAt: payload.decided_at || null,
    grantedRole: payload.granted_role || null,
    retryAt: payload.retry_at || null,
  };
}

// Los códigos del backend son para el backend. Lo que ve una persona son
// frases, y ninguna de ellas menciona políticas, JWT ni tablas.
function accessRequestMessage(payload) {
  switch (payload?.code) {
    case 'not_authenticated':
      return 'Entrá con tu cuenta antes de pedir acceso.';
    case 'invalid_name':
      return 'Escribí tu nombre y apellido.';
    case 'invalid_phone':
      return 'Revisá el teléfono.';
    case 'phone_required':
      return 'Escribí un teléfono para que el comercio pueda contactarte.';
    case 'not_available':
      return 'Este comercio no está recibiendo solicitudes.';
    case 'retry_later':
      return payload?.retry_at
        ? `Tu solicitud anterior fue rechazada. Podés volver a pedirlo a partir del ${formatDay(payload.retry_at)}.`
        : 'Tu solicitud anterior fue rechazada. Probá de nuevo más adelante.';
    case 'contact_business':
      return 'Tu solicitud figura aprobada. Hablá con el comercio para terminar el alta.';
    default:
      return 'No pudimos enviar la solicitud. Probá de nuevo.';
  }
}

function formatDay(value) {
  try {
    return new Date(value).toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit' });
  } catch (_) {
    return '';
  }
}

function authResult(ok, payload = {}) {
  return { ok: Boolean(ok), ...payload };
}

function readableAuthError(error, fallback = 'No pudimos validar la sesión.') {
  const status = Number(error?.status || 0);
  if (status === 429) return 'Demasiados intentos. Esperá un momento y probá de nuevo.';
  if (status === 400 || status === 401) return fallback;
  return fallback;
}
