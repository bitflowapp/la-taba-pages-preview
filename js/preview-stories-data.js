// Historias de la vidriera para el modo demo (`?demo=1`) y la preview.
//
// Por qué existe: `core/stories.js` es fail-closed y hoy tiene una sola fuente
// productiva —el global `TABA2_STORIES` que publicará el backend—. Sin ella el
// aro no se pinta y el acceso queda oculto, que es lo correcto en producción
// pero dejaba la home de la demo sin la superficie que la referencia usa para
// abrir. Esto la llena con el MISMO contrato que consumirá el backend, y sólo
// en demo: `state.js` siembra promociones así desde el primer día.
//
// Qué NO afirma: ninguna historia menciona precio, descuento, ranking, stock ni
// vigencia comercial. El copy es editorial y cada CTA cae en una categoría que
// existe en el catálogo, así que ninguna lleva a una pantalla vacía.
//
// Arte: lote curado y vetado en `la-taba2-beverage-catalog-home/catalog-assets/
// promos/stories`, redimensionado para móvil. Cada pieza declara su origen y su
// página fuente en `docs/catalog/promo-image-manifest.json`.
export const PREVIEW_STORY_SEED = Object.freeze([
  Object.freeze({
    id: 'story-cervezas-heineken',
    business_id: 'la-taba-2',
    title: 'Heineken bien fría',
    media_type: 'image',
    media_url: 'assets/promos/story-cervezas-heineken.webp',
    thumbnail_url: 'assets/promos/story-cervezas-heineken-thumb.webp',
    starts_at: null,
    expires_at: null,
    priority: 40,
    cta_type: 'category',
    cta_target: 'cervezas',
    is_highlight: true,
    published: true,
  }),
  Object.freeze({
    id: 'story-energizantes-monster',
    business_id: 'la-taba-2',
    title: 'Monster para la noche',
    media_type: 'image',
    media_url: 'assets/promos/story-energizantes-monster.webp',
    thumbnail_url: 'assets/promos/story-energizantes-monster-thumb.webp',
    starts_at: null,
    expires_at: null,
    priority: 30,
    cta_type: 'category',
    cta_target: 'energizantes',
    is_highlight: false,
    published: true,
  }),
  Object.freeze({
    id: 'story-mixers-schweppes',
    business_id: 'la-taba-2',
    title: 'Schweppes para mezclar',
    media_type: 'image',
    media_url: 'assets/promos/story-mixers-schweppes.webp',
    thumbnail_url: 'assets/promos/story-mixers-schweppes-thumb.webp',
    starts_at: null,
    expires_at: null,
    priority: 20,
    cta_type: 'category',
    cta_target: 'mixers',
    is_highlight: false,
    published: true,
  }),
  Object.freeze({
    id: 'story-whisky-jack-daniels',
    business_id: 'la-taba-2',
    title: "Jack Daniel's en la barra",
    media_type: 'image',
    media_url: 'assets/promos/story-whisky-jack-daniels.webp',
    thumbnail_url: 'assets/promos/story-whisky-jack-daniels-thumb.webp',
    starts_at: null,
    expires_at: null,
    priority: 10,
    cta_type: 'category',
    cta_target: 'whisky',
    is_highlight: false,
    published: true,
  }),
]);
