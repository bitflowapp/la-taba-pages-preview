// This is deliberately a classic script loaded before the application module.
// It owns the only UI that can recover a failed module bootstrap. Keeping it
// independent from the application import graph is what makes the fallback
// useful when a stale worker, a browser storage error, or a syntax/import
// failure prevents app.js from executing.
(() => {
  const panel = document.querySelector('[data-app-recovery]');
  if (!panel) return;

  const message = panel.querySelector('[data-app-recovery-message]');
  const retry = panel.querySelector('[data-app-recovery-retry]');
  const reset = panel.querySelector('[data-app-recovery-reset]');
  const isDemo = new URLSearchParams(window.location.search).get('demo') === '1';

  // Cuánto esperamos antes de dar el arranque por perdido. Una red mala tarda,
  // y un cartel de error que aparece a los dos segundos sobre una carga que
  // iba a terminar bien es peor que la espera. Ocho segundos es el plazo tras
  // el cual una persona ya asume que la página está rota.
  const BOOT_TIMEOUT_MS = 8000;

  // Lo que lee el cliente y lo que se guarda para diagnóstico son dos cosas
  // distintas a propósito: el código no dice nada útil a quien quiere comprar,
  // y sí a quien atiende el reporte.
  const REASONS = {
    startup: {
      code: 'TABA2-BOOT-01',
      text: 'Puede ser tu conexión. Probá de nuevo: tu pedido no se perdió.',
    },
    storage: {
      code: 'TABA2-BOOT-02',
      text: 'No pudimos abrir los datos guardados en este teléfono. Probá de nuevo.',
    },
    timeout: {
      code: 'TABA2-BOOT-03',
      text: 'La tienda está tardando más de lo normal. Probá de nuevo.',
    },
  };

  // `painted` lo enciende la aplicación cuando terminó su primer render. A
  // partir de ahí los detectores pasivos se callan: un error suelto de una
  // pantalla cualquiera no puede tapar una tienda que está funcionando con un
  // cartel de "no pudimos abrir". Después de pintar, el único que puede mostrar
  // el panel es la aplicación, que sabe si lo que falló era el arranque.
  let painted = false;
  let settled = false;
  let timer = null;

  if (reset) reset.hidden = !isDemo;

  const show = ({ reason = 'startup', resetAvailable = isDemo } = {}) => {
    const detail = REASONS[reason] || REASONS.startup;
    settled = true;
    clearTimeout(timer);
    // El panel vive DENTRO de `<main data-app-main inert aria-busy="true">`, y
    // el único que quita ese `inert` es `js/app.js` cuando la aplicación
    // arranca —o sea, exactamente el código que acá ya sabemos que no corrió—.
    // Sin esto, «Reintentar» se dibujaba pero no se podía tocar ni enfocar: la
    // salida de emergencia quedaba cerrada justo en la emergencia.
    const main = panel.closest('[data-app-main]') || document.querySelector('[data-app-main]');
    if (main) {
      main.removeAttribute('inert');
      main.removeAttribute('aria-busy');
    }
    panel.hidden = false;
    panel.dataset.appRecoveryCode = detail.code;
    panel.dataset.appRecoveryReason = reason;
    if (message) message.textContent = detail.text;
    if (reset) reset.hidden = !isDemo || !resetAvailable;
    // Diagnóstico interno. No se pinta en ninguna superficie del cliente.
    try {
      console.warn(`[TABA] arranque no completado (${detail.code}, reason=${reason})`);
    } catch (_) {
      // Una consola bloqueada no puede impedir que se muestre la salida.
    }
  };

  const hide = () => {
    settled = true;
    painted = true;
    clearTimeout(timer);
    panel.hidden = true;
  };

  retry?.addEventListener('click', () => window.location.reload());
  reset?.addEventListener('click', () => {
    if (!isDemo) return;
    const url = new URL(window.location.href);
    url.searchParams.set('demo', '1');
    url.searchParams.set('reset', '1');
    if (!url.hash) url.hash = '#home';
    window.location.replace(url.href);
  });

  window.TABA_STARTUP_RECOVERY = Object.freeze({ show, hide });

  // Un módulo que no baja (404/503, red caída, worker viejo sirviendo basura)
  // NO dispara `window.onerror`: el fallo de carga de un recurso no burbujea y
  // sólo se ve en la fase de captura. Ese era el caso que dejaba la pantalla en
  // negro sin salida.
  window.addEventListener('error', (event) => {
    if (painted) return;
    const target = event.target;
    if (target && target !== window && target !== document && target.tagName !== 'SCRIPT') return;
    show({ reason: 'startup' });
  }, true);
  window.addEventListener('unhandledrejection', () => {
    if (painted) return;
    show({ reason: 'storage' });
  });

  // Red de seguridad para lo que no avisa: un módulo que queda colgado, una
  // promesa del arranque que nunca resuelve. Si a los ocho segundos la
  // aplicación no pintó ni falló, el cliente igual recibe una salida.
  timer = setTimeout(() => {
    if (settled || document.documentElement.dataset.tabaStartup === 'ready') return;
    show({ reason: 'timeout' });
  }, BOOT_TIMEOUT_MS);
})();
