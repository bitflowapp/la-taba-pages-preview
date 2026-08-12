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

    // Alta de la sesión de este navegador. Es lo que le permite a quien manda
    // ver desde dónde está abierto el Panel y cerrar una sesión puntual sin
    // echar a todo el equipo.
    await registerSession();

    return authResult(true, {
      session: data.session || null,
      user: data.user,
      membership: membership.membership,
    });
  }

  async function registerSession() {
    const { data, error } = await client.rpc('identity_register_session', {
      p_business_id: businessId,
      p_client: PANEL_CLIENT,
      p_device_label: deviceLabel || null,
      p_device_key_hash: null,
      p_app_version: appVersion || null,
    });
    if (error || data?.ok !== true) {
      return authResult(false, { message: 'No pudimos registrar esta sesión.' });
    }
    return authResult(true, { sessionId: data.session_id || null, role: data.role || null });
  }

  /**
   * La autoridad del rol es la compuerta de identidad del backend, no una
   * lectura de la tabla de membresías.
   *
   * Leer `business_members` decía si la fila existía y estaba activa, y nada
   * más: una sesión revocada desde el Panel seguía pasando esa comprobación
   * hasta que el token venciera, y una cuenta dada de baja también, porque la
   * baja no borra la fila. La RPC aplica las cuatro reglas a la vez —membresía
   * activa, persona habilitada, sesión no revocada, token posterior al corte—
   * y devuelve además los permisos, para que la vista no los adivine.
   */
  async function getMembership(userId) {
    if (!userId) return authResult(false, { message: 'No hay una sesión autenticada.' });

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
    // Primero se cierra en el servidor, mientras el token todavía existe: eso
    // borra la sesión del emisor y mata el refresh token. Sin esto, cerrar
    // sesión sólo vaciaba el almacenamiento del navegador y la cadena de
    // renovación seguía viva del otro lado.
    //
    // Si el cierre remoto no llega —sin red, RPC caída— se limpia igual: nunca
    // se deja a alguien adentro porque falló una llamada.
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
