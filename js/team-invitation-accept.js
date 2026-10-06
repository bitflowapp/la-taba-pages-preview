// /cuenta/#invitacion=<token>: aceptar una invitación al equipo del comercio.
// ---------------------------------------------------------------------------
// Llega por el link que el dueño manda desde Panel › Equipo. Dos caminos:
//
//   · cuenta nueva  → la persona escribe SU correo (tiene que ser el invitado),
//                     la función `team-invitation` crea la cuenta confirmada y
//                     devuelve un enlace de contraseña que esta misma página
//                     canjea; la persona elige su contraseña (política de Auth)
//                     y recién después se acepta la invitación con SU sesión;
//   · cuenta existente → entra con su contraseña y se acepta con esa sesión.
//
// El rol lo otorga `identity_accept_invitation` en la base, como siempre. La
// sesión vive en memoria (`persistSession: false`) y se cierra al terminar.
// El token se saca de la barra de direcciones apenas se lee.
import { readableAuthError, TEAM_PASSWORD_MIN_LENGTH } from './services/supabase-auth.js';
import { passwordAidsMarkup, passwordFieldAttributes } from './password-aids.js';

export const INVITE_STEP = Object.freeze({
  WORKING: 'working',
  INVALID: 'invalid',
  NEW_ACCOUNT: 'new_account',
  SET_PASSWORD: 'set_password',
  EXISTING_ACCOUNT: 'existing_account',
  ACCEPTED: 'accepted',
  UNAVAILABLE: 'unavailable',
});

const ROLE_LABEL = Object.freeze({ owner: 'dueño', admin: 'encargado', staff: 'equipo', rider: 'repartidor' });
const TOKEN = /^[0-9a-f]{64}$/;

