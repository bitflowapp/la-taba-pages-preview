// Fixtures técnicos para preview/demo. No representan catálogo, precio ni stock
// comercial aprobado. Producción ignora este módulo y carga sólo Supabase
// verificado; todos los nombres incluyen QA para evitar confusión.
export const categories = [
  { id: 'all', name: 'Todos' },
  { id: 'promos', name: 'Promos' },
  { id: 'pizzas', name: 'Gaseosas' },
  { id: 'bebidas', name: 'Aguas' },
  { id: 'jugos', name: 'Jugos' },
  { id: 'combos', name: 'Energéticas' },
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
  name: `${name} · QA`,
  description: QA_NOTE,
  categoryId,
  tone: options.alcoholic ? 'alcoholic' : 'drink',
  image: 'assets/products/qa-beverage-placeholder.svg',
  price: options.price || 1000,
  stock: options.stock ?? 10,
  available: options.available ?? true,
  featured: options.featured ?? false,
  popular: options.popular ?? false,
  badge: options.badge || '',
  unit: 'unidad',
  unitLabel: presentation,
  marketNote: QA_NOTE,
  prepMinutes: 2,
  alcoholic: options.alcoholic ?? false,
  minimumAge: options.alcoholic ? 18 : null,
  qaFixture: true,
});

export const products = [
  fixture('p-promo-dia', 'Promo de bebidas', 'promos', 'Pack de prueba', { featured: true, badge: 'QA', price: 19990, stock: 8 }),
  fixture('p-muzzarella', 'Gaseosa cola', 'pizzas', 'Botella 1,5 L', { popular: true, price: 8990, stock: 14 }),
  fixture('p-especial', 'Gaseosa lima-limón', 'pizzas', 'Botella 1,5 L', { price: 10490, stock: 10 }),
  fixture('p-coca', 'Agua mineral', 'bebidas', 'Botella 1,5 L', { popular: true, price: 2900, stock: 20 }),
  fixture('p-fugazzeta', 'Agua con gas', 'bebidas', 'Botella 1,5 L', { price: 9490, stock: 8 }),
  fixture('p-napolitana', 'Jugo', 'jugos', 'Envase 1 L', { price: 9990, stock: 4 }),
  fixture('p-combo-familiar', 'Energética', 'combos', 'Lata 473 ml', { price: 27990, stock: 6 }),
  fixture('p-pepperoni', 'Isotónica', 'isotonicas', 'Botella 500 ml', { price: 11490, stock: 7 }),
  fixture('p-calabresa', 'Cerveza', 'cervezas', 'Lata 473 ml', { alcoholic: true, price: 10990, stock: 3 }),
  fixture('p-jamon-muzzarella', 'Vino', 'vinos-espumantes', 'Botella 750 ml', { alcoholic: true, price: 10290, stock: 11 }),
  fixture('p-combo-pizza-bebida', 'Gin', 'gins-vodkas', 'Botella 750 ml', { alcoholic: true, price: 11490, stock: 10 }),
  fixture('p-promo-muzza-x2', 'Whisky', 'whisky-destilados', 'Botella 750 ml', { alcoholic: true, price: 15990, stock: 9 }),
  fixture('p-sprite', 'Picada', 'picadas-deli', 'Unidad', { price: 2700, stock: 14 }),
  fixture('p-agua', 'Hielo', 'hielo-extras', 'Bolsa', { popular: true, price: 1600, stock: 0 }),
];
