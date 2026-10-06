// Ayudas para escribir una contraseña nueva en /cuenta/: contador contra el
// mínimo y «Mostrar». El marcado sale de acá para que el cambio de contraseña y
// la invitación al equipo sean el mismo campo; la página los mantiene vivos
// (account-action-page.js).
//
// Por qué existen: en producción (2026-10-06) cambiar la contraseña desde el
// correo parecía no hacer nada. El campo escribía tinta clara sobre fondo
// blanco, así que no se veía qué se tecleaba, y cada intento fallido volvía a
// pintar el formulario vacío. Sin ver los caracteres ni saber cuántos iban, el
// mínimo de 12 era una adivinanza.

import { TEAM_PASSWORD_MIN_LENGTH } from './services/supabase-auth.js';

export const PASSWORD_COUNT_ID = 'account-password-count';

export function passwordFieldAttributes() {
  return `data-password-field aria-describedby="${PASSWORD_COUNT_ID}"`;
}

export function passwordAidsMarkup(min = TEAM_PASSWORD_MIN_LENGTH) {
  return `<div class="account-password-aids">
          <p class="form-hint" id="${PASSWORD_COUNT_ID}" data-password-count data-password-min="${Number(min)}">${passwordCountCopy(0, min)}</p>
          <button class="account-password-reveal" type="button" data-password-reveal aria-pressed="false">Mostrar</button>
        </div>`;
}

export function passwordCountCopy(length, min = TEAM_PASSWORD_MIN_LENGTH) {
  const count = Math.max(0, Number(length) || 0);
  if (count === 0) return `Mínimo ${min} caracteres.`;
  if (count < min) return `Llevás ${count} de ${min} caracteres.`;
  return `${count} caracteres: alcanza el mínimo.`;
}
