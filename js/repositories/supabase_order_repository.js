import { getBusinessConfig } from '../core/business-config-store.js';
import { getCartItems } from '../cart.js';
import {
  normalizeOrderDraft,
  normalizeTrackingLocation,
  toDomainOrder,
} from '../core/domain.js';
import { normalizeMoneyValue } from '../core/pricing.js';
import { normalizeAddressDetails } from '../core/address.js';
import {
  getNextWorkflowStatus,
  normalizeWorkflowStatus,
  toDemoOrderStatus,
} from '../core/order-workflow.js';
import { sanitizeNotes, sanitizeText } from '../core/validators.js';
import { setProductionCatalogReady } from '../core/runtime-config.js';
import {
  getState,
  paymentLabel,
  statusLabel,
  updateBusinessConfig,
  updateState,
} from '../state.js';
import { createSupabaseAuthService } from '../services/supabase-auth.js';
import { repositoryResult } from './order_repository.js';

// Se conserva sólo para detectar configuraciones históricas. Producción exige un
// businessId explícito y verificado en el runtime config.
export const DEFAULT_SUPABASE_BUSINESS_ID = '00000000-0000-4000-8000-000000000001';

const ORDER_ACCESS_STORAGE_VERSION = 'taba-order-access-v1';
const ORDER_SELECT = '*,order_items(*),rider_locations(*)';
let channelSequence = 0;

