// ─────────────────────────────────────────────────────────────────────────────
// Growth engine · CATÁLOGO DE CAMPAÑAS.
// -----------------------------------------------------------------------------
// Piezas comerciales que el motor puede elegir. TODAS derivan de material ya
// existente y verificado:
//   · fotografías del lote curado (docs/catalog/promo-image-manifest.json);
//   · combos del manifiesto comercial (combos-data.js), cuyo precio y ahorro
//     calcula el backend;
//   · destinos que son categorías/marcas REALES del catálogo de autoridad.
//
// Lo que acá NO hay: precios, porcentajes, "ofertas" ni stock inventado. Una
// campaña editorial es una puerta con ganas; la única que puede afirmar plata
// es la de tipo `combo` (ahorro derivado del catálogo vivo) o `promotion`
// (respaldada por el contrato validado de core/promotions.js). El test
// growth-campaigns lo verifica palabra por palabra.
//
// Vigencias: las editoriales son evergreen (null); no vencen porque no
// prometen condición comercial. El día que Walter cargue campañas con fechas,
// este archivo es el contrato que su panel tiene que llenar.
//
// La elegibilidad es fail-closed sola: una campaña de fernet no aparece hasta
// que fernet publique precios, igual que hoy no aparece su banner. No hace
// falta apagarla a mano.

