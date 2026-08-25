/*
 * La lámina de góndola de TABA: obra propia del comercio, dibujada.
 *
 * QUÉ ES
 * ------
 * El dibujo que ocupa la tarjeta cuando NO hay fotografía oficial publicable.
 * No es una foto, no la imita y no reproduce ningún logotipo: dice envase,
 * formato y color de la línea, que es lo que hace falta para reconocer una
 * bebida de un vistazo cuando el nombre está debajo.
 *
 * POR QUÉ ES CÓDIGO Y NO TREINTA ARCHIVOS DIBUJADOS A MANO
 * -------------------------------------------------------
 * Porque «propio» tiene que ser verificable, no declarado. El generador es
 * determinista: de `catalog/lamina-taba/especificacion.json` sale siempre el
 * mismo byte. Un test regenera todo y compara; si alguien pega un archivo de
 * otro lado en `assets/products/taba/`, el test lo delata. Esa es la prueba de
 * procedencia que el modelo de derechos necesita para dejarlo publicar.
 *
 * Este módulo es puro: recibe una especificación, devuelve texto SVG.
 */

/** Alto del envase como fracción del lienzo, por familia de envase. */
const ALTO_POR_ENVASE = Object.freeze({
  'pet-familiar': 0.86,
  'pet-chica': 0.8,
  lata: 0.74,
  'lata-alta': 0.775,
  'lata-slim': 0.76,
  sifon: 0.86,
});

/** Esbeltez real del envase: alto dividido ancho. */
const ESBELTEZ = Object.freeze({
  'pet-familiar': 2.55,
  'pet-chica': 3.05,
  lata: 1.85,
  'lata-alta': 2.15,
  'lata-slim': 3.05,
  sifon: 2.5,
});

/*
 * El contorno de cada envase, como perfil: para cada altura (0 arriba, 1 abajo)
 * la mitad del ancho (0 al eje, 1 al borde). El dibujo se arma espejando el
 * perfil y suavizándolo, así que cambiar una proporción es mover un número y no
 * reescribir un `path`.
 */
const PERFILES = Object.freeze({
  'pet-familiar': [
    [0, 0.3],
    [0.048, 0.3],
    [0.052, 0.246],
    [0.096, 0.242],
    [0.106, 0.298],
    [0.124, 0.244],
    [0.152, 0.256],
    [0.238, 0.84],
    [0.302, 1],
    [0.47, 1],
    [0.548, 0.9],
    [0.624, 1],
    [0.902, 1],
    [0.958, 0.95],
    [1, 0.74],
  ],
  'pet-chica': [
    [0, 0.32],
    [0.05, 0.32],
    [0.054, 0.26],
    [0.1, 0.256],
    [0.112, 0.312],
    [0.13, 0.258],
    [0.16, 0.27],
    [0.25, 0.86],
    [0.32, 1],
    [0.5, 0.98],
    [0.58, 0.92],
    [0.66, 0.99],
    [0.9, 1],
    [0.955, 0.95],
    [1, 0.76],
  ],
  lata: [
    [0, 0.86],
    [0.022, 0.9],
    [0.062, 1],
    [0.93, 1],
    [0.972, 0.9],
    [1, 0.86],
  ],
  'lata-alta': [
    [0, 0.87],
    [0.018, 0.91],
    [0.05, 1],
    [0.945, 1],
    [0.978, 0.91],
    [1, 0.87],
  ],
  'lata-slim': [
    [0, 0.84],
    [0.02, 0.89],
    [0.058, 1],
    [0.935, 1],
    [0.975, 0.89],
    [1, 0.84],
  ],
  sifon: [
    [0, 0.2],
    [0.055, 0.2],
    [0.062, 0.34],
    [0.108, 0.36],
    [0.118, 0.26],
    [0.152, 0.24],
    [0.168, 0.3],
    [0.26, 0.86],
    [0.33, 1],
    [0.9, 1],
    [0.958, 0.95],
    [1, 0.76],
  ],
});

