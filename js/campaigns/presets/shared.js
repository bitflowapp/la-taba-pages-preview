/*
 * Piezas que comparten las escenas.
 *
 * TODO ES MARCADO ESTÁTICO. Cada función recibe datos ya validados y devuelve
 * una cadena: no crea nodos, no mide, no guarda estado. La animación entera
 * vive en `styles/campaigns.css`; acá sólo se declara QUÉ hay en escena.
 *
 * Por qué importa que sea estático:
 *
 *   · El catálogo parchea el DOM por identidad (`core/stable-catalog-dom.js`) y
 *     compara el HTML como versión. Una escena que es función pura de su
 *     configuración no se vuelve a escribir en cada render.
 *   · `js/motion.js` observa todo el documento: un nodo nuevo dispara una
 *     recolección completa. Burbujas creadas en tiempo de ejecución serían una
 *     recolección por burbuja. El cupo es fijo y existe desde el primer render.
 *
 * EL ENVASE ES GENÉRICO A PROPÓSITO. Es una silueta con el color de la campaña:
 * no lleva logotipo, tipografía ni emblema de ninguna marca. Una creatividad
 * con marca tiene que salir del lote curado con procedencia registrada; acá no
 * se dibuja una.
 *
 * PERO NO ES PLANO. La primera versión pintaba el envase con rellenos lisos y
 * dos rectángulos de sombra: se leía como un ícono, no como un objeto. El
 * volumen ahora es UNA capa encima de todo lo demás —un degradado horizontal
 * que oscurece los bordes y deja una banda de luz, como en cualquier cilindro—
 * y un brillo especular que se apaga hacia las puntas. Sigue siendo un dibujo
 * que no se vuelve a pintar: lo único que se mueve es el ancla que lo lleva.
 */

const HEX_COLOR = /^#[0-9a-f]{6}$/i;

export const CAMPAIGN_VESSELS = Object.freeze(['can', 'bottle']);

export function safeColor(value, fallback) {
  const candidate = String(value || '').trim();
  return HEX_COLOR.test(candidate) ? candidate.toLowerCase() : fallback;
}

/** Mezcla un color con negro (`amount` < 0) o con blanco (`amount` > 0). */
export function shade(hex, amount) {
  const target = amount < 0 ? 0 : 255;
  const weight = Math.min(1, Math.abs(amount));
  const channels = [1, 3, 5].map((offset) => {
    const value = Number.parseInt(hex.slice(offset, offset + 2), 16);
    return Math.round(value + (target - value) * weight).toString(16).padStart(2, '0');
  });
  return `#${channels.join('')}`;
}

/**
 * `count` copias de un nodo decorativo vacío: burbujas, gotas, partículas.
 * Cada copia lleva su número en la clase (`cmp-b cmp-b--1`), así la hoja de
 * estilos las distingue sin depender del orden de sus hermanos.
 */
export function repeat(base, count, variant = '') {
  const group = variant ? ` ${base}--${variant}` : '';
  return Array.from({ length: count }, (_, index) => (
    `<i class="${base}${group} ${base}--${variant}${index + 1}"></i>`
  )).join('');
}

/**
 * El identificador de una escena dentro del documento.
 *
 * Los degradados de un SVG se referencian por `id`, y los `id` son del
 * documento entero: la misma campaña puede estar a la vez en la home y en la
 * grilla, y una de las dos vistas siempre está oculta. Una referencia que cae
 * en un `<defs>` dentro de un subárbol con `display: none` no pinta nada. Cada
 * pieza lleva los suyos.
 */
export function sceneId(value) {
  const clean = String(value ?? '').toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '');
  return clean || 'scene';
}

/* El volumen de un cilindro, de izquierda a derecha: borde en sombra, banda de
   luz, caída suave y el otro borde, más oscuro. Sólo alfa sobre negro y blanco:
   funciona encima de cualquier color de campaña. */
const VOLUME_STOPS = `
      <stop offset="0" stop-color="#000" stop-opacity=".5"/>
      <stop offset=".16" stop-color="#000" stop-opacity=".08"/>
      <stop offset=".3" stop-color="#fff" stop-opacity=".26"/>
      <stop offset=".44" stop-color="#fff" stop-opacity="0"/>
      <stop offset=".72" stop-color="#000" stop-opacity=".2"/>
      <stop offset="1" stop-color="#000" stop-opacity=".58"/>`;

/* El brillo especular: fuerte en el medio, nada en las puntas. */
const GLINT_STOPS = `
      <stop offset="0" stop-color="#fff" stop-opacity="0"/>
      <stop offset=".28" stop-color="#fff" stop-opacity=".62"/>
      <stop offset=".7" stop-color="#fff" stop-opacity=".3"/>
      <stop offset="1" stop-color="#fff" stop-opacity="0"/>`;

function vesselDefs(uid) {
  return `<defs>
      <linearGradient id="${uid}-vol" x1="0" y1="0" x2="1" y2="0">${VOLUME_STOPS}</linearGradient>
      <linearGradient id="${uid}-glint" x1="0" y1="0" x2="0" y2="1">${GLINT_STOPS}</linearGradient>
    </defs>`;
}

