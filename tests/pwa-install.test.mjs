import assert from 'node:assert/strict';
import test from 'node:test';
import {
  INSTALL_DECISION,
  INSTALL_PROMPT_KEY,
  INVITATION_QUIET_MS,
  INVITATION_VIEWS,
  LEGACY_DISMISS_KEYS,
  detectPlatform,
  hasResolvedInstallDecision,
  installInvitationKind,
  iosInstallCapability,
  isAndroidDevice,
  isIOSDevice,
  isIOSSafariBrowser,
  isInvitationMomentClear,
  isStandaloneDisplay,
  manualInstallEntryKind,
  readInstallDecision,
  shouldInviteInstall,
  writeInstallDecision,
} from '../js/core/pwa-install.js';

function fakeStorage(initial = {}) {
  const data = { ...initial };
  return {
    getItem: (key) => (key in data ? data[key] : null),
    setItem: (key, value) => { data[key] = String(value); },
    removeItem: (key) => { delete data[key]; },
    dump: () => ({ ...data }),
  };
}

const IPHONE_SAFARI_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1';
const IPHONE_CHROME_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/125.0 Mobile/15E148 Safari/604.1';
const IPHONE_INSTAGRAM_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Instagram 320.0.0.0.0';
const IPAD_DESKTOP_UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15';
const ANDROID_CHROME_UA = 'Mozilla/5.0 (Linux; Android 15; Moto g15) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0 Mobile Safari/537.36';
const ANDROID_FIREFOX_UA = 'Mozilla/5.0 (Android 15; Mobile; rv:128.0) Gecko/128.0 Firefox/128.0';
const DESKTOP_CHROME_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36';

const nav = (userAgent, extra = {}) => ({ userAgent, platform: 'Linux armv8l', maxTouchPoints: 5, ...extra });
const iosNav = (userAgent, extra = {}) => ({ userAgent, platform: 'iPhone', maxTouchPoints: 5, ...extra });
const win = ({ standalone = false, iosStandalone = false } = {}) => ({
  matchMedia: (query) => ({ matches: standalone && query.includes('display-mode: standalone') }),
  navigator: iosStandalone ? { standalone: true } : {},
});

const iphone = (options) => detectPlatform({ nav: iosNav(IPHONE_SAFARI_UA), win: win(options) });
const android = (options) => detectPlatform({ nav: nav(ANDROID_CHROME_UA), win: win(options) });
const desktop = (options) => detectPlatform({ nav: nav(DESKTOP_CHROME_UA, { platform: 'Win32', maxTouchPoints: 0 }), win: win(options) });

const CLEAR_MOMENT = { bootstrapReady: true, hasOpenDialog: false, activeView: 'home' };

/* ── Detección ──────────────────────────────────────────────────────────── */

test('isIOSDevice: iPhone/iPad por user agent, y iPadOS 13+ por el touch', () => {
  assert.equal(isIOSDevice(iosNav(IPHONE_SAFARI_UA)), true);
  // iPadOS 13+ se declara Mac de escritorio: sólo lo delata `maxTouchPoints`.
  assert.equal(isIOSDevice({ userAgent: IPAD_DESKTOP_UA, platform: 'MacIntel', maxTouchPoints: 5 }), true);
  assert.equal(isIOSDevice({ userAgent: IPAD_DESKTOP_UA, platform: 'MacIntel', maxTouchPoints: 0 }), false);
  assert.equal(isIOSDevice(nav(ANDROID_CHROME_UA)), false);
});

test('isAndroidDevice: Android sí, iOS y escritorio no', () => {
  assert.equal(isAndroidDevice(nav(ANDROID_CHROME_UA)), true);
  assert.equal(isAndroidDevice(nav(ANDROID_FIREFOX_UA)), true);
  assert.equal(isAndroidDevice(iosNav(IPHONE_SAFARI_UA)), false);
  assert.equal(isAndroidDevice(nav(DESKTOP_CHROME_UA, { platform: 'Win32' })), false);
});

