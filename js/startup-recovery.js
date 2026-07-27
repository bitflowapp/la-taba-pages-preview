// This is deliberately a classic script loaded before the application module.
// It owns the only UI that can recover a failed module bootstrap. Keeping it
// independent from the application import graph is what makes the fallback
// useful when a stale worker, a browser storage error, or a syntax/import
// failure prevents app.js from executing.
(() => {
  const panel = document.querySelector('[data-app-recovery]');
  if (!panel) return;

  const message = panel.querySelector('[data-app-recovery-message]');
  const code = panel.querySelector('[data-app-recovery-code]');
  const retry = panel.querySelector('[data-app-recovery-retry]');
  const reset = panel.querySelector('[data-app-recovery-reset]');
  const isDemo = new URLSearchParams(window.location.search).get('demo') === '1';

  if (reset) reset.hidden = !isDemo;

  const show = ({ reason = 'startup', resetAvailable = isDemo } = {}) => {
    panel.hidden = false;
    if (message) {
      message.textContent = reason === 'storage'
        ? 'No pudimos abrir los datos guardados. Podés reintentar sin perder tu sesión.'
        : 'Podés reintentar ahora. Tus datos de prueba no se borraron.';
    }
    if (code) code.textContent = reason === 'storage' ? 'TABA-BOOT-02' : 'TABA-BOOT-01';
    if (reset) reset.hidden = !isDemo || !resetAvailable;
  };

  const hide = () => {
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
  window.addEventListener('error', () => show());
  window.addEventListener('unhandledrejection', () => show({ reason: 'storage' }));
})();
