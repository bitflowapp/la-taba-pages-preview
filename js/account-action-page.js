// La cáscara con DOM de /cuenta/. Todo lo que decide vive en account-action.js;
// acá sólo se arma el cliente, se pinta y se escuchan dos formularios.
//
// El cliente de esta página es PROPIO y se crea con `persistSession: false`: la
// sesión que abre un enlace de correo no se guarda en el navegador, no la ve el
// resto de la app y muere con la pestaña.

import { createAccountActionController, createAccountActionService } from './account-action.js';
import { createConfiguredSupabaseClient } from './services/supabase-client.js';
import { resolveRuntimeConfig } from './core/runtime-config.js';

const PANEL_URL = '../#negocio';

export function mountAccountAction({
  doc = typeof document === 'undefined' ? null : document,
  runtimeConfig = resolveRuntimeConfig(),
  createClient = createConfiguredSupabaseClient,
  search = typeof window === 'undefined' ? '' : window.location.search,
} = {}) {
  if (!doc) return null;
  const host = doc.querySelector('[data-account-action]');
  if (!host) return null;

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

if (typeof document !== 'undefined' && typeof window !== 'undefined') {
  mountAccountAction();
}
