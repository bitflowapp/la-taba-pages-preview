// La página que cierra los enlaces que TABA manda por correo.
//
// ## Por qué existe una página aparte
//
// El cliente Supabase de esta app se crea con `detectSessionInUrl: false` a
// propósito: ninguna pantalla acepta una sesión que venga escrita en la URL. Esa
// decisión es la que hace que un enlace preparado no pueda dejar una sesión
// puesta en el navegador de alguien, y no se negocia.
//
// Pero confirmar un correo y cambiar una contraseña olvidada SON, por
// definición, actos que empiezan en un enlace. Se resuelven acá, en una página
// que:
//
//   · no comparte el cliente ni el almacenamiento con el resto de la app
//     (`persistSession: false`): la sesión de recuperación vive en memoria y
//     muere con la pestaña;
//   · no lee ningún token del fragmento (`#access_token=…`). Lee `token_hash`
//     de la query y lo canjea con `verifyOtp`, que es una llamada POST. La
//     plantilla del correo apunta directo al `site_url` con ese hash, así que en
//     ningún momento hay un `redirect_to` que la allow-list tenga que permitir
//     ni que alguien pueda torcer;
//   · después de cambiar la contraseña CIERRA la sesión. Entrar es un acto
//     aparte, con la credencial nueva.
//
// La máquina de estados es pura y se prueba sin navegador. El DOM entra sólo por
// `mountAccountAction`.

import { RECOVERY_SENT_COPY, readableAuthError, TEAM_PASSWORD_MIN_LENGTH } from './services/supabase-auth.js';

export const ACCOUNT_STEP = Object.freeze({
  WORKING: 'working',
  SET_PASSWORD: 'set_password',
  CONFIRMED: 'confirmed',
  DONE: 'done',
  REQUEST: 'request',
  EXPIRED: 'expired',
  UNAVAILABLE: 'unavailable',
});

/**
 * Los tipos de enlace que esta página sabe cerrar, y con qué palabras se los
 * nombra en pantalla. Un tipo que no esté acá no se procesa: se ofrece pedir el
 * enlace de nuevo, que es lo único seguro que se puede hacer con un enlace que
 * no se entiende.
 */
export const ACCOUNT_ACTION_TYPES = Object.freeze({
  recovery: { verify: 'recovery', needsPassword: true },
  signup: { verify: 'signup', needsPassword: false },
  email: { verify: 'email', needsPassword: false },
  email_change: { verify: 'email_change', needsPassword: false },
  invite: { verify: 'invite', needsPassword: true },
  magiclink: { verify: 'magiclink', needsPassword: false },
});

/**
 * Qué hay que hacer con lo que vino en la URL. No toca la red: decide.
 *
 * Se acepta `token_hash` y también `token`, porque las plantillas de Supabase
 * usan uno u otro según cómo se las escriba, y una plantilla vieja que quede
 * dando vueltas en una casilla tiene que seguir funcionando.
 */
export function planFromSearch(search = '') {
  const params = new URLSearchParams(String(search || '').replace(/^\?/, ''));
  const tokenHash = String(params.get('token_hash') || params.get('token') || '').trim();
  const type = String(params.get('type') || '').trim().toLowerCase();
  const error = String(params.get('error_description') || params.get('error') || '').trim();

  if (error) return { action: 'expired', type, reason: 'link_error' };
  if (!tokenHash) return { action: 'request', type: '', reason: 'no_token' };
  const known = ACCOUNT_ACTION_TYPES[type];
  if (!known) return { action: 'expired', type, reason: 'unknown_type' };
  return { action: 'verify', type, verifyType: known.verify, needsPassword: known.needsPassword, tokenHash };
}

