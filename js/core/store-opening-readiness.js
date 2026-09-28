// Qué falta para abrir el comercio, en palabras del comercio.
// ---------------------------------------------------------------------------
// La autoridad es la base: `get_store_opening_readiness` evalúa cada compuerta
// con los mismos contratos que deciden si un pedido nace, si un producto se
// publica y si la plataforma puede verificar el comercio. Este módulo NO decide
// nada: traduce cada código a título, motivo, acción y lugar donde se arregla,
// y resume el veredicto. Lo usan el Panel («Preparar apertura») y la
// herramienta operativa (`npm run opening:check`), así que las dos superficies
// dicen exactamente lo mismo.
//
// Sin DOM y sin red: se prueba en Node.

export const OPENING_STATUSES = Object.freeze(['pass', 'pending', 'warn', 'info', 'na']);

export const OPENING_GROUPS = Object.freeze([
  Object.freeze({ id: 'business', label: 'Comercio' }),
  Object.freeze({ id: 'fulfillment', label: 'Entrega' }),
  Object.freeze({ id: 'catalog', label: 'Catálogo' }),
  Object.freeze({ id: 'payments', label: 'Pagos' }),
  Object.freeze({ id: 'platform', label: 'Plataforma' }),
  Object.freeze({ id: 'open', label: 'Apertura' }),
]);

// Dónde se arregla cada cosa. `view` es el destino del Panel; `null` cuando no
// lo resuelve el comercio.
const WHERE = Object.freeze({
  platform: Object.freeze({ label: 'Plataforma (operador de La Taba)', view: null }),
  local: Object.freeze({ label: 'Panel › Horarios y cobertura › Datos del local', view: 'operations-config' }),
  fulfillment: Object.freeze({ label: 'Panel › Horarios y cobertura › Cómo entregás', view: 'operations-config' }),
  hours: Object.freeze({ label: 'Panel › Horarios y cobertura › Horario de atención', view: 'operations-config' }),
  pricing: Object.freeze({ label: 'Panel › Horarios y cobertura › Envío y pedido mínimo', view: 'operations-config' }),
  zones: Object.freeze({ label: 'Panel › Horarios y cobertura › Zonas de entrega', view: 'operations-config' }),
  team: Object.freeze({ label: 'Panel › Equipo › Invitar', view: 'team' }),
  catalog: Object.freeze({ label: 'Panel › Catálogo (o la planilla de apertura)', view: 'catalog' }),
  photos: Object.freeze({ label: 'Panel › Catálogo › Cargar fotos', view: 'catalog' }),
  publish: Object.freeze({ label: 'Panel › Catálogo › Verificar y publicar', view: 'catalog' }),
  alcohol: Object.freeze({ label: 'Decisión del comercio (docs/ALCOHOL-ACTIVATION.md)', view: null }),
  payments: Object.freeze({ label: 'Panel › Conectar Mercado Pago', view: 'payments-setup' }),
  open: Object.freeze({ label: 'Panel › Abrir el negocio', view: 'day-open' }),
});

const CHANNEL_LABEL = Object.freeze({ delivery: 'el delivery', pickup: 'el retiro' });

function count(facts, key) {
  const value = Number(facts?.[key]);
  return Number.isSafeInteger(value) && value >= 0 ? value : 0;
}

function plural(value, one, many) {
  return `${value} ${value === 1 ? one : many}`;
}

function listChannels(channels) {
  const names = (Array.isArray(channels) ? channels : []).map((channel) => CHANNEL_LABEL[channel]).filter(Boolean);
  return names.length > 1 ? `${names.slice(0, -1).join(', ')} y ${names.at(-1)}` : names[0] || 'la tienda';
}

