/*
 * La superficie comercial, leída del sistema de diseño y no copiada a mano.
 *
 * `rgb(9, 11, 14)` estaba escrito literal en cinco lugares: dos suites E2E, dos
 * guiones de certificación de staging y un espejo en los tests unitarios. Ese
 * literal no mide un color por gusto —mide que la cadena de estilos esté viva,
 * que es el defecto real que cierra: un `<link>` presente con la hoja en cero
 * reglas dejaba pasar cualquier `toBeVisible` sobre una tienda apagada.
 *
 * El problema del literal es que la afirmación "el fondo es EXACTAMENTE este"
 * deja de ser cierta en cuanto alguien toca el token, y entonces cinco archivos
 * hay que acordarse de tocarlos a la vez. Acá el valor se deriva de
 * `styles/tokens.css`, así que la prueba sigue siendo tan estricta como antes
 * —compara el color computado del `body` contra un valor exacto— pero ese valor
 * ya no puede quedar viejo.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const TOKENS = path.resolve(fileURLToPath(new URL('../styles/tokens.css', import.meta.url)));

export function readDesignToken(name, tokensPath = TOKENS) {
  const css = readFileSync(tokensPath, 'utf8');
  // Sólo el bloque `:root`: un mismo token puede reaparecer en un override de
  // `body` o dentro de una media query, y ahí ya no es el valor de la marca.
  const root = css.slice(css.indexOf(':root'), css.indexOf('\n}'));
  const match = new RegExp(`${name}\\s*:\\s*([^;]+);`).exec(root);
  if (!match) throw new Error(`El token ${name} no existe en ${tokensPath}.`);
  return match[1].trim();
}

export function hexToRgbString(hex) {
  const clean = String(hex).trim().replace('#', '');
  const full = clean.length === 3 ? clean.split('').map((c) => c + c).join('') : clean;
  if (!/^[0-9a-fA-F]{6}$/.test(full)) throw new Error(`No es un color hexadecimal: ${hex}`);
  const [r, g, b] = [0, 2, 4].map((i) => Number.parseInt(full.slice(i, i + 2), 16));
  return `rgb(${r}, ${g}, ${b})`;
}

/** Fondo de la aplicación del cliente, tal como lo devuelve `getComputedStyle`. */
export function brandSurfaceRgb() {
  return hexToRgbString(readDesignToken('--brand-bg'));
}

/** Superficie de la góndola (tarjeta, formulario, panel del cliente). */
export function shelfSurfaceRgb() {
  return hexToRgbString(readDesignToken('--shelf'));
}
