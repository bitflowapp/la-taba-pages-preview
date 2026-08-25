/*
 * INSTALACIÓN DE LA TABA — la decisión, sin DOM.
 *
 * Acá vive TODO el olfateo de plataforma de la tienda y toda la decisión de
 * cuándo corresponde invitar a instalar. La interfaz —el bottom sheet, la guía
 * de iOS, la entrada del Perfil— vive en `js/pwa-install-ui.js` y no vuelve a
 * mirar el user agent ni una sola vez. Ese reparto es el punto: un `navigator`
 * repartido por media docena de archivos es un contrato que nadie puede probar,
 * y esto se prueba entero con objetos falsos, sin navegador.
 *
 * TRES COSAS QUE EL NAVEGADOR DECIDE Y NOSOTROS NO:
 *
 *  1. En Android la instalación existe SÓLO si el navegador dispara
 *     `beforeinstallprompt`. Si no lo dispara —Firefox, un WebView, o Chrome
 *     porque ya está instalada— no hay nada que ofrecer y no se ofrece. Nunca
 *     se simula un botón que no instala.
 *  2. En iOS no existe ningún prompt: la persona lo hace con el menú Compartir.
 *     Lo único honesto es explicar el gesto, y sólo donde ese gesto EXISTE: en
 *     un WebView de Instagram o WhatsApp no está, así que ahí no se invita.
 *  3. Estar instalada no se declara: se detecta, y recién en una apertura
 *     posterior (`display-mode: standalone`, o `navigator.standalone` en iOS).
 */
import { safeJsonParse, safeStorageGet, safeStorageSet } from './storage.js';

/*
 * Una clave, versionada. Si algún día cambia la forma de la decisión, sube el
 * sufijo y la anterior deja de leerse sola, sin migración ni limpieza.
 */
export const INSTALL_PROMPT_KEY = 'TABA_INSTALL_PROMPT_V1';

/*
 * Las dos claves de la versión anterior. Se leen UNA vez, para no volver a
 * molestar a quien ya había cerrado el aviso viejo, y no se vuelven a escribir.
 */
export const LEGACY_DISMISS_KEYS = Object.freeze([
  'la_taba_pwa_install_dismissed_v1',
  'la_taba_pwa_ios_guide_dismissed_v1',
]);

/**
 * Qué pasó con la invitación. `pending` es "todavía no le preguntamos".
 * `declined` cubre las dos formas de decir que no —"Ahora no" y cerrar el
 * prompt nativo—: las dos apagan la invitación automática, ninguna apaga la
 * entrada del Perfil.
 */
export const INSTALL_DECISION = Object.freeze({
  PENDING: 'pending',
  DECLINED: 'declined',
  ACCEPTED: 'accepted',
  INSTALLED: 'installed',
});

const RESOLVED_DECISIONS = new Set([
  INSTALL_DECISION.DECLINED,
  INSTALL_DECISION.ACCEPTED,
  INSTALL_DECISION.INSTALLED,
]);

/**
 * Las vistas donde una invitación no le pisa el trabajo a nadie.
 *
 * El carrito es el checkout —dirección, pago, confirmación— y el seguimiento es
 * un estado vivo: en las dos, un modal encima es exactamente lo que el pedido
 * dice que no hagamos. Negocio y reparto ni figuran: no son el cliente.
 */
export const INVITATION_VIEWS = Object.freeze(['home', 'catalog', 'profile']);

/*
 * Cuánto silencio hace falta antes de abrir la hoja.
 *
 * La lista de vistas no alcanzaba, y no es una hipótesis: en la góndola, con el
 * dedo sumando unidades, la hoja se abrió ENCIMA del "+" y se quedó con el
 * toque siguiente. Estar en una vista permitida dice dónde está la persona; no
 * dice si está haciendo algo. Un segundo y medio sin tocar ni teclear separa
 * "está mirando" de "está usando la tienda", y una invitación sólo interrumpe
 * bien a quien está mirando.
 */
export const INVITATION_QUIET_MS = 1500;

/* ── Plataforma ─────────────────────────────────────────────────────────── */

export function isIOSDevice(nav = globalThis.navigator) {
  if (!nav) return false;
  const ua = String(nav.userAgent || '');
  if (/iP(hone|od|ad)/.test(ua)) return true;
  // iPadOS 13+ se identifica como Mac de escritorio salvo por el touch.
  return nav.platform === 'MacIntel' && Number(nav.maxTouchPoints || 0) > 1;
}

export function isAndroidDevice(nav = globalThis.navigator) {
  if (!nav) return false;
  if (isIOSDevice(nav)) return false;
  return /Android/i.test(String(nav.userAgent || ''));
}

/**
 * Safari real en iOS: no Chrome/Firefox/Edge/Opera para iOS, que llevan su
 * propio marcador aunque por dentro sean el mismo motor.
 */
