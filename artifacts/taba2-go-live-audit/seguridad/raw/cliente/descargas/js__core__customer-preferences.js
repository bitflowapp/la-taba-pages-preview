import { STORAGE_KEYS } from '../config.js';
import {
  getStorageArea,
  safeJsonParse,
  safeStorageGet,
  safeStorageSet,
} from './storage.js';
import { sanitizeText } from './validators.js';

let memoryFavorites = [];

export function getFavoriteProductIds() {
  const stored = readFavoritesFromStorage();
  memoryFavorites = stored;
  return stored;
}

export function isFavoriteProduct(productId) {
  const cleanProductId = sanitizeProductId(productId);
  if (!cleanProductId) return false;
  return getFavoriteProductIds().includes(cleanProductId);
}

export function setFavoriteProduct(productId, favorite) {
  const cleanProductId = sanitizeProductId(productId);
  if (!cleanProductId) {
    return { ok: false, favorites: getFavoriteProductIds(), message: 'Producto no encontrado.' };
  }

  const current = new Set(getFavoriteProductIds());
  if (favorite) current.add(cleanProductId);
  else current.delete(cleanProductId);

  const favorites = sanitizeFavoriteIds([...current]);
  persistFavorites(favorites);
  return {
    ok: true,
    favorites,
    favorite: favorites.includes(cleanProductId),
    message: favorites.includes(cleanProductId)
      ? 'Producto guardado en favoritos.'
      : 'Producto quitado de favoritos.',
  };
}

export function toggleFavoriteProduct(productId) {
  return setFavoriteProduct(productId, !isFavoriteProduct(productId));
}

export function clearFavoriteProductsForTests() {
  persistFavorites([]);
}

function readFavoritesFromStorage() {
  const storage = getStorageArea('localStorage');
  const raw = safeStorageGet(storage, STORAGE_KEYS.customerFavorites);
  if (raw == null) return memoryFavorites.slice();
  return sanitizeFavoriteIds(safeJsonParse(raw, []));
}

function persistFavorites(favorites) {
  memoryFavorites = sanitizeFavoriteIds(favorites);
  safeStorageSet(
    getStorageArea('localStorage'),
    STORAGE_KEYS.customerFavorites,
    JSON.stringify(memoryFavorites),
  );
}

function sanitizeFavoriteIds(value) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map(sanitizeProductId).filter(Boolean))].slice(0, 120);
}

function sanitizeProductId(value) {
  return sanitizeText(value, { fallback: '', maxLength: 80 });
}