export function createSupabaseOrderRepository({
  client,
  createTrackingClient = null,
  authService = null,
  businessId,
  pollMs = 5000,
  storage = safeSessionStorage(),
  cryptoImpl = globalThis.crypto,
} = {}) {
  if (!client || typeof client.from !== 'function' || typeof client.rpc !== 'function') {
    throw new Error('Supabase repository requiere un cliente oficial configurado.');
  }
  if (!isUuid(businessId)) {
    throw new Error('Supabase repository requiere un businessId válido.');
  }

  const auth = authService || createSupabaseAuthService({ client, businessId });
  const pollingInterval = Math.max(1000, Number(pollMs) || 5000);
  const pendingStorageKey = `${ORDER_ACCESS_STORAGE_VERSION}:${businessId}:pending`;
  const lastAccessStorageKey = `${ORDER_ACCESS_STORAGE_VERSION}:${businessId}:last`;
  let trackingClient = null;
  let trackingClientToken = '';
  let pendingRequest = null;
  let createInFlight = null;
  let syncStop = null;
  let catalogProductCount = 0;
  let businessStatus = {
    state: 'idle',
    orderingReady: false,
    deliveryEnabled: false,
    pickupEnabled: false,
  };
  let catalogStatus = {
    state: 'idle',
    message: 'Catálogo productivo todavía no cargado.',
  };

  async function fetchOrderByPublicId(publicId, {
    mirror = false,
    trackingToken = '',
  } = {}) {
    const clean = String(publicId || '').trim();
    if (!clean) return null;
    const requestClient = getTrackingClient(trackingToken) || client;

    if (trackingToken) {
      const { data, error } = await requestClient.rpc('get_public_order_tracking', {
        p_public_id: clean,
      });
      if (error || !data) return null;
      return mirror ? mirrorPublicTracking(data) : data;
    }

    let query = requestClient
      .from('orders')
      .select(ORDER_SELECT)
      .eq('business_id', businessId);
    query = isUuid(clean)
      ? query.eq('id', clean)
      : query.eq('public_code', clean);

    const { data, error } = await query.limit(1).maybeSingle();
    if (error || !data) return null;
    return mirror ? mirrorOrder(data) : data;
  }

  async function fetchOrders({ mirror = true } = {}) {
    const { data, error, status } = await client
      .from('orders')
      .select(ORDER_SELECT)
      .eq('business_id', businessId)
      .order('created_at', { ascending: false })
      .limit(100);

    if (error) return failedQuery(error, status, 'No pudimos cargar los pedidos.');
    const rows = Array.isArray(data) ? data : [];
    const orders = mirror
      ? mirrorOrders(rows, { replace: true })
      : rows.map(rowToDemoOrder).filter(Boolean).map(toDomainOrder).filter(Boolean);
    return repositoryResult(true, { rows, orders });
  }

  async function loadBusinessConfiguration() {
    const { data, error, status } = await client
      .from('businesses')
      .select([
        'id',
        'name',
        'address',
        'whatsapp_phone',
        'currency_code',
        'ordering_enabled',
        'ordering_verified',
        'delivery_enabled',
        'pickup_enabled',
        'delivery_fee',
        'minimum_delivery_subtotal',
        'is_active',
        'status',
      ].join(','))
      .eq('id', businessId)
      .limit(1)
      .maybeSingle();
    if (error || !data) {
      businessStatus = {
        state: 'error',
        orderingReady: false,
        deliveryEnabled: false,
        pickupEnabled: false,
      };
      catalogProductCount = 0;
      catalogStatus = {
        state: 'error',
        message: 'No pudimos verificar que el comercio acepte pedidos.',
      };
      reconcileProductionReadiness();
      replaceProductionCatalog([]);
      return failedQuery(error, status, 'No pudimos cargar la configuración del comercio.');
    }

    const deliveryEnabled = data.delivery_enabled === true;
    const pickupEnabled = data.pickup_enabled === true;
    const orderingReady = Boolean(
      data.is_active
      && data.status === 'open'
      && data.ordering_enabled
      && data.ordering_verified
      && (deliveryEnabled || pickupEnabled),
    );
    businessStatus = {
      state: orderingReady ? 'ready' : 'blocked',
      orderingReady,
      deliveryEnabled,
      pickupEnabled,
    };
    reconcileProductionReadiness();
    updateBusinessConfig({
      businessName: sanitizeText(data.name, { fallback: 'TABA', maxLength: 80 }),
      name: sanitizeText(data.name, { fallback: 'TABA', maxLength: 80 }),
      subtitle: 'Tienda de bebidas',
      address: sanitizeText(data.address, { fallback: 'Dirección no publicada', maxLength: 180 }),
      whatsappNumber: sanitizeText(data.whatsapp_phone, { maxLength: 40 }),
      whatsappVerified: false,
      deliveryFee: normalizeMoneyValue(data.delivery_fee, 0),
      minDeliveryOrder: normalizeMoneyValue(data.minimum_delivery_subtotal, 0),
      orderingDetailsVerified: orderingReady,
      deliveryEnabled,
      pickupEnabled,
      currency: sanitizeText(data.currency_code, { fallback: 'ARS', maxLength: 3 }).toUpperCase(),
      businessLocationVerified: false,
    });
    return repositoryResult(true, { business: data });
  }

  async function loadCatalog() {
    setProductionCatalogReady(false);
    catalogProductCount = 0;
    catalogStatus = {
      state: 'loading',
      message: 'Cargando catálogo productivo.',
    };
    const { data, error, status } = await client
      .from('products')
      .select([
        'id',
        'business_id',
        'name',
        'brand',
        'description',
        'category',
        'subcategory',
        'presentation',
        'capacity',
        'packaging_type',
        'price',
        'stock',
        'available',
        'is_alcoholic',
        'image_url',
        'tags',
        'sort_order',
        'is_active',
        'is_verified',
      ].join(','))
      .eq('business_id', businessId)
      .eq('is_active', true)
      .eq('available', true)
      .eq('is_verified', true)
      .order('sort_order', { ascending: true })
      .order('name', { ascending: true });

    if (error) {
      replaceProductionCatalog([]);
      catalogStatus = {
        state: 'error',
        message: readableSupabaseError(error, 'No pudimos cargar el catálogo verificado.'),
      };
      return failedQuery(error, status, catalogStatus.message);
    }

    const products = (Array.isArray(data) ? data : [])
      .map(rowToCatalogProduct)
      .filter(Boolean);
    catalogProductCount = products.length;
    catalogStatus = products.length
      ? { state: 'ready', message: `${products.length} productos verificados.` }
      : { state: 'empty', message: 'El comercio todavía no publicó productos verificados.' };
    reconcileProductionReadiness();
    replaceProductionCatalog(products);
    return repositoryResult(true, { products, catalogStatus: { ...catalogStatus } });
  }

  async function createOrderInternal(orderDraft = {}) {
    const values = normalizeOrderDraft(orderDraft);
    // La instancia productiva no usa mínimos, tarifas ni totales del estado
    // local: la RPC valida el negocio y calcula todo desde filas bloqueadas.
    if (businessStatus.state === 'idle') await loadBusinessConfiguration();
    if (catalogStatus.state === 'idle') await loadCatalog();
    const cartItems = getCartItems();
    if (!businessStatus.orderingReady || catalogProductCount < 1) {
      return repositoryResult(false, {
        message: 'El comercio todavía no habilitó una configuración verificada para pedidos.',
      });
    }
    if (
      (values.deliveryMode === 'delivery' && !businessStatus.deliveryEnabled)
      || (values.deliveryMode === 'pickup' && !businessStatus.pickupEnabled)
    ) {
      return repositoryResult(false, {
        message: 'La modalidad elegida no está habilitada por el comercio.',
      });
    }
    if (!cartItems.length) {
      return repositoryResult(false, { message: 'Agregá al menos un producto antes de confirmar.' });
    }
    if (cartItems.some((item) => item.product.alcoholic) && !values.ageConfirmed) {
      return repositoryResult(false, {
        message: 'Confirmá que sos mayor de edad para pedir bebidas alcohólicas.',
      });
    }
    if (!values.customerName) return repositoryResult(false, { message: 'Ingresá el nombre del cliente.' });
    if (!values.customerPhone) return repositoryResult(false, { message: 'Ingresá un teléfono de contacto.' });
    if (values.deliveryMode === 'delivery' && !values.customerAddress) {
      return repositoryResult(false, { message: 'Ingresá calle y número para el envío.' });
    }
    if (values.deliveryMode === 'delivery' && values.addressDetails.usesStructured && !values.addressDetails.neighborhood) {
      return repositoryResult(false, { message: 'Ingresá el barrio o zona para el envío.' });
    }

    const items = cartItems.map((item) => ({
      product_id: String(item.product.id || ''),
      quantity: Math.max(0, Math.floor(Number(item.quantity) || 0)),
    }));
    if (!items.length || items.some((item) => !isUuid(item.product_id) || item.quantity < 1)) {
      return repositoryResult(false, {
        message: 'El catálogo productivo no está sincronizado. Actualizá la página antes de pedir.',
      });
    }

    const session = await auth.ensureCustomerSession();
    if (!session.ok) return repositoryResult(false, { message: session.message });

    let request;
    try {
      request = await prepareIdempotentRequest({
        values,
        items,
        storage,
        pendingStorageKey,
        cryptoImpl,
        memoryRequest: pendingRequest,
      });
    } catch (_) {
      return repositoryResult(false, {
        message: 'Este dispositivo no puede generar credenciales seguras para el pedido.',
      });
    }
    pendingRequest = request;

    const payload = {
      business_id: businessId,
      client_request_id: request.clientRequestId,
      tracking_token: request.trackingToken,
      items,
      customer_name: values.customerName,
      customer_phone: values.customerPhone,
      delivery_mode: values.deliveryMode,
      payment_method: values.paymentMethod,
      age_confirmed: values.ageConfirmed,
      ...(values.deliveryMode === 'delivery' ? {
        customer_street_address: values.addressDetails.streetLine || values.customerAddress,
        address_label: values.customerAddress,
        customer_neighborhood: values.addressDetails.neighborhood || undefined,
        customer_reference: values.addressDetails.reference || undefined,
      } : {}),
      ...(values.customerNotes ? { customer_notes: values.customerNotes } : {}),
    };

    const { data, error, status } = await client.rpc('create_order_with_items', { payload });
    if (error) return failedQuery(error, status, readableOrderCreationError(error));

    const row = unwrapOrderRow(data);
    if (!row?.id) {
      return repositoryResult(false, {
        message: 'El backend no devolvió el pedido creado.',
      });
    }

    persistOrderAccess({
      storage,
      key: lastAccessStorageKey,
      access: {
        orderId: row.id,
        publicCode: row.public_code || row.code || '',
        clientRequestId: request.clientRequestId,
        trackingToken: request.trackingToken,
      },
    });
    // Una respuesta exitosa completa este intento. Mantener la clave como
    // "pending" haría que un pedido nuevo e idéntico reutilice el pedido
    // anterior. Los errores conservan la clave; los éxitos la descartan.
    pendingRequest = null;
    removeStoredAccess(storage, pendingStorageKey);

    const order = mirrorCreatedOrder(row);
    await loadCatalog().catch(() => null);
    return repositoryResult(true, {
      order,
      domainOrder: toDomainOrder(order),
      trackingToken: request.trackingToken,
      clientRequestId: request.clientRequestId,
      message: `Pedido ${order.id} creado.`,
    });
  }

  const repository = {
    mode: 'supabase',
    businessId,
    auth,
    async loadCatalog() {
      return loadCatalog();
    },
    async loadBusinessConfiguration() {
      return loadBusinessConfiguration();
    },
    getCatalogStatus() {
      return { ...catalogStatus };
    },
    startSync() {
      if (syncStop) return syncStop;
      let stopped = false;
      const refresh = async () => {
        if (stopped) return;
        await Promise.allSettled([loadBusinessConfiguration(), loadCatalog(), fetchOrders()]);
      };
      const stopRealtime = createRealtimeWatch({
        client,
        pollMs: pollingInterval,
        name: `taba-sync-${businessId}`,
        changes: [
          tableChange('orders', `business_id=eq.${businessId}`, () => fetchOrders()),
          tableChange('rider_locations', `business_id=eq.${businessId}`, () => fetchOrders()),
          tableChange('products', `business_id=eq.${businessId}`, () => loadCatalog()),
          tableChange('businesses', `id=eq.${businessId}`, async () => {
            await loadBusinessConfiguration();
            await loadCatalog();
          }),
        ],
        fallbackTask: refresh,
      });
      refresh();
      syncStop = () => {
        stopped = true;
        stopRealtime();
        syncStop = null;
      };
      return syncStop;
    },
    stopSync() {
      syncStop?.();
    },
    async createOrder(orderDraft = {}) {
      if (createInFlight) return createInFlight;
      createInFlight = createOrderInternal(orderDraft);
      try {
        return await createInFlight;
      } finally {
        createInFlight = null;
      }
    },
    async getActiveOrder() {
      const result = await fetchOrders();
      const visible = result.ok
        ? result.orders.find((order) => !['delivered', 'canceled', 'cancelled'].includes(order.status))
        || result.orders[0]
        || null
        : null;
      if (visible) return visible;

      const access = readStoredAccess(storage, lastAccessStorageKey);
      if (!access?.trackingToken) return null;
      const row = await fetchOrderByPublicId(
        access.orderId || access.publicCode,
        { trackingToken: access.trackingToken },
      );
      return row ? toDomainOrder(mirrorPublicTracking(row)) : null;
    },
    async listOrders() {
      const result = await fetchOrders();
      return result.ok ? result.orders : [];
    },
    async updateOrderStatus(orderId, status) {
      const row = await fetchOrderByPublicId(orderId);
      if (!row) return repositoryResult(false, { message: 'Pedido no encontrado o acceso denegado.' });

      const expectedStatus = normalizeWorkflowStatus(row.status);
      const nextStatus = normalizeWorkflowStatus(status);
      const { data, error, status: responseStatus } = await client.rpc('change_order_status', {
        p_order_id: row.id,
        p_expected_status: expectedStatus,
        p_new_status: nextStatus,
      });
      if (error) {
        return failedQuery(error, responseStatus, readableStatusError(error));
      }

      const updatedRow = unwrapOrderRow(data) || await fetchOrderByPublicId(row.id);
      if (!updatedRow) return repositoryResult(false, { message: 'El backend no devolvió el pedido actualizado.' });
      const order = mirrorOrder(updatedRow);
      return repositoryResult(true, {
        order,
        message: `Pedido ${order.id} actualizado a ${statusLabel(order.status)}.`,
      });
    },
    async assignRider() {
      return repositoryResult(false, {
        message: 'La asignación de rider requiere la RPC autorizada de la próxima fase.',
      });
    },
    async updateRiderLocation(orderId, location) {
      const normalized = normalizeTrackingLocation(location);
      if (!normalized || normalized.source !== 'gps') {
        return repositoryResult(false, { message: 'Producción sólo acepta una ubicación GPS real.' });
      }

      const { data: userData, error: userError } = await client.auth.getUser();
      const user = userData?.user;
      if (userError || !user?.id) {
        return repositoryResult(false, { message: 'Iniciá sesión como rider para compartir ubicación.' });
      }

      const row = await fetchOrderByPublicId(orderId);
      if (!row) return repositoryResult(false, { message: 'Pedido no encontrado o acceso denegado.' });
      if (row.assigned_rider_user_id !== user.id) {
        return repositoryResult(false, { message: 'Este pedido no está asignado a tu cuenta de rider.' });
      }

      const { data, error, status } = await client
        .from('rider_locations')
        .insert({
          order_id: row.id,
          business_id: businessId,
          rider_user_id: user.id,
          lat: normalized.lat,
          lng: normalized.lng,
          accuracy: normalized.accuracy ?? null,
          heading: normalized.heading ?? null,
          speed: normalized.speed ?? null,
          source: 'gps',
        })
        .select('*')
        .single();
      if (error) return failedQuery(error, status, 'No pudimos publicar la ubicación del rider.');

      const fullRow = await fetchOrderByPublicId(row.id) || {
        ...row,
        rider_locations: [data, ...(row.rider_locations || [])],
      };
      const order = mirrorOrder(fullRow);
      mirrorGpsLocation(order, normalized);
      return repositoryResult(true, {
        location: normalized,
        order,
        message: 'Ubicación GPS actualizada.',
      });
    },
    subscribeToOrder(orderId, callback) {
      if (typeof callback !== 'function') return () => {};
      const access = readStoredAccess(storage, lastAccessStorageKey);
      const trackingToken = matchesStoredOrderAccess(access, orderId)
        ? access.trackingToken
        : '';
      const refresh = async () => {
        const row = await fetchOrderByPublicId(orderId, { trackingToken });
        const order = row
          ? trackingToken
            ? mirrorPublicTracking(row)
            : mirrorOrder(row)
          : null;
        callback(order ? toDomainOrder(order) : null);
      };
      return createRealtimeWatch({
        client,
        pollMs: pollingInterval,
        name: `taba-order-${orderId}`,
        changes: [
          tableChange('orders', `${isUuid(orderId) ? 'id' : 'public_code'}=eq.${orderId}`, refresh),
          ...(isUuid(orderId) ? [tableChange('rider_locations', `order_id=eq.${orderId}`, refresh)] : []),
        ],
        fallbackTask: refresh,
        initialTask: refresh,
        // Los headers globales de Supabase sirven para PostgREST, pero el
        // navegador no puede enviarlos por WebSocket. Un tracking client con
        // x-order-token quedaría "SUBSCRIBED" sin recibir cambios por RLS y
        // además apagaría el fallback. Mantener polling para ese acceso.
        pollingOnly: Boolean(trackingToken),
      });
    },
    subscribeToBusinessOrders(callback) {
      if (typeof callback !== 'function') return () => {};
      const refresh = async () => callback(await repository.listOrders());
      return createRealtimeWatch({
        client,
        pollMs: pollingInterval,
        name: `taba-business-${businessId}`,
        changes: [
          tableChange('orders', `business_id=eq.${businessId}`, refresh),
          tableChange('rider_locations', `business_id=eq.${businessId}`, refresh),
        ],
        fallbackTask: refresh,
        initialTask: refresh,
      });
    },
  };

  return repository;

  function reconcileProductionReadiness() {
    const ready = businessStatus.orderingReady && catalogProductCount > 0;
    setProductionCatalogReady(ready);
    if (catalogProductCount > 0) {
      catalogStatus = ready
        ? { state: 'ready', message: `${catalogProductCount} productos verificados.` }
        : {
          state: 'blocked',
          message: 'El comercio todavía no habilitó pedidos con una configuración verificada.',
        };
    }
    return ready;
  }

  function getTrackingClient(token) {
    if (!isSafeTrackingToken(token) || typeof createTrackingClient !== 'function') return null;
    if (trackingClient && trackingClientToken === token) return trackingClient;
    try {
      trackingClient = createTrackingClient(token);
      trackingClientToken = token;
      return trackingClient;
    } catch (_) {
      trackingClient = null;
      trackingClientToken = '';
      return null;
    }
  }
}

