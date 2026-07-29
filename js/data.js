import * as approvedCatalog from './approved-beverage-demo-data.js';

const testCatalog = globalThis.__TABA_TEST_CATALOG__ || null;

export const categories = testCatalog?.categories || approvedCatalog.categories;
export const products = testCatalog?.products || approvedCatalog.products;
export const PREVIEW_CATALOG_VERSION = testCatalog?.PREVIEW_CATALOG_VERSION || approvedCatalog.PREVIEW_CATALOG_VERSION;

// Seed interno para mantener estable la numeración local. Las superficies
// operativas lo excluyen y los datos no representan condiciones comerciales.
export const seedOrders = [
  {
    id: 'LT-0001',
    internalSeed: true,
    customerName: 'Pedido anterior',
    customerPhone: '',
    address: 'Entrega completada',
    addressDetails: {
      streetLine: '',
      neighborhood: '',
      reference: '',
      label: 'Entrega completada',
    },
    deliveryMode: 'delivery',
    paymentMethod: 'Pago a coordinar con el local',
    paymentMethodCode: 'coordinate',
    notes: '',
    createdAt: new Date(Date.now() - 1000 * 60 * 22).toISOString(),
    status: 'delivered',
    items: testCatalog?.seedOrderItems || [
        { productId: 'red-bull-original-lata-250ml', name: 'Red Bull Energy Drink', icon: '', quantity: 1, unitPrice: 3576, unit: 'unidad' },
        { productId: 'speed-original-lata-473ml', name: 'Speed Unlimited', icon: '', quantity: 1, unitPrice: 2925, unit: 'unidad' },
        { productId: 'heineken-original-lata-473ml', name: 'Heineken', icon: '', quantity: 1, unitPrice: 3900, unit: 'unidad' },
      ],
    subtotal: testCatalog ? 17500 : 10401,
    deliveryFee: 0,
    total: testCatalog ? 17500 : 10401,
    statusHistory: [
      { status: 'received', at: new Date(Date.now() - 1000 * 60 * 22).toISOString() },
      { status: 'preparing', at: new Date(Date.now() - 1000 * 60 * 16).toISOString() },
      { status: 'ready', at: new Date(Date.now() - 1000 * 60 * 12).toISOString() },
      { status: 'on_the_way', at: new Date(Date.now() - 1000 * 60 * 8).toISOString() },
      { status: 'delivered', at: new Date(Date.now() - 1000 * 60 * 2).toISOString() },
    ],
    delivery: {
      driverName: 'Reparto TABA',
      driverPhone: '',
      estimatedMinutes: 0,
      currentLocationLabel: 'Pedido entregado',
      deliveredAt: new Date(Date.now() - 1000 * 60 * 2).toISOString(),
    },
  },
];
