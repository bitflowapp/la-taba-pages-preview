// Fixtures técnicos para preview/demo. No representan catálogo, precio ni stock
// comercial aprobado. Producción ignora este módulo y carga sólo Supabase
// verificado. `qaFixture` conserva la separación técnica sin ensuciar la UI.
export const categories = [
  { id: 'all', name: 'Todos' },
  { id: 'promos', name: 'Promos' },
  { id: 'gaseosas', name: 'Gaseosas' },
  { id: 'aguas', name: 'Aguas' },
  { id: 'jugos', name: 'Jugos' },
  { id: 'energeticas', name: 'Energéticas' },
  { id: 'isotonicas', name: 'Isotónicas' },
  { id: 'cervezas', name: 'Cervezas' },
  { id: 'vinos-y-espumantes', name: 'Vinos y espumantes' },
  { id: 'gins-y-vodkas', name: 'Gins y vodkas' },
  { id: 'whisky-y-destilados', name: 'Whisky y destilados' },
  { id: 'picadas-y-deli', name: 'Picadas y deli' },
  { id: 'hielo-y-extras', name: 'Hielo y extras' },
];

const QA_NOTE = 'Fixture técnico QA. Sin valor comercial; no publicar.';
const ALCOHOLIC_CATEGORY_IDS = new Set([
  'cervezas',
  'vinos-y-espumantes',
  'gins-y-vodkas',
  'whisky-y-destilados',
]);
const TONE_BY_CATEGORY = Object.freeze({
  promos: 'promo',
  'picadas-y-deli': 'food',
  'hielo-y-extras': 'ice',
});
const QA_PRICES = Object.freeze({
  unit: 5000,
  specialty: 7500,
  alcoholic: 10000,
  pack: 15000,
});

const fixture = (id, name, categoryId, presentation, options = {}) => {
  const alcoholic = ALCOHOLIC_CATEGORY_IDS.has(categoryId) || options.alcoholic === true;
  return {
    id,
    name,
    description: presentation,
    categoryId,
    tone: alcoholic ? 'alcoholic' : TONE_BY_CATEGORY[categoryId] || 'drink',
    image: 'assets/products/beverage-placeholder.svg',
    price: options.price ?? QA_PRICES.unit,
    stock: options.stock ?? 10,
    available: options.available ?? true,
    featured: options.featured ?? false,
    popular: options.popular ?? false,
    badge: '',
    unit: 'unidad',
    unitLabel: presentation,
    marketNote: QA_NOTE,
    prepMinutes: 2,
    alcoholic,
    minimumAge: alcoholic ? 18 : null,
    qaFixture: true,
  };
};

export const products = [
  fixture('qa-promo-bebidas', 'Pack de bebidas', 'promos', 'Pack seleccionado', { featured: true, price: QA_PRICES.pack, stock: 8 }),
  fixture('qa-gaseosa-cola', 'Gaseosa cola', 'gaseosas', 'Botella 1,5 L', { popular: true, stock: 14 }),
  fixture('qa-gaseosa-lima-limon', 'Gaseosa lima-limón', 'gaseosas', 'Botella 1,5 L'),
  fixture('qa-agua-mineral', 'Agua mineral', 'aguas', 'Botella 1,5 L', { popular: true, stock: 20 }),
  fixture('qa-agua-con-gas', 'Agua con gas', 'aguas', 'Botella 1,5 L', { stock: 8 }),
  fixture('qa-jugo-naranja', 'Jugo de naranja', 'jugos', 'Envase 1 L', { stock: 4 }),
  fixture('qa-energetica', 'Bebida energética', 'energeticas', 'Lata 473 ml', { price: QA_PRICES.specialty, stock: 6 }),
  fixture('qa-isotonica', 'Bebida isotónica', 'isotonicas', 'Botella 500 ml', { price: QA_PRICES.specialty, stock: 7 }),
  fixture('qa-cerveza', 'Cerveza lager', 'cervezas', 'Lata 473 ml', { price: QA_PRICES.alcoholic, stock: 3 }),
  fixture('qa-vino', 'Vino tinto', 'vinos-y-espumantes', 'Botella 750 ml', { price: QA_PRICES.alcoholic, stock: 11 }),
  fixture('qa-gin', 'Gin', 'gins-y-vodkas', 'Botella 750 ml', { price: QA_PRICES.alcoholic }),
  fixture('qa-whisky', 'Whisky', 'whisky-y-destilados', 'Botella 750 ml', { price: QA_PRICES.alcoholic, stock: 9 }),
  fixture('qa-picada', 'Picada', 'picadas-y-deli', 'Unidad', { price: QA_PRICES.specialty, stock: 14 }),
  fixture('qa-hielo', 'Hielo', 'hielo-y-extras', 'Bolsa', { popular: true, stock: 0 }),
];
