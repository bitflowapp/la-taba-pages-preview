/*
 * Lo que sostiene el pulido de lanzamiento cuando nadie está mirando la pantalla.
 *
 * Tres cosas que una captura no puede afirmar y una regresión sí puede romper
 * en silencio:
 *   · la háptica es una mejora progresiva de verdad, incluida la plataforma
 *     donde NO existe (todo iOS);
 *   · las dos mitades del sello "Agregado" —la ventana en JS y la animación en
 *     CSS— siguen midiendo lo mismo;
 *   · las acciones primarias tienen geometría de acción y no de chip, y la
 *     píldora sigue siendo la forma de los chips.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  HAPTIC_PATTERNS,
  getHapticSupport,
  hapticFeedback,
  resetHapticsForTests,
} from '../js/core/haptics.js';
import { readDesignToken } from '../scripts/brand-surface.mjs';

const RAIZ = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const leer = (relativo) => readFileSync(path.join(RAIZ, relativo), 'utf8');

// ===== Háptica =====

test('haptica: sin API no vibra, no lanza y lo dice — el caso de todo iOS', () => {
  resetHapticsForTests();
  // Safari, Chrome y Firefox en iOS son el MISMO motor y ninguno implementa la
  // Vibration API. Este es el navegador de una parte real de los clientes.
  const webkitIos = { maxTouchPoints: 5 };
  const soporte = getHapticSupport(webkitIos);

  assert.equal(soporte.hasApi, false);
  assert.equal(soporte.probableEngine, false);
  assert.equal(soporte.knownUnsupportedPlatform, true);
  assert.equal(hapticFeedback('add', { navigatorRef: webkitIos }), false);
});

test('haptica: en Android vibra con el patron declarado', () => {
  resetHapticsForTests();
  const llamadas = [];
  const android = { maxTouchPoints: 5, vibrate: (p) => { llamadas.push(p); return true; } };

  assert.equal(hapticFeedback('add', { navigatorRef: android, now: 1000 }), true);
  assert.equal(hapticFeedback('remove', { navigatorRef: android, now: 2000 }), true);
  assert.deepEqual(llamadas, [HAPTIC_PATTERNS.add, HAPTIC_PATTERNS.remove]);
  assert.equal(getHapticSupport(android).probableEngine, true);
});

test('haptica: el escritorio declara la API sin motor, y por eso nada de la interfaz puede depender de ella', () => {
  resetHapticsForTests();
  // Chrome de escritorio expone `vibrate` y devuelve `true` sin hardware. La
  // única señal honesta disponible es que no hay puntos táctiles.
  const escritorio = { maxTouchPoints: 0, vibrate: () => true };
  const soporte = getHapticSupport(escritorio);

  assert.equal(soporte.hasApi, true);
  assert.equal(soporte.probableEngine, false, 'sin puntos táctiles no se puede afirmar que haya motor');
});

test('haptica: un navegador que lanza no rompe la compra', () => {
  resetHapticsForTests();
  const hostil = { maxTouchPoints: 5, vibrate: () => { throw new Error('permissions policy'); } };
  assert.equal(hapticFeedback('add', { navigatorRef: hostil }), false);
});

test('haptica: mantener el dedo en "+" no produce una vibracion continua', () => {
  resetHapticsForTests();
  const llamadas = [];
  const android = { maxTouchPoints: 5, vibrate: (p) => { llamadas.push(p); return true; } };

  hapticFeedback('add', { navigatorRef: android, now: 1000 });
  hapticFeedback('add', { navigatorRef: android, now: 1020 });
  hapticFeedback('add', { navigatorRef: android, now: 1040 });
  assert.equal(llamadas.length, 1, 'tres toques dentro de la ventana antirrebote son un solo acuse');

  hapticFeedback('add', { navigatorRef: android, now: 1200 });
  assert.equal(llamadas.length, 2, 'pasada la ventana vuelve a acusar');
});

test('haptica: un tipo de acuse inexistente no inventa un patron', () => {
  resetHapticsForTests();
  const android = { maxTouchPoints: 5, vibrate: () => true };
  assert.equal(hapticFeedback('celebracion', { navigatorRef: android }), false);
});

test('haptica: ningun pulso llega a durar lo que un aviso', () => {
  const duraciones = Object.values(HAPTIC_PATTERNS)
    .flatMap((patron) => (Array.isArray(patron) ? patron : [patron]));
  duraciones.forEach((ms) => {
    assert.ok(ms <= 60, `un pulso de ${ms}ms se lee como alarma, no como acuse`);
  });
});

// ===== Sello "Agregado" =====

test('el sello de agregado dura lo mismo en JS que en CSS', () => {
  const token = readDesignToken('--motion-duration-added-flash');
  const enJs = /const ADDED_FLASH_MS = (\d+);/.exec(leer('js/ui.js'))?.[1];

  assert.ok(enJs, 'ADDED_FLASH_MS dejó de existir en js/ui.js');
  assert.equal(`${enJs}ms`, token.trim());
});

test('el sello deja libre la columna del "+" y se retira sin mezclarse con el control', () => {
  const css = leer('styles/motion.css');
  const regla = /\.qty-stepper\.is-just-added::after \{([\s\S]*?)\}/.exec(css)?.[1] || '';

  assert.match(regla, /inset:\s*0 44px 0 0/, 'el sello volvió a cubrir el "+"');
  assert.match(regla, /pointer-events:\s*none/, 'el sello nunca puede comerse el toque');

  const salida = /@keyframes taba-added-flash \{([\s\S]*?)\n\}/.exec(css)?.[1] || '';
  assert.match(salida, /100%\s*\{\s*opacity:\s*1;\s*transform:\s*translateX\(-101%\)/, 'la salida volvió a ser un desvanecido sobre contenido vivo');
  assert.match(css, /\.qty-stepper\.is-just-added \{[^}]*overflow:\s*hidden/, 'sin recorte el sello se pasea fuera del stepper');
});

test('sin movimiento el sello no se pinta: no puede quedar congelado tapando el control', () => {
  const css = leer('styles/motion.css');
  const bloque = /@media \(prefers-reduced-motion: reduce\) \{\s*\.qty-stepper\.is-just-added::after \{([\s\S]*?)\}/.exec(css)?.[1] || '';
  assert.match(bloque, /content:\s*none/);
});

// ===== Geometría de la acción =====

test('los radios de accion existen y son moderados, no pildoras', () => {
  const accion = Number.parseInt(readDesignToken('--radius-action'), 10);
  const accionLg = Number.parseInt(readDesignToken('--radius-action-lg'), 10);

  assert.ok(accion >= 10 && accion <= 12, `--radius-action fuera del rango pedido: ${accion}px`);
  assert.ok(accionLg > accion && accionLg <= 16, `--radius-action-lg no es un escalón de la misma familia: ${accionLg}px`);
  assert.equal(readDesignToken('--radius-pill'), '999px', 'la píldora sigue existiendo: es la forma del chip');
});

test('ninguna accion primaria vuelve a ser una pildora', () => {
  // Se leen las reglas EXACTAS que pintan cada acción, no el archivo entero:
  // la píldora sigue siendo legítima en chips, insignias y aros, y buscarla en
  // bruto daría falsos positivos por todos lados.
  const reglas = [
    ['styles/catalog.css', /\.product-action \.add-button \{([\s\S]*?)\}/, 'Agregar en la góndola'],
    ['styles/catalog.css', /\.product-action \.qty-stepper \{([\s\S]*?)\}/, 'selector de cantidad en la góndola'],
    ['styles/catalog.css', /\.modal-cart-control\.add-button \{([\s\S]*?)\}/, 'Agregar en la ficha'],
    ['styles/checkout.css', /\.confirm-button \{([\s\S]*?)\}/, 'CTA del checkout'],
    ['styles/brand-home.css', /\.floating-cart \{([\s\S]*?)\}/, 'barra de carrito'],
  ];

  reglas.forEach(([archivo, patron, nombre]) => {
    const bloque = patron.exec(leer(archivo))?.[1];
    assert.ok(bloque, `no se encontró la regla de ${nombre} en ${archivo}`);
    assert.doesNotMatch(bloque, /border-radius:\s*(var\(--radius-pill\)|999px)/, `${nombre} volvió a ser una píldora`);
    assert.match(bloque, /border-radius:\s*var\(--radius-action(-lg)?\)/, `${nombre} no usa el radio de acción del sistema`);
  });
});

test('el toque tiene acuse de color, no solo de escala, y llega sin transicion', () => {
  const css = leer('styles/motion.css');
  const bloque = /\.floating-cart\.motion-pressing:not\(:disabled\) \{([\s\S]*?)\}/.exec(css)?.[1] || '';
  assert.match(bloque, /background:\s*var\(--taba-red-hover\)/);
  assert.match(bloque, /transition:\s*none/, 'un acuse que llega 160ms tarde no es un acuse');
});

// ===== Escala de grafito =====

test('la escala de grafito tiene seis escalones distintos y ordenados', () => {
  const luminancia = (hex) => {
    const c = hex.replace('#', '');
    const [r, g, b] = [0, 2, 4].map((i) => Number.parseInt(c.slice(i, i + 2), 16) / 255);
    const lin = (v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
    return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
  };

  const escalones = ['--shelf-sunken', '--brand-bg', '--brand-bg-raised', '--shelf', '--shelf-raised']
    .map((nombre) => ({ nombre, y: luminancia(readDesignToken(nombre)) }));

  escalones.slice(1).forEach((paso, i) => {
    assert.ok(paso.y > escalones[i].y, `${paso.nombre} no está por encima de ${escalones[i].nombre}`);
  });

  // El fondo dejó de ser un pozo: por debajo tiene que quedar lugar para un
  // hueco real, que es lo que hace que la escala no arranque contra el piso.
  assert.ok(escalones[1].y > luminancia('#000000'), 'el fondo tocó el negro absoluto');
  assert.ok(escalones[1].y >= luminancia('#0e1114'), 'el fondo volvió a ser negro plano');
});

test('la tinta sobre grafito conserva el contraste que declara', () => {
  const luminancia = (hex) => {
    const c = hex.replace('#', '');
    const [r, g, b] = [0, 2, 4].map((i) => Number.parseInt(c.slice(i, i + 2), 16) / 255);
    const lin = (v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
    return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
  };
  const contraste = (a, b) => {
    const [alto, bajo] = [luminancia(a), luminancia(b)].sort((x, y) => y - x);
    return (alto + 0.05) / (bajo + 0.05);
  };

  const pares = [
    ['--brand-ink', '--brand-bg', 4.5],
    ['--brand-ink-muted', '--brand-bg', 4.5],
    ['--brand-red-ink', '--brand-bg', 4.5],
    ['--brand-gold', '--brand-bg', 4.5],
    ['--shelf-ink', '--shelf', 4.5],
    ['--shelf-muted', '--shelf', 4.5],
    ['--shelf-gold', '--shelf', 4.5],
    ['--shelf-red-ink', '--shelf', 4.5],
  ];

  pares.forEach(([tinta, superficie, minimo]) => {
    const razon = contraste(readDesignToken(tinta), readDesignToken(superficie));
    assert.ok(razon >= minimo, `${tinta} sobre ${superficie} cayó a ${razon.toFixed(2)}:1`);
  });
});
