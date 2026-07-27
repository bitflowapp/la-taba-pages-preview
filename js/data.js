export { categories, products, PREVIEW_CATALOG_VERSION } from './beverage-qa-data.js';

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
      { productId: 'qa-gaseosa-cola', name: 'Sprite 1,5 L x6', icon: '', quantity: 1, unitPrice: 5000, unit: 'pack' },
      { productId: 'qa-isotonica', name: 'Monster Energy Ultra White Zero 473 ml x6', icon: '', quantity: 1, unitPrice: 7500, unit: 'pack' },
      { productId: 'qa-agua-mineral', name: 'Villavicencio Sin Gas 500 ml', icon: '', quantity: 1, unitPrice: 5000, unit: 'unidad' },
    ],
    subtotal: 17500,
    deliveryFee: 0,
    total: 17500,
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
