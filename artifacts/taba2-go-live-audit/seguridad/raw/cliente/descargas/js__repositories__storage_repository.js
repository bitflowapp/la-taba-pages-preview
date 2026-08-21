import {
  getStorageArea,
  safeJsonParse,
  safeStorageGet,
  safeStorageSet,
} from '../core/storage.js';

export function createStorageRepository({ area = 'localStorage', namespace = 'la_taba' } = {}) {
  const storage = getStorageArea(area);
  const keyFor = (key) => `${namespace}:${key}`;

  return {
    area,
    namespace,
    getString(key, fallback = null) {
      return safeStorageGet(storage, keyFor(key)) ?? fallback;
    },
    setString(key, value) {
      return safeStorageSet(storage, keyFor(key), String(value));
    },
    getJson(key, fallback = null) {
      return safeJsonParse(safeStorageGet(storage, keyFor(key)), fallback);
    },
    setJson(key, value) {
      return safeStorageSet(storage, keyFor(key), JSON.stringify(value));
    },
    remove(key) {
      try {
        storage?.removeItem(keyFor(key));
        return true;
      } catch (_) {
        return false;
      }
    },
  };
}