function tableChange(table, filter, handler) {
  return {
    config: {
      event: '*',
      schema: 'public',
      table,
      filter,
    },
    handler,
  };
}

function createRealtimeWatch({
  client,
  pollMs,
  name,
  changes,
  fallbackTask,
  initialTask = null,
  pollingOnly = false,
}) {
  let stopped = false;
  let pollingStop = null;
  let channel = null;
  const safeTask = async (task) => {
    if (stopped || typeof task !== 'function') return;
    try {
      await task();
    } catch (_) {
      // El último estado confirmado se conserva hasta poder reconectar.
    }
  };
  const startFallback = () => {
    if (pollingStop || stopped) return;
    pollingStop = startPolling(() => safeTask(fallbackTask), pollMs);
  };
  const stopFallback = () => {
    pollingStop?.();
    pollingStop = null;
  };

  if (pollingOnly || typeof client.channel !== 'function') {
    startFallback();
  } else {
    channel = client.channel(`${sanitizeChannelName(name)}-${++channelSequence}`);
    for (const change of changes) {
      channel.on('postgres_changes', change.config, () => safeTask(change.handler));
    }
    channel.subscribe((status) => {
      if (status === 'SUBSCRIBED') stopFallback();
      if (['CHANNEL_ERROR', 'TIMED_OUT', 'CLOSED'].includes(status)) startFallback();
    });
  }

  if (initialTask) safeTask(initialTask);
  return () => {
    stopped = true;
    stopFallback();
    if (channel && typeof client.removeChannel === 'function') {
      Promise.resolve(client.removeChannel(channel)).catch(() => null);
    } else {
      channel?.unsubscribe?.();
    }
  };
}