// Las siluetas se escriben una vez: el relleno y la capa de volumen usan el
// MISMO trazo, así la luz nunca pinta fuera del envase.
const CAN_BODY = 'M7 6h30a5 5 0 0 1 5 5v70a5 5 0 0 1-5 5H7a5 5 0 0 1-5-5V11a5 5 0 0 1 5-5z';
const CAN_LID = 'M9.5 0h25l5.5 8H4z';
const CAN_FOOT = 'M3.5 84h37l-4.5 8H8z';
const BOTTLE_BODY = 'M15.4 7h9.2v25c0 9 11.4 12.4 11.4 27.4v57.1a6.5 6.5 0 0 1-6.5 6.5h-19a6.5 6.5 0 0 1-6.5-6.5V59.4c0-15 11.4-18.4 11.4-27.4z';

const VESSEL_ART = Object.freeze({
  can: (uid) => `<svg class="cmp-vessel-art" viewBox="0 0 44 92" focusable="false">
      ${vesselDefs(uid)}
      <path class="cmp-v-metal" d="${CAN_LID}"/>
      <path class="cmp-v-rim" d="M10.5 2.6h23"/>
      <path class="cmp-v-metal" d="${CAN_FOOT}"/>
      <path class="cmp-v-body" d="${CAN_BODY}"/>
      <rect class="cmp-v-band" x="2" y="34" width="40" height="24"/>
      <rect class="cmp-v-mark" x="2" y="43.5" width="40" height="5"/>
      <path class="cmp-v-volume" fill="url(#${uid}-vol)" d="${CAN_LID}${CAN_FOOT}${CAN_BODY}"/>
      <rect class="cmp-v-glint" fill="url(#${uid}-glint)" x="11.8" y="9" width="3.2" height="74" rx="1.6"/>
    </svg>`,
  bottle: (uid) => `<svg class="cmp-vessel-art" viewBox="0 0 40 124" focusable="false">
      ${vesselDefs(uid)}
      <path class="cmp-v-body" d="${BOTTLE_BODY}"/>
      <rect class="cmp-v-band" x="15.4" y="12" width="9.2" height="12"/>
      <rect class="cmp-v-label" x="4" y="70" width="32" height="27"/>
      <rect class="cmp-v-mark" x="4" y="80.5" width="32" height="6"/>
      <rect class="cmp-v-cap" x="13.6" y="0" width="12.8" height="8.4" rx="2"/>
      <path class="cmp-v-volume" fill="url(#${uid}-vol)" d="${BOTTLE_BODY}"/>
      <rect class="cmp-v-glint" fill="url(#${uid}-glint)" x="10.4" y="52" width="2.8" height="62" rx="1.4"/>
    </svg>`,
});

/**
 * El envase de la campaña: un ancla en el punto de vertido y, adentro, la
 * silueta. El ancla es lo que se mueve; la silueta nunca se vuelve a pintar.
 * `extra` son las capas que viajan con el envase (escarcha, gotas, brillo).
 */
export function actorMarkup(vessel, extra = '', uid = 'scene', packshot = null) {
  const kind = CAMPAIGN_VESSELS.includes(vessel) ? vessel : 'can';
  const escape = value => String(value || '').replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
  if (packshot) {
    const layout = packshot.layout;
    const style = layout ? ` style="--cmp-img-scale:${layout.scale};--cmp-img-x:${layout.x};--cmp-img-y:${layout.y};--cmp-img-clip:inset(${layout.clip.map(n => `${n}%`).join(' ')})"` : '';
    return `<span class="cmp-actor cmp-actor--${kind} cmp-actor--photo${layout ? ' cmp-actor--bounded' : ''}${packshot.official ? '' : ' cmp-actor--fallback'}"${style}>
      <span class="cmp-vessel"><img class="cmp-packshot" src="${escape(packshot.src)}"${packshot.master ? ` srcset="${escape(packshot.src)} 400w, ${escape(packshot.master)} 1000w" sizes="(max-width: 700px) 110px, 150px"` : ''} width="400" height="400" alt="${escape(packshot.official ? packshot.name : 'Producto sin imagen oficial: ' + packshot.name)}" loading="lazy" decoding="async" data-campaign-image /></span>
    </span>`;
  }
  return `<span class="cmp-actor cmp-actor--${kind}">
      <span class="cmp-vessel">${VESSEL_ART[kind](sceneId(uid))}${extra ? `<span class="cmp-vessel-fx">${extra}</span>` : ''}</span>
    </span>`;
}

/*
 * El vaso. Las paredes son un trazo; lo que le da cuerpo es la base gruesa, el
 * borde y dos reflejos largos. `inner` es lo que va ADENTRO —el líquido, la
 * espuma, el hielo—, recortado por la forma de las paredes.
 */
const GLASS_ART = `<svg class="cmp-glass-art" viewBox="0 0 64 112" preserveAspectRatio="none" focusable="false">
    <path class="cmp-g-base" d="M9.4 98H54.6L55 104Q54.5 110 48 110H16Q9.5 110 9 104Z"/>
    <path class="cmp-g-wall" d="M2 1L9 104Q9.5 110 16 110H48Q54.5 110 55 104L62 1"/>
    <path class="cmp-g-rim" d="M2.4 1.6H61.6"/>
    <path class="cmp-g-shine" d="M9 10L13.6 88"/>
    <path class="cmp-g-shine cmp-g-shine--soft" d="M54.4 14L50.8 72"/>
  </svg>`;

export function glassMarkup(inner = '', after = '') {
  return `<span class="cmp-glass">
        <span class="cmp-glass-in">${inner}</span>
        ${GLASS_ART}
        ${after}
      </span>`;
}
