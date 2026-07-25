const TEAM_ROLES = new Set(['owner', 'admin', 'staff', 'rider']);

export function createSupabaseAuthService({ client, businessId }) {
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

    return authResult(true, {
      session: data.session || null,
      user: data.user,
      membership: membership.membership,
    });
  }

  async function getMembership(userId) {
    if (!userId) return authResult(false, { message: 'No hay una sesión autenticada.' });

    const { data, error } = await client
      .from('business_members')
      .select('business_id,user_id,role,is_active')
      .eq('business_id', businessId)
      .eq('user_id', userId)
      .eq('is_active', true)
      .maybeSingle();

    if (error) {
      return authResult(false, {
        message: 'No pudimos verificar el acceso al comercio.',
      });
    }
    if (!data || !TEAM_ROLES.has(data.role)) {
      return authResult(false, {
        message: 'La cuenta no tiene una membresía activa en este comercio.',
      });
    }

    return authResult(true, { membership: data });
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
    });
  }

  async function signOut() {
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
