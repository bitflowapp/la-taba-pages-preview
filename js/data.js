export { categories, products, PREVIEW_CATALOG_VERSION } from './beverage-demo-data.js';

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
    items: [
      { productId: 'sprite-original-pet-1500ml-pack-6', name: 'Sprite', icon: '', quantity: 1, unitPrice: 19999, unit: 'pack' },
      { productId: 'monster-mango-loco-lata-473ml', name: 'Monster Mango Loco', icon: '', quantity: 1, unitPrice: 3390, unit: 'unidad' },
      { productId: 'coca-cola-original-pet-500ml-pack-12', name: 'Coca-Cola Original', icon: '', quantity: 1, unitPrice: 17100, unit: 'pack' },
    ],
    subtotal: 40489,
    deliveryFee: 0,
    total: 40489,
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
