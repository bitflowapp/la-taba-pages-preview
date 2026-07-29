// Catálogo concreto aislado para preview/demo. Los precios y stocks son tiers QA,
// no datos productivos. Producción ignora este módulo y carga únicamente Supabase.
// Se persiste en el estado demo para refrescar identidades/imágenes cuando cambia
// el catálogo publicado, sin eliminar pedidos, carrito o preferencias compatibles.
export const PREVIEW_CATALOG_VERSION = 'preview-beverages-2026-07-28-unit-v3';

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

const QA_NOTE = 'Preview aislado. Precio y stock QA; no publicar como dato comercial.';
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
});
const PLACEHOLDER = 'assets/products/beverage-placeholder.svg';

const fixture = (id, name, categoryId, presentation, options = {}) => {
  const alcoholic = ALCOHOLIC_CATEGORY_IDS.has(categoryId) || options.alcoholic === true;
  return {
    id,
    name,
    description: presentation,
    categoryId,
    tone: alcoholic ? 'alcoholic' : TONE_BY_CATEGORY[categoryId] || 'drink',
    image: options.image || PLACEHOLDER,
    ...(options.imageThumbnail ? { imageThumbnail: options.imageThumbnail } : {}),
    ...(options.imageSha256 ? { imageSha256: options.imageSha256 } : {}),
    ...(options.imageThumbnailSha256 ? { imageThumbnailSha256: options.imageThumbnailSha256 } : {}),
    ...(options.sourceImageSha256 ? { sourceImageSha256: options.sourceImageSha256 } : {}),
    previewCatalogApproved: options.previewCatalogApproved === true,
    price: options.price ?? QA_PRICES.unit,
    oldPrice: options.oldPrice ?? null,
    homePromoBadge: options.homePromoBadge || '',
    stock: options.stock ?? 10,
    available: options.available ?? true,
    featured: options.featured ?? false,
    popular: options.popular ?? false,
    badge: '',
    unit: options.unit || 'unidad',
    unitLabel: options.unitLabel || presentation,
    marketNote: QA_NOTE,
    brand: options.brand || '',
    variant: options.variant || '',
    capacityValue: options.capacityValue ?? null,
    capacityUnit: options.capacityUnit || '',
    packageType: options.packageType || '',
    unitsPerPack: options.unitsPerPack ?? 1,
    identityStatus: options.identityStatus || 'NO_CONFIRMADA',
    rightsStatus: options.rightsStatus || 'PENDIENTE_DERECHOS',
    prepMinutes: 2,
    alcoholic,
    minimumAge: alcoholic ? 18 : null,
    qaFixture: true,
  };
};