async function prepareIdempotentRequest({
  values,
  items,
  storage,
  pendingStorageKey,
  cryptoImpl,
  memoryRequest,
}) {
  const input = JSON.stringify({
    items: [...items].sort((a, b) => a.product_id.localeCompare(b.product_id)),
    customerName: values.customerName,
    customerPhone: values.customerPhone,
    deliveryMode: values.deliveryMode,
    address: values.customerAddress,
    neighborhood: values.addressDetails.neighborhood,
    reference: values.addressDetails.reference,
    notes: values.customerNotes,
    paymentMethod: values.paymentMethod,
  });
  const fingerprint = await secureDigest(input, cryptoImpl);
  const stored = readStoredAccess(storage, pendingStorageKey);
  const reusable = [memoryRequest, stored].find((candidate) => (
    candidate?.fingerprint === fingerprint
    && isSafeRequestId(candidate.clientRequestId)
    && isSafeTrackingToken(candidate.trackingToken)
  ));
  if (reusable) return reusable;

  const request = {
    fingerprint,
    clientRequestId: `web_${randomBase64Url(18, cryptoImpl)}`,
    trackingToken: randomBase64Url(32, cryptoImpl),
  };
  persistOrderAccess({ storage, key: pendingStorageKey, access: request });
  return request;
}

