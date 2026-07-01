// Detección PWA: funciones puras (sin DOM) para saber cuándo mostrar el CTA
// de instalación en Android y la guía de instalación en iPhone/iPad Safari.
// La UI (mostrar/ocultar banners, wiring de beforeinstallprompt) vive en app.js;
// acá sólo la lógica de decisión, para poder testearla sin navegador real.

export const PWA_INSTALL_DISMISS_KEY = 'la_taba_pwa_install_dismissed_v1';
export const PWA_IOS_GUIDE_DISMISS_KEY = 'la_taba_pwa_ios_guide_dismissed_v1';

// La app ya se abrió instalada (standalone). navigator.standalone es la
// propiedad específica de iOS (más confiable ahí que la media query en
// versiones viejas de iOS); display-mode cubre Android/desktop.
export function isStandaloneDisplay(win = globalThis) {
  const matchesMedia = typeof win.matchMedia === 'function'
    && win.matchMedia('(display-mode: standalone)').matches;
  const iosStandalone = win.navigator?.standalone === true;
  return Boolean(matchesMedia || iosStandalone);
}

export function isIOSDevice(nav = globalThis.navigator) {
  if (!nav) return false;
  const ua = String(nav.userAgent || '');
  if (/iP(hone|od|ad)/.test(ua)) return true;
  // iPadOS 13+ se identifica como Mac de escritorio salvo por el touch.
  return nav.platform === 'MacIntel' && Number(nav.maxTouchPoints || 0) > 1;
}

// Safari real en iOS (no Chrome/Firefox/Edge para iOS, que llevan su propio
// marcador en el user agent aunque usen el motor de Safari por dentro).
export function isIOSSafariBrowser(nav = globalThis.navigator) {
  if (!isIOSDevice(nav)) return false;
  const ua = String(nav.userAgent || '');
  if (/CriOS|FxiOS|EdgiOS|OPiOS|mercury/i.test(ua)) return false;
  return /Safari/i.test(ua);
}

export function shouldShowIOSInstallGuide({ nav = globalThis.navigator, win = globalThis } = {}) {
  return isIOSSafariBrowser(nav) && !isStandaloneDisplay(win);
}

export function shouldShowAndroidInstallCta({ hasDeferredPrompt, win = globalThis } = {}) {
  return Boolean(hasDeferredPrompt) && !isStandaloneDisplay(win);
}

function readDismissed(key, storage) {
  try {
    return storage.getItem(key) === '1';
  } catch (_) {
    return false;
  }
}

function writeDismissed(key, storage) {
  try {
    storage.setItem(key, '1');
  } catch (_) {
    // Almacenamiento no disponible (privado/bloqueado): el banner puede
    // reaparecer en la próxima carga, no es grave.
  }
}

export function isInstallBannerDismissed(storage = globalThis.localStorage) {
  return readDismissed(PWA_INSTALL_DISMISS_KEY, storage);
}

export function dismissInstallBanner(storage = globalThis.localStorage) {
  writeDismissed(PWA_INSTALL_DISMISS_KEY, storage);
}

export function isIOSGuideDismissed(storage = globalThis.localStorage) {
  return readDismissed(PWA_IOS_GUIDE_DISMISS_KEY, storage);
}

export function dismissIOSGuide(storage = globalThis.localStorage) {
  writeDismissed(PWA_IOS_GUIDE_DISMISS_KEY, storage);
}