export const products = [
  fixture('qa-promo-bebidas', 'Coca-Cola Original 1,5 L', 'gaseosas', 'Botella 1,5 L', {
    image: 'assets/catalog/products/qa-coca-cola-original-15l-aa70012decc566a8-1d824eec5604643f.webp',
    imageThumbnail: 'assets/catalog/thumbnails/qa-coca-cola-original-15l-aa70012decc566a8-thumb-ea9fe78055613651.webp',
    imageSha256: '1d824eec5604643f05cbcbf37b1b24f2e099f333fff79e2f9d5dee610075a1fb',
    imageThumbnailSha256: 'ea9fe780556136513a611c7011eee5164986b00e5ed45631802f77ab15ac4380',
    sourceImageSha256: '03ca39878bc428d8933018f5ef3cc6bc7af2842b7ac48b3237b4603f62abccfe',
    previewCatalogApproved: true, unit: 'unidad', unitLabel: 'Botella 1,5 L', price: 5000, oldPrice: 6250, homePromoBadge: '20% OFF', popular: true, featured: true, stock: 14,
    brand: 'Coca-Cola', variant: 'Original', capacityValue: 1.5, capacityUnit: 'l', packageType: 'botella', unitsPerPack: 1, identityStatus: 'EXACTA', rightsStatus: 'APROBADOS',
  }),
  fixture('qa-gaseosa-cola', 'Sprite 1,5 L', 'gaseosas', 'Botella 1,5 L', {
    image: 'assets/catalog/products/qa-sprite-15l-1989810f07a2c3ef-da1929408b8b0643.webp',
    imageThumbnail: 'assets/catalog/thumbnails/qa-sprite-15l-1989810f07a2c3ef-thumb-1676fdfe37e31ebf.webp',
    imageSha256: 'da1929408b8b06438d35250659fd79070a8915933db1c2a5cc0f0d2c5e91bb35',
    imageThumbnailSha256: '1676fdfe37e31ebf3841ae571afd50f067ee99b78d8b476ef7445eb2ae273d87',
    sourceImageSha256: '7df7ddd6b1da800aa31102b3856e2372b73354d966e1164ab07be7d39170ffa4',
    previewCatalogApproved: true, unit: 'unidad', unitLabel: 'Botella 1,5 L', price: 5000, oldPrice: 7150, homePromoBadge: '30% OFF', popular: true, stock: 10,
    brand: 'Sprite', variant: 'Original', capacityValue: 1.5, capacityUnit: 'l', packageType: 'botella', unitsPerPack: 1, identityStatus: 'EXACTA', rightsStatus: 'APROBADOS',
  }),
  fixture('qa-gaseosa-lima-limon', 'Fanta Naranja 1,5 L', 'gaseosas', 'Botella 1,5 L', {
    image: 'assets/catalog/products/qa-fanta-naranja-15l-40851f95ab71b216-e41698f0e9b8788b.webp',
    imageThumbnail: 'assets/catalog/thumbnails/qa-fanta-naranja-15l-40851f95ab71b216-thumb-6f5544d252c1151c.webp',
    imageSha256: 'e41698f0e9b8788b7472ecd777ddeab4791cc6166770630d079f52b3062e08ea',
    imageThumbnailSha256: '6f5544d252c1151c4b4b8aa477d706fc2f9014c0c801f446e589366f5a66c8a7',
    sourceImageSha256: '8a49eddb5f26bdbad98fb14085c221a37432f21a884ce4808358180987f29512',
    previewCatalogApproved: true, unit: 'unidad', unitLabel: 'Botella 1,5 L', price: 5000, oldPrice: 6250, homePromoBadge: '20% OFF', featured: true, stock: 10,
    brand: 'Fanta', variant: 'Naranja', capacityValue: 1.5, capacityUnit: 'l', packageType: 'botella', unitsPerPack: 1, identityStatus: 'EXACTA', rightsStatus: 'APROBADOS',
  }),
  fixture('qa-energetica', 'Monster Energy Original Green 473 ml', 'energeticas', 'Lata 473 ml', {
    image: 'assets/catalog/products/qa-monster-green-473ml-c7a66ed57c1f8268-0c999ce7e48f3aca.webp',
    imageThumbnail: 'assets/catalog/thumbnails/qa-monster-green-473ml-c7a66ed57c1f8268-thumb-883c78950d69aa9d.webp',
    imageSha256: '0c999ce7e48f3aca43085eeca932f4d92c22faacddc3947afdcbe8d38eb10cc2',
    imageThumbnailSha256: '883c78950d69aa9d1a0de24af2a3b6fe8fc5c8c4a8d899703f9ac00ba68c8207',
    sourceImageSha256: 'e5b6f2ac71232f0d344857c5c1402ada7d2f3ba74fadef232efb36d91cf4ba0a',
    previewCatalogApproved: true, unit: 'unidad', unitLabel: 'Lata 473 ml', price: QA_PRICES.specialty, popular: true, stock: 6,
    brand: 'Monster', variant: 'Energy Original Green', capacityValue: 473, capacityUnit: 'ml', packageType: 'lata', unitsPerPack: 1, identityStatus: 'EXACTA', rightsStatus: 'APROBADOS',
  }),
  fixture('qa-jugo-naranja', 'Monster Energy Mango Loco 473 ml', 'energeticas', 'Lata 473 ml', {
    image: 'assets/catalog/products/qa-monster-mango-loco-473ml-f4f4077ed780cebf-0477991f4448a9ef.webp',
    imageThumbnail: 'assets/catalog/thumbnails/qa-monster-mango-loco-473ml-f4f4077ed780cebf-thumb-08da803d560fb306.webp',
    imageSha256: '0477991f4448a9ef741a05dd75ad3c0754ad551a92fda33d97979671c5fd41c1',
    imageThumbnailSha256: '08da803d560fb306e02e196b0ac0594b07dbc02886ac0a1edd0d17eefa633257',
    sourceImageSha256: '8bf759c3734621d31788803e42272d27f9e3cdb658148ce0add38f063caa8b52',
    previewCatalogApproved: true, unit: 'unidad', unitLabel: 'Lata 473 ml', price: QA_PRICES.specialty, featured: true, stock: 4,
    brand: 'Monster', variant: 'Energy Mango Loco', capacityValue: 473, capacityUnit: 'ml', packageType: 'lata', unitsPerPack: 1, identityStatus: 'EXACTA', rightsStatus: 'APROBADOS',
  }),
  fixture('qa-isotonica', 'Monster Energy Ultra White Zero 473 ml', 'energeticas', 'Lata 473 ml', {
    image: 'assets/catalog/products/qa-monster-ultra-white-zero-473ml-05a05734442e6b9d-014fa5aba916e543.webp',
    imageThumbnail: 'assets/catalog/thumbnails/qa-monster-ultra-white-zero-473ml-05a05734442e6b9d-thumb-4ea566a269d72d75.webp',
    imageSha256: '014fa5aba916e543cbc06e5afc15e650608e5f0f0e50701338c98a5baa04135f',
    imageThumbnailSha256: '4ea566a269d72d753153235c2803b993eb2bca5eeae8695dfd44d1cc26899322',
    sourceImageSha256: '45b4a11cd727948f2ffc4ebda4f31e3cf39e1284c8c7c1194e028d87f4a3f856',
    previewCatalogApproved: true, unit: 'unidad', unitLabel: 'Lata 473 ml', price: QA_PRICES.specialty, stock: 6,
    brand: 'Monster', variant: 'Energy Ultra White Zero', capacityValue: 473, capacityUnit: 'ml', packageType: 'lata', unitsPerPack: 1, identityStatus: 'EXACTA', rightsStatus: 'APROBADOS',
  }),
  fixture('qa-picada', 'Monster Energy Ultra Peachy Keen 473 ml', 'energeticas', 'Lata 473 ml', {
    image: 'assets/catalog/products/qa-monster-peachy-keen-473ml-97a89797cdd192ab-847bf12caffaee31.webp',
    imageThumbnail: 'assets/catalog/thumbnails/qa-monster-peachy-keen-473ml-97a89797cdd192ab-thumb-41bf6784558dc908.webp',
    imageSha256: '847bf12caffaee31fe768c535ea7d4af3d78775c53ac1e45d84a4a730191c326',
    imageThumbnailSha256: '41bf6784558dc90876ddb4df78fc2b394900db5122e8e6a6344e900387575bf5',
    sourceImageSha256: 'd61d53a53fdb0edacfb5fc301a4ceb966d81fc9d361392a4707cf21c3b682cd8',
    previewCatalogApproved: true, unit: 'unidad', unitLabel: 'Lata 473 ml', price: QA_PRICES.specialty, stock: 6,
    brand: 'Monster', variant: 'Energy Ultra Peachy Keen', capacityValue: 473, capacityUnit: 'ml', packageType: 'lata', unitsPerPack: 1, identityStatus: 'EXACTA', rightsStatus: 'APROBADOS',
  }),
  fixture('qa-whisky', 'Monster Energy Pipeline Punch 473 ml', 'energeticas', 'Lata 473 ml', {
    image: 'assets/catalog/products/qa-monster-pipeline-punch-473ml-2ea3e22f3cfadc64-e2fa9d61dc39aafb.webp',
    imageThumbnail: 'assets/catalog/thumbnails/qa-monster-pipeline-punch-473ml-2ea3e22f3cfadc64-thumb-c2f25bbc78ee169e.webp',
    imageSha256: 'e2fa9d61dc39aafb1803e10124dd9bae1c879714eb09793284a428ad2af28f26',
    imageThumbnailSha256: 'c2f25bbc78ee169e360e0d59b3d218e20f28ef8cf0122b77d071262ed24fe661',
    sourceImageSha256: '8475e3954af555297afdf5b2ffdb69e31bc90f07cd7527b56d7d939c4a58a7a7',
    previewCatalogApproved: true, unit: 'unidad', unitLabel: 'Lata 473 ml', price: QA_PRICES.specialty, stock: 6,
    brand: 'Monster', variant: 'Energy Pipeline Punch', capacityValue: 473, capacityUnit: 'ml', packageType: 'lata', unitsPerPack: 1, identityStatus: 'EXACTA', rightsStatus: 'APROBADOS',
  }),
  fixture('qa-agua-con-gas', 'Pepsi Original', 'gaseosas', 'Botella PET · capacidad a confirmar', {
    stock: 10,
    brand: 'Pepsi', variant: 'Original', packageType: 'botella', identityStatus: 'PARCIAL', rightsStatus: 'PENDIENTE_DERECHOS',
  }),
  fixture('qa-cerveza', 'Heineken Original 473 ml', 'cervezas', 'Lata 473 ml', {
    image: 'assets/catalog/products/qa-heineken-original-473ml-38f979ff8cce7700-d4917a90ed2277c9.webp',
    imageThumbnail: 'assets/catalog/thumbnails/qa-heineken-original-473ml-38f979ff8cce7700-thumb-cfc186427dd5d784.webp',
    imageSha256: 'd4917a90ed2277c9b5f51b5b02548cd1dca516da54f5d314e04fbb54565fcbad',
    imageThumbnailSha256: 'cfc186427dd5d784074bb3dba0af1a0eb40a2c753f07ca0b5a1300fe4be33b60',
    sourceImageSha256: 'dadce1edf17ac937931a799ee5f44fb116f1665d614ce72a8c42fa247e192252',
    previewCatalogApproved: true, price: QA_PRICES.alcoholic, featured: true, stock: 3,
    brand: 'Heineken', variant: 'Original', capacityValue: 473, capacityUnit: 'ml', packageType: 'lata', unitsPerPack: 1, identityStatus: 'EXACTA', rightsStatus: 'PENDIENTE_DERECHOS',
  }),
  fixture('qa-vino', 'Imperial Extra Lager 473 ml', 'cervezas', 'Lata 473 ml', {
    image: 'assets/catalog/products/qa-imperial-extra-lager-473ml-37ed9cb96bc29a8e-678fda4a3bf94c5e.webp',
    imageThumbnail: 'assets/catalog/thumbnails/qa-imperial-extra-lager-473ml-37ed9cb96bc29a8e-thumb-50bfab8a85306842.webp',
    imageSha256: '678fda4a3bf94c5e32198b020ab201824c5881aea6d8bb6b85c7899efd474724',
    imageThumbnailSha256: '50bfab8a853068426be21d6fc1a703a57f8ec45e0ee97da923d7bbd4dfaee991',
    sourceImageSha256: '7494b8ed2856712ae5fc2f6b842b1c60e0d6229703fa47d8e519ebb631f7b2f4',
    previewCatalogApproved: true, price: QA_PRICES.alcoholic, stock: 6,
    brand: 'Imperial', variant: 'Extra Lager', capacityValue: 473, capacityUnit: 'ml', packageType: 'lata', unitsPerPack: 1, identityStatus: 'EXACTA', rightsStatus: 'PENDIENTE_DERECHOS',
  }),
  fixture('qa-agua-mineral', 'Villavicencio Sin Gas 500 ml', 'aguas', 'Botella 500 ml', {
    image: 'assets/catalog/products/qa-villavicencio-sin-gas-500ml-6e55cfa3ea0e016d-5c3deb02388d6380.webp',
    imageThumbnail: 'assets/catalog/thumbnails/qa-villavicencio-sin-gas-500ml-6e55cfa3ea0e016d-thumb-3264ae2c9f24b6d4.webp',
    imageSha256: '5c3deb02388d6380df1beb8c6ccbde21cad5a8f0b6705fb9238ad153ef0dcfbe',
    imageThumbnailSha256: '3264ae2c9f24b6d471478f8c8d6e382622620f9c9f1ac3a1925d66f2056dd27c',
    sourceImageSha256: '3546153b25e24b0f8585ae63fc788571ec10114feb44e60b9948cb49847a7d13',
    previewCatalogApproved: true, popular: true, stock: 12,
    brand: 'Villavicencio', variant: 'Sin Gas', capacityValue: 500, capacityUnit: 'ml', packageType: 'botella', unitsPerPack: 1, identityStatus: 'EXACTA', rightsStatus: 'PENDIENTE_DERECHOS',
  }),
  fixture('qa-hielo', 'Corona Extra 355 ml', 'cervezas', 'Botella 355 ml', {
    image: 'assets/catalog/products/qa-corona-extra-355ml-424d2a1a94ce2eff-21e867fd5def30fc.webp',
    imageThumbnail: 'assets/catalog/thumbnails/qa-corona-extra-355ml-424d2a1a94ce2eff-thumb-e2fc282d7883d7cb.webp',
    imageSha256: '21e867fd5def30fc51f6084af48d3d12a7e7f46d27f166418f097042da5d9555',
    imageThumbnailSha256: 'e2fc282d7883d7cb8f7d5c436c1213e7dc3ad046b5781acadf66c08eee25bed8',
    sourceImageSha256: 'd2776af58ded150e38f63d31e2147f1bb9928e26a2d968ef4a8c9b5ae83fe212',
    previewCatalogApproved: true, price: QA_PRICES.alcoholic, stock: 4,
    brand: 'Corona', variant: 'Extra', capacityValue: 355, capacityUnit: 'ml', packageType: 'botella', unitsPerPack: 1, identityStatus: 'EXACTA', rightsStatus: 'PENDIENTE_DERECHOS',
  }),
  fixture('qa-gin', "Hendrick's Gin Original", 'gins-y-vodkas', 'Botella · capacidad a confirmar', {
    price: QA_PRICES.alcoholic, stock: 4,
    brand: "Hendrick's", variant: 'Original', packageType: 'botella', identityStatus: 'PARCIAL', rightsStatus: 'PENDIENTE_DERECHOS',
  }),
];
