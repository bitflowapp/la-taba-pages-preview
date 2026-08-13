const TEAM_ROLES = new Set(['owner', 'admin', 'staff', 'rider']);
const PANEL_CLIENT = 'panel_web';

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

    const membership = await getMembership(data.user.id);
    if (!membership.ok || (expectedRole && membership.membership?.role !== expectedRole)) {
      await client.auth.signOut({ scope: 'local' });
      return authResult(false, {
        message: membership.ok
          ? 'Tu cuenta no tiene el rol requerido para esta vista.'
          : membership.message,
      });
    }

    // Registra esta sesión del navegador para que pueda revocarse de forma
    // puntual sin cerrar las del resto del equipo.
    const registration = await registerSession();
    if (!registration.ok || !registration.sessionId) {
      await client.auth.signOut({ scope: 'local' });
      return authResult(false, { message: registration.message || 'No pudimos registrar esta sesión.' });
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
    if (!TEAM_ROLES.has(role)) {
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
      sessionId: data?.session_id || null,
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
    if (!membership.ok) return membership;
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
    registerSession,
    signInTeam,
    signOut,
  };
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