export function accountActionCopy(step, { type = '' } = {}) {
  switch (step) {
    case ACCOUNT_STEP.WORKING:
      return { title: 'Un segundo', lead: 'Estamos revisando tu enlace.' };
    case ACCOUNT_STEP.SET_PASSWORD:
      return {
        title: 'Elegí tu contraseña nueva',
        lead: `Al menos ${TEAM_PASSWORD_MIN_LENGTH} caracteres. No se aceptan contraseñas que ya `
          + 'aparecieron en filtraciones conocidas.',
      };
    case ACCOUNT_STEP.CONFIRMED:
      return {
        title: 'Correo confirmado',
        lead: type === 'email_change'
          ? 'Ya podés entrar al Panel con tu correo nuevo.'
          : 'Tu cuenta quedó confirmada. Entrá al Panel y, si todavía no lo hiciste, '
            + 'pedile acceso al comercio.',
      };
    case ACCOUNT_STEP.DONE:
      return {
        title: 'Contraseña cambiada',
        lead: 'Entrá al Panel con la contraseña nueva. La anterior ya no sirve.',
      };
    case ACCOUNT_STEP.REQUEST:
      return {
        title: 'Recuperá tu contraseña',
        lead: 'Escribí el correo de tu cuenta y te mandamos un enlace nuevo. '
          + 'Sirve una sola vez y vence en una hora.',
      };
    case ACCOUNT_STEP.EXPIRED:
      return {
        title: 'Ese enlace ya no sirve',
        lead: 'Los enlaces se usan una sola vez y vencen en una hora. Pedí uno nuevo.',
      };
    default:
      return {
        title: 'No podemos completar esto acá',
        lead: 'Este despliegue no tiene la configuración necesaria. Escribile al comercio.',
      };
  }
}

/**
 * El servicio de la página, sin DOM. Recibe un cliente de Auth y devuelve los
 * tres actos que la página necesita.
 */
export function createAccountActionService({ client } = {}) {
  if (!client?.auth) throw new Error('La página de la cuenta requiere un cliente Supabase.');

  async function verifyLink({ tokenHash, verifyType } = {}) {
    if (!tokenHash || !verifyType) return { ok: false, expired: true };
    let response;
    try {
      response = await client.auth.verifyOtp({ token_hash: tokenHash, type: verifyType });
    } catch (_) {
      return { ok: false, expired: false, message: 'No pudimos revisar el enlace. Probá de nuevo.' };
    }
    if (response?.error || !response?.data?.session) {
      // Un enlace vencido, ya usado o falso se contestan igual. Distinguirlos
      // le diría a quien prueba enlaces cuál de sus intentos estuvo cerca.
      return { ok: false, expired: true };
    }
    return { ok: true, session: response.data.session, user: response.data.user || null };
  }

  async function setPassword({ password } = {}) {
    const value = String(password || '');
    if (value.length < TEAM_PASSWORD_MIN_LENGTH) {
      return { ok: false, message: `La contraseña necesita al menos ${TEAM_PASSWORD_MIN_LENGTH} caracteres.` };
    }
    let response;
    try {
      response = await client.auth.updateUser({ password: value });
    } catch (_) {
      return { ok: false, message: 'No pudimos guardar la contraseña. Probá de nuevo.' };
    }
    if (response?.error) {
      return { ok: false, message: readableAuthError(response.error, 'No pudimos guardar la contraseña.') };
    }
    // La sesión que abrió el enlace no sigue viva más allá del cambio: entrar es
    // un acto aparte, con la credencial nueva.
    try { await client.auth.signOut({ scope: 'local' }); } catch (_) { /* el cambio ya está hecho */ }
    return { ok: true };
  }

  async function requestLink({ email } = {}) {
    const normalized = String(email || '').trim();
    if (!normalized) return { ok: false, message: 'Escribí tu email.' };
    let response;
    try {
      response = await client.auth.resetPasswordForEmail(normalized);
    } catch (_) {
      return { ok: false, message: 'No pudimos enviar el correo. Probá de nuevo.' };
    }
    if (response?.error && Number(response.error.status || 0) === 429) {
      return { ok: false, message: 'Pediste el correo hace poco. Esperá unos minutos y probá de nuevo.' };
    }
    return { ok: true, sent: !response?.error, message: RECOVERY_SENT_COPY };
  }

  async function closeSession() {
    try { await client.auth.signOut({ scope: 'local' }); } catch (_) { /* nada que cerrar */ }
  }

  return { closeSession, requestLink, setPassword, verifyLink };
}