test('isIOSSafariBrowser: Safari real sí, Chrome/Firefox para iOS no', () => {
  assert.equal(isIOSSafariBrowser(iosNav(IPHONE_SAFARI_UA)), true);
  assert.equal(isIOSSafariBrowser(iosNav(IPHONE_CHROME_UA)), false);
  assert.equal(isIOSSafariBrowser(nav(ANDROID_CHROME_UA)), false);
});

test('iosInstallCapability: Safari, otro navegador, o WebView embebido', () => {
  assert.equal(iosInstallCapability(iosNav(IPHONE_SAFARI_UA)), 'safari');
  assert.equal(iosInstallCapability(iosNav(IPHONE_CHROME_UA)), 'browser');
  // Dentro de Instagram no existe "Agregar a pantalla de inicio".
  assert.equal(iosInstallCapability(iosNav(IPHONE_INSTAGRAM_UA)), 'webview');
  assert.equal(iosInstallCapability(nav(ANDROID_CHROME_UA)), '');
});

test('isStandaloneDisplay: display-mode, pantalla completa y navigator.standalone', () => {
  assert.equal(isStandaloneDisplay(win({ standalone: true })), true);
  assert.equal(isStandaloneDisplay(win()), false);
  // iOS instalada: la media query puede no coincidir y la propiedad sí.
  assert.equal(isStandaloneDisplay(win({ iosStandalone: true })), true);
  // Un lanzador puede abrirla a pantalla completa: sigue siendo "instalada".
  assert.equal(isStandaloneDisplay({
    matchMedia: (query) => ({ matches: query.includes('fullscreen') }),
    navigator: {},
  }), true);
  // Un `matchMedia` que lanza no puede tumbar el arranque.
  assert.equal(isStandaloneDisplay({ matchMedia() { throw new Error('bloqueado'); }, navigator: {} }), false);
});

test('detectPlatform: los cuatro contextos del pedido, sin superponerse', () => {
  const enAndroid = android();
  assert.deepEqual(
    [enAndroid.isAndroid, enAndroid.isIOS, enAndroid.isDesktop, enAndroid.isStandalone],
    [true, false, false, false],
  );
  const enIphone = iphone();
  assert.deepEqual(
    [enIphone.isIOS, enIphone.isAndroid, enIphone.isDesktop, enIphone.isStandalone],
    [true, false, false, false],
  );
  const enEscritorio = desktop();
  assert.deepEqual(
    [enEscritorio.isDesktop, enEscritorio.isMobile, enEscritorio.isStandalone],
    [true, false, false],
  );
  assert.equal(android({ standalone: true }).isStandalone, true);
  assert.equal(iphone({ iosStandalone: true }).isStandalone, true);
});

/* ── Android ────────────────────────────────────────────────────────────── */

test('Android elegible con beforeinstallprompt: invita', () => {
  assert.equal(shouldInviteInstall({
    platform: android(),
    hasDeferredPrompt: true,
    decision: INSTALL_DECISION.PENDING,
    moment: CLEAR_MOMENT,
  }), 'android');
});

test('Android SIN el evento disponible: no se ofrece nada', () => {
  // Es el caso de Firefox para Android y el de cualquier navegador que decidió
  // no ofrecerla. Fingir un botón que no instala es peor que no tener botón.
  assert.equal(shouldInviteInstall({
    platform: android(),
    hasDeferredPrompt: false,
    decision: INSTALL_DECISION.PENDING,
    moment: CLEAR_MOMENT,
  }), '');
  assert.equal(manualInstallEntryKind({ platform: android(), hasDeferredPrompt: false }), '');
});

test('Android ya instalada (standalone): ni invitación ni entrada manual', () => {
  const instalada = android({ standalone: true });
  assert.equal(shouldInviteInstall({
    platform: instalada,
    hasDeferredPrompt: true,
    decision: INSTALL_DECISION.PENDING,
    moment: CLEAR_MOMENT,
  }), '');
  assert.equal(manualInstallEntryKind({ platform: instalada, hasDeferredPrompt: true }), '');
});

/* ── iOS ────────────────────────────────────────────────────────────────── */

