// Fixtures históricos para pruebas de dominio. No son productos comerciales ni
// se importan fuera del runner de Node (`tests/test-bootstrap.mjs`).
export const PREVIEW_CATALOG_VERSION = 'test-fixture-legacy-qa-v1';

export const categories = [
  { id: 'all', name: 'Todos' }, { id: 'promos', name: 'Promos' },
  { id: 'gaseosas', name: 'Gaseosas' }, { id: 'aguas', name: 'Aguas' },
  { id: 'jugos', name: 'Jugos' }, { id: 'energeticas', name: 'Energéticas' },
  { id: 'isotonicas', name: 'Isotónicas' }, { id: 'cervezas', name: 'Cervezas' },
  { id: 'vinos-y-espumantes', name: 'Vinos y espumantes' }, { id: 'gins-y-vodkas', name: 'Gins y vodkas' },
  { id: 'whisky-y-destilados', name: 'Whisky y destilados' }, { id: 'picadas-y-deli', name: 'Picadas y deli' },
  { id: 'hielo-y-extras', name: 'Hielo y extras' },
];

const alcoholCategories = new Set(['cervezas', 'vinos-y-espumantes', 'gins-y-vodkas', 'whisky-y-destilados']);
const make = (id, name, categoryId, { price = 5000, stock = 10, popular = false, featured = false } = {}) => ({
  id, name, sku: id, externalId: id, description: 'Fixture QA aislado', categoryId,
  price, stock, available: true, unit: 'unidad', unitLabel: 'Unidad', unitsPerPack: 1,
  image: 'assets/products/beverage-placeholder.svg', imageThumbnail: 'assets/products/beverage-placeholder.svg',
  imageShowsMultipack: false, previewCatalogApproved: false, qaFixture: true,
  alcoholic: alcoholCategories.has(categoryId), minimumAge: alcoholCategories.has(categoryId) ? 18 : null,
  popular, featured, brand: 'Fixture QA', variant: 'Test', packageType: 'lata', prepMinutes: 2,
});

export const products = [
  make('qa-promo-bebidas', 'Coca-Cola Original 1,5 L', 'gaseosas', { price: 5000, stock: 14, popular: true, featured: true }),
  make('qa-gaseosa-cola', 'Sprite 1,5 L', 'gaseosas', { price: 5000, popular: true }),
  make('qa-gaseosa-lima-limon', 'Fanta Naranja 1,5 L', 'gaseosas', { price: 5000, featured: true }),
  make('qa-energetica', 'Monster Energy Original Green 473 ml', 'energeticas', { price: 7500, stock: 6, popular: true }),
  make('qa-jugo-naranja', 'Monster Energy Mango Loco 473 ml', 'energeticas', { price: 7500, stock: 4, featured: true }),
  make('qa-isotonica', 'Monster Energy Ultra White Zero 473 ml', 'energeticas', { price: 7500, stock: 6 }),
  make('qa-picada', 'Monster Energy Ultra Peachy Keen 473 ml', 'energeticas', { price: 7500, stock: 6 }),
  make('qa-whisky', 'Monster Energy Pipeline Punch 473 ml', 'energeticas', { price: 7500, stock: 6 }),
  make('qa-agua-con-gas', 'Pepsi Original', 'gaseosas'),
  make('qa-cerveza', 'Heineken Original 473 ml', 'cervezas', { price: 10000, stock: 3, featured: true }),
  make('qa-vino', 'Imperial Extra Lager 473 ml', 'cervezas', { price: 10000, stock: 6 }),
  make('qa-agua-mineral', 'Villavicencio Sin Gas 500 ml', 'aguas', { popular: true, stock: 12 }),
  make('qa-hielo', 'Corona Extra 355 ml', 'cervezas', { price: 10000, stock: 4 }),
  make('qa-gin', "Hendrick's Gin Original", 'gins-y-vodkas', { price: 10000, stock: 4 }),
];