/** La banda de etiqueta: desde dónde hasta dónde, como fracción del alto. */
const ETIQUETA = Object.freeze({
  'pet-familiar': [0.345, 0.7],
  'pet-chica': [0.38, 0.74],
  lata: [0.2, 0.82],
  'lata-alta': [0.16, 0.86],
  'lata-slim': [0.16, 0.86],
  sifon: [0.42, 0.76],
});

/** Hasta dónde llega el líquido dentro del envase transparente. */
const NIVEL_LIQUIDO = Object.freeze({
  'pet-familiar': 0.2,
  'pet-chica': 0.22,
  sifon: 0.24,
  pack: 0.2,
});

const n = (valor) => Number(valor.toFixed(2));

/**
 * Suaviza una polilínea con Catmull-Rom convertida a cúbicas. Es lo que
 * convierte quince números en un hombro de botella y no en un techo a dos aguas.
 */
function suavizar(puntos, tension = 0.5) {
  if (puntos.length < 2) return '';
  const d = [`M ${n(puntos[0][0])} ${n(puntos[0][1])}`];
  for (let i = 0; i < puntos.length - 1; i += 1) {
    const p0 = puntos[i - 1] || puntos[i];
    const p1 = puntos[i];
    const p2 = puntos[i + 1];
    const p3 = puntos[i + 2] || p2;
    const c1x = p1[0] + ((p2[0] - p0[0]) / 6) * tension * 2;
    const c1y = p1[1] + ((p2[1] - p0[1]) / 6) * tension * 2;
    const c2x = p2[0] - ((p3[0] - p1[0]) / 6) * tension * 2;
    const c2y = p2[1] - ((p3[1] - p1[1]) / 6) * tension * 2;
    d.push(`C ${n(c1x)} ${n(c1y)} ${n(c2x)} ${n(c2y)} ${n(p2[0])} ${n(p2[1])}`);
  }
  return d.join(' ');
}

/** El perfil, espejado, como un contorno cerrado. */
function contorno(perfil, { cx, arriba, alto, semiAncho }) {
  const derecha = perfil.map(([y, hw]) => [cx + hw * semiAncho, arriba + y * alto]);
  const izquierda = [...perfil].reverse().map(([y, hw]) => [cx - hw * semiAncho, arriba + y * alto]);
  return `${suavizar(derecha)} ${suavizar(izquierda).replace(/^M/, 'L')} Z`;
}

const LIENZO = 1000;

/**
 * Dibuja la lámina de un producto.
 *
 * @param {{envase: string, paleta: {tinta: string, tapa: string, liquido: string, acento?: string}, escala?: number, sku: string}} pieza
 * @returns {string} SVG completo, listo para escribir a disco.
 */
