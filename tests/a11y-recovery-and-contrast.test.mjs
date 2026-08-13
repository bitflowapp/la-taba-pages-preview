// Tres defectos del frente que nunca se había auditado (UX/copy/a11y).
//
// POR QUÉ ESTÁN JUNTOS: los tres son «lo que ya estaba construido no llega a la
// persona». Ninguno agrega funcionalidad; los tres destrababan algo que el
// producto ya tenía.
//
//   1. La salida de emergencia del arranque se dibujaba dentro de un `<main
//      inert>`, y el único que quita ese `inert` es `js/app.js` —justo el código
//      que en ese escenario no corrió—. «Reintentar» no se podía tocar ni
//      enfocar exactamente cuando hacía falta.
//   2. El error de campo del Perfil se pintaba con un literal `#a11c2a` que
//      sobre la góndola grafito da 2,19:1. Es el ÚNICO texto que dice por qué no
//      se pudo guardar.
//   3. Por debajo de 560px el control de orden no mostraba foco: el `<select>`
//      que recibe el anillo está en `opacity: 0`. Es consecuencia directa del
//      arreglo de la affordance del orden, así que se cierra acá.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');

// ── contraste ────────────────────────────────────────────────────────────────
function canal(c) {
  const v = c / 255;
  return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
}

function luminancia(hex) {
  const [r, g, b] = hex.replace('#', '').match(/../g).map((h) => parseInt(h, 16));
  return 0.2126 * canal(r) + 0.7152 * canal(g) + 0.0722 * canal(b);
}

function contraste(a, b) {
  const [hi, lo] = [luminancia(a), luminancia(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/** Lee el valor de un token de styles/tokens.css. */
function token(nombre) {
  const match = read('styles/tokens.css').match(new RegExp(`${nombre}:\\s*(#[0-9a-fA-F]{6})`));
  assert.ok(match, `no se encontró el token ${nombre}`);
  return match[1];
}

test('la calculadora de contraste está calibrada', () => {
  // Control de la herramienta contra verdades que no dependen de este repo:
  // negro sobre blanco es 21:1 exacto y un color contra sí mismo es 1:1.
  assert.equal(Math.round(contraste('#000000', '#ffffff') * 100) / 100, 21);
  assert.equal(Math.round(contraste('#191d23', '#191d23') * 100) / 100, 1);
  // Y contra un valor que la propia paleta declara: `--shelf-muted` dice 7,7:1
  // sobre `--shelf`, y mide 7,75.
  assert.ok(Math.abs(contraste(token('--shelf-muted'), token('--shelf')) - 7.7) < 0.1);
  // NOTA: el comentario de `--shelf-ink` dice 16,9:1 y la medición da 15,80:1.
  // La diferencia es del comentario, no de la fórmula —que es la de WCAG 2.1 y
  // acierta los otros tres controles—. No es un defecto: 15,8 pasa AAA de
  // sobra. Queda anotado para que nadie use ese 16,9 como referencia exacta.
  assert.ok(contraste(token('--shelf-ink'), token('--shelf')) > 15);
});

test('el error de campo del Perfil se puede leer sobre la góndola', () => {
  const css = read('styles/profile.css');
  const regla = css.match(/\.profile-field-error\s*\{([^}]*)\}/);
  assert.ok(regla, 'falta la regla .profile-field-error');

  // No un literal: el literal es lo que se salteaba el remapeo de la paleta.
  assert.doesNotMatch(regla[1], /color:\s*#/, 'el color no puede volver a ser un literal');
  assert.match(regla[1], /color:\s*var\(--shelf-red-ink\)/);

  // Y el token elegido pasa AA en las dos superficies donde vive el campo.
  for (const superficie of ['--shelf', '--shelf-raised']) {
    const ratio = contraste(token('--shelf-red-ink'), token(superficie));
    assert.ok(
      ratio >= 4.5,
      `--shelf-red-ink sobre ${superficie} da ${ratio.toFixed(2)}:1, por debajo de AA`,
    );
  }
});

test('la salida de emergencia del arranque se puede tocar', () => {
  const html = read('index.html');
  // El `inert` del main sigue existiendo: es correcto mientras la app carga.
  assert.match(html, /<main data-app-main inert aria-busy="true">/);
  // Y el panel sigue viviendo adentro, que es lo que hacía el defecto.
  assert.ok(
    html.indexOf('data-app-recovery') > html.indexOf('<main data-app-main'),
    'el panel de recuperación vive dentro del main inerte',
  );

  const recovery = read('js/startup-recovery.js');
  const show = recovery.match(/const show = \(\{[\s\S]*?\n  \};/);
  assert.ok(show, 'no se encontró la función show()');
  assert.match(show[0], /removeAttribute\('inert'\)/, 'show() tiene que devolver el main al árbol');
  assert.match(show[0], /removeAttribute\('aria-busy'\)/);
  // Y tiene que pasar ANTES de revelar el panel, para que no exista un
  // fotograma con el botón visible e intocable.
  assert.ok(
    show[0].indexOf("removeAttribute('inert')") < show[0].indexOf('panel.hidden = false'),
    'el main se destraba antes de mostrar el panel',
  );
});

test('en teléfono, el control de orden muestra foco aunque su select sea invisible', () => {
  const responsive = read('styles/responsive.css');
  const bloque = responsive.slice(responsive.indexOf('@media (max-width: 560px)'));

  // El select sigue invisible: es la condición que hace necesaria la regla.
  assert.match(bloque, /\.catalog-controls \.sort-field select \{[^}]*opacity: 0/);

  // Y el contenedor visible presta el anillo.
  const foco = bloque.match(/\.catalog-controls \.sort-field:has\(select:focus-visible\)\s*\{([^}]*)\}/);
  assert.ok(foco, 'falta la regla de foco del control de orden');
  assert.match(foco[1], /outline:/);
  // El mismo anillo que la regla global, para no inventar un segundo estilo.
  const global = read('styles/tokens.css').match(/:focus-visible\s*\{([^}]*)\}/);
  assert.ok(global, 'falta la regla global de :focus-visible');
  const anillo = (texto) => texto.replace(/\s+/g, ' ').match(/outline:\s*([^;]+);/)?.[1]?.trim();
  assert.equal(anillo(foco[1]), anillo(global[1]), 'el anillo tiene que ser el mismo de tokens.css');
});