/** El token del fragmento, o '' si no hay una invitación con forma válida. */
export function invitationTokenFromHash(hash = '') {
  const params = new URLSearchParams(String(hash || '').replace(/^#/, ''));
  const token = String(params.get('invitacion') || '').trim().toLowerCase();
  return TOKEN.test(token) ? token : '';
}

const FAILURE_COPY = Object.freeze({
  invalid_token: 'Esta invitación ya no sirve: venció, la revocaron o el link está incompleto. Pedile una nueva al comercio.',
  already_accepted: 'Esta invitación ya se aceptó. Entrá con tu correo y tu contraseña.',
  account_disabled: 'Tu cuenta está suspendida en este comercio. Hablá con el dueño.',
  email_mismatch: 'Ese no es el correo al que llegó la invitación. Escribí exactamente ese correo.',
  account_exists: 'Ya tenés una cuenta con ese correo: entrá con tu contraseña para aceptar.',
  SERVICE_UNAVAILABLE: 'No pudimos revisar la invitación. Probá de nuevo en un momento.',
});

export function inviteFailureMessage(code) {
  return FAILURE_COPY[code] || 'No pudimos revisar la invitación. Probá de nuevo en un momento.';
}

/** El servicio de la página, sin DOM. */
export function createInvitationService({ client }) {
  if (!client?.auth || typeof client.rpc !== 'function') throw new Error('La invitación requiere un cliente Supabase.');

  async function call(body) {
    try {
      const { data, error } = await client.functions.invoke('team-invitation', { body });
      if (error) {
        let code = 'SERVICE_UNAVAILABLE';
        try { code = (await error.context?.json?.())?.code || code; } catch (_) { /* sin cuerpo */ }
        return { ok: false, code };
      }
      return data && typeof data === 'object' ? data : { ok: false, code: 'SERVICE_UNAVAILABLE' };
    } catch (_) {
      return { ok: false, code: 'SERVICE_UNAVAILABLE' };
    }
  }

  return {
    inspect: (token) => call({ action: 'inspect', token }),
    async activate(token, email) {
      const activated = await call({ action: 'activate', token, email });
      if (!activated.ok) return activated;
      try {
        const { data, error } = await client.auth.verifyOtp({ token_hash: activated.token_hash, type: 'recovery' });
        if (error || !data?.session) return { ok: false, code: 'SERVICE_UNAVAILABLE' };
      } catch (_) {
        return { ok: false, code: 'SERVICE_UNAVAILABLE' };
      }
      return { ok: true };
    },
    async setPassword(password) {
      const value = String(password || '');
      if (value.length < TEAM_PASSWORD_MIN_LENGTH) {
        return { ok: false, message: `La contraseña necesita al menos ${TEAM_PASSWORD_MIN_LENGTH} caracteres.` };
      }
      try {
        const { error } = await client.auth.updateUser({ password: value });
        if (error) return { ok: false, message: readableAuthError(error, 'No pudimos guardar la contraseña.') };
      } catch (_) {
        return { ok: false, message: 'No pudimos guardar la contraseña. Probá de nuevo.' };
      }
      return { ok: true };
    },
    async signIn(email, password) {
      try {
        const { data, error } = await client.auth.signInWithPassword({ email: String(email || '').trim(), password: String(password || '') });
        if (error || !data?.session) return { ok: false, message: 'El correo o la contraseña no coinciden.' };
      } catch (_) {
        return { ok: false, message: 'No pudimos iniciar sesión. Probá de nuevo.' };
      }
      return { ok: true };
    },
    async accept(token) {
      try {
        const { data, error } = await client.rpc('identity_accept_invitation', { p_token: token });
        if (error || !data?.ok) return { ok: false, code: data?.code || 'invalid_token' };
        return { ok: true, role: data.role };
      } catch (_) {
        return { ok: false, code: 'SERVICE_UNAVAILABLE' };
      }
    },
    async close() {
      try { await client.auth.signOut({ scope: 'local' }); } catch (_) { /* nada que cerrar */ }
    },
  };
}

export function createInvitationController({ service, token, riderAppUrl = '', panelUrl = '../#negocio' }) {
  let state = { step: INVITE_STEP.WORKING, info: null, message: '', busy: false, role: '' };
  const listeners = new Set();
  const publish = () => {
    const markup = renderInvitation({ ...state, riderAppUrl, panelUrl });
    for (const listener of listeners) listener({ ...state, markup });
  };
  const set = (next) => { state = { ...state, ...next }; publish(); };

  async function start() {
    if (!service) return set({ step: INVITE_STEP.UNAVAILABLE });
    if (!token) return set({ step: INVITE_STEP.INVALID, message: inviteFailureMessage('invalid_token') });
    set({ step: INVITE_STEP.WORKING, busy: true });
    const info = await service.inspect(token);
    if (!info.ok) return set({ step: INVITE_STEP.INVALID, busy: false, message: inviteFailureMessage(info.code) });
    return set({ step: info.account === 'existing' ? INVITE_STEP.EXISTING_ACCOUNT : INVITE_STEP.NEW_ACCOUNT, info, busy: false, message: '' });
  }

  async function finish() {
    const accepted = await service.accept(token);
    await service.close();
    if (!accepted.ok) return set({ step: INVITE_STEP.INVALID, busy: false, message: inviteFailureMessage(accepted.code) });
    return set({ step: INVITE_STEP.ACCEPTED, busy: false, role: accepted.role || state.info?.role || '', message: '' });
  }

  async function submitEmail(email) {
    set({ busy: true, message: '' });
    const activated = await service.activate(token, email);
    if (!activated.ok) {
      if (activated.code === 'account_exists') {
        return set({ step: INVITE_STEP.EXISTING_ACCOUNT, busy: false, message: inviteFailureMessage('account_exists') });
      }
      const terminal = ['invalid_token', 'already_accepted', 'account_disabled'].includes(activated.code);
      return set({ step: terminal ? INVITE_STEP.INVALID : state.step, busy: false, message: inviteFailureMessage(activated.code) });
    }
    return set({ step: INVITE_STEP.SET_PASSWORD, busy: false, message: '' });
  }

  async function submitPassword(password) {
    set({ busy: true, message: '' });
    const saved = await service.setPassword(password);
    if (!saved.ok) return set({ busy: false, message: saved.message });
    return finish();
  }

  async function submitSignIn(email, password) {
    set({ busy: true, message: '' });
    const signed = await service.signIn(email, password);
    if (!signed.ok) return set({ busy: false, message: signed.message });
    return finish();
  }

  return {
    getState: () => ({ ...state }),
    onChange(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    start,
    submitEmail,
    submitPassword,
    submitSignIn,
  };
}

export function renderInvitation({ step, info = null, message = '', busy = false, role = '', riderAppUrl = '', panelUrl = '../#negocio' }) {
  const note = message ? `<p class="form-hint account-action-message" role="status">${escapeText(message)}</p>` : '';
  const who = ROLE_LABEL[info?.role || role] || 'parte del equipo';
  const place = escapeText(info?.business_name || 'La Taba');
  const disabled = busy ? ' disabled' : '';
  switch (step) {
    case INVITE_STEP.NEW_ACCOUNT:
      return `${head(`Te invitaron a ${place}`, `Como ${who}. Para crear tu cuenta escribí el correo al que te llegó la invitación (${escapeText(info?.email_hint || '')}).`)}
        <form class="production-auth-form" data-invite-email-form novalidate>
          <label>Tu correo<input name="email" type="email" autocomplete="username" inputmode="email" required /></label>
          ${note}
          <div class="button-row"><button class="primary-button" type="submit"${disabled}>Seguir</button></div>
        </form>`;
    case INVITE_STEP.SET_PASSWORD:
      return `${head('Elegí tu contraseña', `Al menos ${TEAM_PASSWORD_MIN_LENGTH} caracteres. No se aceptan contraseñas que ya aparecieron en filtraciones conocidas.`)}
        <form class="production-auth-form" data-invite-password-form novalidate>
          <label>Contraseña<input name="password" type="password" autocomplete="new-password" minlength="${TEAM_PASSWORD_MIN_LENGTH}" required ${passwordFieldAttributes()} /></label>
          ${passwordAidsMarkup(TEAM_PASSWORD_MIN_LENGTH)}
          ${note}
          <div class="button-row"><button class="primary-button" type="submit"${disabled}>Guardar y aceptar</button></div>
        </form>`;
    case INVITE_STEP.EXISTING_ACCOUNT:
      return `${head(`Te invitaron a ${place}`, `Como ${who}. Ya tenés una cuenta: entrá con tu correo y tu contraseña para aceptar.`)}
        <form class="production-auth-form" data-invite-signin-form novalidate>
          <label>Tu correo<input name="email" type="email" autocomplete="username" inputmode="email" required /></label>
          <label>Contraseña<input name="password" type="password" autocomplete="current-password" required /></label>
          ${note}
          <div class="button-row"><button class="primary-button" type="submit"${disabled}>Entrar y aceptar</button></div>
        </form>`;
    case INVITE_STEP.ACCEPTED: {
      const rider = (role || info?.role) === 'rider';
      return `${head('¡Listo! Ya sos parte del equipo', `Entraste a ${place} como ${who}.`)}
        ${rider
          ? `<p>Instalá la app de repartidor de La Taba en tu teléfono y entrá con este correo y la contraseña que elegiste. Cuando estés en la calle, marcá «Disponible».</p>
             ${riderAppUrl ? `<div class="button-row"><a class="primary-button" href="${escapeText(riderAppUrl)}" rel="noopener noreferrer">Descargar la app de repartidor</a></div>` : '<p class="form-hint">El comercio te pasa el link para instalar la app.</p>'}`
          : `<div class="button-row"><a class="primary-button" href="${escapeText(panelUrl)}">Entrar al Panel</a></div>`}`;
    }
    case INVITE_STEP.INVALID:
      return `${head('No pudimos usar esta invitación', message || inviteFailureMessage('invalid_token'))}
        <div class="button-row"><a class="secondary-button" href="${escapeText(panelUrl)}">Ir al Panel</a></div>`;
    case INVITE_STEP.UNAVAILABLE:
      return head('No podemos completar esto acá', 'Este despliegue no tiene la configuración necesaria. Escribile al comercio.');
    default:
      return head('Un segundo', 'Estamos revisando tu invitación.');
  }
}

function head(title, lead) {
  return `<div class="panel-access-head"><h1>${escapeText(title)}</h1><p>${escapeText(lead)}</p></div>`;
}

function escapeText(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