function replaceProductionCatalog(products) {
  updateState((draft) => {
    const ids = new Set(products.map((product) => product.id));
    draft.products = products;
    draft.cart = (draft.cart || []).filter((item) => ids.has(item.productId));
    if (!products.some((product) => product.categoryId === draft.activeCategory)) {
      draft.activeCategory = 'all';
    }
  });
}

function rowToCatalogProduct(row = {}) {
  if (!isUuid(row.id) || !row.is_verified) return null;
  const name = sanitizeText(row.name, { maxLength: 100 });
  const price = normalizeMoneyValue(row.price, 0);
  if (!name || price <= 0) return null;

  const categoryName = sanitizeText(row.category, { fallback: 'Otros', maxLength: 80 });
  const presentation = sanitizeText(row.presentation, { maxLength: 80 });
  const capacity = sanitizeText(row.capacity, { maxLength: 60 });
  const packagingType = sanitizeText(row.packaging_type, { maxLength: 60 });
  const tags = Array.isArray(row.tags)
    ? row.tags.map((tag) => sanitizeText(tag, { maxLength: 40 })).filter(Boolean)
    : [];
  const tagSet = new Set(tags.map((tag) => tag.toLowerCase()));
  const stock = Math.max(0, Math.floor(Number(row.stock) || 0));

  return {
    id: row.id,
    name,
    brand: sanitizeText(row.brand, { maxLength: 80 }),
    description: sanitizeText(row.description, { maxLength: 180 }),
    categoryId: slugifyCategory(categoryName),
    categoryName,
    subcategory: sanitizeText(row.subcategory, { maxLength: 80 }),
    presentation,
    capacity,
    packagingType,
    tone: row.is_alcoholic ? 'alcoholic' : 'drink',
    image: sanitizeText(row.image_url, { maxLength: 500 }),
    price,
    stock,
    available: Boolean(row.available) && stock > 0,
    alcoholic: Boolean(row.is_alcoholic),
    tags,
    featured: tagSet.has('destacado') || tagSet.has('promo') || tagSet.has('promoción'),
    popular: tagSet.has('más vendido') || tagSet.has('mas vendido') || tagSet.has('popular'),
    badge: tagSet.has('promo') || tagSet.has('promoción') ? 'Promo' : '',
    unit: packagingType || 'unidad',
    unitLabel: [presentation, capacity, packagingType].filter(Boolean).join(' · ') || 'Unidad',
    marketNote: 'Datos verificados por el comercio.',
    sortOrder: Math.max(0, Math.floor(Number(row.sort_order) || 0)),
    prepMinutes: 1,
  };
}

function mirrorOrders(rows, { replace = false } = {}) {
  const orders = rows.map(rowToDemoOrder).filter(Boolean);
  updateState((draft) => {
    const currentLastOrderId = draft.lastOrderId;
    if (replace) {
      draft.orders = orders;
    } else {
      const keys = new Set(orders.flatMap((order) => [order.id, order.backendId]).filter(Boolean));
      draft.orders = [
        ...orders,
        ...draft.orders.filter((order) => !keys.has(order.id) && !keys.has(order.backendId)),
      ];
    }
    const currentOrder = draft.orders.find((order) => (
      order.id === currentLastOrderId || order.backendId === currentLastOrderId
    ));
    draft.lastOrderId = currentOrder ? currentOrder.id : null;
  });
  return orders.map(toDomainOrder).filter(Boolean);
}

function mirrorCreatedOrder(row) {
  const order = rowToDemoOrder(row);
  updateState((draft) => {
    draft.orders = [
      order,
      ...draft.orders.filter((candidate) => (
        candidate.id !== order.id && candidate.backendId !== order.backendId
      )),
    ];
    draft.lastOrderId = order.id;
    draft.cart = [];
  });
  return order;
}

function mirrorOrder(row) {
  const order = rowToDemoOrder(row);
  if (!order) return null;
  updateState((draft) => {
    const index = draft.orders.findIndex((candidate) => (
      candidate.id === order.id || candidate.backendId === order.backendId
    ));
    if (index >= 0) draft.orders[index] = order;
    else draft.orders.unshift(order);
  });
  return order;
}

// El RPC público devuelve deliberadamente un DTO distinto de la fila interna:
// no tiene UUID, items, importes, dirección ni datos del cliente. Nunca debe
// atravesar rowToDemoOrder(), porque eso completaría campos privados con
// defaults y reemplazaría una copia local más rica por información incompleta.
function mirrorPublicTracking(dto) {
  const publicTracking = normalizePublicTrackingDto(dto);
  if (!publicTracking) return null;

  updateState((draft) => {
    const index = draft.orders.findIndex((candidate) => (
      candidate.id === publicTracking.publicCode
      || candidate.code === publicTracking.publicCode
    ));
    const order = index >= 0
      ? mergePublicTracking(draft.orders[index], publicTracking)
      : publicTrackingShell(publicTracking);

    if (index >= 0) draft.orders[index] = order;
    else draft.orders.unshift(order);
    if (!draft.lastOrderId) draft.lastOrderId = order.id;
  });

  return getState().orders.find((candidate) => (
    candidate.id === publicTracking.publicCode
    || candidate.code === publicTracking.publicCode
  )) || null;
}

