// La cáscara con DOM de /cuenta/. Todo lo que decide vive en account-action.js
// (enlaces de correo) y en team-invitation-accept.js (invitaciones al equipo);
// acá sólo se arma el cliente, se pinta y se escuchan los formularios.
//
// El cliente de esta página es PROPIO y se crea con `persistSession: false`: la
// sesión que abre un enlace de correo no se guarda en el navegador, no la ve el
// resto de la app y muere con la pestaña.

import { createAccountActionController, createAccountActionService } from './account-action.js';
import {
  createInvitationController, createInvitationService, invitationTokenFromHash,
} from './team-invitation-accept.js';
import { createConfiguredSupabaseClient } from './services/supabase-client.js';
import { resolveRuntimeConfig } from './core/runtime-config.js';
import { passwordCountCopy } from './password-aids.js';

const PANEL_URL = '../#negocio';
const INVITATION_FOOT = 'La invitación sirve una sola vez y sólo para el correo al que se mandó. '
  + 'Si venció o se perdió, pedile al comercio una nueva.';

export function mountAccountAction({
  doc = typeof document === 'undefined' ? null : document,
  runtimeConfig = resolveRuntimeConfig(),
  createClient = createConfiguredSupabaseClient,
  search = typeof window === 'undefined' ? '' : window.location.search,
  hash = typeof window === 'undefined' ? '' : window.location.hash,
  history = typeof window === 'undefined' ? null : window.history,
  pathname = typeof window === 'undefined' ? '/cuenta/' : window.location.pathname,
} = {}) {
  if (!doc) return null;
  const host = doc.querySelector('[data-account-action]');
  if (!host) return null;

  if (/(?:^#|&)invitacion=/.test(String(hash || ''))) {
    return mountInvitation({ doc, host, runtimeConfig, createClient, hash, history, pathname });
  }

  let service = null;
  try {
    const client = createClient(runtimeConfig, { persistSession: false, storage: null });
    service = createAccountActionService({ client });
  } catch (_) {
    // Sin configuración productiva no hay nada que canjear. La pantalla lo dice
    // en vez de quedarse cargando para siempre.
    service = null;
  }

  const controller = createAccountActionController({ service, panelUrl: PANEL_URL });
  controller.onChange(({ markup }) => { paintForm(host, markup); });
  listenPasswordAids(doc, host);

  doc.addEventListener('submit', (event) => {
    const form = event.target;
    if (!form || typeof form.matches !== 'function') return;
    if (form.matches('[data-account-password-form]')) {
      event.preventDefault();
      controller.submitPassword(String(form.elements?.password?.value || ''));
      return;
    }
    if (form.matches('[data-account-request-form]')) {
      event.preventDefault();
      controller.submitRequest(String(form.elements?.email?.value || '').trim());
    }
  });

  controller.start(search);
  return controller;
}

function mountInvitation({ doc, host, runtimeConfig, createClient, hash, history, pathname }) {
  const token = invitationTokenFromHash(hash);
  // El token sale de la barra de direcciones apenas se lee: no queda en el
  // historial ni en una captura de pantalla.
  try { history?.replaceState?.(null, '', pathname); } catch (_) { /* sin historial, sigue igual */ }

  const foot = doc.querySelector('.payment-return-foot');
  if (foot) foot.textContent = INVITATION_FOOT;

  let service = null;
  try {
    const client = createClient(runtimeConfig, { persistSession: false, storage: null });
    service = createInvitationService({ client });
  } catch (_) {
    service = null;
  }
  const controller = createInvitationController({ service, token, panelUrl: PANEL_URL });
  controller.onChange(({ markup }) => { paintForm(host, markup); });
  listenPasswordAids(doc, host);

  doc.addEventListener('submit', (event) => {
    const form = event.target;
    if (!form || typeof form.matches !== 'function') return;
    if (form.matches('[data-invite-email-form]')) {
      event.preventDefault();
      controller.submitEmail(String(form.elements?.email?.value || '').trim());
    } else if (form.matches('[data-invite-password-form]')) {
      event.preventDefault();
      controller.submitPassword(String(form.elements?.password?.value || ''));
    } else if (form.matches('[data-invite-signin-form]')) {
      event.preventDefault();
      controller.submitSignIn(String(form.elements?.email?.value || '').trim(), String(form.elements?.password?.value || ''));
    }
  });

  controller.start();
  return controller;
}

/*
 * Cada cambio de estado vuelve a escribir el formulario entero —«guardando»,
 * el aviso del error, el botón habilitado otra vez—. Escribirlo de cero tiraba
 * lo que la persona había tecleado: un intento fallido devolvía el campo vacío
 * y había que adivinar de nuevo. Lo escrito sobrevive al repintado si el campo
 * sigue estando; si el paso cambió y el campo ya no existe, no se arrastra.
 */
export function paintForm(host, markup) {
  const kept = new Map();
  for (const field of host.querySelectorAll?.('input[name]') || []) kept.set(field.name, field.value);
  const revealed = host.querySelector?.('[data-password-reveal]')?.getAttribute?.('aria-pressed') === 'true';
  host.innerHTML = markup;
  for (const field of host.querySelectorAll?.('input[name]') || []) {
    if (kept.get(field.name)) field.value = kept.get(field.name);
  }
  if (revealed) host.querySelector?.('[data-password-reveal]')?.setAttribute?.('aria-pressed', 'true');
  syncPasswordAids(host);
}

export function syncPasswordAids(host) {
  const field = host.querySelector?.('[data-password-field]');
  if (!field) return;
  const reveal = host.querySelector('[data-password-reveal]');
  if (reveal) {
    const shown = reveal.getAttribute('aria-pressed') === 'true';
    field.type = shown ? 'text' : 'password';
    reveal.textContent = shown ? 'Ocultar' : 'Mostrar';
  }
  const count = host.querySelector('[data-password-count]');
  if (!count) return;
  const min = Number(count.dataset?.passwordMin);
  count.textContent = passwordCountCopy(String(field.value || '').length, min > 0 ? min : undefined);
}

function listenPasswordAids(doc, host) {
  doc.addEventListener('input', (event) => {
    if (event.target?.matches?.('[data-password-field]')) syncPasswordAids(host);
  });
  doc.addEventListener('click', (event) => {
    const reveal = event.target?.closest?.('[data-password-reveal]');
    if (!reveal) return;
    reveal.setAttribute('aria-pressed', reveal.getAttribute('aria-pressed') === 'true' ? 'false' : 'true');
    syncPasswordAids(host);
    host.querySelector('[data-password-field]')?.focus?.();
  });
}

if (typeof document !== 'undefined' && typeof window !== 'undefined') {
  mountAccountAction();
}
