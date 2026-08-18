/*
 * EL ICONO DE APLICACIÓN DE LA TABA — una sola geometría, cinco archivos.
 *
 * La T no se dibuja de nuevo acá: es LA MISMA que ya estaba aprobada dentro de
 * `assets/icon.svg`, donde el trazo era
 *
 *     M216 266 h80 v22 h-28 v44 h-24 v-44 h-28 v-22 Z
 *
 * o sea una T de 80 × 66 con la barra de 22 (un tercio del alto) y el asta de
 * 24 (30 % del ancho). Esas tres proporciones son el mark; lo único que cambia
 * entre un archivo y otro es a qué tamaño se pinta y cuánto rojo la rodea.
 * Por eso vive acá una función y no cinco SVG copiados: un retoque de marca es
 * un cambio en un lugar, y los tests miden la MISMA fuente que el generador.
 *
 * POR QUÉ TRES VARIANTES Y NO UNA.
 *
 *  · `any`      — la usa el escritorio y el conmutador de tareas tal cual llega,
 *                 así que trae sus propias esquinas redondeadas.
 *  · `maskable` — Android le aplica SU máscara (círculo, squircle, gota…) y sólo
 *                 garantiza el 80 % central. Va a sangre y con la T más chica:
 *                 lo que importa es que ninguna máscara le corte un brazo.
 *  · `apple`    — iOS enmascara por su cuenta y NO acepta SVG en
 *                 `apple-touch-icon`. Va a sangre, opaca y en PNG, o el iPhone
 *                 se guarda una captura de la página en vez del logo.
 */

/** Rojo TABA (`--taba-red` de styles/tokens.css). El fondo de la identidad. */
export const TABA_RED = '#d0000d';
/** La T es blanca. No hay segunda tinta en el icono. */
export const TABA_MARK_INK = '#ffffff';

/** Proporciones de la T aprobada, derivadas de `assets/icon.svg`. */
export const MARK_RATIO = {
  /* alto / ancho del rectángulo que ocupa la T */
  aspect: 66 / 80,
  /* alto de la barra superior sobre el alto total */
  bar: 22 / 66,
  /* ancho del asta sobre el ancho total */
  stem: 24 / 80,
};

const round = (value) => Number(value.toFixed(2));

/**
 * El trazo de la T centrada en (`cx`, `cy`) con el ancho pedido.
 * El alto sale del aspecto: la T no se deforma nunca.
 */
export function tabaMarkPath({ cx, cy, width }) {
  const height = width * MARK_RATIO.aspect;
  const bar = height * MARK_RATIO.bar;
  const stem = width * MARK_RATIO.stem;
  const shoulder = (width - stem) / 2;
  const left = round(cx - width / 2);
  const top = round(cy - height / 2);
  return [
    `M${left} ${top}`,
    `h${round(width)}`,
    `v${round(bar)}`,
    `h${round(-shoulder)}`,
    `v${round(height - bar)}`,
    `h${round(-stem)}`,
    `v${round(bar - height)}`,
    `h${round(-shoulder)}`,
    'Z',
  ].join('');
}

/*
 * Cuánto de la T mide cada variante, en fracción del lienzo.
 *
 * `maskable` es la que tiene una cuenta detrás y no un gusto: la zona segura de
 * Android es el círculo centrado de diámetro 80 %, o sea radio 0,4 del lado. La
 * T entra si su media diagonal cabe en ese radio:
 *
 *     hypot(0,53/2 , 0,53·0,825/2) = 0,344  <  0,4   ✔
 *
 * Con 0,53 sobra margen y la T sigue leyéndose a 48 px, que es el tamaño real
 * de un icono en la pantalla de inicio de un teléfono de gama media.
 */
export const MARK_SCALE = {
  any: 0.5,
  maskable: 0.53,
  apple: 0.5,
};

/** Radio de las esquinas de la variante `any`, en fracción del lado. */
export const ANY_CORNER_RATIO = 0.2;

/**
 * El SVG de una variante. `variant` es 'any' | 'maskable' | 'apple'.
 * `size` es el lado del lienzo cuadrado.
 */
export function tabaAppIconSvg({ variant = 'any', size = 512 } = {}) {
  const scale = MARK_SCALE[variant];
  if (!scale) throw new Error(`variante de icono desconocida: ${variant}`);
  const radius = variant === 'any' ? round(size * ANY_CORNER_RATIO) : 0;
  const mark = tabaMarkPath({ cx: size / 2, cy: size / 2, width: size * scale });
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" role="img" aria-label="La Taba">`,
    '  <title>La Taba</title>',
    `  <rect width="${size}" height="${size}"${radius ? ` rx="${radius}"` : ''} fill="${TABA_RED}"/>`,
    `  <path d="${mark}" fill="${TABA_MARK_INK}"/>`,
    '</svg>',
    '',
  ].join('\n');
}

/** Los archivos que publica el generador, con su tamaño y su variante. */
export const APP_ICON_FILES = [
  { path: 'assets/brand/taba-app-icon.svg', variant: 'any', size: 512, format: 'svg' },
  { path: 'assets/brand/taba-app-icon-192.png', variant: 'any', size: 192, format: 'png' },
  { path: 'assets/brand/taba-app-icon-512.png', variant: 'any', size: 512, format: 'png' },
  { path: 'assets/brand/taba-app-icon-maskable-192.png', variant: 'maskable', size: 192, format: 'png' },
  { path: 'assets/brand/taba-app-icon-maskable-512.png', variant: 'maskable', size: 512, format: 'png' },
  { path: 'assets/brand/taba-app-icon-apple-180.png', variant: 'apple', size: 180, format: 'png' },
];
