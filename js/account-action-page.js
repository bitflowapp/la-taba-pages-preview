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
  controller.onChange(({ markup }) => { host.innerHTML = markup; });

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
  controller.onChange(({ markup }) => { host.innerHTML = markup; });

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

if (typeof document !== 'undefined' && typeof window !== 'undefined') {
  mountAccountAction();
}
