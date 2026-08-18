/*
 * `beforeinstallprompt` SE CAPTURA ACÁ, y no en el módulo de la invitación.
 *
 * El evento es de UN SOLO USO y no se repite: perdérselo es perder la
 * instalación de esa visita entera —ni hoja, ni entrada en el Perfil—. Y se
 * perdía, medido contra el sitio publicado: disparado antes de que corriera una
 * línea de la app, la hoja no se abría y la tarjeta del Perfil quedaba oculta.
 *
 * El motivo es el orden del shell. Este archivo es un script CLÁSICO, así que
 * corre durante el parseo; `js/app.js` es un MÓDULO, o sea diferido, y encima
 * cablea la invitación al final de `bootstrap()`, después de traer el catálogo.
 * Entre un punto y el otro hay toda la red de por medio.
 *
 * Y el hueco se abre justo cuando más importa: Chrome pide interacción previa
 * para ofrecer instalar, así que el evento suele llegar en la SEGUNDA visita
 * —con el worker ya activo y todo caliente—, que es exactamente el caso en que
 * la app tarda menos en pintar y el evento llega más temprano.
 *
 * Acá sólo se guarda. Quién decide si corresponde invitar, cuándo y con qué
 * texto sigue siendo `js/core/pwa-install.js`; quién lo consume, la interfaz.
 */
(() => {
  if (window.__tabaInstallPromptBound) return;
  window.__tabaInstallPromptBound = true;
  window.__TABA_DEFERRED_INSTALL_PROMPT__ = window.__TABA_DEFERRED_INSTALL_PROMPT__ || null;
  window.addEventListener('beforeinstallprompt', (event) => {
    // Sin esto Chrome muestra su propio aviso y la invitación de la tienda
    // pasa a competir con él por el mismo pulgar.
    event.preventDefault();
    window.__TABA_DEFERRED_INSTALL_PROMPT__ = event;
  });
  window.addEventListener('appinstalled', () => {
    window.__TABA_DEFERRED_INSTALL_PROMPT__ = null;
  });
})();

