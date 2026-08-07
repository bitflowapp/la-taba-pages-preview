// Historias de la vidriera para el modo demo (`?demo=1`) y la preview.
//
// Por qué existe: `core/stories.js` es fail-closed y su fuente productiva es el
// global `TABA2_STORIES` que publicará el backend. Sin ella el aro no se pinta
// y el acceso queda oculto, que es lo correcto en producción pero dejaba la home
// de la demo sin la superficie que la referencia usa para abrir. Esto la llena
// con el MISMO contrato que consumirá el backend, y sólo en demo.
//
// También es la semilla del Panel: la primera vez que se abre Marketing →
// Historias en demo, estas cuatro son las que se pueden editar, reordenar y
// programar. Desde la primera edición manda el almacén y esto no se vuelve a
// leer (`core/story-store.js`).
//
// Qué NO afirma: ninguna historia menciona precio, descuento, ranking, stock ni
// vigencia comercial. El copy describe el envase —dato que sale del catálogo— y
// cada CTA cae en un destino que EXISTE y es comprable hoy en la demo, así que
// ninguna lleva a una pantalla vacía. Las cuatro CTA del contrato comercial
// están representadas una vez cada una.
//
// El +18 no se declara acá aunque dos destinos sean alcohólicos: se DERIVA del
// catálogo en `core/story-destination.js`. Declararlo sería una copia que puede
// quedar desactualizada; derivarlo no puede.
//
// Arte: lote curado y vetado en `la-taba2-beverage-catalog-home/catalog-assets/
// promos/stories`, redimensionado para móvil. Cada pieza declara su origen y su
// página fuente en `docs/catalog/promo-image-manifest.json`.
export const PREVIEW_STORY_SEED = Object.freeze([
  Object.freeze({
    id: 'story-cervezas-heineken',
    business_id: 'la-taba-2',
    title: 'Heineken bien fría',
    body: 'La lata de 473 ml, lista para la heladera.',
    media_type: 'image',
    media_url: 'assets/promos/story-cervezas-heineken.webp',
    thumbnail_url: 'assets/promos/story-cervezas-heineken-thumb.webp',
    starts_at: null,
    expires_at: null,
    sort_order: 1,
    cta_type: 'product',
    cta_target: 'heineken-original-lata-473ml',
    enabled: true,
  }),
  Object.freeze({
    id: 'story-combo-heineken-x6',
    business_id: 'la-taba-2',
    title: 'Heineken por seis',
    body: 'Seis latas juntas, armadas por el local.',
    media_type: 'image',
    media_url: 'assets/promos/cervezas-heineken-botella.jpg',
    thumbnail_url: 'assets/promos/cervezas-heineken-botella.jpg',
    starts_at: null,
    expires_at: null,
    sort_order: 2,
    cta_type: 'combo',
    cta_target: 'combo-heineken-x6',
    enabled: true,
  }),
  Object.freeze({
    id: 'story-energizantes-monster',
    business_id: 'la-taba-2',
    title: 'Monster para la noche',
    body: 'Mango Loco en lata de 473 ml.',
    media_type: 'image',
    media_url: 'assets/promos/story-energizantes-monster.webp',
    thumbnail_url: 'assets/promos/story-energizantes-monster-thumb.webp',
    starts_at: null,
    expires_at: null,
    sort_order: 3,
    cta_type: 'buy',
    cta_target: 'monster-mango-loco-lata-473ml',
    enabled: true,
  }),
  // El rubro tiene que tener algo comprable HOY o la historia no se publica.
  // La semilla anterior apuntaba a `mixers` y a `whisky`, y en el catálogo del
  // piloto los dos están enteros en "precio próximamente": las dos historias se
  // apagaban solas y la vidriera quedaba con la mitad de lo que declaraba.
  //
  // El arte también tiene que ser honesto: la foto de Patagonia muestra una
  // cerveza sin precio ni stock, y la tarjeta de Andes Origen es una receta de
  // marca con un botón "DESCARGUE" impreso adentro —un control falso dentro de
  // una superficie táctil—. Esta usa el mismo packshot que ya encabeza el rubro
  // de energizantes en la home, y los cuatro productos de ese rubro sí se
  // pueden comprar.
  Object.freeze({
    id: 'story-energizantes-rubro',
    business_id: 'la-taba-2',
    title: 'Toda la energía',
    body: 'El rubro completo, tal como está en la góndola.',
    media_type: 'image',
    media_url: 'assets/promos/energizantes-red-bull.jpg',
    thumbnail_url: 'assets/promos/energizantes-red-bull.jpg',
    starts_at: null,
    expires_at: null,
    sort_order: 4,
    cta_type: 'category',
    cta_target: 'energizantes',
    enabled: true,
  }),
]);
