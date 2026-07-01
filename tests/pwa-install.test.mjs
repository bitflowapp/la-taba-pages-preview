import assert from 'node:assert/strict';
import test from 'node:test';
import {
  PWA_INSTALL_DISMISS_KEY,
  PWA_IOS_GUIDE_DISMISS_KEY,
  dismissIOSGuide,
  dismissInstallBanner,
  isIOSDevice,
  isIOSGuideDismissed,
  isIOSSafariBrowser,
  isInstallBannerDismissed,
  isStandaloneDisplay,
  shouldShowAndroidInstallCta,
  shouldShowIOSInstallGuide,
} from '../js/core/pwa-install.js';

function fakeStorage(initial = {}) {
  const data = { ...initial };
  return {
    getItem: (key) => (key in data ? data[key] : null),
    setItem: (key, value) => { data[key] = value; },
  };
}

const IPHONE_SAFARI_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1';
const IPHONE_CHROME_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/125.0 Mobile/15E148 Safari/604.1';
const ANDROID_CHROME_UA = 'Mozilla/5.0 (Linux; Android 15; Moto g15) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0 Mobile Safari/537.36';

test('isIOSDevice: reconoce iPhone/iPad por user agent y iPadOS 13+ por touch', () => {
  assert.equal(isIOSDevice({ userAgent: IPHONE_SAFARI_UA, platform: 'iPhone', maxTouchPoints: 5 }), true);
  assert.equal(isIOSDevice({ userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15)', platform: 'MacIntel', maxTouchPoints: 5 }), true);
  assert.equal(isIOSDevice({ userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15)', platform: 'MacIntel', maxTouchPoints: 0 }), false);
  assert.equal(isIOSDevice({ userAgent: ANDROID_CHROME_UA, platform: 'Linux armv8l', maxTouchPoints: 5 }), false);
});

test('isIOSSafariBrowser: Safari real en iOS sí, Chrome/Firefox para iOS no', () => {
  assert.equal(isIOSSafariBrowser({ userAgent: IPHONE_SAFARI_UA, platform: 'iPhone', maxTouchPoints: 5 }), true);
  assert.equal(isIOSSafariBrowser({ userAgent: IPHONE_CHROME_UA, platform: 'iPhone', maxTouchPoints: 5 }), false);
  assert.equal(isIOSSafariBrowser({ userAgent: ANDROID_CHROME_UA, platform: 'Linux armv8l', maxTouchPoints: 5 }), false);
});

test('isStandaloneDisplay: display-mode standalone o navigator.standalone (iOS)', () => {
  const standaloneWin = { matchMedia: () => ({ matches: true }), navigator: {} };
  const browserTabWin = { matchMedia: () => ({ matches: false }), navigator: {} };
  const iosStandaloneWin = { matchMedia: () => ({ matches: false }), navigator: { standalone: true } };
  assert.equal(isStandaloneDisplay(standaloneWin), true);
  assert.equal(isStandaloneDisplay(browserTabWin), false);
  assert.equal(isStandaloneDisplay(iosStandaloneWin), true);
});

test('shouldShowIOSInstallGuide: sólo Safari en iOS y no instalada ya', () => {
  const nav = { userAgent: IPHONE_SAFARI_UA, platform: 'iPhone', maxTouchPoints: 5 };
  const notStandaloneWin = { matchMedia: () => ({ matches: false }), navigator: {} };
  const standaloneWin = { matchMedia: () => ({ matches: false }), navigator: { standalone: true } };
  assert.equal(shouldShowIOSInstallGuide({ nav, win: notStandaloneWin }), true);
  assert.equal(shouldShowIOSInstallGuide({ nav, win: standaloneWin }), false);
});

test('shouldShowAndroidInstallCta: requiere el evento diferido y no estar instalada', () => {
  const notStandaloneWin = { matchMedia: () => ({ matches: false }), navigator: {} };
  const standaloneWin = { matchMedia: () => ({ matches: true }), navigator: {} };
  assert.equal(shouldShowAndroidInstallCta({ hasDeferredPrompt: {}, win: notStandaloneWin }), true);
  assert.equal(shouldShowAndroidInstallCta({ hasDeferredPrompt: null, win: notStandaloneWin }), false);
  assert.equal(shouldShowAndroidInstallCta({ hasDeferredPrompt: {}, win: standaloneWin }), false);
});

test('dismiss helpers: recuerdan el cierre por separado para Android e iOS', () => {
  const storage = fakeStorage();
  assert.equal(isInstallBannerDismissed(storage), false);
  assert.equal(isIOSGuideDismissed(storage), false);
  dismissInstallBanner(storage);
  assert.equal(isInstallBannerDismissed(storage), true);
  assert.equal(isIOSGuideDismissed(storage), false);
  dismissIOSGuide(storage);
  assert.equal(isIOSGuideDismissed(storage), true);
  assert.notEqual(PWA_INSTALL_DISMISS_KEY, PWA_IOS_GUIDE_DISMISS_KEY);
});

test('dismiss helpers no rompen si el storage no está disponible', () => {
  const brokenStorage = {
    getItem() { throw new Error('bloqueado'); },
    setItem() { throw new Error('bloqueado'); },
  };
  assert.doesNotThrow(() => dismissInstallBanner(brokenStorage));
  assert.equal(isInstallBannerDismissed(brokenStorage), false);
});
