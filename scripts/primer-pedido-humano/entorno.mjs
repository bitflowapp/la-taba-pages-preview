// Dónde vive cada cosa, sin clavar la ruta de la máquina de nadie.
//
// Todo sale del propio archivo o de una variable de entorno con un valor por
// defecto razonable. Así estos scripts sirven en cualquier checkout y el gate de
// higiene del repo no encuentra rutas locales.
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';

/** Raíz del worktree: dos niveles arriba de `scripts/primer-pedido-humano/`. */
export const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

/** `require` anclado al worktree, para tomar sus `node_modules` (Playwright). */
export const requireDelRepo = createRequire(path.join(RAIZ, 'package.json'));

/** Dónde dejar capturas y evidencia. Se puede mover con `TABA_EVIDENCIA`. */
export function evidencia(subcarpeta = '') {
  const base = process.env.TABA_EVIDENCIA || path.join(RAIZ, '.taba-evidencia');
  const destino = subcarpeta ? path.join(base, subcarpeta) : base;
  fs.mkdirSync(destino, { recursive: true });
  return destino;
}

/** El CLI de Supabase. Por defecto el que esté en el PATH. */
export const SUPABASE_CLI = process.env.SUPABASE_CLI || 'supabase';

/** Proyecto de staging. Cualquier otro ref tiene que ser explícito. */
export const REF = process.env.TABA_STAGING_REF || 'ukxqbgswjlibmnjemrzd';
export const URL_BASE = `https://${REF}.supabase.co`;
export const SITIO = process.env.TABA_SITIO || 'https://taba2-staging.pages.dev';

/** Negocio La Taba 2 en staging. */
export const BUSINESS_ID = process.env.TABA_BUSINESS_ID || '00000000-0000-4000-8000-000000000001';

/**
 * Carpeta de credenciales de la máquina que opera. NO tiene valor por defecto y
 * NUNCA va en el repo: si falta, el script se planta en vez de buscar a ciegas.
 * Se apunta con `TABA_SECRETS`.
 */
export function secreto(archivo) {
  const base = process.env.TABA_SECRETS;
  if (!base) {
    throw new Error('Falta TABA_SECRETS: apuntá esa variable a la carpeta de credenciales de esta máquina.');
  }
  const ruta = path.join(base, archivo);
  if (!fs.existsSync(ruta)) throw new Error(`No existe ${archivo} en la carpeta de credenciales.`);
  return ruta;
}