export function dibujarLamina(pieza) {
  const envase = String(pieza.envase);
  const perfil = PERFILES[envase];
  if (!perfil) throw new Error(`envase desconocido: ${envase}`);
  const escala = Number(pieza.escala) > 0 ? Number(pieza.escala) : 1;
  const { tinta, tapa, liquido, acento = '#FFFFFF' } = pieza.paleta;
  const vidrio = VIDRIO;

  const alto = LIENZO * ALTO_POR_ENVASE[envase] * escala;
  const ancho = alto / ESBELTEZ[envase];
  const semiAncho = ancho / 2;
  const cx = LIENZO / 2;
  // Se levanta un poco del centro geométrico: abajo va la sombra de apoyo, y un
  // objeto centrado a ojo se ve mejor levemente alto.
  const arriba = (LIENZO - alto) / 2 - LIENZO * 0.018;
  const abajo = arriba + alto;

  const id = `l${hashCorto(pieza.sku)}`;
  const esLata = envase.startsWith('lata');
  const silueta = contorno(perfil, { cx, arriba, alto, semiAncho });

  const [etiquetaDesde, etiquetaHasta] = ETIQUETA[envase] || ETIQUETA['pet-familiar'];
  const etiquetaY = arriba + alto * etiquetaDesde;
  const etiquetaAlto = alto * (etiquetaHasta - etiquetaDesde);

  const partes = [];

  partes.push(`<defs>`);
  // El envase transparente: gris muy claro con brillo, nunca blanco puro —un
  // envase blanco sobre fondo blanco desaparece.
  partes.push(
    `<linearGradient id="${id}v" x1="0" y1="0" x2="1" y2="0">`
      + `<stop offset="0" stop-color="${vidrio.borde}"/>`
      + `<stop offset="0.2" stop-color="${vidrio.claro}"/>`
      + `<stop offset="0.55" stop-color="${vidrio.medio}"/>`
      + `<stop offset="0.86" stop-color="${vidrio.sombra}"/>`
      + `<stop offset="1" stop-color="${vidrio.borde}"/>`
      + `</linearGradient>`,
  );
  partes.push(`<linearGradient id="${id}q" x1="0" y1="0" x2="1" y2="0">`
    + `<stop offset="0" stop-color="${liquido}"/>`
    + `<stop offset="1" stop-color="${liquido}"/>`
    + `</linearGradient>`);
  partes.push(`<linearGradient id="${id}t" x1="0" y1="0" x2="1" y2="0">`
    + `<stop offset="0" stop-color="${tinta}"/>`
    + `<stop offset="1" stop-color="${tinta}"/>`
    + `</linearGradient>`);
  /*
   * El volumen. Un envase es un cilindro, y lo que lo dice no son dos franjas
   * blancas sino una sola rampa: sombra en el canto izquierdo, brillo especular
   * a un cuarto del ancho, medio tono al centro y sombra creciente a la derecha.
   * Con esto la etiqueta y el líquido reciben la MISMA luz, que es lo que hace
   * que se lean como un objeto y no como calcomanías apiladas.
   */
  partes.push(
    `<linearGradient id="${id}s" x1="0" y1="0" x2="1" y2="0">`
      + `<stop offset="0" stop-color="#000000" stop-opacity="0.34"/>`
      + `<stop offset="0.07" stop-color="#000000" stop-opacity="0.1"/>`
      + `<stop offset="0.15" stop-color="#FFFFFF" stop-opacity="0.28"/>`
      + `<stop offset="0.24" stop-color="#FFFFFF" stop-opacity="0.55"/>`
      + `<stop offset="0.33" stop-color="#FFFFFF" stop-opacity="0.16"/>`
      + `<stop offset="0.5" stop-color="#FFFFFF" stop-opacity="0"/>`
      + `<stop offset="0.68" stop-color="#000000" stop-opacity="0.08"/>`
      + `<stop offset="0.87" stop-color="#000000" stop-opacity="0.24"/>`
      + `<stop offset="1" stop-color="#000000" stop-opacity="0.4"/>`
      + `</linearGradient>`,
  );
  partes.push(`<clipPath id="${id}c"><path d="${silueta}"/></clipPath>`);
  partes.push(`</defs>`);

  // La sombra de apoyo: sin ella el envase flota y la lámina se ve pegoteada.
  partes.push(
    `<ellipse cx="${n(cx)}" cy="${n(abajo + alto * 0.028)}" rx="${n(semiAncho * 1.06)}" ry="${n(alto * 0.026)}" fill="#0B0D10" opacity="0.13"/>`,
  );

  const ancho2 = semiAncho * 2.2;
  const x0 = cx - semiAncho * 1.1;

  if (esLata) {
    // Una lata está impresa: el cuerpo ES el color de la línea.
    partes.push(`<path d="${silueta}" fill="url(#${id}t)"/>`);
    partes.push(`<g clip-path="url(#${id}c)">`);
    // Una sola franja de acento. Dos convertían la lata en un toldo.
    partes.push(
      `<rect x="${n(x0)}" y="${n(arriba + alto * 0.615)}" width="${n(ancho2)}" height="${n(alto * 0.055)}" fill="${acento}" opacity="0.92"/>`,
    );
    // Aluminio arriba y abajo: el cuello y el fondo sin imprimir.
    partes.push(`<rect x="${n(x0)}" y="${n(arriba)}" width="${n(ancho2)}" height="${n(alto * 0.045)}" fill="#C6CBD1"/>`);
    partes.push(
      `<rect x="${n(x0)}" y="${n(abajo - alto * 0.036)}" width="${n(ancho2)}" height="${n(alto * 0.036)}" fill="#B4BAC1"/>`,
    );
    partes.push(`</g>`);
    // Tapa: el óvalo del borde y la anilla.
    partes.push(
      `<ellipse cx="${n(cx)}" cy="${n(arriba + alto * 0.013)}" rx="${n(semiAncho * 0.86)}" ry="${n(alto * 0.017)}" fill="#D9DDE2" stroke="#A7ADB4" stroke-width="${n(Math.max(2, ancho * 0.012))}"/>`,
    );
    partes.push(
      `<ellipse cx="${n(cx)}" cy="${n(arriba + alto * 0.015)}" rx="${n(semiAncho * 0.5)}" ry="${n(alto * 0.01)}" fill="none" stroke="#9BA2AA" stroke-width="${n(Math.max(1.5, ancho * 0.008))}"/>`,
    );
  } else {
    // Envase transparente: primero el vidrio, después el líquido recortado.
    partes.push(`<path d="${silueta}" fill="url(#${id}v)"/>`);
    const nivel = arriba + alto * (NIVEL_LIQUIDO[envase] ?? 0.2);
    partes.push(
      `<g clip-path="url(#${id}c)">`
        + `<rect x="${n(x0)}" y="${n(nivel)}" width="${n(ancho2)}" height="${n(abajo - nivel)}" fill="url(#${id}q)" opacity="0.94"/>`
        + `</g>`,
    );
    // Etiqueta: una banda con su canto claro arriba y abajo —así se lee como
    // papel pegado al envase— y una sola franja de acento.
    partes.push(
      `<g clip-path="url(#${id}c)">`
        + `<rect x="${n(x0)}" y="${n(etiquetaY)}" width="${n(ancho2)}" height="${n(etiquetaAlto)}" fill="url(#${id}t)"/>`
        + `<rect x="${n(x0)}" y="${n(etiquetaY + etiquetaAlto * 0.79)}" width="${n(ancho2)}" height="${n(etiquetaAlto * 0.1)}" fill="${acento}" opacity="0.88"/>`
        + `<rect x="${n(x0)}" y="${n(etiquetaY)}" width="${n(ancho2)}" height="${n(etiquetaAlto * 0.035)}" fill="#FFFFFF" opacity="0.34"/>`
        + `<rect x="${n(x0)}" y="${n(etiquetaY + etiquetaAlto * 0.965)}" width="${n(ancho2)}" height="${n(etiquetaAlto * 0.035)}" fill="#000000" opacity="0.16"/>`
        + `</g>`,
    );
    // Tapa y anillo de seguridad.
    const tapaAlto = alto * (envase === 'sifon' ? 0.055 : 0.05);
    const tapaAncho = semiAncho * perfil[0][1] * 2.06;
    partes.push(
      `<rect x="${n(cx - tapaAncho / 2)}" y="${n(arriba - alto * 0.004)}" width="${n(tapaAncho)}" height="${n(tapaAlto)}" rx="${n(tapaAncho * 0.12)}" fill="${tapa}"/>`,
    );
    partes.push(
      `<rect x="${n(cx - tapaAncho / 2)}" y="${n(arriba + tapaAlto * 0.62)}" width="${n(tapaAncho)}" height="${n(tapaAlto * 0.3)}" fill="#000" opacity="0.14"/>`,
    );
    if (envase === 'sifon') {
      // El cabezal, la palanca y el pico. Sin esto un sifón es una botella más,
      // y la soda de sifón es justamente el producto que se reconoce por acá.
      const collarY = arriba + alto * 0.048;
      const collarAlto = alto * 0.055;
      partes.push(
        `<rect x="${n(cx - tapaAncho * 0.72)}" y="${n(collarY)}" width="${n(tapaAncho * 1.44)}" height="${n(collarAlto)}" rx="${n(tapaAncho * 0.18)}" fill="#C6CBD1" stroke="#9BA2AA" stroke-width="${n(Math.max(1.5, ancho * 0.006))}"/>`,
      );
      const picoY = collarY + collarAlto * 0.34;
      partes.push(
        `<path d="M ${n(cx + tapaAncho * 0.6)} ${n(picoY)} `
          + `L ${n(cx + tapaAncho * 1.85)} ${n(picoY)} `
          + `L ${n(cx + tapaAncho * 1.85)} ${n(picoY + alto * 0.052)} `
          + `L ${n(cx + tapaAncho * 1.5)} ${n(picoY + alto * 0.052)} `
          + `L ${n(cx + tapaAncho * 1.5)} ${n(picoY + alto * 0.022)} `
          + `L ${n(cx + tapaAncho * 0.6)} ${n(picoY + alto * 0.022)} Z" fill="#B4BAC1"/>`,
      );
      partes.push(
        `<rect x="${n(cx - tapaAncho * 1.2)}" y="${n(collarY - alto * 0.016)}" width="${n(tapaAncho * 1.1)}" height="${n(alto * 0.018)}" rx="${n(alto * 0.009)}" fill="#9BA2AA"/>`,
      );
    }
  }

  // El volumen, sobre TODO lo dibujado: envase, líquido y etiqueta reciben la
  // misma luz y dejan de leerse como capas planas apiladas.
  partes.push(
    `<g clip-path="url(#${id}c)">`
      + `<rect x="${n(cx - semiAncho * 1.1)}" y="${n(arriba - alto * 0.02)}" width="${n(semiAncho * 2.2)}" height="${n(alto * 1.04)}" fill="url(#${id}s)"/>`
      + `</g>`,
  );
  // Contorno final: separa el envase del fondo blanco sin dibujar un borde duro.
  partes.push(
    `<path d="${silueta}" fill="none" stroke="#0B0D10" stroke-opacity="0.18" stroke-width="${n(Math.max(2, ancho * 0.01))}"/>`,
  );

  return [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${LIENZO} ${LIENZO}" width="${LIENZO}" height="${LIENZO}" role="img" aria-hidden="true">`,
    `<rect width="${LIENZO}" height="${LIENZO}" fill="#FFFFFF"/>`,
    ...partes,
    `</svg>`,
    '',
  ].join('\n');
}