function normalizePublicTrackingDto(dto = {}) {
  if (!dto || typeof dto !== 'object' || Array.isArray(dto)) return null;
  const publicCode = sanitizeText(dto.public_code, { maxLength: 40 });
  if (!publicCode) return null;

  const workflowStatus = normalizeWorkflowStatus(dto.status);
  const status = toDemoOrderStatus(workflowStatus);
  const createdAt = normalizeOptionalIso(dto.created_at) || new Date().toISOString();
  const acceptedAt = normalizeOptionalIso(dto.accepted_at);
  const preparingAt = normalizeOptionalIso(dto.preparing_at);
  const readyAt = normalizeOptionalIso(dto.ready_at);
  const dispatchedAt = normalizeOptionalIso(dto.dispatched_at);
  const arrivedAt = normalizeOptionalIso(dto.arrived_at);
  const deliveredAt = normalizeOptionalIso(dto.delivered_at);
  const updatedAt = latestIsoTimestamp([
    deliveredAt,
    arrivedAt,
    dispatchedAt,
    readyAt,
    preparingAt,
    acceptedAt,
    createdAt,
  ]) || createdAt;
  const location = latestRiderLocation(
    dto.rider_location ? [dto.rider_location] : [],
  );
  const statusHistory = statusHistoryFromRow({
    accepted_at: acceptedAt,
    preparing_at: preparingAt,
    ready_at: readyAt,
    dispatched_at: dispatchedAt,
    arrived_at: arrivedAt,
    delivered_at: deliveredAt,
    updated_at: updatedAt,
  }, status, createdAt);
  const rawEstimate = Number(dto.estimated_minutes);
  const estimatedMinutes = Number.isFinite(rawEstimate)
    ? Math.min(1440, Math.max(0, Math.floor(rawEstimate)))
    : 0;

  return {
    publicCode,
    workflowStatus,
    status,
    createdAt,
    updatedAt,
    acceptedAt,
    preparingAt,
    readyAt,
    dispatchedAt,
    arrivedAt,
    deliveredAt,
    statusHistory,
    estimatedMinutes,
    tracking: location ? {
      lastLocation: location,
      source: 'gps',
      updatedAt: location.lastFixAt,
    } : undefined,
  };
}

function mergePublicTracking(order, tracking) {
  return {
    ...order,
    workflowStatus: tracking.workflowStatus,
    status: tracking.status,
    createdAt: tracking.createdAt,
    updatedAt: tracking.updatedAt,
    acceptedAt: tracking.acceptedAt,
    preparingAt: tracking.preparingAt,
    readyAt: tracking.readyAt,
    pickedUpAt: tracking.dispatchedAt,
    arrivedAt: tracking.arrivedAt,
    deliveredAt: tracking.deliveredAt,
    statusHistory: tracking.statusHistory,
    tracking: tracking.tracking,
    delivery: {
      ...(order.delivery || {}),
      currentLocationLabel: locationLabel(tracking.status, order.deliveryMode),
      ...(tracking.dispatchedAt ? { leftStoreAt: tracking.dispatchedAt } : {}),
      ...(tracking.deliveredAt ? { deliveredAt: tracking.deliveredAt } : {}),
    },
  };
}

function publicTrackingShell(tracking) {
  return {
    id: tracking.publicCode,
    code: tracking.publicCode,
    workflowStatus: tracking.workflowStatus,
    status: tracking.status,
    customerName: 'Cliente',
    customerPhone: '',
    address: '',
    addressDetails: null,
    deliveryMode: 'delivery',
    paymentMethodCode: 'unknown',
    paymentMethod: 'Sin especificar',
    notes: '',
    createdAt: tracking.createdAt,
    updatedAt: tracking.updatedAt,
    acceptedAt: tracking.acceptedAt,
    preparingAt: tracking.preparingAt,
    readyAt: tracking.readyAt,
    pickedUpAt: tracking.dispatchedAt,
    arrivedAt: tracking.arrivedAt,
    deliveredAt: tracking.deliveredAt,
    statusHistory: tracking.statusHistory,
    items: [],
    subtotal: 0,
    deliveryFee: 0,
    total: 0,
    currencyCode: '',
    assignedRiderId: '',
    delivery: {
      driverName: 'Sin asignar',
      driverPhone: '',
      estimatedMinutes: tracking.estimatedMinutes,
      currentLocationLabel: locationLabel(tracking.status, 'delivery'),
      ...(tracking.dispatchedAt ? { leftStoreAt: tracking.dispatchedAt } : {}),
      ...(tracking.deliveredAt ? { deliveredAt: tracking.deliveredAt } : {}),
    },
    tracking: tracking.tracking,
    publicTrackingOnly: true,
  };
}

function mirrorGpsLocation(order, location) {
  if (!order || order.deliveryMode !== 'delivery') return;
  if (['delivered', 'cancelled'].includes(order.status)) return;
  updateState((draft) => {
    draft.simulation = {
      orderId: order.id,
      running: false,
      mode: 'gps',
      source: 'gps',
      routeId: 'gps',
      progress: 0,
      baseEta: order.delivery?.estimatedMinutes || 0,
      etaMinutes: order.delivery?.estimatedMinutes || 0,
      timestamp: location.timestamp,
      lastFixAt: location.lastFixAt,
      gpsStatus: 'active',
      lastGpsFixAt: location.lastFixAt,
      lastSentSource: 'gps',
      lat: location.lat,
      lng: location.lng,
      ...(Number.isFinite(Number(location.accuracy)) ? { accuracy: location.accuracy } : {}),
      ...(Number.isFinite(Number(location.heading)) ? { heading: location.heading } : {}),
      ...(Number.isFinite(Number(location.speed)) ? { speed: location.speed } : {}),
    };
  });
}

