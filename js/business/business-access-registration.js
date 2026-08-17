import { escapeHtml } from '../ui.js';
import { TEAM_PASSWORD_MIN_LENGTH } from '../services/supabase-auth.js';

// Alta autogestionada del Panel: la máquina de estados y su pantalla.
//
// Se escribe aparte, y como funciones puras, por una razón práctica: la parte
// difícil de esto no es el HTML sino DECIDIR qué pantalla corresponde. Esa
// decisión depende de lo que contestó el backend, y tiene que poder probarse
// sin navegador, sin red y sin sesión.
//
// La regla que ordena todo el módulo: crear la cuenta y pedir acceso son dos
// actos separados, y ninguno de los dos otorga nada. Entre "creé mi cuenta" y
// "entro al Panel" hay siempre una decisión de otra persona.

export const ACCESS_STEP = Object.freeze({
  SIGN_IN: 'sign_in',
  SIGN_UP: 'sign_up',
  REQUEST: 'request',
  PENDING: 'pending',
  REJECTED: 'rejected',
  RECOVER: 'recover',
});

const STEPS = new Set(Object.values(ACCESS_STEP));

export function normalizeAccessStep(step) {
  return STEPS.has(step) ? step : ACCESS_STEP.SIGN_IN;
}

/**
 * Qué pantalla corresponde según lo que contestó el backend.
 *
 * `accessState` es el vocabulario de services/supabase-auth.js:
 *   member    → ya entró; esta pantalla no se muestra.
 *   pending   → pidió y espera.
 *   rejected  → pidió y le dijeron que no.
 *   none      → tiene cuenta y todavía no pidió nada.
 *   unknown   → no se pudo saber; se trata como no autenticado y se pide
 *               entrar de nuevo, que es lo único seguro.
 */
export function stepForAccessState(accessState) {
  switch (accessState) {
    case 'pending': return ACCESS_STEP.PENDING;
    case 'rejected': return ACCESS_STEP.REJECTED;
    case 'none': return ACCESS_STEP.REQUEST;
    default: return ACCESS_STEP.SIGN_IN;
  }
}

/** Si un rechazo ya cumplió su espera, se puede volver a pedir. */
export function canRequestAgain(request, now = new Date()) {
  if (!request || request.status !== 'rejected') return false;
  if (!request.retryAt) return true;
  const retry = new Date(request.retryAt);
  if (Number.isNaN(retry.getTime())) return true;
  return retry.getTime() <= new Date(now).getTime();
}

export function accessRegistrationCopy(step, request = null) {
  switch (step) {
    case ACCESS_STEP.RECOVER:
      return {
        title: 'Recuperá tu contraseña',
        lead: 'Te mandamos un enlace al correo de tu cuenta. El enlace sirve una '
          + 'sola vez y vence en una hora.',
      };
    case ACCESS_STEP.SIGN_UP:
      return {
        title: 'Creá tu cuenta',
        lead: 'Con la cuenta creada vas a poder pedirle acceso al comercio. '
          + 'Crear la cuenta todavía no te da acceso al Panel.',
      };
    case ACCESS_STEP.REQUEST:
      return {
        title: 'Pedí acceso al comercio',
        lead: 'Decinos quién sos. El dueño o el encargado revisan la solicitud y deciden.',
      };
    case ACCESS_STEP.PENDING:
      return {
        title: 'Solicitud enviada',
        lead: request?.requestedAccess === 'rider'
          ? 'Tu solicitud para repartir está esperando aprobación.'
          : 'Tu solicitud está esperando la aprobación del comercio.',
      };
    case ACCESS_STEP.REJECTED:
      return {
        title: 'Tu solicitud no fue aprobada',
        lead: canRequestAgain(request)
          ? 'Podés volver a pedirlo si creés que hubo un error.'
          : 'Si creés que hubo un error, hablá con el comercio.',
      };
    default:
      return {
        title: 'Acceso seguro requerido',
        lead: 'Ingresá con una cuenta owner o empleado vinculada a este comercio.',
      };
  }
}

/**
 * El estado de la pantalla de alta. `hidesSignIn` existe para que el contenedor
 * no tenga que saber cuál de los pasos convive con el formulario de ingreso: lo
 * decide acá, junto al resto de la máquina.
 */
export function accessRegistrationView({
  step = ACCESS_STEP.SIGN_IN,
  message = '',
  busy = false,
  request = null,
  email = '',
} = {}) {
  const current = normalizeAccessStep(step);
  return Object.freeze({
    step: current,
    hidesSignIn: current !== ACCESS_STEP.SIGN_IN,
    copy: accessRegistrationCopy(current, request),
    markup: renderAccessRegistration({ step: current, message, busy, request, email }),
  });
}