/**
 * Los cuatro tonos del PET incoloro. Son fijos a propósito: el envase que TABA
 * vende es de plástico transparente, y el color se lo dan el líquido y la
 * etiqueta. Teñir el envase por marca sería inventar un dato del producto.
 */
const VIDRIO = Object.freeze({ borde: '#CBD1D7', claro: '#FAFBFC', medio: '#EFF2F4', sombra: '#D6DBE0' });

/** Huella corta y estable del SKU: da ids de gradiente únicos por archivo. */
export function hashCorto(texto) {
  let h = 0x811c9dc5;
  for (const caracter of String(texto)) {
    h ^= caracter.codePointAt(0);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(36).padStart(7, '0').slice(0, 7);
}

/** Huella del contenido: es lo que hace inmutable el nombre del archivo. */
export function huellaContenido(texto) {
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193;
  for (let i = 0; i < texto.length; i += 1) {
    const c = texto.charCodeAt(i);
    h1 ^= c;
    h1 = Math.imul(h1, 0x01000193) >>> 0;
    h2 = Math.imul(h2 ^ c, 0x85ebca6b) >>> 0;
  }
  return (h1.toString(16).padStart(8, '0') + h2.toString(16).padStart(8, '0')).slice(0, 12);
}

export const ENVASES = Object.freeze(Object.keys(PERFILES));