export const GROWTH_CAMPAIGNS = Object.freeze([
  // ── HERO ───────────────────────────────────────────────────────────────────
  // La pieza por defecto es la MISMA que la vidriera actual: en cold start el
  // storefront se ve exactamente como hoy (esa experiencia ya está auditada).
  Object.freeze({
    id: 'hero-cervezas',
    enabled: true,
    kind: 'editorial',
    placements: ['hero'],
    categoryIds: ['cervezas'],
    priority: 60,
    contexts: [],
    creative: {
      eyebrow: 'La vidriera',
      title: 'Bien fría, como tiene que ser',
      subtitle: 'La selección de cervezas del local, lista para llevar.',
      // Sin image/bandImage: usa la fotografía por defecto del CSS y conserva
      // el preload del shell (tests/home-hero-preload.test.mjs).
      ctaLabel: 'Ver cervezas',
    },
    cta: 'category',
  }),
  Object.freeze({
    id: 'hero-combo-noche-larga',
    enabled: true,
    kind: 'combo',
    placements: ['hero'],
    categoryIds: ['cervezas', 'energizantes'],
    comboId: 'combo-noche-larga',
    priority: 50,
    contexts: ['evening', 'night', 'friday', 'weekend'],
    creative: {
      eyebrow: 'Combo del local',
      title: 'La noche viene larga',
      subtitle: 'Cuatro Heineken y dos Red Bull, listos para salir.',
      image: 'assets/promos/cervezas-heineken-botella-band.webp',
      ctaLabel: 'Ver combo',
    },
    cta: 'combo',
  }),
  Object.freeze({
    id: 'hero-energizantes',
    enabled: true,
    kind: 'editorial',
    placements: ['hero'],
    categoryIds: ['energizantes'],
    priority: 45,
    contexts: ['morning', 'night'],
    creative: {
      eyebrow: 'Energía',
      title: 'Para lo que venga',
      subtitle: 'Energizantes fríos, al toque.',
      image: 'assets/promos/energizantes-red-bull-band.webp',
      ctaLabel: 'Ver energizantes',
    },
    cta: 'category',
  }),
  Object.freeze({
    id: 'hero-fernet',
    enabled: true,
    kind: 'editorial',
    placements: ['hero'],
    categoryIds: ['fernet'],
    priority: 40,
    contexts: ['evening', 'friday', 'weekend'],
    creative: {
      eyebrow: 'Clásico argentino',
      title: 'El clásico no se discute',
      subtitle: 'Fernet y todo lo que lo acompaña.',
      image: 'assets/promos/fernet-brancamenta.jpg',
      focus: '50% 48%',
      ctaLabel: 'Ver fernet',
    },
    cta: 'category',
  }),
  Object.freeze({
    id: 'hero-destilados',
    enabled: true,
    kind: 'editorial',
    placements: ['hero'],
    categoryIds: ['destilados'],
    priority: 35,
    contexts: ['evening', 'night'],
    creative: {
      eyebrow: 'Selección premium',
      title: 'Para tomar despacio',
      subtitle: 'Whisky, gin y destilados elegidos por el local.',
      image: 'assets/promos/whisky-chivas-band.webp',
      ctaLabel: 'Ver destilados',
    },
    cta: 'category',
  }),
  Object.freeze({
    id: 'hero-mixers',
    enabled: true,
    kind: 'editorial',
    placements: ['hero'],
    categoryIds: ['mixers'],
    priority: 28,
    contexts: [],
    creative: {
      eyebrow: 'Para mezclar',
      title: 'El secreto está en el mixer',
      subtitle: 'Tónicas, sodas y todo para armar el tuyo.',
      image: 'assets/promos/mixers-schweppes-band.webp',
      ctaLabel: 'Ver mixers',
    },
    cta: 'category',
  }),

  // ── PUERTAS (banners intercalados de la home) ─────────────────────────────
  // Mismo material curado que HOME_BANNER_COPY, ahora como campañas: el orden
  // deja de ser una lista fija y pasa a decidirlo la intención. El copy y el
  // punto focal de cada pieza vienen de la curaduría original.
  Object.freeze({
    id: 'door-cervezas',
    enabled: true,
    kind: 'editorial',
    placements: ['door'],
    categoryIds: ['cervezas'],
    priority: 60,
    contexts: [],
    creative: {
      eyebrow: 'Para el finde',
      title: 'Cervezas bien frías',
      image: 'assets/promos/cervezas-patagonia-door.webp',
      focus: '50% 62%',
      ctaLabel: 'Ver cervezas',
    },
    cta: 'category',
  }),
  Object.freeze({
    id: 'door-heineken',
    enabled: true,
    kind: 'editorial',
    placements: ['door'],
    categoryIds: ['cervezas'],
    brand: 'Heineken',
    priority: 45,
    contexts: [],
    creative: {
      eyebrow: 'La marca',
      title: 'Heineken bien fría',
      image: 'assets/promos/cervezas-heineken-botella-door.webp',
      focus: '50% 45%',
      ctaLabel: 'Ver Heineken',
    },
    cta: 'brand',
  }),
  Object.freeze({
    id: 'door-andes-origen',
    enabled: true,
    kind: 'editorial',
    placements: ['door'],
    categoryIds: ['cervezas'],
    brand: 'Andes Origen',
    priority: 30,
    contexts: [],
    creative: {
      eyebrow: 'De la Patagonia',
      title: 'Andes Origen',
      image: 'assets/promos/cervezas-andes-origen.webp',
      ctaLabel: 'Ver Andes Origen',
    },
    cta: 'brand',
  }),
  Object.freeze({
    id: 'door-destilados',
    enabled: true,
    kind: 'editorial',
    placements: ['door'],
    categoryIds: ['destilados'],
    priority: 55,
    contexts: [],
    creative: {
      eyebrow: 'Selección premium',
      title: 'El mejor whisky',
      image: 'assets/promos/whisky-chivas-door.webp',
      focus: '64% 55%',
      ctaLabel: 'Ver destilados',
    },
    cta: 'category',
  }),
  Object.freeze({
    id: 'door-fernet',
    enabled: true,
    kind: 'editorial',
    placements: ['door'],
    categoryIds: ['fernet'],
    priority: 50,
    contexts: ['evening', 'friday', 'weekend'],
    creative: {
      eyebrow: 'Clásico argentino',
      title: 'Fernet y amargos',
      image: 'assets/promos/fernet-brancamenta.jpg',
      focus: '50% 48%',
      ctaLabel: 'Ver fernet',
    },
    cta: 'category',
  }),
  Object.freeze({
    id: 'door-gin',
    enabled: true,
    kind: 'editorial',
    placements: ['door'],
    categoryIds: ['destilados'],
    priority: 40,
    contexts: ['evening', 'night'],
    creative: {
      eyebrow: 'Destilados',
      title: 'Gin y tónicas',
      image: 'assets/promos/gin-tanqueray-door.webp',
      focus: '62% 52%',
      ctaLabel: 'Ver destilados',
    },
    cta: 'category',
  }),
  Object.freeze({
    id: 'door-vinos',
    enabled: true,
    kind: 'editorial',
    placements: ['door'],
    categoryIds: ['vinos'],
    priority: 38,
    contexts: [],
    creative: {
      eyebrow: 'Bodega',
      title: 'Vinos para la mesa',
      ctaLabel: 'Ver vinos',
    },
    cta: 'category',
  }),
  Object.freeze({
    id: 'door-aperitivos',
    enabled: true,
    kind: 'editorial',
    placements: ['door'],
    categoryIds: ['aperitivos'],
    priority: 36,
    contexts: ['evening', 'friday', 'weekend'],
    creative: {
      eyebrow: 'La previa',
      title: 'Aperitivos y vermús',
      image: 'assets/promos/aperitivos-gancia-door.webp',
      ctaLabel: 'Ver aperitivos',
    },
    cta: 'category',
  }),
  Object.freeze({
    id: 'door-energizantes',
    enabled: true,
    kind: 'editorial',
    placements: ['door'],
    categoryIds: ['energizantes'],
    priority: 34,
    contexts: [],
    creative: {
      eyebrow: 'Energía',
      title: 'Energizantes fríos',
      image: 'assets/promos/energizantes-red-bull-door.webp',
      focus: '48% 55%',
      ctaLabel: 'Ver energizantes',
    },
    cta: 'category',
  }),
  Object.freeze({
    id: 'door-mixers',
    enabled: true,
    kind: 'editorial',
    placements: ['door'],
    categoryIds: ['mixers'],
    priority: 32,
    contexts: [],
    creative: {
      eyebrow: 'Para mezclar',
      title: 'Tónicas y mixers',
      image: 'assets/promos/mixers-schweppes-door.webp',
      ctaLabel: 'Ver mixers',
    },
    cta: 'category',
  }),
  Object.freeze({
    id: 'door-gaseosas',
    enabled: true,
    kind: 'editorial',
    placements: ['door'],
    categoryIds: ['gaseosas'],
    priority: 26,
    contexts: [],
    creative: {
      eyebrow: 'Siempre en casa',
      title: 'Gaseosas y packs',
      ctaLabel: 'Ver gaseosas',
    },
    cta: 'category',
  }),
  Object.freeze({
    id: 'door-aguas',
    enabled: true,
    kind: 'editorial',
    placements: ['door'],
    categoryIds: ['aguas'],
    priority: 22,
    contexts: ['morning', 'afternoon'],
    creative: {
      eyebrow: 'Hidratación',
      title: 'Aguas y sodas',
      ctaLabel: 'Ver aguas',
    },
    cta: 'category',
  }),
  Object.freeze({
    id: 'door-hielo',
    enabled: true,
    kind: 'editorial',
    placements: ['door'],
    categoryIds: ['hielo'],
    priority: 20,
    contexts: ['evening', 'night', 'friday', 'weekend'],
    creative: {
      eyebrow: 'Complementos',
      title: 'Que no falte el hielo',
      ctaLabel: 'Ver hielo',
    },
    cta: 'category',
  }),

  // ── EN CATÁLOGO (pieza única dentro de la grilla) ─────────────────────────
  // La regla del placement la aplica placements.js: nunca la categoría que ya
  // se está mirando (salvo combos, que son un armado, no una repetición), y
  // las de `requiresIntent` sólo con afinidad real.
  Object.freeze({
    id: 'inline-combo-heineken-x6',
    enabled: true,
    kind: 'combo',
    placements: ['catalog-inline'],
    categoryIds: ['cervezas'],
    comboId: 'combo-heineken-x6',
    priority: 55,
    contexts: [],
    creative: {
      eyebrow: 'Combo del local',
      title: 'Heineken por seis',
      subtitle: 'La verde, por media docena.',
      ctaLabel: 'Ver combo',
    },
    cta: 'combo',
  }),
  Object.freeze({
    id: 'inline-combo-speed-x4',
    enabled: true,
    kind: 'combo',
    placements: ['catalog-inline'],
    categoryIds: ['energizantes'],
    comboId: 'combo-cuatro-para-arrancar',
    priority: 45,
    contexts: [],
    creative: {
      eyebrow: 'Combo del local',
      title: 'Speed por cuatro',
      subtitle: 'Sin alcohol. Para aguantar lo que sea.',
      ctaLabel: 'Ver combo',
    },
    cta: 'combo',
  }),
  Object.freeze({
    id: 'inline-hielo',
    enabled: true,
    kind: 'editorial',
    placements: ['catalog-inline'],
    categoryIds: ['hielo'],
    priority: 40,
    contexts: [],
    creative: {
      eyebrow: 'No te olvides',
      title: 'El hielo va aparte',
      subtitle: 'Bolsas listas para tu pedido.',
      ctaLabel: 'Ver hielo',
    },
    cta: 'category',
  }),
  Object.freeze({
    id: 'inline-gaseosas-fernet',
    enabled: true,
    kind: 'editorial',
    placements: ['catalog-inline'],
    categoryIds: ['gaseosas'],
    priority: 38,
    contexts: [],
    creative: {
      eyebrow: 'Para acompañar',
      title: 'La otra mitad del vaso',
      subtitle: 'Gaseosas frías para completar tu pedido.',
      ctaLabel: 'Ver gaseosas',
    },
    cta: 'category',
  }),
  Object.freeze({
    id: 'inline-cervezas-afinidad',
    enabled: true,
    kind: 'editorial',
    placements: ['catalog-inline'],
    categoryIds: ['cervezas'],
    priority: 30,
    contexts: [],
    requiresIntent: 'category',
    creative: {
      eyebrow: 'Lo tuyo son las birras',
      title: 'Las cervezas te esperan frías',
      image: 'assets/promos/cervezas-patagonia-door.webp',
      focus: '50% 62%',
      ctaLabel: 'Ver cervezas',
    },
    cta: 'category',
  }),
]);