(() => {
  if (!('serviceWorker' in navigator)) return;
  // El módulo se enlaza UNA vez por documento. Si el shell llegara a incluir el
  // script dos veces, la segunda pasada duplicaría cada escucha del ciclo de
  // vida y con ella las recargas.
  if (window.__tabaPwaUpdateBound) return;
  window.__tabaPwaUpdateBound = true;

  const updateBanner = document.querySelector('[data-app-update-banner]');
  const updateButton = document.querySelector('[data-app-update-now]');
  const dismissButton = document.querySelector('[data-app-update-dismiss]');
  const UPDATE_CHECK_DELAYS = [0, 250, 1000, 4000, 12000, 30000, 60000];
  // Si pedimos la activación y el control no cambia, el aviso no puede quedar
  // escondido con una actualización todavía pendiente.
  const ACTIVATION_TIMEOUT = 10000;

  let pendingUpdate = null;
  let refreshing = false;
  let reloaded = false;
  // Qué worker descartó la persona en esta pantalla. Se guarda la referencia al
  // worker, no un booleano: la próxima publicación vuelve a avisar.
  let dismissedWorker = null;
  // Un worker puede llegar por `updatefound`, por el registro inicial y por
  // cualquiera de las revisiones espaciadas. Sin esto, el mismo worker acumula
  // una escucha `statechange` por camino.
  const observedWorkers = new WeakSet();

  const hideUpdate = () => {
    if (updateBanner) updateBanner.hidden = true;
  };
  const showUpdate = () => {
    if (updateBanner) updateBanner.hidden = false;
  };

  /**
   * El aviso dice UNA cosa: «hay un worker en espera que puedo activar ahora».
   *
   * Es una sincronización en los dos sentidos, y esa es la corrección. Antes
   * sólo existía el camino que MUESTRA: cuando el worker en espera desaparecía
   * —porque activó solo, porque lo activó otra pestaña, o porque una publicación
   * más nueva lo dejó obsoleto— nadie retiraba el aviso. Quedaba fijo, sin botón
   * de descarte, 115 px de alto sobre el contenido, comiéndose el toque de lo
   * que hubiera debajo; y «Actualizar ahora» no hacía nada, porque
   * `registration.waiting` ya era null.
   */
  const syncUpdate = (registration) => {
    const waiting = registration?.waiting || null;
    if (!waiting || !navigator.serviceWorker.controller || waiting === dismissedWorker) {
      pendingUpdate = null;
      hideUpdate();
      return;
    }
    pendingUpdate = registration;
    observeWorker(registration, waiting);
    showUpdate();
  };

  // Un worker puede volverse `redundant` sin que cambie el control (lo desplaza
  // una instalación más nueva). Escuchar su estado es lo que permite retirar el
  // aviso en ese caso, que desde afuera no dispara ningún otro evento.
  const observeWorker = (registration, worker) => {
    if (!worker || observedWorkers.has(worker)) return;
    observedWorkers.add(worker);
    worker.addEventListener('statechange', () => syncUpdate(registration));
  };

  const observeInstallingWorker = (registration, installing) => {
    observeWorker(registration, installing);
  };

  const scheduleWaitingUpdateChecks = (registration) => {
    // Un precache completo puede demorar en una conexión móvil. Las revisiones
    // espaciadas cubren ese período sin crear un bucle de timers por pestaña.
    UPDATE_CHECK_DELAYS.forEach((delay) => {
      window.setTimeout(() => syncUpdate(registration), delay);
    });
  };

  const recheckUpdate = () => {
    if (document.visibilityState === 'hidden') return;
    navigator.serviceWorker.getRegistration()
      .then((registration) => syncUpdate(registration))
      .catch(() => undefined);
  };

  const requestActivation = (registration) => {
    const waiting = registration?.waiting;
    if (!waiting) return false;
    refreshing = true;
    hideUpdate();
    waiting.postMessage('skip-waiting');
    // Red de seguridad: si la activación no llega, se vuelve al estado real en
    // vez de dejar una actualización pendiente sin forma de pedirla.
    window.setTimeout(() => {
      if (!refreshing) return;
      refreshing = false;
      recheckUpdate();
    }, ACTIVATION_TIMEOUT);
    return true;
  };

  updateButton?.addEventListener('click', () => {
    if (requestActivation(pendingUpdate)) return;
    // No hay nada en espera: la actualización se activó sola entre que se
    // dibujó el aviso y el toque. El aviso se retira igual —nunca se queda
    // pegado por haberlo tocado— y se vuelve a leer el estado real por si
    // apareció otra publicación mientras tanto.
    hideUpdate();
    navigator.serviceWorker.getRegistration()
      .then((registration) => {
        if (!requestActivation(registration)) syncUpdate(registration);
      })
      .catch(() => undefined);
  });

  dismissButton?.addEventListener('click', () => {
    dismissedWorker = pendingUpdate?.waiting || null;
    pendingUpdate = null;
    hideUpdate();
  });

  navigator.serviceWorker.addEventListener('controllerchange', () => {
    // El control cambió: la actualización YA ocurrió, la haya pedido esta
    // pestaña o cualquier otra. En los dos casos el aviso deja de tener sentido.
    pendingUpdate = null;
    hideUpdate();
    if (!refreshing) {
      // La pidió otra pestaña. No se recarga esta: puede haber un checkout a
      // medio completar, y el worker sirve red primero, así que lo que se pinte
      // a partir de acá ya es la versión nueva.
      recheckUpdate();
      return;
    }
    refreshing = false;
    if (reloaded) return;
    reloaded = true;
    window.location.reload();
  });

  navigator.serviceWorker.register('./sw.js', { updateViaCache: 'none' }).then((registration) => {
    scheduleWaitingUpdateChecks(registration);
    observeInstallingWorker(registration, registration.installing);
    observeWorker(registration, registration.waiting);
    registration.addEventListener('updatefound', () => {
      observeInstallingWorker(registration, registration.installing);
      syncUpdate(registration);
    });
    // GitHub Pages puede mantener una respuesta HTTP anterior: comprobamos la
    // publicación actual sin forzar una recarga ni borrar el pedido persistido.
    registration.update().then(() => syncUpdate(registration)).catch(() => undefined);
  }).catch(() => {
    // La app sigue funcionando cuando el navegador no admite service workers.
  });

  window.addEventListener('focus', recheckUpdate);
  window.addEventListener('pageshow', recheckUpdate);
  document.addEventListener('visibilitychange', recheckUpdate);
})();
