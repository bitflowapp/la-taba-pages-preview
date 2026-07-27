(() => {
  if (!('serviceWorker' in navigator)) return;

  const updateBanner = document.querySelector('[data-app-update-banner]');
  const updateButton = document.querySelector('[data-app-update-now]');
  const UPDATE_CHECK_DELAYS = [0, 250, 1000, 4000, 12000, 30000, 60000];
  let pendingUpdate = null;
  let refreshing = false;

  const hideUpdate = () => {
    if (updateBanner) updateBanner.hidden = true;
  };
  const showUpdate = (registration) => {
    if (!registration?.waiting || !navigator.serviceWorker.controller) return;
    pendingUpdate = registration;
    if (updateBanner) updateBanner.hidden = false;
  };
  const announceWaitingUpdate = (registration) => {
    showUpdate(registration);
  };
  const scheduleWaitingUpdateChecks = (registration) => {
    // Un precache completo puede demorar en una conexión móvil. Las revisiones
    // espaciadas cubren ese período sin crear un bucle de timers por pestaña.
    UPDATE_CHECK_DELAYS.forEach((delay) => {
      window.setTimeout(() => announceWaitingUpdate(registration), delay);
    });
  };
  const observeInstallingWorker = (registration, installing) => {
    if (!installing) return;
    installing.addEventListener('statechange', () => {
      if (installing.state === 'installed') announceWaitingUpdate(registration);
    });
  };
  const recheckUpdate = () => {
    if (document.visibilityState === 'hidden') return;
    navigator.serviceWorker.getRegistration()
      .then((registration) => announceWaitingUpdate(registration))
      .catch(() => undefined);
  };

  updateButton?.addEventListener('click', () => {
    if (!pendingUpdate?.waiting) return;
    refreshing = true;
    hideUpdate();
    pendingUpdate.waiting.postMessage('skip-waiting');
  });

  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!refreshing) return;
    refreshing = false;
    window.location.reload();
  });

  navigator.serviceWorker.register('./sw.js', { updateViaCache: 'none' }).then((registration) => {
    scheduleWaitingUpdateChecks(registration);
    observeInstallingWorker(registration, registration.installing);
    registration.addEventListener('updatefound', () => {
      observeInstallingWorker(registration, registration.installing);
    });
    // GitHub Pages puede mantener una respuesta HTTP anterior: comprobamos la
    // publicación actual sin forzar una recarga ni borrar el pedido persistido.
    registration.update().then(() => announceWaitingUpdate(registration)).catch(() => undefined);
  }).catch(() => {
    // La app sigue funcionando cuando el navegador no admite service workers.
  });

  window.addEventListener('focus', recheckUpdate);
  window.addEventListener('pageshow', recheckUpdate);
  document.addEventListener('visibilitychange', recheckUpdate);
})();
