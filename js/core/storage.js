export function getStorageArea(name) {
  try {
    return globalThis?.[name] || null;
  } catch (_) {
    return null;
  }
}

export function safeStorageGet(storage, key) {
  try {
    return storage?.getItem(key) ?? null;
  } catch (_) {
    return null;
  }
}

export function safeStorageSet(storage, key, value) {
  try {
    storage?.setItem(key, value);
    return true;
  } catch (_) {
    return false;
  }
}

export function safeStorageRemove(storage, key) {
  try {
    storage?.removeItem(key);
    return true;
  } catch (_) {
    return false;
  }
}

export function safeJsonParse(raw, fallback = null) {
  if (typeof raw !== 'string' || raw.trim() === '') return fallback;
  try {
    return JSON.parse(raw);
  } catch (_) {
    return fallback;
  }
}
