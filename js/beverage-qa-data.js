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
  { id: 'vinos-espumantes', name: 'Vinos y espumantes' },
  { id: 'gins-vodkas', name: 'Gins y vodkas' },
  { id: 'whisky-destilados', name: 'Whisky y destilados' },
  { id: 'picadas-deli', name: 'Picadas y deli' },
  { id: 'hielo-extras', name: 'Hielo y extras' },
];

const QA_NOTE = 'Fixture técnico QA. Sin valor comercial; no publicar.';
const fixture = (id, name, categoryId, presentation, options = {}) => ({
  id,
  name,
  description: presentation,
  categoryId,
  tone: options.alcoholic ? 'alcoholic' : 'drink',
  image: 'assets/products/qa-beverage-placeholder.svg',
  price: options.price || 1000,
  stock: options.stock ?? 10,
  available: options.available ?? true,
  featured: options.featured ?? false,
  popular: options.popular ?? false,
  badge: '',
  unit: 'unidad',
  unitLabel: presentation,
  marketNote: QA_NOTE,
  prepMinutes: 2,
  alcoholic: options.alcoholic ?? false,
  minimumAge: options.alcoholic ? 18 : null,
  qaFixture: true,
});

export const products = [
  fixture('qa-promo-bebidas', 'Pack de bebidas', 'promos', 'Pack seleccionado', { featured: true, price: 19990, stock: 8 }),
  fixture('qa-gaseosa-cola', 'Gaseosa cola', 'gaseosas', 'Botella 1,5 L', { popular: true, price: 8990, stock: 14 }),
  fixture('qa-gaseosa-lima-limon', 'Gaseosa lima-limón', 'gaseosas', 'Botella 1,5 L', { price: 10490, stock: 10 }),
  fixture('qa-agua-mineral', 'Agua mineral', 'aguas', 'Botella 1,5 L', { popular: true, price: 2900, stock: 20 }),
  fixture('qa-agua-con-gas', 'Agua con gas', 'aguas', 'Botella 1,5 L', { price: 9490, stock: 8 }),
  fixture('qa-jugo-naranja', 'Jugo de naranja', 'jugos', 'Envase 1 L', { price: 9990, stock: 4 }),
  fixture('qa-energetica', 'Bebida energética', 'energeticas', 'Lata 473 ml', { price: 27990, stock: 6 }),
  fixture('qa-isotonica', 'Bebida isotónica', 'isotonicas', 'Botella 500 ml', { price: 11490, stock: 7 }),
  fixture('qa-cerveza', 'Cerveza lager', 'cervezas', 'Lata 473 ml', { alcoholic: true, price: 10990, stock: 3 }),
  fixture('qa-vino', 'Vino tinto', 'vinos-espumantes', 'Botella 750 ml', { alcoholic: true, price: 10290, stock: 11 }),
  fixture('qa-gin', 'Gin', 'gins-vodkas', 'Botella 750 ml', { alcoholic: true, price: 11490, stock: 10 }),
  fixture('qa-whisky', 'Whisky', 'whisky-destilados', 'Botella 750 ml', { alcoholic: true, price: 15990, stock: 9 }),
  fixture('qa-picada', 'Picada', 'picadas-deli', 'Unidad', { price: 2700, stock: 14 }),
  fixture('qa-hielo', 'Hielo', 'hielo-extras', 'Bolsa', { popular: true, price: 1600, stock: 0 }),
];