// Un texto por código y estado. `reason` explica en qué se nota; `action` dice
// qué hacer. Nunca nombran tablas, columnas, funciones ni códigos de error.
const COPY = Object.freeze({
  BUSINESS_ACTIVE: {
    title: 'Comercio activo',
    pass: () => 'El comercio está activo en la plataforma.',
    pending: () => 'El comercio está dado de baja en la plataforma.',
    action: 'Pedile a la plataforma que lo reactive.',
    where: WHERE.platform,
  },
  CURRENCY: {
    title: 'Moneda',
    pass: (f) => `Los precios se cobran en ${f.currency || 'pesos'}.`,
    pending: () => 'La moneda del comercio todavía no está definida.',
    action: 'La define la plataforma.',
    where: WHERE.platform,
  },
  BUSINESS_ADDRESS: {
    title: 'Dirección del local',
    pass: () => 'La dirección del local está publicada.',
    pending: () => 'Con retiro en el local, el cliente necesita saber adónde ir.',
    warn: () => 'Todavía no hay una dirección publicada del local.',
    action: 'Cargá la dirección del local.',
    where: WHERE.local,
  },
  BUSINESS_CONTACT: {
    title: 'WhatsApp del local',
    pass: () => 'El WhatsApp del local está confirmado.',
    warn: (f) => (f.configured
      ? 'El WhatsApp del local está cargado pero falta confirmarlo.'
      : 'Sin WhatsApp del local, el cliente no tiene cómo escribirle.'),
    action: 'Cargá y confirmá el WhatsApp del local.',
    where: WHERE.local,
  },
  FULFILLMENT_MODE: {
    title: 'Retiro o delivery',
    pass: (f) => (f.delivery && f.pickup ? 'Delivery y retiro en el local.' : f.delivery ? 'Sólo delivery.' : 'Sólo retiro en el local.'),
    pending: () => 'Todavía no está definido si el local hace retiro, delivery o los dos.',
    action: 'Elegí retiro, delivery o los dos.',
    where: WHERE.fulfillment,
  },
  SERVICE_HOURS: {
    title: 'Horarios',
    pass: (f) => `Horario cargado (${plural(Math.max(count(f, 'delivery_windows'), count(f, 'pickup_windows')), 'tramo', 'tramos')} por canal).`,
    pending: (f) => (f.timezone_ok === false
      ? 'Falta el huso horario del local para poder exigir los horarios.'
      : `Faltan los horarios de ${listChannels(f.missing_channels)}: sin horarios la tienda rechaza todos los pedidos.`),
    warn: () => 'El horario no se exige: mientras el local esté abierto, la tienda toma pedidos a cualquier hora.',
    action: 'Configurá los horarios de atención.',
    where: WHERE.hours,
  },
  DELIVERY_PRICING: {
    title: 'Envío y pedido mínimo',
    pass: (f) => `Envío $${Number(f.fee ?? 0)} · mínimo $${Number(f.minimum ?? 0)}.`,
    pending: () => 'Con delivery hace falta el costo de envío y el pedido mínimo del local (el mínimo puede ser 0).',
    na: () => 'No aplica: el local no hace delivery.',
    action: 'Cargá el costo de envío y el pedido mínimo.',
    where: WHERE.pricing,
  },
  DELIVERY_COVERAGE: {
    title: 'Zona de entrega',
    pass: (f) => `${plural(count(f, 'zones_with_fee'), 'zona activa', 'zonas activas')} con costo de envío.`,
    pending: (f) => (f.max_radius_set && !f.point_verified
      ? 'El tope de distancia necesita el punto del local verificado por una persona.'
      : 'No hay ninguna zona activa con costo de envío: el delivery no llega a ningún lado.'),
    warn: () => 'La zona no se exige: el delivery acepta cualquier dirección.',
    na: () => 'No aplica: el local no hace delivery.',
    action: 'Definí las zonas donde entregás.',
    where: WHERE.zones,
  },
  RIDERS: {
    title: 'Repartidores',
    pass: (f) => `${plural(count(f, 'riders'), 'repartidor activo', 'repartidores activos')}; ${count(f, 'available_now')} disponible(s) ahora.`,
    warn: () => 'Sin repartidores: el local entrega por su cuenta y cierra la entrega con el código del cliente.',
    na: () => 'No aplica: el local no hace delivery.',
    action: 'Invitá a los repartidores.',
    where: WHERE.team,
  },
  CATALOG_PRICES: {
    title: 'Precios',
    pass: (f) => `${count(f, 'with_price')} de ${count(f, 'candidates')} productos con precio confirmado.`,
    pending: (f) => `${count(f, 'with_price')} de ${count(f, 'candidates')} productos con precio confirmado (hace falta al menos ${count(f, 'min') || 1}).`,
    action: 'Cargá los precios.',
    where: WHERE.catalog,
  },
  CATALOG_STOCK: {
    title: 'Stock',
    pass: (f) => `${count(f, 'with_stock')} productos con stock contado.`,
    pending: (f) => `${count(f, 'with_stock')} productos con stock contado; ${count(f, 'uncounted')} sin contar y ${count(f, 'sold_out')} agotados.`,
    action: 'Contá el stock del local.',
    where: WHERE.catalog,
  },
  CATALOG_PHOTOS: {
    title: 'Fotos aprobadas',
    pass: (f) => `${count(f, 'with_photo')} de ${count(f, 'candidates')} productos con foto aprobada.`,
    pending: (f) => `${count(f, 'with_photo')} de ${count(f, 'candidates')} productos con foto aprobada: sin foto aprobada un producto no se publica.`,
    na: () => 'En este comercio la foto no es obligatoria para publicar.',
    action: 'Subí las fotos y aprobalas.',
    where: WHERE.photos,
  },
  CATALOG_PUBLISHED: {
    title: 'Productos publicados',
    pass: (f) => `${plural(count(f, 'published'), 'producto publicado', 'productos publicados')}.`,
    pending: (f) => (count(f, 'ready_to_publish') > 0
      ? `${count(f, 'published')} publicados y ${count(f, 'ready_to_publish')} listos para publicar.`
      : `${count(f, 'published')} publicados. Un producto se publica con precio, stock${f.photo_required === false ? '' : ' y foto aprobada'}.`),
    action: 'Publicá los productos listos.',
    where: WHERE.publish,
  },
  ALCOHOL_POLICY: {
    title: 'Venta de alcohol',
    pass: () => 'La venta de alcohol está habilitada con su edad mínima y su franja horaria.',
    info: (f) => `Cerrada: ${plural(count(f, 'alcoholic_products'), 'producto con alcohol', 'productos con alcohol')} no se venden.`,
    action: 'La decide el comercio antes de habilitarla.',
    where: WHERE.alcohol,
  },
  PAYMENT_MANUAL: {
    title: 'Pago en efectivo o transferencia',
    pass: () => 'Efectivo al retirar o recibir, y transferencia a coordinar con el local.',
    action: '',
    where: null,
  },
  PAYMENT_MERCADOPAGO: {
    title: 'Mercado Pago',
    pass: () => 'Mercado Pago conectado y habilitado: la tienda lo ofrece.',
    info: (f) => mercadoPagoInfo(f),
    action: 'El dueño conecta su cuenta desde el Panel.',
    where: WHERE.payments,
  },
  PLATFORM_VERIFICATION: {
    title: 'Verificación de plataforma',
    pass: () => 'La plataforma verificó el comercio: la web puede tomar pedidos.',
    pending: (f) => (f.verified && !f.enabled
      ? 'Verificado, pero los pedidos online están apagados.'
      : 'La plataforma todavía no verificó el comercio. Se pide cuando todo lo anterior está listo.'),
    action: 'Pedile la verificación a la plataforma.',
    where: WHERE.platform,
  },
  STORE_OPEN: {
    title: 'Local abierto',
    pass: () => 'El local está abierto.',
    info: (f) => (f.status === 'paused' ? 'Los pedidos están pausados.' : 'El local está cerrado.'),
    action: 'Abrí el local cuando quieras empezar a vender.',
    where: WHERE.open,
  },
});