test('iPhone no instalado: se ofrece la guía, nunca un prompt inexistente', () => {
  assert.equal(shouldInviteInstall({
    platform: iphone(),
    hasDeferredPrompt: false,
    decision: INSTALL_DECISION.PENDING,
    moment: CLEAR_MOMENT,
  }), 'ios');
  // Chrome para iOS también puede agregar al inicio: misma guía.
  const chromeIOS = detectPlatform({ nav: iosNav(IPHONE_CHROME_UA), win: win() });
  assert.equal(installInvitationKind({ platform: chromeIOS }), 'ios');
});

test('iPhone dentro de otra app (WebView): no se invita porque no se puede', () => {
  const embebido = detectPlatform({ nav: iosNav(IPHONE_INSTAGRAM_UA), win: win() });
  assert.equal(installInvitationKind({ platform: embebido }), '');
  // La entrada del Perfil sí queda: la guía explica que hay que abrirlo en Safari.
  assert.equal(manualInstallEntryKind({ platform: embebido }), 'ios');
});

test('iPhone ya instalado (standalone): no se muestra nada', () => {
  const instalada = iphone({ iosStandalone: true });
  assert.equal(shouldInviteInstall({
    platform: instalada,
    decision: INSTALL_DECISION.PENDING,
    moment: CLEAR_MOMENT,
  }), '');
  assert.equal(manualInstallEntryKind({ platform: instalada }), '');
});

/* ── Escritorio ─────────────────────────────────────────────────────────── */

test('Escritorio: nunca recibe la invitación automática, aunque haya prompt', () => {
  assert.equal(shouldInviteInstall({
    platform: desktop(),
    hasDeferredPrompt: true,
    decision: INSTALL_DECISION.PENDING,
    moment: CLEAR_MOMENT,
  }), '');
  // Pero la entrada del Perfil sí existe si el navegador ofreció instalar.
  assert.equal(manualInstallEntryKind({ platform: desktop(), hasDeferredPrompt: true }), 'android');
  assert.equal(manualInstallEntryKind({ platform: desktop(), hasDeferredPrompt: false }), '');
});

/* ── Momento ────────────────────────────────────────────────────────────── */

test('El momento: con la tienda lista, sin diálogos y fuera del checkout', () => {
  assert.equal(isInvitationMomentClear(CLEAR_MOMENT), true);
  assert.equal(isInvitationMomentClear({ ...CLEAR_MOMENT, bootstrapReady: false }), false);
  assert.equal(isInvitationMomentClear({ ...CLEAR_MOMENT, hasOpenDialog: true }), false);
  // El carrito ES el checkout: dirección, pago y confirmación.
  assert.equal(isInvitationMomentClear({ ...CLEAR_MOMENT, activeView: 'cart' }), false);
  assert.equal(isInvitationMomentClear({ ...CLEAR_MOMENT, activeView: 'tracking' }), false);
  assert.equal(isInvitationMomentClear({ ...CLEAR_MOMENT, activeView: 'business' }), false);
  for (const view of INVITATION_VIEWS) {
    assert.equal(isInvitationMomentClear({ ...CLEAR_MOMENT, activeView: view }), true);
  }
});

test('El momento: no se abre encima de un dedo que está usando la tienda', () => {
  // El caso real: en la góndola, sumando unidades, la hoja se abrió sobre el
  // "+" y se quedó con el toque siguiente. Estar en una vista permitida dice
  // dónde está la persona, no si está haciendo algo.
  assert.equal(isInvitationMomentClear({ ...CLEAR_MOMENT, msSinceInteraction: 200 }), false);
  assert.equal(isInvitationMomentClear({ ...CLEAR_MOMENT, msSinceInteraction: INVITATION_QUIET_MS - 1 }), false);
  assert.equal(isInvitationMomentClear({ ...CLEAR_MOMENT, msSinceInteraction: INVITATION_QUIET_MS }), true);
  // Quien abrió la tienda y no tocó nada no espera de más.
  assert.equal(isInvitationMomentClear({ ...CLEAR_MOMENT, msSinceInteraction: Number.POSITIVE_INFINITY }), true);
  // Y sin el dato, el silencio se presume: nunca bloquea por omisión.
  assert.equal(isInvitationMomentClear(CLEAR_MOMENT), true);
});