export function isIOSSafariBrowser(nav = globalThis.navigator) {
  if (!isIOSDevice(nav)) return false;
  const ua = String(nav.userAgent || '');
  if (/CriOS|FxiOS|EdgiOS|OPiOS|mercury/i.test(ua)) return false;
  return /Safari/i.test(ua);
}

/**
 * Qué puede hacer ESTE navegador de iOS con "Agregar a pantalla de inicio".
 *
 *   'safari'  — Safari: el botón Compartir está en la barra de abajo.
 *   'browser' — Chrome/Firefox/Edge para iOS: también pueden, pero el
 *               Compartir vive en su propio menú.
 *   'webview' — el navegador embebido de Instagram, Facebook, WhatsApp o
 *               cualquier app: NO tiene la opción. Invitarlo ahí es mandar a
 *               alguien a buscar un botón que no existe.
 */
export function iosInstallCapability(nav = globalThis.navigator) {
  if (!isIOSDevice(nav)) return '';
  const ua = String(nav.userAgent || '');
  if (/FBAN|FBAV|FB_IAB|Instagram|Line\/|Twitter|WhatsApp|GSA\//i.test(ua)) return 'webview';
  if (/CriOS|FxiOS|EdgiOS|OPiOS/i.test(ua)) return 'browser';
  if (/Safari/i.test(ua)) return 'safari';
  // Un WKWebView pelado no declara ni Safari ni marca de navegador.
  return 'webview';
}

/**
 * La app ya se abrió instalada.
 *
 * `display-mode` cubre Android, escritorio y iOS moderno; `navigator.standalone`
 * es la propiedad propia de iOS y sigue siendo la más confiable ahí. Se
 * consultan varios modos porque "instalada" no siempre es `standalone`: un
 * lanzador puede abrirla a pantalla completa o con la barra mínima, y en los
 * tres casos ofrecer instalar sería absurdo.
 */
export function isStandaloneDisplay(win = globalThis) {
  const matches = (query) => {
    try {
      return typeof win.matchMedia === 'function' && win.matchMedia(query).matches === true;
    } catch (_) {
      return false;
    }
  };
  if (matches('(display-mode: standalone)')) return true;
  if (matches('(display-mode: fullscreen)')) return true;
  if (matches('(display-mode: minimal-ui)')) return true;
  if (matches('(display-mode: window-controls-overlay)')) return true;
  return win?.navigator?.standalone === true;
}

/**
 * El retrato completo de dónde está corriendo la tienda. Es el ÚNICO objeto que
 * la interfaz consulta.
 *
 * `isDesktop` se define por exclusión a propósito: no es "tiene teclado", es
 * "no es ninguno de los dos teléfonos que sabemos reconocer". Un híbrido con
 * Windows cae acá, y está bien: ahí la instalación la ofrece
 * `beforeinstallprompt` igual que en cualquier escritorio.
 */
export function detectPlatform({ nav = globalThis.navigator, win = globalThis } = {}) {
  const isIOS = isIOSDevice(nav);
  const isAndroid = isAndroidDevice(nav);
  return {
    isIOS,
    isAndroid,
    isMobile: isIOS || isAndroid,
    isDesktop: !isIOS && !isAndroid,
    isStandalone: isStandaloneDisplay(win),
    isIOSSafari: isIOSSafariBrowser(nav),
    iosCapability: iosInstallCapability(nav),
  };
}

/* ── Persistencia ───────────────────────────────────────────────────────── */

function legacyDismissed(storage) {
  return LEGACY_DISMISS_KEYS.some((key) => safeStorageGet(storage, key) === '1');
}

/**
 * La decisión guardada, ya normalizada. Nunca lanza y nunca devuelve `null`:
 * un almacenamiento bloqueado (modo privado, cookies de terceros) equivale a
 * "todavía no le preguntamos", que es el estado seguro.
 */
export function readInstallDecision(storage = globalThis.localStorage) {
  const stored = safeJsonParse(safeStorageGet(storage, INSTALL_PROMPT_KEY), null);
  const decision = stored && typeof stored === 'object' ? String(stored.decision || '') : '';
  if (RESOLVED_DECISIONS.has(decision)) {
    return { decision, at: typeof stored.at === 'string' ? stored.at : '', platform: String(stored.platform || '') };
  }
  // Nadie decidió bajo la clave nueva: honramos el cierre de la versión vieja.
  if (legacyDismissed(storage)) return { decision: INSTALL_DECISION.DECLINED, at: '', platform: 'legacy' };
  return { decision: INSTALL_DECISION.PENDING, at: '', platform: '' };
}

/** Guarda la decisión. Devuelve lo que quedó guardado, aunque el storage falle. */
export function writeInstallDecision(decision, { storage = globalThis.localStorage, platform = '', now = () => new Date().toISOString() } = {}) {
  const value = RESOLVED_DECISIONS.has(decision) ? decision : INSTALL_DECISION.PENDING;
  const record = { v: 1, decision: value, at: now(), platform: String(platform || '') };
  safeStorageSet(storage, INSTALL_PROMPT_KEY, JSON.stringify(record));
  return record;
}

/** ¿Ya dijo que no, o ya la instaló? Entonces no se vuelve a invitar solo. */
export function hasResolvedInstallDecision(storage = globalThis.localStorage) {
  return RESOLVED_DECISIONS.has(readInstallDecision(storage).decision);
}

/* ── Decisión ───────────────────────────────────────────────────────────── */

/**
 * Qué invitación corresponde, si es que corresponde alguna.
 *
 * Devuelve `''` (ninguna), `'android'` (hay prompt nativo capturado) o `'ios'`
 * (hay que explicar el gesto). El escritorio nunca recibe la invitación
 * automática: la instalación desde escritorio existe, pero un cartel de "llevá
 * la app en tu celular" sobre un monitor es publicidad, no ayuda.
 */
export function installInvitationKind({ platform, hasDeferredPrompt = false } = {}) {
  if (!platform || platform.isStandalone) return '';
  if (platform.isAndroid) return hasDeferredPrompt ? 'android' : '';
  if (platform.isIOS) return platform.iosCapability === 'webview' ? '' : 'ios';
  return '';
}

/**
 * La invitación AUTOMÁTICA de la primera visita: la de arriba, más la decisión
 * guardada y el momento.
 */
export function shouldInviteInstall({ platform, hasDeferredPrompt = false, decision = INSTALL_DECISION.PENDING, moment = {} } = {}) {
  if (RESOLVED_DECISIONS.has(decision)) return '';
  if (!isInvitationMomentClear(moment)) return '';
  return installInvitationKind({ platform, hasDeferredPrompt });
}

/**
 * ¿Es un buen momento? Sólo con la tienda ya pintada, sin ningún diálogo
 * abierto y en una vista donde no haya nada crítico en curso.
 *
 * Se evalúa JUSTO ANTES de abrir, no cuando se programa: entre el arranque y el
 * momento de mostrar hay segundos de sobra para que alguien haya entrado al
 * checkout o abierto la ficha de un producto.
 */
export function isInvitationMomentClear({
  bootstrapReady = false,
  hasOpenDialog = false,
  activeView = '',
  msSinceInteraction = Number.POSITIVE_INFINITY,
  visitorIsKnown = true,
} = {}) {
  if (!bootstrapReady) return false;
  if (hasOpenDialog) return false;
  if (msSinceInteraction < INVITATION_QUIET_MS) return false;
  // Un visitante que llega por primera vez todavía no sabe qué es esta tienda.
  if (!visitorIsKnown) return false;
  return INVITATION_VIEWS.includes(activeView);
}

/*
 * A quién ya vimos antes.
 *
 * POR QUÉ EXISTE: medido en producción el 2026-08-25, en un iPhone la primera
 * pantalla de La Taba no era La Taba: 2,5 s después de cargar se abría sola la
 * hoja de instalación y cubría el tercio inferior, barra de navegación incluida.
 * La primera impresión de un comercio que abre el viernes era un modal pidiendo
 * un favor antes de haber mostrado un solo precio.
 *
 * La invitación no se saca, se corre de lugar: se ofrece a quien VUELVE, o a
 * quien ya puso algo en el carrito. A esa altura la persona sabe qué le estamos
 * pidiendo que instale, y la conversión de esa pregunta es mejor justamente por
 * eso. La puerta permanente del Perfil sigue estando desde el primer segundo.
 */
export const VISITOR_SEEN_KEY = 'TABA_VISITOR_SEEN_V1';

export function markVisitorSeen(storage = globalThis.localStorage) {
  try {
    storage?.setItem?.(VISITOR_SEEN_KEY, '1');
  } catch { /* almacenamiento bloqueado: se comporta como visitante nuevo */ }
}

export function visitorIsKnown(storage = globalThis.localStorage) {
  try {
    return storage?.getItem?.(VISITOR_SEEN_KEY) === '1';
  } catch {
    return false;
  }
}

/**
 * Qué ofrece la entrada PERMANENTE del Perfil, que no depende de la decisión
 * guardada: es la puerta de atrás para quien dijo "Ahora no" y cambió de idea.
 *
 *   ''        — ya está instalada, o no hay forma real de instalarla acá.
 *   'android' — hay prompt nativo capturado (también en escritorio).
 *   'ios'     — hay que explicar el gesto, incluso dentro de un WebView: ahí la
 *               guía arranca mandando a abrirla en Safari, que es la verdad.
 */
export function manualInstallEntryKind({ platform, hasDeferredPrompt = false } = {}) {
  if (!platform || platform.isStandalone) return '';
  if (platform.isIOS) return 'ios';
  return hasDeferredPrompt ? 'android' : '';
}
