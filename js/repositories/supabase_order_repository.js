import { getBusinessConfig } from '../core/business-config-store.js';
import { getCartCombos, getCartItems } from '../cart.js';
import {
  normalizeOrderDraft,
  normalizeTrackingLocation,
  toDomainOrder,
} from '../core/domain.js';
import { normalizeMoneyValue } from '../core/pricing.js';
import { normalizeAddressDetails } from '../core/address.js';
import { buildDeliveryCode, normalizeDeliveryCodeValue } from '../core/delivery-code.js';
import {
  getNextWorkflowStatus,
  normalizeWorkflowStatus,
  toDemoOrderStatus,
} from '../core/order-workflow.js';
import {
  isValidArgentinePhone,
  normalizeArgentinePhone,
  sanitizeNotes,
  sanitizeText,
  validateCustomerName,
} from '../core/validators.js';
import { setProductionCatalogReady } from '../core/runtime-config.js';
import {
  getState,
  paymentLabel,
  statusLabel,
  updateBusinessConfig,
  updateState,
} from '../state.js';
import { createSupabaseAuthService } from '../services/supabase-auth.js';
import { createSupabaseCustomerProfileRepository } from './customer_profile_repository.js';
import {
  buildMercadoPagoCheckoutPayload,
  clearMercadoPagoCheckoutRecord,
  createCheckoutClientRequestId,
  readMercadoPagoCheckoutRecord,
  writeMercadoPagoCheckoutRecord,
} from '../payments/mercadopago-checkout.js';
import { repositoryResult } from './order_repository.js';
import {
  allowActiveOrderFallback,
  getActiveOrderId,
  suppressActiveOrderFallback,
} from '../orders.js';
import { createCustomerTrackingPollController } from '../tracking/customer_tracking_poll.js';
import {
  BUSINESS_INBOX_DATABASE_STATUSES,
  BUSINESS_INBOX_STATUSES,
} from '../core/business-order-intake.js';

// Se conserva sólo para detectar configuraciones históricas. Producción exige un
// businessId explícito y verificado en el runtime config.
export const DEFAULT_SUPABASE_BUSINESS_ID = '00000000-0000-4000-8000-000000000001';