export function renderAccessRegistration({
  step = ACCESS_STEP.SIGN_IN,
  message = '',
  busy = false,
  request = null,
  email = '',
} = {}) {
  const current = normalizeAccessStep(step);
  const note = message
    ? `<p class="form-hint panel-access-message" role="status">${escapeHtml(message)}</p>`
    : '';

  if (current === ACCESS_STEP.SIGN_IN) {
    // El ingreso sigue viviendo en su formulario de siempre. Acá abajo van sólo
    // las dos puertas que ese formulario no tiene: la de quien todavía no tiene
    // cuenta y la de quien la tiene y no se acuerda de la contraseña.
    return `<div class="panel-access" data-panel-access-step="sign_in">
      ${note}
      <p class="panel-access-switch">¿Todavía no tenés cuenta?
        <button class="link-button" type="button" data-panel-access-goto="sign_up">Creá tu cuenta</button>
      </p>
      <p class="panel-access-switch">
        <button class="link-button" type="button" data-panel-access-goto="recover">Olvidé mi contraseña</button>
      </p>
    </div>`;
  }

  const { title, lead } = accessRegistrationCopy(current, request);
  const head = `<div class="panel-access-head">
      <h2>${escapeHtml(title)}</h2>
      <p>${escapeHtml(lead)}</p>
    </div>`;

  if (current === ACCESS_STEP.SIGN_UP) {
    return `<div class="panel-access" data-panel-access-step="sign_up">
      ${head}
      <form class="production-auth-form" data-panel-signup-form novalidate>
        <label>
          Email
          <input name="email" type="email" autocomplete="username" inputmode="email"
            value="${escapeHtml(email)}" required />
        </label>
        <label>
          Contraseña
          <input name="password" type="password" autocomplete="new-password"
            minlength="${TEAM_PASSWORD_MIN_LENGTH}" required />
        </label>
        <p class="form-hint">Usá al menos ${TEAM_PASSWORD_MIN_LENGTH} caracteres. No se aceptan
          contraseñas que ya aparecieron en filtraciones conocidas.</p>
        ${note}
        <div class="button-row">
          <button class="primary-button" type="submit" ${busy ? 'disabled' : ''}>Crear cuenta</button>
          <button class="secondary-button" type="button" data-panel-access-goto="sign_in">Ya tengo cuenta</button>
        </div>
      </form>
    </div>`;
  }

  if (current === ACCESS_STEP.RECOVER) {
    return `<div class="panel-access" data-panel-access-step="recover">
      ${head}
      <form class="production-auth-form" data-panel-recovery-form novalidate>
        <label>
          Email de tu cuenta
          <input name="email" type="email" autocomplete="username" inputmode="email"
            value="${escapeHtml(email)}" required />
        </label>
        ${note}
        <div class="button-row">
          <button class="primary-button" type="submit" ${busy ? 'disabled' : ''}>Mandarme el enlace</button>
          <button class="secondary-button" type="button" data-panel-access-goto="sign_in">Volver</button>
        </div>
      </form>
    </div>`;
  }

  if (current === ACCESS_STEP.REQUEST) {
    return `<div class="panel-access" data-panel-access-step="request">
      ${head}
      <form class="production-auth-form" data-panel-request-form novalidate>
        <label>
          Nombre y apellido
          <input name="fullName" type="text" autocomplete="name" maxlength="120"
            value="${escapeHtml(request?.fullName || '')}" required />
        </label>
        <label>
          Teléfono
          <input name="phone" type="tel" autocomplete="tel" inputmode="tel" maxlength="30"
            value="${escapeHtml(request?.contactPhone || '')}" />
        </label>
        ${note}
        <div class="button-row">
          <button class="primary-button" type="submit" ${busy ? 'disabled' : ''}>Pedir acceso</button>
          <button class="secondary-button" type="button" data-panel-access-signout>Cerrar sesión</button>
        </div>
      </form>
    </div>`;
  }

  // Pendiente y rechazada comparten forma: un estado, y dos salidas honestas.
  // No hay reintento automático: refrescar lo pide la persona.
  const detail = current === ACCESS_STEP.PENDING
    ? pendingDetail(request)
    : rejectedDetail(request);
  const retry = current === ACCESS_STEP.REJECTED && canRequestAgain(request)
    ? '<button class="secondary-button" type="button" data-panel-access-goto="request">Volver a pedir</button>'
    : '';

  return `<div class="panel-access panel-access-status" data-panel-access-step="${escapeHtml(current)}">
    ${head}
    ${detail}
    ${note}
    <div class="button-row">
      <button class="primary-button" type="button" data-panel-access-refresh ${busy ? 'disabled' : ''}>
        Actualizar estado
      </button>
      ${retry}
      <button class="secondary-button" type="button" data-panel-access-signout>Cerrar sesión</button>
    </div>
  </div>`;
}

function pendingDetail(request) {
  const when = formatMoment(request?.requestedAt);
  return `<dl class="panel-access-detail">
    <div><dt>Estado</dt><dd>Esperando aprobación</dd></div>
    ${when ? `<div><dt>Enviada</dt><dd>${escapeHtml(when)}</dd></div>` : ''}
  </dl>`;
}

function rejectedDetail(request) {
  const when = formatMoment(request?.decidedAt);
  const retry = request?.retryAt && !canRequestAgain(request) ? formatMoment(request.retryAt) : '';
  return `<dl class="panel-access-detail">
    <div><dt>Estado</dt><dd>No aprobada</dd></div>
    ${when ? `<div><dt>Revisada</dt><dd>${escapeHtml(when)}</dd></div>` : ''}
    ${retry ? `<div><dt>Podés volver a pedirlo</dt><dd>${escapeHtml(retry)}</dd></div>` : ''}
  </dl>`;
}

function formatMoment(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleString('es-AR', {
    day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit',
  });
}
