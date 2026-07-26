export { categories, products } from './beverage-qa-data.js';

// Pedido técnico mínimo para ejercitar historial, operación y reportes en demo.
// Los importes son redondos y deliberadamente neutros: no representan precios,
// cargos ni condiciones comerciales de TABA.
export const seedOrders = [
  {
    id: 'LT-0001',
    customerName: 'Cliente QA',
    customerPhone: '2990000000',
    address: 'Dirección ficticia QA',
    addressDetails: {
      streetLine: 'Dirección ficticia QA',
      neighborhood: 'Zona QA',
      reference: 'Dato técnico no comercial',
      label: 'Dirección ficticia QA',
    },
    deliveryMode: 'delivery',
    paymentMethod: 'Pago a coordinar con el local',
    paymentMethodCode: 'coordinate',
    notes: 'Pedido técnico de demostración.',
    createdAt: new Date(Date.now() - 1000 * 60 * 22).toISOString(),
    status: 'delivered',
    items: [
      { productId: 'qa-gaseosa-cola', name: 'Gaseosa cola', icon: '', quantity: 1, unitPrice: 5000, unit: 'unidad' },
      { productId: 'qa-isotonica', name: 'Bebida isotónica', icon: '', quantity: 1, unitPrice: 7500, unit: 'unidad' },
      { productId: 'qa-agua-mineral', name: 'Agua mineral', icon: '', quantity: 1, unitPrice: 5000, unit: 'unidad' },
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
    // Pedido de ejemplo: sin reputación inventada del repartidor (rating/viajes),
    // sólo los datos operativos que la demo realmente registra.
    delivery: {
      driverName: 'Martín',
      driverPhone: '2991112233',
      estimatedMinutes: 0,
      currentLocationLabel: 'Pedido entregado',
      deliveredAt: new Date(Date.now() - 1000 * 60 * 2).toISOString(),
    },
  },
];