const ORDER_ACCESS_STORAGE_VERSION = 'taba-order-access-v1';
// GPS is intentionally never selected from the client-facing order query.
// Customers obtain the minimized, token-authorized tracking DTO via RPC; the
// rider publishes through its dedicated RPC. This keeps raw rider_locations
// outside browser reads even when an order is otherwise visible to the user.
const ORDER_SELECT = '*,order_items(*)';
const BUSINESS_ORDER_SELECT = '*,order_items(*),order_events(*),order_combos(*)';
const PUBLIC_TRACKING_GPS_MAX_AGE_MS = 3 * 60 * 1000;
const PUBLIC_TRACKING_GPS_FUTURE_TOLERANCE_MS = 30 * 1000;
const PUBLIC_TRACKING_GPS_MAX_ACCURACY_METERS = 250;
const TRUSTED_ETA_MAX_AGE_MS = 15 * 60 * 1000;
const TRUSTED_ETA_SOURCES = new Set(['business', 'routing']);
const MAX_BUSINESS_INBOX_ORDERS = 500;
const BUSINESS_INBOX_ORIGIN = 'production';
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
  const customerProfiles = createSupabaseCustomerProfileRepository({ client, authService: auth });
  const pollingInterval = Math.max(1000, Number(pollMs) || 5000);
  const pendingStorageKey = `${ORDER_ACCESS_STORAGE_VERSION}:${businessId}:pending`;
  const lastAccessStorageKey = `${ORDER_ACCESS_STORAGE_VERSION}:${businessId}:last`;
  let lastOrderAccess = readInitialOrderAccess(storage, lastAccessStorageKey);
  let unavailableTrackingOrderId = '';
  let trackingClient = null;
  let trackingClientToken = '';
  let pendingRequest = null;
  let createInFlight = null;
  let mercadoPagoCheckoutInFlight = null;
  const mercadoPagoStorage = safeLocalStorage();
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
  const customerTrackingPoll = createCustomerTrackingPollController({
    fetchSnapshot: ({ orderId, trackingToken, signal }) => fetchPublicTrackingSnapshot(
      orderId,
      { trackingToken, signal, mirror: true },
    ),
    onUnavailable: ({ orderId = '' } = {}) => markTrackingUnavailable(orderId),
    onSnapshot: (order) => {
      const status = normalizeWorkflowStatus(order?.workflowStatus || order?.status, '');
      if (!['delivered', 'canceled'].includes(status)) return;
      unavailableTrackingOrderId = '';
    },
    // A poll tick also refreshes derived freshness labels when the DTO did not
    // change (or the network is slow), without fabricating a new GPS point.
    onTick: () => updateState(() => {}),
  });

  function markTrackingUnavailable(orderId = '', { selectLocalOrder = false } = {}) {
    const unavailableId = String(orderId || '').trim();
    const access = lastOrderAccess || readStoredAccess(storage, lastAccessStorageKey);
    const unavailableIds = new Set([
      unavailableId,
      String(access?.orderId || '').trim(),
      String(access?.publicCode || '').trim(),
    ].filter(Boolean));
    unavailableTrackingOrderId = unavailableId;
    suppressActiveOrderFallback();
    lastOrderAccess = null;
    removeStoredAccess(storage, lastAccessStorageKey);
    trackingClient = null;
    trackingClientToken = '';
    if (!unavailableId) return;

    updateState((draft) => {
      let removedSelectedShell = false;
      draft.orders = draft.orders.filter((order) => {
        const matches = [order.id, order.code, order.backendId]
          .filter(Boolean)
          .map(String)
          .some((candidate) => unavailableIds.has(candidate));
        const remove = matches && order.publicTrackingOnly === true;
        if (remove && [order.id, order.code].map(String).includes(String(draft.lastOrderId))) {
          removedSelectedShell = true;
        }
        return !remove;
      });
      if (removedSelectedShell) draft.lastOrderId = null;
    });
    if (selectLocalOrder) {
      selectTrackingOrder(unavailableId);
    }
  }

  async function fetchOrderByPublicId(publicId, {
    mirror = false,
    trackingToken = '',
    signal = null,
  } = {}) {
    const clean = String(publicId || '').trim();
    if (!clean) return null;
    const requestClient = getTrackingClient(trackingToken) || client;

    if (trackingToken) {
      const result = await fetchPublicTrackingSnapshot(clean, {
        trackingToken,
        signal,
        mirror,
      });
      return result.kind === 'snapshot' ? result.order : null;
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
    const access = getTrackingAccess();
    const orders = mirror
      ? mirrorOrders(rows, {
        replace: true,
        preservePublicTrackingIds: access && !unavailableTrackingOrderId
          ? [access.orderId, access.publicCode]
          : [],
      })
      : rows.map(rowToDemoOrder).filter(Boolean).map(toDomainOrder).filter(Boolean);
    if (mirror) {
      if (access) selectTrackingOrder(access.orderId || access.publicCode);
    }
    return repositoryResult(true, { rows, orders });
  }

  async function fetchBusinessOrderSnapshot() {
    const { data, error, status } = await client
      .from('orders')
      .select(BUSINESS_ORDER_SELECT)
      .eq('business_id', businessId)
      // La bandeja operativa es la operación real. Un pedido QA se conserva
      // como evidencia en la base y sigue siendo consultable, pero no entra a
      // la cola que el negocio acepta, prepara y despacha: nadie puede mandar
      // una moto a una dirección inventada por un E2E.
      .eq('origin', BUSINESS_INBOX_ORIGIN)
      .in('status', BUSINESS_INBOX_DATABASE_STATUSES)
      .order('created_at', { ascending: true })
      .order('id', { ascending: true })
      .limit(MAX_BUSINESS_INBOX_ORDERS + 1);

    if (error) {
      return failedQuery(error, status, businessSnapshotErrorMessage(error, status));
    }
    const rows = Array.isArray(data) ? data : [];
    if (rows.length > MAX_BUSINESS_INBOX_ORDERS) {
      return repositoryResult(false, {
        code: 'BUSINESS_INBOX_LIMIT_EXCEEDED',
        message: 'La bandeja supera 500 pedidos activos; no se aplicó un snapshot truncado.',
      });
    }

    for (const row of rows) {
      const validationError = validateBusinessOrderRow(row, businessId);
      if (validationError) {
        return repositoryResult(false, {
          code: 'BUSINESS_ORDER_INCOMPLETE',
          message: `PostgreSQL devolvió un pedido incompleto (${validationError}).`,
        });
      }
    }

    const orders = rows.map(rowToDemoOrder).filter(Boolean);
    if (orders.length !== rows.length) {
      return repositoryResult(false, {
        code: 'BUSINESS_ORDER_NORMALIZATION_FAILED',
        message: 'No se pudo normalizar el snapshot completo de pedidos.',
      });
    }
    return repositoryResult(true, {
      rows,
      orders,
      syncedAt: new Date().toISOString(),
    });
  }

  function getTrackingAccess() {
    const access = lastOrderAccess || readStoredAccess(storage, lastAccessStorageKey);
    if (!hasUsableTrackingAccess(access)) {
      if (access) removeStoredAccess(storage, lastAccessStorageKey);
      lastOrderAccess = null;
      return null;
    }
    lastOrderAccess = access;
    return access;
  }

  function selectTrackingOrder(orderId) {
    const requested = String(orderId || '').trim();
    if (!requested) return null;
    const currentState = getState();
    const selected = currentState?.orders?.find((order) => (
      [order.id, order.code, order.backendId].map(String).includes(requested)
    )) || null;
    if (!selected || currentState.lastOrderId === selected.id) return selected;
    updateState((draft) => {
      allowActiveOrderFallback();
      draft.lastOrderId = selected.id;
    });
    return selected;
  }

  function hasTerminalTrackingState(access) {
    const requested = String(access?.orderId || access?.publicCode || '').trim();
    if (!requested) return false;
    const order = getState().orders.find((candidate) => (
      [candidate.id, candidate.code, candidate.backendId].map(String).includes(requested)
    ));
    return normalizeWorkflowStatus(order?.workflowStatus || order?.status, '') === 'delivered';
  }

  async function fetchPublicTrackingSnapshot(publicId, {
    trackingToken = '',
    signal = null,
    mirror = true,
  } = {}) {
    const clean = String(publicId || '').trim();
    const requestClient = getTrackingClient(trackingToken);
    if (!clean || !requestClient) return { kind: 'unavailable' };
    let request = requestClient.rpc('get_public_order_tracking', { p_public_id: clean });
    if (signal && typeof request?.abortSignal === 'function') request = request.abortSignal(signal);
    const { data, error } = await request;
    if (signal?.aborted) return { kind: 'aborted' };
    if (error) {
      const status = Number(error.status || error.statusCode || 0);
      const code = String(error.code || '').trim();
      if ([401, 403].includes(status) || code === '42501') return { kind: 'unavailable' };
      return { kind: 'network-error', error };
    }
    if (!data) return { kind: 'unavailable' };
    const order = mirror ? mirrorPublicTracking(data) : data;
    return order ? { kind: 'snapshot', order } : { kind: 'unavailable' };
  }

  async function recoverCustomerTrackingAccess(rows = []) {
    if (getTrackingAccess()) return lastOrderAccess;
    const { data: userData, error: userError } = await client.auth.getUser();
    const userId = userError ? '' : sanitizeText(userData?.user?.id, { maxLength: 80 });
    if (!isUuid(userId)) return null;
    const row = rows.find((candidate) => (
      candidate?.customer_user_id === userId
      && candidate?.delivery_mode === 'delivery'
      && !['delivered', 'canceled', 'cancelled', 'rejected'].includes(
        normalizeWorkflowStatus(candidate?.status),
      )
    ));
    if (!row?.id) return null;

    let trackingToken = '';
    try {
      trackingToken = randomBase64Url(32, cryptoImpl);
    } catch (_) {
      return null;
    }
    const { data, error } = await client.rpc('recover_order_tracking_access', {
      p_order_id: row.id,
      p_new_tracking_token: trackingToken,
    });
    const deliveryCode = normalizeDeliveryCodeValue(data?.delivery_code);
    if (error || !data?.ok || !deliveryCode) return null;

    const access = {
      orderId: row.id,
      publicCode: sanitizeText(data.public_code || row.public_code, { maxLength: 80 }),
      trackingToken,
      tokenExpiresAt: normalizeOptionalIso(data.token_expires_at),
      recoveredAt: new Date().toISOString(),
    };
    lastOrderAccess = access;
    persistOrderAccess({ storage, key: lastAccessStorageKey, access });
    mirrorOrder({
      ...row,
      delivery_code: deliveryCode,
    });
    return access;
  }

  async function loadBusinessConfiguration() {
    const { data, error, status } = await client
      .from('businesses')
      .select([
        'id',
        'name',
        'address',
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
    const {
      data: publicContactPayload,
      error: publicContactError,
    } = await client.rpc('get_public_business_contact', {
      p_business_id: businessId,
    });
    const publicContact = Array.isArray(publicContactPayload)
      ? publicContactPayload[0] || null
      : publicContactPayload;
    const whatsappNumber = publicContactError
      ? ''
      : sanitizeText(publicContact?.whatsapp_phone, { maxLength: 40 });
    const whatsappDigits = whatsappNumber.replace(/\D/g, '');
    updateBusinessConfig({
      businessName: sanitizeText(data.name, { fallback: 'TABA', maxLength: 80 }),
      name: sanitizeText(data.name, { fallback: 'TABA', maxLength: 80 }),
      subtitle: 'Tienda de bebidas',
      address: sanitizeText(data.address, { fallback: 'Dirección no publicada', maxLength: 180 }),
      whatsappNumber,
      whatsappVerified: !publicContactError
        && publicContact?.whatsapp_verified === true
        && whatsappDigits.length >= 8
        && whatsappDigits.length <= 15,
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
        'external_id',
        'sku',
        'name',
        'brand',
        'description',
        'category',
        'subcategory',
        'variant',
        'presentation',
        'capacity_value',
        'capacity_unit',
        'capacity',
        'packaging_type',
        'units_per_pack',
        'price',
        'price_status',
        'stock',
        'available',
        'chilled',
        'is_alcoholic',
        'minimum_age',
        'image_url',
        'image_sha256',
        'image_thumbnail_url',
        'image_thumbnail_sha256',
        'source_image_sha256',
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
      catalogStatus = {
        state: 'error',
        message: readableSupabaseError(error, 'No pudimos cargar el catálogo verificado.'),
      };
      replaceProductionCatalog([]);
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
    const protectedTrackingAccess = getTrackingAccess();
    const values = normalizeOrderDraft(orderDraft);
    // La ruta directa de pedidos sólo acepta líneas de producto: es el backend
    // que NO deriva el precio de un combo. Dejar pasar un combo por acá lo
    // cobraría a la suma de los precios de lista, así que se rechaza en vez de
    // expandirlo en silencio. El combo se cobra por Checkout Pro.
    if (getCartCombos().length) {
      return repositoryResult(false, {
        message: 'Los combos se cobran con Mercado Pago. Elegí Mercado Pago o quitá el combo del carrito.',
      });
    }
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
    const nameValidation = validateCustomerName(values.customerName);
    if (!nameValidation.ok) return repositoryResult(false, { message: nameValidation.message });
    const customerPhone = normalizeArgentinePhone(values.customerPhone);
    if (!isValidArgentinePhone(customerPhone)) {
      return repositoryResult(false, { message: 'Ingresá un teléfono argentino válido, con código de área.' });
    }
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

    const normalizedValues = {
      ...values,
      customerName: nameValidation.name,
      customerPhone,
    };
    let request;
    try {
      request = await prepareIdempotentRequest({
        values: normalizedValues,
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
      customer_name: normalizedValues.customerName,
      customer_phone: normalizedValues.customerPhone,
      delivery_mode: normalizedValues.deliveryMode,
      payment_method: normalizedValues.paymentMethod,
      age_confirmed: normalizedValues.ageConfirmed,
      ...(normalizedValues.deliveryMode === 'delivery' ? {
        customer_street_address: normalizedValues.addressDetails.streetLine || normalizedValues.customerAddress,
        address_label: normalizedValues.customerAddress,
        customer_neighborhood: normalizedValues.addressDetails.neighborhood || undefined,
        customer_reference: normalizedValues.addressDetails.reference || undefined,
        customer_address_label: normalizedValues.customerAddressLabel || undefined,
        delivery_street: normalizedValues.deliveryStreet || undefined,
        delivery_street_number: normalizedValues.deliveryStreetNumber || undefined,
        delivery_floor: normalizedValues.deliveryFloor || undefined,
        delivery_apartment: normalizedValues.deliveryApartment || undefined,
        delivery_city: normalizedValues.deliveryCity || undefined,
        delivery_province: normalizedValues.deliveryProvince || undefined,
        delivery_postal_code: normalizedValues.deliveryPostalCode || undefined,
        ...(normalizedValues.customerAddressId ? { customer_address_id: normalizedValues.customerAddressId } : {}),
        ...(
          Number.isFinite(normalizedValues.deliveryLatitude) && Number.isFinite(normalizedValues.deliveryLongitude)
            ? {
              delivery_latitude: normalizedValues.deliveryLatitude,
              delivery_longitude: normalizedValues.deliveryLongitude,
              ...(Number.isFinite(normalizedValues.deliveryGeolocationAccuracy)
                ? { delivery_geolocation_accuracy: normalizedValues.deliveryGeolocationAccuracy }
                : {}),
              delivery_address_source: normalizedValues.deliveryAddressSource,
            }
            : {}
        ),
      } : {}),
      ...(normalizedValues.customerNotes ? { customer_notes: normalizedValues.customerNotes } : {}),
    };

    const { data, error, status } = await client.rpc('create_order_with_items', { payload });
    if (error) return failedQuery(error, status, readableOrderCreationError(error));

    const row = unwrapOrderRow(data);
    if (!row?.id) {
      return repositoryResult(false, {
        message: 'El backend no devolvió el pedido creado.',
      });
    }

    if (normalizedValues.deliveryMode === 'delivery') {
      let deliveryCode = normalizeDeliveryCodeValue(row.delivery_code);
      if (!deliveryCode) {
        const {
          data: handoffData,
          error: handoffError,
          status: handoffStatus,
        } = await client.rpc('issue_order_delivery_code', {
          p_order_id: row.id,
          p_tracking_token: request.trackingToken,
        });
        if (handoffError) {
          return failedQuery(
            handoffError,
            handoffStatus,
            'El backend todavía no puede emitir el código de entrega de forma atómica.',
          );
        }
        deliveryCode = normalizeDeliveryCodeValue(handoffData?.delivery_code);
      }
      if (!deliveryCode) {
        return repositoryResult(false, {
          message: 'El backend no devolvió un código de entrega válido. Reintentá.',
        });
      }
      row.delivery_code = deliveryCode;
    }

    const createdOrderAccess = {
      orderId: row.id,
      publicCode: row.public_code || row.code || '',
      clientRequestId: request.clientRequestId,
      trackingToken: request.trackingToken,
    };
    lastOrderAccess = protectedTrackingAccess || createdOrderAccess;
    persistOrderAccess({
      storage,
      key: lastAccessStorageKey,
      access: lastOrderAccess,
    });
    // Una respuesta exitosa completa este intento. Mantener la clave como
    // "pending" haría que un pedido nuevo e idéntico reutilice el pedido
    // anterior. Los errores conservan la clave; los éxitos la descartan.
    pendingRequest = null;
    removeStoredAccess(storage, pendingStorageKey);

    const order = mirrorCreatedOrder(row);
    if (protectedTrackingAccess) {
      selectTrackingOrder(protectedTrackingAccess.orderId || protectedTrackingAccess.publicCode);
    }
    await loadCatalog().catch(() => null);
    return repositoryResult(true, {
      order,
      domainOrder: toDomainOrder(order),
      trackingToken: request.trackingToken,
      clientRequestId: request.clientRequestId,
      message: `Pedido ${order.id} creado.`,
    });
  }

  async function getMercadoPagoCheckoutAvailability() {
    const session = await auth.ensureCustomerSession();
    if (!session.ok) return repositoryResult(false, { available: false, message: session.message });
    const { data, error } = await client.rpc('get_mercadopago_checkout_availability', {
      p_business_id: businessId,
    });
    if (error || !data || typeof data !== 'object') {
      return repositoryResult(false, {
        available: false,
        message: 'Mercado Pago no está disponible en este momento.',
      });
    }
    return repositoryResult(true, {
      available: data.available === true,
      environment: sanitizeText(data.environment, { maxLength: 20 }),
      checkoutMode: sanitizeText(data.checkout_mode, { maxLength: 40 }),
      allowOfflinePaymentMethods: data.allow_offline_payment_methods === true,
      installmentsLimit: Number.isInteger(Number(data.installments_limit))
        ? Number(data.installments_limit)
        : null,
    });
  }

  async function createMercadoPagoCheckout(orderDraft = {}) {
    if (mercadoPagoCheckoutInFlight) return mercadoPagoCheckoutInFlight;
    mercadoPagoCheckoutInFlight = createMercadoPagoCheckoutInternal(orderDraft);
    try {
      return await mercadoPagoCheckoutInFlight;
    } finally {
      mercadoPagoCheckoutInFlight = null;
    }
  }

  async function createMercadoPagoCheckoutInternal(orderDraft = {}) {
    const values = normalizeOrderDraft(orderDraft);
    if (values.paymentMethod !== 'mercadopago') {
      return repositoryResult(false, { message: 'Elegí Mercado Pago para continuar con este checkout.' });
    }
    if (businessStatus.state === 'idle') await loadBusinessConfiguration();
    if (catalogStatus.state === 'idle') await loadCatalog();
    if (!businessStatus.orderingReady || catalogProductCount < 1) {
      return repositoryResult(false, {
        message: 'El comercio todavía no habilitó una configuración verificada para pedidos.',
      });
    }
    if (
      (values.deliveryMode === 'delivery' && !businessStatus.deliveryEnabled)
      || (values.deliveryMode === 'pickup' && !businessStatus.pickupEnabled)
    ) {
      return repositoryResult(false, { message: 'La modalidad elegida no está habilitada por el comercio.' });
    }
    const cartItems = getCartItems();
    const comboLines = getCartCombos();
    if (!cartItems.length && !comboLines.length) {
      return repositoryResult(false, { message: 'Agregá al menos un producto antes de pagar.' });
    }
    if (cartItems.some((item) => item.product.pricePending)) {
      return repositoryResult(false, { message: 'Hay productos con precio pendiente. No se pueden pagar todavía.' });
    }
    const requiresAge = cartItems.some((item) => item.product.alcoholic)
      || comboLines.some((line) => line.combo.ageRestricted);
    if (requiresAge && !values.ageConfirmed) {
      return repositoryResult(false, {
        message: 'Confirmá que sos mayor de edad para pedir bebidas alcohólicas.',
      });
    }
    const nameValidation = validateCustomerName(values.customerName);
    if (!nameValidation.ok) return repositoryResult(false, { message: nameValidation.message });
    const customerPhone = normalizeArgentinePhone(values.customerPhone);
    if (!isValidArgentinePhone(customerPhone)) {
      return repositoryResult(false, { message: 'Ingresá un teléfono argentino válido, con código de área.' });
    }
    if (values.deliveryMode === 'delivery' && !values.customerAddress) {
      return repositoryResult(false, { message: 'Ingresá calle y número para el envío.' });
    }
    const items = cartItems.map((item) => ({
      product_id: String(item.product.id || ''),
      quantity: Math.max(0, Math.floor(Number(item.quantity) || 0)),
    }));
    if (items.some((item) => !isUuid(item.product_id) || item.quantity < 1)) {
      return repositoryResult(false, {
        message: 'El catálogo productivo no está sincronizado. Actualizá la página antes de pagar.',
      });
    }
    // El combo se manda por identificador y sin precio. Expandirlo acá a sus
    // componentes lo cobraria a precio de lista, que es exactamente el defecto
    // que el contrato de combos cierra.
    const comboItems = comboLines.map((line) => ({
      combo_id: String(line.combo.comboId || ''),
      quantity: Math.max(0, Math.floor(Number(line.quantity) || 0)),
    }));
    if (comboItems.some((item) => !/^[a-z0-9][a-z0-9-]{2,63}$/.test(item.combo_id) || item.quantity < 1)) {
      return repositoryResult(false, {
        message: 'Hay un combo que ya no es válido. Actualizá la página antes de pagar.',
      });
    }

    const availability = await getMercadoPagoCheckoutAvailability();
    if (!availability.ok || !availability.available || availability.checkoutMode !== 'checkout_pro') {
      return repositoryResult(false, { message: 'Mercado Pago todavía no está habilitado para este comercio.' });
    }

    let clientRequestId;
    try {
      clientRequestId = createCheckoutClientRequestId(cryptoImpl);
    } catch (_) {
      return repositoryResult(false, {
        message: 'Este dispositivo no puede generar una solicitud de pago segura.',
      });
    }
    const payload = buildMercadoPagoCheckoutPayload({
      businessId,
      clientRequestId,
      values: {
        ...values,
        customerName: nameValidation.name,
        customerPhone,
      },
      items: items.concat(comboItems),
    });
    const sessionResult = await invokePaymentFunction('mercadopago-create-checkout-session', payload);
    if (!sessionResult.ok || !sessionResult.data?.checkout) {
      return repositoryResult(false, {
        code: sessionResult.data?.code || 'CHECKOUT_NOT_AVAILABLE',
        message: sessionResult.data?.message || 'No pudimos preparar este pago. Revisá el carrito y volvé a intentar.',
      });
    }
    const checkout = sessionResult.data.checkout;
    const checkoutSessionId = String(checkout.checkout_session_id || '').trim();
    if (!isUuid(checkoutSessionId)) {
      return repositoryResult(false, { message: 'No recibimos una sesión de pago válida.' });
    }
    writeMercadoPagoCheckoutRecord(mercadoPagoStorage, businessId, checkoutSessionId);
    const preferenceResult = await invokePaymentFunction('mercadopago-create-preference', {
      checkout_session_id: checkoutSessionId,
    });
    if (!preferenceResult.ok || !preferenceResult.data?.init_point) {
      return repositoryResult(false, {
        code: preferenceResult.data?.code || 'PREFERENCE_RECONCILING',
        status: preferenceResult.data?.status || 'reconciling',
        checkoutSessionId,
        message: preferenceResult.data?.message
          || 'Estamos verificando la preparación de tu pago. No vuelvas a pagar todavía.',
      });
    }
    const initPoint = trustedMercadoPagoCheckoutUrl(preferenceResult.data.init_point);
    if (!initPoint) {
      return repositoryResult(false, { message: 'No recibimos una URL de pago segura.' });
    }
    return repositoryResult(true, {
      checkoutSessionId,
      initPoint,
      expiresAt: String(preferenceResult.data.expires_at || checkout.expires_at || ''),
    });
  }

  async function getMercadoPagoCheckoutStatus(checkoutSessionId) {
    if (!isUuid(checkoutSessionId)) {
      return repositoryResult(false, { message: 'La sesión de pago no es válida.' });
    }
    const session = await auth.ensureCustomerSession();
    if (!session.ok) return repositoryResult(false, { message: session.message });
    const result = await invokePaymentFunction('mercadopago-checkout-status', {
      checkout_session_id: checkoutSessionId,
    });
    if (!result.ok || !result.data?.checkout) {
      return repositoryResult(false, {
        code: result.data?.code || 'CHECKOUT_NOT_FOUND',
        message: result.data?.message || 'No pudimos verificar tu pago todavía.',
      });
    }
    return repositoryResult(true, { checkout: result.data.checkout });
  }

  function getMercadoPagoCheckoutRecovery() {
    return readMercadoPagoCheckoutRecord(mercadoPagoStorage, businessId);
  }

  function clearMercadoPagoCheckoutRecovery() {
    clearMercadoPagoCheckoutRecord(mercadoPagoStorage, businessId);
  }

  async function listMercadoPagoBusinessPayments() {
    const teamAccess = await auth.getTeamAccess();
    if (!teamAccess.ok || !['owner', 'admin', 'staff'].includes(teamAccess.membership?.role)) {
      return repositoryResult(false, { message: 'Tu rol no puede consultar pagos.' });
    }
    const { data, error } = await client.rpc('list_business_payments', {
      p_business_id: businessId,
    });
    if (error) return repositoryResult(false, { message: 'No pudimos cargar los pagos.' });
    return repositoryResult(true, { payments: Array.isArray(data) ? data : [] });
  }

  async function reconcileMercadoPagoPayment(paymentIntentId) {
    if (!isUuid(paymentIntentId)) return repositoryResult(false, { message: 'El pago no es válido.' });
    const { data, error } = await client.rpc('enqueue_payment_reconciliation', {
      p_payment_intent_id: paymentIntentId,
    });
    if (error) return repositoryResult(false, { message: 'No pudimos actualizar el estado del pago.' });
    if (data?.terminal) {
      return repositoryResult(true, {
        ...data,
        message: data.internal_status === 'completed' || data.order_id
          ? 'El pedido ya había sido creado.'
          : 'El pago ya está cerrado y no admite otro reintento.',
      });
    }
    if (!data?.queued) return repositoryResult(false, { message: 'No pudimos programar la recuperación.' });
    return repositoryResult(true, {
      ...data,
      message: 'Reintentando…',
    });
  }

  async function requestMercadoPagoRefund({ paymentIntentId, amount = null, reason = '', confirmation = '' } = {}) {
    if (!isUuid(paymentIntentId)) return repositoryResult(false, { message: 'El pago no es válido.' });
    let idempotencyKey;
    try {
      idempotencyKey = createCheckoutClientRequestId(cryptoImpl);
    } catch (_) {
      return repositoryResult(false, { message: 'No pudimos generar una solicitud de reembolso segura.' });
    }
    const result = await invokePaymentFunction('mercadopago-refund', {
      payment_intent_id: paymentIntentId,
      amount,
      reason,
      confirmation,
      idempotency_key: idempotencyKey,
    });
    return repositoryResult(result.ok, {
      code: result.data?.code || '',
      status: result.data?.status || '',
      message: result.data?.message || (result.ok ? 'Solicitud de reembolso enviada.' : 'No se pudo solicitar el reembolso.'),
    });
  }

  async function requestMercadoPagoCancellation({ paymentIntentId, confirmation = '' } = {}) {
    if (!isUuid(paymentIntentId)) return repositoryResult(false, { message: 'El pago no es válido.' });
    let idempotencyKey;
    try {
      idempotencyKey = createCheckoutClientRequestId(cryptoImpl);
    } catch (_) {
      return repositoryResult(false, { message: 'No pudimos generar una solicitud de cancelación segura.' });
    }
    const result = await invokePaymentFunction('mercadopago-cancel-payment', {
      payment_intent_id: paymentIntentId,
      confirmation,
      idempotency_key: idempotencyKey,
    });
    return repositoryResult(result.ok, {
      code: result.data?.code || '',
      status: result.data?.status || '',
      message: result.data?.message || (result.ok ? 'Solicitud de cancelación enviada.' : 'No se pudo solicitar la cancelación.'),
    });
  }

  async function invokePaymentFunction(name, body) {
    if (typeof client.functions?.invoke !== 'function') {
      return { ok: false, data: null };
    }
    try {
      const { data, error } = await client.functions.invoke(name, { body });
      return { ok: !error && data?.ok === true, data: data || null };
    } catch (_) {
      return { ok: false, data: null };
    }
  }

  const repository = {
    mode: 'supabase',
    businessId,
    pollMs: pollingInterval,
    auth,
    customerProfiles,
    async loadCatalog() {
      return loadCatalog();
    },
    async loadBusinessConfiguration() {
      return loadBusinessConfiguration();
    },
    getCatalogStatus() {
      return { ...catalogStatus };
    },
    setCustomerTrackingView({ active = false, orderId = '', status = '' } = {}) {
      if (!active) {
        return customerTrackingPoll.stop();
      }
      const access = getTrackingAccess();
      if (!matchesStoredOrderAccess(access, orderId)) return customerTrackingPoll.stop();
      const trackingStatus = normalizeWorkflowStatus(status, '');
      if (trackingStatus === 'canceled') {
        unavailableTrackingOrderId = '';
        return customerTrackingPoll.stop();
      }
      const resolution = resolveTrackingAccessOrder(getState().orders, access);
      if (
        resolution.kind === 'conflict'
        || (resolution.kind === 'missing' && trackingStatus === 'delivered')
      ) {
        markTrackingUnavailable(access.orderId || access.publicCode, {
          selectLocalOrder: false,
        });
        return customerTrackingPoll.stop();
      }
      unavailableTrackingOrderId = '';
      allowActiveOrderFallback();
      const selected = resolution.order
        ? selectTrackingOrder(resolution.order.id)
        : null;
      return customerTrackingPoll.update({
        orderId: access.orderId || access.publicCode,
        trackingToken: access.trackingToken,
        status: trackingStatus,
        terminalVisibleUntil: selected?.terminalVisibleUntil,
      });
    },
    getCustomerTrackingPollState() {
      return customerTrackingPoll.getSnapshot();
    },
    startSync() {
      if (syncStop) return syncStop;
      let stopped = false;
      const refresh = async () => {
        if (stopped) return;
        const results = await Promise.allSettled([
          loadBusinessConfiguration(),
          loadCatalog(),
          fetchOrders(),
        ]);
        const orderResult = results[2]?.status === 'fulfilled' ? results[2].value : null;
        if (!getTrackingAccess() && !unavailableTrackingOrderId && orderResult?.ok) {
          await recoverCustomerTrackingAccess(orderResult.rows).catch(() => null);
        }
        const access = getTrackingAccess();
        const trackingPollState = customerTrackingPoll.getSnapshot();
        const terminalTrackingIsBeingRevalidated = trackingPollState.terminal
          && trackingPollState.orderId === (access?.orderId || access?.publicCode || '');
        if (
          access
          && !stopped
          && !terminalTrackingIsBeingRevalidated
          && !hasTerminalTrackingState(access)
        ) {
          const result = await fetchPublicTrackingSnapshot(
            access.orderId || access.publicCode,
            { trackingToken: access.trackingToken, mirror: true },
          ).catch(() => ({ kind: 'network-error' }));
          if (result.kind === 'snapshot') {
            selectTrackingOrder(access.orderId || access.publicCode);
          } else if (result.kind === 'unavailable') {
            markTrackingUnavailable(access.orderId || access.publicCode);
          }
        }
      };
      const stopRealtime = createRealtimeWatch({
        client,
        pollMs: pollingInterval,
        name: `taba-sync-${businessId}`,
        changes: [
          tableChange('orders', `business_id=eq.${businessId}`, refresh),
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
        customerTrackingPoll.stop();
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
    async getMercadoPagoCheckoutAvailability() {
      return getMercadoPagoCheckoutAvailability();
    },
    async createMercadoPagoCheckout(orderDraft = {}) {
      return createMercadoPagoCheckout(orderDraft);
    },
    async getMercadoPagoCheckoutStatus(checkoutSessionId) {
      return getMercadoPagoCheckoutStatus(checkoutSessionId);
    },
    getMercadoPagoCheckoutRecovery() {
      return getMercadoPagoCheckoutRecovery();
    },
    clearMercadoPagoCheckoutRecovery() {
      clearMercadoPagoCheckoutRecovery();
    },
    async listMercadoPagoBusinessPayments() {
      return listMercadoPagoBusinessPayments();
    },
    async reconcileMercadoPagoPayment(paymentIntentId) {
      return reconcileMercadoPagoPayment(paymentIntentId);
    },
    async requestMercadoPagoRefund(payload = {}) {
      return requestMercadoPagoRefund(payload);
    },
    async requestMercadoPagoCancellation(payload = {}) {
      return requestMercadoPagoCancellation(payload);
    },
    async getActiveOrder() {
      const result = await fetchOrders();
      const access = getTrackingAccess();
      if (access) {
        const tracked = await fetchOrderByPublicId(
          access.orderId || access.publicCode,
          { trackingToken: access.trackingToken, mirror: true },
        );
        if (tracked) {
          selectTrackingOrder(access.orderId || access.publicCode);
          return toDomainOrder(tracked);
        }
        return toDomainOrder(selectTrackingOrder(access.orderId || access.publicCode));
      }
      const state = getState();
      const activeOrderId = getActiveOrderId(state);
      const activeOrder = state.orders.find((order) => order.id === activeOrderId);
      if (activeOrder) return toDomainOrder(activeOrder);
      return null;
    },
    async listOrders() {
      const result = await fetchOrders();
      return result.ok ? result.orders : [];
    },
    async fetchBusinessOrderSnapshot() {
      return fetchBusinessOrderSnapshot();
    },
    watchBusinessOrderInvalidations({ onInvalidate, onStatus } = {}) {
      const channel = client.channel(`taba-business-intake-${businessId}-${++channelSequence}`);
      channel.on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'orders',
        filter: `business_id=eq.${businessId}`,
      }, (payload) => {
        if (typeof onInvalidate !== 'function') return;
        const row = payload?.new && Object.keys(payload.new).length ? payload.new : payload?.old;
        onInvalidate({
          eventType: String(payload?.eventType || ''),
          orderId: sanitizeText(row?.id, { maxLength: 80 }),
          revision: normalizeOrderRevision(row?.revision),
        });
      });
      channel.subscribe((nextStatus) => onStatus?.(nextStatus));
      return () => {
        if (typeof client.removeChannel === 'function') {
          Promise.resolve(client.removeChannel(channel)).catch(() => null);
        } else {
          channel.unsubscribe?.();
        }
      };
    },
    async updateOrderStatus(orderId, status, { expectedRevision = null, idempotencyKey = '' } = {}) {
      const row = await fetchOrderByPublicId(orderId);
      if (!row) return repositoryResult(false, { message: 'Pedido no encontrado o acceso denegado.' });

      const nextStatus = normalizeWorkflowStatus(status);
      const revision = normalizeOrderRevision(expectedRevision) || normalizeOrderRevision(row.revision);
      if (revision === null) {
        return repositoryResult(false, {
          code: 'ORDER_REVISION_REQUIRED',
          message: 'El pedido no tiene una revisión válida; recuperá la bandeja antes de reintentar.',
        });
      }
      const { data, error, status: responseStatus } = await client.rpc('transition_order', {
        p_order_id: row.id,
        p_expected_revision: revision,
        p_new_status: nextStatus,
        p_idempotency_key: normalizeIdempotencyKey(idempotencyKey),
      });
      if (error) {
        return failedQuery(error, responseStatus, readableStatusError(error));
      }

      // transition_order devuelve la fila de orders, no las relaciones. La
      // tarjeta sólo se actualiza con una lectura completa posterior.
      const updatedRow = await fetchOrderByPublicId(row.id) || unwrapOrderRow(data);
      if (!updatedRow) return repositoryResult(false, { message: 'El backend no devolvió el pedido actualizado.' });
      const order = mirrorOrder(updatedRow);
      return repositoryResult(true, {
        order,
        message: `Pedido ${order.id} actualizado a ${statusLabel(order.status)}.`,
      });
    },
    async cancelBusinessOrder(orderId, { expectedRevision = null, idempotencyKey = '', reason = '' } = {}) {
      const row = await fetchOrderByPublicId(orderId);
      if (!row) return repositoryResult(false, { message: 'Pedido no encontrado o acceso denegado.' });
      const revision = normalizeOrderRevision(expectedRevision) || normalizeOrderRevision(row.revision);
      const cleanReason = sanitizeText(reason, { maxLength: 160 });
      if (revision === null || !cleanReason) {
        return repositoryResult(false, { message: 'La cancelación requiere revisión vigente y motivo.' });
      }
      const { data, error, status: responseStatus } = await client.rpc('cancel_order', {
        p_order_id: row.id,
        p_expected_revision: revision,
        p_reason: cleanReason,
        p_idempotency_key: normalizeIdempotencyKey(idempotencyKey),
      });
      if (error) return failedQuery(error, responseStatus, readableStatusError(error));
      const updatedRow = await fetchOrderByPublicId(row.id) || unwrapOrderRow(data);
      if (!updatedRow) return repositoryResult(false, { message: 'El backend no devolvió el pedido cancelado.' });
      return repositoryResult(true, {
        order: mirrorOrder(updatedRow),
        message: 'Pedido cancelado por el servidor.',
      });
    },
    async listAvailableRiderOrders() {
      const { data, error, status } = await client.rpc('list_available_rider_orders', {
        p_business_id: businessId,
      });
      if (error) {
        return failedQuery(error, status, readableRiderAssignmentError(error));
      }
      const orders = Array.isArray(data)
        ? data.map(normalizeAvailableRiderOrder).filter(Boolean)
        : [];
      return repositoryResult(true, { orders });
    },
    async listActiveRiders() {
      const { data, error, status } = await client.rpc('list_active_business_riders', {
        p_business_id: businessId,
      });
      if (error) {
        return failedQuery(
          error,
          status,
          'No pudimos cargar los riders activos del negocio.',
        );
      }
      const riders = (Array.isArray(data) ? data : [])
        .map(normalizeActiveRider)
        .filter(Boolean);
      return repositoryResult(true, { riders });
    },
    // Contrato canónico del rider: claim_delivery_order (idempotente, con
    // revisión). La sobrecarga legacy claim_available_rider_order fue dropeada
    // y revocada por migración: llamarla es prometer un botón que falla siempre.
    async claimRiderOrder(publicCode, {
      expectedRevision = null,
      idempotencyKey = '',
    } = {}) {
      const cleanPublicCode = sanitizeText(publicCode, { maxLength: 80 });
      if (!cleanPublicCode) {
        return repositoryResult(false, { message: 'Ingresá un código de pedido válido.' });
      }
      const revision = normalizeOrderRevision(expectedRevision);
      if (revision === null) {
        return repositoryResult(false, {
          code: 'ORDER_REVISION_REQUIRED',
          message: 'La cola cambió; actualizá los pedidos listos antes de tomar uno.',
        });
      }
      const { data, error, status } = await client.rpc('claim_delivery_order', {
        p_business_id: businessId,
        p_public_code: cleanPublicCode,
        p_expected_revision: revision,
        p_idempotency_key: normalizeIdempotencyKey(idempotencyKey || `rider-claim-${cleanPublicCode}-${revision}`),
      });
      if (error) {
        return failedQuery(error, status, readableRiderAssignmentError(error));
      }
      if (!data?.ok) {
        return riderContractRefusal(data, {
          not_available: 'El pedido ya no está disponible para reparto.',
          active_delivery_exists: 'Ya tenés una entrega activa. Terminala antes de tomar otra.',
          stale_revision: 'La cola cambió; actualizá los pedidos listos antes de tomar uno.',
          taken_by_other: 'Otro rider tomó este pedido primero.',
        }, 'No pudimos asignarte el pedido.');
      }
      return repositoryResult(true, {
        publicCode: cleanPublicCode,
        idempotentNoOp: data.idempotent_no_op === true,
        message: `Pedido ${cleanPublicCode} asignado a tu cuenta.`,
      });
    },
    // Avance de la entrega por los RPCs canónicos por estado. transition_order
    // exige rol de negocio y el rider no lo tiene: usarlo desde la vista rider
    // era una promesa sin backend.
    async advanceRiderDelivery(orderId, targetStatus, {
      expectedRevision = null,
      idempotencyKey = '',
    } = {}) {
      const target = normalizeWorkflowStatus(targetStatus);
      const rpcByTarget = {
        picked_up: 'mark_delivery_picked_up',
        on_the_way: 'start_rider_delivery',
        arrived: 'mark_rider_arrived',
      };
      const rpcName = rpcByTarget[target];
      if (!rpcName) {
        return repositoryResult(false, { message: 'Ese paso no existe en el circuito del rider.' });
      }
      const row = await fetchOrderByPublicId(orderId);
      if (!row) return repositoryResult(false, { message: 'Pedido no encontrado o acceso denegado.' });
      const revision = normalizeOrderRevision(expectedRevision) ?? normalizeOrderRevision(row.revision);
      if (revision === null) {
        return repositoryResult(false, {
          code: 'ORDER_REVISION_REQUIRED',
          message: 'El pedido no tiene revisión válida; actualizá antes de continuar.',
        });
      }
      const { data, error, status } = await client.rpc(rpcName, {
        p_order_id: row.id,
        p_expected_revision: revision,
        p_idempotency_key: normalizeIdempotencyKey(idempotencyKey || `rider-${target}-${row.id}-${revision}`),
      });
      if (error) return failedQuery(error, status, readableRiderAssignmentError(error));
      if (!data?.ok) {
        return riderContractRefusal(data, {
          not_assigned: 'Este pedido no está asignado a tu cuenta.',
          stale_revision: 'El pedido cambió en otro dispositivo. Actualizá antes de continuar.',
          not_ready_for_pickup: 'El pedido todavía no está listo para retirar.',
          not_picked_up: 'Registrá el retiro antes de salir en camino.',
          not_on_the_way: 'Marcá la salida antes de registrar la llegada.',
        }, 'No pudimos registrar el avance de la entrega.');
      }
      const updatedRow = await fetchOrderByPublicId(row.id);
      const order = updatedRow ? mirrorOrder(updatedRow) : null;
      return repositoryResult(true, {
        order,
        idempotentNoOp: data.idempotent_no_op === true,
        message: 'Avance confirmado por el servidor.',
      });
    },
    async assignRider(orderId, riderId, {
      expectedStatus = null,
      expectedRiderId = undefined,
    } = {}) {
      if (!isUuid(riderId)) {
        return repositoryResult(false, { message: 'Seleccioná un rider autenticado válido.' });
      }
      const row = await fetchOrderByPublicId(orderId);
      if (!row) {
        return repositoryResult(false, { message: 'Pedido no encontrado o acceso denegado.' });
      }
      const currentRiderId = isUuid(row.assigned_rider_user_id)
        ? row.assigned_rider_user_id
        : null;
      const cleanExpectedRiderId = expectedRiderId === undefined
        ? currentRiderId
        : isUuid(expectedRiderId)
          ? expectedRiderId
          : null;
      const { data, error, status } = await client.rpc('assign_order_rider', {
        p_order_id: row.id,
        p_expected_status: normalizeWorkflowStatus(expectedStatus || row.status),
        p_expected_rider_user_id: cleanExpectedRiderId,
        p_new_rider_user_id: riderId,
      });
      if (error) {
        return failedQuery(error, status, readableRiderAssignmentError(error));
      }

      const updatedRow = unwrapOrderRow(data) || await fetchOrderByPublicId(row.id);
      if (!updatedRow) {
        return repositoryResult(false, {
          message: 'El backend no devolvió el pedido actualizado.',
        });
      }
      const order = mirrorOrder(updatedRow);
      return repositoryResult(true, {
        order,
        message: currentRiderId && currentRiderId !== riderId
          ? `Rider reasignado en el pedido ${order.id}.`
          : `Rider asignado al pedido ${order.id}.`,
      });
    },
    async reassignRider(orderId, riderId, options = {}) {
      return repository.assignRider(orderId, riderId, options);
    },
    // confirm_order_delivery quedó con execute revocado por migración; el
    // contrato vivo es confirm_delivery_code, que exige revisión y clave.
    async confirmDelivery(orderId, code, { expectedRevision = null, idempotencyKey = '' } = {}) {
      const deliveryCode = normalizeDeliveryCodeValue(code);
      if (!deliveryCode) {
        return repositoryResult(false, { message: 'Ingresá el código de 4 dígitos del cliente.' });
      }
      const knownOrder = getState().orders.find((candidate) => (
        candidate.id === orderId
        || candidate.backendId === orderId
        || candidate.code === orderId
      ));
      const backendOrderId = isUuid(orderId)
        ? orderId
        : isUuid(knownOrder?.backendId)
          ? knownOrder.backendId
          : '';
      if (!backendOrderId) {
        return repositoryResult(false, { message: 'Pedido no encontrado o acceso denegado.' });
      }
      const revision = normalizeOrderRevision(expectedRevision)
        ?? normalizeOrderRevision(knownOrder?.revision);
      if (revision === null) {
        return repositoryResult(false, {
          code: 'ORDER_REVISION_REQUIRED',
          message: 'El pedido no tiene revisión válida; actualizá antes de confirmar.',
        });
      }
      const { data, error, status } = await client.rpc('confirm_delivery_code', {
        p_order_id: backendOrderId,
        p_expected_revision: revision,
        p_delivery_code: deliveryCode,
        p_idempotency_key: normalizeIdempotencyKey(idempotencyKey || `rider-confirm-${backendOrderId}-${revision}-${deliveryCode}`),
      });
      if (error) {
        return failedQuery(error, status, readableRiderAssignmentError(error));
      }
      if (!data?.ok) {
        const retrySeconds = Math.max(0, Number(data?.retry_after_seconds) || 0);
        return riderContractRefusal(data, {
          invalid_format: 'Ingresá el código de 4 dígitos del cliente.',
          not_assigned: 'Este pedido no está asignado a tu cuenta.',
          stale_revision: 'El pedido cambió en otro dispositivo. Actualizá antes de confirmar.',
          not_arrived: 'Marcá la llegada antes de confirmar la entrega.',
          code_unavailable: 'El código de entrega no está disponible o venció.',
          temporarily_locked: `Demasiados intentos. Probá de nuevo en ${retrySeconds || 300} segundos.`,
          incorrect_code: `Código incorrecto. Te quedan ${Math.max(0, Number(data?.remaining_attempts) || 0)} intento(s).`,
        }, 'No pudimos confirmar la entrega.');
      }
      return repositoryResult(true, {
        order: null,
        publicCode: sanitizeText(knownOrder?.code || orderId, { maxLength: 80 }),
        status: 'delivered',
        alreadyDelivered: data?.outcome === 'already_delivered',
        message: data?.outcome === 'already_delivered'
          ? 'El pedido ya estaba entregado y confirmado.'
          : 'Código confirmado. Pedido entregado.',
      });
    },
    async updateRiderLocation(orderId, location) {
      const normalized = normalizeTrackingLocation(location);
      if (!normalized || normalized.source !== 'gps') {
        return repositoryResult(false, { message: 'Producción sólo acepta una ubicación GPS real.' });
      }
      if (
        !Number.isFinite(Number(normalized.accuracy))
        || Number(normalized.accuracy) > PUBLIC_TRACKING_GPS_MAX_ACCURACY_METERS
      ) {
        return repositoryResult(false, {
          message: 'Esperá una señal GPS más precisa antes de compartir la ubicación.',
        });
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

      // publish_rider_location (6 argumentos) fue dropeada por migración; el
      // contrato vivo es publish_rider_location_receipt, con revisión, hora de
      // captura y clave idempotente. Cada fix lleva clave propia: dos fixes
      // distintos son dos hechos distintos.
      const revision = normalizeOrderRevision(row.revision);
      if (revision === null) {
        return repositoryResult(false, { message: 'El pedido no tiene revisión válida para publicar GPS.' });
      }
      const { data, error, status } = await client.rpc('publish_rider_location_receipt', {
        p_order_id: row.id,
        p_expected_revision: revision,
        p_lat: normalized.lat,
        p_lng: normalized.lng,
        p_accuracy: normalized.accuracy,
        p_heading: normalized.heading ?? null,
        p_speed: normalized.speed ?? null,
        p_captured_at: normalizeIso(normalized.lastFixAt),
        p_idempotency_key: normalizeIdempotencyKey(`gps-${globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`}`),
        p_is_mock: false,
      });
      if (error) return failedQuery(error, status, 'No pudimos publicar la ubicación del rider.');
      if (!data?.ok) {
        const retrySeconds = Math.max(0, Number(data?.retry_after_seconds) || 0);
        return riderContractRefusal(data, {
          inaccurate: 'Esperá una señal GPS más precisa antes de compartir la ubicación.',
          stale: 'La ubicación llegó vieja o el pedido cambió; se descartó sin publicar.',
          throttled: `El servidor pide esperar ${retrySeconds || 5} segundos entre publicaciones.`,
          impossible_jump: 'El salto de ubicación no es físicamente posible; se descartó.',
          not_assigned: 'Este pedido no está asignado a tu cuenta de rider.',
          not_active: 'La ubicación sólo se publica en camino o al llegar.',
          terminal: 'El pedido ya terminó; no se publica más ubicación.',
          mock_location_rejected: 'La ubicación simulada fue rechazada.',
        }, 'No pudimos publicar la ubicación del rider.');
      }

      const serverLocation = normalizeTrackingLocation({
        ...normalized,
        source: 'gps',
        timestamp: data?.recorded_at || normalized.lastFixAt,
      }) || normalized;
      const fullRow = await fetchOrderByPublicId(row.id) || row;
      const order = mirrorOrder(fullRow);
      mirrorGpsLocation(order, serverLocation);
      return repositoryResult(true, {
        location: serverLocation,
        order,
        message: 'Ubicación GPS actualizada.',
      });
    },
    subscribeToOrder(orderId, callback) {
      if (typeof callback !== 'function') return () => {};
      const access = lastOrderAccess || readStoredAccess(storage, lastAccessStorageKey);
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
    addressId: values.customerAddressId,
    addressLabel: values.customerAddressLabel,
    neighborhood: values.addressDetails.neighborhood,
    reference: values.addressDetails.reference,
    floor: values.deliveryFloor,
    apartment: values.deliveryApartment,
    province: values.deliveryProvince,
    postalCode: values.deliveryPostalCode,
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
  const pricePending = row.price_status === 'pending';
  const price = pricePending ? null : normalizeMoneyValue(row.price, 0);
  const externalId = sanitizeText(row.external_id, { maxLength: 120 });
  const sku = sanitizeText(row.sku, { maxLength: 120 });
  const image = sanitizeText(row.image_url, { maxLength: 500 });
  const imageThumbnail = sanitizeText(row.image_thumbnail_url, { maxLength: 500 });
  if (!name || (!pricePending && price <= 0) || !externalId || !sku || !image || !imageThumbnail) return null;

  const categoryName = sanitizeText(row.category, { fallback: 'Otros', maxLength: 80 });
  const variant = sanitizeText(row.variant, { maxLength: 100 });
  const presentation = sanitizeText(row.presentation, { maxLength: 100 });
  const capacityValue = Number(row.capacity_value);
  const capacityUnit = sanitizeText(row.capacity_unit, { maxLength: 20 }).toLowerCase();
  const capacity = sanitizeText(row.capacity, { maxLength: 60 });
  const packagingType = sanitizeText(row.packaging_type, { maxLength: 60 });
  if (
    !variant
    || !presentation
    || presentation !== variant
    || !Number.isFinite(capacityValue)
    || capacityValue <= 0
    || !['ml', 'l', 'g', 'kg', 'unidad'].includes(capacityUnit)
    || capacity !== `${capacityValue} ${capacityUnit}`
  ) return null;
  const tags = Array.isArray(row.tags)
    ? row.tags.map((tag) => sanitizeText(tag, { maxLength: 40 })).filter(Boolean)
    : [];
  const tagSet = new Set(tags.map((tag) => tag.toLowerCase()));
  const stock = Math.max(0, Math.floor(Number(row.stock) || 0));
  const unitsPerPack = Math.max(1, Math.floor(Number(row.units_per_pack) || 1));
  const minimumAge = row.is_alcoholic
    ? Math.min(99, Math.max(18, Math.floor(Number(row.minimum_age) || 18)))
    : null;

  return {
    id: row.id,
    externalId,
    sku,
    name,
    brand: sanitizeText(row.brand, { maxLength: 80 }),
    description: sanitizeText(row.description, { maxLength: 180 }),
    categoryId: slugifyCategory(categoryName),
    categoryName,
    subcategory: sanitizeText(row.subcategory, { maxLength: 80 }),
    variant,
    presentation,
    capacityValue,
    capacityUnit,
    capacity,
    packagingType,
    unitsPerPack,
    chilled: Boolean(row.chilled),
    tone: row.is_alcoholic ? 'alcoholic' : 'drink',
    image,
    imageThumbnail,
    imageSha256: sanitizeText(row.image_sha256, { maxLength: 64 }),
    imageThumbnailSha256: sanitizeText(row.image_thumbnail_sha256, { maxLength: 64 }),
    sourceImageSha256: sanitizeText(row.source_image_sha256, { maxLength: 64 }),
    price,
    stock,
    available: Boolean(row.available) && stock > 0 && !pricePending,
    pricePending,
    priceStatus: pricePending ? 'pending' : 'confirmed',
    alcoholic: Boolean(row.is_alcoholic),
    minimumAge,
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

function mirrorOrders(rows, {
  replace = false,
  preservePublicTrackingIds = [],
} = {}) {
  const normalizedOrders = rows.map(rowToDemoOrder).filter(Boolean);
  const preservedIds = new Set(
    preservePublicTrackingIds.map((value) => String(value || '').trim()).filter(Boolean),
  );
  let orders = normalizedOrders;
  updateState((draft) => {
    const currentLastOrderId = draft.lastOrderId;
    orders = normalizedOrders.map((order) => {
      const current = draft.orders.find((candidate) => (
        candidate.id === order.id
        || candidate.backendId === order.backendId
      ));
      return {
        ...order,
        ...(current?.deliveryCode && !order.deliveryCode ? { deliveryCode: current.deliveryCode } : {}),
        // The token-scoped public DTO may already have supplied a rounded GPS
        // fix. A normal order refresh intentionally does not reselect that
        // protected table, so retain the known DTO until it is refreshed or
        // invalidated by the tracking controller.
        ...(!order.tracking?.lastLocation && current?.tracking?.lastLocation
          ? { tracking: current.tracking }
          : {}),
      };
    });
    if (replace) {
      const refreshedKeys = new Set(orders.flatMap((order) => [order.id, order.backendId]).filter(Boolean));
      const preservedTerminalShells = draft.orders.filter((order) => (
        order.publicTrackingOnly === true
        && [order.id, order.code, order.backendId].filter(Boolean).map(String)
          .some((candidate) => preservedIds.has(candidate))
        && ![order.id, order.backendId].filter(Boolean).some((candidate) => refreshedKeys.has(candidate))
      ));
      draft.orders = [...orders, ...preservedTerminalShells];
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
    draft.comboSelections = [];
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
    if (index >= 0) {
      const current = draft.orders[index];
      draft.orders[index] = !order.tracking?.lastLocation && current?.tracking?.lastLocation
        ? { ...order, tracking: current.tracking }
        : order;
    }
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

  const workflowStatus = normalizeWorkflowStatus(dto.status, '');
  if (!workflowStatus) return null;
  const status = toDemoOrderStatus(workflowStatus);
  const deliveryMode = dto.delivery_mode === 'pickup' ? 'pickup' : 'delivery';
  const createdAt = normalizeOptionalIso(dto.created_at);
  if (!createdAt) return null;
  const acceptedAt = normalizeOptionalIso(dto.accepted_at);
  const preparingAt = normalizeOptionalIso(dto.preparing_at);
  const readyAt = normalizeOptionalIso(dto.ready_at);
  const dispatchedAt = normalizeOptionalIso(dto.dispatched_at);
  const arrivedAt = normalizeOptionalIso(dto.arrived_at);
  const deliveredAt = normalizeOptionalIso(dto.delivered_at);
  const terminalVisibleUntil = normalizeOptionalIso(dto.terminal_visible_until);
  const cancelledAt = normalizeOptionalIso(dto.cancelled_at);
  const rejectedAt = normalizeOptionalIso(dto.rejected_at);
  const updatedAt = latestIsoTimestamp([
    normalizeOptionalIso(dto.updated_at),
    deliveredAt,
    terminalVisibleUntil,
    cancelledAt,
    rejectedAt,
    arrivedAt,
    dispatchedAt,
    readyAt,
    preparingAt,
    acceptedAt,
    createdAt,
  ]) || createdAt;
  const location = latestPublicRiderLocation(dto.rider_location);
  const statusHistory = statusHistoryFromRow({
    accepted_at: acceptedAt,
    preparing_at: preparingAt,
    ready_at: readyAt,
    dispatched_at: dispatchedAt,
    arrived_at: arrivedAt,
    delivered_at: deliveredAt,
    cancelled_at: cancelledAt,
    rejected_at: rejectedAt,
    updated_at: updatedAt,
  }, status, createdAt);
  const trustedEta = trustedEstimatedArrival(dto);
  const deliveryCode = normalizeDeliveryCodeValue(dto.delivery_code);
  const deliveryCodeConfirmedAt = normalizeOptionalIso(dto.delivery_code_confirmed_at);

  return {
    publicCode,
    deliveryMode,
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
    terminalVisibleUntil,
    cancelledAt,
    rejectedAt,
    statusHistory,
    estimatedMinutes: trustedEta?.minutes || 0,
    trustedEta,
    deliveryCodeConfirmedAt,
    deliveryCode: deliveryCode
      ? buildDeliveryCode(deliveryCode, {
        confirmedAt: deliveryCodeConfirmedAt,
        confirmedBy: deliveryCodeConfirmedAt ? 'rider' : '',
      })
      : null,
    tracking: location ? {
      lastLocation: location,
      source: 'gps',
      updatedAt: location.lastFixAt,
    } : undefined,
  };
}

function mergePublicTracking(order, tracking) {
  const isDeliveredTerminal = normalizeWorkflowStatus(tracking.workflowStatus, '') === 'delivered';
  const orderWithoutDeliveryCode = isDeliveredTerminal
    ? (({ deliveryCode: _deliveryCode, ...rest }) => rest)(order)
    : order;
  const confirmedDeliveryCode = tracking.deliveryCode
    || (tracking.deliveryCodeConfirmedAt && order.deliveryCode?.code
      ? buildDeliveryCode(order.deliveryCode.code, {
        confirmedAt: tracking.deliveryCodeConfirmedAt,
        confirmedBy: 'rider',
      })
      : null);
  return {
    ...orderWithoutDeliveryCode,
    deliveryMode: tracking.deliveryMode,
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
    terminalVisibleUntil: tracking.terminalVisibleUntil,
    statusHistory: tracking.statusHistory,
    tracking: tracking.tracking,
    ...(isDeliveredTerminal ? {} : (confirmedDeliveryCode ? { deliveryCode: confirmedDeliveryCode } : {})),
    delivery: {
      ...(order.delivery || {}),
      estimatedMinutes: tracking.estimatedMinutes,
      ...(tracking.trustedEta ? {
        etaMinutes: tracking.trustedEta.minutes,
        etaSource: tracking.trustedEta.source,
        etaCalculatedAt: tracking.trustedEta.updatedAt,
        etaExpiresAt: tracking.trustedEta.arrivalAt,
      } : {
        etaMinutes: null,
        etaSource: '',
        etaCalculatedAt: '',
        etaExpiresAt: '',
      }),
      currentLocationLabel: locationLabel(tracking.status, tracking.deliveryMode),
      ...(tracking.dispatchedAt ? { leftStoreAt: tracking.dispatchedAt } : {}),
      ...(tracking.deliveredAt ? { deliveredAt: tracking.deliveredAt } : {}),
    },
  };
}

function publicTrackingShell(tracking) {
  const isDeliveredTerminal = normalizeWorkflowStatus(tracking.workflowStatus, '') === 'delivered';
  return {
    id: tracking.publicCode,
    code: tracking.publicCode,
    workflowStatus: tracking.workflowStatus,
    status: tracking.status,
    customerName: 'Cliente',
    customerPhone: '',
    address: '',
    addressDetails: null,
    deliveryMode: tracking.deliveryMode,
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
    terminalVisibleUntil: tracking.terminalVisibleUntil,
    statusHistory: tracking.statusHistory,
    items: [],
    subtotal: 0,
    deliveryFee: 0,
    total: 0,
    currencyCode: '',
    assignedRiderId: '',
    ...(isDeliveredTerminal ? {} : (tracking.deliveryCode ? { deliveryCode: tracking.deliveryCode } : {})),
    delivery: {
      driverName: 'Sin asignar',
      driverPhone: '',
      estimatedMinutes: tracking.estimatedMinutes,
      ...(tracking.trustedEta ? {
        etaMinutes: tracking.trustedEta.minutes,
        etaSource: tracking.trustedEta.source,
        etaCalculatedAt: tracking.trustedEta.updatedAt,
        etaExpiresAt: tracking.trustedEta.arrivalAt,
      } : {}),
      currentLocationLabel: locationLabel(tracking.status, tracking.deliveryMode),
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

// orders.revision es bigint: PostgREST puede entregarlo como número o como
// string. Un valor ausente (pedido anterior a la migración, o repositorio sin
// respaldo Supabase) devuelve null para que el reconciliador caiga en el
// criterio por marca de tiempo en vez de asumir una versión falsa.
function normalizeOrderRevision(value) {
  if (value === null || value === undefined || value === '') return null;
  const revision = Number(value);
  return Number.isSafeInteger(revision) && revision > 0 ? revision : null;
}

function rowToDemoOrder(row = {}) {
  if (!row.id) return null;
  const workflowStatus = normalizeWorkflowStatus(row.status);
  const status = toDemoOrderStatus(workflowStatus);
  const deliveryMode = (row.delivery_mode || row.fulfillment_type) === 'pickup' ? 'pickup' : 'delivery';
  const items = Array.isArray(row.order_items)
    ? row.order_items.map(rowToDemoItem).filter(Boolean)
    : [];
  const latestLocation = ['picked_up', 'on_the_way', 'arrived'].includes(workflowStatus)
    ? latestRiderLocation(row.rider_locations)
    : null;
  const createdAt = normalizeIso(row.created_at);
  const terminalVisibleUntil = normalizeOptionalIso(row.terminal_visible_until);
  const trustedEta = trustedEstimatedArrival(row);
  const deliveryCode = normalizeDeliveryCodeValue(row.delivery_code);
  const snapshotStreetLine = [
    row.delivery_street,
    row.delivery_street_number,
  ].filter(Boolean).join(' ');
  const addressDetails = deliveryMode === 'pickup' ? null : {
    ...normalizeAddressDetails({
      customerStreetAddress: snapshotStreetLine || row.customer_street_address || row.address_label,
      customerNeighborhood: row.delivery_city || row.customer_neighborhood,
      customerReference: row.delivery_reference ?? row.customer_reference,
      customerAddress: row.delivery_address_formatted || row.address_label,
    }),
    savedLabel: sanitizeText(row.delivery_address_label, { fallback: '', maxLength: 60 }),
    street: sanitizeText(row.delivery_street, { fallback: '', maxLength: 120 }),
    streetNumber: sanitizeText(row.delivery_street_number, { fallback: '', maxLength: 24 }),
    floor: sanitizeText(row.delivery_floor, { fallback: '', maxLength: 24 }),
    apartment: sanitizeText(row.delivery_apartment, { fallback: '', maxLength: 24 }),
    city: sanitizeText(row.delivery_city, { fallback: '', maxLength: 100 }),
    province: sanitizeText(row.delivery_province, { fallback: '', maxLength: 100 }),
    postalCode: sanitizeText(row.delivery_postal_code, { fallback: '', maxLength: 20 }),
    snapshotCreatedAt: normalizeIso(row.delivery_snapshot_created_at || row.created_at),
  };

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
    // Versión monótona del servidor. Es el criterio autoritativo para descartar
    // mensajes Realtime atrasados: created_at/updated_at empatan entre escrituras
    // de una misma transacción y no pueden desempatarlas.
    revision: normalizeOrderRevision(row.revision),
    lastEventSequence: latestOrderEventSequence(row.order_events),
    ...(workflowStatus === 'delivered' && terminalVisibleUntil
      ? { terminalVisibleUntil }
      : {}),
    status,
    items,
    subtotal: normalizeMoneyValue(row.subtotal, 0),
    deliveryFee: normalizeMoneyValue(row.delivery_fee, 0),
    // El descuento de combos es parte de la invariante de dinero del backend
    // (total = subtotal - discount_total + delivery_fee). Sin mapearlo, el Panel
    // mostraba subtotal y total que "no cierran" y los reportes recalculaban de más.
    discountTotal: normalizeMoneyValue(row.discount_total, 0),
    combos: Array.isArray(row.order_combos)
      ? row.order_combos.map(rowToDemoCombo).filter(Boolean)
      : [],
    total: normalizeMoneyValue(row.total, 0),
    currencyCode: sanitizeText(row.currency_code, { maxLength: 3 }).toUpperCase(),
    assignedRiderId: sanitizeText(row.assigned_rider_user_id || row.assigned_rider_id, { maxLength: 80 }),
    statusHistory: statusHistoryFromRow(row, status, createdAt),
    ...(deliveryCode ? {
      deliveryCode: buildDeliveryCode(deliveryCode, {
        confirmedAt: row.delivery_code_confirmed_at,
        confirmedBy: row.delivery_code_confirmed_at ? 'rider' : '',
      }),
    } : {}),
    delivery: {
      driverName: deliveryMode === 'pickup' ? 'Sin asignar' : 'Rider asignado',
      driverPhone: '',
      estimatedMinutes: deliveryMode === 'pickup' ? 0 : (trustedEta?.minutes || 0),
      ...(trustedEta ? {
        etaMinutes: trustedEta.minutes,
        etaSource: trustedEta.source,
        etaCalculatedAt: trustedEta.updatedAt,
        etaExpiresAt: trustedEta.arrivalAt,
      } : {}),
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

function latestOrderEventSequence(events) {
  if (!Array.isArray(events)) return null;
  const sequences = events
    .map((event) => Number(event?.sequence))
    .filter((sequence) => Number.isSafeInteger(sequence) && sequence > 0);
  return sequences.length ? Math.max(...sequences) : null;
}

function rowToDemoCombo(combo = {}) {
  if (!combo || typeof combo !== 'object') return null;
  const comboId = sanitizeText(combo.combo_id, { maxLength: 80 });
  if (!comboId) return null;
  return {
    comboId,
    name: sanitizeText(combo.name, { fallback: 'Combo', maxLength: 120 }),
    quantity: Math.max(1, Math.floor(Number(combo.quantity) || 1)),
    listPrice: normalizeMoneyValue(combo.list_price, 0),
    promotionalPrice: normalizeMoneyValue(combo.promotional_price, 0),
    discountAmount: normalizeMoneyValue(combo.discount_amount, 0),
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

function normalizeAvailableRiderOrder(row = {}) {
  if (!row || typeof row !== 'object' || Array.isArray(row)) return null;
  const publicCode = sanitizeText(row.public_code, { maxLength: 80 });
  if (!publicCode) return null;
  const packageCount = Number(row.approximate_packages);
  const hasEstimate = row.estimated_minutes !== null && row.estimated_minutes !== undefined;
  const rawEstimate = Number(row.estimated_minutes);
  return {
    publicCode,
    generalZone: sanitizeText(row.general_zone, { maxLength: 120 }),
    pickupBranch: sanitizeText(row.pickup_branch, { maxLength: 180 }),
    approximatePackages: Number.isFinite(packageCount)
      ? Math.max(1, Math.min(100, Math.floor(packageCount)))
      : 1,
    paymentMethod: sanitizeText(row.payment_method, { maxLength: 40 }),
    collectionAmount: row.collection_amount === null || row.collection_amount === undefined
      ? null
      : normalizeMoneyValue(row.collection_amount, 0),
    estimatedMinutes: hasEstimate && Number.isFinite(rawEstimate)
      ? Math.max(1, Math.min(1440, Math.ceil(rawEstimate)))
      : null,
    operationalRestrictions: sanitizeText(row.operational_restrictions, { maxLength: 180 }),
    // La revisión del servidor viaja hasta el botón "Aceptar entrega": el claim
    // canónico la exige y sin ella el rider no puede tomar ningún pedido.
    revision: normalizeOrderRevision(row.revision),
    expectedStatus: 'ready',
    expectedRiderId: null,
  };
}

function normalizeActiveRider(row = {}) {
  if (!row || typeof row !== 'object' || Array.isArray(row)) return null;
  const id = sanitizeText(row.rider_user_id || row.id, { maxLength: 80 });
  if (!isUuid(id)) return null;
  const fallback = `Rider ${id.slice(-8).toUpperCase()}`;
  return {
    id,
    displayName: sanitizeText(row.display_name, { fallback, maxLength: 80 }),
  };
}

function trustedEstimatedArrival(source = {}, now = Date.now()) {
  const workflowStatus = normalizeWorkflowStatus(source.status, '');
  if (['delivered', 'canceled'].includes(workflowStatus)) return null;
  const etaSource = sanitizeText(source.estimated_arrival_source, { maxLength: 24 });
  if (!TRUSTED_ETA_SOURCES.has(etaSource)) return null;
  const arrivalAt = Date.parse(source.estimated_arrival_at || '');
  const updatedAt = Date.parse(source.estimated_arrival_updated_at || '');
  if (!Number.isFinite(arrivalAt) || !Number.isFinite(updatedAt)) return null;
  if (
    updatedAt > now + PUBLIC_TRACKING_GPS_FUTURE_TOLERANCE_MS
    || now - updatedAt > TRUSTED_ETA_MAX_AGE_MS
    || arrivalAt <= now
  ) {
    return null;
  }
  return {
    minutes: Math.max(1, Math.min(1440, Math.ceil((arrivalAt - now) / 60000))),
    source: etaSource,
    arrivalAt: new Date(arrivalAt).toISOString(),
    updatedAt: new Date(updatedAt).toISOString(),
  };
}

function latestPublicRiderLocation(location, now = Date.now()) {
  const normalized = latestRiderLocation(location ? [location] : []);
  if (!normalized) return null;
  const fixAt = Date.parse(normalized.lastFixAt || '');
  const accuracy = Number(normalized.accuracy);
  if (
    !Number.isFinite(fixAt)
    || !Number.isFinite(accuracy)
    || accuracy < 0
    || accuracy > PUBLIC_TRACKING_GPS_MAX_ACCURACY_METERS
    || fixAt > now + PUBLIC_TRACKING_GPS_FUTURE_TOLERANCE_MS
    || now - fixAt > PUBLIC_TRACKING_GPS_MAX_AGE_MS
  ) {
    return null;
  }
  return normalized;
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
  const sequencedHistory = statusHistoryFromSequencedEvents(row.order_events, createdAt);
  if (sequencedHistory.length) return dedupeHistory(sequencedHistory);

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
  if (row.cancelled_at || row.canceled_at || row.rejected_at || status === 'cancelled') {
    history.push({
      status: 'cancelled',
      at: normalizeIso(
        row.cancelled_at
        || row.canceled_at
        || row.rejected_at
        || row.updated_at
        || createdAt,
      ),
    });
  }
  return dedupeHistory(history);
}

function statusHistoryFromSequencedEvents(events, createdAt) {
  if (!Array.isArray(events)) return [];
  return [...events]
    .filter((event) => Number.isSafeInteger(Number(event?.sequence)) && Number(event.sequence) > 0)
    .sort((a, b) => Number(a.sequence) - Number(b.sequence))
    .map((event) => {
      const eventType = String(event.event_type || event.type || '');
      if (eventType === 'order.received') {
        return { status: 'received', at: normalizeIso(event.created_at || createdAt) };
      }
      if (eventType !== 'order.status_changed') return null;
      const nextStatus = event.metadata?.next_status || event.payload?.next_status;
      if (!nextStatus) return null;
      return {
        status: toDemoOrderStatus(normalizeWorkflowStatus(nextStatus)),
        at: normalizeIso(event.created_at || createdAt),
      };
    })
    .filter(Boolean);
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

function validateBusinessOrderRow(row, expectedBusinessId) {
  if (!row || typeof row !== 'object') return 'payload inválido';
  if (!isUuid(row.id)) return 'order_id ausente';
  if (row.business_id !== expectedBusinessId) return 'business_id incorrecto';
  if (!sanitizeText(row.public_code || row.code, { maxLength: 80 })) return 'código público ausente';
  if (normalizeOrderRevision(row.revision) === null) return 'revision ausente';
  if (!BUSINESS_INBOX_STATUSES.includes(normalizeWorkflowStatus(row.status, ''))) return 'estado fuera de bandeja';
  if (!Number.isFinite(Date.parse(row.created_at || ''))) return 'created_at inválido';
  if (!Number.isFinite(Date.parse(row.updated_at || row.created_at || ''))) return 'updated_at inválido';
  if (!sanitizeText(row.customer_name, { maxLength: 80 })) return 'cliente ausente';
  if (!sanitizeText(row.customer_phone, { maxLength: 40 })) return 'teléfono ausente';
  if (!['delivery', 'pickup'].includes(row.delivery_mode || row.fulfillment_type)) return 'modalidad ausente';
  if (!Array.isArray(row.order_items) || row.order_items.length === 0) return 'items ausentes';
  if (row.order_items.some((item) => (
    !item
    || !sanitizeText(item.product_uuid || item.product_id, { maxLength: 80 })
    || !sanitizeText(item.name, { maxLength: 100 })
    || !Number.isFinite(Number(item.quantity))
    || Number(item.quantity) <= 0
  ))) return 'item incompleto';
  if (!Array.isArray(row.order_events)) return 'eventos ausentes';
  if (row.order_events.some((event) => (
    !event
    || !Number.isSafeInteger(Number(event.sequence))
    || Number(event.sequence) < 1
  ))) return 'secuencia de eventos inválida';
  if (!Number.isFinite(Number(row.total)) || Number(row.total) < 0) return 'total inválido';
  if (!sanitizeText(row.currency_code, { maxLength: 3 })) return 'moneda ausente';
  if ((row.delivery_mode || row.fulfillment_type) === 'delivery') {
    const address = row.delivery_address_formatted || row.address_label || row.customer_street_address;
    if (!sanitizeText(address, { maxLength: 180 })) return 'dirección ausente';
  }
  return '';
}

function businessSnapshotErrorMessage(error, status) {
  const responseStatus = Number(status || error?.status || 0);
  const text = `${error?.message || ''} ${error?.details || ''}`.toLowerCase();
  if (responseStatus === 401 || text.includes('jwt') || text.includes('token')) {
    return 'La sesión venció. Volvé a iniciar sesión para recuperar los pedidos.';
  }
  if (responseStatus === 403 || error?.code === '42501' || text.includes('permission')) {
    return 'La membresía no autoriza leer pedidos de este comercio.';
  }
  return 'No pudimos consultar PostgreSQL; conservamos la última bandeja confirmada.';
}

function failedQuery(error, status, fallback) {
  return repositoryResult(false, {
    message: fallback || readableSupabaseError(error),
    errorCode: sanitizeText(error?.code, { maxLength: 40 }),
    status: Number(status || error?.status || 0) || undefined,
  });
}

// Los RPC canónicos del rider devuelven { ok:false, code } en jsonb en vez de
// levantar excepción. Se traduce cada código a una frase operable y se conserva
// el código y la revisión fresca para que el caller distinga conflicto de fallo.
function riderContractRefusal(data, messages, fallback) {
  const code = sanitizeText(data?.code, { maxLength: 60 });
  return repositoryResult(false, {
    code: code || 'RIDER_CONTRACT_REFUSED',
    conflict: code === 'stale_revision' || code === 'taken_by_other',
    revision: normalizeOrderRevision(data?.revision) ?? undefined,
    message: messages[code] || fallback,
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
  if (
    error?.code === '40001'
    || text.includes('expected')
    || text.includes('stale')
    || text.includes('estado actual')
    || text.includes('conflicto de estado')
  ) {
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

function readableRiderAssignmentError(error) {
  const text = `${error?.message || ''} ${error?.details || ''}`.toLowerCase();
  if (
    error?.code === '40001'
    || text.includes('conflicto de asignacion')
    || text.includes('conflicto de asignación')
  ) {
    return 'Otro dispositivo actualizó la asignación. Refrescá la bandeja antes de continuar.';
  }
  if (
    error?.code === '42501'
    || text.includes('rol rider')
    || text.includes('rol de negocio')
    || text.includes('acceso')
  ) {
    return 'Tu cuenta no tiene permiso para asignar este pedido.';
  }
  if (text.includes('rider activo')) {
    return 'Ese rider ya no está activo en el negocio.';
  }
  return readableSupabaseError(error, 'No pudimos actualizar la asignación del rider.');
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

function readInitialOrderAccess(storage, key) {
  const current = readStoredAccess(storage, key);
  if (current) return current;

  const transferredStorage = safeLocalStorage();
  if (!transferredStorage || transferredStorage === storage) return null;
  const transferred = readStoredAccess(transferredStorage, key);
  if (!transferred) return null;

  // A handoff page may only bridge origins through localStorage. Consume it
  // once, move it to the tab-scoped session store, then remove the durable copy.
  persistOrderAccess({ storage, key, access: transferred });
  removeStoredAccess(transferredStorage, key);
  return transferred;
}

function hasUsableTrackingAccess(access) {
  if (!access || !isSafeTrackingToken(access.trackingToken)) return false;
  const expiresAt = normalizeOptionalIso(access.tokenExpiresAt || access.expiresAt);
  return !expiresAt || Date.parse(expiresAt) > Date.now();
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

function resolveTrackingAccessOrder(orders, access) {
  const candidates = Array.isArray(orders) ? orders : [];
  const backendId = String(access?.orderId || '').trim();
  const publicCode = String(access?.publicCode || '').trim();
  const backendMatches = backendId
    ? candidates.filter((order) => (
      String(order?.backendId || '').trim() === backendId
      || (isUuid(order?.id) && String(order.id) === backendId)
    ))
    : [];
  const publicMatches = publicCode
    ? candidates.filter((order) => String(order?.code || '').trim() === publicCode)
    : [];

  if (backendMatches.length > 1 || publicMatches.length > 1) {
    return { kind: 'conflict', order: null };
  }

  const backendOrder = backendMatches[0] || null;
  const publicOrder = publicMatches[0] || null;
  if (backendOrder && publicOrder && backendOrder !== publicOrder) {
    return { kind: 'conflict', order: null };
  }

  const order = backendOrder || publicOrder;
  if (!order) return { kind: 'missing', order: null };
  return {
    kind: backendOrder && publicOrder
      ? 'backend-and-public'
      : backendOrder ? 'backend' : 'public',
    order,
  };
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

function trustedMercadoPagoCheckoutUrl(value) {
  try {
    const url = new URL(String(value || ''));
    const host = url.hostname.toLowerCase();
    const trusted = host === 'mercadopago.com'
      || host.endsWith('.mercadopago.com')
      || host === 'mercadopago.com.ar'
      || host.endsWith('.mercadopago.com.ar');
    return url.protocol === 'https:' && trusted ? url.toString() : '';
  } catch (_) {
    return '';
  }
}

function sanitizeChannelName(value) {
  return String(value || 'taba')
    .replace(/[^a-zA-Z0-9_-]/g, '-')
    .slice(0, 80);
}

function isUuid(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(value || ''));
}

// El contrato del servidor (transition_order, cancel_order, y todos los RPC de
// rider) valida `^[A-Za-z0-9_-]{8,128}$`: sin dos puntos. Una clave con `:`
// muere en 22023 y el outbox la clasifica como fallo permanente, así que acá
// se sanea de forma DETERMINÍSTICA (mismo input → misma clave) antes de enviar.
function normalizeIdempotencyKey(value) {
  const normalized = String(value || '').trim().replace(/[^A-Za-z0-9_-]/g, '-');
  if (/^[A-Za-z0-9_-]{8,128}$/.test(normalized)) return normalized;
  const uuid = globalThis.crypto?.randomUUID?.();
  if (uuid) return `order-transition-${uuid}`;
  return `order-transition-${Date.now()}-${Math.random().toString(36).slice(2)}`;
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

function safeLocalStorage() {
  try {
    return globalThis.localStorage || null;
  } catch (_) {
    return null;
  }
}