export function renderAccountAction({ step, type = '', message = '', busy = false, panelUrl = '../#negocio' } = {}) {
  const { title, lead } = accountActionCopy(step, { type });
  const note = message
    ? `<p class="form-hint account-action-message" role="status">${escapeText(message)}</p>`
    : '';

  if (step === ACCOUNT_STEP.SET_PASSWORD) {
    return `${head(title, lead)}
      <form class="production-auth-form" data-account-password-form novalidate>
        <label>
          Contraseña nueva
          <input name="password" type="password" autocomplete="new-password"
            minlength="${TEAM_PASSWORD_MIN_LENGTH}" required />
        </label>
        ${note}
        <div class="button-row">
          <button class="primary-button" type="submit"${busy ? ' disabled' : ''}>Guardar contraseña</button>
        </div>
      </form>`;
  }

  if (step === ACCOUNT_STEP.REQUEST || step === ACCOUNT_STEP.EXPIRED) {
    return `${head(title, lead)}
      <form class="production-auth-form" data-account-request-form novalidate>
        <label>
          Email de tu cuenta
          <input name="email" type="email" autocomplete="username" inputmode="email" required />
        </label>
        ${note}
        <div class="button-row">
          <button class="primary-button" type="submit"${busy ? ' disabled' : ''}>Mandarme el enlace</button>
          <a class="secondary-button" href="${escapeText(panelUrl)}">Ir al Panel</a>
        </div>
      </form>`;
  }

  if (step === ACCOUNT_STEP.CONFIRMED || step === ACCOUNT_STEP.DONE) {
    return `${head(title, lead)}
      ${note}
      <div class="button-row">
        <a class="primary-button" href="${escapeText(panelUrl)}">Ir al Panel</a>
      </div>`;
  }

  return `${head(title, lead)}${note}`;
}

function head(title, lead) {
  return `<div class="panel-access-head">
      <h1>${escapeText(title)}</h1>
      <p>${escapeText(lead)}</p>
    </div>`;
}

// La página no importa `ui.js` para no arrastrar la app entera a una pantalla
// que sólo tiene un formulario. Es el mismo escape, con la misma tabla.
function escapeText(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * La cáscara con DOM. Se importa sola al cargar la página; con
 * `mountAccountAction({ document, service, search })` también se puede probar
 * con un DOM de mentira.
 */
export function createAccountActionController({ service, render = renderAccountAction, panelUrl } = {}) {
  let state = { step: ACCOUNT_STEP.WORKING, type: '', message: '', busy: false };
  const listeners = new Set();

  function publish() {
    const markup = render({ ...state, panelUrl });
    for (const listener of listeners) listener({ ...state, markup });
  }

  function set(next) {
    state = { ...state, ...next };
    publish();
  }

  async function start(search) {
    const plan = planFromSearch(search);
    if (!service) {
      set({ step: ACCOUNT_STEP.UNAVAILABLE, message: '' });
      return state;
    }
    if (plan.action === 'request') {
      set({ step: ACCOUNT_STEP.REQUEST, type: '', message: '' });
      return state;
    }
    if (plan.action === 'expired') {
      set({ step: ACCOUNT_STEP.EXPIRED, type: plan.type, message: '' });
      return state;
    }

    set({ step: ACCOUNT_STEP.WORKING, type: plan.type, message: '', busy: true });
    const result = await service.verifyLink(plan);
    if (!result.ok) {
      set({
        step: result.expired ? ACCOUNT_STEP.EXPIRED : ACCOUNT_STEP.REQUEST,
        busy: false,
        message: result.expired ? '' : (result.message || ''),
      });
      return state;
    }

    if (plan.needsPassword) {
      set({ step: ACCOUNT_STEP.SET_PASSWORD, busy: false, message: '' });
      return state;
    }

    // Confirmar el correo no deja a nadie adentro: la sesión que abrió el
    // enlace se cierra acá mismo, y el Panel decide después qué puede ver esa
    // persona. Confirmar no reparte rol.
    await service.closeSession();
    set({ step: ACCOUNT_STEP.CONFIRMED, busy: false, message: '' });
    return state;
  }

  async function submitPassword(password) {
    set({ busy: true, message: '' });
    const result = await service.setPassword({ password });
    if (!result.ok) {
      set({ busy: false, message: result.message });
      return { ok: false };
    }
    set({ step: ACCOUNT_STEP.DONE, busy: false, message: '' });
    return { ok: true };
  }

  async function submitRequest(email) {
    set({ busy: true, message: '' });
    const result = await service.requestLink({ email });
    set({ busy: false, message: result.message || '' });
    return { ok: result.ok };
  }

  return {
    getState: () => ({ ...state }),
    onChange(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    start,
    submitPassword,
    submitRequest,
  };
}
