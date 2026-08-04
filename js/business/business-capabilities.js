// Qué puede tocar cada persona del negocio. Es la única fuente de verdad del panel;
// el servidor vuelve a validar todo, esto sólo evita ofrecer botones que van a fallar.

export const BUSINESS_CAPABILITIES = Object.freeze([
  'orders.view', 'orders.advance', 'packing.run', 'scanner.use', 'inventory.count',
  'inventory.receive', 'printing.run', 'devices.test', 'payments.view', 'day.open',
  'products.draft',
  'products.publish', 'products.price', 'payments.refund', 'payments.reconcile',
  'fiscal.configure', 'fiscal.authorize', 'day.close', 'team.manage',
]);

const STAFF_CAPABILITIES = Object.freeze([
  'orders.view', 'orders.advance', 'packing.run', 'scanner.use', 'inventory.count',
  'inventory.receive', 'printing.run', 'devices.test', 'payments.view', 'day.open',
  'products.draft',
]);

const ROLE_CAPABILITIES = Object.freeze({
  owner: Object.freeze([...BUSINESS_CAPABILITIES]),
  admin: Object.freeze([...BUSINESS_CAPABILITIES]),
  staff: STAFF_CAPABILITIES,
});

export const ROLE_LABELS = Object.freeze({
  owner: 'Dueño',
  admin: 'Encargado',
  staff: 'Equipo',
});

// Cada permiso que sólo tienen dueño y encargado explica por qué, en lugar de decir "no autorizado".
const RESTRICTION_REASONS = Object.freeze({
  'products.publish': 'Publicar un producto lo pone a la venta en la web. Lo confirma el dueño o el encargado.',
  'products.price': 'Cambiar precios afecta lo que cobra la web. Lo confirma el dueño o el encargado.',
  'payments.refund': 'Devolver dinero es irreversible. Lo confirma el dueño o el encargado.',
  'payments.reconcile': 'Tocar un pago dudoso cambia el pedido. Lo confirma el dueño o el encargado.',
  'fiscal.configure': 'Los datos fiscales del negocio los define el dueño o el encargado con el contador.',
  'fiscal.authorize': 'Habilitar la facturación necesita autorización del dueño o el encargado.',
  'day.close': 'El cierre del día queda firmado. Lo hace el dueño o el encargado.',
  'team.manage': 'Dar de alta o baja gente del equipo lo hace el dueño o el encargado.',
});

const DEFAULT_RESTRICTION = 'Esta acción la confirma el dueño o el encargado.';

export function normalizeRole(role) {
  const value = String(role || '').toLowerCase();
  return Object.hasOwn(ROLE_CAPABILITIES, value) ? value : '';
}

export function capabilitiesForRole(role) {
  const normalized = normalizeRole(role);
  return normalized ? ROLE_CAPABILITIES[normalized] : Object.freeze([]);
}

export function can(role, capability) {
  return capabilitiesForRole(role).includes(String(capability || ''));
}

export function isElevated(role) {
  return ['owner', 'admin'].includes(normalizeRole(role));
}

export function roleLabel(role) {
  return ROLE_LABELS[normalizeRole(role)] || 'Sin acceso';
}

// Devuelve un resultado uniforme: o se puede, o se explica por qué no y quién puede.
export function requireCapability(role, capability) {
  if (can(role, capability)) return Object.freeze({ allowed: true, message: '' });
  return Object.freeze({
    allowed: false,
    message: RESTRICTION_REASONS[capability] || DEFAULT_RESTRICTION,
  });
}

export function describeRoleScope(role) {
  const normalized = normalizeRole(role);
  if (!normalized) {
    return Object.freeze({ role: '', label: 'Sin acceso', canDo: Object.freeze([]), needsOwner: Object.freeze([]) });
  }
  const granted = capabilitiesForRole(normalized);
  return Object.freeze({
    role: normalized,
    label: ROLE_LABELS[normalized],
    canDo: Object.freeze(granted.filter((capability) => STAFF_CAPABILITIES.includes(capability))),
    needsOwner: Object.freeze(BUSINESS_CAPABILITIES.filter((capability) => !granted.includes(capability))),
  });
}