export const OPENING_CODES = Object.freeze(Object.keys(COPY));

function mercadoPagoInfo(facts = {}) {
  if (facts.seller === 'connected' && !facts.platform_enabled) return 'Cuenta conectada: falta la habilitación de la plataforma para cobrar.';
  if (facts.seller === 'connected') return 'Cuenta conectada: todavía no se ofrece en la tienda.';
  if (facts.seller === 'requires_reauthorization') return 'Mercado Pago pide volver a conectar la cuenta.';
  return 'No conectado: la tienda cobra en efectivo o por transferencia.';
}

function normalizeStatus(value) {
  const status = String(value || '').toLowerCase();
  return OPENING_STATUSES.includes(status) ? status : 'pending';
}

/** Un ítem de la base, en palabras. Un código desconocido se muestra pendiente y sin inventar. */
export function presentOpeningItem(raw = {}) {
  const code = String(raw.code || '');
  const status = normalizeStatus(raw.status);
  const facts = raw.facts && typeof raw.facts === 'object' && !Array.isArray(raw.facts) ? raw.facts : {};
  const copy = COPY[code];
  const blocking = raw.blocking === true;
  if (!copy) {
    return Object.freeze({
      code, group: String(raw.group || ''), status, blocking, title: 'Requisito nuevo',
      reason: 'La plataforma agregó un requisito que esta pantalla todavía no conoce.',
      action: 'Actualizá la app o consultá a la plataforma.', where: '', view: null,
    });
  }
  const say = copy[status] || copy.pending || copy.pass;
  return Object.freeze({
    code,
    group: String(raw.group || ''),
    status,
    blocking,
    title: copy.title,
    reason: say ? say(facts) : '',
    action: status === 'pass' || status === 'na' ? '' : copy.action,
    where: status === 'pass' || status === 'na' || !copy.where ? '' : copy.where.label,
    view: status === 'pass' || status === 'na' || !copy.where ? null : copy.where.view,
  });
}