test('Un momento ocupado no invita ni siquiera con todo lo demás a favor', () => {
  assert.equal(shouldInviteInstall({
    platform: android(),
    hasDeferredPrompt: true,
    decision: INSTALL_DECISION.PENDING,
    moment: { bootstrapReady: true, hasOpenDialog: true, activeView: 'home' },
  }), '');
});

/* ── Persistencia ───────────────────────────────────────────────────────── */

test('Persistencia: la clave versionada guarda y devuelve la decisión', () => {
  const storage = fakeStorage();
  assert.equal(readInstallDecision(storage).decision, INSTALL_DECISION.PENDING);
  assert.equal(hasResolvedInstallDecision(storage), false);

  writeInstallDecision(INSTALL_DECISION.DECLINED, { storage, platform: 'android', now: () => '2026-08-18T00:00:00.000Z' });
  const guardada = readInstallDecision(storage);
  assert.equal(guardada.decision, INSTALL_DECISION.DECLINED);
  assert.equal(guardada.at, '2026-08-18T00:00:00.000Z');
  assert.equal(hasResolvedInstallDecision(storage), true);

  const crudo = JSON.parse(storage.dump()[INSTALL_PROMPT_KEY]);
  assert.equal(crudo.v, 1);
  assert.equal(crudo.platform, 'android');
});

test('Quien ya descartó el cartel no lo vuelve a ver solo, en ninguna plataforma', () => {
  for (const platform of [android(), iphone()]) {
    assert.equal(shouldInviteInstall({
      platform,
      hasDeferredPrompt: true,
      decision: INSTALL_DECISION.DECLINED,
      moment: CLEAR_MOMENT,
    }), '');
  }
  // Y la puerta de atrás del Perfil sigue abierta: la decisión no la apaga.
  assert.equal(manualInstallEntryKind({ platform: android(), hasDeferredPrompt: true }), 'android');
  assert.equal(manualInstallEntryKind({ platform: iphone() }), 'ios');
});

test('Instalada o aceptada: tampoco se vuelve a invitar', () => {
  for (const decision of [INSTALL_DECISION.INSTALLED, INSTALL_DECISION.ACCEPTED]) {
    assert.equal(shouldInviteInstall({
      platform: android(),
      hasDeferredPrompt: true,
      decision,
      moment: CLEAR_MOMENT,
    }), '');
  }
});

test('Migración: el cierre de la versión anterior se respeta sin reescribirlo', () => {
  for (const legacy of LEGACY_DISMISS_KEYS) {
    const storage = fakeStorage({ [legacy]: '1' });
    assert.equal(readInstallDecision(storage).decision, INSTALL_DECISION.DECLINED);
    assert.equal(readInstallDecision(storage).platform, 'legacy');
    // No se toca el almacenamiento al leer: sólo hay una clave, la vieja.
    assert.deepEqual(Object.keys(storage.dump()), [legacy]);
  }
});

test('Un valor corrupto en la clave equivale a "todavía no le preguntamos"', () => {
  assert.equal(readInstallDecision(fakeStorage({ [INSTALL_PROMPT_KEY]: '{roto' })).decision, INSTALL_DECISION.PENDING);
  assert.equal(readInstallDecision(fakeStorage({ [INSTALL_PROMPT_KEY]: '"declined"' })).decision, INSTALL_DECISION.PENDING);
  assert.equal(readInstallDecision(fakeStorage({ [INSTALL_PROMPT_KEY]: '{"decision":"vaya"}' })).decision, INSTALL_DECISION.PENDING);
});

test('Un almacenamiento bloqueado no rompe nada y no inventa una decisión', () => {
  const bloqueado = {
    getItem() { throw new Error('bloqueado'); },
    setItem() { throw new Error('bloqueado'); },
  };
  assert.doesNotThrow(() => writeInstallDecision(INSTALL_DECISION.DECLINED, { storage: bloqueado }));
  assert.equal(readInstallDecision(bloqueado).decision, INSTALL_DECISION.PENDING);
  assert.equal(hasResolvedInstallDecision(bloqueado), false);
});

test('writeInstallDecision no acepta un estado inventado', () => {
  const storage = fakeStorage();
  writeInstallDecision('instalando-quizas', { storage });
  assert.equal(readInstallDecision(storage).decision, INSTALL_DECISION.PENDING);
});