function rowToDemoOrder(row = {}) {
  if (!row.id) return null;
  const workflowStatus = normalizeWorkflowStatus(row.status);
  const status = toDemoOrderStatus(workflowStatus);
  const deliveryMode = (row.delivery_mode || row.fulfillment_type) === 'pickup' ? 'pickup' : 'delivery';
  const items = Array.isArray(row.order_items)
    ? row.order_items.map(rowToDemoItem).filter(Boolean)
    : [];
  const latestLocation = latestRiderLocation(row.rider_locations);
  const createdAt = normalizeIso(row.created_at);
  const addressDetails = deliveryMode === 'pickup' ? null : normalizeAddressDetails({
    customerStreetAddress: row.customer_street_address || row.address_label,
    customerNeighborhood: row.customer_neighborhood,
    customerReference: row.customer_reference,
    customerAddress: row.address_label,
  });

  return {
    id: sanitizeText(row.public_code || row.code || row.id, { maxLength: 80 }),
    backendId: row.id,
    code: sanitizeText(row.public_code || row.code || row.id, { maxLength: 80 }),
    workflowStatus,
    customerName: sanitizeText(row.customer_name, { fallback: 'Cliente', maxLength: 80 }),
    customerPhone: sanitizeText(row.customer_phone, { maxLength: 40 }),
    address: deliveryMode === 'pickup'
      ? getBusinessConfig().address
      : addressDetails.label || sanitizeText(row.address_label, { fallback: 'Sin dirección', maxLength: 180 }),
    addressDetails,
    deliveryMode,
    paymentMethodCode: sanitizeText(row.payment_method, { fallback: 'coordinate', maxLength: 40 }),
    paymentMethod: paymentLabel(row.payment_method || 'coordinate'),
    notes: sanitizeNotes(row.customer_notes || row.notes),
    createdAt,
    updatedAt: normalizeIso(row.updated_at || row.created_at),
    status,
    items,
    subtotal: normalizeMoneyValue(row.subtotal, 0),
    deliveryFee: normalizeMoneyValue(row.delivery_fee, 0),
    total: normalizeMoneyValue(row.total, 0),
    currencyCode: sanitizeText(row.currency_code, { maxLength: 3 }).toUpperCase(),
    assignedRiderId: sanitizeText(row.assigned_rider_user_id || row.assigned_rider_id, { maxLength: 80 }),
    statusHistory: statusHistoryFromRow(row, status, createdAt),
    delivery: {
      driverName: deliveryMode === 'pickup' ? 'Sin asignar' : 'Rider asignado',
      driverPhone: '',
      estimatedMinutes: status === 'delivered' || status === 'cancelled' || deliveryMode === 'pickup' ? 0 : 25,
      currentLocationLabel: locationLabel(status, deliveryMode),
      ...(row.dispatched_at || row.picked_up_at
        ? { leftStoreAt: normalizeIso(row.dispatched_at || row.picked_up_at) }
        : {}),
      ...(row.delivered_at ? { deliveredAt: normalizeIso(row.delivered_at) } : {}),
    },
    tracking: latestLocation ? {
      lastLocation: latestLocation,
      source: latestLocation.source,
      updatedAt: latestLocation.lastFixAt,
    } : undefined,
  };
}

function rowToDemoItem(item = {}) {
  const productId = sanitizeText(item.product_uuid || item.product_id, { maxLength: 80 });
  if (!productId) return null;
  return {
    productId,
    name: sanitizeText(item.product_name || item.name, { fallback: 'Producto', maxLength: 100 }),
    quantity: Math.max(1, Math.floor(Number(item.quantity) || 1)),
    unitPrice: normalizeMoneyValue(item.unit_price, 0),
    unit: sanitizeText(item.presentation || item.unit, { fallback: 'unidad', maxLength: 80 }),
  };
}

function latestRiderLocation(locations) {
  if (!Array.isArray(locations) || !locations.length) return null;
  const gpsLocations = locations.filter((location) => location?.source === 'gps');
  if (!gpsLocations.length) return null;
  const latest = [...gpsLocations].sort((a, b) => (
    Date.parse(b.created_at || '') - Date.parse(a.created_at || '')
  ))[0];
  return normalizeTrackingLocation({
    lat: latest.lat,
    lng: latest.lng,
    accuracy: latest.accuracy,
    heading: latest.heading,
    speed: latest.speed,
    source: 'gps',
    timestamp: latest.created_at,
  });
}

function statusHistoryFromRow(row, status, createdAt) {
  const history = [{ status: 'received', at: createdAt }];
  if (row.accepted_at || row.preparing_at || ['preparing', 'ready', 'on_the_way', 'arriving', 'delivered'].includes(status)) {
    history.push({ status: 'preparing', at: normalizeIso(row.preparing_at || row.accepted_at || row.updated_at || createdAt) });
  }
  if (row.ready_at || ['ready', 'on_the_way', 'arriving', 'delivered'].includes(status)) {
    history.push({ status: 'ready', at: normalizeIso(row.ready_at || row.updated_at || createdAt) });
  }
  if (row.dispatched_at || row.picked_up_at || ['on_the_way', 'arriving', 'delivered'].includes(status)) {
    history.push({ status: 'on_the_way', at: normalizeIso(row.dispatched_at || row.picked_up_at || row.updated_at || createdAt) });
  }
  if (row.arrived_at || ['arriving', 'delivered'].includes(status)) {
    history.push({ status: 'arriving', at: normalizeIso(row.arrived_at || row.updated_at || createdAt) });
  }
  if (row.delivered_at || status === 'delivered') {
    history.push({ status: 'delivered', at: normalizeIso(row.delivered_at || row.updated_at || createdAt) });
  }
  if (row.cancelled_at || row.canceled_at || status === 'cancelled') {
    history.push({ status: 'cancelled', at: normalizeIso(row.cancelled_at || row.canceled_at || row.updated_at || createdAt) });
  }
  return dedupeHistory(history);
}

function dedupeHistory(history) {
  const seen = new Set();
  return history.filter((entry) => {
    if (seen.has(entry.status)) return false;
    seen.add(entry.status);
    return true;
  });
}

export function nextRepositoryStatusForOrder(order) {
  const domainOrder = toDomainOrder(order);
  if (!domainOrder) return null;
  return getNextWorkflowStatus(domainOrder.status, domainOrder.fulfillmentType);
}

function locationLabel(status, deliveryMode) {
  if (deliveryMode === 'pickup') return 'Pedido para retirar en local';
  if (status === 'ready') return 'Pedido listo en el local';
  if (status === 'on_the_way') return 'El repartidor salió del local';
  if (status === 'arriving') return 'El repartidor está llegando';
  if (status === 'delivered') return 'Pedido entregado';
  if (status === 'cancelled') return 'Pedido cancelado por el negocio';
  return 'Pedido recibido por el local';
}

function startPolling(task, pollMs) {
  const id = setInterval(task, Math.max(1000, Number(pollMs) || 5000));
  return () => clearInterval(id);
}