/**
 * La respuesta completa de `get_store_opening_readiness`, lista para dibujar.
 *
 *   commercialReady → todo lo del comercio cumplido (falta, a lo sumo, la
 *                     verificación de plataforma)
 *   canOpen         → además verificado: el dueño puede abrir
 *   accepting       → abierto, verificado y en horario ahora mismo
 */
export function presentOpeningReadiness(payload) {
  const source = payload && typeof payload === 'object' ? payload : null;
  if (!source || !Array.isArray(source.items)) {
    return Object.freeze({ known: false, items: [], groups: [], pending: [], commercialReady: false, canOpen: false,
      accepting: false, headline: 'No pudimos leer qué falta para abrir.', detail: 'Volvé a intentar en un momento.' });
  }
  const photoRequired = source.items.find((item) => item?.code === 'CATALOG_PHOTOS')?.facts?.required !== false;
  const items = source.items.map((item) => presentOpeningItem(item?.code === 'CATALOG_PUBLISHED'
    ? { ...item, facts: { ...(item.facts || {}), photo_required: photoRequired } }
    : item));
  const pending = items.filter((item) => item.blocking && item.status !== 'pass');
  const commercialPending = pending.filter((item) => item.code !== 'PLATFORM_VERIFICATION');
  const commercialReady = source.ready_for_platform_verification === true && commercialPending.length === 0;
  const canOpen = source.can_open === true && pending.length === 0;
  const accepting = source.accepting_orders === true && canOpen;
  const status = String(source.business?.status || '');
  const groups = OPENING_GROUPS
    .map((group) => ({ ...group, items: items.filter((item) => item.group === group.id) }))
    .filter((group) => group.items.length);

  let headline;
  let detail;
  if (accepting) {
    headline = 'La tienda está tomando pedidos.';
    detail = 'Todo lo necesario para vender está cumplido.';
  } else if (canOpen) {
    headline = status === 'open' ? 'Abierto, pero fuera de horario.' : 'Todo listo: falta abrir el local.';
    detail = status === 'open' ? 'La tienda toma pedidos cuando empieza el horario.' : 'Abrí el local desde «Abrir el negocio» cuando quieras empezar.';
  } else if (commercialReady) {
    headline = 'Todo listo del lado del comercio.';
    detail = 'Falta la verificación de plataforma. Después, el dueño abre el local.';
  } else {
    headline = `Faltan ${plural(commercialPending.length, 'paso', 'pasos')} para abrir.`;
    detail = 'Cada paso dice qué falta y dónde se completa.';
  }
  return Object.freeze({
    known: true,
    items,
    groups,
    pending,
    commercialPending,
    commercialReady,
    canOpen,
    accepting,
    headline,
    detail,
    minProducts: Number(source.min_products) || 1,
    counts: source.counts && typeof source.counts === 'object' ? source.counts : {},
    businessStatus: status,
  });
}

/** Marca de una línea para texto plano (terminal): ✓ cumplido, ✗ falta, ! conviene, · dato. */
export function openingItemMark(item) {
  if (item.status === 'pass') return '✓';
  if (item.status === 'na') return '–';
  if (item.status === 'warn') return '!';
  if (item.status === 'info') return '·';
  return item.blocking ? '✗' : '!';
}
