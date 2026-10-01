/*
 * Piezas que comparten las cuatro escenas.
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

const VESSEL_ART = Object.freeze({
  can: `<svg class="cmp-vessel-art" viewBox="0 0 44 92" focusable="false">
      <path class="cmp-v-metal" d="M9 0h26l5 8H4z"/>
      <path class="cmp-v-rim" d="M10 2.500h24"/>
      <rect class="cmp-v-body" x="2" y="6" width="40" height="80" rx="5"/>
      <path class="cmp-v-metal" d="M3 84h38l-4 8H7z"/>
      <rect class="cmp-v-band" x="2" y="33" width="40" height="26"/>
      <circle class="cmp-v-mark" cx="22" cy="46" r="6.5"/>
      <rect class="cmp-v-shade" x="2" y="6" width="5" height="80" rx="2.5"/>
      <rect class="cmp-v-shade" x="30" y="6" width="12" height="80" rx="5"/>
      <rect class="cmp-v-shade" x="37" y="6" width="5" height="80" rx="2.5"/>
      <rect class="cmp-v-shine" x="9" y="10" width="3.6" height="72" rx="1.8"/>
      <rect class="cmp-v-shine cmp-v-shine--soft" x="14.5" y="12" width="2.4" height="68" rx="1.2"/>
    </svg>`,
  bottle: `<svg class="cmp-vessel-art" viewBox="0 0 40 124" focusable="false">
      <path class="cmp-v-body" d="M15 6h10v25c0 8 11 12 11 27v58a6 6 0 0 1-6 6H10a6 6 0 0 1-6-6V58c0-15 11-19 11-27z"/>
      <rect class="cmp-v-cap" x="13.5" y="0" width="13" height="8" rx="2"/>
      <rect class="cmp-v-band" x="15" y="13" width="10" height="10"/>
      <rect class="cmp-v-label" x="7" y="70" width="26" height="28" rx="3"/>
      <circle class="cmp-v-mark" cx="20" cy="84" r="6"/>
      <path class="cmp-v-shade" d="M28 45c5 4 8 8 8 13v58a6 6 0 0 1-6 6h-2z"/>
      <path class="cmp-v-shade" d="M4 58c0-5 2-9 4-12v70a6 6 0 0 1-4-6z"/>
      <rect class="cmp-v-shine" x="9.5" y="56" width="2.8" height="58" rx="1.4"/>
      <rect class="cmp-v-shine cmp-v-shine--soft" x="16.5" y="9" width="1.8" height="20" rx="0.9"/>
    </svg>`,
});

/**
 * El envase de la campaña: un ancla en el punto de vertido y, adentro, la
 * silueta. El ancla es lo que se mueve; la silueta nunca se vuelve a pintar.
 * `extra` son las capas que viajan con el envase (escarcha, gotas, brillo).
 */
export function actorMarkup(vessel, extra = '') {
  const kind = CAMPAIGN_VESSELS.includes(vessel) ? vessel : 'can';
  return `<span class="cmp-actor cmp-actor--${kind}">
      <span class="cmp-vessel">${VESSEL_ART[kind]}${extra ? `<span class="cmp-vessel-fx">${extra}</span>` : ''}</span>
    </span>`;
}