function unwrapOrderRow(payload) {
  const value = Array.isArray(payload) ? payload[0] || null : payload;
  if (!value || typeof value !== 'object') return null;
  if (value.order && typeof value.order === 'object') {
    return {
      ...value.order,
      order_items: value.order_items || value.items || value.order.order_items || [],
      rider_locations: value.rider_locations || value.order.rider_locations || [],
    };
  }
  return {
    ...value,
    order_items: value.order_items || value.items || [],
    rider_locations: value.rider_locations || [],
  };
}

function failedQuery(error, status, fallback) {
  return repositoryResult(false, {
    message: fallback || readableSupabaseError(error),
    errorCode: sanitizeText(error?.code, { maxLength: 40 }),
    status: Number(status || error?.status || 0) || undefined,
  });
}

function readableOrderCreationError(error) {
  const text = `${error?.message || ''} ${error?.details || ''}`.toLowerCase();
  if (text.includes('stock') || text.includes('available')) {
    return 'Algunos productos ya no tienen stock. Actualizá el carrito y probá de nuevo.';
  }
  if (text.includes('ordering') || text.includes('disabled') || text.includes('verified')) {
    return 'El comercio todavía no habilitó los pedidos online.';
  }
  if (text.includes('client_request') || text.includes('fingerprint') || text.includes('idempot')) {
    return 'El contenido del pedido cambió durante el envío. Revisalo y confirmá otra vez.';
  }
  if (text.includes('jwt') || text.includes('auth') || Number(error?.status) === 401) {
    return 'La sesión segura venció. Recargá la página y probá de nuevo.';
  }
  if (text.includes('create_order_with_items') || error?.code === 'PGRST202') {
    return 'El backend de pedidos todavía no tiene aplicada la migración productiva.';
  }
  return 'No pudimos confirmar el pedido. Conservamos el intento para reintentar sin duplicarlo.';
}

function readableStatusError(error) {
  const text = `${error?.message || ''} ${error?.details || ''}`.toLowerCase();
  if (text.includes('expected') || text.includes('stale') || text.includes('estado actual')) {
    return 'El pedido cambió en otro dispositivo. Actualizá la bandeja antes de continuar.';
  }
  if (text.includes('transition') || text.includes('transición')) {
    return 'Ese cambio de estado no está permitido.';
  }
  if (text.includes('membership') || text.includes('role') || text.includes('permission')) {
    return 'Tu cuenta no tiene permiso para cambiar este pedido.';
  }
  return readableSupabaseError(error, 'No pudimos cambiar el estado del pedido.');
}

function readableSupabaseError(error, fallback = 'No pudimos comunicarnos con el backend.') {
  if (Number(error?.status) === 401) return 'La sesión no es válida o venció.';
  if (Number(error?.status) === 403) return 'Tu cuenta no tiene permiso para realizar esta acción.';
  if (Number(error?.status) === 429) return 'Hay demasiadas solicitudes. Esperá un momento y probá de nuevo.';
  return fallback;
}

function persistOrderAccess({ storage, key, access }) {
  if (!storage || !key || !access) return;
  try {
    storage.setItem(key, JSON.stringify(access));
  } catch (_) {
    // La sesión Auth sigue siendo suficiente; storage no es requisito operativo.
  }
}

function readStoredAccess(storage, key) {
  if (!storage || !key) return null;
  try {
    const parsed = JSON.parse(storage.getItem(key) || 'null');
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch (_) {
    return null;
  }
}

function removeStoredAccess(storage, key) {
  if (!storage || !key) return;
  try {
    storage.removeItem(key);
  } catch (_) {
    // La sesión Auth sigue siendo suficiente; storage no es requisito operativo.
  }
}

async function secureDigest(value, cryptoImpl) {
  if (!cryptoImpl?.subtle || typeof TextEncoder === 'undefined') {
    throw new Error('Secure digest unavailable.');
  }
  const bytes = new TextEncoder().encode(value);
  const digest = await cryptoImpl.subtle.digest('SHA-256', bytes);
  return bytesToBase64Url(new Uint8Array(digest));
}

function randomBase64Url(byteLength, cryptoImpl) {
  if (!cryptoImpl?.getRandomValues) throw new Error('Secure random unavailable.');
  const bytes = new Uint8Array(byteLength);
  cryptoImpl.getRandomValues(bytes);
  return bytesToBase64Url(bytes);
}

function bytesToBase64Url(bytes) {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  const base64 = typeof btoa === 'function'
    ? btoa(binary)
    : Buffer.from(bytes).toString('base64');
  return base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function isSafeRequestId(value) {
  return /^[A-Za-z0-9_-]{8,128}$/.test(String(value || ''));
}

function isSafeTrackingToken(value) {
  return /^[A-Za-z0-9_-]{32,256}$/.test(String(value || ''));
}

function matchesStoredOrderAccess(access, orderId) {
  const requested = String(orderId || '').trim();
  return Boolean(
    access
    && isSafeTrackingToken(access.trackingToken)
    && [access.orderId, access.publicCode].map(String).includes(requested),
  );
}

function slugifyCategory(value) {
  const slug = String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
  return slug || 'otros';
}

function sanitizeChannelName(value) {
  return String(value || 'taba')
    .replace(/[^a-zA-Z0-9_-]/g, '-')
    .slice(0, 80);
}

function isUuid(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(value || ''));
}

function normalizeIso(value, fallback = new Date().toISOString()) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? fallback : date.toISOString();
}

function normalizeOptionalIso(value) {
  if (value == null || value === '') return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function latestIsoTimestamp(values) {
  const timestamps = values
    .map((value) => normalizeOptionalIso(value))
    .filter(Boolean)
    .sort((a, b) => Date.parse(b) - Date.parse(a));
  return timestamps[0] || null;
}

function safeSessionStorage() {
  try {
    return globalThis.sessionStorage || null;
  } catch (_) {
    return null;
  }
}
